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
| `ClientReady` | `Bot.initialize` | ActivityTracker, VoiceChannelForumIntegrationService, EmojiReactionService, OnboardingService 초기화·가입 상태 복원 | `onboarding_progress` (가입 UI·심사 복구) | A,B,C,D |
| `guildMemberAdd` | `EventManager` | `OnboardingService.handleMemberAdd` → 회원 잠금 → 개인 채널·현재 단계 카드 생성/복원 | `onboarding_configs`, `onboarding_progress` | D |
| `guildMemberRemove` | `EventManager` | `OnboardingService.handleMemberRemove` → 개인 채널 정리·`departed_at` 저장 | `onboarding_progress` | D |
| 60초 유지보수 | `OnboardingService.maintenance` | `getInterruptedProgress`로 중단된 심사·누락된 채널/카드 복구, 승인 후 10분 삭제 예약 처리 | `onboarding_progress` | D |
| `voiceStateUpdate` | `EventManager` | ActivityTracker → AfkRepository / ActivityRepository, VoiceChannelNicknameManager | `monthly_activity`, `afk_states` | A, C |
| `interactionCreate` (slash) | `CommandHandler` | `{Name}Command` (`/가입관리` 포함) | 해당 커맨드 별 | A,B,C,D |
| `interactionCreate` (button) | `InteractionRouter.routeButtonInteraction` | `OnboardingService` / `ButtonHandler` / `NicknameButtonHandler` / `RecruitmentService` | `onboarding_progress`, `forum_participants`, `post_integrations` | B, C, D |
| `interactionCreate` (modal) | `InteractionRouter.routeModalSubmit` | `ModalHandler` / `NicknameModalHandler` | `forum_participants`, `post_integrations` | B, C |
| `interactionCreate` (select) | `InteractionRouter.routeSelectMenuInteraction` | `OnboardingService` / `RecruitmentService` / `NicknameSelectMenuHandler` | `onboarding_progress`, `post_integrations`, `user_nicknames` | B, C, D |
| `messageCreate` (포럼 스레드 내) | `ForumPostManager` 리스너 | `ParticipantTracker`, `formatParticipantChangeMessage` | — | B |
| `messageReactionAdd/Remove` | `EmojiReactionService` | `ParticipantTracker` | `forum_participants` | B |
| `threadUpdate` (archived) | `MappingService` | `ForumRepository.deactivateMapping` | `post_integrations` | B |
| `guildMemberUpdate` (nickname) | `VoiceChannelNicknameManager` | `TextProcessor.cleanNickname` | — | C |
| `SIGTERM` / `SIGINT` | `gracefulShutdown` | ActivityTracker.flushPending, OnboardingService.stop, Container.dispose | `monthly_activity` | 전체 |

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

### 3.4 신규 회원 개인 채널 가입·등업

```
guildMemberAdd(member)
또는 interactionCreate (onboarding:start: 고정 온보딩 채널)
└─ OnboardingService.openSession()
   └─ OnboardingRepository.withMemberLock(guildId, userId)
      ├─ enabled + category_id 설정 확인, progress 생성/조회
      ├─ 기존 단계 역할 제거
      ├─ 개인 채널 생성/재사용 (topic: onboarding:{guildId}:{userId})
      │   └─ @everyone 열람 거부, 본인 열람 허용·입력 거부, 봇 입력 허용
      └─ 현재 단계의 Embed + 버튼/선택 메뉴 카드 복원

interactionCreate (onboarding:* component)
└─ InteractionRouter → OnboardingService.handleInteraction()
   ├─ 회원·채널·현재 메시지 ID 검증 + DB 회원 잠금
   ├─ gender button → 선택 초안 저장 → games 카드 교체
   ├─ games select  → 선택 초안 저장 → 현재 카드 수정
   ├─ games confirm → rules 카드 교체
   ├─ rules button  → 문서마다 동의 후 rule_index 증가 → 마지막 문서 동의 시 application
   │   └─ 문서 해시 변경 시 동의 초기화·첫 문서로 복귀 (pending/approved 심사에는 소급 적용 안 함)
   ├─ preview button → 비공개 단계별 미리보기 (DB 진행·역할·채널 생성 없음)
   ├─ back button   → gender/games 복귀, 규칙 동의 해제 → 다시 동의
   ├─ apply button  → pending 저장·역할 지급 → 관리자 검토 채널 심사 카드 생성
   └─ approve/reject button (Administrator 또는 config.review_manager_user_id 일치)
       ├─ review_action 승인/거절 결정 checkpoint 기록
       ├─ 승인 → 성별·게임·member 역할 지급 + pending 제거 → approved 저장
       │   └─ 완료 카드, 10분 후 cleanup_at 예약 / 닫기 버튼
       └─ 거절 → pending 제거 → application 저장 → 수정·재신청 카드
```

단계 이동은 값 저장 → 새 카드 전송 → 새 메시지 ID 저장 → 이전 카드 삭제 순서로 처리한다. 게임 선택 중에는 기존 카드만 수정한다. 오래된 메시지·다른 사용자 요청은 거부하며 삭제 실패는 로그로 남긴다. 승인/거절은 심사 채널과 저장된 심사 메시지 ID까지 검증한다. 심사는 결정 기록 → 역할 변경 → 최종 단계 저장(결정 유지) → 심사·개인 UI 갱신 → 결정 해제 순서이며 중단된 단계부터 복구한다.

`ClientReady`에서 DB 상태를 복원한다. 채널 topic과 봇 카드 footer를 확인해 DB 기록 전 종료된 생성 작업도 재사용한다. 60초마다 중단된 심사 처리와 만료된 삭제 예약을 복구한다. 정상 종료 시 유지보수 타이머를 해제한다.

---

## 4. 실패·재시도 경로

| 시나리오 | 복구 루트 |
|---|---|
| `interactionCreate` 처리 중 예외 | `SafeInteraction` fallback → 유저에 "처리 중 오류" 응답 + `logger.error` |
| 봇 재기동 후 세션 유실 | `ClientReady` → `ActivityTracker.initializeActivityData` 가 guild 음성 채널 snapshot으로 재시작 |
| `addParticipant` UNIQUE 충돌 | `isParticipant` 선행 체크 → 사용자에 친화적 메시지 |
| Forum thread archive 중 DB 불일치 | `threadUpdate` 이벤트에서 `deactivateMapping` |
| 가입 도중 재접속/봇 재기동 | DB 진행 상태 및 채널 topic/카드 footer로 현재 화면 복원. 회원별 PostgreSQL session advisory lock으로 중복 생성·단계 제출 직렬화 |
| 신청 직후 역할 지급·심사 메시지 생성 실패 | pending checkpoint를 유지하고 이어하기·초기화·60초 유지보수에서 복구. 누락된 개인 채널·카드도 조회 대상 |
| 승인/거절 도중 역할 지급·UI 갱신 실패 | `review_action`에 기록된 같은 결정을 복구하며 다른 결정은 거부. 최종 단계 저장 후에도 UI 갱신 완료까지 결정 기록을 유지하고 정리를 보류 |
| 가입 화면 삭제/전송 실패 | 현재 DB 단계에 맞는 카드 복원. 이전 카드 삭제 실패 시 이전 메시지 ID 요청은 거부 |
| 개인 채널 삭제 예약 중 봇 종료 | `cleanup_at` 영속 시각을 읽어 재시작·60초 유지보수에서 삭제. 채널 topic 식별 확인 후 삭제 |
| 회원 탈퇴 후 반복 복구 | `departed_at`으로 탈퇴 기록을 남겨 복구·정리 조회에서 제외. 재입장 시 해제하고 저장된 진행부터 재개 |

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
