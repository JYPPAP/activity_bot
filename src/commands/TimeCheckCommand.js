// src/commands/TimeCheckCommand.js - 시간체크 명령어 (관리자용)
import {MessageFlags, EmbedBuilder} from 'discord.js';
import {SafeInteraction} from '../utils/SafeInteraction.js';
import {TimeActivityHelper} from '../utils/TimeActivityHelper.js';
import {COLORS} from '../config/constants.js';
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

      // 일별 상세 활동 시간 조회
      const dailyData = await this.db.getUserDailyActivityByDateRange(
        targetUserId,
        startDate.getTime(),
        endDate.getTime()
      );

      // 총 활동 시간 조회 및 검증 (Helper 사용)
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

      // 일별 상세 출력이 있는 경우 Embed로 응답
      if (dailyData.length > 0) {
        const embed = this.createDailyActivityEmbed(displayName, dateRangeMessage, dailyData, formattedTime);
        await SafeInteraction.safeReply(interaction, {
          embeds: [embed],
          flags: MessageFlags.Ephemeral,
        });
      } else {
        // 활동이 없는 경우 기존 텍스트 응답
        const responseMessage = TimeActivityHelper.createResponseMessage(displayName, dateRangeMessage, formattedTime);
        await SafeInteraction.safeReply(interaction, {
          content: responseMessage,
          flags: MessageFlags.Ephemeral,
        });
      }

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

  /**
   * 일별 활동 시간 Embed를 생성합니다.
   * @param {string} displayName - 사용자 표시명
   * @param {string} dateRangeMessage - 날짜 범위 메시지
   * @param {Array} dailyData - 일별 활동 데이터
   * @param {string} totalFormattedTime - 총 활동 시간
   * @returns {EmbedBuilder} - 생성된 Embed
   */
  createDailyActivityEmbed(displayName, dateRangeMessage, dailyData, totalFormattedTime) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.ACTIVE)
      .setTitle(`📅 ${displayName}님의 일별 활동 시간`)
      .setDescription(`**기간**: ${dateRangeMessage}\n**총 활동 시간**: ${totalFormattedTime}\n**활동 일수**: ${dailyData.length}일`);

    // 일별 데이터를 15일씩 나누어 필드로 추가
    const chunkSize = 15;
    for (let i = 0; i < dailyData.length; i += chunkSize) {
      const chunk = dailyData.slice(i, i + chunkSize);
      const fieldName = dailyData.length > chunkSize 
        ? `📊 일별 활동 시간 (${i + 1}~${Math.min(i + chunkSize, dailyData.length)}일차)`
        : '📊 일별 활동 시간';
      
      const fieldValue = chunk.map(day => {
        const date = new Date(day.date);
        const monthDay = `${date.getMonth() + 1}월 ${date.getDate()}일`;
        return `${monthDay}: ${day.formattedTime} (${day.hours}h)`;
      }).join('\n');

      embed.addFields({
        name: fieldName,
        value: fieldValue || '활동 없음',
        inline: false
      });
    }

    // 통계 정보 추가
    if (dailyData.length > 0) {
      const totalHours = dailyData.reduce((sum, day) => sum + day.hours, 0);
      const avgHours = (totalHours / dailyData.length).toFixed(1);
      const maxDay = dailyData.reduce((max, day) => day.hours > max.hours ? day : max);
      const maxDate = new Date(maxDay.date);
      
      embed.addFields({
        name: '📈 통계',
        value: `평균 일일 활동: ${avgHours}시간\n최고 활동일: ${maxDate.getMonth() + 1}월 ${maxDate.getDate()}일 (${maxDay.formattedTime})`,
        inline: false
      });
    }

    embed.setTimestamp();
    return embed;
  }
}