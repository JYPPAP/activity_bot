import { logger } from '../../config/logger-termux.js';

export class ForumWaitlistRepository {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  // ======== 포럼 대기자 관리 메서드 ========

  /**
   * 포럼 대기자 테이블 생성 (마이그레이션)
   */
  async ensureForumWaitlistTable() {
    try {
      await this.dbManager.query(`
        CREATE TABLE IF NOT EXISTS forum_waitlist (
          id SERIAL PRIMARY KEY,
          forum_post_id VARCHAR(255) NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          nickname VARCHAR(255) NOT NULL,
          added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(forum_post_id, user_id)
        )
      `);

      await this.dbManager.query(`
        CREATE INDEX IF NOT EXISTS idx_forum_waitlist_post_id
        ON forum_waitlist(forum_post_id)
      `);

      logger.info('forum_waitlist 테이블 확인/생성 완료');
      return true;
    } catch (error) {
      logger.error('forum_waitlist 테이블 생성 실패', { error: error.message });
      return false;
    }
  }

  /**
   * 대기자 추가
   */
  async addToWaitlist(forumPostId, userId, nickname) {
    try {
      await this.dbManager.query(`
        INSERT INTO forum_waitlist (forum_post_id, user_id, nickname)
        VALUES ($1, $2, $3)
        ON CONFLICT (forum_post_id, user_id) DO UPDATE
        SET nickname = EXCLUDED.nickname, added_at = CURRENT_TIMESTAMP
      `, [forumPostId, userId, nickname]);

      logger.debug('대기자 추가 완료', { forumPostId, userId, nickname });
      return true;
    } catch (error) {
      logger.error('대기자 추가 실패', { forumPostId, userId, error: error.message });
      return false;
    }
  }

  /**
   * 대기자 제거
   */
  async removeFromWaitlist(forumPostId, userId) {
    try {
      const result = await this.dbManager.query(`
        DELETE FROM forum_waitlist
        WHERE forum_post_id = $1 AND user_id = $2
      `, [forumPostId, userId]);

      logger.debug('대기자 제거 완료', { forumPostId, userId });
      return result.rowCount > 0;
    } catch (error) {
      logger.error('대기자 제거 실패', { forumPostId, userId, error: error.message });
      return false;
    }
  }

  /**
   * 대기자 목록 닉네임 배열 반환 (등록 순)
   */
  async getWaitlistNicknames(forumPostId) {
    try {
      const result = await this.dbManager.query(`
        SELECT nickname FROM forum_waitlist
        WHERE forum_post_id = $1
        ORDER BY added_at ASC
      `, [forumPostId]);

      return result.rows.map(row => row.nickname);
    } catch (error) {
      logger.error('대기자 목록 조회 실패', { forumPostId, error: error.message });
      return [];
    }
  }

  /**
   * 대기자 여부 확인
   */
  async isInWaitlist(forumPostId, userId) {
    try {
      const result = await this.dbManager.query(`
        SELECT 1 FROM forum_waitlist
        WHERE forum_post_id = $1 AND user_id = $2
        LIMIT 1
      `, [forumPostId, userId]);

      return result.rows.length > 0;
    } catch (error) {
      logger.error('대기자 여부 확인 실패', { forumPostId, userId, error: error.message });
      return false;
    }
  }

  /**
   * 포럼 포스트 대기자 전체 삭제 (포스트 종료 시)
   */
  async clearWaitlist(forumPostId) {
    try {
      await this.dbManager.query(`
        DELETE FROM forum_waitlist WHERE forum_post_id = $1
      `, [forumPostId]);
      return true;
    } catch (error) {
      logger.error('대기자 전체 삭제 실패', { forumPostId, error: error.message });
      return false;
    }
  }
}
