// src/bot.js - 봇 클래스 정의 (DI Container 적용 버전)
import {Client, GatewayIntentBits, Events} from 'discord.js';
import {config} from './config/env.js';
import {logger} from './config/logger-termux.js';
import {createDIContainer, initializeContainer, disposeContainer} from './container.js';

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
        GatewayIntentBits.GuildMessages,         // awaitMessages 동작에 필요
        GatewayIntentBits.MessageContent,        // message.content 읽기에 필요 (@name 파싱)
        GatewayIntentBits.GuildMessageReactions,
      ],
    });

    this.client.on('error', (error) => logger.error('[Discord] client error', {
      error: error.message,
      stack: error.stack
    }));
    this.client.on('shardError', (error, shardId) => logger.error('[Discord] shard error', {
      shardId,
      error: error.message,
      stack: error.stack
    }));
    this.client.on('warn', (message) => logger.warn('[Discord] client warn', {message}));

    // DI Container 생성 및 서비스 해결
    this.container = createDIContainer(this.client);
    
    // 각 서비스를 Container에서 해결
    this.dbManager = this.container.resolve('dbManager');
    this.logService = this.container.resolve('logService');
    this.activityTracker = this.container.resolve('activityTracker');
    this.voiceForumService = this.container.resolve('voiceChannelForumIntegrationService');
    this.emojiReactionService = this.container.resolve('emojiReactionService');
    this.commandHandler = this.container.resolve('commandHandler');
    this.eventManager = this.container.resolve('eventManager');
    this.voiceChannelNicknameManager = this.container.resolve('voiceChannelNicknameManager');
    this.inactivePostChecker = this.container.resolve('inactivePostChecker');

    Bot.instance = this;
  }

  async initialize() {
    // DI Container 및 모든 서비스 초기화
    await initializeContainer(this.container);

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

      // EmojiReactionService 초기화 (기존 참가자 캐시 복구)
      try {
        logger.info('이모지 반응 서비스 초기화 시작');
        await this.emojiReactionService.initialize();
        logger.info('이모지 반응 서비스 초기화 완료');
      } catch (error) {
        logger.error('이모지 반응 서비스 초기화 실패', {
          error: error.message,
          stack: error.stack
        });
        // 이모지 반응 서비스 초기화 실패해도 봇 전체는 계속 실행
      }

      // 비활동 구직글 체커 시작 (매일 실행)
      try {
        this.inactivePostChecker.start();
        logger.info('비활동 구직글 체커 시작 완료');
      } catch (error) {
        logger.error('비활동 구직글 체커 시작 실패', { error: error.message });
      }

    });
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
      // 주기적 저장 중단 및 최종 활동 데이터 저장
      await this.activityTracker.finalSaveAndCleanup();
      logger.info('활동 데이터 최종 저장 완료');

      // 비활동 구직글 체커 정지
      this.inactivePostChecker?.stop();

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
