-- PostgreSQL 프로덕션환경 초기화 스크립트
-- 실행 방법: psql -U postgres -f scripts/init-postgresql-prod.sql

-- 프로덕션용 데이터베이스 생성
CREATE DATABASE discord_bot
    OWNER postgres
    ENCODING 'UTF8'
    LC_COLLATE 'en_US.UTF-8'
    LC_CTYPE 'en_US.UTF-8'
    TEMPLATE template0;

-- 프로덕션용 사용자 생성
CREATE USER discord_bot WITH PASSWORD 'prod_password';

-- 권한 부여
GRANT ALL PRIVILEGES ON DATABASE discord_bot TO discord_bot;

-- 데이터베이스 변경
\c discord_bot

-- 스키마 권한 부여
GRANT ALL ON SCHEMA public TO discord_bot;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO discord_bot;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO discord_bot;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO discord_bot;

-- 미래에 생성될 객체에 대한 기본 권한 설정
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO discord_bot;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO discord_bot;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO discord_bot;

-- 연결 테스트
SELECT 'PostgreSQL 프로덕션환경 초기화 완료!' as status;