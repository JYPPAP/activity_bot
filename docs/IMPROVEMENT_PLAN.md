# 프로젝트 개선 계획 (Claude 계획 → Codex 구현 → Claude 검토)

> 작성: 2026-09-21. 이 문서는 **작업 큐**다. 각 태스크는 Codex가 단독으로 수행할 수 있도록 자기완결적으로 쓴다.
> 상태: `todo` / `doing` / `review` / `done`. 완료 시 상태만 바꾸고 본문은 남긴다(이력).
> 운영 방식 → [CLAUDE.md](../CLAUDE.md) "에이전트 협업 워크플로우" 참조.

## 현재 진단 (2026-09-21 측정)

| 항목 | 값 | 판단 |
|---|---|---|
| src 총 라인 | 19,190 / 60 파일 | — |
| `console.*` 호출 | 480건 (logger-termux.js 내부 67건 제외 시 ~413) | **I-09 위반** |
| `interaction.reply/update/defer*` 직접 호출 | 22건 | **I-04 위반** |
| 1,000줄 초과 파일 | ButtonHandler 1312, ForumRepository 1167, ForumPostManager 1104, ModalHandler 1072 | 분할 필요 |
| 단위 테스트 | 0 (`npm test`는 로거 스모크) | 없음 |
| ESLint / Prettier | 없음 | 없음 |
| pre-commit 훅 | husky 디렉토리만 존재, 훅 없음 | 없음 |
| CODEBASE_MAP 드리프트 | 1건 (`services/InactivePostChecker.js` 미기재) | 즉시 수정 |
| 레거시 | `FileManager.js`(JSON), `scripts/*.sql` 6개(migrations와 중복), `run_migration.js` | 정리 대상 |

## 원칙

1. **가드레일 먼저** (Phase 0). 린트·훅이 있어야 이후 Phase의 회귀를 기계가 잡는다 → Claude 검토 토큰 절감.
2. **한 태스크 = 한 PR/커밋 = 한 Codex 세션**. 300줄 이상 diff는 쪼갠다.
3. **동작 변경 없는 리팩터링과 기능 변경을 섞지 않는다.**
4. 모든 태스크의 완료 조건에 `npm run lint && npm test && npm run docs:check:strict` 통과 포함(Phase 0 이후).

---

## Phase 0 — 가드레일 (기계가 잡을 수 있는 것은 기계에게)

### T-001 `done` ESLint flat config 도입
- **범위**: `eslint.config.js` 신규, `package.json` devDeps + `lint` 스크립트.
- **규칙**: `no-console: error` (예외: `src/config/logger-termux.js`, `scripts/**`), `no-unused-vars: warn`, `import/extensions` 대체로 `.js` 확장자 누락 검출(정규식 커스텀 룰 또는 `eslint-plugin-import`의 `extensions: always`).
- **주의**: 초기엔 `no-console`을 `warn`으로 두고 T-010 완료 후 `error`로 승격. 기존 코드 스타일 변경 금지(Prettier 도입 안 함).
- **완료 조건**: `npm run lint` 실행 가능, 신규 에러 0 (warn 허용).

### T-002 `done` Vitest 도입 + 첫 테스트
- **범위**: `vitest` devDep, `npm test` → `vitest run`, `tests/` 디렉토리.
- **첫 테스트 대상** (순수 함수, 외부 의존 없음): `src/utils/TextProcessor.js`의 `cleanNickname`, `src/utils/inputValidator.js`.
- **완료 조건**: 테스트 10개 이상, 모두 통과. 기존 `npm test` 로거 스모크는 `test:logger`로 이름 변경.

### T-003 `done` husky pre-commit 훅
- **범위**: `.husky/pre-commit` = `npm run lint && npm run docs:check:strict`, `prepare` 스크립트.
- **주의**: Termux에서 `git pull`만 하는 prod 환경엔 영향 없어야 함(`prepare` 실패 시 무시: `husky || true`).

### T-004 `done` CODEBASE_MAP 드리프트 수정
- `services/InactivePostChecker.js` 항목 추가 (역할: 15일 비활동 구직글 경고, 커밋 00d1f53 참고). 한 줄 작업.


### T-005 `done` Slack 알림 기능 완전 제거 (사용자 요청 2026-09-21)
- `sendSlackAlert` 및 관련 env/스크립트/axios 의존성 제거. 브리프: `docs/tasks/T-005.md`.
---

## Phase 1 — 불변식 위반 청소 (동작 변경 없음)

### T-010 `done` `console.*` → `logger` 치환 (파일 단위로 분할)
- 순서(건수 많은 순): ForumPostManager(87) → MappingService(64) → ActivityTracker(57) → ButtonHandler(55) → EmojiReactionService(50) → ModalHandler(39) → RecruitmentService(35) → 나머지.
- **매핑**: `console.log`→`logger.info`, `console.warn`→`logger.warn`, `console.error`→`logger.error`. 두 번째 인자로 객체를 넘기는 Errsole 스타일 유지.
- **주입**: 각 클래스에 `logger`가 이미 주입되어 있으면 사용, 없으면 `import { logger } from '../config/logger-termux.js'` (DI 생성자 시그니처 변경 금지 — I-01).
- **한 Codex 세션당 1~2파일**. 완료 후 `npm run lint`에서 no-console 카운트 감소 확인.
- T-010 전부 끝나면 `no-console`을 `error`로 승격.

### T-011 `done` 직접 `interaction.reply/update/defer*` 22건 → SafeInteraction
- `grep -rnE "interaction\.(reply|deferReply|update|deferUpdate)\(" src | grep -v SafeInteraction`로 목록화.
- 각 호출을 `SafeInteraction.safeReply / safeDeferUpdate / safeUpdate`로 교체. 반환값·에러 처리 의미 유지.
- 완료 조건: 위 grep 결과 0.

---

## Phase 2 — 테스트 안전망 (리팩터링 전에)

### T-020 `done` 순수 로직 테스트 확장
- `embedBuilder.js`, 팀짜기 페어 최소화 알고리즘(TeamCommand 관련 유틸), `RecruitmentUIBuilder` 출력 스냅샷.
- 목표: Phase 3 분할 대상 파일이 의존하는 유틸 커버.

### T-021 `done` Repository 계층 테스트
- `pg` Pool을 mock(`vi.fn`)하거나 `pg-mem` 사용. `ForumRepository`의 트랜잭션 경로(BEGIN/COMMIT/ROLLBACK) 검증 — I-08.

### T-022 `done` ADR-0003 테스트 전략 기록
- `docs/adr/0003-test-strategy.md`: Vitest 채택, 커버 범위, E2E 미도입 사유.


### T-023 `todo` ForumRepository 다중 쓰기 트랜잭션화 (I-08)
- 발견(2026-09-21): 트랜잭션은 `ActivityRepository`만 사용. `ForumRepository.createPostIntegration`(SELECT→UPDATE→INSERT), `linkVoiceChannel`, `setStandaloneMode`, `ensureForumMapping` 등 다중 쓰기가 `dbManager.query` 개별 호출로 실행됨 → 중간 실패 시 부분 반영.
- 대상 메서드를 `dbManager.transaction(async client => ...)`로 감싼다. T-021 테스트를 먼저 갖춘 뒤 T-033(분할)과 함께 또는 직전에 수행.
---

## Phase 3 — 거대 파일 분할 (동작 변경 없음)

> 각 태스크는 **파일 이동 + 재export**로만 구성. 로직 수정 금지. CustomId 맵·DI 키 불변.

### T-030 `done` ButtonHandler(1312) 도메인별 분할
- `ui/buttons/RecruitmentButtons.js`(참가/취소/관전/대기), `ui/buttons/MemberEditButtons.js`, `ui/buttons/PostControlButtons.js`(닫기/멘션).
- `ButtonHandler.js`는 라우팅만 남김(<200줄). `CUSTOM_ID_PREFIXES` 매핑 표를 CODEBASE_MAP과 동기화.

### T-031 `done` ModalHandler(1072) 분할 — T-030과 같은 방식.

### T-032 `todo` ForumPostManager(1104) 분할
- 포스트 CRUD / 버튼·임베드 빌드 / 참가자 관리 세 책임으로. DI 키 `forumPostManager`는 Facade로 유지.

### T-033 `todo` ForumRepository(1167) 분할
- `PostIntegrationRepository`, `ForumParticipantRepository`로. `DatabaseManager` Facade가 위임하므로 외부 시그니처 불변.

### T-034 `todo` SafeInteraction(911) 점검
- 사용되지 않는 헬퍼 제거, 중복 래퍼 통합. 사용처 grep으로 근거 남길 것.

---

## Phase 4 — 레거시 제거

### T-040 `todo` `scripts/*.sql` 6개 → migrations와 대조 후 삭제
- 각 SQL이 `migrations/2025010100000N_*.sql`에 포함됨을 확인(diff 첨부). `run_migration.js`도 함께. `DATABASE_SETUP.md` 링크 갱신.

### T-041 `todo` `FileManager.js` / `activity_bot.json` 의존 제거
- 사용처 grep → ADR-0002(PG 단일화) 기준으로 남은 읽기 경로 제거. **`activity_bot.json` 파일 자체는 삭제 금지**(AGENTS.md §6).

---

## Phase 5 — 운영 안정성 (Termux)

### T-050 `todo` 재시작 복원 점검
- `ActivityTracker` 세션 복구, `InactivePostChecker` 마지막 실행 시각 체크포인트, 팀짜기 페어 이력 TTL의 메모리 의존 → DB 저장 여부 결정(I-07).

### T-051 `todo` 전역 에러 핸들링 감사
- `unhandledRejection`/`uncaughtException` 핸들러, Discord `error`/`shardError` 이벤트, PG Pool `error` 이벤트 존재 여부 확인 및 보강.

### T-052 `todo` 보안 취약점 잔여 13건 처리
- `npm audit` → 직접 의존성 업그레이드 가능 항목과 `overrides` 필요 항목 분리. discord.js/pg 메이저 업그레이드는 별도 태스크.

---

## Phase 6 — 문서·자동화

### T-060 `todo` `check-docs-drift.mjs` 확장
- CustomId prefix(`DiscordConstants.js`) ↔ CODEBASE_MAP CustomId 맵 대조, DI 키(`container.js`) ↔ DI 섹션 대조.

### T-061 `todo` `docs/` 구버전 문서 정리
- `ARCHITECTURE.md`, `SERVICES.md`, `COMMANDS.md`, `PostgreSQL_Migration_*` 등이 10~13번 문서와 중복. 중복분은 삭제하고 10~13에 흡수.

---

## 실행 순서 요약

```
Phase 0 (T-001~004) → Phase 1 (T-010, T-011) → Phase 2 (T-020~022)
→ Phase 3 (T-030~034) → Phase 4 → Phase 5 → Phase 6
```
Phase 4~6은 순서 무관, Phase 3 이후 병렬 가능.
