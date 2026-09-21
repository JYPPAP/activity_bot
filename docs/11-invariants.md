# 11. Invariants — 절대 깨면 안 되는 규칙

> 이 문서는 **코드 리뷰에서 즉시 리젝 사유가 되는 규칙**을 모은다.
> 새 규칙을 추가할 때는 PR 설명에 위반 시 발생하는 구체적 장애를 한 줄 기재한다.

---

## I-01. Awilix CLASSIC 모드 준수

**규칙**: `src/container.js`가 `InjectionMode.CLASSIC` + `strict: true`로 설정되어 있다.
따라서 생성자 파라미터는 **이름이 컨테이너 키와 정확히 일치**해야 하며, **위치(positional) 기반**으로 주입된다.

| 허용 | 금지 |
|---|---|
| `constructor(client, dbManager, logService)` | `constructor({ client, dbManager })` (구조분해) |
| 파라미터 이름과 `container.register({ 키: ... })` 키 일치 | 파라미터 이름만 바꾸고 container 키는 그대로 |

**위반 시 발생**: `AwilixResolutionError: Could not resolve 'xxx'` 또는 런타임에 `undefined` 주입 → Null reference.

**근거**: https://github.com/jeffijoe/awilix#injection-modes

---

## I-02. ESM 확장자 명시

**규칙**: `package.json`에 `"type": "module"`로 설정되어 있으므로, **모든 내부 import에 `.js` 확장자 필수**.

```js
// OK
import { Bot } from './bot.js';
// NG — Node ESM 해석 실패
import { Bot } from './bot';
```

**예외**: `node_modules` 패키지는 `exports` 필드를 따르므로 확장자 불필요.

---

## I-03. Discord Snowflake ID는 문자열

**규칙**: 모든 Discord ID (userId, guildId, channelId, threadId, messageId)는 **`string`으로만 취급**.

**이유**: Snowflake는 64-bit 정수인데 JavaScript `Number`의 안전 정수는 2^53-1. 변환 시 precision loss 발생.

```js
// OK
const userId = interaction.user.id; // string
// NG
const userId = Number(interaction.user.id); // precision loss 위험
```

DB 컬럼 역시 `VARCHAR`로 유지 (→ `CODEBASE_MAP.md` 참조).

---

## I-04. 모든 인터랙션 응답은 SafeInteraction 경유

**규칙**: `interaction.reply()`, `interaction.update()`, `interaction.deferReply()`, `interaction.deferUpdate()`의 **직접 호출 금지**. 반드시 `src/utils/SafeInteraction.js`를 사용한다.

```js
// OK
await SafeInteraction.safeReply(interaction, { content: '완료', ephemeral: true });
// NG
await interaction.reply({ content: '완료' });
```

**이유**:
1. Discord의 3초 룰 위반 시 `InteractionAlreadyReplied` 예외가 나면 래퍼에서 집어삼켜 로깅.
2. 중복 응답(이미 ack된 인터랙션) 방어.
3. 네트워크 실패 시 일관된 fallback.

---

## I-05. 닉네임 저장 전 cleanNickname

**규칙**: 닉네임을 DB에 저장하거나 비교할 때 반드시 `TextProcessor.cleanNickname()`을 먼저 호출한다.

```js
// OK
const clean = TextProcessor.cleanNickname(member.displayName);
await repo.addParticipant(threadId, userId, clean);
// NG
await repo.addParticipant(threadId, userId, member.displayName); // "[관전] 이름" 그대로 저장
```

**이유**: `[관전]`, `[대기]`, `(2)` 등 장식 접두사가 붙으면 중복 참가자가 발생한다.

---

## I-06. 인터랙션 3초 룰 (defer 원칙)

**규칙**: 인터랙션 핸들러는 **3초 안에 응답**해야 한다. DB 쿼리·외부 API 호출이 포함되면 **즉시 defer**.

```js
await SafeInteraction.safeDeferReply(interaction, { ephemeral: true });
const result = await heavyTask();
await SafeInteraction.safeEditReply(interaction, { content: result });
```

**근거**: Discord API `InteractionCallbackType` 3 (DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE), https://discord.com/developers/docs/interactions/receiving-and-responding

---

## I-07. 장기 작업은 Idempotent

**규칙**: Termux는 OOM/배터리 절약 등으로 **언제든 SIGKILL** 당할 수 있다. 따라서:

- 여러 단계로 구성된 작업은 단계마다 DB에 checkpoint를 남긴다.
- 재기동 시 `ActivityTracker.initializeActivityData()`, `emojiReactionService.initialize()` 등이 **완전한 상태 복원**을 담당해야 한다.
- **금지**: 메모리 only Map/Set에만 상태를 저장.

---

## I-08. 다중 테이블 쓰기는 트랜잭션

**규칙**: 두 개 이상의 테이블·행에 쓰기가 발생하면 `pg` Pool의 트랜잭션을 사용한다.

```js
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(sqlA, paramsA);
  await client.query(sqlB, paramsB);
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
}
```

---

## I-09. 로깅 채널 통일

**규칙**: `logger.info/warn/error` (Errsole) 만 사용한다. `console.log` 금지.

- 로그 수준 가이드:
  - `info` — 정상 흐름의 중요 이벤트 (봇 기동, 세션 시작)
  - `warn` — 예상된 복구 가능 이상 (중복 참가 시도)
  - `error` — 복구 불가 혹은 재시도 필요
- 에러 시 **stack과 context**를 함께 넘긴다: `logger.error(msg, { error: e.message, stack: e.stack, ...ctx })`.

---

## I-10. CODEBASE_MAP 동기화

**규칙**: 아래 구조적 변경이 있으면 **같은 PR에서** `CODEBASE_MAP.md`를 갱신한다.

- 파일 추가/삭제/이름 변경
- DI 컨테이너 키 추가·제거
- 새 CustomId prefix 추가
- DB 테이블·컬럼 변경

PR 전 `node scripts/check-docs-drift.mjs` 실행. exit code 0이어야 머지 가능.

---

## I-11. 환경 변수는 `config` 객체 경유

**규칙**: `process.env.X`를 서비스 코드에서 직접 읽지 않는다. 반드시 `src/config/env.js`의 `config` 객체를 import.

**이유**: 테스트 시 mock 용이, 기본값 일관성, 타입 검증 지점 일원화.

---

## I-12. Discord Intent 추가는 ADR 필요

**규칙**: `src/bot.js`의 `GatewayIntentBits`에 항목 추가는 **ADR 작성 + 인간 승인** 필요.

**이유**: Intent 추가 시 Discord 측에 **Privileged Intent 신청** 필요할 수 있고, 100 guild 이상에서는 verification 영향.

---

## I-13. Migration 파일은 불변

**규칙**: 이미 커밋된 `migrations/*.sql`은 **절대 수정하지 않는다**. 잘못되었으면 새 마이그레이션으로 롤포워드.

**이유**: `node-pg-migrate`는 파일명 기반 실행 기록. 기존 파일 수정 시 환경 간 DB 상태 drift.

---

## I-14. `activity_bot.json`은 레거시 읽기 전용

**규칙**: 이 파일은 PostgreSQL 마이그레이션 이전의 JSON 스냅샷. **쓰기 금지**.
데이터 마이그레이션 로직(`Bot.migrateDataIfNeeded`)만 접근한다.

---

## 위반 시 절차

1. 위반 코드 발견 시 즉시 PR에 `blocker` 라벨.
2. 작성자가 수정하거나, 예외가 필요하면 `docs/adr/` 에 ADR 신규 작성.
3. ADR 승인 시에만 이 문서에 "예외 조항"으로 추가.

---

_이 문서의 목적은 "재발 방지"다. 새 invariant를 추가할 때는 과거 장애에 대한 근거를 함께 남길 것._
