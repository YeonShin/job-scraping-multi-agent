# 5. 노션 데이터베이스 스키마 및 동기화 (Notion Schema & Sync)

본 문서는 연동이 확인된 사용자 노션 데이터베이스(**`🗃️ 공고 분석`**, ID: `343831b8-54df-8081-adb8-e6c93fc69e37`)의 전체 18개 속성(Properties)과 에이전트 자동 입력 규칙, 그리고 페이지 본문 템플릿을 정의합니다.

---

## 5.1 노션 데이터베이스 전체 속성 명세 및 자동 입력 규칙

사용자 DB에 구성된 모든 속성을 에이전트가 누락 없이 분석하여 채워 넣습니다:

| 속성명 (Property) | 노션 타입 (Type) | 에이전트 자동 입력 및 분석 규칙 |
| :--- | :--- | :--- |
| **기업명** | `title` | 공고 기업명 (예: `비바리퍼블리카`, `당근`) |
| **채용직무** | `rich_text` | 상세 포지션명 (예: `프론트엔드 플랫폼 엔지니어`) |
| **직무분류** | `select` | `프론트엔드 개발자`, `웹 개발`, `백엔드 개발자`, `풀스택 개발자`, `SW개발`, `데이터 엔지니어` 등 DB 기존 옵션과 자동 매칭 |
| **경력조건** | `select` | `신입`, `경력무관`, `1년+`, `3년 미만`, `3년+`, `5년이하 (신입가능)`, `5년+` 중 본문 판별 매칭 |
| **고용형태** | `select` | `정규직`, `채용연계형 인턴`, `체험형 인턴`, `계약직`, `일경험` 등 선택 |
| **산업군** | `select` | `IT/웹통신`, `핀테크`, `이커머스`, `B2B / SaaS`, `스타트업`, `O2O/플랫폼` 등 1차 분류 |
| **산업군 (상세)** | `rich_text` | 기업의 구체적 비즈니스 도메인 (예: `간편결제 / 마이데이터`, `중고거래 커머스`) |
| **회사규모** | `select` | `대기업`, `중견기업`, `스타트업`, `벤처기업`, `외국계기업`, `중소기업` 등 판별 |
| **근무지** | `rich_text` | 회사 위치 및 근무 형태 (예: `서울 강남구 테헤란로 (하이브리드 근무)`) |
| **채용링크** | `url` | 원본 채용공고 링크 (**중복 방지 기준 고유 키**) |
| **마감일** | `date` | 공고 마감일 파싱 (`YYYY-MM-DD`, 상시채용인 경우 비워두거나 본문 기록) |
| **공고 등록일** | `date` | 채용 사이트에 공고가 최초 게시된 날짜 |
| **상태** | `status` | 기본값: **`미지원`** (이후 사용자가 지원 완료, 서류합격 등으로 업데이트) |
| **AI 수집** | `checkbox` | 에이전트가 자동 수집한 항목임을 구분하기 위해 항상 **`true (체크)`** |
| **제출 서류** | `multi_select` | 본문에 명시된 서류 (`이력서`, `포트폴리오`, `자기소개서` 등) 복수 선택 |
| **전형 절차 (1차 ~ 6차)** | `select` (각 차수별) | **공고 본문의 [전형 절차]를 읽어 자동 기입**<br/>• 1차: `서류전형`<br/>• 2차: `코딩테스트` 또는 `사전과제`<br/>• 3차: `임직원 면접` 또는 `라이브코딩`<br/>• 4차~6차: `최종합격`, `처우협의` 등 차수별 자동 분배 |
| **매력도** | `select` | 기본값은 공란으로 |
| **created_at** | `date` | 에이전트가 수집한 일시 |

---

## 5.2 전형 절차 (1차~6차) 자동 추출 메커니즘

많은 개발자 채용공고는 다음과 같은 전형 절차를 포함합니다:
> *"전형 절차: 서류 접수 ➔ 온라인 코딩테스트 ➔ 직무 인터뷰 ➔ 최종 컬처 면접"*

에이전트는 이 텍스트를 파싱하여 사용자 노션 DB의 선택지 옵션에 정확히 1:1 매핑합니다:
* **1차**: `서류전형`
* **2차**: `코딩테스트`
* **3차**: `면접` (또는 `임직원 면접`)
* **4차**: `최종합격`
*(5차, 6차가 없는 전형인 경우 빈 값으로 둡니다)*

---

## 5.3 페이지 기본 아이콘
* 생성되는 모든 채용공고 페이지에는 회사/빌딩을 상징하는 **🏢 이모지 아이콘**이 기본 등록됩니다:
```json
"icon": {
  "type": "emoji",
  "emoji": "🏢"
}
```

---

## 5.4 노션 페이지 본문 템플릿 (Page Body Layout)


노션 페이지 본문에는 세부 업무 요건과 AI 요약이 보기 좋은 블록 형태로 자동 생성됩니다:

```markdown
💡 [AI 핵심 3줄 요약]
- 당근마켓 커머스 도메인의 대규모 트래픽을 처리하는 프론트엔드 웹 서비스 개발
- React, TypeScript, GraphQL 기반의 모던 웹 기술 스택 운영
- 신입 지원 가능하며, 웹 성능 최적화 경험자 우대

---

### 📌 주요 업무 (Responsibilities)
* 대규모 유저를 위한 반응형 웹 및 모바일 웹뷰 화면 개발
* 공통 디자인 시스템 컴포넌트 개발 및 유지보수
* 성능 모니터링 및 Web Vitals 최적화 작업

---

### ✅ 지원 자격 (Qualifications)
* HTML, CSS, JavaScript(ES6+), TypeScript에 대한 탄탄한 이해
* React 기반 SPA 개발 및 상태 관리 라이브러리 활용 경험
* Git을 통한 협업 및 코드 리뷰 문화에 익숙하신 분

---

### 🌟 우대 사항 (Preferred)
* Next.js를 활용한 SSR/SSG 아키텍처 구축 경험
* 웹 접근성(A11y) 및 SEO 최적화 경험
* 대규모 트래픽 서비스 런칭 및 운영 경험

---

### 🎁 복리후생 & 근무조건
* 최신형 맥북 프로 및 모니터 지원
* 시차출퇴근제 및 자율 휴가제 운영
```

---

## 5.5 중복 수집 및 재공고(Re-opening) 판별 규칙

채용 시장에서는 공고가 마감되었다가 시간이 지나 다시 동일 포지션으로 채용을 시작하는 '재공고'가 빈번하게 발생합니다.  
따라서 단순 URL 단순 비교를 넘어 **공고의 '상태(Status)'와 '기업명+채용직무'를 결합한 지능형 중복 판별 알고리즘**을 적용합니다.

### 5.5.1 판별 기준 표
| 구분 | 기존 노션 공고의 '상태' | 판정 결과 | 사유 및 동작 |
| :--- | :---: | :---: | :--- |
| **동일 URL 또는 (동일 기업명 + 채용직무)** | `미지원`, `지원 완료`, `서류합격`, `서류탈락`, `합격` | ❌ **수집 제외 (Skip)** | 이미 검토 중이거나 이력이 존재하는 공고이므로 등록하지 않음 |
| **동일 URL 또는 (동일 기업명 + 채용직무)** | **`마감`** | ⭕ **신규 등록 허용 (Allow)** | 과거 마감되었던 포지션이 **새로 다시 채용을 시작(재공고)**한 것이므로 신규 페이지로 등록 (`상태: 미지원`) |
| **DB에 전혀 없는 공고** | 없음 (최초 발견) | ⭕ **신규 등록 허용 (Allow)** | 신규 공고로 정상 등록 |

### 5.5.2 중복 판별 알고리즘 로직 (JavaScript 구현)
```javascript
function shouldCollectJob(incomingJob, existingJobMap) {
  // incomingJob: { url, company, position }
  // existingJobMap: Map<string, { status: string, company: string, position: string }>

  const normalizedUrl = normalizeUrl(incomingJob.url);
  const jobKey = `${incomingJob.company.trim()}__${incomingJob.position.trim()}`;

  // 1. URL 기준 매칭 확인
  if (existingJobMap.has(normalizedUrl)) {
    const existing = existingJobMap.get(normalizedUrl);
    // 마감 상태인 경우에만 재공고로 등록 허용!
    if (existing.status === '마감') {
      console.log(`[재공고 감지] 과거 마감된 공고가 재오픈됨: ${incomingJob.company} - ${incomingJob.position}`);
      return { allowed: true, reason: 'REOPENED_AFTER_CLOSED' };
    }
    return { allowed: false, reason: 'ALREADY_EXISTS_ACTIVE' };
  }

  // 2. 기업명 + 채용직무 기준 매칭 확인 (URL이 바뀌어 새로 올라온 경우 대비)
  for (const [_, existing] of existingJobMap) {
    const existingKey = `${existing.company.trim()}__${existing.position.trim()}`;
    if (existingKey === jobKey) {
      if (existing.status === '마감') {
        console.log(`[재공고 감지] 마감된 동일 포지션 재게시: ${jobKey}`);
        return { allowed: true, reason: 'REPOSTED_SAME_POSITION' };
      }
      return { allowed: false, reason: 'DUPLICATE_POSITION_ACTIVE' };
    }
  }

  return { allowed: true, reason: 'NEW_JOB' };
}
```

