# 룰: 채용공고 멀티 에이전트 오케스트레이션 프로토콜

이 룰은 Antigravity가 본 워크스페이스에서 채용공고 수집 및 등록 작업을 수행할 때 적용되는 행동 강령입니다.
상세한 에이전트 역할, 실행 단계, 다이어그램은 **[AGENTS.md](../../AGENTS.md)**를 참조하며, 충돌 시 다음 문서들이 최우선합니다:

> 📚 **규격 및 기준의 단일 원천**
> * 심사 기준·트랙 정의·플랫폼별 필터 값: [job-criteria.md](job-criteria.md)
> * 데이터·CLI 규격(jobKey, 스키마, 파일 배치, 실행 순서): [docs/pipeline-spec.md](../../docs/pipeline-spec.md)
> * 에이전트 실행 프로토콜 및 가드레일: [AGENTS.md](../../AGENTS.md)

---

## 1. 3대 절대 가드레일 (Strict Guardrails)
1. **운영자 모드 준수**: 시스템 아키텍처와 `tools/` 코드는 완비되어 있습니다. 임의로 코드를 수정하거나 기능을 덧붙이지 마십시오. 도구 오류 발생 시 수정하지 말고 `--error` 알림을 발송한 뒤 보고하십시오.
2. **🚫 임의의 호스트 크롤러 스크립트 작성 절대 금지**: `scratch/`나 루트에 `.js` 크롤러를 작성해 실행하지 마십시오. 탐색은 100% Antigravity 내장 브라우저 도구를 사용합니다. (각 스킬의 `snippet.js`를 브라우저 evaluate로 실행하는 것만 허용됩니다.)
3. **🚫 MCP 및 전역 설정 변경 금지**: `mcp_config.json`을 수정하지 마십시오.

---

## 2. 2가지 운영 모드 요약

### [모드 A] 플랫폼 전체 자동 탐색 모드 (Batch Scout)
오케스트레이터가 아래 8단계 순서로 총괄 진행합니다:
`runLock acquire` ➔ `notionJobFetcher` ➔ 플랫폼별 수집 서브에이전트 병렬 위임(`scout-*`) ➔ 심사 큐 모니터링 및 배치별 심사 서브에이전트 투입(`job-reviewer`) ➔ `publishRun` ➔ `checkpointManager commit` ➔ `discordNotifier --report` ➔ `runLock release`

### [모드 B] 단일 공고 URL 직통 등록 모드 (On-Demand Single Import)
사용자가 채팅창에 특정 채용공고 URL을 전달했을 때:
`job-url-importer` 스킬이 즉시 작동하여 본문 열람 ➔ 18개 속성 추출 ➔ **심사(합격/탈락 판정) 없이 항상 pass**로 submit ➔ `publishRun` ➔ `discordNotifier --single` ➔ 사용자 브리핑 (체크포인트는 갱신하지 않음).

---

## 3. 장애 알림 프로토콜
실행 도중 오류가 발생하면 즉시 디스코드 장애 알림을 호출합니다:
```bash
node tools/discordNotifier.js --error "<stage>" "<에러원인>" "<상세내용>"
```
*(표준 스테이지 목록 및 종료 코드 대응은 [AGENTS.md](../../AGENTS.md) 참조)*
