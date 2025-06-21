// src/commands/recruitmentCommand.js - 구인구직 명령어
import { MessageFlags } from 'discord.js';
import { CommandBase } from './CommandBase.js';

export class RecruitmentCommand extends CommandBase {
  constructor(services) {
    super(services);
    this.voiceForumService = services.voiceForumService;
  }

  /**
   * 명령어 실행 (CommandBase의 execute를 오버라이드)
   * @param interaction - 상호작용 객체
   */
  async execute(interaction) {
    try {
      // 모달 표시를 위해 defer 하지 않고 바로 실행
      await this.voiceForumService.showStandaloneRecruitmentModal(interaction);
    } catch (error) {
      console.error(`${this.constructor.name} 명령어 실행 오류:`, error);

      // 에러 응답 (아직 응답하지 않은 경우에만)
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '명령어 실행 중 오류가 발생했습니다.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
}