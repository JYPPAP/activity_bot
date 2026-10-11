# Activity Bot - Codebase Map
> 이 파일은 AI 어시스턴트가 코드 구조를 빠르게 파악하기 위한 참조 파일입니다.
> 수정 시 반드시 이 파일도 함께 업데이트할 것.
> 마지막 업데이트: 2026-10-11

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
│   ├── OnboardingRules.js # md/txt 규칙 문서 로딩·검증·버전 해시
│   ├── DiscordConstants.js    # CHANNEL_IDS, CUSTOM_ID_PREFIXES, EMOJIS
│   ├── NicknameConstants.js   # 닉네임 시스템 상수
│   ├── RecruitmentConfig.js   # 구인구직 설정 (MAX_TAGS 등)
│   ├── commandPermissions.js  # 역할 기반 명령어 권한
│   ├── constants.js           # TIME, COLORS
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
│   ├── NicknameManagementCommand.js  # /닉관리 (관리자)
│   ├── NicknameSetupCommand.js       # /닉설정
│   └── OnboardingManagementCommand.js # /가입관리 (관리자 설정·메시지 설치)
│
├── services/             # 비즈니스 로직
│   ├── DatabaseManager.js     # Facade: 4개 Repository 위임 (Singleton)
│   ├── ActivityTracker.js     # 음성채널 활동 추적, 세션 복구
│   ├── ActivityReportService.js  # 활동 리포트 생성
│   ├── ForumPostManager.js    # 포럼 포스트 Facade (책임별 모듈 위임)
│   ├── forum/
│   │   ├── ForumPostCreator.js       # 포럼 포스트 생성
│   │   ├── ForumPostBuilders.js      # Embed 및 버튼 생성
│   │   ├── ForumPostNotifier.js      # 참가자·음성 채널 알림
│   │   ├── ForumPostQueries.js       # 포스트 조회·아카이브
│   │   └── ForumMessageTracker.js    # 추적 메시지 저장·삭제
│   ├── InactivePostChecker.js # 15일 비활동 구직글 경고 (매일 1회, 모집자 멘션, 구직게시판 카테고리 1243571860705251348 전용)
│   ├── RecruitmentService.js  # 구인구직 흐름 총괄
│   ├── VoiceChannelManager.js # 음성 채널 생성/삭제
│   ├── VoiceChannelForumIntegrationService.js  # 음성↔포럼 연동
│   ├── EmojiReactionService.js   # 이모지 반응 기반 참가 관리
│   ├── MappingService.js      # 음성↔포럼 매핑
│   ├── ParticipantTracker.js  # 참가자 추적
│   ├── LogService.js          # 로그 채널 전송
│   ├── EventManager.js        # Discord 이벤트 바인딩
│   ├── PermissionService.js   # 권한 체크
│   ├── UserClassificationService.js  # 유저 활동 분류
│   ├── UserNicknameService.js # 닉네임 DB CRUD
│   ├── PlatformTemplateService.js    # 닉네임 플랫폼 템플릿
│   └── OnboardingService.js   # 개인 가입 채널, 카드 교체, 등업 심사·복구·자동 정리
│
├── repositories/         # DB 쿼리 레이어 (DatabaseManager가 위임)
│   ├── ActivityRepository.js  # monthly activity 테이블
│   ├── AfkRepository.js       # AFK 상태 관리
│   ├── ConfigRepository.js    # guild_settings, role_configs
│   ├── OnboardingRepository.js # onboarding_configs, onboarding_progress
│   ├── ForumRepository.js     # 포럼 Repository Facade
│   ├── forum/
│   │   ├── PostIntegrationRepository.js  # post_integrations 및 채널 매핑
│   │   ├── ForumMessageRepository.js     # 포럼 메시지 추적
│   │   ├── ForumParticipantRepository.js # forum_participants
│   │   └── ForumWaitlistRepository.js    # forum_waitlist
│   └── index.js               # export all
│
├── managers/
│   └── VoiceChannelNicknameManager.js  # 음성채널 닉네임 표시
│
├── ui/                   # 인터랙션 핸들러
│   ├── InteractionRouter.js   # 최상위 인터랙션 라우터
│   ├── ButtonHandler.js       # 버튼 인터랙션 라우팅 Facade
│   ├── buttons/
│   │   ├── RoleTagButtons.js       # 역할 태그 선택·완료 버튼
│   │   ├── VoiceChannelButtons.js  # 음성 채널 관전·대기·초기화·삭제 버튼
│   │   ├── ForumPostButtons.js     # 포럼 참가·취소·대기·멘션 버튼
│   │   └── PreMembersButtons.js    # 미리 모인 멤버 수정 버튼·선택 메뉴
│   ├── ModalHandler.js        # 모달 인터랙션 디스패처 Facade
│   ├── NicknameUIBuilder.js   # 닉네임 임베드·선택 메뉴·버튼 공통 빌더
│   ├── OnboardingUIBuilder.js # 개인 가입 단계·시작 안내·심사 Embed/버튼 빌더
│   ├── OnboardingGameManager.js # 관리자 게임 추가 버튼·역할 선택·이름/일괄 수정 모달
│   ├── modals/
│   │   ├── ModalRetryPolicy.js          # 모달 처리 재시도 정책
│   │   ├── RecruitmentModalBuilder.js   # 구인구직 모달 구성·표시
│   │   ├── RecruitmentModalData.js      # 모달 입력 추출·검증
│   │   └── RecruitmentSubmitFlows.js    # 독립·음성 연동 제출 흐름
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
  │   ├─ onboarding:admin:games: prefix → OnboardingGameManager (일반 가입보다 먼저)
  │   ├─ onboarding: prefix → OnboardingService
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
  │   ├─ onboarding:admin:games: prefix → OnboardingGameManager
  │   ├─ NicknameModal prefix → NicknameModalHandler
  │   └─ else → ModalHandler.handleModalSubmit()
  │       ├─ PREMEMBERS_EDIT_MODAL → handleEditPreMembersModalSubmit()
  │       ├─ scrimmage_recruitment_modal → 내전 처리
  │       ├─ long_term_recruitment_modal → 장기 처리
  │       └─ default → extractModalData() → 독립/연동 구직 처리
  │
  └─ StringSelect → routeSelectMenuInteraction()
      ├─ onboarding: prefix → OnboardingService
      ├─ NicknameSelect → NicknameSelectMenuHandler
      ├─ RECRUITMENT_METHOD → RecruitmentService
      └─ EXISTING_POST_SELECT → RecruitmentService

RoleSelect → OnboardingGameManager (게임 추가 시 역할 선택)
```

---

## CustomId 접두사 (DiscordConstants.CUSTOM_ID_PREFIXES)

| Prefix | Format | 용도 |
|--------|--------|------|
| `voice_connect_` | `{voiceChannelId}` | 음성채널 구직 연동 |
| `voice_close_` | `{voiceChannelId}` | 음성채널 닫기 라우팅 (현재 버튼 생성은 주석 처리) |
| `voice_spectate_` | `{voiceChannelId}` | 관전 모드 |
| `voice_wait_` | `{voiceChannelId}` | 대기 모드 |
| `voice_reset_` | `{voiceChannelId}` | 닉네임 초기화 |
| `voice_delete_` | `{voiceChannelId}` | 채널 닫기 |
| `forum_join_` | `{threadId}` | 참가하기 |
| `forum_leave_` | `{threadId}` | 참가 취소 |
| `forum_wait_` | `{threadId}` | 포럼 참가자를 대기 상태로 전환 |
| `forum_edit_premembers_` | `{threadId}_{recruiterId}` | 멤버 수정 (모집자 전용) |
| `premembers_user_select_` | `{threadId}_{recruiterId}` | 미리 모인 멤버 선택 메뉴 |
| `forum_mention_` | `{threadId}` | 포럼 참가자 멘션 |
| `forum_delete_confirm` | 고정값 | 구직 닫기 확인 |
| `forum_delete_cancel` | 고정값 | 구직 닫기 취소 |
| `forum_participate_` | `{threadId}` | 하위 호환 참가 |
| `role_btn_` | | 역할 태그 선택 |
| `role_complete_` | | 태그 선택 완료 |
| `standalone_role_btn_` | `{tag}` 또는 `{tag}_{methodValue}` | 독립 구직 역할 태그 선택 |
| `standalone_role_complete` | 고정값 또는 `_{methodValue}` | 독립 구직 역할 태그 선택 완료 |
| `recruitment_modal_` | | 모달 표시 |
| `recruitment_method_` | | 연동 방법 선택 |
| `existing_post_select_` | `{voiceChannelId}` | 기존 포럼 글 선택 메뉴 |
| `scrimmage_recruitment_` | | 내전 구직 |
| `long_term_recruitment_` | | 장기 구직 |
| `new_forum` | 고정값 | 새 포럼 생성 방법 선택 |
| `new_forum_` | TODO | TODO: 현재 사용처 없음 (`src/config/DiscordConstants.js`) |
| `existing_forum` | TODO | TODO: 현재 사용처 없음 (`src/config/DiscordConstants.js`) |
| `existing_forum_` | `{postId}` | 기존 포럼 연동 방법 선택 |
| `onboarding:gender` | 고정값 | 기존 성별 선택 ID (레거시 안내에서 사용 불가) |
| `onboarding:gender:` | `male` / `female` | 성별 선택 버튼 |
| `onboarding:games` | 고정값 | 게임 선택 초안 저장·현재 카드 수정 |
| `onboarding:games:confirm` | 고정값 | 게임 선택 완료 후 규칙 화면 이동 |
| `onboarding:start` | 고정값 | 개인 가입 채널 생성 / 이어하기 |
| `onboarding:back:` | `gender` / `games` | 이전 단계 / 입력 수정 |
| `onboarding:close` | 고정값 | 승인된 개인 가입 채널 삭제 |
| `onboarding:rules` | 고정값 | 서버 규칙 동의 |
| `onboarding:rules:back` | 고정값 | 이전 규칙 문서로 이동 |
| `onboarding:preview:` | `{pageIndex}` | 공개 안내에서 가입 단계별 비공개 미리보기 (상태·역할 변경 없음) |
| `onboarding:apply` | 고정값 | 등업 신청 제출 |
| `onboarding:approve:` | `{userId}` | 관리자 등업 승인 |
| `onboarding:reject:` | `{userId}` | 관리자 등업 거절 |
| `onboarding:admin:games:` | 게임 관리 공통 접두사 | 관리자 전용 컴포넌트 라우팅 |
| `onboarding:admin:games:add` | 고정값 | 게임 추가 역할 선택 화면 |
| `onboarding:admin:games:role` | 고정값 | 역할 선택 후 게임 이름 입력 모달 |
| `onboarding:admin:games:name:` | `{roleId}` | 단일 게임 이름 모달 제출 |
| `onboarding:admin:games:bulk:` | `{sha256}` | 현재 게임 목록을 미리 채운 일괄 수정 모달·제출 |

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
onboardingRepository(dbManager)
onboardingService(onboardingRepository, client)
onboardingGameManager(onboardingRepository)
onboardingManagementCommand(onboardingRepository, onboardingService, onboardingGameManager)
buttonHandler(voiceChannelManager, recruitmentService, modalHandler, emojiReactionService, forumPostManager)
modalHandler(recruitmentService, forumPostManager)
interactionRouter(buttonHandler, modalHandler, recruitmentService, nicknameButtonHandler, nicknameSelectMenuHandler, nicknameModalHandler, onboardingService, onboardingGameManager)
```

---

## DB 테이블 (PostgreSQL)

### onboarding_configs / onboarding_progress

| Table | Key / 주요 컬럼 | Description |
|---|---|---|
| `onboarding_configs` | `guild_id` PK, `welcome_channel_id`, `category_id`, `review_channel_id`, `review_manager_user_id` VARCHAR(50) nullable, `welcome_message_id`, `rules_text`, 성별·대기·정회원 역할 ID, `game_roles` JSONB, `enabled` | 시작 안내 채널 `1459874768449699861`, 가입 카테고리와 설정 실행자·관리자·봇 전용 심사 채널. 설정 실행자 계정을 담당자로 저장·열람 허용하며 관리자 권한 없이 승인/거절 가능(미등록 시 관리자만). 정회원 역할 `1243633748344438855`. 기존 단계 채널·`stage_role_ids`는 마이그레이션 호환용으로 보존 |
| `onboarding_progress` | `(guild_id, user_id)` PK, `stage`, 선택 역할 ID, 규칙 동의·신청·심사 시각, `reviewed_by`, `rejection_reason`, `channel_id`, `message_id`, `review_message_id`, `cleanup_at`, `review_action`, `departed_at` | 개인 채널·현재 안내 카드·심사 메시지·삭제 예약·심사 중간 상태를 저장하여 재시작 시 복원. 탈퇴 기록이 있는 회원은 복구·정리 조회에서 제외하고 재입장 시 해제 |

가입 단계는 `gender → games → rules → application → pending → approved` 순서이며, 거절 시 `application`으로 돌아간다. `idx_onboarding_progress_stage (guild_id, stage)`가 단계별 조회를 지원한다.

`config/onboarding/rules/`의 `.md`·`.txt` 파일을 파일명 순서대로 표시하고 문서마다 동의를 받는다. README.md·*.example.md/txt는 제외한다. 파일이 없으면 기존 `rules_text`를 사용한다. `rule_index`(INTEGER, 기본 0)와 `rules_revision`(TEXT, 문서 해시)으로 진행을 복원하며 내용 변경 시 진행 중인 규칙 동의를 초기화한다. `ONBOARDING_CATEGORY_ID`는 저장된 `category_id`보다 우선하며 새 개인 채널에 적용된다. `/가입관리 게시`는 고정 온보딩 채널에 과정 안내·시작·미리보기 버튼을 게시/갱신한다.

`withMemberLock(guildId, userId, callback)`은 전용 DB 연결의 PostgreSQL 세션 advisory lock으로 회원별 채널 생성·단계 전환·심사를 직렬화한다. 같은 잠금 안에서 DB checkpoint와 Discord API 작업을 수행하고 연결을 반환하기 전에 잠금을 해제한다. `review_action`은 승인/거절 도중 종료 시 완료할 결정을 기록한다.

`OnboardingService.initialize()`는 현재 가입 상태를 복원하고 60초마다 심사 복구·삭제 예약을 확인한다. 승인 후 10분에 개인 채널을 삭제하며 `stop()`으로 타이머를 종료한다. 채널 topic과 봇 Embed footer로 생성 직후 종료된 채널/메시지도 다시 찾는다. 배포·운영 절차는 [onboarding-setup.md](docs/onboarding-setup.md).

`cleanup_at`과 `departed_at`은 `TIMESTAMPTZ`로 저장하여 봇과 DB 시간대가 달라도 삭제 예약·탈퇴 시각을 동일하게 해석한다. 승인된 회원 재입장 시 정회원 역할과 현재 설정에 남아 있는 저장된 성별·게임 역할만 복원한다. 신청·심사 중 선택 검증은 현재 설정을 엄격히 따른다.

`/가입관리 게임추가`는 옵션 없이 실행하면 비공개 게임 관리 패널을 연다. 버튼으로 역할 선택→이름 입력 또는 여러 게임 목록(`이름 | 역할ID`) 일괄 수정이 가능하다. 모든 컴포넌트에서 명령 권한을 재검증한다. 일괄 수정은 기존 이름/역할과 겹치는 항목만 대체하며 생략한 행은 삭제하지 않는다. `OnboardingRepository.updateGameRoles(guildId, games, expectedGames)`는 단일 UPDATE의 JSONB 목록 비교와 예약 역할 검증으로 동시 변경을 덮어쓰지 않는다. 이미 회원에게 지급된 역할은 바꾸지 않는다.

### post_integrations
| Column | Type | Description |
|--------|------|-------------|
| guild_id + voice_channel_id | VARCHAR, 복합 PK | 서버 및 음성 채널 ID / `STANDALONE_{threadId}` |
| forum_post_id | VARCHAR, 길드 내 UNIQUE | 포럼 스레드 ID |
| forum_channel_id | VARCHAR | 포럼 채널 ID |
| participant_message_ids / emoji_reaction_message_ids / other_message_types | JSONB | 포럼 메시지 추적 |
| forum_state | VARCHAR | `created` / `voice_pending` / `voice_linked` / `standalone` / `archived` |
| voice_linked_at / link_requested_by | TIMESTAMP / VARCHAR | 연동 시각과 요청자 |
| auto_track_enabled | BOOLEAN | 자동 추적 여부 |
| is_active | BOOLEAN | 활성 여부 |
| archived_at / locked_at | TIMESTAMP | 아카이브·잠금 시각 |
| participants | JSONB | 레거시 참가자 배열(GIN 인덱스) |
| created_at / updated_at | TIMESTAMP | |

주요 인덱스: `forum_post_id`, `voice_channel_id`, 활성 행 부분 인덱스, `forum_state`, 자동 추적 부분 인덱스, `participants` GIN.

### users / guild_settings / user_activities_YYYYMM

| Table | Key / 주요 컬럼 | Description |
|---|---|---|
| `users` | `user_id` PK, `guild_id`, `inactive_start_date`, `inactive_end_date` | 사용자와 AFK 기간 통합. 길드 및 활성 AFK 조회 인덱스 사용 |
| `guild_settings` | `guild_id` PK, `game_roles`, `excluded_voice_channels`, `activity_tiers`, `timezone`, `monthly_target_hours` | 길드별 활동 설정(JSONB 포함) |
| `user_activities_YYYYMM` | `(guild_id, user_id)` PK, `daily_voice_minutes` JSONB, `total_voice_minutes` | 월별 자동 생성 활동 테이블. 사용자·길드 인덱스 사용 |

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
  │   ├─ -# (N/M명)
  │   └─ [📢 참가자 멘션] (클릭 시 멘션 전송 후 참가자 목록과 함께 맨 아래로 재배치)
  ├─ (조건) 🔊 음성 채널: https://...
  └─ **참가하기** 버튼을 눌러 참가하세요.
```

### 포스트 생성 흐름 (ForumPostCreator.createForumPost)
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
| CLIENT_ID | string | Discord 애플리케이션 ID |
| LOG_CHANNEL_ID | string | 로그 채널 |
| FORUM_CHANNEL_ID | string | 메인 포럼 채널 |
| FORUM_TAG_ID | string | 포럼 태그 |
| VOICE_CATEGORY_ID | string | 음성 채널 카테고리 |
| DATABASE_URL / POSTGRES_URL | string | PostgreSQL 연결 (`DATABASE_URL` 우선) |
| TEAM_CHANNEL_IDS | CSV string | 팀짜기 채널 ID들 (,구분) |
| SCRIMMAGE_FORUM_CHANNEL_ID | string | 내전 포럼 |
| LONG_TERM_FORUM_CHANNEL_ID | string | 장기 포럼 |
| EXCLUDE_CHANNELID_1~6 | string | 활동 추적 제외 채널 (`1~3`은 로그도 제외) |
| DEV_ID | string | 전체 커맨드 권한을 가진 개발자 ID |
| CALENDAR_LOG_CHANNEL_ID | string | 활동 목록 출력 채널 |
| NODE_ENV | string | 실행 환경 |
| ERRSOLE_HOST / ERRSOLE_PORT | string | Errsole 대시보드 바인딩 |
| PHONE_IP | string | Termux 네트워크 설정 |
