## 필요한 패키지 설치

먼저 필요한 패키지들을 설치합니다:

```bash
# Termux 홈 디렉토리로 이동
cd ~

# discord_bot 디렉토리로 이동
cd discord_bot

# SQLite 관련 패키지 설치
npm install sqlite3 sqlite better-sqlite3
```

## JSON 데이터 마이그레이션

데이터를 마이그레이션하기 위해 다음 명령을 실행하세요:

node migrate-to-sqlite.js (사용 X)
```bash
# 마이그레이션 스크립트 실행
node migrate-to-lowdb.js
```

이 스크립트는 다음 작업을 수행합니다:
- 기존 JSON 파일 확인
- SQLite 데이터베이스 초기화
- 데이터 마이그레이션
- 원본 JSON 파일 백업

## 3. 봇 재시작

마이그레이션 후 봇을 재시작하세요:

```bash
# 기존 PM2 프로세스 중지
pm2 delete discord-bot

# 새로운 코드로 봇 시작
pm2 start src/index.js --name discord-bot

# 봇 상태 확인
pm2 status
pm2 logs discord-bot
```

## 4. 주요 변경사항

### 새로운 기능

1. **효율적인 데이터 저장**
    - JSON 파일 대신 SQLite 데이터베이스 사용
    - 빠른 읽기/쓰기 성능
    - 데이터 무결성 보장

2. **상세 활동 통계 (`/gap_stats`)**
    - 전체 서버 통계
    - 개인 사용자 통계
    - 시간대별 활동 분석
    - 채널별 사용 패턴

3. **향상된 달력 로그 기능**
    - 로그 데이터 장기 저장
    - 더 정확한 활동 분석

### 명령어 목록

봇은 다음 명령어를 지원합니다:

- `/gap_list [role]` - 역할별 활동 시간 목록 표시
- `/gap_config [role] [hours]` - 역할의 최소 활동 시간 설정
- `/gap_reset [role]` - 역할의 활동 시간 초기화
- `/gap_check [user]` - 특정 사용자의 활동 시간 확인
- `/gap_save` - 활동 데이터 저장
- `/gap_calendar [start_date] [end_date]` - 날짜별 활동 로그 확인
- `/gap_stats [days] [user]` - 상세 활동 통계 확인 (신규)

### 권한 문제

Termux에서 파일 권한 문제가 발생하는 경우:

```bash
# 데이터베이스 디렉토리 권한 확인
ls -la

# 필요시 권한 변경
chmod 755 .
chmod 644 activity_bot.db
```

## 백업 관리

정기적인 데이터베이스 백업을 위해:

```bash
# 백업 디렉토리 생성
mkdir -p ~/backups

# 데이터베이스 백업 (매일 실행 권장)
cp activity_bot.db ~/backups/activity_bot.$(date +%Y%m%d).db
```

자동 백업 스크립트를 만들고 cron job으로 등록하는 것도 좋은 방법입니다.