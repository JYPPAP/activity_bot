-- Up Migration

-- post_integrations 테이블에 participants 컬럼 추가
ALTER TABLE post_integrations
ADD COLUMN IF NOT EXISTS participants JSONB DEFAULT '[]'::jsonb;

-- 인덱스 추가 (참가자 조회 최적화)
CREATE INDEX IF NOT EXISTS idx_post_integrations_participants
ON post_integrations USING GIN (participants);

-- Down Migration

DROP INDEX IF EXISTS idx_post_integrations_participants;
ALTER TABLE post_integrations DROP COLUMN IF EXISTS participants;
