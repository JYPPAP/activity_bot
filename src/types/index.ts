// src/types/index.ts - 공통 타입 정의

import { Client } from 'discord.js';

// ====================
// 환경 설정 타입
// ====================

export interface Config {
  // 필수 환경변수
  TOKEN: string;
  CLIENT_ID: string;

  // 선택적 환경변수 (DB에서 우선 관리)
  LOG_CHANNEL_ID?: string;
  DEV_ID?: string;

  // 구인구직 포럼 관련 (DB에서 관리, fallback용)
  FORUM_CHANNEL_ID?: string;
  VOICE_CATEGORY_ID?: string;
  FORUM_TAG_ID?: string;

  // PostgreSQL 데이터베이스 설정 (필수)
  POSTGRES_HOST: string;
  POSTGRES_PORT: string;
  POSTGRES_DB: string;
  POSTGRES_USER: string;
  POSTGRES_PASSWORD: string;
  POSTGRES_SSL?: string;

  // Errsole 설정
  NODE_ENV?: string;
  ERRSOLE_HOST?: string;
  ERRSOLE_PORT?: string;

  // Slack 알림 설정
  ENABLE_SLACK_ALERTS?: string;
  SLACK_WEBHOOK_URL?: string;
  SLACK_CHANNEL?: string;
  SLACK_MIN_LEVEL?: string;
  PHONE_IP?: string;
}

// ====================
// 서비스 인터페이스
// ====================

import type { IDatabaseManager } from '../interfaces/IDatabaseManager';

export interface ServiceDependencies {
  client: Client;
  dbManager: IDatabaseManager;
  logService?: LogService;
  activityTracker?: ActivityTracker;
}

export interface LogService {
  log(message: string, data?: any): void;
  error(message: string, error: Error | any): void;
  logActivity(message: string, members: string[], action: string, data?: any): void;
  handleChannelUpdate(oldChannel: any, newChannel: any): Promise<void>;
  handleChannelCreate(channel: any): Promise<void>;
}

export interface ActivityTracker {
  loadActivityData(): Promise<void>;
  loadRoleActivityConfig(guildId?: string): Promise<void>;
  getUserActivityTime(userId: string): Promise<number>;
  getRoleActivityConfig(roleName: string): number;
  saveActivityData(): Promise<{ savedUsers: number; dataSize: number }>;
  clearAndReinitializeActivityData(role: string): Promise<void>;
  clearUserActivityData(userIds: string[]): boolean;
  initializeActivityData(guild: any): Promise<void>;
  getAllActivityData(): Promise<any>;
  handleVoiceStateUpdate(oldState: any, newState: any): Promise<void>;
  handleGuildMemberUpdate(oldMember: any, newMember: any): Promise<void>;
}

// ====================
// 활동 데이터 타입
// ====================

export interface UserActivity {
  userId: string;
  totalTime: number;
  startTime: number | null;
  lastUpdate: number;
  lastActivity?: number;
  displayName?: string;
  currentChannelId?: string;
  sessionStartTime?: number;
  dailyTime?: number;
  weeklyTime?: number;
  monthlyTime?: number;
}

export interface UserActivityData {
  totalTime: number;
  startTime: number | null;
  lastUpdate?: number;
}

export interface RoleConfig {
  roleName: string;
  minHours: number;
  createdAt: number;
  updatedAt: number;
  role?: string;
  warningThreshold?: number;
  allowedAfkDuration?: number;
  resetTime?: number;
  reportCycle?: string;
}

export interface ActivityLogEntry {
  id?: string;
  userId: string;
  userName: string;
  channelId: string;
  channelName: string;
  action: 'join' | 'leave' | 'move' | 'disconnect';
  timestamp: number;
  duration?: number;
  additionalData?: Record<string, any>;
}

export interface ResetHistoryEntry {
  id: string;
  timestamp: number;
  reason: string;
  data: any;
  resetType?: 'partial' | 'full';
  affectedUsers?: string[];
}

export interface LogQueryOptions {
  userId?: string;
  channelId?: string;
  startDate?: Date;
  endDate?: Date;
  action?: string;
  limit?: number;
  offset?: number;
}

// ====================
// 잠수 상태 타입
// ====================

export interface AfkStatus {
  userId: string;
  isAfk: boolean;
  afkStartTime: number | null;
  afkUntil?: number;
  afkReason?: string;
  totalAfkTime: number;
  lastUpdate: number;
}

export interface AfkStatusData {
  isAfk: boolean;
  afkStartTime: number | null;
  afkReason?: string;
  totalAfkTime?: number;
}

// ====================
// 포럼 관련 타입
// ====================

export interface ForumMessage {
  channelId: string;
  messageId: string;
  authorId: string;
  content: string;
  timestamp: number;
  lastUpdate: number;
}

export interface ForumMessageData {
  messageId: string;
  authorId: string;
  content: string;
  timestamp: number;
}

export interface VoiceChannelMapping {
  channelId: string;
  forumPostId: string;
  threadId: string;
  createdAt: number;
  isActive: boolean;
}

export interface VoiceChannelMappingData {
  forumPostId: string;
  threadId: string;
  isActive?: boolean;
}

// ====================
// 유틸리티 타입
// ====================

export interface EmbedOptions {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer?: {
    text: string;
    iconURL?: string;
  };
  timestamp?: Date;
  thumbnail?: {
    url: string;
  };
  image?: {
    url: string;
  };
}

export interface PaginationOptions {
  page: number;
  limit: number;
  total: number;
}

export interface DateRange {
  start: Date;
  end: Date;
}

// ====================
// 이벤트 타입
// ====================

export interface BotEvent {
  name: string;
  once?: boolean;
  execute: (...args: any[]) => Promise<void> | void;
}

export interface ActivityEvent {
  userId: string;
  channelId: string;
  action: string;
  timestamp: number;
  data?: Record<string, any>;
}

// ====================
// 응답 타입
// ====================

export interface CommandResponse {
  success: boolean;
  message?: string;
  data?: any;
  error?: string;
}

export interface ServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ====================
// 통계 타입
// ====================

export interface ActivityStats {
  totalUsers: number;
  totalTime: number;
  averageTime: number;
  topUsers: Array<{
    userId: string;
    userName: string;
    totalTime: number;
  }>;
  dailyActivity: Array<{
    date: string;
    totalTime: number;
    userCount: number;
  }>;
}

export interface UserStats {
  userId: string;
  userName: string;
  totalTime: number;
  sessionCount: number;
  averageSessionTime: number;
  lastActivity: number;
  favoriteChannels: Array<{
    channelId: string;
    channelName: string;
    timeSpent: number;
  }>;
}

// ====================
// 에러 타입
// ====================

export interface BotError extends Error {
  code?: string;
  context?: Record<string, any>;
  timestamp?: number;
}

export interface DatabaseError extends Error {
  query?: string;
  params?: any[];
  sqlState?: string;
}

// ====================
// 타입 가드 함수
// ====================

export function isUserActivity(obj: any): obj is UserActivity {
  return obj && typeof obj.userId === 'string' && typeof obj.totalTime === 'number';
}

export function isActivityLogEntry(obj: any): obj is ActivityLogEntry {
  return obj && typeof obj.userId === 'string' && typeof obj.action === 'string';
}

export function isConfig(obj: any): obj is Config {
  return obj && typeof obj.TOKEN === 'string' && typeof obj.CLIENT_ID === 'string';
}

// ====================
// 유니언 타입
// ====================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'alert';
export type ActivityAction = 'join' | 'leave' | 'move' | 'disconnect';
export type UserStatus = 'online' | 'idle' | 'dnd' | 'offline';
export type ChannelType = 'voice' | 'text' | 'forum' | 'thread';

// ====================
// 제네릭 타입
// ====================

export type AsyncHandler<T = void> = (...args: any[]) => Promise<T>;
export type EventHandler<T = any> = (data: T) => Promise<void> | void;
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
