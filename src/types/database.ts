// src/types/database.ts - 데이터베이스 관련 타입 정의

import {
  ActivityLogEntry,
  AfkStatus,
  ForumMessageData,
  VoiceChannelMapping,
  UserActivity,
  RoleConfig,
} from './index.js';

// Re-export types for interfaces
export { UserActivity, RoleConfig } from './index';

// ====================
// 추가 데이터베이스 타입
// ====================

export interface ActivityData {
  startTime: number | null;
  totalTime: number;
  displayName?: string;
}

export interface UserGap {
  userId: string;
  gapStart: number;
  gapEnd?: number;
  reason?: string;
  isActive: boolean;
  metadata?: Record<string, any>;
}

export interface UserStatistics {
  userId: string;
  totalTime: number;
  averageSessionTime: number;
  totalSessions: number;
  lastActiveTime: Date;
  activityTrend: 'increasing' | 'decreasing' | 'stable';
  weeklyStats: {
    week: string;
    totalTime: number;
    sessionCount: number;
  }[];
}

export interface GapAnalysisReport {
  roleType: string;
  period: { start: Date; end: Date };
  totalUsers: number;
  usersWithGaps: number;
  averageGapDuration: number;
  longestGap: { userId: string; duration: number };
  shortestGap: { userId: string; duration: number };
  gapsByDay: Record<string, number>;
  recommendations: string[];
}

export interface DatabaseError {
  code: string;
  message: string;
  details?: Record<string, any>;
  timestamp: Date;
  operation?: string;
  query?: string;
}

// ====================
// 데이터베이스 스키마 타입
// ====================

export interface DatabaseSchema {
  user_activity: Record<string, UserActivity>;
  role_config: Record<string, RoleConfig>;
  activity_logs: ActivityLogEntry[];
  reset_history: ResetHistoryEntry[];
  log_members: Record<string, any>; // 실제 사용 방식에 맞춰 any로 임시 설정
  afk_status: Record<string, AfkStatus>;
  forum_messages: Record<string, ForumMessageData>;
  voice_channel_mappings: Record<string, VoiceChannelMapping>;
  metadata: {
    version: string;
    created_at: number;
    last_updated: number;
  };
}

export interface ResetHistoryEntry {
  id: number;
  roleName: string;
  resetTime: number;
  reason: string;
}

// ====================
// 데이터베이스 설정 타입
// ====================

export interface DatabaseConfig {
  path?: string;
  backup?: boolean;
  backupInterval?: number;
  maxBackups?: number;
  cacheTimeout?: number;
  autoBackup?: boolean;
  validation?: boolean;
}

export interface CacheConfig {
  maxSize?: number;
  maxAge?: number;
  checkInterval?: number;
  evictionPolicy?: 'lru' | 'lfu' | 'fifo' | 'random';
  serialize?: boolean;
  compress?: boolean;
}
