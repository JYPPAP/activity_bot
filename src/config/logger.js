// src/config/logger.js - Errsole 설정 파일 (ES Modules)
import errsole from 'errsole';
import ErrsoleSQLite from 'errsole-sqlite';
import os from 'os';
import path from 'path';

// 환경별 설정
const isDevelopment = process.env.NODE_ENV !== 'production';

if (isDevelopment) {
  // 개발 환경: SQLite를 사용한 로컬 로그 저장
  const logsFile = path.join(os.tmpdir(), 'discord-bot.log.sqlite');
  
  errsole.initialize({
    storage: new ErrsoleSQLite(logsFile),
    appName: 'discord-bot',
    environmentName: process.env.NODE_ENV || 'development',
    
    // 웹 대시보드 설정
    port: process.env.ERRSOLE_PORT || 8001,
    
    // 로그 레벨 설정
    logLevel: 'debug', // debug, info, warn, error, alert
    
    // 로그 보관 기간 (6개월 = 180일)
    retentionDays: 180,
    
    // 에러 알림 설정 (개발 환경에서는 비활성화)
    enableAlerts: false
  });
  
  console.log(`✅ Errsole 개발 환경 설정 완료`);
  console.log(`📊 대시보드: http://localhost:${process.env.ERRSOLE_PORT || 8001}`);
  console.log(`💾 로그 파일: ${logsFile}`);
  
} else {
  // 운영 환경 설정 (Phase 2에서 확장 예정)
  console.log('🚧 운영 환경 설정이 필요합니다 (Phase 2)');
  
  // 임시로 SQLite 사용
  const logsFile = path.join(process.cwd(), 'logs', 'discord-bot-prod.log.sqlite');
  
  errsole.initialize({
    storage: new ErrsoleSQLite(logsFile),
    appName: 'discord-bot',
    environmentName: 'production',
    port: process.env.ERRSOLE_PORT || 8001,
    logLevel: 'info',
    retentionDays: 180,
    enableAlerts: true
  });
}

// 전역 에러 핸들러 설정
process.on('uncaughtException', (error) => {
  errsole.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  errsole.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Discord Bot 전용 로깅 함수들
export const logger = {
  // 기본 로그 레벨
  debug: (message, meta = {}) => errsole.debug(message, meta),
  info: (message, meta = {}) => errsole.info(message, meta),
  warn: (message, meta = {}) => errsole.warn(message, meta),
  error: (message, meta = {}) => errsole.error(message, meta),
  alert: (message, meta = {}) => errsole.alert(message, meta),
  
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