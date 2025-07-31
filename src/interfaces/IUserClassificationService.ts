// src/interfaces/IUserClassificationService.ts - UserClassificationService 인터페이스
import { Collection, GuildMember } from 'discord.js';

// 사용자 데이터 인터페이스
export interface UserData {
  userId: string;
  nickname: string;
  totalTime: number;
  afkUntil?: number;
  joinedAt?: number;
  lastActivity?: number;
  roles?: string[];
  averageSessionTime?: number;
  // 비례 계산 관련 필드
  adjustedMinTime?: number;       // 조정된 기준 시간 (밀리초)
  activityPeriodRatio?: number;   // 활동 가능 기간 비율 (0-1)
  isProportionalApplied?: boolean; // 비례 계산 적용 여부
}

// 역할 설정 인터페이스
export interface RoleSettings {
  minActivityTime: number;
  resetTime: number | null;
  reportCycle: string | null;
  allowedAfkDuration?: number;
  warningThreshold?: number;
}

// 사용자 분류 결과
export interface UserClassificationResult {
  activeUsers: UserData[];
  inactiveUsers: UserData[];
  afkUsers: UserData[];
  resetTime: number | null;
  minHours: number;
  reportCycle?: string | null;
  statistics?: ClassificationStatistics;
}

// 분류 통계
export interface ClassificationStatistics {
  totalUsers: number;
  activePercentage: number;
  inactivePercentage: number;
  afkPercentage: number;
  averageActivityTime: number;
  medianActivityTime: number;
  topActiveUsers: UserData[];
  riskUsers: UserData[];
}

// 서비스 설정
export interface UserClassificationConfig {
  enableDetailedStats: boolean;
  trackRiskUsers: boolean;
  riskThresholdPercentage: number;
  enableAfkWarnings: boolean;
  afkWarningDays: number;
  maxAfkDuration: number;
  enableActivityTrends: boolean;
  cacheDuration: number;
}

/**
 * 사용자 분류 서비스 인터페이스
 */
export interface IUserClassificationService {
  /**
   * 사용자를 활성/비활성/잠수로 분류합니다.
   * @param role - 역할 이름
   * @param roleMembers - 역할 멤버 컬렉션
   * @returns 분류된 사용자 목록과 설정 정보
   */
  classifyUsers(
    role: string,
    roleMembers: Collection<string, GuildMember>
  ): Promise<UserClassificationResult>;

  /**
   * 특정 날짜 범위 내의 사용자를 활성/비활성/잠수로 분류합니다.
   * @param role - 역할 이름
   * @param roleMembers - 역할 멤버 컬렉션
   * @param startDate - 시작 날짜
   * @param endDate - 종료 날짜
   * @returns 분류된 사용자 목록과 설정 정보
   */
  classifyUsersByDateRange(
    role: string,
    roleMembers: Collection<string, GuildMember>,
    startDate: Date | number,
    endDate: Date | number
  ): Promise<UserClassificationResult>;

  /**
   * 역할 설정 가져오기
   * @param role - 역할 이름
   * @param guildId - 길드 ID
   * @returns 역할 설정 객체
   */
  getRoleSettings(role: string, guildId: string): Promise<RoleSettings>;

  /**
   * 사용자 활동 동향 분석
   * @param userId - 사용자 ID
   * @param days - 분석 기간 (일)
   * @returns 활동 동향 정보
   */
  getUserActivityTrend(
    userId: string,
    days?: number
  ): Promise<{
    trend: 'increasing' | 'decreasing' | 'stable';
    weeklyAverage: number;
    dailyActivities: number[];
    prediction: number;
  }>;

  /**
   * 설정 업데이트
   * @param newConfig - 새로운 설정
   */
  updateConfig(newConfig: Partial<UserClassificationConfig>): void;

  /**
   * 캐시 수동 정리
   */
  clearCache(): void;

  /**
   * 서비스 통계 조회
   * @returns 서비스 사용 통계
   */
  getServiceStatistics(): {
    cacheSize: number;
    cacheHitRate: number;
    totalClassifications: number;
    averageClassificationTime: number;
  };
}
