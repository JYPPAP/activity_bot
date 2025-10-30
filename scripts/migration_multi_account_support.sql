-- Migration: 닉네임 시스템 다중 계정 지원
-- 작성일: 2025-01-29
-- 설명: 하나의 플랫폼에 최대 5개의 계정을 등록할 수 있도록 스키마 변경

-- Step 1: 기존 UNIQUE 제약조건 삭제
-- (guild_id, user_id, platform_id) 조합의 유일성 제약 제거
ALTER TABLE user_nicknames DROP CONSTRAINT IF EXISTS user_nicknames_guild_id_user_id_platform_id_key;

-- Step 2: 새로운 UNIQUE 제약조건 추가
-- 완전히 동일한 계정 (guild_id, user_id, platform_id, user_identifier) 중복 방지
ALTER TABLE user_nicknames ADD CONSTRAINT user_nicknames_unique_account
UNIQUE(guild_id, user_id, platform_id, user_identifier);

-- Step 3: 기존 데이터 확인 (선택사항)
-- 마이그레이션 후 사용자별 플랫폼당 계정 개수 확인
SELECT
    guild_id,
    user_id,
    platform_id,
    COUNT(*) as account_count
FROM user_nicknames
GROUP BY guild_id, user_id, platform_id
HAVING COUNT(*) > 1
ORDER BY account_count DESC;

-- 참고: 플랫폼별 최대 5개 제한은 애플리케이션 레벨에서 검증됩니다.
