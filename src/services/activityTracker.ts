// src/services/activityTracker.ts - 활동 추적 서비스 (TypeScript)
import { VoiceState, GuildMember, Collection, Guild, VoiceChannel } from 'discord.js';
import { injectable, inject } from 'tsyringe';

import { TIME, FILTERS, MESSAGE_TYPES } from '../config/constants';
import { config } from '../config/env';
import type { IActivityTracker } from '../interfaces/IActivityTracker';
import type { IDatabaseManager } from '../interfaces/IDatabaseManager';
import type { ILogService } from '../interfaces/ILogService';
import { DI_TOKENS } from '../interfaces/index';
import type { IRedisService } from '../interfaces/IRedisService';
import { EnhancedClient } from '../types/discord';

import { GuildSettingsManager } from './GuildSettingsManager';
// import { UserActivity } from '../types/index'; // 미사용

// ====================
// 활동 추적 관련 타입
// ====================

export interface ActivityData {
  startTime: number | null;
  totalTime: number;
  displayName?: string;
}

export interface UserClassification {
  activeUsers: ClassifiedUser[];
  inactiveUsers: ClassifiedUser[];
  afkUsers: ClassifiedUser[];
  resetTime: number | null;
  minHours: number;
}

export interface ClassifiedUser {
  userId: string;
  nickname: string;
  totalTime: number;
}

export interface ActivityTrackerOptions {
  saveDelay?: number;
  batchSize?: number;
  enableLogging?: boolean;
  enableStatistics?: boolean;
  trackingInterval?: number;
  maxRetries?: number;
}

export interface ActivityStats {
  totalActiveUsers: number;
  totalSessionTime: number;
  averageSessionTime: number;
  peakConcurrentUsers: number;
  totalJoins: number;
  totalLeaves: number;
  lastActivityTime: Date;
  uptime: number;
}

export interface VoiceStateChange {
  type: 'join' | 'leave' | 'move' | 'update';
  userId: string;
  member: GuildMember;
  oldChannelId: string | null;
  newChannelId: string | null;
  timestamp: Date;
}

// ====================
// 활동 추적 서비스 클래스
// ====================

@injectable()
export class ActivityTracker implements IActivityTracker {
  private readonly client: EnhancedClient;
  private readonly db: IDatabaseManager;
  private readonly logService: ILogService;
  private readonly redis: IRedisService;
  private readonly guildSettingsManager: GuildSettingsManager;
  private readonly options: Required<ActivityTrackerOptions>;

  // 활동 데이터 저장소 (Redis 기반 + fallback)
  private readonly channelActivityTime: Map<string, ActivityData> = new Map(); // fallback용
  private roleActivityConfig: Record<string, number> = {};

  // Redis 키 패턴
  private readonly REDIS_KEYS = {
    VOICE_SESSION: (userId: string) => `voice_session:${userId}`,
    ACTIVITY_DATA: (userId: string) => `activity_data:${userId}`,
    SESSION_STATS: 'session_stats',
    ACTIVE_SESSIONS: 'active_voice_sessions',
  };

  // 제어 변수
  private saveActivityTimeout: NodeJS.Timeout | null = null;
  private isInitialized = false;
  private readonly startTime = Date.now();

  // 통계 데이터
  private readonly stats: ActivityStats = {
    totalActiveUsers: 0,
    totalSessionTime: 0,
    averageSessionTime: 0,
    peakConcurrentUsers: 0,
    totalJoins: 0,
    totalLeaves: 0,
    lastActivityTime: new Date(),
    uptime: 0,
  };

  // 세션 및 이벤트 추적 (fallback용)
  private currentSessions: Map<string, { startTime: number; channelId: string }> = new Map();

  constructor(
    @inject(DI_TOKENS.DiscordClient) client: EnhancedClient,
    @inject(DI_TOKENS.IDatabaseManager) dbManager: IDatabaseManager,
    @inject(DI_TOKENS.ILogService) logService: ILogService,
    @inject(DI_TOKENS.IRedisService) redis: IRedisService,
    @inject(DI_TOKENS.IGuildSettingsManager) guildSettingsManager: GuildSettingsManager,
    options: ActivityTrackerOptions = {}
  ) {
    this.client = client;
    this.db = dbManager;
    this.logService = logService;
    this.redis = redis;
    this.guildSettingsManager = guildSettingsManager;
    this.options = {
      saveDelay: TIME.SAVE_ACTIVITY_DELAY,
      batchSize: 50,
      enableLogging: true,
      enableStatistics: true,
      trackingInterval: 60000, // 1분
      maxRetries: 3,
      ...options,
    };

    // 주기적 통계 업데이트
    if (this.options.enableStatistics) {
      this.scheduleStatisticsUpdate();
    }
  }

  // ===========================================
  // 길드 설정 관리
  // ===========================================

  /**
   * 길드별 제외 채널 목록을 가져옵니다 (활동 시간 추적용)
   * @param guildId - 길드 ID
   * @returns 제외 채널 ID 배열 (완전 제외 + 활동 제한 채널 합친 목록)
   */
  private async getExcludedChannels(guildId?: string): Promise<string[]> {
    if (!guildId) {
      console.warn('[ActivityTracker] guildId가 제공되지 않음 - 빈 배열 반환');
      return [];
    }

    try {
      const excludeChannelsSetting = await this.guildSettingsManager.getExcludeChannels(guildId);
      if (excludeChannelsSetting) {
        // 완전 제외 채널 + 활동 제한 채널 합침 (활동 시간 측정에서는 둘 다 제외)
        return [
          ...excludeChannelsSetting.excludedChannels,
          ...excludeChannelsSetting.activityLimitedChannels,
        ];
      }
      console.log('[ActivityTracker] DB에 제외 채널 설정이 없음 - 빈 배열 반환');
      return [];
    } catch (error) {
      console.error('[ActivityTracker] 길드 제외 채널 설정 조회 실패 - 빈 배열 반환:', error);
      return [];
    }
  }

  /**
   * 길드별 로그 제외 채널 목록을 가져옵니다
   * @param guildId - 길드 ID
   * @returns 로그 제외 채널 ID 배열 (완전 제외 채널만, 활동 제한 채널은 로그 출력함)
   */
  private async getExcludedChannelsForLogs(guildId?: string): Promise<string[]> {
    const startTime = Date.now();

    if (!guildId) {
      console.warn('[ActivityTracker] guildId가 제공되지 않음 - 빈 배열 반환');
      return [];
    }

    try {
      console.log('[ActivityTracker] DB에서 제외 채널 설정 조회 시작', {
        guildId,
        timestamp: new Date().toISOString(),
      });

      const excludeChannelsSetting = await this.guildSettingsManager.getExcludeChannels(guildId);
      const queryTime = Date.now() - startTime;

      if (!excludeChannelsSetting) {
        console.log('[ActivityTracker] DB에서 제외 채널 설정 없음 - 빈 배열 반환', {
          guildId,
          queryTime: `${queryTime}ms`,
        });
        return [];
      }

      console.log('[ActivityTracker] DB에서 제외 채널 설정 조회 성공', {
        guildId,
        queryTime: `${queryTime}ms`,
        rawSetting: {
          excludedChannels: excludeChannelsSetting.excludedChannels || null,
          excludedChannelsCount: excludeChannelsSetting.excludedChannels?.length || 0,
          excludedChannelsType: Array.isArray(excludeChannelsSetting.excludedChannels)
            ? 'array'
            : typeof excludeChannelsSetting.excludedChannels,
          activityLimitedChannels: excludeChannelsSetting.activityLimitedChannels || null,
          activityLimitedChannelsCount: excludeChannelsSetting.activityLimitedChannels?.length || 0,
          activityLimitedChannelsType: Array.isArray(excludeChannelsSetting.activityLimitedChannels)
            ? 'array'
            : typeof excludeChannelsSetting.activityLimitedChannels,
          lastUpdated: excludeChannelsSetting.lastUpdated,
        },
      });

      if (excludeChannelsSetting && Array.isArray(excludeChannelsSetting.excludedChannels)) {
        const fullyExcludedChannels = excludeChannelsSetting.excludedChannels;

        console.log('[ActivityTracker] ✅ 로그 제외 채널 결정 - 완전 제외 채널만 사용', {
          guildId,
          fullyExcludedChannels,
          fullyExcludedCount: fullyExcludedChannels.length,
          activityLimitedChannels: excludeChannelsSetting.activityLimitedChannels,
          activityLimitedCount: excludeChannelsSetting.activityLimitedChannels?.length || 0,
          note: '완전 제외 채널: 로그 + 활동 추적 모두 제외, 활동 제한 채널: 로그 출력, 활동 추적만 제외',
        });

        return fullyExcludedChannels;
      } else {
        console.warn('[ActivityTracker] 완전 제외 채널 배열이 유효하지 않음 - 빈 배열 반환', {
          guildId,
          excludedChannelsValue: excludeChannelsSetting.excludedChannels,
          excludedChannelsType: typeof excludeChannelsSetting.excludedChannels,
          isArray: Array.isArray(excludeChannelsSetting.excludedChannels),
        });
        return [];
      }
    } catch (error) {
      const queryTime = Date.now() - startTime;
      console.error('[ActivityTracker] 길드 로그 제외 채널 설정 조회 실패 - 빈 배열 반환', {
        guildId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        queryTime: `${queryTime}ms`,
      });
      return [];
    }
  }

  // ===========================================
  // Redis 세션 관리 메서드들
  // ===========================================

  /**
   * Redis에서 음성 세션 데이터 조회 (fallback 포함)
   */
  private async getVoiceSession(
    userId: string
  ): Promise<{ startTime: number; channelId: string } | null> {
    try {
      if (this.redis.isConnected()) {
        const sessionData = await this.redis.hgetall(this.REDIS_KEYS.VOICE_SESSION(userId));
        if (sessionData.startTime && sessionData.channelId) {
          return {
            startTime: parseInt(sessionData.startTime),
            channelId: sessionData.channelId,
          };
        }
      }

      // fallback - 메모리에서 조회
      return this.currentSessions.get(userId) || null;
    } catch (error) {
      console.error('[ActivityTracker] Redis 세션 조회 실패:', error);
      return this.currentSessions.get(userId) || null;
    }
  }

  /**
   * Redis에 음성 세션 데이터 저장 (fallback 포함)
   */
  private async setVoiceSession(
    userId: string,
    startTime: number,
    channelId: string
  ): Promise<void> {
    const sessionData = { startTime, channelId };

    try {
      if (this.redis.isConnected()) {
        await this.redis.hmset(this.REDIS_KEYS.VOICE_SESSION(userId), {
          startTime: startTime.toString(),
          channelId,
          timestamp: Date.now().toString(),
        });

        // 24시간 TTL 설정
        await this.redis.expire(this.REDIS_KEYS.VOICE_SESSION(userId), 86400);

        // 활성 세션 집합에 추가
        await this.redis.sadd(this.REDIS_KEYS.ACTIVE_SESSIONS, userId);
      }

      // fallback 메모리에도 저장
      this.currentSessions.set(userId, sessionData);
    } catch (error) {
      console.error('[ActivityTracker] Redis 세션 저장 실패:', error);

      // 에러 발생시 fallback만 사용
      this.currentSessions.set(userId, sessionData);
    }
  }

  /**
   * Redis에서 음성 세션 데이터 삭제 (fallback 포함)
   */
  private async removeVoiceSession(userId: string): Promise<void> {
    try {
      if (this.redis.isConnected()) {
        await this.redis.del(this.REDIS_KEYS.VOICE_SESSION(userId));
        await this.redis.srem(this.REDIS_KEYS.ACTIVE_SESSIONS, userId);
      }

      // fallback 메모리에서도 삭제
      this.currentSessions.delete(userId);
    } catch (error) {
      console.error('[ActivityTracker] Redis 세션 삭제 실패:', error);

      // 에러 발생시 fallback만 삭제
      this.currentSessions.delete(userId);
    }
  }

  /**
   * Redis에서 활동 데이터 조회 (fallback 포함)
   */
  private async getActivityData(userId: string): Promise<ActivityData | null> {
    try {
      if (this.redis.isConnected()) {
        const activityData = await this.redis.getJSON<ActivityData>(
          this.REDIS_KEYS.ACTIVITY_DATA(userId)
        );
        if (activityData) {
          return activityData;
        }
      }

      // fallback - 메모리에서 조회
      return this.channelActivityTime.get(userId) || null;
    } catch (error) {
      console.error('[ActivityTracker] Redis 활동 데이터 조회 실패:', error);
      return this.channelActivityTime.get(userId) || null;
    }
  }

  /**
   * Redis에 활동 데이터 저장 (fallback 포함)
   */
  private async setActivityData(userId: string, activityData: ActivityData): Promise<void> {
    try {
      if (this.redis.isConnected()) {
        await this.redis.setJSON(this.REDIS_KEYS.ACTIVITY_DATA(userId), activityData, 3600); // 1시간 TTL
      }

      // fallback 메모리에도 저장
      this.channelActivityTime.set(userId, activityData);
    } catch (error) {
      console.error('[ActivityTracker] Redis 활동 데이터 저장 실패:', error);

      // 에러 발생시 fallback만 사용
      this.channelActivityTime.set(userId, activityData);
    }
  }

  /**
   * Redis에서 모든 활성 세션 조회
   */
  private async getAllActiveSessions(): Promise<string[]> {
    try {
      if (this.redis.isConnected()) {
        const userIds = await this.redis.smembers(this.REDIS_KEYS.ACTIVE_SESSIONS);
        return userIds;
      }

      // fallback - 메모리에서 조회
      return Array.from(this.currentSessions.keys());
    } catch (error) {
      console.error('[ActivityTracker] Redis 활성 세션 조회 실패:', error);
      return Array.from(this.currentSessions.keys());
    }
  }

  /**
   * 봇 재시작 시 Redis에서 세션 복구
   */
  async restoreActiveSessions(): Promise<void> {
    try {
      if (!this.redis.isConnected()) {
        console.log('[ActivityTracker] Redis 연결 없음. 세션 복구 건너뜀.');
        return;
      }

      console.log('[ActivityTracker] Redis에서 활성 세션 복구 중...');

      const activeUserIds = await this.getAllActiveSessions();
      let restoredCount = 0;

      for (const userId of activeUserIds) {
        try {
          const sessionData = await this.getVoiceSession(userId);
          const activityData = await this.getActivityData(userId);

          if (sessionData) {
            // 현재 시간으로부터 너무 오래된 세션은 정리
            const sessionAge = Date.now() - sessionData.startTime;
            if (sessionAge > 86400000) {
              // 24시간 이상
              await this.removeVoiceSession(userId);
              console.log(`[ActivityTracker] 오래된 세션 정리: ${userId}`);
              continue;
            }

            // 메모리에 세션 복구
            this.currentSessions.set(userId, sessionData);
            restoredCount++;
          }

          if (activityData) {
            this.channelActivityTime.set(userId, activityData);
          }
        } catch (error) {
          console.error(`[ActivityTracker] 사용자 ${userId} 세션 복구 실패:`, error);
        }
      }

      console.log(`[ActivityTracker] ✅ ${restoredCount}개 세션 복구 완료`);

      // 실시간 알림 발송
      if (this.redis.isConnected()) {
        await this.redis.publish(
          'voice_activity',
          JSON.stringify({
            type: 'session_restore',
            restoredSessions: restoredCount,
            timestamp: Date.now(),
          })
        );
      }
    } catch (error) {
      console.error('[ActivityTracker] 세션 복구 실패:', error);
    }
  }

  // ===========================================
  // 기존 메서드들
  // ===========================================

  /**
   * 활동 데이터를 DB에서 로드
   */
  async loadActivityData(): Promise<void> {
    try {
      const activities = await this.db.getAllUserActivity();
      this.channelActivityTime.clear();

      for (const activity of activities) {
        this.channelActivityTime.set(activity.userId, {
          startTime: activity.startTime,
          totalTime: activity.totalTime,
          ...(activity.displayName && { displayName: activity.displayName }),
        });
      }

      if (this.options.enableLogging) {
        console.log(
          `[ActivityTracker] ${activities.length}명의 사용자 활동 데이터를 로드했습니다.`
        );
      }
    } catch (error) {
      console.error('[ActivityTracker] 활동 데이터 로드 오류:', error);
      throw error;
    }
  }

  /**
   * 역할 활동 설정을 DB에서 로드
   */
  async loadRoleActivityConfig(guildId?: string): Promise<void> {
    try {
      // 길드 ID가 필수적으로 필요합니다
      if (!guildId) {
        throw new Error('loadRoleActivityConfig: guildId는 필수 매개변수입니다');
      }
      
      const configs = await this.guildSettingsManager.getAllRoleActivityTimes(guildId);
      this.roleActivityConfig = {};

      // 객체 형태로 반환되는 configs를 처리
      for (const [roleName, config] of Object.entries(configs)) {
        this.roleActivityConfig[roleName] = config.minHours;
      }

      const configCount = Object.keys(configs).length;
      if (this.options.enableLogging) {
        console.log(`[ActivityTracker] ${configCount}개의 역할 설정을 로드했습니다.`);
      }
    } catch (error) {
      console.error('[ActivityTracker] 역할 설정 로드 오류:', error);
      throw error;
    }
  }

  /**
   * 활동 데이터를 DB에 저장
   */
  async saveActivityData(): Promise<void> {
    const now = Date.now();
    const activeUsers = Array.from(this.channelActivityTime.entries()).filter(
      ([_, activity]) => activity.startTime !== null
    );

    if (activeUsers.length > 0 && this.options.enableLogging) {
      console.log(
        `[ActivityTracker] 활동 데이터 저장 시작 - ${activeUsers.length}명의 활성 사용자`
      );
    }

    try {
      await this.db.beginTransaction();

      // 배치 단위로 처리
      const batches = this.createBatches(
        Array.from(this.channelActivityTime.entries()),
        this.options.batchSize
      );

      for (const batch of batches) {
        await this.processBatch(batch, now);
      }

      await this.db.commitTransaction();

      if (this.options.enableLogging) {
        console.log('[ActivityTracker] 활동 데이터가 성공적으로 저장되었습니다.');
      }
    } catch (error) {
      await this.db.rollbackTransaction();
      console.error('[ActivityTracker] 활동 데이터 저장 오류:', error);
      throw error;
    }
  }

  /**
   * 배치 처리
   */
  private async processBatch(batch: [string, ActivityData][], now: number): Promise<void> {
    for (const [userId, userActivity] of batch) {
      try {
        if (userActivity.startTime !== null) {
          const existingActivity = await this.db.getUserActivity(userId);
          const existingTotalTime = existingActivity ? existingActivity.totalTime : 0;
          const newTotalTime = existingTotalTime + (now - userActivity.startTime);

          await this.db.updateUserActivity(
            userId,
            newTotalTime,
            now,
            userActivity.displayName || null
          );

          userActivity.totalTime = newTotalTime;
          userActivity.startTime = now;
        } else if (userActivity.totalTime > 0) {
          await this.db.updateUserActivity(
            userId,
            userActivity.totalTime,
            null,
            userActivity.displayName || null
          );
        }
      } catch (error) {
        console.error(`[ActivityTracker] 사용자 데이터 처리 오류 (${userId}):`, error);
      }
    }
  }

  /**
   * 배치 생성
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * 일정 시간 후 활동 데이터 저장 예약
   */
  private debounceSaveActivityData(): void {
    if (this.saveActivityTimeout) {
      clearTimeout(this.saveActivityTimeout);
    }

    this.saveActivityTimeout = setTimeout(async () => {
      try {
        await this.saveActivityData();
      } catch (error) {
        console.error('[ActivityTracker] 예약된 저장 작업 오류:', error);
      }
    }, this.options.saveDelay);
  }

  /**
   * 특정 역할의 활동 데이터 초기화
   */
  async clearAndReinitializeActivityData(role: string, guildId?: string): Promise<void> {
    const startTime = Date.now();
    let membersFetched = false;
    let totalMembers = 0;
    let processedMembers = 0;

    try {
      console.log('[ActivityTracker] 역할별 활동 데이터 초기화 시작', {
        role,
        timestamp: new Date().toISOString(),
      });

      await this.saveActivityData();

      const now = Date.now();
      let guild;
      
      if (guildId) {
        guild = this.client.guilds.cache.get(guildId);
        if (!guild) {
          throw new Error(`길드를 찾을 수 없습니다: ${guildId}`);
        }
      } else {
        // guildId가 제공되지 않으면 첫 번째 사용 가능한 길드 사용
        guild = this.client.guilds.cache.first();
        if (!guild) {
          throw new Error('사용 가능한 길드가 없습니다');
        }
        console.warn(`[ActivityTracker] guildId가 제공되지 않아 기본 길드 사용: ${guild.name} (${guild.id})`);
      }

      console.log('[ActivityTracker] 역할 리셋 시간 업데이트 중', {
        role,
        resetTime: now,
        guildId: guild.id,
      });

      await this.db.updateRoleResetTime(role, now);

      // Guild members fetch with timeout and retry mechanism
      let members: Collection<string, GuildMember>;
      try {
        console.log('[ActivityTracker] 길드 멤버 조회 시작 (타임아웃: 15초)', {
          role,
          guildId: guild.id,
          cachedMembers: guild.members.cache.size,
          totalMembers: guild.memberCount,
        });

        // 15초 타임아웃으로 멤버 조회 시도
        members = (await Promise.race([
          guild.members.fetch(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('GuildMembersTimeout')), 15000)
          ),
        ])) as Collection<string, GuildMember>;

        membersFetched = true;
        totalMembers = members.size;
        console.log('[ActivityTracker] ✅ 길드 멤버 조회 성공', {
          role,
          memberCount: totalMembers,
          fetchTime: `${Date.now() - startTime}ms`,
        });
      } catch (fetchError) {
        const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
        console.warn('[ActivityTracker] ⚠️ 길드 멤버 조회 실패 - 캐시된 멤버로 fallback 시도', {
          role,
          error: errorMessage,
          fetchTime: `${Date.now() - startTime}ms`,
        });

        // Fallback: 캐시된 멤버만 사용
        members = guild.members.cache;
        totalMembers = members.size;

        if (totalMembers === 0) {
          console.error('[ActivityTracker] ❌ 캐시된 멤버도 없음 - 역할 초기화 실패', {
            role,
          });
          throw new Error(`캐시된 멤버가 없어 역할 '${role}' 초기화를 수행할 수 없습니다.`);
        }

        console.log('[ActivityTracker] 📋 캐시된 멤버로 초기화 계속', {
          role,
          cachedMemberCount: totalMembers,
        });
      }

      const excludedChannels = await this.getExcludedChannels(guild.id);

      console.log('[ActivityTracker] 역할 멤버 처리 시작', {
        role,
        totalMembers,
        excludedChannelCount: excludedChannels.length,
      });

      for (const [_, member] of members) {
        try {
          const hasRole = member.roles.cache.some((r: any) => r.name === role);

          if (hasRole) {
            const userId = member.id;
            if (this.channelActivityTime.has(userId)) {
              const userActivity = this.channelActivityTime.get(userId)!;
              const isInVoiceChannel =
                member.voice?.channelId && !excludedChannels.includes(member.voice.channelId);

              if (isInVoiceChannel) {
                userActivity.startTime = now;
                userActivity.totalTime = 0;
              } else {
                userActivity.startTime = null;
                userActivity.totalTime = 0;
              }

              await this.db.updateUserActivity(
                userId,
                0,
                userActivity.startTime,
                member.displayName
              );
              processedMembers++;
            }
          }
        } catch (memberError) {
          console.warn('[ActivityTracker] 멤버 처리 실패', {
            role,
            userId: member.id,
            memberDisplayName: member?.displayName || 'Unknown',
            error: memberError instanceof Error ? memberError.message : String(memberError),
          });
          // 개별 멤버 처리 실패는 전체 초기화를 중단하지 않음
        }
      }

      const initTime = Date.now() - startTime;
      console.log('[ActivityTracker] ✅ 역할별 활동 데이터 초기화 완료', {
        role,
        totalInitTime: `${initTime}ms`,
        membersFetched,
        totalMembers,
        processedMembers,
        avgProcessingTimePerMember:
          totalMembers > 0 ? `${(initTime / totalMembers).toFixed(2)}ms` : 'N/A',
      });
    } catch (error) {
      const initTime = Date.now() - startTime;
      console.error('[ActivityTracker] 역할별 활동 데이터 초기화 오류', {
        role,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        initTime: `${initTime}ms`,
        membersFetched,
        totalMembers,
        processedMembers,
      });
      throw error;
    }
  }

  /**
   * 길드의 활동 데이터 초기화
   */
  async initializeActivityData(guild: Guild): Promise<void> {
    const startTime = Date.now();
    let membersFetched = false;
    let totalMembers = 0;
    let processedMembers = 0;

    try {
      console.log('[ActivityTracker] 활동 데이터 초기화 시작', {
        guildId: guild.id,
        guildName: guild.name,
        cachedMemberCount: guild.memberCount,
      });

      await this.loadRoleActivityConfig(guild.id);
      await this.loadActivityData();

      const roleConfigs = await this.guildSettingsManager.getAllRoleActivityTimes(guild.id);
      const trackedRoles = Object.keys(roleConfigs);

      console.log('[ActivityTracker] 추적 대상 역할:', {
        trackedRoles,
        roleConfigCount: Object.keys(roleConfigs).length,
      });

      // 추적 대상 역할이 없으면 멤버 조회 생략
      if (trackedRoles.length === 0) {
        console.log('[ActivityTracker] ⚠️ 추적 대상 역할이 없어 멤버 조회 생략');
        this.isInitialized = true;
        return;
      }

      // Guild members fetch with timeout and retry mechanism
      let members: Collection<string, GuildMember>;
      
      // 캐시된 멤버가 충분하면 fetch 생략
      const cachedMembers = guild.members.cache;
      if (cachedMembers.size > 0) {
        console.log('[ActivityTracker] 📋 캐시된 멤버 사용 (fetch 생략)', {
          cachedMemberCount: cachedMembers.size,
        });
        members = cachedMembers;
        totalMembers = members.size;
        membersFetched = false;
      } else {
        try {
          console.log('[ActivityTracker] 길드 멤버 조회 시작 (타임아웃: 15초)');

          // 15초로 타임아웃 단축
          members = (await Promise.race([
            guild.members.fetch(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('GuildMembersTimeout')), 15000)
            ),
          ])) as Collection<string, GuildMember>;

          membersFetched = true;
          totalMembers = members.size;
          console.log('[ActivityTracker] ✅ 길드 멤버 조회 성공', {
            memberCount: totalMembers,
            fetchTime: `${Date.now() - startTime}ms`,
          });
        } catch (fetchError) {
          const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
          console.warn('[ActivityTracker] ⚠️ 길드 멤버 조회 실패 - 제한된 초기화', {
            error: errorMessage,
            fetchTime: `${Date.now() - startTime}ms`,
          });

          // 멤버 정보 없이 제한된 초기화
          this.isInitialized = true;
          console.log('[ActivityTracker] ⚠️ 멤버 정보 없이 제한된 초기화 완료');
          return;
        }
      }

      // 멤버 처리
      console.log('[ActivityTracker] 멤버 처리 시작', {
        totalMembers,
        trackedRolesCount: trackedRoles.length,
      });

      for (const [userId, member] of members) {
        try {
          const userRoles = member.roles.cache.map((role: any) => role.name);
          const hasTrackedRole = userRoles.some((role: any) => trackedRoles.includes(role));

          if (hasTrackedRole && !this.channelActivityTime.has(userId)) {
            this.channelActivityTime.set(userId, {
              startTime: null,
              totalTime: 0,
              displayName: member.displayName,
            });

            await this.db.updateUserActivity(userId, 0, null, member.displayName);
            processedMembers++;
          }
        } catch (memberError) {
          console.warn('[ActivityTracker] 멤버 처리 실패', {
            userId,
            memberDisplayName: member?.displayName || 'Unknown',
            error: memberError instanceof Error ? memberError.message : String(memberError),
          });
          // 개별 멤버 처리 실패는 전체 초기화를 중단하지 않음
        }
      }

      this.isInitialized = true;

      const initTime = Date.now() - startTime;
      console.log('[ActivityTracker] ✅ 활동 정보 초기화 완료', {
        totalInitTime: `${initTime}ms`,
        membersFetched,
        totalMembers,
        processedMembers,
        trackedRolesCount: trackedRoles.length,
        avgProcessingTimePerMember:
          totalMembers > 0 ? `${(initTime / totalMembers).toFixed(2)}ms` : 'N/A',
      });
    } catch (error) {
      const initTime = Date.now() - startTime;
      console.error('[ActivityTracker] 활동 데이터 초기화 오류:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        initTime: `${initTime}ms`,
        membersFetched,
        totalMembers,
        processedMembers,
      });

      // 초기화 실패 시에도 기본 상태로 설정하여 봇이 계속 동작할 수 있도록 함
      this.isInitialized = true;
      console.log('[ActivityTracker] ⚠️ 오류 발생했지만 제한된 초기화로 봇 동작 계속');

      throw error;
    }
  }

  /**
   * 음성 상태 업데이트 이벤트 핸들러
   */
  async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (!this.isInitialized) return;

    if (this.isSameChannelUpdate(oldState, newState)) {
      return;
    }

    const userId = newState.id;
    const member = newState.member;
    if (!member) return;

    const now = Date.now();
    const change = this.analyzeVoiceStateChange(oldState, newState);

    if (this.options.enableLogging) {
      console.log(`[ActivityTracker] 음성 채널 ${change.type}: ${member.displayName} (${userId})`);
    }

    // 통계 업데이트
    if (this.options.enableStatistics) {
      this.updateStatistics(change);
    }

    // 로그 처리
    if (change.type === 'join') {
      await this.handleChannelJoin(newState, member);
    } else if (change.type === 'leave') {
      await this.handleChannelLeave(oldState, member);
    }

    // 관전 또는 대기 상태 확인
    if (this.isObservationOrWaiting(member)) {
      return;
    }

    // 활동 시간 추적
    await this.trackActivityTime(change, userId, member, now);
    this.debounceSaveActivityData();
  }

  /**
   * 음성 상태 변경 분석
   */
  private analyzeVoiceStateChange(oldState: VoiceState, newState: VoiceState): VoiceStateChange {
    const userId = newState.id;
    const member = newState.member!;
    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;
    const timestamp = new Date();

    if (!oldChannelId && newChannelId) {
      return { type: 'join', userId, member, oldChannelId, newChannelId, timestamp };
    } else if (oldChannelId && !newChannelId) {
      return { type: 'leave', userId, member, oldChannelId, newChannelId, timestamp };
    } else if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
      return { type: 'move', userId, member, oldChannelId, newChannelId, timestamp };
    } else {
      return { type: 'update', userId, member, oldChannelId, newChannelId, timestamp };
    }
  }

  /**
   * 활동 시간 추적 (Redis 기반)
   */
  private async trackActivityTime(
    change: VoiceStateChange,
    userId: string,
    member: GuildMember,
    now: number
  ): Promise<void> {
    const guildId = member.guild.id;
    const excludedChannels = await this.getExcludedChannels(guildId);

    const isExcluded = (channelId: string | null) =>
      channelId && excludedChannels.includes(channelId);

    if (change.type === 'join' && !isExcluded(change.newChannelId)) {
      await this.startActivityTracking(userId, member, now, change.newChannelId!);
    } else if (change.type === 'leave' && !isExcluded(change.oldChannelId)) {
      await this.endActivityTracking(userId, now);
    } else if (change.type === 'move') {
      if (isExcluded(change.oldChannelId) && !isExcluded(change.newChannelId)) {
        await this.startActivityTracking(userId, member, now, change.newChannelId!);
      } else if (!isExcluded(change.oldChannelId) && isExcluded(change.newChannelId)) {
        await this.endActivityTracking(userId, now);
      }
    }
  }

  /**
   * 활동 추적 시작 (Redis 기반)
   */
  private async startActivityTracking(
    userId: string,
    member: GuildMember,
    now: number,
    channelId: string
  ): Promise<void> {
    try {
      // 기존 활동 데이터 조회
      let activityData = await this.getActivityData(userId);

      if (!activityData) {
        // 새 활동 데이터 생성
        activityData = {
          startTime: now,
          totalTime: 0,
          displayName: member.displayName,
        };
      } else {
        // 기존 데이터 업데이트
        if (activityData.startTime === null) {
          activityData.startTime = now;
        }
        activityData.displayName = member.displayName;
      }

      // Redis에 활동 데이터 저장
      await this.setActivityData(userId, activityData);

      // Redis에 음성 세션 저장
      await this.setVoiceSession(userId, now, channelId);

      // 실시간 알림 발송
      if (this.redis.isConnected()) {
        await this.redis.publish(
          'voice_activity',
          JSON.stringify({
            type: 'join',
            userId,
            channelId,
            displayName: member.displayName,
            timestamp: now,
          })
        );
      }

      console.log(
        `[ActivityTracker] 세션 시작: ${member.displayName} (${userId}) - 채널: ${channelId}`
      );
    } catch (error) {
      console.error('[ActivityTracker] 활동 추적 시작 실패:', error);

      // fallback - 메모리만 사용
      if (!this.channelActivityTime.has(userId)) {
        this.channelActivityTime.set(userId, {
          startTime: now,
          totalTime: 0,
          displayName: member.displayName,
        });
      } else {
        const userActivity = this.channelActivityTime.get(userId)!;
        if (userActivity.startTime === null) {
          userActivity.startTime = now;
        }
        userActivity.displayName = member.displayName;
      }
    }
  }

  /**
   * 활동 추적 종료 (Redis 기반)
   */
  private async endActivityTracking(userId: string, now: number): Promise<void> {
    try {
      // Redis에서 활동 데이터 조회
      const activityData = await this.getActivityData(userId);
      const sessionData = await this.getVoiceSession(userId);

      if (activityData && activityData.startTime !== null) {
        // 세션 시간 계산
        const sessionDuration = now - activityData.startTime;
        const originalStartTime = activityData.startTime; // 원래 startTime 보존

        activityData.totalTime += sessionDuration;
        activityData.startTime = null;

        // Redis에 업데이트된 활동 데이터 저장
        await this.setActivityData(userId, activityData);

        // 세션 종료 기록을 activity_log에 저장 (duration 포함)
        try {
          await this.db.run(
            `
            INSERT INTO activity_log (user_id, action, channel_id, timestamp, duration, user_name, additional_data)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
            [
              userId,
              'SESSION_END',
              sessionData?.channelId || 'unknown',
              now,
              sessionDuration,
              activityData.displayName || userId,
              JSON.stringify({
                sessionStartTime: originalStartTime,
                sessionEndTime: now,
                sessionDurationMs: sessionDuration,
                totalTimeMs: activityData.totalTime,
              }),
            ]
          );

          console.log(
            `[ActivityTracker] 세션 종료 DB 기록: ${userId} - 세션 시간: ${sessionDuration}ms`
          );
        } catch (dbError) {
          console.error('[ActivityTracker] 세션 종료 DB 기록 실패:', dbError);
        }

        // 실시간 알림 발송
        if (this.redis.isConnected()) {
          await this.redis.publish(
            'voice_activity',
            JSON.stringify({
              type: 'leave',
              userId,
              channelId: sessionData?.channelId || 'unknown',
              sessionDuration,
              totalTime: activityData.totalTime,
              timestamp: now,
            })
          );
        }

        console.log(
          `[ActivityTracker] 세션 종료: ${userId} - 세션 시간: ${sessionDuration}ms, 총 시간: ${activityData.totalTime}ms`
        );
      }

      // Redis에서 음성 세션 삭제
      await this.removeVoiceSession(userId);
    } catch (error) {
      console.error('[ActivityTracker] 활동 추적 종료 실패:', error);

      // fallback - 메모리만 사용
      const userActivity = this.channelActivityTime.get(userId);
      if (userActivity && userActivity.startTime !== null) {
        userActivity.totalTime += now - userActivity.startTime;
        userActivity.startTime = null;
      }
    }
  }

  /**
   * 같은 채널 내 상태 변경 확인
   */
  private isSameChannelUpdate(oldState: VoiceState, newState: VoiceState): boolean {
    return oldState.channelId === newState.channelId && newState.channelId !== null;
  }

  /**
   * 관전 또는 대기 상태 확인
   */
  private isObservationOrWaiting(member: GuildMember): boolean {
    return (
      member.displayName.includes(FILTERS.OBSERVATION) ||
      member.displayName.includes(FILTERS.WAITING)
    );
  }

  /**
   * 채널 입장 처리
   */
  private async handleChannelJoin(newState: VoiceState, member: GuildMember): Promise<void> {
    const joinStartTime = Date.now();

    console.log('[ActivityTracker] 📥 채널 입장 처리 시작', {
      userId: newState.id,
      userDisplayName: member.displayName,
      channelId: newState.channelId,
      channelName: newState.channel?.name,
      guildId: member.guild.id,
      timestamp: new Date().toISOString(),
    });

    if (!newState.channel) {
      console.warn('[ActivityTracker] ⚠️ 채널 입장 처리 중단: newState.channel이 null', {
        userId: newState.id,
        userDisplayName: member.displayName,
      });
      return;
    }

    const guildId = member.guild.id;
    const channelId = newState.channelId!;
    const channelName = newState.channel.name;

    console.log('[ActivityTracker] 🔍 제외 채널 확인 중', {
      userId: newState.id,
      userDisplayName: member.displayName,
      channelId,
      channelName,
      guildId,
    });

    const excludedChannelsForLogs = await this.getExcludedChannelsForLogs(guildId);
    const isExcluded = excludedChannelsForLogs.includes(channelId);

    console.log('[ActivityTracker] 🎯 제외 채널 확인 결과', {
      userId: newState.id,
      userDisplayName: member.displayName,
      channelId,
      channelName,
      excludedChannelsForLogs,
      excludedChannelCount: excludedChannelsForLogs.length,
      isExcluded,
      decision: isExcluded
        ? '로그 차단 (완전 제외 채널)'
        : '로그 진행 (일반 채널 또는 활동 제한 채널)',
      note: isExcluded
        ? '완전 제외 채널은 로그와 활동 추적 모두 제외'
        : '활동 제한 채널은 로그 출력됨',
    });

    if (isExcluded) {
      console.log('[ActivityTracker] 🚫 채널 입장 로그 차단됨 (완전 제외 채널)', {
        userId: newState.id,
        userDisplayName: member.displayName,
        channelId,
        channelName,
        reason: '완전 제외 채널',
      });
      return;
    }

    try {
      console.log('[ActivityTracker] 👥 채널 멤버 목록 조회 중', {
        userId: newState.id,
        channelId,
        channelName,
      });

      const membersInChannel = await this.logService.getVoiceChannelMembers(
        newState.channel as VoiceChannel
      );

      console.log('[ActivityTracker] ✅ 채널 멤버 목록 조회 완료', {
        userId: newState.id,
        channelId,
        channelName,
        memberCount: membersInChannel.length,
        members: membersInChannel,
      });

      const logMessage = `${MESSAGE_TYPES.JOIN}: \` ${member.displayName} \`님이 \` ${channelName} \`에 입장했습니다.`;

      console.log('[ActivityTracker] 📝 로그 메시지 생성 및 전송 중', {
        userId: newState.id,
        userDisplayName: member.displayName,
        channelId,
        channelName,
        logMessage,
        memberCount: membersInChannel.length,
      });

      this.logService.logActivity(logMessage, membersInChannel, 'JOIN', { guildId });

      console.log('[ActivityTracker] 💾 상세 활동 DB 기록 중', {
        userId: newState.id,
        action: 'JOIN',
        channelId,
        channelName,
        memberCount: membersInChannel.length,
      });

      await this.db.logDetailedActivity(
        newState.id,
        'JOIN',
        channelId,
        channelName,
        membersInChannel
      );

      const processingTime = Date.now() - joinStartTime;
      console.log('[ActivityTracker] ✅ 채널 입장 처리 완료', {
        userId: newState.id,
        userDisplayName: member.displayName,
        channelId,
        channelName,
        processingTime: `${processingTime}ms`,
        success: true,
      });
    } catch (error) {
      const processingTime = Date.now() - joinStartTime;
      console.error('[ActivityTracker] ❌ 채널 입장 처리 오류', {
        userId: newState.id,
        userDisplayName: member.displayName,
        channelId,
        channelName,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        processingTime: `${processingTime}ms`,
      });
    }
  }

  /**
   * 채널 퇴장 처리
   */
  private async handleChannelLeave(oldState: VoiceState, member: GuildMember): Promise<void> {
    const leaveStartTime = Date.now();

    console.log('[ActivityTracker] 📤 채널 퇴장 처리 시작', {
      userId: oldState.id,
      userDisplayName: member.displayName,
      channelId: oldState.channelId,
      channelName: oldState.channel?.name,
      guildId: member.guild.id,
      timestamp: new Date().toISOString(),
    });

    if (!oldState.channel) {
      console.warn('[ActivityTracker] ⚠️ 채널 퇴장 처리 중단: oldState.channel이 null', {
        userId: oldState.id,
        userDisplayName: member.displayName,
      });
      return;
    }

    const guildId = member.guild.id;
    const channelId = oldState.channelId!;
    const channelName = oldState.channel.name;

    console.log('[ActivityTracker] 🔍 제외 채널 확인 중', {
      userId: oldState.id,
      userDisplayName: member.displayName,
      channelId,
      channelName,
      guildId,
    });

    const excludedChannelsForLogs = await this.getExcludedChannelsForLogs(guildId);
    const isExcluded = excludedChannelsForLogs.includes(channelId);

    console.log('[ActivityTracker] 🎯 제외 채널 확인 결과', {
      userId: oldState.id,
      userDisplayName: member.displayName,
      channelId,
      channelName,
      excludedChannelsForLogs,
      excludedChannelCount: excludedChannelsForLogs.length,
      isExcluded,
      decision: isExcluded
        ? '로그 차단 (완전 제외 채널)'
        : '로그 진행 (일반 채널 또는 활동 제한 채널)',
      note: isExcluded
        ? '완전 제외 채널은 로그와 활동 추적 모두 제외'
        : '활동 제한 채널은 로그 출력됨',
    });

    if (isExcluded) {
      console.log('[ActivityTracker] 🚫 채널 퇴장 로그 차단됨 (완전 제외 채널)', {
        userId: oldState.id,
        userDisplayName: member.displayName,
        channelId,
        channelName,
        reason: '완전 제외 채널',
      });
      return;
    }

    try {
      console.log('[ActivityTracker] 👥 채널 멤버 목록 조회 중', {
        userId: oldState.id,
        channelId,
        channelName,
      });

      const membersInChannel = await this.logService.getVoiceChannelMembers(
        oldState.channel as VoiceChannel
      );

      console.log('[ActivityTracker] ✅ 채널 멤버 목록 조회 완료', {
        userId: oldState.id,
        channelId,
        channelName,
        memberCount: membersInChannel.length,
        members: membersInChannel,
      });

      const logMessage = `${MESSAGE_TYPES.LEAVE}: \` ${member.displayName} \`님이 \` ${channelName} \`에서 퇴장했습니다.`;

      console.log('[ActivityTracker] 📝 로그 메시지 생성 및 전송 중', {
        userId: oldState.id,
        userDisplayName: member.displayName,
        channelId,
        channelName,
        logMessage,
        memberCount: membersInChannel.length,
      });

      this.logService.logActivity(logMessage, membersInChannel, 'LEAVE', { guildId });

      console.log('[ActivityTracker] 💾 상세 활동 DB 기록 중', {
        userId: oldState.id,
        action: 'LEAVE',
        channelId,
        channelName,
        memberCount: membersInChannel.length,
      });

      await this.db.logDetailedActivity(
        oldState.id,
        'LEAVE',
        channelId,
        channelName,
        membersInChannel
      );

      const processingTime = Date.now() - leaveStartTime;
      console.log('[ActivityTracker] ✅ 채널 퇴장 처리 완료', {
        userId: oldState.id,
        userDisplayName: member.displayName,
        channelId,
        channelName,
        processingTime: `${processingTime}ms`,
        success: true,
      });
    } catch (error) {
      const processingTime = Date.now() - leaveStartTime;
      console.error('[ActivityTracker] ❌ 채널 퇴장 처리 오류', {
        userId: oldState.id,
        userDisplayName: member.displayName,
        channelId,
        channelName,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        processingTime: `${processingTime}ms`,
      });
    }
  }

  /**
   * 길드 멤버 업데이트 이벤트 핸들러
   */
  async handleGuildMemberUpdate(oldMember: GuildMember, newMember: GuildMember): Promise<void> {
    if (!this.isInitialized) return;

    const userId = newMember.id;
    const now = Date.now();

    if (oldMember.displayName !== newMember.displayName && this.options.enableLogging) {
      console.log(
        `[ActivityTracker] 멤버 별명 변경: ${oldMember.displayName} → ${newMember.displayName} (${userId})`
      );
    }

    // 관전/대기 상태 변경 감지
    const wasObserving = this.isObservationOrWaiting(oldMember);
    const isObserving = this.isObservationOrWaiting(newMember);

    if (!wasObserving && isObserving) {
      // 관전/대기 상태로 변경
      await this.handleObservationStateChange(userId, newMember, now, true);
    } else if (wasObserving && !isObserving) {
      // 정상 상태로 변경
      await this.handleObservationStateChange(userId, newMember, now, false);
    }

    // 표시 이름 업데이트
    const userActivity = this.channelActivityTime.get(userId);
    if (userActivity) {
      userActivity.displayName = newMember.displayName;
    }
  }

  /**
   * 관전/대기 상태 변경 처리
   */
  private async handleObservationStateChange(
    userId: string,
    member: GuildMember,
    now: number,
    isEnteringObservation: boolean
  ): Promise<void> {
    try {
      const userActivity = this.channelActivityTime.get(userId);

      if (isEnteringObservation) {
        // 관전/대기 상태 진입 - 활동 시간 기록 중단
        if (userActivity && userActivity.startTime !== null) {
          userActivity.totalTime += now - userActivity.startTime;
          userActivity.startTime = null;

          await this.db.updateUserActivity(
            userId,
            userActivity.totalTime,
            null,
            member.displayName
          );
        }
      } else {
        // 정상 상태 복귀 - 음성 채널에 있으면 활동 시간 기록 재개
        const voiceState = member.voice;
        const guildId = member.guild.id;
        const excludedChannels = await this.getExcludedChannels(guildId);

        if (voiceState?.channelId && !excludedChannels.includes(voiceState.channelId)) {
          if (!userActivity) {
            this.channelActivityTime.set(userId, {
              startTime: now,
              totalTime: 0,
              displayName: member.displayName,
            });
          } else if (userActivity.startTime === null) {
            userActivity.startTime = now;
          }

          const activity = this.channelActivityTime.get(userId)!;
          await this.db.updateUserActivity(userId, activity.totalTime, now, member.displayName);

          this.debounceSaveActivityData();
        }
      }
    } catch (error) {
      console.error('[ActivityTracker] 관전/대기 상태 변경 처리 오류:', error);
    }
  }

  /**
   * 역할별 사용자 분류
   */
  async classifyUsersByRole(
    roleName: string,
    roleMembers: Collection<string, GuildMember>
  ): Promise<UserClassification> {
    try {
      const roleConfig = await this.db.getRoleConfig(roleName);
      const minActivityHours = roleConfig ? roleConfig.minHours : 0;
      const minActivityTime = minActivityHours * 60 * 60 * 1000;
      const resetTime: number | null = roleConfig ? (roleConfig.resetTime ?? null) : null;

      const activeUsers: ClassifiedUser[] = [];
      const inactiveUsers: ClassifiedUser[] = [];
      const afkUsers: ClassifiedUser[] = [];

      for (const [userId, member] of roleMembers) {
        const userActivity = await this.db.getUserActivity(userId);
        const totalTime = userActivity ? userActivity.totalTime : 0;

        const userData: ClassifiedUser = {
          userId,
          nickname: member.displayName,
          totalTime,
        };

        if (member.roles.cache.some((r) => r.name.includes('잠수'))) {
          afkUsers.push(userData);
        } else if (totalTime >= minActivityTime) {
          activeUsers.push(userData);
        } else {
          inactiveUsers.push(userData);
        }
      }

      // 활동 시간 기준 정렬
      const sortByTime = (a: ClassifiedUser, b: ClassifiedUser) => b.totalTime - a.totalTime;
      activeUsers.sort(sortByTime);
      inactiveUsers.sort(sortByTime);
      afkUsers.sort(sortByTime);

      return {
        activeUsers,
        inactiveUsers,
        afkUsers,
        resetTime,
        minHours: minActivityHours,
      };
    } catch (error) {
      console.error('[ActivityTracker] 사용자 분류 오류:', error);
      return {
        activeUsers: [],
        inactiveUsers: [],
        afkUsers: [],
        resetTime: null,
        minHours: 0,
      };
    }
  }

  /**
   * 활동 멤버 데이터 조회
   */
  async getActiveMembersData(guildId?: string): Promise<ClassifiedUser[]> {
    try {
      const activities = await this.db.getAllUserActivity();
      const activeMembers: ClassifiedUser[] = [];
      let guild;
      
      if (guildId) {
        guild = this.client.guilds.cache.get(guildId);
        if (!guild) {
          console.warn(`[ActivityTracker] 길드를 찾을 수 없습니다: ${guildId}`);
          return [];
        }
      } else {
        // guildId가 제공되지 않으면 첫 번째 사용 가능한 길드 사용
        guild = this.client.guilds.cache.first();
        if (!guild) {
          console.warn('[ActivityTracker] 사용 가능한 길드가 없습니다');
          return [];
        }
        console.warn(`[ActivityTracker] guildId가 제공되지 않아 기본 길드 사용: ${guild.name} (${guild.id})`);
      }

      for (const activity of activities) {
        if (activity.totalTime <= 0) continue;

        let displayName = activity.displayName || activity.userId;

        // 디스코드에서 최신 멤버 정보 가져오기
        if (guild) {
          try {
            const member = await guild.members.fetch(activity.userId);
            if (member) {
              displayName = member.displayName;

              // DB에 표시 이름 업데이트
              await this.db.updateUserActivity(
                activity.userId,
                activity.totalTime,
                activity.startTime,
                displayName
              );
            }
          } catch (error) {
            // 멤버를 찾을 수 없는 경우 (탈퇴 등)
            console.warn(`[ActivityTracker] 사용자 정보 조회 실패: ${activity.userId}`);
          }
        }

        activeMembers.push({
          userId: activity.userId,
          nickname: displayName,
          totalTime: activity.totalTime,
        });
      }

      return activeMembers.sort((a, b) => b.totalTime - a.totalTime);
    } catch (error) {
      console.error('[ActivityTracker] 활동 멤버 데이터 조회 오류:', error);
      return [];
    }
  }

  /**
   * 통계 업데이트
   */
  private updateStatistics(change: VoiceStateChange): void {
    const now = Date.now();
    this.stats.uptime = now - this.startTime;
    this.stats.lastActivityTime = change.timestamp;

    if (change.type === 'join') {
      this.stats.totalJoins++;
    } else if (change.type === 'leave') {
      this.stats.totalLeaves++;
    }

    // 현재 활성 사용자 수 계산
    const activeUsers = Array.from(this.channelActivityTime.values()).filter(
      (activity) => activity.startTime !== null
    ).length;

    this.stats.totalActiveUsers = activeUsers;
    this.stats.peakConcurrentUsers = Math.max(this.stats.peakConcurrentUsers, activeUsers);

    // 평균 세션 시간 계산
    const totalSessionTime = Array.from(this.channelActivityTime.values()).reduce(
      (sum, activity) => sum + activity.totalTime,
      0
    );

    this.stats.totalSessionTime = totalSessionTime;
    this.stats.averageSessionTime = activeUsers > 0 ? totalSessionTime / activeUsers : 0;
  }

  /**
   * 주기적 통계 업데이트 스케줄링
   */
  private scheduleStatisticsUpdate(): void {
    setInterval(() => {
      this.stats.uptime = Date.now() - this.startTime;

      const activeUsers = Array.from(this.channelActivityTime.values()).filter(
        (activity) => activity.startTime !== null
      ).length;

      this.stats.totalActiveUsers = activeUsers;
    }, this.options.trackingInterval);
  }

  /**
   * 통계 정보 조회
   */
  getStatistics(): ActivityStats {
    return { ...this.stats };
  }

  /**
   * 현재 활성 사용자 수 조회
   */
  getActiveUserCount(): number {
    return Array.from(this.channelActivityTime.values()).filter(
      (activity) => activity.startTime !== null
    ).length;
  }

  /**
   * 특정 사용자의 활동 정보 조회
   */
  getUserActivityInfo(userId: string): ActivityData | null {
    return this.channelActivityTime.get(userId) || null;
  }

  /**
   * 모든 사용자의 현재 활동 상태 조회
   */
  getAllCurrentActivity(): Map<string, ActivityData> {
    return new Map(this.channelActivityTime);
  }

  /**
   * 역할 설정 업데이트
   */
  async updateRoleConfig(roleName: string, minHours: number): Promise<void> {
    this.roleActivityConfig[roleName] = minHours;
    await this.db.updateRoleConfig(roleName, minHours);
  }

  /**
   * 강제 저장
   */
  async forceSave(): Promise<void> {
    if (this.saveActivityTimeout) {
      clearTimeout(this.saveActivityTimeout);
      this.saveActivityTimeout = null;
    }

    await this.saveActivityData();
  }

  /**
   * 정리 작업
   */
  async cleanup(): Promise<void> {
    try {
      if (this.saveActivityTimeout) {
        clearTimeout(this.saveActivityTimeout);
      }

      await this.saveActivityData();

      if (this.options.enableLogging) {
        console.log('[ActivityTracker] 정리 작업 완료');
      }
    } catch (error) {
      console.error('[ActivityTracker] 정리 작업 오류:', error);
    }
  }
}

// ====================
// 유틸리티 함수
// ====================

/**
 * 시간을 사람이 읽기 쉬운 형태로 변환
 */
export function formatActivityTime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}일 ${hours % 24}시간 ${minutes % 60}분`;
  } else if (hours > 0) {
    return `${hours}시간 ${minutes % 60}분`;
  } else if (minutes > 0) {
    return `${minutes}분 ${seconds % 60}초`;
  } else {
    return `${seconds}초`;
  }
}

/**
 * 활동 데이터 유효성 검사
 */
export function validateActivityData(data: ActivityData): boolean {
  if (typeof data.totalTime !== 'number' || data.totalTime < 0) {
    return false;
  }

  if (data.startTime !== null && (typeof data.startTime !== 'number' || data.startTime < 0)) {
    return false;
  }

  if (data.displayName !== undefined && typeof data.displayName !== 'string') {
    return false;
  }

  return true;
}

/**
 * 사용자 분류 데이터 유효성 검사
 */
export function validateUserClassification(classification: UserClassification): boolean {
  const { activeUsers, inactiveUsers, afkUsers, resetTime, minHours } = classification;

  if (!Array.isArray(activeUsers) || !Array.isArray(inactiveUsers) || !Array.isArray(afkUsers)) {
    return false;
  }

  if (resetTime !== null && typeof resetTime !== 'number') {
    return false;
  }

  if (typeof minHours !== 'number' || minHours < 0) {
    return false;
  }

  return true;
}

/**
 * 활동 통계 요약 생성
 */
export function generateActivitySummary(stats: ActivityStats): string {
  const uptimeHours = Math.floor(stats.uptime / (1000 * 60 * 60));
  const avgSessionHours = Math.floor(stats.averageSessionTime / (1000 * 60 * 60));

  return `
활동 통계 요약:
- 현재 활성 사용자: ${stats.totalActiveUsers}명
- 최대 동시 사용자: ${stats.peakConcurrentUsers}명
- 총 입장 횟수: ${stats.totalJoins}회
- 총 퇴장 횟수: ${stats.totalLeaves}회
- 평균 세션 시간: ${avgSessionHours}시간
- 봇 가동 시간: ${uptimeHours}시간
- 마지막 활동: ${stats.lastActivityTime.toLocaleString('ko-KR')}
  `.trim();
}
