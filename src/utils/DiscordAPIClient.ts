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
} from '../interfaces/IDiscordAPIClient';
import { ConnectionPool } from './ConnectionPool';
import { RequestQueue } from './RequestQueue';
import { RetryManager } from './RetryManager';
import { CircuitBreaker } from './CircuitBreaker';
import { PerformanceMetricsCollector } from './PerformanceMetrics';

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
      retryDelay: config.connectionPool?.retryDelay ?? 1000,
      maxRetries: config.connectionPool?.maxRetries ?? 3
    });

    // Initialize request queue
    this.requestQueue = new RequestQueue({
      maxQueueSize: config.requestQueue?.maxQueueSize ?? 1000,
      processingInterval: config.requestQueue?.processingInterval ?? 100,
      batchTimeout: config.requestQueue?.batchTimeout ?? 100,
      batchSize: config.requestQueue?.batchSize ?? 10
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
      enableMetrics: config.metrics?.enableMetrics ?? true,
      metricsInterval: config.metrics?.metricsInterval ?? 1000,
      histogramBuckets: config.metrics?.histogramBuckets,
      maxHistorySize: config.metrics?.maxHistorySize ?? 10000
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
  private async request<T = any>(requestConfig: Partial<DiscordAPIRequest> & { method: string; endpoint: string }): Promise<DiscordAPIResponse<T>> {
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
    const results: Array<{ success: boolean; data?: T; error?: Error }> = [];

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
          priority: requestConfig.priority ?? batch.priority ?? 'normal',
          timeout: requestConfig.timeout ?? 30000,
          retryable: requestConfig.retryable ?? true,
          batchable: true
        };

        const response = await this.executeRequest<T>(request);
        return {
          success: response.success,
          data: response.data,
          error: response.error
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error : new Error(String(error))
        };
      }
    });

    const batchResults = await Promise.allSettled(batchPromises);
    
    batchResults.forEach(result => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({
          success: false,
          error: result.reason instanceof Error ? result.reason : new Error(String(result.reason))
        });
      }
    });

    const successCount = results.filter(r => r.success).length;

    return {
      batchId,
      results,
      totalRequests: batch.requests.length,
      successfulRequests: successCount,
      failedRequests: batch.requests.length - successCount,
      executionTime: Date.now() - Date.now() // This would be calculated properly in real implementation
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
      
      const metrics = this.getMetrics();
      const circuitBreakerState = this.getCircuitBreakerState();
      const connectionStats = this.connectionPool.getStatistics();
      const queueStats = this.requestQueue.getStatistics();

      return {
        isHealthy: testResponse.success && circuitBreakerState.isHealthy,
        responseTime,
        metrics,
        circuitBreakerState: circuitBreakerState.state,
        connectionPoolStats: {
          totalConnections: connectionStats.total,
          activeConnections: connectionStats.active,
          healthyConnections: connectionStats.healthy
        },
        queueStats: {
          queuedRequests: queueStats.currentQueueSize,
          processingRate: queueStats.processingRate
        },
        lastChecked: Date.now()
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      return {
        isHealthy: false,
        responseTime,
        error: error instanceof Error ? error.message : String(error),
        circuitBreakerState: this.getCircuitBreakerState().state,
        lastChecked: Date.now()
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
          batch.requests.map(({ request }) => this.executeHttpRequest(request.request))
        );

        return results.map(result => ({
          success: result.status === 'fulfilled' && result.value.success,
          data: result.status === 'fulfilled' ? result.value.data : undefined,
          error: result.status === 'rejected' 
            ? (result.reason instanceof Error ? result.reason : new Error(String(result.reason)))
            : (result.value.success ? undefined : result.value.error)
        }));
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
  private async performHttpRequest<T>(request: DiscordAPIRequest, connection: any): Promise<DiscordAPIResponse<T>> {
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