// src/ui/NicknameSelectMenuHandler.js - 닉네임 드롭다운 핸들러

import { MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { NicknameConstants } from '../config/NicknameConstants.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';

export class NicknameSelectMenuHandler {
  constructor(platformTemplateService, userNicknameService) {
    this.platformTemplateService = platformTemplateService;
    this.userNicknameService = userNicknameService;
  }

  /**
   * 드롭다운 선택 처리
   */
  async handleSelectMenu(interaction) {
    try {
      const customId = interaction.customId;

      // 메인 드롭다운 (플랫폼 선택 또는 등록 시작)
      if (customId.startsWith(NicknameConstants.CUSTOM_ID_PREFIXES.MAIN_SELECT)) {
        await this.handleMainSelect(interaction);
      }
      // 플랫폼 선택 드롭다운 (닉네임 등록 시)
      else if (customId.startsWith(NicknameConstants.CUSTOM_ID_PREFIXES.PLATFORM_SELECT)) {
        await this.handlePlatformSelect(interaction);
      }
      // 닉네임 삭제 드롭다운
      else if (customId.startsWith(NicknameConstants.CUSTOM_ID_PREFIXES.DELETE_SELECT)) {
        await this.handleDeleteSelect(interaction);
      }
    } catch (error) {
      console.error('[NicknameSelectMenuHandler] 오류:', error);
      await SafeInteraction.safeReply(interaction, {
        content: `❌ 오류: ${error.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * 메인 드롭다운 선택 처리
   */
  async handleMainSelect(interaction) {
    const selectedValue = interaction.values[0];
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    // "➕ 닉네임 등록!" 선택 시
    if (selectedValue === NicknameConstants.SPECIAL_VALUES.REGISTER) {
      await this.showPlatformSelection(interaction, guildId);
      return;
    }

    // 특정 플랫폼 선택 시 (platform_123 형태)
    if (selectedValue.startsWith('platform_')) {
      const platformId = parseInt(selectedValue.replace('platform_', ''), 10);
      await this.handleDirectPlatformSelect(interaction, guildId, userId, platformId);
    }
  }

  /**
   * 플랫폼 선택 드롭다운 표시 (닉네임 등록 시작)
   */
  async showPlatformSelection(interaction, guildId) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const platforms = await this.platformTemplateService.getAllPlatforms(guildId);

    if (platforms.length === 0) {
      await interaction.editReply({
        content: NicknameConstants.MESSAGES.NO_PLATFORMS,
      });
      return;
    }

    // 플랫폼 선택 드롭다운 생성
    const options = platforms.map((platform) => ({
      label: platform.platform_name,
      description: `${platform.platform_name} 닉네임 등록`,
      value: platform.id.toString(),
      emoji: platform.emoji_unicode || NicknameConstants.DEFAULT_EMOJIS.PLATFORM,
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`${NicknameConstants.CUSTOM_ID_PREFIXES.PLATFORM_SELECT}${Date.now()}`)
      .setPlaceholder('플랫폼을 선택하세요')
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.editReply({
      content: '등록할 플랫폼을 선택하세요:',
      components: [row],
    });
  }

  /**
   * 플랫폼 선택 드롭다운 처리
   */
  async handlePlatformSelect(interaction) {
    const platformId = parseInt(interaction.values[0], 10);
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    await this.handleDirectPlatformSelect(interaction, guildId, userId, platformId);
  }

  /**
   * 플랫폼 직접 선택 처리 (등록만 처리, 수정은 EDIT 버튼 사용)
   */
  async handleDirectPlatformSelect(interaction, guildId, userId, platformId) {
    // 플랫폼 정보 가져오기
    const platform = await this.platformTemplateService.getPlatformById(platformId);
    if (!platform || platform.guild_id !== guildId) {
      await SafeInteraction.safeReply(interaction, {
        content: NicknameConstants.MESSAGES.PLATFORM_NOT_FOUND,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 플랫폼별 계정 개수 확인
    const accountCount = await this.userNicknameService.getAccountCount(guildId, userId, platformId);

    if (accountCount >= NicknameConstants.LIMITS.MAX_ACCOUNTS_PER_PLATFORM) {
      // 최대 개수 도달 시 에러 메시지
      await SafeInteraction.safeReply(interaction, {
        content: NicknameConstants.MESSAGES.ACCOUNT_LIMIT_REACHED,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 추가 가능 - 추가 모달 표시
    await this.showAddModal(interaction, platform);
  }

  /**
   * 닉네임 추가 모달 표시
   */
  async showAddModal(interaction, platform) {
    const modal = new ModalBuilder()
      .setCustomId(`${NicknameConstants.CUSTOM_ID_PREFIXES.ADD_MODAL}${platform.id}_${Date.now()}`)
      .setTitle(`${platform.platform_name} 닉네임 등록`);

    const userIdInput = new TextInputBuilder()
      .setCustomId('user_identifier')
      .setLabel('사용자 ID')
      .setPlaceholder(`예: 76561198183295061`)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(NicknameConstants.LIMITS.USER_IDENTIFIER_MAX);

    modal.addComponents(new ActionRowBuilder().addComponents(userIdInput));

    await interaction.showModal(modal);
  }

  /**
   * 닉네임 수정 모달 표시
   */
  async showEditModal(interaction, platform, existingNickname) {
    const modal = new ModalBuilder()
      .setCustomId(`${NicknameConstants.CUSTOM_ID_PREFIXES.EDIT_MODAL}${platform.id}_${Date.now()}`)
      .setTitle(`${platform.platform_name} 닉네임 수정`);

    const userIdInput = new TextInputBuilder()
      .setCustomId('user_identifier')
      .setLabel('사용자 ID')
      .setValue(existingNickname.user_identifier)
      .setPlaceholder(`예: 76561198183295061`)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(NicknameConstants.LIMITS.USER_IDENTIFIER_MAX);

    modal.addComponents(new ActionRowBuilder().addComponents(userIdInput));

    await interaction.showModal(modal);
  }

  /**
   * 닉네임 삭제 드롭다운 처리 (ID 기반)
   */
  async handleDeleteSelect(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const nicknameId = parseInt(interaction.values[0], 10);
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    // 삭제할 닉네임 정보 조회 (삭제 전에 플랫폼명을 가져오기 위해)
    const nicknames = await this.userNicknameService.getUserNicknames(guildId, userId);
    const targetNickname = nicknames.find((n) => n.id === nicknameId);

    if (!targetNickname) {
      await interaction.editReply({
        content: NicknameConstants.MESSAGES.NICKNAME_NOT_FOUND,
      });
      return;
    }

    // ID 기반 닉네임 삭제
    const success = await this.userNicknameService.deleteNicknameById(nicknameId);

    if (success) {
      await interaction.editReply({
        content: `${NicknameConstants.MESSAGES.NICKNAME_DELETED}\n플랫폼: **${targetNickname.platform_name}**\nID: \`${targetNickname.user_identifier}\``,
      });
    } else {
      await interaction.editReply({
        content: '❌ 닉네임 삭제에 실패했습니다.',
      });
    }
  }
}
