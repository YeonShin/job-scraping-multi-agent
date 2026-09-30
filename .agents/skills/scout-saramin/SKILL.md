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
* **정렬 기준**: 최신 등록순 (`sort=RD`)
* **공식 탐색 URL**:
  `https://www.saramin.co.kr/zf_user/jobs/list/job-category?exp_cd=1&exp_none=y&company_type=scale001%2Cscale002%2Cscale003&cat_mcls=2&panel_type=&search_optional_item=y&search_done=y&panel_count=y&preview=y&page=1&sort=RD`

### [분기 2] 웹개발자 / 프론트엔드 / 웹퍼블리셔 전체 트랙 (기업규모 무관)
* **기업 형태**: **기업 형태 필터링 제거** (대기업/중견 포함 전 기업의 프론트엔드/웹 직무 포괄 수집)
* **직무 범위**: 웹개발자(`87`), 프론트엔드개발자(`92`), 웹퍼블리셔(`91`) (`cat_kewd=87%2C92%2C91`)
* **경력 조건**: 신입 (`exp_cd=1`) 및 경력무관 (`exp_none=y`)
* **정렬 기준**: 최신 등록순 (`sort=RD`)
* **공식 탐색 URL**:
  `https://www.saramin.co.kr/zf_user/jobs/list/job-category?exp_cd=1&exp_none=y&cat_kewd=87%2C92%2C91&panel_type=&search_optional_item=y&search_done=y&panel_count=y&preview=y&page=1&sort=RD`

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
1. **브라우저 기반 3단계 구간 점프(Range Skip) 목록 탐색**:
   - `data/checkpoint.json`에서 `headJobId`(최신 앵커)와 `tailJobId`(과거 앵커)를 로드합니다.
   - **Phase 1 (신규 탐색)**: 1페이지부터 공고를 심사·등록하다가, `headJobId` 또는 `headWindow`를 발견하면 신규 탐색을 마칩니다.
   - **Phase 2 (초고속 건너뛰기)**: 본문 열람을 중지하고, 각 페이지의 `rec_idx` 목록만 확인하며 `tailJobId`가 나올 때까지 `&page=2, 3...`을 초고속으로 넘깁니다 (페이지당 0.5초).
   - **Phase 3 (미지의 과거 탐색)**: `tailJobId` 바로 다음 공고부터 다시 상세 본문 열람 및 정밀 심사를 재개하여 새로운 과거 공고를 발굴합니다.
   - 상단 광고 영역을 완전 배제하고, 오직 **`div.common_recruilt_list` (일반 채용공고)** 영역 내부의 공고 카드 링크(`a[href*="rec_idx="]`)만 수집합니다.
2. **중복 필터링 및 통계 누적**:
   - `notion-job-sync`의 기존 등록 캐시와 대조하여 이미 등록된 URL은 0.001초 만에 스킵(`skipped++`)하고, 미등록 공고만 상세 심사로 넘깁니다. 전체 스캔 건수(`totalScanned++`)를 정확히 카운트하고 종료 시 체크포인트를 갱신합니다.
3. **상세 요강 브라우징 및 심사**:
   - `https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx={id}`로 직접 이동하여 주요업무, 자격요건, 우대사항, 채용절차를 파싱합니다.
   - 통이미지/배너 공고인 경우 `browser_screenshot`으로 캡처 후 문맥을 판독합니다.
   - **심사 기준**:
     * 대기업/중견기업: 일반 IT/SW개발 포지션도 합격.
     * 중소/스타트업: 반드시 웹 프론트엔드, 웹 풀스택, 퍼블리셔 포지션이어야 합격 (순수 백엔드 탈락).
     * 공통: 최소 경력 2년 이상 요구 시 즉시 탈락.
4. **전형 절차 분해**: 1차~6차 채용 단계 추출 (`서류전형`, `코딩테스트`, `직무면접` 등).
5. **노션 등록 위임 (Envelope 패턴)**: 심사 통과 건을 `stats`와 함께 `notion-job-sync` 스킬을 통해 노션 DB에 등록합니다.
6. **안전 종료 조건**: 단일 세션 누적 검토 공고(`totalScanned`)가 2,000건을 초과하거나 사용자 지정 목표치에 도달하면 즉시 탐색을 종료하고 체크포인트를 갱신합니다.
