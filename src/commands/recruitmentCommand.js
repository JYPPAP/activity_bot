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
      // ========== 권한 체크 ==========
      if (!this.voiceForumService.hasRecruitmentPermission(interaction.user, interaction.member)) {
        await this.safeReply(interaction, {
          content: '❌ **구인구직 기능 접근 권한이 없습니다.**\n\n이 기능은 현재 베타 테스트 중으로 특정 사용자와 관리자만 이용할 수 있습니다.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      // =============================

      // type 옵션 확인
      const recruitmentType = interaction.options.getInteger('type');

      // type이 지정된 경우: 특수 구인구직 처리
      if (recruitmentType === 1) {
        // 장기 구인구직
        await this.voiceForumService.recruitmentService.handleSpecialRecruitmentButton(interaction, 'long_term');
        return;
      } else if (recruitmentType === 2) {
        // 내전 구인구직
        await this.voiceForumService.recruitmentService.handleSpecialRecruitmentButton(interaction, 'scrimmage');
        return;
      }

      // type이 없는 경우: 기존 일반 구인구직 처리
      await this.voiceForumService.showStandaloneRecruitmentModal(interaction);
    } catch (error) {
      console.error(`${this.constructor.name} 명령어 실행 오류:`, error);

      // 에러 응답 (SafeInteraction이 자동으로 상태 확인)
      await this.safeReply(interaction, {
        content: '명령어 실행 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}