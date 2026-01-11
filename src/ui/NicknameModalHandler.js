// src/ui/NicknameModalHandler.js - 닉네임 모달 핸들러

import { MessageFlags, EmbedBuilder, StringSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
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
      content: `${NicknameConstants.MESSAGES.PLATFORM_ADDED}\n플랫폼: **${platform.platform_name}**\n\n✅ UI가 업데이트되었습니다.`,
    });

    // 닉네임 UI 메시지 찾아서 업데이트
    await this.refreshNicknameUI(interaction.channel, interaction.guild.id);
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
      content: `${NicknameConstants.MESSAGES.PLATFORM_UPDATED}\n플랫폼: **${platform.platform_name}**\n\n✅ UI가 업데이트되었습니다.`,
    });

    // 닉네임 UI 메시지 찾아서 업데이트
    await this.refreshNicknameUI(interaction.channel, interaction.guild.id);
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
        console.log('[NicknameModalHandler] 닉네임 UI 메시지를 찾을 수 없습니다.');
        return;
      }

      // 최신 플랫폼 목록 가져오기
      const platforms = await this.platformTemplateService.getAllPlatforms(guildId);

      if (platforms.length === 0) {
        console.log('[NicknameModalHandler] 플랫폼이 없습니다.');
        return;
      }

      // 새로운 UI 컴포넌트 생성
      const embed = this.createNicknameEmbed(channel.name);
      const selectMenu = this.createMainSelectMenu(channel.id, platforms);
      const buttons = this.createActionButtons(channel.id);

      // 원래 메시지 삭제 (권한이 있는 경우에만)
      try {
        await nicknameUIMessage.delete();
      } catch (error) {
        console.error('[NicknameModalHandler] 메시지 삭제 실패:', error.message);
      }

      // 새로운 메시지 전송
      await channel.send({
        embeds: [embed],
        components: [selectMenu, buttons],
      });

      console.log('[NicknameModalHandler] 닉네임 UI가 업데이트되었습니다.');
    } catch (error) {
      console.error('[NicknameModalHandler] UI 업데이트 오류:', error);
    }
  }

  /**
   * 닉네임 관리 임베드 생성
   */
  createNicknameEmbed(channelName) {
    return new EmbedBuilder()
      .setColor(NicknameConstants.COLORS.PRIMARY)
      .setTitle(`${NicknameConstants.DEFAULT_EMOJIS.REGISTER} 닉네임 관리`)
      .setDescription(
        '아래에서 작업을 선택하세요.\n\n' +
        '**드롭다운 사용법:**\n' +
        '• "➕ 닉네임 등록!" → 플랫폼 선택 → ID 입력\n' +
        '• 플랫폼 직접 선택 → 등록 또는 수정'
      )
      .setFooter({ text: '💡 등록된 닉네임은 음성 채널 입장 시 자동으로 표시됩니다.' });
  }

  /**
   * 메인 드롭다운 생성
   */
  createMainSelectMenu(channelId, platforms) {
    const options = [
      {
        label: '➕ 닉네임 등록!',
        description: '새로운 플랫폼 닉네임을 등록합니다',
        value: NicknameConstants.SPECIAL_VALUES.REGISTER,
        emoji: NicknameConstants.DEFAULT_EMOJIS.REGISTER,
      },
    ];

    // 플랫폼 목록 추가
    platforms.forEach((platform) => {
      try {
        const parsedEmoji = EmojiParser.parse(platform.emoji_unicode, NicknameConstants.DEFAULT_EMOJIS.PLATFORM);

        options.push({
          label: platform.platform_name,
          description: `${platform.platform_name} 닉네임 등록 또는 수정`,
          value: `platform_${platform.id}`,
          emoji: parsedEmoji,
        });
      } catch (error) {
        console.error(`[NicknameModalHandler] Failed to parse emoji for platform ${platform.platform_name}:`, error);

        // 에러 발생 시 fallback 이모지 사용
        options.push({
          label: platform.platform_name,
          description: `${platform.platform_name} 닉네임 등록 또는 수정`,
          value: `platform_${platform.id}`,
          emoji: NicknameConstants.DEFAULT_EMOJIS.PLATFORM,
        });
      }
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`${NicknameConstants.CUSTOM_ID_PREFIXES.MAIN_SELECT}${channelId}`)
      .setPlaceholder('닉네임 등록!')
      .addOptions(options);

    return new ActionRowBuilder().addComponents(selectMenu);
  }

  /**
   * 액션 버튼 생성
   */
  createActionButtons(channelId) {
    const deleteButton = new ButtonBuilder()
      .setCustomId(`${NicknameConstants.CUSTOM_ID_PREFIXES.DELETE_BTN}${channelId}`)
      .setLabel('닉네임 삭제')
      .setEmoji(NicknameConstants.DEFAULT_EMOJIS.DELETE)
      .setStyle(ButtonStyle.Danger);

    const viewButton = new ButtonBuilder()
      .setCustomId(`${NicknameConstants.CUSTOM_ID_PREFIXES.VIEW_BTN}${channelId}`)
      .setLabel('내 정보 조회')
      .setEmoji(NicknameConstants.DEFAULT_EMOJIS.VIEW)
      .setStyle(ButtonStyle.Primary);

    const adminAddButton = new ButtonBuilder()
      .setCustomId(`${NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_ADD_BTN}${channelId}`)
      .setLabel('플랫폼 추가')
      .setEmoji(NicknameConstants.DEFAULT_EMOJIS.REGISTER)
      .setStyle(ButtonStyle.Success);

    const adminEditButton = new ButtonBuilder()
      .setCustomId(`${NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_EDIT_BTN}${channelId}`)
      .setLabel('플랫폼 수정')
      .setEmoji(NicknameConstants.DEFAULT_EMOJIS.EDIT)
      .setStyle(ButtonStyle.Secondary);

    const adminDeleteButton = new ButtonBuilder()
      .setCustomId(`${NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_DELETE_BTN}${channelId}`)
      .setLabel('플랫폼 삭제')
      .setEmoji(NicknameConstants.DEFAULT_EMOJIS.DELETE)
      .setStyle(ButtonStyle.Danger);

    return new ActionRowBuilder().addComponents(
      viewButton,
      deleteButton,
      adminAddButton,
      adminEditButton,
      adminDeleteButton
    );
  }
}
