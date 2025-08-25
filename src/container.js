// src/container.js - DI Container 설정 (통합 개선 버전)
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
 * 베스트 프랙티스 적용:
 * 1. 계층별 등록으로 의존성 그래프 명확화
 * 2. 불필요한 래핑 제거
 * 3. 성능 최적화 (strict mode)
 * 4. 메모리 누수 방지
 * 
 * @param {Client} client - Discord 클라이언트 인스턴스
 * @returns {AwilixContainer} 설정된 컨테이너
 */
export function createDIContainer(client) {
  const container = createContainer({
    injectionMode: InjectionMode.CLASSIC,
    // 성능 최적화: 엄격한 등록 검사 활성화
    strict: true,
  });

  // === 1. 설정 및 외부 의존성 (값) ===
  container.register({
    client: asValue(client),
    token: asValue(config.TOKEN),
    guildId: asValue(config.GUILDID),
    logChannelId: asValue(config.LOG_CHANNEL_ID),
    forumChannelId: asValue(config.FORUM_CHANNEL_ID),
    voiceCategoryId: asValue(config.VOICE_CATEGORY_ID),
    forumTagId: asValue(config.FORUM_TAG_ID),
  });

  // === 2. 인프라 계층 (데이터베이스, 로깅) ===
  container.register({
    dbManager: asClass(DatabaseManager).singleton(),
    databaseManager: asClass(DatabaseManager).singleton(), // 호환성을 위한 별칭
    logService: asClass(LogService).singleton(),
  });

  // === 3. 코어 서비스 계층 ===
  container.register({
    eventManager: asClass(EventManager).singleton(),
    participantTracker: asClass(ParticipantTracker).singleton(),
    activityTracker: asClass(ActivityTracker).singleton(),
  });

  // === 4. 도메인 서비스 계층 ===
  container.register({
    voiceChannelManager: asClass(VoiceChannelManager).singleton(),
    forumPostManager: asFunction((client, forumChannelId, forumTagId, dbManager) =>
      new ForumPostManager(client, forumChannelId, forumTagId, dbManager)
    ).singleton(),
    mappingService: asFunction((client, voiceChannelManager, forumPostManager, dbManager) =>
      new MappingService(client, voiceChannelManager, forumPostManager, dbManager)
    ).singleton(),
    userClassificationService: asClass(UserClassificationService).singleton(),
  });

  // === 5. 애플리케이션 서비스 계층 ===
  container.register({
    recruitmentService: asClass(RecruitmentService).singleton(),
    emojiReactionService: asClass(EmojiReactionService).singleton(),
    // 객체 구조분해 할당을 위해 asFunction 사용
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

  // === 6. UI 계층 ===
  container.register({
    recruitmentUIBuilder: asClass(RecruitmentUIBuilder).singleton(),
    buttonHandler: asClass(ButtonHandler).singleton(),
    modalHandler: asClass(ModalHandler).singleton(),
    interactionRouter: asClass(InteractionRouter).singleton(),
  });

  // === 7. 명령어 계층 ===
  container.register({
    gapConfigCommand: asClass(GapConfigCommand).singleton(),
    timeConfirmCommand: asClass(TimeConfirmCommand).singleton(),
    timeCheckCommand: asClass(TimeCheckCommand).singleton(),
    gapReportCommand: asClass(GapReportCommand).singleton(),
    gapAfkCommand: asClass(GapAfkCommand).singleton(),
    recruitmentCommand: asClass(RecruitmentCommand).singleton(),
    nicknameCommand: asClass(NicknameCommand).singleton(),
  });

  // === 8. 통합 계층 ===
  container.register({
    commandHandler: asClass(CommandHandler).singleton(),
  });

  // === 9. 호환성 서비스 번들 (기존 명령어들을 위한 최소 번들) ===
  container.register({
    services: asFunction((client, dbManager, activityTracker, voiceChannelForumIntegrationService) => ({
      client,
      dbManager,
      activityTracker,
      voiceForumService: voiceChannelForumIntegrationService, // 호환성을 위한 별칭
    })).singleton(),
  });

  return container;
}

/**
 * 성능 모니터링이 포함된 컨테이너 초기화
 */
export async function initializeContainer(container) {
  const startTime = performance.now();
  
  try {
    // 의존성 그래프 검증
    await validateDependencyGraph(container);
    
    // 데이터베이스 초기화
    const dbManager = container.resolve('dbManager');
    await dbManager.initialize();
    
    const initTime = performance.now() - startTime;
    console.log(`DI Container 초기화 완료 (${initTime.toFixed(2)}ms)`);
    
    return true;
  } catch (error) {
    console.error('DI Container 초기화 중 오류 발생:', error);
    throw error;
  }
}

/**
 * 메모리 누수 방지를 위한 안전한 컨테이너 해제
 */
export async function disposeContainer(container) {
  try {
    // 1. 데이터베이스 연결 종료
    const dbManager = container.resolve('dbManager');
    await dbManager.close();
    
    // 2. 이벤트 리스너 정리 (EventManager)
    const eventManager = container.resolve('eventManager');
    if (eventManager.cleanup) {
      await eventManager.cleanup();
    }
    
    // 3. 컨테이너 해제
    await container.dispose();
    
    console.log('DI Container가 안전하게 해제되었습니다.');
  } catch (error) {
    console.error('DI Container 해제 중 오류 발생:', error);
    throw error;
  }
}

/**
 * 의존성 그래프 검증 함수
 */
async function validateDependencyGraph(container) {
  try {
    // 핵심 서비스들의 해결 가능성 검증
    const criticalServices = [
      'dbManager', 'logService', 'eventManager', 
      'activityTracker', 'commandHandler'
    ];
    
    for (const service of criticalServices) {
      container.resolve(service);
    }
    
    console.log('의존성 그래프 검증 완료');
  } catch (error) {
    console.error('의존성 그래프 검증 실패:', error);
    throw new Error(`의존성 해결 실패: ${error.message}`);
  }
}

/**
 * 컨테이너 헬스 체크
 */
export function checkContainerHealth(container) {
  try {
    const services = container.cradle;
    const serviceCount = Object.keys(services).length;
    
    return {
      healthy: true,
      serviceCount,
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}