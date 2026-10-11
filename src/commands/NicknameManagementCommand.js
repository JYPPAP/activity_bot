import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { config } from '../config/env.js';
import { logger } from '../config/logger-termux.js';
import { NicknameConstants } from '../config/NicknameConstants.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';
import { CommandBase } from './CommandBase.js';

export class NicknameManagementCommand extends CommandBase {
  async execute(interaction) {
    try {
      const hasPermission = interaction.member.permissions.has('ManageGuild') ||
        interaction.user.id === config.DEV_ID;

      if (!hasPermission) {
        const replyResult = await SafeInteraction.safeReply(interaction, {
          content: NicknameConstants.MESSAGES.PERMISSION_DENIED,
          flags: MessageFlags.Ephemeral,
        });
        if (replyResult === null) throw new Error('인터랙션 응답에 실패했습니다.');
        return;
      }

      const deferResult = await SafeInteraction.safeDeferReply(interaction, {
        flags: MessageFlags.Ephemeral,
      });
      if (deferResult === null) throw new Error('인터랙션 지연 응답에 실패했습니다.');

      await interaction.channel.send({
        embeds: [this.createManagementEmbed()],
        components: this.createManagementButtons(interaction.guild.id),
      });
      await interaction.editReply({ content: '✅ 플랫폼 관리 UI가 생성되었습니다.' });
    } catch (error) {
      logger.error('[NicknameManagementCommand] 오류', {
        error: error.message,
        stack: error.stack,
      });
      await SafeInteraction.safeReply(interaction, {
        content: `❌ 오류: ${error.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  createManagementEmbed() {
    return new EmbedBuilder()
      .setColor(NicknameConstants.COLORS.PRIMARY)
      .setTitle('🛠️ 플랫폼 관리')
      .setDescription('플랫폼 템플릿을 관리합니다. 아래 버튼을 사용하여 작업을 선택하세요.')
      .addFields(
        { name: '➕ 플랫폼 추가', value: '새로운 플랫폼 템플릿을 등록합니다.', inline: false },
        { name: '✏️ 플랫폼 수정', value: '기존 플랫폼 템플릿을 수정합니다.', inline: false },
        { name: '🗑️ 플랫폼 삭제', value: '플랫폼 템플릿을 삭제합니다.', inline: false },
        { name: '📋 플랫폼 목록', value: '등록된 모든 플랫폼을 확인합니다.', inline: false },
      )
      .setTimestamp();
  }

  createManagementButtons(guildId) {
    const button = (action, label, emoji, style) => new ButtonBuilder()
      .setCustomId(`${action}${guildId}`)
      .setLabel(label)
      .setEmoji(emoji)
      .setStyle(style);

    return [
      new ActionRowBuilder().addComponents(
        button(NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_ADD_BTN, '플랫폼 추가', '➕', ButtonStyle.Success),
        button(NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_EDIT_BTN, '플랫폼 수정', '✏️', ButtonStyle.Primary),
      ),
      new ActionRowBuilder().addComponents(
        button(NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_DELETE_BTN, '플랫폼 삭제', '🗑️', ButtonStyle.Danger),
        button(NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_LIST_BTN, '플랫폼 목록', '📋', ButtonStyle.Secondary),
      ),
    ];
  }
}
