-- =============================================================================
-- Discord Activity Bot - PostgreSQL Schema Design
-- Migration from LowDB JSON structure to normalized relational database
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- =============================================================================
-- CORE ENTITIES
-- =============================================================================

-- Discord Users table - Central user registry
CREATE TABLE users (
    -- Primary identifier (Discord snowflake)
    id VARCHAR(20) PRIMARY KEY CHECK (id ~ '^[0-9]{17,20}$'),
    
    -- User display information
    display_name VARCHAR(255),
    original_username VARCHAR(100), -- Discord username for reference
    discriminator VARCHAR(4),       -- Discord discriminator (deprecated but useful)
    
    -- User metadata
    first_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Discord Roles table - Role configuration and requirements
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    
    -- Role identification
    name VARCHAR(255) UNIQUE NOT NULL,
    discord_role_id VARCHAR(20), -- Discord role snowflake (optional)
    
    -- Activity requirements
    min_hours DECIMAL(5,2) NOT NULL DEFAULT 0.00 CHECK (min_hours >= 0),
    report_cycle_weeks INTEGER DEFAULT 1 CHECK (report_cycle_weeks > 0),
    
    -- Role metadata
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0, -- For role hierarchy
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- ACTIVITY TRACKING
-- =============================================================================

-- User Activities table - Current activity state per user
CREATE TABLE user_activities (
    -- Composite primary key for user activity tracking
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Activity metrics (milliseconds for precision)
    total_time_ms BIGINT DEFAULT 0 CHECK (total_time_ms >= 0),
    current_session_start TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE,
    
    -- Activity statistics
    session_count INTEGER DEFAULT 0 CHECK (session_count >= 0),
    longest_session_ms BIGINT DEFAULT 0 CHECK (longest_session_ms >= 0),
    average_session_ms BIGINT DEFAULT 0 CHECK (average_session_ms >= 0),
    
    -- Current state tracking
    is_currently_active BOOLEAN DEFAULT false,
    current_channel_id VARCHAR(20),
    current_channel_name VARCHAR(255),
    
    -- Computed fields (updated via triggers)
    total_hours DECIMAL(10,2) GENERATED ALWAYS AS (total_time_ms / 3600000.0) STORED,
    total_days DECIMAL(8,2) GENERATED ALWAYS AS (total_time_ms / 86400000.0) STORED,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(user_id), -- One activity record per user
    CHECK (current_session_start IS NULL OR is_currently_active = true),
    CHECK (longest_session_ms <= total_time_ms)
);

-- Activity Events table - Detailed event logging
CREATE TABLE activity_events (
    -- Event identification
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Event details
    event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('JOIN', 'LEAVE', 'MOVE', 'DISCONNECT', 'TIMEOUT')),
    event_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Channel information
    channel_id VARCHAR(20) NOT NULL,
    channel_name VARCHAR(255) NOT NULL,
    channel_type VARCHAR(20) DEFAULT 'VOICE', -- VOICE, TEXT, FORUM
    
    -- Session tracking
    session_id UUID, -- Groups related JOIN/LEAVE events
    session_duration_ms BIGINT, -- Calculated for LEAVE events
    
    -- Context information
    member_count INTEGER DEFAULT 0 CHECK (member_count >= 0),
    server_region VARCHAR(50),
    connection_quality VARCHAR(20), -- EXCELLENT, GOOD, FAIR, POOR
    
    -- Event metadata
    bot_version VARCHAR(20),
    event_source VARCHAR(50) DEFAULT 'discord_bot',
    
    -- Indexes for performance
    INDEX idx_activity_events_user_timestamp (user_id, event_timestamp DESC),
    INDEX idx_activity_events_timestamp (event_timestamp DESC),
    INDEX idx_activity_events_channel (channel_id),
    INDEX idx_activity_events_session (session_id),
    INDEX idx_activity_events_type_timestamp (event_type, event_timestamp DESC)
);

-- Activity Event Participants table - Who was present during events
CREATE TABLE activity_event_participants (
    id SERIAL PRIMARY KEY,
    event_id UUID NOT NULL REFERENCES activity_events(id) ON DELETE CASCADE,
    participant_user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Participant state
    is_speaking BOOLEAN DEFAULT false,
    is_muted BOOLEAN DEFAULT false,
    is_deafened BOOLEAN DEFAULT false,
    connection_time_ms BIGINT, -- How long they've been connected
    
    -- Constraints
    UNIQUE(event_id, participant_user_id)
);

-- =============================================================================
-- ROLE MANAGEMENT
-- =============================================================================

-- User Role Assignments table - Many-to-many relationship
CREATE TABLE user_role_assignments (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    
    -- Assignment tracking
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    assigned_by VARCHAR(20) REFERENCES users(id), -- Who assigned the role
    expires_at TIMESTAMP WITH TIME ZONE, -- Optional expiration
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    -- Constraints
    UNIQUE(user_id, role_id)
);

-- Role Reset History table - Administrative actions tracking
CREATE TABLE role_reset_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Reset details
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    reset_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    reset_reason TEXT NOT NULL DEFAULT 'Administrative reset',
    
    -- Who performed the reset
    admin_user_id VARCHAR(20) REFERENCES users(id),
    admin_username VARCHAR(255),
    
    -- What was reset
    affected_user_count INTEGER DEFAULT 0,
    total_time_cleared_ms BIGINT DEFAULT 0,
    
    -- Reset scope
    reset_scope VARCHAR(20) DEFAULT 'ROLE' CHECK (reset_scope IN ('ROLE', 'USER', 'GLOBAL')),
    
    -- Backup reference
    backup_file_path VARCHAR(500),
    
    -- Indexes
    INDEX idx_role_reset_history_role (role_id),
    INDEX idx_role_reset_history_timestamp (reset_timestamp DESC)
);

-- =============================================================================
-- AFK MANAGEMENT
-- =============================================================================

-- AFK Status table - Away From Keyboard tracking
CREATE TABLE afk_status (
    user_id VARCHAR(20) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    
    -- AFK period
    afk_start TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    afk_until TIMESTAMP WITH TIME ZONE NOT NULL,
    afk_reason VARCHAR(500),
    
    -- AFK type classification
    afk_type VARCHAR(20) DEFAULT 'MANUAL' CHECK (afk_type IN ('MANUAL', 'AUTO', 'SCHEDULED', 'DISCIPLINARY')),
    
    -- Notification settings
    notify_on_mention BOOLEAN DEFAULT true,
    notify_on_dm BOOLEAN DEFAULT false,
    auto_response_message TEXT,
    
    -- Who set the AFK status
    set_by_user_id VARCHAR(20) REFERENCES users(id),
    set_by_admin BOOLEAN DEFAULT false,
    
    -- Status tracking
    is_active BOOLEAN DEFAULT true,
    times_extended INTEGER DEFAULT 0,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints and indexes
    CHECK (afk_until > afk_start),
    INDEX idx_afk_status_until (afk_until),
    INDEX idx_afk_status_active (is_active, afk_until) WHERE is_active = true
);

-- =============================================================================
-- DISCORD INTEGRATION
-- =============================================================================

-- Forum Messages table - Discord forum integration tracking
CREATE TABLE forum_messages (
    id SERIAL PRIMARY KEY,
    
    -- Discord identifiers
    thread_id VARCHAR(20) NOT NULL,
    message_id VARCHAR(20) NOT NULL,
    
    -- Message classification
    message_type VARCHAR(50) NOT NULL CHECK (message_type IN ('participant_count', 'emoji_reaction', 'status_update', 'announcement')),
    message_content TEXT,
    
    -- Message context
    posted_by_user_id VARCHAR(20) REFERENCES users(id),
    channel_context JSONB, -- Flexible storage for channel-specific data
    
    -- Tracking metadata
    is_active BOOLEAN DEFAULT true,
    interaction_count INTEGER DEFAULT 0,
    last_interaction_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints and indexes
    UNIQUE(thread_id, message_type, message_id),
    INDEX idx_forum_messages_thread (thread_id),
    INDEX idx_forum_messages_type (message_type),
    INDEX idx_forum_messages_user (posted_by_user_id)
);

-- Voice Channel Mappings table - Voice channel to forum post relationships
CREATE TABLE voice_channel_mappings (
    -- Primary mapping
    voice_channel_id VARCHAR(20) PRIMARY KEY,
    forum_post_id VARCHAR(20) NOT NULL,
    
    -- Channel information
    voice_channel_name VARCHAR(255),
    forum_thread_title VARCHAR(500),
    
    -- Activity tracking
    last_participant_count INTEGER DEFAULT 0 CHECK (last_participant_count >= 0),
    peak_participant_count INTEGER DEFAULT 0 CHECK (peak_participant_count >= 0),
    total_sessions INTEGER DEFAULT 0 CHECK (total_sessions >= 0),
    
    -- Channel state
    is_active BOOLEAN DEFAULT true,
    auto_archive BOOLEAN DEFAULT true,
    archive_after_hours INTEGER DEFAULT 24,
    
    -- Mapping metadata
    created_by_user_id VARCHAR(20) REFERENCES users(id),
    mapping_type VARCHAR(20) DEFAULT 'MANUAL' CHECK (mapping_type IN ('MANUAL', 'AUTO', 'SYSTEM')),
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_voice_mappings_forum (forum_post_id),
    INDEX idx_voice_mappings_active (is_active) WHERE is_active = true
);

-- =============================================================================
-- SYSTEM METADATA
-- =============================================================================

-- Schema Migrations table - Version control for database changes
CREATE TABLE schema_migrations (
    version VARCHAR(20) PRIMARY KEY,
    description TEXT NOT NULL,
    migration_type VARCHAR(20) DEFAULT 'SCHEMA' CHECK (migration_type IN ('SCHEMA', 'DATA', 'INDEX', 'FUNCTION')),
    
    -- Migration execution
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    applied_by VARCHAR(100) DEFAULT current_user,
    execution_time_ms INTEGER,
    
    -- Migration details
    migration_file VARCHAR(255),
    rollback_file VARCHAR(255),
    is_rollback BOOLEAN DEFAULT false,
    
    -- Status
    status VARCHAR(20) DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS', 'FAILED', 'PARTIAL', 'ROLLED_BACK'))
);

-- System Configuration table - Bot configuration and settings
CREATE TABLE system_configuration (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    value_type VARCHAR(20) DEFAULT 'STRING' CHECK (value_type IN ('STRING', 'INTEGER', 'BOOLEAN', 'JSON', 'TIMESTAMP')),
    
    -- Configuration metadata
    description TEXT,
    category VARCHAR(50) DEFAULT 'GENERAL',
    is_sensitive BOOLEAN DEFAULT false,
    
    -- Change tracking
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(100) DEFAULT current_user,
    
    -- Validation
    validation_regex VARCHAR(255),
    min_value NUMERIC,
    max_value NUMERIC
);

-- =============================================================================
-- PERFORMANCE INDEXES
-- =============================================================================

-- User-centric indexes
CREATE INDEX idx_users_display_name ON users(display_name) WHERE display_name IS NOT NULL;
CREATE INDEX idx_users_active ON users(is_active, last_seen DESC) WHERE is_active = true;
CREATE INDEX idx_users_last_seen ON users(last_seen DESC);

-- Activity performance indexes
CREATE INDEX idx_user_activities_total_time ON user_activities(total_time_ms DESC);
CREATE INDEX idx_user_activities_active ON user_activities(is_currently_active) WHERE is_currently_active = true;
CREATE INDEX idx_user_activities_last_activity ON user_activities(last_activity_at DESC);
CREATE INDEX idx_user_activities_hours ON user_activities(total_hours DESC);

-- Role-based indexes
CREATE INDEX idx_roles_active ON roles(is_active, priority DESC) WHERE is_active = true;
CREATE INDEX idx_user_role_assignments_user ON user_role_assignments(user_id) WHERE is_active = true;
CREATE INDEX idx_user_role_assignments_role ON user_role_assignments(role_id) WHERE is_active = true;

-- Time-based query optimization
CREATE INDEX idx_activity_events_recent ON activity_events(event_timestamp DESC) WHERE event_timestamp > (CURRENT_TIMESTAMP - interval '30 days');
CREATE INDEX idx_activity_events_user_recent ON activity_events(user_id, event_timestamp DESC) WHERE event_timestamp > (CURRENT_TIMESTAMP - interval '7 days');

-- AFK status indexes
CREATE INDEX idx_afk_status_expiring ON afk_status(afk_until ASC) WHERE is_active = true AND afk_until < (CURRENT_TIMESTAMP + interval '1 day');

-- =============================================================================
-- CONSTRAINTS AND TRIGGERS
-- =============================================================================

-- Update timestamp trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update triggers to relevant tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_activities_updated_at BEFORE UPDATE ON user_activities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_afk_status_updated_at BEFORE UPDATE ON afk_status
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_forum_messages_updated_at BEFORE UPDATE ON forum_messages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_voice_channel_mappings_updated_at BEFORE UPDATE ON voice_channel_mappings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Activity statistics trigger function
CREATE OR REPLACE FUNCTION update_activity_statistics()
RETURNS TRIGGER AS $$
BEGIN
    -- Update session statistics when activity changes
    IF TG_OP = 'UPDATE' AND OLD.total_time_ms != NEW.total_time_ms THEN
        -- Update session count and averages
        NEW.session_count = COALESCE(NEW.session_count, 0) + 
            CASE WHEN NEW.current_session_start IS NULL AND OLD.current_session_start IS NOT NULL THEN 1 ELSE 0 END;
        
        -- Update average session time
        IF NEW.session_count > 0 THEN
            NEW.average_session_ms = NEW.total_time_ms / NEW.session_count;
        END IF;
        
        -- Update last activity timestamp
        NEW.last_activity_at = CURRENT_TIMESTAMP;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_activity_statistics BEFORE UPDATE ON user_activities
    FOR EACH ROW EXECUTE FUNCTION update_activity_statistics();

-- =============================================================================
-- VIEWS FOR COMMON QUERIES
-- =============================================================================

-- Active users with current activity status
CREATE VIEW v_active_users AS
SELECT 
    u.id,
    u.display_name,
    ua.total_time_ms,
    ua.total_hours,
    ua.total_days,
    ua.is_currently_active,
    ua.current_channel_name,
    ua.last_activity_at,
    ua.session_count,
    ua.average_session_ms / 1000.0 / 3600.0 AS average_session_hours
FROM users u
JOIN user_activities ua ON u.id = ua.user_id
WHERE u.is_active = true
ORDER BY ua.total_time_ms DESC;

-- Role compliance view
CREATE VIEW v_role_compliance AS
SELECT 
    r.name AS role_name,
    r.min_hours AS required_hours,
    u.id AS user_id,
    u.display_name,
    ua.total_hours AS actual_hours,
    ua.total_hours >= r.min_hours AS meets_requirement,
    (ua.total_hours - r.min_hours) AS hours_difference
FROM roles r
CROSS JOIN users u
LEFT JOIN user_activities ua ON u.id = ua.user_id
LEFT JOIN user_role_assignments ura ON u.id = ura.user_id AND r.id = ura.role_id
WHERE r.is_active = true 
  AND u.is_active = true
  AND (ura.is_active = true OR ura.id IS NULL)
ORDER BY r.name, ua.total_hours DESC;

-- Recent activity summary
CREATE VIEW v_recent_activity AS
SELECT 
    u.display_name,
    ae.event_type,
    ae.channel_name,
    ae.event_timestamp,
    ae.session_duration_ms / 1000.0 / 3600.0 AS session_hours,
    ae.member_count
FROM activity_events ae
JOIN users u ON ae.user_id = u.id
WHERE ae.event_timestamp > (CURRENT_TIMESTAMP - interval '24 hours')
ORDER BY ae.event_timestamp DESC;

-- AFK users view
CREATE VIEW v_afk_users AS
SELECT 
    u.id,
    u.display_name,
    afk.afk_start,
    afk.afk_until,
    afk.afk_reason,
    afk.afk_type,
    EXTRACT(EPOCH FROM (afk.afk_until - CURRENT_TIMESTAMP)) / 3600.0 AS hours_remaining,
    ua.total_hours
FROM afk_status afk
JOIN users u ON afk.user_id = u.id
LEFT JOIN user_activities ua ON u.id = ua.user_id
WHERE afk.is_active = true
  AND afk.afk_until > CURRENT_TIMESTAMP
ORDER BY afk.afk_until ASC;

-- =============================================================================
-- SAMPLE DATA INSERTION
-- =============================================================================

-- Insert initial migration record
INSERT INTO schema_migrations (version, description, migration_type)
VALUES ('1.0.0', 'Initial PostgreSQL schema creation from LowDB migration', 'SCHEMA');

-- Insert default system configuration
INSERT INTO system_configuration (key, value, value_type, description, category) VALUES
('bot_version', '2.0.0', 'STRING', 'Current bot version', 'SYSTEM'),
('max_afk_days', '30', 'INTEGER', 'Maximum AFK duration in days', 'AFK'),
('activity_timeout_minutes', '5', 'INTEGER', 'Minutes before considering user inactive', 'ACTIVITY'),
('backup_retention_days', '90', 'INTEGER', 'Days to retain database backups', 'BACKUP'),
('enable_performance_monitoring', 'true', 'BOOLEAN', 'Enable query performance tracking', 'MONITORING');

-- =============================================================================
-- COMMENTS FOR DOCUMENTATION
-- =============================================================================

COMMENT ON TABLE users IS 'Discord users with display names and metadata';
COMMENT ON TABLE roles IS 'Discord roles with activity requirements and configuration';
COMMENT ON TABLE user_activities IS 'Current activity state and statistics per user';
COMMENT ON TABLE activity_events IS 'Detailed activity event logging with session tracking';
COMMENT ON TABLE activity_event_participants IS 'Participants present during activity events';
COMMENT ON TABLE user_role_assignments IS 'Many-to-many relationship between users and roles';
COMMENT ON TABLE role_reset_history IS 'Administrative reset actions and audit trail';
COMMENT ON TABLE afk_status IS 'Away From Keyboard status tracking with notifications';
COMMENT ON TABLE forum_messages IS 'Discord forum integration message tracking';
COMMENT ON TABLE voice_channel_mappings IS 'Voice channel to forum post relationship mapping';
COMMENT ON TABLE schema_migrations IS 'Database version control and migration tracking';
COMMENT ON TABLE system_configuration IS 'Bot configuration and system settings';

-- Schema design complete
SELECT 'PostgreSQL schema design completed successfully' AS status;