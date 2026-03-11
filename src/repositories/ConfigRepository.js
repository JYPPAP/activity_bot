// src/repositories/ConfigRepository.js
// 길드 설정 및 역할 구성 관련 데이터베이스 쿼리를 담당하는 Repository
import { logger } from '../config/logger-termux.js';
import { config } from '../config/env.js';

export class ConfigRepository {
  /**
   * @param {import('../services/DatabaseManager.js').DatabaseManager} dbManager
   */
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  // ======== 길드 설정 관리 메서드 ========

  /**
   * 길드 설정 조회
   */
  async getGuildSettings(guildId) {
    try {
      const result = await this.dbManager.query(`
          SELECT *
          FROM guild_settings
          WHERE guild_id = $1
      `, [guildId]);

      return result.rows[0] || null;
    } catch (error) {
      logger.error('길드 설정 조회 실패', { guildId, error: error.message });
      throw error;
    }
  }

  /**
   * 길드 설정 업데이트/생성
   */
  async updateGuildSettings(guildId, settings) {
    try {
      const result = await this.dbManager.query(`
          INSERT INTO guild_settings (guild_id, guild_name, game_roles, log_channel_id, report_channel_id,
                                      excluded_voice_channels, activity_tiers, timezone, activity_tracking_enabled,
                                      monthly_target_hours)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (guild_id)
        DO
          UPDATE SET
              guild_name = EXCLUDED.guild_name,
              game_roles = EXCLUDED.game_roles,
              log_channel_id = EXCLUDED.log_channel_id,
              report_channel_id = EXCLUDED.report_channel_id,
              excluded_voice_channels = EXCLUDED.excluded_voice_channels,
              activity_tiers = EXCLUDED.activity_tiers,
              timezone = EXCLUDED.timezone,
              activity_tracking_enabled = EXCLUDED.activity_tracking_enabled,
              monthly_target_hours = EXCLUDED.monthly_target_hours,
              updated_at = CURRENT_TIMESTAMP
              RETURNING *
      `, [
        guildId,
        settings.guild_name || null,
        JSON.stringify(settings.game_roles || []),
        settings.log_channel_id || null,
        settings.report_channel_id || null,
        JSON.stringify(settings.excluded_voice_channels || { type1: [], type2: [] }),
        JSON.stringify(settings.activity_tiers || {}),
        settings.timezone || 'Asia/Seoul',
        settings.activity_tracking_enabled !== undefined ? settings.activity_tracking_enabled : true,
        settings.monthly_target_hours || 30
      ]);

      this.dbManager.invalidateCache();
      return result.rows[0];
    } catch (error) {
      logger.error('길드 설정 업데이트 실패', { guildId, error: error.message });
      throw error;
    }
  }

  // ======== Role Config 관련 (길드 설정으로 통합) ========

  async getRoleConfig(roleName) {
    const guildSettings = await this.getGuildSettings(config.GUILDID);
    if (!guildSettings || !guildSettings.game_roles) return null;

    const gameRoles = guildSettings.game_roles;
    const role = gameRoles.find(role => role.name === roleName);
    return role || null;
  }

  async updateRoleConfig(roleName, minHours, resetTime = null, reportCycle = 1) {
    logger.debug('Role Config 업데이트 (임시 구현)', { roleName, minHours });
    return true;
  }

  async getAllRoleConfigs() {
    const guildSettings = await this.getGuildSettings(config.GUILDID);
    return guildSettings?.game_roles || [];
  }

  /**
   * 역할별 리셋 시간 업데이트 (game_roles JSONB 내부)
   * 실제 활동 추적에서 사용되는 updateRoleResetTime은
   * guild_settings.game_roles JSONB를 업데이트해야 하므로 여기서 처리
   */
  async updateRoleResetTime(roleName, resetTime) {
    try {
      const guildSettings = await this.getGuildSettings(config.GUILDID);
      if (!guildSettings || !guildSettings.game_roles) return false;

      const gameRoles = [...guildSettings.game_roles];
      const roleIndex = gameRoles.findIndex(role => role.name === roleName);

      if (roleIndex === -1) return false;

      gameRoles[roleIndex] = { ...gameRoles[roleIndex], resetTime };

      await this.dbManager.query(`
        UPDATE guild_settings
        SET game_roles = $1::jsonb,
            updated_at = CURRENT_TIMESTAMP
        WHERE guild_id = $2
      `, [JSON.stringify(gameRoles), config.GUILDID]);

      this.dbManager.invalidateCache();
      return true;
    } catch (error) {
      logger.error('역할 리셋 시간 업데이트 실패', { roleName, error: error.message });
      return false;
    }
  }
}
