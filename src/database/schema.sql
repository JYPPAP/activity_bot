-- SQLite Database Schema for Activity Bot
-- 기존 JSON 구조를 최적화된 관계형 데이터베이스로 변환

-- 메타데이터 테이블 (시스템 정보)
CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- 사용자 활동 테이블 (핫 데이터 - 자주 읽기/쓰기)
CREATE TABLE IF NOT EXISTS user_activities (
    user_id TEXT PRIMARY KEY,
    total_time INTEGER NOT NULL DEFAULT 0,
    start_time INTEGER,  -- 현재 세션 시작 시간 (null이면 비활성)
    display_name TEXT,
    last_updated INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- 활동 로그 테이블 (콜드 데이터 - 주로 읽기, 분석용)
CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL, -- 'join', 'leave', 'move' 등
    timestamp INTEGER NOT NULL,
    channel_id TEXT,
    channel_name TEXT,
    guild_id TEXT,
    session_duration INTEGER, -- leave 이벤트인 경우 세션 시간
    additional_data TEXT, -- JSON 형태로 추가 데이터 저장
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- 역할 설정 테이블
CREATE TABLE IF NOT EXISTS role_configs (
    role_id TEXT PRIMARY KEY,
    role_name TEXT,
    config_data TEXT NOT NULL, -- JSON 형태로 설정 저장
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- AFK 상태 테이블
CREATE TABLE IF NOT EXISTS afk_status (
    user_id TEXT PRIMARY KEY,
    is_afk BOOLEAN NOT NULL DEFAULT FALSE,
    afk_since INTEGER,
    reason TEXT,
    auto_afk BOOLEAN NOT NULL DEFAULT FALSE,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- 포럼 메시지 테이블
CREATE TABLE IF NOT EXISTS forum_messages (
    message_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT,
    message_data TEXT, -- JSON 형태로 메시지 데이터 저장
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- 음성 채널 매핑 테이블
CREATE TABLE IF NOT EXISTS voice_channel_mappings (
    voice_channel_id TEXT PRIMARY KEY,
    forum_channel_id TEXT NOT NULL,
    mapping_data TEXT, -- JSON 형태로 매핑 데이터 저장
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- 리셋 히스토리 테이블
CREATE TABLE IF NOT EXISTS reset_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reset_type TEXT NOT NULL, -- 'manual', 'scheduled', 'admin' 등
    reset_timestamp INTEGER NOT NULL,
    admin_user_id TEXT,
    affected_users_count INTEGER,
    backup_data TEXT, -- JSON 형태로 리셋 전 데이터 백업
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- 로그 멤버 테이블 (캘린더 로그용)
CREATE TABLE IF NOT EXISTS log_members (
    user_id TEXT PRIMARY KEY,
    log_data TEXT NOT NULL, -- JSON 형태로 로그 데이터 저장
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- ===============================
-- 인덱스 생성 (성능 최적화)
-- ===============================

-- 사용자 활동 인덱스
CREATE INDEX IF NOT EXISTS idx_user_activities_last_updated ON user_activities(last_updated);
CREATE INDEX IF NOT EXISTS idx_user_activities_start_time ON user_activities(start_time) WHERE start_time IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_activities_total_time ON user_activities(total_time DESC);

-- 활동 로그 인덱스 (시간 기반 쿼리 최적화)
CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON activity_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_event_type ON activity_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_timestamp ON activity_logs(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_channel_id ON activity_logs(channel_id);

-- AFK 상태 인덱스
CREATE INDEX IF NOT EXISTS idx_afk_status_is_afk ON afk_status(is_afk) WHERE is_afk = TRUE;
CREATE INDEX IF NOT EXISTS idx_afk_status_afk_since ON afk_status(afk_since) WHERE afk_since IS NOT NULL;

-- 포럼 메시지 인덱스
CREATE INDEX IF NOT EXISTS idx_forum_messages_channel_id ON forum_messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_forum_messages_user_id ON forum_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_forum_messages_created_at ON forum_messages(created_at DESC);

-- 리셋 히스토리 인덱스
CREATE INDEX IF NOT EXISTS idx_reset_history_timestamp ON reset_history(reset_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_reset_history_type ON reset_history(reset_type);

-- ===============================
-- 초기 메타데이터 삽입
-- ===============================

INSERT OR REPLACE INTO metadata (key, value) VALUES 
    ('version', '2.0.0'),
    ('migration_date', strftime('%s', 'now') * 1000),
    ('database_type', 'sqlite'),
    ('schema_version', '1');

-- ===============================
-- 뷰 생성 (자주 사용되는 쿼리 최적화)
-- ===============================

-- 활성 사용자 뷰 (현재 접속 중인 사용자)
CREATE VIEW IF NOT EXISTS active_users AS
SELECT 
    user_id,
    display_name,
    start_time,
    total_time,
    (strftime('%s', 'now') * 1000 - start_time) as current_session_time
FROM user_activities 
WHERE start_time IS NOT NULL;

-- 사용자 통계 뷰 (총 활동 시간 기준 정렬)
CREATE VIEW IF NOT EXISTS user_statistics AS
SELECT 
    user_id,
    display_name,
    total_time,
    CASE 
        WHEN start_time IS NOT NULL THEN 'active'
        ELSE 'inactive'
    END as status,
    last_updated
FROM user_activities 
ORDER BY total_time DESC;

-- 일일 활동 통계 뷰
CREATE VIEW IF NOT EXISTS daily_activity_stats AS
SELECT 
    date(timestamp / 1000, 'unixepoch') as activity_date,
    COUNT(*) as total_events,
    COUNT(CASE WHEN event_type = 'join' THEN 1 END) as joins,
    COUNT(CASE WHEN event_type = 'leave' THEN 1 END) as leaves,
    COUNT(DISTINCT user_id) as unique_users,
    AVG(CASE WHEN session_duration IS NOT NULL THEN session_duration END) as avg_session_duration
FROM activity_logs 
GROUP BY date(timestamp / 1000, 'unixepoch')
ORDER BY activity_date DESC;