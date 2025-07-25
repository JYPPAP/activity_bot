// src/services/IncrementalDataProcessor.ts - Incremental Data Processing System

import { EventEmitter } from 'events';
import { Collection, GuildMember } from 'discord.js';
import { injectable, inject } from 'tsyringe';

import type { IDatabaseManager } from '../interfaces/IDatabaseManager';
import type { IUserClassificationService } from '../interfaces/IUserClassificationService';
import { DI_TOKENS } from '../interfaces/index';

/**
 * Data chunk for incremental processing
 */
export interface DataChunk<T> {
  id: string;
  data: T[];
  metadata: {
    chunkIndex: number;
    totalChunks: number;
    chunkSize: number;
    processingTime?: number;
    memoryUsage?: number;
  };
  timestamp: Date;
}

/**
 * Processing result for a data chunk
 */
export interface ChunkProcessingResult<T, R> {
  chunkId: string;
  originalData: T[];
  processedData: R[];
  statistics: {
    itemsProcessed: number;
    itemsSkipped: number;
    itemsErrored: number;
    processingTime: number;
    memoryDelta: number;
  };
  errors: Array<{
    index: number;
    item: T;
    error: Error;
  }>;
  success: boolean;
}

/**
 * Incremental processing configuration
 */
export interface IncrementalProcessingConfig {
  /** Chunk size for processing */
  chunkSize: number;
  /** Maximum concurrent chunks */
  maxConcurrentChunks: number;
  /** Memory threshold for backpressure (MB) */
  memoryThresholdMB: number;
  /** Enable result caching */
  enableCaching: boolean;
  /** Cache TTL in milliseconds */
  cacheTTL: number;
  /** Enable error recovery */
  enableErrorRecovery: boolean;
  /** Maximum retry attempts per chunk */
  maxRetries: number;
  /** Backoff delay multiplier */
  backoffMultiplier: number;
  /** Enable progressive loading */
  enableProgressiveLoading: boolean;
  /** Yield frequency (items processed before yielding) */
  yieldFrequency: number;
}

/**
 * Memory-efficient data stream for large datasets
 */
export class DataStream<T> extends EventEmitter {
  private items: T[] = [];
  private currentIndex = 0;
  private isComplete = false;
  private readonly maxBufferSize: number;

  constructor(maxBufferSize = 1000) {
    super();
    this.maxBufferSize = maxBufferSize;
  }

  /**
   * Add items to the stream
   */
  push(items: T[]): void {
    this.items.push(...items);
    
    // Emit data event if buffer is getting full
    if (this.items.length >= this.maxBufferSize) {
      this.emit('data', this.items.splice(0, this.maxBufferSize));
    }
  }

  /**
   * Mark stream as complete
   */
  end(): void {
    this.isComplete = true;
    
    // Emit remaining items
    if (this.items.length > 0) {
      this.emit('data', this.items.splice(0));
    }
    
    this.emit('end');
  }

  /**
   * Get next chunk of data
   */
  next(size: number): T[] | null {
    if (this.currentIndex >= this.items.length) {
      return this.isComplete ? null : [];
    }

    const chunk = this.items.slice(this.currentIndex, this.currentIndex + size);
    this.currentIndex += size;
    
    return chunk;
  }

  /**
   * Check if more data is available
   */
  hasNext(): boolean {
    return this.currentIndex < this.items.length || !this.isComplete;
  }

  /**
   * Get stream statistics
   */
  getStats() {
    return {
      totalItems: this.items.length,
      currentIndex: this.currentIndex,
      bufferedItems: this.items.length - this.currentIndex,
      isComplete: this.isComplete
    };
  }
}

/**
 * Incremental data processor for large datasets
 */
@injectable()
export class IncrementalDataProcessor extends EventEmitter {
  private config: IncrementalProcessingConfig;
  private processingCache = new Map<string, ChunkProcessingResult<any, any>>();
  private activeChunks = new Set<string>();
  private retryCounters = new Map<string, number>();

  constructor(
    @inject(DI_TOKENS.IDatabaseManager) private dbManager: IDatabaseManager,
    @inject(DI_TOKENS.IUserClassificationService) private classificationService: IUserClassificationService,
    config: Partial<IncrementalProcessingConfig> = {}
  ) {
    super();
    
    this.config = {
      chunkSize: 50,
      maxConcurrentChunks: 3,
      memoryThresholdMB: 128,
      enableCaching: true,
      cacheTTL: 300000, // 5 minutes
      enableErrorRecovery: true,
      maxRetries: 3,
      backoffMultiplier: 2,
      enableProgressiveLoading: true,
      yieldFrequency: 10,
      ...config
    };
  }

  /**
   * Process members incrementally with memory management
   */
  async processMembersIncremental(
    members: Collection<string, GuildMember>,
    role: string,
    startDate: Date,
    endDate: Date,
    processingFn?: (chunk: GuildMember[]) => Promise<any[]>
  ): Promise<{
    activeUsers: any[];
    inactiveUsers: any[];
    afkUsers: any[];
    statistics: {
      totalProcessed: number;
      totalSkipped: number;
      totalErrors: number;
      totalChunks: number;
      processingTime: number;
      memoryPeak: number;
    };
  }> {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage().heapUsed;
    let memoryPeak = initialMemory;

    console.log(`[IncrementalProcessor] Starting incremental processing: ${members.size} members`);

    // Create data stream
    const memberStream = this.createMemberStream(members);
    
    // Initialize result accumulators
    const allActiveUsers: any[] = [];
    const allInactiveUsers: any[] = [];
    const allAfkUsers: any[] = [];
    
    let totalProcessed = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let totalChunks = 0;

    // Process chunks incrementally
    for await (const chunkResult of this.processChunksIncremental(
      memberStream,
      role,
      startDate,
      endDate,
      processingFn
    )) {
      // Accumulate results
      if (chunkResult.success) {
        const { activeUsers, inactiveUsers, afkUsers } = chunkResult.processedData as any;
        
        if (activeUsers) allActiveUsers.push(...activeUsers);
        if (inactiveUsers) allInactiveUsers.push(...inactiveUsers);
        if (afkUsers) allAfkUsers.push(...afkUsers);
      }

      // Update statistics
      totalProcessed += chunkResult.statistics.itemsProcessed;
      totalSkipped += chunkResult.statistics.itemsSkipped;
      totalErrors += chunkResult.statistics.itemsErrored;
      totalChunks++;

      // Track memory usage
      const currentMemory = process.memoryUsage().heapUsed;
      memoryPeak = Math.max(memoryPeak, currentMemory);

      // Emit progress
      this.emit('chunk-completed', {
        chunkId: chunkResult.chunkId,
        totalChunks,
        processed: totalProcessed,
        memoryUsage: currentMemory
      });

      // Memory management
      if (currentMemory > this.config.memoryThresholdMB * 1024 * 1024) {
        await this.performMemoryCleanup();
      }

      // Yield to event loop periodically
      if (totalChunks % this.config.yieldFrequency === 0) {
        await this.yieldToEventLoop();
      }
    }

    const processingTime = Date.now() - startTime;
    
    console.log(`[IncrementalProcessor] Completed incremental processing: ${totalChunks} chunks, ${processingTime}ms`);

    return {
      activeUsers: allActiveUsers,
      inactiveUsers: allInactiveUsers,
      afkUsers: allAfkUsers,
      statistics: {
        totalProcessed,
        totalSkipped,
        totalErrors,
        totalChunks,
        processingTime,
        memoryPeak: memoryPeak - initialMemory
      }
    };
  }

  /**
   * Create a memory-efficient member stream
   */
  private createMemberStream(members: Collection<string, GuildMember>): DataStream<GuildMember> {
    const stream = new DataStream<GuildMember>(this.config.chunkSize * 2);
    
    // Convert collection to array in chunks to avoid memory spike
    const memberArray = Array.from(members.values());
    const chunkSize = this.config.chunkSize;
    
    // Stream data in chunks
    setImmediate(() => {
      for (let i = 0; i < memberArray.length; i += chunkSize) {
        const chunk = memberArray.slice(i, i + chunkSize);
        stream.push(chunk);
      }
      stream.end();
    });

    return stream;
  }

  /**
   * Process chunks incrementally with concurrency control
   */
  private async *processChunksIncremental(
    memberStream: DataStream<GuildMember>,
    role: string,
    startDate: Date,
    endDate: Date,
    processingFn?: (chunk: GuildMember[]) => Promise<any[]>
  ): AsyncGenerator<ChunkProcessingResult<GuildMember, any>, void, unknown> {
    const activePromises = new Map<string, Promise<ChunkProcessingResult<GuildMember, any>>>();
    let chunkIndex = 0;
    let streamComplete = false;

    // Listen for stream completion
    memberStream.once('end', () => {
      streamComplete = true;
    });

    while (!streamComplete || activePromises.size > 0) {
      // Start new chunks if under concurrency limit and data available
      while (
        activePromises.size < this.config.maxConcurrentChunks &&
        memberStream.hasNext()
      ) {
        const chunkData = memberStream.next(this.config.chunkSize);
        
        if (chunkData && chunkData.length > 0) {
          const chunk = this.createDataChunk(chunkData, chunkIndex++);
          const promise = this.processChunkWithRetry(
            chunk,
            role,
            startDate,
            endDate,
            processingFn
          );
          
          activePromises.set(chunk.id, promise);
          this.activeChunks.add(chunk.id);
        }
      }

      // Wait for at least one chunk to complete
      if (activePromises.size > 0) {
        const results = await Promise.allSettled(activePromises.values());
        
        // Process completed chunks
        for (const [chunkId, promise] of activePromises.entries()) {
          try {
            const result = await promise;
            yield result;
            
            // Cleanup
            activePromises.delete(chunkId);
            this.activeChunks.delete(chunkId);
            this.cleanupChunkCache(chunkId);
            
          } catch (error) {
            console.error(`[IncrementalProcessor] Chunk ${chunkId} failed:`, error);
            
            // Create error result
            yield {
              chunkId,
              originalData: [],
              processedData: [],
              statistics: {
                itemsProcessed: 0,
                itemsSkipped: 0,
                itemsErrored: 1,
                processingTime: 0,
                memoryDelta: 0
              },
              errors: [{ index: 0, item: {} as GuildMember, error: error as Error }],
              success: false
            };
            
            activePromises.delete(chunkId);
            this.activeChunks.delete(chunkId);
          }
        }
      }

      // Yield to event loop
      await this.yieldToEventLoop();
    }
  }

  /**
   * Process a single chunk with retry logic
   */
  private async processChunkWithRetry(
    chunk: DataChunk<GuildMember>,
    role: string,
    startDate: Date,
    endDate: Date,
    processingFn?: (chunk: GuildMember[]) => Promise<any[]>
  ): Promise<ChunkProcessingResult<GuildMember, any>> {
    const maxRetries = this.config.enableErrorRecovery ? this.config.maxRetries : 0;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.processChunk(
          chunk,
          role,
          startDate,
          endDate,
          processingFn
        );
        
        // Reset retry counter on success
        this.retryCounters.delete(chunk.id);
        return result;
        
      } catch (error) {
        lastError = error as Error;
        
        console.warn(`[IncrementalProcessor] Chunk ${chunk.id} attempt ${attempt + 1} failed:`, error);
        
        if (attempt < maxRetries) {
          // Exponential backoff
          const delay = Math.pow(this.config.backoffMultiplier, attempt) * 1000;
          await this.sleep(delay);
          
          this.retryCounters.set(chunk.id, attempt + 1);
        }
      }
    }

    // All retries failed
    throw lastError || new Error('Unknown processing error');
  }

  /**
   * Process a single data chunk
   */
  private async processChunk(
    chunk: DataChunk<GuildMember>,
    role: string,
    startDate: Date,
    endDate: Date,
    processingFn?: (chunk: GuildMember[]) => Promise<any[]>
  ): Promise<ChunkProcessingResult<GuildMember, any>> {
    const chunkStartTime = Date.now();
    const initialMemory = process.memoryUsage().heapUsed;

    console.log(`[IncrementalProcessor] Processing chunk ${chunk.id}: ${chunk.data.length} items`);

    // Check cache first
    if (this.config.enableCaching) {
      const cacheKey = this.generateCacheKey(chunk, role, startDate, endDate);
      const cached = this.getCachedResult(cacheKey);
      if (cached) {
        console.log(`[IncrementalProcessor] Using cached result for chunk ${chunk.id}`);
        return cached;
      }
    }

    const errors: Array<{ index: number; item: GuildMember; error: Error }> = [];
    let itemsProcessed = 0;
    let itemsSkipped = 0;

    try {
      let processedData: any;

      if (processingFn) {
        // Use custom processing function
        processedData = await processingFn(chunk.data);
      } else {
        // Use default classification service
        const memberCollection = new Collection<string, GuildMember>();
        chunk.data.forEach(member => memberCollection.set(member.id, member));

        const classificationResult = await this.classificationService.classifyUsersByDateRange(
          role,
          memberCollection,
          startDate,
          endDate
        );

        processedData = {
          activeUsers: classificationResult.activeUsers || [],
          inactiveUsers: classificationResult.inactiveUsers || [],
          afkUsers: classificationResult.afkUsers || []
        };
      }

      itemsProcessed = chunk.data.length;

      const processingTime = Date.now() - chunkStartTime;
      const finalMemory = process.memoryUsage().heapUsed;

      const result: ChunkProcessingResult<GuildMember, any> = {
        chunkId: chunk.id,
        originalData: chunk.data,
        processedData,
        statistics: {
          itemsProcessed,
          itemsSkipped,
          itemsErrored: errors.length,
          processingTime,
          memoryDelta: finalMemory - initialMemory
        },
        errors,
        success: true
      };

      // Cache result if enabled
      if (this.config.enableCaching) {
        const cacheKey = this.generateCacheKey(chunk, role, startDate, endDate);
        this.setCachedResult(cacheKey, result);
      }

      console.log(`[IncrementalProcessor] Chunk ${chunk.id} completed: ${itemsProcessed} items, ${processingTime}ms`);
      
      return result;

    } catch (error) {
      console.error(`[IncrementalProcessor] Chunk ${chunk.id} processing failed:`, error);
      
      return {
        chunkId: chunk.id,
        originalData: chunk.data,
        processedData: [],
        statistics: {
          itemsProcessed: 0,
          itemsSkipped: chunk.data.length,
          itemsErrored: 1,
          processingTime: Date.now() - chunkStartTime,
          memoryDelta: process.memoryUsage().heapUsed - initialMemory
        },
        errors: [{ index: 0, item: chunk.data[0], error: error as Error }],
        success: false
      };
    }
  }

  /**
   * Create a data chunk
   */
  private createDataChunk<T>(
    data: T[],
    chunkIndex: number,
    totalChunks?: number
  ): DataChunk<T> {
    return {
      id: `chunk-${chunkIndex}-${Date.now()}`,
      data,
      metadata: {
        chunkIndex,
        totalChunks: totalChunks || -1,
        chunkSize: data.length
      },
      timestamp: new Date()
    };
  }

  /**
   * Generate cache key for chunk
   */
  private generateCacheKey(
    chunk: DataChunk<GuildMember>,
    role: string,
    startDate: Date,
    endDate: Date
  ): string {
    const memberIds = chunk.data.map(m => m.id).sort().join(',');
    const dateRange = `${startDate.getTime()}-${endDate.getTime()}`;
    return `chunk-${role}-${dateRange}-${this.hashString(memberIds)}`;
  }

  /**
   * Get cached result
   */
  private getCachedResult(cacheKey: string): ChunkProcessingResult<any, any> | null {
    const cached = this.processingCache.get(cacheKey);
    if (!cached) return null;

    // Check TTL
    const age = Date.now() - cached.statistics.processingTime;
    if (age > this.config.cacheTTL) {
      this.processingCache.delete(cacheKey);
      return null;
    }

    return cached;
  }

  /**
   * Set cached result
   */
  private setCachedResult(cacheKey: string, result: ChunkProcessingResult<any, any>): void {
    this.processingCache.set(cacheKey, result);

    // Cleanup old cache entries
    if (this.processingCache.size > 100) {
      const oldestKey = this.processingCache.keys().next().value;
      this.processingCache.delete(oldestKey);
    }
  }

  /**
   * Clean up chunk cache
   */
  private cleanupChunkCache(chunkId: string): void {
    // Clean up any chunk-specific cache entries
    for (const [key] of this.processingCache.entries()) {
      if (key.includes(chunkId)) {
        this.processingCache.delete(key);
      }
    }
  }

  /**
   * Perform memory cleanup
   */
  private async performMemoryCleanup(): Promise<void> {
    console.log('[IncrementalProcessor] Performing memory cleanup...');

    // Clear old cache entries
    const cutoff = Date.now() - this.config.cacheTTL;
    for (const [key, result] of this.processingCache.entries()) {
      if (result.statistics.processingTime < cutoff) {
        this.processingCache.delete(key);
      }
    }

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    const currentMemory = process.memoryUsage().heapUsed;
    console.log(`[IncrementalProcessor] Memory cleanup completed. Current usage: ${Math.round(currentMemory / 1024 / 1024)}MB`);
  }

  /**
   * Yield to event loop
   */
  private async yieldToEventLoop(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
  }

  /**
   * Simple string hash function
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get processing statistics
   */
  getProcessingStats() {
    return {
      activeCbunks: this.activeChunks.size,
      cachedResults: this.processingCache.size,
      retryCounters: this.retryCounters.size,
      memoryUsage: process.memoryUsage()
    };
  }

  /**
   * Configure the processor
   */
  configure(config: Partial<IncrementalProcessingConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[IncrementalProcessor] Configuration updated:', config);
  }

  /**
   * Clean up all resources
   */
  async cleanup(): Promise<void> {
    console.log('[IncrementalProcessor] Cleaning up resources...');
    
    this.processingCache.clear();
    this.activeChunks.clear();
    this.retryCounters.clear();
    
    console.log('[IncrementalProcessor] Cleanup completed');
  }
}