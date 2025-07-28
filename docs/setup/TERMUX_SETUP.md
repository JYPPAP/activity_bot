# 🤖 Termux Discord Bot 설정 가이드

**현재 버전**: 1.0.0 (PostgreSQL + TypeScript 마이그레이션)  
**마지막 업데이트**: 2025-07-17

## 🚀 빠른 시작

### **1단계: Termux 환경 설정**
```bash
# Termux에서 필수 패키지 설치 (PostgreSQL 포함)
npm run setup
```

### **2단계: 데이터베이스 선택 및 설정**
```bash
# PostgreSQL 사용 (권장)
export DB_TYPE=postgresql
npm run update

# 또는 SQLite 사용 (기본값)
export DB_TYPE=sqlite
npm run update
```

### **3단계: 대시보드 접속**
```bash
# 핸드폰 IP 확인
npm run ip

# 컴퓨터에서 브라우저 접속
# http://핸드폰IP:8002 (예: http://192.168.219.101:8002)
```

## 📋 실제 사용 가능한 명령어

### **🎯 주요 명령어**
```bash
# 메인 명령어 (코드 업데이트 + 봇 재시작)
npm run update

# PM2로 외부 접근 모드 시작
npm run external

# 핸드폰 IP 주소 확인
npm run ip

# Slack 알림 테스트
npm run slack
```

### **🔧 관리 명령어**
```bash
# PM2 상태 확인
npm run status

# 실시간 로그 확인
npm run logs

# PM2 재시작
npm run restart

# PM2 중지
npm run stop

# 개발 모드 (nodemon)
npm run dev

# Discord 명령어 등록
npm run register

# 데이터베이스 타입 체크
npm run type-check

# 빌드 (TypeScript)
npm run build
```

### **🧪 테스트 명령어**
```bash
# 로거 테스트
npm run test

# Slack 알림 테스트
npm run slack

# 기능 상태 확인 (Discord 명령어)
/기능상태              # 전체 기능 상태
/기능상태 core true    # 코어 기능만 상세히
/기능상태 database     # 데이터베이스 기능만
```

### **🎛️ 기능 관리 시스템**
```bash
# 환경변수로 기능 제어
export ENABLE_EMOJI_REACTIONS=true      # 이모지 반응 활성화
export ENABLE_FORUM_INTEGRATION=false   # 포럼 통합 비활성화
export ENABLE_SLACK_ALERTS=true         # Slack 알림 활성화
export ENABLE_REDIS=false               # Redis 캐싱 비활성화

# Discord 인텐트 제어 (Privileged Intent 필요)
export ENABLE_GUILD_MEMBERS_INTENT=false    # 멤버 정보 접근 (사용자 분류용)
export ENABLE_GUILD_PRESENCES_INTENT=false  # 온라인 상태 접근
export ENABLE_MESSAGE_CONTENT_INTENT=false  # 메시지 내용 접근

# 재시작 후 적용
npm run restart

# Discord에서 상태 확인
/기능상태 상세:true
```

## 🗄️ PostgreSQL 설정 및 관리 가이드

### **📋 빠른 PostgreSQL 설정**
```bash
# 🎯 자동 설정 (권장)
cd database/postgresql
./setup.sh

# 또는 NPM 명령어로 실행
npm run postgres:setup
```

### **📁 PostgreSQL 파일 구조**
```
database/postgresql/
├── README.md                    # 완전한 설명서
├── init.sql                     # 데이터베이스 스키마 초기화
├── postgresql.conf              # Termux 최적화 설정
├── setup.sh                     # 자동 설치 스크립트
├── backup.sh                    # 백업/복원 관리
├── migrate-from-sqlite.sql      # SQLite → PostgreSQL 마이그레이션
└── backups/                     # 백업 파일 저장소
```

### **🚀 자동 설치 스크립트 (setup.sh)**
```bash
# 완전 자동화된 PostgreSQL 설정
./database/postgresql/setup.sh

# 설치 과정:
# 1. PostgreSQL 패키지 설치
# 2. 데이터베이스 초기화
# 3. 설정 파일 복사 (Termux 최적화)
# 4. 서비스 시작
# 5. 데이터베이스 및 사용자 생성
# 6. 스키마 초기화 (8개 테이블)
# 7. 연결 테스트
# 8. 환경변수 파일 생성
```

### **🗃️ 데이터베이스 스키마 (init.sql)**
**자동 생성되는 테이블들:**
```sql
-- 핵심 테이블 (8개)
user_activity           # 사용자 활동 시간 추적
role_config            # 역할별 설정
activity_log           # 상세 활동 로그
afk_status            # 잠수 상태 관리
voice_channel_mapping # 음성 채널 매핑
guild_settings        # 길드별 설정
settings_audit_log    # 설정 변경 이력
daily_activity_stats  # 일일 통계

-- 성능 최적화 인덱스 (12개)
-- 자동 업데이트 트리거 (4개)
-- 유틸리티 뷰 (2개)
```

### **⚙️ Termux 최적화 설정 (postgresql.conf)**
```bash
# 메모리 제한 환경 고려
shared_buffers = 64MB          # 공유 버퍼
max_connections = 20           # 최대 연결 수
effective_cache_size = 256MB   # 캐시 크기
work_mem = 4MB                 # 작업 메모리
maintenance_work_mem = 32MB    # 유지보수 메모리

# 성능 튜닝
checkpoint_completion_target = 0.9
wal_buffers = 2MB
random_page_cost = 1.1
effective_io_concurrency = 2

# 로깅 최적화
log_statement = 'none'
log_duration = off
log_min_duration_statement = 5000ms
```

### **💾 백업 및 복원 시스템 (backup.sh)**
```bash
# 🔄 백업 명령어
npm run postgres:backup                    # 전체 백업
npm run postgres:backup:compress          # 압축 백업
./database/postgresql/backup.sh backup --data-only   # 데이터만 백업

# 📋 백업 관리
npm run postgres:list                      # 백업 목록
npm run postgres:clean                     # 오래된 백업 정리

# 🔧 복원
npm run postgres:restore                   # 백업 복원
./database/postgresql/backup.sh restore --file backup_20250717_143022.sql

# 백업 파일 형식
backup_full_YYYYMMDD_HHMMSS.sql     # 전체 백업
backup_data_YYYYMMDD_HHMMSS.sql     # 데이터만
backup_schema_YYYYMMDD_HHMMSS.sql   # 스키마만
*.sql.gz                            # 압축 백업
```

### **🔄 SQLite → PostgreSQL 마이그레이션**
```bash
# 1. 자동 마이그레이션 스크립트 실행
cd database/postgresql

# 2. SQLite 데이터 내보내기
sqlite3 ../../data/discord_bot.db < migrate-from-sqlite.sql

# 3. PostgreSQL로 데이터 가져오기
psql -d discord_bot -f migrate-from-sqlite.sql

# 마이그레이션되는 데이터:
# - user_activity (사용자 활동)
# - role_config (역할 설정)
# - activity_log (활동 로그)
# - afk_status (AFK 상태)
# - voice_channel_mapping (채널 매핑)
# - guild_settings (길드 설정)

# 데이터 검증 자동 실행
# - 테이블별 레코드 수 확인
# - 데이터 유효성 검사
# - 날짜 범위 확인
```

### **🎛️ NPM 관리 명령어**
```bash
# PostgreSQL 서비스 관리
npm run postgres:start           # PostgreSQL 시작
npm run postgres:stop            # PostgreSQL 중지
npm run postgres:restart         # PostgreSQL 재시작
npm run postgres:status          # 상태 확인
npm run postgres:logs            # 로그 확인

# 데이터베이스 관리
npm run postgres:setup           # 완전 설정
npm run postgres:backup          # 백업 생성
npm run postgres:restore         # 백업 복원
npm run postgres:list            # 백업 목록
npm run postgres:clean           # 정리
```

### **🔧 환경변수 설정 (.env)**
```env
# PostgreSQL 활성화
ENABLE_POSTGRESQL=true

# PostgreSQL 연결 설정
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=discord_bot
POSTGRES_USER=discord_bot
POSTGRES_PASSWORD=          # 로컬 환경에서는 비워둠
POSTGRES_SSL=false

# Redis 캐싱 (PostgreSQL과 함께 사용)
ENABLE_REDIS=true
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=1
```

### **📊 데이터베이스 모니터링**
```bash
# 데이터베이스 상태 확인
psql -d discord_bot -c "
SELECT 
    datname,
    numbackends,
    xact_commit,
    xact_rollback
FROM pg_stat_database 
WHERE datname = 'discord_bot';"

# 테이블 크기 확인
psql -d discord_bot -c "
SELECT 
    relname,
    pg_size_pretty(pg_total_relation_size(relid)) as size
FROM pg_stat_user_tables 
ORDER BY pg_total_relation_size(relid) DESC;"

# 인덱스 사용량 확인
psql -d discord_bot -c "
SELECT 
    schemaname, 
    tablename, 
    indexname, 
    idx_scan
FROM pg_stat_user_indexes 
ORDER BY idx_scan DESC;"
```

### **🔍 성능 최적화 가이드**
```bash
# 정기 유지보수 (월 1회 권장)
psql -d discord_bot -c "VACUUM ANALYZE;"

# 특정 테이블 정리
psql -d discord_bot -c "VACUUM ANALYZE user_activity;"

# 통계 업데이트
psql -d discord_bot -c "ANALYZE;"

# 디스크 사용량 확인
psql -d discord_bot -c "
SELECT pg_size_pretty(pg_database_size('discord_bot')) as db_size;"
```

### **🚨 문제 해결 가이드**

#### **연결 문제**
```bash
# 1. 서비스 상태 확인
npm run postgres:status

# 2. 서비스 재시작
npm run postgres:restart

# 3. 로그 확인
npm run postgres:logs

# 4. 수동 연결 테스트
psql -h localhost -p 5432 -d discord_bot -c "SELECT 1;"
```

#### **권한 문제**
```bash
# 권한 확인
psql -d discord_bot -c "\du"

# 권한 부여
psql -d discord_bot -c "
GRANT ALL PRIVILEGES ON DATABASE discord_bot TO discord_bot;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO discord_bot;"
```

#### **성능 문제**
```bash
# 느린 쿼리 확인 (pg_stat_statements 필요)
psql -d discord_bot -c "
SELECT query, calls, total_time, mean_time 
FROM pg_stat_statements 
ORDER BY total_time DESC LIMIT 10;"

# 락 대기 확인
psql -d discord_bot -c "
SELECT pid, usename, query, state 
FROM pg_stat_activity 
WHERE state = 'active';"
```

#### **SQLite로 폴백**
```bash
# 긴급 상황 시 SQLite 사용
export DB_TYPE=sqlite
npm run restart

# PostgreSQL 문제 해결 후 다시 전환
export DB_TYPE=postgresql
npm run restart
```

### **📖 추가 정보**
- **완전한 문서**: `database/postgresql/README.md` 참조
- **백업 정책**: 일일 자동 백업 (30일 보관)
- **보안**: 로컬 연결만 허용 (trust 인증)
- **모니터링**: Errsole 대시보드에서 DB 상태 확인
- **확장성**: 향후 Master-Slave 구성 가능

## 🌐 외부 접근 설정

### **현재 설정 (이미 구성됨)**
- **Errsole Host**: `0.0.0.0` (외부 접근 허용)
- **포트**: `8002`
- **외부 접근**: 같은 네트워크 내에서 가능

### **접속 방법**
```bash
# 1. 핸드폰 IP 확인
npm run ip
# 출력 예: 192.168.219.101

# 2. 컴퓨터 브라우저에서 접속
# http://192.168.219.101:8002
```

### **접속 테스트**
```bash
# 핸드폰에서 로컬 접속 테스트
curl http://localhost:8002

# 핸드폰에서 외부 IP 접속 테스트  
curl http://$(npm run ip --silent):8002
```

## 🔔 Slack 알림 설정

### **환경변수 확인 (.env 파일)**
```env
# Slack 알림 활성화
ENABLE_SLACK_ALERTS=true

# Slack Webhook URL
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# Slack 채널
SLACK_CHANNEL=#discord-bot-alerts

# 최소 알림 레벨
SLACK_MIN_LEVEL=error
```

### **Slack 알림 테스트**
```bash
# Slack으로 테스트 메시지 전송
npm run slack

# 성공 시 Slack 채널에 메시지 수신 확인
```

## 📊 모니터링 및 관리

### **시스템 상태 확인**
```bash
# PM2 프로세스 상태
npm run status

# 실시간 로그 모니터링
npm run logs

# 시스템 리소스 확인
free -h
df -h
```

### **Errsole 대시보드**
- **안드로이드 접속**: http://localhost:8002
- **컴퓨터 접속**: http://핸드폰IP:8002
- **로그 보관**: 180일 (6개월)
- **로그 파일**: `logs/discord-bot-prod.log.sqlite`

### **로그 파일 위치**
```bash
# PM2 로그
logs/combined.log
logs/out.log  
logs/error.log

# Errsole SQLite 로그
logs/discord-bot-prod.log.sqlite
logs/discord-bot-dev.log.sqlite
```

## 🛠 문제 해결

### **1. 봇이 시작되지 않는 경우**
```bash
# PM2 프로세스 완전 정리
pm2 delete all
pm2 kill

# 다시 시작
npm run update
```

### **2. 포트 충돌 오류**
```bash
# 포트 사용 프로세스 확인 (제한적)
ps aux | grep node

# PM2 프로세스 정리 후 재시작
pm2 delete discord-bot
npm run update
```

### **3. 외부 접근이 안 되는 경우**
```bash
# IP 주소 재확인
npm run ip

# 네트워크 연결 확인
ping 8.8.8.8

# .env 파일의 ERRSOLE_HOST 확인
# ERRSOLE_HOST=0.0.0.0 인지 확인
```

### **4. Slack 알림이 안 되는 경우**
```bash
# Slack 설정 테스트
npm run slack

# .env 파일 확인
# ENABLE_SLACK_ALERTS=true
# SLACK_WEBHOOK_URL이 올바른지 확인

# 수동 테스트
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"Test from Termux"}' \
  SLACK_WEBHOOK_URL
```

### **5. 메모리 부족 문제**
```bash
# 메모리 사용량 확인
free -h
pm2 list

# 메모리 정리
pm2 restart discord-bot
```

### **6. PostgreSQL 연결 문제**
```bash
# PostgreSQL 서비스 상태 확인
pg_ctl -D $PREFIX/var/lib/postgresql status

# PostgreSQL 시작
pg_ctl -D $PREFIX/var/lib/postgresql start

# 연결 테스트
psql -h localhost -p 5432 -d discord_bot -U postgres

# 로그 확인
tail -f $PREFIX/var/lib/postgresql/pg_log/postgresql-*.log

# SQLite로 폴백
export DB_TYPE=sqlite
npm run restart
```

### **7. Redis 연결 문제**
```bash
# Redis 서비스 상태 확인
redis-cli ping

# Redis 서비스 시작
redis-server --daemonize yes

# Redis 로그 확인
redis-cli monitor

# Redis 없이 실행 (캐시 비활성화)
export REDIS_ENABLED=false
npm run restart
```

### **8. TypeScript 컴파일 오류**
```bash
# 타입 체크
npm run type-check

# 빌드 테스트
npm run build

# 의존성 재설치
rm -rf node_modules package-lock.json
npm install

# 개발 모드로 실행
npm run dev
```

### **9. Discord 인텐트 오류 (Used disallowed intents)**
```bash
# ❌ 오류 메시지
# Error: Used disallowed intents

# 🔧 해결 방법 1: Discord Developer Portal 설정 (권장)
# 1. https://discord.com/developers/applications 접속
# 2. 해당 봇 애플리케이션 선택
# 3. 좌측 "Bot" 메뉴 클릭
# 4. "Privileged Gateway Intents" 섹션에서 활성화:
#    - Server Members Intent ✅
#    - Presence Intent ✅
#    - Message Content Intent ✅

# 🔧 해결 방법 2: 인텐트 비활성화 (임시)
export ENABLE_GUILD_MEMBERS_INTENT=false
export ENABLE_GUILD_PRESENCES_INTENT=false
export ENABLE_MESSAGE_CONTENT_INTENT=false
npm run restart

# 📋 기능별 인텐트 요구사항
# - 기본 기능: 인텐트 설정 불필요
# - 사용자 분류: ENABLE_GUILD_MEMBERS_INTENT=true 필요
# - 온라인 상태: ENABLE_GUILD_PRESENCES_INTENT=true 필요
# - 메시지 분석: ENABLE_MESSAGE_CONTENT_INTENT=true 필요

# ✅ 현재 사용 중인 인텐트 확인
# 봇 시작 로그에서 "총 X개 인텐트 사용됨" 메시지 확인
```

## ⚡ 성능 최적화

### **Termux 환경 최적화**
```bash
# 불필요한 패키지 정리
npm prune

# 캐시 정리  
npm cache clean --force

# Node.js 메모리 사용량 모니터링
pm2 monit

# TypeScript 빌드 최적화
npm run build

# PostgreSQL 성능 튜닝
psql discord_bot -c "VACUUM ANALYZE;"

# Redis 메모리 최적화
redis-cli config set maxmemory 100mb
redis-cli config set maxmemory-policy allkeys-lru
```

### **PM2 설정 (이미 최적화됨)**
- **메모리 제한**: 512MB
- **최대 재시작**: 5회
- **재시작 지연**: 6초
- **최소 업타임**: 30초

## 🔧 고급 설정

### **환경 변수 커스터마이징**
```bash
# 다른 포트 사용 시
export ERRSOLE_PORT=8003
npm run update

# 호스트 설정 변경 시  
export ERRSOLE_HOST=localhost  # 로컬만 접근
npm run update

# 데이터베이스 타입 변경
export DB_TYPE=postgresql  # 또는 sqlite
npm run update

# Redis 설정 변경
export REDIS_ENABLED=false  # Redis 비활성화
export REDIS_HOST=localhost
export REDIS_PORT=6379
npm run update

# PostgreSQL 연결 설정
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_DB=discord_bot
export POSTGRES_USER=postgres
npm run update
```

### **개발 환경 설정**
```bash
# 개발 모드 (nodemon + 자동 재시작)
npm run dev

# 로거만 테스트
npm run test
```

## 📱 일반적인 사용 흐름

### **일상적인 봇 관리**
```bash
# 1. 코드 업데이트 및 봇 재시작
npm run update

# 2. 상태 확인
npm run status

# 3. 대시보드 접속하여 로그 확인
# http://핸드폰IP:8002

# 4. 필요시 Slack 알림 테스트
npm run slack
```

### **문제 발생 시 진단**
```bash
# 1. 현재 상태 확인
npm run status
npm run logs

# 2. 완전 재시작
pm2 delete all
npm run update

# 3. 접속 테스트
curl http://localhost:8002
```

## 🔒 보안 고려사항

### **✅ 안전한 사용법**
- **같은 Wi-Fi 네트워크 내에서만 외부 접근 가능**
- **공유기 방화벽으로 보호됨**
- **Slack webhook URL 보안 유지**

### **⚠️ 주의사항**  
- **공용 Wi-Fi에서 외부 접근 금지**
- **민감한 로그 정보 주의**
- **.env 파일 외부 공유 금지**

## 🎉 기능 요약

### **✅ 현재 구현된 기능**

#### **🗄️ 데이터베이스 시스템**
- ✅ **PostgreSQL + SQLite 듀얼 지원**
- ✅ **완전 자동화된 PostgreSQL 설정** (setup.sh)
- ✅ **압축 백업 시스템** (backup.sh)
- ✅ **SQLite → PostgreSQL 마이그레이션** 도구
- ✅ **Redis 캐싱 시스템**
- ✅ **8개 최적화된 테이블 스키마**
- ✅ **12개 성능 인덱스 + 4개 트리거**

#### **🛠️ 개발 환경**
- ✅ **TypeScript 완전 마이그레이션** (strict mode)
- ✅ **의존성 주입 (DI) 패턴**
- ✅ **exactOptionalPropertyTypes 지원**
- ✅ **조건부 기능 관리 시스템** (19개 기능)
- ✅ **환경별 기능 활성화/비활성화**
- ✅ **실시간 기능 상태 모니터링**

#### **📊 모니터링 시스템**
- ✅ Errsole 로깅 시스템 (SQLite)
- ✅ 웹 대시보드 (포트 8002)
- ✅ 외부 네트워크 접근 (0.0.0.0 바인딩)
- ✅ Slack 실시간 알림
- ✅ 6개월 로그 보관
- ✅ **성능 메트릭 수집**
- ✅ **상세한 오류 리포팅**

#### **🚀 운영 관리**
- ✅ PM2 프로세스 관리
- ✅ 자동 재시작 및 복구
- ✅ 환경변수 중앙 관리
- ✅ **NPM 스크립트 통합 관리** (25개 명령어)
- ✅ **Termux 환경 최적화**

### **🎯 주요 장점**
- **한 번의 명령어로 모든 기능 실행** (`npm run update`)
- **컴퓨터에서 핸드폰 봇 원격 모니터링**
- **실시간 Slack 알림으로 즉시 문제 인지**
- **PostgreSQL로 확장성 확보**
- **Redis로 성능 최적화**
- **TypeScript로 타입 안전성 보장**

---

## 🆘 긴급 복구 방법

모든 방법이 실패할 경우:

```bash
# 1. 모든 PM2 프로세스 종료
pm2 kill

# 2. 기본 노드 실행으로 테스트
node src/index.js

# 3. 정상 작동 확인 후 PM2 재시작
# Ctrl+C로 종료 후
npm run update
```

---

**📞 지원**: 이 가이드를 따라하면 Termux 환경에서 안정적으로 Discord Bot을 실행할 수 있습니다!  
**🔄 업데이트**: 새로운 기능 추가 시 이 문서를 업데이트하세요.