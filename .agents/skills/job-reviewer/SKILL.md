---
name: job-reviewer
description: 채용공고 심사 큐에서 배치를 할당받아 본문을 직접 브라우징하고, job-criteria.md 기준으로 심사하여 18개 표준 속성 및 AI 3줄 요약 결과를 reviewQueue에 1건씩 즉시 제출하는 전문 심사 서브에이전트 스킬.
---

# 🎯 채용공고 정밀 심사 서브에이전트 스킬 (Job Reviewer)

이 스킬은 채용공고 수집 큐(`review_queue.json`)에 적재된 공고들을 대상으로 **상세 본문을 직접 열람하여 자격요건, 우대사항, 전형절차를 심사하고 표준화된 결과를 제출**하는 전문 에이전트 가이드입니다.

> 🚨 **[심사 서브에이전트의 단일 책임 원칙 (Single Responsibility)]**
> * 심사 서브에이전트는 **"본문을 읽고, 판정하여, 결과 JSON을 제출(submit)하는 일"**만 전담합니다.
> * 노션 DB 직접 등록, 디스코드 알림, 체크포인트 수정, 레지스트리 직접 파일 조작 등을 **절대 수행하지 마십시오.** (모두 `reviewQueue.js` 및 `publishRun.js`가 코드로 안전하게 전담합니다).
> * **한 서브에이전트는 할당받은 배치 1개만 처리하고 즉시 종료**합니다 (컨텍스트 오염 및 토큰 낭비 방지).

---

## 📋 표준 심사 및 제출 파이프라인 (Execution Protocol)

### 1단계: 배치 할당받기
다음 명령어를 실행하여 검토할 공고 목록(기본 12건 단위)을 할당받습니다:
```bash
node tools/reviewQueue.js next --run <runId>
```
* 반환된 `batchPath` (예: `data/runs/<runId>/batches/batch_1.json`)와 항목 목록(`items`)을 확인합니다.
* `count === 0`이면 심사할 대기 공고가 없으므로 즉시 작업을 완료합니다.

---

### 2단계: 공고별 상세 본문 열람 (No-Script 가드레일)
🚨 **임의의 Node.js 크롤러나 fetch 스크립트를 작성하지 마십시오.**  
항목의 `detailUrl`을 **Antigravity 내장 브라우저 도구**를 통해 사람이 열람하듯 직접 확인합니다.

* **사람인**: `detailUrl`이 이미 `https://www.saramin.co.kr/zf_user/jobs/relay/view-detail?rec_idx={id}`(iframe 직통)로 지정되어 있으므로 불필요한 배너 없이 본문 텍스트를 즉시 확인합니다.
* **잡코리아 / 원티드**: `detailUrl`로 직접 진입하여 본문, 전형단계, 마감일을 확인합니다.
* **통이미지 공고**: 텍스트 복사가 불가능한 통이미지 형태의 공고는 브라우저 스크린샷 도구를 활용하여 비전(Vision)으로 자격요건과 마감일을 판독합니다.
* **가림막 / 팝업**: 팝업이나 쿠키 안내 레이어가 본문을 가릴 경우 닫기 버튼을 클릭하거나 스크롤하여 본문 전체를 읽습니다.

---

### 3단계: [job-criteria.md](../../rules/job-criteria.md) 기준 엄격 판정

반드시 아래 우선순위 순서대로 판정합니다:

1. **마감 여부 (`CLOSED`)**:
   - 이미 마감되었거나 삭제된 공고인 경우 $\rightarrow$ 탈락 (`verdict: "reject"`, `reasonCode: "CLOSED"`)
2. **최소 경력 요구 (`EXPERIENCE_REQUIRED`)**:
   - 최소 1년 이상의 경력을 필수로 요구하거나, 연차 숫자가 하나라도 최소 자격요건으로 명시된 경우 $\rightarrow$ 탈락 (`verdict: "reject"`, `reasonCode: "EXPERIENCE_REQUIRED"`)
   - 단, `신입`, `경력무관`, `신입/경력`, `인턴`, `전환형 인턴`은 통과.
3. **퍼블리셔 전담 (`PUBLISHER_ONLY`)**:
   - 프론트엔드/웹 개발 로직 없이 마크업/퍼블리싱만 전담하는 포지션 $\rightarrow$ 탈락 (`verdict: "reject"`, `reasonCode: "PUBLISHER_ONLY"`)
4. **트랙별 직무 및 기업규모 적합성**:
   - **트랙 2 (기업규모 무관)**: 웹 프론트엔드 또는 웹 풀스택이 아닌 **순수 백엔드** 전용 포지션 $\rightarrow$ 탈락 (`verdict: "reject"`, `reasonCode: "BACKEND_ONLY_TRACK2"`)
   - **트랙 1 (대기업·중견)**: IT/SW 직무가 아닌 경우 $\rightarrow$ 탈락 (`verdict: "reject"`, `reasonCode: "NOT_IT_ROLE"`)
   - **트랙 1 (대기업·중견)**: 대상 기업 규모(대기업, 30대그룹사, 중견기업, 매출1000대기업)에 미달하는 경우 $\rightarrow$ 탈락 (`verdict: "reject"`, `reasonCode: "COMPANY_SCALE_MISMATCH"`)
5. **의심 중복 (`dupHint`) 검토**:
   - 항목에 `dupHint`가 존재하는 경우, 매칭 대상 공고와 비교하여 실제 동일한 포지션의 중복 공고임이 확인되면 $\rightarrow$ 탈락 (`verdict: "reject"`, `reasonCode: "DUPLICATE_CONFIRMED"`)
   - 다른 직무/포지션이면 정상 심사를 계속 진행.
6. **기타 탈락**:
   - 위 기준 외 명백한 부적격 사유가 있는 경우 $\rightarrow$ 탈락 (`verdict: "reject"`, `reasonCode: "OTHER"`, `reason: "<구체적 사유>"`)

---

### 4단계: 합격 공고 표준 18개 속성 및 AI 3줄 요약 도출

모든 심사를 통과(`verdict: "pass"`)한 공고는 표준 JSON 규격으로 데이터를 정제합니다:

#### 1) 18개 메타데이터 필드 (단일 원천 enum 준수)
* `company`: 기업명 (예: `우아한형제들`)
* `position`: 채용직무명 (예: `배민B마트 웹 프론트엔드 개발자`)
* `rawTitle`: 목록에 노출되었던 원문 공고 제목
* `url`: 채용공고 원문 URL
* `jobKey`: 해당 공고의 고유 키 (예: `saramin:51234567`)
* `jobCategory`: `프론트엔드`, `풀스택`, `웹개발`, `소프트웨어` 중 1개 (트랙1 백엔드는 `소프트웨어` 또는 `풀스택`)
* `experienceLevel`: `신입`, `경력무관`, `신입/경력` 중 1개
* `employmentType`: `정규직`, `계약직`, `인턴`, `전환형 인턴`, `채용연계형 인턴`, `체험형 인턴` 중 1개
* `companyScale`: `스타트업`, `중소기업`, `중견기업`, `대기업`, `공기업`, `외국계기업`, `대기업계열사`, `벤처기업` 중 1개
* `industry`: `IT/소프트웨어`, `핀테크`, `커머스`, `이커머스`, `게임`, `B2B / SaaS`, `클라우드/인프라`, `AI`, `데이터 분석`, `헬스케어`, `블록체인`, `모빌리티`, `엔터테이먼트`, `미디어/엔터테인먼트`, `SNS`, `에듀테크`, `스마트팩토리`, `O2O/플랫폼`, `금융권`, `제조업`, `제조·화학`, `호텔/레저`, `기타 서비스업` 중 1개
* `industryDetail`: 세부 비즈니스 모델 (예: `배달 커머스 플랫폼`)
* `location`: 근무지 (예: `서울 송파구 올림픽로 (재택 병행)`)
* `deadline`: 마감일 (`YYYY-MM-DD` 형식, 상시채용/채용시마감은 null 또는 생략)
* `postedDate`: 공고 등록일 (`YYYY-MM-DD` 형식, 확인 불가 시 null)
* `documents`: 제출 서류 배열 (예: `["이력서", "포트폴리오"]`)
* `1차` ~ `6차`: 전형 절차 매핑 (`서류전형`, `코딩테스트`, `과제테스트`, `직무면접`, `컬쳐핏면접`, `임직원면접`, `최종합격`, `임원면접`, `인적성 검사`, `사전과제`, `AI역량검사`, `실무면접` 중 선택, 미진행 단계는 null)
* `mainTasks`: 주요 업무 항목 문자열 배열
* `requirements`: 지원 자격 항목 문자열 배열
* `preferredPoints`: 우대 사항 항목 문자열 배열
* `benefits`: 복리후생 항목 문자열 배열

#### 2) AI 핵심 3줄 요약 (`summary`) 작성 규격
반드시 다음 **3줄 포맷**을 지켜야 합니다:
```
• [지원 적합도]: React/TypeScript 역량 관점에서 이 포지션이 사용자(프론트엔드 신입/주니어)에게 왜 적합한지 또는 주의할 점
• [핵심 업무]: 담당하게 될 주력 서비스 및 핵심 기술적 역할
• [어필 포인트]: 이력서 및 포트폴리오에서 강조하면 합격률을 높일 수 있는 핵심 역량/경험
```

---

### 5단계: 1건 즉시 제출 (Submit-as-You-Go)

🚨 **여러 공고를 모아서 한 번에 제출하지 마십시오!**  
1건을 판정할 때마다 즉시 임시 파일을 생성하고 submit 명령을 호출하여 유실을 방지합니다.

1. **임시 JSON 저장**:
   - 파일 경로: `.agents/scratch/{runId}/review_{jobKey의 ':'를 '_'로 바꾼 이름}.json`
     (예: `.agents/scratch/20261006-1534/review_saramin_51234567.json`)
   - 실행(run) 단위로 폴더를 나누어 관리하며, 폴더가 없으면 먼저 생성합니다.

   * **합격 예시 (`pass`)**:
     ```json
     {
       "jobKey": "saramin:51234567",
       "site": "saramin",
       "track": "track2",
       "verdict": "pass",
       "reasonCode": null,
       "reason": null,
       "job": {
         "company": "토스뱅크",
         "position": "Frontend Developer",
         "rawTitle": "[2026 상반기] Frontend Developer 신입",
         "url": "https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=51234567",
         "jobKey": "saramin:51234567",
         "jobCategory": "프론트엔드",
         "experienceLevel": "신입",
         "employmentType": "정규직",
         "industry": "핀테크",
         "industryDetail": "인터넷전문은행",
         "companyScale": "대기업",
         "location": "서울 강남구 테헤란로",
         "deadline": "2026-10-31",
         "postedDate": "2026-10-05",
         "documents": ["이력서", "포트폴리오"],
         "1차": "서류전형",
         "2차": "직무면접",
         "3차": "최종합격",
         "4차": null,
         "5차": null,
         "6차": null,
         "summary": "• [지원 적합도]: React 및 TypeScript 기반의 대규모 웹 뷰 금융 서비스를 직접 개발하며 기술적 성장을 이룰 수 있는 최적의 신입 포지션입니다.\n• [핵심 업무]: 토스 앱 내 은행 코어 뱅킹 서비스 프론트엔드 웹뷰 개발 및 컴포넌트 라이브러리 고도화\n• [어필 포인트]: 상태 관리 최적화 경험과 엄격한 타입 안정성을 고려한 TypeScript 프로젝트 구현 경험을 적극 어필할 것",
         "mainTasks": ["토스뱅크 웹뷰 서비스 개발"],
         "requirements": ["React, TypeScript 사용 경험자"],
         "preferredPoints": ["웹 성능 최적화 경험자"],
         "benefits": ["선택적 근로시간제, 주택자금 대출 지원"]
       }
     }
     ```

   * **탈락 예시 (`reject`)**:
     ```json
     {
       "jobKey": "saramin:51234999",
       "site": "saramin",
       "track": "track2",
       "verdict": "reject",
       "reasonCode": "EXPERIENCE_REQUIRED",
       "reason": "최소 경력 2년 이상 요구"
     }
     ```

2. **제출 실행**:
   ```bash
   node tools/reviewQueue.js submit --run <runId> --input .agents/scratch/20261006-1534/review_saramin_51234567.json
   ```
   * 성공 시 레지스트리에 실시간 반영되며 `results.jsonl`에 즉시 기록됩니다.
   * 오류(검증 실패) 발생 시 출력된 에러 내용을 확인하고 **해당 항목만 즉시 수정하여 재제출**합니다.

---

### 6단계: 배치 완료 후 종료
배치 파일(`batch_{k}.json`)의 모든 항목을 처리 완료하면:
```bash
node tools/reviewQueue.js status --run <runId>
```
명령으로 큐 상태를 최종 확인하고, 서브에이전트 작업을 종료합니다.
