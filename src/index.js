// src/index.js - 애플리케이션 진입점

// ⚠️ 중요: 환경변수를 먼저 로드 후 logger 임포트
import {config} from './config/env.js';
import './config/logger-termux.js';
import { logger } from './config/logger-termux.js';

import {Bot} from './bot.js';
import {keepAlive} from '../server.js';

// 전역 봇 인스턴스 저장
let botInstance = null;

// 정상 종료 처리 함수
async function gracefulShutdown(signal) {
  logger.info(`${signal} 신호를 받았습니다. 정상 종료를 시작합니다.`, {
    signal,
    timestamp: new Date().toISOString()
  });

  try {
    if (botInstance) {
      await botInstance.shutdown();
    }
    logger.info('정상 종료 완료');
    process.exit(0);
  } catch (error) {
    logger.error('정상 종료 중 오류 발생', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// 종료 신호 핸들러 등록
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 비동기 즉시 실행 함수 (IIFE)로 애플리케이션 시작
(async () => {
  try {
    logger.info('Discord Bot 시작 프로세스 시작', {
      timestamp: new Date().toISOString(),
      nodeEnv: process.env.NODE_ENV || 'development',
      platform: 'Termux Android'
    });

    // 봇 인스턴스 생성 및 초기화
    botInstance = new Bot(config.TOKEN);
    await botInstance.initialize();

    // 서버 실행하여 봇 활성 상태 유지
    keepAlive();

    // 봇 로그인
    await botInstance.login();

    const startTime = new Date().toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'});
    logger.botActivity(`봇이 켜졌습니다: ${startTime}`, {
      startTime,
      timezone: 'Asia/Seoul',
      guildId: config.GUILDID,
      platform: 'Termux Android'
    });

  } catch (error) {
    logger.error('봇 실행 중 오류 발생:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      platform: 'Termux Android'
    });
    
    // 치명적인 에러이므로 프로세스 종료
    process.exit(1);
  }
})();