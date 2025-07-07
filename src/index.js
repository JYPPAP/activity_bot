// src/index.js - 애플리케이션 진입점

// ⚠️ 중요: Errsole은 반드시 첫 번째 줄에 임포트해야 함
import './config/logger.js';
import { logger } from './config/logger.js';

import {Bot} from './bot.js';
import {config} from './config/env.js';
import {keepAlive} from '../server.js';

// 비동기 즉시 실행 함수 (IIFE)로 애플리케이션 시작
(async () => {
  try {
    logger.info('Discord Bot 시작 프로세스 시작', {
      timestamp: new Date().toISOString(),
      nodeEnv: process.env.NODE_ENV || 'development'
    });

    // 봇 인스턴스 생성 및 초기화
    const bot = new Bot(config.TOKEN);
    await bot.initialize();

    // 서버 실행하여 봇 활성 상태 유지
    keepAlive();

    // 봇 로그인
    await bot.login();

    const startTime = new Date().toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'});
    logger.botActivity(`봇이 켜졌습니다: ${startTime}`, {
      startTime,
      timezone: 'Asia/Seoul',
      guildId: config.GUILDID
    });

  } catch (error) {
    logger.error('봇 실행 중 오류 발생:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    // 치명적인 에러이므로 프로세스 종료
    process.exit(1);
  }
})();