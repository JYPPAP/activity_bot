// src/index.js - 애플리케이션 진입점
import { Bot } from './src/bot.js';
import { config } from './src/config/env.js';
import { keepAlive } from './server.js';

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

    console.log(`봇이 켜졌습니다: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  } catch (error) {
    console.error('봇 실행 중 오류 발생:', error);
  }
})();