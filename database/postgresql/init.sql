-- =====================================================
-- Discord Activity Bot - PostgreSQL 초기화 스크립트
-- =====================================================
-- 이 스크립트는 Discord 활동 추적 봇의 모든 테이블과 
-- 관련 함수, 트리거, 인덱스를 생성합니다.

-- 기존 데이터베이스 삭제 및 재생성 (선택사항)
-- DROP DATABASE IF EXISTS discord_bot;
-- CREATE DATABASE discord_bot OWNER postgres;

-- 확장 기능 활성화
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- 1. 사용자 활동 테이블 (user_activity)
-- =====================================================
-- 목적: 사용자의 음성 채널 활동 시간 추적
CREATE TABLE IF NOT EXISTS user_activity (
    user_id VARCHAR(20) PRIMARY KEY,
    total_time BIGINT NOT NULL DEFAULT 0,
    start_time BIGINT,
    last_update BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
    last_activity BIGINT,
    display_name VARCHAR(100),
    current_channel_id VARCHAR(20),
    session_start_time BIGINT,
    daily_time BIGINT DEFAULT 0,
    weekly_time BIGINT DEFAULT 0,
    monthly_time BIGINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- 2. 역할 설정 테이블 (role_config)
-- =====================================================
-- 목적: 역할별 최소 활동 시간 설정 관리
CREATE TABLE IF NOT EXISTS role_config (
    role_name VARCHAR(50) PRIMARY KEY,
    min_hours INTEGER NOT NULL,
    warning_threshold INTEGER,
    allowed_afk_duration BIGINT,
    reset_time INTEGER,
    report_cycle VARCHAR(20),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- 3. 활동 로그 테이블 (activity_log)
-- =====================================================
-- 목적: 사용자의 상세 활동 로그 기록
CREATE TABLE IF NOT EXISTS activity_log (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL,
    user_name VARCHAR(100),
    channel_id VARCHAR(20),
    channel_name VARCHAR(100),
    action VARCHAR(20) NOT NULL CHECK (action IN ('join', 'leave', 'move', 'disconnect')),
    timestamp BIGINT NOT NULL,
    duration BIGINT DEFAULT 0,
    additional_data JSONB,
    guild_id VARCHAR(20),
    created_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- 4. AFK 상태 테이블 (afk_status)
-- =====================================================
-- 목적: 사용자의 잠수(AFK) 상태 관리
CREATE TABLE IF NOT EXISTS afk_status (
    user_id VARCHAR(20) PRIMARY KEY,
    is_afk BOOLEAN NOT NULL DEFAULT FALSE,
    afk_start_time BIGINT,
    afk_until BIGINT,
    afk_reason TEXT,
    total_afk_time BIGINT DEFAULT 0,
    last_update BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- 5. 음성 채널 매핑 테이블 (voice_channel_mapping)
-- =====================================================
-- 목적: 음성 채널과 포럼 포스트 연결
CREATE TABLE IF NOT EXISTS voice_channel_mapping (
    channel_id VARCHAR(20) PRIMARY KEY,
    forum_post_id VARCHAR(20),
    thread_id VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- 6. 길드 설정 테이블 (guild_settings)
-- =====================================================
-- 목적: 길드별 봇 설정 관리
CREATE TABLE IF NOT EXISTS guild_settings (
    id SERIAL PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    setting_type VARCHAR(50) NOT NULL CHECK (setting_type IN ('role_activity', 'game_list', 'exclude_channels', 'channel_management')),
    setting_key VARCHAR(100) NOT NULL,
    setting_value TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(guild_id, setting_type, setting_key)
);

-- =====================================================
-- 7. 설정 감사 로그 테이블 (settings_audit_log)
-- =====================================================
-- 목적: 설정 변경 이력 추적
CREATE TABLE IF NOT EXISTS settings_audit_log (
    id SERIAL PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    user_id VARCHAR(20) NOT NULL,
    user_name VARCHAR(100) NOT NULL,
    action VARCHAR(10) NOT NULL CHECK (action IN ('create', 'update', 'delete')),
    setting_type VARCHAR(50) NOT NULL,
    setting_key VARCHAR(100),
    old_value TEXT,
    new_value TEXT,
    timestamp BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
    created_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- 8. 일일 활동 통계 테이블 (daily_activity_stats)
-- =====================================================
-- 목적: 일별 활동 통계 집계
CREATE TABLE IF NOT EXISTS daily_activity_stats (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    total_joins INTEGER DEFAULT 0,
    total_leaves INTEGER DEFAULT 0,
    total_events INTEGER DEFAULT 0,
    unique_users INTEGER DEFAULT 0,
    peak_concurrent_users INTEGER DEFAULT 0,
    total_active_time BIGINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- 9. 인덱스 생성
-- =====================================================

-- 사용자 활동 관련 인덱스
CREATE INDEX IF NOT EXISTS idx_user_activity_last_update ON user_activity(last_update);
CREATE INDEX IF NOT EXISTS idx_user_activity_total_time ON user_activity(total_time DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_display_name ON user_activity(display_name);

-- 활동 로그 관련 인덱스
CREATE INDEX IF NOT EXISTS idx_activity_log_user_timestamp ON activity_log(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_channel_timestamp ON activity_log(channel_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_timestamp ON activity_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action);
CREATE INDEX IF NOT EXISTS idx_activity_log_guild_id ON activity_log(guild_id);

-- 길드 설정 관련 인덱스
CREATE INDEX IF NOT EXISTS idx_guild_settings_guild_type ON guild_settings(guild_id, setting_type);
CREATE INDEX IF NOT EXISTS idx_guild_settings_type_key ON guild_settings(setting_type, setting_key);

-- 설정 감사 로그 관련 인덱스
CREATE INDEX IF NOT EXISTS idx_settings_audit_guild_time ON settings_audit_log(guild_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_settings_audit_user_time ON settings_audit_log(user_id, timestamp DESC);

-- AFK 상태 관련 인덱스
CREATE INDEX IF NOT EXISTS idx_afk_status_afk_until ON afk_status(afk_until) WHERE is_afk = true;

-- 일일 통계 관련 인덱스
CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_activity_stats(date DESC);

-- =====================================================
-- 10. 트리거 함수 정의
-- =====================================================

-- updated_at 자동 업데이트 함수
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 일일 통계 업데이트 함수
CREATE OR REPLACE FUNCTION update_daily_stats()
RETURNS TRIGGER AS $$
DECLARE
    log_date DATE;
BEGIN
    log_date := DATE(TO_TIMESTAMP(NEW.timestamp / 1000));
    
    INSERT INTO daily_activity_stats (date, total_events)
    VALUES (log_date, 1)
    ON CONFLICT (date)
    DO UPDATE SET 
        total_events = daily_activity_stats.total_events + 1,
        total_joins = CASE 
            WHEN NEW.action = 'join' THEN daily_activity_stats.total_joins + 1 
            ELSE daily_activity_stats.total_joins 
        END,
        total_leaves = CASE 
            WHEN NEW.action = 'leave' THEN daily_activity_stats.total_leaves + 1 
            ELSE daily_activity_stats.total_leaves 
        END,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- =====================================================
-- 11. 트리거 생성
-- =====================================================

-- updated_at 자동 업데이트 트리거
DROP TRIGGER IF EXISTS update_user_activity_updated_at ON user_activity;
CREATE TRIGGER update_user_activity_updated_at
    BEFORE UPDATE ON user_activity
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_role_config_updated_at ON role_config;
CREATE TRIGGER update_role_config_updated_at
    BEFORE UPDATE ON role_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_afk_status_updated_at ON afk_status;
CREATE TRIGGER update_afk_status_updated_at
    BEFORE UPDATE ON afk_status
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_voice_channel_mapping_updated_at ON voice_channel_mapping;
CREATE TRIGGER update_voice_channel_mapping_updated_at
    BEFORE UPDATE ON voice_channel_mapping
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_guild_settings_updated_at ON guild_settings;
CREATE TRIGGER update_guild_settings_updated_at
    BEFORE UPDATE ON guild_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_daily_stats_updated_at ON daily_activity_stats;
CREATE TRIGGER update_daily_stats_updated_at
    BEFORE UPDATE ON daily_activity_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 일일 통계 자동 업데이트 트리거
DROP TRIGGER IF EXISTS update_daily_stats_trigger ON activity_log;
CREATE TRIGGER update_daily_stats_trigger
    AFTER INSERT ON activity_log
    FOR EACH ROW EXECUTE FUNCTION update_daily_stats();

-- =====================================================
-- 12. 기본 데이터 삽입
-- =====================================================

-- 기본 역할 설정 (예시)
INSERT INTO role_config (role_name, min_hours, warning_threshold, reset_time, report_cycle)
VALUES 
    ('정규멤버', 10, 5, 1, 'weekly'),
    ('준회원', 5, 2, 1, 'weekly'),
    ('관리자', 0, 0, 1, 'monthly')
ON CONFLICT (role_name) DO NOTHING;

-- 기본 길드 설정 (예시 - 실제 길드 ID로 교체 필요)
-- INSERT INTO guild_settings (guild_id, setting_type, setting_key, setting_value)
-- VALUES 
--     ('YOUR_GUILD_ID', 'channel_management', 'log_channel_id', 'YOUR_LOG_CHANNEL_ID'),
--     ('YOUR_GUILD_ID', 'channel_management', 'forum_channel_id', 'YOUR_FORUM_CHANNEL_ID')
-- ON CONFLICT (guild_id, setting_type, setting_key) DO NOTHING;

-- =====================================================
-- 13. 유틸리티 뷰 생성
-- =====================================================

-- 활성 사용자 뷰
CREATE OR REPLACE VIEW active_users AS
SELECT 
    u.user_id,
    u.display_name,
    u.total_time,
    u.last_activity,
    u.current_channel_id,
    CASE 
        WHEN u.last_activity > EXTRACT(EPOCH FROM NOW() - INTERVAL '1 hour') * 1000 THEN 'online'
        WHEN u.last_activity > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours') * 1000 THEN 'recent'
        ELSE 'inactive'
    END as status
FROM user_activity u
WHERE u.total_time > 0
ORDER BY u.total_time DESC;

-- 일일 활동 요약 뷰
CREATE OR REPLACE VIEW daily_activity_summary AS
SELECT 
    date,
    total_joins,
    total_leaves,
    total_events,
    unique_users,
    peak_concurrent_users,
    ROUND(total_active_time / 1000.0 / 3600.0, 2) as total_active_hours
FROM daily_activity_stats
ORDER BY date DESC;

-- =====================================================
-- 14. 권한 설정
-- =====================================================

-- discord_bot 사용자 권한 설정 (사용자가 존재하는 경우)
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO discord_bot;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO discord_bot;
-- GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO discord_bot;

-- =====================================================
-- 초기화 완료
-- =====================================================

-- 초기화 완료 로그
DO $$
BEGIN
    RAISE NOTICE 'Discord Activity Bot 데이터베이스 초기화가 완료되었습니다.';
    RAISE NOTICE '생성된 테이블: user_activity, role_config, activity_log, afk_status, voice_channel_mapping, guild_settings, settings_audit_log, daily_activity_stats';
    RAISE NOTICE '생성된 인덱스: % 개', (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public');
    RAISE NOTICE '생성된 트리거: % 개', (SELECT COUNT(*) FROM pg_trigger WHERE tgisinternal = false);
END $$;