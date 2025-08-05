// src/commands/TimeCheckCommand.js - 시간체크 명령어 (관리자용)
import {MessageFlags} from 'discord.js';
import {formatTime} from '../utils/formatters.js';
import {SafeInteraction} from '../utils/SafeInteraction.js';

export class TimeCheckCommand {
  constructor(activityTracker, dbManager) {
    this.activityTracker = activityTracker;
    this.db = dbManager;
  }

  /**
   * YYMMDD 형식의 날짜 문자열을 Date 객체로 변환합니다.
   * @param {string} dateString - YYMMDD 형식의 날짜 문자열
   * @param {boolean} isEndDate - 종료일인지 여부 (true면 23:59:59로 설정)
   * @returns {Date} - 변환된 Date 객체
   */
  parseDate(dateString, isEndDate = false) {
    if (!dateString || dateString.length !== 6) {
      throw new Error('날짜는 YYMMDD 형식으로 입력해주세요. (예: 250101)');
    }

    const year = parseInt(dateString.substring(0, 2)) + 2000;
    const month = parseInt(dateString.substring(2, 4)) - 1; // 월은 0부터 시작
    const day = parseInt(dateString.substring(4, 6));

    if (isEndDate) {
      return new Date(year, month, day, 23, 59, 59, 999);
    } else {
      return new Date(year, month, day, 0, 0, 0, 0);
    }
  }

  /**
   * 시간체크 명령어를 실행합니다.
   * @param interaction - 상호작용 객체
   */
  async execute(interaction) {
    await SafeInteraction.safeDeferReply(interaction, {flags: MessageFlags.Ephemeral});

    try {
      // 확인할 대상 사용자 가져오기
      const targetUser = interaction.options.getUser('user');
      const targetUserId = targetUser.id;

      // 날짜 옵션 가져오기
      const startDateOption = interaction.options.getString('start_date');
      const endDateOption = interaction.options.getString('end_date');

      let startDate, endDate;

      // 날짜가 지정되지 않은 경우 자동 설정: 이번 달 1일 ~ 오늘
      if (!startDateOption && !endDateOption) {
        const today = new Date();
        startDate = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);
        endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
      } else {
        // 시작일과 종료일이 모두 제공되어야 함
        if (!startDateOption || !endDateOption) {
          await SafeInteraction.safeReply(interaction, {
            content: '❌ 날짜를 지정할 경우 시작일과 종료일을 모두 입력해주세요.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        try {
          startDate = this.parseDate(startDateOption, false);
          endDate = this.parseDate(endDateOption, true);
        } catch (error) {
          await SafeInteraction.safeReply(interaction, {
            content: `❌ ${error.message}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        // 날짜 유효성 검사
        if (startDate > endDate) {
          await SafeInteraction.safeReply(interaction, {
            content: '❌ 시작일이 종료일보다 늦을 수 없습니다.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }

      console.log('시간체크 날짜 범위:', startDate, endDate);

      // 메모리에서 현재 활동 상태 확인 (디버깅용)
      const memoryData = this.activityTracker.getMemoryActivityData(targetUserId);
      if (memoryData) {
        console.log(`[메모리 데이터] 사용자 ${targetUserId}:`);
        console.log(`  - 누적 시간: ${Math.round(memoryData.totalTime / 1000 / 60)}분`);
        console.log(`  - 현재 세션: ${Math.round(memoryData.currentSessionTime / 1000 / 60)}분`);
        console.log(`  - 현재 활동 중: ${memoryData.isCurrentlyActive ? 'YES' : 'NO'}`);
        console.log(`  - 총 시간 (누적+현재): ${Math.round(memoryData.totalWithCurrent / 1000 / 60)}분`);
      } else {
        console.log(`[메모리 데이터] 사용자 ${targetUserId}: 데이터 없음`);
      }

      // 특정 기간의 활동 시간 조회
      const totalTime = await this.db.getUserActivityByDateRange(
        targetUserId,
        startDate.getTime(),
        endDate.getTime()
      );

      // 날짜 범위 메시지 작성
      const startDateFormatted = `${startDate.getFullYear()}.${(startDate.getMonth() + 1).toString().padStart(2, '0')}.${startDate.getDate().toString().padStart(2, '0')}`;
      const endDateFormatted = `${endDate.getFullYear()}.${(endDate.getMonth() + 1).toString().padStart(2, '0')}.${endDate.getDate().toString().padStart(2, '0')}`;
      const dateRangeMessage = ` ${startDateFormatted} ~ ${endDateFormatted} 기간`;

      // 총 활동 시간 포맷팅
      const formattedTime = formatTime(totalTime);

      // 대상 사용자 표시명 가져오기
      const guild = interaction.guild;
      let displayName;
      try {
        const member = await guild.members.fetch(targetUserId);
        displayName = member.displayName || targetUser.username;
      } catch (error) {
        displayName = targetUser.username;
      }

      // 응답 전송
      await SafeInteraction.safeReply(interaction, {
        content: `${displayName}님의${dateRangeMessage} 활동 시간은 ${formattedTime} 입니다.`,
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
}