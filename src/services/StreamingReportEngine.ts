// src/services/StreamingReportEngine.ts - Core Streaming Report Engine

import { EventEmitter } from 'events';
import { Collection, GuildMember } from 'discord.js';
import { injectable, inject } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';

import type {
  IStreamingReportEngine,
  StreamingReportConfig,
  StreamingReportResult,
  PartialReportResult,
  StreamingProgress,
  StreamingError,
  DateRange,
  ReportStatistics,
  MemoryStats,
  DiscordStreamingOptions
} from '../interfaces/IStreamingReportEngine';
import { StreamingStage } from '../interfaces/IStreamingReportEngine.js';

import type { IUserClassificationService } from '../interfaces/IUserClassificationService';
import { DI_TOKENS } from '../interfaces/index.js';
import { EmbedFactory } from '../utils/embedBuilder.js';

/**
 * Operation context for tracking streaming operations
 */
interface OperationContext {
  id: string;
  startTime: number;
  stage: StreamingStage;
  progress: StreamingProgress;
  abortController: AbortController;
  memoryUsage: number;
  errorCount: number;
  recoveredErrors: number;
  batchesProcessed: number;
  lastUpdateTime: number;
}

/**
 * Memory buffer pool for efficient reuse
 */
class MemoryBufferPool {
  private buffers: Buffer[] = [];
  private readonly maxSize: number;
  private readonly bufferSize: number;

  constructor(maxSize = 10, bufferSize = 1024 * 1024) {
    this.maxSize = maxSize;
    this.bufferSize = bufferSize;
  }

  acquire(): Buffer {
    const buffer = this.buffers.pop();
    return buffer || Buffer.alloc(this.bufferSize);
  }

  release(buffer: Buffer): void {
    if (this.buffers.length < this.maxSize) {
      buffer.fill(0); // Clear sensitive data
      this.buffers.push(buffer);
    }
  }

  cleanup(): void {
    this.buffers.length = 0;
  }

  getUsage(): number {
    return this.buffers.length;
  }
}

/**
 * Streaming report engine implementation
 */
@injectable()
export class StreamingReportEngine extends EventEmitter implements IStreamingReportEngine {
  private config: StreamingReportConfig;
  private operations = new Map<string, OperationContext>();
  private bufferPool: MemoryBufferPool;
  private memoryStats: MemoryStats;
  private gcTimer: NodeJS.Timeout | null = null;
  private userClassificationService: IUserClassificationService;

  constructor(
    @inject(DI_TOKENS.IUserClassificationService) userClassificationService: IUserClassificationService,
    @inject(DI_TOKENS.StreamingReportConfig) defaultConfig: StreamingReportConfig
  ) {
    super();
    
    const customConfig: Partial<StreamingReportConfig> = {};
    this.userClassificationService = userClassificationService;
    this.config = { ...defaultConfig, ...customConfig };
    this.bufferPool = new MemoryBufferPool(10, 1024 * 1024);
    
    this.memoryStats = {
      current: 0,
      peak: 0,
      gcCount: 0,
      bufferPoolUsage: 0,
      cacheSize: 0
    };

    this.initializeMemoryMonitoring();
  }

  /**
   * Generate a streaming report with real-time updates
   */
  async generateReport(
    role: string,
    members: Collection<string, GuildMember>,
    dateRange: DateRange,
    config?: Partial<StreamingReportConfig>,
    discordOptions?: DiscordStreamingOptions
  ): Promise<StreamingReportResult> {
    const operationId = uuidv4();
    const effectiveConfig = { ...this.config, ...config };
    
    console.log(`[StreamingEngine] Starting report generation: ${operationId}`);

    // Initialize operation context
    const context: OperationContext = {
      id: operationId,
      startTime: Date.now(),
      stage: StreamingStage.INITIALIZING,
      progress: {
        current: 0,
        total: 100,
        percentage: 0,
        message: '보고서 생성을 시작합니다...',
        stage: StreamingStage.INITIALIZING,
        itemsProcessed: 0,
        processingRate: 0
      },
      abortController: new AbortController(),
      memoryUsage: 0,
      errorCount: 0,
      recoveredErrors: 0,
      batchesProcessed: 0,
      lastUpdateTime: Date.now()
    };

    this.operations.set(operationId, context);

    try {
      // Emit initial progress
      this.emitProgress(context);

      // Initialize memory tracking
      this.updateMemoryUsage(context);
      
      // Process members in streaming batches
      const result = await this.processStreamingReport(
        context,
        role,
        members,
        dateRange,
        effectiveConfig,
        discordOptions
      );

      // Mark as completed
      context.stage = StreamingStage.COMPLETED;
      context.progress.percentage = 100;
      context.progress.message = '보고서 생성이 완료되었습니다!';
      this.emitProgress(context);

      console.log(`[StreamingEngine] Report generation completed: ${operationId}`);
      this.emit('complete', result);

      return result;

    } catch (error) {
      console.error(`[StreamingEngine] Report generation failed: ${operationId}`, error);
      
      const streamingError: StreamingError = {
        code: 'GENERATION_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
        stage: context.stage,
        recoverable: false,
        context: { operationId, role, memberCount: members.size },
        timestamp: new Date()
      };

      context.stage = StreamingStage.ERROR;
      this.emit('error', streamingError);

      // Return partial result if available
      return {
        operationId,
        embeds: [],
        statistics: this.generateEmptyStatistics(),
        metadata: {
          role,
          dateRange,
          totalMembers: members.size,
          processingTime: Date.now() - context.startTime,
          memoryUsage: context.memoryUsage,
          errorCount: context.errorCount,
          recoveredErrors: context.recoveredErrors
        },
        success: false,
        error: streamingError
      };

    } finally {
      // Cleanup operation
      this.cleanupOperation(operationId);
    }
  }

  /**
   * Process streaming report with batched processing
   */
  private async processStreamingReport(
    context: OperationContext,
    role: string,
    members: Collection<string, GuildMember>,
    dateRange: DateRange,
    config: StreamingReportConfig,
    discordOptions?: DiscordStreamingOptions
  ): Promise<StreamingReportResult> {
    const { startDate, endDate } = dateRange;
    const totalMembers = members.size;
    const batches = this.createMemberBatches(members, config.batchSize);
    
    console.log(`[StreamingEngine] Processing ${totalMembers} members in ${batches.length} batches`);

    // Update progress
    context.stage = StreamingStage.PROCESSING_DATA;
    context.progress.total = batches.length + 2; // +2 for initialization and finalization
    context.progress.current = 1;
    context.progress.message = `${totalMembers}명의 멤버를 ${batches.length}개 배치로 처리합니다...`;
    this.emitProgress(context);

    // Process batches with streaming
    const allActiveUsers: any[] = [];
    const allInactiveUsers: any[] = [];
    const allAfkUsers: any[] = [];
    let processingStartTime = Date.now();

    for (let i = 0; i < batches.length; i++) {
      if (context.abortController.signal.aborted) {
        throw new Error('Operation was cancelled');
      }

      const batch = batches[i];
      const batchStartTime = Date.now();

      try {
        // Process batch with error recovery
        const batchResult = await this.processBatchWithRecovery(
          context,
          batch,
          role,
          startDate,
          endDate,
          i + 1,
          batches.length
        );

        // Accumulate results
        allActiveUsers.push(...batchResult.activeUsers);
        allInactiveUsers.push(...batchResult.inactiveUsers);
        allAfkUsers.push(...batchResult.afkUsers);

        // Generate partial result if enabled
        if (config.enablePartialStreaming && (i + 1) % 3 === 0) {
          await this.generatePartialResult(
            context,
            role,
            {
              activeUsers: allActiveUsers,
              inactiveUsers: allInactiveUsers,
              afkUsers: allAfkUsers
            },
            dateRange,
            i + 1,
            batches.length,
            discordOptions
          );
        }

        // Update progress
        context.progress.current = i + 2;
        context.progress.percentage = Math.round(((i + 1) / batches.length) * 90); // Reserve 10% for finalization
        context.progress.itemsProcessed = (i + 1) * config.batchSize;
        
        const batchTime = Date.now() - batchStartTime;
        const totalTime = Date.now() - processingStartTime;
        context.progress.processingRate = context.progress.itemsProcessed / (totalTime / 1000);
        context.progress.estimatedTimeRemaining = (batches.length - i - 1) * batchTime;
        context.progress.message = `배치 ${i + 1}/${batches.length} 처리 완료 (${batch.size}명)`;
        
        this.emitProgress(context);
        context.batchesProcessed++;

        // Memory management
        this.updateMemoryUsage(context);
        if (context.memoryUsage > config.memoryCleanupThreshold * 1024 * 1024) {
          await this.performMemoryCleanup();
        }

        // Throttle to prevent overwhelming Discord API
        if (discordOptions?.updateThrottle) {
          await this.sleep(discordOptions.updateThrottle);
        }

      } catch (error) {
        console.error(`[StreamingEngine] Batch ${i + 1} failed:`, error);
        context.errorCount++;

        if (config.enableErrorRecovery && context.errorCount <= config.maxRetries) {
          console.log(`[StreamingEngine] Recovering from batch error (${context.errorCount}/${config.maxRetries})`);
          context.recoveredErrors++;
          // Continue with next batch
          continue;
        } else {
          throw error;
        }
      }
    }

    // Finalization stage
    context.stage = StreamingStage.FINALIZING;
    context.progress.current = batches.length + 1;
    context.progress.percentage = 95;
    context.progress.message = '최종 보고서를 생성하고 있습니다...';
    this.emitProgress(context);

    // Generate final embeds
    const embeds = EmbedFactory.createActivityEmbeds({
      role,
      activeUsers: allActiveUsers,
      inactiveUsers: allInactiveUsers,
      afkUsers: allAfkUsers,
      startDate,
      endDate,
      minHours: 0, // This would come from role settings
      reportCycle: null,
      title: '📊 실시간 스트리밍 활동 보고서'
    });

    // Generate final statistics
    const statistics: ReportStatistics = {
      totalMembers,
      activeMembers: allActiveUsers.length,
      inactiveMembers: allInactiveUsers.length,
      afkMembers: allAfkUsers.length,
      averageActivity: this.calculateAverageActivity(allActiveUsers),
      processingTime: Date.now() - context.startTime,
      memoryPeak: this.memoryStats.peak,
      batchesProcessed: context.batchesProcessed,
      errorsRecovered: context.recoveredErrors
    };

    return {
      operationId: context.id,
      embeds,
      statistics,
      metadata: {
        role,
        dateRange,
        totalMembers,
        processingTime: statistics.processingTime,
        memoryUsage: context.memoryUsage,
        errorCount: context.errorCount,
        recoveredErrors: context.recoveredErrors
      },
      success: true
    };
  }

  /**
   * Create member batches for processing
   */
  private createMemberBatches(
    members: Collection<string, GuildMember>,
    batchSize: number
  ): Collection<string, GuildMember>[] {
    const batches: Collection<string, GuildMember>[] = [];
    const memberArray = Array.from(members.entries());

    for (let i = 0; i < memberArray.length; i += batchSize) {
      const batchEntries = memberArray.slice(i, i + batchSize);
      const batch = new Collection<string, GuildMember>();
      
      for (const [id, member] of batchEntries) {
        batch.set(id, member);
      }
      
      batches.push(batch);
    }

    return batches;
  }

  /**
   * Process a batch with error recovery
   */
  private async processBatchWithRecovery(
    _context: OperationContext,
    batch: Collection<string, GuildMember>,
    role: string,
    startDate: Date,
    endDate: Date,
    _batchNumber: number,
    _totalBatches: number
  ): Promise<{ activeUsers: any[]; inactiveUsers: any[]; afkUsers: any[] }> {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount <= maxRetries) {
      try {
        // Use the existing classification service
        const classificationResult = await this.userClassificationService.classifyUsersByDateRange(
          role,
          batch,
          startDate,
          endDate
        );

        return {
          activeUsers: classificationResult.activeUsers || [],
          inactiveUsers: classificationResult.inactiveUsers || [],
          afkUsers: classificationResult.afkUsers || []
        };

      } catch (error) {
        retryCount++;
        console.error(`[StreamingEngine] Batch processing failed (attempt ${retryCount}/${maxRetries}):`, error);

        if (retryCount > maxRetries) {
          throw error;
        }

        // Exponential backoff
        await this.sleep(Math.pow(2, retryCount) * 1000);
      }
    }

    // This should never be reached due to the throw above
    throw new Error('Maximum retry attempts exceeded');
  }

  /**
   * Generate partial result for streaming
   */
  private async generatePartialResult(
    context: OperationContext,
    role: string,
    partialData: { activeUsers: any[]; inactiveUsers: any[]; afkUsers: any[] },
    dateRange: DateRange,
    currentBatch: number,
    totalBatches: number,
    _discordOptions?: DiscordStreamingOptions
  ): Promise<void> {
    context.stage = StreamingStage.GENERATING_PARTIAL;

    // Generate partial embeds (limited number)
    const partialEmbeds = EmbedFactory.createActivityEmbeds({
      role,
      activeUsers: partialData.activeUsers.slice(0, 20), // Limit for partial results
      inactiveUsers: partialData.inactiveUsers.slice(0, 10),
      afkUsers: partialData.afkUsers.slice(0, 10),
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      minHours: 0,
      reportCycle: null,
      title: `📊 부분 결과 (${currentBatch}/${totalBatches} 배치 처리됨)`
    });

    const partialResult: PartialReportResult = {
      id: `${context.id}-partial-${currentBatch}`,
      progress: { ...context.progress },
      embeds: partialEmbeds.slice(0, this.config.partialEmbedLimit),
      statistics: {
        totalMembers: partialData.activeUsers.length + partialData.inactiveUsers.length + partialData.afkUsers.length,
        activeMembers: partialData.activeUsers.length,
        inactiveMembers: partialData.inactiveUsers.length,
        afkMembers: partialData.afkUsers.length
      },
      batchInfo: {
        batchNumber: currentBatch,
        totalBatches,
        itemsInBatch: context.progress.itemsProcessed || 0
      },
      isFinal: false,
      timestamp: new Date()
    };

    this.emit('partial-result', partialResult);
    context.stage = StreamingStage.PROCESSING_DATA; // Return to processing
  }

  /**
   * Cancel an ongoing operation
   */
  async cancelOperation(operationId: string): Promise<boolean> {
    const context = this.operations.get(operationId);
    if (!context) {
      return false;
    }

    context.abortController.abort();
    this.emit('operation-cancelled', operationId);
    this.cleanupOperation(operationId);
    
    console.log(`[StreamingEngine] Operation cancelled: ${operationId}`);
    return true;
  }

  /**
   * Get operation status
   */
  getOperationStatus(operationId: string): StreamingProgress | null {
    const context = this.operations.get(operationId);
    return context ? { ...context.progress } : null;
  }

  /**
   * Configure the engine
   */
  configure(config: Partial<StreamingReportConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[StreamingEngine] Configuration updated:', config);
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(): MemoryStats {
    this.updateMemoryStats();
    return { ...this.memoryStats };
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    console.log('[StreamingEngine] Cleaning up resources...');

    // Cancel all operations
    for (const [operationId] of this.operations) {
      await this.cancelOperation(operationId);
    }

    // Clear timers
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }

    // Clean up buffer pool
    this.bufferPool.cleanup();

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    console.log('[StreamingEngine] Cleanup completed');
  }

  /**
   * Initialize memory monitoring
   */
  private initializeMemoryMonitoring(): void {
    this.gcTimer = setInterval(() => {
      this.updateMemoryStats();
      
      if (this.memoryStats.current > this.config.maxMemoryMB * 1024 * 1024 * 0.8) {
        this.emit('memory-warning', this.getMemoryStats());
        this.performMemoryCleanup();
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Update memory usage statistics
   */
  private updateMemoryStats(): void {
    const usage = process.memoryUsage();
    this.memoryStats.current = usage.heapUsed;
    this.memoryStats.peak = Math.max(this.memoryStats.peak, usage.heapUsed);
    this.memoryStats.bufferPoolUsage = this.bufferPool.getUsage();
    this.memoryStats.cacheSize = this.operations.size;
  }

  /**
   * Update memory usage for operation context
   */
  private updateMemoryUsage(context: OperationContext): void {
    const usage = process.memoryUsage();
    context.memoryUsage = usage.heapUsed;
    this.updateMemoryStats();
  }

  /**
   * Perform memory cleanup
   */
  private async performMemoryCleanup(): Promise<void> {
    console.log('[StreamingEngine] Performing memory cleanup...');

    // Clean up old operations (older than 1 hour)
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [operationId, context] of this.operations) {
      if (context.startTime < cutoff) {
        this.cleanupOperation(operationId);
      }
    }

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      this.memoryStats.gcCount++;
    }

    this.updateMemoryStats();
    console.log(`[StreamingEngine] Memory cleanup completed. Current usage: ${Math.round(this.memoryStats.current / 1024 / 1024)}MB`);
  }

  /**
   * Clean up operation context
   */
  private cleanupOperation(operationId: string): void {
    const context = this.operations.get(operationId);
    if (context) {
      context.abortController.abort();
      this.operations.delete(operationId);
    }
  }

  /**
   * Emit progress update
   */
  private emitProgress(context: OperationContext): void {
    const now = Date.now();
    if (now - context.lastUpdateTime >= this.config.progressUpdateInterval) {
      this.emit('progress', { ...context.progress });
      context.lastUpdateTime = now;
    }
  }

  /**
   * Calculate average activity
   */
  private calculateAverageActivity(activeUsers: any[]): number {
    if (activeUsers.length === 0) return 0;
    
    const totalActivity = activeUsers.reduce((sum, user) => {
      return sum + (user.totalVoiceTime || 0);
    }, 0);
    
    return totalActivity / activeUsers.length;
  }

  /**
   * Generate empty statistics for error cases
   */
  private generateEmptyStatistics(): ReportStatistics {
    return {
      totalMembers: 0,
      activeMembers: 0,
      inactiveMembers: 0,
      afkMembers: 0,
      averageActivity: 0,
      processingTime: 0,
      memoryPeak: this.memoryStats.peak,
      batchesProcessed: 0,
      errorsRecovered: 0
    };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}