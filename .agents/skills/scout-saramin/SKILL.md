---
name: scout-saramin
description: >-
  사람인(Saramin) 채용 플랫폼에서 [대기업/중견 IT전체 트랙1]과 [웹·프론트엔드 트랙2]의 목록 수집 루프를 순차 수행하는 전문 서브에이전트 스킬.
---

# Saramin Scout Sub-Agent

사람인 채용정보 목록에서 공고 메타데이터(id, url, title, company, career)를 추출하여 `scanController`로 전달하는 **목록 수집 전용 에이전트**입니다.

> 🚨 **[서브에이전트 역할 엄수]**
> - **목록 수집만 수행**: 본문 열람, 심사/판정, 노션 발행, 디스코드 발송, 체크포인트 파일 수정은 절대 하지 않습니다.
> - **판단은 코드가 전담**: 다음 페이지 이동 여부, 구간 점프, 수집 종료는 모두 `tools/scanController.js`의 반환값(`action`)에 따릅니다.
> - **필터 기준 및 규격**: [`.agents/rules/job-criteria.md`](../../rules/job-criteria.md) 및 [`docs/pipeline-spec.md`](../../../docs/pipeline-spec.md)를 참조합니다.

---

## 1. 플랫폼 필터 진입 URL

* **트랙 1 (대기업·중견기업 SW개발 7개 직무 - 백엔드/서버, 앱, 웹, 프론트엔드, 유지보수, 퍼블리셔, SI)**:
  `https://www.saramin.co.kr/zf_user/jobs/list/job-category?cat_kewd=84%2C86%2C87%2C92%2C89%2C91%2C101&exp_cd=1&company_type=scale001%2Cscale002%2Cscale003&panel_type=&search_optional_item=y&search_done=y&panel_count=y&preview=y&page=1&sort=RD`
* **트랙 2 (기업규모 무관 웹개발·프론트엔드)**:
  `https://www.saramin.co.kr/zf_user/jobs/list/job-category?cat_kewd=92%2C87&exp_cd=1&panel_type=&search_optional_item=y&search_done=y&panel_count=y&preview=y&page=1&sort=RD`

---

## 2. 수집 및 scanController 연동 루프

동일 에이전트가 **트랙 1 ➔ 트랙 2** 순서로 순차 수행합니다.

### 🔄 단일 트랙 수집 루프
1. **페이지 진입**: 트랙 URL(기본 `page=1`)로 내장 브라우저 이동.
2. **목록 스니펫 실행**:
   - 브라우저 콘솔에서 [`.agents/skills/scout-saramin/snippet.js`](snippet.js) 코드를 `browser_evaluate`로 실행.
   - 반환된 `{ appliedFilters, items }` JSON 데이터를 `data/runs/{runId}/saramin_{track}/raw_{page}.json` 파일로 저장.
3. **컨트롤러 스텝 호출**:
   ```bash
   node tools/scanController.js step --run <runId> --site saramin --track <track> --page <page> --input data/runs/<runId>/saramin_<track>/raw_<page>.json
   ```
4. **결과 액션(`action`) 수행**:
   * **`NEXT_PAGE`** 또는 **`JUMP_PAGE`**:
     - 반환된 `page` 번호로 URL의 `page` 파라미터를 변경하여 브라우저 이동 후 2단계로 복귀.
     - 예: `&page=2` ➔ `&page=15` (JUMP_PAGE)
   * **`STOP`**:
     - 해당 트랙 수집 즉시 종료.
     - 반환된 `reason`(`LIMIT_PAGES`, `LIMIT_QUEUED`, `LIST_END`, `FILTER_MISMATCH` 등)과 누적 카운터를 확인하고 오케스트레이터에게 보고. (기본 설정 시 트랙별 최대 2페이지 탐색 후 LIMIT_PAGES 종료)
5. **다음 트랙 진행**: 트랙 1이 종료되면 트랙 2로 진입하여 동일 루프 반복.

---

## 3. 예외 및 실패 처리
* `snippet.js` 실행 시 `CONTAINER_NOT_FOUND` 에러가 발생하면 1회 재시도 후 오케스트레이터에게 보고.
* `scanController.js`가 `FILTER_MISMATCH`를 반환하면 URL 파라미터를 확인하고 1회 재시도 후에도 불일치 시 트랙을 즉시 중단합니다.
