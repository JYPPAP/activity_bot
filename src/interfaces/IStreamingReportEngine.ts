// src/interfaces/IStreamingReportEngine.ts - Streaming Report Generation Interfaces

import { EventEmitter } from 'events';
import { Collection, GuildMember, EmbedBuilder, ChatInputCommandInteraction } from 'discord.js';

/**
 * Progress information for streaming operations
 */
export interface StreamingProgress {
  /** Current step number */
  current: number;
  /** Total steps */
  total: number;
  /** Percentage completion (0-100) */
  percentage: number;
  /** Current operation description */
  message: string;
  /** Current processing stage */
  stage: StreamingStage;
  /** Estimated time remaining in milliseconds */
  estimatedTimeRemaining?: number;
  /** Number of items processed */
  itemsProcessed?: number;
  /** Processing rate (items per second) */
  processingRate?: number;
  /** Partial results available */
  hasPartialResults?: boolean;
}

/**
 * Streaming operation stages
 */
export enum StreamingStage {
  INITIALIZING = 'initializing',
  FETCHING_MEMBERS = 'fetching_members',
  PROCESSING_DATA = 'processing_data',
  GENERATING_PARTIAL = 'generating_partial',
  STREAMING_RESULTS = 'streaming_results',
  FINALIZING = 'finalizing',
  COMPLETED = 'completed',
  ERROR = 'error'
}

/**
 * Partial report result that can be streamed
 */
export interface PartialReportResult {
  /** Unique identifier for this partial result */
  id: string;
  /** Progress information */
  progress: StreamingProgress;
  /** Partial embed data */
  embeds?: EmbedBuilder[];
  /** Partial statistics */
  statistics?: Partial<ReportStatistics>;
  /** Batch information */
  batchInfo?: {
    batchNumber: number;
    totalBatches: number;
    itemsInBatch: number;
  };
  /** Error information if applicable */
  error?: StreamingError;
  /** Whether this is the final result */
  isFinal: boolean;
  /** Timestamp of result generation */
  timestamp: Date;
}

/**
 * Complete streaming report result
 */
export interface StreamingReportResult {
  /** Operation ID */
  operationId: string;
  /** Final report embeds */
  embeds: EmbedBuilder[];
  /** Complete statistics */
  statistics: ReportStatistics;
  /** Operation metadata */
  metadata: {
    role: string;
    dateRange: DateRange;
    totalMembers: number;
    processingTime: number;
    memoryUsage: number;
    errorCount: number;
    recoveredErrors: number;
  };
  /** Success status */
  success: boolean;
  /** Error information if failed */
  error?: StreamingError;
}

/**
 * Report statistics
 */
export interface ReportStatistics {
  totalMembers: number;
  activeMembers: number;
  inactiveMembers: number;
  afkMembers: number;
  averageActivity: number;
  processingTime: number;
  memoryPeak: number;
  batchesProcessed: number;
  errorsRecovered: number;
}

/**
 * Date range for reports
 */
export interface DateRange {
  startDate: Date;
  endDate: Date;
}

/**
 * Streaming error with recovery information
 */
export interface StreamingError {
  code: string;
  message: string;
  stage: StreamingStage;
  recoverable: boolean;
  retryCount?: number;
  context?: Record<string, any>;
  timestamp: Date;
}

/**
 * Streaming report configuration
 */
export interface StreamingReportConfig {
  /** Batch size for processing */
  batchSize: number;
  /** Maximum memory usage in MB */
  maxMemoryMB: number;
  /** Progress update interval in milliseconds */
  progressUpdateInterval: number;
  /** Maximum concurrent operations */
  maxConcurrency: number;
  /** Enable partial result streaming */
  enablePartialStreaming: boolean;
  /** Enable error recovery */
  enableErrorRecovery: boolean;
  /** Maximum retry attempts */
  maxRetries: number;
  /** Discord update throttling (milliseconds) */
  discordUpdateThrottle: number;
  /** Memory cleanup threshold */
  memoryCleanupThreshold: number;
  /** Partial result embed limit */
  partialEmbedLimit: number;
}

/**
 * Discord streaming integration options
 */
export interface DiscordStreamingOptions {
  /** Discord interaction for updates */
  interaction: ChatInputCommandInteraction;
  /** Channel ID for streaming updates */
  channelId?: string;
  /** Enable ephemeral updates */
  ephemeral: boolean;
  /** Update frequency throttling */
  updateThrottle: number;
  /** Progress embed template */
  progressTemplate?: {
    title: string;
    color: number;
    footer?: string;
  };
  /** Maximum embeds per message */
  maxEmbedsPerMessage: number;
}

/**
 * Memory management options
 */
export interface MemoryManagementOptions {
  /** Enable automatic garbage collection */
  enableGC: boolean;
  /** Memory monitoring interval */
  monitoringInterval: number;
  /** Memory usage alert threshold */
  alertThreshold: number;
  /** Automatic cleanup on threshold breach */
  autoCleanup: boolean;
  /** Buffer pool size for reuse */
  bufferPoolSize: number;
}

/**
 * Main streaming report engine interface
 */
export interface IStreamingReportEngine extends EventEmitter {
  /**
   * Generate a streaming report
   */
  generateReport(
    role: string,
    members: Collection<string, GuildMember>,
    dateRange: DateRange,
    config?: Partial<StreamingReportConfig>,
    discordOptions?: DiscordStreamingOptions
  ): Promise<StreamingReportResult>;

  /**
   * Cancel an ongoing streaming operation
   */
  cancelOperation(operationId: string): Promise<boolean>;

  /**
   * Get current operation status
   */
  getOperationStatus(operationId: string): StreamingProgress | null;

  /**
   * Get memory usage statistics
   */
  getMemoryStats(): MemoryStats;

  /**
   * Configure the streaming engine
   */
  configure(config: Partial<StreamingReportConfig>): void;

  /**
   * Clean up resources
   */
  cleanup(): Promise<void>;
}

/**
 * Memory statistics
 */
export interface MemoryStats {
  current: number;
  peak: number;
  gcCount: number;
  bufferPoolUsage: number;
  cacheSize: number;
}

/**
 * Events emitted by the streaming engine
 */
export interface StreamingReportEngineEvents {
  'progress': (progress: StreamingProgress) => void;
  'partial-result': (result: PartialReportResult) => void;
  'complete': (result: StreamingReportResult) => void;
  'error': (error: StreamingError) => void;
  'memory-warning': (stats: MemoryStats) => void;
  'operation-cancelled': (operationId: string) => void;
}

/**
 * Default streaming configuration
 */
export const DEFAULT_STREAMING_CONFIG: StreamingReportConfig = {
  batchSize: 50,
  maxMemoryMB: 256,
  progressUpdateInterval: 2000,
  maxConcurrency: 3,
  enablePartialStreaming: true,
  enableErrorRecovery: true,
  maxRetries: 3,
  discordUpdateThrottle: 1500,
  memoryCleanupThreshold: 200,
  partialEmbedLimit: 5
};

/**
 * Default Discord streaming options
 */
export const DEFAULT_DISCORD_OPTIONS: Partial<DiscordStreamingOptions> = {
  ephemeral: true,
  updateThrottle: 1500,
  maxEmbedsPerMessage: 10,
  progressTemplate: {
    title: '📊 보고서 생성 중...',
    color: 0x00AE86,
    footer: '실시간 업데이트'
  }
};