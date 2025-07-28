// src/interfaces/index.ts - 서비스 인터페이스 내보내기

// 핵심 서비스 인터페이스
export type { IDatabaseManager } from './IDatabaseManager';
export type { ILogService } from './ILogService';
export type { IActivityTracker } from './IActivityTracker';
export type {
  ICommandHandler,
  CommandExecutionResult,
  CommandHandlerStatistics,
  CommandHandlerConfig,
} from './ICommandHandler';
export type {
  IUserClassificationService,
  UserData,
  RoleSettings,
  UserClassificationResult,
  ClassificationStatistics,
  UserClassificationConfig,
} from './IUserClassificationService';

// Discord Member Fetch 최적화 서비스
export type {
  IMemberFetchService,
  MemberFetchResult,
  RoleMemberFetchResult,
  FetchProgress,
  MemberFetchServiceConfig,
  MemberFetchStatistics,
  ProgressCallback,
  MemberFilter
} from './IMemberFetchService';

// 모니터링 서비스 인터페이스
export type {
  IPerformanceMonitoringService,
  PerformanceMetrics,
  PerformanceAlert,
  PerformanceThresholds,
} from './IPerformanceMonitoringService';

// 신뢰성 있는 임베드 전송 서비스
export type {
  IReliableEmbedSender,
  EmbedSendResult,
  EmbedSendProgress,
  ReportSectionData,
  ThreeSectionReport,
  ReliableEmbedSendOptions,
  EmbedValidationError,
  EmbedSendError
} from './IReliableEmbedSender';

// 활동 보고서 템플릿 시스템
export type {
  IActivityReportTemplateService,
  ActivityReportTemplate,
  ReportSectionTemplate,
  PaginatedSection,
  TemplateConfig,
  TemplateFormattingOptions,
  TemplateValidationError,
  TemplateFormattingError,
  TemplatePaginationError
} from './IActivityReportTemplate';

// Discord 임베드 청킹 시스템
export type {
  IEmbedChunkingSystem,
  EmbedChunkingConfig,
  EmbedChunk,
  ChunkingResult,
  NavigationState,
  FileAttachmentData,
  ChunkingProgress,
  ChunkingStrategy,
  AttachmentFormat,
  EmbedChunkingError,
  NavigationError,
  FileFallbackError
} from './IEmbedChunkingSystem';

export type {
  IPrometheusMetricsService,
  DiscordBotMetrics,
  MetricsConfig,
} from './IPrometheusMetricsService';

// Redis 서비스 인터페이스
export type {
  IRedisService,
  RedisConfig,
  RateLimitResult,
  RedisHealthStatus,
  RedisCacheStats,
  RedisMessage,
} from './IRedisService';

// DI Container 토큰 정의
export const DI_TOKENS = {
  // 핵심 서비스
  IDatabaseManager: Symbol.for('IDatabaseManager'),
  ILogService: Symbol.for('ILogService'),
  IActivityTracker: Symbol.for('IActivityTracker'),
  ICommandHandler: Symbol.for('ICommandHandler'),
  IUserClassificationService: Symbol.for('IUserClassificationService'),

  // 설정 관리 서비스
  IGuildSettingsManager: Symbol.for('IGuildSettingsManager'),
  
  // Discord 최적화 서비스
  IMemberFetchService: Symbol.for('IMemberFetchService'),
  
  // 스트리밍 보고서 서비스
  IStreamingReportEngine: Symbol.for('IStreamingReportEngine'),
  IDiscordStreamingService: Symbol.for('IDiscordStreamingService'),
  IIncrementalDataProcessor: Symbol.for('IIncrementalDataProcessor'),

  // 신뢰성 있는 임베드 전송 서비스
  IReliableEmbedSender: Symbol.for('IReliableEmbedSender'),

  // 활동 보고서 템플릿 시스템
  IActivityReportTemplateService: Symbol.for('IActivityReportTemplateService'),

  // Discord 임베드 청킹 시스템
  IEmbedChunkingSystem: Symbol.for('IEmbedChunkingSystem'),

  // 모니터링 서비스
  IPerformanceMonitoringService: Symbol.for('IPerformanceMonitoringService'),
  IPrometheusMetricsService: Symbol.for('IPrometheusMetricsService'),

  // 인프라 서비스
  IRedisService: Symbol.for('IRedisService'),

  // UI/Forum 서비스
  IVoiceChannelForumIntegrationService: Symbol.for('IVoiceChannelForumIntegrationService'),
  IEmojiReactionService: Symbol.for('IEmojiReactionService'),
  IEventManager: Symbol.for('IEventManager'),

  // Discord 클라이언트
  DiscordClient: Symbol.for('DiscordClient'),

  // 설정
  BotConfig: Symbol.for('BotConfig'),
  LogServiceConfig: Symbol.for('LogServiceConfig'),
  CommandHandlerConfig: Symbol.for('CommandHandlerConfig'),
  MetricsConfig: Symbol.for('MetricsConfig'),
  RedisConfig: Symbol.for('RedisConfig'),
  StreamingReportConfig: Symbol.for('StreamingReportConfig'),
} as const;

// 타입 가드 함수들
export function isIDatabaseManager(obj: any): boolean {
  return (
    obj &&
    typeof obj.initialize === 'function' &&
    typeof obj.getUserActivity === 'function' &&
    typeof obj.saveUserActivity === 'function'
  );
}

export function isILogService(obj: any): boolean {
  return (
    obj &&
    typeof obj.logChannelActivity === 'function' &&
    typeof obj.logEvent === 'function' &&
    typeof obj.handleChannelUpdate === 'function'
  );
}

export function isIActivityTracker(obj: any): boolean {
  return (
    obj &&
    typeof obj.handleVoiceStateUpdate === 'function' &&
    typeof obj.getUserActivity === 'function' &&
    typeof obj.classifyUsers === 'function'
  );
}
