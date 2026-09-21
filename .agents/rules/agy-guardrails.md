# agy 실행 규칙 (activity_bot)

> 이 파일은 Antigravity CLI(`agy`)가 이 저장소에서 헤드리스로 실행될 때 적용되는 **하드 제약**이다.
> `.agents/hooks.json`의 PreToolUse 훅이 아래 금지 명령을 기계적으로 차단하며, 이 문서는 그 의도를 설명한다.
> 공통 오리엔테이션(불변식·플레이북)은 `AGENTS.md`를 따른다.

## 1. 역할
- agy는 **브리프(`docs/tasks/T-XXX.md`)에 명시된 작업만** 수행하는 실행기다. 계획·검토는 Claude가 한다.
- 프롬프트에 브리프 경로가 없으면 **읽기 전용 질문 응답**만 한다 (파일 수정 금지).

## 2. 파일 범위
- 수정 허용: 브리프의 "범위 > 수정" 목록에 있는 파일만.
- 브리프에 없는 파일이 수정이 필요해 보이면 **수정하지 말고** 마지막 메시지에 파일:줄과 이유를 보고한다.
- 항상 금지 (훅이 차단): `.env*`, `migrations/**` 기존 파일, `ecosystem*.cjs`, `scripts/start-bot.sh`, `activity_bot.json`, `.git/**`, `node_modules/**`, `.claude/**`, `.agents/**`, `CLAUDE.md`, `~/.gemini/**`.

## 3. 명령 범위
- 허용: `npm run lint`, `npm run lint:fix`, `npm test`, `npm run docs:check*`, `npx eslint`, `npx vitest`, `node <script>`, `git status/diff/log/ls-files/grep`, `rg`, `grep`, `ls`, `cat`, `head`, `tail`, `sed -n`(읽기).
- 금지 (훅이 차단): `git commit/push/reset/checkout/restore/clean/stash/rebase/merge/tag`, `npm install/uninstall/update/publish/ci`, `rm -rf`/`Remove-Item -Recurse`/`del /s`, `curl`/`wget`/`Invoke-WebRequest`/`Invoke-RestMethod`, `pm2`, `psql`, `node-pg-migrate`, `.git` 경로 직접 조작.
- 의존성이 필요하면 설치하지 말고 보고한다 (Claude가 설치 후 재실행).

## 4. 종료 조건
- 브리프의 "완료 조건" 검증 명령을 실행하고, 마지막 메시지에 **검증 출력 + `git diff --stat`** 을 포함한다.
- 검증이 실패하면 소스를 더 고치지 말고 실패 출력을 그대로 보고한다.
- 커밋하지 않는다. 커밋은 Claude 검토 후 사람이 한다.

## 5. 금지 행동
- 린트/테스트 에러를 설정(globals, eslint-disable, it.skip)으로 숨기지 않는다. 실제 원인을 고치거나 보고한다.
- 로그 라인·에러 처리·제어 흐름을 브리프에 없는 이유로 바꾸지 않는다.
- 브리프 범위를 넘는 "개선"을 하지 않는다.
