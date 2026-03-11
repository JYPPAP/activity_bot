# 서비스 목록 및 역할

## 인프라 서비스

### DatabaseManager (`services/DatabaseManager.js`)
- PostgreSQL 연결 풀 관리 (min: 2, max: 10)
- 모든 테이블의 CRUD 메서드 제공
- 30초 TTL 캐싱, SSL 지원 (프로덕션)
- JSON → PostgreSQL 마이그레이션 헬퍼 포함

### LogService (`services/logService.js`)
- Discord 로그 채널로 음성 활동 로그 배치 전송
- 30초 버퍼링 후 한꺼번에 전송 (API 레이트 리밋 방지)
- 입장(초록)/퇴장(빨강)/생성(파랑) 색상 구분 Embed

### FileManager (`services/fileManager.js`)
- **레거시**: LowDB(JSON) 시절의 파일 기반 저장소
- 현재는 PostgreSQL로 대체됨, 일부 호환성 유지

## 활동 추적 서비스

### ActivityTracker (`services/activityTracker.js`)
- 음성 채널 입퇴장 실시간 추적
- 세션 관리: 봇 재시작 시 활성 세션 복구
- 주기적 DB 저장 (데이터 손실 방지)
- 비정상 활동 감지 (24시간+ 세션 등)

### ActivityReportService (`services/activityReportService.js`)
- 역할별 활동 보고서 생성
- UserClassificationService와 연동하여 활동/비활동 분류
- Embed 형태로 보고서 출력

### UserClassificationService (`services/UserClassificationService.js`)
- 활동 메트릭 기반 사용자 분류 (활동/비활동/AFK)
- 역할별 기준 시간 비교
- AFK 역할 자동 감지

## 구인구직 서비스

### RecruitmentService (`services/RecruitmentService.js`)
- 음성 채널 구인구직 핵심 비즈니스 로직
- 참가 버튼 처리, 채널 생성/삭제 시 포럼글 연동
- 내전(scrimmage), 장기(long-term) 특수 타입 지원

### ForumPostManager (`services/ForumPostManager.js`)
- 포럼 게시글 생성/수정/삭제
- 참가자 목록 Embed 동적 갱신
- 버튼/태그 포함 게시글 빌더

### MappingService (`services/MappingService.js`)
- 음성채널 ID ↔ 포럼 게시글 ID 매핑 관리
- 메모리 캐시 + PostgreSQL 이중 저장
- 업데이트 큐 중복 제거

### ParticipantTracker (`services/ParticipantTracker.js`)
- 채널 참가자 수 카운팅 및 분류
- [관전], [대기] 태그별 그룹핑
- 봇 자동 제외

### EmojiReactionService (`services/EmojiReactionService.js`)
- 이모지 반응 기반 참가/퇴장 처리
- 버튼 클릭과 이모지 반응 양방향 동기화
- 봇 재시작 시 기존 참가자 캐시 복구

### PermissionService (`services/PermissionService.js`)
- 구인구직 기능 접근 권한 제어
- 유저 화이트리스트, 관리자 역할 체크

## 닉네임 서비스

### UserNicknameService (`services/UserNicknameService.js`)
- 유저별 플랫폼 닉네임 CRUD
- 제한: 유저당 최대 5개, 플랫폼당 3개 계정
- 중복 감지, URL 생성

### PlatformTemplateService (`services/PlatformTemplateService.js`)
- 플랫폼 템플릿 관리 (Steam, Discord, Epic 등)
- URL 패턴 기반 프로필 링크 자동 생성
- 서버당 최대 20개 플랫폼

### VoiceChannelNicknameManager (`managers/VoiceChannelNicknameManager.js`)
- 음성 채널 입장 시 닉네임 앞에 태그 자동 추가
- [관전], [대기] 등 상태 태그 관리

## 이벤트/유틸리티

### EventManager (`services/eventManager.js`)
- Discord 이벤트 → 핸들러 매핑 관리
- 하나의 이벤트에 여러 핸들러 등록 가능
- 이벤트별 에러 격리

### VoiceChannelManager (`services/VoiceChannelManager.js`)
- 추적 대상 음성 채널 판별 (카테고리 기반)
- 채널 이름/인원 변경 감지
- 입장/퇴장/이동 상태 분석

## DI Container 등록 현황 (`src/container.js`)

모든 서비스는 Singleton으로 등록되며, 계층별로 관리됩니다:
1. 설정 값 (client, guildId, channelId 등)
2. 인프라 (DatabaseManager, LogService)
3. 코어 (EventManager, ActivityTracker, ParticipantTracker)
4. 도메인 (VoiceChannelManager, ForumPostManager, MappingService 등)
5. 애플리케이션 (RecruitmentService, EmojiReactionService, VoiceForumService)
6. UI (ButtonHandler, ModalHandler, InteractionRouter 등)
7. 명령어 (각 Command 클래스)
8. 통합 (CommandHandler)
