// src/commands/TimeConfirmCommand.js - 시간확인 명령어 (개인용)
import {MessageFlags} from 'discord.js';
import {formatTime} from '../utils/formatters.js';
import {SafeInteraction} from '../utils/SafeInteraction.js';

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

      console.log('자동 설정된 날짜:', startDate, endDate);

      // 메모리에서 현재 활동 상태 확인 (디버깅용)
      const memoryData = this.activityTracker.getMemoryActivityData(userId);
      if (memoryData) {
        console.log(`[메모리 데이터] 사용자 ${userId}:`);
        console.log(`  - 누적 시간: ${Math.round(memoryData.totalTime / 1000 / 60)}분`);
        console.log(`  - 현재 세션: ${Math.round(memoryData.currentSessionTime / 1000 / 60)}분`);
        console.log(`  - 현재 활동 중: ${memoryData.isCurrentlyActive ? 'YES' : 'NO'}`);
        console.log(`  - 총 시간 (누적+현재): ${Math.round(memoryData.totalWithCurrent / 1000 / 60)}분`);
      } else {
        console.log(`[메모리 데이터] 사용자 ${userId}: 데이터 없음`);
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
      console.error('시간확인 명령어 실행 오류:', error);
      await SafeInteraction.safeReply(interaction, {
        content: '활동 시간 확인 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}