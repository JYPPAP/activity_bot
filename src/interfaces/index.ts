// src/interfaces/index.ts - 서비스 인터페이스 내보내기

// 핵심 서비스 인터페이스
export type { IDatabaseManager } from './IDatabaseManager.js';
export type { ILogService } from './ILogService.js';
export type { IActivityTracker } from './IActivityTracker.js';
export type { ICalendarLogService, CalendarEventData, CalendarSummary, ActivityCalendarEntry } from './ICalendarLogService.js';
export type { ICommandHandler, CommandExecutionResult, CommandHandlerStatistics, CommandHandlerConfig } from './ICommandHandler.js';

// 모니터링 서비스 인터페이스
export type { 
  IPerformanceMonitoringService, 
  PerformanceMetrics, 
  PerformanceAlert, 
  PerformanceThresholds 
} from './IPerformanceMonitoringService.js';

export type { 
  IPrometheusMetricsService, 
  DiscordBotMetrics, 
  MetricsConfig 
} from './IPrometheusMetricsService.js';

// Redis 서비스 인터페이스
export type {
  IRedisService,
  RedisConfig,
  RateLimitResult,
  RedisHealthStatus,
  RedisCacheStats,
  RedisMessage
} from './IRedisService.js';

// DI Container 토큰 정의
export const DI_TOKENS = {
  // 핵심 서비스
  IDatabaseManager: Symbol.for('IDatabaseManager'),
  ILogService: Symbol.for('ILogService'),
  IActivityTracker: Symbol.for('IActivityTracker'),
  ICalendarLogService: Symbol.for('ICalendarLogService'),
  ICommandHandler: Symbol.for('ICommandHandler'),
  
  // 모니터링 서비스
  IPerformanceMonitoringService: Symbol.for('IPerformanceMonitoringService'),
  IPrometheusMetricsService: Symbol.for('IPrometheusMetricsService'),
  
  // 인프라 서비스
  IRedisService: Symbol.for('IRedisService'),
  
  // Discord 클라이언트
  DiscordClient: Symbol.for('DiscordClient'),
  
  // 설정
  BotConfig: Symbol.for('BotConfig'),
  LogServiceConfig: Symbol.for('LogServiceConfig'),
  CommandHandlerConfig: Symbol.for('CommandHandlerConfig'),
  MetricsConfig: Symbol.for('MetricsConfig'),
  RedisConfig: Symbol.for('RedisConfig'),
} as const;

// 타입 가드 함수들
export function isIDatabaseManager(obj: any): boolean {
  return obj && 
    typeof obj.initialize === 'function' &&
    typeof obj.getUserActivity === 'function' &&
    typeof obj.saveUserActivity === 'function';
}

export function isILogService(obj: any): boolean {
  return obj && 
    typeof obj.logChannelActivity === 'function' &&
    typeof obj.logEvent === 'function' &&
    typeof obj.handleChannelUpdate === 'function';
}

export function isIActivityTracker(obj: any): boolean {
  return obj && 
    typeof obj.handleVoiceStateUpdate === 'function' &&
    typeof obj.getUserActivity === 'function' &&
    typeof obj.classifyUsers === 'function';
}