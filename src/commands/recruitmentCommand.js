// src/commands/recruitmentCommand.js - 구인구직 명령어
import { MessageFlags } from 'discord.js';
import { CommandBase } from './CommandBase.js';

export class RecruitmentCommand extends CommandBase {
  constructor(services) {
    super(services);
    this.voiceForumService = services.voiceForumService;
  }

  /**
   * 구인구직 명령어의 실제 실행 로직
   * @param interaction - 상호작용 객체
   */
  async executeCommand(interaction) {
    // 구인구직 포스트 생성 모달 직접 표시
    await this.voiceForumService.showStandaloneRecruitmentModal(interaction);
  }
}