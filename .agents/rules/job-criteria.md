# 룰: 채용공고 심사 기준 (Job Criteria) — 유일한 원천

이 문서는 **심사 기준, 트랙 정의, 플랫폼별 필터 설정값**의 유일한 원천(Single Source of Truth)입니다.
다른 문서(AGENTS.md, orchestration-protocol.md, SKILL.md, docs/*)와 충돌하면 이 문서를 따릅니다.
다른 문서는 이 내용을 복제하지 말고 "job-criteria.md 참조"로만 링크합니다.

데이터·CLI 규격(jobKey, 스키마, 파일 배치 등)은 [docs/pipeline-spec.md](../../docs/pipeline-spec.md)를 따릅니다.

---

## 1. 공통 기준 (모든 트랙)

| 항목 | 규칙 |
| :--- | :--- |
| 대상 | **신입 공고만** 대상 |
| 통과 | `신입`, `경력무관`, `신입/경력` 표기 |
| 통과 | 인턴, 전환형 인턴 |
| 탈락 | **최소 경력을 요구**하는 공고 (1년 이상 포함, 연차 숫자가 하나라도 최소 요건으로 명시된 경우) |
| 탈락 | **퍼블리셔 전담** 포지션 (트랙과 무관) |

---

## 2. 트랙 정의

### 트랙 1 — 대기업·중견기업 등 큰 기업 대상
* **기업 범위**
  * 사람인: 대기업 · 매출1000대기업 · 중견기업
  * 잡코리아: 대기업 · 30대그룹사 · 중견기업 · 매출1000대기업
* **직무 기준**: IT/SW 직무 **전반 합격**
  (프론트엔드, 백엔드, 앱, 시스템, AI, 데이터, SW 개발 등)

### 트랙 2 — 기업규모 무관
* **기업 범위**: 제한 없음 (스타트업·중소·중견·대기업 모두 포함)
* **직무 기준**: **프론트엔드, 웹개발(웹 풀스택 포함) 직무만 합격**
  순수 백엔드는 탈락.

---

## 3. 플랫폼별 운영 트랙

| 플랫폼 | track1 | track2 |
| :--- | :---: | :---: |
| 사람인 (saramin) | ✅ | ✅ |
| 잡코리아 (jobkorea) | ✅ | ✅ |
| 원티드 (wanted) | ❌ | ✅ (track2만 운영) |

체크포인트 파일도 이 구성을 따릅니다 (`data/checkpoints/{site}/{track}.json`, 원티드는 `wanted/track2.json`).

---

## 4. 플랫폼별 필터 설정값

### 4.1 사람인 (Saramin) — URL 파라미터 방식
* **트랙 1** (대기업·매출1000대·중견 / IT개발·데이터 7개 직무 - 백엔드, 앱, 웹, 프론트엔드, 유지보수, 퍼블리셔, SI / 신입 / 최신순)
  * 파라미터: `cat_kewd=84,86,87,92,89,91,101`, `exp_cd=1`, `company_type=scale001,scale002,scale003`, `sort=RD`
  * 직무 키워드: 백엔드/서버개발(`84`), 앱개발(`86`), 웹개발(`87`), 프론트엔드(`92`), 유지보수(`89`), 퍼블리셔(`91`), SI개발(`101`)
  * 직통 URL:
    `https://www.saramin.co.kr/zf_user/jobs/list/job-category?cat_kewd=84%2C86%2C87%2C92%2C89%2C91%2C101&exp_cd=1&company_type=scale001%2Cscale002%2Cscale003&panel_type=&search_optional_item=y&search_done=y&panel_count=y&preview=y&page=1&sort=RD`
* **트랙 2** (기업형태 필터 없음 / 웹개발자·프론트엔드개발자 / 신입 / 최신순)
  * 파라미터: `cat_kewd=92,87`, `exp_cd=1`, `sort=RD` (**`company_type` 지정 금지**)
  * 직통 URL:
    `https://www.saramin.co.kr/zf_user/jobs/list/job-category?cat_kewd=92%2C87&exp_cd=1&panel_type=&search_optional_item=y&search_done=y&panel_count=y&preview=y&page=1&sort=RD`
* **목록 컨테이너**: `div.common_recruilt_list` (또는 `.common_recruit_list`) 내부 `a[href*="rec_idx="]`
  (상단 파워채용·스페셜 등 광고 영역은 무시)
* **본문 원문 URL**: `https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx={id}` (iframe 직통)

### 4.2 원티드 (Wanted) — track2만
* **조건**: 개발 직군(`518`), 프론트엔드(`669`), 웹 개발자(`873`), 신입(`years=0`), 최신순
* 직통 URL:
  `https://www.wanted.co.kr/wdlist/518?country=kr&job_sort=job.latest_order&years=0&locations=all&selected=669&selected=873`
* **목록 컨테이너**: 공고 카드 링크 `a[href*="/wd/"]` (`ul[data-cy="job-list"]`)
* **상세 페이지**: `https://www.wanted.co.kr/wd/{id}`

### 4.3 잡코리아 (Jobkorea) — UI 클릭 방식
> 🚨 **잡코리아는 필터 선택값이 URL 파라미터로 동기화되지 않습니다.**
> 페이지 내부 AJAX로 동작하므로 URL 쿼리(`cotype`, `duty`, `career` 등)로 필터를 적용할 수 없습니다.
> 기본 URL로 진입한 뒤 **내장 브라우저로 필터 UI를 직접 클릭**해서만 적용합니다.

* **기본 진입 URL**: `https://www.jobkorea.co.kr/recruit/joblist?menucode=duty`
* **트랙 1 클릭 항목**
  1. 직무: `IT·인터넷` 선택 후 `프론트엔드개발자`, `웹개발자`, `앱개발자`, `시스템엔지니어`, `소프트웨어개발자`, `AI서비스개발자` 등 AI·개발·데이터 주요 직군 (백엔드 포함) 체크
  2. 경력: `신입`
  3. 기업 형태: `대기업`, `30대그룹사`, `중견기업`, `매출1000대기업`
  4. 검색 버튼 클릭, 정렬 `등록일순`
* **트랙 2 클릭 항목**
  1. 직무: `IT·인터넷` 선택 후 `프론트엔드개발자`, `웹개발자` 2개만 체크
  2. 경력: `신입`
  3. 기업 형태: **선택하지 않음** (기업규모 무관)
  4. 검색 버튼 클릭, 정렬 `등록일순`
* **목록 컨테이너**: `<div id="dev-gi-list">` 내부 `a[href*="GI_Read/"]`
  (상단 스페셜·포커스 광고는 무시)
* **상세 페이지**: `https://www.jobkorea.co.kr/Recruit/GI_Read/{id}`
* 필터 적용 후 화면에 실제 선택된 조건을 `appliedFilters`로 기록하고, 기대값과 다르면 `FILTER_MISMATCH`로 중단합니다.

---

## 5. 탈락 사유 코드

탈락(`verdict: "reject"`) 시 아래 코드 중 **하나**를 `reasonCode`로 기록합니다.

| 코드 | 의미 |
| :--- | :--- |
| `EXPERIENCE_REQUIRED` | 최소 경력 요구 (1년 이상 포함) |
| `PUBLISHER_ONLY` | 퍼블리셔 전담 포지션 |
| `BACKEND_ONLY_TRACK2` | 트랙2 공고인데 순수 백엔드 |
| `NOT_IT_ROLE` | IT/SW 직무가 아님 (트랙1) |
| `COMPANY_SCALE_MISMATCH` | 트랙1인데 기업 규모가 대상 범위 밖 |
| `CLOSED` | 이미 마감된 공고 |
| `DUPLICATE_CONFIRMED` | 심사 중 중복으로 확정 |
| `OTHER` | 위에 해당하지 않음. **`reason` 사유 텍스트 필수** |

## 6. 심사 판정 순서 (권장)
1. `CLOSED` 여부
2. 경력 요건 (`EXPERIENCE_REQUIRED`)
3. 퍼블리셔 전담 (`PUBLISHER_ONLY`)
4. 트랙별 직무·기업규모 (`NOT_IT_ROLE`, `COMPANY_SCALE_MISMATCH`, `BACKEND_ONLY_TRACK2`)
5. 중복 확정 (`DUPLICATE_CONFIRMED`)
