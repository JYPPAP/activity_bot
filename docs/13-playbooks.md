# 13. Playbooks — 반복 작업 체크리스트

> 자주 발생하는 개발 작업의 **단계별 절차**. AI 에이전트는 해당 섹션의 체크박스를 모두 통과해야 PR을 낼 수 있다.

---

## A. 새 슬래시 커맨드 추가

대상 예: `/gap_summary` (월 요약 명령)

- [ ] 1. `src/commands/GapSummaryCommand.js` 생성, `CommandBase` 상속
      - `name`, `description`, `options` static 필드 정의
      - `async execute(interaction)` 구현
      - **Invariant I-06**: 3초 초과 작업이면 `SafeInteraction.safeDeferReply` 선행
- [ ] 2. `src/container.js` 의 **커맨드 등록 섹션**에 추가
      ```js
      gapSummaryCommand: asClass(GapSummaryCommand).singleton(),
      ```
      `CommandHandler` 생성자 파라미터에도 이름으로 주입 (I-01).
- [ ] 3. `src/commands/CommandHandler.js` 의 라우팅 테이블에 추가.
- [ ] 4. `scripts/registerCommands.js` 에 `SlashCommandBuilder` 정의 추가.
- [ ] 5. `npm run register` 로 Discord에 등록 (개발 길드 기준).
- [ ] 6. `docs/10-domain.md` UC 표 갱신.
- [ ] 7. `CODEBASE_MAP.md` 커맨드 목록 추가.
- [ ] 8. `docs/12-event-flow.md` 필요 시 매핑 추가.
- [ ] 9. 수동 테스트: 개발 길드에서 실행 → 로그 확인.

---

## B. 새 버튼 / 모달 / SelectMenu 추가

- [ ] 1. **CustomId prefix** 정의: `src/config/DiscordConstants.js` 의 `CUSTOM_ID_PREFIXES` 에 엔트리 추가.
      - 규칙: `{도메인}_{액션}_` 형태 (예: `voice_reset_`)
      - **Invariant**: prefix는 **고유**하며, 서로의 접두어가 되지 않아야 함.
- [ ] 2. UI 빌더(`RecruitmentUIBuilder` 등)에서 컴포넌트 생성 시 `customId: PREFIX + dynamicPart` 사용.
- [ ] 3. `src/ui/InteractionRouter.js` 의 분기에 추가.
- [ ] 4. 실제 핸들러(`ButtonHandler` / `ModalHandler` / `SelectMenuHandler`)에 구현.
- [ ] 5. `CODEBASE_MAP.md` **CustomId 접두사 표** 갱신.
- [ ] 6. `SafeInteraction` 래퍼 사용 (I-04).

---

## C. 새 DB 테이블 / 컬럼 추가

- [ ] 1. 다음 명령으로 마이그레이션 파일 생성:
      ```bash
      npm run migrate:create -- add_xxx_table
      ```
      → `migrations/YYYYMMDDHHMMSS_add_xxx_table.sql` 생성.
- [ ] 2. 파일에 `-- Up Migration` 섹션 작성. **`Down Migration`도 작성**.
- [ ] 3. 로컬 WSL에서 `npm run migrate:up` 실행, 성공 확인.
- [ ] 4. 대응 Repository 추가 (`src/repositories/XxxRepository.js`) 또는 기존 확장.
- [ ] 5. `DatabaseManager` 파사드에 위임 메서드 추가.
- [ ] 6. `scripts/init-database.sql` 갱신 (신규 환경용 초기 스키마 일관성 유지).
- [ ] 7. `CODEBASE_MAP.md` **DB 테이블 표** 갱신.
- [ ] 8. **Invariant I-13**: 기존 마이그레이션은 절대 수정 금지.
- [ ] 9. 프로덕션 배포 전 `npm run backup:db` 로 백업 선행.

---

## D. 새 서비스 (Service) 추가

- [ ] 1. `src/services/XxxService.js` 작성. **단일 책임** 유지.
- [ ] 2. `src/container.js` 의 적절한 계층에 등록:
      - 순수 로직 → 코어 서비스 계층
      - Discord API 호출 의존 → 도메인 서비스 계층
      - 다수 서비스 조합 → 애플리케이션 서비스 계층
- [ ] 3. 의존성이 있으면 constructor 파라미터 **이름을 정확히 컨테이너 키와 일치** (I-01).
- [ ] 4. 생명주기 메서드 필요 시:
      - `async initialize()` — bot ready 시점에 호출될 수 있게 `bot.js`에 추가
      - `async dispose()` — `container.dispose()` 에 반응 (Awilix disposer)
- [ ] 5. `CODEBASE_MAP.md` 서비스 목록 갱신.

---

## E. 새 이벤트(리스너) 처리

- [ ] 1. 필요한 Intent 확인, 없으면 **ADR 작성 후** `bot.js` 수정 (I-12).
- [ ] 2. `src/services/EventManager.js` 에 핸들러 바인딩 추가.
- [ ] 3. 비즈니스 로직은 서비스로 위임 (이벤트 매니저 자체엔 로직 최소화).
- [ ] 4. `docs/12-event-flow.md` §2 매핑표 행 추가.
- [ ] 5. 재시작 복원 필요하면 `initialize()` 경로 설계 (I-07 idempotent).

---

## F. 환경변수 추가

- [ ] 1. `.env.example` 에 **키 + 주석** 추가.
- [ ] 2. `src/config/env.js` 의 `config` 객체에 추가 (기본값 설정, 타입 변환 명시).
- [ ] 3. 필요 시 `src/container.js` 의 `asValue` 등록.
- [ ] 4. `AGENTS.md` §4 `.env` 섹션 갱신 (해당 섹션이 있다면).
- [ ] 5. **Invariant I-11**: 서비스에서 `process.env` 직접 접근 금지 — 항상 `config` 경유.

---

## G. 외부 API 연동 추가

- [ ] 1. 키는 환경변수로 주입. 코드에 하드코딩 금지.
- [ ] 2. `node_modules/axios` 사용. 전역 인스턴스는 서비스 단위로 분리.
- [ ] 3. **Retry & Timeout** 필수:
      - timeout: 5~10초
      - 지수 백오프 재시도 3회
- [ ] 4. Rate limit 응답(`429`) 발생 시 `Retry-After` 헤더 존중.
- [ ] 5. 실패 시 사용자 에러 메시지는 "외부 서비스 문제" 수준으로 추상화.
- [ ] 6. 새로운 외부 의존성이면 **ADR 작성 필수**.

---

## H. 로그 레벨 점검

- [ ] 1. 신규 `logger.info` 가 초당 10회 이상 발생 가능한 경로라면 `debug`로 낮추기.
- [ ] 2. `logger.error` 는 stack + context 포함 (I-09).
- [ ] 3. Slack 알림이 필요한 경우 `ENABLE_SLACK_ALERTS=true` 환경에서만 트리거.

---

## I. 배포 (Termux 프로덕션)

- [ ] 1. WSL에서 테스트 완료.
- [ ] 2. `CODEBASE_MAP.md`, `docs/*` 변경 커밋.
- [ ] 3. Termux에서:
      ```bash
      cd discord_bot
      git pull
      npm install    # 의존성 변경 시에만
      npm run migrate:up   # 마이그레이션 있을 때만
      pm2 restart discord-bot
      pm2 logs discord-bot --lines 100
      ```
- [ ] 4. ready 로그 확인: `Discord Bot 로그인 성공`, `활동 추적 초기화 완료`, `매핑 서비스 초기화 완료`.
- [ ] 5. 슬래시 커맨드 변경이 있으면 `npm run register`.

---

## J. 롤백

- [ ] 1. `pm2 stop discord-bot`
- [ ] 2. `git revert <commit>` 또는 `git checkout <prev-tag>`
- [ ] 3. 마이그레이션을 되돌려야 하면 `npm run migrate:down` (로컬 먼저 검증).
- [ ] 4. `pm2 start ecosystem-termux.config.cjs --env production`
- [ ] 5. 원인 파악 후 ADR 또는 invariant 업데이트.

---

_모든 playbook은 `AGENTS.md §5 Invariants` 와 교차 검증된다. 위반 여부를 최종 확인하고 PR을 제출할 것._
