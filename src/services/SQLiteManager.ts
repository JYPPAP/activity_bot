// SQLiteManager - 고성능 SQLite 데이터베이스 매니저

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

import { UserActivity, ActivityLogEntry, AfkStatus } from '../types/index.js';

export class SQLiteManager {
  private connection: DatabaseConnection | null = null;
  private initializer: DatabaseInitializer;
  private config: Required<SQLiteConfig>;

  // 성능 최적화를 위한 캐싱 시스템
  private cache: Map<string, { data: any; timestamp: number; ttl: number }> = new Map();
  private metrics: PerformanceMetrics;

  // 준비된 쿼리 문들 (성능 최적화)
  private preparedStatements: Map<string, sqlite3.Statement> = new Map();

  constructor(config: Partial<SQLiteConfig> = {}) {
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
    const cached = this.getFromCache(cacheKey);
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
        this.setCache(cacheKey, row, 30000); // 30초 캐시
        return userActivity;
      }

      return null;
    } catch (error) {
      console.error('[SQLite] 사용자 활동 조회 실패:', error);
      return null;
    }
  }

  /**
   * 모든 사용자 활동 데이터 조회
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
   * 사용자 활동 업데이트
   */
  async updateUserActivity(userId: string, activity: Partial<UserActivity>): Promise<boolean> {
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
      this.invalidateCache(`user_activity_${userId}`);

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
        this.invalidateCache(`user_activity_${userId}`);
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

    // 캐시 확인 (5초 TTL)
    const cached = this.getFromCache(cacheKey);
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

      this.setCache(cacheKey, activeUsers, 5000); // 5초 캐시
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
  // 성능 모니터링 및 캐싱
  // ===========================================

  /**
   * 캐시에서 데이터 조회
   */
  private getFromCache(key: string): any {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      this.metrics.cacheHitRate = this.metrics.cacheHitRate * 0.9 + 1 * 0.1;
      return cached.data;
    }

    if (cached) {
      this.cache.delete(key);
    }

    this.metrics.cacheHitRate = this.metrics.cacheHitRate * 0.9;
    return null;
  }

  /**
   * 캐시에 데이터 저장
   */
  private setCache(key: string, data: any, ttl: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });

    // 캐시 크기 제한 (1000개)
    if (this.cache.size > 1000) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
  }

  /**
   * 캐시 무효화
   */
  private invalidateCache(key: string): void {
    this.cache.delete(key);
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
}
