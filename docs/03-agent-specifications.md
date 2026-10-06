# 3. 에이전트 계층별 상세 명세 (Agent Specifications)

본 문서는 Antigravity 네이티브 멀티 에이전트 시스템을 구성하는 총괄 오케스트레이터(Chief Orchestrator)와 플랫폼별 전문 서브에이전트 스킬(.agents/skills/)의 역할 및 입출력 명세를 정의합니다.

---

## 3.1 총괄 오케스트레이터 (Chief Orchestrator)

### 3.1.1 책임과 역할
* **전체 파이프라인 수명 주기 총괄**: 사용자 명령 시 가동되어 세션 잠금부터 디스코드 리포팅 및 잠금 해제까지 전 과정을 지휘.
* **병렬 위임 및 동시성 제어**: 사람인, 잡코리아, 원티드 수집 서브에이전트에게 목록 탐색 임무를 병렬로 위임.
* **심사 큐 모니터링 및 배분**: `reviewQueue.js status`로 대기 건수를 확인하고, 배치(기본 12건) 단위로 `job-reviewer`를 2~3개씩 투입. 대기·점유 건수가 모두 0이 될 때까지 반복.
* **발행**: 수집·심사 결과를 기반으로 `publishRun.js`로 노션 등록, `discordNotifier.js`로 리포트 발송.
* **기준 감독**: [job-criteria.md](../.agents/rules/job-criteria.md)의 트랙 정의와 심사 기준을 서브에이전트가 따르도록 지휘.
* **종합 리포트 발행**: 플랫폼별 수집 수량, 심사 통과 수량, 탈락 수량을 집계하여 Discord 리포트 발송.

---

## 3.2 서브에이전트 스킬 명세

서브에이전트는 **수집(Scout, 플랫폼별 3종)** 과 **심사(Reviewer, 1종)** 로 역할이 나뉩니다. 수집 에이전트는 목록 메타데이터만 추출하고, 본문 열람과 심사는 `job-reviewer`가 큐에서 받아 수행합니다. 공통 원칙: 수집 에이전트는 본문 열람, 심사, 노션 발행, 체크포인트 수정을 하지 않습니다.

### 수집 에이전트 공통 동작
1. 플랫폼별 필터가 적용된 목록 페이지에 진입.
2. 스킬 폴더의 `snippet.js`를 `browser_evaluate`로 **1회 실행**하여 목록을 JSON으로 수신. 광고 영역 배제는 snippet의 컨테이너 셀렉터가 처리합니다.
3. 결과를 `tools/scanController.js step`에 전달하고, 반환된 액션(`NEXT_PAGE`, `JUMP_PAGE`, `STOP`)을 수행.

### 3.2.1 사람인 스카우트 ([scout-saramin](../.agents/skills/scout-saramin/SKILL.md))
* **역할**: 사람인 직업별 채용정보(`job-category`) 트랙 1·2의 **목록 수집**. 페이지 이동은 URL 기반이며, 점프(`JUMP_PAGE`)가 허용되는 플랫폼입니다.
* **도구**: `browser_subagent`, `browser_evaluate`([snippet.js](../.agents/skills/scout-saramin/snippet.js) 실행)
* **목록 타깃팅 (광고 배제)**: snippet이 **`div.common_recruilt_list` (또는 `.common_recruit_list`)** 내부의 `a[href*="rec_idx="]`만 추출하므로 상단 유료 광고(파워채용 등)는 포함되지 않습니다.
* **탐색 규모**: 운영 트랙 track1+track2, 필터 설정값은 [job-criteria.md §4.1](../.agents/rules/job-criteria.md) 참조.

### 3.2.2 잡코리아 스카우트 ([scout-jobkorea](../.agents/skills/scout-jobkorea/SKILL.md))
* **역할**: 잡코리아 직무별 채용정보(`menucode=duty`) 트랙 1·2의 **목록 수집**. 점프는 비활성이며 1페이지씩 앵커를 검증합니다.
* **도구**: `browser_subagent`, `browser_evaluate`([snippet.js](../.agents/skills/scout-jobkorea/snippet.js) 실행)
* **목록 타깃팅 (광고 배제)**: snippet이 **`#dev-gi-list`** 내부의 `a[href*="GI_Read/"]`만 추출하므로 상단 스페셜/포커스 광고는 포함되지 않습니다.
* **탐색 규모**: 운영 트랙 track1+track2. 필터는 URL 파라미터가 아니라 **UI 클릭으로만** 적용되며, 클릭 항목은 [job-criteria.md §4.3](../.agents/rules/job-criteria.md) 참조.
* **페이지 이동**: 필터와 페이지 상태가 URL에 반영되지 않으므로, 서브에이전트가 직접 판단해 버튼 클릭 등 브라우저 조작으로 이동합니다.

### 3.2.3 원티드 스카우트 ([scout-wanted](../.agents/skills/scout-wanted/SKILL.md))
* **역할**: 원티드 신입 웹/프론트엔드 채용공고 **목록 수집** (**track2만 운영**). 점프는 비활성이며, 무한 스크롤이므로 맨 아래 스크롤 후 대기, `snippet.js` 재실행 순으로 진행합니다.
* **도구**: `browser_subagent`, `browser_evaluate`([snippet.js](../.agents/skills/scout-wanted/snippet.js) 실행)
* **탐색 규모**: 필터 설정값(직군 `518`, 직무 `669`/`873`, 신입 `years=0`)은 [job-criteria.md §4.2](../.agents/rules/job-criteria.md) 참조.

### 3.2.4 심사 에이전트 ([job-reviewer](../.agents/skills/job-reviewer/SKILL.md))
* **역할**: 플랫폼 구분 없이 심사 큐의 공고 본문을 열람하고 [job-criteria.md](../.agents/rules/job-criteria.md) 기준으로 판정. 합격 공고는 18개 표준 속성과 AI 3줄 요약을 작성.
* **흐름**: `reviewQueue.js next`로 배치(기본 12건, 30분 Lease) 수령 → 공고별 본문 열람 → `reviewQueue.js submit`으로 **1건씩 즉시 제출** → 배치 1개 처리 후 종료.
* **본문 접근**: 사람인은 iframe 직통 `https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx={id}`, 잡코리아·원티드는 `detailUrl`로 진입. 통이미지 공고는 스크린샷으로 판독.
* **금지**: 노션 등록, 디스코드 알림, 체크포인트·레지스트리 수정.

### 3.2.5 노션 동기화 스킬 ([notion-job-sync](../.agents/skills/notion-job-sync/SKILL.md))
* **역할**: 기존 등록 공고 중복 캐시 조회, 재공고 판별, 18개 속성 표준 규격 관리. 실제 발행은 `publishRun.js`가 수행.
* **도구**: [tools/notionJobFetcher.js](../tools/notionJobFetcher.js), [tools/publishRun.js](../tools/publishRun.js), Notion MCP

---

## 3.3 표준 공고 데이터 인터페이스 (Job Data Payload)

심사 에이전트가 심사를 완료하고 노션 등록으로 넘기는 데이터 스키마(심사 결과 줄, `job` 필드, 허용 enum 포함)는 **[pipeline-spec.md §4.5, §5](pipeline-spec.md)** 가 유일한 원천입니다. (이전 버전의 `role_category`, `rounds` 등 snake_case 스키마는 폐기되었습니다.)
