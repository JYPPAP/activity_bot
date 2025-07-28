-- =====================================================
-- Discord Activity Bot - 개선된 스키마 (기간별 활동 최적화)
-- =====================================================
-- 목적: 기간별 보고서 생성을 위한 고성능 집계 테이블 구조

-- =====================================================
-- 1. 사용자 일일 활동 집계 테이블 (NEW)
-- =====================================================
-- 목적: 일별 사용자 활동을 미리 집계하여 빠른 기간별 조회 지원
CREATE TABLE IF NOT EXISTS user_daily_activity (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL,
    activity_date DATE NOT NULL,
    total_time_ms BIGINT NOT NULL DEFAULT 0,
    session_count INTEGER NOT NULL DEFAULT 0,
    first_activity_time BIGINT,
    last_activity_time BIGINT,
    channels_visited TEXT[], -- 방문한 채널 ID 목록
    peak_concurrent_session_time BIGINT, -- 가장 긴 연속 세션
    guild_id VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- 복합 인덱스로 빠른 조회 보장
    UNIQUE(user_id, activity_date, guild_id)
);

-- =====================================================
-- 2. 사용자 주별 활동 집계 테이블 (NEW)
-- =====================================================
-- 목적: 주별 집계로 중장기 보고서 성능 최적화
CREATE TABLE IF NOT EXISTS user_weekly_activity (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL,
    week_start_date DATE NOT NULL, -- 주 시작일 (월요일)
    week_end_date DATE NOT NULL,   -- 주 종료일 (일요일)
    total_time_ms BIGINT NOT NULL DEFAULT 0,
    active_days INTEGER NOT NULL DEFAULT 0, -- 활동한 일수
    session_count INTEGER NOT NULL DEFAULT 0,
    avg_daily_time_ms BIGINT GENERATED ALWAYS AS (total_time_ms / GREATEST(active_days, 1)) STORED,
    guild_id VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(user_id, week_start_date, guild_id)
);

-- =====================================================
-- 3. 사용자 월별 활동 집계 테이블 (NEW)
-- =====================================================
CREATE TABLE IF NOT EXISTS user_monthly_activity (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL,
    activity_month DATE NOT NULL, -- 월 첫째 날 (YYYY-MM-01)
    total_time_ms BIGINT NOT NULL DEFAULT 0,
    active_days INTEGER NOT NULL DEFAULT 0,
    session_count INTEGER NOT NULL DEFAULT 0,
    avg_daily_time_ms BIGINT GENERATED ALWAYS AS (total_time_ms / GREATEST(active_days, 1)) STORED,
    guild_id VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(user_id, activity_month, guild_id)
);

-- =====================================================
-- 4. 활동 세션 테이블 (개선된 구조)
-- =====================================================
-- 목적: 실시간 세션 추적 및 집계 테이블 업데이트 소스
CREATE TABLE IF NOT EXISTS activity_sessions (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL,
    user_name VARCHAR(100),
    guild_id VARCHAR(20) NOT NULL,
    channel_id VARCHAR(20) NOT NULL,
    channel_name VARCHAR(100),
    session_start_time BIGINT NOT NULL,
    session_end_time BIGINT,
    duration_ms BIGINT,
    session_type VARCHAR(20) DEFAULT 'voice' CHECK (session_type IN ('voice', 'afk')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- 5. 기간별 보고서 캐시 테이블 (NEW)
-- =====================================================
-- 목적: 생성된 보고서 캐싱으로 반복 요청 최적화
CREATE TABLE IF NOT EXISTS report_cache (
    id SERIAL PRIMARY KEY,
    cache_key VARCHAR(255) UNIQUE NOT NULL,
    guild_id VARCHAR(20) NOT NULL,
    role_name VARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    report_data JSONB NOT NULL,
    user_count INTEGER NOT NULL,
    generation_time_ms INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);

-- =====================================================
-- 6. 개선된 인덱스 전략
-- =====================================================

-- 일일 활동 집계 인덱스
CREATE INDEX IF NOT EXISTS idx_user_daily_activity_user_date ON user_daily_activity(user_id, activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_user_daily_activity_guild_date ON user_daily_activity(guild_id, activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_user_daily_activity_date_range ON user_daily_activity(activity_date) WHERE total_time_ms > 0;

-- 주별 활동 집계 인덱스
CREATE INDEX IF NOT EXISTS idx_user_weekly_activity_user_week ON user_weekly_activity(user_id, week_start_date DESC);
CREATE INDEX IF NOT EXISTS idx_user_weekly_activity_guild_week ON user_weekly_activity(guild_id, week_start_date DESC);

-- 월별 활동 집계 인덱스
CREATE INDEX IF NOT EXISTS idx_user_monthly_activity_user_month ON user_monthly_activity(user_id, activity_month DESC);
CREATE INDEX IF NOT EXISTS idx_user_monthly_activity_guild_month ON user_monthly_activity(guild_id, activity_month DESC);

-- 세션 테이블 인덱스
CREATE INDEX IF NOT EXISTS idx_activity_sessions_user_time ON activity_sessions(user_id, session_start_time DESC);
CREATE INDEX IF NOT EXISTS idx_activity_sessions_active ON activity_sessions(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_activity_sessions_guild_time ON activity_sessions(guild_id, session_start_time DESC);

-- 보고서 캐시 인덱스
CREATE INDEX IF NOT EXISTS idx_report_cache_key ON report_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_report_cache_guild_role ON report_cache(guild_id, role_name);
CREATE INDEX IF NOT EXISTS idx_report_cache_expires ON report_cache(expires_at) WHERE expires_at > NOW();

-- =====================================================
-- 7. 집계 업데이트 함수들
-- =====================================================

-- 일일 활동 집계 업데이트 함수
CREATE OR REPLACE FUNCTION update_daily_activity_aggregation()
RETURNS TRIGGER AS $$
DECLARE
    target_date DATE;
    existing_record RECORD;
BEGIN
    -- 세션 종료 시에만 집계 업데이트
    IF NEW.session_end_time IS NOT NULL AND NEW.duration_ms IS NOT NULL THEN
        target_date := DATE(TO_TIMESTAMP(NEW.session_start_time / 1000));
        
        -- 기존 레코드 확인
        SELECT * INTO existing_record 
        FROM user_daily_activity 
        WHERE user_id = NEW.user_id 
          AND activity_date = target_date 
          AND guild_id = NEW.guild_id;
        
        IF existing_record IS NOT NULL THEN
            -- 기존 레코드 업데이트
            UPDATE user_daily_activity 
            SET 
                total_time_ms = total_time_ms + NEW.duration_ms,
                session_count = session_count + 1,
                last_activity_time = GREATEST(last_activity_time, NEW.session_end_time),
                channels_visited = ARRAY(
                    SELECT DISTINCT unnest(channels_visited || ARRAY[NEW.channel_id])
                ),
                peak_concurrent_session_time = GREATEST(
                    COALESCE(peak_concurrent_session_time, 0), 
                    NEW.duration_ms
                ),
                updated_at = NOW()
            WHERE user_id = NEW.user_id 
              AND activity_date = target_date 
              AND guild_id = NEW.guild_id;
        ELSE
            -- 새 레코드 삽입
            INSERT INTO user_daily_activity (
                user_id, activity_date, total_time_ms, session_count,
                first_activity_time, last_activity_time, channels_visited,
                peak_concurrent_session_time, guild_id
            ) VALUES (
                NEW.user_id, target_date, NEW.duration_ms, 1,
                NEW.session_start_time, NEW.session_end_time, ARRAY[NEW.channel_id],
                NEW.duration_ms, NEW.guild_id
            );
        END IF;
        
        -- 주별/월별 집계도 업데이트
        PERFORM update_weekly_monthly_aggregation(NEW.user_id, target_date, NEW.guild_id);
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 주별/월별 집계 업데이트 함수
CREATE OR REPLACE FUNCTION update_weekly_monthly_aggregation(
    p_user_id VARCHAR(20), 
    p_date DATE, 
    p_guild_id VARCHAR(20)
)
RETURNS VOID AS $$
DECLARE
    week_start DATE;
    week_end DATE;
    month_start DATE;
    daily_total BIGINT;
    weekly_total BIGINT;
    monthly_total BIGINT;
    weekly_days INTEGER;
    monthly_days INTEGER;
BEGIN
    -- 해당 날짜의 일일 총 활동 시간 조회
    SELECT total_time_ms INTO daily_total
    FROM user_daily_activity
    WHERE user_id = p_user_id AND activity_date = p_date AND guild_id = p_guild_id;
    
    -- 주별 집계 계산
    week_start := DATE_TRUNC('week', p_date)::DATE;
    week_end := (week_start + INTERVAL '6 days')::DATE;
    
    SELECT 
        COALESCE(SUM(total_time_ms), 0),
        COUNT(*)
    INTO weekly_total, weekly_days
    FROM user_daily_activity
    WHERE user_id = p_user_id 
      AND activity_date BETWEEN week_start AND week_end
      AND guild_id = p_guild_id;
    
    -- 주별 레코드 업서트
    INSERT INTO user_weekly_activity (
        user_id, week_start_date, week_end_date, total_time_ms, 
        active_days, session_count, guild_id
    ) VALUES (
        p_user_id, week_start, week_end, weekly_total, 
        weekly_days, 
        (SELECT COALESCE(SUM(session_count), 0) FROM user_daily_activity 
         WHERE user_id = p_user_id AND activity_date BETWEEN week_start AND week_end AND guild_id = p_guild_id),
        p_guild_id
    )
    ON CONFLICT (user_id, week_start_date, guild_id)
    DO UPDATE SET
        total_time_ms = EXCLUDED.total_time_ms,
        active_days = EXCLUDED.active_days,
        session_count = EXCLUDED.session_count,
        updated_at = NOW();
    
    -- 월별 집계 계산
    month_start := DATE_TRUNC('month', p_date)::DATE;
    
    SELECT 
        COALESCE(SUM(total_time_ms), 0),
        COUNT(*)
    INTO monthly_total, monthly_days
    FROM user_daily_activity
    WHERE user_id = p_user_id 
      AND activity_date >= month_start
      AND activity_date < (month_start + INTERVAL '1 month')::DATE
      AND guild_id = p_guild_id;
    
    -- 월별 레코드 업서트
    INSERT INTO user_monthly_activity (
        user_id, activity_month, total_time_ms, active_days, session_count, guild_id
    ) VALUES (
        p_user_id, month_start, monthly_total, monthly_days,
        (SELECT COALESCE(SUM(session_count), 0) FROM user_daily_activity 
         WHERE user_id = p_user_id 
           AND activity_date >= month_start 
           AND activity_date < (month_start + INTERVAL '1 month')::DATE 
           AND guild_id = p_guild_id),
        p_guild_id
    )
    ON CONFLICT (user_id, activity_month, guild_id)
    DO UPDATE SET
        total_time_ms = EXCLUDED.total_time_ms,
        active_days = EXCLUDED.active_days,
        session_count = EXCLUDED.session_count,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 8. 트리거 생성
-- =====================================================

-- 세션 종료시 일일 집계 업데이트 트리거
DROP TRIGGER IF EXISTS trigger_update_daily_aggregation ON activity_sessions;
CREATE TRIGGER trigger_update_daily_aggregation
    AFTER INSERT OR UPDATE ON activity_sessions
    FOR EACH ROW EXECUTE FUNCTION update_daily_activity_aggregation();

-- updated_at 자동 업데이트 트리거들
DROP TRIGGER IF EXISTS update_user_daily_activity_updated_at ON user_daily_activity;
CREATE TRIGGER update_user_daily_activity_updated_at
    BEFORE UPDATE ON user_daily_activity
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_weekly_activity_updated_at ON user_weekly_activity;
CREATE TRIGGER update_user_weekly_activity_updated_at
    BEFORE UPDATE ON user_weekly_activity
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_monthly_activity_updated_at ON user_monthly_activity;
CREATE TRIGGER update_user_monthly_activity_updated_at
    BEFORE UPDATE ON user_monthly_activity
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_activity_sessions_updated_at ON activity_sessions;
CREATE TRIGGER update_activity_sessions_updated_at
    BEFORE UPDATE ON activity_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 9. 고성능 조회 뷰 생성
-- =====================================================

-- 기간별 사용자 활동 조회 뷰 (가장 중요!)
CREATE OR REPLACE VIEW v_user_activity_by_date_range AS
SELECT 
    uda.user_id,
    uda.guild_id,
    uda.activity_date,
    uda.total_time_ms,
    uda.session_count,
    uda.channels_visited,
    uda.first_activity_time,
    uda.last_activity_time,
    ua.display_name,
    CASE 
        WHEN uda.total_time_ms >= 3600000 THEN 'high_active'    -- 1시간 이상
        WHEN uda.total_time_ms >= 1800000 THEN 'active'        -- 30분 이상
        WHEN uda.total_time_ms > 0 THEN 'low_active'           -- 활동 있음
        ELSE 'inactive'
    END as activity_level
FROM user_daily_activity uda
LEFT JOIN user_activity ua ON uda.user_id = ua.user_id
ORDER BY uda.activity_date DESC, uda.total_time_ms DESC;

-- 보고서 생성용 집계 뷰
CREATE OR REPLACE VIEW v_user_period_summary AS
WITH date_range AS (
    SELECT 
        user_id,
        guild_id,
        MIN(activity_date) as first_active_date,
        MAX(activity_date) as last_active_date,
        COUNT(DISTINCT activity_date) as active_days,
        SUM(total_time_ms) as total_time_ms,
        SUM(session_count) as total_sessions,
        AVG(total_time_ms) as avg_daily_time_ms
    FROM user_daily_activity
    GROUP BY user_id, guild_id
)
SELECT 
    dr.*,
    ua.display_name,
    ROUND(dr.total_time_ms / 1000.0 / 3600.0, 2) as total_hours,
    ROUND(dr.avg_daily_time_ms / 1000.0 / 3600.0, 2) as avg_daily_hours
FROM date_range dr
LEFT JOIN user_activity ua ON dr.user_id = ua.user_id;

-- =====================================================
-- 10. 데이터 정리 함수
-- =====================================================

-- 오래된 캐시 정리 함수
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM report_cache WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    IF deleted_count > 0 THEN
        RAISE NOTICE '만료된 캐시 % 개 삭제됨', deleted_count;
    END IF;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 오래된 집계 데이터 아카이브 함수 (90일 이전 데이터)
CREATE OR REPLACE FUNCTION archive_old_daily_activity(days_to_keep INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    cutoff_date DATE;
    archived_count INTEGER;
BEGIN
    cutoff_date := CURRENT_DATE - INTERVAL '1 day' * days_to_keep;
    
    -- 아카이브 테이블로 이동 (필요시 생성)
    CREATE TABLE IF NOT EXISTS user_daily_activity_archive (LIKE user_daily_activity INCLUDING ALL);
    
    WITH moved_data AS (
        DELETE FROM user_daily_activity 
        WHERE activity_date < cutoff_date
        RETURNING *
    )
    INSERT INTO user_daily_activity_archive SELECT * FROM moved_data;
    
    GET DIAGNOSTICS archived_count = ROW_COUNT;
    
    RAISE NOTICE '% 건의 오래된 일일 활동 데이터가 아카이브됨 (기준일: %)', archived_count, cutoff_date;
    
    RETURN archived_count;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 완료 알림
-- =====================================================
DO $$
BEGIN
    RAISE NOTICE '=== 개선된 Discord Activity Bot 스키마 생성 완료 ===';
    RAISE NOTICE '새로운 테이블: user_daily_activity, user_weekly_activity, user_monthly_activity, activity_sessions, report_cache';
    RAISE NOTICE '고성능 뷰: v_user_activity_by_date_range, v_user_period_summary';
    RAISE NOTICE '자동 집계: 실시간 트리거로 일일/주별/월별 데이터 자동 업데이트';
    RAISE NOTICE '캐싱 시스템: 보고서 결과 캐싱으로 반복 요청 최적화';
    RAISE NOTICE '예상 성능 개선: 30초 → 3초 이내 (10배 향상)';
END $$;