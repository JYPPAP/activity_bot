// src/config/logger-termux.ts - Termux 환경용 Errsole 설정 (SQLite 사용)
import path from 'path';

import axios from 'axios';
import errsole from 'errsole';
import ErrsoleSQLite from 'errsole-sqlite';

import { LogLevel } from '../types/index.js';

import { TIME } from './constants.js';
import { config, isDevelopment } from './env.js';

// SQLite 모듈 동적 임포트 (타입 안전성)
let sqlite3: any;
try {
  sqlite3 = await import('sqlite3');
} catch (error) {
  console.warn('⚠️ SQLite3 모듈을 로드할 수 없습니다. 일부 기능이 제한될 수 있습니다.');
}

// ====================
// 타입 정의
// ====================

interface LoggerConfig {
  host: string;
  port: number;
  logLevel: LogLevel;
  retentionDays: number;
  enableAlerts: boolean;
  environment: string;
  appName: string;
  logsFile: string;
}

interface LogMeta {
  [key: string]: any;
  type?: string;
  timestamp?: string;
  userId?: string;
  guildId?: string;
  channelId?: string;
  commandName?: string;
  error?: string;
  stack?: string;
}

interface HealthCheckData {
  uptime: string;
  memory: MemoryUsage;
  memoryDiff: MemoryDiff;
  timestamp: string;
  discord?: DiscordHealthMetrics;
}

interface DiscordHealthMetrics {
  websocketPing: number;
  guilds: number;
  users: number;
  channels: number;
  ready: boolean;
  rateLimitHits: number;
  reconnections: number;
  totalDisconnections: number;
  eventTypesTracked: number;
  performanceIssues: string[];
}

interface MemoryUsage {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
}

interface MemoryDiff {
  rss: number;
  heapUsed: number;
  heapTotal?: number;
}

interface SlackAttachment {
  color: string;
  fields: Array<{
    title: string;
    value: string;
    short: boolean;
  }>;
}

interface SlackMessage {
  channel: string;
  username: string;
  text: string;
  attachments: SlackAttachment[];
}

interface LoggerMethods {
  debug: (message: string, meta?: LogMeta) => void;
  info: (message: string, meta?: LogMeta) => void;
  warn: (message: string, meta?: LogMeta) => void;
  error: (message: string, meta?: LogMeta) => void;
  alert: (message: string, meta?: LogMeta) => void;
}

interface BotLogger extends LoggerMethods {
  botActivity: (message: string, meta?: LogMeta) => void;
  voiceActivity: (message: string, meta?: LogMeta) => void;
  commandExecution: (message: string, meta?: LogMeta) => void;
  databaseOperation: (message: string, meta?: LogMeta) => void;
  discordEvent: (message: string, meta?: LogMeta) => void;
  discordRateLimit: (message: string, meta?: LogMeta) => void;
  discordPerformance: (message: string, meta?: LogMeta) => void;
  withMeta: (meta: LogMeta) => LoggerMethods;
}

// ====================
// 설정 변수
// ====================

const errsoleHost: string = config.ERRSOLE_HOST || '0.0.0.0';
const errsolePort: number = parseInt(config.ERRSOLE_PORT || '8002', 10);

// ====================
// SQLite 데이터베이스 최적화 함수
// ====================

async function optimizeSQLiteDatabase(dbPath: string): Promise<void> {
  if (!sqlite3) {
    console.warn('⚠️ SQLite3 모듈이 없어 데이터베이스 최적화를 건너뜁니다.');
    return;
  }

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err: Error | null) => {
      if (err) {
        console.error('❌ SQLite 데이터베이스 연결 실패:', err.message);
        reject(err);
        return;
      }

      console.log('🔧 SQLite 데이터베이스 최적화 시작...');

      // WAL 모드 활성화 및 최적화 설정
      db.serialize(() => {
        // WAL 모드 활성화 (동시 읽기/쓰기 성능 향상)
        db.run('PRAGMA journal_mode = WAL;', (err: Error | null) => {
          if (err) console.error('❌ WAL 모드 설정 실패:', err.message);
          else console.log('✅ WAL 모드 활성화 완료');
        });

        // Synchronous 모드 최적화 (WAL과 함께 사용할 때 NORMAL이 최적)
        db.run('PRAGMA synchronous = NORMAL;', (err: Error | null) => {
          if (err) console.error('❌ Synchronous 모드 설정 실패:', err.message);
          else console.log('✅ Synchronous 모드 NORMAL 설정 완료');
        });

        // 타임아웃 설정 (10초)
        db.run('PRAGMA busy_timeout = 10000;', (err: Error | null) => {
          if (err) console.error('❌ Timeout 설정 실패:', err.message);
          else console.log('✅ Busy timeout 10초 설정 완료');
        });

        // 캐시 크기 최적화 (Termux 환경에 맞게 조정)
        db.run('PRAGMA cache_size = -64000;', (err: Error | null) => {
          if (err) console.error('❌ Cache 크기 설정 실패:', err.message);
          else console.log('✅ Cache 크기 64MB 설정 완료');
        });

        // WAL 자동 체크포인트 설정 (1000 페이지마다)
        db.run('PRAGMA wal_autocheckpoint = 1000;', (err: Error | null) => {
          if (err) console.error('❌ WAL 체크포인트 설정 실패:', err.message);
          else console.log('✅ WAL 자동 체크포인트 설정 완료');
        });
      });

      db.close((err: Error | null) => {
        if (err) {
          console.error('❌ SQLite 데이터베이스 닫기 실패:', err.message);
          reject(err);
        } else {
          console.log('✅ SQLite 데이터베이스 최적화 완료');
          resolve();
        }
      });
    });
  });
}

// ====================
// 로거 설정
// ====================

function createLoggerConfig(environment: 'development' | 'production'): LoggerConfig {
  const logsDir = path.join(process.cwd(), 'logs');
  const logsFile = path.join(logsDir, `discord-bot-${environment}.log.sqlite`);

  return {
    host: errsoleHost,
    port: errsolePort,
    logLevel: environment === 'development' ? 'debug' : 'info',
    retentionDays: 180, // 6개월
    enableAlerts: environment === 'production',
    environment,
    appName: 'discord-bot',
    logsFile,
  };
}

function initializeLogger(loggerConfig: LoggerConfig): void {
  errsole.initialize({
    storage: new ErrsoleSQLite(loggerConfig.logsFile),
    appName: loggerConfig.appName,
    environmentName: loggerConfig.environment,
    port: loggerConfig.port,
  });
}

// 환경별 로거 설정
const loggerConfig = createLoggerConfig(isDevelopment() ? 'development' : 'production');

if (isDevelopment()) {
  initializeLogger(loggerConfig);

  console.log(`✅ Errsole 개발 환경 설정 완료 (Termux)`);
  console.log(
    `📊 대시보드 (${errsoleHost}): http://${errsoleHost === '0.0.0.0' ? '핸드폰IP' : errsoleHost}:${errsolePort}`
  );
  console.log(`💾 로그 파일: ${loggerConfig.logsFile}`);

  // 환경변수 검증 로그
  console.log(`🔍 환경변수 검증:`);
  console.log(`   - NODE_ENV: ${config.NODE_ENV || 'development'}`);
  console.log(`   - ERRSOLE_HOST: ${errsoleHost}`);
  console.log(`   - ERRSOLE_PORT: ${errsolePort}`);
  console.log(`   - ENABLE_SLACK_ALERTS: ${config.ENABLE_SLACK_ALERTS || 'false'}`);
  console.log(`   - SLACK_WEBHOOK_URL: ${config.SLACK_WEBHOOK_URL ? '설정됨' : '미설정'}`);
  console.log(`   - SLACK_CHANNEL: ${config.SLACK_CHANNEL || '#discord-bot-alert'}`);
} else {
  console.log('🚀 Errsole 운영 환경 설정 (Slack 알림 포함)');
  console.log('Note: Terminal output will be disabled after initial logs.');

  initializeLogger(loggerConfig);

  console.log(`✅ Errsole 운영 환경 설정 완료`);
  console.log(
    `📊 대시보드: http://${errsoleHost === '0.0.0.0' ? '핸드폰IP' : errsoleHost}:${errsolePort}`
  );
  console.log(`💾 로그 파일: ${loggerConfig.logsFile}`);

  // 환경변수 검증 로그
  console.log(`🔍 환경변수 검증:`);
  console.log(`   - NODE_ENV: ${config.NODE_ENV || 'production'}`);
  console.log(`   - ERRSOLE_HOST: ${errsoleHost}`);
  console.log(`   - ERRSOLE_PORT: ${errsolePort}`);
  console.log(`   - ENABLE_SLACK_ALERTS: ${config.ENABLE_SLACK_ALERTS || 'false'}`);
  console.log(`   - SLACK_WEBHOOK_URL: ${config.SLACK_WEBHOOK_URL ? '설정됨' : '미설정'}`);
  console.log(`   - SLACK_CHANNEL: ${config.SLACK_CHANNEL || '#discord-bot-alert'}`);
  console.log(`   - SLACK_MIN_LEVEL: ${config.SLACK_MIN_LEVEL || 'error'}`);

  if (config.ENABLE_SLACK_ALERTS === 'true') {
    console.log(`🔔 Slack 알림 활성화: ${config.SLACK_CHANNEL || '#discord-bot-alert'}`);
  } else {
    console.log(`🔕 Slack 알림 비활성화`);
  }
}

// SQLite 최적화 실행
optimizeSQLiteDatabase(loggerConfig.logsFile).catch((err: Error) => {
  console.error('⚠️ SQLite 최적화 중 오류 발생:', err.message);
});

if (errsoleHost === '0.0.0.0') {
  console.log(`🌐 외부 접속 모드 활성화 - 같은 네트워크의 다른 기기에서 접속 가능`);
  console.log(`💻 컴퓨터에서 접속하려면: 핸드폰 IP 확인 후 http://핸드폰IP:${errsolePort}`);
}

// ====================
// Slack 알림 함수
// ====================

async function sendSlackAlert(level: LogLevel, message: string, meta: LogMeta = {}): Promise<void> {
  // 개발 환경이거나 Slack 알림이 비활성화된 경우 건너뛰기
  if (isDevelopment() || config.ENABLE_SLACK_ALERTS !== 'true') {
    return;
  }

  // 최소 알림 레벨 체크
  const minLevel = (config.SLACK_MIN_LEVEL as LogLevel) || 'error';
  const levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    alert: 4,
  };

  if (levelPriority[level] < levelPriority[minLevel]) {
    return;
  }

  try {
    const webhookUrl = config.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      console.info('Slack 알림 비활성화: SLACK_WEBHOOK_URL이 설정되지 않았습니다.');
      return;
    }

    // 레벨별 이모지 설정
    const levelEmojis: Record<LogLevel, string> = {
      debug: '🔍',
      info: 'ℹ️',
      warn: '⚠️',
      error: '🚨',
      alert: '🔥',
    };

    // 레벨별 색상 설정
    const getColorForLevel = (level: LogLevel): string => {
      switch (level) {
        case 'error':
        case 'alert':
          return 'danger';
        case 'warn':
          return 'warning';
        default:
          return 'good';
      }
    };

    // Slack 메시지 구성
    const slackMessage: SlackMessage = {
      channel: config.SLACK_CHANNEL || '#discord-bot-alert',
      username: 'Discord Bot Alert (Termux)',
      text: `${levelEmojis[level]} **${level.toUpperCase()}**: ${message}`,
      attachments: [
        {
          color: getColorForLevel(level),
          fields: [
            {
              title: 'App Name',
              value: 'discord-bot',
              short: true,
            },
            {
              title: 'Environment',
              value: 'Termux (Android)',
              short: true,
            },
            {
              title: 'Timestamp',
              value: new Date().toISOString(),
              short: true,
            },
            {
              title: 'Dashboard',
              value: `http://${errsoleHost === '0.0.0.0' ? config.PHONE_IP || '핸드폰IP' : errsoleHost}:${errsolePort}`,
              short: true,
            },
          ],
        },
      ],
    };

    // 메타데이터가 있으면 추가
    if (Object.keys(meta).length > 0) {
      slackMessage.attachments[0].fields.push({
        title: 'Metadata',
        value: '```' + JSON.stringify(meta, null, 2) + '```',
        short: false,
      });
    }

    // Slack으로 전송
    await axios.post(webhookUrl, slackMessage, {
      timeout: TIME.API_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Slack 알림 전송 실패:', error instanceof Error ? error.message : String(error));
  }
}

// ====================
// 에러 핸들러 설정
// ====================

function setupErrorHandlers(): void {
  // 강화된 전역 에러 핸들러 설정
  process.on('uncaughtException', (error: Error) => {
    console.error('💥 치명적 오류 발생:', error.message);

    // SQLite 관련 에러 특별 처리
    if (
      error.message &&
      (error.message.includes('database is locked') ||
        error.message.includes('SQLITE_BUSY') ||
        error.message.includes('SQLITE_LOCKED'))
    ) {
      console.error('🔒 SQLite 데이터베이스 잠금 에러 감지 - 프로세스 재시작 권장');
      errsole.error('SQLite Database Lock Error - Process Restart Required', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
        restartRecommended: true,
      });
    } else {
      errsole.error('Uncaught Exception:', error);
    }

    // 강제 가비지 컬렉션 (메모리 정리)
    if (global.gc) {
      console.log('🗑️ 강제 가비지 컬렉션 실행');
      global.gc();
    }

    // 1초 후 프로세스 종료 (로그 저장 시간 확보)
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    console.error('❌ 처리되지 않은 Promise 거부:', reason);

    // SQLite 관련 Promise 거부 특별 처리
    if (
      reason?.message &&
      (reason.message.includes('database is locked') ||
        reason.message.includes('SQLITE_BUSY') ||
        reason.message.includes('SQLITE_LOCKED'))
    ) {
      console.error('🔒 SQLite Promise 거부 - 데이터베이스 접근 재시도 필요');
      errsole.error('SQLite Promise Rejection - Database Access Retry Needed', {
        reason: reason.message,
        stack: reason.stack,
        timestamp: new Date().toISOString(),
        retryNeeded: true,
      });
    } else {
      errsole.error('Unhandled Rejection at:', promise, 'reason:', reason);
    }
  });

  // 메모리 사용량 모니터링
  process.on('warning', (warning: any) => {
    console.warn('⚠️ Node.js 경고:', warning.name, warning.message);

    if (warning.name === 'MaxListenersExceededWarning') {
      errsole.warn('Memory Leak Warning - Too Many Listeners', {
        warning: warning.message,
        stack: warning.stack,
        timestamp: new Date().toISOString(),
      });
    }
  });
}

// ====================
// 헬스체크 모니터링
// ====================

let healthCheckInterval: NodeJS.Timeout | null = null;
let lastMemoryUsage: NodeJS.MemoryUsage = process.memoryUsage();

function startHealthMonitoring(): void {
  console.log('🏥 헬스체크 모니터링 시작 (5분 간격)');

  healthCheckInterval = setInterval(async () => {
    try {
      const currentMemory = process.memoryUsage();
      const uptime = process.uptime();

      // 메모리 사용량 변화 계산
      const memoryDiff: MemoryDiff = {
        rss: currentMemory.rss - lastMemoryUsage.rss,
        heapUsed: currentMemory.heapUsed - lastMemoryUsage.heapUsed,
        heapTotal: currentMemory.heapTotal - lastMemoryUsage.heapTotal,
      };

      // MB 단위로 변환
      const memoryMB: MemoryUsage = {
        rss: Math.round(currentMemory.rss / 1024 / 1024),
        heapUsed: Math.round(currentMemory.heapUsed / 1024 / 1024),
        heapTotal: Math.round(currentMemory.heapTotal / 1024 / 1024),
        external: Math.round(currentMemory.external / 1024 / 1024),
      };

      // Discord 봇 메트릭 수집 (동적 임포트로 순환 참조 방지)
      let discordMetrics: DiscordHealthMetrics | undefined;
      try {
        const { Bot } = await import('../bot.js');
        const botInstance = Bot.getInstance();
        
        if (botInstance && botInstance.isReady()) {
          const performanceStatus = botInstance.services.performanceMonitor.getDetailedReport();
          
          // 성능 이슈 감지
          const performanceIssues: string[] = [];
          
          if (performanceStatus.websocket.ping > 300) {
            performanceIssues.push(`높은 레이턴시: ${performanceStatus.websocket.ping}ms`);
          }
          
          if (performanceStatus.api.rateLimitHits > 20) {
            performanceIssues.push(`레이트 리밋: ${performanceStatus.api.rateLimitHits}회`);
          }
          
          if (performanceStatus.websocket.reconnectCount > 5) {
            performanceIssues.push(`재연결: ${performanceStatus.websocket.reconnectCount}회`);
          }
          
          discordMetrics = {
            websocketPing: performanceStatus.websocket.ping,
            guilds: performanceStatus.discord.guilds,
            users: performanceStatus.discord.users,
            channels: performanceStatus.discord.channels,
            ready: performanceStatus.discord.ready,
            rateLimitHits: performanceStatus.api.rateLimitHits,
            reconnections: performanceStatus.websocket.reconnectCount,
            totalDisconnections: performanceStatus.websocket.totalDisconnections,
            eventTypesTracked: Object.keys(performanceStatus.events).length,
            performanceIssues,
          };
        }
      } catch (error) {
        // Discord 메트릭 수집 실패 시 무시 (봇이 아직 초기화되지 않았을 수 있음)
        console.debug('Discord 메트릭 수집 건너뜀:', error instanceof Error ? error.message : String(error));
      }

      // 헬스체크 데이터
      const healthData: HealthCheckData = {
        uptime: `${Math.round(uptime / 60)}분`,
        memory: memoryMB,
        memoryDiff: {
          rss: Math.round(memoryDiff.rss / 1024 / 1024),
          heapUsed: Math.round(memoryDiff.heapUsed / 1024 / 1024),
        },
        timestamp: new Date().toISOString(),
        ...(discordMetrics && { discord: discordMetrics }),
      };

      // 헬스체크 로그
      logger.info(`[HealthCheck] 시스템 상태 체크`, healthData);

      // Discord 성능 이슈 경고
      if (discordMetrics && discordMetrics.performanceIssues.length > 0) {
        logger.warn(`[HealthCheck] Discord 성능 이슈 감지`, {
          issues: discordMetrics.performanceIssues,
          websocketPing: discordMetrics.websocketPing,
          rateLimitHits: discordMetrics.rateLimitHits,
          recommendation: '봇 상태 점검 필요',
        });
      }

      // 메모리 누수 경고 (RSS가 200MB 이상 증가했을 때)
      if (memoryDiff.rss > 200 * 1024 * 1024) {
        logger.warn(`[HealthCheck] 메모리 사용량 급증 감지`, {
          memoryIncrease: `${Math.round(memoryDiff.rss / 1024 / 1024)}MB`,
          currentMemory: memoryMB,
          recommendation: 'PM2 재시작 권장',
        });
      }

      // 강제 가비지 컬렉션 (필요시)
      if (global.gc && memoryMB.heapUsed > 150) {
        console.log('🗑️ 예방적 가비지 컬렉션 실행');
        global.gc();
      }

      lastMemoryUsage = currentMemory;
    } catch (error) {
      logger.error('[HealthCheck] 헬스체크 실행 중 오류', {
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      });
    }
  }, 5 * TIME.MINUTE); // 5분마다 실행
}

// ====================
// 종료 핸들러 설정
// ====================

function setupShutdownHandlers(): void {
  const shutdown = (signal: string) => {
    console.log(`🔄 프로세스 종료 시그널 감지 (${signal}) - 정리 작업 시작`);
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
      console.log('✅ 헬스체크 모니터링 중지');
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ====================
// 로거 인스턴스 생성
// ====================

export const logger: BotLogger = {
  // 기본 로그 레벨 (Slack 알림 포함)
  debug: (message: string, meta: LogMeta = {}) => {
    errsole.debug(message, meta);
    sendSlackAlert('debug', message, meta);
  },
  info: (message: string, meta: LogMeta = {}) => {
    errsole.info(message, meta);
    sendSlackAlert('info', message, meta);
  },
  warn: (message: string, meta: LogMeta = {}) => {
    errsole.warn(message, meta);
    sendSlackAlert('warn', message, meta);
  },
  error: (message: string, meta: LogMeta = {}) => {
    errsole.error(message, meta);
    sendSlackAlert('error', message, meta);
  },
  alert: (message: string, meta: LogMeta = {}) => {
    errsole.alert(message, meta);
    sendSlackAlert('alert', message, meta);
  },

  // Discord Bot 전용 로깅 함수
  botActivity: (message: string, meta: LogMeta = {}) => {
    errsole.meta({ type: 'bot_activity', ...meta }).info(message);
  },

  voiceActivity: (message: string, meta: LogMeta = {}) => {
    errsole.meta({ type: 'voice_activity', ...meta }).info(message);
  },

  commandExecution: (message: string, meta: LogMeta = {}) => {
    errsole.meta({ type: 'command_execution', ...meta }).info(message);
  },

  databaseOperation: (message: string, meta: LogMeta = {}) => {
    errsole.meta({ type: 'database_operation', ...meta }).debug(message);
  },

  discordEvent: (message: string, meta: LogMeta = {}) => {
    errsole.meta({ type: 'discord_event', ...meta }).debug(message);
  },

  discordRateLimit: (message: string, meta: LogMeta = {}) => {
    errsole.meta({ type: 'discord_rate_limit', ...meta }).warn(message);
    sendSlackAlert('warn', message, { type: 'discord_rate_limit', ...meta });
  },

  discordPerformance: (message: string, meta: LogMeta = {}) => {
    errsole.meta({ type: 'discord_performance', ...meta }).info(message);
  },

  // 메타데이터와 함께 로깅하는 헬퍼 함수
  withMeta: (meta: LogMeta): LoggerMethods => ({
    debug: (message: string) => errsole.meta(meta).debug(message),
    info: (message: string) => errsole.meta(meta).info(message),
    warn: (message: string) => errsole.meta(meta).warn(message),
    error: (message: string) => errsole.meta(meta).error(message),
    alert: (message: string) => errsole.meta(meta).alert(message),
  }),
};

// ====================
// 초기화 함수들 실행
// ====================

setupErrorHandlers();
setupShutdownHandlers();

// 애플리케이션 시작 시 헬스체크 시작 (10초 후)
setTimeout(() => {
  startHealthMonitoring();
}, 10 * TIME.SECOND);

// 기본 errsole 인스턴스 내보내기
export default errsole;

// ====================
// 유틸리티 함수 내보내기
// ====================

export function getLoggerConfig(): LoggerConfig {
  return loggerConfig;
}

export function isLoggerInitialized(): boolean {
  return true; // errsole이 초기화되었으므로 항상 true
}

export function getLogLevel(): LogLevel {
  return loggerConfig.logLevel;
}

export function setLogLevel(level: LogLevel): void {
  // 동적 로그 레벨 변경 (개발 중에만 사용)
  if (isDevelopment()) {
    console.log(`🔧 로그 레벨 변경: ${loggerConfig.logLevel} -> ${level}`);
    loggerConfig.logLevel = level;
  }
}

export function formatLogMessage(level: LogLevel, message: string, meta?: LogMeta): string {
  const timestamp = new Date().toISOString();
  const metaString = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaString}`;
}

export function createChildLogger(defaultMeta: LogMeta): BotLogger {
  return {
    debug: (message: string, meta: LogMeta = {}) =>
      logger.debug(message, { ...defaultMeta, ...meta }),
    info: (message: string, meta: LogMeta = {}) =>
      logger.info(message, { ...defaultMeta, ...meta }),
    warn: (message: string, meta: LogMeta = {}) =>
      logger.warn(message, { ...defaultMeta, ...meta }),
    error: (message: string, meta: LogMeta = {}) =>
      logger.error(message, { ...defaultMeta, ...meta }),
    alert: (message: string, meta: LogMeta = {}) =>
      logger.alert(message, { ...defaultMeta, ...meta }),
    botActivity: (message: string, meta: LogMeta = {}) =>
      logger.botActivity(message, { ...defaultMeta, ...meta }),
    voiceActivity: (message: string, meta: LogMeta = {}) =>
      logger.voiceActivity(message, { ...defaultMeta, ...meta }),
    commandExecution: (message: string, meta: LogMeta = {}) =>
      logger.commandExecution(message, { ...defaultMeta, ...meta }),
    databaseOperation: (message: string, meta: LogMeta = {}) =>
      logger.databaseOperation(message, { ...defaultMeta, ...meta }),
    discordEvent: (message: string, meta: LogMeta = {}) =>
      logger.discordEvent(message, { ...defaultMeta, ...meta }),
    discordRateLimit: (message: string, meta: LogMeta = {}) =>
      logger.discordRateLimit(message, { ...defaultMeta, ...meta }),
    discordPerformance: (message: string, meta: LogMeta = {}) =>
      logger.discordPerformance(message, { ...defaultMeta, ...meta }),
    withMeta: (meta: LogMeta) => logger.withMeta({ ...defaultMeta, ...meta }),
  };
}
