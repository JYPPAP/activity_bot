import { logger } from '../config/logger-termux.js';
// src/commands/NicknameSetupCommand.js - 닉네임 설정 명령어 (사용자용)

import { MessageFlags, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { CommandBase } from './CommandBase.js';
import { NicknameConstants } from '../config/NicknameConstants.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';
import { EmojiParser } from '../utils/EmojiParser.js';

export class NicknameSetupCommand extends CommandBase {
  constructor(services) {
    super(services);
    this.platformTemplateService = services.platformTemplateService;
    this.userNicknameService = services.userNicknameService;
  }

  /**
   * 명령어 실행
   */
  async execute(interaction) {
    try {
      const deferResult = await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      // null 실패도 기존 catch 경로로 전달하여 후속 작업을 중단한다.
      if (deferResult === null) {
        throw new Error('인터랙션 지연 응답에 실패했습니다.');
      }

      const channel = interaction.channel;
      const channelId = channel.id;
      const guildId = interaction.guild.id;

      // 플랫폼 목록 가져오기
      const platforms = await this.platformTemplateService.getAllPlatforms(guildId);

      if (platforms.length === 0) {
        await interaction.editReply({
          content: NicknameConstants.MESSAGES.NO_PLATFORMS,
        });
        return;
      }

      // UI 생성
      const embed = this.createNicknameEmbed(channel.name);
      const selectMenu = this.createMainSelectMenu(channelId, platforms);
      const buttons = this.createActionButtons(channelId);

      // 채널에 메시지 전송
      await channel.send({
        embeds: [embed],
        components: [selectMenu, buttons],
      });

      // 성공 메시지
      await interaction.editReply({
        content: `✅ **${channel.name}** 채널에 닉네임 관리 UI가 설정되었습니다.`,
      });
    } catch (error) {
      logger.error('[NicknameSetupCommand] 오류', { error: error.message, stack: error.stack });
      await SafeInteraction.safeReply(interaction, {
        content: `❌ 오류: ${error.message}`,
        flags: MessageFlags.Ephemeral,
      });
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
        logger.error(`[NicknameSetupCommand] Failed to parse emoji for platform ${platform.platform_name}`, { error: error.message, stack: error.stack });

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

    const editButton = new ButtonBuilder()
      .setCustomId(`${NicknameConstants.CUSTOM_ID_PREFIXES.EDIT_BTN}${channelId}`)
      .setLabel('닉네임 수정')
      .setEmoji(NicknameConstants.DEFAULT_EMOJIS.EDIT)
      .setStyle(ButtonStyle.Primary);

    const viewButton = new ButtonBuilder()
      .setCustomId(`${NicknameConstants.CUSTOM_ID_PREFIXES.VIEW_BTN}${channelId}`)
      .setLabel('내 정보 조회')
      .setEmoji(NicknameConstants.DEFAULT_EMOJIS.VIEW)
      .setStyle(ButtonStyle.Secondary);

    return new ActionRowBuilder().addComponents(deleteButton, editButton, viewButton);
  }
}
