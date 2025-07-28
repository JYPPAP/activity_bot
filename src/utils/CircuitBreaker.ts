// src/utils/CircuitBreaker.ts - Circuit Breaker Pattern Implementation

import { EventEmitter } from 'events';
import { CircuitBreakerConfig, CircuitBreakerState, DiscordAPIRequest, DiscordAPIResponse } from '../interfaces/IDiscordAPIClient.js';

// Circuit breaker failure tracking
interface FailureRecord {
  timestamp: number;
  error: Error;
  endpoint: string;
  statusCode?: number;
}

// Circuit breaker statistics
interface CircuitBreakerStatistics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  circuitBreakerTrips: number;
  timeInClosed: number;
  timeInOpen: number;
  timeInHalfOpen: number;
  lastStateChange: number;
  averageFailureRate: number;
  averageRecoveryTime: number;
  healthScore: number;
}

export class CircuitBreaker extends EventEmitter {
  private state: CircuitBreakerState;
  private failures: FailureRecord[] = [];
  private statistics: CircuitBreakerStatistics;
  private stateChangeTime: number = Date.now();
  private halfOpenSuccessCount = 0;
  private monitoringTimer: NodeJS.Timeout | null = null;

  constructor(private config: CircuitBreakerConfig) {
    super();
    
    this.state = {
      state: 'closed',
      failureCount: 0,
      successCount: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0,
      isHealthy: true
    };

    this.statistics = this.initializeStatistics();
    this.startMonitoring();
  }

  /**
   * Execute a request through the circuit breaker
   */
  async execute<T>(
    request: DiscordAPIRequest,
    executor: (request: DiscordAPIRequest) => Promise<DiscordAPIResponse<T>>
  ): Promise<DiscordAPIResponse<T>> {
    if (!this.config.enable) {
      // Circuit breaker disabled, execute directly
      return await executor(request);
    }

    // Check if circuit breaker allows the request
    const allowRequest = this.canExecuteRequest();
    if (!allowRequest) {
      this.emit('requestRejected', request.id, this.state.state);
      
      return {
        success: false,
        error: new Error(`Circuit breaker is ${this.state.state}. Next attempt allowed at ${new Date(this.state.nextAttemptTime!)}`),
        metadata: {
          requestId: request.id,
          executionTime: 0,
          retryCount: 0,
          fromCache: false
        }
      } as DiscordAPIResponse<T>;
    }

    const startTime = Date.now();
    this.statistics.totalRequests++;

    try {
      // Execute the request
      const response = await executor(request);
      const executionTime = Date.now() - startTime;

      if (response.success) {
        this.onSuccess(request, executionTime);
      } else {
        this.onFailure(request, response.error || new Error('Request failed'), response.status, executionTime);
      }

      return response;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorObj = error instanceof Error ? error : new Error(String(error));
      
      this.onFailure(request, errorObj, undefined, executionTime);
      
      return {
        success: false,
        error: errorObj,
        metadata: {
          requestId: request.id,
          executionTime,
          retryCount: 0,
          fromCache: false
        }
      } as DiscordAPIResponse<T>;
    }
  }

  /**
   * Check if a request can be executed
   */
  private canExecuteRequest(): boolean {
    const now = Date.now();

    switch (this.state.state) {
      case 'closed':
        return true;

      case 'open':
        // Check if enough time has passed to try half-open
        if (this.state.nextAttemptTime && now >= this.state.nextAttemptTime) {
          this.transitionToHalfOpen();
          return true;
        }
        return false;

      case 'half-open':
        return true;

      default:
        return false;
    }
  }

  /**
   * Handle successful request
   */
  private onSuccess(request: DiscordAPIRequest, executionTime: number): void {
    this.statistics.successfulRequests++;
    this.state.successCount++;

    if (this.state.state === 'half-open') {
      this.halfOpenSuccessCount++;
      
      // Check if we have enough successful requests to close the circuit
      if (this.halfOpenSuccessCount >= this.config.successThreshold) {
        this.transitionToClosed();
      }
    }

    // Remove old failures from the monitoring window
    this.cleanupOldFailures();
    
    this.emit('requestSuccess', request.id, executionTime, this.state.state);
  }

  /**
   * Handle failed request
   */
  private onFailure(request: DiscordAPIRequest, error: Error, statusCode?: number, executionTime?: number): void {
    this.statistics.failedRequests++;
    this.state.failureCount++;
    this.state.lastFailureTime = Date.now();

    // Record the failure
    const failureRecord: FailureRecord = {
      timestamp: Date.now(),
      error,
      endpoint: request.endpoint
    };

    // Add statusCode conditionally for exactOptionalPropertyTypes
    if (statusCode !== undefined) {
      failureRecord.statusCode = statusCode;
    }
    this.failures.push(failureRecord);

    // Clean up old failures
    this.cleanupOldFailures();

    this.emit('requestFailure', request.id, error, statusCode, executionTime, this.state.state);

    // Check if we should trip the circuit breaker
    if (this.shouldTripCircuitBreaker()) {
      this.transitionToOpen();
    } else if (this.state.state === 'half-open') {
      // Any failure in half-open state trips back to open
      this.transitionToOpen();
    }
  }

  /**
   * Check if circuit breaker should trip
   */
  private shouldTripCircuitBreaker(): boolean {
    if (this.state.state === 'open') {
      return false; // Already open
    }

    const recentFailures = this.getRecentFailures();
    return recentFailures.length >= this.config.failureThreshold;
  }

  /**
   * Get recent failures within the monitoring period
   */
  private getRecentFailures(): FailureRecord[] {
    const cutoffTime = Date.now() - this.config.monitoringPeriod;
    return this.failures.filter(failure => failure.timestamp > cutoffTime);
  }

  /**
   * Clean up old failure records
   */
  private cleanupOldFailures(): void {
    const cutoffTime = Date.now() - this.config.monitoringPeriod;
    this.failures = this.failures.filter(failure => failure.timestamp > cutoffTime);
  }

  /**
   * Transition to closed state
   */
  private transitionToClosed(): void {
    const previousState = this.state.state;
    const now = Date.now();
    
    // Update statistics
    if (previousState !== 'closed') {
      this.updateStateTimeStatistics(previousState, now);
    }

    this.state = {
      state: 'closed',
      failureCount: 0,
      successCount: 0,
      lastFailureTime: 0,
      nextAttemptTime: 0,
      isHealthy: true
    };

    this.stateChangeTime = now;
    this.halfOpenSuccessCount = 0;

    this.emit('stateChanged', 'closed', previousState, this.state);
    this.emit('circuitBreakerClosed', this.state);
  }

  /**
   * Transition to open state
   */
  private transitionToOpen(): void {
    const previousState = this.state.state;
    const now = Date.now();
    
    // Update statistics
    if (previousState !== 'open') {
      this.updateStateTimeStatistics(previousState, now);
      this.statistics.circuitBreakerTrips++;
    }

    this.state = {
      state: 'open',
      failureCount: this.getRecentFailures().length,
      successCount: 0,
      lastFailureTime: now,
      nextAttemptTime: now + this.config.resetTimeout,
      isHealthy: false
    };

    this.stateChangeTime = now;
    this.halfOpenSuccessCount = 0;

    this.emit('stateChanged', 'open', previousState, this.state);
    this.emit('circuitBreakerOpen', this.state);
  }

  /**
   * Transition to half-open state
   */
  private transitionToHalfOpen(): void {
    const previousState = this.state.state;
    const now = Date.now();
    
    // Update statistics
    if (previousState !== 'half-open') {
      this.updateStateTimeStatistics(previousState, now);
    }

    this.state = {
      state: 'half-open',
      failureCount: this.state.failureCount,
      successCount: 0,
      lastFailureTime: this.state.lastFailureTime || 0,
      nextAttemptTime: 0,
      isHealthy: false
    };

    this.stateChangeTime = now;
    this.halfOpenSuccessCount = 0;

    this.emit('stateChanged', 'half-open', previousState, this.state);
    this.emit('circuitBreakerHalfOpen', this.state);
  }

  /**
   * Update state time statistics
   */
  private updateStateTimeStatistics(state: 'closed' | 'open' | 'half-open', now: number): void {
    const timeInState = now - this.stateChangeTime;
    
    switch (state) {
      case 'closed':
        this.statistics.timeInClosed += timeInState;
        break;
      case 'open':
        this.statistics.timeInOpen += timeInState;
        break;
      case 'half-open':
        this.statistics.timeInHalfOpen += timeInState;
        break;
    }
  }

  /**
   * Get current circuit breaker state
   */
  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  /**
   * Get circuit breaker statistics
   */
  getStatistics(): CircuitBreakerStatistics {
    this.updateCurrentStateTime();
    this.calculateHealthScore();
    return { ...this.statistics };
  }

  /**
   * Update current state time
   */
  private updateCurrentStateTime(): void {
    const now = Date.now();
    const timeInCurrentState = now - this.stateChangeTime;
    
    switch (this.state.state) {
      case 'closed':
        this.statistics.timeInClosed += timeInCurrentState;
        break;
      case 'open':
        this.statistics.timeInOpen += timeInCurrentState;
        break;
      case 'half-open':
        this.statistics.timeInHalfOpen += timeInCurrentState;
        break;
    }
    
    this.stateChangeTime = now;
  }

  /**
   * Calculate health score
   */
  private calculateHealthScore(): void {
    if (this.statistics.totalRequests === 0) {
      this.statistics.healthScore = 100;
      return;
    }

    const successRate = this.statistics.successfulRequests / this.statistics.totalRequests;
    const totalTime = this.statistics.timeInClosed + this.statistics.timeInOpen + this.statistics.timeInHalfOpen;
    const uptime = totalTime > 0 ? this.statistics.timeInClosed / totalTime : 1;
    
    // Health score is weighted average of success rate and uptime
    this.statistics.healthScore = Math.round((successRate * 0.7 + uptime * 0.3) * 100);
  }

  /**
   * Reset circuit breaker to closed state
   */
  reset(): void {
    this.transitionToClosed();
    this.failures = [];
    this.emit('circuitBreakerReset');
  }

  /**
   * Force circuit breaker to open state
   */
  forceOpen(): void {
    this.transitionToOpen();
    this.emit('circuitBreakerForcedOpen');
  }

  /**
   * Enable circuit breaker
   */
  enable(): void {
    this.config.enable = true;
    this.emit('circuitBreakerEnabled');
  }

  /**
   * Disable circuit breaker
   */
  disable(): void {
    this.config.enable = false;
    this.emit('circuitBreakerDisabled');
  }

  /**
   * Update circuit breaker configuration
   */
  updateConfig(config: Partial<CircuitBreakerConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('configUpdated', this.config);
  }

  /**
   * Initialize statistics
   */
  private initializeStatistics(): CircuitBreakerStatistics {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      circuitBreakerTrips: 0,
      timeInClosed: 0,
      timeInOpen: 0,
      timeInHalfOpen: 0,
      lastStateChange: Date.now(),
      averageFailureRate: 0,
      averageRecoveryTime: 0,
      healthScore: 100
    };
  }

  /**
   * Start monitoring timer
   */
  private startMonitoring(): void {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
    }

    this.monitoringTimer = setInterval(() => {
      this.cleanupOldFailures();
      this.updateStatistics();
      this.checkAutoRecovery();
    }, Math.min(this.config.monitoringPeriod / 4, 30000)); // Monitor every quarter period, max 30s
  }

  /**
   * Update statistics periodically
   */
  private updateStatistics(): void {
    const recentFailures = this.getRecentFailures();
    const monitoringPeriodInSeconds = this.config.monitoringPeriod / 1000;
    
    this.statistics.averageFailureRate = recentFailures.length / monitoringPeriodInSeconds;
    
    // Calculate average recovery time (time between open and closed states)
    if (this.statistics.circuitBreakerTrips > 0) {
      this.statistics.averageRecoveryTime = this.statistics.timeInOpen / this.statistics.circuitBreakerTrips;
    }
  }

  /**
   * Check for automatic recovery conditions
   */
  private checkAutoRecovery(): void {
    if (this.state.state === 'open' && this.state.nextAttemptTime) {
      const now = Date.now();
      if (now >= this.state.nextAttemptTime) {
        this.emit('autoRecoveryReady', this.state);
      }
    }
  }

  /**
   * Get detailed failure analysis
   */
  getFailureAnalysis(): {
    recentFailures: number;
    failuresByEndpoint: Record<string, number>;
    failuresByStatusCode: Record<number, number>;
    failuresByErrorType: Record<string, number>;
    failureRate: number;
    timeToNextAttempt?: number;
  } {
    const recentFailures = this.getRecentFailures();
    const now = Date.now();

    // Group failures by endpoint
    const failuresByEndpoint: Record<string, number> = {};
    recentFailures.forEach(failure => {
      failuresByEndpoint[failure.endpoint] = (failuresByEndpoint[failure.endpoint] || 0) + 1;
    });

    // Group failures by status code
    const failuresByStatusCode: Record<number, number> = {};
    recentFailures.forEach(failure => {
      if (failure.statusCode) {
        failuresByStatusCode[failure.statusCode] = (failuresByStatusCode[failure.statusCode] || 0) + 1;
      }
    });

    // Group failures by error type
    const failuresByErrorType: Record<string, number> = {};
    recentFailures.forEach(failure => {
      const errorType = failure.error.constructor.name;
      failuresByErrorType[errorType] = (failuresByErrorType[errorType] || 0) + 1;
    });

    const failureRate = this.statistics.totalRequests > 0 
      ? (this.statistics.failedRequests / this.statistics.totalRequests) * 100 
      : 0;

    const timeToNextAttempt = this.state.nextAttemptTime && this.state.nextAttemptTime > now
      ? this.state.nextAttemptTime - now
      : undefined;

    const result: {
      recentFailures: number;
      failuresByEndpoint: Record<string, number>;
      failuresByStatusCode: Record<number, number>;
      failuresByErrorType: Record<string, number>;
      failureRate: number;
      timeToNextAttempt?: number;
    } = {
      recentFailures: recentFailures.length,
      failuresByEndpoint,
      failuresByStatusCode,
      failuresByErrorType,
      failureRate: Math.round(failureRate * 100) / 100
    };

    // Add timeToNextAttempt conditionally for exactOptionalPropertyTypes
    if (timeToNextAttempt !== undefined) {
      result.timeToNextAttempt = timeToNextAttempt;
    }

    return result;
  }

  /**
   * Test circuit breaker behavior
   */
  async testCircuitBreaker(
    scenario: 'failure-threshold' | 'recovery' | 'half-open-failure' | 'half-open-success'
  ): Promise<{
    initialState: string;
    finalState: string;
    stateTransitions: string[];
    executionResults: boolean[];
  }> {
    const initialState = this.state.state;
    const stateTransitions: string[] = [initialState];
    const executionResults: boolean[] = [];

    const mockRequest: DiscordAPIRequest = {
      id: `test-${Date.now()}`,
      method: 'GET',
      endpoint: '/test',
      priority: 'normal'
    };

    // Track state changes
    const stateChangeListener = (newState: string) => {
      stateTransitions.push(newState);
    };
    this.on('stateChanged', stateChangeListener);

    try {
      switch (scenario) {
        case 'failure-threshold':
          // Generate enough failures to trip the circuit breaker
          for (let i = 0; i < this.config.failureThreshold + 1; i++) {
            const mockExecutor = async (): Promise<DiscordAPIResponse> => {
              throw new Error(`Test failure ${i + 1}`);
            };
            
            try {
              const result = await this.execute(mockRequest, mockExecutor);
              executionResults.push(result.success);
            } catch (error) {
              executionResults.push(false);
            }
          }
          break;

        case 'recovery':
          // Trip the circuit breaker, then wait for recovery
          this.forceOpen();
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Wait for reset timeout (simulated)
          this.state.nextAttemptTime = Date.now() - 1;
          
          const successExecutor = async (): Promise<DiscordAPIResponse> => ({
            success: true,
            data: { test: 'success' },
            metadata: {
              requestId: mockRequest.id,
              executionTime: 100,
              retryCount: 0,
              fromCache: false
            }
          });
          
          // Execute enough successful requests to close the circuit
          for (let i = 0; i < this.config.successThreshold; i++) {
            const result = await this.execute(mockRequest, successExecutor);
            executionResults.push(result.success);
          }
          break;

        case 'half-open-failure':
          // Force to half-open, then fail a request
          this.forceOpen();
          this.state.nextAttemptTime = Date.now() - 1;
          
          const failureExecutor = async (): Promise<DiscordAPIResponse> => {
            throw new Error('Half-open test failure');
          };
          
          const result = await this.execute(mockRequest, failureExecutor);
          executionResults.push(result.success);
          break;

        case 'half-open-success':
          // Force to half-open, then succeed enough requests to close
          this.forceOpen();
          this.state.nextAttemptTime = Date.now() - 1;
          
          const successExecutor2 = async (): Promise<DiscordAPIResponse> => ({
            success: true,
            data: { test: 'success' },
            metadata: {
              requestId: mockRequest.id,
              executionTime: 100,
              retryCount: 0,
              fromCache: false
            }
          });
          
          for (let i = 0; i < this.config.successThreshold; i++) {
            const result = await this.execute(mockRequest, successExecutor2);
            executionResults.push(result.success);
          }
          break;
      }
    } finally {
      this.off('stateChanged', stateChangeListener);
    }

    return {
      initialState,
      finalState: this.state.state,
      stateTransitions,
      executionResults
    };
  }

  /**
   * Shutdown circuit breaker
   */
  shutdown(): void {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    
    this.emit('shutdown');
  }
}