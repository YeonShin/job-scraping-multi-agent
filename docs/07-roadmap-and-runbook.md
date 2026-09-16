# 7. 구현 로드맵 및 운영 런북 (Roadmap & Runbook)

본 문서는 Antigravity 네이티브 멀티 에이전트 시스템의 **실제 디렉토리 구조, 운영 런북(Runbook), 환경 설정 및 스케줄 관리 방법**을 기술합니다.

---

## 7.1 실제 프로젝트 디렉토리 구조

현재 프로젝트는 레거시 크롤러 스크립트를 전면 정리하고, **Google Antigravity 에이전트 네이티브 표준 구조**로 운영되고 있습니다:

```text
채용공고 스크랩/
├── .agents/
│   ├── rules/
│   │   └── orchestration-protocol.md   # 멀티 에이전트 오케스트레이션 행동 강령
│   └── skills/                         # 플랫폼별 전문 서브에이전트 스킬 모음
│       ├── notion-job-sync/SKILL.md    # 노션 DB 표준 18개 속성 발행 & 중복 검증
│       ├── scout-jobkorea/SKILL.md     # 잡코리아 듀얼 트랙(대기업 SW / 중소 웹·FE) 스카우트
│       ├── scout-saramin/SKILL.md      # 사람인 듀얼 트랙(대기업 IT / 중소 웹·FE) 스카우트
│       └── scout-wanted/SKILL.md       # 원티드 개발 직군 웹·프론트엔드 스카우트
├── docs/                               # 📚 시스템 공식 설계 및 운영 문서 모음
│   ├── 01-overview.md                  # 시스템 개요 및 사용자 맞춤 심사 철학
│   ├── 02-system-architecture.md       # 전체 멀티 에이전트 구조 및 듀얼 트랙 흐름
│   ├── 03-agent-specifications.md      # 오케스트레이터 및 서브에이전트 입출력 명세
│   ├── 04-browsing-and-mcp-strategy.md # 브라우징, iframe 원문 직통, 비전 스크린샷 전략
│   ├── 05-notion-schema-and-sync.md    # 노션 18개 속성 스키마 및 본문 템플릿
│   ├── 06-harness-engineering.md       # Rate Limit 방어 및 가드레일 설계
│   ├── 07-roadmap-and-runbook.md       # 디렉토리 구조, 수동/자동 실행 런북 (본 문서)
│   ├── draft-llm-orchestration-workflow.md # 하이브리드 워크플로우 명세서
│   └── decisions/                      # 🏛️ 아키텍처 의사결정 기록 (ADR)
│       ├── README.md                   # ADR 목록 및 개요
│       └── 001-why-antigravity-as-orchestrator.md # Antigravity(Gemini Flash) 선정 배경
├── tools/                              # 🛠️ 에이전트 보조 실행 유틸리티
│   ├── discordNotifier.js              # 디스코드 일일 리포트 발송 스크립트
│   └── notionJobPublisher.js           # 노션 데이터베이스 발행 및 동기화 스크립트
├── AGENTS.md                           # 🤖 Antigravity 시스템 총괄 오케스트레이터 룰
├── package.json                        # 프로젝트 의존성 설정
└── .env                                # 노션 토큰, DB ID, 디스코드 웹훅 URL
```

---

## 7.2 운영 런북 (Operations Runbook)

### 1. 사용자 수동 트리거 발화
대화창에서 아래와 같이 자연어로 명령하면 즉시 멀티 에이전트 파이프라인이 가동됩니다:
* *"오늘 새로 올라온 채용공고 탐색해서 등록해줘"*
* *"사람인/원티드 공고 스크랩해서 노션에 넣어줘"*
* *"새로운 신입 프론트엔드 공고 찾아서 디스코드로 보고해줘"*

### 2. 정기 야간 자동화 (매일 새벽 02:00 KST)
* **스케줄러 상태**: `task-364` (Daemon 모드로 백그라운드 상주 중)
* **동작 흐름**:
  1. 새벽 02:00 정각 백그라운드에서 Chief Orchestrator 자동 기동
  2. 원티드, 사람인, 잡코리아 듀얼 트랙 탐색
  3. 자격 심사 및 노션 DB 등록 (🏢 아이콘, AI 3줄 요약)
  4. 디스코드 채널로 일일 요약 Embed 리포트 자동 전송

### 3. 스케줄러 관리 및 시간 변경 방법
* **스케줄 확인**: Antigravity 대화창에 `스케줄 상태 확인해줘` 요청
* **스케줄 변경/신규 등록**:
  - 채팅창에 `/schedule` 명령어 입력 후 원하는 시간대 지정 (예: `/schedule 매일 오전 08:00에 채용공고 탐색 및 등록 실행`)
* **수동 즉시 알림 테스트**:
  ```bash
  node tools/discordNotifier.js
  ```

---

## 7.3 환경 변수 설정 (`.env`)

```env
NOTION_API_KEY=secret_...
NOTION_DATABASE_ID=343831b8-54df-8081-adb8-e6c93fc69e37
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```
