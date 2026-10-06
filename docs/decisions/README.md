# 🏛️ Architecture Decision Records (ADR)

이 디렉토리는 **채용공고 스크랩 멀티 에이전트 시스템**의 핵심 기술적 의사결정, 아키텍처 선정 이유, 트레이드오프 분석을 기록하는 **아키텍처 의사결정 기록소(ADR Repository)**입니다.

---

## 📋 의사결정 목록 (Decision Log)

| 번호 | 문서 제목 | 결정 일자 | 상태 | 핵심 요약 |
| :--- | :--- | :--- | :--- | :--- |
| **[ADR-001](./001-why-antigravity-as-orchestrator.md)** | **Antigravity(Gemini Flash 기반)를 총괄 오케스트레이터로 선정한 이유** | 2026-09-16 | `Accepted` | Claude 대비 크레딧 소모를 대폭 절감하여 주력 개발용 크레딧을 보존하고, 일일 야간 배치에 적합한 가성비와 IDE 네이티브 도구 연동을 극대화함. |
| **[ADR-002](./002-code-based-harness-and-pipeline-refactoring.md)** | **코드 기반 하네스(Harness) 도입 및 파이프라인 아키텍처 개편** | 2026-10-06 | `Accepted` | LLM의 비결정론적 판단으로 인해 지침 생략, 중복 필터링 실패, 앵커 스킵 오작동 등 '동작 신뢰성 붕괴'가 발생하던 한계를 극복하기 위해, 상태 판단·구간점프·중복제거를 전용 Node.js 도구(Harness)로 전면 이관하여 실행 결정론 100%와 무인 신뢰성을 확보함. |
