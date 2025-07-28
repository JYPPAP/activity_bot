// src/utils/PerformanceMetrics.ts - Comprehensive Performance Metrics Collection

import { EventEmitter } from 'events';
import { PerformanceMetrics, DiscordAPIRequest, DiscordAPIResponse } from '../interfaces/IDiscordAPIClient.js';

// Individual request metrics
interface RequestMetric {
  requestId: string;
  endpoint: string;
  method: string;
  priority: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  statusCode?: number;
  errorType?: string;
  retryCount: number;
  fromCache: boolean;
  connectionId?: string;
  batchId?: string;
}

// Time-windowed statistics
interface TimeWindowStats {
  timestamp: number;
  requests: number;
  successes: number;
  failures: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  throughput: number;
}

// Histogram for response time distribution
class Histogram {
  private buckets: Map<number, number> = new Map();
  private bucketBoundaries: number[];

  constructor(boundaries: number[] = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]) {
    this.bucketBoundaries = boundaries.sort((a, b) => a - b);
    this.bucketBoundaries.forEach(boundary => this.buckets.set(boundary, 0));
    this.buckets.set(Infinity, 0); // Catch-all bucket
  }

  record(value: number): void {
    for (const boundary of this.bucketBoundaries) {
      if (value <= boundary) {
        this.buckets.set(boundary, (this.buckets.get(boundary) || 0) + 1);
        return;
      }
    }
    // Value exceeds all boundaries
    this.buckets.set(Infinity, (this.buckets.get(Infinity) || 0) + 1);
  }

  getDistribution(): Array<{ boundary: number; count: number; percentage: number }> {
    const total = Array.from(this.buckets.values()).reduce((sum, count) => sum + count, 0);
    if (total === 0) return [];

    return Array.from(this.buckets.entries()).map(([boundary, count]) => ({
      boundary: boundary === Infinity ? Infinity : boundary,
      count,
      percentage: Math.round((count / total) * 10000) / 100 // Two decimal places
    }));
  }

  getPercentile(percentile: number): number {
    const total = Array.from(this.buckets.values()).reduce((sum, count) => sum + count, 0);
    if (total === 0) return 0;

    const targetCount = Math.ceil((percentile / 100) * total);
    let cumulativeCount = 0;

    for (const [boundary, count] of this.buckets.entries()) {
      cumulativeCount += count;
      if (cumulativeCount >= targetCount) {
        return boundary === Infinity ? Number.MAX_SAFE_INTEGER : boundary;
      }
    }

    return 0;
  }

  reset(): void {
    this.buckets.forEach((_, key) => this.buckets.set(key, 0));
  }
}

export class PerformanceMetricsCollector extends EventEmitter {
  private requests: RequestMetric[] = [];
  private timeWindows: TimeWindowStats[] = [];
  private responseTimeHistogram: Histogram;
  private currentMetrics: PerformanceMetrics;
  private startTime: number = Date.now();
  private metricsInterval: NodeJS.Timeout | null = null;
  private isEnabled = true;

  // Configuration
  private readonly maxRequestsHistory = 10000;
  private readonly maxTimeWindows = 288; // 24 hours in 5-minute windows
  private readonly timeWindowDuration = 5 * 60 * 1000; // 5 minutes
  private readonly metricsUpdateInterval = 1000; // 1 second

  constructor(
    config: {
      enableMetrics: boolean;
      metricsInterval: number;
      histogramBuckets?: number[];
      maxHistorySize?: number;
    }
  ) {
    super();
    
    this.isEnabled = config.enableMetrics;
    this.responseTimeHistogram = new Histogram(config.histogramBuckets);
    this.currentMetrics = this.initializeMetrics();
    
    if (this.isEnabled) {
      this.startMetricsCollection();
    }
  }

  /**
   * Record a request start
   */
  recordRequestStart(request: DiscordAPIRequest): void {
    if (!this.isEnabled) return;

    const metric: Partial<RequestMetric> = {
      requestId: request.id,
      endpoint: request.endpoint,
      method: request.method,
      priority: request.priority,
      startTime: Date.now(),
      retryCount: 0,
      fromCache: false
    };

    // Store partial metric for completion later
    this.emit('requestStarted', metric);
  }

  /**
   * Record a request completion
   */
  recordRequestEnd(
    request: DiscordAPIRequest, 
    response: DiscordAPIResponse, 
    additionalInfo?: {
      connectionId?: string;
      batchId?: string;
      retryCount?: number;
    }
  ): void {
    if (!this.isEnabled) return;

    const endTime = Date.now();
    const duration = response.metadata.executionTime || 0;

    const metric: RequestMetric = {
      requestId: request.id,
      endpoint: request.endpoint,
      method: request.method,
      priority: request.priority,
      startTime: endTime - duration,
      endTime,
      duration,
      success: response.success,
      statusCode: response.status ?? 0,
      ...(response.error && { errorType: response.error.constructor.name }),
      retryCount: additionalInfo?.retryCount ?? response.metadata.retryCount ?? 0,
      fromCache: response.metadata.fromCache ?? false,
      ...(additionalInfo?.connectionId && { connectionId: additionalInfo.connectionId }),
      ...(additionalInfo?.batchId && { batchId: additionalInfo.batchId })
    };

    this.addRequestMetric(metric);
    this.emit('requestCompleted', metric);
  }

  /**
   * Add a request metric to the collection
   */
  private addRequestMetric(metric: RequestMetric): void {
    // Add to request history
    this.requests.push(metric);
    
    // Trim history if too large
    if (this.requests.length > this.maxRequestsHistory) {
      this.requests = this.requests.slice(-this.maxRequestsHistory);
    }

    // Update histogram
    this.responseTimeHistogram.record(metric.duration);

    // Update current metrics
    this.updateCurrentMetrics();
  }

  /**
   * Update current metrics
   */
  private updateCurrentMetrics(): void {
    const recentRequests = this.getRecentRequests(60000); // Last minute
    
    if (this.requests.length === 0) {
      this.currentMetrics = this.initializeMetrics();
      return;
    }

    const totalRequests = this.requests.length;
    const successfulRequests = this.requests.filter(r => r.success).length;
    const failedRequests = totalRequests - successfulRequests;

    // Calculate response times
    const responseTimes = this.requests.map(r => r.duration);
    const averageResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
    const p95ResponseTime = this.responseTimeHistogram.getPercentile(95);
    const p99ResponseTime = this.responseTimeHistogram.getPercentile(99);

    // Calculate throughput (requests per second over last minute)
    const throughputPerSecond = recentRequests.length / 60;

    // Calculate rates
    const errorRate = totalRequests > 0 ? (failedRequests / totalRequests) * 100 : 0;
    const cacheHitRate = totalRequests > 0 
      ? (this.requests.filter(r => r.fromCache).length / totalRequests) * 100 
      : 0;
    const retryRate = totalRequests > 0
      ? (this.requests.filter(r => r.retryCount > 0).length / totalRequests) * 100
      : 0;

    // Count active connections and queued requests (these would come from external sources)
    const activeConnections = this.getActiveConnectionsCount();
    const queuedRequests = this.getQueuedRequestsCount();
    const circuitBreakerTrips = this.getCircuitBreakerTripsCount();

    this.currentMetrics = {
      totalRequests,
      successfulRequests,
      failedRequests,
      averageResponseTime: Math.round(averageResponseTime),
      p95ResponseTime: Math.round(p95ResponseTime),
      p99ResponseTime: Math.round(p99ResponseTime),
      throughputPerSecond: Math.round(throughputPerSecond * 100) / 100,
      activeConnections,
      queuedRequests,
      circuitBreakerTrips,
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      retryRate: Math.round(retryRate * 100) / 100,
      errorRate: Math.round(errorRate * 100) / 100,
      lastResetTime: this.startTime
    };
  }

  /**
   * Get current metrics
   */
  getMetrics(): PerformanceMetrics {
    this.updateCurrentMetrics();
    return { ...this.currentMetrics };
  }

  /**
   * Get detailed metrics with additional breakdowns
   */
  getDetailedMetrics(timeWindow?: number): {
    requests: PerformanceMetrics;
    responseTimeHistogram: Array<{ boundary: number; count: number; percentage: number }>;
    errorBreakdown: Record<string, number>;
    rateLimitHits: number;
    endpointStats: Array<{
      endpoint: string;
      method: string;
      requests: number;
      avgResponseTime: number;
      errorRate: number;
      p95ResponseTime: number;
    }>;
    timeSeriesData: TimeWindowStats[];
  } {
    const windowMs = timeWindow || 3600000; // Default 1 hour
    const cutoffTime = Date.now() - windowMs;
    const windowedRequests = this.requests.filter(r => r.startTime > cutoffTime);

    // Error breakdown
    const errorBreakdown: Record<string, number> = {};
    windowedRequests.filter(r => !r.success).forEach(r => {
      const errorType = r.errorType || 'Unknown';
      errorBreakdown[errorType] = (errorBreakdown[errorType] || 0) + 1;
    });

    // Rate limit hits (assuming 429 status code)
    const rateLimitHits = windowedRequests.filter(r => r.statusCode === 429).length;

    // Endpoint statistics
    const endpointMap = new Map<string, RequestMetric[]>();
    windowedRequests.forEach(request => {
      const key = `${request.method} ${request.endpoint}`;
      if (!endpointMap.has(key)) {
        endpointMap.set(key, []);
      }
      endpointMap.get(key)!.push(request);
    });

    const endpointStats = Array.from(endpointMap.entries()).map(([key, requests]) => {
      const [method, endpoint] = key.split(' ', 2);
      const totalRequests = requests.length;
      const errors = requests.filter(r => !r.success).length;
      const responseTimes = requests.map(r => r.duration);
      const avgResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
      
      // Calculate P95 for this endpoint
      const sortedTimes = responseTimes.sort((a, b) => a - b);
      const p95Index = Math.ceil(sortedTimes.length * 0.95) - 1;
      const p95ResponseTime = sortedTimes[p95Index] || 0;

      return {
        endpoint,
        method,
        requests: totalRequests,
        avgResponseTime: Math.round(avgResponseTime),
        errorRate: totalRequests > 0 ? Math.round((errors / totalRequests) * 10000) / 100 : 0,
        p95ResponseTime: Math.round(p95ResponseTime)
      };
    }).sort((a, b) => b.requests - a.requests);

    return {
      requests: this.getMetrics(),
      responseTimeHistogram: this.responseTimeHistogram.getDistribution(),
      errorBreakdown,
      rateLimitHits,
      endpointStats,
      timeSeriesData: this.getTimeSeriesData(timeWindow)
    };
  }

  /**
   * Get time series data for the specified window
   */
  private getTimeSeriesData(timeWindow?: number): TimeWindowStats[] {
    const windowMs = timeWindow || 3600000; // Default 1 hour
    const cutoffTime = Date.now() - windowMs;
    return this.timeWindows.filter(window => window.timestamp > cutoffTime);
  }

  /**
   * Get recent requests within specified time window
   */
  private getRecentRequests(timeWindowMs: number): RequestMetric[] {
    const cutoffTime = Date.now() - timeWindowMs;
    return this.requests.filter(request => request.startTime > cutoffTime);
  }

  /**
   * Reset all metrics
   */
  resetMetrics(): void {
    this.requests = [];
    this.timeWindows = [];
    this.responseTimeHistogram.reset();
    this.currentMetrics = this.initializeMetrics();
    this.startTime = Date.now();
    this.emit('metricsReset');
  }

  /**
   * Initialize empty metrics
   */
  private initializeMetrics(): PerformanceMetrics {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0,
      throughputPerSecond: 0,
      activeConnections: 0,
      queuedRequests: 0,
      circuitBreakerTrips: 0,
      cacheHitRate: 0,
      retryRate: 0,
      errorRate: 0,
      lastResetTime: Date.now()
    };
  }

  /**
   * Start metrics collection and time window aggregation
   */
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.updateTimeWindow();
      this.cleanupOldData();
      this.emit('metricsUpdated', this.getMetrics());
    }, this.metricsUpdateInterval);
  }

  /**
   * Update time window statistics
   */
  private updateTimeWindow(): void {
    const now = Date.now();
    const windowStart = Math.floor(now / this.timeWindowDuration) * this.timeWindowDuration;
    
    // Check if we need to create a new time window
    const lastWindow = this.timeWindows[this.timeWindows.length - 1];
    if (!lastWindow || lastWindow.timestamp < windowStart) {
      const windowRequests = this.getRecentRequests(this.timeWindowDuration);
      
      if (windowRequests.length > 0) {
        const successes = windowRequests.filter(r => r.success).length;
        const failures = windowRequests.length - successes;
        const responseTimes = windowRequests.map(r => r.duration);
        const avgResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
        const minResponseTime = Math.min(...responseTimes);
        const maxResponseTime = Math.max(...responseTimes);
        const throughput = windowRequests.length / (this.timeWindowDuration / 1000);

        const windowStat: TimeWindowStats = {
          timestamp: windowStart,
          requests: windowRequests.length,
          successes,
          failures,
          avgResponseTime: Math.round(avgResponseTime),
          minResponseTime: Math.round(minResponseTime),
          maxResponseTime: Math.round(maxResponseTime),
          throughput: Math.round(throughput * 100) / 100
        };

        this.timeWindows.push(windowStat);
      }
    }

    // Trim old time windows
    if (this.timeWindows.length > this.maxTimeWindows) {
      this.timeWindows = this.timeWindows.slice(-this.maxTimeWindows);
    }
  }

  /**
   * Clean up old data to prevent memory leaks
   */
  private cleanupOldData(): void {
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // Keep 24 hours of data
    this.requests = this.requests.filter(request => request.startTime > cutoffTime);
  }

  /**
   * Enable metrics collection
   */
  enable(): void {
    if (!this.isEnabled) {
      this.isEnabled = true;
      this.startMetricsCollection();
      this.emit('metricsEnabled');
    }
  }

  /**
   * Disable metrics collection
   */
  disable(): void {
    if (this.isEnabled) {
      this.isEnabled = false;
      if (this.metricsInterval) {
        clearInterval(this.metricsInterval);
        this.metricsInterval = null;
      }
      this.emit('metricsDisabled');
    }
  }

  /**
   * Export metrics data
   */
  exportMetrics(): {
    summary: PerformanceMetrics;
    requests: RequestMetric[];
    timeWindows: TimeWindowStats[];
    histogram: Array<{ boundary: number; count: number; percentage: number }>;
    exportTime: number;
  } {
    return {
      summary: this.getMetrics(),
      requests: [...this.requests],
      timeWindows: [...this.timeWindows],
      histogram: this.responseTimeHistogram.getDistribution(),
      exportTime: Date.now()
    };
  }

  /**
   * Import metrics data
   */
  importMetrics(data: {
    requests: RequestMetric[];
    timeWindows: TimeWindowStats[];
    startTime?: number;
  }): void {
    this.requests = [...data.requests];
    this.timeWindows = [...data.timeWindows];
    if (data.startTime) {
      this.startTime = data.startTime;
    }

    // Rebuild histogram
    this.responseTimeHistogram.reset();
    this.requests.forEach(request => {
      this.responseTimeHistogram.record(request.duration);
    });

    this.updateCurrentMetrics();
    this.emit('metricsImported');
  }

  /**
   * Get performance alerts based on thresholds
   */
  getPerformanceAlerts(thresholds: {
    errorRateThreshold?: number;
    responseTimeThreshold?: number;
    throughputThreshold?: number;
  }): Array<{
    type: 'error_rate' | 'response_time' | 'throughput';
    severity: 'warning' | 'critical';
    message: string;
    currentValue: number;
    threshold: number;
  }> {
    const alerts: any[] = [];
    const metrics = this.getMetrics();

    // Error rate alert
    if (thresholds.errorRateThreshold && metrics.errorRate > thresholds.errorRateThreshold) {
      alerts.push({
        type: 'error_rate',
        severity: metrics.errorRate > thresholds.errorRateThreshold * 2 ? 'critical' : 'warning',
        message: `Error rate (${metrics.errorRate}%) exceeds threshold (${thresholds.errorRateThreshold}%)`,
        currentValue: metrics.errorRate,
        threshold: thresholds.errorRateThreshold
      });
    }

    // Response time alert
    if (thresholds.responseTimeThreshold && metrics.p95ResponseTime > thresholds.responseTimeThreshold) {
      alerts.push({
        type: 'response_time',
        severity: metrics.p95ResponseTime > thresholds.responseTimeThreshold * 2 ? 'critical' : 'warning',
        message: `P95 response time (${metrics.p95ResponseTime}ms) exceeds threshold (${thresholds.responseTimeThreshold}ms)`,
        currentValue: metrics.p95ResponseTime,
        threshold: thresholds.responseTimeThreshold
      });
    }

    // Throughput alert
    if (thresholds.throughputThreshold && metrics.throughputPerSecond < thresholds.throughputThreshold) {
      alerts.push({
        type: 'throughput',
        severity: metrics.throughputPerSecond < thresholds.throughputThreshold * 0.5 ? 'critical' : 'warning',
        message: `Throughput (${metrics.throughputPerSecond} req/s) below threshold (${thresholds.throughputThreshold} req/s)`,
        currentValue: metrics.throughputPerSecond,
        threshold: thresholds.throughputThreshold
      });
    }

    return alerts;
  }

  /**
   * Shutdown metrics collection
   */
  shutdown(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
    this.emit('shutdown');
  }

  // These methods would be implemented to integrate with external systems
  private getActiveConnectionsCount(): number {
    // This would be provided by the connection pool
    return 0;
  }

  private getQueuedRequestsCount(): number {
    // This would be provided by the request queue
    return 0;
  }

  private getCircuitBreakerTripsCount(): number {
    // This would be provided by the circuit breaker
    return 0;
  }

  /**
   * Set external metric providers
   */
  setExternalProviders(providers: {
    connectionPool?: () => number;
    requestQueue?: () => number;
    circuitBreaker?: () => number;
  }): void {
    if (providers.connectionPool) {
      this.getActiveConnectionsCount = providers.connectionPool;
    }
    if (providers.requestQueue) {
      this.getQueuedRequestsCount = providers.requestQueue;
    }
    if (providers.circuitBreaker) {
      this.getCircuitBreakerTripsCount = providers.circuitBreaker;
    }
  }
}