# AGENTS.md — activity_bot

> Discord 음성 활동 추적 & 구인구직 봇. 이 파일은 **AI 에이전트가 작업 전 가장 먼저 읽는 진입점**이다.
> 공통 사양: [agents.md](https://agents.md) (Cursor / Claude Code / Codex 공용).
> 기존 `CLAUDE.md`와 역할이 다르다 — `CLAUDE.md`는 환경 차이만 담고, **이 파일은 "작업 전 5분 오리엔테이션"** 이다.

---

## 1. TL;DR

| 항목 | 값 |
|---|---|
| 목적 | Discord 서버의 음성 활동 추적, 구인구직 포럼/음성 연동, 닉네임 관리 |
| Runtime | Node.js (ESM, `"type": "module"`) |
| 프레임워크 | discord.js v14 |
| DI | Awilix `InjectionMode.CLASSIC` + `strict: true` |
| DB | PostgreSQL 17 (`pg` Pool) + `node-pg-migrate` |
| Logger | Errsole (SQLite 백엔드) |
| Process Manager | PM2 |
| Platform | Production = **Android Termux** / Dev = WSL |
| 진입점 | `src/index.js` → `src/bot.js` → `src/container.js` |

---

## 2. Must-Read Before You Code (우선순위 순)

1. **[CODEBASE_MAP.md](./CODEBASE_MAP.md)** — 디렉토리, 라우팅, CustomId, DI 그래프, DB 스키마, 유틸 시그니처.
2. **[docs/11-invariants.md](./docs/11-invariants.md)** — **절대 깨면 안 되는 규칙**. 작업 전 필독.
3. **[docs/13-playbooks.md](./docs/13-playbooks.md)** — 흔한 작업(커맨드/버튼/마이그레이션 추가)의 단계별 체크리스트.
4. **[docs/10-domain.md](./docs/10-domain.md)** — 봇이 *무엇을* 하는지 (도메인 용어 포함).
5. **[docs/12-event-flow.md](./docs/12-event-flow.md)** — Discord 이벤트 → 서비스 → DB 매핑표.
6. **[CLAUDE.md](./CLAUDE.md)** — Termux(prod) vs WSL(dev) 환경 차이.
7. **[docs/adr/](./docs/adr/)** — 과거 아키텍처 결정의 *이유*.

> 구조만 궁금하면 1번, 코드를 *쓰려* 하면 2~3번이 핵심이다.

---

## 3. Project Layout (요약)

```
src/
├── index.js              # 진입점 (process signal handler + IIFE)
├── bot.js                # Bot 싱글톤, Client intent, DI resolve, ready 이벤트
├── container.js          # Awilix DI 컨테이너 (계층적 등록)
├── server.js             # HTTP keep-alive (UptimeRobot)
├── config/               # env, constants, logger
├── commands/             # /슬래시 커맨드
├── services/             # 비즈니스 로직 (single responsibility)
├── repositories/         # DB 쿼리 (DatabaseManager 위임 패턴)
├── ui/                   # Button/Modal/Select 핸들러 + InteractionRouter
├── managers/             # 상태 관리 (VoiceChannelNicknameManager 등)
└── utils/                # 순수 함수 유틸
docs/                     # 이 하네스 문서들
migrations/               # node-pg-migrate SQL 파일
scripts/                  # 배포·DB·문서 자동화 스크립트
```

---

## 4. Commands

| Task | Command |
|---|---|
| install | `npm install` |
| dev 실행 | `npm run dev` (nodemon) |
| prod 실행 (Termux) | `npm run pm2` |
| 로그 | `npm run logs` |
| 슬래시 커맨드 등록 | `npm run register` |
| DB 초기화 | `npm run init-db` |
| 마이그레이션 up | `npm run migrate:up` |
| 마이그레이션 생성 | `npm run migrate:create <name>` |
| DB 백업 | `npm run backup:db` |
| 문서 드리프트 검사 | `node scripts/check-docs-drift.mjs` |

---

## 5. Non-Negotiable Invariants (요약)

> 전체 목록 → [docs/11-invariants.md](./docs/11-invariants.md)

1. **Awilix CLASSIC 모드**: 생성자 파라미터 **이름 = 컨테이너 키**, 순서 중요. 구조분해 금지.
2. **ESM**: 모든 `import` 경로에 `.js` 확장자 필수. CommonJS `require` 금지.
3. **Discord ID**: 항상 `string` (Snowflake). BigInt 변환 시 precision loss 발생.
4. **인터랙션 응답**: `SafeInteraction.safeReply/safeDeferUpdate` 만 사용. 직접 `interaction.reply` 금지.
5. **닉네임**: DB 저장·비교 전 반드시 `TextProcessor.cleanNickname()`.
6. **인터랙션 3초 룰**: 즉시 응답 불가능하면 `deferReply()` 또는 `deferUpdate()` 선행.
7. **Termux는 언제든 kill 가능**: 모든 장기 작업은 **idempotent** (재시작 후 상태 복원 가능).
8. **DB 쓰기**: 다중 테이블 변경은 반드시 트랜잭션 (`BEGIN`/`COMMIT`).
9. **로깅**: `logger.info/warn/error` 에만 의존. `console.log`는 코드 리뷰에서 거부.
10. **코드 수정 시 `CODEBASE_MAP.md` 동기화**. 드리프트 발견 시 즉시 수정 PR.

---

## 6. Out of Scope for Agents (인간 승인 필요)

- `.env`, `.env.example` 수정
- `migrations/` 기존 파일 수정·삭제 (신규 생성은 OK)
- `ecosystem*.config.cjs` 변경
- 외부 배포 경로 (`scripts/start-bot.sh`) 수정
- Discord 봇 intent 추가/제거 (`src/bot.js`의 `GatewayIntentBits`)
- `activity_bot.json` (프로덕션 레거시 데이터) 편집

---

## 7. Common Gotchas

| 증상 | 원인 | 해결 |
|---|---|---|
| `Container registration not found` | CLASSIC 모드 파라미터 이름 오타 | 이름이 컨테이너 키와 정확히 일치하는지 확인 |
| `Cannot use import statement` | `.js` 확장자 누락 또는 `type: module` 누락 | 모든 import에 `.js` 명시 |
| Interaction already acknowledged | `reply` 중복 호출 | `SafeInteraction`로 래핑 |
| 닉네임 `(3)` 붙어서 저장 | `cleanNickname` 누락 | `TextProcessor.cleanNickname()` 선행 |
| Termux 재기동 후 상태 유실 | 메모리 상태만 있음 | DB·파일에 checkpoint 저장 |

---

## 8. Test & Eval (TBD)

현재 단위 테스트 없음. 향후 계획:
- `evals/` 디렉토리 + goldset JSONL
- LLM-as-judge 회귀 테스트
- 커맨드 E2E (mock Discord.js client)

> ADR [0003] 로 결정 예정.

---

## 9. Agent-Specific Tips

- **태스크 브리프가 주어지면** (`docs/tasks/T-XXX.md`) 그 범위 밖 파일은 건드리지 않는다. 전체 계획: `docs/IMPROVEMENT_PLAN.md`.
- **작업 종료 시** 완료 조건의 검증 명령 출력과 `git diff --stat`을 마지막 메시지에 포함한다 (Claude 검토 입력).
- **agy(Antigravity CLI)로 실행될 때**는 `.agents/rules/agy-guardrails.md` 의 하드 제약이 추가 적용되며 `.agents/hooks.json` 훅이 금지 명령·경로를 차단한다.

- **큰 변경 전**: 먼저 `CODEBASE_MAP.md`의 DI 섹션을 다시 읽어 의존성 방향을 확인한다.
- **새 커맨드 추가**: `docs/13-playbooks.md` §A 순서를 그대로 따른다.
- **DB 변경**: `migrations/` 파일 생성 → `init-database.sql` 과의 동기화 확인.
- **커밋 전**: `node scripts/check-docs-drift.mjs` 로 구조 문서 최신성 확인.

---

_마지막 업데이트: 2026-04-24. 이 파일은 코드 레이아웃이 바뀔 때 반드시 함께 수정한다._
