---
name: job-url-importer
description: >-
  사용자가 제시한 특정 채용공고 사이트 링크(원티드, 사람인, 잡코리아, 랠릿, 점핏, 링크드인, 기업 자체 채용 페이지 등)를 직접 브라우징하여 분석하고, 노션 채용 관리 DB에 표준 18개 속성과 AI 3줄 요약 규격으로 즉시 등록하는 단일 공고 전문 임포터 스킬. 사용자가 채용공고 URL을 전달하거나 "이 공고 등록해줘", "이 링크 노션에 넣어줘"라고 할 때 사용한다.
---

# Job URL Importer Skill (단일 채용공고 링크 즉시 등록)

사용자가 채팅창에 특정 채용공고 URL을 전달하며 등록을 요청했을 때 작동하는 온디맨드(On-Demand) 직통 임포트 파이프라인입니다.

> 🚨 **[단일 모드 심사 제외 원칙]**
> * 단일 모드에는 **합격/탈락 심사가 없습니다.** 사용자가 직접 지정하여 등록을 원한 공고이므로, 경력 요구, 퍼블리셔, 백엔드 등 `job-criteria.md`의 필터 기준과 맞지 않더라도 **묻지 않고 그대로 노션에 등록**합니다.
> * 필드 및 3줄 요약 작성 포맷만 [`.agents/skills/job-reviewer/SKILL.md`](../job-reviewer/SKILL.md)의 규격을 준수합니다.
> * 단일 모드는 탐색 체크포인트(`data/checkpoints/`)를 건드리지 않습니다.

---

## 🛠️ 실행 절차 (6단계 직통 프로토콜)

### 1단계: 세션 발급 및 노션 캐시 동기화
1. KST 시각 기준 단일 runId 발급: `runId = "single-" + YYYYMMDD-HHmmss`
2. 최신 노션 DB 캐시 확보:
   ```bash
   node tools/notionJobFetcher.js --out data/cache/notion_jobs.json
   ```

### 2단계: URL 식별 및 기존 등록 상태 대조
1. URL에서 고유 `jobKey` 추출 (예: `saramin:55201338`, `wanted:12345`).
2. `tools/jobFilter.js` 또는 노션 캐시를 통해 기존 등록 여부를 대조합니다:
   - **기존 공고가 존재하고 상태가 `미지원`, `서류작성중` 등 진행 중인 경우**:
     - 사용자에게 이미 등록되어 있음을 알리고("현재 '미지원' 상태로 등록되어 있습니다. 그래도 덮어쓰시겠습니까?"), 사용자가 재등록을 명시적으로 요청할 때만 진행.
   - **기존 공고가 `마감` 상태이거나 미등록 신규 공고인 경우**: 즉시 다음 단계 진행.

### 3단계: 공고 본문 브라우징 (No-Script 가드레일 준수)
* **임의의 Node.js 크롤러 스크립트 작성 절대 금지**. 내장 브라우저 도구를 통해 사람이 보듯 열람합니다.
* **사람인**: iframe 직통 주소(`https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx={id}`)로 이동하여 본문 확보.
* **원티드 / 잡코리아 / 기타 플랫폼 (랠릿, 점핏, 자체 ATS 등)**: 제시된 URL로 직접 진입하여 본문 확인.

### 4단계: 18개 표준 속성 정제 및 AI 3줄 요약 작성
* [`.agents/skills/job-reviewer/SKILL.md`](../job-reviewer/SKILL.md)의 18개 표준 속성 및 AI 3줄 요약(`• [지원 적합도]`, `• [핵심 업무]`, `• [어필 포인트]`) 규격대로 JSON 데이터를 구성합니다.
* verdict는 **항상 `"pass"`**로 설정합니다 (심사 탈락 판정 없음).
* 단일 큐 디렉터리(`data/runs/<runId>/`)를 생성하고 `review_queue.json`에 1건 등록 후 submit:
  ```json
  [
    {
      "jobKey": "<jobKey>",
      "site": "<site>",
      "track": "manual",
      "detailUrl": "<url>",
      "title": "<position>",
      "company": "<company>"
    }
  ]
  ```
  해당 단일 항목을 `data/runs/<runId>/review_queue.json`에 저장한 뒤 submit 실행:
  ```bash
  node tools/reviewQueue.js submit --run <runId> --input .agents/scratch/<runId>/review_<jobKey의 ':'를 '_'로 바꾼 이름>.json
  ```

### 5단계: 노션 DB 단일 발행 및 디스코드 알림
1. 정규 발행 파이프라인 호출:
   ```bash
   node tools/publishRun.js --run <runId>
   ```
2. 단일 등록 전용 디스코드 웹훅 발송:
   ```bash
   node tools/discordNotifier.js --single data/runs/<runId>/publish_result.json
   ```

### 6단계: 사용자 브리핑
* 등록 완료된 노션 페이지 링크(`notionUrl`)와 함께 기업명, 채용직무, 마감일, AI 3줄 요약을 대화창에 명확히 보고합니다.
* 체크포인트(`data/checkpoints/`)는 일체 갱신하지 않습니다.
