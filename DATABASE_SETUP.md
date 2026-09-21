# PostgreSQL 데이터베이스 설정 가이드

## 설정 완료 사항

### ✅ 환경 구성 완료
- **PostgreSQL 패키지 설치**: `pg@^8.11.3` 의존성 추가됨
- **환경 설정 파일**: `.env` 및 `.env.example` 생성 완료
- **초기화 스크립트**: `scripts/init-database.js`, `scripts/init-database.sql` 준비됨
- **NPM 스크립트**: `npm run init-db` 명령어 설정 완료

### ✅ 데이터베이스 스키마
PostgreSQL 서버에서 다음 구조가 생성됩니다:

#### 핵심 테이블
1. **users**: 사용자 정보 + 잠수 상태 관리 (기존 afk_status 통합)
2. **guild_settings**: 길드 설정 정보
3. **post_integrations**: 포스트 연동 + 포럼 메시지 통합 테이블
4. **user_activities_YYYYMM**: 월별 활동 데이터 (자동 파티셔닝)

#### 핵심 기능
- **월별 테이블 자동 생성**: `create_monthly_activity_table()` 함수
- **성능 최적화 인덱스**: 조회 성능을 위한 복합 인덱스들
- **자동 트리거**: `updated_at` 필드 자동 업데이트

## 데이터베이스 초기화 방법

### 🚀 완전 초기화 (처음 설정 또는 initdb 후)

**Termux 환경에서 실행:**

```bash
cd ~/discord_bot

# 1단계: PostgreSQL 서버 시작
pg_ctl start -D ~/postgres_data

# 2단계: activity_bot 데이터베이스 생성 (아직 없는 경우)
psql -d postgres -c "CREATE DATABASE activity_bot;"

# 3단계: 사용자 및 권한 설정
psql -d postgres -f scripts/setup-user-permissions.sql

# 4단계: 데이터베이스 스키마 초기화
npm run init-db

# 5단계: 추가 마이그레이션 적용
npm run migrate:up

# 6단계: 현재 월 활동 테이블 생성
psql -d activity_bot -c "SELECT create_monthly_activity_table('$(date +%Y%m)');"

# 7단계: 테이블 확인
psql -d activity_bot -c "\dt"

# 8단계: 봇 시작
npm run start:prod
```

### ⚡ 빠른 재시작 (핸드폰 재부팅 후)

```bash
cd ~/discord_bot
npm run start:prod
```

이 명령어 하나로 PostgreSQL 시작 + 봇 재시작이 자동으로 실행됩니다!

### 📋 개별 단계별 설정

#### 1단계: PostgreSQL 서버 확인
```bash
# PostgreSQL 서버 상태 확인
pg_isready -h localhost -p 5432

# 실행 중이 아니면 시작
pg_ctl start -D ~/postgres_data

# 버전 확인
psql --version
```

#### 2단계: 데이터베이스 생성 (필요시)
```bash
# activity_bot 데이터베이스 생성
psql -d postgres -c "CREATE DATABASE activity_bot;"

# 데이터베이스 목록 확인
psql -l
```

#### 3단계: 사용자 및 권한 설정
```bash
# scripts/setup-user-permissions.sql 실행
psql -d postgres -f scripts/setup-user-permissions.sql
```

이 스크립트는 다음을 수행합니다:
- `discord_bot` 사용자 생성 (비밀번호: prod_password)
- `activity_bot` 데이터베이스에 대한 모든 권한 부여
- 스키마, 테이블, 시퀀스, 함수에 대한 권한 설정
- 미래에 생성될 객체들에 대한 기본 권한 설정

#### 4단계: 환경 설정
`.env` 파일 확인 (이미 설정되어 있음):
```env
DATABASE_URL=postgresql://discord_bot:prod_password@localhost:5432/activity_bot?sslmode=disable
```

#### 5단계: 데이터베이스 스키마 초기화
```bash
# init-database.js를 통한 초기 스키마 생성
npm run init-db

# 추가 마이그레이션 적용
npm run migrate:up
```

## 초기화 스크립트 상세

### scripts/init-database.js
- 환경 변수 로드 및 연결 설정
- SSL 설정 (프로덕션 환경 지원)
- 상세한 오류 진단 및 해결 가이드
- 생성된 테이블 및 인덱스 확인

### scripts/init-database.sql
- 완전한 스키마 정의
- 성능 최적화 인덱스
- 월별 테이블 자동 생성 함수
- 트리거 설정

## 마이그레이션 준비 완료

### 이전 시스템에서 변경사항
- **LowDB 제거**: JSON 파일 기반 → PostgreSQL
- **activity_logs 제거**: 실시간 세션 추적으로 대체
- **forum_messages 통합**: post_integrations 테이블로 통합
- **월별 파티셔닝**: 성능 최적화를 위한 자동 파티셔닝

### 다음 단계
데이터베이스 초기화 완료 후:
1. **기능 테스트**: 실제 Discord 봇 실행 테스트
2. **데이터 검증**: ActivityTracker 실시간 추적 확인
3. **성능 검증**: 월별 테이블 성능 테스트

## 환경별 설정

### Development (WSL)
- PostgreSQL 16.9 설치됨
- 로컬 데이터베이스 서버 사용
- 개발용 샘플 데이터

### Production (Termux)
- ecosystem-termux.config.cjs 사용
- 실제 운영 데이터베이스
- SSL 연결 및 보안 설정 필요

## 💾 데이터베이스 백업

### 수동 백업
```bash
# 전체 데이터베이스 백업 (스키마 + 데이터)
cd ~/discord_bot
npm run backup:db

# 또는 직접 실행
pg_dump -U u0_a308 -d activity_bot -F c -f backups/activity_bot_$(date +%Y%m%d_%H%M%S).backup
```

### 백업 복원
```bash
# 백업 파일로부터 복원
pg_restore -U u0_a308 -d activity_bot -c backups/activity_bot_YYYYMMDD_HHMMSS.backup
```

### 자동 백업 설정 (선택사항)
Termux에서 cron을 사용하여 자동 백업 설정:
```bash
# cronie 설치
pkg install cronie

# cron 시작
crond

# crontab 편집
crontab -e

# 매일 새벽 3시에 백업 (아래 내용 추가)
0 3 * * * cd ~/discord_bot && npm run backup:db
```

## 문제 해결

### 연결 실패 시
1. PostgreSQL 서버 실행 확인: `pg_isready -h localhost`
2. 사용자 권한 확인: `psql -l`
3. 데이터베이스 존재 확인: `psql -d postgres -c "\l"`
4. 포트 확인: `netstat -tlnp | grep 5432`

### 권한 오류 시
```bash
# setup-user-permissions.sql 재실행
psql -d postgres -f scripts/setup-user-permissions.sql
```

### 테이블이 모두 사라진 경우
```bash
# 전체 초기화 프로세스 다시 실행
npm run init-db
npm run migrate:up
```

### PostgreSQL 재시작 필요 시
```bash
# 서버 중지
pg_ctl stop -D ~/postgres_data

# 서버 시작
pg_ctl start -D ~/postgres_data

# 또는 재시작
pg_ctl restart -D ~/postgres_data
```

---

**PostgreSQL 마이그레이션 환경 설정 완료** ✅
