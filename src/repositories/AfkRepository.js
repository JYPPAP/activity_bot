// src/repositories/AfkRepository.js
// 잠수(AFK) 상태 관리 데이터베이스 쿼리를 담당하는 Repository
import { logger } from '../config/logger-termux.js';
import { config } from '../config/env.js';

export class AfkRepository {
  /**
   * @param {import('../services/DatabaseManager.js').DatabaseManager} dbManager
   */
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  // ======== 잠수 상태 관리 메서드 (users 테이블 통합) ========

  /**
   * 사용자 잠수 상태 설정
   */
  async setUserAfkStatus(userId, displayName, untilTimestamp) {
    try {
      const untilDate = new Date(untilTimestamp).toISOString().split('T')[0];

      const result = await this.dbManager.query(`
          UPDATE users
          SET inactive_start_date = CURRENT_DATE,
              inactive_end_date   = $1,
              updated_at          = CURRENT_TIMESTAMP
          WHERE user_id = $2
      `, [untilDate, userId]);

      if (result.rowCount === 0) {
        // 사용자가 없으면 생성
        await this.dbManager.query(`
            INSERT INTO users (user_id, username, guild_id, inactive_start_date, inactive_end_date)
            VALUES ($1, $2, $3, CURRENT_DATE, $4)
        `, [userId, displayName, config.GUILDID, untilDate]);
      }

      logger.databaseOperation('잠수 상태 설정', { userId, until: untilDate });
      this.dbManager.invalidateCache();
      return true;
    } catch (error) {
      logger.error('잠수 상태 설정 실패', { userId, error: error.message });
      return false;
    }
  }

  /**
   * 사용자 잠수 상태 조회
   */
  async getUserAfkStatus(userId) {
    try {
      const result = await this.dbManager.query(`
          SELECT user_id  as "userId",
                 username as "displayName",
                 inactive_start_date,
                 inactive_end_date,
                 CASE
                     WHEN inactive_end_date IS NULL THEN NULL
                     ELSE EXTRACT(EPOCH FROM inactive_end_date::timestamp) * 1000
                     END  as "afkUntil"
          FROM users
          WHERE user_id = $1
            AND inactive_start_date IS NOT NULL
      `, [userId]);

      const user = result.rows[0];
      if (!user) return null;

      return {
        userId: user.userId,
        displayName: user.displayName,
        afkUntil: user.afkUntil,
        totalTime: 0
      };
    } catch (error) {
      logger.error('잠수 상태 조회 실패', { userId, error: error.message });
      return null;
    }
  }

  /**
   * 사용자 잠수 상태 해제
   */
  async clearUserAfkStatus(userId) {
    try {
      const result = await this.dbManager.query(`
          UPDATE users
          SET inactive_start_date = NULL,
              inactive_end_date   = NULL,
              updated_at          = CURRENT_TIMESTAMP
          WHERE user_id = $1
      `, [userId]);

      logger.databaseOperation('잠수 상태 해제', { userId });
      this.dbManager.invalidateCache();
      return result.rowCount > 0;
    } catch (error) {
      logger.error('잠수 상태 해제 실패', { userId, error: error.message });
      return false;
    }
  }

  /**
   * 모든 잠수 사용자 조회
   */
  async getAllAfkUsers() {
    try {
      const result = await this.dbManager.query(`
          SELECT user_id  as "userId",
                 username as "displayName",
                 CASE
                     WHEN inactive_end_date IS NULL THEN NULL
                     ELSE EXTRACT(EPOCH FROM inactive_end_date::timestamp) * 1000
                     END  as "afkUntil"
          FROM users
          WHERE inactive_start_date IS NOT NULL
          ORDER BY inactive_start_date DESC
      `);

      return result.rows.map(row => ({
        ...row,
        totalTime: 0
      }));
    } catch (error) {
      logger.error('잠수 사용자 조회 실패', { error: error.message });
      return [];
    }
  }

  /**
   * 만료된 잠수 상태 정리
   */
  async clearExpiredAfkStatus() {
    try {
      const result = await this.dbManager.query(`
          UPDATE users
          SET inactive_start_date = NULL,
              inactive_end_date   = NULL,
              updated_at          = CURRENT_TIMESTAMP
          WHERE inactive_end_date < CURRENT_DATE RETURNING user_id
      `);

      const clearedUsers = result.rows.map(row => row.user_id);

      if (clearedUsers.length > 0) {
        logger.databaseOperation('만료된 잠수 상태 정리', { count: clearedUsers.length });
      }

      return clearedUsers;
    } catch (error) {
      logger.error('잠수 상태 만료 처리 실패', { error: error.message });
      return [];
    }
  }
}
