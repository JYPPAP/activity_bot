// src/bot.js - 봇 클래스 정의 (SQLite 버전)
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { EventManager } from './services/eventManager.js';
import { ActivityTracker } from './services/activityTracker.js';
import { LogService } from './services/logService.js';
import { CalendarLogService } from './services/calendarLogService.js';
import { CommandHandler } from './commands/commandHandler.js';
import { FileManager } from './services/fileManager.js'; // 마이그레이션용으로 유지
import { DatabaseManager } from './services/databaseManager.js'; // 새로운 DB 관리자
import { config } from './config/env.js';
import { PATHS } from './config/constants.js';
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
      ],
    });

    // 각 서비스 인스턴스 생성 (FileManager → DatabaseManager로 변경)
    this.dbManager = new DatabaseManager();
    this.fileManager = new FileManager(); // 마이그레이션용으로 유지
    this.logService = new LogService(this.client, config.LOG_CHANNEL_ID);
    this.calendarLogService = new CalendarLogService(this.client, this.dbManager);
    this.activityTracker = new ActivityTracker(this.client, this.dbManager, this.logService);
    this.commandHandler = new CommandHandler(
        this.client,
        this.activityTracker,
        this.dbManager,
        this.calendarLogService
    );
    this.eventManager = new EventManager(this.client);

    Bot.instance = this;
  }

  async initialize() {
    // 데이터베이스 초기화
    await this.dbManager.initialize();

    // JSON 데이터 마이그레이션 (필요시)
    await this.migrateDataIfNeeded();

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

      // 달력 로그 서비스 초기화
      await this.calendarLogService.initialize();
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

        console.log('JSON 데이터를 SQLite 데이터베이스로 마이그레이션합니다...');

        // JSON 파일 로드
        const activityData = this.fileManager.loadJSON(PATHS.ACTIVITY_INFO);
        const roleConfigData = this.fileManager.loadJSON(PATHS.ROLE_CONFIG);

        // 마이그레이션 실행
        const success = await this.dbManager.migrateFromJSON(activityData, roleConfigData);

        if (success) {
          console.log('마이그레이션이 성공적으로 완료되었습니다!');

          // 마이그레이션 완료 후 백업 파일 생성
          const timestamp = new Date().toISOString().replace(/:/g, '-');
          fs.copyFileSync(PATHS.ACTIVITY_INFO, `${PATHS.ACTIVITY_INFO}.${timestamp}.bak`);
          fs.copyFileSync(PATHS.ROLE_CONFIG, `${PATHS.ROLE_CONFIG}.${timestamp}.bak`);

          console.log('기존 JSON 파일의 백업이 생성되었습니다.');
        }
      } else if (hasData) {
        console.log('데이터베이스에 이미 데이터가 있어 마이그레이션을 건너뜁니다.');
      } else {
        console.log('마이그레이션할 JSON 파일이 없습니다. 새 데이터베이스로 시작합니다.');
      }
    } catch (error) {
      console.error('데이터 마이그레이션 중 오류 발생:', error);
    }
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

  /**
   * 종료 시 리소스 정리
   */
  async shutdown() {
    console.log('봇을 종료합니다...');

    // 남은 활동 데이터 저장
    await this.activityTracker.saveActivityData();

    // 데이터베이스 연결 종료
    await this.dbManager.close();

    // 클라이언트 연결 종료
    if (this.client) {
      this.client.destroy();
    }

    console.log('봇이 안전하게 종료되었습니다.');
  }
}