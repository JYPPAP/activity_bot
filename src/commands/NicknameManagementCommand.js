// src/commands/NicknameManagementCommand.js - 닉네임 관리 명령어 (관리자 전용)

import { MessageFlags, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } from 'discord.js';
import { CommandBase } from './CommandBase.js';
import { NicknameConstants } from '../config/NicknameConstants.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';

export class NicknameManagementCommand extends CommandBase {
  constructor(services) {
    super(services);
    this.platformTemplateService = services.platformTemplateService;
  }

  /**
   * 명령어 실행
   */
  async execute(interaction) {
    try {
      // 관리자 권한 확인
      if (!interaction.member.permissions.has('ManageGuild')) {
        await interaction.reply({
          content: NicknameConstants.MESSAGES.PERMISSION_DENIED,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const subcommand = interaction.options.getSubcommand();
      const guildId = interaction.guild.id;

      switch (subcommand) {
        case '플랫폼추가':
          await this.handleAddPlatform(interaction, guildId);
          break;
        case '플랫폼수정':
          await this.handleEditPlatform(interaction, guildId);
          break;
        case '플랫폼삭제':
          await this.handleDeletePlatform(interaction, guildId);
          break;
        case '플랫폼목록':
          await this.handleListPlatforms(interaction, guildId);
          break;
        default:
          await interaction.editReply({ content: '알 수 없는 서브커맨드입니다.' });
      }
    } catch (error) {
      console.error('[NicknameManagementCommand] 오류:', error);
      await SafeInteraction.safeReply(interaction, {
        content: `❌ 오류: ${error.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * 플랫폼 추가 처리
   */
  async handleAddPlatform(interaction, guildId) {
    const modal = new ModalBuilder()
      .setCustomId(`${NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_ADD_MODAL}${Date.now()}`)
      .setTitle('플랫폼 추가');

    const nameInput = new TextInputBuilder()
      .setCustomId('platform_name')
      .setLabel('플랫폼명')
      .setPlaceholder('예: Steam, Discord, Epic Games')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);

    const emojiInput = new TextInputBuilder()
      .setCustomId('platform_emoji')
      .setLabel('이모지 (선택사항)')
      .setPlaceholder('예: 🎮, 💬, 🎯')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(50);

    const baseUrlInput = new TextInputBuilder()
      .setCustomId('base_url')
      .setLabel('Base URL')
      .setPlaceholder('예: https://steamcommunity.com/profiles/')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(500);

    const urlPatternInput = new TextInputBuilder()
      .setCustomId('url_pattern')
      .setLabel('URL 패턴 (선택사항)')
      .setValue('{base_url}{user_id}/')
      .setPlaceholder('{base_url}{user_id}/')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(500);

    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(emojiInput),
      new ActionRowBuilder().addComponents(baseUrlInput),
      new ActionRowBuilder().addComponents(urlPatternInput)
    );

    await interaction.editReply({ content: '모달을 표시합니다...' });
    await interaction.followUp({ modal, flags: MessageFlags.Ephemeral });
  }

  /**
   * 플랫폼 수정 처리
   */
  async handleEditPlatform(interaction, guildId) {
    const platforms = await this.platformTemplateService.getAllPlatforms(guildId);

    if (platforms.length === 0) {
      await interaction.editReply({ content: NicknameConstants.MESSAGES.NO_PLATFORMS });
      return;
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`nickname_admin_edit_select_${Date.now()}`)
      .setPlaceholder('수정할 플랫폼을 선택하세요')
      .addOptions(
        platforms.map((platform) => ({
          label: platform.platform_name,
          value: platform.id.toString(),
          emoji: platform.emoji_unicode || NicknameConstants.DEFAULT_EMOJIS.PLATFORM,
        }))
      );

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const response = await interaction.editReply({
      content: '수정할 플랫폼을 선택하세요:',
      components: [row],
    });

    try {
      const selectInteraction = await response.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        time: 60000,
      });

      const platformId = parseInt(selectInteraction.values[0], 10);
      const platform = platforms.find((p) => p.id === platformId);

      const modal = new ModalBuilder()
        .setCustomId(`${NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_EDIT_MODAL}${platformId}`)
        .setTitle(`${platform.platform_name} 수정`);

      const nameInput = new TextInputBuilder()
        .setCustomId('platform_name')
        .setLabel('플랫폼명')
        .setValue(platform.platform_name)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

      const emojiInput = new TextInputBuilder()
        .setCustomId('platform_emoji')
        .setLabel('이모지')
        .setValue(platform.emoji_unicode || '')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(50);

      const baseUrlInput = new TextInputBuilder()
        .setCustomId('base_url')
        .setLabel('Base URL')
        .setValue(platform.base_url)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(500);

      const urlPatternInput = new TextInputBuilder()
        .setCustomId('url_pattern')
        .setLabel('URL 패턴')
        .setValue(platform.url_pattern || '{base_url}{user_id}/')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(500);

      modal.addComponents(
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(emojiInput),
        new ActionRowBuilder().addComponents(baseUrlInput),
        new ActionRowBuilder().addComponents(urlPatternInput)
      );

      await selectInteraction.showModal(modal);
    } catch (error) {
      console.error('[NicknameManagementCommand] 수정 시간 초과:', error);
      await interaction.editReply({ content: '시간 초과되었습니다.', components: [] });
    }
  }

  /**
   * 플랫폼 삭제 처리
   */
  async handleDeletePlatform(interaction, guildId) {
    const platforms = await this.platformTemplateService.getAllPlatforms(guildId);

    if (platforms.length === 0) {
      await interaction.editReply({ content: NicknameConstants.MESSAGES.NO_PLATFORMS });
      return;
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`nickname_admin_delete_select_${Date.now()}`)
      .setPlaceholder('삭제할 플랫폼을 선택하세요')
      .addOptions(
        platforms.map((platform) => ({
          label: platform.platform_name,
          value: platform.id.toString(),
          emoji: platform.emoji_unicode || NicknameConstants.DEFAULT_EMOJIS.PLATFORM,
          description: `Base URL: ${platform.base_url.substring(0, 50)}...`,
        }))
      );

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const response = await interaction.editReply({
      content: '⚠️ **주의**: 플랫폼을 삭제하면 연결된 모든 사용자 닉네임도 삭제됩니다.\n삭제할 플랫폼을 선택하세요:',
      components: [row],
    });

    try {
      const selectInteraction = await response.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        time: 60000,
      });

      const platformId = parseInt(selectInteraction.values[0], 10);
      const platform = platforms.find((p) => p.id === platformId);

      const success = await this.platformTemplateService.deletePlatform(platformId, guildId);

      if (success) {
        await selectInteraction.update({
          content: `${NicknameConstants.MESSAGES.PLATFORM_DELETED}\n삭제된 플랫폼: **${platform.platform_name}**`,
          components: [],
        });
      } else {
        await selectInteraction.update({
          content: '❌ 플랫폼 삭제에 실패했습니다.',
          components: [],
        });
      }
    } catch (error) {
      console.error('[NicknameManagementCommand] 삭제 시간 초과:', error);
      await interaction.editReply({ content: '시간 초과되었습니다.', components: [] });
    }
  }

  /**
   * 플랫폼 목록 표시
   */
  async handleListPlatforms(interaction, guildId) {
    const platforms = await this.platformTemplateService.getAllPlatforms(guildId);

    if (platforms.length === 0) {
      await interaction.editReply({ content: NicknameConstants.MESSAGES.NO_PLATFORMS });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(NicknameConstants.COLORS.INFO)
      .setTitle(`${NicknameConstants.DEFAULT_EMOJIS.VIEW} 등록된 플랫폼 목록`)
      .setDescription(`총 ${platforms.length}개의 플랫폼이 등록되어 있습니다.`)
      .setTimestamp();

    platforms.forEach((platform, index) => {
      embed.addFields({
        name: `${index + 1}. ${platform.emoji_unicode || NicknameConstants.DEFAULT_EMOJIS.PLATFORM} ${platform.platform_name}`,
        value: `Base URL: \`${platform.base_url}\`\nURL 패턴: \`${platform.url_pattern}\``,
        inline: false,
      });
    });

    await interaction.editReply({ embeds: [embed] });
  }
}
