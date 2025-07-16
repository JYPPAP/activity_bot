// src/ui/RecruitmentUIBuilder.ts - 구인구직 UI 빌더
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  APIEmbedField,
} from 'discord.js';

import { DiscordConstants } from '../config/DiscordConstants';
import { RecruitmentConfig } from '../config/RecruitmentConfig';

// 기존 포스트 정보 인터페이스
interface ExistingPost {
  id: string;
  name: string;
  memberCount: number;
  archived?: boolean;
  lastActivity?: Date;
}

// 참여자 통계 인터페이스
interface ParticipantStats {
  total: number;
  active: number;
  waiting: number;
  spectating: number;
  idle?: number;
  detailed?: {
    userDetails: Array<{
      userId: string;
      username: string;
      status: 'active' | 'waiting' | 'spectating' | 'idle';
      joinTime?: Date;
    }>;
  };
}

// 임베드 구성 옵션 인터페이스
interface EmbedOptions {
  title?: string;
  description?: string;
  color?: number;
  footer?: string;
  timestamp?: boolean;
  fields?: APIEmbedField[];
  thumbnail?: string;
  image?: string;
  author?: {
    name: string;
    iconURL?: string;
    url?: string;
  };
}

// 버튼 구성 옵션 인터페이스
interface ButtonOptions {
  customId: string;
  label: string;
  style: ButtonStyle;
  emoji?: string;
  disabled?: boolean;
  url?: string;
}

// 셀렉트 메뉴 옵션 인터페이스
interface SelectMenuOption {
  label: string;
  description: string;
  value: string;
  emoji: string;
  default?: boolean;
}

// UI 구성 통계 인터페이스
interface UIBuildStatistics {
  embedsCreated: number;
  buttonsCreated: number;
  selectMenusCreated: number;
  actionRowsCreated: number;
  lastBuildTime: Date;
  buildHistory: Array<{
    timestamp: Date;
    type: 'embed' | 'button' | 'selectMenu' | 'actionRow';
    identifier: string;
  }>;
}

export class RecruitmentUIBuilder {
  private static buildStats: UIBuildStatistics = {
    embedsCreated: 0,
    buttonsCreated: 0,
    selectMenusCreated: 0,
    actionRowsCreated: 0,
    lastBuildTime: new Date(),
    buildHistory: [],
  };

  /**
   * 구인구직 연동 초기 임베드 생성
   * @param voiceChannelName - 음성 채널 이름
   * @returns 생성된 임베드
   */
  static createInitialEmbed(voiceChannelName: string): EmbedBuilder {
    this.recordBuild('embed', 'initial');

    return new EmbedBuilder()
      .setTitle('🎮 구인구직 포럼 연동')
      .setDescription(
        `음성 채널 **${voiceChannelName}**에서 구인구직을 시작하세요!\n\n` +
          '• 👁️ **관전**: 별명에 [관전] 태그 추가\n' +
          '• ⏳ **대기**: 별명에 [대기] 태그 추가\n' +
          '• 🔄 **초기화**: 별명의 태그를 제거'
      )
      .setColor(RecruitmentConfig.COLORS.INFO)
      .setFooter({ text: '아래 버튼을 클릭하여 원하는 작업을 선택하세요.' });
  }

  /**
   * 구인구직 연동 버튼들 생성
   * @param voiceChannelId - 음성 채널 ID
   * @returns 액션 로우 배열
   */
  static createInitialButtons(voiceChannelId: string): ActionRowBuilder<ButtonBuilder>[] {
    this.recordBuild('button', 'initial');

    const buttons: ButtonOptions[] = [
      {
        customId: `${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_CONNECT}${voiceChannelId}`,
        label: '🎯 연동하기',
        style: ButtonStyle.Primary,
      },
      {
        customId: `${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_SPECTATE}${voiceChannelId}`,
        label: `${DiscordConstants.EMOJIS.SPECTATOR} 관전`,
        style: ButtonStyle.Secondary,
      },
      {
        customId: `${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_WAIT}${voiceChannelId}`,
        label: '⏳ 대기',
        style: ButtonStyle.Success,
      },
      {
        customId: `${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_RESET}${voiceChannelId}`,
        label: `${DiscordConstants.EMOJIS.RESET} 초기화`,
        style: ButtonStyle.Primary,
      },
    ];

    const buttonComponents = buttons.map((buttonOption) => this.createButton(buttonOption));

    this.recordBuild('actionRow', 'initialButtons');
    return [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttonComponents)];
  }

  /**
   * 연동 방법 선택 임베드 생성
   * @param voiceChannelName - 음성 채널 이름
   * @returns 생성된 임베드
   */
  static createMethodSelectionEmbed(voiceChannelName: string): EmbedBuilder {
    this.recordBuild('embed', 'methodSelection');

    return new EmbedBuilder()
      .setTitle('🎮 구인구직 포럼 연동')
      .setDescription(
        `음성 채널 **${voiceChannelName}**에서 구인구직을 시작하세요!\n\n` +
          '📌 **연동 방법**\n' +
          '• 🆕 **새 포럼 생성**: 새로운 구인구직 포럼을 만들어 연동\n' +
          '• 🔗 **기존 포럼 선택**: 이미 생성된 구인구직에 음성 채널 연결\n\n' +
          '💡 아래 드롭다운에서 원하는 방법을 선택하세요.'
      )
      .setColor(RecruitmentConfig.COLORS.INFO)
      .setFooter({ text: '연동 방법을 선택한 후 다음 단계로 진행됩니다.' });
  }

  /**
   * 연동 방법 선택 드롭다운 생성
   * @param voiceChannelId - 음성 채널 ID
   * @param existingPosts - 기존 포스트 목록
   * @returns 드롭다운이 포함된 액션 로우
   */
  static createMethodSelectMenu(
    voiceChannelId: string,
    existingPosts: ExistingPost[] = []
  ): ActionRowBuilder<StringSelectMenuBuilder> {
    this.recordBuild('selectMenu', 'methodSelection');

    const options: SelectMenuOption[] = [
      {
        label: '🆕 새 구인구직 포럼 생성하기',
        description: '새로운 구인구직 포럼을 만들어 음성 채널과 연동',
        value: DiscordConstants.METHOD_VALUES.NEW_FORUM,
        emoji: '🆕',
      },
    ];

    // 기존 포스트가 있으면 선택 옵션 추가
    existingPosts.forEach((post, index) => {
      if (index < 8) {
        // 최대 8개까지만 (새 포럼 생성 + 7개 기존 포스트)
        options.push({
          label: `🔗 ${post.name}`,
          description: `기존 구인구직에 연동 (멤버: ${post.memberCount}명)`,
          value: `${DiscordConstants.METHOD_VALUES.EXISTING_FORUM_PREFIX}${post.id}`,
          emoji: '🔗',
        });
      }
    });

    const selectMenuOptions = options.map((option) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(option.label)
        .setDescription(option.description)
        .setValue(option.value)
        .setEmoji(option.emoji)
        .setDefault(option.default || false)
    );

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_METHOD}${voiceChannelId}`)
      .setPlaceholder('연동 방법을 선택하세요')
      .addOptions(selectMenuOptions);

    this.recordBuild('actionRow', 'methodSelectMenu');
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
  }

  /**
   * 역할 태그 선택 임베드 생성
   * @param selectedTags - 선택된 태그 목록
   * @param isStandalone - 독립 모드 여부
   * @returns 생성된 임베드
   */
  static createRoleTagSelectionEmbed(
    selectedTags: string[] = [],
    isStandalone: boolean = false
  ): EmbedBuilder {
    this.recordBuild('embed', 'roleTagSelection');

    const selectedTagsText = selectedTags.length > 0 ? selectedTags.join(', ') : '없음';
    const modeText = isStandalone ? '독립 구인구직' : '음성 채널 연동';

    return new EmbedBuilder()
      .setTitle('🏷️ 역할 태그 선택')
      .setDescription(
        `**${modeText}**을 위한 역할 태그를 선택하세요.\n\n` +
          `선택된 태그: **${selectedTagsText}**\n\n` +
          `💡 최대 ${RecruitmentConfig.MAX_SELECTED_TAGS}개까지 선택할 수 있습니다.\n` +
          '✅ 선택이 완료되면 "선택 완료" 버튼을 클릭하세요.'
      )
      .setColor(RecruitmentConfig.COLORS.INFO);
  }

  /**
   * 역할 태그 버튼 그리드 생성
   * @param selectedTags - 선택된 태그 목록
   * @param voiceChannelId - 음성 채널 ID (선택사항)
   * @param methodValue - 메서드 값 (선택사항)
   * @param isStandalone - 독립 모드 여부
   * @returns 버튼 그리드 액션 로우 배열
   */
  static createRoleTagButtons(
    selectedTags: string[] = [],
    voiceChannelId: string | null = null,
    methodValue: string | null = null,
    isStandalone: boolean = false
  ): ActionRowBuilder<ButtonBuilder>[] {
    this.recordBuild('button', 'roleTagGrid');

    const components: ActionRowBuilder<ButtonBuilder>[] = [];

    // 4행 4열 버튼 그리드 생성 (15개 태그만 표시)
    for (let row = 0; row < RecruitmentConfig.BUTTON_GRID_ROWS; row++) {
      const actionRow = new ActionRowBuilder<ButtonBuilder>();
      let hasButtons = false;

      for (let col = 0; col < RecruitmentConfig.BUTTON_GRID_COLS; col++) {
        const tagIndex = row * RecruitmentConfig.BUTTON_GRID_COLS + col;
        const tag = RecruitmentConfig.ROLE_TAG_VALUES[tagIndex];

        // 태그가 존재할 때만 버튼 생성
        if (tag) {
          const isSelected = selectedTags.includes(tag);

          let buttonCustomId: string;
          if (isStandalone) {
            buttonCustomId = `${DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_BUTTON}${tag}`;
          } else {
            buttonCustomId = `${DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_BUTTON}${tag}_${voiceChannelId}_${methodValue}`;
          }

          const button = this.createButton({
            customId: buttonCustomId,
            label: tag,
            style: isSelected ? ButtonStyle.Primary : ButtonStyle.Secondary,
          });

          actionRow.addComponents(button);
          hasButtons = true;
        }
      }

      // 버튼이 있는 행만 추가
      if (hasButtons) {
        this.recordBuild('actionRow', `roleTagRow${row}`);
        components.push(actionRow);
      }
    }

    // 완료 버튼 추가
    let completeCustomId: string;
    if (isStandalone) {
      completeCustomId = DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE;
    } else {
      completeCustomId = `${DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_COMPLETE}${voiceChannelId}_${methodValue}`;
    }

    const completeButton = this.createButton({
      customId: completeCustomId,
      label: '선택 완료',
      style: ButtonStyle.Primary,
      emoji: '✅',
      disabled: selectedTags.length === 0,
    });

    const completeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(completeButton);
    this.recordBuild('actionRow', 'completeButton');
    components.push(completeRow);

    return components;
  }

  /**
   * 독립 구인구직 생성 임베드
   * @returns 생성된 임베드
   */
  static createStandaloneRecruitmentEmbed(): EmbedBuilder {
    this.recordBuild('embed', 'standaloneRecruitment');

    return new EmbedBuilder()
      .setTitle('🎮 구인구직 포럼 생성')
      .setDescription(
        '새로운 구인구직 포럼을 생성합니다.\n\n' +
          '📌 **단계**\n' +
          '1. 🏷️ **역할 태그 선택** (현재 단계)\n' +
          '2. 📝 **구인구직 정보 입력**\n' +
          '3. 🎯 **포럼 포스트 생성**\n\n' +
          '💡 역할 태그를 선택하면 해당 역할의 멤버들이 알림을 받습니다.'
      )
      .setColor(RecruitmentConfig.COLORS.INFO)
      .setFooter({ text: '(장기 컨텐츠는 연동X)' });
  }

  /**
   * 성공 메시지 임베드 생성
   * @param title - 제목
   * @param description - 설명
   * @param fields - 추가 필드 (선택사항)
   * @returns 생성된 임베드
   */
  static createSuccessEmbed(
    title: string,
    description: string,
    fields: APIEmbedField[] = []
  ): EmbedBuilder {
    this.recordBuild('embed', 'success');

    const embed = new EmbedBuilder()
      .setTitle(`✅ ${title}`)
      .setDescription(description)
      .setColor(RecruitmentConfig.COLORS.SUCCESS)
      .setTimestamp();

    if (fields.length > 0) {
      embed.addFields(fields);
    }

    return embed;
  }

  /**
   * 에러 메시지 임베드 생성
   * @param title - 제목
   * @param description - 설명
   * @returns 생성된 임베드
   */
  static createErrorEmbed(title: string, description: string): EmbedBuilder {
    this.recordBuild('embed', 'error');

    return new EmbedBuilder()
      .setTitle(`❌ ${title}`)
      .setDescription(description)
      .setColor(RecruitmentConfig.COLORS.ERROR)
      .setTimestamp();
  }

  /**
   * 경고 메시지 임베드 생성
   * @param title - 제목
   * @param description - 설명
   * @returns 생성된 임베드
   */
  static createWarningEmbed(title: string, description: string): EmbedBuilder {
    this.recordBuild('embed', 'warning');

    return new EmbedBuilder()
      .setTitle(`⚠️ ${title}`)
      .setDescription(description)
      .setColor(RecruitmentConfig.COLORS.WARNING)
      .setTimestamp();
  }

  /**
   * 참여자 정보 임베드 생성
   * @param voiceChannelName - 음성 채널 이름
   * @param participantStats - 참여자 통계
   * @returns 생성된 임베드
   */
  static createParticipantInfoEmbed(
    voiceChannelName: string,
    participantStats: ParticipantStats
  ): EmbedBuilder {
    this.recordBuild('embed', 'participantInfo');

    const description = [
      `**전체 참여자**: ${participantStats.total}명`,
      `**활성 참여자**: ${participantStats.active}명`,
      `**대기 중**: ${participantStats.waiting}명`,
      `**관전 중**: ${participantStats.spectating}명`,
    ];

    if (participantStats.idle !== undefined) {
      description.push(`**유휴 상태**: ${participantStats.idle}명`);
    }

    return new EmbedBuilder()
      .setTitle(`👥 ${voiceChannelName} 참여자 현황`)
      .setDescription(description.join('\n'))
      .setColor(RecruitmentConfig.COLORS.INFO)
      .setTimestamp();
  }

  /**
   * 정보 임베드 생성 (범용)
   * @param options - 임베드 구성 옵션
   * @returns 생성된 임베드
   */
  static createInfoEmbed(options: EmbedOptions): EmbedBuilder {
    this.recordBuild('embed', 'info');

    const embed = new EmbedBuilder();

    if (options.title) embed.setTitle(options.title);
    if (options.description) embed.setDescription(options.description);
    if (options.color !== undefined) embed.setColor(options.color);
    if (options.footer) embed.setFooter({ text: options.footer });
    if (options.timestamp) embed.setTimestamp();
    if (options.fields) embed.addFields(options.fields);
    if (options.thumbnail) embed.setThumbnail(options.thumbnail);
    if (options.image) embed.setImage(options.image);
    if (options.author) embed.setAuthor(options.author);

    return embed;
  }

  /**
   * 버튼 생성 헬퍼 메서드
   * @param options - 버튼 구성 옵션
   * @returns 생성된 버튼
   */
  private static createButton(options: ButtonOptions): ButtonBuilder {
    this.buildStats.buttonsCreated++;

    const button = new ButtonBuilder()
      .setCustomId(options.customId)
      .setLabel(options.label)
      .setStyle(options.style);

    if (options.emoji) button.setEmoji(options.emoji);
    if (options.disabled !== undefined) button.setDisabled(options.disabled);
    if (options.url) button.setURL(options.url);

    return button;
  }

  /**
   * 로딩 임베드 생성
   * @param message - 로딩 메시지
   * @returns 생성된 임베드
   */
  static createLoadingEmbed(message: string = '처리 중...'): EmbedBuilder {
    this.recordBuild('embed', 'loading');

    return new EmbedBuilder()
      .setTitle('⏳ 로딩 중')
      .setDescription(message)
      .setColor(RecruitmentConfig.COLORS.INFO)
      .setTimestamp();
  }

  /**
   * 진행률 임베드 생성
   * @param title - 제목
   * @param current - 현재 진행도
   * @param total - 전체
   * @param description - 추가 설명
   * @returns 생성된 임베드
   */
  static createProgressEmbed(
    title: string,
    current: number,
    total: number,
    description?: string
  ): EmbedBuilder {
    this.recordBuild('embed', 'progress');

    const percentage = Math.round((current / total) * 100);
    const progressBar = this.createProgressBar(current, total);

    let embedDescription = `${progressBar} ${percentage}% (${current}/${total})`;
    if (description) {
      embedDescription += `\n\n${description}`;
    }

    return new EmbedBuilder()
      .setTitle(title)
      .setDescription(embedDescription)
      .setColor(RecruitmentConfig.COLORS.INFO)
      .setTimestamp();
  }

  /**
   * 진행률 바 생성
   * @param current - 현재 값
   * @param total - 전체 값
   * @param length - 바 길이
   * @returns 진행률 바 문자열
   */
  private static createProgressBar(current: number, total: number, length: number = 20): string {
    const filled = Math.round((current / total) * length);
    const empty = length - filled;

    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  /**
   * UI 빌드 기록
   * @param type - 빌드 타입
   * @param identifier - 식별자
   */
  private static recordBuild(
    type: UIBuildStatistics['buildHistory'][0]['type'],
    identifier: string
  ): void {
    this.buildStats.lastBuildTime = new Date();

    switch (type) {
      case 'embed':
        this.buildStats.embedsCreated++;
        break;
      case 'button':
        this.buildStats.buttonsCreated++;
        break;
      case 'selectMenu':
        this.buildStats.selectMenusCreated++;
        break;
      case 'actionRow':
        this.buildStats.actionRowsCreated++;
        break;
    }

    this.buildStats.buildHistory.push({
      timestamp: new Date(),
      type,
      identifier,
    });

    // 히스토리 크기 제한
    if (this.buildStats.buildHistory.length > 1000) {
      this.buildStats.buildHistory = this.buildStats.buildHistory.slice(-1000);
    }
  }

  /**
   * UI 빌드 통계 조회
   * @returns UI 빌드 통계
   */
  static getBuildStatistics(): UIBuildStatistics {
    return { ...this.buildStats };
  }

  /**
   * 통계 초기화
   */
  static resetStatistics(): void {
    this.buildStats = {
      embedsCreated: 0,
      buttonsCreated: 0,
      selectMenusCreated: 0,
      actionRowsCreated: 0,
      lastBuildTime: new Date(),
      buildHistory: [],
    };
  }

  /**
   * 빌드 히스토리 조회
   * @param limit - 조회할 히스토리 수 제한
   * @returns 빌드 히스토리
   */
  static getBuildHistory(limit: number = 100): UIBuildStatistics['buildHistory'] {
    return this.buildStats.buildHistory
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * 특정 타입의 빌드 통계 조회
   * @param type - 빌드 타입
   * @returns 해당 타입의 빌드 수
   */
  static getBuildCountByType(type: UIBuildStatistics['buildHistory'][0]['type']): number {
    switch (type) {
      case 'embed':
        return this.buildStats.embedsCreated;
      case 'button':
        return this.buildStats.buttonsCreated;
      case 'selectMenu':
        return this.buildStats.selectMenusCreated;
      case 'actionRow':
        return this.buildStats.actionRowsCreated;
      default:
        return 0;
    }
  }
}
