// src/config/logger-termux.js - Termux 환경용 Errsole 설정 (SQLite 사용)
import errsole from 'errsole';
import ErrsoleSQLite from 'errsole-sqlite';
import axios from 'axios';
import path from 'path';

// 환경별 설정
const isDevelopment = process.env.NODE_ENV !== 'production';
const errsoleHost = process.env.ERRSOLE_HOST || '0.0.0.0'; // 외부 접근 허용
const errsolePort = process.env.ERRSOLE_PORT || 8002;

if (isDevelopment) {
  // 개발 환경: SQLite를 사용한 로컬 로그 저장
  const logsFile = path.join(process.cwd(), 'logs', 'discord-bot-dev.log.sqlite');
  
  errsole.initialize({
    storage: new ErrsoleSQLite(logsFile),
    appName: 'discord-bot',
    environmentName: process.env.NODE_ENV || 'development',
    
    // 웹 대시보드 설정 (외부 접속 지원)
    host: errsoleHost,
    port: errsolePort,
    
    // 로그 레벨 설정
    logLevel: 'debug', // debug, info, warn, error, alert
    
    // 로그 보관 기간 (6개월 = 180일)
    retentionDays: 180,
    
    // 에러 알림 설정 (개발 환경에서는 비활성화)
    enableAlerts: false
  });
  
  console.log(`✅ Errsole 개발 환경 설정 완료 (Termux)`);
  console.log(`📊 대시보드 (${errsoleHost}): http://${errsoleHost === '0.0.0.0' ? '핸드폰IP' : errsoleHost}:${errsolePort}`);
  console.log(`💾 로그 파일: ${logsFile}`);
  
  // 환경변수 검증 로그
  console.log(`🔍 환경변수 검증:`);
  console.log(`   - NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   - ERRSOLE_HOST: ${errsoleHost}`);
  console.log(`   - ERRSOLE_PORT: ${errsolePort}`);
  console.log(`   - ENABLE_SLACK_ALERTS: ${process.env.ENABLE_SLACK_ALERTS || 'false'}`);
  console.log(`   - SLACK_WEBHOOK_URL: ${process.env.SLACK_WEBHOOK_URL ? '설정됨' : '기본값 사용'}`);
  console.log(`   - SLACK_CHANNEL: ${process.env.SLACK_CHANNEL || '#discord-bot-alerts'}`);
  
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
    enableAlerts: true
  });
  
  console.log(`✅ Errsole 운영 환경 설정 완료`);
  console.log(`📊 대시보드: http://${errsoleHost === '0.0.0.0' ? '핸드폰IP' : errsoleHost}:${errsolePort}`);
  console.log(`💾 로그 파일: ${logsFile}`);
  
  // 환경변수 검증 로그
  console.log(`🔍 환경변수 검증:`);
  console.log(`   - NODE_ENV: ${process.env.NODE_ENV || 'production'}`);
  console.log(`   - ERRSOLE_HOST: ${errsoleHost}`);
  console.log(`   - ERRSOLE_PORT: ${errsolePort}`);
  console.log(`   - ENABLE_SLACK_ALERTS: ${process.env.ENABLE_SLACK_ALERTS || 'false'}`);
  console.log(`   - SLACK_WEBHOOK_URL: ${process.env.SLACK_WEBHOOK_URL ? '설정됨' : '기본값 사용'}`);
  console.log(`   - SLACK_CHANNEL: ${process.env.SLACK_CHANNEL || '#discord-bot-alerts'}`);
  console.log(`   - SLACK_MIN_LEVEL: ${process.env.SLACK_MIN_LEVEL || 'error'}`);
  
  if (process.env.ENABLE_SLACK_ALERTS === 'true') {
    console.log(`🔔 Slack 알림 활성화: ${process.env.SLACK_CHANNEL || '#discord-bot-alerts'}`);
  } else {
    console.log(`🔕 Slack 알림 비활성화`);
  }
}

if (errsoleHost === '0.0.0.0') {
  console.log(`🌐 외부 접속 모드 활성화 - 같은 네트워크의 다른 기기에서 접속 가능`);
  console.log(`💻 컴퓨터에서 접속하려면: 핸드폰 IP 확인 후 http://핸드폰IP:${errsolePort}`);
}

// 전역 에러 핸들러 설정
process.on('uncaughtException', (error) => {
  errsole.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  errsole.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Slack 알림 함수
async function sendSlackAlert(level, message, meta = {}) {
  // 개발 환경이거나 Slack 알림이 비활성화된 경우 건너뛰기
  if (isDevelopment || process.env.ENABLE_SLACK_ALERTS !== 'true') {
    return;
  }
  
  // 최소 알림 레벨 체크
  const minLevel = process.env.SLACK_MIN_LEVEL || 'error';
  const levelPriority = { debug: 0, info: 1, warn: 2, error: 3, alert: 4 };
  
  if (levelPriority[level] < levelPriority[minLevel]) {
    return;
  }
  
  try {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      console.error('SLACK_WEBHOOK_URL이 설정되지 않았습니다.[logger-termux.js]');
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
      channel: process.env.SLACK_CHANNEL || '#discord-bot-alerts',
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
              value: `http://${errsoleHost === '0.0.0.0' ? '핸드폰IP' : errsoleHost}:${errsolePort}`,
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
    errsole.meta({ type: 'database_operation', ...meta }).debug(message);
  },
  
  discordEvent: (message, meta = {}) => {
    errsole.meta({ type: 'discord_event', ...meta }).debug(message);
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

export default errsole;