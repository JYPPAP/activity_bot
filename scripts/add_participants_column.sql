-- PostgreSQL 마이그레이션: 참가자 컬럼 추가
-- Activity Bot - 참가자 정보 영속화 지원

-- post_integrations 테이블에 participants 컬럼 추가
ALTER TABLE post_integrations
ADD COLUMN IF NOT EXISTS participants JSONB DEFAULT '[]'::jsonb;

-- 인덱스 추가 (참가자 조회 최적화)
CREATE INDEX IF NOT EXISTS idx_post_integrations_participants
ON post_integrations USING GIN (participants);

-- 마이그레이션 완료 로그
DO $$
BEGIN
    RAISE NOTICE '=== 참가자 컬럼 마이그레이션 완료 ===';
    RAISE NOTICE '추가된 컬럼: participants JSONB';
    RAISE NOTICE '추가된 인덱스: idx_post_integrations_participants (GIN)';
    RAISE NOTICE '==========================================';
END $$;
