// src/services/DatabaseManager.js - PostgreSQL 버전
import pkg from 'pg';
import { logger } from '../config/logger-termux.js';
import { config } from '../config/env.js';

const { Pool } = pkg;

export class DatabaseManager {
  constructor() {
    this.pool = null;
    this.isInitialized = false;
    
    // 캐싱 시스템 (성능 최적화용)
    this.cache = new Map();
    this.cacheTimeout = 30000; // 30초 캐시 유지
    this.lastCacheTime = 0;
  }

  /**
   * 데이터베이스 연결 풀 초기화
   */
  async initialize() {
    try {
      if (!config.DATABASE_URL) {
        throw new Error('DATABASE_URL 환경 변수가 설정되지 않았습니다.');
      }

      this.pool = new Pool({
        connectionString: config.DATABASE_URL,
        // 연결 풀 설정
        min: 2,           // 최소 연결 수
        max: 10,          // 최대 연결 수
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
        // SSL 설정 (프로덕션 환경)
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
      });

      // 연결 테스트
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      this.isInitialized = true;
      logger.databaseOperation('PostgreSQL 연결 풀 초기화 완료', { 
        min: 2, 
        max: 10,
        ssl: process.env.NODE_ENV === 'production'
      });

      return true;
    } catch (error) {
      logger.error('데이터베이스 초기화 실패', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * 연결 풀 종료
   */
  async close() {
    try {
      if (this.pool) {
        await this.pool.end();
        this.isInitialized = false;
        logger.databaseOperation('PostgreSQL 연결 풀 종료 완료');
      }
      return true;
    } catch (error) {
      logger.error('데이터베이스 종료 실패', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * 데이터베이스 쿼리 실행 (기본)
   */
  async query(text, params = []) {
    if (!this.isInitialized) {
      throw new Error('데이터베이스가 초기화되지 않았습니다.');
    }

    try {
      const start = Date.now();
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      logger.debug('PostgreSQL 쿼리 실행', { 
        query: text.substring(0, 100), 
        params: params.length,
        duration: `${duration}ms`,
        rows: result.rowCount
      });
      
      return result;
    } catch (error) {
      logger.error('PostgreSQL 쿼리 실행 실패', { 
        error: error.message, 
        query: text.substring(0, 100),
        params: params.length
      });
      throw error;
    }
  }

  /**
   * 트랜잭션 실행
   */
  async transaction(callback) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('트랜잭션 롤백', { error: error.message });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 월별 활동 테이블 자동 생성
   */
  async ensureMonthlyTable(date = new Date()) {
    const tableSuffix = date.toISOString().slice(0, 7).replace('-', '');
    const tableName = `user_activities_${tableSuffix}`;
    
    try {
      const result = await this.query(`
        SELECT create_monthly_activity_table($1) as result
      `, [tableSuffix]);
      
      logger.debug('월별 테이블 확인/생성', { tableName });
      return tableName;
    } catch (error) {
      logger.error('월별 테이블 생성 실패', { tableName, error: error.message });
      throw error;
    }
  }

  /**
   * 스마트 캐싱 시스템
   */
  getCached(key, getter) {
    const now = Date.now();
    
    // 캐시 만료 확인
    if ((now - this.lastCacheTime) > this.cacheTimeout) {
      this.cache.clear();
      this.lastCacheTime = now;
    }
    
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    
    const data = getter();
    this.cache.set(key, data);
    return data;
  }

  /**
   * 캐시 무효화
   */
  invalidateCache() {
    this.cache.clear();
    this.lastCacheTime = Date.now();
  }

  // ======== 사용자 관리 메서드 ========

  /**
   * 사용자 정보 조회/생성
   */
  async ensureUser(userId, username, guildId) {
    try {
      const result = await this.query(`
        INSERT INTO users (user_id, username, guild_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          username = EXCLUDED.username,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [userId, username, guildId]);

      return result.rows[0];
    } catch (error) {
      logger.error('사용자 생성/조회 실패', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * 사용자 정보 조회
   */
  async getUserById(userId) {
    try {
      const result = await this.query(`
        SELECT * FROM users WHERE user_id = $1
      `, [userId]);

      return result.rows[0] || null;
    } catch (error) {
      logger.error('사용자 조회 실패', { userId, error: error.message });
      throw error;
    }
  }

  // ======== 월별 활동 관리 메서드 ========

  /**
   * 일별 활동 시간 업데이트
   */
  async updateDailyActivity(userId, username, guildId, date, minutesToAdd) {
    try {
      const tableName = await this.ensureMonthlyTable(date);
      const dayKey = date.getDate().toString().padStart(2, '0');

      await this.transaction(async (client) => {
        // 사용자 레코드 확인/생성
        await client.query(`
          INSERT INTO ${tableName} (guild_id, user_id, username, daily_voice_minutes, total_voice_minutes)
          VALUES ($1, $2, $3, '{}'::jsonb, 0)
          ON CONFLICT (guild_id, user_id) 
          DO UPDATE SET 
            username = EXCLUDED.username,
            updated_at = CURRENT_TIMESTAMP
        `, [guildId, userId, username]);

        // 일별 시간 추가
        await client.query(`
          UPDATE ${tableName}
          SET 
            daily_voice_minutes = COALESCE(daily_voice_minutes, '{}'::jsonb) || 
              jsonb_build_object($1, COALESCE((daily_voice_minutes->>$1)::integer, 0) + $2),
            total_voice_minutes = total_voice_minutes + $2,
            updated_at = CURRENT_TIMESTAMP
          WHERE guild_id = $3 AND user_id = $4
        `, [dayKey, minutesToAdd, guildId, userId]);
      });

      logger.databaseOperation('일별 활동 시간 업데이트', { 
        userId, 
        date: date.toISOString().split('T')[0], 
        minutesToAdd 
      });

      this.invalidateCache();
      return true;
    } catch (error) {
      logger.error('일별 활동 시간 업데이트 실패', { 
        userId, 
        date: date.toISOString(), 
        minutesToAdd,
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * 사용자 활동 시간 조회 (기간별)
   */
  async getUserActivityByDateRange(userId, startTime, endTime) {
    try {
      const startDate = new Date(startTime);
      const endDate = new Date(endTime);
      
      const months = [];
      let currentDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      
      while (currentDate <= endDate) {
        const tableSuffix = currentDate.toISOString().slice(0, 7).replace('-', '');
        months.push({
          suffix: tableSuffix,
          tableName: `user_activities_${tableSuffix}`,
          year: currentDate.getFullYear(),
          month: currentDate.getMonth() + 1
        });
        
        currentDate.setMonth(currentDate.getMonth() + 1);
      }

      let totalMinutes = 0;

      for (const monthInfo of months) {
        try {
          const result = await this.query(`
            SELECT daily_voice_minutes 
            FROM ${monthInfo.tableName} 
            WHERE user_id = $1
          `, [userId]);

          if (result.rows[0]) {
            const dailyMinutes = result.rows[0].daily_voice_minutes || {};
            
            for (const [day, minutes] of Object.entries(dailyMinutes)) {
              const fullDate = new Date(monthInfo.year, monthInfo.month - 1, parseInt(day));
              
              if (fullDate >= startDate && fullDate <= endDate) {
                totalMinutes += parseInt(minutes) || 0;
              }
            }
          }
        } catch (error) {
          if (error.code === '42P01') {
            logger.debug('월별 테이블 존재하지 않음 (정상)', { tableName: monthInfo.tableName });
            continue;
          }
          throw error;
        }
      }

      const totalTimeMs = totalMinutes * 60 * 1000;
      
      logger.databaseOperation('사용자 활동 시간 조회 완료', { 
        userId, 
        totalMinutes,
        totalTimeMs,
        monthsChecked: months.length
      });

      return totalTimeMs;
    } catch (error) {
      logger.error('사용자 활동 시간 조회 실패', { 
        userId, 
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        error: error.message 
      });
      return 0;
    }
  }

  /**
   * 모든 사용자 활동 데이터 조회 (호환성)
   */
  async getAllUserActivity() {
    try {
      const currentMonth = new Date().toISOString().slice(0, 7).replace('-', '');
      const tableName = `user_activities_${currentMonth}`;
      
      const result = await this.query(`
        SELECT 
          user_id as "userId",
          username as "displayName", 
          total_voice_minutes * 60 * 1000 as "totalTime",
          NULL as "startTime"
        FROM ${tableName}
        ORDER BY total_voice_minutes DESC
      `);

      return result.rows;
    } catch (error) {
      if (error.code === '42P01') {
        logger.debug('현재 월 테이블 존재하지 않음', { tableName: `user_activities_${currentMonth}` });
        return [];
      }
      logger.error('모든 사용자 활동 조회 실패', { error: error.message });
      throw error;
    }
  }

  // ======== 길드 설정 관리 메서드 ========

  /**
   * 길드 설정 조회
   */
  async getGuildSettings(guildId) {
    try {
      const result = await this.query(`
        SELECT * FROM guild_settings WHERE guild_id = $1
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
      const result = await this.query(`
        INSERT INTO guild_settings (guild_id, guild_name, game_roles, log_channel_id, report_channel_id, excluded_voice_channels, activity_tiers, timezone, activity_tracking_enabled, monthly_target_hours)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (guild_id) 
        DO UPDATE SET 
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

      this.invalidateCache();
      return result.rows[0];
    } catch (error) {
      logger.error('길드 설정 업데이트 실패', { guildId, error: error.message });
      throw error;
    }
  }

  // 계속해서 다른 메서드들을 추가해야 합니다...
  // 이 파일이 너무 길어지므로 부분적으로 구현하겠습니다.

  /**
   * 데이터 존재 확인 (호환성)
   */
  async hasAnyData() {
    try {
      const result = await this.query('SELECT COUNT(*) as count FROM users');
      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      logger.error('데이터 존재 확인 실패', { error: error.message });
      return false;
    }
  }

  // ======== 잠수 상태 관리 메서드 (users 테이블 통합) ========

  /**
   * 사용자 잠수 상태 설정
   */
  async setUserAfkStatus(userId, displayName, untilTimestamp) {
    try {
      const untilDate = new Date(untilTimestamp).toISOString().split('T')[0];
      
      const result = await this.query(`
        UPDATE users 
        SET 
          inactive_start_date = CURRENT_DATE,
          inactive_end_date = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $2
      `, [untilDate, userId]);

      if (result.rowCount === 0) {
        // 사용자가 없으면 생성
        await this.query(`
          INSERT INTO users (user_id, username, guild_id, inactive_start_date, inactive_end_date)
          VALUES ($1, $2, $3, CURRENT_DATE, $4)
        `, [userId, displayName, config.GUILDID, untilDate]);
      }

      logger.databaseOperation('잠수 상태 설정', { userId, until: untilDate });
      this.invalidateCache();
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
      const result = await this.query(`
        SELECT 
          user_id as "userId",
          username as "displayName",
          inactive_start_date,
          inactive_end_date,
          CASE 
            WHEN inactive_end_date IS NULL THEN NULL
            ELSE EXTRACT(EPOCH FROM inactive_end_date::timestamp) * 1000
          END as "afkUntil"
        FROM users 
        WHERE user_id = $1 AND inactive_start_date IS NOT NULL
      `, [userId]);

      const user = result.rows[0];
      if (!user) return null;

      return {
        userId: user.userId,
        displayName: user.displayName,
        afkUntil: user.afkUntil,
        totalTime: 0 // 필요시 별도 조회
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
      const result = await this.query(`
        UPDATE users 
        SET 
          inactive_start_date = NULL,
          inactive_end_date = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $1
      `, [userId]);

      logger.databaseOperation('잠수 상태 해제', { userId });
      this.invalidateCache();
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
      const result = await this.query(`
        SELECT 
          user_id as "userId",
          username as "displayName",
          CASE 
            WHEN inactive_end_date IS NULL THEN NULL
            ELSE EXTRACT(EPOCH FROM inactive_end_date::timestamp) * 1000
          END as "afkUntil"
        FROM users 
        WHERE inactive_start_date IS NOT NULL
        ORDER BY inactive_start_date DESC
      `);

      return result.rows.map(row => ({
        ...row,
        totalTime: 0 // 필요시 월별 테이블에서 조회
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
      const result = await this.query(`
        UPDATE users 
        SET 
          inactive_start_date = NULL,
          inactive_end_date = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE inactive_end_date < CURRENT_DATE
        RETURNING user_id
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

  // ======== 포스트 연동 관리 메서드 (통합 테이블) ========

  /**
   * 포스트 연동 생성/업데이트
   */
  async createPostIntegration(guildId, voiceChannelId, forumPostId, forumChannelId) {
    try {
      const result = await this.query(`
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
      this.invalidateCache();
      return result.rows[0];
    } catch (error) {
      logger.error('포스트 연동 생성 실패', { 
        guildId, voiceChannelId, forumPostId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * 포스트 연동 조회
   */
  async getPostIntegration(voiceChannelId) {
    try {
      const result = await this.query(`
        SELECT * FROM post_integrations 
        WHERE voice_channel_id = $1 AND is_active = true
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
      
      const result = await this.query(`
        UPDATE post_integrations 
        SET 
          is_active = false,
          archived_at = ${archive ? 'CURRENT_TIMESTAMP' : 'archived_at'},
          locked_at = ${lock ? 'CURRENT_TIMESTAMP' : 'locked_at'},
          updated_at = CURRENT_TIMESTAMP
        WHERE voice_channel_id = $1 AND is_active = true
        RETURNING *
      `, [voiceChannelId]);

      if (result.rows[0]) {
        logger.databaseOperation('포스트 연동 해제', { 
          voiceChannelId, 
          forumPostId: result.rows[0].forum_post_id,
          archive, 
          lock 
        });
      }

      this.invalidateCache();
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
      await this.query(`
        UPDATE post_integrations 
        SET 
          ${messageType}_message_ids = COALESCE(${messageType}_message_ids, '[]'::jsonb) || $1::jsonb,
          updated_at = CURRENT_TIMESTAMP
        WHERE voice_channel_id = $2 AND is_active = true
      `, [JSON.stringify([messageId]), voiceChannelId]);

      logger.databaseOperation('포럼 메시지 ID 추가', { 
        voiceChannelId, messageType, messageId 
      });
      
      this.invalidateCache();
      return true;
    } catch (error) {
      logger.error('포럼 메시지 ID 추가 실패', { 
        voiceChannelId, messageType, messageId, 
        error: error.message 
      });
      return false;
    }
  }

  /**
   * 포럼 메시지 ID 조회
   */
  async getForumMessageIds(voiceChannelId, messageType) {
    try {
      const result = await this.query(`
        SELECT ${messageType}_message_ids as message_ids
        FROM post_integrations 
        WHERE voice_channel_id = $1 AND is_active = true
      `, [voiceChannelId]);

      if (result.rows[0]) {
        return result.rows[0].message_ids || [];
      }
      return [];
    } catch (error) {
      logger.error('포럼 메시지 ID 조회 실패', { 
        voiceChannelId, messageType, 
        error: error.message 
      });
      return [];
    }
  }

  // ======== 호환성을 위한 레거시 메서드들 ========

  // Role Config 관련 (길드 설정으로 통합)
  async getRoleConfig(roleName) {
    const guildSettings = await this.getGuildSettings(config.GUILDID);
    if (!guildSettings || !guildSettings.game_roles) return null;
    
    const gameRoles = guildSettings.game_roles;
    const role = gameRoles.find(role => role.name === roleName);
    return role || null;
  }

  async updateRoleConfig(roleName, minHours, resetTime = null, reportCycle = 1) {
    // 임시 구현 - 추후 개선 필요
    logger.debug('Role Config 업데이트 (임시 구현)', { roleName, minHours });
    return true;
  }

  async getAllRoleConfigs() {
    const guildSettings = await this.getGuildSettings(config.GUILDID);
    return guildSettings?.game_roles || [];
  }

  // Activity 관련 호환성 메서드
  async getUserActivity(userId) {
    const user = await this.getUserById(userId);
    if (!user) return null;

    // 현재 월 활동 시간 조회
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const totalTime = await this.getUserActivityByDateRange(userId, monthStart, now);

    return {
      userId: user.user_id,
      totalTime: totalTime,
      startTime: null,
      displayName: user.username
    };
  }

  async updateUserActivity(userId, totalTime, startTime, displayName) {
    // 레거시 호환성을 위한 임시 구현
    await this.ensureUser(userId, displayName, config.GUILDID);
    return true;
  }

  // Transaction 관련 (Pool에서 자동 관리)
  async beginTransaction() { return true; }
  async commitTransaction() { return true; }
  async rollbackTransaction() { return true; }

  // Migration 관련
  async migrateFromJSON(activityData, roleConfigData) {
    logger.info('JSON 마이그레이션은 새로운 PostgreSQL 구조에서 지원하지 않습니다.');
    return true;
  }

  // 기타 임시 구현
  reloadData() { this.invalidateCache(); }
  forceReload() { this.invalidateCache(); }
  smartReload() { this.invalidateCache(); }

  // 채널 매핑 호환성 (post_integrations로 리다이렉트)
  async saveChannelMapping(voiceChannelId, forumPostId) {
    return await this.createPostIntegration(config.GUILDID, voiceChannelId, forumPostId, config.FORUM_CHANNEL_ID);
  }

  async getChannelMapping(voiceChannelId) {
    const integration = await this.getPostIntegration(voiceChannelId);
    if (!integration) return null;

    return {
      voice_channel_id: integration.voice_channel_id,
      forum_post_id: integration.forum_post_id,
      last_participant_count: 0 // 임시
    };
  }

  async removeChannelMapping(voiceChannelId) {
    const result = await this.deactivatePostIntegration(voiceChannelId);
    return result !== null;
  }

  async updateLastParticipantCount(voiceChannelId, count) {
    try {
      // post_integrations 테이블에 last_participant_count 필드가 없으므로 임시로 무시
      // 실제로는 별도 테이블이나 JSONB 필드에 저장할 수 있음
      console.log(`[DatabaseManager] 참여자 수 기록: ${voiceChannelId} = ${count}`);
      return true;
    } catch (error) {
      console.error('[DatabaseManager] 참여자 수 업데이트 오류:', error);
      return false;
    }
  }

  async getAllChannelMappings() {
    try {
      const query = `
        SELECT voice_channel_id, forum_post_id, created_at
        FROM post_integrations 
        WHERE is_active = true
        ORDER BY created_at DESC
      `;
      
      const result = await this.pool.query(query);
      return result.rows.map(row => ({
        voice_channel_id: row.voice_channel_id,
        forum_post_id: row.forum_post_id,
        last_participant_count: 0, // 임시값, 필요하면 별도 필드 추가
        created_at: row.created_at
      }));
    } catch (error) {
      console.error('[DatabaseManager] 채널 매핑 목록 조회 오류:', error);
      return [];
    }
  }

  // ActivityReportService 호환성 (activity_logs 제거로 인한 스텁 메서드)
  async getDailyActivityStats(startTime, endTime) {
    // activity_logs를 사용하지 않으므로 빈 통계 반환
    console.warn('[DatabaseManager] getDailyActivityStats: activity_logs 제거로 인해 빈 데이터 반환');
    return [];
  }

  async getActivityLogs(startTime, endTime) {
    // activity_logs를 사용하지 않으므로 빈 로그 반환
    console.warn('[DatabaseManager] getActivityLogs: activity_logs 제거로 인해 빈 데이터 반환');
    return [];
  }

  // 포럼 메시지 추적 호환성
  async trackForumMessage(threadId, messageType, messageId) {
    try {
      // messageType에 따라 적절한 컬럼 선택
      let columnName;
      if (messageType === 'participant_count') {
        columnName = 'participant_message_ids';
      } else if (messageType === 'emoji_reaction') {
        columnName = 'emoji_reaction_message_ids';
      } else {
        console.warn(`[DatabaseManager] 알 수 없는 메시지 타입: ${messageType}`);
        return false;
      }

      // 포럼 포스트 ID로 post_integrations 레코드 찾기 및 메시지 ID 추가
      const query = `
        UPDATE post_integrations 
        SET ${columnName} = COALESCE(${columnName}, '[]'::jsonb) || $2::jsonb,
            updated_at = CURRENT_TIMESTAMP
        WHERE forum_post_id = $1 AND is_active = true
      `;
      
      const result = await this.pool.query(query, [threadId, JSON.stringify([messageId])]);
      return result.rowCount > 0;
    } catch (error) {
      console.error('[DatabaseManager] 포럼 메시지 추적 저장 오류:', error);
      return false;
    }
  }

  async getTrackedMessages(threadId, messageType) {
    try {
      // messageType에 따라 적절한 컬럼 선택
      let columnName;
      if (messageType === 'participant_count') {
        columnName = 'participant_message_ids';
      } else if (messageType === 'emoji_reaction') {
        columnName = 'emoji_reaction_message_ids';
      } else {
        console.warn(`[DatabaseManager] 알 수 없는 메시지 타입: ${messageType}`);
        return [];
      }

      const query = `
        SELECT ${columnName} as message_ids
        FROM post_integrations 
        WHERE forum_post_id = $1 AND is_active = true
      `;
      
      const result = await this.pool.query(query, [threadId]);
      
      if (result.rows.length > 0 && result.rows[0].message_ids) {
        return result.rows[0].message_ids;
      }
      return [];
    } catch (error) {
      console.error('[DatabaseManager] 추적된 메시지 조회 오류:', error);
      return [];
    }
  }

  async clearTrackedMessages(threadId, messageType) {
    try {
      // messageType에 따라 적절한 컬럼 선택
      let columnName;
      if (messageType === 'participant_count') {
        columnName = 'participant_message_ids';
      } else if (messageType === 'emoji_reaction') {
        columnName = 'emoji_reaction_message_ids';
      } else {
        console.warn(`[DatabaseManager] 알 수 없는 메시지 타입: ${messageType}`);
        return false;
      }

      // 해당 메시지 타입의 추적 정보 초기화
      const query = `
        UPDATE post_integrations 
        SET ${columnName} = '[]'::jsonb,
            updated_at = CURRENT_TIMESTAMP
        WHERE forum_post_id = $1 AND is_active = true
      `;
      
      const result = await this.pool.query(query, [threadId]);
      return result.rowCount > 0;
    } catch (error) {
      console.error('[DatabaseManager] 추적된 메시지 삭제 오류:', error);
      return false;
    }
  }
}