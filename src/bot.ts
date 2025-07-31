// src/bot.ts - 봇 클래스 정의 (TypeScript 버전)
import { Client, GatewayIntentBits, Events } from 'discord.js';
import fs from 'fs';
// import { MemoryGuard } from 'discord-optimizer';

// ExtendedClient 제거됨 - 표준 Client 사용

// DI Container 및 서비스 임포트
import { DIContainer, setupContainer } from './di/container.js';
import { DI_TOKENS } from './interfaces/index.js';
// import { FeatureManagerService, Features } from './services/FeatureManagerService';
import type { 
  IDatabaseManager, 
  ILogService, 
  IActivityTracker, 
  ICommandHandler,
  IPerformanceMonitoringService,
  IPrometheusMetricsService,
  IRedisService
} from './interfaces/index';

// 추가 서비스 임포트 (DI Container로 관리되지 않는 서비스들 - 타입 정의용)
// import { EventManager } from './services/eventManager';
// import { VoiceChannelForumIntegrationService } from './services/VoiceChannelForumIntegrationService';
// import { EmojiReactionService } from './services/EmojiReactionService';

// 설정 및 유틸리티 임포트
import { PATHS } from './config/constants.js';
import { logger } from './config/logger-termux.js';

// 타입 정의
interface BotServices {
  redisService: IRedisService;
  dbManager: IDatabaseManager;
  logService: ILogService;
  activityTracker: IActivityTracker;
  voiceForumService: any; // VoiceChannelForumIntegrationService
  emojiReactionService: any; // EmojiReactionService
  commandHandler: ICommandHandler;
  eventManager: any; // EventManager
  performanceMonitor: IPerformanceMonitoringService;
  prometheusMetrics: IPrometheusMetricsService;
}

interface BotStats {
  startTime: Date;
  lastHeartbeat: Date;
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  guildCount: number;
  userCount: number;
  channelCount: number;
  commandsExecuted: number;
  eventsProcessed: number;
}

interface MigrationResult {
  success: boolean;
  migratedRecords: number;
  errors: string[];
  backupCreated: boolean;
}

interface InitializationResult {
  success: boolean;
  services: {
    redis: boolean;
    database: boolean;
    eventManager: boolean;
    activityTracker: boolean;
    voiceForumMapping: boolean;
  };
  errors: string[];
  initializationTime: number;
}

export class Bot {
  private static instance: Bot | null = null;

  // 기본 속성
  private readonly token!: string;
  public readonly client!: Client;

  // 서비스 인스턴스들
  public readonly services!: BotServices;

  // 통계 및 상태 관리
  private stats!: BotStats;
  private isInitialized: boolean = false;
  private isShuttingDown: boolean = false;

  // 인텐트 동적 결정
  private static getClientOptions(): { intents: GatewayIntentBits[] } {
    const baseIntents = [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessageReactions,
    ];

    // 환경변수로 Privileged Intent 제어
    const enableMembersIntent = process.env.ENABLE_GUILD_MEMBERS_INTENT === 'true';
    const enablePresencesIntent = process.env.ENABLE_GUILD_PRESENCES_INTENT === 'true';
    const enableMessageContentIntent = process.env.ENABLE_MESSAGE_CONTENT_INTENT === 'true';

    if (enableMembersIntent) {
      baseIntents.push(GatewayIntentBits.GuildMembers);
      logger.info('GuildMembers Intent 활성화됨');
    }

    if (enablePresencesIntent) {
      baseIntents.push(GatewayIntentBits.GuildPresences);
      logger.info('GuildPresences Intent 활성화됨');
    }

    if (enableMessageContentIntent) {
      baseIntents.push(GatewayIntentBits.MessageContent);
      logger.info('MessageContent Intent 활성화됨');
    }

    logger.info(`총 ${baseIntents.length}개 인텐트 사용됨`);
    return { intents: baseIntents };
  }

  constructor(token: string) {
    if (Bot.instance) {
      logger.warn('Bot 인스턴스가 이미 존재합니다. 기존 인스턴스를 반환합니다.');
      return Bot.instance;
    }

    if (!token) {
      throw new Error('Discord 봇 토큰이 필요합니다.');
    }

    this.token = token;

    // Discord Client 생성 (MemoryGuard 임시 비활성화)
    // const baseClient = new Client(Bot.getClientOptions());
    // this.client = MemoryGuard.wrap(baseClient, {
    //   maxMemory: 256, // 256MB 메모리 제한 (Termux 환경 고려)
    //   autoRestart: false, // PM2가 재시작을 담당하므로 비활성화
    // });
    
    // 직접 Client 생성
    this.client = new Client(Bot.getClientOptions());

    // 통계 초기화
    this.stats = {
      startTime: new Date(),
      lastHeartbeat: new Date(),
      uptime: 0,
      memoryUsage: process.memoryUsage(),
      guildCount: 0,
      userCount: 0,
      channelCount: 0,
      commandsExecuted: 0,
      eventsProcessed: 0,
    };

    // DI Container 설정 및 Discord Client 등록
    try {
      setupContainer();
      DIContainer.registerClient(this.client);
      logger.info('DI Container 설정 완료');
    } catch (error) {
      logger.error('DI Container 설정 중 오류 발생:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    // 서비스 인스턴스 생성
    try {
      this.services = this.initializeServices();
      logger.info('모든 서비스가 성공적으로 초기화되었습니다.');
    } catch (error) {
      logger.error('서비스 초기화 중 오류 발생:', {
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      });
      throw error;
    }

    // 정기적 통계 업데이트 설정
    this.setupStatsUpdater();

    Bot.instance = this;
  }

  /**
   * 싱글톤 인스턴스 조회
   * @returns Bot 인스턴스 또는 null
   */
  static getInstance(): Bot | null {
    return Bot.instance;
  }

  /**
   * 서비스 인스턴스들 초기화 (DI Container 사용)
   * @returns 초기화된 서비스들
   */
  private initializeServices(): BotServices {
    logger.info('DI Container를 사용하여 서비스 초기화 시작');

    try {
      // DI Container에서 관리되는 서비스들 조회
      const redisService = DIContainer.get<IRedisService>(DI_TOKENS.IRedisService);
      const dbManager = DIContainer.get<IDatabaseManager>(DI_TOKENS.IDatabaseManager);
      const logService = DIContainer.get<ILogService>(DI_TOKENS.ILogService);
      const activityTracker = DIContainer.get<IActivityTracker>(DI_TOKENS.IActivityTracker);
      const commandHandler = DIContainer.get<ICommandHandler>(DI_TOKENS.ICommandHandler);
      const performanceMonitor = DIContainer.get<IPerformanceMonitoringService>(DI_TOKENS.IPerformanceMonitoringService);
      const prometheusMetrics = DIContainer.get<IPrometheusMetricsService>(DI_TOKENS.IPrometheusMetricsService);

      // UI/Forum 서비스들도 DI Container에서 가져오기
      const voiceForumService = DIContainer.get<any>(DI_TOKENS.IVoiceChannelForumIntegrationService);
      const emojiReactionService = DIContainer.get<any>(DI_TOKENS.IEmojiReactionService);
      const eventManager = DIContainer.get<any>(DI_TOKENS.IEventManager);

      // EmojiReactionService에 ForumPostManager 주입
      emojiReactionService.setForumPostManager(voiceForumService.forumPostManager);
      
      // EmojiReactionService에 MappingService 주입
      emojiReactionService.setMappingService(voiceForumService.mappingService);

      // CommandHandler에 VoiceChannelForumIntegrationService 주입
      (commandHandler as any).setVoiceForumService(voiceForumService);

      logger.info('DI Container 서비스 조회 완료');

      return {
        redisService,
        dbManager,
        logService,
        activityTracker,
        voiceForumService,
        emojiReactionService,
        commandHandler,
        eventManager,
        performanceMonitor,
        prometheusMetrics,
      };
    } catch (error) {
      logger.error('DI Container 서비스 조회 중 오류:', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 봇 초기화 (비동기)
   * @returns 초기화 결과
   */
  async initialize(): Promise<InitializationResult> {
    const startTime = Date.now();
    const result: InitializationResult = {
      success: false,
      services: {
        redis: false,
        database: false,
        eventManager: false,
        activityTracker: false,
        voiceForumMapping: false,
      },
      errors: [],
      initializationTime: 0,
    };

    try {
      console.log('[Bot] 봇 초기화 프로세스 시작');
      logger.info('봇 초기화 프로세스 시작');

      // 1. Redis 연결 초기화
      console.log('[Bot] Redis 연결 초기화 시작...');
      try {
        const redisConnected = await this.services.redisService.connect();
        result.services.redis = redisConnected;
        
        if (redisConnected) {
          console.log('[Bot] ✅ Redis 연결 초기화 완료');
          logger.info('✅ Redis 연결 초기화 완료');
        } else {
          console.log('[Bot] ⚠️ Redis 연결 실패 - fallback 캐시 사용');
          logger.warn('⚠️ Redis 연결 실패 - fallback 캐시 사용');
        }
      } catch (error) {
        const errorMsg = `Redis 초기화 실패: ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(errorMsg);
        console.log(`[Bot] ⚠️ ${errorMsg} - fallback 캐시 사용`);
        logger.warn(`⚠️ ${errorMsg} - fallback 캐시 사용`);
      }

      // 2. 데이터베이스 초기화
      console.log('[Bot] 데이터베이스 초기화 시작...');
      try {
        await this.services.dbManager.initialize();
        result.services.database = true;
        console.log('[Bot] ✅ 데이터베이스 초기화 완료');
        logger.info('✅ 데이터베이스 초기화 완료');
      } catch (error) {
        const errorMsg = `데이터베이스 초기화 실패: ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(errorMsg);
        console.log(`[Bot] ❌ ${errorMsg}`);
        logger.error(errorMsg);
      }

      // 2. JSON 데이터 마이그레이션 (필요시)
      try {
        const migrationResult = await this.migrateDataIfNeeded();
        if (migrationResult.success && migrationResult.migratedRecords > 0) {
          logger.info(`✅ 데이터 마이그레이션 완료: ${migrationResult.migratedRecords}개 레코드`);
        }
      } catch (error) {
        const errorMsg = `데이터 마이그레이션 실패: ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(errorMsg);
        logger.warn(errorMsg);
      }

      // 3. 이벤트 핸들러 등록
      try {
        this.registerEventHandlers();
        result.services.eventManager = true;
        logger.info('✅ 이벤트 핸들러 등록 완료');
      } catch (error) {
        const errorMsg = `이벤트 핸들러 등록 실패: ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(errorMsg);
        logger.error(errorMsg);
      }

      // 4. 클라이언트 ready 이벤트 처리 설정
      this.setupReadyHandler(result);

      result.initializationTime = Date.now() - startTime;
      result.success = result.errors.length === 0;
      this.isInitialized = true;

      logger.info('봇 초기화 프로세스 완료', {
        success: result.success,
        initializationTime: `${result.initializationTime}ms`,
        errorsCount: result.errors.length,
      });

      return result;
    } catch (error) {
      const errorMsg = `초기화 중 예상치 못한 오류: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(errorMsg);
      result.initializationTime = Date.now() - startTime;
      logger.error(errorMsg, {
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      });

      return result;
    }
  }

  /**
   * Ready 이벤트 핸들러 설정
   * @param initResult - 초기화 결과 객체
   */
  private setupReadyHandler(initResult: InitializationResult): void {
    this.client.once(Events.ClientReady, async (readyClient) => {
      try {
        logger.botActivity(`Discord Bot 로그인 성공: ${readyClient.user.tag}`, {
          botTag: readyClient.user.tag,
          botId: readyClient.user.id,
          guildCount: readyClient.guilds.cache.size,
        });

        // 통계 업데이트
        this.updateStats();

        // 활동 추적 초기화 (모든 길드에 대해)
        const guilds = readyClient.guilds.cache;
        if (guilds.size === 0) {
          const errorMsg = '봇이 속한 길드가 없습니다';
          initResult.errors.push(errorMsg);
          logger.error(errorMsg);
        } else {
          try {
            logger.info(`활동 추적 초기화 시작 (총 ${guilds.size}개 길드)`, {
              guildCount: guilds.size,
              guildNames: guilds.map(g => g.name),
            });

            // 각 길드에 대해 활동 추적 초기화
            for (const [guildId, guild] of guilds) {
              try {
                logger.info(`길드 초기화: ${guild.name} (${guildId})`, {
                  guildId: guild.id,
                  guildName: guild.name,
                  memberCount: guild.memberCount,
                });

                await this.services.activityTracker.initializeActivityData(guild);
                logger.info(`✅ ${guild.name} 활동 추적 초기화 완료`);
              } catch (error) {
                const errorMsg = `길드 ${guild.name} 활동 추적 초기화 실패: ${error instanceof Error ? error.message : String(error)}`;
                initResult.errors.push(errorMsg);
                logger.error(errorMsg);
              }
            }
            
            // Redis 세션 복구 (Redis가 연결된 경우에만)
            if (this.services.redisService.isConnected()) {
              await this.services.activityTracker.restoreActiveSessions();
            }
            
            initResult.services.activityTracker = true;
            logger.info('✅ 모든 길드 활동 추적 초기화 완료');
          } catch (error) {
            const errorMsg = `활동 추적 초기화 실패: ${error instanceof Error ? error.message : String(error)}`;
            initResult.errors.push(errorMsg);
            logger.error(errorMsg);
          }
        }


        // VoiceChannelForumIntegrationService 매핑 초기화
        try {
          logger.info('음성-포럼 매핑 서비스 초기화 시작');
          await this.services.voiceForumService.initializeMappingService();
          initResult.services.voiceForumMapping = true;
          logger.info('✅ 음성-포럼 매핑 서비스 초기화 완료');
        } catch (error) {
          const errorMsg = `매핑 서비스 초기화 실패: ${error instanceof Error ? error.message : String(error)}`;
          initResult.errors.push(errorMsg);
          logger.error(errorMsg);
          // 매핑 초기화 실패해도 봇 전체는 계속 실행
        }

        // Prometheus 메트릭 서비스 시작
        try {
          logger.info('Prometheus 메트릭 서비스 시작');
          await this.services.prometheusMetrics.start();
          logger.info('✅ Prometheus 메트릭 서비스 시작 완료');
        } catch (error) {
          const errorMsg = `Prometheus 메트릭 서비스 시작 실패: ${error instanceof Error ? error.message : String(error)}`;
          initResult.errors.push(errorMsg);
          logger.error(errorMsg);
        }

        // 성능 모니터링 서비스 시작
        try {
          logger.info('성능 모니터링 서비스 시작');
          this.services.performanceMonitor.start();
          logger.info('✅ 성능 모니터링 서비스 시작 완료');
        } catch (error) {
          const errorMsg = `성능 모니터링 서비스 시작 실패: ${error instanceof Error ? error.message : String(error)}`;
          initResult.errors.push(errorMsg);
          logger.error(errorMsg);
        }

        // 최종 상태 로깅
        const successfulServices = Object.values(initResult.services).filter(Boolean).length;
        const totalServices = Object.keys(initResult.services).length;

        logger.info('🎉 봇이 완전히 준비되었습니다!', {
          successfulServices: `${successfulServices}/${totalServices}`,
          guilds: {
            count: readyClient.guilds.cache.size,
            names: readyClient.guilds.cache.map(g => g.name),
            totalMembers: readyClient.guilds.cache.reduce((total, g) => total + g.memberCount, 0),
          },
          stats: this.getBasicStats(),
          monitoring: {
            discordOptimizer: 'enabled',
            performanceMonitoring: 'enabled',
            prometheusMetrics: 'enabled',
            redis: this.services.redisService.isConnected() ? 'connected' : 'fallback',
            memoryLimit: '256MB',
            metricsEndpoint: 'http://0.0.0.0:3001/metrics',
          },
        });
      } catch (error) {
        logger.error('Ready 이벤트 처리 중 오류:', {
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
        });
      }
    });
  }

  /**
   * JSON 데이터를 SQLite로 마이그레이션 (필요한 경우)
   * @returns 마이그레이션 결과
   */
  private async migrateDataIfNeeded(): Promise<MigrationResult> {
    const result: MigrationResult = {
      success: false,
      migratedRecords: 0,
      errors: [],
      backupCreated: false,
    };

    try {
      // 데이터베이스에 이미 데이터가 있는지 확인
      const hasData = await this.services.dbManager.hasAnyData();

      // 데이터가 없고 JSON 파일이 존재하는 경우에만 마이그레이션
      if (!hasData && fs.existsSync(PATHS.ACTIVITY_INFO) && fs.existsSync(PATHS.ROLE_CONFIG)) {
        logger.info('JSON 데이터를 SQLite 데이터베이스로 마이그레이션 시작', {
          activityInfoPath: PATHS.ACTIVITY_INFO,
          roleConfigPath: PATHS.ROLE_CONFIG,
        });

        // JSON 파일 로드 (FileManager 없이 직접 로드)
        const activityData = JSON.parse(fs.readFileSync(PATHS.ACTIVITY_INFO, 'utf8'));
        const roleConfigData = JSON.parse(fs.readFileSync(PATHS.ROLE_CONFIG, 'utf8'));

        // 마이그레이션 실행
        const success = await this.services.dbManager.migrateFromJSON(activityData, roleConfigData);

        if (success) {
          result.success = true;
          result.migratedRecords =
            Object.keys(activityData?.participants || {}).length +
            Object.keys(roleConfigData?.roles || {}).length;

          logger.info('마이그레이션이 성공적으로 완료되었습니다', {
            migratedRecords: result.migratedRecords,
          });

          // 마이그레이션 완료 후 백업 파일 생성
          try {
            const timestamp = new Date().toISOString().replace(/:/g, '-');
            fs.copyFileSync(PATHS.ACTIVITY_INFO, `${PATHS.ACTIVITY_INFO}.${timestamp}.bak`);
            fs.copyFileSync(PATHS.ROLE_CONFIG, `${PATHS.ROLE_CONFIG}.${timestamp}.bak`);
            result.backupCreated = true;

            logger.info('기존 JSON 파일의 백업이 생성되었습니다', {
              backupTimestamp: timestamp,
            });
          } catch (backupError) {
            const errorMsg = `백업 생성 실패: ${backupError instanceof Error ? backupError.message : String(backupError)}`;
            result.errors.push(errorMsg);
            logger.warn(errorMsg);
          }
        } else {
          result.errors.push('마이그레이션 실행 실패');
        }
      } else if (hasData) {
        logger.info('데이터베이스에 이미 데이터가 있어 마이그레이션을 건너뜁니다');
        result.success = true; // 마이그레이션이 불필요한 경우도 성공으로 간주
      } else {
        logger.info('마이그레이션할 JSON 파일이 없습니다. 새 데이터베이스로 시작합니다');
        result.success = true; // 새 시작도 성공으로 간주
      }
    } catch (error) {
      const errorMsg = `데이터 마이그레이션 중 오류: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(errorMsg);
      logger.error(errorMsg, {
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      });
    }

    return result;
  }

  /**
   * 이벤트 핸들러 등록
   */
  private registerEventHandlers(): void {
    logger.info('이벤트 핸들러 등록 시작');

    // 개별 이벤트 핸들러 등록 (타입 안전성을 위해)

    // 음성 채널 상태 변경 이벤트
    this.services.eventManager.registerHandler(
      Events.VoiceStateUpdate,
      this.services.activityTracker.handleVoiceStateUpdate.bind(this.services.activityTracker)
    );
    this.services.eventManager.registerHandler(
      Events.VoiceStateUpdate,
      this.services.voiceForumService.handleVoiceStateUpdate.bind(this.services.voiceForumService)
    );

    // 멤버 업데이트 이벤트
    this.services.eventManager.registerHandler(
      Events.GuildMemberUpdate,
      this.services.activityTracker.handleGuildMemberUpdate.bind(this.services.activityTracker)
    );
    this.services.eventManager.registerHandler(
      Events.GuildMemberUpdate,
      this.services.voiceForumService.handleGuildMemberUpdate.bind(this.services.voiceForumService)
    );

    // 채널 관련 이벤트
    this.services.eventManager.registerHandler(
      Events.ChannelUpdate,
      this.services.logService.handleChannelUpdate.bind(this.services.logService)
    );
    this.services.eventManager.registerHandler(
      Events.ChannelCreate,
      this.services.logService.handleChannelCreate.bind(this.services.logService)
    );
    this.services.eventManager.registerHandler(
      Events.ChannelCreate,
      this.services.voiceForumService.handleChannelCreate.bind(this.services.voiceForumService)
    );
    this.services.eventManager.registerHandler(
      Events.ChannelDelete,
      this.services.voiceForumService.handleChannelDelete.bind(this.services.voiceForumService)
    );

    // 인터랙션 이벤트
    this.services.eventManager.registerHandler(
      Events.InteractionCreate,
      this.services.commandHandler.handleInteraction.bind(this.services.commandHandler)
    );

    // 이모지 반응 이벤트
    this.services.eventManager.registerHandler(
      Events.MessageReactionAdd,
      this.services.emojiReactionService.handleMessageReactionAdd.bind(
        this.services.emojiReactionService
      )
    );
    this.services.eventManager.registerHandler(
      Events.MessageReactionRemove,
      this.services.emojiReactionService.handleMessageReactionRemove.bind(
        this.services.emojiReactionService
      )
    );

    // 이벤트 핸들러 초기화
    this.services.eventManager.initialize();

    logger.info('이벤트 핸들러 등록 완료');
  }

  /**
   * Discord에 로그인
   * @returns Promise<string> - 로그인 토큰
   */
  async login(): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('봇이 초기화되지 않았습니다. initialize()를 먼저 호출하세요.');
    }

    logger.info('Discord 로그인 시도 중...');

    try {
      const result = await this.client.login(this.token);
      logger.info('Discord 로그인 성공');
      return result;
    } catch (error) {
      logger.error('Discord 로그인 실패:', {
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      });
      throw error;
    }
  }

  /**
   * 정기적 통계 업데이트 설정
   */
  private setupStatsUpdater(): void {
    // 30초마다 통계 업데이트
    setInterval(() => {
      this.updateStats();
    }, 30000);

    // 5분마다 상세 통계 로깅
    setInterval(() => {
      this.logDetailedStats();
    }, 300000);
  }

  /**
   * 통계 업데이트
   */
  private updateStats(): void {
    this.stats.lastHeartbeat = new Date();
    this.stats.uptime = Date.now() - this.stats.startTime.getTime();
    this.stats.memoryUsage = process.memoryUsage();

    if (this.client.readyAt) {
      this.stats.guildCount = this.client.guilds.cache.size;
      this.stats.userCount = this.client.users.cache.size;
      this.stats.channelCount = this.client.channels.cache.size;
    }
  }

  /**
   * 기본 통계 조회
   * @returns 기본 통계
   */
  private getBasicStats(): Partial<BotStats> {
    return {
      uptime: this.stats.uptime,
      guildCount: this.stats.guildCount,
      userCount: this.stats.userCount,
      channelCount: this.stats.channelCount,
      memoryUsage: this.stats.memoryUsage,
    };
  }

  /**
   * 상세 통계 로깅
   */
  private logDetailedStats(): void {
    const memUsageMB = {
      rss: Math.round(this.stats.memoryUsage.rss / 1024 / 1024),
      heapTotal: Math.round(this.stats.memoryUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(this.stats.memoryUsage.heapUsed / 1024 / 1024),
      external: Math.round(this.stats.memoryUsage.external / 1024 / 1024),
    };

    logger.info('봇 상태 리포트', {
      uptime: `${Math.round(this.stats.uptime / 1000)}초`,
      guilds: this.stats.guildCount,
      users: this.stats.userCount,
      channels: this.stats.channelCount,
      memoryUsage: `${memUsageMB.heapUsed}MB`,
      memoryDetails: memUsageMB,
      lastHeartbeat: this.stats.lastHeartbeat.toISOString(),
      websocketPing: this.client.ws.ping,
    });
  }

  /**
   * 봇 통계 조회
   * @returns 봇 통계
   */
  getStats(): BotStats {
    this.updateStats();
    return { ...this.stats };
  }

  /**
   * 봇이 준비되었는지 확인
   * @returns 준비 상태
   */
  isReady(): boolean {
    return this.client.isReady() && this.isInitialized;
  }

  /**
   * 종료 시 리소스 정리
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('이미 종료 프로세스가 진행 중입니다.');
      return;
    }

    this.isShuttingDown = true;
    logger.info('봇 종료 프로세스 시작');

    const shutdownTasks = [
      {
        name: 'Prometheus 메트릭 서비스 중지',
        task: () => this.services.prometheusMetrics.stop(),
      },
      {
        name: '성능 모니터링 서비스 중지',
        task: () => this.services.performanceMonitor.stop(),
      },
      {
        name: '활동 데이터 저장',
        task: () => this.services.activityTracker.saveActivityData(),
      },
      {
        name: 'Redis 연결 종료',
        task: () => this.services.redisService.disconnect(),
      },
      {
        name: '데이터베이스 연결 종료',
        task: () => this.services.dbManager.close(),
      },
      {
        name: 'Discord 클라이언트 연결 종료',
        task: () => {
          if (this.client) {
            this.client.destroy();
          }
        },
      },
    ];

    for (const { name, task } of shutdownTasks) {
      try {
        await task();
        logger.info(`✅ ${name} 완료`);
      } catch (error) {
        logger.error(`❌ ${name} 실패:`, {
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
        });
      }
    }

    // 정적 인스턴스 초기화
    Bot.instance = null;

    logger.info('봇이 안전하게 종료되었습니다', {
      totalUptime: `${Math.round(this.stats.uptime / 1000)}초`,
      shutdownTime: new Date().toISOString(),
    });
  }
}

// 타입 내보내기
export type { BotServices, BotStats, MigrationResult, InitializationResult };
