// src/services/DatabaseManager.ts - LowDB 버전 (TypeScript)
import low from 'lowdb';
import FileSync from 'lowdb/adapters/FileSync.js';
import path from 'path';
import { DatabaseSchema, DatabaseConfig } from '../types/database.js';
import { 
  UserActivity, 
  RoleConfig, 
  ActivityLogEntry, 
  AfkStatus,
  ForumMessageData,
  VoiceChannelMapping,
  ResetHistoryEntry,
  DatabaseManager as IDatabaseManager
} from '../types/index.js';

// ====================
// 메서드 옵션 타입
// ====================

export interface CacheOptions {
  forceReload?: boolean;
  timeout?: number;
}

export interface ActivityLogOptions {
  eventType?: string;
  limit?: number;
  sortBy?: 'timestamp' | 'userId';
  sortOrder?: 'asc' | 'desc';
}

export interface StatsOptions {
  groupBy?: 'day' | 'week' | 'month';
  includeInactive?: boolean;
  minActivityTime?: number;
}

export interface MigrationOptions {
  validateData?: boolean;
  createBackup?: boolean;
  skipErrors?: boolean;
}

export interface CleanupOptions {
  maxAge?: number;
  dryRun?: boolean;
  verbose?: boolean;
}

// ====================
// 통계 데이터 타입
// ====================

export interface DailyActivityStats {
  date: string;
  totalEvents: number;
  joins: number;
  leaves: number;
  uniqueUsers: number;
}

export interface ActiveMember {
  userId: string;
  displayName: string;
  totalTime: number;
}

export interface ChannelActivity {
  name: string;
  count: number;
}

export interface DatabaseStats {
  totalUsers: number;
  totalRoles: number;
  totalLogs: number;
  totalAfkUsers: number;
  totalMappings: number;
  lastUpdate: Date;
}

// ====================
// 데이터베이스 매니저 클래스
// ====================

export class DatabaseManager implements IDatabaseManager {
  private readonly dbPath: string;
  private readonly adapter: any; // lowdb v1 타입 호환성을 위해 any 사용
  private readonly db: any; // lowdb v1 타입 호환성을 위해 any 사용
  
  // 캐싱 시스템
  private readonly cache: Map<string, any> = new Map();
  private readonly cacheTimeout: number = 30000; // 30초
  private lastCacheTime: number = 0;
  
  // 설정
  private readonly config: DatabaseConfig;

  constructor(config: DatabaseConfig = {}) {
    this.config = {
      path: config.path || path.join(process.cwd(), 'activity_bot.json'),
      cacheTimeout: config.cacheTimeout || 30000,
      autoBackup: config.autoBackup ?? true,
      backupInterval: config.backupInterval || 3600000, // 1시간
      maxBackups: config.maxBackups || 5,
      validation: config.validation ?? true,
      ...config
    };

    this.dbPath = this.config.path!;
    this.adapter = new FileSync(this.dbPath);
    this.db = low(this.adapter);

    // 기본 데이터베이스 구조 설정
    this.initializeDatabase();
  }

  /**
   * 데이터베이스 초기화
   */
  private initializeDatabase(): void {
    const defaults: DatabaseSchema = {
      user_activity: {},
      role_config: {},
      activity_logs: [],
      reset_history: [],
      log_members: {},
      afk_status: {},
      forum_messages: {},
      voice_channel_mappings: {},
      metadata: {
        version: '1.0.0',
        created_at: Date.now(),
        last_updated: Date.now()
      }
    };

    this.db.defaults(defaults).write();
  }

  /**
   * 데이터베이스 연결 및 초기화
   */
  async initialize(): Promise<boolean> {
    try {
      // 메타데이터 업데이트
      this.db.get('metadata')
        .assign({ last_updated: Date.now() })
        .write();

      console.log(`[DB] LowDB 데이터베이스가 ${this.dbPath}에 연결되었습니다.`);
      
      // 자동 백업 활성화
      if (this.config.autoBackup) {
        this.scheduleBackup();
      }

      return true;
    } catch (error) {
      console.error('[DB] 데이터베이스 초기화 오류:', error);
      return false;
    }
  }

  /**
   * 스마트 캐싱 시스템
   */
  private smartReload(options: CacheOptions = {}): void {
    const { forceReload = false, timeout = this.cacheTimeout } = options;
    const now = Date.now();
    
    if (forceReload || (now - this.lastCacheTime) > timeout) {
      try {
        this.db.read();
        this.lastCacheTime = now;
        this.cache.clear();
        
        // 메타데이터 업데이트
        this.db.get('metadata')
          .assign({ last_updated: now })
          .write();
      } catch (error) {
        console.error('[DB] 데이터 새로고침 실패:', error);
      }
    }
  }

  /**
   * 캐시된 데이터 가져오기
   */
  private getCached<T>(key: string, getter: () => T): T {
    this.smartReload();
    
    if (this.cache.has(key)) {
      return this.cache.get(key) as T;
    }
    
    const data = getter();
    this.cache.set(key, data);
    return data;
  }

  /**
   * 쓰기 작업 시 캐시 무효화
   */
  private invalidateCache(): void {
    this.cache.clear();
    this.smartReload({ forceReload: true });
  }

  /**
   * 강제 데이터 새로고침
   */
  forceReload(): void {
    this.smartReload({ forceReload: true });
  }

  /**
   * 데이터베이스 내 데이터 존재 확인
   */
  async hasAnyData(): Promise<boolean> {
    const userActivity = this.db.get('user_activity').value();
    return Object.keys(userActivity).length > 0;
  }

  /**
   * 데이터베이스 통계 조회
   */
  async getStats(): Promise<DatabaseStats> {
    this.smartReload();
    
    const userActivity = this.db.get('user_activity').value();
    const roleConfig = this.db.get('role_config').value();
    const activityLogs = this.db.get('activity_logs').value();
    const afkStatus = this.db.get('afk_status').value();
    const mappings = this.db.get('voice_channel_mappings').value();
    const metadata = this.db.get('metadata').value();

    return {
      totalUsers: Object.keys(userActivity).length,
      totalRoles: Object.keys(roleConfig).length,
      totalLogs: activityLogs.length,
      totalAfkUsers: Object.keys(afkStatus).length,
      totalMappings: Object.keys(mappings).length,
      lastUpdate: new Date(metadata.last_updated)
    };
  }

  /**
   * 데이터베이스 연결 종료
   */
  async close(): Promise<boolean> {
    try {
      this.cache.clear();
      console.log('[DB] 데이터베이스 연결이 종료되었습니다.');
      return true;
    } catch (error) {
      console.error('[DB] 데이터베이스 종료 오류:', error);
      return false;
    }
  }

  /**
   * 트랜잭션 시작 (LowDB 호환성)
   */
  async beginTransaction(): Promise<boolean> {
    return true;
  }

  /**
   * 트랜잭션 커밋 (LowDB 호환성)
   */
  async commitTransaction(): Promise<boolean> {
    return true;
  }

  /**
   * 트랜잭션 롤백 (LowDB 호환성)
   */
  async rollbackTransaction(): Promise<boolean> {
    return true;
  }

  // ======== 사용자 활동 관련 메서드 ========

  /**
   * 사용자 활동 데이터 가져오기
   */
  async getUserActivity(userId: string): Promise<UserActivity | null> {
    if (!userId) return null;

    return this.getCached(`user_activity_${userId}`, () => {
      const activity = this.db.get('user_activity').get(userId).value();
      return activity || null;
    });
  }

  /**
   * 사용자 활동 데이터 업데이트/삽입
   */
  async updateUserActivity(
    userId: string,
    totalTime: number,
    startTime: number | null = null,
    displayName: string | null = null
  ): Promise<boolean> {
    if (!userId) return false;

    try {
      this.invalidateCache();
      
      const activityData: UserActivity = {
        userId,
        totalTime,
        startTime,
        displayName
      };

      this.db.get('user_activity')
        .set(userId, activityData)
        .write();

      return true;
    } catch (error) {
      console.error('[DB] 사용자 활동 업데이트 오류:', error);
      return false;
    }
  }

  /**
   * 모든 사용자 활동 데이터 가져오기
   */
  async getAllUserActivity(): Promise<UserActivity[]> {
    return this.getCached('all_user_activity', () => {
      const activities = this.db.get('user_activity').value();
      return Object.values(activities);
    });
  }

  /**
   * 특정 역할을 가진 사용자들의 활동 데이터 가져오기
   */
  async getUserActivityByRole(
    roleId: string,
    startTime?: number,
    endTime?: number
  ): Promise<UserActivity[]> {
    // 현재 LowDB 구조에서는 역할별 필터링이 제한적
    // 모든 사용자 활동을 반환하고 상위 레벨에서 필터링
    return await this.getAllUserActivity();
  }

  /**
   * 사용자 활동 데이터 삭제
   */
  async deleteUserActivity(userId: string): Promise<boolean> {
    if (!userId) return false;

    try {
      this.invalidateCache();
      this.db.get('user_activity').unset(userId).write();
      return true;
    } catch (error) {
      console.error('[DB] 사용자 활동 삭제 오류:', error);
      return false;
    }
  }

  // ======== 역할 설정 관련 메서드 ========

  /**
   * 역할 설정 가져오기
   */
  async getRoleConfig(roleName: string): Promise<RoleConfig | null> {
    if (!roleName) return null;

    return this.getCached(`role_config_${roleName}`, () => {
      const config = this.db.get('role_config').get(roleName).value();
      return config || null;
    });
  }

  /**
   * 역할 설정 업데이트/삽입
   */
  async updateRoleConfig(
    roleName: string,
    minHours: number,
    resetTime: number | null = null,
    reportCycle: number = 1
  ): Promise<boolean> {
    if (!roleName || minHours < 0) return false;

    try {
      this.invalidateCache();
      
      const configData: RoleConfig = {
        roleName,
        minHours,
        resetTime,
        reportCycle
      };

      this.db.get('role_config')
        .set(roleName, configData)
        .write();

      return true;
    } catch (error) {
      console.error('[DB] 역할 설정 업데이트 오류:', error);
      return false;
    }
  }

  /**
   * 모든 역할 설정 가져오기
   */
  async getAllRoleConfigs(): Promise<RoleConfig[]> {
    return this.getCached('all_role_configs', () => {
      const configs = this.db.get('role_config').value();
      return Object.values(configs);
    });
  }

  /**
   * 역할 리셋 시간 업데이트
   */
  async updateRoleResetTime(
    roleName: string,
    resetTime: number,
    reason: string = '관리자에 의한 리셋'
  ): Promise<boolean> {
    if (!roleName) return false;

    try {
      this.invalidateCache();
      
      const roleConfig = await this.getRoleConfig(roleName);
      if (roleConfig) {
        await this.updateRoleConfig(roleName, roleConfig.minHours, resetTime, roleConfig.reportCycle);
      } else {
        await this.updateRoleConfig(roleName, 0, resetTime);
      }

      // 리셋 이력 기록
      const historyEntry: ResetHistoryEntry = {
        id: Date.now(),
        roleName,
        resetTime,
        reason
      };

      this.db.get('reset_history')
        .push(historyEntry)
        .write();

      return true;
    } catch (error) {
      console.error('[DB] 역할 리셋 시간 업데이트 오류:', error);
      return false;
    }
  }

  /**
   * 역할 리셋 이력 가져오기
   */
  async getRoleResetHistory(roleName: string, limit: number = 5): Promise<ResetHistoryEntry[]> {
    if (!roleName) return [];

    return this.getCached(`reset_history_${roleName}`, () => {
      return this.db.get('reset_history')
        .filter({ roleName })
        .sortBy('resetTime')
        .reverse()
        .take(limit)
        .value();
    });
  }

  // ======== 활동 로그 관련 메서드 ========

  /**
   * 활동 로그 기록하기
   */
  async logActivity(
    userId: string,
    eventType: string,
    channelId: string,
    channelName: string,
    members: string[] = []
  ): Promise<string> {
    if (!userId || !eventType || !channelId) {
      throw new Error('필수 파라미터가 누락되었습니다.');
    }

    try {
      this.invalidateCache();
      const timestamp = Date.now();
      const logId = `${timestamp}-${userId.slice(0, 6)}`;

      const logEntry: ActivityLogEntry = {
        id: logId,
        userId,
        eventType,
        channelId,
        channelName,
        timestamp,
        membersCount: members.length
      };

      this.db.get('activity_logs')
        .push(logEntry)
        .write();

      // 멤버 목록 저장
      if (members.length > 0) {
        this.db.set(`log_members.${logId}`, members).write();
      }

      return logId;
    } catch (error) {
      console.error('[DB] 활동 로그 기록 오류:', error);
      throw error;
    }
  }

  /**
   * 특정 기간의 활동 로그 가져오기
   */
  async getActivityLogs(
    startTime: number,
    endTime: number,
    options: ActivityLogOptions = {}
  ): Promise<ActivityLogEntry[]> {
    const { eventType, limit, sortBy = 'timestamp', sortOrder = 'desc' } = options;

    try {
      this.smartReload();
      
      let query = this.db.get('activity_logs')
        .filter(log => log.timestamp >= startTime && log.timestamp <= endTime);

      if (eventType) {
        query = query.filter({ eventType });
      }

      let logs = query.sortBy(sortBy).value();
      
      if (sortOrder === 'desc') {
        logs = logs.reverse();
      }

      if (limit) {
        logs = logs.slice(0, limit);
      }

      // 멤버 정보 추가
      return logs.map(log => {
        const members = this.db.get(`log_members.${log.id}`).value() || [];
        return { ...log, members };
      });
    } catch (error) {
      console.error('[DB] 활동 로그 조회 오류:', error);
      return [];
    }
  }

  /**
   * 특정 사용자의 활동 로그 가져오기
   */
  async getUserActivityLogs(userId: string, limit: number = 100): Promise<ActivityLogEntry[]> {
    if (!userId) return [];

    try {
      this.smartReload();
      
      const logs = this.db.get('activity_logs')
        .filter({ userId })
        .sortBy('timestamp')
        .reverse()
        .take(limit)
        .value();

      return logs.map(log => {
        const members = this.db.get(`log_members.${log.id}`).value() || [];
        return { ...log, members };
      });
    } catch (error) {
      console.error('[DB] 사용자 활동 로그 조회 오류:', error);
      return [];
    }
  }

  /**
   * 날짜별 활동 통계 가져오기
   */
  async getDailyActivityStats(
    startTime: number,
    endTime: number,
    options: StatsOptions = {}
  ): Promise<DailyActivityStats[]> {
    try {
      this.smartReload();
      
      const logs = this.db.get('activity_logs')
        .filter(log => log.timestamp >= startTime && log.timestamp <= endTime)
        .value();

      const dailyStats: { [key: string]: DailyActivityStats } = {};

      logs.forEach(log => {
        const date = new Date(log.timestamp);
        const dateStr = date.toISOString().split('T')[0];

        if (!dailyStats[dateStr]) {
          dailyStats[dateStr] = {
            date: dateStr,
            totalEvents: 0,
            joins: 0,
            leaves: 0,
            uniqueUsers: 0
          };
        }

        dailyStats[dateStr].totalEvents++;

        if (log.eventType === 'JOIN') {
          dailyStats[dateStr].joins++;
        } else if (log.eventType === 'LEAVE') {
          dailyStats[dateStr].leaves++;
        }
      });

      // 고유 사용자 수 계산
      Object.keys(dailyStats).forEach(dateStr => {
        const dayLogs = logs.filter(log => {
          const logDate = new Date(log.timestamp).toISOString().split('T')[0];
          return logDate === dateStr;
        });
        
        const uniqueUsers = new Set(dayLogs.map(log => log.userId));
        dailyStats[dateStr].uniqueUsers = uniqueUsers.size;
      });

      return Object.values(dailyStats);
    } catch (error) {
      console.error('[DB] 날짜별 활동 통계 조회 오류:', error);
      return [];
    }
  }

  /**
   * 특정 기간 동안의 사용자 활동 시간 조회
   */
  async getUserActivityByDateRange(
    userId: string,
    startTime: number,
    endTime: number
  ): Promise<number> {
    if (!userId) return 0;

    try {
      this.smartReload();
      
      const logs = this.db.get('activity_logs')
        .filter(log => 
          log.userId === userId && 
          log.timestamp >= startTime && 
          log.timestamp <= endTime
        )
        .value();

      let totalTime = 0;
      let joinTime: number | null = null;

      for (const log of logs) {
        if (log.eventType === 'JOIN') {
          joinTime = log.timestamp;
        } else if (log.eventType === 'LEAVE' && joinTime) {
          totalTime += log.timestamp - joinTime;
          joinTime = null;
        }
      }

      // 아직 나가지 않은 경우 현재 시간까지 계산
      if (joinTime) {
        totalTime += Math.min(endTime, Date.now()) - joinTime;
      }

      return totalTime;
    } catch (error) {
      console.error('[DB] 특정 기간 활동 시간 조회 오류:', error);
      return 0;
    }
  }

  /**
   * 특정 기간의 활동 멤버 목록 가져오기
   */
  async getActiveMembersForTimeRange(
    startTime: number,
    endTime: number
  ): Promise<ActiveMember[]> {
    try {
      this.smartReload();
      
      const logs = this.db.get('activity_logs')
        .filter(log => log.timestamp >= startTime && log.timestamp <= endTime)
        .value();

      const userIds = [...new Set(logs.map(log => log.userId))];
      const activeMembers: ActiveMember[] = [];

      for (const userId of userIds) {
        const userActivity = this.db.get('user_activity').get(userId).value();
        if (userActivity) {
          activeMembers.push({
            userId,
            displayName: userActivity.displayName || userId,
            totalTime: userActivity.totalTime || 0
          });
        }
      }

      return activeMembers;
    } catch (error) {
      console.error('[DB] 활동 멤버 조회 오류:', error);
      return [];
    }
  }

  /**
   * 가장 활동적인 채널 조회
   */
  async getMostActiveChannels(
    startTime: number,
    endTime: number,
    limit: number = 5
  ): Promise<ChannelActivity[]> {
    try {
      this.smartReload();
      
      const logs = this.db.get('activity_logs')
        .filter(log => log.timestamp >= startTime && log.timestamp <= endTime)
        .value();

      const channelCounts: { [key: string]: number } = {};
      
      logs.forEach(log => {
        if (!channelCounts[log.channelName]) {
          channelCounts[log.channelName] = 0;
        }
        channelCounts[log.channelName]++;
      });

      return Object.entries(channelCounts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
    } catch (error) {
      console.error('[DB] 활동적인 채널 조회 오류:', error);
      return [];
    }
  }

  /**
   * 역할 보고서 주기 업데이트
   */
  async updateRoleReportCycle(roleName: string, reportCycle: number): Promise<boolean> {
    if (!roleName || reportCycle < 1) return false;

    try {
      const roleConfig = await this.getRoleConfig(roleName);
      if (roleConfig) {
        await this.updateRoleConfig(
          roleName,
          roleConfig.minHours,
          roleConfig.resetTime,
          reportCycle
        );
        return true;
      }
      return false;
    } catch (error) {
      console.error('[DB] 역할 보고서 주기 업데이트 오류:', error);
      return false;
    }
  }

  /**
   * 역할별 다음 보고서 예정 시간 확인
   */
  async getNextReportTime(roleName: string): Promise<number | null> {
    if (!roleName) return null;

    try {
      const roleConfig = await this.getRoleConfig(roleName);
      if (!roleConfig) return null;

      const reportCycle = roleConfig.reportCycle || 1;
      const lastResetTime = roleConfig.resetTime || Date.now();

      return lastResetTime + (reportCycle * 7 * 24 * 60 * 60 * 1000);
    } catch (error) {
      console.error('[DB] 다음 보고서 시간 조회 오류:', error);
      return null;
    }
  }

  // ======== 잠수 상태 관리 메서드 ========

  /**
   * 사용자의 잠수 상태 설정
   */
  async setUserAfkStatus(
    userId: string,
    displayName: string,
    untilTimestamp: number
  ): Promise<boolean> {
    if (!userId || !untilTimestamp) return false;

    try {
      this.invalidateCache();

      const afkData: AfkStatus = {
        userId,
        displayName,
        afkUntil: untilTimestamp,
        createdAt: Date.now()
      };

      this.db.get('afk_status')
        .set(userId, afkData)
        .write();

      console.log(`[DB] 잠수 상태 설정: ${userId}, until: ${new Date(untilTimestamp).toISOString()}`);
      return true;
    } catch (error) {
      console.error('[DB] 잠수 상태 설정 오류:', error);
      return false;
    }
  }

  /**
   * 사용자의 잠수 상태 확인
   */
  async getUserAfkStatus(userId: string): Promise<AfkStatus | null> {
    if (!userId) return null;

    try {
      this.smartReload();

      const afkData = this.db.get('afk_status').get(userId).value();
      console.log(`[DB] 잠수 상태 조회: ${userId}, 결과:`, afkData);

      if (!afkData || !afkData.afkUntil) {
        return null;
      }

      return afkData;
    } catch (error) {
      console.error('[DB] 잠수 상태 조회 오류:', error);
      return null;
    }
  }

  /**
   * 사용자의 잠수 상태 해제
   */
  async clearUserAfkStatus(userId: string): Promise<boolean> {
    if (!userId) return false;

    try {
      this.invalidateCache();
      this.db.get('afk_status').unset(userId).write();
      
      console.log(`[DB] 잠수 상태 해제: ${userId}`);
      return true;
    } catch (error) {
      console.error('[DB] 잠수 상태 해제 오류:', error);
      return false;
    }
  }

  /**
   * 모든 잠수 사용자 조회
   */
  async getAllAfkUsers(): Promise<AfkStatus[]> {
    try {
      this.smartReload();

      const afkData = this.db.get('afk_status').value();
      const afkUsers: AfkStatus[] = [];

      for (const [userId, data] of Object.entries(afkData)) {
        if (data.afkUntil) {
          afkUsers.push(data);
        }
      }

      return afkUsers;
    } catch (error) {
      console.error('[DB] 잠수 사용자 조회 오류:', error);
      return [];
    }
  }

  /**
   * 만료된 잠수 상태 확인 및 해제
   */
  async clearExpiredAfkStatus(): Promise<string[]> {
    try {
      this.smartReload();

      const now = Date.now();
      const afkData = this.db.get('afk_status').value();
      const clearedUsers: string[] = [];

      for (const [userId, data] of Object.entries(afkData)) {
        if (data.afkUntil && data.afkUntil < now) {
          this.db.get('afk_status').unset(userId).write();
          clearedUsers.push(userId);
          console.log(`[DB] 잠수 상태 만료 해제: ${userId}`);
        }
      }

      return clearedUsers;
    } catch (error) {
      console.error('[DB] 잠수 상태 만료 처리 오류:', error);
      return [];
    }
  }

  // ======== 포럼 메시지 추적 관련 메서드 ========

  /**
   * 포럼 메시지 ID 추적 저장
   */
  async trackForumMessage(
    threadId: string,
    messageType: string,
    messageId: string
  ): Promise<boolean> {
    if (!threadId || !messageType || !messageId) return false;

    try {
      this.invalidateCache();
      
      const threadData = this.db.get('forum_messages').get(threadId).value() || {};
      
      if (!threadData[messageType]) {
        threadData[messageType] = [];
      }
      
      if (!threadData[messageType].includes(messageId)) {
        threadData[messageType].push(messageId);
      }
      
      this.db.get('forum_messages').set(threadId, threadData).write();
      
      console.log(`[DB] 포럼 메시지 추적 저장: ${threadId}, ${messageType}, ${messageId}`);
      return true;
    } catch (error) {
      console.error('[DB] 포럼 메시지 추적 저장 오류:', error);
      return false;
    }
  }

  /**
   * 특정 스레드의 추적된 메시지 ID들 가져오기
   */
  async getTrackedMessages(threadId: string, messageType: string): Promise<string[]> {
    if (!threadId || !messageType) return [];

    try {
      this.smartReload();
      
      const threadData = this.db.get('forum_messages').get(threadId).value();
      if (!threadData || !threadData[messageType]) {
        return [];
      }
      
      return threadData[messageType] || [];
    } catch (error) {
      console.error('[DB] 추적된 메시지 조회 오류:', error);
      return [];
    }
  }

  /**
   * 특정 스레드의 특정 타입 메시지 추적 정보 삭제
   */
  async clearTrackedMessages(threadId: string, messageType: string): Promise<string[]> {
    if (!threadId || !messageType) return [];

    try {
      this.invalidateCache();
      
      const threadData = this.db.get('forum_messages').get(threadId).value();
      if (!threadData || !threadData[messageType]) {
        return [];
      }
      
      const messageIds = threadData[messageType] || [];
      delete threadData[messageType];
      
      if (Object.keys(threadData).length === 0) {
        this.db.get('forum_messages').unset(threadId).write();
      } else {
        this.db.get('forum_messages').set(threadId, threadData).write();
      }
      
      console.log(`[DB] 추적된 메시지 삭제: ${threadId}, ${messageType}, ${messageIds.length}개`);
      return messageIds;
    } catch (error) {
      console.error('[DB] 추적된 메시지 삭제 오류:', error);
      return [];
    }
  }

  /**
   * 모든 포럼 메시지 추적 정보 삭제 (스레드 단위)
   */
  async clearAllTrackedMessagesForThread(threadId: string): Promise<ForumMessageData> {
    if (!threadId) return {};

    try {
      this.invalidateCache();
      
      const threadData = this.db.get('forum_messages').get(threadId).value();
      if (!threadData) {
        return {};
      }
      
      this.db.get('forum_messages').unset(threadId).write();
      
      console.log(`[DB] 스레드의 모든 추적 메시지 삭제: ${threadId}`);
      return threadData;
    } catch (error) {
      console.error('[DB] 스레드 메시지 추적 정보 삭제 오류:', error);
      return {};
    }
  }

  // ======== 음성 채널 매핑 관련 메서드 ========

  /**
   * 음성 채널-포럼 포스트 매핑 저장
   */
  async saveChannelMapping(
    voiceChannelId: string,
    forumPostId: string,
    lastParticipantCount: number = 0
  ): Promise<boolean> {
    if (!voiceChannelId || !forumPostId) return false;

    try {
      this.invalidateCache();
      
      const now = Date.now();
      const mappingData: VoiceChannelMapping = {
        voice_channel_id: voiceChannelId,
        forum_post_id: forumPostId,
        created_at: now,
        last_updated: now,
        last_participant_count: lastParticipantCount
      };
      
      this.db.get('voice_channel_mappings')
        .set(voiceChannelId, mappingData)
        .write();
      
      console.log(`[DB] 채널 매핑 저장: ${voiceChannelId} -> ${forumPostId}`);
      return true;
    } catch (error) {
      console.error('[DB] 채널 매핑 저장 오류:', error);
      return false;
    }
  }

  /**
   * 음성 채널 매핑 정보 가져오기
   */
  async getChannelMapping(voiceChannelId: string): Promise<VoiceChannelMapping | null> {
    if (!voiceChannelId) return null;

    try {
      this.smartReload();
      
      const mappingData = this.db.get('voice_channel_mappings').get(voiceChannelId).value();
      return mappingData || null;
    } catch (error) {
      console.error('[DB] 채널 매핑 조회 오류:', error);
      return null;
    }
  }

  /**
   * 모든 음성 채널 매핑 가져오기
   */
  async getAllChannelMappings(): Promise<VoiceChannelMapping[]> {
    try {
      this.smartReload();
      
      const mappings = this.db.get('voice_channel_mappings').value();
      return Object.values(mappings);
    } catch (error) {
      console.error('[DB] 모든 채널 매핑 조회 오류:', error);
      return [];
    }
  }

  /**
   * 음성 채널 매핑 제거
   */
  async removeChannelMapping(voiceChannelId: string): Promise<boolean> {
    if (!voiceChannelId) return false;

    try {
      this.invalidateCache();
      
      const existed = this.db.get('voice_channel_mappings').has(voiceChannelId).value();
      if (!existed) {
        return false;
      }
      
      this.db.get('voice_channel_mappings').unset(voiceChannelId).write();
      
      console.log(`[DB] 채널 매핑 제거: ${voiceChannelId}`);
      return true;
    } catch (error) {
      console.error('[DB] 채널 매핑 제거 오류:', error);
      return false;
    }
  }

  /**
   * 마지막 참여자 수 업데이트
   */
  async updateLastParticipantCount(
    voiceChannelId: string,
    participantCount: number
  ): Promise<boolean> {
    if (!voiceChannelId || participantCount < 0) return false;

    try {
      this.invalidateCache();
      
      const mappingData = this.db.get('voice_channel_mappings').get(voiceChannelId).value();
      if (!mappingData) {
        console.log(`[DB] 매핑을 찾을 수 없음: ${voiceChannelId}`);
        return false;
      }
      
      mappingData.last_participant_count = participantCount;
      mappingData.last_updated = Date.now();
      
      this.db.get('voice_channel_mappings')
        .set(voiceChannelId, mappingData)
        .write();
      
      console.log(`[DB] 참여자 수 업데이트: ${voiceChannelId} -> ${participantCount}`);
      return true;
    } catch (error) {
      console.error('[DB] 참여자 수 업데이트 오류:', error);
      return false;
    }
  }

  /**
   * 포럼 포스트 ID로 음성 채널 ID 찾기
   */
  async getVoiceChannelIdByPostId(forumPostId: string): Promise<string | null> {
    if (!forumPostId) return null;

    try {
      this.smartReload();
      
      const mappings = this.db.get('voice_channel_mappings').value();
      
      for (const [channelId, data] of Object.entries(mappings)) {
        if (data.forum_post_id === forumPostId) {
          return channelId;
        }
      }
      
      return null;
    } catch (error) {
      console.error('[DB] 포스트 ID로 채널 ID 조회 오류:', error);
      return null;
    }
  }

  /**
   * 만료된 매핑 정리
   */
  async cleanupExpiredMappings(
    options: CleanupOptions = {}
  ): Promise<number> {
    const { 
      maxAge = 7 * 24 * 60 * 60 * 1000, // 7일
      dryRun = false,
      verbose = false
    } = options;

    try {
      this.smartReload();
      
      const now = Date.now();
      const mappings = this.db.get('voice_channel_mappings').value();
      let cleanedCount = 0;
      
      for (const [channelId, data] of Object.entries(mappings)) {
        if (data.last_updated && (now - data.last_updated) > maxAge) {
          if (!dryRun) {
            this.db.get('voice_channel_mappings').unset(channelId).write();
          }
          cleanedCount++;
          
          if (verbose) {
            const daysPassed = Math.round((now - data.last_updated) / (24 * 60 * 60 * 1000));
            console.log(`[DB] ${dryRun ? '(DRY RUN) ' : ''}만료된 매핑 제거: ${channelId} (${daysPassed}일 경과)`);
          }
        }
      }
      
      if (cleanedCount > 0 && verbose) {
        console.log(`[DB] ${dryRun ? '(DRY RUN) ' : ''}만료된 매핑 정리 완료: ${cleanedCount}개 제거`);
      }
      
      return cleanedCount;
    } catch (error) {
      console.error('[DB] 만료된 매핑 정리 오류:', error);
      return 0;
    }
  }

  // ======== 마이그레이션 관련 메서드 ========

  /**
   * JSON 데이터에서 마이그레이션
   */
  async migrateFromJSON(
    activityData: any,
    roleConfigData: any,
    options: MigrationOptions = {}
  ): Promise<boolean> {
    const { validateData = true, createBackup = true, skipErrors = false } = options;

    try {
      // 백업 생성
      if (createBackup) {
        await this.createBackup();
      }

      this.invalidateCache();

      // 사용자 활동 데이터 마이그레이션
      for (const [userId, data] of Object.entries(activityData)) {
        if (userId !== 'resetTimes') {
          try {
            const activityData: UserActivity = {
              userId,
              totalTime: (data as any).totalTime || 0,
              startTime: (data as any).startTime || null,
              displayName: null
            };

            this.db.get('user_activity')
              .set(userId, activityData)
              .write();
          } catch (error) {
            console.error(`[DB] 사용자 활동 마이그레이션 오류 (${userId}):`, error);
            if (!skipErrors) throw error;
          }
        }
      }

      // 역할 구성 마이그레이션
      for (const [roleName, minHours] of Object.entries(roleConfigData)) {
        try {
          const resetTime = activityData?.resetTimes?.[roleName] || null;

          const configData: RoleConfig = {
            roleName,
            minHours: minHours as number,
            resetTime,
            reportCycle: 1
          };

          this.db.get('role_config')
            .set(roleName, configData)
            .write();

          if (resetTime) {
            const historyEntry: ResetHistoryEntry = {
              id: Date.now() + Math.random(),
              roleName,
              resetTime,
              reason: 'JSON 데이터 마이그레이션'
            };

            this.db.get('reset_history')
              .push(historyEntry)
              .write();
          }
        } catch (error) {
          console.error(`[DB] 역할 설정 마이그레이션 오류 (${roleName}):`, error);
          if (!skipErrors) throw error;
        }
      }

      console.log('[DB] JSON 데이터가 성공적으로 마이그레이션되었습니다.');
      return true;
    } catch (error) {
      console.error('[DB] JSON 데이터 마이그레이션 오류:', error);
      throw error;
    }
  }

  // ======== 백업 관련 메서드 ========

  /**
   * 데이터베이스 백업 생성
   */
  async createBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.dbPath}.backup.${timestamp}`;
    
    try {
      const fs = await import('fs');
      await fs.promises.copyFile(this.dbPath, backupPath);
      
      console.log(`[DB] 백업 생성 완료: ${backupPath}`);
      return backupPath;
    } catch (error) {
      console.error('[DB] 백업 생성 오류:', error);
      throw error;
    }
  }

  /**
   * 자동 백업 스케줄링
   */
  private scheduleBackup(): void {
    if (!this.config.autoBackup) return;

    const interval = this.config.backupInterval || 3600000; // 1시간
    
    setInterval(async () => {
      try {
        await this.createBackup();
        await this.cleanupOldBackups();
      } catch (error) {
        console.error('[DB] 자동 백업 오류:', error);
      }
    }, interval);
  }

  /**
   * 오래된 백업 정리
   */
  private async cleanupOldBackups(): Promise<void> {
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      const dir = path.dirname(this.dbPath);
      const baseName = path.basename(this.dbPath);
      
      const files = await fs.promises.readdir(dir);
      const backupFiles = files
        .filter(file => file.startsWith(`${baseName}.backup.`))
        .map(file => ({
          name: file,
          path: path.join(dir, file),
          stats: fs.statSync(path.join(dir, file))
        }))
        .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());

      const maxBackups = this.config.maxBackups || 5;
      const filesToDelete = backupFiles.slice(maxBackups);

      for (const file of filesToDelete) {
        await fs.promises.unlink(file.path);
        console.log(`[DB] 오래된 백업 삭제: ${file.name}`);
      }
    } catch (error) {
      console.error('[DB] 오래된 백업 정리 오류:', error);
    }
  }

  /**
   * 데이터 새로고침 (호환성)
   */
  reloadData(): void {
    this.forceReload();
  }
}