// src/utils/DiscordAPIClient.ts - Main Discord API Client with Integrated Components

import { EventEmitter } from 'events';
import {
  IDiscordAPIClient,
  DiscordAPIRequest,
  DiscordAPIResponse,
  DiscordAPIClientConfig,
  BatchRequest,
  BatchResponse,
  CircuitBreakerState,
  PerformanceMetrics,
  HealthStatus
} from '../interfaces/IDiscordAPIClient.js';
import { ConnectionPool } from './ConnectionPool.js';
import { RequestQueue } from './RequestQueue.js';
import { RetryManager } from './RetryManager.js';
import { CircuitBreaker } from './CircuitBreaker.js';
import { PerformanceMetricsCollector } from './PerformanceMetrics.js';

export class DiscordAPIClient extends EventEmitter implements IDiscordAPIClient {
  private connectionPool: ConnectionPool;
  private requestQueue: RequestQueue;
  private retryManager: RetryManager;
  private circuitBreaker: CircuitBreaker;
  private metricsCollector: PerformanceMetricsCollector;
  private isShuttingDown = false;

  constructor(private config: DiscordAPIClientConfig) {
    super();

    // Initialize connection pool
    this.connectionPool = new ConnectionPool({
      maxConnections: config.connectionPool?.maxConnections ?? 50,
      maxConnectionsPerHost: config.connectionPool?.maxConnectionsPerHost ?? 10,
      connectionTimeout: config.connectionPool?.connectionTimeout ?? 5000,
      requestTimeout: config.connectionPool?.requestTimeout ?? 30000,
      keepAliveTimeout: config.connectionPool?.keepAliveTimeout ?? 5000,
      enableKeepAlive: config.connectionPool?.enableKeepAlive ?? true,
      enableHttp2: config.connectionPool?.enableHttp2 ?? false,
      maxIdleTime: config.connectionPool?.maxIdleTime ?? 60000,
      healthCheckInterval: config.connectionPool?.healthCheckInterval ?? 30000,
      retryDelay: 1000,
      maxRetries: 3
    });

    // Initialize request queue
    this.requestQueue = new RequestQueue({
      maxQueueSize: config.requestQueue?.maxQueueSize ?? 1000,
      priorityLevels: config.requestQueue?.priorityLevels ?? 4,
      batchSize: config.requestQueue?.batchSize ?? 10,
      batchTimeout: config.requestQueue?.batchTimeout ?? 100,
      processingInterval: config.requestQueue?.processingInterval ?? 100,
      enablePrioritization: config.requestQueue?.enablePrioritization ?? true
    });

    // Initialize retry manager
    this.retryManager = new RetryManager({
      maxRetries: config.retry?.maxRetries ?? 3,
      baseDelay: config.retry?.baseDelay ?? 1000,
      maxDelay: config.retry?.maxDelay ?? 30000,
      exponentialBase: config.retry?.exponentialBase ?? 2,
      jitter: config.retry?.jitter ?? true,
      retryableStatusCodes: config.retry?.retryableStatusCodes ?? [429, 500, 502, 503, 504],
      retryableErrors: config.retry?.retryableErrors ?? ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND']
    });

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker({
      enable: config.circuitBreaker?.enable ?? true,
      failureThreshold: config.circuitBreaker?.failureThreshold ?? 5,
      successThreshold: config.circuitBreaker?.successThreshold ?? 3,
      resetTimeout: config.circuitBreaker?.resetTimeout ?? 60000,
      monitoringPeriod: config.circuitBreaker?.monitoringPeriod ?? 60000
    });

    // Initialize performance metrics
    this.metricsCollector = new PerformanceMetricsCollector({
      enableMetrics: config.performance?.enableMetrics ?? true,
      metricsInterval: config.performance?.metricsInterval ?? 1000,
      histogramBuckets: config.performance?.histogramBuckets,
      maxHistorySize: 10000
    });

    this.setupIntegrations();
    this.setupEventHandlers();
  }

  /**
   * HTTP GET request
   */
  async get<T = any>(endpoint: string, config?: Partial<DiscordAPIRequest>): Promise<DiscordAPIResponse<T>> {
    return this.request<T>({
      method: 'GET',
      endpoint,
      ...config
    });
  }

  /**
   * HTTP POST request
   */
  async post<T = any>(endpoint: string, data?: any, config?: Partial<DiscordAPIRequest>): Promise<DiscordAPIResponse<T>> {
    return this.request<T>({
      method: 'POST',
      endpoint,
      data,
      ...config
    });
  }

  /**
   * HTTP PUT request
   */
  async put<T = any>(endpoint: string, data?: any, config?: Partial<DiscordAPIRequest>): Promise<DiscordAPIResponse<T>> {
    return this.request<T>({
      method: 'PUT',
      endpoint,
      data,
      ...config
    });
  }

  /**
   * HTTP PATCH request
   */
  async patch<T = any>(endpoint: string, data?: any, config?: Partial<DiscordAPIRequest>): Promise<DiscordAPIResponse<T>> {
    return this.request<T>({
      method: 'PATCH',
      endpoint,
      data,
      ...config
    });
  }

  /**
   * HTTP DELETE request
   */
  async delete<T = any>(endpoint: string, config?: Partial<DiscordAPIRequest>): Promise<DiscordAPIResponse<T>> {
    return this.request<T>({
      method: 'DELETE',
      endpoint,
      ...config
    });
  }

  /**
   * Core request method
   */
  async request<T = any>(requestConfig: Partial<DiscordAPIRequest> & { method: string; endpoint: string }): Promise<DiscordAPIResponse<T>> {
    if (this.isShuttingDown) {
      throw new Error('Discord API client is shutting down');
    }

    const request: DiscordAPIRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      method: requestConfig.method,
      endpoint: requestConfig.endpoint,
      data: requestConfig.data,
      headers: {
        'Authorization': `Bot ${this.config.token}`,
        'Content-Type': 'application/json',
        ...requestConfig.headers
      },
      priority: requestConfig.priority ?? 'normal',
      timeout: requestConfig.timeout ?? 30000,
      retryable: requestConfig.retryable ?? true,
      batchable: requestConfig.batchable ?? true
    };

    // Record request start for metrics
    this.metricsCollector.recordRequestStart(request);

    // Execute through the integration pipeline
    return this.executeRequest<T>(request);
  }

  /**
   * Execute request through the integrated pipeline
   */
  private async executeRequest<T>(request: DiscordAPIRequest): Promise<DiscordAPIResponse<T>> {
    // Execute through circuit breaker
    return this.circuitBreaker.execute(request, async (req) => {
      // Execute through retry manager
      return this.retryManager.executeWithRetry(req, async (retryReq) => {
        // Queue the request for processing
        return this.requestQueue.enqueueRequest(retryReq);
      });
    });
  }

  /**
   * Execute batch request
   */
  async batchRequest<T = any>(batch: BatchRequest): Promise<BatchResponse<T>> {
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const results = new Map<string, DiscordAPIResponse<T>>();
    const startTime = Date.now();

    // Process each request in the batch
    const batchPromises = batch.requests.map(async (requestConfig, index) => {
      try {
        const request: DiscordAPIRequest = {
          id: `${batchId}-${index}`,
          method: requestConfig.method,
          endpoint: requestConfig.endpoint,
          data: requestConfig.data,
          headers: {
            'Authorization': `Bot ${this.config.token}`,
            'Content-Type': 'application/json',
            ...requestConfig.headers
          },
          priority: requestConfig.priority ?? 'normal',
          timeout: requestConfig.timeout ?? 30000,
          retryable: requestConfig.retryable ?? true,
          batchable: true
        };

        const response = await this.executeRequest<T>(request);
        results.set(request.id, response);
        return response;
      } catch (error) {
        const errorResponse: DiscordAPIResponse<T> = {
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          metadata: {
            requestId: `${batchId}-${index}`,
            executionTime: Date.now() - startTime,
            retryCount: 0,
            fromCache: false
          }
        };
        results.set(`${batchId}-${index}`, errorResponse);
        return errorResponse;
      }
    });

    await Promise.allSettled(batchPromises);
    
    const successCount = Array.from(results.values()).filter(r => r.success).length;
    const executionTime = Date.now() - startTime;
    const averageRequestTime = executionTime / batch.requests.length;

    return {
      success: true,
      results,
      metadata: {
        batchId,
        totalRequests: batch.requests.length,
        successfulRequests: successCount,
        failedRequests: batch.requests.length - successCount,
        executionTime,
        averageRequestTime
      }
    };
  }

  /**
   * Get circuit breaker state
   */
  getCircuitBreakerState(): CircuitBreakerState {
    return this.circuitBreaker.getState();
  }

  /**
   * Get performance metrics
   */
  getMetrics(): PerformanceMetrics {
    return this.metricsCollector.getMetrics();
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<HealthStatus> {
    const startTime = Date.now();
    
    try {
      // Perform a simple API call to test connectivity
      const testResponse = await this.get('/gateway');
      const responseTime = Date.now() - startTime;
      
      const circuitBreakerState = this.getCircuitBreakerState();

      return {
        healthy: testResponse.success && circuitBreakerState.isHealthy,
        status: testResponse.success && circuitBreakerState.isHealthy ? 'healthy' : 'degraded',
        lastCheck: new Date(),
        responseTime,
        errorCount: 0,
        consecutiveFailures: 0,
        uptime: Date.now() - startTime,
        details: {
          connectionPool: true,
          circuitBreaker: circuitBreakerState.isHealthy,
          requestQueue: true,
          rateLimiting: true
        }
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      return {
        healthy: false,
        status: 'unhealthy',
        lastCheck: new Date(),
        responseTime,
        errorCount: 1,
        consecutiveFailures: 1,
        uptime: 0,
        details: {
          connectionPool: false,
          circuitBreaker: false,
          requestQueue: false,
          rateLimiting: false
        }
      };
    }
  }

  /**
   * Setup integrations between components
   */
  private setupIntegrations(): void {
    // Set request queue executors
    this.requestQueue.setExecutors(
      // Single request executor
      async (request: DiscordAPIRequest) => {
        return this.executeHttpRequest(request);
      },
      // Batch request executor
      async (batch) => {
        const results = await Promise.allSettled(
          batch.requests.map((queuedRequest) => {
            // Extract DiscordAPIRequest from QueuedRequest
            const request = queuedRequest.request;
            return this.executeHttpRequest(request);
          })
        );

        return results.map(result => {
          if (result.status === 'fulfilled') {
            const response = result.value;
            const responseObj: { success: boolean; data?: any; error?: Error } = {
              success: response.success
            };
            if (response.data !== undefined) {
              responseObj.data = response.data;
            }
            if (response.error !== undefined) {
              responseObj.error = response.error;
            }
            return responseObj;
          } else {
            const error = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
            return {
              success: false,
              error
            };
          }
        });
      }
    );

    // Set up external metric providers
    this.metricsCollector.setExternalProviders({
      connectionPool: () => this.connectionPool.getStatistics().active,
      requestQueue: () => this.requestQueue.getStatistics().currentQueueSize,
      circuitBreaker: () => this.circuitBreaker.getStatistics().circuitBreakerTrips
    });
  }

  /**
   * Execute actual HTTP request
   */
  private async executeHttpRequest<T>(request: DiscordAPIRequest): Promise<DiscordAPIResponse<T>> {
    const startTime = Date.now();
    
    try {
      // Get connection from pool
      const connection = await this.connectionPool.getConnection(this.config.baseURL || 'https://discord.com/api/v10');
      
      // Perform HTTP request using the connection
      const response = await this.performHttpRequest<T>(request, connection);
      
      // Release connection back to pool
      this.connectionPool.releaseConnection(connection.id);
      
      // Record metrics
      this.metricsCollector.recordRequestEnd(request, response, {
        connectionId: connection.id
      });
      
      return response;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorResponse: DiscordAPIResponse<T> = {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: {
          requestId: request.id,
          executionTime,
          retryCount: 0,
          fromCache: false
        }
      };
      
      // Record metrics for failed request
      this.metricsCollector.recordRequestEnd(request, errorResponse);
      
      return errorResponse;
    }
  }

  /**
   * Perform the actual HTTP request (placeholder - would use actual HTTP library)
   */
  private async performHttpRequest<T>(request: DiscordAPIRequest, _connection: any): Promise<DiscordAPIResponse<T>> {
    // This is a placeholder implementation
    // In a real implementation, this would use the connection's agent to make the HTTP request
    
    return new Promise((resolve) => {
      // Simulate network delay
      setTimeout(() => {
        resolve({
          success: true,
          data: { message: 'Mock response' } as T,
          status: 200,
          headers: {},
          metadata: {
            requestId: request.id,
            executionTime: 100,
            retryCount: 0,
            fromCache: false
          }
        });
      }, Math.random() * 100);
    });
  }

  /**
   * Setup event handlers for component coordination
   */
  private setupEventHandlers(): void {
    // Connection pool events
    this.connectionPool.on('connectionCreated', (connection) => {
      this.emit('connectionCreated', connection);
    });

    this.connectionPool.on('connectionRemoved', (connectionId) => {
      this.emit('connectionRemoved', connectionId);
    });

    // Request queue events
    this.requestQueue.on('requestQueued', (requestId, priority) => {
      this.emit('requestQueued', requestId, priority);
    });

    this.requestQueue.on('queueFull', (queueSize) => {
      this.emit('queueFull', queueSize);
    });

    // Circuit breaker events
    this.circuitBreaker.on('circuitBreakerOpen', (state) => {
      this.emit('circuitBreakerOpen', state);
    });

    this.circuitBreaker.on('circuitBreakerClosed', (state) => {
      this.emit('circuitBreakerClosed', state);
    });

    // Retry manager events
    this.retryManager.on('retryAttempt', (requestId, attempt, decision) => {
      this.emit('retryAttempt', requestId, attempt, decision);
    });

    // Metrics events
    this.metricsCollector.on('metricsUpdated', (metrics) => {
      this.emit('metricsUpdated', metrics);
    });
  }

  /**
   * Get detailed system status
   */
  getDetailedStatus() {
    return {
      connectionPool: this.connectionPool.getDetailedStats(),
      requestQueue: this.requestQueue.getDetailedStatus(),
      circuitBreaker: this.circuitBreaker.getStatistics(),
      retryManager: this.retryManager.getDetailedStatistics(),
      metrics: this.metricsCollector.getDetailedMetrics()
    };
  }

  /**
   * Queue a request for processing
   */
  async queueRequest(request: DiscordAPIRequest): Promise<string> {
    return this.requestQueue.enqueueRequest(request);
  }

  /**
   * Cancel a queued request
   */
  cancelRequest(requestId: string): boolean {
    return this.requestQueue.cancelRequest(requestId);
  }

  /**
   * Get queue status
   */
  getQueueStatus() {
    return this.requestQueue.getStatistics();
  }

  /**
   * Get connection stats
   */
  getConnectionStats() {
    const stats = this.connectionPool.getStatistics();
    return {
      total: stats.total,
      active: stats.active,
      idle: stats.idle,
      pending: stats.pending || 0
    };
  }

  /**
   * Close idle connections
   */
  closeIdleConnections(): number {
    return this.connectionPool.closeIdleConnections();
  }

  /**
   * Refresh connection pool
   */
  async refreshConnectionPool(): Promise<void> {
    await this.connectionPool.refreshAllConnections();
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
  }

  /**
   * Enable circuit breaker
   */
  enableCircuitBreaker(): void {
    this.circuitBreaker.enable();
  }

  /**
   * Disable circuit breaker
   */
  disableCircuitBreaker(): void {
    this.circuitBreaker.disable();
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metricsCollector.resetMetrics();
  }

  /**
   * Get detailed metrics
   */
  getDetailedMetrics(timeWindow?: number): {
    requests: PerformanceMetrics;
    responseTimeHistogram: number[];
    errorBreakdown: Record<string, number>;
    rateLimitHits: number;
  } {
    const detailed = this.metricsCollector.getDetailedMetrics(timeWindow);
    return {
      requests: detailed.requests,
      responseTimeHistogram: detailed.responseTimeHistogram.map(item => item.count),
      errorBreakdown: detailed.errorBreakdown,
      rateLimitHits: detailed.rateLimitHits
    };
  }

  /**
   * Get rate limit info
   */
  getRateLimitInfo(): any[] {
    // This would be implemented with actual rate limit tracking
    return [];
  }

  /**
   * Wait for rate limit
   */
  async waitForRateLimit(_bucket: string): Promise<void> {
    // This would be implemented with actual rate limit tracking
  }

  /**
   * Ping the service
   */
  async ping(): Promise<number> {
    const startTime = Date.now();
    try {
      await this.get('/gateway');
      return Date.now() - startTime;
    } catch {
      return -1;
    }
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      ready: !this.isShuttingDown,
      version: '1.0.0',
      uptime: Date.now(),
      environment: process.env.NODE_ENV || 'development'
    };
  }

  /**
   * Get config
   */
  getConfig(): DiscordAPIClientConfig {
    return { ...this.config };
  }

  /**
   * Initialize the client
   */
  async initialize(): Promise<void> {
    // All components are already initialized in constructor
    // Just enable metrics collection
    this.metricsCollector.enable();
  }

  /**
   * Restart the client
   */
  async restart(): Promise<void> {
    await this.shutdown();
    await this.initialize();
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<DiscordAPIClientConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // Update component configurations
    if (newConfig.retry) {
      this.retryManager.updateConfig(newConfig.retry);
    }
    
    if (newConfig.circuitBreaker) {
      this.circuitBreaker.updateConfig(newConfig.circuitBreaker);
    }

    this.emit('configUpdated', this.config);
  }

  /**
   * Shutdown the client and all components
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    
    this.emit('shuttingDown');
    
    // Shutdown components in reverse order of dependencies
    await Promise.allSettled([
      this.requestQueue.shutdown(),
      this.connectionPool.shutdown(),
      this.circuitBreaker.shutdown(),
      this.metricsCollector.shutdown()
    ]);
    
    this.emit('shutdown');
  }
}