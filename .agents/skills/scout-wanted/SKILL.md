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
* **웹 URL**:
  `https://www.wanted.co.kr/wdlist/518/669,873?country=kr&job_sort=job.latest_order&years=0&locations=all`
* **상세 페이지 및 API**:
  - 페이지: `https://www.wanted.co.kr/wd/{id}`
  - 상세 API: `https://www.wanted.co.kr/api/chaos/jobs/v4/{id}/details`

---

## 2. 작업 절차 (Sub-Agent Workflow)
1. **목록 탐색**:
   - `browser_subagent` 또는 Playwright MCP 도구(`browser_navigate`), 혹은 원티드 API 엔드포인트를 통해 최신 웹/프론트엔드 공고 목록을 조회합니다.
2. **중복 필터링**:
   - `notion-job-sync`의 기존 캐시와 대조하여 이미 등록된 공고는 즉시 스킵합니다.
3. **상세 본문 브라우징 및 심사**:
   - `browser_subagent` 또는 `browser_navigate`로 상세 페이지(`https://www.wanted.co.kr/wd/{id}`)에 접근하거나 상세 API로 요강을 파싱합니다.
   - 자격요건에서 React/Vue/TypeScript 등 기술 스택을 확인합니다.
   - 최소 경력 2년 이상 요구 시 탈락, 신입/경력무관/주니어 적합 건만 통과합니다.
   - 1차~6차 채용 전형 단계 및 AI 3줄 요약을 작성합니다.
4. **노션 등록 위임**:
   - 심사 통과 건을 `notion-job-sync` 스킬을 통해 노션 DB에 등록합니다.
