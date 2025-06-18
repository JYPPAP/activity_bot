// src/commands/gapListCommand.js - gap_list 명령어 (잠수 기능 개선)
import {MessageFlags} from 'discord.js';
import {EmbedFactory} from '../utils/embedBuilder.js';
import {cleanRoleName} from '../utils/formatters.js';
import {CommandBase} from './CommandBase.js';

export class GapListCommand extends CommandBase {
  constructor(activityTracker, dbManager) {
    super({activityTracker, dbManager});
    this.userClassificationService = null;
  }

  /**
   * 의존성 주입을 위한 메서드
   * @param {UserClassificationService} userClassificationService - 사용자 분류 서비스
   */
  setUserClassificationService(userClassificationService) {
    this.userClassificationService = userClassificationService;
  }

  /**
   * gap_list 명령어의 실제 실행 로직
   * @param  interaction - 상호작용 객체
   */
  async executeCommand(interaction) {
    // 역할 옵션 가져오기
    const roleOption = interaction.options.getString("role");
    const roles = roleOption.split(',').map(r => cleanRoleName(r.trim()));
    const guild = interaction.guild;

    // 활동 데이터 초기화
    await this.activityTracker.initializeActivityData(guild);

    // 역할 멤버 가져오기
    const members = await guild.members.fetch();
    const roleMembers = members.filter(member =>
      member.roles.cache.some(r => roles.includes(r.name))
    );

    // 현재 활동 데이터 저장
    await this.activityTracker.saveActivityData();

    // 최신 데이터로 활성/비활성/잠수 사용자 분류
    const {activeUsers, inactiveUsers, afkUsers, resetTime, minHours} =
      await this.userClassificationService.classifyUsers(roles[0], roleMembers);

    // 임베드 생성
    const embeds = EmbedFactory.createActivityEmbeds(
      roles[0], activeUsers, inactiveUsers, afkUsers, resetTime, minHours, '활동 목록'
    );

    try {
      // DM으로 임베드 전송
      for (const embed of embeds) {
        await interaction.user.send({embeds: [embed]});
      }

      // 명령어 실행한 채널에 알림
      await interaction.followUp({
        content: '📩 활동 데이터 임베드를 DM으로 전송했습니다!',
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('DM 전송 실패:', error);

      // DM 전송 실패 시 채널에서 직접 임베드 제공
      await interaction.followUp({
        content: '📂 DM 전송에 실패했습니다. 여기에서 확인하세요:',
        embeds: embeds,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}