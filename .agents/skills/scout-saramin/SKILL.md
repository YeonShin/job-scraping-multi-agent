---
name: scout-saramin
description: >-
  사람인(Saramin) 채용 플랫폼에서 [대기업/중견 IT전체 트랙]과 [중소/스타트업 웹·프론트·퍼블리셔 트랙]의 2단계 분기 탐색을 수행하고 심사하는 전문 서브에이전트 스킬.
---

# Saramin Scout Sub-Agent

사람인 플랫폼의 직업별 채용정보(`job-category`)에서 기업 규모와 직무 범위에 맞춘 **2가지 분기(Dual-Track) 탐색 전략**을 수행합니다.

---

## 1. 듀얼 트랙 탐색 규격 및 URL

### [분기 1] 대기업 / 중견기업 / 매출1000대기업 트랙
* **기업 형태**: 대기업(`scale001`), 매출1000대기업(`scale002`), 중견기업(`scale003`)
* **직무 범위**: **IT개발·데이터 전체 선택** (`cat_mcls=2`)
* **경력 조건**: 신입 (`exp_cd=1`) 및 경력무관 (`exp_none=y`)
* **정렬 기준**: 최신 등록순 (`sort=rd`)
* **공식 탐색 URL**:
  `https://www.saramin.co.kr/zf_user/jobs/list/job-category?cat_mcls=2&company_type=scale001%2Cscale002%2Cscale003&exp_cd=1&exp_none=y&panel_type=&search_optional_item=y&search_done=y&panel_count=y&preview=y&sort=rd`

### [분기 2] 중소기업 / 스타트업 트랙
* **기업 형태**: 중소기업(`scale004`), 스타트업(`scale005`)
* **직무 범위**: 웹개발자(`87`), 프론트엔드개발자(`92`), 퍼블리셔(`91`) (`cat_mcls=2&cat_cd=87%2C92%2C91`)
* **경력 조건**: 신입 (`exp_cd=1`) 및 경력무관 (`exp_none=y`)
* **정렬 기준**: 최신 등록순 (`sort=rd`)
* **공식 탐색 URL**:
  `https://www.saramin.co.kr/zf_user/jobs/list/job-category?cat_mcls=2&cat_cd=87%2C92%2C91&company_type=scale004%2Cscale005&exp_cd=1&exp_none=y&panel_type=&search_optional_item=y&search_done=y&panel_count=y&preview=y&sort=rd`

---

## 2. 공고 목록 타깃팅 및 광고 배제 (토큰·비용 최적화)
> 🚨 **[광고 필터링 필수]** 사람인 목록 상단의 광고(파워채용, 스페셜, 헤드헌팅)는 필터 조건과 무관한 공고가 다수 포함되어 크레딧과 시간을 낭비합니다.  
> 반드시 **일반 채용공고 리스트 영역인 `div.common_recruilt_list` (또는 `.common_recruit_list`) 내부의 공고만 탐색**하십시오!

* **타깃 컨테이너**: `div.common_recruilt_list` (또는 `.common_recruit_list`)
* **공고 식별**: 해당 컨테이너 내부의 `a[href*="rec_idx="]` 태그를 통해 고유 `rec_idx` 식별.
* **💡 본문 원문 직통 iframe URL (누락 방지)**:
  `https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx={id}`
  (메인 페이지의 분리된 iframe 뷰를 직접 호출하여 자격 요건, 우대 사항, 전형 단계를 온전히 파싱)

---

## 3. 작업 절차 (Sub-Agent Workflow)
1. **브라우저 기반 목록 탐색**:
   - `browser_subagent` 또는 Playwright MCP 도구(`browser_navigate`)로 분기 1(대기업 IT전체)과 분기 2(중소 웹/FE/퍼블리셔) URL로 순차 진입합니다.
   - 상단 광고 영역을 건너뛰고, 오직 **`div.common_recruilt_list` (일반 채용공고)** 영역으로 바로 스크롤/포커스하여 공고 카드 링크(`a[href*="rec_idx="]`)를 식별합니다.
2. **중복 필터링**:
   - `notion-job-sync`의 기존 등록 캐시와 대조하여 이미 등록된 URL은 건너뜁니다.
3. **상세 요강 브라우징 및 심사**:
   - `https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx={id}`로 직접 이동하여 주요업무, 자격요건, 우대사항, 채용절차를 파싱합니다.
   - 통이미지/배너 공고인 경우 `browser_screenshot`으로 캡처 후 문맥을 판독합니다.
   - **심사 기준**:
     * 대기업/중견기업: 일반 IT/SW개발 포지션도 합격.
     * 중소/스타트업: 반드시 웹 프론트엔드, 웹 풀스택, 퍼블리셔 포지션이어야 합격 (순수 백엔드 탈락).
     * 공통: 최소 경력 2년 이상 요구 시 즉시 탈락.
4. **전형 절차 분해**: 1차~6차 채용 단계 추출 (`서류전형`, `코딩테스트`, `직무면접` 등).
5. **노션 등록 위임**: 심사 통과 건을 `notion-job-sync` 스킬을 통해 노션 DB에 등록합니다.
