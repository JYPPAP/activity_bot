import { logger } from '../config/logger-termux.js';
// src/ui/NicknameModalHandler.js - 닉네임 모달 핸들러

import { MessageFlags } from 'discord.js';
import { NicknameConstants } from '../config/NicknameConstants.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';
import { EmojiParser } from '../utils/EmojiParser.js';
import {
  createActionButtons,
  createMainSelectMenu,
  createNicknameEmbed,
} from './NicknameUIBuilder.js';

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
      logger.error('[NicknameModalHandler] 오류', { error: error.message, stack: error.stack });
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
    const deferResult = await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    // null 실패도 기존 catch 경로로 전달하여 후속 작업을 중단한다.
    if (deferResult === null) {
      throw new Error('인터랙션 지연 응답에 실패했습니다.');
    }

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
      content: `${NicknameConstants.MESSAGES.PLATFORM_ADDED}\n플랫폼: **${platform.platform_name}**\n\n✅ UI가 업데이트되었습니다.`,
    });

    // 닉네임 UI 메시지 찾아서 업데이트
    await this.refreshNicknameUI(interaction.channel, interaction.guild.id);
  }

  /**
   * 관리자 플랫폼 수정 처리
   */
  async handleAdminEdit(interaction) {
    const deferResult = await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    // null 실패도 기존 catch 경로로 전달하여 후속 작업을 중단한다.
    if (deferResult === null) {
      throw new Error('인터랙션 지연 응답에 실패했습니다.');
    }

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
      content: `${NicknameConstants.MESSAGES.PLATFORM_UPDATED}\n플랫폼: **${platform.platform_name}**\n\n✅ UI가 업데이트되었습니다.`,
    });

    // 닉네임 UI 메시지 찾아서 업데이트
    await this.refreshNicknameUI(interaction.channel, interaction.guild.id);
  }

  /**
   * 사용자 닉네임 추가 처리
   */
  async handleUserAdd(interaction) {
    const deferResult = await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    // null 실패도 기존 catch 경로로 전달하여 후속 작업을 중단한다.
    if (deferResult === null) {
      throw new Error('인터랙션 지연 응답에 실패했습니다.');
    }

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

    const fullUrlText = nickname.full_url ? `\nURL: ${nickname.full_url}` : '';

    await interaction.editReply({
      content: `${NicknameConstants.MESSAGES.NICKNAME_ADDED}\n플랫폼: **${platform.platform_name}**\nID: \`${userIdentifier}\`${fullUrlText}`,
    });
  }

  /**
   * 사용자 닉네임 수정 처리 (ID 기반)
   */
  async handleUserEdit(interaction) {
    const deferResult = await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    // null 실패도 기존 catch 경로로 전달하여 후속 작업을 중단한다.
    if (deferResult === null) {
      throw new Error('인터랙션 지연 응답에 실패했습니다.');
    }

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

  /**
   * 닉네임 UI 메시지 찾아서 업데이트
   */
  async refreshNicknameUI(channel, guildId) {
    try {
      // 채널에서 최근 메시지 가져오기 (최대 100개)
      const messages = await channel.messages.fetch({ limit: 100 });

      // 닉네임 UI 메시지 찾기 (봇이 보낸 메시지 중 "닉네임 관리" 임베드 포함)
      const nicknameUIMessage = messages.find(msg =>
        msg.author.bot &&
        msg.embeds.length > 0 &&
        msg.embeds[0].title === `${NicknameConstants.DEFAULT_EMOJIS.REGISTER} 닉네임 관리` &&
        msg.components.length > 0
      );

      if (!nicknameUIMessage) {
        logger.info('[NicknameModalHandler] 닉네임 UI 메시지를 찾을 수 없습니다.');
        return;
      }

      // 최신 플랫폼 목록 가져오기
      const platforms = await this.platformTemplateService.getAllPlatforms(guildId);

      if (platforms.length === 0) {
        logger.info('[NicknameModalHandler] 플랫폼이 없습니다.');
        return;
      }

      // 새로운 UI 컴포넌트 생성
      const embed = createNicknameEmbed();
      const selectMenu = createMainSelectMenu(channel.id, platforms);
      const buttons = createActionButtons(channel.id, true);

      // 원래 메시지 삭제 (권한이 있는 경우에만)
      try {
        await nicknameUIMessage.delete();
      } catch (error) {
        logger.error('[NicknameModalHandler] 메시지 삭제 실패', { error: error.message, stack: error.stack });
      }

      // 새로운 메시지 전송
      await channel.send({
        embeds: [embed],
        components: [selectMenu, buttons],
      });

      logger.info('[NicknameModalHandler] 닉네임 UI가 업데이트되었습니다.');
    } catch (error) {
      logger.error('[NicknameModalHandler] UI 업데이트 오류', { error: error.message, stack: error.stack });
    }
  }

}
