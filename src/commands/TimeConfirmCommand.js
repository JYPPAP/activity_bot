// src/commands/TimeConfirmCommand.js - 시간확인 명령어 (개인용)
import {MessageFlags} from 'discord.js';
import {formatTime} from '../utils/formatters.js';
import {SafeInteraction} from '../utils/SafeInteraction.js';
import { logger } from '../config/logger-termux.js';

export class TimeConfirmCommand {
  constructor(activityTracker, dbManager) {
    this.activityTracker = activityTracker;
    this.db = dbManager;
  }

  /**
   * 시간확인 명령어를 실행합니다.
   * @param interaction - 상호작용 객체
   */
  async execute(interaction) {
    await SafeInteraction.safeDeferReply(interaction, {flags: MessageFlags.Ephemeral});

    try {
      // 명령어를 실행한 사용자 정보 가져오기
      const user = interaction.user;
      const userId = user.id;

      // 현재 활동 데이터는 실시간으로 추적되므로 별도 저장 불필요 (성능 최적화)

      // 자동 날짜 설정: 이번 달 1일 ~ 오늘
      const today = new Date();
      const startDate = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);
      const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

      logger.commandExecution('자동 설정된 날짜', { component: 'TimeConfirmCommand', startDate: startDate.toISOString(), endDate: endDate.toISOString(), userId: interaction.user.id });

      // 메모리에서 현재 활동 상태 확인 (디버깅용)
      const memoryData = this.activityTracker.getMemoryActivityData(userId);
      if (memoryData) {
        logger.warn('⚠️ 메모리에서 데이터 조회 (DB 대신 메모리 사용)', { 
          component: 'TimeConfirmCommand', 
          issue: 'MEMORY_DATA_USAGE', 
          userId, 
          totalTimeMinutes: Math.round(memoryData.totalTime / 1000 / 60),
          currentSessionMinutes: Math.round(memoryData.currentSessionTime / 1000 / 60),
          isCurrentlyActive: memoryData.isCurrentlyActive,
          totalWithCurrentMinutes: Math.round(memoryData.totalWithCurrent / 1000 / 60)
        });
      } else {
        logger.warn('⚠️ 메모리 데이터 없음 (DB 대신 메모리 조회)', { component: 'TimeConfirmCommand', issue: 'NO_MEMORY_DATA', userId });
      }

      // 특정 기간의 활동 시간 조회
      const totalTime = await this.db.getUserActivityByDateRange(
        userId,
        startDate.getTime(),
        endDate.getTime()
      );

      // 날짜 범위 메시지 작성
      const startDateFormatted = `${startDate.getFullYear()}.${(startDate.getMonth() + 1).toString().padStart(2, '0')}.${startDate.getDate().toString().padStart(2, '0')}`;
      const endDateFormatted = `${endDate.getFullYear()}.${(endDate.getMonth() + 1).toString().padStart(2, '0')}.${endDate.getDate().toString().padStart(2, '0')}`;
      const dateRangeMessage = ` ${startDateFormatted} ~ ${endDateFormatted} 기간`;

      // 총 활동 시간 포맷팅
      const formattedTime = formatTime(totalTime);

      // 응답 전송
      await SafeInteraction.safeReply(interaction, {
        content: `${interaction.member?.displayName || user.username}님의${dateRangeMessage} 활동 시간은 ${formattedTime} 입니다.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.error('시간확인 명령어 실행 오류', { component: 'TimeConfirmCommand', error: error.message, stack: error.stack, userId: interaction.user.id });
      await SafeInteraction.safeReply(interaction, {
        content: '활동 시간 확인 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}