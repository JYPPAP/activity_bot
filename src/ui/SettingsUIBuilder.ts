// src/ui/SettingsUIBuilder.ts - 설정 UI 빌더
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  // ComponentType 사용되지 않음
} from 'discord.js';

import { isDevelopment } from '../config/env.js';
import {
  RoleActivitySetting,
  GameListSetting,
  ExcludeChannelsSetting,
  ChannelManagementSetting,
} from '../services/GuildSettingsManager.js';

export interface SettingsUIComponents {
  embed: EmbedBuilder;
  components: ActionRowBuilder<any>[];
}

export interface SettingsMainMenuOptions {
  guildName: string;
  roleActivityCount: number;
  gameListCount: number;
  excludeChannelsCount: number;
  channelManagementCount: number;
}

export interface RoleActivityModalOptions {
  roleName?: string;
  currentHours?: number;
  isEdit?: boolean;
}

export interface GameListModalOptions {
  currentGames?: string[];
  isEdit?: boolean;
}

export interface ExcludeChannelsModalOptions {
  currentExcludedChannels?: string[];
  currentActivityLimitedChannels?: string[];
  isEdit?: boolean;
}

export interface ChannelManagementModalOptions {
  currentSettings?: ChannelManagementSetting;
  isEdit?: boolean;
}

/**
 * 설정 관련 UI 컴포넌트 빌더
 */
export class SettingsUIBuilder {
  private static readonly COLORS = {
    INFO: 0x3498db,
    SUCCESS: 0x2ecc71,
    WARNING: 0xf39c12,
    ERROR: 0xe74c3c,
  };

  private static readonly EMOJIS = {
    SETTINGS: '⚙️',
    ACTIVITY: '📊',
    GAMES: '🎮',
    EXCLUDE: '🚫',
    CHANNELS: '📋',
    VIEW: '👁️',
    SAVE: '💾',
    CANCEL: '❌',
    EDIT: '✏️',
    ADD: '➕',
    DELETE: '🗑️',
  };

  /**
   * 메인 설정 메뉴 생성
   */
  static createMainMenu(options: SettingsMainMenuOptions): SettingsUIComponents {
    const titlePrefix = isDevelopment() ? '[DEV] ' : '';

    const embed = new EmbedBuilder()
      .setTitle(`${titlePrefix}${this.EMOJIS.SETTINGS} 서버 설정 관리`)
      .setDescription(
        `**${options.guildName}** 서버의 설정을 관리할 수 있습니다.\n\n아래 버튼을 클릭하여 원하는 설정을 변경하세요.`
      )
      .addFields(
        {
          name: `${this.EMOJIS.ACTIVITY} 활동시간 지정`,
          value: `역할별 최소 활동시간 설정\n현재 ${options.roleActivityCount}개 역할 설정됨`,
          inline: true,
        },
        {
          name: `${this.EMOJIS.GAMES} 게임 목록 설정`,
          value: `게임 태그용 게임 목록 관리\n현재 ${options.gameListCount}개 게임 등록됨`,
          inline: true,
        },
        {
          name: `${this.EMOJIS.EXCLUDE} 제외 채널 지정`,
          value: `활동시간 추적 제외 채널 설정\n현재 ${options.excludeChannelsCount}개 채널 제외됨`,
          inline: true,
        },
        {
          name: `${this.EMOJIS.CHANNELS} 관리 채널 지정`,
          value: `보고서, 구인구직 채널 관리\n현재 ${options.channelManagementCount}개 채널 설정됨`,
          inline: false,
        }
      )
      .setColor(this.COLORS.INFO)
      .setFooter({ text: '관리자 권한이 필요합니다.' })
      .setTimestamp();

    const components = [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('settings_activity_time')
          .setLabel('활동시간 지정')
          .setEmoji(this.EMOJIS.ACTIVITY)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('settings_game_list')
          .setLabel('게임 목록 설정')
          .setEmoji(this.EMOJIS.GAMES)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('settings_exclude_channels')
          .setLabel('제외 채널 지정')
          .setEmoji(this.EMOJIS.EXCLUDE)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('settings_channel_management')
          .setLabel('관리 채널 지정')
          .setEmoji(this.EMOJIS.CHANNELS)
          .setStyle(ButtonStyle.Primary)
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('settings_view_all')
          .setLabel('현재 설정 확인')
          .setEmoji(this.EMOJIS.VIEW)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('settings_cancel')
          .setLabel('닫기')
          .setEmoji(this.EMOJIS.CANCEL)
          .setStyle(ButtonStyle.Secondary)
      ),
    ];

    return { embed, components };
  }

  /**
   * 역할 활동시간 설정 모달 생성
   */
  static createRoleActivityModal(options: RoleActivityModalOptions = {}): ModalBuilder {
    const title = options.isEdit ? '역할 활동시간 수정' : '역할 활동시간 설정';
    const modalId = options.isEdit ? 'modal_edit_role_activity' : 'modal_add_role_activity';

    const modal = new ModalBuilder().setCustomId(modalId).setTitle(title);

    const roleNameInput = new TextInputBuilder()
      .setCustomId('role_name')
      .setLabel('역할 이름')
      .setPlaceholder('예: 정규멤버, 준회원, 관리자')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(50)
      .setRequired(true);

    if (options.roleName) {
      roleNameInput.setValue(options.roleName);
    }

    const hoursInput = new TextInputBuilder()
      .setCustomId('min_hours')
      .setLabel('최소 활동시간 (시간)')
      .setPlaceholder('예: 10 (0-168 사이의 숫자)')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(3)
      .setRequired(true);

    if (options.currentHours !== undefined) {
      hoursInput.setValue(options.currentHours.toString());
    }

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(roleNameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(hoursInput)
    );

    return modal;
  }

  /**
   * 게임 목록 설정 모달 생성
   */
  static createGameListModal(options: GameListModalOptions = {}): ModalBuilder {
    const title = options.isEdit ? '게임 목록 수정' : '게임 목록 설정';
    const modalId = options.isEdit ? 'modal_edit_game_list' : 'modal_add_game_list';

    const modal = new ModalBuilder().setCustomId(modalId).setTitle(title);

    const gameListInput = new TextInputBuilder()
      .setCustomId('game_list')
      .setLabel('게임 목록 (쉼표로 구분)')
      .setPlaceholder('예: 롤, 스팀, 넥슨, 보드게임, 생존게임, 공포게임')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(1000)
      .setRequired(true);

    if (options.currentGames && options.currentGames.length > 0) {
      gameListInput.setValue(options.currentGames.join(', '));
    }

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(gameListInput));

    return modal;
  }

  /**
   * 제외 채널 설정 모달 생성
   */
  static createExcludeChannelsModal(options: ExcludeChannelsModalOptions = {}): ModalBuilder {
    const title = options.isEdit ? '제외 채널 수정' : '제외 채널 설정';
    const modalId = options.isEdit ? 'modal_edit_exclude_channels' : 'modal_add_exclude_channels';

    const modal = new ModalBuilder().setCustomId(modalId).setTitle(title);

    const excludedChannelIdsInput = new TextInputBuilder()
      .setCustomId('excluded_channel_ids')
      .setLabel('완전 제외 채널 ID 목록 (쉼표로 구분)')
      .setPlaceholder('예: 1234567890123456789, 9876543210987654321')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(2000)
      .setRequired(false);

    if (options.currentExcludedChannels && options.currentExcludedChannels.length > 0) {
      excludedChannelIdsInput.setValue(options.currentExcludedChannels.join(', '));
    }

    const activityLimitedChannelIdsInput = new TextInputBuilder()
      .setCustomId('activity_limited_channel_ids')
      .setLabel('활동 제한 채널 ID 목록 (쉼표로 구분)')
      .setPlaceholder('예: 1234567890123456789, 9876543210987654321')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(2000)
      .setRequired(false);

    if (
      options.currentActivityLimitedChannels &&
      options.currentActivityLimitedChannels.length > 0
    ) {
      activityLimitedChannelIdsInput.setValue(options.currentActivityLimitedChannels.join(', '));
    }

    const infoInput = new TextInputBuilder()
      .setCustomId('exclude_channels_info')
      .setLabel('📝 설정 안내')
      .setPlaceholder(
        '• 완전 제외: 활동 추적 + 로그 둘 다 제외\n• 활동 제한: 로그는 출력, 활동 추적만 제외\n• 쉼표(,)로 채널 ID를 구분하세요'
      )
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(excludedChannelIdsInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(activityLimitedChannelIdsInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(infoInput)
    );

    return modal;
  }

  /**
   * 관리 채널 설정 모달 생성
   */
  static createChannelManagementModal(options: ChannelManagementModalOptions = {}): ModalBuilder {
    const title = options.isEdit ? '관리 채널 수정' : '관리 채널 설정';
    const modalId = options.isEdit
      ? 'modal_edit_channel_management'
      : 'modal_add_channel_management';

    const modal = new ModalBuilder().setCustomId(modalId).setTitle(title);

    const logChannelInput = new TextInputBuilder()
      .setCustomId('log_channel_id')
      .setLabel('로그 활성화 (채널 ID 입력)')
      .setPlaceholder('예: 1234567890123456789')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(20)
      .setRequired(false);

    if (options.currentSettings?.logChannelId) {
      logChannelInput.setValue(options.currentSettings.logChannelId);
    }

    const forumChannelInput = new TextInputBuilder()
      .setCustomId('forum_channel_id')
      .setLabel('구인구직 활성화 (포럼 채널 ID 입력)')
      .setPlaceholder('예: 1234567890123456789')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(20)
      .setRequired(false);

    if (options.currentSettings?.forumChannelId) {
      forumChannelInput.setValue(options.currentSettings.forumChannelId);
    }

    const voiceCategoryInput = new TextInputBuilder()
      .setCustomId('voice_category_id')
      .setLabel('게임 음성 채널 생성 활성화 (카테고리 ID 입력)')
      .setPlaceholder('예: 1234567890123456789')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(20)
      .setRequired(false);

    if (options.currentSettings?.voiceCategoryId) {
      voiceCategoryInput.setValue(options.currentSettings.voiceCategoryId);
    }

    const forumTagInput = new TextInputBuilder()
      .setCustomId('forum_tag_id')
      .setLabel('구인구직 태그 활성화 (태그 ID 입력)')
      .setPlaceholder('예: 1234567890123456789')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(20)
      .setRequired(false);

    if (options.currentSettings?.forumTagId) {
      forumTagInput.setValue(options.currentSettings.forumTagId);
    }

    const infoInput = new TextInputBuilder()
      .setCustomId('channel_management_info')
      .setLabel('📝 설정 안내')
      .setPlaceholder(
        '• 로그 채널: 활동 보고서 출력 채널\n• 포럼 채널: 구인구직 게시글 작성 채널\n• 음성 카테고리: 게임별 음성 채널 생성 위치\n• 포럼 태그: 구인구직 게시글 태그'
      )
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(logChannelInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(forumChannelInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(voiceCategoryInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(forumTagInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(infoInput)
    );

    return modal;
  }

  /**
   * 현재 설정 확인 임베드 생성
   */
  static createSettingsOverview(
    guildName: string,
    roleActivities: { [roleName: string]: RoleActivitySetting },
    gameList: GameListSetting | null,
    excludeChannels: ExcludeChannelsSetting | null,
    channelManagement: ChannelManagementSetting | null
  ): EmbedBuilder {
    const titlePrefix = isDevelopment() ? '[DEV] ' : '';

    const embed = new EmbedBuilder()
      .setTitle(`${titlePrefix}${this.EMOJIS.VIEW} 현재 설정 확인`)
      .setDescription(`**${guildName}** 서버의 현재 설정 상태입니다.`)
      .setColor(this.COLORS.INFO)
      .setTimestamp();

    // 역할 활동시간 설정
    const roleActivityEntries = Object.entries(roleActivities);
    if (roleActivityEntries.length > 0) {
      const roleActivityText = roleActivityEntries
        .map(([roleName, setting]) => `• **${roleName}**: ${setting.minHours}시간`)
        .join('\n');
      embed.addFields({
        name: `${this.EMOJIS.ACTIVITY} 역할별 활동시간 (${roleActivityEntries.length}개)`,
        value:
          roleActivityText.length > 1000
            ? roleActivityText.substring(0, 1000) + '...'
            : roleActivityText,
        inline: false,
      });
    } else {
      embed.addFields({
        name: `${this.EMOJIS.ACTIVITY} 역할별 활동시간`,
        value: '설정된 역할이 없습니다.',
        inline: false,
      });
    }

    // 게임 목록 설정
    if (gameList && gameList.games.length > 0) {
      const gameListText = gameList.games.map((game) => `• ${game}`).join('\n');
      embed.addFields({
        name: `${this.EMOJIS.GAMES} 게임 목록 (${gameList.games.length}개)`,
        value: gameListText.length > 1000 ? gameListText.substring(0, 1000) + '...' : gameListText,
        inline: false,
      });
    } else {
      embed.addFields({
        name: `${this.EMOJIS.GAMES} 게임 목록`,
        value: '설정된 게임이 없습니다.',
        inline: false,
      });
    }

    // 제외 채널 설정
    if (excludeChannels) {
      const excludedChannelText =
        excludeChannels.excludedChannels.length > 0
          ? excludeChannels.excludedChannels.map((id) => `• <#${id}>`).join('\n')
          : '설정된 완전 제외 채널이 없습니다.';

      const activityLimitedChannelText =
        excludeChannels.activityLimitedChannels.length > 0
          ? excludeChannels.activityLimitedChannels.map((id) => `• <#${id}>`).join('\n')
          : '설정된 활동 제한 채널이 없습니다.';

      const totalChannels =
        excludeChannels.excludedChannels.length + excludeChannels.activityLimitedChannels.length;

      const combinedText = `**완전 제외 (${excludeChannels.excludedChannels.length}개)**\n${excludedChannelText}\n\n**활동 제한 (${excludeChannels.activityLimitedChannels.length}개)**\n${activityLimitedChannelText}`;

      embed.addFields({
        name: `${this.EMOJIS.EXCLUDE} 제외 채널 설정 (총 ${totalChannels}개)`,
        value: combinedText.length > 1000 ? combinedText.substring(0, 1000) + '...' : combinedText,
        inline: false,
      });
    } else {
      embed.addFields({
        name: `${this.EMOJIS.EXCLUDE} 제외 채널 설정`,
        value: '설정된 제외 채널이 없습니다.',
        inline: false,
      });
    }

    // 채널 관리 설정
    if (channelManagement) {
      const channelFields: string[] = [];

      if (channelManagement.logChannelId) {
        channelFields.push(`• **로그 채널**: <#${channelManagement.logChannelId}>`);
      }
      if (channelManagement.forumChannelId) {
        channelFields.push(`• **포럼 채널**: <#${channelManagement.forumChannelId}>`);
      }
      if (channelManagement.voiceCategoryId) {
        channelFields.push(`• **음성 카테고리**: <#${channelManagement.voiceCategoryId}>`);
      }
      if (channelManagement.forumTagId) {
        channelFields.push(`• **포럼 태그 ID**: ${channelManagement.forumTagId}`);
      }

      const channelText =
        channelFields.length > 0 ? channelFields.join('\n') : '설정된 채널이 없습니다.';

      embed.addFields({
        name: `${this.EMOJIS.CHANNELS} 관리 채널`,
        value: channelText.length > 1000 ? channelText.substring(0, 1000) + '...' : channelText,
        inline: false,
      });
    } else {
      embed.addFields({
        name: `${this.EMOJIS.CHANNELS} 관리 채널`,
        value: '설정된 채널이 없습니다.',
        inline: false,
      });
    }

    return embed;
  }

  /**
   * 성공 메시지 임베드 생성
   */
  static createSuccessEmbed(title: string, description: string, details?: string): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`${this.EMOJIS.SAVE} ${title}`)
      .setDescription(description)
      .setColor(this.COLORS.SUCCESS)
      .setTimestamp();

    if (details) {
      embed.addFields({
        name: '상세 정보',
        value: details,
        inline: false,
      });
    }

    return embed;
  }

  /**
   * 오류 메시지 임베드 생성
   */
  static createErrorEmbed(title: string, error: string, suggestions?: string[]): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`${this.EMOJIS.CANCEL} ${title}`)
      .setDescription(error)
      .setColor(this.COLORS.ERROR)
      .setTimestamp();

    if (suggestions && suggestions.length > 0) {
      embed.addFields({
        name: '해결 방법',
        value: suggestions.map((s) => `• ${s}`).join('\n'),
        inline: false,
      });
    }

    return embed;
  }

  /**
   * 경고 메시지 임베드 생성
   */
  static createWarningEmbed(title: string, warnings: string[]): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`⚠️ ${title}`)
      .setDescription('설정이 저장되었지만 다음 경고사항이 있습니다:')
      .setColor(this.COLORS.WARNING)
      .addFields({
        name: '경고 사항',
        value: warnings.map((w) => `• ${w}`).join('\n'),
        inline: false,
      })
      .setTimestamp();

    return embed;
  }

  /**
   * 역할 선택 드롭다운 생성
   */
  static createRoleSelectMenu(
    customId: string,
    placeholder: string,
    roles: { [roleName: string]: RoleActivitySetting },
    maxValues: number = 1
  ): ActionRowBuilder<StringSelectMenuBuilder> {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .setMaxValues(maxValues)
      .setMinValues(1);

    const options = Object.entries(roles).map(([roleName, setting]) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(roleName)
        .setValue(roleName)
        .setDescription(`현재 설정: ${setting.minHours}시간`)
        .setEmoji(this.EMOJIS.ACTIVITY)
    );

    if (options.length === 0) {
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel('설정된 역할이 없습니다')
          .setValue('no_roles')
          .setDescription('먼저 역할을 추가해주세요')
          .setEmoji(this.EMOJIS.CANCEL)
      );
    }

    selectMenu.addOptions(options);

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
  }

  /**
   * 관리 버튼 생성
   */
  static createManagementButtons(
    hasSettings: boolean,
    settingType: 'activity' | 'games' | 'channels' | 'channel_management'
  ): ActionRowBuilder<ButtonBuilder> {
    const buttons = [
      new ButtonBuilder()
        .setCustomId(`settings_${settingType}_add`)
        .setLabel('추가')
        .setEmoji(this.EMOJIS.ADD)
        .setStyle(ButtonStyle.Success),
    ];

    if (hasSettings) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`settings_${settingType}_edit`)
          .setLabel('수정')
          .setEmoji(this.EMOJIS.EDIT)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`settings_${settingType}_delete`)
          .setLabel('삭제')
          .setEmoji(this.EMOJIS.DELETE)
          .setStyle(ButtonStyle.Danger)
      );
    }

    buttons.push(
      new ButtonBuilder()
        .setCustomId('settings_back_to_main')
        .setLabel('메인으로')
        .setEmoji('🔙')
        .setStyle(ButtonStyle.Secondary)
    );

    return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
  }
}
