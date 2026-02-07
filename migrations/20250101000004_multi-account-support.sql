-- Up Migration

-- 기존 UNIQUE 제약조건 삭제
-- (guild_id, user_id, platform_id) 조합의 유일성 제약 제거
ALTER TABLE user_nicknames DROP CONSTRAINT IF EXISTS user_nicknames_guild_id_user_id_platform_id_key;

-- 새로운 UNIQUE 제약조건 추가
-- 완전히 동일한 계정 (guild_id, user_id, platform_id, user_identifier) 중복 방지
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_nicknames_unique_account'
  ) THEN
    ALTER TABLE user_nicknames ADD CONSTRAINT user_nicknames_unique_account
    UNIQUE(guild_id, user_id, platform_id, user_identifier);
  END IF;
END $$;

-- Down Migration

ALTER TABLE user_nicknames DROP CONSTRAINT IF EXISTS user_nicknames_unique_account;
ALTER TABLE user_nicknames ADD CONSTRAINT user_nicknames_guild_id_user_id_platform_id_key
UNIQUE(guild_id, user_id, platform_id);
