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

### 1단계: PostgreSQL 서버 확인
```bash
# PostgreSQL 서버 상태 확인
pg_isready -h localhost -p 5432

# 버전 확인
psql --version
```

### 2단계: 데이터베이스 생성 (필요시)
```sql
-- PostgreSQL 관리자로 접속하여 데이터베이스 생성
CREATE DATABASE activity_bot;
CREATE USER activity_bot_user WITH PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE activity_bot TO activity_bot_user;
```

### 3단계: 환경 설정
`.env` 파일의 `DATABASE_URL`을 실제 PostgreSQL 연결 정보로 업데이트:
```env
DATABASE_URL=postgresql://username:password@localhost:5432/activity_bot
```

### 4단계: 데이터베이스 초기화
```bash
npm run init-db
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

## 문제 해결

### 연결 실패 시
1. PostgreSQL 서버 실행 확인
2. 사용자 권한 확인
3. 데이터베이스 존재 확인
4. 방화벽 설정 확인

### 권한 오류 시
```sql
GRANT ALL PRIVILEGES ON DATABASE activity_bot TO your_username;
GRANT USAGE ON SCHEMA public TO your_username;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_username;
```

---

**PostgreSQL 마이그레이션 환경 설정 완료** ✅