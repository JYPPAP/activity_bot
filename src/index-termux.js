// src/index-termux.js - Termux 환경용 애플리케이션 진입점

// ⚠️ 중요: Termux용 logger를 먼저 임포트
import './config/logger-termux.js';
import { logger } from './config/logger-termux.js';

import {Bot} from './bot.js';
import {config} from './config/env.js';
import {keepAlive} from '../server.js';

// 비동기 즉시 실행 함수 (IIFE)로 애플리케이션 시작
(async () => {
  try {
    logger.info('Discord Bot 시작 프로세스 시작 (Termux 환경)', {
      timestamp: new Date().toISOString(),
      nodeEnv: process.env.NODE_ENV || 'development',
      platform: 'Termux Android'
    });

    // 봇 인스턴스 생성 및 초기화
    const bot = new Bot(config.TOKEN);
    await bot.initialize();

    // 서버 실행하여 봇 활성 상태 유지
    keepAlive();

    // 봇 로그인
    await bot.login();

    const startTime = new Date().toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'});
    logger.botActivity(`Termux 환경에서 봇이 켜졌습니다: ${startTime}`, {
      startTime,
      timezone: 'Asia/Seoul',
      guildId: config.GUILDID,
      platform: 'Termux Android'
    });

  } catch (error) {
    logger.error('봇 실행 중 오류 발생 (Termux)', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      platform: 'Termux Android'
    });
    
    // 치명적인 에러이므로 프로세스 종료
    process.exit(1);
  }
})();