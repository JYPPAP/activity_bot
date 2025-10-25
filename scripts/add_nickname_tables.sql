-- 닉네임 관리 시스템 테이블 생성 스크립트
-- Activity Bot 닉네임 등록 기능

-- 1. 플랫폼 템플릿 테이블
CREATE TABLE IF NOT EXISTS platform_templates (
    id SERIAL PRIMARY KEY,
    guild_id VARCHAR(50) NOT NULL,
    platform_name VARCHAR(100) NOT NULL,
    emoji_unicode VARCHAR(50) DEFAULT '🎮',
    base_url VARCHAR(500) NOT NULL,
    url_pattern VARCHAR(500) DEFAULT '{base_url}{user_id}/',
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(guild_id, platform_name)
);

-- 2. 사용자 닉네임 테이블
CREATE TABLE IF NOT EXISTS user_nicknames (
    id SERIAL PRIMARY KEY,
    guild_id VARCHAR(50) NOT NULL,
    user_id VARCHAR(50) NOT NULL,
    platform_id INTEGER REFERENCES platform_templates(id) ON DELETE CASCADE,
    user_identifier VARCHAR(200) NOT NULL,
    full_url VARCHAR(700) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(guild_id, user_id, platform_id)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_platform_templates_guild ON platform_templates(guild_id);
CREATE INDEX IF NOT EXISTS idx_platform_templates_display_order ON platform_templates(guild_id, display_order);
CREATE INDEX IF NOT EXISTS idx_user_nicknames_guild_user ON user_nicknames(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_nicknames_platform ON user_nicknames(platform_id);

-- 트리거 함수: updated_at 자동 업데이트 (기존 함수 사용)
-- update_updated_at_column() 함수는 init-database.sql에 이미 정의되어 있음

-- 트리거 생성: platform_templates updated_at 자동 업데이트
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = 'update_platform_templates_updated_at'
      AND c.relname = 'platform_templates'
  ) THEN
    CREATE TRIGGER update_platform_templates_updated_at
      BEFORE UPDATE ON platform_templates
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- 트리거 생성: user_nicknames updated_at 자동 업데이트
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = 'update_user_nicknames_updated_at'
      AND c.relname = 'user_nicknames'
  ) THEN
    CREATE TRIGGER update_user_nicknames_updated_at
      BEFORE UPDATE ON user_nicknames
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- 초기화 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '=== 닉네임 관리 시스템 테이블 생성 완료 ===';
    RAISE NOTICE '생성된 테이블:';
    RAISE NOTICE '  - platform_templates (플랫폼 템플릿)';
    RAISE NOTICE '  - user_nicknames (사용자 닉네임)';
    RAISE NOTICE '생성된 인덱스 및 트리거: 조회 성능 최적화 완료';
    RAISE NOTICE '============================================';
END $$;
