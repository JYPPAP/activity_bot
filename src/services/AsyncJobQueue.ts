// src/services/AsyncJobQueue.ts - Async Job Queue Service Implementation

import { EventEmitter } from 'events';
import { injectable, inject } from 'tsyringe';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  IAsyncJobQueue,
  Job,
  JobStatus,
  JobProgress,
  JobConfig,
  JobContext,
  JobResult,
  JobHandler,
  JobQueueStatistics,
  JobQueueHealth,
  AsyncJobQueueConfig,
  DiscordProgressConfig,
  WebhookConfig,
  DEFAULT_JOB_CONFIG,
  DEFAULT_ASYNC_JOB_QUEUE_CONFIG,
  JobHandlerMap,
  IJobResultCache,
  IWebhookDeliveryService,
} from '../interfaces/IAsyncJobQueue.js';
import { DI_TOKENS } from '../interfaces/index.js';
import type { ILogService } from '../interfaces/ILogService';

// Job result cache implementation
class JobResultCache implements IJobResultCache {
  private cache = new Map<string, { value: any; expiry: number; size: number }>();
  private maxSize: number;
  private currentSize = 0;
  private hits = 0;
  private misses = 0;

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize;
  }

  async get(key: string): Promise<any> {
    const entry = this.cache.get(key);

    if (!entry || entry.expiry < Date.now()) {
      if (entry) {
        this.cache.delete(key);
        this.currentSize -= entry.size;
      }
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.value;
  }

  async set(key: string, value: any, ttl: number = 3600000): Promise<void> {
    const size = this.estimateSize(value);
    const expiry = Date.now() + ttl;

    // Remove existing entry if present
    const existing = this.cache.get(key);
    if (existing) {
      this.currentSize -= existing.size;
    }

    // Evict entries if necessary
    while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
      this.evictLRU();
    }

    this.cache.set(key, { value, expiry, size });
    this.currentSize += size;
  }

  async delete(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (entry) {
      this.cache.delete(key);
      this.currentSize -= entry.size;
      return true;
    }
    return false;
  }

  async clear(pattern?: string): Promise<number> {
    if (!pattern) {
      const count = this.cache.size;
      this.cache.clear();
      this.currentSize = 0;
      return count;
    }

    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    let deleted = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        this.currentSize -= entry.size;
        deleted++;
      }
    }

    return deleted;
  }

  async getStats(): Promise<{
    hitRate: number;
    missRate: number;
    size: number;
    memoryUsage: number;
  }> {
    const total = this.hits + this.misses;
    return {
      hitRate: total > 0 ? this.hits / total : 0,
      missRate: total > 0 ? this.misses / total : 0,
      size: this.cache.size,
      memoryUsage: this.currentSize,
    };
  }

  private evictLRU(): void {
    const firstKey = this.cache.keys().next().value;
    if (firstKey) {
      const entry = this.cache.get(firstKey)!;
      this.cache.delete(firstKey);
      this.currentSize -= entry.size;
    }
  }

  private estimateSize(obj: any): number {
    return JSON.stringify(obj).length * 2; // Rough estimate
  }
}

// Webhook delivery service implementation
class WebhookDeliveryService implements IWebhookDeliveryService {
  private deliveryStatus = new Map<
    string,
    {
      status: 'pending' | 'delivered' | 'failed';
      attempts: number;
      lastAttempt?: Date;
      error?: string;
    }
  >();

  async deliver(webhookConfig: WebhookConfig, payload: any, context: JobContext): Promise<boolean> {
    const deliveryId = `${context.correlationId || Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    this.deliveryStatus.set(deliveryId, {
      status: 'pending',
      attempts: 0,
    });

    const maxRetries = webhookConfig.retries || 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.deliveryStatus.set(deliveryId, {
          status: 'pending',
          attempts: attempt,
          lastAttempt: new Date(),
        });

        const transformedPayload = webhookConfig.transformPayload
          ? webhookConfig.transformPayload(payload.job, payload.result)
          : payload;

        const response = await fetch(webhookConfig.url, {
          method: webhookConfig.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...webhookConfig.headers,
            ...(webhookConfig.enableAuth && webhookConfig.authToken
              ? { Authorization: `Bearer ${webhookConfig.authToken}` }
              : {}),
          },
          body: JSON.stringify(transformedPayload),
          signal: AbortSignal.timeout(webhookConfig.timeout || 30000),
        });

        if (response.ok) {
          this.deliveryStatus.set(deliveryId, {
            status: 'delivered',
            attempts: attempt,
            lastAttempt: new Date(),
          });
          return true;
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxRetries) {
          const delay = webhookConfig.retryDelay || 1000;
          await new Promise((resolve) => setTimeout(resolve, delay * attempt));
        }
      }
    }

    const failedStatus: any = {
      status: 'failed',
      attempts: maxRetries,
      lastAttempt: new Date(),
    };

    if (lastError?.message) {
      failedStatus.error = lastError.message;
    }

    this.deliveryStatus.set(deliveryId, failedStatus);

    return false;
  }

  async getDeliveryStatus(deliveryId: string) {
    return (
      this.deliveryStatus.get(deliveryId) || {
        status: 'failed' as const,
        attempts: 0,
        error: 'Delivery ID not found',
      }
    );
  }
}

@injectable()
export class AsyncJobQueue extends EventEmitter implements IAsyncJobQueue {
  private jobs = new Map<string, Job>();
  private jobHandlers: JobHandlerMap = new Map();
  private runningJobs = new Map<string, Promise<void>>();
  private processingQueue: Job[] = [];
  private isProcessing = false;
  private isPaused = false;
  private processingTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private metricsTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;

  private resultCache: IJobResultCache;
  private webhookService: IWebhookDeliveryService;
  private statistics: JobQueueStatistics;
  private health: JobQueueHealth;
  private startTime = Date.now();

  constructor(
    @inject(DI_TOKENS.ILogService) private logService: ILogService,
    private config: AsyncJobQueueConfig = DEFAULT_ASYNC_JOB_QUEUE_CONFIG
  ) {
    super();

    this.resultCache = new JobResultCache(config.maxCacheSize);
    this.webhookService = new WebhookDeliveryService();

    this.statistics = this.initializeStatistics();
    this.health = this.initializeHealth();

    this.setupTimers();
    this.setupEventHandlers();
  }

  // Core job management methods
  async enqueueJob<TPayload = any>(
    type: string,
    payload: TPayload,
    context: JobContext,
    config: Partial<JobConfig> = {}
  ): Promise<string> {
    const jobId = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const jobConfig = { ...DEFAULT_JOB_CONFIG, ...config };

    const job: Job = {
      id: jobId,
      type,
      payload,
      context,
      config: jobConfig,
      status: JobStatus.PENDING,
      createdAt: new Date(),
      retryCount: 0,
      logs: [],
      version: 1,
    };

    // Check queue capacity
    if (this.jobs.size >= this.config.maxQueueSize) {
      this.emit('queueFull', this.jobs.size);
      throw new Error(`Queue is full (${this.jobs.size}/${this.config.maxQueueSize})`);
    }

    // Validate job handler exists
    if (!this.jobHandlers.has(type)) {
      throw new Error(`No handler registered for job type: ${type}`);
    }

    this.jobs.set(jobId, job);
    this.processingQueue.push(job);
    this.sortProcessingQueue();

    this.statistics.totalJobs++;
    this.statistics.pendingJobs++;

    this.emit('jobEnqueued', job);
    this.logService.logActivity(`Job enqueued: ${jobId}`, [], 'job_enqueued', {
      jobId,
      type,
      userId: context.userId,
      guildId: context.guildId,
    });

    // Start processing if not already running
    if (!this.isProcessing && !this.isPaused) {
      this.startProcessing();
    }

    return jobId;
  }

  async getJob(jobId: string): Promise<Job | null> {
    return this.jobs.get(jobId) || null;
  }

  async getJobs(
    filter: {
      status?: JobStatus;
      type?: string;
      userId?: string;
      guildId?: string;
      tags?: string[];
      createdAfter?: Date;
      createdBefore?: Date;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<Job[]> {
    let jobs = Array.from(this.jobs.values());

    // Apply filters
    if (filter.status) {
      jobs = jobs.filter((job) => job.status === filter.status);
    }
    if (filter.type) {
      jobs = jobs.filter((job) => job.type === filter.type);
    }
    if (filter.userId) {
      jobs = jobs.filter((job) => job.context.userId === filter.userId);
    }
    if (filter.guildId) {
      jobs = jobs.filter((job) => job.context.guildId === filter.guildId);
    }
    if (filter.tags && filter.tags.length > 0) {
      jobs = jobs.filter((job) => filter.tags!.some((tag) => job.config.tags?.includes(tag)));
    }
    if (filter.createdAfter) {
      jobs = jobs.filter((job) => job.createdAt >= filter.createdAfter!);
    }
    if (filter.createdBefore) {
      jobs = jobs.filter((job) => job.createdAt <= filter.createdBefore!);
    }

    // Sort by creation date (newest first)
    jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Apply pagination
    const offset = filter.offset || 0;
    const limit = filter.limit || jobs.length;

    return jobs.slice(offset, offset + limit);
  }

  async cancelJob(jobId: string, reason?: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    if (job.status === JobStatus.RUNNING) {
      // Job is currently running, mark for cancellation
      job.status = JobStatus.CANCELLED;
      job.completedAt = new Date();
      job.logs.push(`Job cancelled: ${reason || 'No reason provided'}`);

      this.statistics.pendingJobs = Math.max(0, this.statistics.pendingJobs - 1);
      this.statistics.runningJobs = Math.max(0, this.statistics.runningJobs - 1);

      this.emit('jobCancelled', job, reason);
      return true;
    } else if (job.status === JobStatus.PENDING || job.status === JobStatus.RETRYING) {
      // Remove from processing queue
      const queueIndex = this.processingQueue.findIndex((j) => j.id === jobId);
      if (queueIndex !== -1) {
        this.processingQueue.splice(queueIndex, 1);
      }

      job.status = JobStatus.CANCELLED;
      job.completedAt = new Date();
      job.logs.push(`Job cancelled: ${reason || 'No reason provided'}`);

      this.statistics.pendingJobs = Math.max(0, this.statistics.pendingJobs - 1);

      this.emit('jobCancelled', job, reason);
      return true;
    }

    return false;
  }

  async retryJob(jobId: string, newConfig?: Partial<JobConfig>): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== JobStatus.FAILED) return false;

    // Update job configuration if provided
    if (newConfig) {
      job.config = { ...job.config, ...newConfig };
    }

    // Reset job state for exactOptionalPropertyTypes compatibility
    job.status = JobStatus.PENDING;
    delete job.startedAt;
    delete job.completedAt;
    delete job.result;
    delete job.progress;
    delete job.lastError;
    job.retryCount = 0;
    job.version++;
    job.logs.push('Job manually retried');

    // Add back to processing queue
    this.processingQueue.push(job);
    this.sortProcessingQueue();

    this.statistics.pendingJobs++;
    this.statistics.failedJobs = Math.max(0, this.statistics.failedJobs - 1);

    this.emit('jobEnqueued', job);
    return true;
  }

  // Job handler registration
  registerHandler<TResult = any>(
    type: string,
    handler: JobHandler<TResult>,
    defaultConfig?: Partial<JobConfig>
  ): void {
    const handlerInfo: any = { handler };
    if (defaultConfig) {
      handlerInfo.defaultConfig = defaultConfig;
    }
    this.jobHandlers.set(type, handlerInfo);
    this.logService.logActivity(`Job handler registered: ${type}`, [], 'handler_registered', {
      type,
    });
  }

  unregisterHandler(type: string): boolean {
    const result = this.jobHandlers.delete(type);
    if (result) {
      this.logService.logActivity(`Job handler unregistered: ${type}`, [], 'handler_unregistered', {
        type,
      });
    }
    return result;
  }

  // Progress management
  async updateJobProgress(jobId: string, progress: JobProgress): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== JobStatus.RUNNING) return;

    job.progress = progress;
    job.logs.push(`Progress update: ${progress.percentage}% - ${progress.message || ''}`);

    this.emit('jobProgress', job, progress);

    // Send Discord progress update if enabled
    if (this.config.enableDiscordProgressUpdates && job.config.enableProgressUpdates) {
      await this.sendProgressUpdate(job, progress);
    }
  }

  async getJobProgress(jobId: string): Promise<JobProgress | null> {
    const job = this.jobs.get(jobId);
    return job?.progress || null;
  }

  // Result caching
  async getCachedResult(cacheKey: string): Promise<any> {
    if (!this.config.enableResultCaching) return null;
    return await this.resultCache.get(cacheKey);
  }

  async setCachedResult(cacheKey: string, result: any, ttl?: number): Promise<void> {
    if (!this.config.enableResultCaching) return;
    await this.resultCache.set(cacheKey, result, ttl || this.config.defaultCacheTTL);
  }

  async invalidateCache(pattern?: string): Promise<number> {
    return await this.resultCache.clear(pattern);
  }

  // Webhook delivery
  async deliverResultViaWebhook(
    job: Job,
    result: JobResult,
    webhookConfig: WebhookConfig
  ): Promise<boolean> {
    if (!this.config.enableWebhookDelivery) return false;

    try {
      const payload = {
        job: {
          id: job.id,
          type: job.type,
          context: job.context,
          status: job.status,
          createdAt: job.createdAt,
          completedAt: job.completedAt,
        },
        result: {
          success: result.success,
          data: result.data,
          executionTime: result.executionTime,
          retryCount: result.retryCount,
        },
        timestamp: new Date().toISOString(),
      };

      return await this.webhookService.deliver(webhookConfig, payload, job.context);
    } catch (error) {
      this.logService.logActivity('Webhook delivery failed', [], 'webhook_failed', {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // Discord integration
  async sendProgressUpdate(
    job: Job,
    progress: JobProgress,
    _config?: DiscordProgressConfig
  ): Promise<void> {
    const interaction = job.context.interaction;
    if (!interaction || !interaction.isRepliable()) return;

    try {
      const embed = new EmbedBuilder()
        .setTitle(`Job Progress: ${job.type}`)
        .setDescription(progress.message || 'Processing...')
        .setColor(0x3498db)
        .addFields([
          {
            name: 'Progress',
            value: this.createProgressBar(progress.percentage),
            inline: false,
          },
          {
            name: 'Status',
            value: progress.stage || 'Processing',
            inline: true,
          },
          {
            name: 'Completion',
            value: `${progress.current}/${progress.total} (${progress.percentage.toFixed(1)}%)`,
            inline: true,
          },
        ])
        .setTimestamp();

      if (progress.estimatedTimeRemaining) {
        embed.addFields([
          {
            name: 'ETA',
            value: `${Math.ceil(progress.estimatedTimeRemaining / 1000)}s remaining`,
            inline: true,
          },
        ]);
      }

      const components = [];
      if (job.status === JobStatus.RUNNING) {
        components.push(
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`cancel_job_${job.id}`)
              .setLabel('Cancel Job')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('❌')
          )
        );
      }

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({
          embeds: [embed],
          components,
        });
      } else {
        await interaction.reply({
          embeds: [embed],
          components,
          ephemeral: true,
        });
      }
    } catch (error) {
      this.logService.logActivity('Discord progress update failed', [], 'progress_update_failed', {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Queue management
  startProcessing(): void {
    if (this.isProcessing) return;

    this.isProcessing = true;
    this.isPaused = false;

    this.processingTimer = setInterval(() => this.processJobs(), this.config.jobProcessingInterval);

    this.logService.logActivity('Job queue processing started', [], 'queue_started');
  }

  async stopProcessing(): Promise<void> {
    this.isProcessing = false;
    this.isPaused = false;

    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }

    // Wait for running jobs to complete
    const runningPromises = Array.from(this.runningJobs.values());
    if (runningPromises.length > 0) {
      await Promise.allSettled(runningPromises);
    }

    this.logService.logActivity('Job queue processing stopped', [], 'queue_stopped');
  }

  pauseProcessing(): void {
    this.isPaused = true;
    this.logService.logActivity('Job queue processing paused', [], 'queue_paused');
  }

  resumeProcessing(): void {
    this.isPaused = false;
    this.logService.logActivity('Job queue processing resumed', [], 'queue_resumed');
  }

  // Private implementation methods
  private async processJobs(): Promise<void> {
    if (this.isPaused || this.runningJobs.size >= this.config.maxConcurrentJobs) {
      return;
    }

    while (
      this.processingQueue.length > 0 &&
      this.runningJobs.size < this.config.maxConcurrentJobs
    ) {
      const job = this.processingQueue.shift()!;

      if (job.status === JobStatus.CANCELLED) {
        continue;
      }

      const jobPromise = this.executeJob(job);
      this.runningJobs.set(job.id, jobPromise);

      // Clean up after job completes
      jobPromise.finally(() => {
        this.runningJobs.delete(job.id);
      });
    }

    // Emit queue empty event if appropriate
    if (this.processingQueue.length === 0 && this.runningJobs.size === 0) {
      this.emit('queueEmpty');
    }
  }

  private async executeJob(job: Job): Promise<void> {
    const startTime = Date.now();

    try {
      // Update job status
      job.status = JobStatus.RUNNING;
      job.startedAt = new Date();
      job.logs.push('Job execution started');

      this.statistics.pendingJobs = Math.max(0, this.statistics.pendingJobs - 1);
      this.statistics.runningJobs++;

      this.emit('jobStarted', job);

      // Get job handler
      const handlerInfo = this.jobHandlers.get(job.type);
      if (!handlerInfo) {
        throw new Error(`No handler found for job type: ${job.type}`);
      }

      // Check for cached result
      let result: any = null;
      const cacheKey = `job_result:${job.type}:${JSON.stringify(job.payload)}`;

      if (job.config.cacheResults) {
        result = await this.getCachedResult(cacheKey);
        if (result) {
          await this.completeJob(job, {
            success: true,
            data: result,
            executionTime: Date.now() - startTime,
            retryCount: job.retryCount,
            cacheHit: true,
            logs: job.logs,
          });
          return;
        }
      }

      // Execute job with timeout
      const progressCallback = async (progress: JobProgress) => {
        await this.updateJobProgress(job.id, progress);
      };

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Job timeout')), job.config.timeout);
      });

      result = await Promise.race([
        handlerInfo.handler(job, job.context, progressCallback),
        timeoutPromise,
      ]);

      // Cache result if enabled
      if (job.config.cacheResults) {
        await this.setCachedResult(cacheKey, result, job.config.cacheTTL);
      }

      await this.completeJob(job, {
        success: true,
        data: result,
        executionTime: Date.now() - startTime,
        retryCount: job.retryCount,
        logs: job.logs,
      });
    } catch (error) {
      await this.handleJobError(job, error as Error, startTime);
    }
  }

  private async completeJob(job: Job, result: JobResult): Promise<void> {
    job.status = JobStatus.COMPLETED;
    job.completedAt = new Date();
    job.result = result;
    job.logs.push(`Job completed successfully in ${result.executionTime}ms`);

    this.statistics.runningJobs = Math.max(0, this.statistics.runningJobs - 1);
    this.statistics.completedJobs++;
    this.updateAverageExecutionTime(result.executionTime);

    this.emit('jobCompleted', job, result);

    // Deliver result via webhook if configured
    if (job.config.enableWebhookDelivery && job.config.webhookUrl) {
      const webhookConfig: WebhookConfig = {
        url: job.config.webhookUrl,
        method: 'POST',
        timeout: 30000,
        retries: 3,
        retryDelay: 1000,
        enableAuth: false,
        ...this.config.defaultWebhookConfig,
      };

      await this.deliverResultViaWebhook(job, result, webhookConfig);
    }

    // Send final progress update
    if (this.config.enableDiscordProgressUpdates && job.config.enableProgressUpdates) {
      await this.sendCompletionUpdate(job, result);
    }
  }

  private async handleJobError(job: Job, error: Error, startTime: number): Promise<void> {
    job.lastError = error;
    job.logs.push(`Job failed: ${error.message}`);

    const executionTime = Date.now() - startTime;

    // Check if we should retry
    if (job.retryCount < job.config.maxRetries) {
      job.retryCount++;
      job.status = JobStatus.RETRYING;
      job.logs.push(`Retrying job (attempt ${job.retryCount}/${job.config.maxRetries})`);

      this.statistics.runningJobs = Math.max(0, this.statistics.runningJobs - 1);
      this.statistics.pendingJobs++;

      this.emit('jobRetry', job, job.retryCount);

      // Schedule retry with backoff
      const retryDelay =
        job.config.retryDelay * Math.pow(job.config.retryBackoffMultiplier, job.retryCount - 1);

      setTimeout(() => {
        job.status = JobStatus.PENDING;
        this.processingQueue.push(job);
        this.sortProcessingQueue();
      }, retryDelay);
    } else {
      // Job has failed permanently
      job.status = JobStatus.FAILED;
      job.completedAt = new Date();
      job.result = {
        success: false,
        error,
        executionTime,
        retryCount: job.retryCount,
        logs: job.logs,
      };

      this.statistics.runningJobs = Math.max(0, this.statistics.runningJobs - 1);
      this.statistics.failedJobs++;
      this.updateErrorRate();

      this.emit('jobFailed', job, error);

      // Send failure notification
      if (this.config.enableDiscordProgressUpdates) {
        await this.sendFailureUpdate(job, error);
      }
    }
  }

  private async sendCompletionUpdate(job: Job, result: JobResult): Promise<void> {
    const interaction = job.context.interaction;
    if (!interaction || !interaction.isRepliable()) return;

    try {
      const embed = new EmbedBuilder()
        .setTitle(`Job Completed: ${job.type}`)
        .setDescription('Job has been completed successfully!')
        .setColor(0x2ecc71)
        .addFields([
          {
            name: 'Execution Time',
            value: `${result.executionTime}ms`,
            inline: true,
          },
          {
            name: 'Retry Count',
            value: result.retryCount.toString(),
            inline: true,
          },
          {
            name: 'Cache Hit',
            value: result.cacheHit ? 'Yes' : 'No',
            inline: true,
          },
        ])
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed],
        components: [],
      });
    } catch (error) {
      console.error('Failed to send completion update:', error);
    }
  }

  private async sendFailureUpdate(job: Job, error: Error): Promise<void> {
    const interaction = job.context.interaction;
    if (!interaction || !interaction.isRepliable()) return;

    try {
      const embed = new EmbedBuilder()
        .setTitle(`Job Failed: ${job.type}`)
        .setDescription(`Job failed after ${job.retryCount} retries`)
        .setColor(0xe74c3c)
        .addFields([
          {
            name: 'Error',
            value: error.message.substring(0, 1024),
            inline: false,
          },
          {
            name: 'Retry Count',
            value: job.retryCount.toString(),
            inline: true,
          },
        ])
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed],
        components: [],
      });
    } catch (err) {
      console.error('Failed to send failure update:', err);
    }
  }

  // Utility methods
  private sortProcessingQueue(): void {
    this.processingQueue.sort((a, b) => {
      // Sort by priority first, then by creation time
      if (a.config.priority !== b.config.priority) {
        return b.config.priority - a.config.priority;
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  private createProgressBar(percentage: number, length: number = 20): string {
    const filled = Math.round((percentage / 100) * length);
    const empty = length - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percentage.toFixed(1)}%`;
  }

  private initializeStatistics(): JobQueueStatistics {
    return {
      totalJobs: 0,
      pendingJobs: 0,
      runningJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      cancelledJobs: 0,
      averageExecutionTime: 0,
      averageWaitTime: 0,
      throughputPerMinute: 0,
      errorRate: 0,
      retryRate: 0,
      cacheHitRate: 0,
      memoryUsage: 0,
      queueHealth: 'healthy',
      lastResetTime: new Date(),
    };
  }

  private initializeHealth(): JobQueueHealth {
    return {
      status: 'healthy',
      uptime: 0,
      totalJobs: 0,
      recentErrors: 0,
      memoryUsage: 0,
      processingRate: 0,
      queueBacklog: 0,
      lastHealthCheck: new Date(),
      issues: [],
      recommendations: [],
    };
  }

  private setupTimers(): void {
    // Cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldJobs();
    }, this.config.cleanupInterval);

    // Metrics collection timer
    this.metricsTimer = setInterval(() => {
      this.updateStatistics();
    }, this.config.metricsCollectionInterval);

    // Health check timer
    this.healthCheckTimer = setInterval(() => {
      this.updateHealthStatus();
    }, this.config.healthCheckInterval);
  }

  private setupEventHandlers(): void {
    this.on('jobCompleted', () => this.updateStatistics());
    this.on('jobFailed', () => this.updateStatistics());
    this.on('jobCancelled', () => this.updateStatistics());
  }

  private updateAverageExecutionTime(executionTime: number): void {
    const totalCompleted = this.statistics.completedJobs;
    if (totalCompleted === 1) {
      this.statistics.averageExecutionTime = executionTime;
    } else {
      this.statistics.averageExecutionTime =
        (this.statistics.averageExecutionTime * (totalCompleted - 1) + executionTime) /
        totalCompleted;
    }
  }

  private updateErrorRate(): void {
    const total = this.statistics.completedJobs + this.statistics.failedJobs;
    this.statistics.errorRate = total > 0 ? this.statistics.failedJobs / total : 0;
  }

  private async updateStatistics(): Promise<void> {
    // Update cache statistics
    const cacheStats = await this.resultCache.getStats();
    this.statistics.cacheHitRate = cacheStats.hitRate;

    // Update memory usage
    const memUsage = process.memoryUsage();
    this.statistics.memoryUsage = memUsage.heapUsed;

    // Update throughput
    const uptime = Date.now() - this.startTime;
    const minutes = uptime / (1000 * 60);
    this.statistics.throughputPerMinute = minutes > 0 ? this.statistics.completedJobs / minutes : 0;

    // Update queue health
    this.updateQueueHealth();
  }

  private updateQueueHealth(): void {
    if (this.statistics.errorRate > 0.5) {
      this.statistics.queueHealth = 'critical';
    } else if (
      this.statistics.errorRate > 0.2 ||
      this.processingQueue.length > this.config.maxQueueSize * 0.8
    ) {
      this.statistics.queueHealth = 'degraded';
    } else {
      this.statistics.queueHealth = 'healthy';
    }
  }

  private async updateHealthStatus(): Promise<void> {
    this.health.uptime = Date.now() - this.startTime;
    this.health.totalJobs = this.statistics.totalJobs;
    this.health.recentErrors = this.statistics.failedJobs;
    this.health.memoryUsage = this.statistics.memoryUsage;
    this.health.processingRate = this.statistics.throughputPerMinute;
    this.health.queueBacklog = this.processingQueue.length;
    this.health.lastHealthCheck = new Date();

    // Update health status
    this.health.issues = [];
    this.health.recommendations = [];

    if (this.statistics.errorRate > 0.5) {
      this.health.status = 'critical';
      this.health.issues.push('High error rate detected');
      this.health.recommendations.push('Review job handlers and error logs');
    } else if (this.statistics.errorRate > 0.2) {
      this.health.status = 'degraded';
      this.health.issues.push('Elevated error rate');
      this.health.recommendations.push('Monitor job execution patterns');
    } else {
      this.health.status = 'healthy';
    }

    if (this.processingQueue.length > this.config.maxQueueSize * 0.8) {
      this.health.issues.push('Queue backlog is high');
      this.health.recommendations.push('Consider increasing concurrent job limit');
    }

    if (this.statistics.memoryUsage > 1024 * 1024 * 1024) {
      // 1GB
      this.health.issues.push('High memory usage');
      this.health.recommendations.push('Consider reducing cache size or job retention time');
    }
  }

  // Public API methods
  async getStatistics(): Promise<JobQueueStatistics> {
    await this.updateStatistics();
    return { ...this.statistics };
  }

  async getHealthStatus(): Promise<JobQueueHealth> {
    await this.updateHealthStatus();
    return { ...this.health };
  }

  updateConfig(newConfig: Partial<AsyncJobQueueConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logService.logActivity('Job queue configuration updated', [], 'config_updated');
  }

  getConfig(): AsyncJobQueueConfig {
    return { ...this.config };
  }

  async cleanupOldJobs(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [jobId, job] of this.jobs.entries()) {
      const shouldCleanup =
        (job.status === JobStatus.COMPLETED &&
          job.completedAt &&
          now - job.completedAt.getTime() > this.config.completedJobRetentionTime) ||
        (job.status === JobStatus.FAILED &&
          job.completedAt &&
          now - job.completedAt.getTime() > this.config.failedJobRetentionTime) ||
        (job.status === JobStatus.CANCELLED &&
          job.completedAt &&
          now - job.completedAt.getTime() > this.config.completedJobRetentionTime);

      if (shouldCleanup) {
        this.jobs.delete(jobId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logService.logActivity(`Cleaned up ${cleaned} old jobs`, [], 'jobs_cleaned', {
        count: cleaned,
      });
    }

    return cleaned;
  }

  async clearQueue(status?: JobStatus): Promise<number> {
    let cleared = 0;

    if (status) {
      for (const [jobId, job] of this.jobs.entries()) {
        if (job.status === status) {
          this.jobs.delete(jobId);
          cleared++;
        }
      }
    } else {
      cleared = this.jobs.size;
      this.jobs.clear();
      this.processingQueue = [];
    }

    // Reset statistics
    this.statistics = this.initializeStatistics();

    this.logService.logActivity(`Cleared ${cleared} jobs from queue`, [], 'queue_cleared', {
      count: cleared,
      status: status || 'all',
    });

    return cleared;
  }

  /**
   * Shutdown the job queue and cleanup resources
   */
  shutdown(): void {
    // Clear all timers
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    this.logService.logActivity('Job queue shutdown completed', [], 'queue_shutdown');
  }
}
