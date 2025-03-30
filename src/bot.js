// src/bot.js - 봇 클래스 정의
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { EventManager } from './services/eventManager.js';
import { ActivityTracker } from './services/activityTracker.js';
import { LogService } from './services/logService.js';
import { CommandHandler } from './commands/commandHandler.js';
import { FileManager } from './services/fileManager.js';
import { config } from './config/env.js';
import { PATHS } from './config/constants.js';

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
      ],
    });

    // 각 서비스 인스턴스 생성
    this.fileManager = new FileManager();
    this.logService = new LogService(this.client, config.LOG_CHANNEL_ID);
    this.activityTracker = new ActivityTracker(this.client, this.fileManager, this.logService);
    this.commandHandler = new CommandHandler(this.client, this.activityTracker, this.fileManager);
    this.eventManager = new EventManager(this.client);

    Bot.instance = this;
  }

  async initialize() {
    // 이벤트 핸들러 등록
    this.registerEventHandlers();

    // 클라이언트 ready 이벤트 처리
    this.client.once(Events.ClientReady, async () => {
      console.log(`Logged in as ${this.client.user.tag}!`);

      // 활동 추적 초기화
      const guild = this.client.guilds.cache.get(config.GUILDID);
      if (guild) {
        await this.activityTracker.initializeActivityData(guild);
      }
    });
  }

  registerEventHandlers() {
    // 음성 채널 상태 변경 이벤트
    this.eventManager.registerHandler(
      Events.VoiceStateUpdate,
      this.activityTracker.handleVoiceStateUpdate.bind(this.activityTracker)
    );

    // 멤버 업데이트 이벤트
    this.eventManager.registerHandler(
      Events.GuildMemberUpdate,
      this.activityTracker.handleGuildMemberUpdate.bind(this.activityTracker)
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

    // 명령어 처리 이벤트
    this.eventManager.registerHandler(
      Events.InteractionCreate,
      this.commandHandler.handleInteraction.bind(this.commandHandler)
    );

    // 이벤트 핸들러 초기화
    this.eventManager.initialize();
  }

  login() {
    return this.client.login(this.token);
  }
}