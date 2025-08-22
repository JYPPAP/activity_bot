// src/container.js - DI Container 설정
import { createContainer, asClass, asValue, asFunction, InjectionMode } from 'awilix';
import { config } from './config/env.js';

// 서비스 임포트
import { DatabaseManager } from './services/DatabaseManager.js';
import { LogService } from './services/logService.js';
import { ActivityTracker } from './services/activityTracker.js';
import { EventManager } from './services/eventManager.js';
import { VoiceChannelForumIntegrationService } from './services/VoiceChannelForumIntegrationService.js';
import { EmojiReactionService } from './services/EmojiReactionService.js';
import { UserClassificationService } from './services/UserClassificationService.js';
import { ParticipantTracker } from './services/ParticipantTracker.js';
import { VoiceChannelManager } from './services/VoiceChannelManager.js';
import { ForumPostManager } from './services/ForumPostManager.js';
import { MappingService } from './services/MappingService.js';
import { RecruitmentService } from './services/RecruitmentService.js';

// UI 관련 임포트
import { ButtonHandler } from './ui/ButtonHandler.js';
import { ModalHandler } from './ui/ModalHandler.js';
import { InteractionRouter } from './ui/InteractionRouter.js';
import { RecruitmentUIBuilder } from './ui/RecruitmentUIBuilder.js';

// 명령어 관련 임포트
import { CommandHandler } from './commands/commandHandler.js';
import { GapConfigCommand } from './commands/gapConfigCommand.js';
import { TimeConfirmCommand } from './commands/TimeConfirmCommand.js';
import { TimeCheckCommand } from './commands/TimeCheckCommand.js';
import { GapReportCommand } from './commands/gapReportCommand.js';
import { GapAfkCommand } from './commands/gapAfkCommand.js';
import { RecruitmentCommand } from './commands/recruitmentCommand.js';
import { NicknameCommand } from './commands/NicknameCommand.js';

/**
 * DI Container 생성 및 설정
 * @param {Client} client - Discord 클라이언트 인스턴스
 * @returns {AwilixContainer} 설정된 컨테이너
 */
export function createDIContainer(client) {
  const container = createContainer({
    injectionMode: InjectionMode.CLASSIC,
  });

  // 외부 의존성 등록 (값)
  container.register({
    client: asValue(client),
    token: asValue(config.TOKEN),
    guildId: asValue(config.GUILDID),
    logChannelId: asValue(config.LOG_CHANNEL_ID),
    forumChannelId: asValue(config.FORUM_CHANNEL_ID),
    voiceCategoryId: asValue(config.VOICE_CATEGORY_ID),
    forumTagId: asValue(config.FORUM_TAG_ID),
  });

  // 기반 서비스들
  container.register({
    dbManager: asClass(DatabaseManager).singleton(),
    databaseManager: asFunction((dbManager) => dbManager).singleton(),
    logService: asClass(LogService).singleton(),
    eventManager: asClass(EventManager).singleton(),
    participantTracker: asClass(ParticipantTracker).singleton(),
  });

  console.log('DB alias same?', container.resolve('dbManager') === container.resolve('databaseManager'));

  // 음성/포럼 관련 개별 서비스
  container.register({
    voiceChannelManager: asClass(VoiceChannelManager).singleton(),
    forumPostManager: asClass(ForumPostManager).singleton(),
  });

  // 복합 서비스
  container.register({
    mappingService: asClass(MappingService).singleton(),
    activityTracker: asClass(ActivityTracker).singleton(),
    userClassificationService: asClass(UserClassificationService).singleton(),
  });

  // 통합/부가 서비스
  container.register({
    emojiReactionService: asClass(EmojiReactionService).singleton(),
    recruitmentService: asClass(RecruitmentService).singleton(),
  });

  // UI 계층
  container.register({
    recruitmentUIBuilder: asClass(RecruitmentUIBuilder).singleton(),
    buttonHandler: asClass(ButtonHandler).singleton(),
    modalHandler: asClass(ModalHandler).singleton(),
    interactionRouter: asClass(InteractionRouter).singleton(),
  });

  // === 통합 서비스 등록 (CLASSIC 모드: 매개변수 이름으로 주입) ===
  container.register({
    voiceChannelForumIntegrationService: asFunction((
        client,
        forumChannelId,
        voiceCategoryId,
        dbManager,
        voiceChannelManager,
        forumPostManager,
        participantTracker,
        mappingService,
        recruitmentService,
        modalHandler,
        buttonHandler,
        interactionRouter
      ) =>
        new VoiceChannelForumIntegrationService({
          client,
          forumChannelId,
          voiceCategoryId,
          dbManager,
          voiceChannelManager,
          forumPostManager,
          participantTracker,
          mappingService,
          recruitmentService,
          modalHandler,
          buttonHandler,
          interactionRouter,
        })
    ).singleton(),
  });

  container.register({
    voiceForumService: asFunction((voiceChannelForumIntegrationService) =>
      voiceChannelForumIntegrationService
    ).singleton(),
  });

  // === services 번들 (CLASSIC 모드: 개별 파라미터 나열) ===
  container.register({
    services: asFunction((
      client,
      dbManager,
      activityTracker,
      voiceForumService,
      voiceChannelManager,
      forumPostManager,
      mappingService,
      recruitmentService,
      logService,
      participantTracker,
      emojiReactionService,
      userClassificationService
    ) => ({
      client,
      dbManager,
      activityTracker,
      voiceForumService,
      voiceChannelManager,
      forumPostManager,
      mappingService,
      recruitmentService,
      logService,
      participantTracker,
      emojiReactionService,
      userClassificationService
    })).singleton()
  });

  // 명령어들
  container.register({
    gapConfigCommand: asClass(GapConfigCommand).singleton(),
    timeConfirmCommand: asClass(TimeConfirmCommand).singleton(),
    timeCheckCommand: asClass(TimeCheckCommand).singleton(),
    gapReportCommand: asClass(GapReportCommand).singleton(),
    gapAfkCommand: asClass(GapAfkCommand).singleton(),
    recruitmentCommand: asClass(RecruitmentCommand).singleton(),
    nicknameCommand: asClass(NicknameCommand).singleton(),
  });

  // 명령어 핸들러 (CLASSIC 모드: 파라미터 이름과 등록 키 일치)
  container.register({
    commandHandler: asFunction((
      client,
      activityTracker,
      dbManager,
      voiceForumService,
      userClassificationService,
      gapConfigCommand,
      timeConfirmCommand,
      timeCheckCommand,
      gapReportCommand,
      gapAfkCommand,
      recruitmentCommand,
      nicknameCommand
    ) => new CommandHandler(
      client,
      activityTracker,
      dbManager,
      voiceForumService,
      userClassificationService,
      gapConfigCommand,
      timeConfirmCommand,
      timeCheckCommand,
      gapReportCommand,
      gapAfkCommand,
      recruitmentCommand,
      nicknameCommand
    )).singleton(),
  });

  return container;
}

/**
 * 컨테이너 초기화
 */
export async function initializeContainer(container) {
  try {
    const dbManager = container.resolve('dbManager');
    await dbManager.initialize();
    console.log('DI Container 및 서비스들이 성공적으로 초기화되었습니다.');
    return true;
  } catch (error) {
    console.error('DI Container 초기화 중 오류 발생:', error);
    throw error;
  }
}

/**
 * 컨테이너 해제
 */
export async function disposeContainer(container) {
  try {
    const dbManager = container.resolve('dbManager');
    await dbManager.close();
    container.dispose();
    console.log('DI Container가 안전하게 해제되었습니다.');
  } catch (error) {
    console.error('DI Container 해제 중 오류 발생:', error);
    throw error;
  }
}
