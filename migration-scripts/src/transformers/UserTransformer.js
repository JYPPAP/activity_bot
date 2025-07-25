// User Data Transformation
// Handles LowDB user_activity → PostgreSQL users + user_activities transformation

import { v4 as uuidv4 } from 'uuid';

/**
 * Transforms LowDB user activity data to PostgreSQL normalized structure
 */
export class UserTransformer {
  constructor(connectionPool, logger) {
    this.pool = connectionPool;
    this.logger = logger;
    this.processedUsers = new Set();
    this.stats = {
      usersProcessed: 0,
      activitiesCreated: 0,
      errors: 0,
      skipped: 0
    };
  }

  /**
   * Transform and migrate user activity data
   * @param {Object} lowdbUserActivity - LowDB user_activity collection
   * @returns {Promise<Object>} Migration statistics
   */
  async transformUserActivity(lowdbUserActivity) {
    this.logger.info('Starting user activity transformation', {
      totalUsers: Object.keys(lowdbUserActivity).length
    });

    const errors = [];
    
    for (const [userId, userData] of Object.entries(lowdbUserActivity)) {
      try {
        await this.transformSingleUser(userId, userData);
        this.stats.usersProcessed++;
        
        if (this.stats.usersProcessed % 100 === 0) {
          this.logger.info('User transformation progress', {
            processed: this.stats.usersProcessed,
            errors: this.stats.errors
          });
        }
      } catch (error) {
        this.stats.errors++;
        const errorDetails = {
          userId,
          error: error.message,
          stack: error.stack
        };
        errors.push(errorDetails);
        this.logger.error('Failed to transform user', errorDetails);
      }
    }

    this.logger.info('User activity transformation completed', this.stats);
    return {
      stats: this.stats,
      errors
    };
  }

  /**
   * Transform single user record
   * @param {string} userId - Discord user ID
   * @param {Object} userData - LowDB user data
   */
  async transformSingleUser(userId, userData) {
    // Validate Discord ID format
    if (!this.isValidDiscordId(userId)) {
      throw new Error(`Invalid Discord ID format: ${userId}`);
    }

    // Skip if already processed (duplicate prevention)
    if (this.processedUsers.has(userId)) {
      this.stats.skipped++;
      this.logger.debug('Skipping duplicate user', { userId });
      return;
    }

    await this.pool.transaction(async (client) => {
      // 1. Create or update user record
      await this.createUserRecord(client, userId, userData);
      
      // 2. Create user activity record
      await this.createUserActivityRecord(client, userId, userData);
      
      this.processedUsers.add(userId);
    });
  }

  /**
   * Create user record in PostgreSQL
   * @param {Object} client - Database client
   * @param {string} userId - Discord user ID
   * @param {Object} userData - User data from LowDB
   */
  async createUserRecord(client, userId, userData) {
    const displayName = this.sanitizeDisplayName(userData.displayName);
    const now = new Date();

    await client.query(`
      INSERT INTO users (
        id, 
        display_name, 
        first_seen, 
        last_seen, 
        is_active,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        last_seen = EXCLUDED.last_seen,
        updated_at = EXCLUDED.updated_at
    `, [
      userId,
      displayName,
      now, // first_seen
      now, // last_seen
      true, // is_active (assume active during migration)
      now, // created_at
      now  // updated_at
    ]);

    this.logger.debug('Created user record', { userId, displayName });
  }

  /**
   * Create user activity record in PostgreSQL
   * @param {Object} client - Database client
   * @param {string} userId - Discord user ID
   * @param {Object} userData - User data from LowDB
   */
  async createUserActivityRecord(client, userId, userData) {
    const totalTimeMs = parseInt(userData.totalTime) || 0;
    const currentSessionStart = userData.startTime ? new Date(userData.startTime) : null;
    const isCurrentlyActive = userData.startTime !== null;
    const sessionCount = isCurrentlyActive ? 1 : 0;
    const now = new Date();

    await client.query(`
      INSERT INTO user_activities (
        user_id,
        total_time_ms,
        current_session_start,
        is_currently_active,
        session_count,
        last_activity_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_id) DO UPDATE SET
        total_time_ms = EXCLUDED.total_time_ms,
        current_session_start = EXCLUDED.current_session_start,
        is_currently_active = EXCLUDED.is_currently_active,
        session_count = EXCLUDED.session_count,
        last_activity_at = EXCLUDED.last_activity_at,
        updated_at = EXCLUDED.updated_at
    `, [
      userId,
      totalTimeMs,
      currentSessionStart,
      isCurrentlyActive,
      sessionCount,
      now, // last_activity_at
      now, // created_at
      now  // updated_at
    ]);

    this.stats.activitiesCreated++;
    this.logger.debug('Created user activity record', {
      userId,
      totalTimeMs,
      isCurrentlyActive,
      sessionCount
    });
  }

  /**
   * Validate Discord ID format (snowflake)
   * @param {string} userId - User ID to validate
   * @returns {boolean} True if valid Discord ID
   */
  isValidDiscordId(userId) {
    return /^[0-9]{17,20}$/.test(userId);
  }

  /**
   * Sanitize display name for database storage
   * @param {string} displayName - Raw display name
   * @returns {string} Sanitized display name
   */
  sanitizeDisplayName(displayName) {
    if (!displayName || typeof displayName !== 'string') {
      return 'Unknown User';
    }

    // Trim and limit length
    return displayName.trim().substring(0, 255) || 'Unknown User';
  }

  /**
   * Get transformation statistics
   * @returns {Object} Current statistics
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.usersProcessed / (this.stats.usersProcessed + this.stats.errors) * 100
    };
  }

  /**
   * Reset transformer state for new migration
   */
  reset() {
    this.processedUsers.clear();
    this.stats = {
      usersProcessed: 0,
      activitiesCreated: 0,
      errors: 0,
      skipped: 0
    };
  }

  /**
   * Validate user data before transformation
   * @param {Object} lowdbUserActivity - LowDB user activity data
   * @returns {Array} Validation errors
   */
  validateData(lowdbUserActivity) {
    const errors = [];

    if (!lowdbUserActivity || typeof lowdbUserActivity !== 'object') {
      errors.push('Invalid user activity data structure');
      return errors;
    }

    for (const [userId, userData] of Object.entries(lowdbUserActivity)) {
      // Check Discord ID format
      if (!this.isValidDiscordId(userId)) {
        errors.push(`Invalid Discord ID format: ${userId}`);
      }

      // Check user data structure
      if (!userData || typeof userData !== 'object') {
        errors.push(`Invalid user data structure for user: ${userId}`);
        continue;
      }

      // Check totalTime is numeric
      if (userData.totalTime !== undefined && (!Number.isInteger(parseInt(userData.totalTime)) || parseInt(userData.totalTime) < 0)) {
        errors.push(`Invalid totalTime for user ${userId}: ${userData.totalTime}`);
      }

      // Check startTime format
      if (userData.startTime !== null && userData.startTime !== undefined) {
        const startTime = parseInt(userData.startTime);
        if (isNaN(startTime) || startTime < 0) {
          errors.push(`Invalid startTime for user ${userId}: ${userData.startTime}`);
        }
      }
    }

    return errors;
  }
}

export default UserTransformer;