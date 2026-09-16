# 4. 브라우징 및 MCP 연동 전략 (Browsing & MCP Strategy)

본 문서는 채용 사이트의 봇 방어 시스템(Anti-bot)을 안전하게 우회하고, Playwright MCP를 활용하여 브라우저를 지능적으로 제어하며, 다양한 웹 엣지 케이스를 극복하는 전략을 기술합니다.

---

## 4.1 봇 탐지 우회 아키텍처 (Anti-bot Bypass)

대다수 채용 플랫폼(사람인, 잡코리아, 링크드인 등)은 헤드리스 브라우저의 기본 플래그(`navigator.webdriver = true`, 자동화 헤더)를 감지하여 접근을 차단하거나 CAPTCHA를 요구합니다.  
이를 완벽히 우회하기 위해 **실제 사용자 환경을 그대로 활용하는 두 가지 모드**를 지원합니다.

```mermaid
flowchart LR
    subgraph Mode1["모드 1: CDP 원격 디버깅 연결 (추천: 주간/직접 테스트)"]
        UserChrome["사용자 크롬 실행<br/>chrome.exe --remote-debugging-port=9222"]
        MCP1["Playwright MCP"]
        MCP1 <-->|connect_over_cdp('http://localhost:9222')| UserChrome
    end

    subgraph Mode2["모드 2: 영구 프로필 런칭 (추천: 야간 무인 자동화)"]
        ProfileDir["전용 크롬 프로필 디렉토리<br/>userDataDir: './.chrome-profile'"]
        MCP2["Playwright MCP"]
        MCP2 -->|launch_persistent_context| StandaloneChrome["스마트 백그라운드 브라우저"]
        ProfileDir <-->|쿠키/세션 영구 보존| StandaloneChrome
    end
```

### 4.1.1 모드 1: CDP (Chrome DevTools Protocol) 연결
* 사용자가 평소 쓰는 크롬을 `--remote-debugging-port=9222` 옵션으로 켜둔 상태에서 연결.
* **장점**: 100% 실제 사용자 세션, 확장 프로그램, 로그인 쿠키 공유. 봇 탐지 솔루션 통과율 최고.
* **실행 명령어**:
  ```powershell
  & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\Users\yeonn\AppData\Local\Google\Chrome\User Data"
  ```

### 4.1.2 모드 2: 영구 컨텍스트 (Persistent Context) 자동 런칭
* 야간 자동 실행 시 크롬이 켜져 있지 않아도, 스크립트가 전용 프로필 디렉토리를 로드하여 직접 실행.
* **스텔스(Stealth) 인자 필수 적용**:
  ```javascript
  const context = await chromium.launchPersistentContext('./.chrome-bot-profile', {
    headless: false, // 창을 최소화하거나 가상 디스플레이에서 실행
    args: [
      '--disable-blink-features=AutomationControlled', // 봇 감지 플래그 제거
      '--no-sandbox',
      '--disable-infobars',
      '--window-size=1920,1080'
    ]
  });
  ```

---

## 4.2 Playwright MCP 도구 조작 프로토콜

에이전트는 제공된 MCP 도구를 다음과 같은 표준 프로토콜로 사용합니다:

| 단계 | 사용하는 도구 | 설명 |
| :--- | :--- | :--- |
| **페이지 진입** | `browser_navigate(url)` | 대상 공고 상세 페이지로 직행 (히스토리 꼬임 방지) |
| **상태 확인** | `browser_evaluate()` 또는 DOM 트리 | 페이지 로딩 완료 및 팝업 여부 감지 |
| **팝업 제거** | `browser_click(selector)` | "오늘 하루 보지 않기", "닫기", "X" 버튼 클릭 |
| **텍스트 추출** | `browser_evaluate()` | 본문 텍스트 콘텐츠(자격요건, 우대사항 등) 1차 추출 |
| **비전 캡처** | `browser_screenshot()` | 본문이 이미지일 경우 본문 요소를 캡처하여 Vision LLM 전달 |

---

## 4.3 엣지 케이스 대응 전략 (Edge Case Handling)

### 4.3.1 엣지 케이스 ①: 통이미지(Image-only) 공고
* **감지 조건**:
  - 본문 텍스트 길이가 150자 미만인 경우.
  - 본문 컨테이너 내부에 고해상도 `<img>` 태그가 1개 이상 존재하거나 `iframe`으로 이미지가 임베드된 경우.
* **대응 파이프라인**:
  1. `page.locator('.job_description, .user_content, #artNotice')` 등의 본문 영역을 타깃하여 스크린샷 캡처.
  2. 이미지가 세로로 긴 경우(Long-scroll image): 뷰포트 높이별로 분할 캡처 또는 풀페이지 캡처(`fullPage: true`).
  3. 캡처된 이미지 버퍼를 Gemini Vision LLM에 전달하여 프롬프트 실행:
     > *"이 채용공고 이미지에서 웹 개발 부문의 [담당업무, 필수 자격요건, 우대사항, 기술스택, 마감일]을 텍스트로 복원하라."*
  4. 복원된 텍스트를 `JobDataPayload`에 채우고 `isImageBased: true` 플래그 설정.

### 4.3.2 엣지 케이스 ②: 자사 채용 홈페이지 지원 (External Apply Link)
* **감지 조건**:
  - 사람인/잡코리아 등의 접수방법 란에 "홈페이지 지원 바로가기" 또는 외부 링크(`https://careers.*`)가 기재된 경우.
  - 본문에 "자세한 사항은 채용 홈페이지를 참조하세요" 문구만 있고 세부 요건이 누락된 경우.
* **대응 파이프라인**:
  1. **1차 시도 (Follow-up)**: 에이전트가 외부 링크를 새 탭으로 열어 본문 텍스트 로드를 시도.
  2. **보호 장치 (Fallback Guardrail)**: 만약 외부 사이트가 회원가입/사내 인트라넷/CAPTCHA로 막혀 있다면 즉시 탐색을 중단.
  3. 수집된 기본 정보(회사명, 공고명, 원본 링크)에 `requiresExternalApply: true` 플래그를 달고, 노션 페이지 최상단에 **🚨 [자사 채용 사이트 직접 확인 필요]** 배너를 생성하여 사용자가 아침에 노션에서 클릭 한 번으로 이동할 수 있도록 안내.

### 4.3.3 엣지 케이스 ③: 대규모 통합 공채 (Multi-track Recruiting)
* **감지 조건**:
  - 공고 제목에 "신입/경력 공채", "부문별 수시 채용" 등 포괄적인 명칭 사용.
  - 본문 안에 여러 모집 직무(예: 기획, 디자인, 영업, 웹개발, 모바일, 인프라)가 병렬로 나열된 경우.
* **대응 파이프라인**:
  - LLM에게 전체 텍스트를 전달하고 "웹 개발(프론트엔드, 백엔드, 풀스택)" 섹션만 별도로 발췌하도록 지시.
  - 웹 개발 직무가 목록에 아예 없다면 수집을 취소(`SKIPPED_NOT_RELEVANT`)하여 불필요한 노션 페이지 생성을 방지.
