// src/index.ts - 애플리케이션 진입점
import process from 'process';

// ⚠️ 중요: 환경변수를 먼저 로드 후 logger 임포트
import { config } from './config/env.js';
import './config/logger-termux.js';
import { logger } from './config/logger-termux.js';

import { Bot } from './bot.js';
import { keepAlive } from '../server.js';

// 프로세스 정보 인터페이스
interface ProcessInfo {
  nodeVersion: string;
  platform: string;
  architecture: string;
  pid: number;
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
}

// 시작 통계 인터페이스
interface StartupStats {
  startTime: Date;
  initializationTime: number;
  loginTime: number;
  totalStartupTime: number;
}

// 전역 에러 처리
process.on('uncaughtException', (error: Error) => {
  logger.error('처리되지 않은 예외 발생:', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
    type: 'uncaughtException'
  });
  
  // 치명적인 오류이므로 안전하게 종료
  process.exit(1);
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('처리되지 않은 Promise 거부:', {
    reason: reason?.message || reason,
    stack: reason?.stack,
    promise: promise.toString(),
    timestamp: new Date().toISOString(),
    type: 'unhandledRejection'
  });
  
  // Promise 거부는 종료하지 않고 로그만 기록
});

// 시스템 신호 처리
process.on('SIGINT', async () => {
  logger.info('SIGINT 신호 수신 - 봇 종료 시작');
  await gracefulShutdown();
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM 신호 수신 - 봇 종료 시작');
  await gracefulShutdown();
});

/**
 * 프로세스 정보 수집
 * @returns 프로세스 정보
 */
function getProcessInfo(): ProcessInfo {
  return {
    nodeVersion: process.version,
    platform: `${process.platform} ${process.arch}`,
    architecture: process.arch,
    pid: process.pid,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage()
  };
}

/**
 * 메모리 사용량을 MB 단위로 포맷
 * @param bytes - 바이트 단위 메모리 사용량
 * @returns MB 단위 문자열
 */
function formatMemoryUsage(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024 * 100) / 100} MB`;
}

/**
 * 시작 정보 로깅
 * @param processInfo - 프로세스 정보
 */
function logStartupInfo(processInfo: ProcessInfo): void {
  logger.info('Discord Bot 시작 프로세스 시작', {
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV || 'development',
    platform: 'Termux Android',
    processInfo: {
      nodeVersion: processInfo.nodeVersion,
      platform: processInfo.platform,
      pid: processInfo.pid,
      memoryUsage: {
        rss: formatMemoryUsage(processInfo.memoryUsage.rss),
        heapTotal: formatMemoryUsage(processInfo.memoryUsage.heapTotal),
        heapUsed: formatMemoryUsage(processInfo.memoryUsage.heapUsed),
        external: formatMemoryUsage(processInfo.memoryUsage.external)
      }
    },
    config: {
      guildId: config.GUILDID,
      logChannelId: config.LOG_CHANNEL_ID,
      forumChannelId: config.FORUM_CHANNEL_ID,
      voiceCategoryId: config.VOICE_CATEGORY_ID
    }
  });
}

/**
 * 메모리 사용량 모니터링 시작
 */
function startMemoryMonitoring(): void {
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    
    // 메모리 사용량이 높으면 경고
    if (heapUsedMB > 200) {
      logger.warn('높은 메모리 사용량 감지', {
        heapUsed: formatMemoryUsage(memUsage.heapUsed),
        heapTotal: formatMemoryUsage(memUsage.heapTotal),
        rss: formatMemoryUsage(memUsage.rss),
        external: formatMemoryUsage(memUsage.external),
        timestamp: new Date().toISOString()
      });
    }
  }, 60000); // 1분마다 체크
}

/**
 * 안전한 종료 처리
 */
async function gracefulShutdown(): Promise<void> {
  try {
    logger.info('안전한 종료 프로세스 시작');
    
    const bot = Bot.getInstance();
    if (bot) {
      await bot.shutdown();
    }
    
    logger.info('봇이 안전하게 종료되었습니다');
    process.exit(0);
  } catch (error) {
    logger.error('종료 프로세스 중 오류 발생:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  }
}

/**
 * 시작 시간 측정 및 통계 수집
 * @param startTime - 시작 시간
 * @param initTime - 초기화 완료 시간
 * @param loginTime - 로그인 완료 시간
 * @returns 시작 통계
 */
function calculateStartupStats(startTime: Date, initTime: Date, loginTime: Date): StartupStats {
  const initializationTime = initTime.getTime() - startTime.getTime();
  const loginTimeMs = loginTime.getTime() - initTime.getTime();
  const totalStartupTime = loginTime.getTime() - startTime.getTime();

  return {
    startTime,
    initializationTime,
    loginTime: loginTimeMs,
    totalStartupTime
  };
}

/**
 * 환경 검증
 */
function validateEnvironment(): void {
  const requiredEnvVars = ['TOKEN', 'GUILDID', 'LOG_CHANNEL_ID'];
  const missingVars: string[] = [];

  for (const varName of requiredEnvVars) {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    logger.error('필수 환경 변수가 누락되었습니다:', {
      missingVariables: missingVars,
      availableVariables: Object.keys(process.env).filter(key => 
        key.startsWith('DISCORD_') || 
        key === 'TOKEN' || 
        key === 'GUILDID' || 
        key.includes('CHANNEL')
      )
    });
    throw new Error(`필수 환경 변수 누락: ${missingVars.join(', ')}`);
  }
}

/**
 * 애플리케이션 메인 함수
 */
async function main(): Promise<void> {
  const appStartTime = new Date();
  let bot: Bot | null = null;

  try {
    // 환경 검증
    validateEnvironment();

    // 프로세스 정보 수집 및 로깅
    const processInfo = getProcessInfo();
    logStartupInfo(processInfo);

    // 메모리 모니터링 시작
    startMemoryMonitoring();

    // 봇 인스턴스 생성
    logger.info('봇 인스턴스 생성 중...');
    bot = new Bot(config.TOKEN);

    // 봇 초기화
    logger.info('봇 초기화 중...');
    const initStartTime = new Date();
    await bot.initialize();
    const initEndTime = new Date();
    logger.info('봇 초기화 완료', {
      initializationTime: `${initEndTime.getTime() - initStartTime.getTime()}ms`
    });

    // 서버 실행하여 봇 활성 상태 유지
    logger.info('Keep-alive 서버 시작 중...');
    keepAlive();
    logger.info('Keep-alive 서버 시작 완료');

    // 봇 로그인
    logger.info('Discord에 로그인 중...');
    const loginStartTime = new Date();
    await bot.login();
    const loginEndTime = new Date();

    // 시작 통계 계산
    const startupStats = calculateStartupStats(appStartTime, initEndTime, loginEndTime);

    // 성공 로그
    const startTimeKST = startupStats.startTime.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    logger.botActivity(`봇이 성공적으로 시작되었습니다: ${startTimeKST}`, {
      startTime: startTimeKST,
      timezone: 'Asia/Seoul',
      guildId: config.GUILDID,
      platform: 'Termux Android',
      startupStats: {
        initializationTime: `${startupStats.initializationTime}ms`,
        loginTime: `${startupStats.loginTime}ms`,
        totalStartupTime: `${startupStats.totalStartupTime}ms`
      },
      memoryUsage: {
        heapUsed: formatMemoryUsage(process.memoryUsage().heapUsed),
        rss: formatMemoryUsage(process.memoryUsage().rss)
      }
    });

    // 정상 시작 완료
    logger.info('🚀 Discord Bot이 정상적으로 실행되었습니다!', {
      uptime: `${Math.round(process.uptime())}초`,
      memoryUsage: formatMemoryUsage(process.memoryUsage().heapUsed)
    });

  } catch (error) {
    const errorDetails = {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
      platform: 'Termux Android',
      startupTime: Date.now() - appStartTime.getTime(),
      processInfo: getProcessInfo()
    };

    logger.error('봇 실행 중 치명적인 오류 발생:', errorDetails);

    // 봇이 생성되었다면 안전하게 종료 시도
    if (bot) {
      try {
        await bot.shutdown();
      } catch (shutdownError) {
        logger.error('봇 종료 중 추가 오류:', {
          shutdownError: shutdownError instanceof Error ? shutdownError.message : String(shutdownError)
        });
      }
    }
    
    // 치명적인 에러이므로 프로세스 종료
    process.exit(1);
  }
}

// 비동기 즉시 실행 함수 (IIFE)로 애플리케이션 시작
(async (): Promise<void> => {
  await main();
})().catch((error: Error) => {
  // 최종 안전망: main 함수에서도 처리되지 않은 에러
  console.error('애플리케이션 시작 중 예상치 못한 오류:', error);
  process.exit(1);
});

// 모듈 내보내기 (테스트 용도)
export { main, getProcessInfo, formatMemoryUsage, validateEnvironment };