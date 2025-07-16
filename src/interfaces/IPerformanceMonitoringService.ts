// src/interfaces/IPerformanceMonitoringService.ts - 성능 모니터링 서비스 인터페이스

/**
 * 성능 메트릭 데이터 인터페이스
 */
export interface PerformanceMetrics {
  timestamp: Date;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: number;
  websocketPing: number;
  rateLimitHits: number;
  eventProcessingTime: number;
  activeConnections: number;
  uptime: number;
}

/**
 * 성능 경고 인터페이스
 */
export interface PerformanceAlert {
  type: 'memory' | 'cpu' | 'latency' | 'rate_limit' | 'error_rate';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  value: number;
  threshold: number;
  timestamp: Date;
  metadata?: Record<string, any>;
}

/**
 * 성능 임계값 설정 인터페이스
 */
export interface PerformanceThresholds {
  memoryUsageMB: number;
  cpuUsagePercent: number;
  websocketPingMs: number;
  rateLimitHitsPerMinute: number;
  errorRatePercent: number;
  eventProcessingTimeMs: number;
}

/**
 * 성능 모니터링 서비스 인터페이스
 * Discord 봇의 성능 지표를 추적하고 모니터링하는 서비스
 */
export interface IPerformanceMonitoringService {
  // 초기화 및 제어
  start(): void;
  stop(): void;
  isRunning(): boolean;

  // 메트릭 수집
  collectMetrics(): PerformanceMetrics;
  getLatestMetrics(): PerformanceMetrics | null;
  getMetricsHistory(limit?: number): PerformanceMetrics[];

  // 임계값 관리
  setThresholds(thresholds: Partial<PerformanceThresholds>): void;
  getThresholds(): PerformanceThresholds;
  checkThresholds(metrics: PerformanceMetrics): PerformanceAlert[];

  // 경고 시스템
  getActiveAlerts(): PerformanceAlert[];
  getAlertHistory(limit?: number): PerformanceAlert[];
  clearAlerts(): void;
  onAlert(callback: (alert: PerformanceAlert) => void): void;

  // Discord 특화 모니터링
  trackRateLimit(endpoint: string, remaining: number, resetTime: Date): void;
  trackWebSocketEvent(eventType: string, processingTime: number): void;
  trackAPICall(endpoint: string, responseTime: number, success: boolean): void;

  // 메모리 모니터링
  getMemoryUsage(): NodeJS.MemoryUsage;
  getMemoryTrend(minutes: number): Array<{ timestamp: Date; usage: number }>;
  checkMemoryLeaks(): { detected: boolean; details?: string };

  // CPU 모니터링
  getCPUUsage(): Promise<number>;
  getCPUTrend(minutes: number): Array<{ timestamp: Date; usage: number }>;

  // 네트워크 모니터링
  getWebSocketLatency(): number;
  getAPILatency(): number;
  getConnectionStatus(): { status: 'connected' | 'disconnected' | 'reconnecting'; uptime: number };

  // 이벤트 처리 모니터링
  trackEventProcessing(eventType: string, startTime: number): void;
  getEventProcessingStats(): Record<string, { count: number; avgTime: number; errors: number }>;

  // 에러 추적
  trackError(error: Error, context?: Record<string, any>): void;
  getErrorRate(minutes?: number): number;
  getRecentErrors(
    limit?: number
  ): Array<{ error: Error; timestamp: Date; context?: Record<string, any> }>;

  // 리포트 생성
  generateHealthReport(): Promise<{
    status: 'healthy' | 'warning' | 'critical';
    summary: string;
    metrics: PerformanceMetrics;
    alerts: PerformanceAlert[];
    recommendations: string[];
  }>;

  // 설정 관리
  setMonitoringInterval(intervalMs: number): void;
  getMonitoringInterval(): number;
  setRetentionPeriod(hours: number): void;

  // 데이터 관리
  exportMetrics(startTime: Date, endTime: Date): Promise<string>;
  clearHistory(olderThanHours?: number): void;

  // 헬스 체크
  healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: Record<string, any> }>;

  // 현재 상태 조회
  getCurrentStatus(): { status: 'healthy' | 'warning' | 'critical'; details: Record<string, any> };

  // 상세 성능 리포트 조회
  getDetailedReport(): any;
}
