// src/commands/TimeConfirmCommand.js - 시간확인 명령어 (개인용)
import {MessageFlags} from 'discord.js';
import {SafeInteraction} from '../utils/SafeInteraction.js';
import {TimeActivityHelper} from '../utils/TimeActivityHelper.js';
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
      const user = interaction.user;
      const userId = user.id;

      // 기본 날짜 범위 계산 (이번 달 1일 ~ 오늘)
      const { startDate, endDate } = TimeActivityHelper.calculateDefaultDateRange();

      logger.commandExecution('자동 설정된 날짜', { 
        component: 'TimeConfirmCommand', 
        startDate: startDate.toISOString(), 
        endDate: endDate.toISOString(), 
        userId 
      });

      logger.commandExecution('DB에서 사용자 활동 시간 조회 시작', { 
        component: 'TimeConfirmCommand', 
        userId, 
        startDate: startDate.toISOString(), 
        endDate: endDate.toISOString() 
      });

      // 활동 시간 조회 및 검증 (Helper 사용)
      const { totalTime, formattedTime } = await TimeActivityHelper.getAndValidateActivityTime(
        this.db, 
        this.activityTracker, 
        userId, 
        startDate, 
        endDate, 
        'TimeConfirmCommand'
      );

      // 날짜 범위 메시지 생성 (Helper 사용)
      const dateRangeMessage = TimeActivityHelper.formatDateRange(startDate, endDate);

      // 응답 메시지 생성 (Helper 사용)
      const displayName = interaction.member?.displayName || user.username;
      const responseMessage = TimeActivityHelper.createResponseMessage(displayName, dateRangeMessage, formattedTime);

      // 응답 전송
      await SafeInteraction.safeReply(interaction, {
        content: responseMessage,
        flags: MessageFlags.Ephemeral,
      });

      // 명령어 실행 완료 로그 (Helper 사용)
      TimeActivityHelper.logCommandExecution('TimeConfirmCommand', '시간확인', {
        userId,
        totalTimeMs: totalTime,
        formattedTime,
        dateRange: dateRangeMessage
      });

    } catch (error) {
      // 에러 처리 (Helper 사용)
      TimeActivityHelper.handleCommandError(interaction, error, 'TimeConfirmCommand');
      
      await SafeInteraction.safeReply(interaction, {
        content: '활동 시간 확인 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}