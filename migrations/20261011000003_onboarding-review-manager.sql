-- Up Migration

ALTER TABLE onboarding_configs ADD COLUMN review_manager_user_id VARCHAR(50);

-- Down Migration

ALTER TABLE onboarding_configs DROP COLUMN review_manager_user_id;
