---
name: scout-wanted
description: >-
  원티드(Wanted) 채용 플랫폼에서 스타트업/성장기업 중심의 웹 개발자 및 프론트엔드 개발자 신입 공고(트랙2)의 목록 수집 루프를 수행하는 전문 서브에이전트 스킬.
---

# Wanted Scout Sub-Agent

원티드 채용정보 목록에서 공고 메타데이터(id, url, title, company, career)를 추출하여 `scanController`로 전달하는 **목록 수집 전용 에이전트**입니다.

> 🚨 **[서브에이전트 역할 엄수]**
> - **목록 수집만 수행**: 본문 열람, 심사/판정, 노션 발행, 디스코드 발송, 체크포인트 파일 수정은 절대 하지 않습니다.
> - **판단은 코드가 전담**: 다음 페이지 이동 여부, 수집 종료는 모두 `tools/scanController.js`의 반환값(`action`)에 따릅니다.
> - **단일 트랙 운영**: 원티드는 트랙 2(웹/프론트엔드 신입)만 단독 운영합니다.
> - **필터 기준 및 규격**: [`.agents/rules/job-criteria.md`](../../rules/job-criteria.md) 및 [`docs/pipeline-spec.md`](../../../docs/pipeline-spec.md)를 참조합니다.

---

## 1. 플랫폼 진입 URL (트랙 2 전용)

* **조건**: 개발 직군(`518`), 프론트엔드(`669`), 웹 개발자(`873`), 신입(`years=0`), 최신순 (`job_sort=job.latest_order`)
* **공식 탐색 URL**:
  `https://www.wanted.co.kr/wdlist/518?country=kr&job_sort=job.latest_order&years=0&locations=all&selected=669&selected=873`
* **타깃 컨테이너**: `ul[data-cy="job-list"]` 내부 카드 링크 `a[href*="/wd/"]`

---

## 2. 수집 및 scanController 연동 루프

### 🔄 트랙 2 수집 루프
1. **페이지 진입**: 트랙 2 공식 웹 URL로 내장 브라우저 진입.
2. **목록 스니펫 실행**:
   - 브라우저 콘솔에서 [`.agents/skills/scout-wanted/snippet.js`](snippet.js) 코드를 `browser_evaluate`로 실행.
   - 반환된 `{ appliedFilters, items }` JSON 데이터를 `data/runs/{runId}/wanted_track2/raw_{page}.json` 파일로 저장.
3. **컨트롤러 스텝 호출**:
   ```bash
   node tools/scanController.js step --run <runId> --site wanted --track track2 --page <page> --input data/runs/<runId>/wanted_track2/raw_<page>.json
   ```
4. **결과 액션(`action`) 수행**:
   * **`NEXT_PAGE`**:
     - 원티드는 무한 스크롤 형태이므로, 브라우저에서 **페이지 맨 아래로 스크롤(`window.scrollTo(0, document.body.scrollHeight)`) 후 신규 카드들이 로드될 때까지 1~2초 대기**하고 2단계로 복귀. (원티드는 `JUMP_PAGE` 비활성)
   * **`STOP`**:
     - 수집 즉시 종료.
     - 반환된 `reason`(`LIMIT_QUEUED`, `LIST_END`, `FILTER_MISMATCH` 등)과 누적 카운터를 확인하고 오케스트레이터에게 보고.
