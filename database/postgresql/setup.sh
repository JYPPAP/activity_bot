#!/bin/bash

# =====================================================
# Discord Activity Bot - PostgreSQL 설정 스크립트
# =====================================================
# Termux 환경에서 PostgreSQL을 설치하고 설정하는 스크립트

set -e  # 에러 발생시 스크립트 중단

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 로그 함수
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# PostgreSQL 관련 변수
DB_NAME="discord_bot"
DB_USER="discord_bot"
DB_PASSWORD=""
POSTGRES_DATA_DIR="$PREFIX/var/lib/postgresql"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# =====================================================
# 1. 환경 확인
# =====================================================
check_environment() {
    log_info "환경 확인 중..."
    
    # Termux 환경 확인
    if [ -z "$PREFIX" ]; then
        log_error "Termux 환경이 아닙니다. PREFIX 변수가 설정되지 않았습니다."
        exit 1
    fi
    
    # 권한 확인
    if [ ! -w "$PREFIX" ]; then
        log_error "PREFIX 디렉토리에 쓰기 권한이 없습니다: $PREFIX"
        exit 1
    fi
    
    log_success "환경 확인 완료"
}

# =====================================================
# 2. PostgreSQL 설치
# =====================================================
install_postgresql() {
    log_info "PostgreSQL 설치 확인 중..."
    
    if command -v psql >/dev/null 2>&1; then
        log_success "PostgreSQL이 이미 설치되어 있습니다."
        return 0
    fi
    
    log_info "PostgreSQL 설치 중..."
    pkg update
    pkg install -y postgresql
    
    if command -v psql >/dev/null 2>&1; then
        log_success "PostgreSQL 설치 완료"
    else
        log_error "PostgreSQL 설치 실패"
        exit 1
    fi
}

# =====================================================
# 3. PostgreSQL 초기화
# =====================================================
initialize_postgresql() {
    log_info "PostgreSQL 초기화 중..."
    
    # 데이터 디렉토리 확인
    if [ -d "$POSTGRES_DATA_DIR" ] && [ "$(ls -A $POSTGRES_DATA_DIR)" ]; then
        log_warning "PostgreSQL 데이터 디렉토리가 이미 존재합니다: $POSTGRES_DATA_DIR"
        read -p "기존 데이터를 삭제하고 다시 초기화하시겠습니까? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            log_warning "기존 PostgreSQL 데이터 삭제 중..."
            rm -rf "$POSTGRES_DATA_DIR"
        else
            log_info "기존 데이터를 유지합니다."
            return 0
        fi
    fi
    
    # 디렉토리 생성
    mkdir -p "$POSTGRES_DATA_DIR"
    
    # PostgreSQL 초기화
    log_info "PostgreSQL 데이터베이스 클러스터 초기화 중..."
    initdb "$POSTGRES_DATA_DIR"
    
    if [ $? -eq 0 ]; then
        log_success "PostgreSQL 초기화 완료"
    else
        log_error "PostgreSQL 초기화 실패"
        exit 1
    fi
}

# =====================================================
# 4. PostgreSQL 설정 파일 복사
# =====================================================
copy_config_files() {
    log_info "PostgreSQL 설정 파일 복사 중..."
    
    # 백업 생성
    if [ -f "$POSTGRES_DATA_DIR/postgresql.conf" ]; then
        cp "$POSTGRES_DATA_DIR/postgresql.conf" "$POSTGRES_DATA_DIR/postgresql.conf.backup"
        log_info "기존 설정 파일 백업 완료"
    fi
    
    # 새 설정 파일 복사
    if [ -f "$SCRIPT_DIR/postgresql.conf" ]; then
        cp "$SCRIPT_DIR/postgresql.conf" "$POSTGRES_DATA_DIR/postgresql.conf"
        log_success "PostgreSQL 설정 파일 복사 완료"
    else
        log_warning "PostgreSQL 설정 파일을 찾을 수 없습니다: $SCRIPT_DIR/postgresql.conf"
    fi
    
    # pg_hba.conf 설정 (로컬 연결 허용)
    cat > "$POSTGRES_DATA_DIR/pg_hba.conf" << EOF
# TYPE  DATABASE        USER            ADDRESS                 METHOD

# 로컬 연결
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust

# Discord Bot 전용 연결
local   $DB_NAME        $DB_USER                                md5
host    $DB_NAME        $DB_USER        127.0.0.1/32            md5
EOF
    
    log_success "pg_hba.conf 설정 완료"
}

# =====================================================
# 5. PostgreSQL 서비스 시작
# =====================================================
start_postgresql() {
    log_info "PostgreSQL 서비스 시작 중..."
    
    # 이미 실행 중인지 확인
    if pg_ctl -D "$POSTGRES_DATA_DIR" status >/dev/null 2>&1; then
        log_success "PostgreSQL이 이미 실행 중입니다."
        return 0
    fi
    
    # PostgreSQL 시작
    pg_ctl -D "$POSTGRES_DATA_DIR" -l "$POSTGRES_DATA_DIR/postgresql.log" start
    
    # 시작 확인 (최대 30초 대기)
    for i in {1..30}; do
        if pg_ctl -D "$POSTGRES_DATA_DIR" status >/dev/null 2>&1; then
            log_success "PostgreSQL 서비스 시작 완료"
            return 0
        fi
        sleep 1
    done
    
    log_error "PostgreSQL 서비스 시작 실패"
    exit 1
}

# =====================================================
# 6. 데이터베이스 및 사용자 생성
# =====================================================
create_database_and_user() {
    log_info "데이터베이스 및 사용자 생성 중..."
    
    # 데이터베이스 존재 확인
    if psql -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
        log_warning "데이터베이스 '$DB_NAME'이 이미 존재합니다."
    else
        log_info "데이터베이스 '$DB_NAME' 생성 중..."
        createdb "$DB_NAME"
        log_success "데이터베이스 생성 완료"
    fi
    
    # 사용자 존재 확인 및 생성
    if psql -t -c "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
        log_warning "사용자 '$DB_USER'가 이미 존재합니다."
    else
        log_info "사용자 '$DB_USER' 생성 중..."
        if [ -n "$DB_PASSWORD" ]; then
            psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';"
        else
            psql -c "CREATE USER $DB_USER;"
        fi
        log_success "사용자 생성 완료"
    fi
    
    # 권한 부여
    log_info "데이터베이스 권한 부여 중..."
    psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
    psql -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON SCHEMA public TO $DB_USER;"
    psql -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $DB_USER;"
    psql -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $DB_USER;"
    psql -d "$DB_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;"
    psql -d "$DB_NAME" -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;"
    
    log_success "권한 부여 완료"
}

# =====================================================
# 7. 스키마 초기화
# =====================================================
initialize_schema() {
    log_info "데이터베이스 스키마 초기화 중..."
    
    if [ -f "$SCRIPT_DIR/init.sql" ]; then
        log_info "초기화 스크립트 실행 중..."
        psql -d "$DB_NAME" -f "$SCRIPT_DIR/init.sql"
        
        if [ $? -eq 0 ]; then
            log_success "스키마 초기화 완료"
        else
            log_error "스키마 초기화 실패"
            exit 1
        fi
    else
        log_warning "초기화 스크립트를 찾을 수 없습니다: $SCRIPT_DIR/init.sql"
    fi
}

# =====================================================
# 8. 연결 테스트
# =====================================================
test_connection() {
    log_info "데이터베이스 연결 테스트 중..."
    
    # postgres 사용자로 연결 테스트
    if psql -d "$DB_NAME" -c "SELECT version();" >/dev/null 2>&1; then
        log_success "postgres 사용자 연결 성공"
    else
        log_error "postgres 사용자 연결 실패"
        return 1
    fi
    
    # 생성한 사용자로 연결 테스트
    if [ -n "$DB_PASSWORD" ]; then
        if PGPASSWORD="$DB_PASSWORD" psql -h localhost -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" >/dev/null 2>&1; then
            log_success "사용자 '$DB_USER' 연결 성공"
        else
            log_warning "사용자 '$DB_USER' 연결 실패 (권한 확인 필요)"
        fi
    fi
    
    # 테이블 확인
    TABLE_COUNT=$(psql -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';")
    log_info "생성된 테이블 수: $TABLE_COUNT"
}

# =====================================================
# 9. 환경변수 파일 생성
# =====================================================
create_env_file() {
    log_info "환경변수 파일 생성 중..."
    
    ENV_FILE="$PROJECT_ROOT/.env.postgresql"
    
    cat > "$ENV_FILE" << EOF
# =====================================================
# PostgreSQL 환경변수 설정
# =====================================================
# 이 파일을 .env에 복사하거나 내용을 추가하세요

# 데이터베이스 타입
DB_TYPE=postgresql

# PostgreSQL 연결 정보
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=$DB_NAME
POSTGRES_USER=$DB_USER
POSTGRES_PASSWORD=$DB_PASSWORD
POSTGRES_SSL=false

# 연결 풀 설정
POSTGRES_MAX_CONNECTIONS=20
POSTGRES_IDLE_TIMEOUT=30000
POSTGRES_CONNECTION_TIMEOUT=10000

# Redis 설정 (PostgreSQL과 함께 사용)
REDIS_ENABLED=true
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# 로깅 설정
LOG_LEVEL=info
LOG_SQL_QUERIES=false
EOF
    
    log_success "환경변수 파일 생성 완료: $ENV_FILE"
    log_info "이 파일의 내용을 .env 파일에 복사하세요."
}

# =====================================================
# 10. 시작 스크립트 생성
# =====================================================
create_start_script() {
    log_info "PostgreSQL 시작 스크립트 생성 중..."
    
    START_SCRIPT="$PROJECT_ROOT/scripts/start-postgresql.sh"
    mkdir -p "$(dirname "$START_SCRIPT")"
    
    cat > "$START_SCRIPT" << EOF
#!/bin/bash
# PostgreSQL 시작 스크립트

POSTGRES_DATA_DIR="$POSTGRES_DATA_DIR"

echo "PostgreSQL 상태 확인 중..."
if pg_ctl -D "\$POSTGRES_DATA_DIR" status >/dev/null 2>&1; then
    echo "✅ PostgreSQL이 이미 실행 중입니다."
else
    echo "🚀 PostgreSQL 시작 중..."
    pg_ctl -D "\$POSTGRES_DATA_DIR" -l "\$POSTGRES_DATA_DIR/postgresql.log" start
    
    if [ \$? -eq 0 ]; then
        echo "✅ PostgreSQL 시작 완료"
    else
        echo "❌ PostgreSQL 시작 실패"
        exit 1
    fi
fi

echo "📊 PostgreSQL 정보:"
echo "  - 데이터 디렉토리: \$POSTGRES_DATA_DIR"
echo "  - 로그 파일: \$POSTGRES_DATA_DIR/postgresql.log"
echo "  - 데이터베이스: $DB_NAME"
echo "  - 사용자: $DB_USER"
echo ""
echo "연결 테스트: psql -d $DB_NAME"
EOF
    
    chmod +x "$START_SCRIPT"
    log_success "시작 스크립트 생성 완료: $START_SCRIPT"
}

# =====================================================
# 11. 정리 함수
# =====================================================
cleanup() {
    log_info "정리 작업 중..."
    # 필요시 정리 작업 수행
}

# 시그널 핸들러 등록
trap cleanup EXIT

# =====================================================
# 메인 실행 함수
# =====================================================
main() {
    echo "=============================================="
    echo "  Discord Activity Bot PostgreSQL 설정"
    echo "=============================================="
    echo ""
    
    # 사용자 입력 받기
    read -p "데이터베이스 이름 [$DB_NAME]: " input_db_name
    DB_NAME=${input_db_name:-$DB_NAME}
    
    read -p "데이터베이스 사용자명 [$DB_USER]: " input_db_user
    DB_USER=${input_db_user:-$DB_USER}
    
    read -s -p "데이터베이스 비밀번호 (비워두면 trust 인증): " input_db_password
    DB_PASSWORD=${input_db_password}
    echo ""
    echo ""
    
    # 실행 단계
    check_environment
    install_postgresql
    initialize_postgresql
    copy_config_files
    start_postgresql
    create_database_and_user
    initialize_schema
    test_connection
    create_env_file
    create_start_script
    
    echo ""
    echo "=============================================="
    echo "🎉 PostgreSQL 설정이 완료되었습니다!"
    echo "=============================================="
    echo ""
    echo "📋 다음 단계:"
    echo "1. 환경변수 파일 확인: $PROJECT_ROOT/.env.postgresql"
    echo "2. .env 파일에 설정 복사 또는 업데이트"
    echo "3. PostgreSQL 시작: $PROJECT_ROOT/scripts/start-postgresql.sh"
    echo "4. 봇 시작: npm run update"
    echo ""
    echo "🔧 유용한 명령어:"
    echo "  - PostgreSQL 상태 확인: pg_ctl -D $POSTGRES_DATA_DIR status"
    echo "  - PostgreSQL 중지: pg_ctl -D $POSTGRES_DATA_DIR stop"
    echo "  - 데이터베이스 접속: psql -d $DB_NAME"
    echo "  - 로그 확인: tail -f $POSTGRES_DATA_DIR/postgresql.log"
    echo ""
}

# 스크립트가 직접 실행되었을 때만 main 함수 호출
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi