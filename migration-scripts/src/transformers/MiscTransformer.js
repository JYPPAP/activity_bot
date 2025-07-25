// Miscellaneous Data Transformation
// Handles remaining LowDB collections: reset_history, afk_status, forum_messages, voice_channel_mappings

import { v4 as uuidv4 } from 'uuid';

/**
 * Transforms remaining LowDB collections to PostgreSQL structure
 */
export class MiscTransformer {
  constructor(connectionPool, logger) {
    this.pool = connectionPool;
    this.logger = logger;
    this.stats = {
      resetHistoryProcessed: 0,
      afkStatusProcessed: 0,
      forumMessagesProcessed: 0,
      voiceMappingsProcessed: 0,
      errors: 0
    };
  }

  /**
   * Transform all miscellaneous collections
   * @param {Object} lowdbData - Complete LowDB data
   * @returns {Promise<Object>} Migration statistics
   */
  async transformMiscCollections(lowdbData) {
    this.logger.info('Starting miscellaneous collections transformation');

    const results = {
      resetHistory: null,
      afkStatus: null,
      forumMessages: null,
      voiceMappings: null,
      errors: []
    };

    try {
      // Transform reset history
      if (lowdbData.reset_history) {
        results.resetHistory = await this.transformResetHistory(lowdbData.reset_history);
      }

      // Transform AFK status
      if (lowdbData.afk_status) {
        results.afkStatus = await this.transformAfkStatus(lowdbData.afk_status);
      }

      // Transform forum messages
      if (lowdbData.forum_messages) {
        results.forumMessages = await this.transformForumMessages(lowdbData.forum_messages);
      }

      // Transform voice channel mappings
      if (lowdbData.voice_channel_mappings) {
        results.voiceMappings = await this.transformVoiceMappings(lowdbData.voice_channel_mappings);
      }

    } catch (error) {
      this.logger.error('Failed to transform miscellaneous collections', error);
      results.errors.push(error);
    }

    this.logger.info('Miscellaneous collections transformation completed', this.stats);
    return results;
  }

  /**
   * Transform reset history data
   * @param {Object} lowdbResetHistory - LowDB reset_history collection
   * @returns {Promise<Object>} Transformation result
   */
  async transformResetHistory(lowdbResetHistory) {
    this.logger.info('Transforming reset history data', {
      totalEntries: Object.keys(lowdbResetHistory).length
    });

    const errors = [];

    for (const [resetId, resetData] of Object.entries(lowdbResetHistory)) {
      try {
        await this.transformSingleResetRecord(resetId, resetData);
        this.stats.resetHistoryProcessed++;
      } catch (error) {
        this.stats.errors++;
        errors.push({ resetId, error: error.message });
        this.logger.error('Failed to transform reset history record', { resetId, error });
      }
    }

    return { processed: this.stats.resetHistoryProcessed, errors };
  }

  /**
   * Transform single reset history record
   * @param {string} resetId - Reset record ID
   * @param {Object} resetData - Reset data from LowDB
   */
  async transformSingleResetRecord(resetId, resetData) {
    if (!this.validateResetData(resetData)) {
      throw new Error(`Invalid reset data for ID: ${resetId}`);
    }

    await this.pool.transaction(async (client) => {
      // Find role ID by name
      const roleResult = await client.query(
        'SELECT id FROM roles WHERE name = $1',
        [resetData.roleName]
      );

      if (roleResult.rows.length === 0) {
        this.logger.warn('Role not found for reset history', {
          resetId,
          roleName: resetData.roleName
        });
        return;
      }

      const roleId = roleResult.rows[0].id;
      const resetTimestamp = new Date(resetData.resetTime);

      await client.query(`
        INSERT INTO role_reset_history (
          role_id,
          reset_timestamp,
          reset_reason,
          admin_username,
          notes,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (role_id, reset_timestamp) DO UPDATE SET
          reset_reason = EXCLUDED.reset_reason,
          admin_username = EXCLUDED.admin_username,
          notes = EXCLUDED.notes
      `, [
        roleId,
        resetTimestamp,
        resetData.reason || 'Legacy reset from migration',
        resetData.adminUser || 'system',
        `Migrated from LowDB reset ID: ${resetId}`,
        new Date()
      ]);
    });
  }

  /**
   * Transform AFK status data
   * @param {Object} lowdbAfkStatus - LowDB afk_status collection
   * @returns {Promise<Object>} Transformation result
   */
  async transformAfkStatus(lowdbAfkStatus) {
    this.logger.info('Transforming AFK status data', {
      totalEntries: Object.keys(lowdbAfkStatus).length
    });

    const errors = [];

    for (const [userId, afkData] of Object.entries(lowdbAfkStatus)) {
      try {
        await this.transformSingleAfkRecord(userId, afkData);
        this.stats.afkStatusProcessed++;
      } catch (error) {
        this.stats.errors++;
        errors.push({ userId, error: error.message });
        this.logger.error('Failed to transform AFK status record', { userId, error });
      }
    }

    return { processed: this.stats.afkStatusProcessed, errors };
  }

  /**
   * Transform single AFK status record
   * @param {string} userId - Discord user ID
   * @param {Object} afkData - AFK data from LowDB
   */
  async transformSingleAfkRecord(userId, afkData) {
    if (!this.isValidDiscordId(userId) || !this.validateAfkData(afkData)) {
      throw new Error(`Invalid AFK data for user: ${userId}`);
    }

    const afkStart = afkData.createdAt ? new Date(afkData.createdAt) : new Date();
    const afkUntil = afkData.afkUntil ? new Date(afkData.afkUntil) : null;
    const isActive = afkUntil ? afkUntil > new Date() : false;

    await this.pool.query(`
      INSERT INTO afk_status (
        user_id,
        afk_start,
        afk_until,
        afk_type,
        afk_reason,
        is_active,
        set_by_user_id,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (user_id, afk_start) DO UPDATE SET
        afk_until = EXCLUDED.afk_until,
        is_active = EXCLUDED.is_active,
        updated_at = EXCLUDED.updated_at
    `, [
      userId,
      afkStart,
      afkUntil,
      'MANUAL', // Default AFK type
      afkData.reason || 'Legacy AFK status from migration',
      isActive,
      userId, // Self-set AFK
      new Date(),
      new Date()
    ]);
  }

  /**
   * Transform forum messages data
   * @param {Object} lowdbForumMessages - LowDB forum_messages collection
   * @returns {Promise<Object>} Transformation result
   */
  async transformForumMessages(lowdbForumMessages) {
    this.logger.info('Transforming forum messages data', {
      totalThreads: Object.keys(lowdbForumMessages).length
    });

    const errors = [];
    let totalMessages = 0;

    for (const [threadId, messageData] of Object.entries(lowdbForumMessages)) {
      try {
        const messageCount = await this.transformForumThread(threadId, messageData);
        totalMessages += messageCount;
        this.stats.forumMessagesProcessed += messageCount;
      } catch (error) {
        this.stats.errors++;
        errors.push({ threadId, error: error.message });
        this.logger.error('Failed to transform forum thread', { threadId, error });
      }
    }

    return { processed: totalMessages, errors };
  }

  /**
   * Transform single forum thread
   * @param {string} threadId - Thread ID
   * @param {Object} messageData - Message data structure
   * @returns {Promise<number>} Number of messages processed
   */
  async transformForumThread(threadId, messageData) {
    if (!this.isValidDiscordId(threadId)) {
      throw new Error(`Invalid thread ID: ${threadId}`);
    }

    let messageCount = 0;

    for (const [messageType, messageIds] of Object.entries(messageData)) {
      if (!Array.isArray(messageIds)) continue;

      for (const messageId of messageIds) {
        if (!this.isValidDiscordId(messageId)) continue;

        await this.pool.query(`
          INSERT INTO forum_messages (
            thread_id,
            message_type,
            message_id,
            is_active,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (thread_id, message_id) DO UPDATE SET
            message_type = EXCLUDED.message_type,
            updated_at = EXCLUDED.updated_at
        `, [
          threadId,
          messageType.toUpperCase(),
          messageId,
          true,
          new Date(),
          new Date()
        ]);

        messageCount++;
      }
    }

    return messageCount;
  }

  /**
   * Transform voice channel mappings data
   * @param {Object} lowdbVoiceMappings - LowDB voice_channel_mappings collection
   * @returns {Promise<Object>} Transformation result
   */
  async transformVoiceMappings(lowdbVoiceMappings) {
    this.logger.info('Transforming voice channel mappings data', {
      totalMappings: Object.keys(lowdbVoiceMappings).length
    });

    const errors = [];

    for (const [voiceChannelId, mappingData] of Object.entries(lowdbVoiceMappings)) {
      try {
        await this.transformSingleVoiceMapping(voiceChannelId, mappingData);
        this.stats.voiceMappingsProcessed++;
      } catch (error) {
        this.stats.errors++;
        errors.push({ voiceChannelId, error: error.message });
        this.logger.error('Failed to transform voice mapping', { voiceChannelId, error });
      }
    }

    return { processed: this.stats.voiceMappingsProcessed, errors };
  }

  /**
   * Transform single voice channel mapping
   * @param {string} voiceChannelId - Voice channel ID
   * @param {Object} mappingData - Mapping data from LowDB
   */
  async transformSingleVoiceMapping(voiceChannelId, mappingData) {
    if (!this.isValidDiscordId(voiceChannelId) || !this.validateVoiceMappingData(mappingData)) {
      throw new Error(`Invalid voice mapping data for channel: ${voiceChannelId}`);
    }

    const createdAt = mappingData.createdAt ? new Date(mappingData.createdAt) : new Date();
    const updatedAt = mappingData.lastUpdated ? new Date(mappingData.lastUpdated) : createdAt;

    await this.pool.query(`
      INSERT INTO voice_channel_mappings (
        voice_channel_id,
        forum_post_id,
        last_participant_count,
        created_at,
        updated_at,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (voice_channel_id) DO UPDATE SET
        forum_post_id = EXCLUDED.forum_post_id,
        last_participant_count = EXCLUDED.last_participant_count,
        updated_at = EXCLUDED.updated_at
    `, [
      voiceChannelId,
      mappingData.forumPostId || null,
      parseInt(mappingData.lastParticipantCount) || 0,
      createdAt,
      updatedAt,
      true
    ]);
  }

  /**
   * Validation methods
   */
  isValidDiscordId(id) {
    return typeof id === 'string' && /^[0-9]{17,20}$/.test(id);
  }

  validateResetData(resetData) {
    return resetData && 
           typeof resetData === 'object' &&
           resetData.roleName &&
           resetData.resetTime &&
           !isNaN(parseInt(resetData.resetTime));
  }

  validateAfkData(afkData) {
    return afkData && 
           typeof afkData === 'object' &&
           (afkData.afkUntil === null || !isNaN(parseInt(afkData.afkUntil)));
  }

  validateVoiceMappingData(mappingData) {
    return mappingData && typeof mappingData === 'object';
  }

  /**
   * Get transformation statistics
   * @returns {Object} Current statistics
   */
  getStats() {
    const totalProcessed = this.stats.resetHistoryProcessed + 
                          this.stats.afkStatusProcessed + 
                          this.stats.forumMessagesProcessed + 
                          this.stats.voiceMappingsProcessed;
    
    return {
      ...this.stats,
      totalProcessed,
      successRate: totalProcessed / (totalProcessed + this.stats.errors) * 100
    };
  }

  /**
   * Reset transformer state for new migration
   */
  reset() {
    this.stats = {
      resetHistoryProcessed: 0,
      afkStatusProcessed: 0,
      forumMessagesProcessed: 0,
      voiceMappingsProcessed: 0,
      errors: 0
    };
  }

  /**
   * Validate all miscellaneous data before transformation
   * @param {Object} lowdbData - Complete LowDB data
   * @returns {Array} Validation errors
   */
  validateData(lowdbData) {
    const errors = [];

    // Validate reset history
    if (lowdbData.reset_history && typeof lowdbData.reset_history !== 'object') {
      errors.push('Invalid reset_history data structure');
    }

    // Validate AFK status
    if (lowdbData.afk_status && typeof lowdbData.afk_status !== 'object') {
      errors.push('Invalid afk_status data structure');
    }

    // Validate forum messages
    if (lowdbData.forum_messages && typeof lowdbData.forum_messages !== 'object') {
      errors.push('Invalid forum_messages data structure');
    }

    // Validate voice mappings
    if (lowdbData.voice_channel_mappings && typeof lowdbData.voice_channel_mappings !== 'object') {
      errors.push('Invalid voice_channel_mappings data structure');
    }

    return errors;
  }

  /**
   * Get migration summary for miscellaneous collections
   * @param {Object} lowdbData - Complete LowDB data
   * @returns {Object} Migration summary
   */
  getMigrationSummary(lowdbData) {
    return {
      resetHistory: {
        total: lowdbData.reset_history ? Object.keys(lowdbData.reset_history).length : 0
      },
      afkStatus: {
        total: lowdbData.afk_status ? Object.keys(lowdbData.afk_status).length : 0,
        activeCount: lowdbData.afk_status ? 
          Object.values(lowdbData.afk_status).filter(afk => 
            afk.afkUntil && new Date(afk.afkUntil) > new Date()
          ).length : 0
      },
      forumMessages: {
        totalThreads: lowdbData.forum_messages ? Object.keys(lowdbData.forum_messages).length : 0,
        estimatedMessages: lowdbData.forum_messages ?
          Object.values(lowdbData.forum_messages).reduce((total, thread) => {
            return total + Object.values(thread).reduce((threadTotal, messages) => {
              return threadTotal + (Array.isArray(messages) ? messages.length : 0);
            }, 0);
          }, 0) : 0
      },
      voiceMappings: {
        total: lowdbData.voice_channel_mappings ? Object.keys(lowdbData.voice_channel_mappings).length : 0
      }
    };
  }
}

export default MiscTransformer;