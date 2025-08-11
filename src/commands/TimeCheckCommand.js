// src/commands/TimeCheckCommand.js - 시간체크 명령어 (관리자용)
import {MessageFlags} from 'discord.js';
import {SafeInteraction} from '../utils/SafeInteraction.js';
import {TimeActivityHelper} from '../utils/TimeActivityHelper.js';
import { logger } from '../config/logger-termux.js';

export class TimeCheckCommand {
  constructor(activityTracker, dbManager) {
    this.activityTracker = activityTracker;
    this.db = dbManager;
  }


  /**
   * 시간체크 명령어를 실행합니다.
   * @param interaction - 상호작용 객체
   */
  async execute(interaction) {
    await SafeInteraction.safeDeferReply(interaction, {flags: MessageFlags.Ephemeral});

    try {
      const targetUser = interaction.options.getUser('user');
      const targetUserId = targetUser.id;
      const startDateOption = interaction.options.getString('start_date');
      const endDateOption = interaction.options.getString('end_date');

      // 날짜 범위 처리 (Helper 사용)
      const dateResult = TimeActivityHelper.processDateRange(startDateOption, endDateOption);
      
      if (dateResult.error) {
        await SafeInteraction.safeReply(interaction, {
          content: dateResult.error,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const { startDate, endDate } = dateResult;

      logger.commandExecution('시간체크 날짜 범위 설정', { 
        component: 'TimeCheckCommand', 
        startDate: startDate.toISOString(), 
        endDate: endDate.toISOString(), 
        userId: interaction.user.id 
      });

      logger.commandExecution('DB에서 대상 사용자 활동 시간 조회 시작', { 
        component: 'TimeCheckCommand', 
        targetUserId, 
        executedBy: interaction.user.id,
        startDate: startDate.toISOString(), 
        endDate: endDate.toISOString() 
      });

      // 활동 시간 조회 및 검증 (Helper 사용)
      const { totalTime, formattedTime } = await TimeActivityHelper.getAndValidateActivityTime(
        this.db, 
        this.activityTracker, 
        targetUserId, 
        startDate, 
        endDate, 
        'TimeCheckCommand',
        { executedBy: interaction.user.id }
      );

      // 날짜 범위 메시지 생성 (Helper 사용)
      const dateRangeMessage = TimeActivityHelper.formatDateRange(startDate, endDate);

      // 대상 사용자 표시명 조회 (Helper 사용)
      const displayName = await TimeActivityHelper.getUserDisplayName(
        interaction.guild,
        targetUserId,
        targetUser.username
      );

      // 응답 메시지 생성 (Helper 사용)
      const responseMessage = TimeActivityHelper.createResponseMessage(displayName, dateRangeMessage, formattedTime);

      // 응답 전송
      await SafeInteraction.safeReply(interaction, {
        content: responseMessage,
        flags: MessageFlags.Ephemeral,
      });

      // 명령어 실행 완료 로그 (Helper 사용)
      TimeActivityHelper.logCommandExecution('TimeCheckCommand', '시간체크', {
        targetUserId,
        executedBy: interaction.user.id,
        totalTimeMs: totalTime,
        formattedTime,
        targetDisplayName: displayName,
        dateRange: dateRangeMessage
      });

    } catch (error) {
      // 에러 처리 (Helper 사용)
      TimeActivityHelper.handleCommandError(interaction, error, 'TimeCheckCommand');
      
      await SafeInteraction.safeReply(interaction, {
        content: '활동 시간 확인 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}