// src/bot.js - 봇 클래스 정의 (SQLite 버전)
import {Client, GatewayIntentBits, Events} from 'discord.js';
import {EventManager} from './services/eventManager.js';
import {ActivityTracker} from './services/activityTracker.js';
import {LogService} from './services/logService.js';
import {CalendarLogService} from './services/calendarLogService.js';
import {CommandHandler} from './commands/commandHandler.js';
import {UserClassificationService} from './services/UserClassificationService.js';
import {DatabaseManager} from './services/DatabaseManager.js'; // 새로운 DB 관리자
import {JobPostCleanupService} from './services/jobPostCleanupService.js';
import {EmbedFactory} from './utils/embedBuilder.js';
import {config} from './config/env.js';
import {PATHS} from './config/constants.js';
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

    // 각 서비스 인스턴스 생성 (FileManager 제거)
    this.dbManager = new DatabaseManager();
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
    this.jobPostCleanupService = new JobPostCleanupService(this.client, this.dbManager);

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

      // 구인구직 서비스 초기화
      await this.commandHandler.initializeJobPostService();
      
      // 구인구직 정리 서비스 초기화
      await this.jobPostCleanupService.initialize();

      // 여러 역할 출력 일정 설정 추가
      await this.scheduleRoleListings(guild);
    });
  }

  /**
   * 역할별 출력 일정 설정
   * @param {Guild} guild - 디스코드 길드 객체
   */
  async scheduleRoleListings(guild) {
    try {
      // 모든 역할 설정 가져오기
      const roleConfigs = await this.dbManager.getAllRoleConfigs();
      if (!roleConfigs || roleConfigs.length === 0) {
        console.log('설정된 역할이 없습니다.');
        return;
      }

      // UserClassificationService 인스턴스 생성
      const userClassificationService = new UserClassificationService(this.dbManager, this.activityTracker);

      console.log(`${roleConfigs.length}개 역할에 대한 출력 일정을 설정합니다.`);

      for (const roleConfig of roleConfigs) {
        const roleName = roleConfig.roleName;
        // 역할별 출력 주기 설정 (인턴은 1주일, 나머지는 2주일)
        const interval = roleName.toLowerCase().includes('인턴')
          ? 7 * 24 * 60 * 60 * 1000  // 1주일
          : 14 * 24 * 60 * 60 * 1000; // 2주일

        // 일정 시간 후 첫 출력 실행 (역할별로 시간차를 두어 동시 출력 방지)
        const initialDelay = 1000 * 60 * 60 * (1 + roleConfigs.indexOf(roleConfig)); // 역할별로 1시간씩 차이

        setTimeout(() => {
          // 첫 출력 실행
          this.generateRoleReport(guild, roleName, userClassificationService);

          // 이후 정기적으로 실행
          setInterval(() => {
            this.generateRoleReport(guild, roleName, userClassificationService);
          }, interval);

          console.log(`${roleName} 역할의 출력 일정이 설정되었습니다 (주기: ${interval / (24 * 60 * 60 * 1000)}일)`);
        }, initialDelay);
      }
    } catch (error) {
      console.error('역할 출력 일정 설정 오류:', error);
    }
  }


  /**
   * 역할별 보고서 생성 메서드 (UserClassificationService 활용)
   * @param {Guild} guild - 디스코드 길드 객체
   * @param {string} roleName - 역할 이름
   * @param {UserClassificationService} userClassificationService - 사용자 분류 서비스 (선택적)
   */
  async generateRoleReport(guild, roleName, userClassificationService = null) {
    try {
      console.log(`${roleName} 역할에 대한 보고서 생성 시작...`);

      // 로그 채널 가져오기
      const logChannelId = config.LOG_CHANNEL_ID;
      const logChannel = await this.client.channels.fetch(logChannelId);
      if (!logChannel) {
        console.error('로그 채널을 찾을 수 없습니다.');
        return;
      }

      // 역할 멤버 가져오기
      const members = await guild.members.fetch();
      const roleMembers = members.filter(member =>
        member.roles.cache.some(r => r.name === roleName)
      );

      // UserClassificationService가 제공되지 않은 경우 생성
      if (!userClassificationService) {
        userClassificationService = new UserClassificationService(this.dbManager, this.activityTracker);
      }

      // 사용자 분류 서비스를 사용하여 멤버 분류
      const {activeUsers, inactiveUsers, afkUsers, resetTime, minHours} =
        await userClassificationService.classifyUsers(roleName, roleMembers);

      // EmbedFactory를 사용하여 임베드 생성
      const reportEmbeds = EmbedFactory.createActivityEmbeds(
        roleName, activeUsers, inactiveUsers, afkUsers, resetTime, minHours, '활동 보고서'
      );

      // 임베드 전송
      for (const embed of reportEmbeds) {
        await logChannel.send({embeds: [embed]});
      }

      console.log(`${roleName} 역할에 대한 보고서가 생성되었습니다.`);
    } catch (error) {
      console.error(`${roleName} 역할 보고서 생성 오류:`, error);
    }
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

    // 채널 생성 이벤트 (구인구직 연동)
    this.eventManager.registerHandler(
      Events.ChannelCreate,
      this.commandHandler.handleChannelCreate.bind(this.commandHandler)
    );

    // 채널 삭제 이벤트 (구인구직 연동)
    this.eventManager.registerHandler(
      Events.ChannelDelete,
      this.commandHandler.handleChannelDelete.bind(this.commandHandler)
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