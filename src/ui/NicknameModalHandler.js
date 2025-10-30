// src/ui/NicknameModalHandler.js - 닉네임 모달 핸들러

import { MessageFlags } from 'discord.js';
import { NicknameConstants } from '../config/NicknameConstants.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';
import { EmojiParser } from '../utils/EmojiParser.js';

export class NicknameModalHandler {
  constructor(platformTemplateService, userNicknameService) {
    this.platformTemplateService = platformTemplateService;
    this.userNicknameService = userNicknameService;
  }

  /**
   * 모달 제출 처리
   */
  async handleModalSubmit(interaction) {
    try {
      const customId = interaction.customId;

      // 관리자 플랫폼 추가 모달
      if (customId.startsWith(NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_ADD_MODAL)) {
        await this.handleAdminAdd(interaction);
      }
      // 관리자 플랫폼 수정 모달
      else if (customId.startsWith(NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_EDIT_MODAL)) {
        await this.handleAdminEdit(interaction);
      }
      // 사용자 닉네임 추가 모달
      else if (customId.startsWith(NicknameConstants.CUSTOM_ID_PREFIXES.ADD_MODAL)) {
        await this.handleUserAdd(interaction);
      }
      // 사용자 닉네임 수정 모달
      else if (customId.startsWith(NicknameConstants.CUSTOM_ID_PREFIXES.EDIT_MODAL)) {
        await this.handleUserEdit(interaction);
      }
    } catch (error) {
      console.error('[NicknameModalHandler] 오류:', error);
      await SafeInteraction.safeReply(interaction, {
        content: `❌ 오류: ${error.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * 관리자 플랫폼 추가 처리
   */
  async handleAdminAdd(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const platformName = interaction.fields.getTextInputValue('platform_name');
    const emojiInput = interaction.fields.getTextInputValue('platform_emoji') || undefined;
    const baseUrl = interaction.fields.getTextInputValue('base_url');
    const urlPattern = interaction.fields.getTextInputValue('url_pattern') || undefined;

    // 이모지 처리 (입력이 있는 경우에만)
    let emojiUnicode = emojiInput;
    if (emojiInput) {
      // :name: 형태를 <:name:id> 형태로 자동 변환
      const resolveResult = EmojiParser.resolveEmoji(emojiInput, interaction.guild);
      if (resolveResult.error) {
        await interaction.editReply({
          content: resolveResult.error,
        });
        return;
      }
      emojiUnicode = resolveResult.emoji;

      // 변환된 이모지 검증
      const emojiValidation = EmojiParser.validate(emojiUnicode);
      if (!emojiValidation.valid) {
        await interaction.editReply({
          content: emojiValidation.error,
        });
        return;
      }
    }

    const platform = await this.platformTemplateService.addPlatform(interaction.guild.id, {
      platformName,
      emojiUnicode,
      baseUrl,
      urlPattern,
    });

    await interaction.editReply({
      content: `${NicknameConstants.MESSAGES.PLATFORM_ADDED}\n플랫폼: **${platform.platform_name}**`,
    });
  }

  /**
   * 관리자 플랫폼 수정 처리
   */
  async handleAdminEdit(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const platformId = parseInt(interaction.customId.replace(NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_EDIT_MODAL, ''), 10);
    const platformName = interaction.fields.getTextInputValue('platform_name');
    const emojiInput = interaction.fields.getTextInputValue('platform_emoji') || undefined;
    const baseUrl = interaction.fields.getTextInputValue('base_url');
    const urlPattern = interaction.fields.getTextInputValue('url_pattern') || undefined;

    // 이모지 처리 (입력이 있는 경우에만)
    let emojiUnicode = emojiInput;
    if (emojiInput) {
      // :name: 형태를 <:name:id> 형태로 자동 변환
      const resolveResult = EmojiParser.resolveEmoji(emojiInput, interaction.guild);
      if (resolveResult.error) {
        await interaction.editReply({
          content: resolveResult.error,
        });
        return;
      }
      emojiUnicode = resolveResult.emoji;

      // 변환된 이모지 검증
      const emojiValidation = EmojiParser.validate(emojiUnicode);
      if (!emojiValidation.valid) {
        await interaction.editReply({
          content: emojiValidation.error,
        });
        return;
      }
    }

    const platform = await this.platformTemplateService.updatePlatform(platformId, interaction.guild.id, {
      platformName,
      emojiUnicode,
      baseUrl,
      urlPattern,
    });

    await interaction.editReply({
      content: `${NicknameConstants.MESSAGES.PLATFORM_UPDATED}\n플랫폼: **${platform.platform_name}**`,
    });
  }

  /**
   * 사용자 닉네임 추가 처리
   */
  async handleUserAdd(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const parts = interaction.customId.replace(NicknameConstants.CUSTOM_ID_PREFIXES.ADD_MODAL, '').split('_');
    const platformId = parseInt(parts[0], 10);
    const userIdentifier = interaction.fields.getTextInputValue('user_identifier');

    const nickname = await this.userNicknameService.addNickname(
      interaction.guild.id,
      interaction.user.id,
      platformId,
      userIdentifier
    );

    const platform = await this.platformTemplateService.getPlatformById(platformId);

    await interaction.editReply({
      content: `${NicknameConstants.MESSAGES.NICKNAME_ADDED}\n플랫폼: **${platform.platform_name}**\nID: \`${userIdentifier}\`\nURL: ${nickname.full_url}`,
    });
  }

  /**
   * 사용자 닉네임 수정 처리 (ID 기반)
   */
  async handleUserEdit(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // customId에서 nicknameId 추출: nickname_edit_modal_<id>
    const nicknameId = parseInt(interaction.customId.replace(NicknameConstants.CUSTOM_ID_PREFIXES.EDIT_MODAL, ''), 10);
    const newUserIdentifier = interaction.fields.getTextInputValue('user_identifier');

    // ID 기반 수정
    const nickname = await this.userNicknameService.updateNicknameById(nicknameId, newUserIdentifier);

    // 플랫폼 정보 조회
    const platform = await this.platformTemplateService.getPlatformById(nickname.platform_id);

    const fullUrlText = nickname.full_url ? `\nURL: ${nickname.full_url}` : '';

    await interaction.editReply({
      content: `${NicknameConstants.MESSAGES.NICKNAME_UPDATED}\n플랫폼: **${platform.platform_name}**\n새 ID: \`${newUserIdentifier}\`${fullUrlText}`,
    });
  }
}
