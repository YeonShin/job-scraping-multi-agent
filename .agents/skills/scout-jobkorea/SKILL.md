---
name: scout-jobkorea
description: >-
  잡코리아(Jobkorea) 채용 플랫폼에서 [대기업/그룹사 SW전체 트랙1]과 [웹·프론트엔드 트랙2]의 UI 필터 설정 및 목록 수집 루프를 순차 수행하는 전문 서브에이전트 스킬.
---

# Jobkorea Scout Sub-Agent

잡코리아 채용정보 목록에서 공고 메타데이터(id, url, title, company, career)를 추출하여 `scanController`로 전달하는 **목록 수집 전용 에이전트**입니다.

> 🚨 **[서브에이전트 역할 엄수]**
> - **목록 수집만 수행**: 본문 열람, 심사/판정, 노션 발행, 디스코드 발송, 체크포인트 파일 수정은 절대 하지 않습니다.
> - **판단은 코드가 전담**: 다음 페이지 이동 여부, 수집 종료는 모두 `tools/scanController.js`의 반환값(`action`)에 따릅니다.
> - **필터 기준 및 규격**: [`.agents/rules/job-criteria.md`](../../rules/job-criteria.md) 및 [`docs/pipeline-spec.md`](../../../docs/pipeline-spec.md)를 참조합니다.

> 🌐 **[브라우저 도구 규칙]**
> - 목록 수집은 **Playwright MCP 도구**(`browser_navigate`, `browser_evaluate`, `browser_snapshot`, `browser_click`, `browser_wait_for` 등)를 직접 호출하여 수행합니다.
> - `snippet.js`는 `browser_evaluate`로 **파일 내용 그대로** 실행합니다. **Antigravity `browser_subagent`에 위임하거나 코드를 작업 프롬프트에 붙여 넣지 마십시오.** (`browser_subagent`는 JS를 실행하지 못하고 스크롤·DOM 추출을 반복하는 방식으로 대체하여 느려지고 결과가 불안정해집니다.)
> - `browser_evaluate`의 인자 `function`은 `() => { ... }` 형태를 기대합니다. `snippet.js`는 `(() => {...})()` 형태이므로 형식 오류가 나면 `() => ( <snippet 전체 식> )`로 감싸 실행하되 내용은 바꾸지 마십시오.

---

## 1. 잡코리아 UI 필터링 프로토콜 (URL 파라미터 미지원)

잡코리아는 URL 쿼리 파라미터로 필터가 적용되지 않으므로, Playwright MCP로 기본 URL에 진입한 후 **UI 요소를 직접 클릭**하여 필터를 설정합니다. `browser_snapshot`으로 페이지의 요소를 확인한 뒤 `browser_click`의 `target`에 스냅샷의 요소 ref(또는 고유 선택자)를 지정하고, 렌더링은 `browser_wait_for`로 기다립니다.

* **기본 진입 URL**: `https://www.jobkorea.co.kr/recruit/joblist?menucode=duty`

### [트랙 1] 대기업·그룹사·중견기업 SW전체
1. **직무 선택 (Duty)**: `AI·개발·데이터` 대분류 클릭 ➔ `프론트엔드개발자`, `웹개발자`, `앱개발자`, `시스템엔지니어`, `소프트웨어개발자`, `AI서비스개발자` 체크
2. **경력(Career)**: `신입` 체크
3. **기업 형태 (Company Type)**: `대기업`, `30대그룹사`, `매출1000대기업`, `중견기업` 체크
4. **검색 및 정렬**: `선택된 조건 검색하기` 버튼 클릭 ➔ 정렬을 기본 `추천순`에서 `등록일순`으로 변경

### [트랙 2] 웹개발자 / 프론트엔드 (기업규모 무관)
1. **직무 선택 (Duty)**: `AI·개발·데이터` 대분류 클릭 ➔ `프론트엔드개발자`, `웹개발자` 2개만 체크
2. **경력(Career)**: `신입` 체크
3. **기업 형태 (Company Type)**: **선택하지 않음** (기업규모 무관)
4. **검색 및 정렬**: `선택된 조건 검색하기` 버튼 클릭 ➔ 정렬을 기본 `추천순`에서 `등록일순`으로 변경

---

## 2. 수집 및 scanController 연동 루프

동일 에이전트가 **트랙 1 ➔ 트랙 2** 순서로 순차 수행합니다.

### 🔄 단일 트랙 수집 루프
1. **필터 설정**: 위의 프로토콜에 따라 해당 트랙의 UI 필터를 클릭 설정하고 1페이지 로드.
2. **목록 스니펫 실행**:
   - Playwright MCP `browser_evaluate`로 [`.agents/skills/scout-jobkorea/snippet.js`](snippet.js)의 내용을 그대로 실행.
   - 결과를 `data/runs/{runId}/jobkorea_{track}/raw_{page}.json` 파일로 저장.
3. **컨트롤러 스텝 호출**:
   ```bash
   node tools/scanController.js step --run <runId> --site jobkorea --track <track> --page <page> --input data/runs/<runId>/jobkorea_<track>/raw_<page>.json
   ```
4. **결과 액션(`action`) 수행**:
   * **`NEXT_PAGE`**:
     - 잡코리아는 URL 변경으로 이동할 수 없으므로, 목록 하단 페이지네이션 컨테이너에서 해당 페이지 번호 링크(예: `2`, `3` 버튼)를 `browser_snapshot` 확인 후 `browser_click`으로 직접 클릭하여 이동 후 2단계로 복귀. (잡코리아는 `JUMP_PAGE` 비활성)
   * **`STOP`**:
     - 해당 트랙 수집 즉시 종료.
     - 반환된 `reason`과 누적 카운터를 확인하고 오케스트레이터에게 보고.
5. **다음 트랙 진행**: 트랙 1이 종료되면 트랙 2로 진입하여 필터를 재설정하고 동일 루프 반복.
