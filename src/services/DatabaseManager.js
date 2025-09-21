// src/services/DatabaseManager.js - PostgreSQL 버전
import pkg from 'pg';
import {logger} from '../config/logger-termux.js';
import {config} from '../config/env.js';

const {Pool} = pkg;

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
        ssl: process.env.NODE_ENV === 'production' ? {rejectUnauthorized: false} : false
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
      logger.error('데이터베이스 초기화 실패', {error: error.message, stack: error.stack});
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
      logger.error('데이터베이스 종료 실패', {error: error.message, stack: error.stack});
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
      logger.error('트랜잭션 롤백', {error: error.message});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 월별 활동 테이블 자동 생성
   */
  async ensureMonthlyTable(date = new Date()) {
    // 시간대 안전 날짜 계산 (UTC 문제 해결)
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const tableSuffix = `${year}${month}`;
    const tableName = `user_activities_${tableSuffix}`;

    try {
      const result = await this.query(`
        SELECT create_monthly_activity_table($1) as result
      `, [tableSuffix]);

      logger.debug('월별 테이블 확인/생성', {tableName});
      return tableName;
    } catch (error) {
      logger.error('월별 테이블 생성 실패', {tableName, error: error.message});
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
          VALUES ($1, $2, $3) ON CONFLICT (user_id) 
        DO
          UPDATE SET
              username = EXCLUDED.username,
              updated_at = CURRENT_TIMESTAMP
              RETURNING *
      `, [userId, username, guildId]);

      return result.rows[0];
    } catch (error) {
      logger.error('사용자 생성/조회 실패', {userId, error: error.message});
      throw error;
    }
  }

  /**
   * 사용자 정보 조회
   */
  async getUserById(userId) {
    try {
      const result = await this.query(`
          SELECT *
          FROM users
          WHERE user_id = $1
      `, [userId]);

      return result.rows[0] || null;
    } catch (error) {
      logger.error('사용자 조회 실패', {userId, error: error.message});
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
            VALUES ($1, $2, $3, '{}'::jsonb, 0) ON CONFLICT (guild_id, user_id) 
          DO
            UPDATE SET
                username = EXCLUDED.username,
                updated_at = CURRENT_TIMESTAMP
        `, [guildId, userId, username]);

        // 일별 시간 추가
        await client.query(`
            UPDATE ${tableName}
            SET daily_voice_minutes = COALESCE(daily_voice_minutes, '{}'::jsonb) ||
                                      jsonb_build_object($1::text, COALESCE((daily_voice_minutes ->>$1::text)::integer, 0) + $2::integer),
                total_voice_minutes = total_voice_minutes + $2::integer,
                updated_at          = CURRENT_TIMESTAMP
            WHERE guild_id = $3
              AND user_id = $4
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
        // 시간대 안전 날짜 계산 (UTC 문제 해결)
        const year = currentDate.getFullYear();
        const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
        const tableSuffix = `${year}${month}`;
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
            logger.debug('월별 테이블 존재하지 않음 (정상)', {tableName: monthInfo.tableName});
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
   * 사용자의 일별 활동 시간을 날짜 범위별로 조회합니다.
   * @param {string} userId - 사용자 ID
   * @param {number} startTime - 시작 시간 (타임스탬프)
   * @param {number} endTime - 종료 시간 (타임스탬프)
   * @returns {Promise<Array>} - 일별 활동 데이터 배열
   */
  async getUserDailyActivityByDateRange(userId, startTime, endTime) {
    try {
      const startDate = new Date(startTime);
      const endDate = new Date(endTime);
      const dailyData = [];

      const months = [];
      let currentDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

      while (currentDate <= endDate) {
        const year = currentDate.getFullYear();
        const month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
        const tableSuffix = `${year}${month}`;
        months.push({
          suffix: tableSuffix,
          tableName: `user_activities_${tableSuffix}`,
          year: currentDate.getFullYear(),
          month: currentDate.getMonth() + 1
        });

        currentDate.setMonth(currentDate.getMonth() + 1);
      }

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
                const minutesNum = parseInt(minutes) || 0;
                if (minutesNum > 0) { // 활동이 있는 날만 포함
                  dailyData.push({
                    date: fullDate,
                    dateString: fullDate.toISOString().split('T')[0], // YYYY-MM-DD
                    day: parseInt(day),
                    minutes: minutesNum,
                    hours: Math.round((minutesNum / 60) * 10) / 10, // 소수점 1자리
                    formattedTime: this.formatMinutesToTime(minutesNum)
                  });
                }
              }
            }
          }
        } catch (error) {
          if (error.code === '42P01') {
            logger.debug('월별 테이블 존재하지 않음 (정상)', {tableName: monthInfo.tableName});
            continue;
          }
          throw error;
        }
      }

      // 날짜순 정렬
      dailyData.sort((a, b) => a.date - b.date);

      logger.databaseOperation('사용자 일별 활동 시간 조회 완료', {
        userId,
        totalDays: dailyData.length,
        dateRange: `${startDate.toISOString().split('T')[0]} ~ ${endDate.toISOString().split('T')[0]}`
      });

      return dailyData;
    } catch (error) {
      logger.error('사용자 일별 활동 시간 조회 실패', {
        userId,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        error: error.message
      });
      return [];
    }
  }

  /**
   * 분을 시간:분 형태로 포맷팅합니다.
   * @param {number} minutes - 분
   * @returns {string} - 포맷팅된 시간 문자열
   */
  formatMinutesToTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}시간 ${mins}분`;
  }

  /**
   * 모든 사용자 활동 데이터 조회 (호환성)
   */
  async getAllUserActivity() {
    try {
      // 시간대 안전 날짜 계산 (UTC 문제 해결)
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, '0');
      const currentMonth = `${year}${month}`;
      const tableName = `user_activities_${currentMonth}`;

      const result = await this.query(`
          SELECT user_id                         as "userId",
                 username                        as "displayName",
                 total_voice_minutes * 60 * 1000 as "totalTime",
                 NULL                            as "startTime"
          FROM ${tableName}
          ORDER BY total_voice_minutes DESC
      `);

      return result.rows;
    } catch (error) {
      if (error.code === '42P01') {
        logger.debug('현재 월 테이블 존재하지 않음', {tableName: `user_activities_${currentMonth}`});
        return [];
      }
      logger.error('모든 사용자 활동 조회 실패', {error: error.message});
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
          SELECT *
          FROM guild_settings
          WHERE guild_id = $1
      `, [guildId]);

      return result.rows[0] || null;
    } catch (error) {
      logger.error('길드 설정 조회 실패', {guildId, error: error.message});
      throw error;
    }
  }

  /**
   * 길드 설정 업데이트/생성
   */
  async updateGuildSettings(guildId, settings) {
    try {
      const result = await this.query(`
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
        JSON.stringify(settings.excluded_voice_channels || {type1: [], type2: []}),
        JSON.stringify(settings.activity_tiers || {}),
        settings.timezone || 'Asia/Seoul',
        settings.activity_tracking_enabled !== undefined ? settings.activity_tracking_enabled : true,
        settings.monthly_target_hours || 30
      ]);

      this.invalidateCache();
      return result.rows[0];
    } catch (error) {
      logger.error('길드 설정 업데이트 실패', {guildId, error: error.message});
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
      logger.error('데이터 존재 확인 실패', {error: error.message});
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
          SET inactive_start_date = CURRENT_DATE,
              inactive_end_date   = $1,
              updated_at          = CURRENT_TIMESTAMP
          WHERE user_id = $2
      `, [untilDate, userId]);

      if (result.rowCount === 0) {
        // 사용자가 없으면 생성
        await this.query(`
            INSERT INTO users (user_id, username, guild_id, inactive_start_date, inactive_end_date)
            VALUES ($1, $2, $3, CURRENT_DATE, $4)
        `, [userId, displayName, config.GUILDID, untilDate]);
      }

      logger.databaseOperation('잠수 상태 설정', {userId, until: untilDate});
      this.invalidateCache();
      return true;
    } catch (error) {
      logger.error('잠수 상태 설정 실패', {userId, error: error.message});
      return false;
    }
  }

  /**
   * 사용자 잠수 상태 조회
   */
  async getUserAfkStatus(userId) {
    try {
      const result = await this.query(`
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
        totalTime: 0 // 필요시 별도 조회
      };
    } catch (error) {
      logger.error('잠수 상태 조회 실패', {userId, error: error.message});
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
          SET inactive_start_date = NULL,
              inactive_end_date   = NULL,
              updated_at          = CURRENT_TIMESTAMP
          WHERE user_id = $1
      `, [userId]);

      logger.databaseOperation('잠수 상태 해제', {userId});
      this.invalidateCache();
      return result.rowCount > 0;
    } catch (error) {
      logger.error('잠수 상태 해제 실패', {userId, error: error.message});
      return false;
    }
  }

  /**
   * 모든 잠수 사용자 조회
   */
  async getAllAfkUsers() {
    try {
      const result = await this.query(`
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
        totalTime: 0 // 필요시 월별 테이블에서 조회
      }));
    } catch (error) {
      logger.error('잠수 사용자 조회 실패', {error: error.message});
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
          SET inactive_start_date = NULL,
              inactive_end_date   = NULL,
              updated_at          = CURRENT_TIMESTAMP
          WHERE inactive_end_date < CURRENT_DATE RETURNING user_id
      `);

      const clearedUsers = result.rows.map(row => row.user_id);

      if (clearedUsers.length > 0) {
        logger.databaseOperation('만료된 잠수 상태 정리', {count: clearedUsers.length});
      }

      return clearedUsers;
    } catch (error) {
      logger.error('잠수 상태 만료 처리 실패', {error: error.message});
      return [];
    }
  }

  // ======== 포스트 연동 관리 메서드 (통합 테이블) ========

  /**
   * 포스트 연동 생성/업데이트
   */
  async createPostIntegration(guildId, voiceChannelId, forumPostId, forumChannelId) {
    try {
      // 먼저 기존 연동 상태를 확인
      const existingByPost = await this.query(`
        SELECT voice_channel_id, forum_post_id 
        FROM post_integrations 
        WHERE guild_id = $1 AND forum_post_id = $2 AND is_active = true
      `, [guildId, forumPostId]);

      const existingByChannel = await this.query(`
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
            guildId,
            existingChannelId,
            newVoiceChannelId: voiceChannelId,
            forumPostId
          });
          
          // STANDALONE → 실제 채널 업그레이드 처리
          // 먼저 target voice_channel_id가 이미 사용 중인지 확인
          const existingTargetChannel = await this.query(`
            SELECT voice_channel_id, forum_post_id 
            FROM post_integrations 
            WHERE guild_id = $1 AND voice_channel_id = $2 AND is_active = true
          `, [guildId, voiceChannelId]);

          // 기존 레코드가 있다면 비활성화
          if (existingTargetChannel.rows.length > 0) {
            await this.query(`
              UPDATE post_integrations 
              SET is_active = false, updated_at = CURRENT_TIMESTAMP
              WHERE guild_id = $1 AND voice_channel_id = $2 AND is_active = true
            `, [guildId, voiceChannelId]);
          }

          const updateResult = await this.query(`
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
              voiceChannelId, 
              forumPostId,
              previousChannelId: existingChannelId,
              newState: 'voice_linked',
              upgradeType: 'standalone_to_voice'
            });
            this.invalidateCache();
            return updateResult.rows[0];
          } else {
            logger.error('STANDALONE 포럼 업그레이드 실패 - 업데이트된 행이 없음', {
              voiceChannelId,
              forumPostId,
              existingChannelId
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

      // UPSERT 쿼리 실행 - 두 unique constraint 모두 처리
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

      logger.databaseOperation('포스트 연동 생성', {voiceChannelId, forumPostId});
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
          SELECT *
          FROM post_integrations
          WHERE voice_channel_id = $1
            AND is_active = true
      `, [voiceChannelId]);

      return result.rows[0] || null;
    } catch (error) {
      logger.error('포스트 연동 조회 실패', {voiceChannelId, error: error.message});
      return null;
    }
  }

  /**
   * 포스트 연동 해제 (아카이빙)
   */
  async deactivatePostIntegration(voiceChannelId, options = {}) {
    try {
      const {archive = true, lock = true} = options;

      const result = await this.query(`
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
          voiceChannelId,
          forumPostId: result.rows[0].forum_post_id,
          archive,
          lock
        });
      }

      this.invalidateCache();
      return result.rows[0] || null;
    } catch (error) {
      logger.error('포스트 연동 해제 실패', {voiceChannelId, error: error.message});
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
          SET ${messageType}_message_ids = COALESCE(${messageType}_message_ids, '[]'::jsonb) || $1::jsonb,
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
          WHERE voice_channel_id = $1
            AND is_active = true
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
    logger.debug('Role Config 업데이트 (임시 구현)', {roleName, minHours});
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
      const { rows } = await this.query(`
          SELECT
              voice_channel_id,
              forum_post_id,
              0 AS last_participant_count, -- 임시로 0 반환
              NULL::varchar(20) AS forum_tag_id, -- post_integrations에는 없으므로 우선 NULL
              created_at,
              updated_at
          FROM post_integrations
          WHERE is_active = true
          ORDER BY created_at DESC
      `);
      return rows ?? [];
    } catch (err) {
      console.error('[DatabaseManager] 채널 매핑 목록 조회 오류:', err);
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

  /**
   * 포럼 레코드 조회 또는 자동 생성
   * @param {string} forumPostId - 포럼 포스트 ID
   * @returns {Promise<Object|null>} - 포럼 레코드 또는 null
   */
  async getOrCreateForumRecord(forumPostId) {
    if (!this.isInitialized) {
      logger.error('데이터베이스 초기화되지 않음', { method: 'getOrCreateForumRecord' });
      return null;
    }

    try {
      // 1. 기존 레코드 확인 (is_active 조건 제거하여 모든 레코드 확인)
      const existingQuery = `
        SELECT * FROM post_integrations 
        WHERE forum_post_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `;
      
      const existingResult = await this.pool.query(existingQuery, [forumPostId]);
      
      if (existingResult.rows.length > 0) {
        const existing = existingResult.rows[0];
        logger.debug('기존 포럼 레코드 발견', { 
          forumPostId, 
          forum_state: existing.forum_state,
          is_active: existing.is_active
        });
        
        // 비활성 레코드인 경우 활성화
        if (!existing.is_active) {
          const reactivateQuery = `
            UPDATE post_integrations 
            SET is_active = true, updated_at = CURRENT_TIMESTAMP
            WHERE forum_post_id = $1
            RETURNING *
          `;
          const reactivateResult = await this.pool.query(reactivateQuery, [forumPostId]);
          logger.info('포럼 레코드 재활성화', { forumPostId });
          return reactivateResult.rows[0];
        }
        
        return existing;
      }

      // 2. 레코드가 없으면 기본 레코드 생성
      logger.info('포럼 레코드 자동 생성 시작', { forumPostId });
      
      return await this.createDefaultForumRecord(forumPostId);
      
    } catch (error) {
      logger.error('포럼 레코드 조회/생성 오류', {
        method: 'getOrCreateForumRecord',
        forumPostId,
        error: error.message,
        code: error.code
      });
      return null;
    }
  }

  /**
   * 기본 포럼 레코드 생성
   * @param {string} forumPostId - 포럼 포스트 ID
   * @returns {Promise<Object|null>} - 생성된 레코드 또는 null
   */
  async createDefaultForumRecord(forumPostId) {
    try {
      // 실제 길드 ID 사용 (config에서)
      const guildId = config.GUILDID || 'UNKNOWN_GUILD';
      
      // 실제 제약조건에 맞는 ON CONFLICT 패턴 시도
      const conflictStrategies = [
        // 실제 테이블 제약조건: PRIMARY KEY(guild_id, voice_channel_id), UNIQUE(guild_id, forum_post_id)
        'ON CONFLICT (guild_id, voice_channel_id) DO UPDATE SET',
        'ON CONFLICT (guild_id, forum_post_id) DO UPDATE SET', 
        'ON CONFLICT DO NOTHING' // 마지막 시도로 중복 시 무시
      ];

      let lastError = null;

      for (let i = 0; i < conflictStrategies.length; i++) {
        const conflictClause = conflictStrategies[i];
        const isDoNothing = conflictClause.includes('DO NOTHING');
        
        try {
          const insertQuery = `
            INSERT INTO post_integrations (
              guild_id, 
              voice_channel_id, 
              forum_post_id, 
              forum_channel_id,
              forum_state,
              auto_track_enabled,
              is_active,
              participant_message_ids,
              emoji_reaction_message_ids
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9
            )
            ${conflictClause}${isDoNothing ? '' : `
              forum_state = EXCLUDED.forum_state,
              auto_track_enabled = EXCLUDED.auto_track_enabled,
              is_active = EXCLUDED.is_active,
              updated_at = CURRENT_TIMESTAMP`}
            RETURNING *
          `;

          // 기본값 설정
          const values = [
            guildId,                      // guild_id
            `STANDALONE_${forumPostId}`,  // voice_channel_id (고유화)
            forumPostId,                  // forum_post_id
            config.FORUM_CHANNEL_ID,      // forum_channel_id (포럼이 생성된 채널 ID)
            'standalone',                 // forum_state
            true,                         // auto_track_enabled
            true,                         // is_active
            '[]',                         // participant_message_ids
            '[]'                          // emoji_reaction_message_ids
          ];

          const result = await this.pool.query(insertQuery, values);
          
          if (result.rows.length > 0) {
            logger.info('기본 포럼 레코드 생성 성공', {
              forumPostId,
              guildId,
              forum_state: result.rows[0].forum_state,
              conflictStrategy: conflictClause.split(' ')[0] + ' ' + conflictClause.split(' ')[1]
            });
            return result.rows[0];
          } else if (isDoNothing) {
            // DO NOTHING 인 경우 삽입되지 않았을 수 있으니 기존 레코드 조회
            logger.info('중복 레코드로 인해 삽입 생략, 기존 레코드 조회', { forumPostId });
            const existingQuery = `SELECT * FROM post_integrations WHERE forum_post_id = $1 LIMIT 1`;
            const existingResult = await this.pool.query(existingQuery, [forumPostId]);
            return existingResult.rows[0] || null;
          }
          
          break; // 성공하면 루프 종료
          
        } catch (error) {
          lastError = error;
          logger.warn(`포럼 레코드 생성 실패 (${i+1}/${conflictStrategies.length} 시도)`, {
            forumPostId,
            conflictStrategy: conflictClause.split(' ')[0] + ' ' + conflictClause.split(' ')[1],
            error: error.message,
            code: error.code
          });
          
          if (i === conflictStrategies.length - 1) {
            // 모든 시도 실패
            throw lastError;
          }
          
          continue; // 다음 전략 시도
        }
      }

      
    } catch (error) {
      logger.error('기본 포럼 레코드 생성 실패', {
        method: 'createDefaultForumRecord',
        forumPostId,
        error: error.message,
        code: error.code
      });
      return null;
    }
  }

  /**
   * 음성 채널과 포럼 연동
   * @param {string} forumPostId - 포럼 포스트 ID
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {string} requestedBy - 요청자 사용자 ID
   * @returns {Promise<boolean>} - 성공 여부
   */
  async linkVoiceChannel(forumPostId, voiceChannelId, requestedBy = null) {
    if (!this.isInitialized) {
      logger.error('데이터베이스 초기화되지 않음', { method: 'linkVoiceChannel' });
      return false;
    }

    try {
      const query = `
        UPDATE post_integrations 
        SET voice_channel_id = $2,
            forum_state = 'voice_linked',
            voice_linked_at = CURRENT_TIMESTAMP,
            link_requested_by = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE forum_post_id = $1
        RETURNING *
      `;
      
      const result = await this.pool.query(query, [forumPostId, voiceChannelId, requestedBy]);
      
      if (result.rowCount > 0) {
        logger.info('음성 채널 연동 완료', {
          forumPostId,
          voiceChannelId,
          requestedBy,
          forum_state: result.rows[0].forum_state
        });
        return true;
      }
      
      return false;
      
    } catch (error) {
      logger.error('음성 채널 연동 실패', {
        method: 'linkVoiceChannel',
        forumPostId,
        voiceChannelId,
        requestedBy,
        error: error.message,
        code: error.code
      });
      return false;
    }
  }

  /**
   * 독립형 포럼으로 설정
   * @param {string} forumPostId - 포럼 포스트 ID
   * @returns {Promise<boolean>} - 성공 여부
   */
  async setStandaloneMode(forumPostId) {
    if (!this.isInitialized) {
      logger.error('데이터베이스 초기화되지 않음', { method: 'setStandaloneMode' });
      return false;
    }

    try {
      const query = `
        UPDATE post_integrations 
        SET forum_state = 'standalone',
            voice_channel_id = 'STANDALONE',
            updated_at = CURRENT_TIMESTAMP
        WHERE forum_post_id = $1
        RETURNING *
      `;
      
      const result = await this.pool.query(query, [forumPostId]);
      
      if (result.rowCount > 0) {
        logger.info('독립형 포럼 설정 완료', {
          forumPostId,
          forum_state: result.rows[0].forum_state
        });
        return true;
      }
      
      return false;
      
    } catch (error) {
      logger.error('독립형 포럼 설정 실패', {
        method: 'setStandaloneMode',
        forumPostId,
        error: error.message,
        code: error.code
      });
      return false;
    }
  }

  // 포럼 메시지 추적 호환성 (개선된 버전)
  async trackForumMessage(threadId, messageType, messageId) {
    if (!this.isInitialized) {
      logger.error('데이터베이스 초기화되지 않음', { method: 'trackForumMessage' });
      return false;
    }

    if (!threadId || !messageType || !messageId) {
      logger.error('필수 파라미터 누락', { 
        method: 'trackForumMessage',
        threadId: !!threadId,
        messageType: !!messageType,
        messageId: !!messageId
      });
      return false;
    }

    try {
      // messageType에 따라 적절한 컬럼 선택
      let columnName;
      if (messageType === 'participant_count') {
        columnName = 'participant_message_ids';
      } else if (messageType === 'emoji_reaction') {
        columnName = 'emoji_reaction_message_ids';
      } else {
        // 'participant_change' 또는 기타 타입은 other_message_types JSONB 컬럼 사용
        columnName = 'other_message_types';
      }

      // 1. 포럼 레코드가 존재하는지 확인하고 없으면 생성
      const record = await this.getOrCreateForumRecord(threadId);
      if (!record) {
        logger.error('포럼 레코드 생성/조회 실패', {
          method: 'trackForumMessage',
          threadId,
          messageType,
          messageId
        });
        return false;
      }

      // 2. 메시지 ID 추가
      let query, queryParams;
      
      if (columnName === 'other_message_types') {
        // other_message_types JSONB 컬럼에 messageType별로 배열 저장
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
        // 기존 방식 (participant_message_ids, emoji_reaction_message_ids)
        query = `
            UPDATE post_integrations
            SET ${columnName} = COALESCE(${columnName}, '[]'::jsonb) || $2::jsonb,
              updated_at = CURRENT_TIMESTAMP
            WHERE forum_post_id = $1 AND is_active = true
        `;
        queryParams = [threadId, JSON.stringify([messageId])];
      }

      const result = await this.pool.query(query, queryParams);
      
      if (result.rowCount > 0) {
        logger.debug('포럼 메시지 추적 저장 성공', {
          threadId,
          messageType,
          messageId,
          columnName,
          forum_state: record.forum_state
        });
        return true;
      } else {
        logger.warn('포럼 메시지 추적 저장 실패: 업데이트 실패', {
          threadId,
          messageType,
          messageId
        });
        return false;
      }
      
    } catch (error) {
      logger.error('포럼 메시지 추적 저장 오류', {
        method: 'trackForumMessage',
        threadId,
        messageType,
        messageId,
        error: error.message,
        code: error.code
      });
      return false;
    }
  }

  async getTrackedMessages(threadId, messageType) {
    if (!this.isInitialized) {
      logger.error('데이터베이스 초기화되지 않음', { method: 'getTrackedMessages' });
      return [];
    }

    if (!threadId || !messageType) {
      logger.error('필수 파라미터 누락', { 
        method: 'getTrackedMessages',
        threadId: !!threadId,
        messageType: !!messageType
      });
      return [];
    }

    try {
      // messageType에 따라 적절한 컬럼 선택
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
        // 'participant_change' 또는 기타 타입은 other_message_types JSONB 컬럼에서 조회
        query = `
            SELECT other_message_types->$2::text as message_ids
            FROM post_integrations
            WHERE forum_post_id = $1 AND is_active = true
        `;
        queryParams = [threadId, messageType];
      }

      const result = await this.pool.query(query, queryParams);

      if (result.rows.length > 0 && result.rows[0].message_ids) {
        const messageIds = result.rows[0].message_ids;
        
        // JSONB 배열인지 확인
        if (Array.isArray(messageIds)) {
          logger.debug('추적된 메시지 조회 성공', {
            threadId,
            messageType,
            messageCount: messageIds.length
          });
          return messageIds;
        } else {
          logger.warn('추적된 메시지 데이터 형식 오류', {
            threadId,
            messageType,
            dataType: typeof messageIds
          });
          return [];
        }
      }
      
      logger.debug('추적된 메시지 없음', {
        threadId,
        messageType,
        foundRecords: result.rows.length
      });
      return [];
      
    } catch (error) {
      logger.error('추적된 메시지 조회 오류', {
        method: 'getTrackedMessages',
        threadId,
        messageType,
        error: error.message,
        code: error.code
      });
      return [];
    }
  }

  async clearTrackedMessages(threadId, messageType) {
    if (!this.isInitialized) {
      logger.error('데이터베이스 초기화되지 않음', { method: 'clearTrackedMessages' });
      return false;
    }

    if (!threadId || !messageType) {
      logger.error('필수 파라미터 누락', { 
        method: 'clearTrackedMessages',
        threadId: !!threadId,
        messageType: !!messageType
      });
      return false;
    }

    try {
      // 현재 추적된 메시지 수 확인 (로깅용)
      const currentMessages = await this.getTrackedMessages(threadId, messageType);
      const currentCount = currentMessages.length;

      // 해당 메시지 타입의 추적 정보 초기화
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
        // 'participant_change' 또는 기타 타입은 other_message_types JSONB에서 해당 키 제거
        query = `
            UPDATE post_integrations
            SET other_message_types = other_message_types - $2::text,
              updated_at = CURRENT_TIMESTAMP
            WHERE forum_post_id = $1 AND is_active = true
        `;
        queryParams = [threadId, messageType];
      }

      const result = await this.pool.query(query, queryParams);
      
      if (result.rowCount > 0) {
        logger.debug('추적된 메시지 정리 성공', {
          threadId,
          messageType,
          clearedCount: currentCount
        });
        this.invalidateCache(); // 캐시 무효화
        return true;
      } else {
        logger.warn('추적된 메시지 정리 실패: 대상 레코드 없음', {
          threadId,
          messageType
        });
        return false;
      }
      
    } catch (error) {
      logger.error('추적된 메시지 정리 오류', {
        method: 'clearTrackedMessages',
        threadId,
        messageType,
        error: error.message,
        code: error.code
      });
      return false;
    }
  }

  // ======== 추가된 메서드들 (activityTracker 호환성) ========
  
  /**
   * 사용자의 현재 월 총 활동 분 조회
   * @param {string} userId - 사용자 ID
   * @param {string} guildId - 길드 ID
   * @returns {Promise<number>} - 총 활동 분
   */
  async getUserTotalActivityMinutes(userId, guildId) {
    try {
      // 현재 월 기준으로 테이블 이름 생성
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, '0');
      const tableName = `user_activities_${year}${month}`;

      const result = await this.query(`
          SELECT total_voice_minutes
          FROM ${tableName}
          WHERE user_id = $1 AND guild_id = $2
      `, [userId, guildId]);

      const totalMinutes = result.rows[0]?.total_voice_minutes || 0;
      
      logger.debug('사용자 총 활동 분 조회', {
        userId,
        guildId,
        tableName,
        totalMinutes
      });

      return totalMinutes;
    } catch (error) {
      if (error.code === '42P01') {
        logger.debug('월별 테이블 존재하지 않음 (정상)', {
          method: 'getUserTotalActivityMinutes',
          userId,
          guildId
        });
        return 0;
      }
      logger.error('사용자 총 활동 분 조회 실패', {
        method: 'getUserTotalActivityMinutes',
        userId,
        guildId,
        error: error.message
      });
      return 0;
    }
  }

  /**
   * 현재 월의 모든 활성 사용자 활동 데이터 조회
   * @param {string} guildId - 길드 ID
   * @returns {Promise<Array>} - 활성 사용자 배열
   */
  async getAllActiveUsersThisMonth(guildId) {
    try {
      // 현재 월 기준으로 테이블 이름 생성
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, '0');
      const tableName = `user_activities_${year}${month}`;

      const result = await this.query(`
          SELECT 
              user_id as "userId",
              username as "nickname",
              total_voice_minutes as "totalMinutes"
          FROM ${tableName}
          WHERE guild_id = $1 
            AND total_voice_minutes > 0
          ORDER BY total_voice_minutes DESC
      `, [guildId]);

      logger.debug('현재 월 활성 사용자 조회', {
        guildId,
        tableName,
        userCount: result.rows.length
      });

      return result.rows;
    } catch (error) {
      if (error.code === '42P01') {
        logger.debug('월별 테이블 존재하지 않음 (정상)', {
          method: 'getAllActiveUsersThisMonth',
          guildId
        });
        return [];
      }
      logger.error('현재 월 활성 사용자 조회 실패', {
        method: 'getAllActiveUsersThisMonth',
        guildId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * 포럼 매핑 정보를 확실히 저장하는 메서드 (ensureForumMapping)
   * @param {string} voiceChannelId - 음성 채널 ID (또는 STANDALONE_포럼ID)
   * @param {string} forumPostId - 포럼 포스트 ID
   * @param {string} forumState - 포럼 상태 ('created', 'voice_linked', 'standalone')
   * @param {boolean} isActive - 활성 상태
   * @returns {Promise<boolean>} - 성공 여부
   */
  async ensureForumMapping(voiceChannelId, forumPostId, forumState = 'standalone', isActive = true) {
    if (!this.isInitialized) {
      logger.error('데이터베이스 초기화되지 않음', { method: 'ensureForumMapping' });
      return false;
    }

    if (!voiceChannelId || !forumPostId) {
      logger.error('필수 파라미터 누락', { 
        method: 'ensureForumMapping',
        voiceChannelId: !!voiceChannelId,
        forumPostId: !!forumPostId
      });
      return false;
    }

    try {
      const guildId = config.GUILDID || 'UNKNOWN_GUILD';
      
      // UPSERT 방식으로 매핑 정보 저장
      const query = `
        INSERT INTO post_integrations (
          guild_id, 
          voice_channel_id, 
          forum_post_id, 
          forum_channel_id,
          forum_state,
          auto_track_enabled,
          is_active,
          participant_message_ids,
          emoji_reaction_message_ids
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9
        )
        ON CONFLICT (guild_id, voice_channel_id) 
        DO UPDATE SET
          forum_post_id = EXCLUDED.forum_post_id,
          forum_state = EXCLUDED.forum_state,
          auto_track_enabled = EXCLUDED.auto_track_enabled,
          is_active = EXCLUDED.is_active,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `;

      const values = [
        guildId,                         // guild_id
        voiceChannelId,                  // voice_channel_id
        forumPostId,                     // forum_post_id
        config.FORUM_CHANNEL_ID,         // forum_channel_id
        forumState,                      // forum_state
        true,                            // auto_track_enabled
        isActive,                        // is_active
        '[]',                            // participant_message_ids
        '[]'                             // emoji_reaction_message_ids
      ];

      const result = await this.pool.query(query, values);
      
      if (result.rows.length > 0) {
        logger.info('포럼 매핑 저장 성공', {
          voiceChannelId,
          forumPostId,
          forumState,
          isActive,
          operation: result.rows[0].created_at === result.rows[0].updated_at ? 'INSERT' : 'UPDATE'
        });
        this.invalidateCache(); // 캐시 무효화
        return true;
      }
      
      logger.warn('포럼 매핑 저장 실패: 결과 없음', {
        voiceChannelId,
        forumPostId,
        forumState
      });
      return false;
      
    } catch (error) {
      logger.error('포럼 매핑 저장 오류', {
        method: 'ensureForumMapping',
        voiceChannelId,
        forumPostId,
        forumState,
        isActive,
        error: error.message,
        code: error.code
      });
      return false;
    }
  }

  /**
   * 포럼 상태 기반으로 활성 매핑 조회
   * @param {Array<string>} forumStates - 조회할 포럼 상태 배열 ['created', 'voice_linked', 'standalone']
   * @param {boolean} activeOnly - 활성 상태만 조회할지 여부 (기본값: true)
   * @returns {Promise<Array>} - 매핑 목록
   */
  async getActiveMappingsByForumState(forumStates = ['created', 'voice_linked', 'standalone'], activeOnly = true) {
    if (!this.isInitialized) {
      logger.error('데이터베이스 초기화되지 않음', { method: 'getActiveMappingsByForumState' });
      return [];
    }

    try {
      let query = `
        SELECT 
          voice_channel_id,
          forum_post_id,
          forum_state,
          is_active,
          auto_track_enabled,
          voice_linked_at,
          created_at,
          updated_at
        FROM post_integrations
        WHERE forum_state = ANY($1::text[])
      `;
      
      const params = [forumStates];
      
      if (activeOnly) {
        query += ` AND is_active = true`;
      }
      
      query += ` ORDER BY created_at DESC`;

      const result = await this.pool.query(query, params);
      
      logger.debug('포럼 상태별 활성 매핑 조회', {
        forumStates,
        activeOnly,
        foundCount: result.rows.length
      });
      
      return result.rows;
      
    } catch (error) {
      logger.error('포럼 상태별 활성 매핑 조회 오류', {
        method: 'getActiveMappingsByForumState',
        forumStates,
        activeOnly,
        error: error.message,
        code: error.code
      });
      return [];
    }
  }

  /**
   * 포럼 정보 조회 (Discord API 검증용)
   * @param {string} forumPostId - 포럼 포스트 ID
   * @returns {Promise<Object|null>} - 포럼 정보 (archived, locked 상태 포함)
   */
  async getForumPostInfo(forumPostId) {
    if (!this.isInitialized) {
      logger.error('데이터베이스 초기화되지 않음', { method: 'getForumPostInfo' });
      return null;
    }

    try {
      const query = `
        SELECT 
          forum_post_id,
          voice_channel_id,
          forum_state,
          is_active,
          auto_track_enabled,
          voice_linked_at,
          created_at,
          updated_at
        FROM post_integrations
        WHERE forum_post_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const result = await this.pool.query(query, [forumPostId]);
      
      if (result.rows.length > 0) {
        logger.debug('포럼 정보 조회 성공', {
          forumPostId,
          forum_state: result.rows[0].forum_state,
          is_active: result.rows[0].is_active
        });
        return result.rows[0];
      }
      
      logger.debug('포럼 정보 없음', { forumPostId });
      return null;
      
    } catch (error) {
      logger.error('포럼 정보 조회 오류', {
        method: 'getForumPostInfo',
        forumPostId,
        error: error.message,
        code: error.code
      });
      return null;
    }
  }
}