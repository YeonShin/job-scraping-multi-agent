# ADR-002: 코드 기반 하네스(Harness) 도입 및 파이프라인 아키텍처 개편

* **문서 상태**: 승인됨 (Accepted)
* **결정 일자**: 2026-10-06
* **결정 주체**: 프로젝트 설계자 (Yeon)
* **문맥 키워드**: `Architecture Decision Record`, `Harness Engineering`, `Pipeline Spec`, `Queue-Based Decoupling`, `scanController`, `jobFilter`, `reviewQueue`, `publishRun`, `Before-After Comparison`

---

## 1. 개편 배경 및 문제 정의 (Context & Problem Statement)

초기 프로토타입 시스템은 LLM(서브에이전트)이 목록 탐색부터 필터 조작, 본문 열람, 상태 판단, 노션 발행까지 **전 과정을 자연어 추론과 단일 브라우징 세션으로 수행하는 'LLM 중심(LLM-Heavy) 구조'**였습니다.

그러나 실제 운영 테스트 과정에서 마주한 주요 문제는 비용 이전에 **"에이전트가 설계한 규격과 지침대로 신뢰성 있게 동작하지 않는다(Lack of Determinism & Operational Reliability)"**는 점이었습니다.

### 🚨 핵심 문제: 에이전트 동작의 신뢰성 결여 (Reliability Issue)
LLM에게 상태 머신 판단과 절차적 규칙 제어를 위임하자, 컨텍스트가 길어질수록 프롬프트의 지침을 제멋대로 생략하거나 왜곡하는 현상이 빈번하게 발생했습니다:
1. **중복 필터링 오작동 및 누락**:
   - 기존 노션 DB 캐시 대조를 정밀하게 수행하지 않고 대충 넘어가거나, 이미 등록된 공고를 새 공고로 착각하여 중복 처리하는 문제 발생.
   - 노션 등록 시 중복 판단이 공고 URL, 제목 일치 등 약한 기준에 의존했고, 같은 공고가 다른 플랫폼에 올라온 경우를 구분하지 못함.
2. **head/tail 앵커 구간 스킵 판단 붕괴**:
   - 이전 세션의 수집 경계(`headJobId`, `tailJobId`)를 만나면 스킵 모드로 전환해야 함에도, LLM의 자의적 판단으로 구간을 건너뛰지 못하거나 엉뚱한 페이지로 튀어버림.
3. **목록 수집 방식의 비효율 (한 번에 추출하지 않고 스크롤·DOM 읽기를 반복)**:
   - 의도한 방식은 목록 페이지에 진입해 JS 쿼리를 **한 번** 실행하고 공고 배열(id, 제목, 회사 등)을 통째로 가져오는 것이었습니다.
   - 그러나 지침에는 컨테이너 셀렉터가 설명문으로만 적혀 있었고, **실행 가능한 단일 추출 코드가 없었습니다.** 그 결과 브라우저 서브에이전트가 스크롤을 내리고 → DOM을 읽고 → 다시 스크롤하는 과정을 반복했습니다.
   - 이로 인해 수집 시간이 오래 걸리고 호출마다 컨텍스트가 쌓였으며, 에이전트가 화면에서 읽은 **부분 결과**에 의존하게 되어 이후의 중복 판정과 앵커 스킵 판단까지 불안정해졌습니다.
4. **비단조적(Non-monotonic) 플랫폼에서의 공고 유실**:
   - 잡코리아와 원티드는 공고 수정/끌올 기준 정렬이라 ID 역전이 빈번함에도, LLM이 단순 ID 대소 비교로 조기 종료해버려 대량의 신규 공고가 유실됨.

### ⚠️ 파생된 부차적 문제들
* **컨텍스트 비대화 및 지연**: 에이전트가 긴 루프를 돌며 신뢰성 없는 판단을 반복하다 보니 대화 컨텍스트가 비대해지고 실행 속도가 저하됨.
* **탈락 공고의 무한 재심사**: 노션 DB에는 합격건만 올라가므로, 어제 탈락시킨 공고를 오늘 또 새 공고로 오인하여 브라우저로 본문을 다시 열어보는 낭비 발생.
* **수집-심사 결합으로 인한 복원력 부재**: 브라우저 다운이나 예외 발생 시 "어디까지 수집했고 무엇을 검토했는지" 상태 추적이 불가능하여 처음부터 전체를 재실행해야 함.

---

## 2. 아키텍처 핵심 원칙: "Brain & Harness의 명확한 분리"

위 문제를 통해 얻은 핵심 교훈은 **"LLM에게 절차적 제어 흐름(Control Flow)과 규칙 강제(Rule Enforcement)를 맡기면 반드시 무너진다"**는 점이었습니다.

따라서 **"판단·중복검증·구간점프·발행·상태관리는 전용 Node.js 도구(Harness)가 코드로 강제하고, LLM은 코드가 떠먹여주는 공고의 상세 본문 분석에만 집중하도록 격리한다"**는 하네스 엔지니어링 원칙을 수립하고 전면 개편을 단행했습니다.

```text
[ 이전 구조 (Before): LLM 중심의 취약한 모놀리식 ]
사용자 명령 ➔ LLM 에이전트가 "목록 탐색 + 앵커 판단 + 중복 대조 + 본문 열람 + 판정 + 발행"을 혼자서 수행
🚨 문제점: 스크롤·DOM 읽기 반복으로 수집 지연, 중복 필터 실패, head/tail 스킵 오작동 등 신뢰성 저하

[ 개편된 구조 (After): 코드 하네스 기반 상태 강제 & 역할 분리 ]
Phase 1. 수집 에이전트 ──(snippet.js 실행)──► tools/scanController.js (코드가 NEXT/JUMP/STOP 결정론적 제어)
                                                     │
                                                     ▼
                                              tools/jobFilter.js (5단계 사전 필터링 및 큐 적재)
                                                     │
                                                     ▼ (안전 격리)
Phase 2. 심사 에이전트 ◄───(12건 Lease 할당)──── tools/reviewQueue.js (작업 큐 & 18개 속성 스키마 강제)
               │                                     │
               └─────────(1건씩 submit)─────────────► results.jsonl + registry.json (영구 이력 보존)
                                                     │
Phase 3. 발행 오케스트레이터 ──────────────────► tools/publishRun.js (교차 중복제거 & 350ms 노션 안전 발행)
                                                     │
Phase 4. 모니터링 & 워치독 ───────────────────► tools/watchdog.js & discordNotifier.js (완주 보장 감시)
```

---

## 3. 이전 구조 vs 개편된 구조 상세 비교

| 비교 영역 | 이전 구조 (Before) | 개편된 구조 (After) |
| :--- | :--- | :--- |
| **목록 추출 방식** | 지침에 셀렉터가 설명문으로만 존재. 에이전트가 스크롤 → DOM 읽기를 반복하며 수집 | 독립 `snippet.js`를 `browser_evaluate`로 **1회 실행**해 목록 전체를 JSON으로 수신 |
| **페이지 이동** | 에이전트 자율 | 사람인은 URL 이동. 잡코리아는 URL 파라미터가 반영되지 않는 구조라 버튼 클릭 등 브라우저 조작으로 이동(서브에이전트가 직접 판단). 원티드는 무한 스크롤을 명시된 단계로만 수행 |
| **제어 주체** | LLM 자연어 판단 | 중복 필터, 앵커 스킵, 종료 판단을 `scanController`, `jobFilter`가 코드로 수행 |
| **상태 보관** | LLM 컨텍스트에 의존 | 목록, 심사 큐, 결과를 `data/runs/{runId}/` 아래 JSON 파일로 저장하고 이를 기준으로 필터 |
| **역할 구성** | 서브에이전트 하나가 목록 수집, 본문 열람, 노션 등록을 모두 수행 | 수집 에이전트(목록) / 심사 에이전트(본문 열람, 심사) / 오케스트레이터(노션 발행, 디스코드 알림)로 분리 |
| **노션 중복 방지** | 공고 URL, 제목 일치 등으로 대조 | 노션 DB에 `공고키`(`플랫폼명:공고id`) 속성을 추가해 1순위 기준으로 사용. 이후 `companyKey`, 제목 유사도 순으로 보조 |
| **교차 플랫폼 중복** | 구분 수단 없음 | 기업명 정규화(별칭표)와 제목 유사도(자카드)로 의심 공고를 표시하고, 발행 시 먼저 들어온 1건만 등록 |
| **점프 정책** | 모든 플랫폼에 동일 규칙 적용 | 플랫폼별로 다름. 사람인은 ID 단조 감소가 확인되어 점프 허용, 잡코리아와 원티드는 ID 역전 가능성을 고려해 점프 비활성 및 1페이지씩 앵커 검증 |
| **탈락 공고 이력** | 기록 없음 (노션에는 합격건만 존재) | `data/registry.json`에 영구 기록하여 다음 실행 시 목록 단계에서 제외 |
| **통계** | 전체 / 스킵 / 등록 수준 | 트랙별로 목록 수, 앵커 구간 스킵, 중복 스킵, 의심, 큐 적재, 심사, 합격, 탈락, 등록으로 세분화 |
| **동시 실행·장애 대응** | 세션 상태 추적 불가 | `runLock`으로 세션 상호 배제, 단계별 파일 저장, `retry.jsonl`, `watchdog`으로 중단 지점 파악 |


---

## 4. 핵심 개편 과정 및 도입 기술 (Implementation Journey)

### 4.1. 목록 추출 `snippet.js` 분리 및 [`scanController.js`](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/tools/scanController.js)
* **한 번에 추출하는 단일 원천 코드 도입**:
  - 이전에는 목록 DOM 파싱 방법이 지침에 설명문으로만 있어, 에이전트가 스크롤과 DOM 읽기를 반복하며 수집했습니다.
  - 각 플랫폼 스킬 디렉터리에 읽기 전용 IIFE 파일([`scout-saramin/snippet.js`](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/.agents/skills/scout-saramin/snippet.js), [`scout-jobkorea/snippet.js`](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/.agents/skills/scout-jobkorea/snippet.js), [`scout-wanted/snippet.js`](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/.agents/skills/scout-wanted/snippet.js))을 두었습니다.
  - 에이전트는 페이지 진입 후 이 파일을 `browser_evaluate`로 1회 실행하고, 반환된 `{id, url, title, company, ...}` 배열과 `appliedFilters`를 `scanController.js step`에 넘깁니다. 이후 흐름은 반환된 액션(`NEXT_PAGE`, `JUMP_PAGE`, `STOP`)만 따릅니다.
* **페이지 이동 방식은 사이트 구조에 맞춤**:
  - 사람인은 URL 이동이 가능합니다.
  - 잡코리아는 필터와 페이지 상태가 URL 파라미터에 반영되지 않으므로, 서브에이전트가 직접 판단해 버튼 클릭 등 브라우저 조작으로 이동합니다.
  - 원티드는 무한 스크롤이므로 스크롤 후 대기, `snippet.js` 재실행을 명시된 단계로 수행합니다.
* **플랫폼 ID 단조성 실측 및 안전 점프**:
  - 3개 플랫폼의 실제 DOM 및 56개 샘플의 ID 정렬을 직접 측정했습니다.
  - **사람인**: 최신순 정렬 시 ID 단조 감소가 성립 ➔ URL 직접 점프(`JUMP_PAGE`) 활성화.
  - **잡코리아 / 원티드**: 수정/끌올 기준 정렬로 인해 ID 역전 빈번 ➔ 직접 점프를 비활성화(`jumpEnabled: false`)하고 1페이지씩 3-Window 앵커 매칭 수행.

### 4.2. [`jobFilter.js`](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/tools/jobFilter.js) & [`jobKeys.js`](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/tools/jobKeys.js)
* **공고키 속성**: 노션 DB에 `공고키`(`플랫폼명:공고id`, 예: `saramin:51234567`) 속성을 추가하여 URL, 제목 대조보다 먼저, 더 명확하게 중복을 판정합니다.
* **키 정규화**: URL 트래킹 파라미터 제거, 법인 수식어(`(주)`, `Inc.`) 제거, 공고 제목의 노이즈 키워드(`[신입]`, `2025년 상반기`, `채용`) 제거.
* **기업명 동의어 사전 ([`config/company-aliases.json`](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/config/company-aliases.json))**: `kakao` ➔ `카카오`, `woowabrothers` ➔ `우아한형제들` 매핑을 통해 플랫폼 간 명칭 불일치 해결.
* **자카드 유사도 (Jaccard Bigram)**: 동일 기업 내 제목 유사도가 70% 이상인 경우 `SUSPECT` 판정 및 `dupHint`를 부여하여 심사관에게 사전 경고.

### 4.3. [`reviewQueue.js`](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/tools/reviewQueue.js) & [`job-reviewer`](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/.agents/skills/job-reviewer/SKILL.md)
* **단일 책임 서브에이전트**: 심사 에이전트는 본문 열람 ➔ 판정 ➔ `submit`만 수행하도록 역할을 단순화.
* **30분 Lease 잠금**: 여러 심사관이 동시에 투입되어도 겹치지 않도록 `review_queue.json` 내 항목에 임대 타임스탬프를 부여.
* **스키마 검증**: 18개 필수 속성, 노션 select 표준 옵션, 날짜 포맷(`YYYY-MM-DD`), AI 3줄 요약 필수 헤더(`• [지원 적합도]`, `• [핵심 업무]`, `• [어필 포인트]`)를 정규식 및 enum set으로 검증.

### 4.4. [`publishRun.js`](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/tools/publishRun.js) & [`registry.json`](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/data/registry.json)
* **탈락 공고 영구 보존**: 노션에는 올리지 않는 탈락 공고도 `data/registry.json`에 영구 기록하여 익일 스크랩 시 목록 단계에서 걸러냄.
* **크로스 플랫폼 중복 제거**: 사람인과 잡코리아 양쪽에서 합격한 동일 공고 중 먼저 들어온 1건만 노션에 발행하고, 후순위 공고는 `DUPLICATE_CONFIRMED`로 안전하게 탈락 처리.
* **안전 발행**: 350ms 간격 순차 발행 및 실패건 [`data/retry.jsonl`](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/data/retry.jsonl) 자동 누적.

### 4.5. [`runLock.js`](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/tools/runLock.js) & [`watchdog.js`](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/tools/watchdog.js)
* **세션 상호 배제**: 세션 잠금(`.lock`)을 통해 다중 스케줄 충돌 방지.
* **전 구간 완주 감시**: 세션 폴더 내 `summary.json`과 `report_sent.json`의 존재 여부를 감시하여 비정상 종료 시 디스코드 장애 알림(`--error`) 발송.

### 4.6. 책임 분리 요약
* **코드로 이동한 로직**: 노션 중복 필터(캐시 기반), 앵커 기준 스킵, 목록 수집 결과와 심사 큐의 파일 저장, 세션 잠금. LLM 컨텍스트가 아니라 JSON 파일이 상태의 기준입니다.
* **역할 분할**: 수집 에이전트는 목록만, 심사 에이전트는 본문 열람과 심사만, 오케스트레이터는 서브에이전트가 정리한 결과로 노션 등록과 디스코드 알림을 수행합니다.
* **통계 세분화**: 트랙별 `listed`, `coveredSkipped`, `dupSkipped`, `suspected`, `queued`, `reviewed`, `passed`, `rejected`와 발행 결과를 집계해 리포트가 운영 판단에 쓰이도록 했습니다.
* **필터 조정**: 사람인 `cat_kewd`를 IT 전체에서 `84,86,87,92,89,91,101`(track1), `92,87`(track2)로 좁혔습니다. IT 전체로 두면 게임 개발, 헬프데스크 등 관련 없는 공고까지 수집되었기 때문입니다. 기준은 [`job-criteria.md`](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/.agents/rules/job-criteria.md)와 `config/pipeline.json`에 반영되어 있습니다.

---

## 5. 검증 및 테스트 결과 (Verification & Test Results)

본 개편 작업은 9개의 전용 단위 테스트 스위트와 실제 실측 리허설을 통해 신뢰성을 검증했습니다:

1. **단위 테스트 (`tests/` 9개 스위트)**:
   * `jobFilter.test.js`: 5단계 필터링 및 의심 공고 탐지 검증
   * `jobKeys.test.js`: URL/사명/제목 정규화 및 자카드 유사도 연산 검증
   * `scanController.test.js`: 3단계 상태머신 및 플랫폼별 점프 제어 검증
   * `reviewQueue.test.js`: 30분 Lease 원자적 배분 및 18개 속성 스키마 검증
   * `publishRun.test.js`: 교차 중복 1건 선별, 노션 Rate Limit 준수, retry 누적 검증
   * `registry.test.js`, `runLock.test.js`, `watchdog.test.js`, `publisher.test.js`
2. **실전 리허설 검증 (`runId: 20261005-2137`, `20261006-1534`)**:
   * 사람인 트랙 목록 수집 ➔ `scanController` 스텝 정상 제어
   * `jobFilter`를 통한 신규 공고 선별 ➔ `reviewQueue` 12건 단위 배치 정상 할당
   * 심사 에이전트의 상세 본문 브라우징 및 18개 속성 추출 ➔ `results.jsonl` 실시간 누적
   * `publishRun`을 통한 노션 DB 정상 등록 및 디스코드 리포트 전송 완주 확인

---

## 6. 최종 결론 및 권장사항 (Conclusion)

본 아키텍처 개편을 통해 **"LLM의 불안정한 상태 추론과 긴 컨텍스트에 의존하던 취약한 파이프라인"**에서 **"코드가 상태와 데이터 흐름을 관리하고 LLM은 비정형 본문 심사에 집중하는 하이브리드 구조"**로 전환했습니다.

* **운영 규칙**: 향후 시스템 운영 시 대화창 에이전트는 코드 수정자가 아닌 **총괄 오케스트레이터(Operator)** 역할을 수행하며, 도구의 검증된 CLI 인터페이스만을 호출하여 파이프라인을 지휘해야 합니다.
