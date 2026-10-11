-- Up Migration

ALTER TABLE onboarding_progress
    ADD COLUMN rule_index INTEGER NOT NULL DEFAULT 0 CHECK (rule_index >= 0),
    ADD COLUMN rules_revision TEXT;

-- Down Migration

ALTER TABLE onboarding_progress
    DROP COLUMN rules_revision,
    DROP COLUMN rule_index;
