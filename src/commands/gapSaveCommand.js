// src/commands/gapSaveCommand.js - gap_save 명령어
import { MessageFlags } from 'discord.js';

export class GapSaveCommand {
  constructor(activityTracker) {
    this.activityTracker = activityTracker;
  }

  /**
   * gap_save 명령어를 실행합니다.
   * @param {Interaction} interaction - 상호작용 객체
   */
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // 활동 데이터 저장
      await this.activityTracker.saveActivityData();
      
      // 활동 데이터 초기화 및 재초기화
      await this.activityTracker.clearAndReinitializeActivityData();

      // 응답 전송
      await interaction.followUp({
        content: "활동 데이터가 최신화되었습니다.",
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('gap_save 명령어 실행 오류:', error);
      await interaction.followUp({
        content: '활동 데이터 저장 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}