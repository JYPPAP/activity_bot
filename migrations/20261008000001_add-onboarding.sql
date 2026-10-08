-- Up Migration

CREATE TABLE onboarding_configs (
    guild_id VARCHAR(50) PRIMARY KEY,
    welcome_channel_id VARCHAR(50) NOT NULL,
    game_channel_id VARCHAR(50) NOT NULL,
    rules_channel_id VARCHAR(50) NOT NULL,
    application_channel_id VARCHAR(50) NOT NULL,
    review_channel_id VARCHAR(50) NOT NULL,
    gender_male_role_id VARCHAR(50) NOT NULL,
    gender_female_role_id VARCHAR(50) NOT NULL,
    stage_role_ids JSONB NOT NULL CHECK (jsonb_typeof(stage_role_ids) = 'object'),
    pending_role_id VARCHAR(50) NOT NULL,
    member_role_id VARCHAR(50) NOT NULL,
    game_roles JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(game_roles) = 'array'),
    enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE onboarding_progress (
    guild_id VARCHAR(50) NOT NULL,
    user_id VARCHAR(50) NOT NULL,
    stage VARCHAR(20) NOT NULL DEFAULT 'gender'
        CHECK (stage IN ('gender', 'games', 'rules', 'application', 'pending', 'approved')),
    gender_role_id VARCHAR(50),
    game_role_ids JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(game_role_ids) = 'array'),
    rules_accepted_at TIMESTAMP,
    applied_at TIMESTAMP,
    reviewed_at TIMESTAMP,
    reviewed_by VARCHAR(50),
    rejection_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX idx_onboarding_progress_stage ON onboarding_progress(guild_id, stage);

-- Down Migration

DROP TABLE IF EXISTS onboarding_progress;
DROP TABLE IF EXISTS onboarding_configs;
