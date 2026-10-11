import { MessageFlags } from 'discord.js';
import { logger } from '../config/logger-termux.js';
import { NicknameConstants } from '../config/NicknameConstants.js';
import {
  createActionButtons,
  createMainSelectMenu,
  createNicknameEmbed,
} from '../ui/NicknameUIBuilder.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';
import { CommandBase } from './CommandBase.js';

export class NicknameSetupCommand extends CommandBase {
  constructor(services) {
    super(services);
    this.platformTemplateService = services.platformTemplateService;
  }

  async execute(interaction) {
    try {
      const deferResult = await SafeInteraction.safeDeferReply(interaction, {
        flags: MessageFlags.Ephemeral,
      });
      if (deferResult === null) throw new Error('인터랙션 지연 응답에 실패했습니다.');

      const channel = interaction.channel;
      const platforms = await this.platformTemplateService.getAllPlatforms(interaction.guild.id);
      if (platforms.length === 0) {
        await interaction.editReply({ content: NicknameConstants.MESSAGES.NO_PLATFORMS });
        return;
      }

      await channel.send({
        embeds: [createNicknameEmbed()],
        components: [
          createMainSelectMenu(channel.id, platforms),
          createActionButtons(channel.id),
        ],
      });
      await interaction.editReply({
        content: `✅ **${channel.name}** 채널에 닉네임 관리 UI가 설정되었습니다.`,
      });
    } catch (error) {
      logger.error('[NicknameSetupCommand] 오류', {
        error: error.message,
        stack: error.stack,
      });
      await SafeInteraction.safeReply(interaction, {
        content: `❌ 오류: ${error.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
