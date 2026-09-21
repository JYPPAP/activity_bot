# 0003. 테스트 전략: Vitest + 순수 로직·mock 우선, E2E 미도입

- **상태**: Accepted
- **날짜**: 2026-09-21
- **관련**: `docs/IMPROVEMENT_PLAN.md` Phase 2, `tests/setup.js`, `vitest.config.js`, `AGENTS.md §8`

## 컨텍스트

프로젝트는 2026-09까지 단위 테스트가 0개였고 `npm test`는 로거 스모크였다. Phase 3에서 1,000줄 이상 파일 4개(ButtonHandler, ForumRepository, ForumPostManager, ModalHandler)를 분할하려면 회귀를 잡을 안전망이 먼저 필요하다. 제약:

- 운영 환경이 Android Termux라 CI 인프라·Docker 없음. 로컬 PC(Windows/WSL)에서 빠르게 도는 테스트여야 한다.
- 로거(`logger-termux.js`)가 import 시 Errsole 서버(SQLite+HTTP)를 기동하므로, 테스트 프로세스에서 실제 로거를 로드하면 포트 충돌(`EADDRINUSE`)이 난다.
- Discord API·PostgreSQL은 테스트에서 실제 접속 불가.
- 코드 수정은 Codex/agy가 하고 Claude가 검토하는 체계라, 테스트는 "에이전트가 잘못 고쳤을 때 기계적으로 잡히는" 역할이 핵심.

## 검토한 옵션

### 옵션 1: Vitest, 순수 로직 + mock 기반 단위 테스트
- 장점: ESM 네이티브, 설정 거의 없음, 빠름(<1s). `vi.mock`으로 로거·pg 격리 용이.
- 단점: 통합 경로(Discord 이벤트→서비스→DB)는 커버 못 함.

### 옵션 2: Jest
- 장점: 생태계 크고 익숙함.
- 단점: ESM 지원이 실험적(`--experimental-vm-modules`), `.js` 확장자 import 규칙(I-02)과 마찰.

### 옵션 3: E2E (mock discord.js Client + 실제 PostgreSQL)
- 장점: 실제 흐름 검증.
- 단점: 로컬 PG 필요, 느림, Termux에서 실행 불가. 지금 단계에선 유지 비용이 이득보다 큼.

### 옵션 4: LLM-as-judge 회귀 테스트 (AGENTS.md §8에 언급됐던 안)
- 단점: 비결정적, 토큰 비용, 이 프로젝트의 로직은 대부분 결정적이라 부적합. **채택하지 않음.**

## 결정

**Vitest를 채택하고, 순수 함수 → mock 기반 서비스/리포지토리 순으로 커버리지를 넓힌다. E2E와 LLM-judge는 도입하지 않는다.**

## 근거

- 분할 대상 파일이 의존하는 유틸(TextProcessor, formatters, EmbedFactory, TeamCommand 정적 메서드)은 순수 함수라 mock 없이 즉시 테스트 가능 → 가장 싼 안전망.
- `DatabaseManager.transaction`/`ForumRepository`는 `pool`·`dbManager`를 주입 가능한 구조라 mock으로 SQL 호출 패턴을 고정할 수 있다. I-08(트랜잭션) 회귀는 여기서 잡는다.
- 로거는 `tests/setup.js`에서 전역 `vi.mock` — 어떤 모듈을 import해도 Errsole이 뜨지 않는다.

## 규칙

1. 테스트 파일: `tests/<src와 같은 경로>/<이름>.test.js`. 순수 로직은 `it()`, 외부 의존은 `vi.fn()` 주입. 실제 네트워크·DB·파일 I/O 금지.
2. 테스트가 소스 버그를 드러내면 **테스트에서 소스를 고치지 않는다.** `it.todo('사유')`로 남기고 별도 태스크로 처리한다 (예: `cleanNickname` `(3)` 접미 — T-002에서 발견).
3. 항상 참인 assertion(`toBeDefined()`만 있는 테스트 등) 금지. 문자열 비교는 정확한 값으로, SQL 비교는 `stringContaining` 핵심 토큰으로.
4. `npm test`는 pre-commit 훅에 포함되어 있다(T-003). 실패하면 커밋 불가.
5. 새 서비스/리포지토리 메서드를 추가할 때는 같은 PR에 최소 1개 테스트를 넣는다 (`docs/13-playbooks.md`에 반영 예정).

## 결과

- Phase 2 종료 시점 기준: 테스트 파일 5개, 62 passed / 2 todo (T-021 완료 시 추가).
- AGENTS.md §8 "Test & Eval (TBD)" 항목은 이 ADR을 가리키도록 갱신.
