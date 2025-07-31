// src/services/UserClassificationService.ts - 잠수 상태 처리 개선
import { Collection, GuildMember } from 'discord.js';
import { injectable, inject } from 'tsyringe';

import type { IActivityTracker } from '../interfaces/IActivityTracker';
import type { IDatabaseManager } from '../interfaces/IDatabaseManager';
import { DI_TOKENS } from '../interfaces/index.js';
import { GuildSettingsManager } from './GuildSettingsManager.js';
import type {
  IUserClassificationService,
  UserData,
  RoleSettings,
  UserClassificationResult,
  ClassificationStatistics,
  UserClassificationConfig,
} from '../interfaces/IUserClassificationService';
import { calculateNextSunday } from '../utils/dateUtils.js';

// 날짜 범위 변환 결과
interface DateRangeResult {
  startOfDay: Date;
  endOfDay: Date;
}

// 잠수 상태 정보 (currently unused)
// interface AfkStatusInfo {
//   afkUntil: number;
//   setAt: number;
//   reason?: string;
//   previousActivity?: number;
// }

@injectable()
export class UserClassificationService implements IUserClassificationService {
  private db: IDatabaseManager;
  private guildSettingsManager: GuildSettingsManager;
  // private _activityTracker: IActivityTracker; // 향후 확장을 위해 보관 - 현재 사용되지 않음
  private config: UserClassificationConfig;
  private classificationCache: Map<string, { result: UserClassificationResult; timestamp: number }>;

  constructor(
    @inject(DI_TOKENS.IDatabaseManager) dbManager: IDatabaseManager,
    @inject(DI_TOKENS.IActivityTracker) _activityTracker: IActivityTracker,
    @inject(DI_TOKENS.IGuildSettingsManager) guildSettingsManager: GuildSettingsManager,
    config: Partial<UserClassificationConfig> = {}
  ) {
    this.db = dbManager;
    this.guildSettingsManager = guildSettingsManager;
    // this._activityTracker = activityTracker; // 향후 확장을 위해 보관 - 현재 사용되지 않음
    this.config = {
      enableDetailedStats: true,
      trackRiskUsers: true,
      riskThresholdPercentage: 20,
      enableAfkWarnings: true,
      afkWarningDays: 7,
      maxAfkDuration: 30 * 24 * 60 * 60 * 1000, // 30일
      enableActivityTrends: true,
      cacheDuration: 300000, // 5분
      ...config,
    };

    this.classificationCache = new Map();

    // 캐시 정리 타이머
    if (this.config.cacheDuration > 0) {
      setInterval(() => this.cleanupCache(), this.config.cacheDuration);
    }
  }

  /**
   * 사용자를 활성/비활성/잠수로 분류합니다.
   * @param role - 역할 이름
   * @param roleMembers - 역할 멤버 컬렉션
   * @returns 분류된 사용자 목록과 설정 정보
   */
  async classifyUsers(
    role: string,
    roleMembers: Collection<string, GuildMember>
  ): Promise<UserClassificationResult> {
    // Extract guild ID from role members
    const guildId = roleMembers.first()?.guild?.id;
    if (!guildId) {
      throw new Error('Guild ID를 찾을 수 없습니다. 역할 멤버가 비어있거나 유효하지 않습니다.');
    }
    
    const cacheKey = `${role}_${roleMembers.size}_${guildId}`;

    // 캐시 확인
    if (this.config.cacheDuration > 0) {
      const cached = this.classificationCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.config.cacheDuration) {
        return cached.result;
      }
    }

    try {
      // 역할 설정 가져오기
      const { minActivityTime, resetTime } = await this.getRoleSettings(role, guildId);

      const activeUsers: UserData[] = [];
      const inactiveUsers: UserData[] = [];
      const afkUsers: UserData[] = [];

      // 각 멤버 분류
      for (const [userId, member] of roleMembers.entries()) {
        const userData = await this.createBasicUserData(userId, member);

        // 잠수 역할 확인
        if (this.hasAfkRole(member)) {
          const userWithAfkStatus = await this.processAfkUser(userId, member, userData);
          afkUsers.push(userWithAfkStatus);
        } else {
          // 활성/비활성 분류
          this.classifyUserByActivityTime(userData, minActivityTime, activeUsers, inactiveUsers);
        }
      }

      // 활동 시간 기준으로 정렬
      this.sortUsersByActivityTime(activeUsers, inactiveUsers, afkUsers);

      const result: UserClassificationResult = {
        activeUsers,
        inactiveUsers,
        afkUsers,
        resetTime,
        minHours: minActivityTime / (60 * 60 * 1000),
      };

      // 상세 통계 생성
      if (this.config.enableDetailedStats) {
        result.statistics = this.generateClassificationStatistics(
          activeUsers,
          inactiveUsers,
          afkUsers
        );
      }

      // 캐시 저장
      if (this.config.cacheDuration > 0) {
        this.classificationCache.set(cacheKey, {
          result,
          timestamp: Date.now(),
        });
      }

      return result;
    } catch (error) {
      console.error(`[UserClassificationService] 분류 중 오류 발생:`, error);
      throw error;
    }
  }

  /**
   * 특정 날짜 범위 내의 사용자를 활성/비활성/잠수로 분류합니다.
   * @param role - 역할 이름
   * @param roleMembers - 역할 멤버 컬렉션
   * @param startDate - 시작 날짜
   * @param endDate - 종료 날짜
   * @returns 분류된 사용자 목록과 설정 정보
   */
  async classifyUsersByDateRange(
    role: string,
    roleMembers: Collection<string, GuildMember>,
    startDate: Date | number,
    endDate: Date | number
  ): Promise<UserClassificationResult> {
    // Extract guild ID from role members
    const guildId = roleMembers.first()?.guild?.id;
    if (!guildId) {
      throw new Error('Guild ID를 찾을 수 없습니다. 역할 멤버가 비어있거나 유효하지 않습니다.');
    }
    
    const classificationStartTime = Date.now();
    console.log(`[분류] 사용자 분류 시작: ${new Date().toISOString()}`);
    console.log(`[분류] 파라미터:`, {
      role,
      guildId,
      memberCount: roleMembers.size,
      startDate: startDate instanceof Date ? startDate.toISOString() : new Date(startDate).toISOString(),
      endDate: endDate instanceof Date ? endDate.toISOString() : new Date(endDate).toISOString()
    });

    try {
      // 역할 설정 가져오기
      console.log(`[분류] 역할 설정 조회 시작: ${role}`);
      const settingsStartTime = Date.now();
      const { minActivityTime, reportCycle } = await this.getRoleSettings(role, guildId);
      console.log(`[분류] 역할 설정 조회 완료: ${Date.now() - settingsStartTime}ms`, {
        minActivityTime,
        reportCycle
      });

      // 날짜 변환
      console.log(`[분류] 날짜 변환 시작`);
      const { startOfDay, endOfDay } = this.convertDatesToTimeRange(startDate, endDate);
      console.log(`[분류] 날짜 변환 완료:`, {
        startOfDay: startOfDay.toISOString(),
        endOfDay: endOfDay.toISOString()
      });

      const activeUsers: UserData[] = [];
      const inactiveUsers: UserData[] = [];
      const afkUsers: UserData[] = [];

      // 각 멤버 분류
      console.log(`[분류] 멤버 처리 시작: ${roleMembers.size}명`);
      let processedCount = 0;
      const batchStartTime = Date.now();
      let cumulativeTime = 0;
      
      for (const [userId, member] of roleMembers.entries()) {
        const userStartTime = Date.now();
        processedCount++;
        
        // 진행률 및 예상 시간 계산
        const progressPercent = Math.round((processedCount / roleMembers.size) * 100);
        const avgTimePerUser = processedCount > 1 ? cumulativeTime / (processedCount - 1) : 0;
        const estimatedRemaining = avgTimePerUser > 0 
          ? Math.round((roleMembers.size - processedCount + 1) * avgTimePerUser / 1000) 
          : 'N/A';
        
        console.log(`[분류] 사용자 처리 시작 [${processedCount}/${roleMembers.size}] (${progressPercent}%): ${member.displayName} (${userId})`);
        console.log(`[분류] 예상 잔여 시간: ${estimatedRemaining}초, 현재까지 평균: ${avgTimePerUser.toFixed(0)}ms/user`);
        
        try {
          const createDataStartTime = Date.now();
          const userData = await this.createUserDataByDateRange(userId, member, startOfDay, endOfDay);
          const createDataTime = Date.now() - createDataStartTime;
          
          console.log(`[분류] 사용자 데이터 생성 완료: ${member.displayName}, DB 조회시간: ${createDataTime}ms, 활동시간: ${userData.totalTime}ms`);

          // 비례 계산 적용
          const proportionalResult = this.calculateProportionalMinTime(
            member,
            minActivityTime,
            startOfDay,
            endOfDay
          );
          
          // 비례 계산 정보를 userData에 추가
          userData.adjustedMinTime = proportionalResult.adjustedMinTime;
          userData.activityPeriodRatio = proportionalResult.activityPeriodRatio;
          userData.isProportionalApplied = proportionalResult.isProportionalApplied;

          // 잠수 역할 확인
          if (this.hasAfkRole(member)) {
            console.log(`[분류] 잠수 역할 감지: ${member.displayName}`);
            const afkStartTime = Date.now();
            
            const userWithAfkStatus = await this.processAfkUser(userId, member, userData);
            // 잠수 사용자에게도 비례 계산 정보 적용
            userWithAfkStatus.adjustedMinTime = proportionalResult.adjustedMinTime;
            userWithAfkStatus.activityPeriodRatio = proportionalResult.activityPeriodRatio;
            userWithAfkStatus.isProportionalApplied = proportionalResult.isProportionalApplied;
            
            const afkProcessTime = Date.now() - afkStartTime;
            console.log(`[분류] 잠수 처리 완료: ${member.displayName}, 소요시간: ${afkProcessTime}ms`);
            afkUsers.push(userWithAfkStatus);
          } else {
            // 활성/비활성 분류 - 비례 계산된 기준 시간 사용
            console.log(`[분류] 활성/비활성 분류 중: ${member.displayName}`);
            this.classifyUserByActivityTime(userData, proportionalResult.adjustedMinTime, activeUsers, inactiveUsers);
            
            const isActive = userData.totalTime >= proportionalResult.adjustedMinTime;
            console.log(`[분류] 분류 완료: ${member.displayName} -> ${isActive ? '활성' : '비활성'} 사용자`);
          }
          
          const totalUserTime = Date.now() - userStartTime;
          cumulativeTime += totalUserTime;
          console.log(`[분류] 사용자 처리 완료: ${member.displayName}, 총 소요시간: ${totalUserTime}ms`);
          
          // 10명마다 진행 상황 요약
          if (processedCount % 10 === 0) {
            const elapsed = Date.now() - batchStartTime;
            console.log(`[분류] === 진행 상황 요약 ===`);
            console.log(`[분류] 처리 완료: ${processedCount}/${roleMembers.size}명`);
            console.log(`[분류] 경과 시간: ${(elapsed / 1000).toFixed(1)}초`);
            console.log(`[분류] 평균 처리 시간: ${(cumulativeTime / processedCount).toFixed(0)}ms/user`);
            console.log(`[분류] 현재까지 - 활성: ${activeUsers.length}, 비활성: ${inactiveUsers.length}, AFK: ${afkUsers.length}`);
            console.log(`[분류] ===================`);
          }
          
        } catch (userError) {
          const userErrorTime = Date.now() - userStartTime;
          cumulativeTime += userErrorTime;
          console.error(`[분류] 사용자 처리 실패: ${member.displayName}, 소요시간: ${userErrorTime}ms`, userError);
          
          // 에러가 발생해도 계속 진행
          inactiveUsers.push({
            userId,
            nickname: member.displayName,
            totalTime: 0,
          });
        }
      }
      
      const totalBatchTime = Date.now() - batchStartTime;
      console.log(`[분류] 모든 멤버 처리 완료: ${processedCount}명`);
      console.log(`[분류] 배치 처리 시간: ${(totalBatchTime / 1000).toFixed(1)}초`);
      console.log(`[분류] 평균 처리 시간: ${(cumulativeTime / processedCount).toFixed(0)}ms/user`);
      console.log(`[분류] 전체 분류 소요시간: ${Date.now() - classificationStartTime}ms`);
      console.log(`[분류] 분류 결과:`, {
        activeCount: activeUsers.length,
        inactiveCount: inactiveUsers.length,
        afkCount: afkUsers.length
      });

      // 활동 시간 기준으로 정렬
      this.sortUsersByActivityTime(activeUsers, inactiveUsers, afkUsers);

      const result: UserClassificationResult = {
        activeUsers,
        inactiveUsers,
        afkUsers,
        resetTime: null,
        minHours: minActivityTime / (60 * 60 * 1000),
        reportCycle,
      };

      // 상세 통계 생성
      if (this.config.enableDetailedStats) {
        result.statistics = this.generateClassificationStatistics(
          activeUsers,
          inactiveUsers,
          afkUsers
        );
      }

      return result;
    } catch (error) {
      console.error(`[UserClassificationService] 날짜 범위 분류 중 오류 발생:`, error);
      throw error;
    }
  }

  /**
   * 역할 설정 가져오기
   * @param role - 역할 이름
   * @param guildId - 길드 ID
   * @returns 역할 설정 객체
   */
  async getRoleSettings(role: string, guildId: string): Promise<RoleSettings> {
    try {
      const roleConfig = await this.guildSettingsManager.getRoleActivityTime(guildId, role);
      const minActivityHours = roleConfig?.minHours || 0;
      const minActivityTime = minActivityHours * 60 * 60 * 1000;
      const resetTime = null; // GuildSettingsManager doesn't have resetTime - using null for now
      const reportCycle = null; // GuildSettingsManager doesn't have reportCycle - using null for now

      return {
        minActivityTime,
        resetTime,
        reportCycle,
        allowedAfkDuration: roleConfig?.allowedAfkDuration || this.config.maxAfkDuration,
        warningThreshold: roleConfig?.warningThreshold || minActivityTime * 0.5,
      };
    } catch (error) {
      console.error(`[UserClassificationService] 역할 설정 조회 실패:`, error);
      return {
        minActivityTime: 0,
        resetTime: null,
        reportCycle: null,
      };
    }
  }

  /**
   * 날짜를 시간 범위로 변환
   * @param startDate - 시작 날짜
   * @param endDate - 종료 날짜
   * @returns 시작일과 종료일 객체
   */
  convertDatesToTimeRange(startDate: Date | number, endDate: Date | number): DateRangeResult {
    const startTimestamp = startDate instanceof Date ? startDate.getTime() : Number(startDate);
    const endTimestamp = endDate instanceof Date ? endDate.getTime() : Number(endDate);

    const startOfDay = new Date(startTimestamp);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(endTimestamp);
    endOfDay.setHours(23, 59, 59, 999);

    return { startOfDay, endOfDay };
  }

  /**
   * 기본 사용자 데이터 생성
   * @param userId - 사용자 ID
   * @param member - 멤버 객체
   * @returns 사용자 데이터 객체
   */
  async createBasicUserData(userId: string, member: GuildMember): Promise<UserData> {
    try {
      const userActivity = await this.db.getUserActivity(userId);

      const userData: UserData = {
        userId,
        nickname: member.displayName,
        totalTime: userActivity?.totalTime || 0,
      };

      // 추가 정보 수집
      if (this.config.enableActivityTrends) {
        if (member.joinedTimestamp) {
          userData.joinedAt = member.joinedTimestamp;
        }
        if (userActivity?.lastActivity) {
          userData.lastActivity = userActivity.lastActivity;
        }
        userData.roles = member.roles.cache.map((role) => role.name);
      }

      return userData;
    } catch (error) {
      console.error(`[UserClassificationService] 기본 사용자 데이터 생성 실패:`, error);
      return {
        userId,
        nickname: member.displayName,
        totalTime: 0,
      };
    }
  }

  /**
   * 특정 날짜 범위의 사용자 데이터 생성
   * @param userId - 사용자 ID
   * @param member - 멤버 객체
   * @param startOfDay - 시작일
   * @param endOfDay - 종료일
   * @returns 사용자 데이터 객체
   */
  async createUserDataByDateRange(
    userId: string,
    member: GuildMember,
    startOfDay: Date,
    endOfDay: Date
  ): Promise<UserData> {
    const queryStartTime = Date.now();
    console.log(`[DB쿼리] 활동시간 조회 시작: ${member.displayName} (${userId})`);
    console.log(`[DB쿼리] 조회 범위: ${startOfDay.toISOString()} ~ ${endOfDay.toISOString()}`);
    
    try {
      // 타임아웃이 있는 Promise로 DB 쿼리 실행
      let timeoutId: NodeJS.Timeout;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          console.error(`[DB쿼리] ⚠️ 타임아웃 발생! 30초 초과: ${member.displayName} (${userId})`);
          reject(new Error(`DB 쿼리 타임아웃 (30초 초과): ${member.displayName}`));
        }, 30000);
      });
      
      console.log(`[DB쿼리] getUserActivityByDateRange 호출 중...`);
      const queryPromise = this.db.getUserActivityByDateRange(
        userId,
        startOfDay.getTime(),
        endOfDay.getTime()
      );

      console.log(`[DB쿼리] Promise.race 시작: ${member.displayName}`);
      const activityTime = await Promise.race([queryPromise, timeoutPromise]);
      
      // 타임아웃 클리어
      clearTimeout(timeoutId!);
      
      const queryTime = Date.now() - queryStartTime;
      console.log(`[DB쿼리] 활동시간 조회 완료: ${member.displayName}, 소요시간: ${queryTime}ms, 결과: ${activityTime}ms`);
      
      // 쿼리 시간이 5초 이상 걸린 경우 경고
      if (queryTime > 5000) {
        console.warn(`[DB쿼리] ⚠️ 느린 쿼리 감지: ${member.displayName}, 소요시간: ${queryTime}ms`);
      }

      const userData: UserData = {
        userId,
        nickname: member.displayName,
        totalTime: activityTime || 0,
      };

      // 추가 정보 수집
      if (this.config.enableActivityTrends) {
        console.log(`[DB쿼리] 추가 정보 수집 중: ${member.displayName}`);
        if (member.joinedTimestamp) {
          userData.joinedAt = member.joinedTimestamp;
        }
        userData.roles = member.roles.cache.map((role) => role.name);
        console.log(`[DB쿼리] 추가 정보 수집 완료: ${member.displayName}`, {
          joinedAt: userData.joinedAt,
          rolesCount: userData.roles?.length
        });
      }

      const totalTime = Date.now() - queryStartTime;
      console.log(`[DB쿼리] 사용자 데이터 생성 총 완료: ${member.displayName}, 총 소요시간: ${totalTime}ms`);
      
      return userData;
    } catch (error) {
      const errorTime = Date.now() - queryStartTime;
      console.error(`[DB쿼리] 사용자 데이터 생성 실패: ${member.displayName}, 소요시간: ${errorTime}ms`, {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        userId,
        startTime: startOfDay.toISOString(),
        endTime: endOfDay.toISOString()
      });
      
      // 에러가 발생해도 기본 데이터는 반환
      return {
        userId,
        nickname: member.displayName,
        totalTime: 0,
      };
    }
  }

  /**
   * 멤버가 잠수 역할을 가지고 있는지 확인
   * @param member - 멤버 객체
   * @returns 잠수 역할 여부
   */
  hasAfkRole(member: GuildMember): boolean {
    return member.roles.cache.some((r) => r.name === '잠수');
  }

  /**
   * 잠수 사용자 처리 (개선된 버전)
   * @param userId - 사용자 ID
   * @param member - 멤버 객체
   * @param userData - 사용자 데이터 객체
   * @returns 업데이트된 사용자 데이터
   */
  async processAfkUser(userId: string, member: GuildMember, userData: UserData): Promise<UserData> {
    console.log(`[잠수처리] 시작: userId=${userId}, nickname=${member.displayName}`);

    try {
      // DB 강제 새로고침 (선택적 메서드)
      if (this.db.forceReload) {
        this.db.forceReload();
      }

      // 별도 테이블에서 잠수 상태 조회
      const afkStatus = await this.db.getUserAfkStatus(userId);
      console.log(`[잠수처리] DB 조회 결과:`, afkStatus);

      if (afkStatus?.afkUntil) {
        console.log(
          `[잠수처리] 기존 잠수 데이터 사용: ${new Date(afkStatus.afkUntil).toISOString()}`
        );
        userData.afkUntil = afkStatus.afkUntil;

        // 잠수 기간 검증
        if (this.config.enableAfkWarnings) {
          this.checkAfkDuration(userData, afkStatus.afkUntil);
        }
      } else {
        console.log(`[잠수처리] 새로운 잠수 기한 설정`);
        // 다음 일요일 계산
        const nextSunday = calculateNextSunday(new Date());
        const afkUntilTimestamp = nextSunday.getTime();

        console.log(`[잠수처리] 계산된 기한: ${new Date(afkUntilTimestamp).toISOString()}`);

        // DB에 저장
        const saveResult = await this.db.setUserAfkStatus(
          userId,
          member.displayName,
          afkUntilTimestamp
        );
        console.log(`[잠수처리] 저장 결과: ${saveResult}`);

        if (saveResult) {
          userData.afkUntil = afkUntilTimestamp;

          // 저장 후 검증
          const verifyAfkStatus = await this.db.getUserAfkStatus(userId);
          console.log(`[잠수처리] 저장 후 검증:`, verifyAfkStatus);
        } else {
          console.error(`[잠수처리] 저장 실패 - 기본값 사용`);
          userData.afkUntil = afkUntilTimestamp;
        }
      }

      console.log(`[잠수처리] 최종 userData:`, userData);
      return userData;
    } catch (error) {
      console.error(`[잠수처리] 오류 발생:`, error);

      // 오류 발생 시 기본값 설정
      const fallbackDate = calculateNextSunday(new Date());
      userData.afkUntil = fallbackDate.getTime();

      console.log(
        `[잠수처리] 오류 복구 - 기본값 설정: ${new Date(userData.afkUntil).toISOString()}`
      );
      return userData;
    }
  }

  /**
   * 활동 시간 기준으로 사용자 분류
   * @param userData - 사용자 데이터 객체
   * @param minActivityTime - 최소 활동 시간(밀리초)
   * @param activeUsers - 활성 사용자 배열
   * @param inactiveUsers - 비활성 사용자 배열
   */
  classifyUserByActivityTime(
    userData: UserData,
    minActivityTime: number,
    activeUsers: UserData[],
    inactiveUsers: UserData[]
  ): void {
    if (userData.totalTime >= minActivityTime) {
      activeUsers.push(userData);
    } else {
      inactiveUsers.push(userData);
    }
  }

  /**
   * 비례 계산된 최소 활동 시간 계산
   * @param member - 길드 멤버
   * @param minActivityTime - 기본 최소 활동 시간 (밀리초)
   * @param startDate - 평가 기간 시작일
   * @param endDate - 평가 기간 종료일
   * @returns 조정된 최소 활동 시간과 관련 정보
   */
  private calculateProportionalMinTime(
    member: GuildMember,
    minActivityTime: number,
    startDate: Date,
    endDate: Date
  ): {
    adjustedMinTime: number;
    activityPeriodRatio: number;
    isProportionalApplied: boolean;
  } {
    // 멤버의 서버 가입일
    const joinedTimestamp = member.joinedTimestamp;
    if (!joinedTimestamp) {
      return {
        adjustedMinTime: minActivityTime,
        activityPeriodRatio: 1,
        isProportionalApplied: false,
      };
    }

    const joinedDate = new Date(joinedTimestamp);
    
    // 평가 기간 시작일보다 먼저 가입한 경우 비례 계산 불필요
    if (joinedDate <= startDate) {
      return {
        adjustedMinTime: minActivityTime,
        activityPeriodRatio: 1,
        isProportionalApplied: false,
      };
    }

    // 평가 기간 종료일 이후 가입한 경우 (일반적으로 발생하지 않음)
    if (joinedDate >= endDate) {
      return {
        adjustedMinTime: 0,
        activityPeriodRatio: 0,
        isProportionalApplied: true,
      };
    }

    // 전체 평가 기간 (밀리초)
    const totalPeriod = endDate.getTime() - startDate.getTime();
    
    // 실제 활동 가능 기간 (밀리초)
    const actualPeriod = endDate.getTime() - joinedDate.getTime();
    
    // 활동 가능 기간 비율 계산
    const activityPeriodRatio = actualPeriod / totalPeriod;
    
    // 조정된 최소 활동 시간 계산
    const adjustedMinTime = Math.ceil(minActivityTime * activityPeriodRatio);

    console.log(`[분류-비례계산] 사용자 ${member.displayName} - 가입일: ${joinedDate.toISOString()}, 비율: ${(activityPeriodRatio * 100).toFixed(1)}%, 조정된 기준: ${(adjustedMinTime / (60 * 60 * 1000)).toFixed(1)}시간`);

    return {
      adjustedMinTime,
      activityPeriodRatio,
      isProportionalApplied: true,
    };
  }

  /**
   * 사용자 목록 정렬
   * @param activeUsers - 활성 사용자 배열
   * @param inactiveUsers - 비활성 사용자 배열
   * @param afkUsers - 잠수 사용자 배열
   */
  sortUsersByActivityTime(
    activeUsers: UserData[],
    inactiveUsers: UserData[],
    afkUsers: UserData[]
  ): void {
    const sortFn = (a: UserData, b: UserData) => b.totalTime - a.totalTime;

    activeUsers.sort(sortFn);
    inactiveUsers.sort(sortFn);
    afkUsers.sort(sortFn);
  }

  /**
   * 분류 통계 생성
   * @param activeUsers - 활성 사용자 배열
   * @param inactiveUsers - 비활성 사용자 배열
   * @param afkUsers - 잠수 사용자 배열
   * @returns 분류 통계
   */
  generateClassificationStatistics(
    activeUsers: UserData[],
    inactiveUsers: UserData[],
    afkUsers: UserData[]
  ): ClassificationStatistics {
    const totalUsers = activeUsers.length + inactiveUsers.length + afkUsers.length;
    const allUsers = [...activeUsers, ...inactiveUsers, ...afkUsers];

    // 활동 시간 통계
    const activityTimes = allUsers.map((u) => u.totalTime).filter((t) => t > 0);
    const averageActivityTime =
      activityTimes.length > 0
        ? activityTimes.reduce((sum, time) => sum + time, 0) / activityTimes.length
        : 0;

    // 중앙값 계산
    const sortedTimes = [...activityTimes].sort((a, b) => a - b);
    const medianActivityTime =
      sortedTimes.length > 0 ? sortedTimes[Math.floor(sortedTimes.length / 2)] : 0;

    // 위험 사용자 식별
    const riskUsers: UserData[] = [];
    if (this.config.trackRiskUsers) {
      const riskThreshold = averageActivityTime * (this.config.riskThresholdPercentage / 100);
      riskUsers.push(
        ...inactiveUsers.filter((u) => u.totalTime > 0 && u.totalTime < riskThreshold)
      );
    }

    return {
      totalUsers,
      activePercentage: totalUsers > 0 ? (activeUsers.length / totalUsers) * 100 : 0,
      inactivePercentage: totalUsers > 0 ? (inactiveUsers.length / totalUsers) * 100 : 0,
      afkPercentage: totalUsers > 0 ? (afkUsers.length / totalUsers) * 100 : 0,
      averageActivityTime,
      medianActivityTime,
      topActiveUsers: activeUsers.slice(0, 10),
      riskUsers,
    };
  }

  /**
   * 잠수 기간 검증
   * @param userData - 사용자 데이터
   * @param afkUntil - 잠수 종료 시간
   */
  private checkAfkDuration(userData: UserData, afkUntil: number): void {
    const now = Date.now();
    const afkDuration = afkUntil - now;

    if (afkDuration > this.config.maxAfkDuration) {
      console.warn(
        `[잠수처리] 과도한 잠수 기간: ${userData.nickname} (${Math.floor(afkDuration / (24 * 60 * 60 * 1000))}일)`
      );
    }

    // 잠수 만료 임박 확인
    const warningTime = this.config.afkWarningDays * 24 * 60 * 60 * 1000;
    if (afkDuration > 0 && afkDuration < warningTime) {
      console.log(
        `[잠수처리] 잠수 만료 임박: ${userData.nickname} (${Math.floor(afkDuration / (24 * 60 * 60 * 1000))}일 남음)`
      );
    }
  }

  /**
   * 캐시 정리
   */
  private cleanupCache(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [key, value] of this.classificationCache.entries()) {
      if (now - value.timestamp > this.config.cacheDuration) {
        expired.push(key);
      }
    }

    expired.forEach((key) => this.classificationCache.delete(key));

    if (expired.length > 0) {
      console.log(`[UserClassificationService] 캐시 정리: ${expired.length}개 항목 삭제`);
    }
  }

  /**
   * 사용자 활동 동향 분석
   * @param userId - 사용자 ID
   * @param days - 분석 기간 (일)
   * @returns 활동 동향 정보
   */
  async getUserActivityTrend(
    userId: string,
    days: number = 7
  ): Promise<{
    trend: 'increasing' | 'decreasing' | 'stable';
    weeklyAverage: number;
    dailyActivities: number[];
    prediction: number;
  }> {
    if (!this.config.enableActivityTrends) {
      throw new Error('활동 동향 분석이 비활성화되어 있습니다.');
    }

    const now = Date.now();
    const startTime = now - days * 24 * 60 * 60 * 1000;

    // 일별 활동 데이터 수집
    const dailyActivities: number[] = [];
    for (let i = 0; i < days; i++) {
      const dayStart = startTime + i * 24 * 60 * 60 * 1000;
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;

      const dayActivity = await this.db.getUserActivityByDateRange(userId, dayStart, dayEnd);
      dailyActivities.push(dayActivity || 0);
    }

    // 추세 분석
    const weeklyAverage = dailyActivities.reduce((sum, activity) => sum + activity, 0) / days;
    const firstHalf = dailyActivities.slice(0, Math.floor(days / 2));
    const secondHalf = dailyActivities.slice(Math.floor(days / 2));

    const firstHalfAvg = firstHalf.reduce((sum, activity) => sum + activity, 0) / firstHalf.length;
    const secondHalfAvg =
      secondHalf.reduce((sum, activity) => sum + activity, 0) / secondHalf.length;

    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    const changeThreshold = weeklyAverage * 0.1; // 10% 변화 임계값

    if (secondHalfAvg > firstHalfAvg + changeThreshold) {
      trend = 'increasing';
    } else if (secondHalfAvg < firstHalfAvg - changeThreshold) {
      trend = 'decreasing';
    }

    // 단순 선형 예측
    const prediction =
      trend === 'increasing'
        ? secondHalfAvg * 1.1
        : trend === 'decreasing'
          ? secondHalfAvg * 0.9
          : weeklyAverage;

    return {
      trend,
      weeklyAverage,
      dailyActivities,
      prediction,
    };
  }

  /**
   * 설정 업데이트
   * @param newConfig - 새로운 설정
   */
  updateConfig(newConfig: Partial<UserClassificationConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // 캐시 정리가 비활성화된 경우 기존 캐시 삭제
    if (newConfig.cacheDuration === 0) {
      this.classificationCache.clear();
    }
  }

  /**
   * 캐시 수동 정리
   */
  clearCache(): void {
    this.classificationCache.clear();
    console.log('[UserClassificationService] 캐시가 수동으로 정리되었습니다.');
  }

  /**
   * 서비스 통계 조회
   * @returns 서비스 사용 통계
   */
  getServiceStatistics(): {
    cacheSize: number;
    cacheHitRate: number;
    totalClassifications: number;
    averageClassificationTime: number;
  } {
    // 간단한 통계 반환 (실제 구현에서는 더 상세한 메트릭 수집)
    return {
      cacheSize: this.classificationCache.size,
      cacheHitRate: 0, // 실제 구현에서는 히트율 계산
      totalClassifications: 0, // 실제 구현에서는 총 분류 횟수
      averageClassificationTime: 0, // 실제 구현에서는 평균 처리 시간
    };
  }
}
