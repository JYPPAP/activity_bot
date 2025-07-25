// src/interfaces/IAsyncJobQueue.ts - Async Job Queue Service Interface

import { EventEmitter } from 'events';
import { 
  Interaction, 
  CommandInteraction, 
  ButtonInteraction, 
  ModalSubmitInteraction 
} from 'discord.js';

// Job status enumeration
export enum JobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  TIMEOUT = 'timeout',
  RETRYING = 'retrying'
}

// Job priority levels
export enum JobPriority {
  LOW = 1,
  NORMAL = 2,
  HIGH = 3,
  CRITICAL = 4
}

// Job progress information
export interface JobProgress {
  current: number;
  total: number;
  percentage: number;
  message?: string;
  stage?: string;
  estimatedTimeRemaining?: number;
  additionalData?: Record<string, any>;
}

// Job configuration
export interface JobConfig {
  timeout: number;
  maxRetries: number;
  retryDelay: number;
  retryBackoffMultiplier: number;
  priority: JobPriority;
  enableProgressUpdates: boolean;
  progressUpdateInterval: number;
  enableWebhookDelivery: boolean;
  webhookUrl?: string;
  cacheResults: boolean;
  cacheTTL: number;
  tags?: string[];
  metadata?: Record<string, any>;
}

// Job execution context
export interface JobContext {
  userId: string;
  guildId?: string;
  channelId?: string;
  interaction?: Interaction;
  correlationId?: string;
  traceId?: string;
  additionalContext?: Record<string, any>;
}

// Job result
export interface JobResult {
  success: boolean;
  data?: any;
  error?: Error;
  executionTime: number;
  memoryUsage?: number;
  retryCount: number;
  cacheHit?: boolean;
  logs?: string[];
  additionalMetrics?: Record<string, any>;
}

// Job definition
export interface Job {
  id: string;
  type: string;
  payload: any;
  context: JobContext;
  config: JobConfig;
  status: JobStatus;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: JobResult;
  progress?: JobProgress;
  retryCount: number;
  lastError?: Error;
  logs: string[];
  version: number;
}

// Job statistics
export interface JobQueueStatistics {
  totalJobs: number;
  pendingJobs: number;
  runningJobs: number;
  completedJobs: number;
  failedJobs: number;
  cancelledJobs: number;
  averageExecutionTime: number;
  averageWaitTime: number;
  throughputPerMinute: number;
  errorRate: number;
  retryRate: number;
  cacheHitRate: number;
  memoryUsage: number;
  queueHealth: 'healthy' | 'degraded' | 'critical';
  lastResetTime: Date;
}

// Job handler function type
export type JobHandler<TPayload = any, TResult = any> = (
  job: Job,
  context: JobContext,
  progressCallback: (progress: JobProgress) => Promise<void>
) => Promise<TResult>;

// Webhook delivery configuration
export interface WebhookConfig {
  url: string;
  method: 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  timeout: number;
  retries: number;
  retryDelay: number;
  enableAuth: boolean;
  authToken?: string;
  transformPayload?: (job: Job, result: JobResult) => any;
}

// Job queue configuration
export interface AsyncJobQueueConfig {
  // Queue settings
  maxConcurrentJobs: number;
  maxQueueSize: number;
  defaultJobTimeout: number;
  defaultMaxRetries: number;
  defaultRetryDelay: number;
  
  // Progress update settings
  enableDiscordProgressUpdates: boolean;
  progressUpdateInterval: number;
  progressEmbedTemplate?: any;
  
  // Caching settings
  enableResultCaching: boolean;
  defaultCacheTTL: number;
  maxCacheSize: number;
  cacheEvictionPolicy: 'lru' | 'ttl' | 'size';
  
  // Webhook settings
  enableWebhookDelivery: boolean;
  defaultWebhookConfig?: Partial<WebhookConfig>;
  webhookRetryPolicy: {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
  };
  
  // Monitoring settings
  enableMetrics: boolean;
  metricsCollectionInterval: number;
  enableHealthChecks: boolean;
  healthCheckInterval: number;
  
  // Cleanup settings
  cleanupInterval: number;
  completedJobRetentionTime: number;
  failedJobRetentionTime: number;
  maxLogEntries: number;
  
  // Performance settings
  batchProcessingSize: number;
  enableJobBatching: boolean;
  jobProcessingInterval: number;
}

// Discord progress update configuration
export interface DiscordProgressConfig {
  updateInteraction: boolean;
  sendFollowups: boolean;
  useEmbeds: boolean;
  showProgressBar: boolean;
  showPercentage: boolean;
  showETA: boolean;
  customTemplate?: {
    title: string;
    description: string;
    color: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  };
}

// Job queue health status
export interface JobQueueHealth {
  status: 'healthy' | 'degraded' | 'critical';
  uptime: number;
  totalJobs: number;
  recentErrors: number;
  memoryUsage: number;
  processingRate: number;
  queueBacklog: number;
  lastHealthCheck: Date;
  issues: string[];
  recommendations: string[];
}

// Async Job Queue Service Interface
export interface IAsyncJobQueue extends EventEmitter {
  // Core job management
  enqueueJob<TPayload = any>(
    type: string,
    payload: TPayload,
    context: JobContext,
    config?: Partial<JobConfig>
  ): Promise<string>;
  
  getJob(jobId: string): Promise<Job | null>;
  getJobs(filter?: {
    status?: JobStatus;
    type?: string;
    userId?: string;
    guildId?: string;
    tags?: string[];
    createdAfter?: Date;
    createdBefore?: Date;
    limit?: number;
    offset?: number;
  }): Promise<Job[]>;
  
  cancelJob(jobId: string, reason?: string): Promise<boolean>;
  retryJob(jobId: string, newConfig?: Partial<JobConfig>): Promise<boolean>;
  
  // Job handler registration
  registerHandler<TPayload = any, TResult = any>(
    type: string,
    handler: JobHandler<TPayload, TResult>,
    defaultConfig?: Partial<JobConfig>
  ): void;
  
  unregisterHandler(type: string): boolean;
  
  // Progress management
  updateJobProgress(jobId: string, progress: JobProgress): Promise<void>;
  getJobProgress(jobId: string): Promise<JobProgress | null>;
  
  // Result caching
  getCachedResult(cacheKey: string): Promise<any>;
  setCachedResult(cacheKey: string, result: any, ttl?: number): Promise<void>;
  invalidateCache(pattern?: string): Promise<number>;
  
  // Webhook delivery
  deliverResultViaWebhook(
    job: Job,
    result: JobResult,
    webhookConfig: WebhookConfig
  ): Promise<boolean>;
  
  // Discord integration
  sendProgressUpdate(
    job: Job,
    progress: JobProgress,
    config?: DiscordProgressConfig
  ): Promise<void>;
  
  // Queue management
  startProcessing(): void;
  stopProcessing(): Promise<void>;
  pauseProcessing(): void;
  resumeProcessing(): void;
  
  // Monitoring and statistics
  getStatistics(): Promise<JobQueueStatistics>;
  getHealthStatus(): Promise<JobQueueHealth>;
  
  // Configuration
  updateConfig(newConfig: Partial<AsyncJobQueueConfig>): void;
  getConfig(): AsyncJobQueueConfig;
  
  // Cleanup
  cleanupOldJobs(): Promise<number>;
  clearQueue(status?: JobStatus): Promise<number>;
  
  // Events
  on(event: 'jobEnqueued', listener: (job: Job) => void): this;
  on(event: 'jobStarted', listener: (job: Job) => void): this;
  on(event: 'jobProgress', listener: (job: Job, progress: JobProgress) => void): this;
  on(event: 'jobCompleted', listener: (job: Job, result: JobResult) => void): this;
  on(event: 'jobFailed', listener: (job: Job, error: Error) => void): this;
  on(event: 'jobCancelled', listener: (job: Job, reason?: string) => void): this;
  on(event: 'jobRetry', listener: (job: Job, attempt: number) => void): this;
  on(event: 'queueEmpty', listener: () => void): this;
  on(event: 'queueFull', listener: (queueSize: number) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

// Job processor interface for custom processing logic
export interface IJobProcessor {
  processJobs(): Promise<void>;
  processBatch(jobs: Job[]): Promise<JobResult[]>;
  isHealthy(): boolean;
  getMetrics(): {
    processedJobs: number;
    failedJobs: number;
    averageProcessingTime: number;
  };
}

// Result cache interface
export interface IJobResultCache {
  get(key: string): Promise<any>;
  set(key: string, value: any, ttl?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  clear(pattern?: string): Promise<number>;
  getStats(): Promise<{
    hitRate: number;
    missRate: number;
    size: number;
    memoryUsage: number;
  }>;
}

// Webhook delivery service interface
export interface IWebhookDeliveryService {
  deliver(
    webhookConfig: WebhookConfig,
    payload: any,
    context: JobContext
  ): Promise<boolean>;
  
  getDeliveryStatus(deliveryId: string): Promise<{
    status: 'pending' | 'delivered' | 'failed';
    attempts: number;
    lastAttempt?: Date;
    error?: string;
  }>;
}

// Export utility types
export type JobFilter = Parameters<IAsyncJobQueue['getJobs']>[0];
export type JobHandlerMap = Map<string, {
  handler: JobHandler;
  defaultConfig?: Partial<JobConfig>;
}>;

// Default configurations
export const DEFAULT_JOB_CONFIG: JobConfig = {
  timeout: 300000, // 5 minutes
  maxRetries: 3,
  retryDelay: 5000, // 5 seconds
  retryBackoffMultiplier: 2,
  priority: JobPriority.NORMAL,
  enableProgressUpdates: true,
  progressUpdateInterval: 2000, // 2 seconds
  enableWebhookDelivery: false,
  cacheResults: true,
  cacheTTL: 3600000, // 1 hour
  tags: [],
  metadata: {}
};

export const DEFAULT_ASYNC_JOB_QUEUE_CONFIG: AsyncJobQueueConfig = {
  maxConcurrentJobs: 10,
  maxQueueSize: 1000,
  defaultJobTimeout: 300000,
  defaultMaxRetries: 3,
  defaultRetryDelay: 5000,
  
  enableDiscordProgressUpdates: true,
  progressUpdateInterval: 2000,
  
  enableResultCaching: true,
  defaultCacheTTL: 3600000,
  maxCacheSize: 10000,
  cacheEvictionPolicy: 'lru',
  
  enableWebhookDelivery: false,
  webhookRetryPolicy: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2
  },
  
  enableMetrics: true,
  metricsCollectionInterval: 60000,
  enableHealthChecks: true,
  healthCheckInterval: 30000,
  
  cleanupInterval: 300000, // 5 minutes
  completedJobRetentionTime: 86400000, // 24 hours
  failedJobRetentionTime: 259200000, // 3 days
  maxLogEntries: 100,
  
  batchProcessingSize: 5,
  enableJobBatching: false,
  jobProcessingInterval: 1000
};