# 3. 에이전트 계층별 상세 명세 (Agent Specifications)

본 문서는 Antigravity 네이티브 멀티 에이전트 시스템을 구성하는 **총괄 오케스트레이터(Chief Orchestrator)**와 **플랫폼별 전문 서브에이전트 스킬(.agents/skills/)**의 역할 및 입출력 명세를 정의합니다.

---

## 3.1 총괄 오케스트레이터 (Chief Orchestrator)

### 3.1.1 책임과 역할
* **전체 파이프라인 수명 주기 총괄**: 스케줄러(02:00) 또는 사용자 명령 시 가동되어 수집 시작부터 디스코드 리포팅까지 전 과정을 지휘.
* **병렬 위임 및 동시성 제어**: 사람인, 잡코리아, 원티드 서브에이전트에게 듀얼 트랙 탐색 임무를 병렬로 위임.
* **통합 심사 기준 감독**: 스타트업(웹 FE/풀스택/퍼블리셔 필수) vs 대기업(IT/SW개발 포괄) 차등 심사 규칙을 철저히 준수하도록 감독.
* **종합 리포트 발행**: 플랫폼별 수집 수량, 심사 통과 수량, 탈락 수량을 집계하여 Discord 리포트 발송.

---

## 3.2 플랫폼별 서브에이전트 스킬 명세

### 3.2.1 사람인 스카우트 ([scout-saramin](../.agents/skills/scout-saramin/SKILL.md))
* **역할**: 사람인 직업별 채용정보(`job-category`) 듀얼 트랙 탐색 및 iframe 원문 상세 분석.
* **도구**: `browser_subagent`, Playwright MCP (`browser_navigate`, `browser_screenshot`)
* **목록 타깃팅 (광고 배제)**: 상단 유료 광고(파워채용 등)를 건너뛰고 **`div.common_recruilt_list` (또는 `.common_recruit_list`)** 내부 공고만 탐색.
* **탐색 규격**:
  - **트랙 1 (대기업/우량)**: `cat_mcls=2` & `company_type=scale001,scale002,scale003` & 신입/경력무관
  - **트랙 2 (중소/스타트업)**: `cat_cd=87,92,91` & `company_type=scale004,scale005` & 신입/경력무관
* **본문 원문 직통**: `https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx={id}`

### 3.2.2 잡코리아 스카우트 ([scout-jobkorea](../.agents/skills/scout-jobkorea/SKILL.md))
* **역할**: 잡코리아 직무별 채용정보(`menucode=duty`) 듀얼 트랙 탐색 및 상세 요강 심사.
* **도구**: `browser_subagent`, Playwright MCP (`browser_navigate`, `browser_screenshot`)
* **목록 타깃팅 (광고 배제)**: 상단 스페셜/포커스 광고를 건너뛰고 **`<div id="dev-gi-list">`** 내부 공고만 탐색.
* **탐색 규격**:
  - **트랙 1 (대기업/그룹사)**: `cotype=1,2,3,4,5` & 주요 직군(백엔드, 프론트, 웹, 앱, 시스템, SW개발, 퍼블리셔, AI서비스) & `career=1,8`
  - **트랙 2 (중소/상장)**: `cotype=15,7,11,12` & 웹개발, 프론트엔드, 퍼블리셔 & `career=1,8`
* **상세 페이지 접근**: `https://www.jobkorea.co.kr/Recruit/GI_Read/{id}`

### 3.2.3 원티드 스카우트 ([scout-wanted](../.agents/skills/scout-wanted/SKILL.md))
* **역할**: 스타트업/성장기업 중심의 웹/프론트엔드 채용공고 탐색 및 심사.
* **도구**: 원티드 Navigation API, `browser_subagent`, Playwright MCP
* **탐색 규격**:
  - 직군: 개발 (`job_group_id=518`)
  - 직무: 웹 개발자 (`job_ids=873`), 프론트엔드 개발자 (`job_ids=669`), 풀스택 (`job_ids=872`)
  - 경력: 신입/경력무관 (`years=0`)

### 3.2.4 노션 동기화 스킬 ([notion-job-sync](../.agents/skills/notion-job-sync/SKILL.md))
* **역할**: 기존 등록 공고 중복 캐시 조회, 재공고 판별, 18개 속성 표준 규격화 및 DB 등록 실행.
* **도구**: [tools/notionJobPublisher.js](../tools/notionJobPublisher.js), Notion MCP

---

## 3.3 표준 공고 데이터 인터페이스 (Job Data Payload)

서브에이전트가 심사를 완료하고 노션 등록으로 넘기는 JSON 스키마입니다:

```json
{
  "company": "토스뱅크",
  "position": "Frontend Platform Engineer",
  "role_category": "프론트엔드 개발자",
  "experience": "신입",
  "employment_type": "정규직",
  "industry": "핀테크",
  "industry_detail": "인터넷전문은행 / 금융플랫폼",
  "company_size": "대기업",
  "location": "서울 강남구 테헤란로 (하이브리드 근무)",
  "apply_url": "https://...",
  "deadline": "2026-10-15",
  "posted_date": "2026-09-16",
  "status": "미지원",
  "ai_collected": true,
  "submitted_docs": ["이력서", "포트폴리오"],
  "rounds": {
    "round_1": "서류전형",
    "round_2": "코딩테스트",
    "round_3": "직무인터뷰",
    "round_4": "최종면접",
    "round_5": null,
    "round_6": null
  },
  "three_line_summary": [
    "토스뱅크 웹 뱅킹 서비스 개발 및 모노레포 아키텍처 환경 구축 참여",
    "React, TypeScript 기반 복잡한 금융 데이터 인터랙션 및 상태 관리 경험",
    "신입 지원 가능 포지션으로 최신 웹 프론트엔드 인프라 학습 기회 풍부"
  ]
}
```
