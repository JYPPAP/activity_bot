// src/repositories/ActivityRepository.js
// 활동 시간 추적 관련 데이터베이스 쿼리를 담당하는 Repository
import { logger } from '../config/logger-termux.js';

export class ActivityRepository {
  /**
   * @param {import('../services/DatabaseManager.js').DatabaseManager} dbManager
   */
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  // ======== 월별 활동 관리 메서드 ========

  /**
   * 일별 활동 시간 업데이트
   */
  async updateDailyActivity(userId, username, guildId, date, minutesToAdd) {
    try {
      const tableName = await this.dbManager.ensureMonthlyTable(date);
      const dayKey = date.getDate().toString().padStart(2, '0');

      await this.dbManager.transaction(async (client) => {
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

      this.dbManager.invalidateCache();
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
          const result = await this.dbManager.query(`
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
          const result = await this.dbManager.query(`
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
                if (minutesNum > 0) {
                  dailyData.push({
                    date: fullDate,
                    dateString: fullDate.toISOString().split('T')[0],
                    day: parseInt(day),
                    minutes: minutesNum,
                    hours: Math.round((minutesNum / 60) * 10) / 10,
                    formattedTime: this.formatMinutesToTime(minutesNum)
                  });
                }
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
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, '0');
      const currentMonth = `${year}${month}`;
      const tableName = `user_activities_${currentMonth}`;

      const result = await this.dbManager.query(`
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
        logger.debug('현재 월 테이블 존재하지 않음');
        return [];
      }
      logger.error('모든 사용자 활동 조회 실패', { error: error.message });
      throw error;
    }
  }

  /**
   * 사용자의 현재 월 총 활동 분 조회
   * @param {string} userId - 사용자 ID
   * @param {string} guildId - 길드 ID
   * @returns {Promise<number>} - 총 활동 분
   */
  async getUserTotalActivityMinutes(userId, guildId) {
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, '0');
      const tableName = `user_activities_${year}${month}`;

      const result = await this.dbManager.query(`
          SELECT total_voice_minutes
          FROM ${tableName}
          WHERE user_id = $1 AND guild_id = $2
      `, [userId, guildId]);

      const totalMinutes = result.rows[0]?.total_voice_minutes || 0;

      logger.debug('사용자 총 활동 분 조회', {
        userId, guildId, tableName, totalMinutes
      });

      return totalMinutes;
    } catch (error) {
      if (error.code === '42P01') {
        logger.debug('월별 테이블 존재하지 않음 (정상)', {
          method: 'getUserTotalActivityMinutes', userId, guildId
        });
        return 0;
      }
      logger.error('사용자 총 활동 분 조회 실패', {
        method: 'getUserTotalActivityMinutes', userId, guildId, error: error.message
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
      const now = new Date();
      const year = now.getFullYear();
      const month = (now.getMonth() + 1).toString().padStart(2, '0');
      const tableName = `user_activities_${year}${month}`;

      const result = await this.dbManager.query(`
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
        guildId, tableName, userCount: result.rows.length
      });

      return result.rows;
    } catch (error) {
      if (error.code === '42P01') {
        logger.debug('월별 테이블 존재하지 않음 (정상)', {
          method: 'getAllActiveUsersThisMonth', guildId
        });
        return [];
      }
      logger.error('현재 월 활성 사용자 조회 실패', {
        method: 'getAllActiveUsersThisMonth', guildId, error: error.message
      });
      return [];
    }
  }

  /**
   * 사용자 활동 조회 (호환성 - getUserActivity)
   */
  async getUserActivity(userId) {
    const user = await this.dbManager.getUserById(userId);
    if (!user) return null;

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

  /**
   * 사용자 활동 업데이트 (레거시 호환성)
   */
  async updateUserActivity(userId, totalTime, startTime, displayName) {
    const { config } = await import('../config/env.js');
    await this.dbManager.ensureUser(userId, displayName, config.GUILDID);
    return true;
  }

  // ActivityReportService 호환성 스텁 메서드
  async getDailyActivityStats(startTime, endTime) {
    console.warn('[ActivityRepository] getDailyActivityStats: activity_logs 제거로 인해 빈 데이터 반환');
    return [];
  }

  async getActivityLogs(startTime, endTime) {
    console.warn('[ActivityRepository] getActivityLogs: activity_logs 제거로 인해 빈 데이터 반환');
    return [];
  }
}
