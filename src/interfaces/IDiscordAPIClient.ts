// src/interfaces/IDiscordAPIClient.ts - Discord API Client Wrapper Interface

import { AxiosRequestConfig, AxiosResponse } from 'axios';

// Request types and configurations
export interface DiscordAPIRequest {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  endpoint: string;
  data?: any;
  headers?: Record<string, string>;
  priority: 'low' | 'normal' | 'high' | 'critical';
  retryable?: boolean;
  batchable?: boolean;
  timeout?: number;
  rateLimit?: {
    bucket?: string;
    limit?: number;
    resetAfter?: number;
  };
}

// Response types
export interface DiscordAPIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: Error;
  status?: number;
  headers?: Record<string, any>;
  metadata: {
    requestId: string;
    executionTime: number;
    retryCount: number;
    fromCache: boolean;
    rateLimitRemaining?: number;
    rateLimitResetAfter?: number;
    connectionId?: string;
    batchId?: string;
  };
}

// Batch request configuration
export interface BatchRequest {
  id: string;
  requests: DiscordAPIRequest[];
  maxConcurrency?: number;
  failFast?: boolean;
  timeout?: number;
}

export interface BatchResponse<T = any> {
  success: boolean;
  results: Map<string, DiscordAPIResponse<T>>;
  metadata: {
    batchId: string;
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    executionTime: number;
    averageRequestTime: number;
  };
}

// Connection pool configuration
export interface ConnectionPoolConfig {
  maxConnections: number;
  maxConnectionsPerHost: number;
  connectionTimeout: number;
  requestTimeout: number;
  keepAliveTimeout: number;
  enableKeepAlive: boolean;
  enableHttp2: boolean;
  maxIdleTime: number;
  healthCheckInterval: number;
}

// Circuit breaker configuration and state
export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
  successThreshold: number;
  enable: boolean;
}

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  nextAttemptTime?: number;
  isHealthy: boolean;
}

// Retry configuration
export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  exponentialBase: number;
  jitter: boolean;
  retryableStatusCodes: number[];
  retryableErrors: string[];
}

// Performance metrics
export interface PerformanceMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  throughputPerSecond: number;
  activeConnections: number;
  queuedRequests: number;
  circuitBreakerTrips: number;
  cacheHitRate: number;
  retryRate: number;
  errorRate: number;
  lastResetTime: number;
}

// Rate limit information
export interface RateLimitInfo {
  bucket: string;
  limit: number;
  remaining: number;
  resetAfter: number;
  resetAt: Date;
  global: boolean;
}

// Queue configuration and statistics
export interface RequestQueueConfig {
  maxQueueSize: number;
  priorityLevels: number;
  batchSize: number;
  batchTimeout: number;
  processingInterval: number;
  enablePrioritization: boolean;
}

export interface QueueStatistics {
  totalQueued: number;
  currentQueueSize: number;
  averageWaitTime: number;
  processingRate: number;
  droppedRequests: number;
  batchesProcessed: number;
  priorityDistribution: Record<string, number>;
}

// Health check configuration
export interface HealthCheckConfig {
  enabled: boolean;
  interval: number;
  timeout: number;
  endpoint: string;
  method: 'GET' | 'POST';
  expectedStatus: number[];
  retries: number;
}

export interface HealthStatus {
  healthy: boolean;
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: Date;
  responseTime: number;
  errorCount: number;
  consecutiveFailures: number;
  uptime: number;
  details: {
    connectionPool: boolean;
    circuitBreaker: boolean;
    requestQueue: boolean;
    rateLimiting: boolean;
  };
}

// Main Discord API Client interface
export interface IDiscordAPIClient {
  // Core request methods
  get<T = any>(endpoint: string, config?: Partial<DiscordAPIRequest>): Promise<DiscordAPIResponse<T>>;
  post<T = any>(endpoint: string, data?: any, config?: Partial<DiscordAPIRequest>): Promise<DiscordAPIResponse<T>>;
  put<T = any>(endpoint: string, data?: any, config?: Partial<DiscordAPIRequest>): Promise<DiscordAPIResponse<T>>;
  patch<T = any>(endpoint: string, data?: any, config?: Partial<DiscordAPIRequest>): Promise<DiscordAPIResponse<T>>;
  delete<T = any>(endpoint: string, config?: Partial<DiscordAPIRequest>): Promise<DiscordAPIResponse<T>>;

  // Advanced request methods
  request<T = any>(config: DiscordAPIRequest): Promise<DiscordAPIResponse<T>>;
  batchRequest<T = any>(batch: BatchRequest): Promise<BatchResponse<T>>;

  // Queue management
  queueRequest(request: DiscordAPIRequest): Promise<string>; // Returns request ID
  cancelRequest(requestId: string): boolean;
  getQueueStatus(): QueueStatistics;

  // Connection pool management
  getConnectionStats(): {
    total: number;
    active: number;
    idle: number;
    pending: number;
  };
  closeIdleConnections(): number;
  refreshConnectionPool(): Promise<void>;

  // Circuit breaker control
  getCircuitBreakerState(): CircuitBreakerState;
  resetCircuitBreaker(): void;
  enableCircuitBreaker(): void;
  disableCircuitBreaker(): void;

  // Performance monitoring
  getMetrics(): PerformanceMetrics;
  resetMetrics(): void;
  getDetailedMetrics(timeWindow?: number): {
    requests: PerformanceMetrics;
    responseTimeHistogram: number[];
    errorBreakdown: Record<string, number>;
    rateLimitHits: number;
  };

  // Rate limiting
  getRateLimitInfo(bucket?: string): RateLimitInfo[];
  waitForRateLimit(bucket: string): Promise<void>;
  
  // Health and diagnostics
  healthCheck(): Promise<HealthStatus>;
  ping(): Promise<number>; // Returns latency in ms
  getStatus(): {
    ready: boolean;
    version: string;
    uptime: number;
    environment: string;
  };

  // Configuration management
  updateConfig(config: Partial<DiscordAPIClientConfig>): void;
  getConfig(): DiscordAPIClientConfig;

  // Lifecycle management
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  restart(): Promise<void>;

  // Event handling
  on(event: 'request' | 'response' | 'error' | 'circuitBreakerOpen' | 'circuitBreakerClose' | 'rateLimitHit', listener: (...args: any[]) => void): void;
  off(event: string, listener: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;
}

// Complete configuration interface
export interface DiscordAPIClientConfig {
  // Basic configuration
  baseURL: string;
  token: string;
  userAgent: string;
  apiVersion: string;

  // Connection pool settings
  connectionPool: ConnectionPoolConfig;

  // Request queue settings
  requestQueue: RequestQueueConfig;

  // Retry configuration
  retry: RetryConfig;

  // Circuit breaker configuration
  circuitBreaker: CircuitBreakerConfig;

  // Health check configuration
  healthCheck: HealthCheckConfig;

  // Performance settings
  performance: {
    enableMetrics: boolean;
    metricsInterval: number;
    histogramBuckets: number[];
    enableTracing: boolean;
    enableCaching: boolean;
    cacheSize: number;
    cacheTTL: number;
  };

  // Rate limiting settings
  rateLimiting: {
    enableGlobalLimiter: boolean;
    enablePerBucketLimiter: boolean;
    bufferTime: number;
    burstAllowance: number;
  };

  // Logging configuration
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    enableRequestLogging: boolean;
    enableResponseLogging: boolean;
    enableErrorLogging: boolean;
    logFormat: 'json' | 'text';
  };

  // Environment settings
  environment: 'development' | 'staging' | 'production';
  debug: boolean;
}

// Error types
export class DiscordAPIError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public endpoint?: string,
    public requestId?: string
  ) {
    super(message);
    this.name = 'DiscordAPIError';
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(public nextAttemptTime: number) {
    super('Circuit breaker is open');
    this.name = 'CircuitBreakerOpenError';
  }
}

export class RateLimitError extends Error {
  constructor(
    public resetAfter: number,
    public bucket: string,
    public global: boolean = false
  ) {
    super(`Rate limited. Reset after ${resetAfter}ms`);
    this.name = 'RateLimitError';
  }
}

export class QueueFullError extends Error {
  constructor(public queueSize: number, public maxSize: number) {
    super(`Request queue is full (${queueSize}/${maxSize})`);
    this.name = 'QueueFullError';
  }
}

// Event types
export interface ClientEvents {
  request: [DiscordAPIRequest];
  response: [DiscordAPIResponse];
  error: [Error, DiscordAPIRequest?];
  circuitBreakerOpen: [CircuitBreakerState];
  circuitBreakerClose: [CircuitBreakerState];
  rateLimitHit: [RateLimitInfo];
  connectionPoolFull: [number];
  queueFull: [number];
  healthCheckFailed: [HealthStatus];
}

// Utility types
export type RequestPriority = 'low' | 'normal' | 'high' | 'critical';
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type CircuitBreakerStateType = 'closed' | 'open' | 'half-open';