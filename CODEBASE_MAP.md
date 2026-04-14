# Activity Bot - Codebase Map
> 이 파일은 AI 어시스턴트가 코드 구조를 빠르게 파악하기 위한 참조 파일입니다.
> 수정 시 반드시 이 파일도 함께 업데이트할 것.
> 마지막 업데이트: 2026-04-14

## 기술 스택
- Runtime: Node.js (ESM)
- Framework: discord.js v14
- DI: Awilix (InjectionMode.CLASSIC — 위치 기반 인자)
- DB: PostgreSQL (pg Pool)
- Process Manager: PM2
- Platform: Production=Android Termux / Dev=WSL

---

## 디렉토리 구조

```
src/
├── index.js              # 진입점 → container 생성 → Bot.start()
├── bot.js                # Bot 클래스: client 초기화, 이벤트 등록
├── container.js          # Awilix DI 컨테이너 (CLASSIC 모드)
├── server.js             # HTTP keep-alive 서버 (UptimeRobot용)
│
├── config/               # 설정 & 상수
│   ├── env.js            # process.env → config 객체 (TEAM_CHANNEL_IDS 등)
│   ├── DiscordConstants.js    # CUSTOM_ID_PREFIXES, EMOJIS
│   ├── NicknameConstants.js   # 닉네임 시스템 상수
│   ├── RecruitmentConfig.js   # 구인구직 설정 (MAX_TAGS 등)
│   ├── commandPermissions.js  # 역할 기반 명령어 권한
│   ├── constants.js           # PATHS, TIME, COLORS
│   └── logger-termux.js       # Errsole 로거 (SQLite)
│
├── commands/             # 슬래시 커맨드 핸들러
│   ├── CommandBase.js         # 기본 클래스 (hasPermission 등)
│   ├── CommandHandler.js      # 명령어 라우터 (interactionCreate)
│   ├── RecruitmentCommand.js  # /구직
│   ├── TeamCommand.js         # /팀짜기
│   ├── TimeCheckCommand.js    # /시간체크 (관리자)
│   ├── TimeConfirmCommand.js  # /시간확인 (개인)
│   ├── GapReportCommand.js    # /gap_report
│   ├── NicknameCommand.js     # /닉네임
│   ├── NicknameManagementCommand.js  # /닉관리 (관리자)
│   └── NicknameSetupCommand.js       # /닉설정
│
├── services/             # 비즈니스 로직
│   ├── DatabaseManager.js     # Facade: 4개 Repository 위임 (Singleton)
│   ├── ActivityTracker.js     # 음성채널 활동 추적, 세션 복구
│   ├── ActivityReportService.js  # 활동 리포트 생성
│   ├── ForumPostManager.js    # 포럼 포스트 CRUD, 버튼, 참가자 관리
│   ├── RecruitmentService.js  # 구인구직 흐름 총괄
│   ├── VoiceChannelManager.js # 음성 채널 생성/삭제
│   ├── VoiceChannelForumIntegrationService.js  # 음성↔포럼 연동
│   ├── EmojiReactionService.js   # 이모지 반응 기반 참가 관리
│   ├── MappingService.js      # 음성↔포럼 매핑
│   ├── ParticipantTracker.js  # 참가자 추적
│   ├── LogService.js          # 로그 채널 전송
│   ├── EventManager.js        # Discord 이벤트 바인딩
│   ├── FileManager.js         # JSON 파일 I/O (레거시)
│   ├── PermissionService.js   # 권한 체크
│   ├── UserClassificationService.js  # 유저 활동 분류
│   ├── UserNicknameService.js # 닉네임 DB CRUD
│   └── PlatformTemplateService.js    # 닉네임 플랫폼 템플릿
│
├── repositories/         # DB 쿼리 레이어 (DatabaseManager가 위임)
│   ├── ActivityRepository.js  # monthly activity 테이블
│   ├── AfkRepository.js       # AFK 상태 관리
│   ├── ConfigRepository.js    # guild_settings, role_configs
│   ├── ForumRepository.js     # post_integrations, forum_participants
│   └── index.js               # export all
│
├── managers/
│   └── VoiceChannelNicknameManager.js  # 음성채널 닉네임 표시
│
├── ui/                   # 인터랙션 핸들러
│   ├── InteractionRouter.js   # 최상위 인터랙션 라우터
│   ├── ButtonHandler.js       # 버튼 인터랙션 (참가/취소/관전/대기/멤버수정)
│   ├── ModalHandler.js        # 모달 인터랙션 (구직 작성/멤버수정)
│   ├── RecruitmentUIBuilder.js # 구직 UI 빌더 (Embed, Select)
│   ├── NicknameButtonHandler.js
│   ├── NicknameSelectMenuHandler.js
│   └── NicknameModalHandler.js
│
└── utils/                # 유틸리티
    ├── SafeInteraction.js     # 안전한 인터랙션 응답 (에러 래핑)
    ├── TextProcessor.js       # cleanNickname, 텍스트 정화
    ├── formatters.js          # formatParticipantList, formatParticipantChangeMessage
    ├── inputValidator.js      # validateAndSanitizeInput, VALIDATION_PRESETS
    ├── EmojiParser.js         # 이모지 파싱
    ├── TimeActivityHelper.js  # 시간/활동 헬퍼
    ├── dateUtils.js           # 날짜 유틸
    └── embedBuilder.js        # EmbedBuilder 헬퍼
```

---

## 인터랙션 라우팅 흐름

```
Discord Event: interactionCreate
        ↓
CommandHandler (slash commands: /구직, /팀짜기, /시간체크 ...)
        ↓
InteractionRouter.routeInteraction()
  ├─ Button → routeButtonInteraction()
  │   ├─ NicknameButton prefix → NicknameButtonHandler
  │   ├─ VOICE_CONNECT prefix → RecruitmentService
  │   └─ else → ButtonHandler.routeButtonInteraction()
  │       ├─ isRoleTagButton → handleRoleTagButtons()
  │       ├─ isVoiceChannelButton → handleVoiceChannelButtons()
  │       │   ├─ FORUM_JOIN → handleJoinButton()
  │       │   ├─ FORUM_LEAVE → handleLeaveButton()
  │       │   ├─ FORUM_EDIT_PREMEMBERS → handleEditPreMembersButton()
  │       │   ├─ VOICE_SPECTATE → handleSpectateButton()
  │       │   ├─ VOICE_WAIT → handleWaitButton()
  │       │   ├─ VOICE_RESET → handleResetButton()
  │       │   └─ VOICE_DELETE → handleDeleteButton()
  │       └─ isRecruitmentOptionsButton → handleRecruitmentOptionsButton()
  │
  ├─ ModalSubmit → routeModalSubmit()
  │   ├─ NicknameModal prefix → NicknameModalHandler
  │   └─ else → ModalHandler.handleModalSubmit()
  │       ├─ PREMEMBERS_EDIT_MODAL → handleEditPreMembersModalSubmit()
  │       ├─ scrimmage_recruitment_modal → 내전 처리
  │       ├─ long_term_recruitment_modal → 장기 처리
  │       └─ default → extractModalData() → 독립/연동 구직 처리
  │
  └─ StringSelect → routeSelectMenuInteraction()
      ├─ NicknameSelect → NicknameSelectMenuHandler
      ├─ RECRUITMENT_METHOD → RecruitmentService
      └─ EXISTING_POST_SELECT → RecruitmentService
```

---

## CustomId 접두사 (DiscordConstants.CUSTOM_ID_PREFIXES)

| Prefix | Format | 용도 |
|--------|--------|------|
| `voice_connect_` | `{voiceChannelId}` | 음성채널 구직 연동 |
| `voice_spectate_` | `{voiceChannelId}` | 관전 모드 |
| `voice_wait_` | `{voiceChannelId}` | 대기 모드 |
| `voice_reset_` | `{voiceChannelId}` | 닉네임 초기화 |
| `voice_delete_` | `{voiceChannelId}` | 채널 닫기 |
| `forum_join_` | `{threadId}` | 참가하기 |
| `forum_leave_` | `{threadId}` | 참가 취소 |
| `forum_edit_premembers_` | `{threadId}_{recruiterId}` | 멤버 수정 (모집자 전용) |
| `forum_participate_` | `{threadId}` | 하위 호환 참가 |
| `role_btn_` | | 역할 태그 선택 |
| `role_complete_` | | 태그 선택 완료 |
| `recruitment_modal_` | | 모달 표시 |
| `recruitment_method_` | | 연동 방법 선택 |
| `premembers_edit_modal_` | `{threadId}` | 멤버 수정 모달 |
| `scrimmage_recruitment_` | | 내전 구직 |
| `long_term_recruitment_` | | 장기 구직 |

---

## DI 컨테이너 (container.js) — 주요 의존성

> InjectionMode.CLASSIC: constructor 파라미터 **이름 = 컨테이너 키**, 순서 중요

```
dbManager (DatabaseManager.singleton)
databaseManager = alias → dbManager
logService(client, logChannelId)
activityTracker(client, dbManager, logService)
voiceChannelManager(client, voiceCategoryId, guildId)
forumPostManager(client, forumChannelId, forumTagId, dbManager) ← asFunction
mappingService(client, voiceChannelManager, forumPostManager, dbManager) ← asFunction
recruitmentService(client, forumPostManager, voiceChannelManager, mappingService, participantTracker)
emojiReactionService(client, forumPostManager)
buttonHandler(voiceChannelManager, recruitmentService, modalHandler, emojiReactionService, forumPostManager)
modalHandler(recruitmentService, forumPostManager)
interactionRouter(buttonHandler, modalHandler, recruitmentService, nicknameButtonHandler, nicknameSelectMenuHandler, nicknameModalHandler)
```

---

## DB 테이블 (PostgreSQL)

### post_integrations
| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL PK | |
| guild_id | VARCHAR | 서버 ID |
| voice_channel_id | VARCHAR | 음성 채널 ID / `STANDALONE_{threadId}` |
| forum_post_id | VARCHAR | 포럼 스레드 ID |
| forum_channel_id | VARCHAR | 포럼 채널 ID |
| forum_state | VARCHAR | `created` / `voice_linked` / `standalone` |
| is_active | BOOLEAN | 활성 여부 |
| participants | JSON | 레거시 참가자 배열 |
| max_count | INT | 최대 참가 인원 |
| last_participant_count | INT | |
| created_at / updated_at | TIMESTAMP | |

### forum_participants
| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL PK | |
| forum_post_id | VARCHAR NOT NULL | 포럼 스레드 ID |
| user_id | VARCHAR NOT NULL | Discord 유저 ID |
| nickname | VARCHAR | cleanNickname 처리된 이름 |
| joined_at | TIMESTAMP | |
| **UNIQUE** | (forum_post_id, user_id) | |

### 주요 쿼리 메서드 (ForumRepository → DatabaseManager 위임)
```
addParticipant(forumPostId, userId, nickname)
removeParticipant(forumPostId, userId)
getParticipants(forumPostId) → [{ userId, nickname, joinedAt }]
getParticipantNicknames(forumPostId) → [nickname, ...]
isParticipant(forumPostId, userId) → boolean
getParticipantCount(forumPostId) → number
clearParticipants(forumPostId)
ensureForumMapping(voiceChannelId, forumPostId, forumState, isActive)
getOrCreateForumRecord(forumPostId)
trackForumMessage(threadId, messageType, messageId)
getTrackedMessages(threadId, messageType)
```

---

## 구인구직 포럼 포스트 구조

```
[포럼 포스트 (thread)]
  │
  ├─ Starter Message (Embed + 버튼 2행)
  │   ├─ 1행: 관전/대기/초기화/닫기 버튼
  │   └─ 2행: [👥 참가하기] [👋 참가 취소] [✏️ 멤버 수정]
  │
  ├─ (조건) 📢 미리 모인 멤버: @mention... (핑 알림)
  ├─ ## 👥 참가자(N명): ` name1 ` , ` name2 `
  │   -# (N/M명)
  ├─ (조건) 🔊 음성 채널: https://...
  └─ **참가하기** 버튼을 눌러 참가하세요.
```

### 포스트 생성 흐름 (ForumPostManager.createForumPost)
```
1. createPostEmbed() → Embed 생성 (제목, 태그, 설명, 모집자, 미리 모인 멤버)
2. createParticipationButtons(temp, recruiterId) → 버튼 생성
3. forumChannel.threads.create() → 스레드 생성
4. starterMessage.edit() → 버튼 customId를 실제 threadId로 업데이트
5. thread.members.add(recruiterId) → 모집자 스레드 추가
6. DB: addParticipant(모집자)
7. DB: addParticipant(미리 모인 멤버 each) + thread.members.add
8. @name → guild.members.search() → ID 해석 → addParticipant
9. thread.send(📢 미리 모인 멤버 핑)
10. thread.send(참가자 목록 메시지)
11. thread.send(음성 채널 링크) — 조건
12. thread.send(참가 안내 메시지)
13. DB: ensureForumMapping (독립형)
```

---

## 유틸 함수 시그니처

```js
// formatters.js
formatParticipantList(participants: string[]) → "## 👥 **참가자(N명)**: ` name1 ` , ` name2 `"
formatParticipantChangeMessage(joined: string[], left: string[]) → "-# name님이 참가했습니다."

// TextProcessor.js
TextProcessor.cleanNickname(name: string) → string  // [관전], [대기] 등 태그 제거

// SafeInteraction.js
SafeInteraction.safeReply(interaction, options) → 안전한 응답 (이미 응답됨 체크)
SafeInteraction.safeDeferUpdate(interaction) → 안전한 deferUpdate
SafeInteraction.startProcessing(interaction) → 중복 처리 방지
SafeInteraction.validateInteraction(interaction) → { valid, reason }
```

---

## 환경 변수 (.env → config)

| Key | Type | Description |
|-----|------|-------------|
| TOKEN | string | Discord 봇 토큰 |
| GUILDID | string | 서버 ID |
| LOG_CHANNEL_ID | string | 로그 채널 |
| FORUM_CHANNEL_ID | string | 메인 포럼 채널 |
| FORUM_TAG_ID | string | 포럼 태그 |
| VOICE_CATEGORY_ID | string | 음성 채널 카테고리 |
| DATABASE_URL | string | PostgreSQL 연결 |
| TEAM_CHANNEL_IDS | CSV string | 팀짜기 채널 ID들 (,구분) |
| SCRIMMAGE_FORUM_CHANNEL_ID | string | 내전 포럼 |
| LONG_TERM_FORUM_CHANNEL_ID | string | 장기 포럼 |
| EXCLUDED_CHANNELS | CSV string | 활동 추적 제외 채널 |
