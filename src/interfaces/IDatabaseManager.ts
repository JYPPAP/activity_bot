// src/interfaces/IDatabaseManager.ts - 데이터베이스 관리자 인터페이스

import type {
  UserActivity,
  RoleConfig,
} from '../types/database.js';

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
  updateUserActivity(userId: string, totalTimeOrActivity: number | Partial<UserActivity>, startTime?: number | null, displayName?: string | null): Promise<boolean>;
  deleteUserActivity(userId: string): Promise<boolean>;
  
  // 역할 설정 관리
  getRoleConfig(roleType: string): Promise<RoleConfig | null>;
  getAllRoleConfigs(): Promise<RoleConfig[]>;
  updateRoleConfig(roleName: string, minHours: number, resetTime?: number | null, reportCycle?: number): Promise<boolean>;
  updateRoleResetTime(roleName: string, resetTime: number): Promise<boolean>;
  
  // 데이터 마이그레이션
  migrateFromJSON(activityData: any, roleConfigData: any): Promise<boolean>;
  
  // 활동 로그 관리
  logActivity(action: string, metadata?: Record<string, any>): Promise<boolean>;
  logDetailedActivity(userId: string, eventType: string, channelId: string, channelName: string, members?: string[]): Promise<string>;
  
  // 캐시 관리
  clearCache(): Promise<void>;
  getCacheStats(): { hitRate: number; size: number; maxSize: number };
  
  // 트랜잭션 지원
  beginTransaction(): Promise<boolean>;
  commitTransaction(): Promise<boolean>;
  rollbackTransaction(): Promise<boolean>;
  
  // 헬스 체크
  healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: Record<string, any> }>;
}