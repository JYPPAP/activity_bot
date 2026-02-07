-- Up Migration

CREATE TABLE IF NOT EXISTS forum_participants (
  id SERIAL PRIMARY KEY,
  forum_post_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  nickname VARCHAR(255) NOT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(forum_post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_forum_participants_post_id ON forum_participants(forum_post_id);
CREATE INDEX IF NOT EXISTS idx_forum_participants_user_id ON forum_participants(user_id);

COMMENT ON TABLE forum_participants IS '포럼 포스트 참가자 정보 - 버튼 클릭 및 이모지 반응으로 참가한 사용자 추적';
COMMENT ON COLUMN forum_participants.forum_post_id IS '포럼 포스트(스레드) ID';
COMMENT ON COLUMN forum_participants.user_id IS 'Discord 사용자 ID';
COMMENT ON COLUMN forum_participants.nickname IS '참가 당시 사용자 닉네임 (정리된 형태)';
COMMENT ON COLUMN forum_participants.joined_at IS '참가 시각';

-- Down Migration

DROP TABLE IF EXISTS forum_participants CASCADE;
