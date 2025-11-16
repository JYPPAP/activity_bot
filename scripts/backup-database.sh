#!/data/data/com.termux/files/usr/bin/bash
# =====================================================
# PostgreSQL 데이터베이스 백업 스크립트
# =====================================================
# Termux 환경에서 activity_bot 데이터베이스를 백업합니다.

set -e  # 에러 발생 시 스크립트 중단

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 설정
DB_NAME="activity_bot"
DB_USER="u0_a308"  # Termux 기본 사용자
BACKUP_DIR="$HOME/discord_bot/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/activity_bot_${TIMESTAMP}.backup"

echo -e "${GREEN}📦 PostgreSQL 데이터베이스 백업 시작${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 백업 디렉토리 생성
if [ ! -d "$BACKUP_DIR" ]; then
  echo -e "${YELLOW}📁 백업 디렉토리 생성: $BACKUP_DIR${NC}"
  mkdir -p "$BACKUP_DIR"
fi

# PostgreSQL 서버 실행 확인
echo -e "${YELLOW}🔍 PostgreSQL 서버 상태 확인...${NC}"
if ! pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
  echo -e "${RED}❌ PostgreSQL 서버가 실행 중이 아닙니다.${NC}"
  echo -e "${YELLOW}서버를 시작하려면: pg_ctl start -D ~/postgres_data${NC}"
  exit 1
fi
echo -e "${GREEN}✅ PostgreSQL 서버 실행 중${NC}"

# 데이터베이스 백업
echo -e "${YELLOW}💾 데이터베이스 백업 중...${NC}"
echo "   - 데이터베이스: $DB_NAME"
echo "   - 백업 파일: $BACKUP_FILE"

if pg_dump -U "$DB_USER" -d "$DB_NAME" -F c -f "$BACKUP_FILE"; then
  # 백업 파일 크기 확인
  FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo -e "${GREEN}✅ 백업 완료!${NC}"
  echo "   - 파일 크기: $FILE_SIZE"
  echo "   - 저장 위치: $BACKUP_FILE"
else
  echo -e "${RED}❌ 백업 실패${NC}"
  exit 1
fi

# 오래된 백업 파일 정리 (30일 이상 된 파일 삭제)
echo ""
echo -e "${YELLOW}🧹 오래된 백업 파일 정리 (30일 이상)${NC}"
DELETED_COUNT=$(find "$BACKUP_DIR" -name "activity_bot_*.backup" -type f -mtime +30 -delete -print | wc -l)
if [ "$DELETED_COUNT" -gt 0 ]; then
  echo -e "${GREEN}   - 삭제된 파일: ${DELETED_COUNT}개${NC}"
else
  echo -e "${GREEN}   - 삭제할 파일 없음${NC}"
fi

# 백업 파일 목록 표시 (최근 5개)
echo ""
echo -e "${GREEN}📋 최근 백업 파일 (최근 5개):${NC}"
ls -lht "$BACKUP_DIR"/activity_bot_*.backup 2>/dev/null | head -5 | awk '{print "   - " $9 " (" $5 ", " $6 " " $7 " " $8 ")"}'

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ 백업 작업 완료${NC}"
echo ""
echo -e "${YELLOW}💡 백업 복원 방법:${NC}"
echo "   pg_restore -U $DB_USER -d $DB_NAME -c $BACKUP_FILE"
echo ""
