import { logger } from '../../config/logger-termux.js';
import { config } from '../../config/env.js';

export class PostIntegrationRepository {
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
      logger.info(`[ForumRepository] 참여자 수 기록: ${voiceChannelId} = ${count}`);
      return true;
    } catch (error) {
      logger.error('[ForumRepository] 참여자 수 업데이트 오류', { error: error.message, stack: error.stack });
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
      logger.error('[ForumRepository] 채널 매핑 목록 조회 오류', { error: err.message, stack: err.stack });
      return [];
    }
  }
}
