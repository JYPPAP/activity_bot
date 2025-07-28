# 🗄️ PostgreSQL 설정 가이드

Discord Activity Bot의 PostgreSQL 데이터베이스 설정 및 관리 파일들입니다.

## 📁 파일 구조

```
database/postgresql/
├── README.md                    # 이 파일
├── init.sql                     # 데이터베이스 초기화 스크립트
├── postgresql.conf              # PostgreSQL 설정 파일
├── setup.sh                     # 자동 설정 스크립트
├── backup.sh                    # 백업/복원 스크립트
├── migrate-from-sqlite.sql      # SQLite → PostgreSQL 마이그레이션
└── backups/                     # 백업 파일 저장소 (자동 생성)
```

## 🚀 빠른 시작

### 1. 자동 설정 (권장)
```bash
# PostgreSQL 자동 설치 및 설정
cd database/postgresql
./setup.sh
```

### 2. 수동 설정
```bash
# PostgreSQL 설치
pkg install postgresql

# 데이터베이스 초기화
initdb $PREFIX/var/lib/postgresql

# PostgreSQL 시작
pg_ctl -D $PREFIX/var/lib/postgresql start

# 데이터베이스 생성
createdb discord_bot

# 스키마 초기화
psql -d discord_bot -f init.sql
```

## 🔧 주요 파일 설명

### 📄 init.sql
- **목적**: 모든 테이블, 인덱스, 트리거 생성
- **포함 내용**:
  - 8개 주요 테이블 생성
  - 성능 최적화 인덱스
  - 자동 업데이트 트리거
  - 기본 데이터 삽입
  - 유틸리티 뷰 생성

**주요 테이블:**
- `user_activity` - 사용자 활동 시간 추적
- `role_config` - 역할별 설정
- `activity_log` - 상세 활동 로그
- `afk_status` - 잠수 상태 관리
- `voice_channel_mapping` - 음성 채널 매핑
- `guild_settings` - 길드별 설정
- `settings_audit_log` - 설정 변경 이력
- `daily_activity_stats` - 일일 통계

### 📄 postgresql.conf
- **목적**: Termux 환경 최적화 설정
- **주요 특징**:
  - 메모리 제한 환경 고려 (64MB shared_buffers)
  - 연결 수 제한 (20개)
  - 로깅 최적화
  - 성능 튜닝

### 📄 setup.sh
- **목적**: 완전 자동화된 PostgreSQL 설정
- **기능**:
  - PostgreSQL 설치 및 초기화
  - 설정 파일 복사
  - 데이터베이스 및 사용자 생성
  - 스키마 초기화
  - 연결 테스트
  - 환경변수 파일 생성

### 📄 backup.sh
- **목적**: 백업 및 복원 관리
- **기능**:
  - 전체/데이터/스키마 백업
  - 압축 백업 지원
  - 백업 복원
  - 백업 파일 관리
  - 오래된 백업 정리

### 📄 migrate-from-sqlite.sql
- **목적**: SQLite에서 PostgreSQL로 데이터 이전
- **기능**:
  - SQLite 데이터 내보내기 스크립트
  - PostgreSQL 데이터 가져오기 스크립트
  - 데이터 검증 쿼리
  - 시퀀스 값 재설정

## 🔧 사용법

### PostgreSQL 설정
```bash
# 완전 자동 설정
./setup.sh

# 대화형 설정 (데이터베이스명, 사용자명 입력)
# 기본값: discord_bot / discord_bot / (비밀번호 없음)
```

### 백업 관리
```bash
# 전체 백업
./backup.sh backup

# 압축 백업
./backup.sh backup --compress

# 데이터만 백업
./backup.sh backup --data-only

# 백업 목록 확인
./backup.sh list

# 백업 복원
./backup.sh restore --file backup_20250717_143022.sql

# 오래된 백업 정리 (30일 이전)
./backup.sh clean

# 7일 이전 백업 정리
./backup.sh clean --days 7
```

### SQLite 마이그레이션
```bash
# 1. SQLite에서 데이터 내보내기
sqlite3 data/discord_bot.db < migrate-from-sqlite.sql

# 2. PostgreSQL에서 데이터 가져오기
psql -d discord_bot -f migrate-from-sqlite.sql
```

## 🔍 유용한 명령어

### PostgreSQL 관리
```bash
# PostgreSQL 상태 확인
pg_ctl -D $PREFIX/var/lib/postgresql status

# PostgreSQL 시작
pg_ctl -D $PREFIX/var/lib/postgresql start

# PostgreSQL 중지
pg_ctl -D $PREFIX/var/lib/postgresql stop

# PostgreSQL 재시작
pg_ctl -D $PREFIX/var/lib/postgresql restart

# 로그 확인
tail -f $PREFIX/var/lib/postgresql/pg_log/postgresql-$(date +%Y-%m-%d).log
```

### 데이터베이스 접속
```bash
# 기본 데이터베이스 접속
psql -d discord_bot

# 특정 사용자로 접속
psql -h localhost -U discord_bot -d discord_bot

# 원격 접속 (필요시)
psql -h 192.168.1.100 -p 5432 -U discord_bot -d discord_bot
```

### 데이터베이스 확인
```sql
-- 테이블 목록
\dt

-- 테이블 구조 확인
\d user_activity

-- 데이터베이스 크기
SELECT pg_size_pretty(pg_database_size('discord_bot'));

-- 테이블별 레코드 수
SELECT 
    table_name,
    (xpath('/row/count/text()', xml_count))[1]::text::int as row_count
FROM (
    SELECT 
        table_name, 
        query_to_xml(format('select count(*) as count from %I.%I', table_schema, table_name), false, true, '') as xml_count
    FROM information_schema.tables 
    WHERE table_schema = 'public'
) t;

-- 인덱스 사용량 확인
SELECT 
    schemaname, 
    tablename, 
    indexname, 
    idx_scan, 
    idx_tup_read, 
    idx_tup_fetch
FROM pg_stat_user_indexes 
ORDER BY idx_scan DESC;
```

## 🔧 성능 최적화

### 정기 유지보수
```sql
-- 통계 업데이트
ANALYZE;

-- 테이블 정리
VACUUM;

-- 전체 정리 (주의: 시간이 오래 걸림)
VACUUM FULL;

-- 특정 테이블 정리
VACUUM ANALYZE user_activity;
```

### 설정 최적화
```bash
# 메모리 사용량 확인
SELECT 
    name,
    setting,
    unit,
    context
FROM pg_settings 
WHERE name IN ('shared_buffers', 'effective_cache_size', 'work_mem', 'maintenance_work_mem');

# 연결 상태 확인
SELECT 
    count(*),
    state
FROM pg_stat_activity 
GROUP BY state;
```

## 🚨 문제 해결

### 연결 문제
```bash
# PostgreSQL 서비스 확인
pg_ctl -D $PREFIX/var/lib/postgresql status

# 포트 사용 확인
netstat -an | grep 5432

# 연결 테스트
psql -h localhost -p 5432 -d discord_bot -c "SELECT 1;"
```

### 권한 문제
```sql
-- 사용자 권한 확인
\du

-- 데이터베이스 권한 확인
\l

-- 테이블 권한 확인
\dp user_activity

-- 권한 부여
GRANT ALL PRIVILEGES ON DATABASE discord_bot TO discord_bot;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO discord_bot;
```

### 성능 문제
```sql
-- 느린 쿼리 확인
SELECT 
    query,
    calls,
    total_time,
    mean_time,
    rows
FROM pg_stat_statements 
ORDER BY total_time DESC 
LIMIT 10;

-- 락 대기 확인
SELECT 
    blocked_locks.pid AS blocked_pid,
    blocked_activity.usename AS blocked_user,
    blocking_locks.pid AS blocking_pid,
    blocking_activity.usename AS blocking_user,
    blocked_activity.query AS blocked_statement,
    blocking_activity.query AS current_statement_in_blocking_process
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
    AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
    AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
    AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
    AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
    AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
    AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
    AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
    AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
    AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
```

## 🔐 보안 고려사항

### 기본 보안 설정
- 로컬 연결만 허용 (`listen_addresses = 'localhost'`)
- trust 인증 사용 (개발환경)
- 연결 수 제한 (20개)

### 프로덕션 환경 권장사항
```bash
# 비밀번호 설정
ALTER USER discord_bot WITH PASSWORD 'secure_password';

# md5 인증 사용
# pg_hba.conf에서 trust를 md5로 변경

# SSL 연결 활성화 (필요시)
# ssl = on
# ssl_cert_file = 'server.crt'
# ssl_key_file = 'server.key'
```

## 📊 모니터링

### 시스템 상태 확인
```sql
-- 데이터베이스 상태
SELECT 
    datname,
    numbackends,
    xact_commit,
    xact_rollback,
    blks_read,
    blks_hit,
    tup_returned,
    tup_fetched,
    tup_inserted,
    tup_updated,
    tup_deleted
FROM pg_stat_database 
WHERE datname = 'discord_bot';

-- 테이블 상태
SELECT 
    relname,
    seq_scan,
    seq_tup_read,
    idx_scan,
    idx_tup_fetch,
    n_tup_ins,
    n_tup_upd,
    n_tup_del
FROM pg_stat_user_tables;
```

---

## 📞 지원

문제가 발생하면 다음을 확인하세요:

1. **로그 파일**: `$PREFIX/var/lib/postgresql/pg_log/`
2. **설정 파일**: `$PREFIX/var/lib/postgresql/postgresql.conf`
3. **연결 설정**: `$PREFIX/var/lib/postgresql/pg_hba.conf`
4. **환경변수**: `.env` 파일의 PostgreSQL 설정

추가 도움이 필요하면 프로젝트 이슈 트래커를 확인하세요.