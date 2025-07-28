# Termux Production Setup Guide

## Prerequisites
- Termux 환경 설정 완료
- Node.js 및 npm 설치 완료
- 빌드된 dist 파일 준비

## 2. PostgreSQL Database Setup

### 2.1 자동 설정 (권장 방법)

프로젝트에 포함된 설정 스크립트를 사용하여 PostgreSQL을 자동으로 설정합니다.

```bash
# 방법 1: npm 스크립트 사용 (권장)
npm run postgres:setup

# 방법 2: 설정 스크립트 직접 실행
cd database/postgresql
./setup.sh
```

**자동 설정이 수행하는 작업:**
- PostgreSQL 설치 및 초기화
- Termux 최적화 설정 적용 (`postgresql.conf`)
- 데이터베이스 및 사용자 생성
- 테이블 스키마 초기화 (`init.sql`)
- 백업 스크립트 설정
- 환경변수 파일 생성

### 2.2 수동 설정 (문제 해결용)

자동 설정이 실패할 경우에만 수동으로 설정합니다.

#### 2.2.1 PostgreSQL 설치

```bash
# PostgreSQL 패키지 설치
pkg install postgresql

# PostgreSQL 데이터 디렉토리 초기화
initdb $PREFIX/var/lib/postgresql

# PostgreSQL 서비스 시작
pg_ctl -D $PREFIX/var/lib/postgresql start
```

#### 2.2.2 최적화 설정 적용

프로젝트에 포함된 Termux 최적화 설정을 적용합니다:

```bash
# 기존 설정 백업
cp $PREFIX/var/lib/postgresql/postgresql.conf $PREFIX/var/lib/postgresql/postgresql.conf.backup

# 최적화된 설정 파일 복사
cp database/postgresql/postgresql.conf $PREFIX/var/lib/postgresql/postgresql.conf

# PostgreSQL 재시작
pg_ctl -D $PREFIX/var/lib/postgresql restart
```

**주요 최적화 설정:**
- `shared_buffers = 64MB` - Termux 메모리 제한 고려
- `max_connections = 20` - 적절한 연결 수 제한
- `work_mem = 4MB` - 쿼리 작업 메모리 최적화
- `effective_cache_size = 256MB` - 시스템 캐시 크기 추정
- 로깅 및 성능 모니터링 설정 포함

#### 2.2.3 데이터베이스 및 사용자 생성

```bash
# PostgreSQL에 접속
psql -U postgres

# 프로덕션 데이터베이스 생성
CREATE DATABASE discord_bot_prod;

# 프로덕션 사용자 생성 및 권한 부여
CREATE USER discord_bot_prod WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE discord_bot_prod TO discord_bot_prod;

# 추가 권한 설정
\c discord_bot_prod
GRANT ALL ON SCHEMA public TO discord_bot_prod;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO discord_bot_prod;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO discord_bot_prod;

# psql 종료
\q
```

#### 2.2.4 테이블 스키마 초기화

프로젝트에 포함된 초기화 스크립트를 사용합니다:

```bash
# 스키마 초기화 (프로젝트 루트에서 실행)
psql -d discord_bot_prod -f database/postgresql/init.sql

# 또는 TypeScript 초기화 스크립트 사용
NODE_ENV=production POSTGRES_DB=discord_bot_prod node dist/scripts/init-postgresql.js
```

### 2.3 PostgreSQL 관리 명령어

프로젝트에 포함된 npm 스크립트를 사용하여 PostgreSQL을 관리합니다:

```bash
# PostgreSQL 상태 확인
npm run postgres:status

# PostgreSQL 시작 (환경별 자동 감지)
npm run postgres:start

# 프로덕션 환경 PostgreSQL 시작
npm run postgres:start:prod

# PostgreSQL 중지
npm run postgres:stop

# PostgreSQL 재시작
npm run postgres:restart

# PostgreSQL 로그 확인
npm run postgres:logs

# 백업 생성
npm run postgres:backup

# 압축 백업 생성
npm run postgres:backup:compress

# 백업 목록 확인
npm run postgres:list

# 백업 복원
npm run postgres:restore

# 오래된 백업 정리
npm run postgres:clean
```

### 2.4 환경 설정 업데이트

.env.production 파일을 프로덕션 데이터베이스에 맞게 수정합니다:

```bash
# .env.production 파일 편집
nano .env.production
```

PostgreSQL 섹션을 다음과 같이 수정:

```env
# PostgreSQL 프로덕션 환경 설정
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=discord_bot_prod
POSTGRES_USER=discord_bot_prod
POSTGRES_PASSWORD=your_secure_password
POSTGRES_SSL=false
```

### 2.5 연결 테스트

```bash
# 데이터베이스 연결 테스트
psql -h localhost -U discord_bot_prod -d discord_bot_prod -c "SELECT version();"

# 테이블 확인
psql -h localhost -U discord_bot_prod -d discord_bot_prod -c "\dt"

# 봇 연결 테스트
NODE_ENV=production node -e "
const { config } = require('./dist/config/env.js');
console.log('DB 설정:', {
  host: config.POSTGRES_HOST,
  port: config.POSTGRES_PORT,
  database: config.POSTGRES_DB,
  user: config.POSTGRES_USER
});
"
```

## 3. Project Deployment

### 3.1 빌드된 파일 확인

현재 폴더의 dist 디렉토리를 그대로 사용합니다:

```bash
# dist 디렉토리 및 필수 파일 확인
ls -la dist/
ls -la dist/index.js          # 메인 진입점
ls -la dist/bot.js            # 봇 클래스
ls -la dist/config/           # 설정 파일들
ls -la dist/services/         # 서비스 클래스들
ls -la dist/commands/         # 명령어 핸들러들

# 의존성 확인
node -e "console.log('Node.js 버전:', process.version)"
npm list --depth=0 | grep -E "(discord.js|pg|redis)"
```

### 3.2 환경 설정 파일 검증

```bash
# .env.production 파일 존재 확인
ls -la .env.production

# 필수 환경 변수 확인
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
```

### 3.3 프로덕션 실행 테스트

```bash
# 일회성 실행으로 테스트
NODE_ENV=production node dist/index.js

# 또는 npm 스크립트 사용
npm run start

# Discord 명령어 등록 (최초 1회)
npm run register:prod
```

### 3.4 빌드 프로세스 (필요시)

dist 파일이 최신 상태가 아닌 경우에만 실행:

```bash
# TypeScript 컴파일
npm run build

# 타입 체크
npm run type-check

# 코드 품질 검사
npm run quality

# 프로덕션 테스트
npm run test:prod
```

## 5. Service Management (PM2)

### 5.1 PM2 설치

```bash
# 전역 PM2 설치
npm install -g pm2

# PM2 설치 확인
pm2 --version
pm2 list
```

### 5.2 PM2 설정 파일 확인

프로젝트에 포함된 PM2 설정 파일을 확인합니다:

```bash
# 설정 파일 확인
cat ecosystem-termux.config.cjs

# 설정 파일 검증
pm2 ecosystem ecosystem-termux.config.cjs
```

### 5.3 프로덕션 배포

```bash
# 완전 자동 배포 (빌드 + PM2 시작)
npm run start:prod

# 수동 배포 단계별 실행
npm run build                                              # 1. TypeScript 컴파일
pm2 start ecosystem-termux.config.cjs --env production   # 2. PM2로 시작
```

### 5.4 PM2 프로세스 관리

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
pm2 reload discord-bot                  # 무중단 재시작 (클러스터 모드)
pm2 stop discord-bot                    # 중지
pm2 delete discord-bot                  # 삭제

# 모든 프로세스 관리
pm2 restart all
pm2 stop all
pm2 delete all
```

### 5.5 자동 시작 설정

Termux 부팅 시 자동으로 시작하도록 설정:

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

# 테스트 실행
~/.termux/boot/start-discord-bot.sh
```

### 5.6 PM2 고급 기능

```bash
# 메모리 사용량 모니터링
pm2 describe discord-bot | grep -A 5 "Monit"

# CPU 프로파일링 (성능 분석)
pm2 profile discord-bot

# 힙 덤프 생성 (메모리 누수 디버깅)
pm2 dump discord-bot

# 프로세스 메트릭 확인
pm2 show discord-bot

# 로그 순환 설정 (pm2-logrotate 설치 필요)
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

## 추가 관리 도구

### PostgreSQL 백업 스크립트

프로젝트에 포함된 백업 도구 사용:

```bash
# 백업 스크립트 위치
ls -la database/postgresql/backup.sh

# 백업 스크립트 실행
cd database/postgresql

# 전체 백업
./backup.sh backup

# 압축 백업
./backup.sh backup --compress

# 데이터만 백업
./backup.sh backup --data-only

# 백업 목록 확인
./backup.sh list

# 특정 백업 복원
./backup.sh restore --file backup_20250128_143022.sql

# 오래된 백업 정리 (30일 이전)
./backup.sh clean

# 백업 디렉토리 확인
ls -la database/postgresql/backups/
```

### 로그 관리

```bash
# PM2 로그 위치
ls -la ~/.pm2/logs/

# PostgreSQL 로그 확인
tail -f $PREFIX/var/lib/postgresql/pg_log/postgresql-$(date +%Y-%m-%d).log

# 봇 애플리케이션 로그 (Errsole)
# 브라우저에서 http://[폰IP]:8002 접속

# 시스템 로그 확인
dmesg | tail -20
```

### 시스템 모니터링

```bash
# 시스템 리소스 확인
top -p $(pgrep -f "discord-bot\|postgres")

# 메모리 사용량
free -h

# 디스크 사용량
df -h

# 네트워크 연결 확인
netstat -tulpn | grep -E "(5432|8002)"

# 프로세스 트리
pstree -p
```

### 네트워크 설정 (외부 접근)

Errsole 대시보드 및 PostgreSQL 접근:

```bash
# 현재 IP 확인
npm run ip

# 또는 수동 확인
ifconfig wlan0 | grep inet
termux-wifi-connectioninfo | grep ip_address

# 방화벽 확인 (Android)
# Settings > Wi-Fi > Advanced > Private DNS 설정 확인
```

**외부 접근 URL:**
- Errsole 대시보드: `http://[폰IP]:8002`
- PostgreSQL: `[폰IP]:5432` (필요시에만 외부 개방)

## 프로덕션 체크리스트

### 설치 및 설정
- [ ] Termux 환경 설정 완료
- [ ] PostgreSQL 설치 및 최적화 설정 적용
- [ ] 프로덕션 데이터베이스 및 사용자 생성
- [ ] 테이블 스키마 초기화 완료
- [ ] .env.production 파일 설정 및 검증

### 배포
- [ ] dist 파일 빌드 완료 및 검증
- [ ] PM2 설치 및 설정 완료
- [ ] 프로덕션 환경 실행 테스트 완료
- [ ] Discord 명령어 등록 완료

### 관리 도구
- [ ] PostgreSQL 관리 명령어 테스트
- [ ] 백업 스크립트 설정 및 테스트
- [ ] PM2 프로세스 관리 테스트
- [ ] 자동 시작 설정 완료

### 모니터링
- [ ] 로그 순환 설정 완료
- [ ] Errsole 대시보드 접근 확인
- [ ] 시스템 리소스 모니터링 설정
- [ ] 네트워크 접근 설정 (필요시)

### 보안
- [ ] PostgreSQL 접근 권한 설정
- [ ] 환경 변수 파일 권한 설정 (`chmod 600 .env.production`)
- [ ] 불필요한 포트 외부 개방 차단
- [ ] 정기 백업 스케줄 설정

## 문제 해결

자세한 문제 해결 가이드는 다음 문서를 참조하세요:

- **PostgreSQL 관련**: `database/postgresql/README.md`
- **PM2 관련**: PM2 공식 문서
- **Termux 관련**: Termux Wiki

**주요 로그 파일 위치:**
- PostgreSQL: `$PREFIX/var/lib/postgresql/pg_log/`
- PM2: `~/.pm2/logs/`
- 봇 애플리케이션: Errsole 대시보드 (`http://[폰IP]:8002`)
- 시스템: `dmesg`, Termux 로그

**일반적인 문제:**
- PostgreSQL 연결 실패 → `npm run postgres:status`로 상태 확인
- PM2 프로세스 중단 → `pm2 restart discord-bot`로 재시작
- 메모리 부족 → `pm2 monit`으로 리소스 확인 후 재시작
- 권한 문제 → 파일 및 디렉토리 권한 확인