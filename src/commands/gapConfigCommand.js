// src/commands/gapConfigCommand.js - gap_config 명령어 (수정)
import {MessageFlags} from 'discord.js';
import {cleanRoleName} from '../utils/formatters.js';
import { validateAndSanitizeInput } from '../utils/inputValidator.js';

export class GapConfigCommand {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  /**
   * gap_config 명령어를 실행합니다.
   * @param interaction - 상호작용 객체
   */
  async execute(interaction) {
    await interaction.deferReply({flags: MessageFlags.Ephemeral});

    try {
      // 명령어 옵션 가져오기 및 검증
      const rawRole = interaction.options.getString("role");
      const hours = interaction.options.getInteger("hours");
      
      // 역할명 입력 검증
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

      // 역할 설정 업데이트
      await this.dbManager.updateRoleConfig(role, hours);

      // 응답 전송
      await interaction.followUp({
        content: `역할 ${role}의 최소 활동시간을 ${hours}시간으로 설정했습니다!`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('gap_config 명령어 실행 오류:', error);
      await interaction.followUp({
        content: '설정 저장 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}