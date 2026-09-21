import { logger } from '../../config/logger-termux.js';

export class ForumMessageRepository {
  constructor(dbManager) {
    this.dbManager = dbManager;
    this.parent = null;
  }

  setParent(parent) {
    this.parent = parent;
  }

  /**
   * 포럼 메시지 추적
   */
  async trackForumMessage(threadId, messageType, messageId) {
    if (!this.dbManager.isInitialized) {
      logger.error('데이터베이스 초기화되지 않음', { method: 'trackForumMessage' });
      return false;
    }

    if (!threadId || !messageType || !messageId) {
      logger.error('필수 파라미터 누락', {
        method: 'trackForumMessage',
        threadId: !!threadId, messageType: !!messageType, messageId: !!messageId
      });
      return false;
    }

    try {
      let columnName;
      if (messageType === 'participant_count') {
        columnName = 'participant_message_ids';
      } else if (messageType === 'emoji_reaction') {
        columnName = 'emoji_reaction_message_ids';
      } else {
        columnName = 'other_message_types';
      }

      const record = await this.parent.getOrCreateForumRecord(threadId);
      if (!record) {
        logger.error('포럼 레코드 생성/조회 실패', {
          method: 'trackForumMessage', threadId, messageType, messageId
        });
        return false;
      }

      let query, queryParams;

      if (columnName === 'other_message_types') {
        query = `
            UPDATE post_integrations
            SET other_message_types = COALESCE(other_message_types, '{}'::jsonb) ||
                jsonb_build_object($3::text,
                  COALESCE(other_message_types->$3::text, '[]'::jsonb) || $2::jsonb
                ),
              updated_at = CURRENT_TIMESTAMP
            WHERE forum_post_id = $1 AND is_active = true
        `;
        queryParams = [threadId, JSON.stringify([messageId]), messageType];
      } else {
        query = `
            UPDATE post_integrations
            SET ${columnName} = COALESCE(${columnName}, '[]'::jsonb) || $2::jsonb,
              updated_at = CURRENT_TIMESTAMP
            WHERE forum_post_id = $1 AND is_active = true
        `;
        queryParams = [threadId, JSON.stringify([messageId])];
      }

      const result = await this.dbManager.query(query, queryParams);

      if (result.rowCount > 0) {
        logger.debug('포럼 메시지 추적 저장 성공', {
          threadId, messageType, messageId, columnName, forum_state: record.forum_state
        });
        return true;
      } else {
        logger.warn('포럼 메시지 추적 저장 실패: 업데이트 실패', { threadId, messageType, messageId });
        return false;
      }

    } catch (error) {
      logger.error('포럼 메시지 추적 저장 오류', {
        method: 'trackForumMessage', threadId, messageType, messageId,
        error: error.message, code: error.code
      });
      return false;
    }
  }

  /**
   * 추적된 메시지 조회
   */
  async getTrackedMessages(threadId, messageType) {
    if (!this.dbManager.isInitialized) {
      logger.error('데이터베이스 초기화되지 않음', { method: 'getTrackedMessages' });
      return [];
    }

    if (!threadId || !messageType) {
      logger.error('필수 파라미터 누락', {
        method: 'getTrackedMessages', threadId: !!threadId, messageType: !!messageType
      });
      return [];
    }

    try {
      let query, queryParams;

      if (messageType === 'participant_count') {
        query = `
            SELECT participant_message_ids as message_ids
            FROM post_integrations
            WHERE forum_post_id = $1 AND is_active = true
        `;
        queryParams = [threadId];
      } else if (messageType === 'emoji_reaction') {
        query = `
            SELECT emoji_reaction_message_ids as message_ids
            FROM post_integrations
            WHERE forum_post_id = $1 AND is_active = true
        `;
        queryParams = [threadId];
      } else {
        query = `
            SELECT other_message_types->$2::text as message_ids
            FROM post_integrations
            WHERE forum_post_id = $1 AND is_active = true
        `;
        queryParams = [threadId, messageType];
      }

      const result = await this.dbManager.query(query, queryParams);

      if (result.rows.length > 0 && result.rows[0].message_ids) {
        const messageIds = result.rows[0].message_ids;

        if (Array.isArray(messageIds)) {
          logger.debug('추적된 메시지 조회 성공', {
            threadId, messageType, messageCount: messageIds.length
          });
          return messageIds;
        } else {
          logger.warn('추적된 메시지 데이터 형식 오류', {
            threadId, messageType, dataType: typeof messageIds
          });
          return [];
        }
      }

      logger.debug('추적된 메시지 없음', {
        threadId, messageType, foundRecords: result.rows.length
      });
      return [];

    } catch (error) {
      logger.error('추적된 메시지 조회 오류', {
        method: 'getTrackedMessages', threadId, messageType, error: error.message, code: error.code
      });
      return [];
    }
  }

  /**
   * 추적된 메시지 정리
   */
  async clearTrackedMessages(threadId, messageType) {
    if (!this.dbManager.isInitialized) {
      logger.error('데이터베이스 초기화되지 않음', { method: 'clearTrackedMessages' });
      return false;
    }

    if (!threadId || !messageType) {
      logger.error('필수 파라미터 누락', {
        method: 'clearTrackedMessages', threadId: !!threadId, messageType: !!messageType
      });
      return false;
    }

    try {
      const currentMessages = await this.parent.getTrackedMessages(threadId, messageType);
      const currentCount = currentMessages.length;

      let query, queryParams;

      if (messageType === 'participant_count') {
        query = `
            UPDATE post_integrations
            SET participant_message_ids = '[]'::jsonb,
              updated_at = CURRENT_TIMESTAMP
            WHERE forum_post_id = $1 AND is_active = true
        `;
        queryParams = [threadId];
      } else if (messageType === 'emoji_reaction') {
        query = `
            UPDATE post_integrations
            SET emoji_reaction_message_ids = '[]'::jsonb,
              updated_at = CURRENT_TIMESTAMP
            WHERE forum_post_id = $1 AND is_active = true
        `;
        queryParams = [threadId];
      } else {
        query = `
            UPDATE post_integrations
            SET other_message_types = other_message_types - $2::text,
              updated_at = CURRENT_TIMESTAMP
            WHERE forum_post_id = $1 AND is_active = true
        `;
        queryParams = [threadId, messageType];
      }

      const result = await this.dbManager.query(query, queryParams);

      if (result.rowCount > 0) {
        logger.debug('추적된 메시지 정리 성공', { threadId, messageType, clearedCount: currentCount });
        this.dbManager.invalidateCache();
        return true;
      } else {
        logger.warn('추적된 메시지 정리 실패: 대상 레코드 없음', { threadId, messageType });
        return false;
      }

    } catch (error) {
      logger.error('추적된 메시지 정리 오류', {
        method: 'clearTrackedMessages', threadId, messageType, error: error.message, code: error.code
      });
      return false;
    }
  }
}
