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
    injectionMode: InjectionMode.CLASSIC
  });

  // 모든 의존성을 한 번에 등록 (의존성 순서를 고려하여 정렬)
  container.register({
    // 1. 외부 의존성 (값)
    client: asValue(client),
    token: asValue(config.TOKEN),
    guildId: asValue(config.GUILDID),
    logChannelId: asValue(config.LOG_CHANNEL_ID),
    forumChannelId: asValue(config.FORUM_CHANNEL_ID),
    voiceCategoryId: asValue(config.VOICE_CATEGORY_ID),
    forumTagId: asValue(config.FORUM_TAG_ID),

    // 2. 기반 서비스 (의존성이 거의 없거나 외부 의존성만 가짐)
    dbManager: asClass(DatabaseManager).singleton(),
    databaseManager: asClass(DatabaseManager).singleton(), // Alias
    logService: asClass(LogService).singleton(),
    eventManager: asClass(EventManager).singleton(),
    participantTracker: asClass(ParticipantTracker).singleton(),
    voiceChannelManager: asClass(VoiceChannelManager).singleton(),
    forumPostManager: asClass(ForumPostManager).singleton(),
    recruitmentUIBuilder: asClass(RecruitmentUIBuilder).singleton(),

    // 3. 복합 서비스 (기반 서비스에 의존)
    mappingService: asClass(MappingService).singleton(),
    activityTracker: asClass(ActivityTracker).singleton(),
    userClassificationService: asClass(UserClassificationService).singleton(),
    recruitmentService: asClass(RecruitmentService).singleton(),
    
    // 4. UI 핸들러 (복합 서비스에 의존)
    modalHandler: asClass(ModalHandler).singleton(),
    buttonHandler: asClass(ButtonHandler).singleton(),
    interactionRouter: asClass(InteractionRouter).singleton(),
    emojiReactionService: asClass(EmojiReactionService).singleton(),

    // 5. 최종 통합 서비스 (가장 복잡한 의존성)
    // 생성자가 모든 의존성을 담은 객체 하나를 인자로 받으므로, 팩토리 함수로 컨테이너 프록시(c)를 전달
    voiceChannelForumIntegrationService: asFunction((c) => new VoiceChannelForumIntegrationService(c)).singleton(),
    voiceForumService: asFunction((c) => new VoiceChannelForumIntegrationService(c)).singleton(), // Alias

    // 6. 명령어 (각자 필요한 서비스에 의존)
    gapConfigCommand: asClass(GapConfigCommand).singleton(),
    timeConfirmCommand: asClass(TimeConfirmCommand).singleton(),
    timeCheckCommand: asClass(TimeCheckCommand).singleton(),
    gapReportCommand: asClass(GapReportCommand).singleton(),
    gapAfkCommand: asClass(GapAfkCommand).singleton(),
    // 생성자가 services 객체를 받으므로, 필요한 서비스를 담아 팩토리 함수로 생성
    recruitmentCommand: asFunction(({ voiceForumService }) => new RecruitmentCommand({ voiceForumService })).singleton(),
    nicknameCommand: asFunction(({ voiceChannelManager }) => new NicknameCommand({ voiceChannelManager })).singleton(),

    // 7. 명령어 핸들러 (최상위)
    // CommandHandler의 생성자가 여러 인자를 받으므로 asClass로 자동 주입
    commandHandler: asClass(CommandHandler).singleton()
  });

  return container;
}

/**
 * 컨테이너 초기화
 * 모든 서비스들의 초기화 메서드를 순서대로 호출
 * @param {AwilixContainer} container - DI 컨테이너
 */
export async function initializeContainer(container) {
  try {
    // 1. 데이터베이스 초기화 (가장 먼저)
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
 * 모든 리소스를 정리
 * @param {AwilixContainer} container - DI 컨테이너
 */
export async function disposeContainer(container) {
  try {
    // 데이터베이스 연결 종료
    const dbManager = container.resolve('dbManager');
    await dbManager.close();

    // 컨테이너 해제
    container.dispose();
    
    console.log('DI Container가 안전하게 해제되었습니다.');
  } catch (error) {
    console.error('DI Container 해제 중 오류 발생:', error);
    throw error;
  }
}
