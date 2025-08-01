# 🤖 Discord Activity Bot - 완전 설치 및 관리 가이드

**현재 버전**: 2.0.0 (PostgreSQL + TypeScript 완전 마이그레이션)  
**마지막 업데이트**: 2025-01-28  
**지원 환경**: Termux (Android), Linux, macOS

## 📋 시스템 요구사항

### 필수 요구사항
- **Node.js**: >= 18.0.0 LTS
- **PostgreSQL**: >= 13.0 (권장 데이터베이스)
- **메모리**: 최소 256MB, 권장 512MB
- **저장 공간**: 최소 1GB 여유 공간

### 선택사항
- **Redis**: >= 6.0 (캐싱 성능 향상)
- **PM2**: 프로덕션 환경 프로세스 관리

---

## 🚀 빠른 시작 (1분 설치)

### **1단계: Termux 환경 설정**
```bash
# 필수 패키지 설치 (PostgreSQL 포함)
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

---

## 🗄️ PostgreSQL 완전 설정 가이드

### **🎯 자동 설정 (권장 방법)**

**완전 자동화된 PostgreSQL 설정:**
```bash
# 방법 1: NPM 스크립트 사용 (권장)
npm run postgres:setup

# 방법 2: 설정 스크립트 직접 실행
cd database/postgresql
./setup.sh
```

**자동 설정이 수행하는 작업:**
- ✅ PostgreSQL 설치 및 초기화
- ✅ Termux 최적화 설정 적용 (`postgresql.conf`)
- ✅ 데이터베이스 및 사용자 생성
- ✅ 테이블 스키마 초기화 (`init.sql`)
- ✅ 백업 스크립트 설정
- ✅ 환경변수 파일 생성
- ✅ 연결 테스트 및 검증

### **📁 PostgreSQL 파일 구조**
```
database/postgresql/
├── README.md                    # 완전한 설명서
├── init.sql                     # 데이터베이스 스키마 초기화 (8개 테이블)
├── postgresql.conf              # Termux 최적화 설정
├── setup.sh                     # 자동 설치 스크립트
├── backup.sh                    # 백업/복원 관리
├── migrate-from-sqlite.sql      # SQLite → PostgreSQL 마이그레이션
└── backups/                     # 백업 파일 저장소 (자동 생성)
```

### **🗃️ 데이터베이스 스키마 (자동 생성)**

**핵심 테이블 (8개):**
```sql
user_activity           # 사용자 활동 시간 추적
role_config            # 역할별 설정
activity_log           # 상세 활동 로그
afk_status            # 잠수 상태 관리
voice_channel_mapping # 음성 채널 매핑
guild_settings        # 길드별 설정
settings_audit_log    # 설정 변경 이력
daily_activity_stats  # 일일 통계

# 자동 생성되는 추가 요소:
# - 성능 최적화 인덱스 (12개)
# - 자동 업데이트 트리거 (4개)
# - 유틸리티 뷰 (2개)
```

### **⚙️ Termux 최적화 설정**
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
```

### **💾 백업 및 복원 시스템**
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
./database/postgresql/backup.sh restore --file backup_20250128_143022.sql
```

### **🔄 SQLite → PostgreSQL 마이그레이션**
```bash
# 기존 SQLite 데이터가 있는 경우 자동 마이그레이션
cd database/postgresql

# 1. SQLite 데이터 내보내기
sqlite3 ../../data/discord_bot.db < migrate-from-sqlite.sql

# 2. PostgreSQL로 데이터 가져오기
psql -d discord_bot -f migrate-from-sqlite.sql

# 마이그레이션되는 데이터:
# - user_activity (사용자 활동)
# - role_config (역할 설정)
# - activity_log (활동 로그)
# - afk_status (AFK 상태)
# - voice_channel_mapping (채널 매핑)
# - guild_settings (길드 설정)
```

---

## 📦 완전 설치 가이드 (수동 설정)

### **1. Termux 환경 준비**

```bash
# 패키지 목록 업데이트
pkg update && pkg upgrade -y

# 필수 개발 도구 설치
pkg install git nodejs-lts postgresql redis openssh -y

# PM2 글로벌 설치
npm install -g pm2

# SSH 접속을 위한 비밀번호 설정
passwd
```

### **2. 프로젝트 설치**

```bash
# 홈 디렉토리로 이동
cd ~

# 프로젝트 클론
git clone <repository-url> activity_bot

# 프로젝트 디렉토리로 이동
cd activity_bot

# 종속성 설치
npm install
```

### **3. 환경 설정**

```bash
# 환경변수 파일 생성
cp .env.example .env.production

# 환경변수 파일 편집
nano .env.production
```

**필수 환경변수 설정:**
```env
# Discord Bot 설정
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_client_id
DISCORD_GUILD_ID=your_guild_id

# PostgreSQL 설정
ENABLE_POSTGRESQL=true
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=discord_bot
POSTGRES_USER=discord_bot
POSTGRES_PASSWORD=          # 로컬 환경에서는 비워둠
POSTGRES_SSL=false

# Redis 캐싱 (선택사항)
ENABLE_REDIS=true
REDIS_HOST=localhost
REDIS_PORT=6379

# 모니터링 설정
ERRSOLE_HOST=0.0.0.0         # 외부 접근 허용
ERRSOLE_PORT=8002

# 기능 관리 (19개 기능 개별 제어)
ENABLE_EMOJI_REACTIONS=true
ENABLE_FORUM_INTEGRATION=true
ENABLE_SLACK_ALERTS=true
ENABLE_GUILD_MEMBERS_INTENT=false    # Privileged Intent 필요
```

### **4. 데이터베이스 초기화**

```bash
# PostgreSQL 서비스 시작
npm run postgres:start

# 데이터베이스 초기화 (자동)
npm run postgres:setup

# 연결 테스트
npm run postgres:status
```

### **5. 프로덕션 배포**

```bash
# TypeScript 컴파일
npm run build

# 환경변수 검증
NODE_ENV=production node -e "
require('dotenv').config({ path: '.env.production' });
const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'POSTGRES_HOST', 'POSTGRES_DB'];
const missing = required.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error('❌ 누락된 환경 변수:', missing);
  process.exit(1);
} else {
  console.log('✅ 모든 필수 환경 변수 설정됨');
}
"

# Discord 명령어 등록 (최초 1회)
npm run register:prod

# 프로덕션 시작
npm run start:prod
```

---

## 🎛️ 실제 사용 명령어 가이드

### **🎯 주요 명령어 (일상 관리)**
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

# TypeScript 타입 체크
npm run type-check

# 빌드 (TypeScript)
npm run build
```

### **🗄️ PostgreSQL 관리 명령어**
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

### **🧪 테스트 및 진단 명령어**
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

---

## 🎛️ 고급 기능 관리 시스템

### **환경변수 기반 기능 제어 (19개 기능)**
```bash
# 기본 기능
export ENABLE_EMOJI_REACTIONS=true      # 이모지 반응 활성화
export ENABLE_FORUM_INTEGRATION=false   # 포럼 통합 비활성화
export ENABLE_SLACK_ALERTS=true         # Slack 알림 활성화
export ENABLE_REDIS=true                # Redis 캐싱 활성화

# Discord 인텐트 제어 (Privileged Intent 필요)
export ENABLE_GUILD_MEMBERS_INTENT=false    # 멤버 정보 접근 (사용자 분류용)
export ENABLE_GUILD_PRESENCES_INTENT=false  # 온라인 상태 접근
export ENABLE_MESSAGE_CONTENT_INTENT=false  # 메시지 내용 접근

# 재시작 후 적용
npm run restart

# Discord에서 상태 확인
/기능상태 상세:true
```

---

## 🚀 PM2 프로덕션 관리

### **PM2 설정 및 배포**
```bash
# PM2 설치 확인
pm2 --version

# 설정 파일 확인
cat ecosystem-termux.config.cjs

# 완전 자동 배포 (빌드 + PM2 시작)
npm run start:prod

# 수동 배포 단계별 실행
npm run build                                              # 1. TypeScript 컴파일
pm2 start ecosystem-termux.config.cjs --env production   # 2. PM2로 시작
```

### **PM2 프로세스 관리**
```bash
# 프로세스 상태 확인
pm2 status
pm2 describe discord-bot

# 로그 확인
pm2 logs discord-bot                    # 실시간 로그
pm2 logs discord-bot --lines 100       # 최근 100줄
pm2 logs discord-bot --err              # 에러 로그만

# 실시간 모니터링
pm2 monit

# 프로세스 관리
pm2 restart discord-bot                 # 재시작
pm2 reload discord-bot                  # 무중단 재시작
pm2 stop discord-bot                    # 중지
pm2 delete discord-bot                  # 삭제
```

### **자동 시작 설정**
```bash
# PM2 시작 스크립트 저장
pm2 save

# Termux 부팅 스크립트 생성
mkdir -p ~/.termux/boot/
cat > ~/.termux/boot/start-discord-bot.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/sh

# 로그 파일 설정
LOG_FILE="$HOME/discord-bot-startup.log"
exec 1> >(tee -a "$LOG_FILE")
exec 2>&1

echo "$(date): Discord Bot 자동 시작 스크립트 실행"

# PostgreSQL 시작
echo "$(date): PostgreSQL 시작 중..."
pg_ctl -D $PREFIX/var/lib/postgresql start

# 잠시 대기 (PostgreSQL 시작 완료 대기)
sleep 5

# Discord Bot 프로젝트 디렉토리로 이동
cd /data/data/com.termux/files/home/activity_bot

# PM2로 Discord Bot 시작
echo "$(date): Discord Bot PM2 시작 중..."
pm2 resurrect

echo "$(date): 자동 시작 완료"
EOF

chmod +x ~/.termux/boot/start-discord-bot.sh
```

---

## 🌐 외부 접근 및 모니터링

### **네트워크 설정**
```bash
# 현재 IP 확인
npm run ip

# 또는 수동 확인
ifconfig wlan0 | grep inet
termux-wifi-connectioninfo | grep ip_address

# 접속 테스트
curl http://localhost:8002
curl http://$(npm run ip --silent):8002
```

### **외부 접근 URL**
- **Errsole 대시보드**: `http://[폰IP]:8002`
- **PostgreSQL**: `[폰IP]:5432` (필요시에만 외부 개방)

### **모니터링 시스템**
- **Errsole 대시보드**: 실시간 로그 및 에러 추적
- **로그 보관**: 180일 (6개월)
- **로그 파일**: `logs/discord-bot-prod.log.sqlite`

---

## 🔔 Slack 알림 설정

### **환경변수 설정**
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

---

## 🛠️ 문제 해결 및 트러블슈팅

### **1. 봇이 시작되지 않는 경우**
```bash
# PM2 프로세스 완전 정리
pm2 delete all
pm2 kill

# 다시 시작
npm run update
```

### **2. PostgreSQL 연결 문제**
```bash
# PostgreSQL 서비스 상태 확인
npm run postgres:status

# PostgreSQL 시작
npm run postgres:start

# 연결 테스트
psql -h localhost -p 5432 -d discord_bot -c "SELECT 1;"

# 로그 확인
npm run postgres:logs

# SQLite로 폴백 (긴급 상황)
export DB_TYPE=sqlite
npm run restart
```

### **3. Discord 인텐트 오류 (Used disallowed intents)**
```bash
# ❌ 오류 메시지: Error: Used disallowed intents

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
```

### **4. 외부 접근이 안 되는 경우**
```bash
# IP 주소 재확인
npm run ip

# 네트워크 연결 확인
ping 8.8.8.8

# .env 파일의 ERRSOLE_HOST 확인
# ERRSOLE_HOST=0.0.0.0 인지 확인
```

### **5. 메모리 부족 문제**
```bash
# 메모리 사용량 확인
free -h
pm2 list

# 메모리 정리
pm2 restart discord-bot
```

### **6. TypeScript 컴파일 오류**
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

---

## ⚡ 성능 최적화 및 유지보수

### **Termux 환경 최적화**
```bash
# 불필요한 패키지 정리
npm prune

# 캐시 정리  
npm cache clean --force

# Node.js 메모리 사용량 모니터링
pm2 monit

# PostgreSQL 성능 튜닝
psql discord_bot -c "VACUUM ANALYZE;"

# Redis 메모리 최적화
redis-cli config set maxmemory 100mb
redis-cli config set maxmemory-policy allkeys-lru
```

### **정기 유지보수 작업**
```bash
# PostgreSQL 정기 유지보수 (월 1회 권장)
psql -d discord_bot -c "VACUUM ANALYZE;"

# 특정 테이블 정리
psql -d discord_bot -c "VACUUM ANALYZE user_activity;"

# 백업 생성 (주간)
npm run postgres:backup:compress

# 오래된 백업 정리 (30일 이전)
npm run postgres:clean
```

---

## 📊 시스템 모니터링 및 상태 확인

### **시스템 상태 확인**
```bash
# PM2 프로세스 상태
npm run status

# 실시간 로그 모니터링
npm run logs

# 시스템 리소스 확인
free -h
df -h

# 네트워크 연결 확인
netstat -tulpn | grep -E "(5432|8002)"
```

### **데이터베이스 모니터링**
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

---

## ✅ 프로덕션 체크리스트

### **설치 및 설정**
- [ ] Termux 환경 설정 완료
- [ ] PostgreSQL 설치 및 최적화 설정 적용
- [ ] 프로덕션 데이터베이스 및 사용자 생성
- [ ] 테이블 스키마 초기화 완료
- [ ] .env.production 파일 설정 및 검증

### **배포**
- [ ] TypeScript 빌드 완료 및 검증
- [ ] PM2 설치 및 설정 완료
- [ ] 프로덕션 환경 실행 테스트 완료
- [ ] Discord 명령어 등록 완료

### **관리 도구**
- [ ] PostgreSQL 관리 명령어 테스트
- [ ] 백업 스크립트 설정 및 테스트
- [ ] PM2 프로세스 관리 테스트
- [ ] 자동 시작 설정 완료

### **모니터링**
- [ ] 로그 순환 설정 완료
- [ ] Errsole 대시보드 접근 확인
- [ ] 시스템 리소스 모니터링 설정
- [ ] 네트워크 접근 설정 (필요시)

### **보안**
- [ ] PostgreSQL 접근 권한 설정
- [ ] 환경 변수 파일 권한 설정 (`chmod 600 .env.production`)
- [ ] 불필요한 포트 외부 개방 차단
- [ ] 정기 백업 스케줄 설정

---

## 🔒 보안 고려사항

### **✅ 안전한 사용법**
- **같은 Wi-Fi 네트워크 내에서만 외부 접근 가능**
- **공유기 방화벽으로 보호됨**
- **Slack webhook URL 보안 유지**

### **⚠️ 주의사항**  
- **공용 Wi-Fi에서 외부 접근 금지**
- **민감한 로그 정보 주의**
- **.env 파일 외부 공유 금지**

---

## 🆘 긴급 복구 방법

모든 방법이 실패할 경우:

```bash
# 1. 모든 PM2 프로세스 종료
pm2 kill

# 2. PostgreSQL 서비스 확인
npm run postgres:status

# 3. 기본 노드 실행으로 테스트
NODE_ENV=production node dist/index.js

# 4. 정상 작동 확인 후 PM2 재시작
# Ctrl+C로 종료 후
npm run update
```

---

## 📞 지원 및 추가 리소스

### **주요 로그 파일 위치**
- **PostgreSQL**: `$PREFIX/var/lib/postgresql/pg_log/`
- **PM2**: `~/.pm2/logs/`
- **봇 애플리케이션**: Errsole 대시보드 (`http://[폰IP]:8002`)
- **시스템**: `dmesg`, Termux 로그

### **추가 문서**
- **PostgreSQL 관련**: `database/postgresql/README.md`
- **설정 가이드**: `docs/setup/TERMUX_SETUP.md`
- **프로덕션 가이드**: `docs/setup/termux-production-setup.md`

---

**📞 지원**: 이 가이드를 따라하면 Termux 환경에서 안정적으로 Discord Bot을 실행할 수 있습니다!  
**🔄 업데이트**: 새로운 기능 추가 시 이 문서를 업데이트하세요.
