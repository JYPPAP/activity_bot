#!/bin/bash

# =====================================================
# PostgreSQL 백업 및 복원 스크립트
# =====================================================
# Discord Activity Bot PostgreSQL 데이터베이스 백업/복원

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

# 기본 설정
DB_NAME="discord_bot"
DB_USER="discord_bot"
DB_HOST="localhost"
DB_PORT="5432"
BACKUP_DIR="$(dirname "$0")/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# 사용법 출력
usage() {
    echo "사용법: $0 [backup|restore|list|clean] [옵션]"
    echo ""
    echo "명령어:"
    echo "  backup   - 데이터베이스 백업 생성"
    echo "  restore  - 백업에서 데이터베이스 복원"
    echo "  list     - 백업 파일 목록 표시"
    echo "  clean    - 오래된 백업 파일 정리"
    echo ""
    echo "백업 옵션:"
    echo "  --data-only     데이터만 백업 (스키마 제외)"
    echo "  --schema-only   스키마만 백업 (데이터 제외)"
    echo "  --compress      백업 파일 압축"
    echo ""
    echo "복원 옵션:"
    echo "  --file FILE     복원할 백업 파일 지정"
    echo "  --drop-db       복원 전 데이터베이스 삭제"
    echo ""
    echo "정리 옵션:"
    echo "  --days N        N일 이전 백업 파일 삭제 (기본: 30일)"
    echo ""
    echo "예시:"
    echo "  $0 backup --compress"
    echo "  $0 restore --file backup_20250717_143022.sql"
    echo "  $0 clean --days 7"
}

# 백업 디렉토리 생성
create_backup_dir() {
    if [ ! -d "$BACKUP_DIR" ]; then
        mkdir -p "$BACKUP_DIR"
        log_info "백업 디렉토리 생성: $BACKUP_DIR"
    fi
}

# 데이터베이스 연결 테스트
test_connection() {
    log_info "데이터베이스 연결 테스트 중..."
    
    if ! psql -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" -U "$DB_USER" -c "SELECT 1;" >/dev/null 2>&1; then
        log_error "데이터베이스에 연결할 수 없습니다."
        log_error "설정을 확인하세요: $DB_HOST:$DB_PORT/$DB_NAME (사용자: $DB_USER)"
        return 1
    fi
    
    log_success "데이터베이스 연결 성공"
    return 0
}

# 백업 실행
backup_database() {
    local data_only=false
    local schema_only=false
    local compress=false
    local backup_file=""
    
    # 옵션 파싱
    while [[ $# -gt 0 ]]; do
        case $1 in
            --data-only)
                data_only=true
                shift
                ;;
            --schema-only)
                schema_only=true
                shift
                ;;
            --compress)
                compress=true
                shift
                ;;
            *)
                shift
                ;;
        esac
    done
    
    create_backup_dir
    test_connection || return 1
    
    # 백업 파일명 결정
    if [ "$data_only" = true ]; then
        backup_file="$BACKUP_DIR/backup_data_${TIMESTAMP}.sql"
    elif [ "$schema_only" = true ]; then
        backup_file="$BACKUP_DIR/backup_schema_${TIMESTAMP}.sql"
    else
        backup_file="$BACKUP_DIR/backup_full_${TIMESTAMP}.sql"
    fi
    
    # 압축 옵션
    if [ "$compress" = true ]; then
        backup_file="${backup_file}.gz"
    fi
    
    log_info "백업 시작: $backup_file"
    
    # pg_dump 옵션 구성
    local pg_dump_opts=()
    pg_dump_opts+=("-h" "$DB_HOST")
    pg_dump_opts+=("-p" "$DB_PORT")
    pg_dump_opts+=("-U" "$DB_USER")
    pg_dump_opts+=("-d" "$DB_NAME")
    pg_dump_opts+=("--verbose")
    pg_dump_opts+=("--no-password")
    
    if [ "$data_only" = true ]; then
        pg_dump_opts+=("--data-only")
        pg_dump_opts+=("--disable-triggers")
    elif [ "$schema_only" = true ]; then
        pg_dump_opts+=("--schema-only")
    fi
    
    # 백업 실행
    if [ "$compress" = true ]; then
        if pg_dump "${pg_dump_opts[@]}" | gzip > "$backup_file"; then
            log_success "압축 백업 완료: $backup_file"
        else
            log_error "압축 백업 실패"
            return 1
        fi
    else
        if pg_dump "${pg_dump_opts[@]}" > "$backup_file"; then
            log_success "백업 완료: $backup_file"
        else
            log_error "백업 실패"
            return 1
        fi
    fi
    
    # 백업 파일 정보
    local file_size=$(du -h "$backup_file" | cut -f1)
    log_info "백업 파일 크기: $file_size"
    
    # 백업 검증
    if [ "$compress" = true ]; then
        if gzip -t "$backup_file" 2>/dev/null; then
            log_success "백업 파일 검증 성공"
        else
            log_warning "백업 파일 검증 실패"
        fi
    else
        if head -n 1 "$backup_file" | grep -q "PostgreSQL database dump"; then
            log_success "백업 파일 검증 성공"
        else
            log_warning "백업 파일 검증 실패"
        fi
    fi
}

# 백업 복원
restore_database() {
    local backup_file=""
    local drop_db=false
    
    # 옵션 파싱
    while [[ $# -gt 0 ]]; do
        case $1 in
            --file)
                backup_file="$2"
                shift 2
                ;;
            --drop-db)
                drop_db=true
                shift
                ;;
            *)
                shift
                ;;
        esac
    done
    
    # 백업 파일 확인
    if [ -z "$backup_file" ]; then
        log_error "복원할 백업 파일을 지정해주세요. (--file 옵션 사용)"
        return 1
    fi
    
    if [ ! -f "$backup_file" ]; then
        # 상대 경로로 다시 시도
        backup_file="$BACKUP_DIR/$backup_file"
        if [ ! -f "$backup_file" ]; then
            log_error "백업 파일을 찾을 수 없습니다: $backup_file"
            return 1
        fi
    fi
    
    log_info "백업 복원 시작: $backup_file"
    
    # 데이터베이스 삭제 및 재생성
    if [ "$drop_db" = true ]; then
        log_warning "기존 데이터베이스를 삭제합니다..."
        read -p "정말 진행하시겠습니까? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "복원 취소됨"
            return 1
        fi
        
        # 기존 연결 종료
        psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" 2>/dev/null || true
        
        # 데이터베이스 삭제 및 재생성
        dropdb -h "$DB_HOST" -p "$DB_PORT" -U postgres "$DB_NAME" 2>/dev/null || true
        createdb -h "$DB_HOST" -p "$DB_PORT" -U postgres "$DB_NAME"
        
        # 권한 재설정
        psql -h "$DB_HOST" -p "$DB_PORT" -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
        
        log_success "데이터베이스 재생성 완료"
    fi
    
    # 복원 실행
    log_info "데이터 복원 중..."
    
    if [[ "$backup_file" == *.gz ]]; then
        # 압축된 백업 복원
        if gzip -dc "$backup_file" | psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1; then
            log_success "압축 백업 복원 완료"
        else
            log_error "압축 백업 복원 실패"
            return 1
        fi
    else
        # 일반 백업 복원
        if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 < "$backup_file"; then
            log_success "백업 복원 완료"
        else
            log_error "백업 복원 실패"
            return 1
        fi
    fi
    
    # 복원 후 통계 업데이트
    log_info "데이터베이스 통계 업데이트 중..."
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "ANALYZE;" >/dev/null 2>&1
    
    log_success "복원 작업 완료"
}

# 백업 파일 목록
list_backups() {
    if [ ! -d "$BACKUP_DIR" ]; then
        log_warning "백업 디렉토리가 존재하지 않습니다: $BACKUP_DIR"
        return 1
    fi
    
    log_info "백업 파일 목록 ($BACKUP_DIR):"
    echo ""
    
    local backup_files=($(find "$BACKUP_DIR" -name "backup_*.sql*" -type f | sort -r))
    
    if [ ${#backup_files[@]} -eq 0 ]; then
        log_warning "백업 파일이 없습니다."
        return 0
    fi
    
    printf "%-30s %-10s %-20s\n" "파일명" "크기" "생성일시"
    printf "%-30s %-10s %-20s\n" "$(printf '%.0s-' {1..30})" "$(printf '%.0s-' {1..10})" "$(printf '%.0s-' {1..20})"
    
    for file in "${backup_files[@]}"; do
        local filename=$(basename "$file")
        local filesize=$(du -h "$file" | cut -f1)
        local filedate=$(stat -c %y "$file" | cut -d. -f1)
        
        printf "%-30s %-10s %-20s\n" "$filename" "$filesize" "$filedate"
    done
    
    echo ""
    log_info "총 ${#backup_files[@]}개의 백업 파일"
}

# 오래된 백업 파일 정리
clean_backups() {
    local days=30
    
    # 옵션 파싱
    while [[ $# -gt 0 ]]; do
        case $1 in
            --days)
                days="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done
    
    if [ ! -d "$BACKUP_DIR" ]; then
        log_warning "백업 디렉토리가 존재하지 않습니다: $BACKUP_DIR"
        return 1
    fi
    
    log_info "${days}일 이전 백업 파일 정리 중..."
    
    local old_files=($(find "$BACKUP_DIR" -name "backup_*.sql*" -type f -mtime +$days))
    
    if [ ${#old_files[@]} -eq 0 ]; then
        log_info "정리할 백업 파일이 없습니다."
        return 0
    fi
    
    log_warning "다음 파일들이 삭제됩니다:"
    for file in "${old_files[@]}"; do
        echo "  - $(basename "$file")"
    done
    
    read -p "정말 삭제하시겠습니까? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "정리 취소됨"
        return 1
    fi
    
    local deleted_count=0
    for file in "${old_files[@]}"; do
        if rm "$file"; then
            ((deleted_count++))
            log_info "삭제됨: $(basename "$file")"
        else
            log_error "삭제 실패: $(basename "$file")"
        fi
    done
    
    log_success "${deleted_count}개 파일 정리 완료"
}

# 메인 함수
main() {
    if [ $# -eq 0 ]; then
        usage
        exit 1
    fi
    
    # 환경변수에서 설정 읽기
    if [ -n "$POSTGRES_HOST" ]; then
        DB_HOST="$POSTGRES_HOST"
    fi
    if [ -n "$POSTGRES_PORT" ]; then
        DB_PORT="$POSTGRES_PORT"
    fi
    if [ -n "$POSTGRES_DB" ]; then
        DB_NAME="$POSTGRES_DB"
    fi
    if [ -n "$POSTGRES_USER" ]; then
        DB_USER="$POSTGRES_USER"
    fi
    
    local command="$1"
    shift
    
    case "$command" in
        backup)
            backup_database "$@"
            ;;
        restore)
            restore_database "$@"
            ;;
        list)
            list_backups "$@"
            ;;
        clean)
            clean_backups "$@"
            ;;
        *)
            log_error "알 수 없는 명령어: $command"
            usage
            exit 1
            ;;
    esac
}

# 스크립트가 직접 실행되었을 때만 main 함수 호출
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi