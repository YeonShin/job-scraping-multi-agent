# Antigravity 네이티브 멀티 에이전트 하이브리드 워크플로우

> **문서 상태**: **FINAL (공식 아키텍처 규격)**  
> **최종 갱신일**: 2026-09-16  
> **시스템 정의**: 고속 카테고리 필터링 탐색(Hands) + Antigravity 지능형 심사 및 전형 분해(Brain)의 2단계 하이브리드 멀티 에이전트 파이프라인

---

## 1. 핵심 철학: Brain & Hands의 완벽한 분리

1. **손발 (플랫폼별 서브에이전트 스킬)**:
   - 각 채용 사이트의 공식 **직업/직무 카테고리 + 경력(신입/경력무관)** 필터 URL로 직접 진입.
   - 노션 기존 등록 캐시와 대조하여 이미 등록된 공고는 **0.001초 만에 스킵(Fast-forward Passthrough)**.
2. **뇌 (Antigravity Chief Orchestrator)**:
   - 비정형 공고 본문 전체를 읽고, **스타트업(웹 FE/풀스택 필수) vs 대기업(일반 SW/IT 포괄)** 심사 평가 기준을 자율 판정.
   - 1차~6차 채용 전형 단계를 정밀 분해하고 React/TypeScript 맞춤 AI 3줄 요약 작성.

---

## 2. 전체 멀티 에이전트 워크플로우

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 사용자 / ⏰ 스케줄러(02:00)
    participant AGY as 🧠 Chief Orchestrator (Main Agent)
    participant Scouts as 🤖 서브에이전트군 (원티드, 사람인, 잡코리아)
    participant NotionDB as 🗃️ 노션 채용 DB
    participant Notifier as 📢 디스코드 웹훅

    User->>AGY: "오늘 채용공고 탐색 및 등록 실행" (또는 매일 새벽 02:00 자동 트리거)
    
    rect rgb(240, 248, 255)
        note over AGY,Scouts: 1단계: 듀얼 트랙 탐색 & 고속 중복 제거
        AGY->>Scouts: 플랫폼별 듀얼 트랙(대기업 IT전체 / 중소 웹·FE) 탐색 위임
        Scouts->>NotionDB: 기존 등록 공고 캐시 대조
        Scouts-->>AGY: 오늘 새로 올라온 미수집 공고 목록 반환 (ID, 기업명, 본문 링크)
    end

    rect rgb(255, 250, 240)
        note over AGY,Scouts: 2단계: 본문 수집 & Antigravity 지능형 심사
        loop 각 미수집 공고별 반복
            Scouts->>Scouts: 상세 페이지 진입 (사람인은 view-detail iframe 직통)
            Scouts-->>AGY: 자격요건, 우대사항, 채용절차 원문 전달
            
            note over AGY: [Antigravity 자체 LLM 지능 심사]<br/>1. 스타트업 vs 대기업/우량기업 차등 판정<br/>2. 신입 지원 적합성 (신입/0년/무관 Pass, 2년 이상 Fail)<br/>3. 1차~6차 채용 전형 단계 파싱<br/>4. React/TS 역량 맞춤 3줄 요약 생성
            
            alt 심사 통과 (PASS)
                AGY->>NotionDB: 🏢 아이콘 + 18개 표준 속성 + 블루 콜아웃 등록
            else 심사 탈락 (FAIL)
                note over AGY: 탈락 사유 기록 (예: 스타트업인데 백엔드 전용)
            end
        end
    end

    rect rgb(240, 255, 240)
        note over AGY,Notifier: 3단계: 일일 리포팅
        AGY->>Notifier: 일일 수집/심사 요약 리포트 발송
        AGY-->>User: "총 N건 발굴, M건 심사 통과 노션 등록 완료!" 보고
    end
```

---

## 3. 사이트별 공식 탐색 규격 요약

| 플랫폼 | 트랙 1: 대기업 / 우량기업 | 트랙 2: 중소 / 스타트업 |
| :--- | :--- | :--- |
| **사람인 (Saramin)** | 대기업, 중견, 1000대기업 ➔ **IT개발·데이터 전체** (`cat_mcls=2`) & 신입/무관 | 중소, 스타트업 ➔ **웹개발(`87`), 프론트(`92`), 퍼블리셔(`91`)** & 신입/무관 |
| **잡코리아 (Jobkorea)** | 대기업, 30대그룹, 중견, 1000대, 강소 ➔ **개발 주요 직군 전체** & 신입/무관 | 중소, 벤처, 코스피, 코스닥 ➔ **웹개발, 프론트, 퍼블리셔** & 신입/무관 |
| **원티드 (Wanted)** | 스타트업/성장기업 중심 ➔ **개발 직군 웹 개발자(`873`), 프론트엔드 개발자(`669`)** & 신입/0년차 | - |

---

## 4. 정기 자동 스케줄링 운영

* **실행 시각**: 매일 새벽 02:00 KST (`CronExpression: 0 2 * * *`, Background Daemon)
* **등록 태스크**: `task-364`
* **사용자 명령어**: `/schedule`을 통해 언제든 주기 및 시간 재조정 가능
