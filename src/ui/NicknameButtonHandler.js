import { logger } from '../config/logger-termux.js';
// src/ui/NicknameButtonHandler.js - 닉네임 버튼 핸들러

import { MessageFlags, StringSelectMenuBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ComponentType, EmbedBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
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
      // 닉네임 수정 버튼
      else if (customId.startsWith(NicknameConstants.CUSTOM_ID_PREFIXES.EDIT_BTN)) {
        await this.handleEditButton(interaction);
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
      logger.error('[NicknameButtonHandler] 오류', { error: error.message, stack: error.stack });
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
    const deferResult = await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    // null 실패도 기존 catch 경로로 전달하여 후속 작업을 중단한다.
    if (deferResult === null) {
      throw new Error('인터랙션 지연 응답에 실패했습니다.');
    }

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
    const options = nicknames.map((nickname) => {
      try {
        return {
          label: `${nickname.platform_name} - ${nickname.user_identifier}`,
          description: `ID: ${nickname.user_identifier}`,
          value: nickname.id.toString(),
          emoji: EmojiParser.parse(nickname.emoji_unicode, NicknameConstants.DEFAULT_EMOJIS.PLATFORM),
        };
      } catch (error) {
        logger.error(`[NicknameButtonHandler] Failed to parse emoji for ${nickname.platform_name}`, { error: error.message, stack: error.stack });
        return {
          label: `${nickname.platform_name} - ${nickname.user_identifier}`,
          description: `ID: ${nickname.user_identifier}`,
          value: nickname.id.toString(),
          emoji: NicknameConstants.DEFAULT_EMOJIS.PLATFORM,
        };
      }
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`${NicknameConstants.CUSTOM_ID_PREFIXES.DELETE_SELECT}${Date.now()}`)
      .setPlaceholder('삭제할 닉네임들을 선택하세요')
      .setMinValues(1)
      .setMaxValues(Math.min(options.length, 15)) // 최대 15개까지 선택 가능
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.editReply({
      content: '삭제할 닉네임을 선택하세요:',
      components: [row],
    });
  }

  /**
   * 닉네임 수정 버튼 처리
   */
  async handleEditButton(interaction) {
    const deferResult = await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    // null 실패도 기존 catch 경로로 전달하여 후속 작업을 중단한다.
    if (deferResult === null) {
      throw new Error('인터랙션 지연 응답에 실패했습니다.');
    }

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    // 사용자의 모든 닉네임 가져오기
    const nicknames = await this.userNicknameService.getUserNicknames(guildId, userId);

    if (nicknames.length === 0) {
      await interaction.editReply({
        content: NicknameConstants.MESSAGES.NO_ACCOUNTS_TO_EDIT,
      });
      return;
    }

    // 수정할 닉네임 선택 드롭다운 생성
    const options = nicknames.map((nickname) => {
      try {
        return {
          label: `${nickname.platform_name} - ${nickname.user_identifier}`,
          description: `ID: ${nickname.user_identifier}`,
          value: nickname.id.toString(),
          emoji: EmojiParser.parse(nickname.emoji_unicode, NicknameConstants.DEFAULT_EMOJIS.PLATFORM),
        };
      } catch (error) {
        logger.error(`[NicknameButtonHandler] Failed to parse emoji for ${nickname.platform_name}`, { error: error.message, stack: error.stack });
        return {
          label: `${nickname.platform_name} - ${nickname.user_identifier}`,
          description: `ID: ${nickname.user_identifier}`,
          value: nickname.id.toString(),
          emoji: NicknameConstants.DEFAULT_EMOJIS.PLATFORM,
        };
      }
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`${NicknameConstants.CUSTOM_ID_PREFIXES.EDIT_SELECT}${Date.now()}`)
      .setPlaceholder('수정할 닉네임을 선택하세요')
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const response = await interaction.editReply({
      content: '수정할 닉네임을 선택하세요:',
      components: [row],
    });

    // 드롭다운 선택 대기
    try {
      const selectInteraction = await response.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        time: 60000,
      });

      const nicknameId = parseInt(selectInteraction.values[0], 10);
      const selectedNickname = nicknames.find((n) => n.id === nicknameId);

      // 수정 모달 표시
      const modal = new ModalBuilder()
        .setCustomId(`${NicknameConstants.CUSTOM_ID_PREFIXES.EDIT_MODAL}${nicknameId}`)
        .setTitle(`${selectedNickname.platform_name} 닉네임 수정`);

      const userIdInput = new TextInputBuilder()
        .setCustomId('user_identifier')
        .setLabel('닉네임 또는 친구코드')
        .setValue(selectedNickname.user_identifier)
        .setPlaceholder(`예: 76561198183295061`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(NicknameConstants.LIMITS.USER_IDENTIFIER_MAX);

      modal.addComponents(new ActionRowBuilder().addComponents(userIdInput));

      await selectInteraction.showModal(modal);
    } catch (error) {
      logger.error('[NicknameButtonHandler] 수정 시간 초과', { error: error.message, stack: error.stack });
      await interaction.editReply({ content: '시간 초과되었습니다.', components: [] });
    }
  }

  /**
   * 내 정보 조회 버튼 처리
   */
  async handleViewButton(interaction) {
    const deferResult = await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    // null 실패도 기존 catch 경로로 전달하여 후속 작업을 중단한다.
    if (deferResult === null) {
      throw new Error('인터랙션 지연 응답에 실패했습니다.');
    }

    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    // 사용자의 모든 닉네임 가져오기
    const nicknames = await this.userNicknameService.getUserNicknames(guildId, userId);

    // 임베드 생성
    const embedData = this.userNicknameService.createMyNicknamesEmbed(interaction.user, interaction.member, nicknames);

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
      .setMaxLength(100);

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
    const deferResult = await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    // null 실패도 기존 catch 경로로 전달하여 후속 작업을 중단한다.
    if (deferResult === null) {
      throw new Error('인터랙션 지연 응답에 실패했습니다.');
    }

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
        platforms.map((platform) => {
          try {
            return {
              label: platform.platform_name,
              value: platform.id.toString(),
              emoji: EmojiParser.parse(platform.emoji_unicode, NicknameConstants.DEFAULT_EMOJIS.PLATFORM),
            };
          } catch (error) {
            logger.error(`[NicknameButtonHandler] Failed to parse emoji for platform ${platform.platform_name}`, { error: error.message, stack: error.stack });
            return {
              label: platform.platform_name,
              value: platform.id.toString(),
              emoji: NicknameConstants.DEFAULT_EMOJIS.PLATFORM,
            };
          }
        })
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
        .setMaxLength(100);

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
      logger.error('[NicknameButtonHandler] 수정 시간 초과', { error: error.message, stack: error.stack });
      await interaction.editReply({ content: '시간 초과되었습니다.', components: [] });
    }
  }

  /**
   * 관리자 플랫폼 삭제 버튼 처리
   */
  async handleAdminDeleteButton(interaction) {
    const deferResult = await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    // null 실패도 기존 catch 경로로 전달하여 후속 작업을 중단한다.
    if (deferResult === null) {
      throw new Error('인터랙션 지연 응답에 실패했습니다.');
    }

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
        platforms.map((platform) => {
          try {
            return {
              label: platform.platform_name,
              value: platform.id.toString(),
              emoji: EmojiParser.parse(platform.emoji_unicode, NicknameConstants.DEFAULT_EMOJIS.PLATFORM),
              description: `Base URL: ${platform.base_url.substring(0, 50)}...`,
            };
          } catch (error) {
            logger.error(`[NicknameButtonHandler] Failed to parse emoji for platform ${platform.platform_name}`, { error: error.message, stack: error.stack });
            return {
              label: platform.platform_name,
              value: platform.id.toString(),
              emoji: NicknameConstants.DEFAULT_EMOJIS.PLATFORM,
              description: `Base URL: ${platform.base_url.substring(0, 50)}...`,
            };
          }
        })
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
          content: `${NicknameConstants.MESSAGES.PLATFORM_DELETED}\n삭제된 플랫폼: **${platform.platform_name}**\n\n✅ UI가 업데이트되었습니다.`,
          components: [],
        });

        // 닉네임 UI 메시지 찾아서 업데이트
        await this.refreshNicknameUI(interaction.channel, interaction.guild.id);
      } else {
        await selectInteraction.update({
          content: '❌ 플랫폼 삭제에 실패했습니다.',
          components: [],
        });
      }
    } catch (error) {
      logger.error('[NicknameButtonHandler] 삭제 시간 초과', { error: error.message, stack: error.stack });
      await interaction.editReply({ content: '시간 초과되었습니다.', components: [] });
    }
  }

  /**
   * 관리자 플랫폼 목록 버튼 처리
   */
  async handleAdminListButton(interaction) {
    const deferResult = await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    // null 실패도 기존 catch 경로로 전달하여 후속 작업을 중단한다.
    if (deferResult === null) {
      throw new Error('인터랙션 지연 응답에 실패했습니다.');
    }

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
        logger.info('[NicknameButtonHandler] 닉네임 UI 메시지를 찾을 수 없습니다.');
        return;
      }

      // 최신 플랫폼 목록 가져오기
      const platforms = await this.platformTemplateService.getAllPlatforms(guildId);

      if (platforms.length === 0) {
        logger.info('[NicknameButtonHandler] 플랫폼이 없습니다.');
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
        logger.error('[NicknameButtonHandler] 메시지 삭제 실패', { error: error.message, stack: error.stack });
      }

      // 새로운 메시지 전송
      await channel.send({
        embeds: [embed],
        components: [selectMenu, buttons],
      });

      logger.info('[NicknameButtonHandler] 닉네임 UI가 업데이트되었습니다.');
    } catch (error) {
      logger.error('[NicknameButtonHandler] UI 업데이트 오류', { error: error.message, stack: error.stack });
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
        logger.error(`[NicknameButtonHandler] Failed to parse emoji for platform ${platform.platform_name}`, { error: error.message, stack: error.stack });

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
