// src/commands/gapCheckCommand.js - 시간체크 명령어 (수정)
import {MessageFlags} from 'discord.js';
import {formatTime} from '../utils/formatters.js';
import {SafeInteraction} from '../utils/SafeInteraction.js';

export class GapCheckCommand {
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
      // 명령어를 실행한 사용자 정보 가져오기
      const user = interaction.user;
      const userId = user.id;
      const startDateStr = interaction.options.getString("start_date")?.trim();
      const endDateStr = interaction.options.getString("end_date")?.trim();

      // 현재 활동 데이터는 실시간으로 추적되므로 별도 저장 불필요 (성능 최적화)

      // 날짜 범위 파싱
      let totalTime;
      let dateRangeMessage = "";

      if (startDateStr && endDateStr) {
        // 날짜 형식 검증
        if (!this.validateDateFormat(startDateStr, '시작', interaction) ||
          !this.validateDateFormat(endDateStr, '종료', interaction)) {
          return;
        }

        try {
          // 날짜 파싱
          const { startDate, endDate } = this.parseYYMMDDDates(startDateStr, endDateStr);
          console.log('파싱된 날짜:', startDate, endDate);

          // 특정 기간의 활동 시간 조회
          totalTime = await this.db.getUserActivityByDateRange(
            userId,
            startDate.getTime(),
            endDate.getTime()
          );

          // 날짜 범위 메시지 작성
          const startDateFormatted = `${startDate.getFullYear()}.${(startDate.getMonth() + 1).toString().padStart(2, '0')}.${startDate.getDate().toString().padStart(2, '0')}`;
          const endDateFormatted = `${endDate.getFullYear()}.${(endDate.getMonth() + 1).toString().padStart(2, '0')}.${endDate.getDate().toString().padStart(2, '0')}`;
          dateRangeMessage = ` ${startDateFormatted} ~ ${endDateFormatted} 기간`;
        } catch (error) {
          console.error('날짜 파싱 오류:', error);
          await SafeInteraction.safeReply(interaction, {
            content: `날짜 처리 중 오류가 발생했습니다: ${error.message}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      } else {
        // 전체 활동 시간 조회
        const activity = await this.db.getUserActivity(userId) || {totalTime: 0};
        totalTime = activity.totalTime;
      }

      // 총 활동 시간 포맷팅
      const formattedTime = formatTime(totalTime);

      // 응답 전송
      await SafeInteraction.safeReply(interaction, {
        content: `${interaction.member?.displayName || user.username}님의${dateRangeMessage} 활동 시간은 ${formattedTime} 입니다.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('시간체크 명령어 실행 오류:', error);
      await SafeInteraction.safeReply(interaction, {
        content: '활동 시간 확인 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // 날짜 형식 검증
  validateDateFormat(dateStr, label, interaction) {
    if (!/^\d{6}$/.test(dateStr)) {
      SafeInteraction.safeReply(interaction, {
        content: `${label} 날짜 형식이 올바르지 않습니다. '${dateStr}'는 'YYMMDD' 형식이어야 합니다. (예: 250413)`,
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }
    return true;
  }

  // YYMMDD 형식 날짜 파싱
  parseYYMMDDDates(startDateStr, endDateStr) {
    // 수동으로 날짜 파싱
    const startYear = 2000 + parseInt(startDateStr.substring(0, 2), 10);
    const startMonth = parseInt(startDateStr.substring(2, 4), 10) - 1;
    const startDay = parseInt(startDateStr.substring(4, 6), 10);

    const endYear = 2000 + parseInt(endDateStr.substring(0, 2), 10);
    const endMonth = parseInt(endDateStr.substring(2, 4), 10) - 1;
    const endDay = parseInt(endDateStr.substring(4, 6), 10);

    const startDate = new Date(startYear, startMonth, startDay, 0, 0, 0, 0);
    const endDate = new Date(endYear, endMonth, endDay, 23, 59, 59, 999);

    // 날짜 유효성 검사
    if (isNaN(startDate.getTime())) {
      throw new Error(`유효하지 않은 시작 날짜: ${startDateStr}`);
    }

    if (isNaN(endDate.getTime())) {
      throw new Error(`유효하지 않은 종료 날짜: ${endDateStr}`);
    }

    return { startDate, endDate };
  }
}