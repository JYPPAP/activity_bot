// Role Configuration Transformation
// Handles LowDB role_config → PostgreSQL roles + role_reset_history transformation

/**
 * Transforms LowDB role configuration data to PostgreSQL normalized structure
 */
export class RoleTransformer {
  constructor(connectionPool, logger) {
    this.pool = connectionPool;
    this.logger = logger;
    this.stats = {
      rolesProcessed: 0,
      resetHistoryCreated: 0,
      errors: 0,
      skipped: 0
    };
  }

  /**
   * Transform and migrate role configuration data
   * @param {Object} lowdbRoleConfig - LowDB role_config collection
   * @returns {Promise<Object>} Migration statistics
   */
  async transformRoleConfig(lowdbRoleConfig) {
    this.logger.info('Starting role configuration transformation', {
      totalRoles: Object.keys(lowdbRoleConfig).length
    });

    const errors = [];
    
    for (const [roleName, roleData] of Object.entries(lowdbRoleConfig)) {
      try {
        await this.transformSingleRole(roleName, roleData);
        this.stats.rolesProcessed++;
      } catch (error) {
        this.stats.errors++;
        const errorDetails = {
          roleName,
          error: error.message,
          stack: error.stack
        };
        errors.push(errorDetails);
        this.logger.error('Failed to transform role', errorDetails);
      }
    }

    this.logger.info('Role configuration transformation completed', this.stats);
    return {
      stats: this.stats,
      errors
    };
  }

  /**
   * Transform single role record
   * @param {string} roleName - Role name from LowDB
   * @param {Object} roleData - Role data from LowDB
   */
  async transformSingleRole(roleName, roleData) {
    // Validate role data
    if (!this.validateRoleData(roleName, roleData)) {
      throw new Error(`Invalid role data for role: ${roleName}`);
    }

    await this.pool.transaction(async (client) => {
      // 1. Create or update role record
      const roleId = await this.createRoleRecord(client, roleName, roleData);
      
      // 2. Create reset history record if resetTime exists
      if (roleData.resetTime) {
        await this.createResetHistoryRecord(client, roleId, roleData.resetTime);
      }
    });
  }

  /**
   * Create role record in PostgreSQL
   * @param {Object} client - Database client
   * @param {string} roleName - Role name
   * @param {Object} roleData - Role data from LowDB
   * @returns {Promise<number>} Role ID
   */
  async createRoleRecord(client, roleName, roleData) {
    const minHours = parseFloat(roleData.minHours) || 0.0;
    const reportCycleWeeks = parseInt(roleData.reportCycle) || 1;
    const priority = this.calculateRolePriority(minHours);
    const now = new Date();

    const result = await client.query(`
      INSERT INTO roles (
        name,
        min_hours,
        report_cycle_weeks,
        priority,
        description,
        is_active,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (name) DO UPDATE SET
        min_hours = EXCLUDED.min_hours,
        report_cycle_weeks = EXCLUDED.report_cycle_weeks,
        priority = EXCLUDED.priority,
        updated_at = EXCLUDED.updated_at
      RETURNING id
    `, [
      this.sanitizeRoleName(roleName),
      minHours,
      reportCycleWeeks,
      priority,
      `Role migrated from LowDB: ${roleName}`,
      true, // is_active
      now,  // created_at
      now   // updated_at
    ]);

    const roleId = result.rows[0].id;
    
    this.logger.debug('Created role record', {
      roleId,
      roleName,
      minHours,
      reportCycleWeeks,
      priority
    });

    return roleId;
  }

  /**
   * Create role reset history record
   * @param {Object} client - Database client
   * @param {number} roleId - Role ID
   * @param {number} resetTime - Reset timestamp from LowDB
   */
  async createResetHistoryRecord(client, roleId, resetTime) {
    const resetTimestamp = new Date(resetTime);
    const now = new Date();

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
      ON CONFLICT (role_id, reset_timestamp) DO NOTHING
    `, [
      roleId,
      resetTimestamp,
      'Legacy data migration reset',
      'system',
      'Role reset history migrated from LowDB',
      now
    ]);

    this.stats.resetHistoryCreated++;
    
    this.logger.debug('Created reset history record', {
      roleId,
      resetTimestamp
    });
  }

  /**
   * Calculate role priority based on minimum hours
   * Higher hours = higher priority (lower number)
   * @param {number} minHours - Minimum hours required
   * @returns {number} Priority value
   */
  calculateRolePriority(minHours) {
    if (minHours >= 100) return 1;  // Very high priority
    if (minHours >= 50) return 2;   // High priority
    if (minHours >= 20) return 3;   // Medium priority
    if (minHours >= 10) return 4;   // Low priority
    return 5;                       // Default priority
  }

  /**
   * Sanitize role name for database storage
   * @param {string} roleName - Raw role name
   * @returns {string} Sanitized role name
   */
  sanitizeRoleName(roleName) {
    if (!roleName || typeof roleName !== 'string') {
      throw new Error('Invalid role name');
    }

    // Trim and limit length
    return roleName.trim().substring(0, 255);
  }

  /**
   * Validate role data structure
   * @param {string} roleName - Role name
   * @param {Object} roleData - Role data to validate
   * @returns {boolean} True if valid
   */
  validateRoleData(roleName, roleData) {
    if (!roleName || typeof roleName !== 'string') {
      this.logger.error('Invalid role name', { roleName });
      return false;
    }

    if (!roleData || typeof roleData !== 'object') {
      this.logger.error('Invalid role data structure', { roleName });
      return false;
    }

    // Check required fields
    if (roleData.minHours === undefined || roleData.minHours === null) {
      this.logger.error('Missing minHours field', { roleName });
      return false;
    }

    // Validate minHours is numeric and non-negative
    const minHours = parseFloat(roleData.minHours);
    if (isNaN(minHours) || minHours < 0) {
      this.logger.error('Invalid minHours value', { roleName, minHours: roleData.minHours });
      return false;
    }

    // Validate reportCycle if present
    if (roleData.reportCycle !== undefined) {
      const reportCycle = parseInt(roleData.reportCycle);
      if (isNaN(reportCycle) || reportCycle < 1) {
        this.logger.error('Invalid reportCycle value', { roleName, reportCycle: roleData.reportCycle });
        return false;
      }
    }

    // Validate resetTime if present
    if (roleData.resetTime !== undefined && roleData.resetTime !== null) {
      const resetTime = parseInt(roleData.resetTime);
      if (isNaN(resetTime) || resetTime < 0) {
        this.logger.error('Invalid resetTime value', { roleName, resetTime: roleData.resetTime });
        return false;
      }
    }

    return true;
  }

  /**
   * Get transformation statistics
   * @returns {Object} Current statistics
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.rolesProcessed / (this.stats.rolesProcessed + this.stats.errors) * 100
    };
  }

  /**
   * Reset transformer state for new migration
   */
  reset() {
    this.stats = {
      rolesProcessed: 0,
      resetHistoryCreated: 0,
      errors: 0,
      skipped: 0
    };
  }

  /**
   * Validate entire role configuration before transformation
   * @param {Object} lowdbRoleConfig - LowDB role configuration data
   * @returns {Array} Validation errors
   */
  validateData(lowdbRoleConfig) {
    const errors = [];

    if (!lowdbRoleConfig || typeof lowdbRoleConfig !== 'object') {
      errors.push('Invalid role configuration data structure');
      return errors;
    }

    const roleNames = Object.keys(lowdbRoleConfig);
    if (roleNames.length === 0) {
      errors.push('No roles found in configuration');
      return errors;
    }

    // Check for duplicate role names (case-insensitive)
    const normalizedNames = new Set();
    for (const roleName of roleNames) {
      const normalized = roleName.toLowerCase().trim();
      if (normalizedNames.has(normalized)) {
        errors.push(`Duplicate role name found: ${roleName}`);
      }
      normalizedNames.add(normalized);
    }

    // Validate each role
    for (const [roleName, roleData] of Object.entries(lowdbRoleConfig)) {
      if (!this.validateRoleData(roleName, roleData)) {
        errors.push(`Invalid role data for: ${roleName}`);
      }
    }

    return errors;
  }

  /**
   * Get role migration summary
   * @param {Object} lowdbRoleConfig - LowDB role configuration data
   * @returns {Object} Migration summary
   */
  getMigrationSummary(lowdbRoleConfig) {
    const summary = {
      totalRoles: Object.keys(lowdbRoleConfig).length,
      rolesWithResetHistory: 0,
      hourRanges: {
        '0-10': 0,
        '10-20': 0,
        '20-50': 0,
        '50-100': 0,
        '100+': 0
      },
      reportCycles: {}
    };

    for (const [roleName, roleData] of Object.entries(lowdbRoleConfig)) {
      // Count roles with reset history
      if (roleData.resetTime) {
        summary.rolesWithResetHistory++;
      }

      // Categorize by hour ranges
      const minHours = parseFloat(roleData.minHours) || 0;
      if (minHours >= 100) summary.hourRanges['100+']++;
      else if (minHours >= 50) summary.hourRanges['50-100']++;
      else if (minHours >= 20) summary.hourRanges['20-50']++;
      else if (minHours >= 10) summary.hourRanges['10-20']++;
      else summary.hourRanges['0-10']++;

      // Count report cycles
      const reportCycle = parseInt(roleData.reportCycle) || 1;
      summary.reportCycles[reportCycle] = (summary.reportCycles[reportCycle] || 0) + 1;
    }

    return summary;
  }
}

export default RoleTransformer;