// src/repositories/ForumRepository.js
// 포럼/포스트 연동 및 참가자 관리 데이터베이스 쿼리를 담당하는 Repository
import { logger } from '../config/logger-termux.js';
import { config } from '../config/env.js';

export class ForumRepository {
  /**
   * @param {import('../services/DatabaseManager.js').DatabaseManager} dbManager
   */
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  // ======== 포스트 연동 관리 메서드 ========

  /**
   * 포스트 연동 생성/업데이트
   */
  async createPostIntegration(guildId, voiceChannelId, forumPostId, forumChannelId) {
    try {
      // 먼저 기존 연동 상태를 확인
      const existingByPost = await this.dbManager.query(`
        SELECT voice_channel_id, forum_post_id
        FROM post_integrations
        WHERE guild_id = $1 AND forum_post_id = $2 AND is_active = true
      `, [guildId, forumPostId]);

      const existingByChannel = await this.dbManager.query(`
        SELECT voice_channel_id, forum_post_id
        FROM post_integrations
        WHERE guild_id = $1 AND voice_channel_id = $2 AND is_active = true
      `, [guildId, voiceChannelId]);

      // 동일한 포럼에 다른 채널이 이미 연결된 경우 확인
      if (existingByPost.rows.length > 0 && existingByPost.rows[0].voice_channel_id !== voiceChannelId) {
        const existingChannelId = existingByPost.rows[0].voice_channel_id;
        const isExistingStandalone = existingChannelId.startsWith('STANDALONE_');

        // STANDALONE 채널인 경우: 실제 채널로 업그레이드 허용
        if (isExistingStandalone) {
          logger.info('STANDALONE 포럼을 실제 음성채널로 업그레이드', {
            guildId, existingChannelId, newVoiceChannelId: voiceChannelId, forumPostId
          });

          // 먼저 target voice_channel_id가 이미 사용 중인지 확인
          const existingTargetChannel = await this.dbManager.query(`
            SELECT voice_channel_id, forum_post_id
            FROM post_integrations
            WHERE guild_id = $1 AND voice_channel_id = $2 AND is_active = true
          `, [guildId, voiceChannelId]);

          // 기존 레코드가 있다면 비활성화
          if (existingTargetChannel.rows.length > 0) {
            await this.dbManager.query(`
              UPDATE post_integrations
              SET is_active = false, updated_at = CURRENT_TIMESTAMP
              WHERE guild_id = $1 AND voice_channel_id = $2 AND is_active = true
            `, [guildId, voiceChannelId]);
          }

          const updateResult = await this.dbManager.query(`
            UPDATE post_integrations
            SET
              voice_channel_id = $1,
              forum_state = 'voice_linked',
              voice_linked_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = $2 AND forum_post_id = $3 AND is_active = true
            RETURNING *
          `, [voiceChannelId, guildId, forumPostId]);

          if (updateResult.rows.length > 0) {
            logger.databaseOperation('STANDALONE 포럼 업그레이드 완료', {
              voiceChannelId, forumPostId,
              previousChannelId: existingChannelId,
              newState: 'voice_linked',
              upgradeType: 'standalone_to_voice'
            });
            this.dbManager.invalidateCache();
            return updateResult.rows[0];
          } else {
            logger.error('STANDALONE 포럼 업그레이드 실패 - 업데이트된 행이 없음', {
              voiceChannelId, forumPostId, existingChannelId
            });
            throw new Error('STANDALONE 포럼 업그레이드 실패: 업데이트된 행이 없습니다');
          }
        } else {
          // 일반 채널끼리의 중복만 에러 처리
          const conflictError = new Error('이미 다른 음성 채널이 연결된 포럼 포스트입니다.');
          conflictError.code = '23505';
          conflictError.constraint = 'post_integrations_guild_id_forum_post_id_key';
          conflictError.detail = `Voice channel ${existingChannelId} is already linked to forum post ${forumPostId}`;
          throw conflictError;
        }
      }

      // UPSERT 쿼리 실행
      const result = await this.dbManager.query(`
        INSERT INTO post_integrations (guild_id, voice_channel_id, forum_post_id, forum_channel_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (guild_id, voice_channel_id)
        DO UPDATE SET
          forum_post_id = EXCLUDED.forum_post_id,
          forum_channel_id = EXCLUDED.forum_channel_id,
          is_active = true,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [guildId, voiceChannelId, forumPostId, forumChannelId]);

      logger.databaseOperation('포스트 연동 생성', { voiceChannelId, forumPostId });
      this.dbManager.invalidateCache();
      return result.rows[0];
    } catch (error) {
      logger.error('포스트 연동 생성 실패', {
        guildId, voiceChannelId, forumPostId, error: error.message
      });
      throw error;
    }
  }

  /**
   * 포스트 연동 조회
   */
  async getPostIntegration(voiceChannelId) {
    try {
      const result = await this.dbManager.query(`
          SELECT *
          FROM post_integrations
          WHERE voice_channel_id = $1
            AND is_active = true
      `, [voiceChannelId]);

      return result.rows[0] || null;
    } catch (error) {
      logger.error('포스트 연동 조회 실패', { voiceChannelId, error: error.message });
      return null;
    }
  }

  /**
   * 포스트 연동 해제 (아카이빙)
   */
  async deactivatePostIntegration(voiceChannelId, options = {}) {
    try {
      const { archive = true, lock = true } = options;

      const result = await this.dbManager.query(`
          UPDATE post_integrations
          SET is_active   = false,
              archived_at = ${archive ? 'CURRENT_TIMESTAMP' : 'archived_at'},
              locked_at   = ${lock ? 'CURRENT_TIMESTAMP' : 'locked_at'},
              updated_at  = CURRENT_TIMESTAMP
          WHERE voice_channel_id = $1
            AND is_active = true RETURNING *
      `, [voiceChannelId]);

      if (result.rows[0]) {
        logger.databaseOperation('포스트 연동 해제', {
          voiceChannelId, forumPostId: result.rows[0].forum_post_id, archive, lock
        });
      }

      this.dbManager.invalidateCache();
      return result.rows[0] || null;
    } catch (error) {
      logger.error('포스트 연동 해제 실패', { voiceChannelId, error: error.message });
      throw error;
    }
  }

  /**
   * 포럼 메시지 ID 추가
   */
  async addForumMessageId(voiceChannelId, messageType, messageId) {
    try {
      await this.dbManager.query(`
          UPDATE post_integrations
          SET ${messageType}_message_ids = COALESCE(${messageType}_message_ids, '[]'::jsonb) || $1::jsonb,
          updated_at = CURRENT_TIMESTAMP
          WHERE voice_channel_id = $2 AND is_active = true
      `, [JSON.stringify([messageId]), voiceChannelId]);

      logger.databaseOperation('포럼 메시지 ID 추가', { voiceChannelId, messageType, messageId });
      this.dbManager.invalidateCache();
      return true;
    } catch (error) {
      logger.error('포럼 메시지 ID 추가 실패', {
        voiceChannelId, messageType, messageId, error: error.message
      });
      return false;
    }
  }

  /**
   * 포럼 메시지 ID 조회
   */
  async getForumMessageIds(voiceChannelId, messageType) {
    try {
      const result = await this.dbManager.query(`
          SELECT ${messageType}_message_ids as message_ids
          FROM post_integrations
          WHERE voice_channel_id = $1
            AND is_active = true
      `, [voiceChannelId]);

      if (result.rows[0]) {
        return result.rows[0].message_ids || [];
      }
      return [];
    } catch (error) {
      logger.error('포럼 메시지 ID 조회 실패', { voiceChannelId, messageType, error: error.message });
      return [];
    }
  }

  // ======== 포럼 고급 관리 메서드 ========

  /**
   * 포럼 레코드 조회 또는 자동 생성
   */
  async getOrCreateForumRecord(forumPostId) {
    if (!this.dbManager.isInitialized) {
      logger.error('데이터베이스 초기화되지 않음', { method: 'getOrCreateForumRecord' });
      return null;
    }

    try {
      const existingResult = await this.dbManager.query(`
        SELECT * FROM post_integrations
        WHERE forum_post_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `, [forumPostId]);

      if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];
        logger.debug('기존 포럼 레코드 발견', {
          forumPostId, forum_state: existing.forum_state, is_active: existing.is_active
        });

        // 비활성 레코드인 경우 활성화
        if (!existing.is_active) {
          const reactivateResult = await this.dbManager.query(`
            UPDATE post_integrations
            SET is_active = true, updated_at = CURRENT_TIMESTAMP
            WHERE forum_post_id = $1
            RETURNING *
          `, [forumPostId]);
          logger.info('포럼 레코드 재활성화', { forumPostId });
          return reactivateResult.rows[0];
        }

        return existing;
      }

      // 레코드가 없으면 기본 레코드 생성
      logger.info('포럼 레코드 자동 생성 시작', { forumPostId });
      return await this.createDefaultForumRecord(forumPostId);

    } catch (error) {
      logger.error('포럼 레코드 조회/생성 오류', {
        method: 'getOrCreateForumRecord', forumPostId, error: error.message, code: error.code
      });
      return null;
    }
  }

  /**
   * 기본 포럼 레코드 생성
   */
  async createDefaultForumRecord(forumPostId) {
    try {
      const guildId = config.GUILDID || 'UNKNOWN_GUILD';

      const conflictStrategies = [
        'ON CONFLICT (guild_id, voice_channel_id) DO UPDATE SET',
        'ON CONFLICT (guild_id, forum_post_id) DO UPDATE SET',
        'ON CONFLICT DO NOTHING'
      ];

      let lastError = null;

      for (let i = 0; i < conflictStrategies.length; i++) {
        const conflictClause = conflictStrategies[i];
        const isDoNothing = conflictClause.includes('DO NOTHING');

        try {
          const insertQuery = `
            INSERT INTO post_integrations (
              guild_id, voice_channel_id, forum_post_id, forum_channel_id,
              forum_state, auto_track_enabled, is_active,
              participant_message_ids, emoji_reaction_message_ids
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ${conflictClause}${isDoNothing ? '' : `
              forum_state = EXCLUDED.forum_state,
              auto_track_enabled = EXCLUDED.auto_track_enabled,
              is_active = EXCLUDED.is_active,
              updated_at = CURRENT_TIMESTAMP`}
            RETURNING *
          `;

          const values = [
            guildId,
            `STANDALONE_${forumPostId}`,
            forumPostId,
            config.FORUM_CHANNEL_ID,
            'standalone',
            true,
            true,
            '[]',
            '[]'
          ];

          const result = await this.dbManager.query(insertQuery, values);

          if (result.rows.length > 0) {
            logger.info('기본 포럼 레코드 생성 성공', {
              forumPostId, guildId, forum_state: result.rows[0].forum_state
            });
            return result.rows[0];
          } else {
            // DO NOTHING: 중복으로 삽입 생략된 경우
            // DO UPDATE: RETURNING이 비어있는 엣지케이스 (매우 드묾)
            // 두 경우 모두 기존 레코드를 fallback 조회
            const label = isDoNothing ? '중복 레코드로 인해 삽입 생략' : 'RETURNING 빈 rows (엣지케이스)';
            logger.info(`${label}, 기존 레코드 조회`, { forumPostId });
            const existingResult = await this.dbManager.query(
              `SELECT * FROM post_integrations WHERE forum_post_id = $1 LIMIT 1`,
              [forumPostId]
            );
            return existingResult.rows[0] || null;
          }

        } catch (error) {
          lastError = error;
          logger.warn(`포럼 레코드 생성 실패 (${i + 1}/${conflictStrategies.length} 시도)`, {
            forumPostId, error: error.message, code: error.code
          });

          if (i === conflictStrategies.length - 1) {
            throw lastError;
          }
          continue;
        }
      }

    } catch (error) {
      logger.error('기본 포럼 레코드 생성 실패', {
        method: 'createDefaultForumRecord', forumPostId, error: error.message, code: error.code
      });
      return null;
    }
  }

  /**
   * 음성 채널과 포럼 연동
   */
  async linkVoiceChannel(forumPostId, voiceChannelId, requestedBy = null) {
    if (!this.dbManager.isInitialized) {
      logger.error('데이터베이스 초기화되지 않음', { method: 'linkVoiceChannel' });
      return false;
    }

    try {
      const result = await this.dbManager.query(`
        UPDATE post_integrations
        SET voice_channel_id = $2,
            forum_state = 'voice_linked',
            voice_linked_at = CURRENT_TIMESTAMP,
            link_requested_by = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE forum_post_id = $1
        RETURNING *
      `, [forumPostId, voiceChannelId, requestedBy]);

      if (result.rowCount > 0) {
        logger.info('음성 채널 연동 완료', {
          forumPostId, voiceChannelId, requestedBy, forum_state: result.rows[0].forum_state
        });
        return true;
      }

      return false;

    } catch (error) {
      logger.error('음성 채널 연동 실패', {
        method: 'linkVoiceChannel', forumPostId, voiceChannelId, requestedBy,
        error: error.message, code: error.code
      });
      return false;
    }
  }

  /**
   * 독립형 포럼으로 설정
   */
  async setStandaloneMode(forumPostId) {
    if (!this.dbManager.isInitialized) {
      logger.error('데이터베이스 초기화되지 않음', { method: 'setStandaloneMode' });
      return false;
    }

    try {
      const result = await this.dbManager.query(`
        UPDATE post_integrations
        SET forum_state = 'standalone',
            voice_channel_id = 'STANDALONE',
            updated_at = CURRENT_TIMESTAMP
        WHERE forum_post_id = $1
        RETURNING *
      `, [forumPostId]);

      if (result.rowCount > 0) {
        logger.info('독립형 포럼 설정 완료', {
          forumPostId, forum_state: result.rows[0].forum_state
        });
        return true;
      }

      return false;

    } catch (error) {
      logger.error('독립형 포럼 설정 실패', {
        method: 'setStandaloneMode', forumPostId, error: error.message, code: error.code
      });
      return false;
    }
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

      const record = await this.getOrCreateForumRecord(threadId);
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
      const currentMessages = await this.getTrackedMessages(threadId, messageType);
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

  /**
   * 포럼 매핑 정보를 확실히 저장
   */
  async ensureForumMapping(voiceChannelId, forumPostId, forumState = 'standalone', isActive = true) {
    if (!this.dbManager.isInitialized) {
      logger.error('데이터베이스 초기화되지 않음', { method: 'ensureForumMapping' });
      return false;
    }

    if (!voiceChannelId || !forumPostId) {
      logger.error('필수 파라미터 누락', {
        method: 'ensureForumMapping', voiceChannelId: !!voiceChannelId, forumPostId: !!forumPostId
      });
      return false;
    }

    try {
      const guildId = config.GUILDID || 'UNKNOWN_GUILD';

      const result = await this.dbManager.query(`
        INSERT INTO post_integrations (
          guild_id, voice_channel_id, forum_post_id, forum_channel_id,
          forum_state, auto_track_enabled, is_active,
          participant_message_ids, emoji_reaction_message_ids
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (guild_id, voice_channel_id)
        DO UPDATE SET
          forum_post_id = EXCLUDED.forum_post_id,
          forum_state = EXCLUDED.forum_state,
          auto_track_enabled = EXCLUDED.auto_track_enabled,
          is_active = EXCLUDED.is_active,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [
        guildId, voiceChannelId, forumPostId, config.FORUM_CHANNEL_ID,
        forumState, true, isActive, '[]', '[]'
      ]);

      if (result.rows.length > 0) {
        logger.info('포럼 매핑 저장 성공', {
          voiceChannelId, forumPostId, forumState, isActive,
          operation: result.rows[0].created_at === result.rows[0].updated_at ? 'INSERT' : 'UPDATE'
        });
        this.dbManager.invalidateCache();
        return true;
      }

      logger.warn('포럼 매핑 저장 실패: 결과 없음', { voiceChannelId, forumPostId, forumState });
      return false;

    } catch (error) {
      logger.error('포럼 매핑 저장 오류', {
        method: 'ensureForumMapping', voiceChannelId, forumPostId, forumState, isActive,
        error: error.message, code: error.code
      });
      return false;
    }
  }

  /**
   * 포럼 상태 기반으로 활성 매핑 조회
   */
  async getActiveMappingsByForumState(forumStates = ['created', 'voice_linked', 'standalone'], activeOnly = true) {
    if (!this.dbManager.isInitialized) {
      logger.error('데이터베이스 초기화되지 않음', { method: 'getActiveMappingsByForumState' });
      return [];
    }

    try {
      let query = `
        SELECT
          voice_channel_id, forum_post_id, forum_state, is_active,
          auto_track_enabled, voice_linked_at, created_at, updated_at
        FROM post_integrations
        WHERE forum_state = ANY($1::text[])
      `;

      const params = [forumStates];

      if (activeOnly) {
        query += ` AND is_active = true`;
      }

      query += ` ORDER BY created_at DESC`;

      const result = await this.dbManager.query(query, params);

      logger.debug('포럼 상태별 활성 매핑 조회', {
        forumStates, activeOnly, foundCount: result.rows.length
      });

      return result.rows;

    } catch (error) {
      logger.error('포럼 상태별 활성 매핑 조회 오류', {
        method: 'getActiveMappingsByForumState', forumStates, activeOnly,
        error: error.message, code: error.code
      });
      return [];
    }
  }

  /**
   * 포럼 정보 조회
   */
  async getForumPostInfo(forumPostId) {
    if (!this.dbManager.isInitialized) {
      logger.error('데이터베이스 초기화되지 않음', { method: 'getForumPostInfo' });
      return null;
    }

    try {
      const result = await this.dbManager.query(`
        SELECT
          forum_post_id, voice_channel_id, forum_state, is_active,
          auto_track_enabled, voice_linked_at, created_at, updated_at
        FROM post_integrations
        WHERE forum_post_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `, [forumPostId]);

      if (result.rows.length > 0) {
        logger.debug('포럼 정보 조회 성공', {
          forumPostId, forum_state: result.rows[0].forum_state, is_active: result.rows[0].is_active
        });
        return result.rows[0];
      }

      logger.debug('포럼 정보 없음', { forumPostId });
      return null;

    } catch (error) {
      logger.error('포럼 정보 조회 오류', {
        method: 'getForumPostInfo', forumPostId, error: error.message, code: error.code
      });
      return null;
    }
  }

  // ======== 채널 매핑 호환성 메서드 ========

  async saveChannelMapping(voiceChannelId, forumPostId) {
    return await this.createPostIntegration(config.GUILDID, voiceChannelId, forumPostId, config.FORUM_CHANNEL_ID);
  }

  async getChannelMapping(voiceChannelId) {
    const integration = await this.getPostIntegration(voiceChannelId);
    if (!integration) return null;

    return {
      voice_channel_id: integration.voice_channel_id,
      forum_post_id: integration.forum_post_id,
      last_participant_count: 0
    };
  }

  async removeChannelMapping(voiceChannelId) {
    const result = await this.deactivatePostIntegration(voiceChannelId);
    return result !== null;
  }

  async updateLastParticipantCount(voiceChannelId, count) {
    try {
      console.log(`[ForumRepository] 참여자 수 기록: ${voiceChannelId} = ${count}`);
      return true;
    } catch (error) {
      console.error('[ForumRepository] 참여자 수 업데이트 오류:', error);
      return false;
    }
  }

  async getAllChannelMappings() {
    try {
      const { rows } = await this.dbManager.query(`
          SELECT
              voice_channel_id,
              forum_post_id,
              0 AS last_participant_count,
              NULL::varchar(20) AS forum_tag_id,
              created_at,
              updated_at
          FROM post_integrations
          WHERE is_active = true
          ORDER BY created_at DESC
      `);
      return rows ?? [];
    } catch (err) {
      console.error('[ForumRepository] 채널 매핑 목록 조회 오류:', err);
      return [];
    }
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
