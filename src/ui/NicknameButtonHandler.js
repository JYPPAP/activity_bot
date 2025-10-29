// src/ui/NicknameButtonHandler.js - 닉네임 버튼 핸들러

import { MessageFlags, StringSelectMenuBuilder, ActionRowBuilder } from 'discord.js';
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
}
