// src/interfaces/IDatabaseManager.ts - 데이터베이스 관리자 인터페이스

import type { UserActivity, RoleConfig } from '../types/database';

/**
 * 데이터베이스 관리자 인터페이스 (간소화 버전)
 * 현재 SQLiteManager 구현에 맞춘 핵심 메서드들
 */
export interface IDatabaseManager {
  // 초기화 및 연결 관리
  initialize(): Promise<boolean>;
  close(): Promise<void>;

  // 데이터 존재 여부 확인
  hasAnyData(): Promise<boolean>;

  // 사용자 활동 데이터 관리 (SQLiteManager의 실제 메서드에 맞춤)
  getUserActivity(userId: string): Promise<UserActivity | null>;
  getAllUserActivity(): Promise<UserActivity[]>;
  updateUserActivity(
    userId: string,
    totalTimeOrActivity: number | Partial<UserActivity>,
    startTime?: number | null,
    displayName?: string | null
  ): Promise<boolean>;
  deleteUserActivity(userId: string): Promise<boolean>;

  // 역할 설정 관리
  getRoleConfig(roleType: string): Promise<RoleConfig | null>;
  getAllRoleConfigs(): Promise<RoleConfig[]>;
  updateRoleConfig(roleName: string, minHours: number): Promise<boolean>;
  updateRoleResetTime(roleName: string, resetTime: number): Promise<boolean>;

  // 데이터 마이그레이션
  migrateFromJSON(activityData: any, roleConfigData: any): Promise<boolean>;

  // 활동 로그 관리
  logActivity(action: string, metadata?: Record<string, any>): Promise<boolean>;
  logDetailedActivity(
    userId: string,
    eventType: string,
    channelId: string,
    channelName: string,
    members?: string[]
  ): Promise<string>;

  // 캐시 관리
  clearCache(): Promise<void>;
  getCacheStats(): { hitRate: number; size: number; maxSize: number };

  // 트랜잭션 지원
  beginTransaction(): Promise<boolean>;
  commitTransaction(): Promise<boolean>;
  rollbackTransaction(): Promise<boolean>;

  // 헬스 체크
  healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: Record<string, any> }>;

  // SQL 쿼리 메서드 (직접 SQL 실행용)
  run(sql: string, params?: any[]): Promise<any>;
  get(sql: string, params?: any[]): Promise<any>;
  all(sql: string, params?: any[]): Promise<any[]>;

  // 추가 메서드
  forceReload?(): void;

  // 날짜 범위별 사용자 활동 조회 (GapCheckCommand에서 사용)
  getUserActivityByDateRange(userId: string, startTime: number, endTime: number): Promise<number>;

  // AFK 상태 관리 (JamsuCommand에서 사용)
  getUserAfkStatus(userId: string): Promise<{
    userId: string;
    isAfk: boolean;
    afkStartTime: number | null;
    afkUntil?: number;
    afkReason?: string;
    totalAfkTime: number;
    lastUpdate: number;
  } | null>;

  setUserAfkStatus(userId: string, displayName: string, untilTimestamp: number): Promise<boolean>;
  clearUserAfkStatus(userId: string): Promise<boolean>;

  // 활동 로그 및 통계 관련 메서드
  getDailyActivityStats(startTime: number, endTime: number): Promise<any[]>;
  getActivityLogs(options: { startDate: Date; endDate: Date }): Promise<any[]>;

  // 채널 매핑 관리 (음성 채널 - 포럼 매핑)
  getAllChannelMappings(): Promise<
    Array<{
      channel_id: string;
      forum_post_id: string;
      thread_id?: string;
      is_active: boolean;
      created_at: number;
      updated_at: number;
    }>
  >;

  saveChannelMapping(
    voiceChannelId: string,
    forumPostId: string,
    lastParticipantCount: number
  ): Promise<boolean>;
  removeChannelMapping(voiceChannelId: string): Promise<boolean>;
  updateLastParticipantCount(voiceChannelId: string, count: number): Promise<boolean>;

  // 포럼 포스트 관리
  saveForumPost(postData: {
    id: string;
    threadId?: string;
    title: string;
    description?: string;
    authorId: string;
    authorName: string;
    voiceChannelId?: string;
    tags?: string[];
    maxParticipants?: number;
    currentParticipants?: number;
    category?: string;
    priority?: string;
    duration?: number;
    requirements?: string[];
    rewards?: string[];
    isActive?: boolean;
  }): Promise<boolean>;

  updateForumPost(
    postId: string,
    updates: {
      threadId?: string;
      title?: string;
      description?: string;
      currentParticipants?: number;
      isActive?: boolean;
      archivedAt?: Date;
      archiveReason?: string;
    }
  ): Promise<boolean>;

  // 추적된 메시지 관리
  getTrackedMessages(threadId: string, messageType: string): Promise<string[]>;
  clearTrackedMessages(threadId: string, messageType: string): Promise<boolean>;
  trackForumMessage(threadId: string, messageType: string, messageId: string): Promise<boolean>;

  // 선택적 메서드 (PostgreSQL 구현에서만 사용)
  forceReload?(): void;
}
