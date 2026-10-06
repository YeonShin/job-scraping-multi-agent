# 파이프라인 데이터·CLI 규격 (Pipeline Spec) — 유일한 원천

이 문서는 **jobKey, 정규화 키, 파일 배치, JSON 스키마, 허용 enum, 설정값, 실행 순서**의 유일한 원천입니다.
심사 기준·트랙 정의·플랫폼 필터 값은 [.agents/rules/job-criteria.md](../.agents/rules/job-criteria.md)를 따릅니다.
이 두 문서가 다른 문서와 충돌하면 이 두 문서가 우선합니다.

> 상태: 1단계(규격 정의). 이 문서의 일부(레지스트리, scanController, 심사 큐 등)는 이후 단계에서 구현됩니다.

---

## 1. 공고키 (jobKey)

형식: `{platform}:{id}` — `platform` ∈ `saramin` | `jobkorea` | `wanted`

| 플랫폼 | 추출 방법 | 예시 |
| :--- | :--- | :--- |
| saramin | URL 쿼리 `rec_idx` | `saramin:51234567` |
| jobkorea | 경로 정규식 `/GI_Read/(\d+)` | `jobkorea:47891234` |
| wanted | 경로 정규식 `/wd/(\d+)` | `wanted:301234` |
| 그 외 | `url:{정규화 URL}` | `url:https://careers.example.com/jobs?id=77` |

**URL 정규화 (그 외 플랫폼)**: 트래킹 파라미터(`utm_*`, `ref`, `tracking_id` 등)만 제거하고, **공고 식별 파라미터는 보존**한다. 프래그먼트(`#...`)와 끝 슬래시는 제거한다.

## 2. 정규화 키

### companyKey
1. 제거: `(주)`, `㈜`, `주식회사`, `유한회사`, `Inc.`, `Corp.`, `Co.`, `Ltd.`
2. 공백·특수문자 제거
3. 영문 소문자화
4. [config/company-aliases.json](../config/company-aliases.json) 별칭표 적용 (예: `naver` → `네이버`)

### titleKey
다음을 제거한 뒤 공백·특수문자를 제거한다.
* 대괄호 `[...]`, 소괄호 `(...)` 안의 내용(괄호 포함)
* 연도(4자리 숫자)
* `상반기`, `하반기`
* `신입`, `경력`, `경력무관`
* `채용`, `모집`, `공고`, `정규직`

## 3. 파일 배치

| 경로 | 용도 |
| :--- | :--- |
| `data/cache/notion_jobs.json` | 노션 캐시 (fetcher가 생성) |
| `data/registry.json` | 처리 이력 레지스트리 (published / rejected / failed) |
| `data/retry.jsonl` | 등록 실패 재시도 큐 |
| `data/checkpoints/{site}/{track}.json` | 체크포인트 (원티드도 `track2.json`으로 통일) |
| `data/runs/{runId}/` | 실행 단위 디렉터리. `runId` = KST `YYYYMMDD-HHmm` |
| `data/runs/{runId}/{site}_{track}/page_{n}.json` | 목록 추출 결과 |
| `data/runs/{runId}/{site}_{track}/state.json` | scanController 상태 |
| `data/runs/{runId}/{site}_{track}/proposed_checkpoint.json` | 확정 전 체크포인트 |
| `data/runs/{runId}/review_queue.json` | 심사 대기 큐 |
| `data/runs/{runId}/results.jsonl` | 심사 결과 (1건당 1줄, 즉시 추가) |
| `data/runs/{runId}/publish_result.json` | 발행 결과 |
| `data/runs/{runId}/summary.json` | 실행 요약 |
| `config/pipeline.json` | 상한값 등 설정 |
| `config/company-aliases.json` | 회사명 별칭표 |

## 4. 스키마

### 4.1 노션 캐시 항목 (`data/cache/notion_jobs.json`)
| 필드 | 설명 |
| :--- | :--- |
| pageId | 노션 페이지 ID |
| jobKey | 노션 `공고키` 속성. 없으면 URL에서 추출 시도 |
| url | 채용링크 원문 |
| normalizedUrl | 정규화 URL |
| company / companyKey | 기업명 / 정규화 키 |
| position / titleKey | 채용직무 / **position 기준** 정규화 키 |
| status | 노션 상태 값 |

```json
{
  "pageId": "1a2b3c4d-0000-0000-0000-000000000001",
  "jobKey": "saramin:51234567",
  "url": "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=51234567&utm_source=x",
  "normalizedUrl": "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=51234567",
  "company": "(주)토스뱅크",
  "companyKey": "토스뱅크",
  "position": "[2026 상반기] Frontend Developer 신입",
  "titleKey": "frontenddeveloper",
  "status": "미지원"
}
```

### 4.2 레지스트리 항목 (`data/registry.json`)
`key = jobKey`, `value` 구조:

```json
{
  "saramin:51234567": {
    "verdict": "published",
    "site": "saramin",
    "track": "track2",
    "company": "토스뱅크",
    "companyKey": "토스뱅크",
    "rawTitle": "[2026 상반기] Frontend Developer 신입",
    "titleKey": "frontenddeveloper",
    "position": "Frontend Developer",
    "notionPageId": "1a2b3c4d-0000-0000-0000-000000000001",
    "reasonCode": null,
    "reason": null,
    "runId": "20261005-0200",
    "updatedAt": "2026-10-05T02:41:10+09:00"
  }
}
```
* `verdict`: `passed` | `published` | `rejected` | `failed`
  * 상태 전이 흐름:
    * `(없음)` → `passed` (심사 통과, 등록 대기) | `rejected` (심사 탈락)
    * `passed` → `published` (노션 DB 발행 완료) | `failed` (노션 API 오류 등 발행 실패)
    * `failed` → `published` (다음 실행 시 `retry.jsonl` 재시도 성공)
* `rejected`이면 `reasonCode`는 job-criteria.md의 탈락 사유 코드.
* `jobFilter` 판정 1번(레지스트리 대조): 레지스트리에 키가 존재하면 `published`, `rejected`, `failed`뿐만 아니라 `passed`(등록 대기) 상태인 공고도 중복 스킵 대상(`SKIP_REGISTRY`)입니다.

### 4.3 목록 페이지 파일 (`{site}_{track}/page_{n}.json`)
```json
{
  "site": "saramin",
  "track": "track1",
  "page": 1,
  "capturedAt": "2026-10-05T02:05:00+09:00",
  "appliedFilters": ["exp_cd=1", "cat_mcls=2", "company_type=scale001,scale002,scale003", "sort=RD"],
  "items": [
    {
      "id": "51234567",
      "url": "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=51234567",
      "title": "웹 프론트엔드 개발자 (신입)",
      "company": "(주)예시컴퍼니",
      "career": "신입"
    }
  ]
}
```
`career`는 목록에 노출된 경력 문구 **원문** 그대로.

### 4.4 심사 큐 항목 (`review_queue.json`)
```json
{
  "jobKey": "saramin:51234567",
  "site": "saramin",
  "track": "track1",
  "detailUrl": "https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx=51234567",
  "title": "웹 프론트엔드 개발자 (신입)",
  "company": "(주)예시컴퍼니",
  "career": "신입",
  "dupHint": {
    "matchedKey": "jobkorea:47891234",
    "matchedTitle": "프론트엔드 개발자",
    "reason": "companyKey 동일 + titleKey 유사도 0.82"
  }
}
```
`dupHint`는 선택 필드 (유사 공고가 의심될 때만).

### 4.5 심사 결과 줄 (`results.jsonl`, 1건 1줄)
```json
{"jobKey":"saramin:51234567","site":"saramin","track":"track1","verdict":"pass","reasonCode":null,"reason":null,"job":{"company":"예시컴퍼니","position":"웹 프론트엔드 개발자","rawTitle":"웹 프론트엔드 개발자 (신입)","jobKey":"saramin:51234567","url":"https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=51234567","jobCategory":"프론트엔드","experienceLevel":"신입","employmentType":"정규직","industry":"IT/소프트웨어","industryDetail":"B2B SaaS","companyScale":"대기업","location":"서울 강남구","deadline":"2026-10-31","postedDate":"2026-10-05","documents":["이력서","포트폴리오"],"1차":"서류전형","2차":"코딩테스트","3차":"직무면접","4차":"최종합격","5차":null,"6차":null,"summary":"• [지원 적합도]: ...\n• [핵심 업무]: ...\n• [어필 포인트]: ...","mainTasks":["..."],"requirements":["..."],"preferredPoints":["..."],"benefits":["..."]}}
{"jobKey":"saramin:51234999","site":"saramin","track":"track2","verdict":"reject","reasonCode":"BACKEND_ONLY_TRACK2","reason":"Java 백엔드 전용 포지션"}
```
* `verdict`: `pass` | `reject`. `reject`이면 `job`은 생략.
* `job`은 job-url-importer SKILL.md 필드(`company, position, url, jobCategory, experienceLevel, employmentType, industry, industryDetail, companyScale, location, deadline, postedDate, documents, 1차~6차, summary, mainTasks, requirements, preferredPoints, benefits`)에 **`rawTitle`, `jobKey`를 추가**한 것.
* `reasonCode = OTHER`이면 `reason` 필수.

### 4.6 체크포인트 (`data/checkpoints/{site}/{track}.json`)
```json
{
  "site": "saramin",
  "track": "track1",
  "headJobId": "51234567",
  "headWindow": ["51234567", "51234560", "51234551"],
  "tailJobId": "51190001",
  "tailWindow": ["51190001", "51189990", "51189975"],
  "tailPageHint": 42,
  "updatedAt": "2026-10-05T02:45:00+09:00"
}
```
* `headWindow`, `tailWindow`: 최대 3개 (`windowSize`).
* `updatedAt`: `+09:00` 오프셋 ISO.

### 4.7 scanController 출력
```json
{
  "action": "NEXT_PAGE",
  "page": 3,
  "reason": null,
  "phase": 1,
  "counters": { "listed": 40, "coveredSkipped": 5, "dupSkipped": 12, "suspected": 1, "queued": 22, "pages": 2 }
}
```
* `action`: `NEXT_PAGE` | `JUMP_PAGE` | `STOP` (`page`, `reason`은 선택)
* `phase`: `1` (신규 탐색) | `2` (건너뛰기) | `3` (미지의 과거 탐색)
* `STOP`의 `reason`: `LIST_END`, `LIMIT_QUEUED`, `LIMIT_PAGES`, `FILTER_MISMATCH`, `CONTAINER_NOT_FOUND`, `EMPTY_PAGE`

### 4.8 summary.json
트랙별 항목과 전체 합계를 가진다.
```json
{
  "runId": "20261005-0200",
  "tracks": {
    "saramin_track1": {
      "listed": 120, "coveredSkipped": 30, "dupSkipped": 40, "suspected": 3,
      "queued": 47, "reviewed": 47, "passed": 15, "rejected": 32,
      "rejectTopReasons": [{ "reasonCode": "EXPERIENCE_REQUIRED", "count": 18 }],
      "published": 15, "reopened": 0, "failed": 0,
      "stopReason": "LIST_END"
    }
  },
  "total": {
    "listed": 120, "coveredSkipped": 30, "dupSkipped": 40, "suspected": 3,
    "queued": 47, "reviewed": 47, "passed": 15, "rejected": 32,
    "published": 15, "reopened": 0, "failed": 0
  }
}
```

## 5. 허용 enum (심사 결과 검증 및 노션 select 값의 기준)

노션 DB 스키마(`notionJobFetcher --schema`)에 정의된 실제 옵션 목록을 기준으로 합니다.

| 필드 | 허용 값 (노션 DB 기준) | 비고 |
| :--- | :--- | :--- |
| **jobCategory** | `프론트엔드`, `풀스택`, `웹개발`, `소프트웨어` | 노션 DB에 `시스템엔지니어`, `SW개발` 등도 등록되어 있으나 AI 자동 심사 분류는 이 4개 표준값 우선 매핑 |
| **experienceLevel** | `신입`, `경력무관`, `신입/경력` | job-criteria.md 기준 통과 가능한 경력 옵션만 허용 |
| **employmentType** | `정규직`, `계약직`, `인턴`, `전환형 인턴`, `채용연계형 인턴`, `체험형 인턴` | 기본 4종 외 노션 DB 옵션(`채용연계형 인턴` 등) 포괄 허용 |
| **companyScale** | `스타트업`, `중소기업`, `중견기업`, `대기업`, `공기업`, `외국계기업`, `대기업계열사`, `벤처기업` | 기본 4종 외 노션 DB 옵션 포괄 허용 |
| **documents** | `이력서`, `포트폴리오`, `자기소개서`, `깃허브` | 노션 DB의 `경력기술서`, `학위증명서`, `GitHub 링크` 등도 유효 |
| **1차~6차** | `서류전형`, `코딩테스트`, `과제테스트`, `직무면접`, `컬쳐핏면접`, `임직원면접`, `최종합격`, `임원면접`, `인적성 검사`, `사전과제`, `AI역량검사`, `실무면접` | 기본 7종 외 노션 DB 다빈도 단계 허용 |
| **industry** | `IT/소프트웨어`, `핀테크`, `커머스`, `이커머스`, `게임`, `B2B / SaaS`, `클라우드/인프라`, `AI`, `데이터 분석`, `헬스케어`, `블록체인`, `모빌리티`, `엔터테이먼트`, `미디어/엔터테인먼트`, `SNS`, `에듀테크`, `스마트팩토리`, `O2O/플랫폼`, `금융권`, `제조업`, `제조·화학`, `호텔/레저`, `기타 서비스업` | 노션 DB select 옵션 26개 기준 확정 |


## 6. config/pipeline.json 기본값

```json
{
  "windowSize": 3,
  "maxQueuedPerTrack": 80,
  "maxPagesPerTrack": 2,
  "maxPhase2Pages": 2,
  "reviewBatchSize": 12,
  "suspectSimilarity": 0.7,
  "jumpEnabled": { "saramin": true, "jobkorea": false, "wanted": false },
  "expectedFilters": {
    "saramin_track1": ["cat_kewd=84,86,87,92,89,91,101", "exp_cd=1", "company_type=scale001,scale002,scale003", "sort=RD"],
    "saramin_track2": ["cat_kewd=92,87", "exp_cd=1", "sort=RD"],
    "jobkorea_track1": ["신입", "대기업", "30대그룹사", "중견기업", "매출1000대기업"],
    "jobkorea_track2": ["신입", "프론트엔드개발자", "웹개발자"],
    "wanted_track2": ["job_sort=job.latest_order", "years=0", "selected=669", "selected=873"]
  }
}
```
* 일반적인 탐색 요청 시 사용자 대기 시간 최적화를 위해 **트랙별 기본 최대 2페이지(`maxPagesPerTrack: 2`)**로 제한합니다 (사용자의 명시적 확장 요청 시 동적 조정).


## 7. 실행 순서 개요 (이후 단계에서 구현)

1. 오케스트레이터가 `runId` 발급
2. `retry.jsonl` 큐 재등록
3. 노션 캐시 생성 (`notionJobFetcher`)
4. 플랫폼별 수집 서브에이전트 **병렬** 실행 (같은 사이트의 트랙은 **순차**)
5. 심사 서브에이전트 배치 (`reviewBatchSize` 단위)
6. `publishRun`
7. checkpoint commit
8. 디스코드 리포트 (**0건이어도 발송**)

어느 단계든 실패하면 `node tools/discordNotifier.js --error "<단계>" "<원인>"`.

---

## 8. 플랫폼별 목록 구조 및 ID 단조성 검증 결과

4단계 작업 0(전제 검증)을 통해 내장 브라우저로 3개 플랫폼의 DOM 셀렉터 및 ID 단조성(Monotonicity)을 실측한 결과입니다.

| 플랫폼 | 일반 목록 컨테이너 | 카드 아이템 셀렉터 | 공고 링크 / ID 추출 | 공고 제목 / 회사명 / 경력 셀렉터 | 등록일순 ID 단조성 실측 결과 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **사람인 (saramin)** | `div.common_recruilt_list, div.common_recruit_list` | `div.list_item` (광고 제외) | `a[href*="rec_idx="]`<br/>(URL 쿼리 `rec_idx`) | • 제목: `a.str_tit` 또는 `h2.job_tit a`<br/>• 회사: `div.col.company_nm a.str_tit`<br/>• 경력: `div.recruit_info span.career` | **단조 감소 성립 (역전 0건)**<br/>`sort=RD` 정렬 시 `rec_idx`가 위에서 아래로 완벽히 감소. `jumpEnabled=true` 적용. |
| **잡코리아 (jobkorea)** | `div#dev-gi-list` | `li.list-post` (광고 제외) | `a[href*="GI_Read/"]`<br/>(경로 `/GI_Read/(\d+)`) | • 제목: `div.post-list-info a.title`<br/>• 회사: `div.post-list-corp a.name`<br/>• 경력: `p.option span.exp` | **역전 빈번 발생 (비단조적)**<br/>초안 생성 순 ID와 공고 등록/노출 순서의 불일치 및 끌올로 역전 발생. `jumpEnabled=false`, `headWindow`/`tailWindow` 매칭 필수. |
| **원티드 (wanted)** | `ul[data-cy="job-list"]` | `ul[data-cy="job-list"] > li` | `a[href*="/wd/"]`<br/>(경로 `/wd/(\d+)`) | • 제목: 카드 내 제목 요소 (`strong`)<br/>• 회사: 카드 내 회사 요소 (`span`)<br/>• 경력: URL 필터(`years=0`)로 보장 | **역전 빈번 발생 (비단조적)**<br/>최신순 정렬이 최초 등록일이 아닌 수정/끌올 기준이므로 56개 샘플 중 20회 역전 발생. `jumpEnabled=false`, `headWindow`/`tailWindow` 매칭 필수. |

### 목록 추출 스니펫 규격 요구사항
1. **순수 읽기 전용 IIFE**: DOM 변경, 클릭, 네트워크 요청(fetch, XHR) 일체 금지.
2. **반환 형태**:
   ```javascript
   {
     appliedFilters: [...], // 잡코리아는 선택된 칩 라벨 목록, 사람인/원티드는 location.search
     items: [
       { id: "51234567", url: "https://...", title: "...", company: "...", career: "신입" }
     ]
   }
   ```
3. **일반 컨테이너 한정**: 광고 영역(사람인 파워/스페셜, 잡코리아 스페셜/포커스 등) 완전 제외. 컨테이너 미발견 시 `{ error: 'CONTAINER_NOT_FOUND' }` 반환.
4. **중복 배제**: 한 페이지 내 동일 ID는 1회만 반환.
