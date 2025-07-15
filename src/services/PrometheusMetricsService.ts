// src/services/PrometheusMetricsService.ts - Prometheus 메트릭 수집 서비스
import { Client } from 'discord.js';
import express, { Request, Response } from 'express';
import {
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
  Registry,
} from 'prom-client';
import { Server } from 'http';

import { logger } from '../config/logger-termux.js';

// 메트릭 타입 정의
interface DiscordBotMetrics {
  // Command metrics
  commandsTotal: Counter<string>;
  commandDuration: Histogram<string>;
  commandErrors: Counter<string>;

  // Discord API metrics
  discordApiRequests: Counter<string>;
  discordRateLimits: Counter<string>;
  websocketPing: Gauge<string>;
  websocketReconnections: Counter<string>;

  // Bot state metrics
  guilds: Gauge<string>;
  users: Gauge<string>;
  channels: Gauge<string>;
  botReady: Gauge<string>;

  // Event processing metrics
  eventsProcessed: Counter<string>;
  eventProcessingDuration: Histogram<string>;

  // System metrics
  memoryUsage: Gauge<string>;
  cpuUsage: Gauge<string>;
  uptime: Gauge<string>;

  // Database metrics
  databaseQueries: Counter<string>;
  databaseQueryDuration: Histogram<string>;
  databaseConnections: Gauge<string>;

  // Activity tracking metrics
  voiceChannelSessions: Counter<string>;
  userActivityUpdates: Counter<string>;
  activityReports: Counter<string>;
}

interface MetricsServerConfig {
  port: number;
  host: string;
  path: string;
  enableDefaultMetrics: boolean;
  defaultMetricsInterval: number;
}

export class PrometheusMetricsService {
  private client: Client;
  private app: express.Application;
  private server: Server | null = null;
  private registry: Registry;
  private metrics: DiscordBotMetrics;
  private isEnabled: boolean = true;

  private readonly config: MetricsServerConfig = {
    port: 3001,
    host: '0.0.0.0',
    path: '/metrics',
    enableDefaultMetrics: true,
    defaultMetricsInterval: 30000, // 30초
  };

  constructor(client: Client) {
    this.client = client;
    this.app = express();
    this.registry = new Registry();

    // 기본 시스템 메트릭 수집 활성화
    if (this.config.enableDefaultMetrics) {
      collectDefaultMetrics({
        register: this.registry,
        gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5], // GC 지속시간 버킷
      });
    }

    // Discord Bot 전용 메트릭 초기화
    this.metrics = this.initializeMetrics();

    // Express 서버 설정
    this.setupExpressServer();

    logger.info('[PrometheusMetrics] Prometheus 메트릭 서비스 초기화 완료', {
      port: this.config.port,
      host: this.config.host,
      path: this.config.path,
    });
  }

  /**
   * Discord Bot 전용 메트릭 초기화
   */
  private initializeMetrics(): DiscordBotMetrics {
    // Command metrics
    const commandsTotal = new Counter({
      name: 'discord_bot_commands_total',
      help: 'Total number of commands executed',
      labelNames: ['command_name', 'user_id', 'guild_id', 'status'],
      registers: [this.registry],
    });

    const commandDuration = new Histogram({
      name: 'discord_bot_command_duration_seconds',
      help: 'Command execution duration in seconds',
      labelNames: ['command_name'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30], // 0.1초 ~ 30초
      registers: [this.registry],
    });

    const commandErrors = new Counter({
      name: 'discord_bot_command_errors_total',
      help: 'Total number of command errors',
      labelNames: ['command_name', 'error_type'],
      registers: [this.registry],
    });

    // Discord API metrics
    const discordApiRequests = new Counter({
      name: 'discord_bot_api_requests_total',
      help: 'Total number of Discord API requests',
      labelNames: ['method', 'endpoint', 'status_code'],
      registers: [this.registry],
    });

    const discordRateLimits = new Counter({
      name: 'discord_bot_rate_limits_total',
      help: 'Total number of rate limit hits',
      labelNames: ['route', 'bucket'],
      registers: [this.registry],
    });

    const websocketPing = new Gauge({
      name: 'discord_bot_websocket_ping_milliseconds',
      help: 'WebSocket ping in milliseconds',
      registers: [this.registry],
    });

    const websocketReconnections = new Counter({
      name: 'discord_bot_websocket_reconnections_total',
      help: 'Total number of WebSocket reconnections',
      registers: [this.registry],
    });

    // Bot state metrics
    const guilds = new Gauge({
      name: 'discord_bot_guilds_total',
      help: 'Number of guilds the bot is in',
      registers: [this.registry],
    });

    const users = new Gauge({
      name: 'discord_bot_users_total',
      help: 'Number of users the bot can see',
      registers: [this.registry],
    });

    const channels = new Gauge({
      name: 'discord_bot_channels_total',
      help: 'Number of channels the bot can see',
      registers: [this.registry],
    });

    const botReady = new Gauge({
      name: 'discord_bot_ready',
      help: 'Whether the bot is ready (1) or not (0)',
      registers: [this.registry],
    });

    // Event processing metrics
    const eventsProcessed = new Counter({
      name: 'discord_bot_events_processed_total',
      help: 'Total number of Discord events processed',
      labelNames: ['event_type'],
      registers: [this.registry],
    });

    const eventProcessingDuration = new Histogram({
      name: 'discord_bot_event_processing_duration_seconds',
      help: 'Event processing duration in seconds',
      labelNames: ['event_type'],
      buckets: [0.001, 0.01, 0.1, 0.5, 1, 5], // 1ms ~ 5초
      registers: [this.registry],
    });

    // System metrics
    const memoryUsage = new Gauge({
      name: 'discord_bot_memory_usage_bytes',
      help: 'Memory usage in bytes',
      labelNames: ['type'], // rss, heapUsed, heapTotal, external
      registers: [this.registry],
    });

    const cpuUsage = new Gauge({
      name: 'discord_bot_cpu_usage_percent',
      help: 'CPU usage percentage',
      registers: [this.registry],
    });

    const uptime = new Gauge({
      name: 'discord_bot_uptime_seconds',
      help: 'Bot uptime in seconds',
      registers: [this.registry],
    });

    // Database metrics
    const databaseQueries = new Counter({
      name: 'discord_bot_database_queries_total',
      help: 'Total number of database queries',
      labelNames: ['operation', 'table', 'status'],
      registers: [this.registry],
    });

    const databaseQueryDuration = new Histogram({
      name: 'discord_bot_database_query_duration_seconds',
      help: 'Database query duration in seconds',
      labelNames: ['operation', 'table'],
      buckets: [0.001, 0.01, 0.1, 0.5, 1, 5], // 1ms ~ 5초
      registers: [this.registry],
    });

    const databaseConnections = new Gauge({
      name: 'discord_bot_database_connections',
      help: 'Number of active database connections',
      registers: [this.registry],
    });

    // Activity tracking metrics
    const voiceChannelSessions = new Counter({
      name: 'discord_bot_voice_sessions_total',
      help: 'Total number of voice channel sessions',
      labelNames: ['action'], // join, leave
      registers: [this.registry],
    });

    const userActivityUpdates = new Counter({
      name: 'discord_bot_user_activity_updates_total',
      help: 'Total number of user activity updates',
      labelNames: ['update_type'],
      registers: [this.registry],
    });

    const activityReports = new Counter({
      name: 'discord_bot_activity_reports_total',
      help: 'Total number of activity reports generated',
      labelNames: ['report_type'],
      registers: [this.registry],
    });

    return {
      commandsTotal,
      commandDuration,
      commandErrors,
      discordApiRequests,
      discordRateLimits,
      websocketPing,
      websocketReconnections,
      guilds,
      users,
      channels,
      botReady,
      eventsProcessed,
      eventProcessingDuration,
      memoryUsage,
      cpuUsage,
      uptime,
      databaseQueries,
      databaseQueryDuration,
      databaseConnections,
      voiceChannelSessions,
      userActivityUpdates,
      activityReports,
    };
  }

  /**
   * Express 서버 설정
   */
  private setupExpressServer(): void {
    // Health check endpoint
    this.app.get('/health', (_req: Request, res: Response) => {
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        bot_ready: this.client.isReady(),
      });
    });

    // Metrics endpoint
    this.app.get(this.config.path, async (_req: Request, res: Response) => {
      try {
        // 메트릭 업데이트
        this.updateSystemMetrics();
        this.updateDiscordMetrics();

        res.set('Content-Type', this.registry.contentType);
        const metrics = await this.registry.metrics();
        res.end(metrics);
      } catch (error) {
        logger.error('[PrometheusMetrics] 메트릭 노출 중 오류', {
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).end('Error collecting metrics');
      }
    });

    // 404 handler
    this.app.use('*', (_req: Request, res: Response) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Available endpoints: /health, ${this.config.path}`,
      });
    });
  }

  /**
   * 시스템 메트릭 업데이트
   */
  private updateSystemMetrics(): void {
    try {
      // 메모리 사용량
      const memUsage = process.memoryUsage();
      this.metrics.memoryUsage.set({ type: 'rss' }, memUsage.rss);
      this.metrics.memoryUsage.set({ type: 'heapUsed' }, memUsage.heapUsed);
      this.metrics.memoryUsage.set({ type: 'heapTotal' }, memUsage.heapTotal);
      this.metrics.memoryUsage.set({ type: 'external' }, memUsage.external);

      // 업타임
      this.metrics.uptime.set(process.uptime());

      // CPU 사용률 (Node.js는 직접 제공하지 않으므로 process.cpuUsage 활용)
      const cpuUsage = process.cpuUsage();
      const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // 마이크로초를 초로 변환
      this.metrics.cpuUsage.set(cpuPercent);
    } catch (error) {
      logger.error('[PrometheusMetrics] 시스템 메트릭 업데이트 오류', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Discord 관련 메트릭 업데이트
   */
  private updateDiscordMetrics(): void {
    try {
      if (!this.client.isReady()) {
        this.metrics.botReady.set(0);
        return;
      }

      this.metrics.botReady.set(1);
      this.metrics.guilds.set(this.client.guilds.cache.size);
      this.metrics.users.set(this.client.users.cache.size);
      this.metrics.channels.set(this.client.channels.cache.size);
      this.metrics.websocketPing.set(this.client.ws.ping);
    } catch (error) {
      logger.error('[PrometheusMetrics] Discord 메트릭 업데이트 오류', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 서버 시작
   */
  async start(): Promise<void> {
    if (!this.isEnabled) {
      logger.warn('[PrometheusMetrics] 서비스가 비활성화되어 있습니다');
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port, this.config.host, () => {
          logger.info('[PrometheusMetrics] Prometheus 메트릭 서버 시작', {
            port: this.config.port,
            host: this.config.host,
            metricsEndpoint: `http://${this.config.host}:${this.config.port}${this.config.path}`,
            healthEndpoint: `http://${this.config.host}:${this.config.port}/health`,
          });
          resolve();
        });

        this.server.on('error', (error) => {
          logger.error('[PrometheusMetrics] 서버 시작 오류', {
            error: error.message,
            port: this.config.port,
          });
          reject(error);
        });
      } catch (error) {
        logger.error('[PrometheusMetrics] 서버 설정 오류', {
          error: error instanceof Error ? error.message : String(error),
        });
        reject(error);
      }
    });
  }

  /**
   * 서버 중지
   */
  async stop(): Promise<void> {
    if (!this.server) {
      logger.warn('[PrometheusMetrics] 서버가 실행되고 있지 않습니다');
      return;
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        logger.info('[PrometheusMetrics] Prometheus 메트릭 서버 중지');
        this.server = null;
        resolve();
      });
    });
  }

  /**
   * 명령어 실행 메트릭 기록
   */
  recordCommand(commandName: string, userId: string, guildId: string, duration: number, success: boolean): void {
    const status = success ? 'success' : 'error';
    
    this.metrics.commandsTotal.inc({
      command_name: commandName,
      user_id: userId,
      guild_id: guildId,
      status,
    });

    this.metrics.commandDuration.observe({ command_name: commandName }, duration / 1000); // 밀리초를 초로 변환

    if (!success) {
      this.metrics.commandErrors.inc({
        command_name: commandName,
        error_type: 'execution_error',
      });
    }
  }

  /**
   * 이벤트 처리 메트릭 기록
   */
  recordEvent(eventType: string, duration: number): void {
    this.metrics.eventsProcessed.inc({ event_type: eventType });
    this.metrics.eventProcessingDuration.observe({ event_type: eventType }, duration / 1000);
  }

  /**
   * API 요청 메트릭 기록
   */
  recordApiRequest(method: string, endpoint: string, statusCode: number): void {
    this.metrics.discordApiRequests.inc({
      method,
      endpoint,
      status_code: statusCode.toString(),
    });
  }

  /**
   * 레이트 리밋 메트릭 기록
   */
  recordRateLimit(route: string, bucket: string): void {
    this.metrics.discordRateLimits.inc({ route, bucket });
  }

  /**
   * WebSocket 재연결 메트릭 기록
   */
  recordWebSocketReconnection(): void {
    this.metrics.websocketReconnections.inc();
  }

  /**
   * 데이터베이스 쿼리 메트릭 기록
   */
  recordDatabaseQuery(operation: string, table: string, duration: number, success: boolean): void {
    const status = success ? 'success' : 'error';
    
    this.metrics.databaseQueries.inc({ operation, table, status });
    this.metrics.databaseQueryDuration.observe({ operation, table }, duration / 1000);
  }

  /**
   * 음성 채널 세션 메트릭 기록
   */
  recordVoiceSession(action: 'join' | 'leave'): void {
    this.metrics.voiceChannelSessions.inc({ action });
  }

  /**
   * 사용자 활동 업데이트 메트릭 기록
   */
  recordUserActivityUpdate(updateType: string): void {
    this.metrics.userActivityUpdates.inc({ update_type: updateType });
  }

  /**
   * 활동 리포트 생성 메트릭 기록
   */
  recordActivityReport(reportType: string): void {
    this.metrics.activityReports.inc({ report_type: reportType });
  }

  /**
   * 메트릭 레지스트리 조회
   */
  getRegistry(): Registry {
    return this.registry;
  }

  /**
   * 메트릭 서비스 활성화/비활성화
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (enabled) {
      this.start().catch((error) => {
        logger.error('[PrometheusMetrics] 서비스 활성화 실패', { error: error.message });
      });
    } else {
      this.stop().catch((error) => {
        logger.error('[PrometheusMetrics] 서비스 비활성화 실패', { error: error.message });
      });
    }
  }

  /**
   * 서버 상태 조회
   */
  async getStatus() {
    return {
      enabled: this.isEnabled,
      serverRunning: this.server !== null,
      port: this.config.port,
      host: this.config.host,
      metricsPath: this.config.path,
      registeredMetrics: (await this.registry.getMetricsAsJSON()).length,
    };
  }
}