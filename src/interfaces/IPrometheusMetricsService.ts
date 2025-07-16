// src/interfaces/IPrometheusMetricsService.ts - Prometheus 메트릭 서비스 인터페이스

import type { Registry, Counter, Gauge, Histogram } from 'prom-client';

/**
 * Discord 봇 메트릭 인터페이스
 */
export interface DiscordBotMetrics {
  // 카운터 메트릭
  commandsTotal: Counter<string>;
  eventsTotal: Counter<string>;
  errorsTotal: Counter<string>;
  apiCallsTotal: Counter<string>;
  rateLimitHitsTotal: Counter<string>;

  // 게이지 메트릭
  websocketPing: Gauge<string>;
  memoryUsage: Gauge<string>;
  cpuUsage: Gauge<string>;
  activeConnections: Gauge<string>;
  guildCount: Gauge<string>;
  userCount: Gauge<string>;
  channelCount: Gauge<string>;

  // 히스토그램 메트릭
  commandDuration: Histogram<string>;
  eventProcessingDuration: Histogram<string>;
  apiResponseTime: Histogram<string>;
  databaseQueryDuration: Histogram<string>;
}

/**
 * 메트릭 수집 설정 인터페이스
 */
export interface MetricsConfig {
  enabled: boolean;
  port: number;
  endpoint: string;
  collectInterval: number;
  enableDefaultMetrics: boolean;
  prefix: string;
  labels: Record<string, string>;
}

/**
 * Prometheus 메트릭 서비스 인터페이스
 * Discord 봇의 메트릭을 Prometheus 형식으로 수집하고 노출하는 서비스
 */
export interface IPrometheusMetricsService {
  // 서비스 제어
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;

  // 메트릭 레지스트리 관리
  getRegistry(): Registry;
  getMetrics(): Promise<string>;
  clearMetrics(): void;

  // Discord 봇 메트릭 접근
  getBotMetrics(): DiscordBotMetrics;

  // 명령어 메트릭
  recordCommand(commandName: string, success: boolean, duration: number): void;
  recordCommandError(commandName: string, errorType: string): void;

  // 이벤트 메트릭
  recordEvent(eventType: string, processingTime: number): void;
  recordEventError(eventType: string, errorType: string): void;

  // Discord API 메트릭
  recordAPICall(endpoint: string, method: string, statusCode: number, duration: number): void;
  recordRateLimit(endpoint: string, remaining: number): void;
  recordWebSocketPing(ping: number): void;

  // 시스템 메트릭
  recordMemoryUsage(usage: NodeJS.MemoryUsage): void;
  recordCPUUsage(usage: number): void;
  recordConnectionStatus(status: 'connected' | 'disconnected' | 'reconnecting'): void;

  // Discord 엔티티 메트릭
  recordGuildCount(count: number): void;
  recordUserCount(count: number): void;
  recordChannelCount(count: number): void;

  // 데이터베이스 메트릭
  recordDatabaseQuery(operation: string, table: string, duration: number, success: boolean): void;
  recordDatabaseConnection(status: 'connected' | 'disconnected'): void;

  // 에러 추적
  recordError(type: string, severity: 'low' | 'medium' | 'high' | 'critical'): void;
  recordException(error: Error, context?: Record<string, any>): void;

  // 커스텀 메트릭
  createCounter(name: string, help: string, labels?: string[]): Counter<string>;
  createGauge(name: string, help: string, labels?: string[]): Gauge<string>;
  createHistogram(
    name: string,
    help: string,
    buckets?: number[],
    labels?: string[]
  ): Histogram<string>;

  // 설정 관리
  updateConfig(config: Partial<MetricsConfig>): void;
  getConfig(): MetricsConfig;

  // 레이블 관리
  setGlobalLabels(labels: Record<string, string>): void;
  getGlobalLabels(): Record<string, string>;

  // 서버 관리
  getServerPort(): number;
  getServerEndpoint(): string;
  getServerStatus(): { running: boolean; port: number; uptime: number };

  // 메트릭 쿼리
  getMetricValue(name: string, labels?: Record<string, string>): number | undefined;
  getAllMetricNames(): string[];

  // 백업 및 복원
  exportMetrics(): Promise<string>;

  // 헬스 체크
  healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: Record<string, any> }>;
}
