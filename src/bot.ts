// src/bot.ts - 봇 클래스 정의 (TypeScript 버전)
import { Client, GatewayIntentBits, Events } from 'discord.js';
import fs from 'fs';

import { ExtendedClient } from './types/discord.js';

// 서비스 임포트
import { EventManager } from './services/eventManager.js';
import { ActivityTracker } from './services/activityTracker.js';
import { LogService } from './services/logService.js';
import { CalendarLogService } from './services/calendarLogService.js';
import { CommandHandler } from './commands/commandHandler.js';
import { DatabaseManager } from './services/DatabaseManager.js';
import { VoiceChannelForumIntegrationService } from './services/VoiceChannelForumIntegrationService.js';
import { EmojiReactionService } from './services/EmojiReactionService.js';

// 설정 및 유틸리티 임포트
import { config } from './config/env.js';
import { PATHS } from './config/constants.js';
import { logger } from './config/logger-termux.js';

// 타입 정의
interface BotServices {
  dbManager: DatabaseManager;
  logService: LogService;
  calendarLogService: CalendarLogService;
  activityTracker: ActivityTracker;
  voiceForumService: VoiceChannelForumIntegrationService;
  emojiReactionService: EmojiReactionService;
  commandHandler: CommandHandler;
  eventManager: EventManager;
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
    database: boolean;
    eventManager: boolean;
    activityTracker: boolean;
    calendarLog: boolean;
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

  // 상수
  private static readonly CLIENT_OPTIONS = {
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessageReactions,
    ],
  };

  constructor(token: string) {
    // 싱글톤 패턴 - 이미 인스턴스가 존재하면 그 인스턴스 반환
    if (Bot.instance) {
      logger.warn('Bot 인스턴스가 이미 존재합니다. 기존 인스턴스를 반환합니다.');
      return Bot.instance;
    }

    if (!token) {
      throw new Error('Discord 봇 토큰이 필요합니다.');
    }

    this.token = token;
    this.client = new Client(Bot.CLIENT_OPTIONS);

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
   * 서비스 인스턴스들 초기화
   * @returns 초기화된 서비스들
   */
  private initializeServices(): BotServices {
    logger.info('서비스 초기화 시작');

    // 데이터베이스 관리자
    const dbManager = new DatabaseManager();

    // 로그 서비스
    const logService = new LogService(this.client as unknown as ExtendedClient, {
      logChannelId: config.LOG_CHANNEL_ID,
    });

    // 달력 로그 서비스
    const calendarLogService = new CalendarLogService(
      this.client as unknown as ExtendedClient,
      dbManager
    );

    // 활동 추적 서비스
    const activityTracker = new ActivityTracker(
      this.client as unknown as ExtendedClient,
      dbManager,
      logService
    );

    // 음성-포럼 연동 서비스
    const voiceForumService = new VoiceChannelForumIntegrationService(
      this.client as unknown as ExtendedClient,
      config.FORUM_CHANNEL_ID || '',
      config.VOICE_CATEGORY_ID || '',
      dbManager
    );

    // 이모지 반응 서비스
    const emojiReactionService = new EmojiReactionService(
      this.client,
      voiceForumService.forumPostManager
    );

    // 명령어 핸들러
    const commandHandler = new CommandHandler(
      this.client,
      activityTracker,
      dbManager,
      calendarLogService,
      voiceForumService
    );

    // 이벤트 관리자
    const eventManager = new EventManager(this.client as unknown as ExtendedClient);

    return {
      dbManager,
      logService,
      calendarLogService,
      activityTracker,
      voiceForumService,
      emojiReactionService,
      commandHandler,
      eventManager,
    };
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
        database: false,
        eventManager: false,
        activityTracker: false,
        calendarLog: false,
        voiceForumMapping: false,
      },
      errors: [],
      initializationTime: 0,
    };

    try {
      logger.info('봇 초기화 프로세스 시작');

      // 1. 데이터베이스 초기화
      try {
        await this.services.dbManager.initialize();
        result.services.database = true;
        logger.info('✅ 데이터베이스 초기화 완료');
      } catch (error) {
        const errorMsg = `데이터베이스 초기화 실패: ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(errorMsg);
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

        // 활동 추적 초기화
        const guild = readyClient.guilds.cache.get(config.GUILDID);
        if (guild) {
          try {
            logger.info('활동 추적 초기화 시작', {
              guildId: guild.id,
              guildName: guild.name,
              memberCount: guild.memberCount,
            });

            await this.services.activityTracker.initializeActivityData(guild);
            initResult.services.activityTracker = true;
            logger.info('✅ 활동 추적 초기화 완료');
          } catch (error) {
            const errorMsg = `활동 추적 초기화 실패: ${error instanceof Error ? error.message : String(error)}`;
            initResult.errors.push(errorMsg);
            logger.error(errorMsg);
          }
        } else {
          const errorMsg = `길드를 찾을 수 없습니다: ${config.GUILDID}`;
          initResult.errors.push(errorMsg);
          logger.error(errorMsg);
        }

        // 달력 로그 서비스 초기화
        try {
          logger.info('달력 로그 서비스 초기화 시작');
          await this.services.calendarLogService.initialize();
          initResult.services.calendarLog = true;
          logger.info('✅ 달력 로그 서비스 초기화 완료');
        } catch (error) {
          const errorMsg = `달력 로그 서비스 초기화 실패: ${error instanceof Error ? error.message : String(error)}`;
          initResult.errors.push(errorMsg);
          logger.error(errorMsg);
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

        // 최종 상태 로깅
        const successfulServices = Object.values(initResult.services).filter(Boolean).length;
        const totalServices = Object.keys(initResult.services).length;

        logger.info('🎉 봇이 완전히 준비되었습니다!', {
          successfulServices: `${successfulServices}/${totalServices}`,
          guild: guild
            ? {
                id: guild.id,
                name: guild.name,
                memberCount: guild.memberCount,
              }
            : null,
          stats: this.getBasicStats(),
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
        name: '활동 데이터 저장',
        task: () => this.services.activityTracker.saveActivityData(),
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
