// SQLiteManager - 고성능 SQLite 데이터베이스 매니저

import { injectable, inject } from 'tsyringe';
import sqlite3 from 'sqlite3';
import path from 'path';

import { DatabaseInitializer } from '../database/init.js';
import {
  SQLiteConfig,
  DatabaseConnection,
  UserActivityRow,
  ActivityLogRow,
  AfkStatusRow,
  PerformanceMetrics,
  UserActivityQueryOptions,
  ActivityLogQueryOptions,
} from '../types/sqlite.js';

import { UserActivity, ActivityLogEntry, AfkStatus, RoleConfig, VoiceChannelMapping } from '../types/index.js';
import type { IDatabaseManager } from '../interfaces/IDatabaseManager.js';
import type { IRedisService } from '../interfaces/IRedisService.js';
import { DI_TOKENS } from '../interfaces/index.js';

@injectable()
export class SQLiteManager implements IDatabaseManager {
  private connection: DatabaseConnection | null = null;
  private initializer: DatabaseInitializer;
  private config: Required<SQLiteConfig>;

  // Redis 캐싱 시스템 (분산 캐시)
  private redis: IRedisService;
  private fallbackCache: Map<string, { data: any; timestamp: number; ttl: number }> = new Map();
  private metrics: PerformanceMetrics;

  // 캐시 설정
  private readonly CACHE_TTL = {
    USER_ACTIVITY: 300, // 5분
    ROLE_CONFIG: 600,   // 10분
    ACTIVITY_LOG: 180,  // 3분
    STATISTICS: 120,    // 2분
  };

  // 준비된 쿼리 문들 (성능 최적화)
  private preparedStatements: Map<string, sqlite3.Statement> = new Map();

  constructor(
    config: Partial<SQLiteConfig> = {},
    @inject(DI_TOKENS.IRedisService) redis: IRedisService
  ) {
    this.redis = redis;
    this.config = {
      database: config.database || path.join(process.cwd(), 'activity_bot.sqlite'),
      enableWAL: config.enableWAL ?? true,
      timeout: config.timeout ?? 30000,
      enableForeignKeys: config.enableForeignKeys ?? true,
      cacheSize: config.cacheSize ?? 2000,
      busyTimeout: config.busyTimeout ?? 10000,
    };

    this.initializer = new DatabaseInitializer(this.config);

    this.metrics = {
      queryCount: 0,
      totalQueryTime: 0,
      averageQueryTime: 0,
      slowQueries: [],
      cacheHitRate: 0,
      memoryUsage: 0,
    };
  }

  /**
   * 데이터베이스 연결 및 초기화
   */
  async initialize(): Promise<boolean> {
    try {
      console.log('[SQLite] 데이터베이스 초기화 중...');

      this.connection = await this.initializer.initialize();

      if (this.connection.isConnected) {
        await this.prepareCriticalStatements();
        console.log('[SQLite] 데이터베이스 초기화 완료');
        return true;
      }

      return false;
    } catch (error) {
      console.error('[SQLite] 초기화 실패:', error);
      return false;
    }
  }

  /**
   * 자주 사용되는 쿼리들을 미리 준비
   */
  private async prepareCriticalStatements(): Promise<void> {
    const statements = {
      getUserActivity: 'SELECT * FROM user_activities WHERE user_id = ?',
      updateUserActivity: `
        INSERT OR REPLACE INTO user_activities 
        (user_id, total_time, start_time, display_name, last_updated) 
        VALUES (?, ?, ?, ?, ?)
      `,
      insertActivityLog: `
        INSERT INTO activity_logs 
        (user_id, event_type, timestamp, channel_id, channel_name, guild_id, session_duration) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      getActiveUsers: 'SELECT * FROM active_users',
      updateAfkStatus: `
        INSERT OR REPLACE INTO afk_status 
        (user_id, is_afk, afk_since, reason, auto_afk, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?)
      `,
    };

    for (const [name, sql] of Object.entries(statements)) {
      try {
        const stmt = await this.prepare(sql);
        this.preparedStatements.set(name, stmt);
      } catch (error) {
        console.warn(`[SQLite] 준비된 쿼리 생성 실패 (${name}):`, error);
      }
    }

    console.log(`[SQLite] ${this.preparedStatements.size}개의 준비된 쿼리 생성 완료`);
  }

  // ===========================================
  // 사용자 활동 관련 메서드들
  // ===========================================

  /**
   * 사용자 활동 데이터 조회
   */
  async getUserActivity(userId: string): Promise<UserActivity | null> {
    const cacheKey = `user_activity_${userId}`;

    // 캐시 확인
    const cached = await this.getFromCache(cacheKey);
    if (cached) {
      return this.convertToUserActivity(cached);
    }

    try {
      const startTime = Date.now();
      const stmt = this.preparedStatements.get('getUserActivity');

      const row: UserActivityRow = await this.getWithStatement(stmt!, [userId]);

      this.updateMetrics(Date.now() - startTime);

      if (row) {
        const userActivity = this.convertToUserActivity(row);
        await this.setCache(cacheKey, row, this.CACHE_TTL.USER_ACTIVITY); // Redis TTL 사용
        return userActivity;
      }

      return null;
    } catch (error) {
      console.error('[SQLite] 사용자 활동 조회 실패:', error);
      return null;
    }
  }

  /**
   * 모든 사용자 활동 데이터 조회 (DatabaseManager 호환성)
   */
  async getAllUserActivity(): Promise<UserActivity[]> {
    return await this.getAllUserActivities();
  }

  /**
   * 모든 사용자 활동 데이터 조회 (옵션 포함)
   */
  async getAllUserActivities(options: UserActivityQueryOptions = {}): Promise<UserActivity[]> {
    try {
      const {
        limit = 1000,
        offset = 0,
        orderBy = 'total_time',
        orderDirection = 'DESC',
        includeInactive = true,
        minTotalTime = 0,
      } = options;

      let sql = 'SELECT * FROM user_activities WHERE total_time >= ?';
      const params: any[] = [minTotalTime];

      if (!includeInactive) {
        sql += ' AND start_time IS NOT NULL';
      }

      sql += ` ORDER BY ${orderBy} ${orderDirection}`;
      sql += ` LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const startTime = Date.now();
      const rows: UserActivityRow[] = await this.all(sql, params);
      this.updateMetrics(Date.now() - startTime);

      return rows.map((row) => this.convertToUserActivity(row));
    } catch (error) {
      console.error('[SQLite] 전체 사용자 활동 조회 실패:', error);
      return [];
    }
  }

  /**
   * 사용자 활동 업데이트 (호환성 메서드)
   */
  async updateUserActivity(userId: string, totalTimeOrActivity: number | Partial<UserActivity>, startTime?: number | null, displayName?: string | null): Promise<boolean> {
    // 호환성을 위해 여러 시그니처 지원
    if (typeof totalTimeOrActivity === 'number') {
      const activity: Partial<UserActivity> = {
        totalTime: totalTimeOrActivity,
        startTime: startTime !== undefined ? startTime : null,
        ...(displayName !== undefined && displayName !== null && { displayName })
      };
      return await this.updateUserActivityInternal(userId, activity);
    } else {
      return await this.updateUserActivityInternal(userId, totalTimeOrActivity);
    }
  }

  /**
   * 사용자 활동 업데이트 (내부 메서드)
   */
  private async updateUserActivityInternal(userId: string, activity: Partial<UserActivity>): Promise<boolean> {
    try {
      const currentData = await this.getUserActivity(userId);
      const updatedData: UserActivityRow = {
        user_id: userId,
        total_time: activity.totalTime ?? currentData?.totalTime ?? 0,
        start_time: activity.startTime ?? currentData?.startTime ?? null,
        display_name: activity.displayName ?? currentData?.displayName ?? null,
        last_updated: Date.now(),
        created_at: Date.now(),
      };

      const stmt = this.preparedStatements.get('updateUserActivity');
      const startTime = Date.now();

      await this.runWithStatement(stmt!, [
        updatedData.user_id,
        updatedData.total_time,
        updatedData.start_time,
        updatedData.display_name,
        updatedData.last_updated,
      ]);

      this.updateMetrics(Date.now() - startTime);

      // 캐시 무효화
      await this.invalidateCache(`user_activity_${userId}`);

      return true;
    } catch (error) {
      console.error('[SQLite] 사용자 활동 업데이트 실패:', error);
      return false;
    }
  }

  /**
   * 배치 사용자 활동 업데이트 (성능 최적화)
   */
  async batchUpdateUserActivities(
    activities: Array<{ userId: string; activity: Partial<UserActivity> }>
  ): Promise<boolean> {
    if (activities.length === 0) return true;

    try {
      const stmt = this.preparedStatements.get('updateUserActivity');

      const startTime = Date.now();
      await this.run('BEGIN TRANSACTION');

      for (const { userId, activity } of activities) {
        const currentData = await this.getUserActivity(userId);

        await this.runWithStatement(stmt!, [
          userId,
          activity.totalTime ?? currentData?.totalTime ?? 0,
          activity.startTime ?? currentData?.startTime ?? null,
          activity.displayName ?? currentData?.displayName ?? null,
          Date.now(),
        ]);

        // 캐시 무효화
        await this.invalidateCache(`user_activity_${userId}`);
      }

      await this.run('COMMIT');
      this.updateMetrics(Date.now() - startTime);

      console.log(`[SQLite] 배치 사용자 활동 업데이트 완료: ${activities.length}건`);
      return true;
    } catch (error) {
      console.error('[SQLite] 배치 사용자 활동 업데이트 실패:', error);
      await this.run('ROLLBACK');
      return false;
    }
  }

  // ===========================================
  // 활동 로그 관련 메서드들
  // ===========================================

  /**
   * 활동 로그 추가
   */
  async addActivityLog(logEntry: ActivityLogEntry): Promise<boolean> {
    try {
      const stmt = this.preparedStatements.get('insertActivityLog');
      const startTime = Date.now();

      await this.runWithStatement(stmt!, [
        logEntry.userId,
        logEntry.action,
        logEntry.timestamp,
        logEntry.channelId || null,
        logEntry.channelName || null,
        null, // guildId
        logEntry.duration || null,
      ]);

      this.updateMetrics(Date.now() - startTime);
      return true;
    } catch (error) {
      console.error('[SQLite] 활동 로그 추가 실패:', error);
      return false;
    }
  }

  /**
   * 활동 로그 조회
   */
  async getActivityLogs(options: ActivityLogQueryOptions = {}): Promise<ActivityLogEntry[]> {
    try {
      const {
        userId,
        eventType,
        channelId,
        timestampAfter,
        timestampBefore,
        startDate,
        endDate,
        limit = 100,
        offset = 0,
        orderBy = 'timestamp',
        orderDirection = 'DESC',
      } = options;

      let sql = 'SELECT * FROM activity_logs WHERE 1=1';
      const params: any[] = [];

      if (userId) {
        sql += ' AND user_id = ?';
        params.push(userId);
      }

      if (eventType) {
        if (Array.isArray(eventType)) {
          sql += ` AND event_type IN (${eventType.map(() => '?').join(',')})`;
          params.push(...eventType);
        } else {
          sql += ' AND event_type = ?';
          params.push(eventType);
        }
      }

      if (channelId) {
        sql += ' AND channel_id = ?';
        params.push(channelId);
      }

      if (timestampAfter) {
        sql += ' AND timestamp >= ?';
        params.push(timestampAfter);
      }

      if (timestampBefore) {
        sql += ' AND timestamp <= ?';
        params.push(timestampBefore);
      }

      if (startDate) {
        sql += ' AND timestamp >= ?';
        params.push(startDate.getTime());
      }

      if (endDate) {
        sql += ' AND timestamp <= ?';
        params.push(endDate.getTime());
      }

      sql += ` ORDER BY ${orderBy} ${orderDirection}`;
      sql += ` LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const startTime = Date.now();
      const rows: ActivityLogRow[] = await this.all(sql, params);
      this.updateMetrics(Date.now() - startTime);

      return rows.map((row) => this.convertToActivityLogEntry(row));
    } catch (error) {
      console.error('[SQLite] 활동 로그 조회 실패:', error);
      return [];
    }
  }

  // ===========================================
  // AFK 상태 관련 메서드들
  // ===========================================

  /**
   * AFK 상태 조회 (호환성 메서드)
   */
  async getUserAfkStatus(userId: string): Promise<AfkStatus | null> {
    return await this.getAfkStatus(userId);
  }

  /**
   * AFK 상태 조회
   */
  async getAfkStatus(userId: string): Promise<AfkStatus | null> {
    try {
      const startTime = Date.now();
      const row: AfkStatusRow = await this.get('SELECT * FROM afk_status WHERE user_id = ?', [
        userId,
      ]);
      this.updateMetrics(Date.now() - startTime);

      return row ? this.convertToAfkStatus(row) : null;
    } catch (error) {
      console.error('[SQLite] AFK 상태 조회 실패:', error);
      return null;
    }
  }

  /**
   * AFK 상태 업데이트
   */
  async updateAfkStatus(userId: string, afkStatus: Partial<AfkStatus>): Promise<boolean> {
    try {
      const stmt = this.preparedStatements.get('updateAfkStatus');
      const startTime = Date.now();

      await this.runWithStatement(stmt!, [
        userId,
        afkStatus.isAfk ?? false,
        afkStatus.afkStartTime ?? null,
        afkStatus.afkReason ?? null,
        false, // autoAfk
        Date.now(),
      ]);

      this.updateMetrics(Date.now() - startTime);
      return true;
    } catch (error) {
      console.error('[SQLite] AFK 상태 업데이트 실패:', error);
      return false;
    }
  }

  // ===========================================
  // 통계 및 분석 메서드들
  // ===========================================

  /**
   * 활성 사용자 조회 (뷰 사용)
   */
  async getActiveUsers(): Promise<UserActivity[]> {
    const cacheKey = 'active_users';

    // 캐시 확인
    const cached = await this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const startTime = Date.now();
      const rows = await this.all('SELECT * FROM active_users ORDER BY total_time DESC');
      this.updateMetrics(Date.now() - startTime);

      const activeUsers = rows.map((row: any) => ({
        userId: row.user_id,
        totalTime: row.total_time,
        startTime: row.start_time,
        displayName: row.display_name,
        lastUpdate: Date.now(),
      }));

      await this.setCache(cacheKey, activeUsers, this.CACHE_TTL.STATISTICS); // Redis TTL 사용
      return activeUsers;
    } catch (error) {
      console.error('[SQLite] 활성 사용자 조회 실패:', error);
      return [];
    }
  }

  /**
   * 데이터베이스 통계 조회
   */
  async getDatabaseStats(): Promise<any> {
    try {
      if (!this.connection?.db) {
        throw new Error('Database connection not available');
      }
      return await this.initializer.getDatabaseStats(this.connection.db);
    } catch (error) {
      console.error('[SQLite] 데이터베이스 통계 조회 실패:', error);
      return null;
    }
  }

  // ===========================================
  // DatabaseManager 호환성 메서드들
  // ===========================================

  /**
   * 사용자 활동 삭제
   */
  async deleteUserActivity(userId: string): Promise<boolean> {
    try {
      const startTime = Date.now();
      await this.run('DELETE FROM user_activities WHERE user_id = ?', [userId]);
      this.updateMetrics(Date.now() - startTime);
      
      await this.invalidateCache(`user_activity_${userId}`);
      return true;
    } catch (error) {
      console.error('[SQLite] 사용자 활동 삭제 실패:', error);
      return false;
    }
  }

  /**
   * 특정 기간 사용자 활동 시간 조회
   */
  async getUserActivityByDateRange(userId: string, startTime: number, endTime: number): Promise<number> {
    try {
      const sql = `
        SELECT SUM(session_duration) as total_time
        FROM activity_logs 
        WHERE user_id = ? AND timestamp >= ? AND timestamp <= ?
          AND session_duration IS NOT NULL
      `;
      
      const result = await this.get(sql, [userId, startTime, endTime]);
      return result?.total_time || 0;
    } catch (error) {
      console.error('[SQLite] 특정 기간 활동 시간 조회 실패:', error);
      return 0;
    }
  }

  /**
   * 사용자 활동 로그 조회
   */
  async getUserActivityLogs(userId: string, limit: number = 100): Promise<ActivityLogEntry[]> {
    return await this.getActivityLogs({
      userId,
      limit,
      orderBy: 'timestamp',
      orderDirection: 'DESC'
    });
  }

  /**
   * 역할 설정 조회
   */
  async getRoleConfig(roleName: string): Promise<RoleConfig | null> {
    try {
      const startTime = Date.now();
      const row = await this.get('SELECT * FROM role_configs WHERE role_name = ?', [roleName]);
      this.updateMetrics(Date.now() - startTime);

      if (!row) return null;

      const config: RoleConfig = {
        roleName: row.role_name,
        minHours: row.min_hours || 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        resetTime: row.reset_time,
        reportCycle: row.report_cycle || '1',
        enabled: true
      };

      return config;
    } catch (error) {
      console.error('[SQLite] 역할 설정 조회 실패:', error);
      return null;
    }
  }

  /**
   * 모든 역할 설정 조회
   */
  async getAllRoleConfigs(): Promise<RoleConfig[]> {
    try {
      const startTime = Date.now();
      const rows = await this.all('SELECT * FROM role_configs ORDER BY role_name');
      this.updateMetrics(Date.now() - startTime);

      return rows.map(row => ({
        roleName: row.role_name,
        minHours: row.min_hours || 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        resetTime: row.reset_time,
        reportCycle: row.report_cycle || '1',
        enabled: true
      }));
    } catch (error) {
      console.error('[SQLite] 모든 역할 설정 조회 실패:', error);
      return [];
    }
  }

  /**
   * 역할 설정 업데이트
   */
  async updateRoleConfig(roleName: string, minHours: number, resetTime?: number | null, reportCycle: number = 1): Promise<boolean> {
    try {
      const sql = `
        INSERT OR REPLACE INTO role_configs 
        (role_name, min_hours, reset_time, report_cycle, updated_at, created_at) 
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      const now = Date.now();
      await this.run(sql, [roleName, minHours, resetTime, reportCycle.toString(), now, now]);
      
      return true;
    } catch (error) {
      console.error('[SQLite] 역할 설정 업데이트 실패:', error);
      return false;
    }
  }

  /**
   * 역할 보고서 주기 업데이트
   */
  async updateRoleReportCycle(roleName: string, cycle: number): Promise<boolean> {
    try {
      const sql = `
        UPDATE role_configs 
        SET report_cycle = ?, updated_at = ? 
        WHERE role_name = ?
      `;
      
      await this.run(sql, [cycle.toString(), Date.now(), roleName]);
      return true;
    } catch (error) {
      console.error('[SQLite] 역할 보고서 주기 업데이트 실패:', error);
      return false;
    }
  }

  /**
   * 역할 리셋 시간 업데이트
   */
  async updateRoleResetTime(roleName: string, resetTime: number, reason: string = '관리자에 의한 리셋'): Promise<boolean> {
    try {
      const sql = `
        UPDATE role_configs 
        SET reset_time = ?, updated_at = ? 
        WHERE role_name = ?
      `;
      
      await this.run(sql, [resetTime, Date.now(), roleName]);
      
      // 리셋 히스토리 추가
      const historySQL = `
        INSERT INTO reset_history 
        (reset_type, reset_timestamp, admin_user_id, affected_users_count, backup_data, created_at) 
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      await this.run(historySQL, [
        'manual',
        resetTime,
        null,
        null,
        JSON.stringify({ roleName, reason }),
        Date.now()
      ]);
      
      return true;
    } catch (error) {
      console.error('[SQLite] 역할 리셋 시간 업데이트 실패:', error);
      return false;
    }
  }

  /**
   * 다음 보고서 시간 조회
   */
  async getNextReportTime(roleName: string): Promise<number | null> {
    try {
      const roleConfig = await this.getRoleConfig(roleName);
      if (!roleConfig) return null;

      const reportCycle = parseInt(roleConfig.reportCycle || '1');
      const lastResetTime = roleConfig.resetTime || Date.now();

      return lastResetTime + reportCycle * 7 * 24 * 60 * 60 * 1000; // 주 단위
    } catch (error) {
      console.error('[SQLite] 다음 보고서 시간 조회 실패:', error);
      return null;
    }
  }

  /**
   * 일반 활동 로그 기록 (IDatabaseManager 인터페이스 구현)
   */
  async logActivity(action: string, metadata?: Record<string, any>): Promise<boolean> {
    try {
      const logEntry: ActivityLogEntry = {
        userId: metadata?.userId || 'system',
        userName: metadata?.userName || 'System',
        channelId: metadata?.channelId || '',
        channelName: metadata?.channelName || '',
        action: action as any,
        timestamp: Date.now()
      };

      return await this.addActivityLog(logEntry);
    } catch (error) {
      console.error('[SQLite] 활동 로그 기록 실패:', error);
      return false;
    }
  }

  /**
   * 상세 활동 로그 기록 (기존 메서드)
   */
  async logDetailedActivity(userId: string, eventType: string, channelId: string, channelName: string, members: string[] = []): Promise<string> {
    try {
      const logEntry: ActivityLogEntry = {
        userId,
        userName: 'Unknown',
        channelId,
        channelName,
        action: eventType as any,
        timestamp: Date.now()
      };

      const success = await this.addActivityLog(logEntry);
      if (success) {
        const logId = `${logEntry.timestamp}-${userId.slice(0, 6)}`;
        
        // 멤버 정보 저장 (필요시)
        if (members.length > 0) {
          const memberSQL = `
            INSERT INTO log_members (user_id, log_data, created_at, updated_at) 
            VALUES (?, ?, ?, ?)
          `;
          await this.run(memberSQL, [logId, JSON.stringify(members), Date.now(), Date.now()]);
        }
        
        return logId;
      }
      
      throw new Error('Failed to add activity log');
    } catch (error) {
      console.error('[SQLite] 활동 로그 기록 실패:', error);
      throw error;
    }
  }

  /**
   * 일일 활동 통계 조회
   */
  async getDailyActivityStats(startTime: number, endTime: number, _options: any = {}): Promise<any[]> {
    try {
      const sql = `
        SELECT 
          DATE(timestamp/1000, 'unixepoch') as date,
          COUNT(*) as totalEvents,
          SUM(CASE WHEN event_type = 'join' THEN 1 ELSE 0 END) as joins,
          SUM(CASE WHEN event_type = 'leave' THEN 1 ELSE 0 END) as leaves,
          COUNT(DISTINCT user_id) as uniqueUsers
        FROM activity_logs 
        WHERE timestamp >= ? AND timestamp <= ?
        GROUP BY DATE(timestamp/1000, 'unixepoch')
        ORDER BY date
      `;
      
      const rows = await this.all(sql, [startTime, endTime]);
      return rows.map(row => ({
        date: row.date,
        totalEvents: row.totalEvents,
        joins: row.joins,
        leaves: row.leaves,
        uniqueUsers: row.uniqueUsers
      }));
    } catch (error) {
      console.error('[SQLite] 일일 활동 통계 조회 실패:', error);
      return [];
    }
  }

  /**
   * 특정 기간 활성 멤버 조회
   */
  async getActiveMembersForTimeRange(startTime: number, endTime: number): Promise<any[]> {
    try {
      const sql = `
        SELECT 
          ua.user_id as userId,
          ua.display_name as displayName,
          ua.total_time as totalTime
        FROM user_activities ua
        JOIN activity_logs al ON ua.user_id = al.user_id
        WHERE al.timestamp >= ? AND al.timestamp <= ?
        GROUP BY ua.user_id
        ORDER BY ua.total_time DESC
      `;
      
      const rows = await this.all(sql, [startTime, endTime]);
      return rows.map(row => ({
        userId: row.userId,
        displayName: row.displayName || row.userId,
        totalTime: row.totalTime
      }));
    } catch (error) {
      console.error('[SQLite] 활성 멤버 조회 실패:', error);
      return [];
    }
  }

  /**
   * 가장 활성화된 채널 조회
   */
  async getMostActiveChannels(startTime: number, endTime: number, limit: number = 5): Promise<any[]> {
    try {
      const sql = `
        SELECT 
          channel_name as name,
          COUNT(*) as count
        FROM activity_logs
        WHERE timestamp >= ? AND timestamp <= ?
          AND channel_name IS NOT NULL
        GROUP BY channel_name
        ORDER BY count DESC
        LIMIT ?
      `;
      
      const rows = await this.all(sql, [startTime, endTime, limit]);
      return rows;
    } catch (error) {
      console.error('[SQLite] 활성 채널 조회 실패:', error);
      return [];
    }
  }

  /**
   * 모든 AFK 사용자 조회
   */
  async getAllAfkUsers(): Promise<AfkStatus[]> {
    try {
      const startTime = Date.now();
      const rows = await this.all('SELECT * FROM afk_status WHERE is_afk = 1');
      this.updateMetrics(Date.now() - startTime);

      return rows.map(row => this.convertToAfkStatus(row));
    } catch (error) {
      console.error('[SQLite] AFK 사용자 조회 실패:', error);
      return [];
    }
  }

  /**
   * 만료된 AFK 상태 정리
   */
  async clearExpiredAfkStatus(): Promise<string[]> {
    try {
      const now = Date.now();
      
      // 만료된 사용자 찾기
      const expiredRows = await this.all(
        'SELECT user_id FROM afk_status WHERE afk_since IS NOT NULL AND afk_since < ?',
        [now]
      );
      
      const expiredUsers = expiredRows.map(row => row.user_id);
      
      if (expiredUsers.length > 0) {
        // 만료된 사용자들 삭제
        await this.run(
          'DELETE FROM afk_status WHERE afk_since IS NOT NULL AND afk_since < ?',
          [now]
        );
        
        console.log(`[SQLite] ${expiredUsers.length}명의 만료된 AFK 상태 정리 완료`);
      }
      
      return expiredUsers;
    } catch (error) {
      console.error('[SQLite] 만료된 AFK 상태 정리 실패:', error);
      return [];
    }
  }

  /**
   * AFK 상태 설정
   */
  async setUserAfkStatus(userId: string, _displayName: string, untilTimestamp: number): Promise<boolean> {
    try {
      const afkStatus: Partial<AfkStatus> = {
        isAfk: true,
        afkStartTime: Date.now(),
        afkUntil: untilTimestamp
      };
      
      return await this.updateAfkStatus(userId, afkStatus);
    } catch (error) {
      console.error('[SQLite] AFK 상태 설정 실패:', error);
      return false;
    }
  }

  /**
   * AFK 상태 해제
   */
  async clearUserAfkStatus(userId: string): Promise<boolean> {
    try {
      const startTime = Date.now();
      await this.run('DELETE FROM afk_status WHERE user_id = ?', [userId]);
      this.updateMetrics(Date.now() - startTime);
      
      return true;
    } catch (error) {
      console.error('[SQLite] AFK 상태 해제 실패:', error);
      return false;
    }
  }

  /**
   * 포럼 메시지 추적
   */
  async trackForumMessage(threadId: string, messageType: string, messageId: string): Promise<boolean> {
    try {
      const sql = `
        INSERT OR REPLACE INTO forum_messages 
        (message_id, channel_id, user_id, content, message_data, created_at) 
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      await this.run(sql, [
        messageId,
        threadId,
        'system',
        messageType,
        JSON.stringify({ messageType, threadId }),
        Date.now()
      ]);
      
      return true;
    } catch (error) {
      console.error('[SQLite] 포럼 메시지 추적 실패:', error);
      return false;
    }
  }

  /**
   * 추적된 메시지 조회
   */
  async getTrackedMessages(threadId: string, messageType: string): Promise<string[]> {
    try {
      const sql = `
        SELECT message_id FROM forum_messages 
        WHERE channel_id = ? AND content = ?
      `;
      
      const rows = await this.all(sql, [threadId, messageType]);
      return rows.map(row => row.message_id);
    } catch (error) {
      console.error('[SQLite] 추적된 메시지 조회 실패:', error);
      return [];
    }
  }

  /**
   * 추적된 메시지 삭제
   */
  async clearTrackedMessages(threadId: string, messageType: string): Promise<string[]> {
    try {
      const messages = await this.getTrackedMessages(threadId, messageType);
      
      await this.run(
        'DELETE FROM forum_messages WHERE channel_id = ? AND content = ?',
        [threadId, messageType]
      );
      
      return messages;
    } catch (error) {
      console.error('[SQLite] 추적된 메시지 삭제 실패:', error);
      return [];
    }
  }

  /**
   * 스레드의 모든 추적 메시지 삭제
   */
  async clearAllTrackedMessagesForThread(threadId: string): Promise<any> {
    try {
      const allMessages = await this.all(
        'SELECT * FROM forum_messages WHERE channel_id = ?',
        [threadId]
      );
      
      await this.run('DELETE FROM forum_messages WHERE channel_id = ?', [threadId]);
      
      return allMessages.reduce((acc, msg) => {
        if (!acc[msg.content]) acc[msg.content] = [];
        acc[msg.content].push(msg.message_id);
        return acc;
      }, {});
    } catch (error) {
      console.error('[SQLite] 스레드 메시지 삭제 실패:', error);
      return null;
    }
  }

  /**
   * 음성 채널 매핑 저장
   */
  async saveChannelMapping(voiceChannelId: string, forumPostId: string, lastParticipantCount: number = 0): Promise<boolean> {
    try {
      const sql = `
        INSERT OR REPLACE INTO voice_channel_mappings 
        (voice_channel_id, forum_channel_id, mapping_data, created_at, updated_at) 
        VALUES (?, ?, ?, ?, ?)
      `;
      
      const mappingData = {
        forumPostId,
        lastParticipantCount,
        isActive: true
      };
      
      await this.run(sql, [
        voiceChannelId,
        forumPostId,
        JSON.stringify(mappingData),
        Date.now(),
        Date.now()
      ]);
      
      return true;
    } catch (error) {
      console.error('[SQLite] 채널 매핑 저장 실패:', error);
      return false;
    }
  }

  /**
   * 채널 매핑 조회
   */
  async getChannelMapping(voiceChannelId: string): Promise<VoiceChannelMapping | null> {
    try {
      const row = await this.get(
        'SELECT * FROM voice_channel_mappings WHERE voice_channel_id = ?',
        [voiceChannelId]
      );
      
      if (!row) return null;
      
      const mappingData = JSON.parse(row.mapping_data || '{}');
      
      return {
        channelId: voiceChannelId,
        forumPostId: mappingData.forumPostId || row.forum_channel_id,
        threadId: mappingData.forumPostId || row.forum_channel_id,
        createdAt: row.created_at,
        isActive: mappingData.isActive ?? true
      };
    } catch (error) {
      console.error('[SQLite] 채널 매핑 조회 실패:', error);
      return null;
    }
  }

  /**
   * 모든 채널 매핑 조회
   */
  async getAllChannelMappings(): Promise<VoiceChannelMapping[]> {
    try {
      const rows = await this.all('SELECT * FROM voice_channel_mappings');
      
      return rows.map(row => {
        const mappingData = JSON.parse(row.mapping_data || '{}');
        return {
          channelId: row.voice_channel_id,
          forumPostId: mappingData.forumPostId || row.forum_channel_id,
          threadId: mappingData.forumPostId || row.forum_channel_id,
          createdAt: row.created_at,
          isActive: mappingData.isActive ?? true
        };
      });
    } catch (error) {
      console.error('[SQLite] 모든 채널 매핑 조회 실패:', error);
      return [];
    }
  }

  /**
   * 채널 매핑 제거
   */
  async removeChannelMapping(voiceChannelId: string): Promise<boolean> {
    try {
      await this.run('DELETE FROM voice_channel_mappings WHERE voice_channel_id = ?', [voiceChannelId]);
      return true;
    } catch (error) {
      console.error('[SQLite] 채널 매핑 제거 실패:', error);
      return false;
    }
  }

  /**
   * 참여자 수 업데이트
   */
  async updateLastParticipantCount(voiceChannelId: string, participantCount: number): Promise<boolean> {
    try {
      const sql = `
        UPDATE voice_channel_mappings 
        SET mapping_data = json_set(mapping_data, '$.lastParticipantCount', ?),
            updated_at = ?
        WHERE voice_channel_id = ?
      `;
      
      await this.run(sql, [participantCount, Date.now(), voiceChannelId]);
      return true;
    } catch (error) {
      console.error('[SQLite] 참여자 수 업데이트 실패:', error);
      return false;
    }
  }

  /**
   * 포럼 포스트 ID로 음성 채널 ID 찾기
   */
  async getVoiceChannelIdByPostId(forumPostId: string): Promise<string | null> {
    try {
      const row = await this.get(
        'SELECT voice_channel_id FROM voice_channel_mappings WHERE forum_channel_id = ?',
        [forumPostId]
      );
      
      return row?.voice_channel_id || null;
    } catch (error) {
      console.error('[SQLite] 포스트 ID로 채널 ID 조회 실패:', error);
      return null;
    }
  }

  /**
   * 만료된 매핑 정리
   */
  async cleanupExpiredMappings(options: any = {}): Promise<number> {
    try {
      const maxAge = options.maxAge || 7 * 24 * 60 * 60 * 1000; // 7일
      const now = Date.now();
      
      const result = await this.run(
        'DELETE FROM voice_channel_mappings WHERE updated_at < ?',
        [now - maxAge]
      );
      
      return result.changes || 0;
    } catch (error) {
      console.error('[SQLite] 만료된 매핑 정리 실패:', error);
      return 0;
    }
  }

  /**
   * 백업 생성
   */
  async createBackup(): Promise<string> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${this.config.database}.backup.${timestamp}`;
      
      if (this.connection?.db) {
        await this.initializer.createBackup(this.connection.db, backupPath);
      }
      
      return backupPath;
    } catch (error) {
      console.error('[SQLite] 백업 생성 실패:', error);
      throw error;
    }
  }

  /**
   * 데이터 존재 여부 확인
   */
  async hasAnyData(): Promise<boolean> {
    try {
      const result = await this.get('SELECT COUNT(*) as count FROM user_activities');
      return (result?.count || 0) > 0;
    } catch (error) {
      console.error('[SQLite] 데이터 존재 확인 실패:', error);
      return false;
    }
  }

  /**
   * JSON 데이터 마이그레이션
   */
  async migrateFromJSON(_activityData: any, _roleConfigData: any, _options: any = {}): Promise<boolean> {
    try {
      // 기존 마이그레이션 로직 호출
      const { DatabaseMigrator } = await import('../database/migrator.js');
      const migrator = new DatabaseMigrator();
      
      return await migrator.migrate();
    } catch (error) {
      console.error('[SQLite] JSON 마이그레이션 실패:', error);
      return false;
    }
  }

  /**
   * 통계 조회
   */
  async getStats(): Promise<any> {
    try {
      const userCount = await this.get('SELECT COUNT(*) as count FROM user_activities');
      const roleCount = await this.get('SELECT COUNT(*) as count FROM role_configs');
      const logCount = await this.get('SELECT COUNT(*) as count FROM activity_logs');
      const afkCount = await this.get('SELECT COUNT(*) as count FROM afk_status WHERE is_afk = 1');
      const mappingCount = await this.get('SELECT COUNT(*) as count FROM voice_channel_mappings');
      
      return {
        totalUsers: userCount?.count || 0,
        totalRoles: roleCount?.count || 0,
        totalLogs: logCount?.count || 0,
        totalAfkUsers: afkCount?.count || 0,
        totalMappings: mappingCount?.count || 0,
        lastUpdate: new Date()
      };
    } catch (error) {
      console.error('[SQLite] 통계 조회 실패:', error);
      return {
        totalUsers: 0,
        totalRoles: 0,
        totalLogs: 0,
        totalAfkUsers: 0,
        totalMappings: 0,
        lastUpdate: new Date()
      };
    }
  }

  /**
   * 역할 리셋 히스토리 조회
   */
  async getRoleResetHistory(roleName: string, limit: number = 5): Promise<any[]> {
    try {
      const sql = `
        SELECT * FROM reset_history 
        WHERE json_extract(backup_data, '$.roleName') = ?
        ORDER BY reset_timestamp DESC
        LIMIT ?
      `;
      
      const rows = await this.all(sql, [roleName, limit]);
      return rows.map(row => ({
        id: row.id,
        timestamp: row.reset_timestamp,
        reason: JSON.parse(row.backup_data || '{}').reason || 'Unknown',
        data: JSON.parse(row.backup_data || '{}')
      }));
    } catch (error) {
      console.error('[SQLite] 역할 리셋 히스토리 조회 실패:', error);
      return [];
    }
  }

  /**
   * 호환성을 위한 더미 메서드들
   */
  async smartReload(forceReload?: boolean): Promise<void> {
    // SQLite는 항상 최신 데이터를 반환하므로 별도 구현 불필요
    if (forceReload) {
      await this.clearCache();
    }
  }

  async forceReload(): Promise<void> {
    await this.clearCache();
  }

  /**
   * 트랜잭션 시작 (호환성 메서드)
   */
  async beginTransaction(): Promise<boolean> {
    try {
      await this.run('BEGIN TRANSACTION');
      return true;
    } catch (error) {
      console.error('[SQLite] 트랜잭션 시작 실패:', error);
      return false;
    }
  }

  /**
   * 트랜잭션 커밋 (호환성 메서드)
   */
  async commitTransaction(): Promise<boolean> {
    try {
      await this.run('COMMIT');
      return true;
    } catch (error) {
      console.error('[SQLite] 트랜잭션 커밋 실패:', error);
      return false;
    }
  }

  /**
   * 트랜잭션 롤백 (호환성 메서드)
   */
  async rollbackTransaction(): Promise<boolean> {
    try {
      await this.run('ROLLBACK');
      return true;
    } catch (error) {
      console.error('[SQLite] 트랜잭션 롤백 실패:', error);
      return false;
    }
  }

  // ===========================================
  // 성능 모니터링 및 캐싱
  // ===========================================

  /**
   * 캐시에서 데이터 조회 (Redis 우선, 실패시 fallback)
   */
  private async getFromCache(key: string): Promise<any> {
    try {
      // Redis에서 먼저 시도
      if (this.redis.isConnected()) {
        const cached = await this.redis.getJSON(key);
        if (cached !== null) {
          this.metrics.cacheHitRate = this.metrics.cacheHitRate * 0.9 + 1 * 0.1;
          return cached;
        }
      }

      // Redis 실패시 fallback cache 사용
      const cached = this.fallbackCache.get(key);
      if (cached && Date.now() - cached.timestamp < cached.ttl) {
        this.metrics.cacheHitRate = this.metrics.cacheHitRate * 0.9 + 1 * 0.1;
        return cached.data;
      }

      if (cached) {
        this.fallbackCache.delete(key);
      }

      this.metrics.cacheHitRate = this.metrics.cacheHitRate * 0.9;
      return null;
    } catch (error) {
      console.error('[SQLite] 캐시 조회 실패:', error);
      
      // 에러 발생시 fallback cache만 사용
      const cached = this.fallbackCache.get(key);
      if (cached && Date.now() - cached.timestamp < cached.ttl) {
        return cached.data;
      }
      
      return null;
    }
  }

  /**
   * 캐시에 데이터 저장 (Redis 우선, 실패시 fallback)
   */
  private async setCache(key: string, data: any, ttlSeconds: number): Promise<void> {
    try {
      // Redis에 저장 시도
      if (this.redis.isConnected()) {
        await this.redis.setJSON(key, data, ttlSeconds);
      }

      // fallback cache에도 저장
      this.fallbackCache.set(key, {
        data,
        timestamp: Date.now(),
        ttl: ttlSeconds * 1000, // milliseconds로 변환
      });

      // fallback 캐시 크기 제한 (500개로 축소 - Redis가 주 캐시)
      if (this.fallbackCache.size > 500) {
        const oldestKey = this.fallbackCache.keys().next().value;
        if (oldestKey) {
          this.fallbackCache.delete(oldestKey);
        }
      }
    } catch (error) {
      console.error('[SQLite] 캐시 저장 실패:', error);
      
      // 에러 발생시 fallback cache만 사용
      this.fallbackCache.set(key, {
        data,
        timestamp: Date.now(),
        ttl: ttlSeconds * 1000,
      });
    }
  }

  /**
   * 캐시 무효화 (Redis + fallback)
   */
  private async invalidateCache(key: string): Promise<void> {
    try {
      // Redis에서 삭제
      if (this.redis.isConnected()) {
        await this.redis.del(key);
      }

      // fallback cache에서도 삭제
      this.fallbackCache.delete(key);
    } catch (error) {
      console.error('[SQLite] 캐시 무효화 실패:', error);
      
      // 에러 발생시 fallback cache만 삭제
      this.fallbackCache.delete(key);
    }
  }

  /**
   * 성능 메트릭 업데이트
   */
  private updateMetrics(queryTime: number): void {
    this.metrics.queryCount++;
    this.metrics.totalQueryTime += queryTime;
    this.metrics.averageQueryTime = this.metrics.totalQueryTime / this.metrics.queryCount;

    // 느린 쿼리 추적 (100ms 이상)
    if (queryTime > 100) {
      this.metrics.slowQueries.push({
        sql: 'query', // TODO: 실제 SQL 기록
        duration: queryTime,
        timestamp: Date.now(),
      });

      // 최근 10개만 유지
      if (this.metrics.slowQueries.length > 10) {
        this.metrics.slowQueries.shift();
      }
    }
  }

  /**
   * 성능 메트릭 조회
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return {
      ...this.metrics,
      memoryUsage: process.memoryUsage().heapUsed,
    };
  }

  // ===========================================
  // 데이터 변환 헬퍼 메서드들
  // ===========================================

  private convertToUserActivity(row: UserActivityRow): UserActivity {
    return {
      userId: row.user_id,
      totalTime: row.total_time,
      startTime: row.start_time,
      lastUpdate: row.last_updated,
      ...(row.display_name && { displayName: row.display_name }),
    };
  }

  private convertToActivityLogEntry(row: ActivityLogRow): ActivityLogEntry {
    return {
      userId: row.user_id,
      userName: '', // TODO: userName 조회 필요
      action: row.event_type as any,
      timestamp: row.timestamp,
      channelId: row.channel_id || '',
      channelName: row.channel_name || '',
      ...(row.session_duration && { duration: row.session_duration }),
    };
  }

  private convertToAfkStatus(row: AfkStatusRow): AfkStatus {
    return {
      userId: row.user_id,
      isAfk: row.is_afk,
      afkStartTime: row.afk_since,
      totalAfkTime: 0,
      lastUpdate: row.updated_at,
      ...(row.reason && { afkReason: row.reason }),
    };
  }

  // ===========================================
  // SQLite 헬퍼 메서드들
  // ===========================================

  private async run(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.connection!.db.run(sql, params, function (this: sqlite3.RunResult, err: any) {
        if (err) reject(err);
        else resolve({ changes: this.changes, lastID: this.lastID });
      });
    });
  }

  private async get(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.connection!.db.get(sql, params, (err: any, row: any) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  private async all(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.connection!.db.all(sql, params, (err: any, rows: any[]) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  private async prepare(sql: string): Promise<sqlite3.Statement> {
    return new Promise((resolve, reject) => {
      const stmt = this.connection!.db.prepare(sql, (err: any) => {
        if (err) reject(err);
        else resolve(stmt);
      });
    });
  }

  private async runWithStatement(stmt: sqlite3.Statement, params: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      stmt.run(params, function (this: sqlite3.RunResult, err: any) {
        if (err) reject(err);
        else resolve({ changes: this.changes, lastID: this.lastID });
      });
    });
  }

  private async getWithStatement(stmt: sqlite3.Statement, params: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      stmt.get(params, (err: any, row: any) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  /**
   * 연결 종료
   */
  async close(): Promise<void> {
    if (this.connection?.isConnected) {
      // 준비된 쿼리들 정리
      for (const stmt of this.preparedStatements.values()) {
        stmt.finalize();
      }
      this.preparedStatements.clear();

      await this.initializer.close(this.connection.db);
      this.connection.isConnected = false;

      console.log('[SQLite] 데이터베이스 연결 종료');
    }
  }

  // ===========================================
  // IDatabaseManager 인터페이스 구현 메서드들
  // ===========================================

  /**
   * 캐시 클리어 (Redis + fallback)
   */
  async clearCache(): Promise<void> {
    try {
      // Redis 캐시 클리어 (봇 관련 키만)
      if (this.redis.isConnected()) {
        const keys = await this.redis.keys('user_activity_*');
        keys.push(...await this.redis.keys('role_config_*'));
        keys.push(...await this.redis.keys('activity_log_*'));
        keys.push(...await this.redis.keys('active_users'));
        
        for (const key of keys) {
          await this.redis.del(key);
        }
      }

      // fallback cache 클리어
      this.fallbackCache.clear();
      console.log('[SQLite] Redis 및 fallback 캐시가 클리어되었습니다.');
    } catch (error) {
      console.error('[SQLite] 캐시 클리어 실패:', error);
      
      // 에러 발생시 fallback cache만 클리어
      this.fallbackCache.clear();
      console.log('[SQLite] fallback 캐시가 클리어되었습니다.');
    }
  }

  /**
   * 캐시 통계 조회 (Redis + fallback 통합)
   */
  getCacheStats(): { hitRate: number; size: number; maxSize: number } {
    return {
      hitRate: this.metrics.cacheHitRate,
      size: this.fallbackCache.size, // fallback cache 크기 (Redis 크기는 별도 모니터링)
      maxSize: 500 // fallback cache 최대 크기
    };
  }

  /**
   * 헬스 체크
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: Record<string, any> }> {
    try {
      const isConnected = this.connection?.isConnected || false;
      const cacheStats = this.getCacheStats();
      
      if (!isConnected) {
        return {
          status: 'unhealthy',
          details: {
            connected: false,
            error: 'Database connection is not established'
          }
        };
      }

      // 간단한 쿼리로 연결 테스트
      await this.get('SELECT 1');

      return {
        status: 'healthy',
        details: {
          connected: true,
          cacheSize: cacheStats.size,
          cacheHitRate: cacheStats.hitRate,
          queryCount: this.metrics.queryCount,
          averageQueryTime: this.metrics.averageQueryTime
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }
}
