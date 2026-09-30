---
name: scout-wanted
description: >-
  원티드(Wanted) 채용 플랫폼에서 스타트업/성장기업 중심의 웹 개발자 및 프론트엔드 개발자 신입/경력무관 공고를 탐색하고 심사하는 전문 서브에이전트 스킬.
---

# Wanted Scout Sub-Agent

원티드는 주로 스타트업 및 중소·성장기업 채용이 활발하므로, **직군(개발)과 직무(웹 개발자, 프론트엔드 개발자)**를 정밀 타깃팅하여 탐색합니다.

---

## 1. 탐색 타깃 및 엔드포인트
* **직군 분류**: 개발 (`job_group_id=518`)
* **직무 분류**:
  - `job_ids=669`: 프론트엔드 개발자
  - `job_ids=873`: 웹 개발자
  - *(참고) `job_ids=872`: 풀스택 개발자*
* **경력 조건**: 신입 및 경력무관 (`years=0`)
* **정렬 기준**: 최신순 (`job_sort=job.latest_order`)
* **공식 API URL**:
  `https://www.wanted.co.kr/api/chaos/navigation/v1/results?job_group_id=518&job_ids=669&job_ids=873&country=kr&job_sort=job.latest_order&years=0&locations=all&limit=20`
* **공식 웹 URL**:
  `https://www.wanted.co.kr/wdlist/518?country=kr&job_sort=job.latest_order&years=0&locations=all&selected=669&selected=873`
* **상세 페이지 및 API**:
  - 페이지: `https://www.wanted.co.kr/wd/{id}`
  - 상세 API: `https://www.wanted.co.kr/api/chaos/jobs/v4/{id}/details`
* **타깃 컨테이너**: <ul data-cy="job-list" class="List_List__Zx2dt"></ul>
---

## 2. 작업 절차 (Sub-Agent Workflow)
1. **브라우저 기반 3단계 구간 점프(Range Skip) 목록 탐색**:
   - `data/checkpoint.json`에서 `headJobId`(최신 앵커)와 `tailJobId`(과거 앵커)를 로드합니다.
   - **Phase 1 (신규 탐색)**: 최신 카드부터 심사·등록하다가 `headJobId` 또는 `headWindow`를 만나면 신규 탐색을 완료합니다.
   - **Phase 2 (초고속 건너뛰기)**: 본문 열람을 일절 중단하고, 카드 링크 목록만 스캔하며 `tailJobId`가 화면에 나타날 때까지 연속 스크롤(`window.scrollTo(0, document.body.scrollHeight)`)을 초고속으로 내립니다 (토큰 소모 제로).
   - **Phase 3 (미지의 과거 탐색)**: `tailJobId` 다음 카드부터 상세 요강 열람 및 정밀 심사를 재개하여 새로운 과거 공고를 지속 발굴합니다.
2. **중복 필터링 및 통계 누적**:
   - `notion-job-sync`의 기존 캐시와 대조하여 이미 등록된 공고는 0.001초 만에 스킵(`skipped++`)하고, 전체 스캔 건수(`totalScanned++`)를 집계하며 종료 시 체크포인트를 갱신합니다.
3. **상세 본문 브라우징 및 심사**:
   - `browser_subagent` 또는 `browser_navigate`로 상세 페이지(`https://www.wanted.co.kr/wd/{id}`)에 접근하거나 상세 API로 요강을 파싱합니다.
   - 자격요건에서 React/Vue/TypeScript 등 기술 스택을 확인합니다.
   - 최소 경력 2년 이상 요구 시 탈락, 신입/경력무관/주니어 적합 건만 통과합니다.
   - 1차~6차 채용 전형 단계 및 AI 3줄 요약을 작성합니다.
4. **노션 등록 위임 (Envelope 패턴)**:
   - 심사 통과 건을 `stats` 메타데이터와 함께 `notion-job-sync` 스킬을 통해 노션 DB에 일괄 등록합니다.
5. **안전 종료 조건**:
   - 단일 세션 누적 검토 공고(`totalScanned`)가 2,000건을 초과하거나 사용자 지정 목표치에 도달하면 즉시 탐색을 종료하고 체크포인트를 갱신합니다.
