# 12. Event Flow — Discord 이벤트 매핑표

> Discord Gateway가 발행하는 이벤트가 **어떤 서비스**를 거쳐 **어떤 DB 테이블**에 쓰는지 한눈에 본다.
> 버그가 생겼을 때 "어디를 봐야 하는가" 의 출발점.

---

## 1. Gateway Intents (현재 활성)

`src/bot.js` 기준:

| Intent | 용도 |
|---|---|
| `Guilds` | 길드 캐시 (필수) |
| `GuildMembers` | 멤버 목록, 신규 가입 및 닉네임 변경 감지 |
| `GuildPresences` | 온라인 상태 (일부 리포트) |
| `GuildVoiceStates` | 음성 채널 입·퇴장 (활동 추적 핵심) |
| `GuildMessages` | 포럼 스레드 메시지, `awaitMessages` |
| `MessageContent` | `@name` 파싱 (Privileged) |
| `GuildMessageReactions` | 이모지 기반 참가 관리 |

---

## 2. 이벤트 → 핸들러 → DB 매핑표

| 이벤트 | 1차 핸들러 | 서비스 체인 | 영향 테이블 | 도메인 |
|---|---|---|---|---|
| `ClientReady` | `Bot.initialize` | ActivityTracker, VoiceChannelForumIntegrationService, EmojiReactionService 초기화 | — (캐시 복원) | A,B,C,D |
| `guildMemberAdd` | `EventManager` | `OnboardingService.handleMemberAdd` → `OnboardingRepository.ensureProgress` → 성별 단계 역할 지급 | `onboarding_configs`, `onboarding_progress` | D |
| `voiceStateUpdate` | `EventManager` | ActivityTracker → AfkRepository / ActivityRepository, VoiceChannelNicknameManager | `monthly_activity`, `afk_states` | A, C |
| `interactionCreate` (slash) | `CommandHandler` | `{Name}Command` (`/가입관리` 포함) | 해당 커맨드 별 | A,B,C,D |
| `interactionCreate` (button) | `InteractionRouter.routeButtonInteraction` | `OnboardingService` / `ButtonHandler` / `NicknameButtonHandler` / `RecruitmentService` | `onboarding_progress`, `forum_participants`, `post_integrations` | B, C, D |
| `interactionCreate` (modal) | `InteractionRouter.routeModalSubmit` | `ModalHandler` / `NicknameModalHandler` | `forum_participants`, `post_integrations` | B, C |
| `interactionCreate` (select) | `InteractionRouter.routeSelectMenuInteraction` | `OnboardingService` / `RecruitmentService` / `NicknameSelectMenuHandler` | `onboarding_progress`, `post_integrations`, `user_nicknames` | B, C, D |
| `messageCreate` (포럼 스레드 내) | `ForumPostManager` 리스너 | `ParticipantTracker`, `formatParticipantChangeMessage` | — | B |
| `messageReactionAdd/Remove` | `EmojiReactionService` | `ParticipantTracker` | `forum_participants` | B |
| `threadUpdate` (archived) | `MappingService` | `ForumRepository.deactivateMapping` | `post_integrations` | B |
| `guildMemberUpdate` (nickname) | `VoiceChannelNicknameManager` | `TextProcessor.cleanNickname` | — | C |
| `SIGTERM` / `SIGINT` | `gracefulShutdown` | ActivityTracker.flushPending, Container.dispose | `monthly_activity` | 전체 |

> "영향 테이블"에 **—** 가 있으면 캐시/UI 업데이트만 발생.

---

## 3. 주요 인터랙션 루트 (계단 뷰)

### 3.1 음성 채널 접속/이탈

```
voiceStateUpdate(oldState, newState)
└─ ActivityTracker.handleVoiceStateUpdate()
   ├─ 채널 진입      → startSession(userId, channelId, ts)
   │                   └─ memory Map (+ checkpoint 주기적 flush)
   ├─ 채널 이탈      → endSession(userId, ts)
   │                   └─ ActivityRepository.incrementSeconds(userId, yyyyMM, diff)
   ├─ mute/deaf 변경 → AfkRepository.setAfk / clearAfk
   └─ 닉네임 태그 반영 → VoiceChannelNicknameManager.applyDisplay()
                         └─ TextProcessor.cleanNickname → Member.setNickname()
```

### 3.2 /구직 → 포럼 포스트 생성

```
interactionCreate (/구직)
└─ CommandHandler → RecruitmentCommand.execute()
   └─ Recruitment UI: 모달 혹은 Select (연동/독립)
       │
       ├─ 모달 제출 interactionCreate (ModalSubmit)
       │   └─ InteractionRouter → ModalHandler
       │       └─ RecruitmentService.handleModalSubmit()
       │           ├─ ForumPostManager.createForumPost()
       │           │   ├─ thread.create()
       │           │   ├─ starterMessage.edit(buttons with real threadId)
       │           │   ├─ ForumRepository.addParticipant (모집자)
       │           │   ├─ ForumRepository.addParticipant (pre-members)
       │           │   ├─ thread.members.add(...)
       │           │   └─ thread.send(참가자 목록 / 음성 링크 / 안내)
       │           └─ ForumRepository.ensureForumMapping()
       │
       └─ 버튼 interactionCreate (Button)
           └─ InteractionRouter → ButtonHandler.handleVoiceChannelButtons / handleRoleTagButtons
```

### 3.3 참가/참가 취소 버튼

```
interactionCreate (Button: forum_join_{threadId})
└─ InteractionRouter → ButtonHandler.handleJoinButton
   ├─ SafeInteraction.safeDeferUpdate()
   ├─ cleanNickname(displayName)
   ├─ ForumRepository.addParticipant(threadId, userId, nickname)  ← UNIQUE 위반 시 이미 참가 안내
   ├─ thread.members.add(userId)
   ├─ ParticipantTracker.notifyChange({ joined: [nickname] })
   └─ formatParticipantList → thread.send(업데이트 메시지)
```

### 3.4 신규 회원 단계별 가입·등업

```
guildMemberAdd(member)
└─ OnboardingService.handleMemberAdd()
   ├─ OnboardingRepository.getConfig(guildId)
   ├─ OnboardingRepository.ensureProgress(guildId, userId)
   └─ member.roles.add(stage_role_ids.gender)

interactionCreate (onboarding:* component)
└─ InteractionRouter → OnboardingService.handleInteraction()
   ├─ gender select → 성별 역할 지급 → stage role: gender → games
   ├─ games select  → 게임 역할 지급 → stage role: games → rules
   ├─ rules button  → 동의 시각 저장 → stage role: rules → application
   ├─ apply button  → pending 역할 지급 → 관리자 검토 채널에 승인/거절 버튼 전송
   └─ approve/reject button (Administrator)
       ├─ 승인 → pending 제거 + member 역할 지급 → approved
       └─ 거절 → pending 제거 + application 역할 복구 → application
```

각 단계 완료 응답은 다음 채널을 멘션한다. 실제 채널 공개/숨김은 봇이 교체하는 단계 역할과 Discord 채널 권한 덮어쓰기가 담당한다.

---

## 4. 실패·재시도 경로

| 시나리오 | 복구 루트 |
|---|---|
| `interactionCreate` 처리 중 예외 | `SafeInteraction` fallback → 유저에 "처리 중 오류" 응답 + `logger.error` |
| 봇 재기동 후 세션 유실 | `ClientReady` → `ActivityTracker.initializeActivityData` 가 guild 음성 채널 snapshot으로 재시작 |
| `addParticipant` UNIQUE 충돌 | `isParticipant` 선행 체크 → 사용자에 친화적 메시지 |
| Forum thread archive 중 DB 불일치 | `threadUpdate` 이벤트에서 `deactivateMapping` |
| 가입 도중 재접속/봇 재기동 | `onboarding_progress`의 현재 `stage`를 유지하며 중복 단계 제출은 거부 |
| 역할 지급/제거 실패 | 유저에게 권한·봇 역할 순서 확인 안내 + `logger.error`; DB 단계 전이는 역할 변경 뒤 수행 |

---

## 5. 이벤트 추가 시 체크리스트

1. Intent 필요 여부 확인 → 필요 시 **ADR 작성** (I-12).
2. `src/services/EventManager.js`에 바인딩 추가.
3. 처리 서비스를 `src/services/` 또는 기존 서비스에 연결.
4. 이 문서 **§2 매핑표**에 행 추가.
5. `CODEBASE_MAP.md`의 관련 섹션 갱신.
6. `docs/11-invariants.md` 위반 여부 체크 (특히 I-06, I-07).

---

_빠른 디버깅 팁: 이슈가 들어오면 이 문서의 §2 표에서 이벤트 행을 먼저 찾아 "서비스 체인"을 따라간다._
