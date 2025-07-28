-- =====================================================
-- SQLite에서 PostgreSQL로 데이터 마이그레이션 스크립트
-- =====================================================
-- 이 스크립트는 SQLite의 데이터를 PostgreSQL로 이전하는 SQL 명령어들을 포함합니다.
-- 실제 실행은 별도의 마이그레이션 도구를 통해 수행됩니다.

-- =====================================================
-- 1. 데이터 내보내기 (SQLite에서 실행)
-- =====================================================

-- 사용자 활동 데이터 내보내기
.mode csv
.output user_activity.csv
SELECT 
    userId as user_id,
    totalTime as total_time,
    startTime as start_time,
    lastUpdate as last_update,
    lastActivity as last_activity,
    displayName as display_name,
    currentChannelId as current_channel_id,
    sessionStartTime as session_start_time,
    0 as daily_time,
    0 as weekly_time,
    0 as monthly_time,
    datetime(lastUpdate/1000, 'unixepoch') as created_at,
    datetime(lastUpdate/1000, 'unixepoch') as updated_at
FROM user_activity;

-- 역할 설정 데이터 내보내기
.output role_config.csv
SELECT 
    roleName as role_name,
    minHours as min_hours,
    COALESCE(warningThreshold, 0) as warning_threshold,
    COALESCE(allowedAfkDuration, 0) as allowed_afk_duration,
    COALESCE(resetTime, 1) as reset_time,
    'weekly' as report_cycle,
    datetime(createdAt/1000, 'unixepoch') as created_at,
    datetime(updatedAt/1000, 'unixepoch') as updated_at
FROM role_config;

-- 활동 로그 데이터 내보내기 (테이블이 존재하는 경우)
.output activity_log.csv
SELECT 
    rowid as id,
    userId as user_id,
    userName as user_name,
    channelId as channel_id,
    channelName as channel_name,
    action,
    timestamp,
    COALESCE(duration, 0) as duration,
    '{}' as additional_data,
    '' as guild_id,
    datetime(timestamp/1000, 'unixepoch') as created_at
FROM activity_log
WHERE EXISTS (SELECT name FROM sqlite_master WHERE type='table' AND name='activity_log');

-- AFK 상태 데이터 내보내기 (테이블이 존재하는 경우)
.output afk_status.csv
SELECT 
    userId as user_id,
    CASE WHEN afkUntil > (strftime('%s', 'now') * 1000) THEN 1 ELSE 0 END as is_afk,
    COALESCE(afkStartTime, 0) as afk_start_time,
    COALESCE(afkUntil, 0) as afk_until,
    COALESCE(afkReason, '') as afk_reason,
    COALESCE(totalAfkTime, 0) as total_afk_time,
    lastUpdate as last_update,
    datetime(lastUpdate/1000, 'unixepoch') as created_at,
    datetime(lastUpdate/1000, 'unixepoch') as updated_at
FROM afk_status
WHERE EXISTS (SELECT name FROM sqlite_master WHERE type='table' AND name='afk_status');

-- 음성 채널 매핑 데이터 내보내기 (테이블이 존재하는 경우)
.output voice_channel_mapping.csv
SELECT 
    channelId as channel_id,
    COALESCE(forumPostId, '') as forum_post_id,
    COALESCE(threadId, '') as thread_id,
    COALESCE(isActive, 1) as is_active,
    datetime('now') as created_at,
    datetime('now') as updated_at
FROM voice_channel_mapping
WHERE EXISTS (SELECT name FROM sqlite_master WHERE type='table' AND name='voice_channel_mapping');

-- 길드 설정 데이터 내보내기 (테이블이 존재하는 경우)
.output guild_settings.csv
SELECT 
    rowid as id,
    guildId as guild_id,
    settingType as setting_type,
    settingKey as setting_key,
    settingValue as setting_value,
    datetime(createdAt/1000, 'unixepoch') as created_at,
    datetime(updatedAt/1000, 'unixepoch') as updated_at
FROM guild_settings
WHERE EXISTS (SELECT name FROM sqlite_master WHERE type='table' AND name='guild_settings');

.output

-- =====================================================
-- 2. 데이터 가져오기 (PostgreSQL에서 실행)
-- =====================================================

-- 임시로 제약조건 비활성화 (필요시)
-- ALTER TABLE user_activity DISABLE TRIGGER ALL;
-- ALTER TABLE role_config DISABLE TRIGGER ALL;

-- 사용자 활동 데이터 가져오기
\COPY user_activity(user_id, total_time, start_time, last_update, last_activity, display_name, current_channel_id, session_start_time, daily_time, weekly_time, monthly_time, created_at, updated_at) FROM 'user_activity.csv' WITH (FORMAT CSV, HEADER false);

-- 역할 설정 데이터 가져오기
\COPY role_config(role_name, min_hours, warning_threshold, allowed_afk_duration, reset_time, report_cycle, created_at, updated_at) FROM 'role_config.csv' WITH (FORMAT CSV, HEADER false);

-- 활동 로그 데이터 가져오기 (파일이 존재하는 경우)
\COPY activity_log(user_id, user_name, channel_id, channel_name, action, timestamp, duration, additional_data, guild_id, created_at) FROM 'activity_log.csv' WITH (FORMAT CSV, HEADER false);

-- AFK 상태 데이터 가져오기 (파일이 존재하는 경우)
\COPY afk_status(user_id, is_afk, afk_start_time, afk_until, afk_reason, total_afk_time, last_update, created_at, updated_at) FROM 'afk_status.csv' WITH (FORMAT CSV, HEADER false);

-- 음성 채널 매핑 데이터 가져오기 (파일이 존재하는 경우)
\COPY voice_channel_mapping(channel_id, forum_post_id, thread_id, is_active, created_at, updated_at) FROM 'voice_channel_mapping.csv' WITH (FORMAT CSV, HEADER false);

-- 길드 설정 데이터 가져오기 (파일이 존재하는 경우)
\COPY guild_settings(guild_id, setting_type, setting_key, setting_value, created_at, updated_at) FROM 'guild_settings.csv' WITH (FORMAT CSV, HEADER false);

-- 시퀀스 값 재설정
SELECT setval('activity_log_id_seq', COALESCE((SELECT MAX(id) FROM activity_log), 1));
SELECT setval('guild_settings_id_seq', COALESCE((SELECT MAX(id) FROM guild_settings), 1));
SELECT setval('settings_audit_log_id_seq', COALESCE((SELECT MAX(id) FROM settings_audit_log), 1));
SELECT setval('daily_activity_stats_id_seq', COALESCE((SELECT MAX(id) FROM daily_activity_stats), 1));

-- 트리거 재활성화 (필요시)
-- ALTER TABLE user_activity ENABLE TRIGGER ALL;
-- ALTER TABLE role_config ENABLE TRIGGER ALL;

-- =====================================================
-- 3. 데이터 검증 쿼리
-- =====================================================

-- 테이블별 레코드 수 확인
SELECT 'user_activity' as table_name, COUNT(*) as record_count FROM user_activity
UNION ALL
SELECT 'role_config' as table_name, COUNT(*) as record_count FROM role_config
UNION ALL
SELECT 'activity_log' as table_name, COUNT(*) as record_count FROM activity_log
UNION ALL
SELECT 'afk_status' as table_name, COUNT(*) as record_count FROM afk_status
UNION ALL
SELECT 'voice_channel_mapping' as table_name, COUNT(*) as record_count FROM voice_channel_mapping
UNION ALL
SELECT 'guild_settings' as table_name, COUNT(*) as record_count FROM guild_settings
UNION ALL
SELECT 'settings_audit_log' as table_name, COUNT(*) as record_count FROM settings_audit_log
UNION ALL
SELECT 'daily_activity_stats' as table_name, COUNT(*) as record_count FROM daily_activity_stats;

-- 데이터 유효성 검사
SELECT 
    'user_activity_validation' as check_name,
    COUNT(*) as total_users,
    COUNT(*) FILTER (WHERE total_time > 0) as active_users,
    AVG(total_time) as avg_total_time,
    MAX(last_update) as latest_update
FROM user_activity;

SELECT 
    'role_config_validation' as check_name,
    COUNT(*) as total_roles,
    AVG(min_hours) as avg_min_hours,
    MIN(min_hours) as min_hours,
    MAX(min_hours) as max_hours
FROM role_config;

-- 날짜 범위 확인
SELECT 
    'date_range_check' as check_name,
    MIN(TO_TIMESTAMP(last_update / 1000)) as earliest_date,
    MAX(TO_TIMESTAMP(last_update / 1000)) as latest_date
FROM user_activity
WHERE last_update > 0;

-- =====================================================
-- 4. 데이터 정리 (선택사항)
-- =====================================================

-- 중복 데이터 제거 (필요시)
-- DELETE FROM user_activity a USING user_activity b 
-- WHERE a.ctid < b.ctid AND a.user_id = b.user_id;

-- 유효하지 않은 데이터 제거 (필요시)
-- DELETE FROM user_activity WHERE user_id IS NULL OR user_id = '';
-- DELETE FROM role_config WHERE role_name IS NULL OR role_name = '';

-- 통계 업데이트
ANALYZE user_activity;
ANALYZE role_config;
ANALYZE activity_log;
ANALYZE afk_status;
ANALYZE voice_channel_mapping;
ANALYZE guild_settings;

-- =====================================================
-- 5. 마이그레이션 완료 확인
-- =====================================================

-- 마이그레이션 상태 확인
DO $$
DECLARE
    user_count INTEGER;
    role_count INTEGER;
    log_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO user_count FROM user_activity;
    SELECT COUNT(*) INTO role_count FROM role_config;
    SELECT COUNT(*) INTO log_count FROM activity_log;
    
    RAISE NOTICE '=== 마이그레이션 완료 ===';
    RAISE NOTICE '사용자 활동: % 개', user_count;
    RAISE NOTICE '역할 설정: % 개', role_count;
    RAISE NOTICE '활동 로그: % 개', log_count;
    
    IF user_count > 0 OR role_count > 0 THEN
        RAISE NOTICE '✅ 마이그레이션이 성공적으로 완료되었습니다.';
    ELSE
        RAISE NOTICE '⚠️  데이터가 마이그레이션되지 않았습니다. 파일을 확인하세요.';
    END IF;
END $$;