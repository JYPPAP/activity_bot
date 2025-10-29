// src/ui/NicknameButtonHandler.js - 닉네임 버튼 핸들러

import { MessageFlags, StringSelectMenuBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ComponentType, EmbedBuilder } from 'discord.js';
import { NicknameConstants } from '../config/NicknameConstants.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';
import { EmojiParser } from '../utils/EmojiParser.js';

export class NicknameButtonHandler {
  constructor(platformTemplateService, userNicknameService) {
    this.platformTemplateService = platformTemplateService;
    this.userNicknameService = userNicknameService;
  }

  /**
   * 버튼 클릭 처리
   */
  async handleButton(interaction) {
    try {
      const customId = interaction.customId;

      // 닉네임 삭제 버튼
      if (customId.startsWith(NicknameConstants.CUSTOM_ID_PREFIXES.DELETE_BTN)) {
        await this.handleDeleteButton(interaction);
      }
      // 내 정보 조회 버튼
      else if (customId.startsWith(NicknameConstants.CUSTOM_ID_PREFIXES.VIEW_BTN)) {
        await this.handleViewButton(interaction);
      }
      // 관리자 플랫폼 추가 버튼
      else if (customId.startsWith(NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_ADD_BTN)) {
        await this.handleAdminAddButton(interaction);
      }
      // 관리자 플랫폼 수정 버튼
      else if (customId.startsWith(NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_EDIT_BTN)) {
        await this.handleAdminEditButton(interaction);
      }
      // 관리자 플랫폼 삭제 버튼
      else if (customId.startsWith(NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_DELETE_BTN)) {
        await this.handleAdminDeleteButton(interaction);
      }
      // 관리자 플랫폼 목록 버튼
      else if (customId.startsWith(NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_LIST_BTN)) {
        await this.handleAdminListButton(interaction);
      }
    } catch (error) {
      console.error('[NicknameButtonHandler] 오류:', error);
      await SafeInteraction.safeReply(interaction, {
        content: `❌ 오류: ${error.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * 닉네임 삭제 버튼 처리
   */
  async handleDeleteButton(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    // 사용자의 모든 닉네임 가져오기
    const nicknames = await this.userNicknameService.getUserNicknames(guildId, userId);

    if (nicknames.length === 0) {
      await interaction.editReply({
        content: NicknameConstants.MESSAGES.NO_NICKNAMES,
      });
      return;
    }

    // 삭제할 닉네임 선택 드롭다운 생성
    const options = nicknames.map((nickname) => ({
      label: nickname.platform_name,
      description: `ID: ${nickname.user_identifier}`,
      value: nickname.platform_id.toString(),
      emoji: EmojiParser.parse(nickname.emoji_unicode, NicknameConstants.DEFAULT_EMOJIS.PLATFORM),
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`${NicknameConstants.CUSTOM_ID_PREFIXES.DELETE_SELECT}${Date.now()}`)
      .setPlaceholder('삭제할 닉네임을 선택하세요')
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.editReply({
      content: '삭제할 닉네임을 선택하세요:',
      components: [row],
    });
  }

  /**
   * 내 정보 조회 버튼 처리
   */
  async handleViewButton(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    // 사용자의 모든 닉네임 가져오기
    const nicknames = await this.userNicknameService.getUserNicknames(guildId, userId);

    // 임베드 생성
    const embedData = this.userNicknameService.createMyNicknamesEmbed(interaction.user, nicknames);

    await interaction.editReply(embedData);
  }

  /**
   * 관리자 플랫폼 추가 버튼 처리
   */
  async handleAdminAddButton(interaction) {
    const guildId = interaction.customId.replace(NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_ADD_BTN, '');

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
      .setLabel('Base URL (선택사항)')
      .setPlaceholder('예: https://steamcommunity.com/profiles/')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
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

    await interaction.showModal(modal);
  }

  /**
   * 관리자 플랫폼 수정 버튼 처리
   */
  async handleAdminEditButton(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = interaction.customId.replace(NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_EDIT_BTN, '');
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
        .setLabel('Base URL (선택사항)')
        .setValue(platform.base_url || '')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
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
      console.error('[NicknameButtonHandler] 수정 시간 초과:', error);
      await interaction.editReply({ content: '시간 초과되었습니다.', components: [] });
    }
  }

  /**
   * 관리자 플랫폼 삭제 버튼 처리
   */
  async handleAdminDeleteButton(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = interaction.customId.replace(NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_DELETE_BTN, '');
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
      console.error('[NicknameButtonHandler] 삭제 시간 초과:', error);
      await interaction.editReply({ content: '시간 초과되었습니다.', components: [] });
    }
  }

  /**
   * 관리자 플랫폼 목록 버튼 처리
   */
  async handleAdminListButton(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = interaction.customId.replace(NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_LIST_BTN, '');
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
