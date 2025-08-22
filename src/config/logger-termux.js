// src/config/logger-termux.js - Termux 환경용 Errsole 설정 (SQLite 사용)
import errsole from 'errsole';
import ErrsoleSQLite from 'errsole-sqlite';
import axios from 'axios';
import path from 'path';
import { config } from './env.js';
import sqlite3 from 'sqlite3';

// 환경별 설정
const isDevelopment = config.NODE_ENV !== 'production';
const errsoleHost = config.ERRSOLE_HOST || '0.0.0.0'; // 외부 접근 허용
const errsolePort = config.ERRSOLE_PORT || 8002;

// SQLite 데이터베이스 최적화 함수
async function optimizeSQLiteDatabase(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('❌ SQLite 데이터베이스 연결 실패:', err.message);
        reject(err);
        return;
      }

      console.log('🔧 Errsole 로깅 시스템 (SQLite) 최적화 시작...');
      
      // WAL 모드 활성화 및 최적화 설정
      db.serialize(() => {
        // WAL 모드 활성화 (동시 읽기/쓰기 성능 향상)
        db.run('PRAGMA journal_mode = WAL;', (err) => {
          if (err) console.error('❌ WAL 모드 설정 실패:', err.message);
          else console.log('✅ WAL 모드 활성화 완료');
        });

        // Synchronous 모드 실시간성 우선 설정 (로그 지연 최소화)
        db.run('PRAGMA synchronous = FULL;', (err) => {
          if (err) console.error('❌ Synchronous 모드 설정 실패:', err.message);
          else console.log('✅ Synchronous 모드 FULL 설정 완료 (실시간성 우선)');
        });

        // 타임아웃 설정 (10초)
        db.run('PRAGMA busy_timeout = 10000;', (err) => {
          if (err) console.error('❌ Timeout 설정 실패:', err.message);
          else console.log('✅ Busy timeout 10초 설정 완료');
        });

        // 캐시 크기 최적화 (Termux 환경에 맞게 조정)
        db.run('PRAGMA cache_size = -64000;', (err) => {
          if (err) console.error('❌ Cache 크기 설정 실패:', err.message);
          else console.log('✅ Cache 크기 64MB 설정 완료');
        });

        // WAL 자동 체크포인트 설정 (100 페이지마다 - 실시간성 우선)
        db.run('PRAGMA wal_autocheckpoint = 100;', (err) => {
          if (err) console.error('❌ WAL 체크포인트 설정 실패:', err.message);
          else console.log('✅ WAL 자동 체크포인트 100페이지 설정 완료 (실시간성 우선)');
        });
      });

      db.close((err) => {
        if (err) {
          console.error('❌ SQLite 데이터베이스 닫기 실패:', err.message);
          reject(err);
        } else {
          console.log('✅ Errsole 로깅 시스템 (SQLite) 최적화 완료');
          resolve();
        }
      });
    });
  });
}

if (isDevelopment) {
  // 개발 환경: SQLite를 사용한 로컬 로그 저장
  const logsFile = path.join(process.cwd(), 'logs', 'discord-bot-dev.log.sqlite');
  
  errsole.initialize({
    storage: new ErrsoleSQLite(logsFile),
    appName: 'discord-bot',
    environmentName: config.NODE_ENV || 'development',
    
    // 웹 대시보드 설정 (외부 접속 지원)
    host: errsoleHost,
    port: errsolePort,
    
    // 로그 레벨 설정
    logLevel: 'info', // 실시간성을 위해 debug → info로 변경
    
    // 로그 보관 기간 (6개월 = 180일)
    retentionDays: 180,
    
    // 에러 알림 설정 (개발 환경에서는 비활성화)
    enableAlerts: false,
    
    // 실시간성 설정 추가
    flushInterval: 1000,    // 1초마다 강제 플러시
    maxBufferSize: 10,      // 버퍼 크기 최소화 (10개 로그마다 즉시 전송)
    enableRealTime: true,   // 실시간 모드 활성화
    collectLogs: true,      // 로그 수집 활성화
    enableConsoleOutput: true  // 콘솔 출력도 유지
  });
  
  console.log(`✅ Errsole 개발 환경 설정 완료 (Termux)`);
  console.log(`📊 대시보드 (${errsoleHost}): http://${errsoleHost === '0.0.0.0' ? '핸드폰IP' : errsoleHost}:${errsolePort}`);
  console.log(`💾 로그 파일: ${logsFile}`);
  
  // SQLite 최적화 실행
  optimizeSQLiteDatabase(logsFile).catch(err => {
    console.error('⚠️ SQLite 최적화 중 오류 발생:', err.message);
  });
  
  // 환경변수 검증 로그
  console.log(`🔍 환경변수 검증:`);
  console.log(`   - NODE_ENV: ${config.NODE_ENV || 'development'}`);
  console.log(`   - ERRSOLE_HOST: ${errsoleHost}`);
  console.log(`   - ERRSOLE_PORT: ${errsolePort}`);
  console.log(`   - ENABLE_SLACK_ALERTS: ${config.ENABLE_SLACK_ALERTS || 'false'}`);
  console.log(`   - SLACK_WEBHOOK_URL: ${config.SLACK_WEBHOOK_URL ? '설정됨' : '미설정'}`);
  console.log(`   - SLACK_CHANNEL: ${config.SLACK_CHANNEL || '#discord-bot-alert'}`);
  
} else {
  // 운영 환경 설정 - Slack 알림 포함
  console.log('🚀 Errsole 운영 환경 설정 (Slack 알림 포함)');
  console.log('Note: Terminal output will be disabled after initial logs.');
  
  // SQLite 로그 파일 경로
  const logsFile = path.join(process.cwd(), 'logs', 'discord-bot-prod.log.sqlite');
  
  errsole.initialize({
    storage: new ErrsoleSQLite(logsFile),
    appName: 'discord-bot',
    environmentName: 'production',
    host: errsoleHost, // 외부 접근 허용
    port: errsolePort,
    logLevel: 'info',
    retentionDays: 180, // 6개월 보관
    enableAlerts: true,
    
    // 실시간성 설정 추가 (운영환경에서도 적용)
    flushInterval: 2000,    // 2초마다 강제 플러시 (운영환경은 약간 보수적)
    maxBufferSize: 20,      // 버퍼 크기 (20개 로그마다 전송)
    enableRealTime: true,   // 실시간 모드 활성화
    collectLogs: true,      // 로그 수집 활성화
    enableConsoleOutput: false  // 운영환경에서는 콘솔 출력 비활성화
  });
  
  console.log(`✅ Errsole 운영 환경 설정 완료`);
  console.log(`📊 대시보드: http://${errsoleHost === '0.0.0.0' ? '핸드폰IP' : errsoleHost}:${errsolePort}`);
  console.log(`💾 로그 파일: ${logsFile}`);
  
  // SQLite 최적화 실행
  optimizeSQLiteDatabase(logsFile).catch(err => {
    console.error('⚠️ SQLite 최적화 중 오류 발생:', err.message);
  });
  
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

if (errsoleHost === '0.0.0.0') {
  console.log(`🌐 외부 접속 모드 활성화 - 같은 네트워크의 다른 기기에서 접속 가능`);
  console.log(`💻 컴퓨터에서 접속하려면: 핸드폰 IP 확인 후 http://핸드폰IP:${errsolePort}`);
}

// 강화된 전역 에러 핸들러 설정
process.on('uncaughtException', (error) => {
  console.error('💥 치명적 오류 발생:', error.message);
  
  // SQLite 관련 에러 특별 처리
  if (error.message && (
    error.message.includes('database is locked') ||
    error.message.includes('SQLITE_BUSY') ||
    error.message.includes('SQLITE_LOCKED')
  )) {
    console.error('🔒 SQLite 데이터베이스 잠금 에러 감지 - 프로세스 재시작 권장');
    errsole.error('SQLite Database Lock Error - Process Restart Required', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      restartRecommended: true
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

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ 처리되지 않은 Promise 거부:', reason);
  
  // SQLite 관련 Promise 거부 특별 처리
  if (reason && reason.message && (
    reason.message.includes('database is locked') ||
    reason.message.includes('SQLITE_BUSY') ||
    reason.message.includes('SQLITE_LOCKED')
  )) {
    console.error('🔒 SQLite Promise 거부 - 데이터베이스 접근 재시도 필요');
    errsole.error('SQLite Promise Rejection - Database Access Retry Needed', {
      reason: reason.message,
      stack: reason.stack,
      timestamp: new Date().toISOString(),
      retryNeeded: true
    });
  } else {
    errsole.error('Unhandled Rejection at:', promise, 'reason:', reason);
  }
});

// 메모리 사용량 모니터링
process.on('warning', (warning) => {
  console.warn('⚠️ Node.js 경고:', warning.name, warning.message);
  
  if (warning.name === 'MaxListenersExceededWarning') {
    errsole.warn('Memory Leak Warning - Too Many Listeners', {
      warning: warning.message,
      stack: warning.stack,
      timestamp: new Date().toISOString()
    });
  }
});

// Slack 알림 함수
async function sendSlackAlert(level, message, meta = {}) {
  // 개발 환경이거나 Slack 알림이 비활성화된 경우 건너뛰기
  if (isDevelopment || config.ENABLE_SLACK_ALERTS !== 'true') {
    return;
  }
  
  // 최소 알림 레벨 체크
  const minLevel = config.SLACK_MIN_LEVEL || 'error';
  const levelPriority = { debug: 0, info: 1, warn: 2, error: 3, alert: 4 };
  
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
    const levelEmojis = {
      debug: '🔍',
      info: 'ℹ️',
      warn: '⚠️',
      error: '🚨',
      alert: '🔥'
    };
    
    // Slack 메시지 구성
    const slackMessage = {
      channel: config.SLACK_CHANNEL || '#discord-bot-alert',
      username: 'Discord Bot Alert (Termux)',
      text: `${levelEmojis[level]} **${level.toUpperCase()}**: ${message}`,
      attachments: [
        {
          color: level === 'error' || level === 'alert' ? 'danger' : level === 'warn' ? 'warning' : 'good',
          fields: [
            {
              title: 'App Name',
              value: 'discord-bot',
              short: true
            },
            {
              title: 'Environment',
              value: 'Termux (Android)',
              short: true
            },
            {
              title: 'Timestamp',
              value: new Date().toISOString(),
              short: true
            },
            {
              title: 'Dashboard',
              value: `http://${errsoleHost === '0.0.0.0' ? (config.PHONE_IP) : errsoleHost}:${errsolePort}`,
              short: true
            }
          ]
        }
      ]
    };
    
    // 메타데이터가 있으면 추가
    if (Object.keys(meta).length > 0) {
      slackMessage.attachments[0].fields.push({
        title: 'Metadata',
        value: '```' + JSON.stringify(meta, null, 2) + '```',
        short: false
      });
    }
    
    // Slack으로 전송
    await axios.post(webhookUrl, slackMessage);
    
  } catch (error) {
    console.error('Slack 알림 전송 실패:', error.message);
  }
}

// Discord Bot 전용 로깅 함수들
export const logger = {
  // 기본 로그 레벨 (Slack 알림 포함)
  debug: (message, meta = {}) => {
    errsole.debug(message, meta);
    sendSlackAlert('debug', message, meta);
  },
  info: (message, meta = {}) => {
    errsole.info(message, meta);
    sendSlackAlert('info', message, meta);
  },
  warn: (message, meta = {}) => {
    errsole.warn(message, meta);
    sendSlackAlert('warn', message, meta);
  },
  error: (message, meta = {}) => {
    errsole.error(message, meta);
    sendSlackAlert('error', message, meta);
  },
  alert: (message, meta = {}) => {
    errsole.alert(message, meta);
    sendSlackAlert('alert', message, meta);
  },
  
  // Discord Bot 전용 로깅 함수
  botActivity: (message, meta = {}) => {
    errsole.meta({ type: 'bot_activity', ...meta }).info(message);
  },
  
  voiceActivity: (message, meta = {}) => {
    errsole.meta({ type: 'voice_activity', ...meta }).info(message);
  },
  
  commandExecution: (message, meta = {}) => {
    errsole.meta({ type: 'command_execution', ...meta }).info(message);
  },
  
  databaseOperation: (message, meta = {}) => {
    errsole.meta({ type: 'database_operation', ...meta }).info(message);
  },
  
  discordEvent: (message, meta = {}) => {
    errsole.meta({ type: 'discord_event', ...meta }).info(message);
  },
  
  // 메타데이터와 함께 로깅하는 헬퍼 함수
  withMeta: (meta) => ({
    debug: (message) => errsole.meta(meta).debug(message),
    info: (message) => errsole.meta(meta).info(message),
    warn: (message) => errsole.meta(meta).warn(message),
    error: (message) => errsole.meta(meta).error(message),
    alert: (message) => errsole.meta(meta).alert(message)
  })
};

// 헬스체크 및 모니터링 시스템
let healthCheckInterval;
let logDelayMonitorInterval;
let lastMemoryUsage = process.memoryUsage();

// 로그 지연 모니터링 시스템
let logDelayMetrics = {
  samples: [],
  maxSamples: 50, // 최근 50개 샘플 유지
  lastReportTime: Date.now()
};

// 로그 지연 추적 함수
function trackLogDelay(originalTimestamp) {
  const currentTime = Date.now();
  const delay = currentTime - originalTimestamp;
  
  // 샘플 추가
  logDelayMetrics.samples.push({
    originalTime: originalTimestamp,
    recordedTime: currentTime,
    delay: delay,
    timestamp: new Date(originalTimestamp).toISOString()
  });
  
  // 최대 샘플 수 유지
  if (logDelayMetrics.samples.length > logDelayMetrics.maxSamples) {
    logDelayMetrics.samples.shift();
  }
}

// 로그 지연 통계 계산
function calculateDelayStats() {
  if (logDelayMetrics.samples.length === 0) {
    return null;
  }
  
  const delays = logDelayMetrics.samples.map(s => s.delay);
  const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
  const maxDelay = Math.max(...delays);
  const minDelay = Math.min(...delays);
  
  return {
    samples: delays.length,
    avgDelayMs: Math.round(avgDelay),
    maxDelayMs: maxDelay,
    minDelayMs: minDelay,
    avgDelayMinutes: Math.round(avgDelay / 60000 * 10) / 10,
    maxDelayMinutes: Math.round(maxDelay / 60000 * 10) / 10
  };
}

// 로그 지연 모니터링 시작
function startLogDelayMonitoring() {
  console.log('⏱️ 로그 지연 모니터링 시작 (2분 간격)');
  
  logDelayMonitorInterval = setInterval(async () => {
    try {
      // 테스트 로그로 지연 시간 측정
      const testLogTime = Date.now();
      trackLogDelay(testLogTime);
      
      // 10분마다 통계 보고
      const now = Date.now();
      if (now - logDelayMetrics.lastReportTime >= 10 * 60 * 1000) {
        const stats = calculateDelayStats();
        
        if (stats) {
          console.log(`📊 로그 지연 통계 보고:`);
          console.log(`   - 평균 지연: ${stats.avgDelayMinutes}분 (${stats.avgDelayMs}ms)`);
          console.log(`   - 최대 지연: ${stats.maxDelayMinutes}분 (${stats.maxDelayMs}ms)`);
          console.log(`   - 샘플 수: ${stats.samples}개`);
          
          // 지연이 5분 이상인 경우 경고
          if (stats.avgDelayMs > 5 * 60 * 1000) {
            console.warn(`⚠️ 로그 지연 경고: 평균 ${stats.avgDelayMinutes}분 지연 감지`);
            logger.warn('[LogDelayMonitor] 로그 지연 경고', {
              ...stats,
              recommendation: 'SQLite 최적화 설정 점검 필요'
            });
          } else if (stats.avgDelayMs > 30 * 1000) {
            console.info(`ℹ️ 로그 지연 정보: 평균 ${Math.round(stats.avgDelayMs/1000)}초 지연`);
          }
          
          // Errsole로 통계 전송
          logger.info('[LogDelayMonitor] 로그 지연 통계', stats);
        }
        
        logDelayMetrics.lastReportTime = now;
      }
      
    } catch (error) {
      console.error('[LogDelayMonitor] 로그 지연 모니터링 중 오류:', error.message);
    }
  }, 2 * 60 * 1000); // 2분마다 실행
}

function startHealthMonitoring() {
  console.log('🏥 헬스체크 모니터링 시작 (5분 간격)');
  
  healthCheckInterval = setInterval(async () => {
    try {
      const currentMemory = process.memoryUsage();
      const uptime = process.uptime();
      
      // 메모리 사용량 변화 계산
      const memoryDiff = {
        rss: currentMemory.rss - lastMemoryUsage.rss,
        heapUsed: currentMemory.heapUsed - lastMemoryUsage.heapUsed,
        heapTotal: currentMemory.heapTotal - lastMemoryUsage.heapTotal
      };
      
      // MB 단위로 변환
      const memoryMB = {
        rss: Math.round(currentMemory.rss / 1024 / 1024),
        heapUsed: Math.round(currentMemory.heapUsed / 1024 / 1024),
        heapTotal: Math.round(currentMemory.heapTotal / 1024 / 1024),
        external: Math.round(currentMemory.external / 1024 / 1024)
      };
      
      // 헬스체크 로그
      logger.info(`[HealthCheck] 시스템 상태 체크`, {
        uptime: `${Math.round(uptime / 60)}분`,
        memory: memoryMB,
        memoryDiff: {
          rss: Math.round(memoryDiff.rss / 1024 / 1024),
          heapUsed: Math.round(memoryDiff.heapUsed / 1024 / 1024)
        },
        timestamp: new Date().toISOString()
      });
      
      // 메모리 누수 경고 (RSS가 200MB 이상 증가했을 때)
      if (memoryDiff.rss > 200 * 1024 * 1024) {
        logger.warn(`[HealthCheck] 메모리 사용량 급증 감지`, {
          memoryIncrease: `${Math.round(memoryDiff.rss / 1024 / 1024)}MB`,
          currentMemory: memoryMB,
          recommendation: 'PM2 재시작 권장'
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
        error: error.message,
        stack: error.stack
      });
    }
  }, 5 * 60 * 1000); // 5분마다 실행
}

// 애플리케이션 시작 시 헬스체크 및 로그 지연 모니터링 시작
setTimeout(() => {
  startHealthMonitoring();
  startLogDelayMonitoring();
}, 10000); // 10초 후 시작

// 프로세스 종료 시 정리
process.on('SIGINT', () => {
  console.log('🔄 프로세스 종료 시그널 감지 - 정리 작업 시작');
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    console.log('✅ 헬스체크 모니터링 중지');
  }
  if (logDelayMonitorInterval) {
    clearInterval(logDelayMonitorInterval);
    console.log('✅ 로그 지연 모니터링 중지');
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🔄 프로세스 종료 시그널 감지 - 정리 작업 시작');
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    console.log('✅ 헬스체크 모니터링 중지');
  }
  if (logDelayMonitorInterval) {
    clearInterval(logDelayMonitorInterval);
    console.log('✅ 로그 지연 모니터링 중지');
  }
  process.exit(0);
});

export default errsole;