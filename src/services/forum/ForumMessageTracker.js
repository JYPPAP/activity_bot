import { logger } from '../../config/logger-termux.js';

export class ForumMessageTracker {
  constructor(deps) {
    this.client = deps.client;
    this.forumChannelId = deps.forumChannelId;
    this.forumTagId = deps.forumTagId;
    this.databaseManager = deps.databaseManager;
    this.parent = deps.parent;
  }

  async _deleteTrackedMessages(threadId, messageType) {
    if (!this.databaseManager) {
      logger.warn('[ForumPostManager] DatabaseManager가 설정되지 않음');
      return false;
    }

    // 데이터베이스 초기화 상태 확인
    if (!this.databaseManager.isInitialized) {
      logger.warn('[ForumPostManager] 데이터베이스가 초기화되지 않음');
      return false;
    }

    try {
      // 데이터베이스에서 추적된 메시지 ID들 가져오기
      const messageIds = await this.databaseManager.getTrackedMessages(threadId, messageType);
      
      if (messageIds.length === 0) {
        logger.info(`[ForumPostManager] 삭제할 메시지가 없음: ${threadId}, ${messageType}`);
        return true; // 삭제할 메시지가 없음
      }

      // 스레드 가져오기 (재시도 로직 포함)
      let thread = null;
      for (let retry = 0; retry < 3; retry++) {
        try {
          thread = await this.client.channels.fetch(threadId);
          if (thread && thread.isThread()) {
            break;
          }
        } catch (fetchError) {
          if (fetchError.code === 10003) { // Unknown Channel
            logger.warn(`[ForumPostManager] 스레드가 삭제됨: ${threadId}`);
            // 스레드가 삭제된 경우 추적 정보만 정리
            await this.databaseManager.clearTrackedMessages(threadId, messageType);
            return true;
          }
          
          if (retry === 2) throw fetchError;
          logger.warn(`[ForumPostManager] 스레드 가져오기 재시도 ${retry + 1}/3: ${threadId}`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기
        }
      }

      if (!thread || !thread.isThread()) {
        logger.warn(`[ForumPostManager] 유효하지 않은 스레드: ${threadId}`);
        // 유효하지 않은 스레드의 경우 추적 정보만 정리
        await this.databaseManager.clearTrackedMessages(threadId, messageType);
        return false;
      }

      let deletedCount = 0;
      let failedIds = [];
      
      // 각 메시지 삭제 시도 (배치 처리)
      const deletePromises = messageIds.map(async (messageId) => {
        try {
          const message = await thread.messages.fetch(messageId);
          if (message) {
            await message.delete();
            deletedCount++;
            logger.info(`[ForumPostManager] 메시지 삭제 완료: ${messageId}`);
            return { success: true, messageId };
          }
        } catch (deleteError) {
          if (deleteError.code === 10008) { // Unknown Message
            logger.info(`[ForumPostManager] 메시지가 이미 삭제됨: ${messageId}`);
            return { success: true, messageId }; // 이미 삭제된 것으로 간주
          } else {
            logger.warn(`[ForumPostManager] 메시지 삭제 실패: ${messageId}`, { error: deleteError.message });
            failedIds.push(messageId);
            return { success: false, messageId, error: deleteError.message };
          }
        }
      });

      // 모든 삭제 작업 완료 대기 (최대 10초)
      try {
        await Promise.allSettled(deletePromises);
      } catch (error) {
        logger.error(`[ForumPostManager] 메시지 삭제 배치 처리 오류: ${threadId}`, { error: error.message, stack: error.stack });
      }

      // 데이터베이스에서 추적 정보 삭제 (실패한 메시지가 있어도 진행)
      try {
        await this.databaseManager.clearTrackedMessages(threadId, messageType);
        logger.info(`[ForumPostManager] 추적 정보 정리 완료: ${threadId}, ${messageType}`);
      } catch (clearError) {
        logger.error(`[ForumPostManager] 추적 정보 정리 실패: ${threadId}, ${messageType}`, { error: clearError.message, stack: clearError.stack });
        // 추적 정보 정리 실패해도 계속 진행
      }
      
      if (failedIds.length > 0) {
        logger.warn(`[ForumPostManager] 일부 메시지 삭제 실패: ${threadId}, ${messageType}, 실패 ${failedIds.length}개: ${failedIds.join(', ')}`);
      }
      
      logger.info(`[ForumPostManager] 추적된 메시지 삭제 완료: ${threadId}, ${messageType}, 성공 ${deletedCount}/${messageIds.length}개`);
      return failedIds.length === 0; // 모든 메시지가 성공적으로 삭제된 경우에만 true

    } catch (error) {
      logger.error(`[ForumPostManager] 추적된 메시지 삭제 오류: ${threadId}, ${messageType}`, { error: error.message, stack: error.stack });
      
      // 심각한 오류 발생 시에도 추적 정보는 정리 시도
      try {
        await this.databaseManager.clearTrackedMessages(threadId, messageType);
        logger.info(`[ForumPostManager] 오류 발생 후 추적 정보 정리 완료: ${threadId}, ${messageType}`);
      } catch (clearError) {
        logger.error(`[ForumPostManager] 오류 발생 후 추적 정보 정리 실패: ${threadId}, ${messageType}`, { error: clearError.message, stack: clearError.stack });
      }
      
      return false;
    }
  }

  async _trackMessage(threadId, messageType, messageId) {
    if (!this.databaseManager) {
      logger.warn('[ForumPostManager] DatabaseManager가 설정되지 않음');
      return false;
    }

    try {
      await this.databaseManager.trackForumMessage(threadId, messageType, messageId);
      logger.info(`[ForumPostManager] 메시지 추적 저장: ${threadId}, ${messageType}, ${messageId}`);
      return true;
    } catch (error) {
      logger.error(`[ForumPostManager] 메시지 추적 저장 오류: ${threadId}, ${messageType}, ${messageId}`, { error: error.message, stack: error.stack });
      return false;
    }
  }
}
