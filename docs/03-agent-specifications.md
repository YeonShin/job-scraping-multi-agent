# 3. 에이전트 계층별 상세 명세 (Agent Specifications)

본 문서는 3-Tier 계층을 이루는 에이전트들의 상세 역할, 입출력 인터페이스(TypeScript/JSON), 수명 주기, 프롬프트 가이드라인을 정의합니다.

---

## 3.1 Tier 1: 총괄 오케스트레이터 (Master Orchestrator)

### 3.1.1 책임과 역할
* **배치 수명 주기 관리**: 수집 시작 시점부터 종료 시점까지의 전 과정 조율.
* **지능형 캐시 및 재공고 관리**: 노션 DB에서 기존 공고의 URL, 기업명, 직무명, **상태(Status)**를 읽어와 캐시를 구축. 기존 공고는 제외하되 **'마감' 상태인 동일 포지션은 재공고로 판별하여 신규 수집 허용**.
* **작업 분배**: Tier 2로부터 전달받은 신규 공고 목록을 `JobQueue`에 담고, 동시성 제한 하에 Tier 3 워커를 호출.
* **리포팅**: 최종 수집 결과(성공, 실패, 마감 후 재오픈, 건너뜀)를 요약하여 로그에 기록.

### 3.1.2 오케스트레이터 상태 인터페이스 (State Interface)
```typescript
interface ExistingJobRecord {
  url: string;
  company: string;
  position: string;
  status: string; // '마감' | '미지원' | '지원 완료' 등
}

interface OrchestratorState {
  startedAt: string;
  targetDate: string;
  existingJobsCache: Map<string, ExistingJobRecord>; // URL 및 (기업명__직무명) 기준 매핑
  discoveredJobs: {
    platform: string;
    url: string;
    company: string;
    position: string;
    discoveredAt: string;
  }[];
  queue: string[];
  metrics: {
    totalDiscovered: number;
    alreadyExistsActive: number;
    reopenedAfterClosed: number; // 마감 후 재오픈된 공고 수
    processedSuccess: number;
    processedFailed: number;
    skippedNotRelevant: number;
  };
}
```


---

## 3.2 Tier 2: 플랫폼별 스카우트 에이전트 (Platform Scouts)

### 3.2.1 책임과 역할
* 오직 **공고 목록(List View) 페이지만을 전담**합니다.
* 마우스 클릭 대신, 사전에 정의된 **고정 직무 필터 URL**로 직접 진입하여 UI 변화에 영향을 받지 않습니다.
* **초고속 패스스루(Fast-forward Passthrough)**:
  - 1페이지부터 설정된 최대 페이지(예: 1~15페이지)까지 순차적으로 훑습니다.
  - 이미 노션에 존재하는 공고는 **0.001초 만에 무시(Skip)**하고 다음 공고로 넘어가며 리소스를 아낍니다.
  - 미수집된 과거 공고나 신규 공고만 선별하여 `JobQueue`에 담습니다.
  - 당일 목표 수집 수량(`MAX_DAILY_JOBS`, 기본 100개)이 차면 탐색을 마칩니다.


### 3.2.2 플랫폼별 엔드포인트 및 탐색 규칙
| 플랫폼 | 타깃 진입 URL 예시 | 탐색 방식 | 추출 대상 선택자(또는 텍스트) |
| :--- | :--- | :--- | :--- |
| **원티드 (Wanted)** | `https://www.wanted.co.kr/wdlist/518/873?country=kr&job_sort=job.latest_order` (웹 개발자 최신순) | 무한 스크롤 3~5회 | `a[data-attribute-id="position__entry"]` 또는 `/wd/[0-9]+` 링크 |
| **사람인 (Saramin)** | `https://www.saramin.co.kr/zf_user/jobs/list/job-category?cat_kcls=2&sort=RD` (IT/인터넷 웹개발 최신순) | 페이지네이션 (1~3페이지) | `a.str_tit` 또는 `/zf_user/jobs/relay/view` 링크 |
| **점핏 (Jumpit)** | `https://www.jumpit.co.kr/positions?jobCategory=1&sort=rsp_rate` (웹 개발 최신순) | 무한 스크롤 3~5회 | `a[href^="/position/"]` 링크 |

### 3.2.3 스카우트 출력 데이터 규격
```typescript
interface ScoutResult {
  platform: 'wanted' | 'saramin' | 'jumpit' | 'jobkorea';
  scoutedAt: string;
  jobUrls: string[]; // 추출된 공고 상세 URL 배열
}
```

---

## 3.3 Tier 3: 공고 분석 워커 에이전트 (Detail Analysis Worker)

### 3.3.1 책임과 역할
* **단일 공고(Single Job) 전담**: 1개의 URL만 맡아 상세 페이지에 진입하고 수명 주기를 마치는 **일회성(One-shot) 격리 세션**입니다.
* **자율 탐색 및 적응**:
  1. 페이지 진입 후 팝업(닫기 버튼)이 있으면 감지하여 닫기 수행.
  2. 본문이 텍스트인지, 통이미지인지, 외부 링크인지 판단.
  3. 이미지일 경우 `browser_screenshot` 후 멀티모달 비전 OCR 분석.
  4. 외부 링크일 경우 리디렉션 추적 (Follow Link).
* **웹 개발 직무 적합도 필터링**:
  - 대규모 공채인 경우 본문 중 '웹 개발' 부문만 정밀 발췌.
  - 웹 개발 직무가 아예 없는 공고(기획/영업 등)인 경우 수집 제외(Skip) 판정.
* **노션 규격 변환**: 최종 데이터를 `JobDataPayload` 형태로 노션 MCP에 전달하여 등록.

### 3.3.2 최종 출력 데이터 페이로드 (JobDataPayload)
```typescript
interface JobDataPayload {
  title: string;              // 공고 제목 (예: [토스] 프론트엔드 플랫폼 개발자)
  company: string;            // 회사명 (예: 비바리퍼블리카)
  platform: string;           // 출처 플랫폼 (예: Wanted)
  sourceUrl: string;          // 원본 공고 링크
  applyUrl?: string;          // 별도 자사 채용 링크가 있을 경우
  location: string;           // 근무지 (예: 서울시 강남구 테헤란로)
  experienceLevel: string;    // 경력 요건 (예: 신입, 1~3년, 경력무관)
  techStack: string[];        // 기술 스택 태그 (예: ["React", "TypeScript", "Next.js"])
  deadline: string;           // 마감일 (예: 2026-10-31, 또는 "상시채용")
  summary: string;            // 핵심 3줄 요약
  responsibilities: string[]; // 주요 업무 리스트
  qualifications: string[];   // 지원 자격 (필수 요건)
  preferred: string[];        // 우대 사항
  benefits: string[];         // 복리후생 / 근무 조건
  isImageBased: boolean;      // 통이미지 기반 여부
  requiresExternalApply: boolean; // 외부 자사 사이트 직접 지원 필요 여부
}
```

### 3.3.3 Tier 3 워커용 시스템 프롬프트 가이드라인
```markdown
당신은 채용공고의 본문을 분석하여 규격화된 데이터로 추출하는 전문 채용 에이전트입니다.
제공된 페이지 텍스트 또는 스크린샷 이미지를 면밀히 분석하여 아래 규칙에 따라 JSON 규격으로 반환하십시오.

[분석 및 발췌 규칙]
1. 타깃 직무 확인:
   - 본 공고가 '웹 개발'(프론트엔드, 백엔드, 풀스택)과 관련된 직무인지 확인합니다.
   - 만약 대규모 통합 공채라면, 여러 직무 중 '웹 개발' 부문의 내용만 정밀하게 발췌하십시오.
   - 웹 개발과 완전히 무관한 공고(예: 영업, 마케팅, 재무 전용)인 경우 status: "SKIPPED_NOT_RELEVANT"로 즉시 반환하십시오.
2. 기술 스택 추출:
   - 본문에 명시된 프로그래밍 언어, 프레임워크, 라이브러리, 인프라 도구를 정규화된 영문 명칭(예: React, Node.js, Spring Boot, Docker)으로 배열에 담으십시오.
3. 마감일 파싱:
   - 날짜(YYYY-MM-DD) 형식으로 표준화하며, 마감일이 명시되지 않았거나 수시 채용인 경우 '상시채용'으로 표기하십시오.
4. 요약:
   - 개발자가 3초 만에 파악할 수 있도록 핵심 업무와 특징을 3문장 이내로 요약하십시오.
```
