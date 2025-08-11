// src/index.js - 애플리케이션 진입점
import { Bot } from './src/bot.js';
import { config } from './src/config/env.js';
import { keepAlive } from './server.js';
import { logger } from './src/config/logger-termux.js';

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
    process.exit(1);
  }
})();