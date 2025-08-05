// src/commands/gapResetCommand.js - gap_reset 명령어
import {MessageFlags} from 'discord.js';
import {cleanRoleName} from '../utils/formatters.js';
import { validateAndSanitizeInput, VALIDATION_PRESETS } from '../utils/inputValidator.js';

export class GapResetCommand {
  constructor(activityTracker) {
    this.activityTracker = activityTracker;
  }

  /**
   * gap_reset 명령어를 실행합니다.
   * @param interaction - 상호작용 객체
   */
  async execute(interaction) {
    await interaction.deferReply({flags: MessageFlags.Ephemeral});

    try {
      // 역할 옵션 가져오기 및 검증
      const rawRole = interaction.options.getString("role");
      
      // 입력 검증
      const roleValidation = validateAndSanitizeInput(rawRole, {
        maxLength: 50,
        minLength: 1,
        allowUrls: false,
        strictMode: true,
        fieldName: '역할명'
      });

      if (!roleValidation.isValid) {
        await interaction.followUp({
          content: `❌ **역할명 입력 오류:**\n${roleValidation.errors.join('\n')}`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const role = cleanRoleName(roleValidation.sanitizedText);

      // 해당 역할의 멤버들 가져오기
      const members = interaction.guild.members.cache.filter(
        member => member.roles.cache.some(r => r.name === role)
      );

      // 채널 활동 시간 초기화
      members.forEach(member => {
        const userId = member.user.id;
        if (this.activityTracker.channelActivityTime.has(userId)) {
          this.activityTracker.channelActivityTime.delete(userId);
        }
      });

      // 활동 데이터 초기화 및 재초기화
      await this.activityTracker.clearAndReinitializeActivityData(role);

      // 응답 전송
      await interaction.followUp({
        content: `역할 ${role}의 모든 사용자의 활동 시간이 초기화되었습니다.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('gap_reset 명령어 실행 오류:', error);
      await interaction.followUp({
        content: '활동 시간 초기화 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}