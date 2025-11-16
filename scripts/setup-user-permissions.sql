-- =====================================================
-- PostgreSQL User & Permissions Setup
-- =====================================================
-- 이 파일은 discord_bot 사용자와 권한을 설정합니다.
-- initdb 후 또는 새로운 PostgreSQL 인스턴스 설정 시 실행하세요.

-- 1. 사용자 생성
-- 이미 존재하는 경우 에러가 발생하지만 무시해도 됩니다.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = 'discord_bot') THEN
    CREATE USER discord_bot WITH PASSWORD 'prod_password';
    RAISE NOTICE 'User discord_bot created successfully';
  ELSE
    RAISE NOTICE 'User discord_bot already exists';
  END IF;
END
$$;

-- 2. activity_bot 데이터베이스에 대한 권한 부여
GRANT ALL PRIVILEGES ON DATABASE activity_bot TO discord_bot;

-- 3. public 스키마에 대한 권한 부여
GRANT ALL ON SCHEMA public TO discord_bot;

-- 4. 기존 테이블에 대한 모든 권한 부여
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO discord_bot;

-- 5. 기존 시퀀스에 대한 모든 권한 부여 (ID 자동 증가용)
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO discord_bot;

-- 6. 기존 함수에 대한 실행 권한 부여
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO discord_bot;

-- 7. 앞으로 생성될 테이블에 대한 기본 권한 설정
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO discord_bot;

-- 8. 앞으로 생성될 시퀀스에 대한 기본 권한 설정
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO discord_bot;

-- 9. 앞으로 생성될 함수에 대한 기본 권한 설정
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO discord_bot;

-- 완료 메시지
DO $$
BEGIN
  RAISE NOTICE '✅ discord_bot 사용자 권한 설정 완료';
  RAISE NOTICE '📊 데이터베이스: activity_bot';
  RAISE NOTICE '👤 사용자: discord_bot';
  RAISE NOTICE '🔑 권한: ALL PRIVILEGES';
END
$$;
