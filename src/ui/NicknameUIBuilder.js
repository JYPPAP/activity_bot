import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { NicknameConstants } from '../config/NicknameConstants.js';
import { logger } from '../config/logger-termux.js';
import { EmojiParser } from '../utils/EmojiParser.js';

export function createNicknameEmbed() {
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

export function createMainSelectMenu(channelId, platforms) {
  const options = [{
    label: '➕ 닉네임 등록!',
    description: '새로운 플랫폼 닉네임을 등록합니다',
    value: NicknameConstants.SPECIAL_VALUES.REGISTER,
    emoji: NicknameConstants.DEFAULT_EMOJIS.REGISTER,
  }];

  for (const platform of platforms) {
    let emoji = NicknameConstants.DEFAULT_EMOJIS.PLATFORM;
    try {
      emoji = EmojiParser.parse(platform.emoji_unicode, emoji);
    } catch (error) {
      logger.error(`플랫폼 이모지 파싱 실패: ${platform.platform_name}`, {
        error: error.message,
        stack: error.stack,
      });
    }

    options.push({
      label: platform.platform_name,
      description: `${platform.platform_name} 닉네임 등록 또는 수정`,
      value: `platform_${platform.id}`,
      emoji,
    });
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`${NicknameConstants.CUSTOM_ID_PREFIXES.MAIN_SELECT}${channelId}`)
    .setPlaceholder('닉네임 등록!')
    .addOptions(options);

  return new ActionRowBuilder().addComponents(selectMenu);
}

export function createActionButtons(channelId, admin = false) {
  const button = (prefix, label, emoji, style) => new ButtonBuilder()
    .setCustomId(`${prefix}${channelId}`)
    .setLabel(label)
    .setEmoji(emoji)
    .setStyle(style);

  const deleteButton = button(
    NicknameConstants.CUSTOM_ID_PREFIXES.DELETE_BTN,
    '닉네임 삭제',
    NicknameConstants.DEFAULT_EMOJIS.DELETE,
    ButtonStyle.Danger
  );
  const viewButton = button(
    NicknameConstants.CUSTOM_ID_PREFIXES.VIEW_BTN,
    '내 정보 조회',
    NicknameConstants.DEFAULT_EMOJIS.VIEW,
    admin ? ButtonStyle.Primary : ButtonStyle.Secondary
  );

  if (!admin) {
    return new ActionRowBuilder().addComponents(
      deleteButton,
      button(
        NicknameConstants.CUSTOM_ID_PREFIXES.EDIT_BTN,
        '닉네임 수정',
        NicknameConstants.DEFAULT_EMOJIS.EDIT,
        ButtonStyle.Primary
      ),
      viewButton
    );
  }

  return new ActionRowBuilder().addComponents(
    viewButton,
    deleteButton,
    button(
      NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_ADD_BTN,
      '플랫폼 추가',
      NicknameConstants.DEFAULT_EMOJIS.REGISTER,
      ButtonStyle.Success
    ),
    button(
      NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_EDIT_BTN,
      '플랫폼 수정',
      NicknameConstants.DEFAULT_EMOJIS.EDIT,
      ButtonStyle.Secondary
    ),
    button(
      NicknameConstants.CUSTOM_ID_PREFIXES.ADMIN_DELETE_BTN,
      '플랫폼 삭제',
      NicknameConstants.DEFAULT_EMOJIS.DELETE,
      ButtonStyle.Danger
    )
  );
}
