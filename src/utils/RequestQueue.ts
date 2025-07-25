// src/utils/RequestQueue.ts - Advanced Request Queue with Batching and Prioritization

import { EventEmitter } from 'events';
import { DiscordAPIRequest, RequestPriority, QueueStatistics, RequestQueueConfig } from '../interfaces/IDiscordAPIClient';

// Internal queue item interface
interface QueuedRequest {
  request: DiscordAPIRequest;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  queuedAt: number;
  priority: RequestPriority;
  batchable: boolean;
  retryCount: number;
}

// Batch processing interface
interface RequestBatch {
  id: string;
  requests: QueuedRequest[];
  createdAt: number;
  priority: RequestPriority;
  endpoint: string;
  method: string;
}

// Priority queue implementation
class PriorityQueue<T> {
  private items: Array<{ item: T; priority: number }> = [];
  private priorities: Record<RequestPriority, number> = {
    critical: 4,
    high: 3,
    normal: 2,
    low: 1
  };

  enqueue(item: T, priority: RequestPriority): void {
    const numericPriority = this.priorities[priority];
    const newItem = { item, priority: numericPriority };
    
    // Find insertion point to maintain priority order
    let insertIndex = 0;
    while (insertIndex < this.items.length && this.items[insertIndex].priority >= numericPriority) {
      insertIndex++;
    }
    
    this.items.splice(insertIndex, 0, newItem);
  }

  dequeue(): T | undefined {
    const item = this.items.shift();
    return item ? item.item : undefined;
  }

  peek(): T | undefined {
    return this.items.length > 0 ? this.items[0].item : undefined;
  }

  size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }

  toArray(): T[] {
    return this.items.map(item => item.item);
  }

  removeWhere(predicate: (item: T) => boolean): T[] {
    const removed: T[] = [];
    this.items = this.items.filter(({ item }) => {
      if (predicate(item)) {
        removed.push(item);
        return false;
      }
      return true;
    });
    return removed;
  }
}

export class RequestQueue extends EventEmitter {
  private queue: PriorityQueue<QueuedRequest> = new PriorityQueue();
  private batches: Map<string, RequestBatch> = new Map();
  private processing = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private batchTimeout: NodeJS.Timeout | null = null;
  private droppedRequests = 0;
  private totalQueued = 0;
  private totalProcessed = 0;
  private waitTimeSum = 0;
  private lastResetTime = Date.now();
  private isShuttingDown = false;

  constructor(private config: RequestQueueConfig) {
    super();
    this.startProcessing();
  }

  /**
   * Add a request to the queue
   */
  async enqueueRequest(request: DiscordAPIRequest): Promise<any> {
    if (this.isShuttingDown) {
      throw new Error('Request queue is shutting down');
    }

    // Check queue size limit
    if (this.queue.size() >= this.config.maxQueueSize) {
      this.droppedRequests++;
      this.emit('queueFull', this.queue.size());
      throw new Error(`Request queue is full (${this.queue.size()}/${this.config.maxQueueSize})`);
    }

    return new Promise((resolve, reject) => {
      const queuedRequest: QueuedRequest = {
        request,
        resolve,
        reject,
        queuedAt: Date.now(),
        priority: request.priority,
        batchable: request.batchable ?? true,
        retryCount: 0
      };

      // Add to priority queue
      this.queue.enqueue(queuedRequest, request.priority);
      this.totalQueued++;

      this.emit('requestQueued', request.id, request.priority);

      // Trigger immediate processing for critical requests
      if (request.priority === 'critical' && !this.processing) {
        this.processQueue();
      }
    });
  }

  /**
   * Remove a request from the queue
   */
  cancelRequest(requestId: string): boolean {
    const removed = this.queue.removeWhere(item => item.request.id === requestId);
    
    if (removed.length > 0) {
      removed.forEach(item => {
        item.reject(new Error('Request cancelled'));
      });
      this.emit('requestCancelled', requestId);
      return true;
    }

    // Check if it's in a batch
    for (const [batchId, batch] of this.batches) {
      const requestIndex = batch.requests.findIndex(item => item.request.id === requestId);
      if (requestIndex !== -1) {
        const [removedRequest] = batch.requests.splice(requestIndex, 1);
        removedRequest.reject(new Error('Request cancelled'));
        
        // Remove batch if empty
        if (batch.requests.length === 0) {
          this.batches.delete(batchId);
        }
        
        this.emit('requestCancelled', requestId);
        return true;
      }
    }

    return false;
  }

  /**
   * Get current queue statistics
   */
  getStatistics(): QueueStatistics {
    const now = Date.now();
    const uptime = now - this.lastResetTime;
    const processingRate = uptime > 0 ? (this.totalProcessed / uptime) * 1000 : 0;
    const averageWaitTime = this.totalProcessed > 0 ? this.waitTimeSum / this.totalProcessed : 0;

    // Calculate priority distribution
    const queuedItems = this.queue.toArray();
    const priorityDistribution: Record<string, number> = {
      critical: 0,
      high: 0,
      normal: 0,
      low: 0
    };

    queuedItems.forEach(item => {
      priorityDistribution[item.priority]++;
    });

    // Add batched requests to distribution
    for (const batch of this.batches.values()) {
      batch.requests.forEach(item => {
        priorityDistribution[item.priority]++;
      });
    }

    return {
      totalQueued: this.totalQueued,
      currentQueueSize: this.queue.size() + Array.from(this.batches.values()).reduce((sum, batch) => sum + batch.requests.length, 0),
      averageWaitTime: Math.round(averageWaitTime),
      processingRate: Math.round(processingRate * 100) / 100,
      droppedRequests: this.droppedRequests,
      batchesProcessed: this.batches.size,
      priorityDistribution
    };
  }

  /**
   * Clear the queue and reset statistics
   */
  clear(): void {
    // Reject all queued requests
    const queuedItems = this.queue.toArray();
    queuedItems.forEach(item => {
      item.reject(new Error('Queue cleared'));
    });
    this.queue.clear();

    // Reject all batched requests
    for (const batch of this.batches.values()) {
      batch.requests.forEach(item => {
        item.reject(new Error('Queue cleared'));
      });
    }
    this.batches.clear();

    this.resetStatistics();
    this.emit('queueCleared');
  }

  /**
   * Reset statistics
   */
  resetStatistics(): void {
    this.droppedRequests = 0;
    this.totalQueued = 0;
    this.totalProcessed = 0;
    this.waitTimeSum = 0;
    this.lastResetTime = Date.now();
  }

  /**
   * Shutdown the queue
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Stop processing
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    // Wait for current processing to complete (with timeout)
    const maxWaitTime = 5000;
    const startTime = Date.now();
    while (this.processing && (Date.now() - startTime) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Clear remaining requests
    this.clear();

    this.emit('shutdown');
  }

  /**
   * Start the queue processing interval
   */
  private startProcessing(): void {
    this.processingInterval = setInterval(() => {
      if (!this.processing) {
        this.processQueue();
      }
    }, this.config.processingInterval);
  }

  /**
   * Process the queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.isShuttingDown) {
      return;
    }

    this.processing = true;
    
    try {
      // Process batches first
      await this.processBatches();

      // Process individual requests
      await this.processIndividualRequests();
    } catch (error) {
      this.emit('processingError', error);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Process batched requests
   */
  private async processBatches(): Promise<void> {
    const batchesToProcess = Array.from(this.batches.values())
      .filter(batch => {
        const age = Date.now() - batch.createdAt;
        return batch.requests.length >= this.config.batchSize || age >= this.config.batchTimeout;
      })
      .sort((a, b) => {
        // Sort by priority, then by age
        const priorityOrder = { critical: 4, high: 3, normal: 2, low: 1 };
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        return priorityDiff !== 0 ? priorityDiff : a.createdAt - b.createdAt;
      });

    for (const batch of batchesToProcess) {
      await this.processBatch(batch);
      this.batches.delete(batch.id);
    }
  }

  /**
   * Process individual requests from the queue
   */
  private async processIndividualRequests(): Promise<void> {
    const requestsToProcess: QueuedRequest[] = [];
    
    // Dequeue up to batchSize requests
    for (let i = 0; i < this.config.batchSize && this.queue.size() > 0; i++) {
      const request = this.queue.dequeue();
      if (request) {
        requestsToProcess.push(request);
      }
    }

    // Group batchable requests
    const batchableRequests = requestsToProcess.filter(req => req.batchable);
    const nonBatchableRequests = requestsToProcess.filter(req => !req.batchable);

    // Process non-batchable requests immediately
    const individualProcessingPromises = nonBatchableRequests.map(request => 
      this.processRequest(request)
    );

    // Group batchable requests by endpoint and method
    const batchGroups = new Map<string, QueuedRequest[]>();
    batchableRequests.forEach(request => {
      const key = `${request.request.method}:${request.request.endpoint}`;
      if (!batchGroups.has(key)) {
        batchGroups.set(key, []);
      }
      batchGroups.get(key)!.push(request);
    });

    // Create or add to batches
    for (const [key, requests] of batchGroups) {
      const [method, endpoint] = key.split(':', 2);
      const priority = this.getHighestPriority(requests.map(r => r.priority));
      
      const existingBatch = Array.from(this.batches.values()).find(
        batch => batch.method === method && batch.endpoint === endpoint && batch.priority === priority
      );

      if (existingBatch && existingBatch.requests.length + requests.length <= this.config.batchSize) {
        // Add to existing batch
        existingBatch.requests.push(...requests);
      } else {
        // Create new batch
        const batchId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const newBatch: RequestBatch = {
          id: batchId,
          requests,
          createdAt: Date.now(),
          priority,
          endpoint,
          method
        };
        this.batches.set(batchId, newBatch);
      }
    }

    // Wait for individual requests to complete
    await Promise.allSettled(individualProcessingPromises);
  }

  /**
   * Process a single batch
   */
  private async processBatch(batch: RequestBatch): Promise<void> {
    try {
      this.emit('batchProcessingStarted', batch.id, batch.requests.length);
      
      // Execute the batch request
      const results = await this.executeBatchRequest(batch);
      
      // Resolve individual requests with their results
      batch.requests.forEach((request, index) => {
        const result = results[index];
        const waitTime = Date.now() - request.queuedAt;
        
        this.waitTimeSum += waitTime;
        this.totalProcessed++;
        
        if (result.success) {
          request.resolve(result.data);
        } else {
          request.reject(result.error || new Error('Batch request failed'));
        }
      });

      this.emit('batchProcessingCompleted', batch.id, batch.requests.length);
    } catch (error) {
      // Reject all requests in the batch
      batch.requests.forEach(request => {
        request.reject(error instanceof Error ? error : new Error('Batch processing failed'));
      });
      
      this.emit('batchProcessingFailed', batch.id, error);
    }
  }

  /**
   * Process a single request
   */
  private async processRequest(request: QueuedRequest): Promise<void> {
    try {
      this.emit('requestProcessingStarted', request.request.id);
      
      const result = await this.executeRequest(request.request);
      const waitTime = Date.now() - request.queuedAt;
      
      this.waitTimeSum += waitTime;
      this.totalProcessed++;
      
      request.resolve(result);
      this.emit('requestProcessingCompleted', request.request.id, waitTime);
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error('Request processing failed'));
      this.emit('requestProcessingFailed', request.request.id, error);
    }
  }

  /**
   * Execute a batch request (to be implemented by the client)
   */
  private async executeBatchRequest(batch: RequestBatch): Promise<Array<{ success: boolean; data?: any; error?: Error }>> {
    // This is a placeholder - the actual implementation will be in the Discord API client
    // For now, we'll process each request individually
    const results = await Promise.allSettled(
      batch.requests.map(request => this.executeRequest(request.request))
    );

    return results.map(result => ({
      success: result.status === 'fulfilled',
      data: result.status === 'fulfilled' ? result.value : undefined,
      error: result.status === 'rejected' ? result.reason : undefined
    }));
  }

  /**
   * Execute a single request (to be implemented by the client)
   */
  private async executeRequest(request: DiscordAPIRequest): Promise<any> {
    // This is a placeholder - the actual implementation will be in the Discord API client
    throw new Error('executeRequest must be implemented by the client');
  }

  /**
   * Get the highest priority from a list of priorities
   */
  private getHighestPriority(priorities: RequestPriority[]): RequestPriority {
    const priorityOrder: RequestPriority[] = ['critical', 'high', 'normal', 'low'];
    for (const priority of priorityOrder) {
      if (priorities.includes(priority)) {
        return priority;
      }
    }
    return 'normal';
  }

  /**
   * Get detailed queue information
   */
  getDetailedStatus(): {
    queue: {
      size: number;
      requests: Array<{
        id: string;
        priority: RequestPriority;
        method: string;
        endpoint: string;
        queuedAt: number;
        waitTime: number;
      }>;
    };
    batches: Array<{
      id: string;
      priority: RequestPriority;
      method: string;
      endpoint: string;
      requestCount: number;
      createdAt: number;
      age: number;
    }>;
    statistics: QueueStatistics;
  } {
    const now = Date.now();
    const queuedRequests = this.queue.toArray().map(item => ({
      id: item.request.id,
      priority: item.priority,
      method: item.request.method,
      endpoint: item.request.endpoint,
      queuedAt: item.queuedAt,
      waitTime: now - item.queuedAt
    }));

    const batches = Array.from(this.batches.values()).map(batch => ({
      id: batch.id,
      priority: batch.priority,
      method: batch.method,
      endpoint: batch.endpoint,
      requestCount: batch.requests.length,
      createdAt: batch.createdAt,
      age: now - batch.createdAt
    }));

    return {
      queue: {
        size: this.queue.size(),
        requests: queuedRequests
      },
      batches,
      statistics: this.getStatistics()
    };
  }

  /**
   * Set the request and batch executors
   */
  setExecutors(
    requestExecutor: (request: DiscordAPIRequest) => Promise<any>,
    batchExecutor?: (batch: RequestBatch) => Promise<Array<{ success: boolean; data?: any; error?: Error }>>
  ): void {
    this.executeRequest = requestExecutor;
    if (batchExecutor) {
      this.executeBatchRequest = batchExecutor;
    }
  }
}