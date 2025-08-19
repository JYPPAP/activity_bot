// src/bot.js - 봇 클래스 정의 (DI Container 적용 버전)
import {Client, GatewayIntentBits, Events} from 'discord.js';
import {config} from './config/env.js';
import {PATHS} from './config/constants.js';
import {logger} from './config/logger-termux.js';
import {createDIContainer, initializeContainer, disposeContainer} from './container.js';
import fs from 'fs';

export class Bot {
  static instance = null;

  constructor(token) {
    // 싱글톤 패턴 - 이미 인스턴스가 존재하면 그 인스턴스 반환
    if (Bot.instance) {
      return Bot.instance;
    }

    this.token = token;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
      ],
    });

    // DI Container 생성 및 서비스 해결
    this.container = createDIContainer(this.client);
    
    // 각 서비스를 Container에서 해결
    this.dbManager = this.container.resolve('dbManager');
    this.logService = this.container.resolve('logService');
    this.calendarLogService = this.container.resolve('calendarLogService');
    this.activityTracker = this.container.resolve('activityTracker');
    this.voiceForumService = this.container.resolve('voiceChannelForumIntegrationService');
    this.emojiReactionService = this.container.resolve('emojiReactionService');
    this.commandHandler = this.container.resolve('commandHandler');
    this.eventManager = this.container.resolve('eventManager');

    Bot.instance = this;
  }

  async initialize() {
    // DI Container 및 모든 서비스 초기화
    await initializeContainer(this.container);

    // JSON 데이터 마이그레이션 (필요시)
    await this.migrateDataIfNeeded();

    // 이벤트 핸들러 등록
    this.registerEventHandlers();

    // 클라이언트 ready 이벤트 처리
    this.client.once(Events.ClientReady, async () => {
      logger.botActivity(`Discord Bot 로그인 성공: ${this.client.user.tag}`, {
        botTag: this.client.user.tag,
        botId: this.client.user.id,
        guildCount: this.client.guilds.cache.size
      });

      // 활동 추적 초기화
      const guild = this.client.guilds.cache.get(config.GUILDID);
      if (guild) {
        logger.info('활동 추적 초기화 시작', { guildId: guild.id, guildName: guild.name });
        await this.activityTracker.initializeActivityData(guild);
        logger.info('활동 추적 초기화 완료');
      }

      // 달력 로그 서비스 초기화
      logger.info('달력 로그 서비스 초기화 시작');
      await this.calendarLogService.initialize();
      logger.info('달력 로그 서비스 초기화 완료');

      // VoiceChannelForumIntegrationService 매핑 초기화 (봇이 준비된 후)
      try {
        logger.info('음성-포럼 매핑 서비스 초기화 시작');
        await this.voiceForumService.initializeMappingService();
        logger.info('음성-포럼 매핑 서비스 초기화 완료');
      } catch (error) {
        logger.error('매핑 서비스 초기화 실패', {
          error: error.message,
          stack: error.stack
        });
        // 매핑 초기화 실패해도 봇 전체는 계속 실행
      }

    });
  }




  /**
   * JSON 데이터를 SQLite로 마이그레이션 (필요한 경우)
   */
  async migrateDataIfNeeded() {
    try {
      // 데이터베이스에 이미 데이터가 있는지 확인
      const hasData = await this.dbManager.hasAnyData();

      // 데이터가 없고 JSON 파일이 존재하는 경우에만 마이그레이션
      if (!hasData &&
        fs.existsSync(PATHS.ACTIVITY_INFO) &&
        fs.existsSync(PATHS.ROLE_CONFIG)) {

        logger.info('JSON 데이터를 SQLite 데이터베이스로 마이그레이션 시작', {
          activityInfoPath: PATHS.ACTIVITY_INFO,
          roleConfigPath: PATHS.ROLE_CONFIG
        });

        // JSON 파일 로드
        const activityData = JSON.parse(fs.readFileSync(PATHS.ACTIVITY_INFO, 'utf8'));
        const roleConfigData = JSON.parse(fs.readFileSync(PATHS.ROLE_CONFIG, 'utf8'));

        // 마이그레이션 실행
        const success = await this.dbManager.migrateFromJSON(activityData, roleConfigData);

        if (success) {
          logger.info('마이그레이션이 성공적으로 완료되었습니다');

          // 마이그레이션 완료 후 백업 파일 생성
          const timestamp = new Date().toISOString().replace(/:/g, '-');
          fs.copyFileSync(PATHS.ACTIVITY_INFO, `${PATHS.ACTIVITY_INFO}.${timestamp}.bak`);
          fs.copyFileSync(PATHS.ROLE_CONFIG, `${PATHS.ROLE_CONFIG}.${timestamp}.bak`);

          logger.info('기존 JSON 파일의 백업이 생성되었습니다', {
            backupTimestamp: timestamp
          });
        }
      } else if (hasData) {
        logger.info('데이터베이스에 이미 데이터가 있어 마이그레이션을 건너뜁니다');
      } else {
        logger.info('마이그레이션할 JSON 파일이 없습니다. 새 데이터베이스로 시작합니다');
      }
    } catch (error) {
      logger.error('데이터 마이그레이션 중 오류 발생', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  registerEventHandlers() {
    // 음성 채널 상태 변경 이벤트
    this.eventManager.registerHandler(
      Events.VoiceStateUpdate,
      this.activityTracker.handleVoiceStateUpdate.bind(this.activityTracker)
    );

    // 음성채널-포럼 연동: 음성 상태 변경 이벤트
    this.eventManager.registerHandler(
      Events.VoiceStateUpdate,
      this.voiceForumService.handleVoiceStateUpdate.bind(this.voiceForumService)
    );

    // 멤버 업데이트 이벤트
    this.eventManager.registerHandler(
      Events.GuildMemberUpdate,
      this.activityTracker.handleGuildMemberUpdate.bind(this.activityTracker)
    );

    // 음성채널-포럼 연동: 멤버 업데이트 이벤트 (별명 변경 시 실시간 갱신)
    this.eventManager.registerHandler(
      Events.GuildMemberUpdate,
      this.voiceForumService.handleGuildMemberUpdate.bind(this.voiceForumService)
    );

    // 채널 업데이트 이벤트
    this.eventManager.registerHandler(
      Events.ChannelUpdate,
      this.logService.handleChannelUpdate.bind(this.logService)
    );

    // 채널 생성 이벤트
    this.eventManager.registerHandler(
      Events.ChannelCreate,
      this.logService.handleChannelCreate.bind(this.logService)
    );

    // 음성채널-포럼 연동: 채널 생성 이벤트
    this.eventManager.registerHandler(
      Events.ChannelCreate,
      this.voiceForumService.handleChannelCreate.bind(this.voiceForumService)
    );

    // 음성채널-포럼 연동: 채널 삭제 이벤트
    this.eventManager.registerHandler(
      Events.ChannelDelete,
      this.voiceForumService.handleChannelDelete.bind(this.voiceForumService)
    );


    // 모든 인터랙션 처리 (명령어 + 구인구직 UI)
    this.eventManager.registerHandler(
      Events.InteractionCreate,
      this.commandHandler.handleInteraction.bind(this.commandHandler)
    );

    // 이모지 반응 추가 이벤트
    this.eventManager.registerHandler(
      Events.MessageReactionAdd,
      this.emojiReactionService.handleMessageReactionAdd.bind(this.emojiReactionService)
    );

    // 이모지 반응 제거 이벤트
    this.eventManager.registerHandler(
      Events.MessageReactionRemove,
      this.emojiReactionService.handleMessageReactionRemove.bind(this.emojiReactionService)
    );

    // 이벤트 핸들러 초기화
    this.eventManager.initialize();
  }

  login() {
    return this.client.login(this.token);
  }

  /**
   * 종료 시 리소스 정리
   */
  async shutdown() {
    logger.info('봇 종료 프로세스 시작');

    try {
      // 남은 활동 데이터 저장
      await this.activityTracker.saveActivityData();
      logger.info('활동 데이터 저장 완료');

      // DI Container 및 모든 리소스 해제
      await disposeContainer(this.container);
      logger.info('DI Container 해제 완료');

      // 클라이언트 연결 종료
      if (this.client) {
        this.client.destroy();
        logger.info('Discord 클라이언트 연결 종료 완료');
      }

      logger.info('봇이 안전하게 종료되었습니다');
    } catch (error) {
      logger.error('봇 종료 중 오류 발생', {
        error: error.message,
        stack: error.stack
      });
    }
  }
}