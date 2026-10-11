-- Up Migration

ALTER TABLE onboarding_configs
    ADD COLUMN category_id VARCHAR(50),
    ADD COLUMN rules_text TEXT NOT NULL DEFAULT '',
    ADD COLUMN welcome_message_id VARCHAR(50),
    ALTER COLUMN game_channel_id DROP NOT NULL,
    ALTER COLUMN rules_channel_id DROP NOT NULL,
    ALTER COLUMN application_channel_id DROP NOT NULL,
    ALTER COLUMN stage_role_ids DROP NOT NULL;

-- Existing shared-channel configurations need explicit setup before recovery can create private channels.
UPDATE onboarding_configs SET enabled=false WHERE category_id IS NULL;

ALTER TABLE onboarding_progress
    ADD COLUMN channel_id VARCHAR(50),
    ADD COLUMN message_id VARCHAR(50),
    ADD COLUMN review_message_id VARCHAR(50),
    ADD COLUMN cleanup_at TIMESTAMPTZ,
    ADD COLUMN departed_at TIMESTAMPTZ,
    ADD COLUMN review_action VARCHAR(10) CHECK (review_action IN ('approve', 'reject'));

CREATE INDEX idx_onboarding_progress_cleanup ON onboarding_progress(cleanup_at)
    WHERE stage='approved' AND channel_id IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS idx_onboarding_progress_cleanup;

ALTER TABLE onboarding_progress
    DROP COLUMN review_action,
    DROP COLUMN departed_at,
    DROP COLUMN cleanup_at,
    DROP COLUMN review_message_id,
    DROP COLUMN message_id,
    DROP COLUMN channel_id;

-- Keep configuration rows but require shared-channel setup again after rollback.
UPDATE onboarding_configs SET
    enabled=false,
    game_channel_id=COALESCE(game_channel_id, welcome_channel_id),
    rules_channel_id=COALESCE(rules_channel_id, welcome_channel_id),
    application_channel_id=COALESCE(application_channel_id, welcome_channel_id),
    stage_role_ids=COALESCE(stage_role_ids, '{}'::jsonb);

ALTER TABLE onboarding_configs
    DROP COLUMN welcome_message_id,
    DROP COLUMN rules_text,
    DROP COLUMN category_id,
    ALTER COLUMN game_channel_id SET NOT NULL,
    ALTER COLUMN rules_channel_id SET NOT NULL,
    ALTER COLUMN application_channel_id SET NOT NULL,
    ALTER COLUMN stage_role_ids SET NOT NULL;
