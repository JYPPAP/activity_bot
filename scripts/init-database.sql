-- PostgreSQL 데이터베이스 초기화 스크립트
-- Activity Bot 마이그레이션용

-- 기존 테이블 삭제 (개발환경에서만 사용)
-- DROP TABLE IF EXISTS post_integrations CASCADE;
-- DROP TABLE IF EXISTS guild_settings CASCADE;
-- DROP TABLE IF EXISTS users CASCADE;

-- 1. 사용자 정보 테이블 (잠수 상태 관리 포함)
CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(20) PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    guild_id VARCHAR(20) NOT NULL,
    first_joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- 잠수 상태 관리 (기존 afk_status 테이블 통합)
    inactive_start_date DATE NULL,    -- 잠수 시작 날짜
    inactive_end_date DATE NULL,      -- 잠수 종료 날짜 (NULL이면 진행중)
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. 길드 설정 테이블
CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id VARCHAR(20) PRIMARY KEY,
    guild_name VARCHAR(200),
    game_roles JSONB DEFAULT '[]'::jsonb,
    log_channel_id VARCHAR(20),
    report_channel_id VARCHAR(20),
    excluded_voice_channels JSONB DEFAULT '{"type1": [], "type2": []}'::jsonb,
    activity_tiers JSONB DEFAULT '{
        "tier1": {"min": 30, "max": null},
        "tier2": {"min": 20, "max": 29},
        "tier3": {"min": 15, "max": 19},
        "tier4": {"min": 10, "max": 14},
        "tier5": {"min": 0, "max": 9}
    }'::jsonb,
    timezone VARCHAR(50) DEFAULT 'Asia/Seoul',
    activity_tracking_enabled BOOLEAN DEFAULT true,
    monthly_target_hours INTEGER DEFAULT 30,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. 포스트 연동 + 포럼 메시지 통합 테이블
CREATE TABLE IF NOT EXISTS post_integrations (
    guild_id VARCHAR(20) NOT NULL,
    voice_channel_id VARCHAR(20) NOT NULL,
    forum_post_id VARCHAR(20) NOT NULL,        -- 포럼 포스트(스레드) ID
    forum_channel_id VARCHAR(20) NOT NULL,     -- 포럼 채널 ID
    
    -- 포럼 메시지 추적 (기존 forum_messages 통합)
    participant_message_ids JSONB DEFAULT '[]'::jsonb,    -- 참가자 수 메시지 ID들
    emoji_reaction_message_ids JSONB DEFAULT '[]'::jsonb, -- 이모지 반응 메시지 ID들
    other_message_types JSONB DEFAULT '{}'::jsonb,        -- 기타 메시지 타입들 {"type": [ids]}
    
    -- 연동 상태 및 아카이빙 관리
    is_active BOOLEAN DEFAULT true,             -- 연동 활성 상태
    archived_at TIMESTAMP NULL,                -- 아카이빙 처리 시간
    locked_at TIMESTAMP NULL,                  -- 스레드 잠금 시간
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY(guild_id, voice_channel_id),
    UNIQUE(guild_id, forum_post_id)            -- 포럼 포스트 중복 방지
);

-- 인덱스 생성
-- 사용자 조회 최적화
CREATE INDEX IF NOT EXISTS idx_users_guild_id ON users(guild_id);
CREATE INDEX IF NOT EXISTS idx_users_inactive_dates ON users(inactive_start_date, inactive_end_date) WHERE inactive_start_date IS NOT NULL;

-- 포스트 연동 조회 최적화
CREATE INDEX IF NOT EXISTS idx_post_integrations_forum_post ON post_integrations(forum_post_id);
CREATE INDEX IF NOT EXISTS idx_post_integrations_voice_channel ON post_integrations(voice_channel_id);
CREATE INDEX IF NOT EXISTS idx_post_integrations_active ON post_integrations(is_active) WHERE is_active = true;

-- 월별 활동 테이블 생성 함수
DROP FUNCTION IF EXISTS create_monthly_activity_table(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION create_monthly_activity_table(table_suffix TEXT)
RETURNS VOID AS $$
DECLARE
    table_name TEXT;
BEGIN
    table_name := 'user_activities_' || table_suffix;
    
    -- 테이블이 존재하지 않으면 생성
    IF NOT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE information_schema.tables.table_name = table_name
          AND information_schema.tables.table_schema = 'public'
    ) THEN
        EXECUTE format('
            CREATE TABLE %I (
                guild_id VARCHAR(20) NOT NULL,
                user_id VARCHAR(20) NOT NULL,
                username VARCHAR(100) NOT NULL,
                daily_voice_minutes JSONB DEFAULT ''{}''::jsonb, -- {"01": 120, "02": 45, ...}
                total_voice_minutes INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(guild_id, user_id)
            )', table_name);
        
        -- 인덱스 생성
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_user_id ON %I(user_id)', table_name, table_name);
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_guild_id ON %I(guild_id)', table_name, table_name);
        
        RAISE NOTICE '월별 활동 테이블 생성 완료: %', table_name;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 현재 월 활동 테이블 생성
SELECT create_monthly_activity_table(to_char(CURRENT_DATE, 'YYYYMM'));

-- 다음 월 활동 테이블 생성 (미리 준비)
SELECT create_monthly_activity_table(to_char(CURRENT_DATE + INTERVAL '1 month', 'YYYYMM'));

-- 트리거 함수: updated_at 자동 업데이트
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성: updated_at 자동 업데이트
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_guild_settings_updated_at
    BEFORE UPDATE ON guild_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_post_integrations_updated_at
    BEFORE UPDATE ON post_integrations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 초기화 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '=== PostgreSQL 데이터베이스 초기화 완료 ===';
    RAISE NOTICE '생성된 테이블:';
    RAISE NOTICE '  - users (사용자 정보 + 잠수 상태)';
    RAISE NOTICE '  - guild_settings (길드 설정)';
    RAISE NOTICE '  - post_integrations (포스트 연동 + 포럼 메시지)';
    RAISE NOTICE '  - user_activities_%% (월별 활동 데이터)';
    RAISE NOTICE '생성된 인덱스 및 트리거: 조회 성능 최적화 완료';
    RAISE NOTICE '============================================';
END $$;
