# 시스템 아키텍처

## 전체 구조

```
Discord Events (WebSocket)
    ↓
Bot (src/bot.js) ─── DI Container (Awilix)
    │
    ├─ EventManager ─── 이벤트 라우팅
    │   ├─ VoiceStateUpdate → ActivityTracker, VoiceForumService
    │   ├─ GuildMemberUpdate → ActivityTracker, VoiceForumService
    │   ├─ ChannelCreate/Delete → LogService, VoiceForumService
    │   ├─ InteractionCreate → CommandHandler
    │   └─ MessageReaction → EmojiReactionService
    │
    ├─ CommandHandler ─── 슬래시 명령어 처리
    │   └─ 9개 Command 클래스
    │
    └─ Services ─── 비즈니스 로직
        ├─ ActivityTracker (활동 추적)
        ├─ RecruitmentService (구인구직)
        ├─ UserNicknameService (닉네임 관리)
        └─ ... 기타 서비스
            ↓
        DatabaseManager (Facade)
            ├─ ActivityRepository
            ├─ ForumRepository
            ├─ ConfigRepository
            └─ AfkRepository
                ↓
            PostgreSQL (pg Pool)
```

## 계층 구조

### 1. 인프라 계층
- **DatabaseManager**: PostgreSQL 연결 풀 관리, Repository Facade 패턴
  - Core 메서드 (query, transaction, ensureMonthlyTable, cache)
  - 사용자 관리 메서드 (ensureUser, getUserById)
  - Repository 위임 메서드 (하위 호환성 유지)
- **Repository 계층** (`src/repositories/`):
  - **ActivityRepository**: 월별 활동 시간 추적 쿼리 (updateDailyActivity, getUserActivityByDateRange 등)
  - **ForumRepository**: 포럼/포스트 연동 + 참가자 관리 (createPostIntegration, addParticipant 등)
  - **ConfigRepository**: 길드 설정, 역할 구성 (getGuildSettings, getRoleConfig 등)
  - **AfkRepository**: 잠수 상태 관리 (setUserAfkStatus, clearExpiredAfkStatus 등)
- **LogService**: Discord 로그 채널로 활동 로그 배치 전송
- **logger-termux.js**: Errsole 기반 구조화 로깅

### 2. 코어 서비스 계층
- **EventManager**: Discord 이벤트 → 핸들러 라우팅
- **ActivityTracker**: 음성 채널 입퇴장 실시간 추적, DB 저장
- **ParticipantTracker**: 채널 참가자 분류 (활성/대기/관전)

### 3. 도메인 서비스 계층
- **VoiceChannelManager**: 추적 대상 음성 채널 판별
- **ForumPostManager**: 포럼 게시글 생성/수정/삭제
- **MappingService**: 음성채널 ↔ 포럼글 매핑 (메모리 캐시 + DB)
- **RecruitmentService**: 구인구직 비즈니스 로직
- **UserNicknameService**: 플랫폼별 닉네임 CRUD
- **PlatformTemplateService**: 플랫폼 템플릿 관리
- **UserClassificationService**: 사용자 활동/비활동 분류

### 4. UI 계층
- **InteractionRouter**: 버튼/모달/셀렉트메뉴 라우팅
- **ButtonHandler / NicknameButtonHandler**: 버튼 클릭 처리
- **ModalHandler / NicknameModalHandler**: 모달 입력 처리
- **NicknameSelectMenuHandler**: 드롭다운 메뉴 처리
- **RecruitmentUIBuilder**: 구인구직 UI 컴포넌트 빌더

### 5. 명령어 계층
- **CommandHandler**: 중앙 명령어 라우터
- **CommandBase**: 공통 에러 핸들링 (Template Method 패턴)
- 9개 개별 Command 클래스

## 의존성 주입 (DI Container)

Awilix 기반 DI Container로 모든 서비스를 관리합니다.
- 등록: `src/container.js`
- 해결: `container.resolve('serviceName')`
- 모든 서비스는 Singleton으로 등록
- `databaseManager`는 `dbManager`의 별칭 (동일 인스턴스 참조)

## 데이터베이스 (PostgreSQL)

### Repository 패턴

DatabaseManager는 Facade 패턴으로 동작합니다. 모든 기존 호출자(`this.db.methodName()`)는 변경 없이 동작하며, 내부적으로 4개 Repository에 위임됩니다.

```
Caller (e.g., ActivityTracker)
    → this.db.updateDailyActivity(...)
        → DatabaseManager.updateDailyActivity(...)  (위임 메서드)
            → ActivityRepository.updateDailyActivity(...)  (실제 구현)
                → this.dbManager.query(...)  (Core 메서드)
                    → pg Pool.query(...)
```

### 주요 테이블
| 테이블 | 용도 | Repository |
|--------|------|-----------|
| `users` | 사용자 정보 + 잠수 상태 | DatabaseManager (Core) + AfkRepository |
| `guild_settings` | 서버별 설정 (game_roles JSONB 포함) | ConfigRepository |
| `user_activities_YYYYMM` | 월별 활동 기록 (자동 생성) | ActivityRepository |
| `post_integrations` | 음성채널 ↔ 포럼글 매핑 | ForumRepository |
| `forum_participants` | 포럼글 참가자 목록 | ForumRepository |
| `platform_templates` | 닉네임 플랫폼 템플릿 | PlatformTemplateService (직접 query) |
| `user_nicknames` | 사용자별 플랫폼 닉네임 | UserNicknameService (직접 query) |
| `schema_migrations` | 마이그레이션 이력 추적 | run_migration.js |

### 마이그레이션
- 범용 마이그레이션 러너: `scripts/run_migration.js`
- 파일 위치: `migrations/`
- 실행 방법:
  - `node scripts/run_migration.js` → 미적용 마이그레이션 전체 실행
  - `node scripts/run_migration.js 006` → 특정 번호만 실행
  - `node scripts/run_migration.js --status` → 적용 상태 확인
  - `node scripts/run_migration.js --dry-run` → 실행 없이 확인

## 운영 환경

### Production (Android/Termux)
- PM2 프로세스 관리 (`ecosystem-termux.config.cjs`)
- 메모리 제한: 256MB
- Errsole 로그 대시보드 (포트 8002)
- Express keep-alive 서버 (포트 3000)

### Development (WSL)
- PM2 또는 nodemon (`ecosystem.config.cjs`)
- 메모리 제한: 1GB

## 환경 변수 (`src/config/env.js`)

### 필수
- `TOKEN` - Discord 봇 토큰
- `GUILDID` - 대상 서버 ID
- `CLIENT_ID` - 봇 애플리케이션 ID
- `DATABASE_URL` - PostgreSQL 연결 문자열
- `LOG_CHANNEL_ID` - 로그 출력 채널

### 선택
- `FORUM_CHANNEL_ID`, `VOICE_CATEGORY_ID`, `FORUM_TAG_ID` - 포럼 연동
- `SCRIMMAGE_FORUM_CHANNEL_ID`, `LONG_TERM_FORUM_CHANNEL_ID` - 특수 포럼
- `ERRSOLE_HOST`, `ERRSOLE_PORT` - 로그 대시보드
- `SLACK_WEBHOOK_URL`, `ENABLE_SLACK_ALERTS` - Slack 알림
- `EXCLUDE_CHANNELID_1~6` - 추적 제외 채널
