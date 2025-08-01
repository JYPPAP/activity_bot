-- =====================================================
-- Migration: Add activity_threshold support
-- Date: 2025-08-01
-- Description: Add activity_threshold as a valid setting_type 
--              in guild_settings table for guild-wide activity 
--              threshold management
-- =====================================================

-- Add activity_threshold to the allowed setting_type values
ALTER TABLE guild_settings 
DROP CONSTRAINT guild_settings_setting_type_check;

ALTER TABLE guild_settings 
ADD CONSTRAINT guild_settings_setting_type_check 
CHECK (setting_type IN ('role_activity', 'game_list', 'exclude_channels', 'channel_management', 'activity_threshold'));

-- Optional: Add comment for documentation
COMMENT ON COLUMN guild_settings.setting_type IS 'Type of setting: role_activity (deprecated), game_list, exclude_channels, channel_management, activity_threshold';