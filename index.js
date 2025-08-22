// src/index.js - 애플리케이션 진입점
import { Bot } from './src/bot.js';
import { config } from './src/config/env.js';
import { keepAlive } from './server.js';
import { logger } from './src/config/logger-termux.js';

// ---- Lifecycle & crash diagnostics (must be before the IIFE) ----
process.on('beforeExit', (code) => {
  console.error('[LIFECYCLE] beforeExit', { code, ts: new Date().toISOString() });
});

process.on('exit', (code) => {
  console.error('[LIFECYCLE] exit', { code, ts: new Date().toISOString() });
});

process.on('SIGINT', () => {
  console.error('[LIFECYCLE] SIGINT');
  // PM2가 graceful하게 죽도록 약간의 시간 제공
  setTimeout(() => process.exit(0), 200);
});

process.on('SIGTERM', () => {
  console.error('[LIFECYCLE] SIGTERM');
  setTimeout(() => process.exit(0), 200);
});

// 치명적 오류 로깅
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException', { message: err?.message, stack: err?.stack });
  // 로그가 디스크/전송으로 flush될 시간 확보
  setTimeout(() => process.exit(1), 300);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection', { reason: String(reason) });
  setTimeout(() => process.exit(1), 300);
});

// 이벤트 루프이 유휴 상태로 빠지며 프로세스가 조용히 끝나는지 탐지용 하트비트
setInterval(() => {
  // no-op
}, 10_000);
// ---------------------------------------------------------------


// 비동기 즉시 실행 함수 (IIFE)로 애플리케이션 시작
(async () => {
  try {
    // 봇 인스턴스 생성 및 초기화
    const bot = new Bot(config.TOKEN);
    await bot.initialize();

    // 서버 실행하여 봇 활성 상태 유지
    keepAlive();

    // 봇 로그인
    await bot.login();

    // Terminal output - bot status only
    console.log(`✅ Discord Bot 시작 완료: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
    logger.botActivity('Discord Bot 초기화 및 로그인 완료', { timestamp: new Date().toISOString(), environment: config.NODE_ENV });
  } catch (error) {
    // Terminal output - critical startup errors only
    console.error(`❌ 봇 시작 실패: ${error.message}`);
    logger.error('봇 실행 중 치명적 오류 발생', { error: error.message, stack: error.stack, timestamp: new Date().toISOString() });
    setTimeout(() => process.exit(1), 300); // flush time
  }
})();