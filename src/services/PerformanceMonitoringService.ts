// src/services/PerformanceMonitoringService.ts - Discord Bot 성능 모니터링 서비스
import { performance } from 'perf_hooks';

import { Client, Events } from 'discord.js';
import { injectable, inject } from 'tsyringe';

import { TIME } from '../config/constants.js';
import { logger } from '../config/logger-termux.js';
import { DI_TOKENS } from '../interfaces/index.js';

import { PrometheusMetricsService } from './PrometheusMetricsService.js';

// Discord API 레이트 리밋 정보
interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAfter: number;
  bucket: string;
  route: string;
  majorParameter: string;
  retryAfter?: number;
}

// 웹소켓 연결 상태
interface WebSocketMetrics {
  ping: number;
  status: number;
  reconnectCount: number;
  lastReconnect?: Date;
  totalDisconnections: number;
}

// 이벤트 처리 성능 메트릭
interface EventPerformanceMetrics {
  eventType: string;
  count: number;
  totalTime: number;
  averageTime: number;
  maxTime: number;
  minTime: number;
  lastExecution: Date;
  errorsCount: number;
}

// API 호출 메트릭
interface APIMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rateLimitHits: number;
  averageResponseTime: number;
  lastRateLimit?: RateLimitInfo;
}

// 종합 성능 리포트
interface PerformanceReport {
  timestamp: Date;
  uptime: number;
  websocket: WebSocketMetrics;
  api: APIMetrics;
  events: Record<string, EventPerformanceMetrics>;
  memory: NodeJS.MemoryUsage;
  discord: {
    guilds: number;
    users: number;
    channels: number;
    ready: boolean;
  };
}

@injectable()
export class PerformanceMonitoringService {
  private client: Client;
  private isEnabled: boolean = true;
  private prometheusMetrics: PrometheusMetricsService;

  // 메트릭 저장소
  private websocketMetrics: WebSocketMetrics;
  private apiMetrics: APIMetrics;
  private eventMetrics: Map<string, EventPerformanceMetrics>;
  private eventStartTimes: Map<string, number>;

  // 모니터링 인터벌
  private monitoringInterval: NodeJS.Timeout | undefined;
  private reportingInterval: NodeJS.Timeout | undefined;

  // 설정
  private readonly config = {
    monitoringInterval: 30 * TIME.SECOND, // 30초마다 메트릭 수집
    reportingInterval: 5 * TIME.MINUTE, // 5분마다 리포트 생성
    maxEventHistory: 1000, // 최대 이벤트 기록 수
    enableDetailedLogging: true,
  };

  constructor(
    @inject(DI_TOKENS.DiscordClient) client: Client,
    @inject(DI_TOKENS.IPrometheusMetricsService) prometheusMetrics: PrometheusMetricsService
  ) {
    this.client = client;
    this.prometheusMetrics = prometheusMetrics;

    // 초기 메트릭 설정
    this.websocketMetrics = {
      ping: 0,
      status: 0,
      reconnectCount: 0,
      totalDisconnections: 0,
    };

    this.apiMetrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitHits: 0,
      averageResponseTime: 0,
    };

    this.eventMetrics = new Map();
    this.eventStartTimes = new Map();

    this.setupEventListeners();
  }

  /**
   * 모니터링 서비스 시작
   */
  start(): void {
    if (!this.isEnabled) {
      logger.warn('[PerformanceMonitor] 서비스가 비활성화되어 있습니다');
      return;
    }

    logger.info('[PerformanceMonitor] 성능 모니터링 서비스 시작');

    // 정기적인 메트릭 수집
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.monitoringInterval);

    // 정기적인 리포트 생성
    this.reportingInterval = setInterval(() => {
      this.generatePerformanceReport();
    }, this.config.reportingInterval);

    // 초기 수집
    this.collectMetrics();
  }

  /**
   * 모니터링 서비스 중지
   */
  stop(): void {
    logger.info('[PerformanceMonitor] 성능 모니터링 서비스 중지');

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    if (this.reportingInterval) {
      clearInterval(this.reportingInterval);
      this.reportingInterval = undefined;
    }
  }

  /**
   * Discord 이벤트 리스너 설정
   */
  private setupEventListeners(): void {
    // API 레이트 리밋 모니터링
    this.client.rest.on('rateLimited', (rateLimitData) => {
      this.handleRateLimit(rateLimitData);
    });

    // 웹소켓 연결 상태 모니터링
    this.client.on('ready', () => {
      logger.info('[PerformanceMonitor] WebSocket 연결 준비 완료');
      this.websocketMetrics.status = 1;
    });

    this.client.on('shardResumed', () => {
      logger.info('[PerformanceMonitor] WebSocket 연결 재개');
      this.websocketMetrics.reconnectCount++;
      this.websocketMetrics.lastReconnect = new Date();

      // Prometheus 메트릭 기록
      this.prometheusMetrics.recordWebSocketReconnection();
    });

    this.client.on('shardDisconnect', () => {
      logger.warn('[PerformanceMonitor] WebSocket 연결 끊김');
      this.websocketMetrics.status = 0;
      this.websocketMetrics.totalDisconnections++;
    });

    // 주요 이벤트 성능 측정
    this.setupEventPerformanceTracking();
  }

  /**
   * 이벤트 성능 추적 설정
   */
  private setupEventPerformanceTracking(): void {
    const eventsToTrack = [
      Events.MessageCreate,
      Events.MessageDelete,
      Events.VoiceStateUpdate,
      Events.GuildMemberUpdate,
      Events.InteractionCreate,
      Events.ChannelCreate,
      Events.ChannelDelete,
      Events.ChannelUpdate,
    ];

    eventsToTrack.forEach((eventName) => {
      // 이벤트 시작 시간 기록
      this.client.prependListener(eventName, () => {
        const startTime = performance.now();
        const eventId = `${eventName}-${Date.now()}-${Math.random()}`;
        this.eventStartTimes.set(eventId, startTime);

        // 이벤트 완료 후 성능 기록
        process.nextTick(() => {
          this.recordEventPerformance(eventName, eventId);
        });
      });
    });
  }

  /**
   * API 레이트 리밋 처리
   */
  private handleRateLimit(rateLimitData: any): void {
    this.apiMetrics.rateLimitHits++;

    const rateLimitInfo: RateLimitInfo = {
      limit: rateLimitData.limit || 0,
      remaining: rateLimitData.remaining || 0,
      resetAfter: rateLimitData.resetAfter || 0,
      bucket: rateLimitData.bucket || 'unknown',
      route: rateLimitData.route || 'unknown',
      majorParameter: rateLimitData.majorParameter || 'unknown',
      retryAfter: rateLimitData.retryAfter,
    };

    this.apiMetrics.lastRateLimit = rateLimitInfo;

    // Prometheus 메트릭 기록
    this.prometheusMetrics.recordRateLimit(rateLimitInfo.route, rateLimitInfo.bucket);

    logger.discordRateLimit('[PerformanceMonitor] API 레이트 리밋 도달', {
      route: rateLimitInfo.route,
      remaining: rateLimitInfo.remaining,
      resetAfter: rateLimitInfo.resetAfter,
      totalHits: this.apiMetrics.rateLimitHits,
      bucket: rateLimitInfo.bucket,
      majorParameter: rateLimitInfo.majorParameter,
    });

    // 심각한 레이트 리밋의 경우 알림
    if (rateLimitInfo.retryAfter && rateLimitInfo.retryAfter > 60) {
      logger.alert('[PerformanceMonitor] 심각한 API 레이트 리밋 감지', {
        retryAfter: rateLimitInfo.retryAfter,
        route: rateLimitInfo.route,
        severity: 'critical',
      });
    }
  }

  /**
   * 이벤트 성능 기록
   */
  private recordEventPerformance(eventName: string, eventId: string): void {
    const startTime = this.eventStartTimes.get(eventId);
    if (!startTime) return;

    const executionTime = performance.now() - startTime;
    this.eventStartTimes.delete(eventId);

    // 기존 메트릭 조회 또는 생성
    let metrics = this.eventMetrics.get(eventName);
    if (!metrics) {
      metrics = {
        eventType: eventName,
        count: 0,
        totalTime: 0,
        averageTime: 0,
        maxTime: 0,
        minTime: Infinity,
        lastExecution: new Date(),
        errorsCount: 0,
      };
      this.eventMetrics.set(eventName, metrics);
    }

    // 메트릭 업데이트
    metrics.count++;
    metrics.totalTime += executionTime;
    metrics.averageTime = metrics.totalTime / metrics.count;
    metrics.maxTime = Math.max(metrics.maxTime, executionTime);
    metrics.minTime = Math.min(metrics.minTime, executionTime);
    metrics.lastExecution = new Date();

    // Prometheus 메트릭 기록
    this.prometheusMetrics.recordEvent(eventName, executionTime);

    // 느린 이벤트 처리 경고
    if (executionTime > 1000) {
      // 1초 이상
      logger.warn('[PerformanceMonitor] 느린 이벤트 처리 감지', {
        eventType: eventName,
        executionTime: `${executionTime.toFixed(2)}ms`,
        averageTime: `${metrics.averageTime.toFixed(2)}ms`,
      });
    }
  }

  /**
   * 메트릭 수집
   */
  private collectMetrics(): void {
    try {
      // 웹소켓 핑 업데이트
      this.websocketMetrics.ping = this.client.ws.ping;

      // API 요청 통계 업데이트 (Discord.js 내부 통계 활용)
      const restStats = (this.client.rest as any).requestManager?.globalTimeout || 0;
      if (restStats > 0) {
        this.apiMetrics.averageResponseTime = restStats;
      }

      if (this.config.enableDetailedLogging) {
        logger.debug('[PerformanceMonitor] 메트릭 수집 완료', {
          websocketPing: this.websocketMetrics.ping,
          rateLimitHits: this.apiMetrics.rateLimitHits,
          trackedEvents: this.eventMetrics.size,
        });
      }
    } catch (error) {
      logger.error('[PerformanceMonitor] 메트릭 수집 중 오류', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 성능 리포트 생성
   */
  private generatePerformanceReport(): void {
    try {
      const report: PerformanceReport = {
        timestamp: new Date(),
        uptime: this.client.uptime || 0,
        websocket: { ...this.websocketMetrics },
        api: { ...this.apiMetrics },
        events: Object.fromEntries(this.eventMetrics),
        memory: process.memoryUsage(),
        discord: {
          guilds: this.client.guilds.cache.size,
          users: this.client.users.cache.size,
          channels: this.client.channels.cache.size,
          ready: this.client.isReady(),
        },
      };

      // 메모리 사용량 MB 변환
      const memoryMB = {
        rss: Math.round(report.memory.rss / 1024 / 1024),
        heapTotal: Math.round(report.memory.heapTotal / 1024 / 1024),
        heapUsed: Math.round(report.memory.heapUsed / 1024 / 1024),
        external: Math.round(report.memory.external / 1024 / 1024),
      };

      logger.discordPerformance('[PerformanceMonitor] 성능 리포트', {
        uptime: `${Math.round(report.uptime / 1000)}초`,
        websocketPing: `${report.websocket.ping}ms`,
        guilds: report.discord.guilds,
        users: report.discord.users,
        channels: report.discord.channels,
        memoryUsage: `${memoryMB.heapUsed}MB`,
        memoryDetails: memoryMB,
        rateLimitHits: report.api.rateLimitHits,
        reconnections: report.websocket.reconnectCount,
        totalDisconnections: report.websocket.totalDisconnections,
        eventTypesTracked: Object.keys(report.events).length,
        ready: report.discord.ready,
      });

      // 성능 이슈 감지
      this.detectPerformanceIssues(report);
    } catch (error) {
      logger.error('[PerformanceMonitor] 리포트 생성 중 오류', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 성능 이슈 감지
   */
  private detectPerformanceIssues(report: PerformanceReport): void {
    const issues: string[] = [];

    // 높은 웹소켓 레이턴시
    if (report.websocket.ping > 300) {
      issues.push(`높은 웹소켓 레이턴시: ${report.websocket.ping}ms`);
    }

    // 메모리 사용량 경고
    const heapUsedMB = Math.round(report.memory.heapUsed / 1024 / 1024);
    if (heapUsedMB > 200) {
      issues.push(`높은 메모리 사용량: ${heapUsedMB}MB`);
    }

    // 빈번한 재연결
    if (report.websocket.reconnectCount > 10) {
      issues.push(`빈번한 재연결: ${report.websocket.reconnectCount}회`);
    }

    // API 레이트 리밋 문제
    if (report.api.rateLimitHits > 50) {
      issues.push(`API 레이트 리밋 초과: ${report.api.rateLimitHits}회`);
    }

    // 느린 이벤트 처리
    for (const [eventType, metrics] of Object.entries(report.events)) {
      if (metrics.averageTime > 500) {
        issues.push(`느린 이벤트 처리 (${eventType}): ${metrics.averageTime.toFixed(2)}ms`);
      }
    }

    // 이슈가 있으면 경고 로그
    if (issues.length > 0) {
      logger.warn('[PerformanceMonitor] 성능 이슈 감지', {
        issues,
        recommendAction: '봇 재시작 또는 최적화 검토 필요',
      });
    }
  }

  /**
   * 현재 성능 상태 조회
   */
  getCurrentStatus(): { status: 'healthy' | 'warning' | 'critical'; details: Record<string, any> } {
    this.collectMetrics();

    const memoryUsageMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const websocketPing = this.websocketMetrics.ping;

    // 상태 판정
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';

    if (memoryUsageMB > 500 || websocketPing > 500) {
      status = 'warning';
    }
    if (memoryUsageMB > 1000 || websocketPing > 1000) {
      status = 'critical';
    }

    return {
      status,
      details: {
        timestamp: new Date(),
        uptime: this.client.uptime || 0,
        memoryUsageMB,
        websocketPing,
        guilds: this.client.guilds.cache.size,
        users: this.client.users.cache.size,
        channels: this.client.channels.cache.size,
        ready: this.client.isReady(),
        rateLimitHits: this.apiMetrics.rateLimitHits,
        reconnections: this.websocketMetrics.reconnectCount,
      },
    };
  }

  /**
   * 상세 성능 리포트 조회 (기존 getCurrentStatus 기능)
   */
  getDetailedReport(): PerformanceReport {
    this.collectMetrics();
    return {
      timestamp: new Date(),
      uptime: this.client.uptime || 0,
      websocket: { ...this.websocketMetrics },
      api: { ...this.apiMetrics },
      events: Object.fromEntries(this.eventMetrics),
      memory: process.memoryUsage(),
      discord: {
        guilds: this.client.guilds.cache.size,
        users: this.client.users.cache.size,
        channels: this.client.channels.cache.size,
        ready: this.client.isReady(),
      },
    };
  }

  /**
   * 메트릭 초기화
   */
  resetMetrics(): void {
    logger.info('[PerformanceMonitor] 메트릭 초기화');

    this.websocketMetrics.reconnectCount = 0;
    this.websocketMetrics.totalDisconnections = 0;
    this.apiMetrics.totalRequests = 0;
    this.apiMetrics.successfulRequests = 0;
    this.apiMetrics.failedRequests = 0;
    this.apiMetrics.rateLimitHits = 0;
    this.eventMetrics.clear();
  }

  /**
   * 서비스 활성화/비활성화
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (enabled) {
      this.start();
    } else {
      this.stop();
    }
  }
}
