// src/di/container.ts - DI Container 설정

import { Client } from 'discord.js';
import { container } from 'tsyringe';

// 서비스 클래스 임포트
import { CommandHandler } from '../commands/commandHandler.js';
import { config } from '../config/env.js';
import { DI_TOKENS } from '../interfaces/index.js';
import type { RedisConfig } from '../interfaces/IRedisService';
import { ActivityTracker } from '../services/activityTracker.js';
import { ConditionalServiceWrapper } from '../services/ConditionalServiceWrapper.js';
import { EmojiReactionService } from '../services/EmojiReactionService.js';
import { EventManager } from '../services/eventManager.js';
import { FeatureManagerService } from '../services/FeatureManagerService.js';
import { GuildSettingsManager } from '../services/GuildSettingsManager.js';
import { LogService } from '../services/logService.js';
import type { LogServiceOptions } from '../services/logService';
import { PerformanceMonitoringService } from '../services/PerformanceMonitoringService.js';
import { PostgreSQLManager } from '../services/PostgreSQLManager.js';
import { PrometheusMetricsService } from '../services/PrometheusMetricsService.js';
import { RedisService } from '../services/RedisService.js';
import { UserClassificationServiceOptimized } from '../services/UserClassificationServiceOptimized.js';
import { VoiceChannelForumIntegrationService } from '../services/VoiceChannelForumIntegrationService.js';
import { MemberFetchService } from '../services/MemberFetchService.js';
import { StreamingReportEngine } from '../services/StreamingReportEngine.js';
import { DiscordStreamingService } from '../services/DiscordStreamingService.js';
import { IncrementalDataProcessor } from '../services/IncrementalDataProcessor.js';
import { ReliableEmbedSender } from '../services/ReliableEmbedSender.js';
import { ActivityReportTemplateService } from '../services/ActivityReportTemplateService.js';
import { EmbedChunkingSystem } from '../services/EmbedChunkingSystem.js';
import { IntegratedReportChunkingService } from '../services/IntegratedReportChunkingService.js';
import { ReportGenerationValidator } from '../services/ReportGenerationValidator.js';
import { OptimizedMemberFetchService } from '../services/OptimizedMemberFetchService.js';
import { ReportCommandIntegration } from '../services/ReportCommandIntegration.js';
import { DEFAULT_STREAMING_CONFIG } from '../interfaces/IStreamingReportEngine.js';

// 인터페이스 및 토큰 임포트

// 설정 임포트

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
    ...(config.LOG_CHANNEL_ID && { logChannelId: config.LOG_CHANNEL_ID }), // DB에서 우선 관리, 환경변수는 fallback
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
    db: parseInt(process.env.REDIS_DB || '1'),
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 5,
    lazyConnect: true,
    enableOfflineQueue: true,
    connectTimeout: 15000,
    commandTimeout: 8000,
    family: 4,
    keepAlive: 30000,
    keyPrefix: 'discord_bot:',
  };

  container.registerInstance(DI_TOKENS.LogServiceConfig, logServiceConfig);
  container.registerInstance(DI_TOKENS.RedisConfig, redisConfig);
  container.registerInstance(DI_TOKENS.BotConfig, config);
  container.registerInstance(DI_TOKENS.StreamingReportConfig, DEFAULT_STREAMING_CONFIG);

  // 핵심 서비스들을 싱글톤으로 등록 (concrete class 등록)
  container.registerSingleton(DI_TOKENS.IDatabaseManager, PostgreSQLManager);
  container.registerSingleton(DI_TOKENS.ILogService, LogService);
  container.registerSingleton(DI_TOKENS.IActivityTracker, ActivityTracker);
  
  // 🚀 최적화된 사용자 분류 서비스 사용 (30초 → 3초 성능 개선)
  container.registerSingleton(DI_TOKENS.IUserClassificationService, UserClassificationServiceOptimized);

  // 설정 관리 서비스 등록
  container.registerSingleton(DI_TOKENS.IGuildSettingsManager, GuildSettingsManager);

  // 🚀 Discord Member Fetch 최적화 서비스 등록
  container.registerSingleton(DI_TOKENS.IMemberFetchService, MemberFetchService);

  // 🚀 스트리밍 보고서 서비스 등록
  container.registerSingleton(DI_TOKENS.IStreamingReportEngine, StreamingReportEngine);
  container.registerSingleton(DI_TOKENS.IDiscordStreamingService, DiscordStreamingService);
  container.registerSingleton(DI_TOKENS.IIncrementalDataProcessor, IncrementalDataProcessor);

  // 🚀 신뢰성 있는 임베드 전송 서비스 등록
  container.registerSingleton(DI_TOKENS.IReliableEmbedSender, ReliableEmbedSender);

  // 🚀 활동 보고서 템플릿 시스템 등록
  container.registerSingleton(DI_TOKENS.IActivityReportTemplateService, ActivityReportTemplateService);

  // 🚀 Discord 임베드 청킹 시스템 등록
  container.registerSingleton(DI_TOKENS.IEmbedChunkingSystem, EmbedChunkingSystem);

  // 🚀 통합 보고서 청킹 서비스 등록
  container.registerSingleton(IntegratedReportChunkingService);

  // 🔍 보고서 생성 검증 시스템 등록
  container.registerSingleton(ReportGenerationValidator);

  // ⚡ 최적화된 멤버 가져오기 서비스 등록
  container.registerSingleton(OptimizedMemberFetchService);

  // 🔧 보고서 명령어 통합 서비스 등록
  container.registerSingleton(ReportCommandIntegration);

  // 기능 관리 서비스 등록
  container.registerSingleton(FeatureManagerService);
  container.registerSingleton(ConditionalServiceWrapper);

  // 인프라 서비스 등록
  container.registerSingleton(DI_TOKENS.IRedisService, RedisService);

  // 모니터링 서비스들 등록
  container.registerSingleton(DI_TOKENS.IPrometheusMetricsService, PrometheusMetricsService);
  container.registerSingleton(
    DI_TOKENS.IPerformanceMonitoringService,
    PerformanceMonitoringService
  );

  // 명령어 핸들러 등록 (의존성이 많으므로 마지막에)
  container.registerSingleton(DI_TOKENS.ICommandHandler, CommandHandler);

  // UI/Forum 서비스들 등록
  container.registerSingleton(
    DI_TOKENS.IVoiceChannelForumIntegrationService,
    VoiceChannelForumIntegrationService
  );
  container.registerSingleton(DI_TOKENS.IEmojiReactionService, EmojiReactionService);
  container.registerSingleton(DI_TOKENS.IEventManager, EventManager);

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
  },
};
