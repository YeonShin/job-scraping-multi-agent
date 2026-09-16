# 2. 시스템 아키텍처 (System Architecture)

## 2.1 전체 시스템 구조도

본 시스템은 **3-Tier 계층형 멀티 에이전트(Hierarchical Multi-Agent)** 구조와 **하네스 엔지니어링 통제 레이어**로 구성됩니다.

```mermaid
flowchart TB
    subgraph Sched["스케줄링 & 트리거 레이어"]
        Cron["야간 스케줄러 (새벽 02:00 자동 실행)<br/>- Node.js 스크립트 / Task Scheduler / Antigravity /schedule"]
    end

    subgraph Tier1["Tier 1: 총괄 오케스트레이터 (Master Agent)"]
        Orch["오케스트레이터 에이전트"]
        DedupeEngine["중복 방지 엔진 (Deduplication Engine)"]
        WorkerPool["워커 풀 제어기 (동시성 3~5개 제어)"]
        Reporter["결과 집계 & 리포터"]
    end

    subgraph NotionStore["데이터 저장소 (Notion Database)"]
        NotionDB[("노션 채용공고 DB")]
    end

    subgraph Tier2["Tier 2: 플랫폼별 스카우트 에이전트 (Scouts)"]
        WantedScout["원티드 스카우트"]
        SaraminScout["사람인 스카우트"]
        JobkoreaScout["잡코리아 스카우트"]
        OtherScout["기타 플랫폼 스카우트"]
    end

    subgraph Queue["메모리 큐 (Task Queue)"]
        JobQueue["신규 공고 작업 큐 (Unprocessed URL Queue)"]
    end

    subgraph Tier3["Tier 3: 공고 분석 워커 에이전트 풀 (Workers)"]
        Worker1["워커 에이전트 #1"]
        Worker2["워커 에이전트 #2"]
        Worker3["워커 에이전트 #3"]
    end

    subgraph RuntimeEnv["실행 인프라 & MCP 환경"]
        PlaywrightMCP["Playwright MCP 서버<br/>(CDP / Persistent Context)"]
        NotionMCP["Notion MCP 서버<br/>(공식 SDK / MCP)"]
        VisionLLM["멀티모달 Vision LLM<br/>(Gemini Flash OCR)"]
    subgraph Alert["실시간 알림 레이어"]
        DiscordWebhook["디스코드 웹훅 (Discord Webhook)<br/>모바일/PC 실시간 리포트 알림"]
    end

    %% 연결 관계
    Cron --> Orch
    Orch <-->|1. 기존 수집 URL/상태 조회| NotionDB
    Orch --> DedupeEngine

    Orch --> WantedScout & SaraminScout & JobkoreaScout & OtherScout
    WantedScout & SaraminScout & JobkoreaScout & OtherScout <-->|목록 탐색| PlaywrightMCP
    
    WantedScout & SaraminScout & JobkoreaScout & OtherScout -->|2. 수집된 URL 전달| DedupeEngine
    DedupeEngine -->|3. 신규 공고만 선별| JobQueue

    JobQueue --> WorkerPool
    WorkerPool --> Worker1 & Worker2 & Worker3

    Worker1 & Worker2 & Worker3 <-->|상세 진입 / 스크린샷| PlaywrightMCP
    Worker1 & Worker2 & Worker3 <-->|통이미지 OCR 판독| VisionLLM
    Worker1 & Worker2 & Worker3 -->|4. 규격화된 페이지 생성| NotionMCP
    NotionMCP --> NotionDB

    Worker1 & Worker2 & Worker3 -->|5. 작업 완료 통보| Reporter
    Reporter -->|최종 요약 전송| Orch
    Orch -->|6. 아침 일일 수집 리포트 발송| DiscordWebhook
```

---

## 2.2 단계별 데이터 흐름 (Data Flow Lifecycle)

### Phase 1: 초기화 및 중복 필터링 캐시 생성 (Init & Deduplication)
1. 오케스트레이터가 가동되면 가장 먼저 Notion MCP를 통해 현재 노션 DB에 저장된 **기존 공고의 원본 링크(URL) 및 상태(Status) 목록**을 조회합니다.
2. 이를 인메모리 캐시(`ExistingJobsMap`)로 생성하여 마감 여부를 판별할 수 있게 준비합니다.

### Phase 2: 플랫폼별 신규 공고 발굴 (Scouting)
1. Tier 2 스카우트 에이전트들이 각 플랫폼(원티드, 사람인 등)의 사전 정의된 직무 필터 URL로 이동합니다.
2. 목록 페이지를 스크롤하며 최신 공고들의 상세 링크(`targetUrl`)들을 일괄 추출합니다.
3. 기존 공고 중 활성 상태인 것은 즉시 배제하고, **순수 신규 공고 및 마감 후 재오픈된 공고만 작업 큐(`JobQueue`)에 인큐(Enqueue)**합니다.

### Phase 3: 워커 풀 기반 병렬 상세 분석 (Worker Analysis)
1. 워커 풀 제어기는 설정된 동시성 제한(예: 3개 동시 실행) 내에서 Tier 3 워커 에이전트를 스폰합니다.
2. 워커는 할당받은 단일 공고 URL로 이동하여 상세 정보를 수집합니다:
   - 텍스트 본문 파싱 또는 통이미지 스크린샷 OCR 판독
   - 외부 채용 링크 감지 시 추적(Follow Link)
   - 대규모 공채 내 웹 개발 부문 분리 추출
3. 정제된 데이터를 공통 스키마 규격(`JobDataPayload`)으로 구조화합니다.

### Phase 4: 노션 페이지 발행 및 디스코드 리포팅 (Publish & Alert)
1. 워커가 Notion MCP를 호출하여 노션 데이터베이스에 🏢 아이콘과 함께 표준 템플릿 페이지를 생성합니다.
2. 작업 성공 여부를 오케스트레이터에 알리고 워커 세션을 정상 종료(메모리 해제)합니다.
3. 모든 큐가 소진되면 오케스트레이터가 수집 통계(총 탐색, 신규 등록, 재공고, 스킵, 실패)를 집계합니다.
4. **디스코드 웹훅(Discord Webhook)**을 호출하여 사용자 스마트폰/PC로 아침 요약 Embed 메시지를 발송하고 배치를 완료합니다.


---

## 2.3 기술 스택 (Technology Stack)

* **언어 및 런타임**: Node.js (v18+) / TypeScript (또는 ES Modules JavaScript)
* **브라우저 제어**: Playwright MCP (`browser_navigate`, `browser_screenshot`, `browser_click` 등)
* **브라우저 프로필**: Chrome CDP (`--remote-debugging-port`) 또는 Persistent Context (`userDataDir`)
* **데이터베이스 및 동기화**: Notion MCP (`notion-create-pages`, `notion-query-data-sources`) 및 `@notionhq/client`
* **지능형 분석 및 OCR**: Gemini Flash (초고속 멀티모달 LLM 추론)
* **동시성 및 하네스 관리**: `p-limit` (Worker Pool 제어), 인하우스 Circuit Breaker 모듈
