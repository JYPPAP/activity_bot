-- Up Migration
-- 닉네임 시스템 NOT NULL 제약조건 수정
-- 문제: base_url과 full_url이 NOT NULL이지만, 코드에서 선택사항으로 처리됨
-- base_url이 없는 플랫폼(예: 프로필 URL이 없는 게임)의 경우 null 허용 필요

-- platform_templates.base_url: NOT NULL → NULL 허용
ALTER TABLE platform_templates ALTER COLUMN base_url DROP NOT NULL;
ALTER TABLE platform_templates ALTER COLUMN base_url SET DEFAULT NULL;

-- user_nicknames.full_url: NOT NULL → NULL 허용
ALTER TABLE user_nicknames ALTER COLUMN full_url DROP NOT NULL;
ALTER TABLE user_nicknames ALTER COLUMN full_url SET DEFAULT NULL;

-- Down Migration
-- ALTER TABLE platform_templates ALTER COLUMN base_url SET NOT NULL;
-- ALTER TABLE user_nicknames ALTER COLUMN full_url SET NOT NULL;
