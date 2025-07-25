-- Discord Activity Bot PostgreSQL Schema
-- Migration from LowDB JSON structure to normalized PostgreSQL

-- Enable UUID extension for primary keys
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table - Core user information
CREATE TABLE users (
    id VARCHAR(20) PRIMARY KEY,  -- Discord user ID (snowflake)
    display_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Roles table - Discord roles configuration
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    min_hours INTEGER NOT NULL DEFAULT 0,
    report_cycle INTEGER DEFAULT 1,  -- weeks
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- User activity tracking - Main activity data
CREATE TABLE user_activities (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_time_ms BIGINT DEFAULT 0,  -- Total activity time in milliseconds
    start_time TIMESTAMP WITH TIME ZONE,  -- Current session start (NULL if not active)
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id)  -- One record per user
);

-- Activity logs - Detailed event logging
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('JOIN', 'LEAVE', 'MOVE')),
    channel_id VARCHAR(20) NOT NULL,
    channel_name VARCHAR(255) NOT NULL,
    members_count INTEGER DEFAULT 0,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Index for performance
    INDEX idx_activity_logs_user_timestamp (user_id, timestamp),
    INDEX idx_activity_logs_timestamp (timestamp),
    INDEX idx_activity_logs_channel (channel_id)
);

-- Activity log members - Participants in each activity event
CREATE TABLE activity_log_members (
    id SERIAL PRIMARY KEY,
    log_id UUID NOT NULL REFERENCES activity_logs(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    UNIQUE(log_id, user_id)
);

-- Role reset history - Administrative reset tracking
CREATE TABLE role_resets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_name VARCHAR(255) NOT NULL,
    reset_time TIMESTAMP WITH TIME ZONE NOT NULL,
    reason TEXT DEFAULT 'Manual reset',
    admin_user_id VARCHAR(20),  -- Who performed the reset
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_role_resets_role_time (role_name, reset_time)
);

-- AFK status management - Separate table for AFK tracking
CREATE TABLE afk_status (
    user_id VARCHAR(20) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    afk_until TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_afk_status_until (afk_until)
);

-- Forum message tracking - Discord forum integration
CREATE TABLE forum_messages (
    id SERIAL PRIMARY KEY,
    thread_id VARCHAR(20) NOT NULL,
    message_type VARCHAR(50) NOT NULL CHECK (message_type IN ('participant_count', 'emoji_reaction')),
    message_id VARCHAR(20) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(thread_id, message_type, message_id),
    INDEX idx_forum_messages_thread (thread_id)
);

-- Voice channel mappings - Channel-forum integration
CREATE TABLE voice_channel_mappings (
    voice_channel_id VARCHAR(20) PRIMARY KEY,
    forum_post_id VARCHAR(20) NOT NULL,
    last_participant_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_voice_mappings_forum (forum_post_id)
);

-- Migration tracking - Version control for schema changes
CREATE TABLE schema_migrations (
    version VARCHAR(20) PRIMARY KEY,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    description TEXT
);

-- Insert initial migration record
INSERT INTO schema_migrations (version, description) 
VALUES ('1.0.0', 'Initial PostgreSQL schema from LowDB migration');

-- Update timestamp triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply update triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE
    ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_roles_updated_at BEFORE UPDATE
    ON roles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_afk_status_updated_at BEFORE UPDATE
    ON afk_status FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_voice_channel_mappings_updated_at BEFORE UPDATE
    ON voice_channel_mappings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Performance indexes
CREATE INDEX idx_user_activities_total_time ON user_activities(total_time_ms DESC);
CREATE INDEX idx_user_activities_start_time ON user_activities(start_time) WHERE start_time IS NOT NULL;

-- Comments for documentation
COMMENT ON TABLE users IS 'Discord users with display names';
COMMENT ON TABLE roles IS 'Discord roles with activity requirements';
COMMENT ON TABLE user_activities IS 'Main activity tracking per user';
COMMENT ON TABLE activity_logs IS 'Detailed activity event logging';
COMMENT ON TABLE role_resets IS 'Administrative reset history';
COMMENT ON TABLE afk_status IS 'AFK status tracking with expiration';
COMMENT ON TABLE forum_messages IS 'Discord forum message tracking';
COMMENT ON TABLE voice_channel_mappings IS 'Voice channel to forum post mappings';