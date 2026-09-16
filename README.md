# 🤖 Nightly Job-Scraping Multi-Agent System
> 매일 밤 자는 동안 채용공고를 자율 탐색·수집하여 노션 데이터베이스에 규격화된 페이지로 발행하는 3-Tier 멀티 에이전트 시스템

---

## 📌 시스템 개요
본 시스템은 사람인, 원티드, 점핏 등 다양한 채용 플랫폼의 웹 개발 직무 공고를 사람처럼 탐색·수집하고, 멀티모달 비전 OCR과 LLM 기반 직무 분석을 거쳐 **노션 데이터베이스에 규격화된 템플릿으로 자동 등록**하는 완전 자율 야간 배치 에이전트입니다.

* **봇 차단 회피**: 실제 크롬 프로필(Persistent Context) 및 CDP 원격 디버깅 연동
* **지능형 공고 분석**: 통이미지 공고의 Vision OCR 판독 & 대규모 공채 내 웹 개발 부문 정밀 발췌
* **비용/속도 최적화**: 3-Tier 계층형 에이전트 분업과 Worker Pool 동시성 제어
* **노션 연동**: 표준화된 프로퍼티 스키마 및 가독성 높은 상세 템플릿 자동 생성

---

## 📚 상세 설계 문서 모음 (Architecture Suite)

설계는 영역별로 체계적으로 분리되어 관리됩니다. 아래 링크를 통해 상세 내용을 확인하실 수 있습니다:

1. [01. 시스템 개요 및 배경 (01-overview.md)](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/docs/01-overview.md)
   - 프로젝트 목적, 기존 크롤러 방식 대비 AI 에이전트 도입의 가치 및 해결 과제
2. [02. 시스템 아키텍처 및 데이터 흐름 (02-system-architecture.md)](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/docs/02-system-architecture.md)
   - 3-Tier 계층 구조도, 데이터 수명 주기, 기술 스택 정의
3. [03. 에이전트 계층별 상세 명세 (03-agent-specifications.md)](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/docs/03-agent-specifications.md)
   - Tier 1(오케스트레이터), Tier 2(스카우트), Tier 3(워커)의 입출력 데이터 모델 및 프롬프트 규격
4. [04. 브라우징 및 MCP 연동 전략 (04-browsing-and-mcp-strategy.md)](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/docs/04-browsing-and-mcp-strategy.md)
   - Playwright MCP 조작법, CDP vs Persistent 모드, 통이미지 OCR, 외부 채용 링크 추적 Fallback
5. [05. 노션 스키마 및 동기화 설계 (05-notion-schema-and-sync.md)](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/docs/05-notion-schema-and-sync.md)
   - 노션 데이터베이스 필드(속성), 본문 레이아웃 템플릿, URL 정규화 기반 중복 방지 알고리즘
6. [06. 하네스 엔지니어링 및 가드레일 (06-harness-engineering.md)](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/docs/06-harness-engineering.md)
   - 동시성 제어(Worker Pool), 타임아웃, 서킷 브레이커, 메모리 누수 방지, 토큰 비용 절감책
7. [07. 구현 로드맵 및 운영 런북 (07-roadmap-and-runbook.md)](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/docs/07-roadmap-and-runbook.md)
   - 마일스톤, 디렉토리 구조, 환경 변수 가이드, 야간 무인 스케줄러 등록법

---

## 🚀 빠른 시작 (Next Steps)
설계 검토가 완료되면 [07. 구현 로드맵](file:///c:/Users/yeonn/Documents/Yeon/Project/채용공고%20스크랩/docs/07-roadmap-and-runbook.md)의 **1단계(노션 연동 및 첫 번째 플랫폼 스카우트 프로토타입)**부터 즉시 코드 구현에 착수할 수 있습니다.
