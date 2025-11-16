#!/data/data/com.termux/files/usr/bin/bash
# =====================================================
# Discord Bot 재시작 스크립트 (Termux)
# =====================================================
# PostgreSQL 서버 시작 + PM2 봇 재시작을 자동으로 수행합니다.

set -e  # 에러 발생 시 스크립트 중단

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 설정
POSTGRES_DATA_DIR="$HOME/postgres_data"
BOT_NAME="discord-bot"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🤖 Discord Bot 재시작${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 1. PostgreSQL 서버 상태 확인 및 시작
echo -e "${YELLOW}[1/3] PostgreSQL 서버 확인 중...${NC}"

if pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
  echo -e "${GREEN}   ✅ PostgreSQL 서버가 이미 실행 중입니다.${NC}"
else
  echo -e "${YELLOW}   ⚠️  PostgreSQL 서버가 실행 중이 아닙니다.${NC}"
  echo -e "${YELLOW}   🚀 PostgreSQL 서버를 시작합니다...${NC}"

  if pg_ctl start -D "$POSTGRES_DATA_DIR" -l "$POSTGRES_DATA_DIR/logfile" > /dev/null 2>&1; then
    # 서버가 준비될 때까지 대기
    sleep 3

    if pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
      echo -e "${GREEN}   ✅ PostgreSQL 서버 시작 완료${NC}"
    else
      echo -e "${RED}   ❌ PostgreSQL 서버 시작 실패${NC}"
      echo -e "${YELLOW}   💡 수동으로 시작하세요: pg_ctl start -D $POSTGRES_DATA_DIR${NC}"
      exit 1
    fi
  else
    echo -e "${RED}   ❌ PostgreSQL 서버 시작 실패${NC}"
    exit 1
  fi
fi

echo ""

# 2. PM2 봇 재시작
echo -e "${YELLOW}[2/3] Discord Bot 재시작 중...${NC}"

if pm2 restart "$BOT_NAME" > /dev/null 2>&1; then
  echo -e "${GREEN}   ✅ 봇 재시작 완료${NC}"
else
  echo -e "${YELLOW}   ⚠️  PM2에서 봇을 찾을 수 없습니다. 새로 시작합니다...${NC}"

  if pm2 start ecosystem-termux.config.cjs > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ 봇 시작 완료${NC}"
  else
    echo -e "${RED}   ❌ 봇 시작 실패${NC}"
    echo -e "${YELLOW}   💡 수동으로 시작하세요: pm2 start ecosystem-termux.config.cjs${NC}"
    exit 1
  fi
fi

echo ""

# 3. 상태 확인
echo -e "${YELLOW}[3/3] 상태 확인 중...${NC}"

# PostgreSQL 연결 테스트
if psql -d activity_bot -c "SELECT 1;" > /dev/null 2>&1; then
  echo -e "${GREEN}   ✅ 데이터베이스 연결 정상${NC}"
else
  echo -e "${RED}   ❌ 데이터베이스 연결 실패${NC}"
fi

# PM2 상태 확인
if pm2 list | grep -q "$BOT_NAME.*online"; then
  echo -e "${GREEN}   ✅ 봇 상태: 실행 중${NC}"
else
  echo -e "${YELLOW}   ⚠️  봇 상태를 확인하세요: pm2 list${NC}"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ 재시작 완료!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}💡 로그 확인: ${NC}pm2 logs $BOT_NAME --lines 20"
echo -e "${YELLOW}💡 상태 확인: ${NC}pm2 list"
echo -e "${YELLOW}💡 백업 실행: ${NC}npm run backup:db"
echo ""
