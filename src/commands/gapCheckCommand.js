// src/commands/gapCheckCommand.js - gap_check 명령어 (수정)
import {MessageFlags} from 'discord.js';
import {formatTime} from '../utils/formatters.js';

export class GapCheckCommand {
  constructor(activityTracker, dbManager) {
    this.activityTracker = activityTracker;
    this.db = dbManager;
  }

  /**
   * gap_check 명령어를 실행합니다.
   * @param interaction - 상호작용 객체
   */
  async execute(interaction) {
    await interaction.deferReply({flags: MessageFlags.Ephemeral});

    try {
      // 사용자 옵션 가져오기
      const user = interaction.options.getUser("user");
      const userId = user.id;

      // 현재 활동 데이터 저장 (최신 데이터 확보)
      await this.activityTracker.saveActivityData();

      // 활동 데이터 로드
      const activity = await this.db.getUserActivity(userId) || {totalTime: 0};

      // 총 활동 시간 포맷팅
      const formattedTime = formatTime(activity.totalTime);

      // 응답 전송
      await interaction.followUp({
        content: `${user.username}님의 총 활동 시간은 ${formattedTime} 입니다.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('gap_check 명령어 실행 오류:', error);
      await interaction.followUp({
        content: '활동 시간 확인 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}