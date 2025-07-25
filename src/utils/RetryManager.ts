// src/utils/RetryManager.ts - Advanced Retry Logic with Jitter and Intelligent Backoff

import { EventEmitter } from 'events';
import { RetryConfig, DiscordAPIRequest, DiscordAPIResponse } from '../interfaces/IDiscordAPIClient';

// Retry attempt information
interface RetryAttempt {
  attemptNumber: number;
  delay: number;
  error: Error;
  timestamp: number;
  requestId: string;
}

// Retry statistics
interface RetryStatistics {
  totalRetries: number;
  successfulRetries: number;
  failedRetries: number;
  averageAttempts: number;
  averageDelay: number;
  maxDelay: number;
  totalDelay: number;
  retrysByStatusCode: Record<number, number>;
  retrysByErrorType: Record<string, number>;
  lastResetTime: number;
}

// Retry decision interface
interface RetryDecision {
  shouldRetry: boolean;
  delay: number;
  reason: string;
  nextAttemptTime: number;
}

export class RetryManager extends EventEmitter {
  private retryAttempts: Map<string, RetryAttempt[]> = new Map();
  private statistics: RetryStatistics;
  private jitterCache: Map<string, number> = new Map();

  constructor(private config: RetryConfig) {
    super();
    this.statistics = this.initializeStatistics();
    
    // Clear jitter cache periodically to prevent memory leaks
    setInterval(() => {
      if (this.jitterCache.size > 1000) {
        this.jitterCache.clear();
      }
    }, 300000); // Clear every 5 minutes
  }

  /**
   * Execute a request with retry logic
   */
  async executeWithRetry<T>(
    request: DiscordAPIRequest,
    executor: (request: DiscordAPIRequest) => Promise<DiscordAPIResponse<T>>
  ): Promise<DiscordAPIResponse<T>> {
    const requestId = request.id;
    let lastError: Error;
    let lastResponse: DiscordAPIResponse<T> | undefined;

    // Initialize retry tracking for this request
    this.retryAttempts.set(requestId, []);

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        // Execute the request
        const startTime = Date.now();
        const response = await executor(request);
        const executionTime = Date.now() - startTime;

        // Check if the response indicates a successful retry
        if (response.success) {
          const attempts = this.retryAttempts.get(requestId) || [];
          if (attempts.length > 0) {
            this.statistics.successfulRetries++;
            this.updateRetryStatistics(attempts, true);
            this.emit('retrySuccess', requestId, attempt, attempts);
          }
          
          // Cleanup retry tracking
          this.retryAttempts.delete(requestId);
          
          return response;
        }

        // Handle unsuccessful response
        lastResponse = response;
        lastError = response.error || new Error(`Request failed with status ${response.status}`);

        // Check if we should retry
        const retryDecision = this.shouldRetry(request, lastError, response, attempt);
        
        if (!retryDecision.shouldRetry || attempt === this.config.maxRetries) {
          break;
        }

        // Record retry attempt
        const retryAttempt: RetryAttempt = {
          attemptNumber: attempt + 1,
          delay: retryDecision.delay,
          error: lastError,
          timestamp: Date.now(),
          requestId
        };

        const attempts = this.retryAttempts.get(requestId) || [];
        attempts.push(retryAttempt);
        this.retryAttempts.set(requestId, attempts);

        this.statistics.totalRetries++;
        this.statistics.totalDelay += retryDecision.delay;
        this.updateErrorStatistics(lastError, response.status);

        this.emit('retryAttempt', requestId, retryAttempt, retryDecision);

        // Wait before retrying
        await this.sleep(retryDecision.delay);

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Check if we should retry this error
        const retryDecision = this.shouldRetry(request, lastError, undefined, attempt);
        
        if (!retryDecision.shouldRetry || attempt === this.config.maxRetries) {
          break;
        }

        // Record retry attempt
        const retryAttempt: RetryAttempt = {
          attemptNumber: attempt + 1,
          delay: retryDecision.delay,
          error: lastError,
          timestamp: Date.now(),
          requestId
        };

        const attempts = this.retryAttempts.get(requestId) || [];
        attempts.push(retryAttempt);
        this.retryAttempts.set(requestId, attempts);

        this.statistics.totalRetries++;
        this.statistics.totalDelay += retryDecision.delay;
        this.updateErrorStatistics(lastError);

        this.emit('retryAttempt', requestId, retryAttempt, retryDecision);

        // Wait before retrying
        await this.sleep(retryDecision.delay);
      }
    }

    // All retries exhausted
    const attempts = this.retryAttempts.get(requestId) || [];
    this.statistics.failedRetries++;
    this.updateRetryStatistics(attempts, false);
    this.retryAttempts.delete(requestId);

    this.emit('retryExhausted', requestId, attempts, lastError);

    // Return the last response if available, otherwise create error response
    if (lastResponse) {
      return lastResponse;
    }

    return {
      success: false,
      error: lastError,
      metadata: {
        requestId,
        executionTime: 0,
        retryCount: attempts.length,
        fromCache: false
      }
    } as DiscordAPIResponse<T>;
  }

  /**
   * Determine if a request should be retried
   */
  private shouldRetry(
    request: DiscordAPIRequest,
    error: Error,
    response?: DiscordAPIResponse,
    attempt: number = 0
  ): RetryDecision {
    // Check if retries are disabled for this request
    if (request.retryable === false) {
      return {
        shouldRetry: false,
        delay: 0,
        reason: 'Request marked as non-retryable',
        nextAttemptTime: Date.now()
      };
    }

    // Check if we've exceeded max retries
    if (attempt >= this.config.maxRetries) {
      return {
        shouldRetry: false,
        delay: 0,
        reason: 'Maximum retry attempts exceeded',
        nextAttemptTime: Date.now()
      };
    }

    // Check if the error is retryable
    const isRetryableError = this.isRetryableError(error);
    
    // Check if the status code is retryable
    const isRetryableStatus = response?.status ? 
      this.config.retryableStatusCodes.includes(response.status) : 
      true; // Assume retryable if no status code

    if (!isRetryableError && !isRetryableStatus) {
      return {
        shouldRetry: false,
        delay: 0,
        reason: `Non-retryable error: ${error.message} (status: ${response?.status || 'unknown'})`,
        nextAttemptTime: Date.now()
      };
    }

    // Calculate delay with exponential backoff and jitter
    const delay = this.calculateRetryDelay(attempt, request);
    const nextAttemptTime = Date.now() + delay;

    return {
      shouldRetry: true,
      delay,
      reason: `Retryable error: ${error.message}`,
      nextAttemptTime
    };
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: Error): boolean {
    const errorMessage = error.message.toLowerCase();
    
    return this.config.retryableErrors.some(retryableError => 
      errorMessage.includes(retryableError.toLowerCase())
    ) || this.isNetworkError(error);
  }

  /**
   * Check if an error is a network error
   */
  private isNetworkError(error: Error): boolean {
    const networkErrorPatterns = [
      'timeout',
      'econnreset',
      'econnrefused',
      'enotfound',
      'ehostunreach',
      'epipe',
      'socket hang up',
      'network error',
      'request timeout',
      'connection timeout'
    ];

    const errorMessage = error.message.toLowerCase();
    return networkErrorPatterns.some(pattern => errorMessage.includes(pattern));
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   */
  private calculateRetryDelay(attempt: number, request: DiscordAPIRequest): number {
    // Base exponential backoff
    const baseDelay = this.config.baseDelay * Math.pow(this.config.exponentialBase, attempt);
    
    // Cap at max delay
    const cappedDelay = Math.min(baseDelay, this.config.maxDelay);
    
    if (!this.config.jitter) {
      return cappedDelay;
    }

    // Apply jitter to prevent thundering herd
    const jitterKey = `${request.endpoint}-${attempt}`;
    let jitter = this.jitterCache.get(jitterKey);
    
    if (jitter === undefined) {
      // Full jitter: random value between 0 and cappedDelay
      jitter = Math.random() * cappedDelay;
      this.jitterCache.set(jitterKey, jitter);
    }

    return Math.round(jitter);
  }

  /**
   * Update retry statistics
   */
  private updateRetryStatistics(attempts: RetryAttempt[], success: boolean): void {
    if (attempts.length === 0) return;

    const totalDelay = attempts.reduce((sum, attempt) => sum + attempt.delay, 0);
    const maxDelay = Math.max(...attempts.map(attempt => attempt.delay));

    if (totalDelay > this.statistics.maxDelay) {
      this.statistics.maxDelay = maxDelay;
    }

    // Update averages
    const totalOperations = this.statistics.successfulRetries + this.statistics.failedRetries;
    if (totalOperations > 0) {
      this.statistics.averageAttempts = this.statistics.totalRetries / totalOperations;
      this.statistics.averageDelay = this.statistics.totalDelay / this.statistics.totalRetries;
    }
  }

  /**
   * Update error statistics
   */
  private updateErrorStatistics(error: Error, statusCode?: number): void {
    // Update error type statistics
    const errorType = error.constructor.name;
    if (!this.statistics.retrysByErrorType[errorType]) {
      this.statistics.retrysByErrorType[errorType] = 0;
    }
    this.statistics.retrysByErrorType[errorType]++;

    // Update status code statistics
    if (statusCode) {
      if (!this.statistics.retrysByStatusCode[statusCode]) {
        this.statistics.retrysByStatusCode[statusCode] = 0;
      }
      this.statistics.retrysByStatusCode[statusCode]++;
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Initialize retry statistics
   */
  private initializeStatistics(): RetryStatistics {
    return {
      totalRetries: 0,
      successfulRetries: 0,
      failedRetries: 0,
      averageAttempts: 0,
      averageDelay: 0,
      maxDelay: 0,
      totalDelay: 0,
      retrysByStatusCode: {},
      retrysByErrorType: {},
      lastResetTime: Date.now()
    };
  }

  /**
   * Get retry statistics
   */
  getStatistics(): RetryStatistics {
    return { ...this.statistics };
  }

  /**
   * Reset retry statistics
   */
  resetStatistics(): void {
    this.statistics = this.initializeStatistics();
    this.emit('statisticsReset');
  }

  /**
   * Get detailed retry information for active requests
   */
  getActiveRetries(): Array<{
    requestId: string;
    attempts: RetryAttempt[];
    totalAttempts: number;
    totalDelay: number;
    lastError?: string;
    nextRetryIn?: number;
  }> {
    const now = Date.now();
    return Array.from(this.retryAttempts.entries()).map(([requestId, attempts]) => {
      const totalDelay = attempts.reduce((sum, attempt) => sum + attempt.delay, 0);
      const lastAttempt = attempts[attempts.length - 1];
      const nextRetryTime = lastAttempt ? lastAttempt.timestamp + lastAttempt.delay : 0;
      const nextRetryIn = nextRetryTime > now ? nextRetryTime - now : 0;

      return {
        requestId,
        attempts: [...attempts],
        totalAttempts: attempts.length,
        totalDelay,
        lastError: lastAttempt?.error.message,
        nextRetryIn: nextRetryIn > 0 ? nextRetryIn : undefined
      };
    });
  }

  /**
   * Cancel retry attempts for a specific request
   */
  cancelRetries(requestId: string): boolean {
    if (this.retryAttempts.has(requestId)) {
      this.retryAttempts.delete(requestId);
      this.emit('retriesCancelled', requestId);
      return true;
    }
    return false;
  }

  /**
   * Update retry configuration
   */
  updateConfig(config: Partial<RetryConfig>): void {
    this.config = { ...this.config, ...config };
    this.jitterCache.clear(); // Clear jitter cache when config changes
    this.emit('configUpdated', this.config);
  }

  /**
   * Get current retry configuration
   */
  getConfig(): RetryConfig {
    return { ...this.config };
  }

  /**
   * Get detailed statistics with breakdown
   */
  getDetailedStatistics(): {
    overview: RetryStatistics;
    statusCodeBreakdown: Array<{ statusCode: number; count: number; percentage: number }>;
    errorTypeBreakdown: Array<{ errorType: string; count: number; percentage: number }>;
    successRate: number;
    retryRate: number;
  } {
    const overview = this.getStatistics();
    const totalOperations = overview.successfulRetries + overview.failedRetries;
    const successRate = totalOperations > 0 ? (overview.successfulRetries / totalOperations) * 100 : 0;
    const retryRate = totalOperations > 0 ? (overview.totalRetries / totalOperations) * 100 : 0;

    // Status code breakdown
    const totalStatusCodeRetries = Object.values(overview.retrysByStatusCode).reduce((sum, count) => sum + count, 0);
    const statusCodeBreakdown = Object.entries(overview.retrysByStatusCode).map(([statusCode, count]) => ({
      statusCode: parseInt(statusCode),
      count,
      percentage: totalStatusCodeRetries > 0 ? Math.round((count / totalStatusCodeRetries) * 100) : 0
    })).sort((a, b) => b.count - a.count);

    // Error type breakdown
    const totalErrorTypeRetries = Object.values(overview.retrysByErrorType).reduce((sum, count) => sum + count, 0);
    const errorTypeBreakdown = Object.entries(overview.retrysByErrorType).map(([errorType, count]) => ({
      errorType,
      count,
      percentage: totalErrorTypeRetries > 0 ? Math.round((count / totalErrorTypeRetries) * 100) : 0
    })).sort((a, b) => b.count - a.count);

    return {
      overview,
      statusCodeBreakdown,
      errorTypeBreakdown,
      successRate: Math.round(successRate * 100) / 100,
      retryRate: Math.round(retryRate * 100) / 100
    };
  }

  /**
   * Test retry logic with a mock request
   */
  async testRetryLogic(
    mockError: Error, 
    statusCode?: number, 
    shouldSucceedAfter: number = 2
  ): Promise<{
    totalAttempts: number;
    totalDelay: number;
    success: boolean;
    finalError?: Error;
  }> {
    const testRequest: DiscordAPIRequest = {
      id: `test-${Date.now()}`,
      method: 'GET',
      endpoint: '/test',
      priority: 'normal',
      retryable: true
    };

    let attempts = 0;
    const totalStartTime = Date.now();

    const mockExecutor = async (): Promise<DiscordAPIResponse> => {
      attempts++;
      
      if (attempts <= shouldSucceedAfter) {
        throw mockError;
      }
      
      return {
        success: true,
        data: { test: 'success' },
        metadata: {
          requestId: testRequest.id,
          executionTime: 100,
          retryCount: attempts - 1,
          fromCache: false
        }
      };
    };

    try {
      const result = await this.executeWithRetry(testRequest, mockExecutor);
      const totalDelay = Date.now() - totalStartTime;
      
      return {
        totalAttempts: attempts,
        totalDelay,
        success: result.success,
        finalError: result.success ? undefined : result.error
      };
    } catch (error) {
      const totalDelay = Date.now() - totalStartTime;
      
      return {
        totalAttempts: attempts,
        totalDelay,
        success: false,
        finalError: error instanceof Error ? error : new Error(String(error))
      };
    }
  }
}