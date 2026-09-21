import { logger } from '../../config/logger-termux.js';

export class ForumParticipantRepository {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  // ======== 포럼 참가자 관리 메서드 ========

  /**
   * 포럼 참가자 테이블 생성 (마이그레이션)
   */
  async ensureForumParticipantsTable() {
    try {
      await this.dbManager.query(`
        CREATE TABLE IF NOT EXISTS forum_participants (
          id SERIAL PRIMARY KEY,
          forum_post_id VARCHAR(255) NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          nickname VARCHAR(255) NOT NULL,
          joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(forum_post_id, user_id)
        )
      `);

      await this.dbManager.query(`
        CREATE INDEX IF NOT EXISTS idx_forum_participants_post_id
        ON forum_participants(forum_post_id)
      `);

      await this.dbManager.query(`
        CREATE INDEX IF NOT EXISTS idx_forum_participants_user_id
        ON forum_participants(user_id)
      `);

      logger.info('forum_participants 테이블 확인/생성 완료');
      return true;
    } catch (error) {
      logger.error('forum_participants 테이블 생성 실패', { error: error.message });
      return false;
    }
  }

  /**
   * 참가자 추가
   */
  async addParticipant(forumPostId, userId, nickname) {
    try {
      await this.dbManager.query(`
        INSERT INTO forum_participants (forum_post_id, user_id, nickname)
        VALUES ($1, $2, $3)
        ON CONFLICT (forum_post_id, user_id) DO UPDATE
        SET nickname = EXCLUDED.nickname, joined_at = CURRENT_TIMESTAMP
      `, [forumPostId, userId, nickname]);

      logger.debug('참가자 추가 완료', { forumPostId, userId, nickname });
      return true;
    } catch (error) {
      logger.error('참가자 추가 실패', { forumPostId, userId, nickname, error: error.message });
      return false;
    }
  }

  /**
   * 참가자 제거
   */
  async removeParticipant(forumPostId, userId) {
    try {
      const result = await this.dbManager.query(`
        DELETE FROM forum_participants
        WHERE forum_post_id = $1 AND user_id = $2
      `, [forumPostId, userId]);

      logger.debug('참가자 제거 완료', { forumPostId, userId, rowCount: result.rowCount });
      return result.rowCount > 0;
    } catch (error) {
      logger.error('참가자 제거 실패', { forumPostId, userId, error: error.message });
      return false;
    }
  }

  /**
   * 특정 포럼의 참가자 목록 조회
   */
  async getParticipants(forumPostId) {
    try {
      const result = await this.dbManager.query(`
        SELECT user_id, nickname, joined_at
        FROM forum_participants
        WHERE forum_post_id = $1
        ORDER BY joined_at ASC
      `, [forumPostId]);

      return result.rows.map(row => ({
        userId: row.user_id,
        nickname: row.nickname,
        joinedAt: row.joined_at
      }));
    } catch (error) {
      logger.error('참가자 목록 조회 실패', { forumPostId, error: error.message });
      return [];
    }
  }

  /**
   * 특정 포럼의 참가자 닉네임 목록 조회
   */
  async getParticipantNicknames(forumPostId) {
    try {
      const result = await this.dbManager.query(`
        SELECT nickname
        FROM forum_participants
        WHERE forum_post_id = $1
        ORDER BY joined_at ASC
      `, [forumPostId]);

      return result.rows.map(row => row.nickname);
    } catch (error) {
      logger.error('참가자 닉네임 목록 조회 실패', { forumPostId, error: error.message });
      return [];
    }
  }

  /**
   * 사용자가 특정 포럼에 참가 중인지 확인
   */
  async isParticipant(forumPostId, userId) {
    try {
      const result = await this.dbManager.query(`
        SELECT 1 FROM forum_participants
        WHERE forum_post_id = $1 AND user_id = $2
        LIMIT 1
      `, [forumPostId, userId]);

      return result.rows.length > 0;
    } catch (error) {
      logger.error('참가 여부 확인 실패', { forumPostId, userId, error: error.message });
      return false;
    }
  }

  /**
   * 특정 포럼의 참가자 수 조회
   */
  async getParticipantCount(forumPostId) {
    try {
      const result = await this.dbManager.query(`
        SELECT COUNT(*) as count
        FROM forum_participants
        WHERE forum_post_id = $1
      `, [forumPostId]);

      return parseInt(result.rows[0].count, 10);
    } catch (error) {
      logger.error('참가자 수 조회 실패', { forumPostId, error: error.message });
      return 0;
    }
  }

  /**
   * 특정 포럼의 모든 참가자 제거 (포럼 종료 시)
   */
  async clearParticipants(forumPostId) {
    try {
      const result = await this.dbManager.query(`
        DELETE FROM forum_participants
        WHERE forum_post_id = $1
      `, [forumPostId]);

      logger.info('포럼 참가자 전체 삭제 완료', {
        forumPostId, deletedCount: result.rowCount
      });
      return true;
    } catch (error) {
      logger.error('포럼 참가자 전체 삭제 실패', { forumPostId, error: error.message });
      return false;
    }
  }

  /**
   * 모든 활성 포럼의 참가자 정보 조회 (봇 초기화 시 사용)
   */
  async getAllActiveParticipants() {
    try {
      const result = await this.dbManager.query(`
        SELECT fp.forum_post_id, fp.nickname
        FROM forum_participants fp
        INNER JOIN post_integrations pi ON fp.forum_post_id = pi.forum_post_id
        WHERE pi.is_active = true
        ORDER BY fp.forum_post_id, fp.joined_at ASC
      `);

      const participantsMap = new Map();
      for (const row of result.rows) {
        const forumPostId = row.forum_post_id;
        if (!participantsMap.has(forumPostId)) {
          participantsMap.set(forumPostId, []);
        }
        participantsMap.get(forumPostId).push(row.nickname);
      }

      logger.info('모든 활성 포럼 참가자 정보 조회 완료', {
        forumCount: participantsMap.size,
        totalParticipants: result.rows.length
      });

      return participantsMap;
    } catch (error) {
      logger.error('모든 활성 포럼 참가자 정보 조회 실패', { error: error.message });
      return new Map();
    }
  }
}
