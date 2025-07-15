// src/di/container.ts - DI Container 설정

import { container } from 'tsyringe';
import { Client } from 'discord.js';

// 서비스 클래스 임포트
import { SQLiteManager } from '../services/SQLiteManager.js';
import { LogService } from '../services/logService.js';
import { ActivityTracker } from '../services/activityTracker.js';
import { CalendarLogService } from '../services/calendarLogService.js';
import { CommandHandler } from '../commands/commandHandler.js';
import { PerformanceMonitoringService } from '../services/PerformanceMonitoringService.js';
import { PrometheusMetricsService } from '../services/PrometheusMetricsService.js';
import { RedisService } from '../services/RedisService.js';

// 인터페이스 및 토큰 임포트
import { DI_TOKENS } from '../interfaces/index.js';

// 설정 임포트
import { config } from '../config/env.js';
import type { LogServiceOptions } from '../services/logService.js';
import type { RedisConfig } from '../interfaces/IRedisService.js';

/**
 * DI Container 설정 및 서비스 바인딩
 */
export function configureDIContainer(): void {
  // 이미 등록된 항목들을 정리
  container.clearInstances();

  // Discord Client 등록 (외부에서 주입받아야 함)
  // 이는 Bot 클래스에서 등록될 예정

  // 설정 객체들 등록
  const logServiceConfig: LogServiceOptions = {
    logChannelId: config.LOG_CHANNEL_ID,
    batchSize: 10,
    logDelay: 5000,
    maxRetries: 3,
    enableFileLogging: true,
    enableConsoleLogging: true,
    includeMetadata: true,
  };
  
  const redisConfig: RedisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
    db: parseInt(process.env.REDIS_DB || '0'),
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: 10000,
    commandTimeout: 5000,
    family: 4,
    keepAlive: 30000,
    keyPrefix: 'discord_bot:',
  };
  
  container.registerInstance(DI_TOKENS.LogServiceConfig, logServiceConfig);
  container.registerInstance(DI_TOKENS.RedisConfig, redisConfig);
  container.registerInstance(DI_TOKENS.BotConfig, config);

  // 핵심 서비스들을 싱글톤으로 등록 (concrete class 등록)
  container.registerSingleton(DI_TOKENS.IDatabaseManager, SQLiteManager);
  container.registerSingleton(DI_TOKENS.ILogService, LogService);
  container.registerSingleton(DI_TOKENS.IActivityTracker, ActivityTracker);
  container.registerSingleton(DI_TOKENS.ICalendarLogService, CalendarLogService);
  
  // 인프라 서비스 등록
  container.registerSingleton(DI_TOKENS.IRedisService, RedisService);

  // 모니터링 서비스들 등록
  container.registerSingleton(DI_TOKENS.IPrometheusMetricsService, PrometheusMetricsService);
  container.registerSingleton(DI_TOKENS.IPerformanceMonitoringService, PerformanceMonitoringService);

  // 명령어 핸들러 등록 (의존성이 많으므로 마지막에)
  container.registerSingleton(DI_TOKENS.ICommandHandler, CommandHandler);

  console.log('[DI Container] 모든 서비스가 등록되었습니다.');
}

/**
 * 테스트 환경용 Mock 서비스 설정
 */
export function configureTestContainer(): void {
  // 테스트용 Mock 구현체들을 등록할 예정
  // Phase 7에서 구현
  console.log('[DI Container] 테스트 환경 설정 (추후 구현)');
}

/**
 * 프로덕션 환경용 추가 설정
 */
export function configureProductionContainer(): void {
  // 프로덕션 환경에서 추가로 필요한 설정들
  console.log('[DI Container] 프로덕션 환경 설정 완료');
}

/**
 * 환경에 따른 컨테이너 설정
 */
export function setupContainer(): void {
  configureDIContainer();

  if (process.env.NODE_ENV === 'test') {
    configureTestContainer();
  } else if (process.env.NODE_ENV === 'production') {
    configureProductionContainer();
  }

  console.log(`[DI Container] ${process.env.NODE_ENV || 'development'} 환경으로 설정 완료`);
}

// DI Container 인스턴스 내보내기
export { container };

// 컨테이너 헬퍼 함수들
export const DIContainer = {
  /**
   * 서비스 인스턴스 조회
   */
  get<T>(token: symbol): T {
    return container.resolve<T>(token);
  },

  /**
   * Discord Client 등록 (Bot 클래스에서 호출)
   */
  registerClient(client: Client): void {
    container.registerInstance(DI_TOKENS.DiscordClient, client);
  },

  /**
   * 특정 서비스 재등록
   */
  rebind<T>(token: symbol, implementation: new (...args: any[]) => T): void {
    container.registerSingleton<T>(token, implementation);
  },

  /**
   * 컨테이너 상태 확인
   */
  getRegisteredServices(): string[] {
    // TSyringe는 등록된 서비스 목록을 직접 조회하는 API가 없으므로
    // 알려진 토큰들을 기반으로 확인
    const knownTokens = Object.values(DI_TOKENS);
    const registered: string[] = [];

    for (const token of knownTokens) {
      try {
        container.resolve(token);
        registered.push(token.toString());
      } catch (error) {
        // 등록되지 않은 서비스는 무시
      }
    }

    return registered;
  },

  /**
   * 컨테이너 초기화 (테스트용)
   */
  reset(): void {
    container.clearInstances();
  }
};