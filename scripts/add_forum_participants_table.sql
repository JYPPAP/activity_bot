-- 포럼 참가자 정보 저장 테이블 추가
-- 봇 재시작 시에도 참가자 정보를 유지하기 위한 테이블

CREATE TABLE IF NOT EXISTS forum_participants (
  id SERIAL PRIMARY KEY,
  forum_post_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  nickname VARCHAR(255) NOT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(forum_post_id, user_id)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_forum_participants_post_id ON forum_participants(forum_post_id);
CREATE INDEX IF NOT EXISTS idx_forum_participants_user_id ON forum_participants(user_id);

-- 코멘트 추가
COMMENT ON TABLE forum_participants IS '포럼 포스트 참가자 정보 - 버튼 클릭 및 이모지 반응으로 참가한 사용자 추적';
COMMENT ON COLUMN forum_participants.forum_post_id IS '포럼 포스트(스레드) ID';
COMMENT ON COLUMN forum_participants.user_id IS 'Discord 사용자 ID';
COMMENT ON COLUMN forum_participants.nickname IS '참가 당시 사용자 닉네임 (정리된 형태)';
COMMENT ON COLUMN forum_participants.joined_at IS '참가 시각';
