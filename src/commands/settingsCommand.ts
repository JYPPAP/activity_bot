// src/commands/settingsCommand.ts - 서버 설정 관리 명령어
import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
  ButtonInteraction,
  GuildChannel,
  PermissionFlagsBits,
} from 'discord.js';

import { DIContainer } from '../di/container.js';
import { DI_TOKENS } from '../interfaces/index.js';
import { GuildSettingsManager, ExcludeChannelsSetting } from '../services/GuildSettingsManager.js';

import {
  CommandBase,
  CommandServices,
  CommandResult,
  CommandExecutionOptions,
  CommandMetadata,
} from './CommandBase.js';

export class SettingsCommand extends CommandBase {
  private guildSettingsManager: GuildSettingsManager;

  public readonly metadata: CommandMetadata = {
    name: '설정',
    description: '서버의 봇 설정을 관리합니다.',
    category: 'administration',
    permissions: ['Administrator'],
    cooldown: 5,
    adminOnly: true,
    guildOnly: true,
    usage: '/설정',
    examples: ['/설정 (서버 설정 관리 인터페이스)'],
    aliases: ['config', '설정'],
  };

  constructor(services: CommandServices) {
    super(services);
    // DI 컨테이너에서 서비스들 주입
    this.guildSettingsManager = DIContainer.get<GuildSettingsManager>(
      DI_TOKENS.IGuildSettingsManager
    );
  }

  /**
   * 슬래시 명령어 빌더 생성
   */
  buildSlashCommand(): SlashCommandBuilder {
    const builder = new SlashCommandBuilder()
      .setName(this.metadata.name)
      .setDescription(this.metadata.description);

    return builder;
  }

  /**
   * 설정 명령어의 실제 실행 로직
   * @param interaction - 상호작용 객체
   * @param options - 실행 옵션
   */
  protected async executeCommand(
    interaction: ChatInputCommandInteraction,
    _options: CommandExecutionOptions
  ): Promise<CommandResult> {
    try {
      // 서버 설정 관리 메인 인터페이스 표시
      await this.showMainSettingsInterface(interaction);

      return {
        success: true,
        message: '서버 설정 관리 인터페이스가 표시되었습니다.',
      };
    } catch (error) {
      console.error('설정 명령어 실행 오류:', error);

      const errorMessage =
        error instanceof Error
          ? error.message
          : '설정 인터페이스 표시 중 알 수 없는 오류가 발생했습니다.';

      const errorEmbed = this.createErrorEmbed(errorMessage);
      await interaction.followUp({
        embeds: [errorEmbed],
        flags: MessageFlags.Ephemeral,
      });

      return {
        success: false,
        message: errorMessage,
        error: error as Error,
      };
    }
  }

  /**
   * 메인 서버 설정 인터페이스 표시
   * @param interaction - 상호작용 객체
   */
  public async showMainSettingsInterface(
    interaction: ChatInputCommandInteraction | ButtonInteraction
  ): Promise<void> {
    try {
      const guildId = interaction.guild?.id;
      if (!guildId) {
        throw new Error('길드 정보를 찾을 수 없습니다.');
      }

      // 현재 설정 상태 조회
      const currentSettings = await this.guildSettingsManager.getAllGuildSettings(guildId);

      // 메인 설정 관리 Embed 생성
      const mainEmbed = await this.createMainSettingsEmbed(interaction.guild.name, currentSettings, guildId);

      // 4개의 메인 설정 카테고리 버튼 생성
      const actionRow1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('settings_activity_threshold')
          .setLabel('🕐 활동시간 설정')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('settings_game_list')
          .setLabel('🎮 게임 목록 설정')
          .setStyle(ButtonStyle.Primary)
      );

      const actionRow2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('settings_exclude_channels')
          .setLabel('🚫 제외 채널 지정')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('settings_management_channels')
          .setLabel('⚙️ 관리 채널 지정')
          .setStyle(ButtonStyle.Secondary)
      );

      // 인터랙션 타입에 따라 적절한 메서드 사용
      if (interaction instanceof ButtonInteraction) {
        await interaction.update({
          embeds: [mainEmbed],
          components: [actionRow1, actionRow2],
        });
      } else {
        await interaction.followUp({
          embeds: [mainEmbed],
          components: [actionRow1, actionRow2],
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      console.error('메인 설정 인터페이스 표시 오류:', error);
      const errorEmbed = this.createErrorEmbed(
        '설정 인터페이스를 표시하는 중 오류가 발생했습니다.'
      );

      // 인터랙션 타입에 따라 적절한 메서드 사용
      if (interaction instanceof ButtonInteraction) {
        await interaction.update({
          embeds: [errorEmbed],
          components: [],
        });
      } else {
        await interaction.followUp({
          embeds: [errorEmbed],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }

  /**
   * 메인 설정 관리 Embed 생성
   * @param guildName - 길드 이름
   * @param currentSettings - 현재 설정 상태
   * @param guildId - 길드 ID
   */
  private async createMainSettingsEmbed(guildName: string, currentSettings: any, guildId: string): Promise<EmbedBuilder> {
    const embed = new EmbedBuilder()
      .setTitle('⚙️ 서버 설정 관리')
      .setColor(Colors.Blue)
      .setDescription(
        `**${guildName}** 서버의 봇 설정을 관리합니다.\n아래 버튼을 클릭하여 각 항목을 설정하세요.`
      )
      .setTimestamp()
      .setFooter({ text: '서버 설정 관리 시스템' });

    // 현재 길드 활동 임계값 조회
    const currentThresholdHours = await this.guildSettingsManager.getGuildActivityThresholdHours(guildId);

    // 현재 설정 상태 표시
    const roleActivityCount = Object.keys(currentSettings.roleActivity || {}).length;
    const gameListCount = currentSettings.gameList?.games?.length || 0;
    const excludeChannelsCount = currentSettings.excludeChannels?.channels?.length || 0;
    const channelManagementCount = this.getChannelManagementCount(
      currentSettings.channelManagement
    );

    embed.addFields(
      {
        name: '🕐 활동시간 설정',
        value: `• 길드 전역 활동 시간 임계값 설정\n• 현재 임계값: **${currentThresholdHours}시간** (수정 가능)\n• 모든 멤버에게 공통 적용`,
        inline: true,
      },
      {
        name: '🎮 게임 목록 설정',
        value: `• 게임 목록을 콤마로 구분하여 입력\n• 현재 설정: **${gameListCount}개 게임**\n• 게임 태그에 @게임명 자동 반영`,
        inline: true,
      },
      {
        name: '🚫 제외 채널 지정',
        value: `• 활동 추적 제외할 채널 ID 설정\n• 현재 설정: **${excludeChannelsCount}개 채널**\n• 숫자만 입력 가능`,
        inline: true,
      },
      {
        name: '⚙️ 관리 채널 지정',
        value: `• 보고서/로그/구인구직/게임 채널 설정\n• 현재 설정: **${channelManagementCount}/4개 완료**\n• 각 채널별 개별 설정`,
        inline: true,
      },
      {
        name: '📝 사용 방법',
        value:
          '1. 원하는 설정 카테고리 버튼 클릭\n2. 표시되는 입력 폼에서 값 입력\n3. 기존 설정이 있으면 수정 가능\n4. 변경사항 자동 저장 및 이력 기록',
        inline: false,
      }
    );

    // 설정 완료도 표시
    const totalCategories = 4;
    const completedCategories = [
      roleActivityCount > 0,
      gameListCount > 0,
      excludeChannelsCount > 0,
      channelManagementCount === 4,
    ].filter(Boolean).length;

    embed.addFields({
      name: '📊 설정 완료도',
      value: `${completedCategories}/${totalCategories} 카테고리 설정 완료 (${Math.round((completedCategories / totalCategories) * 100)}%)`,
      inline: false,
    });

    return embed;
  }

  /**
   * 채널 관리 설정 완료 개수 계산
   * @param settings - 채널 관리 설정
   * @returns 설정된 채널 개수
   */
  private getChannelManagementCount(settings: any): number {
    if (!settings) return 0;

    let count = 0;
    if (settings.logChannelId) count++;
    if (settings.forumChannelId) count++;
    if (settings.voiceCategoryId) count++;
    if (settings.forumTagId) count++;

    return count;
  }

  /**
   * 오류 Embed 생성
   * @param message - 오류 메시지
   */
  private createErrorEmbed(message: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('❌ 오류 발생')
      .setColor(Colors.Red)
      .setDescription(message)
      .addFields({
        name: '🔧 도움이 필요하신가요?',
        value: '관리자에게 문의해주세요.',
        inline: false,
      })
      .setTimestamp()
      .setFooter({ text: '오류 정보' });
  }

  /**
   * 명령어 도움말 생성
   */
  public getHelp(): string {
    return `**${this.metadata.name}** - ${this.metadata.description}

**사용법:**
\`${this.metadata.usage}\`

**설명:**
• 서버의 봇 설정을 종합적으로 관리합니다.
• 관리자 권한이 필요합니다.

**주요 기능:**
• 🕐 **활동시간 설정**: 길드 전역 활동 시간 임계값 설정
• 🎮 **게임 목록 설정**: 게임 태그 목록 관리 (콤마 구분)
• 🚫 **제외 채널 지정**: 활동 추적 제외 채널 설정
• ⚙️ **관리 채널 지정**: 보고서, 로그, 구인구직, 게임 채널 관리

**사용 방법:**
1. \`/설정\` 명령어 입력
2. 표시되는 4개 카테고리 중 원하는 버튼 클릭
3. 입력 폼에서 값 입력 및 저장
4. 모든 설정은 길드별로 자동 분류 저장

**데이터 저장:**
• 모든 설정은 길드 ID별로 분류되어 데이터베이스에 저장
• 기존 설정이 있을 경우 수정 가능
• 설정 변경 이력 자동 기록

**게임 목록 예시:**
• "롤, 스팀, 넥슨, 보드게임, 생존게임, 공포게임, 퍼즐게임, 기타게임"
• 콤마로 구분하여 입력하면 자동으로 게임 태그 목록에 반영

**관리 채널 설정:**
• 보고서 채널: 활동 보고서가 전송될 채널
• 로그 채널: 봇 활동 로그가 기록될 채널
• 구인구직 채널: 구인구직 포스트가 생성될 채널
• 게임 채널 카테고리: 게임별 음성 채널이 생성될 카테고리

**권한:** 관리자 전용
**쿨다운:** ${this.metadata.cooldown}초`;
  }

  // ==========================================
  // 활동시간 임계값 설정 Modal 및 핸들러
  // ==========================================

  /**
   * 활동시간 임계값 설정 버튼 처리
   * @param interaction - 버튼 상호작용 객체
   */
  async handleActivityThresholdButton(interaction: ButtonInteraction): Promise<void> {
    try {
      const guildId = interaction.guild?.id;
      if (!guildId) {
        throw new Error('길드 정보를 찾을 수 없습니다.');
      }

      // 현재 설정된 길드 전역 활동 임계값 조회
      const currentThresholdHours = await this.guildSettingsManager.getGuildActivityThresholdHours(guildId);
      
      await this.showActivityThresholdModal(interaction, currentThresholdHours);
    } catch (error) {
      console.error('활동시간 임계값 버튼 처리 오류:', error);
      const errorEmbed = this.createErrorEmbed('활동시간 임계값 설정을 불러오는 중 오류가 발생했습니다.');
      await interaction.followUp({
        embeds: [errorEmbed],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * 활동시간 임계값 Modal 표시
   * @param interaction - 상호작용 객체
   * @param currentHours - 현재 임계값 시간
   */
  private async showActivityThresholdModal(
    interaction: ButtonInteraction,
    currentHours: number
  ): Promise<void> {
    const modal = new ModalBuilder()
      .setCustomId('activity_threshold_modal')
      .setTitle('⚙️ 길드 활동시간 임계값 설정');

    // 임계값 입력
    const thresholdInput = new TextInputBuilder()
      .setCustomId('threshold_hours')
      .setLabel('활동시간 임계값 (시간 단위)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(3)
      .setValue(currentHours.toString())
      .setPlaceholder('예: 30');

    // 설명 입력 (선택사항)
    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('변경 사유 (선택사항)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(200)
      .setPlaceholder('임계값 변경 사유를 입력하세요. (선택사항)');

    // ActionRow에 입력 필드들 추가
    const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(thresholdInput);
    const secondActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput);

    modal.addComponents(firstActionRow, secondActionRow);

    await interaction.showModal(modal);
  }

  /**
   * 활동시간 임계값 Modal 제출 처리
   * @param interaction - Modal 제출 상호작용 객체
   */
  async handleActivityThresholdModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    try {
      const guildId = interaction.guild?.id;
      if (!guildId) {
        throw new Error('길드 정보를 찾을 수 없습니다.');
      }

      const thresholdHoursInput = interaction.fields.getTextInputValue('threshold_hours').trim();
      const description = interaction.fields.getTextInputValue('description')?.trim() || '';

      // 입력 검증
      if (!thresholdHoursInput) {
        throw new Error('활동시간 임계값을 입력해야 합니다.');
      }

      const thresholdHours = parseInt(thresholdHoursInput);
      if (isNaN(thresholdHours) || thresholdHours < 1 || thresholdHours > 168) {
        throw new Error('임계값은 1~168 사이의 숫자여야 합니다.');
      }

      // 데이터베이스에 저장
      const result = await this.guildSettingsManager.setGuildActivityThreshold(
        guildId,
        thresholdHours,
        interaction.user.id,
        interaction.user.displayName
      );

      if (!result.isValid) {
        throw new Error(result.error || '활동시간 임계값 저장에 실패했습니다.');
      }

      // 성공 응답
      const successEmbed = this.createActivityThresholdSuccessEmbed(
        thresholdHours,
        description,
        result.warnings
      );

      await interaction.reply({
        embeds: [successEmbed],
        flags: MessageFlags.Ephemeral,
      });

    } catch (error) {
      console.error('활동시간 임계값 Modal 제출 처리 오류:', error);

      const errorMessage =
        error instanceof Error ? error.message : '활동시간 임계값 저장 중 오류가 발생했습니다.';
      const errorEmbed = this.createErrorEmbed(errorMessage);

      await interaction.reply({
        embeds: [errorEmbed],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * 활동시간 임계값 설정 성공 Embed 생성
   * @param thresholdHours - 설정된 임계값 시간
   * @param description - 변경 사유
   * @param warnings - 경고 메시지들
   */
  private createActivityThresholdSuccessEmbed(
    thresholdHours: number,
    description?: string,
    warnings?: string[]
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('✅ 활동시간 임계값 설정 완료')
      .setColor(warnings && warnings.length > 0 ? Colors.Orange : Colors.Green)
      .addFields(
        {
          name: '⏰ 새로운 임계값',
          value: `**${thresholdHours}시간**`,
          inline: true,
        },
        {
          name: '🎯 적용 대상',
          value: '길드 전체 멤버',
          inline: true,
        },
        {
          name: '🔄 적용 시점',
          value: '즉시 적용',
          inline: true,
        }
      )
      .setTimestamp()
      .setFooter({ text: '활동시간 임계값이 성공적으로 변경되었습니다.' });

    // 변경 사유가 있으면 추가
    if (description) {
      embed.addFields({
        name: '📄 변경 사유',
        value: description,
        inline: false,
      });
    }

    // 경고사항이 있으면 추가
    if (warnings && warnings.length > 0) {
      embed.addFields({
        name: '⚠️ 경고사항',
        value: warnings.map((w) => `• ${w}`).join('\n'),
        inline: false,
      });
    }

    embed.addFields({
      name: '💡 적용 효과',
      value: 
        `• 모든 활동 보고서에서 **${thresholdHours}시간**을 기준으로 활성/비활성 분류\n` +
        '• 기존 역할별 설정보다 우선 적용됨\n' +
        '• 비례 계산 시에도 이 임계값이 기준으로 사용됨',
      inline: false,
    });

    return embed;
  }

  // ==========================================
  // 활동시간 관리 Modal 및 핸들러 (기존 역할 기반)
  // ==========================================

  /**
   * 활동시간 관리 인터페이스 표시
   * @param interaction - 버튼 상호작용 객체
   */
  async handleActivityTimeButton(interaction: ButtonInteraction): Promise<void> {
    // 기존 역할별 관리 → 활동시간 설정으로 리다이렉트
    await this.handleActivityThresholdButton(interaction);
  }

  /*
   * ============================================
   * 아래 메서드들은 역할별 활동시간 시스템에서 사용되던 것들입니다.
   * 길드 전역 임계값 시스템으로 전환되면서 더 이상 사용되지 않습니다.
   * ============================================
   */

  /**
   * 활동시간 역할 선택 인터페이스 표시 (사용 안함)
   * @param interaction - 상호작용 객체
   * @param existingRoles - 기존 역할 목록
   * @param settings - 현재 설정들
   */
  /*private async showActivityTimeSelectionInterface(
    interaction: ButtonInteraction,
    existingRoles: string[],
    settings: any
  ): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle('🕐 활동시간 관리')
      .setColor(Colors.Blue)
      .setDescription('현재 설정된 역할들입니다. 수정하거나 새 역할을 추가하세요.')
      .setTimestamp();

    // 현재 설정된 역할들 표시
    const roleList = existingRoles
      .slice(0, 10) // 최대 10개만 표시
      .map((role, index) => {
        const roleSetting = settings[role];
        return `${index + 1}. **${role}** - ${roleSetting.minHours}시간`;
      })
      .join('\n');

    embed.addFields({
      name: `📋 현재 설정 (${existingRoles.length}개)`,
      value: roleList,
      inline: false,
    });

    // 버튼들 생성
    const actionRow1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('activity_time_add')
        .setLabel('🆕 새 역할 추가')
        .setStyle(ButtonStyle.Primary)
    );

    const actionRow2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('activity_time_delete')
        .setLabel('🗑️ 역할 삭제')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('settings_back_main')
        .setLabel('⬅️ 메인으로')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.update({
      embeds: [embed],
      components: [actionRow1, actionRow2],
    });
  }

  // DEPRECATED: showActivityTimeModal 메서드 제거됨 - 역할별 활동시간 시스템 제거

  /**
   * 활동시간 역할 삭제 버튼 처리 (사용 안함 - 리다이렉트)
   * @param interaction - 버튼 상호작용 객체
   */
  async handleActivityTimeDeleteButton(interaction: ButtonInteraction): Promise<void> {
    // 역할별 시스템 제거됨 - 활동시간 설정으로 리다이렉트
    await this.handleActivityThresholdButton(interaction);
  }

  // DEPRECATED: showRoleDeleteInterface 및 createRoleDeleteButtons 메서드 제거됨 - 역할별 활동시간 시스템 제거

  /**
   * 역할 토글 처리 (선택/해제) - DEPRECATED
   * @deprecated 역할별 시스템 제거됨 - 활동시간 설정으로 리다이렉트
   * @param interaction - 버튼 상호작용 객체
   */
  async handleActivityTimeRoleToggle(interaction: ButtonInteraction): Promise<void> {
    await this.handleActivityThresholdButton(interaction);
    /*
    try {
      const guildId = interaction.guild?.id;
      if (!guildId) {
        throw new Error('길드 정보를 찾을 수 없습니다.');
      }

      // customId에서 역할명 추출
      const roleName = interaction.customId.replace('activity_time_role_toggle_', '');

      // 현재 메시지에서 선택된 역할들 상태 파악
      const embed = interaction.message.embeds[0];
      const currentComponents = interaction.message.components;

      // 현재 선택된 역할들 파악 (Primary 스타일인 버튼들)
      let selectedRoles: string[] = [];
      for (const row of currentComponents) {
        if ('components' in row && Array.isArray(row.components)) {
          for (const component of row.components) {
            if (component.type === 2 && component.style === 1) {
              // ButtonType.Button && ButtonStyle.Primary
              const roleNameFromId = component.customId?.replace('activity_time_role_toggle_', '');
              if (roleNameFromId && roleNameFromId !== roleName) {
                selectedRoles.push(roleNameFromId);
              }
            }
          }
        }
      }

      // 클릭된 역할의 선택 상태 토글
      if (selectedRoles.includes(roleName)) {
        selectedRoles = selectedRoles.filter((r) => r !== roleName);
      } else {
        selectedRoles.push(roleName);
      }

      // 모든 역할 목록 다시 가져오기
      const roleActivitySettings = await this.guildSettingsManager.getAllRoleActivityTimes(guildId);
      const allRoles = Object.keys(roleActivitySettings);

      // 새로운 버튼 그리드 생성
      const newActionRows = await this.createRoleDeleteButtons(allRoles, selectedRoles);

      // 임베드 업데이트 (선택된 개수 정보 추가)
      const newEmbed = EmbedBuilder.from(embed).setDescription(
        '삭제하고 싶은 역할들을 선택하고 "선택 완료" 버튼을 클릭하세요.\n' +
          '**파란색** 버튼: 선택됨\n' +
          '**회색** 버튼: 선택 안됨\n\n' +
          `**선택된 역할 수**: ${selectedRoles.length}개`
      );

      await interaction.update({
        embeds: [newEmbed],
        components: newActionRows,
      });
    } catch (error) {
      console.error('역할 토글 처리 오류:', error);
      await interaction.followUp({
        content: '역할 선택 처리 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
    */
  }

  /**
   * 역할 삭제 확인 처리
   * @param interaction - 버튼 상호작용 객체
   */
  async handleActivityTimeDeleteConfirm(interaction: ButtonInteraction): Promise<void> {
    // 역할별 시스템 제거됨 - 활동시간 설정으로 리다이렉트
    await this.handleActivityThresholdButton(interaction);
    /*
    try {
      const guildId = interaction.guild?.id;
      if (!guildId) {
        throw new Error('길드 정보를 찾을 수 없습니다.');
      }

      // 현재 선택된 역할들 파악 (Primary 스타일인 버튼들)
      const currentComponents = interaction.message.components;
      const selectedRoles: string[] = [];

      for (const row of currentComponents) {
        if ('components' in row && Array.isArray(row.components)) {
          for (const component of row.components) {
            if (component.type === 2 && component.style === 1) {
              // ButtonType.Button && ButtonStyle.Primary
              const roleNameFromId = component.customId?.replace('activity_time_role_toggle_', '');
              if (roleNameFromId) {
                selectedRoles.push(roleNameFromId);
              }
            }
          }
        }
      }

      if (selectedRoles.length === 0) {
        await interaction.reply({
          content: '삭제할 역할을 선택해주세요.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // 선택된 역할들 삭제
      let deletedCount = 0;
      const deleteResults: string[] = [];

      for (const roleName of selectedRoles) {
        try {
          const result = await this.guildSettingsManager.removeRoleActivityTime(
            guildId,
            roleName,
            interaction.user.id,
            interaction.user.displayName
          );
          if (result.isValid) {
            deletedCount++;
            deleteResults.push(`✅ **${roleName}**`);
          } else {
            deleteResults.push(`❌ **${roleName}**: ${result.error}`);
          }
        } catch (error) {
          deleteResults.push(`❌ **${roleName}**: 삭제 실패`);
        }
      }

      // 결과 임베드 생성
      const resultEmbed = new EmbedBuilder()
        .setTitle('🗑️ 역할 삭제 완료')
        .setDescription(
          `총 ${selectedRoles.length}개 역할 중 ${deletedCount}개가 성공적으로 삭제되었습니다.`
        )
        .setColor(deletedCount === selectedRoles.length ? 0x00ff00 : 0xff9900)
        .addFields({
          name: '삭제 결과',
          value: deleteResults.join('\n'),
          inline: false,
        })
        .setTimestamp();

      await interaction.update({
        embeds: [resultEmbed],
        components: [], // 모든 버튼 제거
      });
    } catch (error) {
      console.error('역할 삭제 확인 처리 오류:', error);
      await interaction.followUp({
        content: '역할 삭제 처리 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
    */
  }

  /**
   * 역할 삭제 취소 처리
   * @param interaction - 버튼 상호작용 객체
   */
  async handleActivityTimeDeleteCancel(interaction: ButtonInteraction): Promise<void> {
    // 역할별 시스템 제거됨 - 활동시간 설정으로 리다이렉트
    await this.handleActivityThresholdButton(interaction);
    /*
    try {
      const cancelEmbed = new EmbedBuilder()
        .setTitle('❌ 역할 삭제 취소')
        .setDescription('역할 삭제가 취소되었습니다.')
        .setColor(0x666666)
        .setTimestamp();

      await interaction.update({
        embeds: [cancelEmbed],
        components: [], // 모든 버튼 제거
      });
    } catch (error) {
      console.error('역할 삭제 취소 처리 오류:', error);
      await interaction.followUp({
        content: '취소 처리 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
    */
  }

  /**
   * 활동시간 Modal 제출 처리
   * @param interaction - Modal 제출 상호작용 객체
   */
  async handleActivityTimeModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    // 역할별 시스템 제거됨 - 활동시간 설정으로 리다이렉트
    const buttonInteraction = interaction as any as ButtonInteraction;
    await this.handleActivityThresholdButton(buttonInteraction);
    /*
    try {
      const guildId = interaction.guild?.id;
      if (!guildId) {
        throw new Error('길드 정보를 찾을 수 없습니다.');
      }

      const isEdit = interaction.customId === 'activity_time_edit_modal';
      const roleName = interaction.fields.getTextInputValue('role_name').trim();
      const minHoursInput = interaction.fields.getTextInputValue('min_hours').trim();
      const description = interaction.fields.getTextInputValue('description')?.trim() || '';

      // 입력 검증
      if (!roleName) {
        throw new Error('역할 이름을 입력해야 합니다.');
      }

      const minHours = parseInt(minHoursInput);
      if (isNaN(minHours) || minHours < 0 || minHours > 168) {
        throw new Error('시간은 0~168 사이의 숫자여야 합니다.');
      }

      // Discord에서 역할 ID 가져오기
      let roleId: string | undefined;
      try {
        const guild = interaction.guild!;
        await guild.roles.fetch(); // 역할 캐시 갱신
        
        // 역할 이름으로 역할 찾기 (대소문자 무시)
        const role = guild.roles.cache.find(r => 
          r.name.toLowerCase() === roleName.toLowerCase()
        );
        
        if (role) {
          roleId = role.id;
          console.log(`[설정] 역할 ID 찾음: "${roleName}" -> ${roleId}`);
        } else {
          console.warn(`[설정] 역할 ID를 찾을 수 없음: "${roleName}"`);
        }
      } catch (roleSearchError) {
        console.warn(`[설정] 역할 ID 검색 실패:`, roleSearchError);
      }

      // 데이터베이스에 저장
      const result = await this.guildSettingsManager.setRoleActivityTime(
        guildId,
        roleName,
        minHours,
        interaction.user.id,
        interaction.user.displayName,
        roleId  // 역할 ID 추가
      );

      if (!result.isValid) {
        throw new Error(result.error || '설정 저장에 실패했습니다.');
      }

      // 성공 응답
      const successEmbed = this.createActivityTimeSuccessEmbed(
        roleName,
        minHours,
        isEdit,
        description,
        result.warnings
      );

      await interaction.reply({
        embeds: [successEmbed],
        flags: MessageFlags.Ephemeral,
      });

      // 로그 기록 제거됨 - 음성 채널 활동과 관련 없는 관리 설정 로그
    } catch (error) {
      console.error('활동시간 Modal 제출 처리 오류:', error);

      const errorMessage =
        error instanceof Error ? error.message : '설정 저장 중 오류가 발생했습니다.';
      const errorEmbed = this.createErrorEmbed(errorMessage);

      await interaction.reply({
        embeds: [errorEmbed],
        flags: MessageFlags.Ephemeral,
      });
      return; // 오류 처리 후 함수 종료
    }
    */
  }

  // DEPRECATED: createActivityTimeSuccessEmbed 메서드 제거됨 - 역할별 활동시간 시스템 제거

  // ==========================================
  // 게임 목록 관리 Modal 및 핸들러
  // ==========================================

  /**
   * 게임 목록 관리 인터페이스 표시
   * @param interaction - 버튼 상호작용 객체
   */
  async handleGameListButton(interaction: ButtonInteraction): Promise<void> {
    try {
      const guildId = interaction.guild?.id;
      if (!guildId) {
        throw new Error('길드 정보를 찾을 수 없습니다.');
      }

      // 현재 설정된 게임 목록 조회
      const gameListSetting = await this.guildSettingsManager.getGameList(guildId);

      if (gameListSetting && gameListSetting.games.length > 0) {
        // 기존 게임 목록이 있으면 수정 인터페이스 표시
        await this.showGameListInterface(interaction, gameListSetting);
      } else {
        // 게임 목록이 없으면 바로 추가 Modal 표시
        await this.showGameListModal(interaction, false);
      }
    } catch (error) {
      console.error('게임 목록 버튼 처리 오류:', error);
      const errorEmbed = this.createErrorEmbed('게임 목록 설정을 불러오는 중 오류가 발생했습니다.');
      await interaction.followUp({
        embeds: [errorEmbed],
        flags: MessageFlags.Ephemeral,
      });
      return; // 오류 처리 후 함수 종료
    }
  }

  /**
   * 게임 목록 인터페이스 표시
   * @param interaction - 상호작용 객체
   * @param gameListSetting - 현재 게임 목록 설정
   */
  private async showGameListInterface(
    interaction: ButtonInteraction,
    gameListSetting: any
  ): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle('🎮 게임 목록 관리')
      .setColor(Colors.Blue)
      .setDescription('현재 설정된 게임 목록입니다. 수정하거나 새로 설정하세요.')
      .setTimestamp();

    // 현재 게임 목록 표시
    const gameList = gameListSetting.games
      .slice(0, 20) // 최대 20개만 표시
      .map((game: string, index: number) => `${index + 1}. **@${game}**`)
      .join('\n');

    embed.addFields(
      {
        name: `🎮 현재 게임 목록 (${gameListSetting.games.length}개)`,
        value: gameList || '설정된 게임이 없습니다.',
        inline: false,
      },
      {
        name: '📝 게임 태그 반영',
        value: '설정된 게임들은 자동으로 @게임명 형태로 게임 태그 선택에 반영됩니다.',
        inline: false,
      },
      {
        name: '💡 사용 방법',
        value:
          '• 게임명을 콤마(,)로 구분하여 입력\n• 예시: 롤, 발로란트, 오버워치, 보드게임\n• 기존 목록을 수정하거나 새로 설정 가능',
        inline: false,
      }
    );

    if (gameListSetting.games.length > 20) {
      embed.addFields({
        name: '📋 안내',
        value: `총 ${gameListSetting.games.length}개 게임이 설정되어 있지만, 처음 20개만 표시됩니다.`,
        inline: false,
      });
    }

    // 버튼들 생성
    const actionRow1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('game_list_edit')
        .setLabel('✏️ 게임 목록 수정')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('game_list_clear')
        .setLabel('🗑️ 목록 초기화')
        .setStyle(ButtonStyle.Danger)
    );

    const actionRow2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('settings_back_main')
        .setLabel('⬅️ 메인으로')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.update({
      embeds: [embed],
      components: [actionRow1, actionRow2],
    });
  }

  /**
   * 게임 목록 Modal 표시
   * @param interaction - 상호작용 객체
   * @param isEdit - 수정 모드 여부
   * @param currentGames - 현재 게임 목록 (수정 모드일 때)
   */
  private async showGameListModal(
    interaction: ButtonInteraction,
    isEdit: boolean = false,
    currentGames?: string[]
  ): Promise<void> {
    const modal = new ModalBuilder()
      .setCustomId(isEdit ? 'game_list_edit_modal' : 'game_list_add_modal')
      .setTitle(isEdit ? '✏️ 게임 목록 수정' : '🎮 새 게임 목록 설정');

    // 게임 목록 입력
    const gameListInput = new TextInputBuilder()
      .setCustomId('game_list')
      .setLabel('게임 목록 (콤마로 구분)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(2000)
      .setPlaceholder(
        '예: 롤, 발로란트, 오버워치, 보드게임, 생존게임, 공포게임, 퍼즐게임, 기타게임'
      );

    if (isEdit && currentGames && currentGames.length > 0) {
      gameListInput.setValue(currentGames.join(', '));
    }

    // 설명 입력 (선택사항)
    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('설명 (선택사항)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(200)
      .setPlaceholder('게임 목록에 대한 추가 설명을 입력하세요. (선택사항)');

    // ActionRow에 입력 필드들 추가
    const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(gameListInput);
    const secondActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput);

    modal.addComponents(firstActionRow, secondActionRow);

    await interaction.showModal(modal);
  }

  /**
   * 게임 목록 Modal 제출 처리
   * @param interaction - Modal 제출 상호작용 객체
   */
  async handleGameListModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    try {
      const guildId = interaction.guild?.id;
      if (!guildId) {
        throw new Error('길드 정보를 찾을 수 없습니다.');
      }

      const isEdit = interaction.customId === 'game_list_edit_modal';
      const gameListInput = interaction.fields.getTextInputValue('game_list').trim();
      const description = interaction.fields.getTextInputValue('description')?.trim() || '';

      // 입력 검증
      if (!gameListInput) {
        throw new Error('게임 목록을 입력해야 합니다.');
      }

      // 콤마로 구분하여 게임 목록 파싱
      const games = gameListInput
        .split(',')
        .map((game) => game.trim())
        .filter((game) => game.length > 0)
        .filter((game) => game.length <= 30) // 개별 게임명 최대 30자
        .slice(0, 50); // 최대 50개 게임

      if (games.length === 0) {
        throw new Error('유효한 게임 이름을 입력해야 합니다.');
      }

      // 중복 제거
      const uniqueGames = [...new Set(games)];

      // 데이터베이스에 저장
      const result = await this.guildSettingsManager.setGameList(
        guildId,
        uniqueGames.join(', '),
        interaction.user.id,
        interaction.user.displayName
      );

      if (!result.isValid) {
        throw new Error(result.error || '게임 목록 저장에 실패했습니다.');
      }

      // 성공 응답
      const successEmbed = this.createGameListSuccessEmbed(
        uniqueGames,
        isEdit,
        description,
        result.warnings
      );

      await interaction.reply({
        embeds: [successEmbed],
        flags: MessageFlags.Ephemeral,
      });

      // 로그 기록 제거됨 - 음성 채널 활동과 관련 없는 관리 설정 로그
    } catch (error) {
      console.error('게임 목록 Modal 제출 처리 오류:', error);

      const errorMessage =
        error instanceof Error ? error.message : '게임 목록 저장 중 오류가 발생했습니다.';
      const errorEmbed = this.createErrorEmbed(errorMessage);

      await interaction.reply({
        embeds: [errorEmbed],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * 게임 목록 설정 성공 Embed 생성
   * @param games - 게임 목록
   * @param isEdit - 수정 여부
   * @param description - 설명
   * @param warnings - 경고 메시지들
   */
  private createGameListSuccessEmbed(
    games: string[],
    isEdit: boolean,
    description?: string,
    warnings?: string[]
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('✅ 게임 목록 설정 완료')
      .setColor(warnings && warnings.length > 0 ? Colors.Orange : Colors.Green)
      .addFields(
        {
          name: '🎮 등록된 게임 수',
          value: `**${games.length}개**`,
          inline: true,
        },
        {
          name: '📝 상태',
          value: isEdit ? '✏️ 수정됨' : '🆕 새로 생성됨',
          inline: true,
        },
        {
          name: '🏷️ 게임 태그 생성',
          value: '자동으로 @게임명 태그 생성됨',
          inline: true,
        }
      )
      .setTimestamp()
      .setFooter({ text: '게임 목록이 성공적으로 저장되었습니다.' });

    // 게임 목록 표시 (최대 25개)
    const gameListDisplay = games
      .slice(0, 25)
      .map((game, index) => `${index + 1}. **@${game}**`)
      .join('\n');

    embed.addFields({
      name: `🎯 게임 목록 (처음 ${Math.min(games.length, 25)}개)`,
      value: gameListDisplay,
      inline: false,
    });

    if (games.length > 25) {
      embed.addFields({
        name: '📋 안내',
        value: `총 ${games.length}개 게임이 등록되었지만, 처음 25개만 표시됩니다.`,
        inline: false,
      });
    }

    // 설명이 있으면 추가
    if (description) {
      embed.addFields({
        name: '📄 설명',
        value: description,
        inline: false,
      });
    }

    // 경고사항이 있으면 추가
    if (warnings && warnings.length > 0) {
      embed.addFields({
        name: '⚠️ 경고사항',
        value: warnings.map((w) => `• ${w}`).join('\n'),
        inline: false,
      });
    }

    embed.addFields({
      name: '💡 게임 태그 사용법',
      value:
        '이제 구인구직 포스트 작성 시 위 게임들이 @게임명 형태로 게임 태그 선택 목록에 나타납니다.',
      inline: false,
    });

    return embed;
  }

  // ==========================================
  // 제외 채널 관리 Modal 및 핸들러
  // ==========================================

  /**
   * 제외 채널 관리 인터페이스 표시
   * @param interaction - 버튼 상호작용 객체
   */
  async handleExcludeChannelsButton(interaction: ButtonInteraction): Promise<void> {
    try {
      const guildId = interaction.guild?.id;
      if (!guildId) {
        throw new Error('길드 정보를 찾을 수 없습니다.');
      }

      // 현재 설정된 제외 채널 목록 조회 (defer 전에 확인)
      const excludeChannelsSetting = await this.guildSettingsManager.getExcludeChannels(guildId);

      // 안전성 체크 개선
      const hasExcludedChannels = (excludeChannelsSetting?.excludedChannels?.length ?? 0) > 0;
      const hasActivityLimitedChannels =
        (excludeChannelsSetting?.activityLimitedChannels?.length ?? 0) > 0;

      if (excludeChannelsSetting && (hasExcludedChannels || hasActivityLimitedChannels)) {
        // 기존 제외 채널이 있으면 인터랙션 defer 후 수정 인터페이스 표시
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await this.showExcludeChannelsInterface(interaction, excludeChannelsSetting);
      } else {
        // 제외 채널이 없으면 defer 없이 바로 Modal 표시
        await this.showExcludeChannelsModal(interaction, false);
      }
    } catch (error) {
      console.error('제외 채널 버튼 처리 오류:', error);
      const errorEmbed = this.createErrorEmbed('제외 채널 설정을 불러오는 중 오류가 발생했습니다.');

      // interaction 상태에 따른 조건부 에러 응답
      if (interaction.deferred) {
        await interaction.editReply({
          embeds: [errorEmbed],
        });
      } else if (interaction.replied) {
        await interaction.followUp({
          embeds: [errorEmbed],
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          embeds: [errorEmbed],
          flags: MessageFlags.Ephemeral,
        });
      }
      return; // 오류 처리 후 함수 종료
    }
  }

  /**
   * 제외 채널 인터페이스 표시
   * @param interaction - 상호작용 객체
   * @param excludeChannelsSetting - 현재 제외 채널 설정
   */
  private async showExcludeChannelsInterface(
    interaction: ButtonInteraction,
    excludeChannelsSetting: ExcludeChannelsSetting
  ): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle('🚫 제외 채널 관리')
      .setColor(Colors.Red)
      .setDescription('활동 추적에서 제외할 채널들을 관리합니다.')
      .setTimestamp();

    // 완전 제외 채널 목록
    const excludedChannelList = excludeChannelsSetting.excludedChannels
      .slice(0, 10) // 최대 10개만 표시
      .map((channelId: string, index: number) => `${index + 1}. <#${channelId}> (\`${channelId}\`)`)
      .join('\n');

    // 활동 제한 채널 목록
    const activityLimitedChannelList = excludeChannelsSetting.activityLimitedChannels
      .slice(0, 10) // 최대 10개만 표시
      .map((channelId: string, index: number) => `${index + 1}. <#${channelId}> (\`${channelId}\`)`)
      .join('\n');

    embed.addFields(
      {
        name: `🚫 완전 제외 채널 (${excludeChannelsSetting.excludedChannels.length}개)`,
        value: excludedChannelList || '설정된 완전 제외 채널이 없습니다.',
        inline: false,
      },
      {
        name: `⚠️ 활동 제한 채널 (${excludeChannelsSetting.activityLimitedChannels.length}개)`,
        value: activityLimitedChannelList || '설정된 활동 제한 채널이 없습니다.',
        inline: false,
      },
      {
        name: '📝 채널 타입 설명',
        value:
          '• **완전 제외**: 활동 추적 + 로그 출력 모두 제외\n• **활동 제한**: 로그는 출력하되 활동 시간 측정만 제외',
        inline: false,
      },
      {
        name: '💡 사용 방법',
        value:
          '• 채널 ID를 콤마(,)로 구분하여 입력\n• 숫자로만 이루어진 채널 ID만 유효\n• 예시: 1234567890123456789, 9876543210987654321',
        inline: false,
      }
    );

    const totalChannels =
      excludeChannelsSetting.excludedChannels.length +
      excludeChannelsSetting.activityLimitedChannels.length;
    if (totalChannels > 20) {
      embed.addFields({
        name: '📋 안내',
        value: `총 ${totalChannels}개 채널이 설정되어 있지만, 각 타입별로 처음 10개만 표시됩니다.`,
        inline: false,
      });
    }

    // 버튼들 생성
    const actionRow1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('exclude_channels_edit')
        .setLabel('✏️ 제외 채널 수정')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('exclude_channels_clear')
        .setLabel('🗑️ 전체 초기화')
        .setStyle(ButtonStyle.Danger)
    );

    const actionRow2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('settings_back_main')
        .setLabel('⬅️ 메인으로')
        .setStyle(ButtonStyle.Secondary)
    );

    // deferred 상태이므로 editReply 사용
    await interaction.editReply({
      embeds: [embed],
      components: [actionRow1, actionRow2],
    });
  }

  /**
   * 제외 채널 Modal 표시
   * @param interaction - 상호작용 객체
   * @param isEdit - 수정 모드 여부
   * @param currentSetting - 현재 설정 (수정 모드일 때)
   */
  private async showExcludeChannelsModal(
    interaction: ButtonInteraction,
    isEdit: boolean = false,
    currentSetting?: { excludedChannels: string[]; activityLimitedChannels: string[] }
  ): Promise<void> {
    const modal = new ModalBuilder()
      .setCustomId(isEdit ? 'exclude_channels_edit_modal' : 'exclude_channels_add_modal')
      .setTitle(isEdit ? '✏️ 제외 채널 수정' : '🚫 제외 채널 설정');

    // 완전 제외 채널 목록 입력
    const channelListInput = new TextInputBuilder()
      .setCustomId('excluded_channels')
      .setLabel('완전 제외 채널 ID 목록 (활동+로그 둘 다 제외)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(2000)
      .setPlaceholder('예: 1234567890123456789, 9876543210987654321');

    // 활동 제한 채널 목록 입력
    const activityLimitedInput = new TextInputBuilder()
      .setCustomId('activity_limited_channels')
      .setLabel('활동 제한 채널 ID 목록 (로그 출력, 활동 시간만 제외)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(2000)
      .setPlaceholder('예: 1234567890123456789, 9876543210987654321');

    if (isEdit && currentSetting) {
      if (currentSetting.excludedChannels.length > 0) {
        channelListInput.setValue(currentSetting.excludedChannels.join(', '));
      }
      if (currentSetting.activityLimitedChannels.length > 0) {
        activityLimitedInput.setValue(currentSetting.activityLimitedChannels.join(', '));
      }
    }

    // ActionRow에 입력 필드들 추가
    const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(channelListInput);
    const secondActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
      activityLimitedInput
    );

    modal.addComponents(firstActionRow, secondActionRow);

    await interaction.showModal(modal);
  }

  /**
   * 제외 채널 Modal 제출 처리
   * @param interaction - Modal 제출 상호작용 객체
   */
  async handleExcludeChannelsModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    try {
      const guildId = interaction.guild?.id;
      if (!guildId) {
        throw new Error('길드 정보를 찾을 수 없습니다.');
      }

      const isEdit = interaction.customId === 'exclude_channels_edit_modal';
      const excludedChannelsInput =
        interaction.fields.getTextInputValue('excluded_channels')?.trim() || '';
      const activityLimitedInput =
        interaction.fields.getTextInputValue('activity_limited_channels')?.trim() || '';

      // 입력 검증 - 최소 하나는 입력되어야 함
      if (!excludedChannelsInput && !activityLimitedInput) {
        throw new Error('완전 제외 채널 또는 활동 제한 채널 중 하나는 입력해야 합니다.');
      }

      // 완전 제외 채널 파싱
      const excludedChannelIds = excludedChannelsInput
        ? excludedChannelsInput
            .split(',')
            .map((id) => id.trim())
            .filter((id) => id.length > 0)
            .filter((id) => /^\d{17,20}$/.test(id)) // Discord 채널 ID 형식 검증 (17-20자리 숫자)
            .slice(0, 50) // 최대 50개 채널
        : [];

      // 활동 제한 채널 파싱
      const activityLimitedChannelIds = activityLimitedInput
        ? activityLimitedInput
            .split(',')
            .map((id) => id.trim())
            .filter((id) => id.length > 0)
            .filter((id) => /^\d{17,20}$/.test(id)) // Discord 채널 ID 형식 검증 (17-20자리 숫자)
            .slice(0, 50) // 최대 50개 채널
        : [];

      // 중복 제거
      const uniqueExcludedIds = [...new Set(excludedChannelIds)];
      const uniqueActivityLimitedIds = [...new Set(activityLimitedChannelIds)];

      // 두 목록 간 중복 검사
      const overlapping = uniqueExcludedIds.filter((id) => uniqueActivityLimitedIds.includes(id));
      if (overlapping.length > 0) {
        throw new Error(`채널이 두 목록에 중복되었습니다: ${overlapping.join(', ')}`);
      }

      // 데이터베이스에 저장
      const result = await this.guildSettingsManager.setExcludeChannels(
        guildId,
        uniqueExcludedIds.join(', '),
        uniqueActivityLimitedIds.join(', '),
        interaction.user.id,
        interaction.user.displayName
      );

      if (!result.isValid) {
        throw new Error(result.error || '제외 채널 설정 저장에 실패했습니다.');
      }

      // 성공 응답
      const successEmbed = this.createExcludeChannelsSuccessEmbed(
        uniqueExcludedIds,
        uniqueActivityLimitedIds,
        isEdit,
        result.warnings
      );

      await interaction.reply({
        embeds: [successEmbed],
        flags: MessageFlags.Ephemeral,
      });

      // 로그 기록 제거됨 - 음성 채널 활동과 관련 없는 관리 설정 로그
    } catch (error) {
      console.error('제외 채널 Modal 제출 처리 오류:', error);

      const errorMessage =
        error instanceof Error ? error.message : '제외 채널 설정 저장 중 오류가 발생했습니다.';
      const errorEmbed = this.createErrorEmbed(errorMessage);

      await interaction.reply({
        embeds: [errorEmbed],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * 제외 채널 설정 성공 Embed 생성
   * @param channelIds - 채널 ID 목록
   * @param isEdit - 수정 여부
   * @param description - 설명
   * @param warnings - 경고 메시지들
   */
  private createExcludeChannelsSuccessEmbed(
    excludedChannelIds: string[],
    activityLimitedChannelIds: string[],
    isEdit: boolean,
    warnings?: string[]
  ): EmbedBuilder {
    const totalChannelCount = excludedChannelIds.length + activityLimitedChannelIds.length;

    const embed = new EmbedBuilder()
      .setTitle('✅ 제외 채널 설정 완료')
      .setColor(warnings && warnings.length > 0 ? Colors.Orange : Colors.Green)
      .addFields(
        {
          name: '🚫 완전 제외 채널',
          value: `**${excludedChannelIds.length}개** (활동+로그 둘 다 제외)`,
          inline: true,
        },
        {
          name: '⚠️ 활동 제한 채널',
          value: `**${activityLimitedChannelIds.length}개** (로그 출력, 활동만 제외)`,
          inline: true,
        },
        {
          name: '📝 상태',
          value: isEdit ? '✏️ 수정됨' : '🆕 새로 설정됨',
          inline: true,
        }
      )
      .setTimestamp()
      .setFooter({ text: '제외 채널 설정이 성공적으로 저장되었습니다.' });

    // 완전 제외 채널 목록 표시 (최대 10개)
    if (excludedChannelIds.length > 0) {
      const excludedChannelDisplay = excludedChannelIds
        .slice(0, 10)
        .map((channelId, index) => `${index + 1}. <#${channelId}> (\`${channelId}\`)`)
        .join('\n');

      embed.addFields({
        name: `🚫 완전 제외 채널 목록 (처음 ${Math.min(excludedChannelIds.length, 10)}개)`,
        value: excludedChannelDisplay,
        inline: false,
      });
    }

    // 활동 제한 채널 목록 표시 (최대 10개)
    if (activityLimitedChannelIds.length > 0) {
      const activityLimitedDisplay = activityLimitedChannelIds
        .slice(0, 10)
        .map((channelId, index) => `${index + 1}. <#${channelId}> (\`${channelId}\`)`)
        .join('\n');

      embed.addFields({
        name: `⚠️ 활동 제한 채널 목록 (처음 ${Math.min(activityLimitedChannelIds.length, 10)}개)`,
        value: activityLimitedDisplay,
        inline: false,
      });
    }

    if (totalChannelCount > 20) {
      embed.addFields({
        name: '📋 안내',
        value: `총 ${totalChannelCount}개 채널이 설정되었지만, 각 유형별로 처음 10개씩만 표시됩니다.`,
        inline: false,
      });
    }

    // 경고사항이 있으면 추가
    if (warnings && warnings.length > 0) {
      embed.addFields({
        name: '⚠️ 경고사항',
        value: warnings.map((w) => `• ${w}`).join('\n'),
        inline: false,
      });
    }

    embed.addFields({
      name: '💡 적용 효과',
      value:
        '• 위 채널들에서는 음성 활동이 추적되지 않습니다.\n• 활동 시간 집계 및 보고서에서 완전히 제외됩니다.\n• 기존 환경변수 설정보다 우선 적용됩니다.',
      inline: false,
    });

    return embed;
  }

  // ==========================================
  // 관리 채널 설정 Modal 및 핸들러
  // ==========================================

  /**
   * 관리 채널 설정 인터페이스 표시
   * @param interaction - 버튼 상호작용 객체
   */
  async handleManagementChannelsButton(interaction: ButtonInteraction): Promise<void> {
    try {
      const guildId = interaction.guild?.id;
      if (!guildId) {
        throw new Error('길드 정보를 찾을 수 없습니다.');
      }

      // 현재 설정된 관리 채널 조회
      const channelManagementSetting =
        await this.guildSettingsManager.getChannelManagement(guildId);

      if (channelManagementSetting && this.hasAnyChannelManagementSet(channelManagementSetting)) {
        // 기존 관리 채널 설정이 있으면 수정 인터페이스 표시
        await this.showManagementChannelsInterface(interaction, channelManagementSetting);
      } else {
        // 관리 채널 설정이 없으면 바로 설정 Modal 표시
        await this.showManagementChannelsModal(interaction, false);
      }
    } catch (error) {
      console.error('관리 채널 버튼 처리 오류:', error);
      const errorEmbed = this.createErrorEmbed('관리 채널 설정을 불러오는 중 오류가 발생했습니다.');
      await interaction.followUp({
        embeds: [errorEmbed],
        flags: MessageFlags.Ephemeral,
      });
      return; // 오류 처리 후 함수 종료
    }
  }

  /**
   * 관리 채널 설정 존재 여부 확인
   * @param settings - 채널 관리 설정
   */
  private hasAnyChannelManagementSet(settings: any): boolean {
    return !!(
      settings.logChannelId ||
      settings.forumChannelId ||
      settings.voiceCategoryId ||
      settings.forumTagId
    );
  }

  /**
   * 관리 채널 인터페이스 표시
   * @param interaction - 상호작용 객체
   * @param channelManagementSetting - 현재 관리 채널 설정
   */
  private async showManagementChannelsInterface(
    interaction: ButtonInteraction,
    channelManagementSetting: any
  ): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle('⚙️ 관리 채널 설정')
      .setColor(Colors.Blue)
      .setDescription('봇이 사용할 관리 채널들을 설정합니다.')
      .setTimestamp();

    // 현재 설정된 채널들 표시
    const channelFields: string[] = [];

    if (channelManagementSetting.logChannelId) {
      channelFields.push(
        `• **로그 채널**: <#${channelManagementSetting.logChannelId}> (\`${channelManagementSetting.logChannelId}\`)`
      );
    } else {
      channelFields.push('• **로그 채널**: 미설정');
    }

    if (channelManagementSetting.forumChannelId) {
      channelFields.push(
        `• **구인구직 포럼**: <#${channelManagementSetting.forumChannelId}> (\`${channelManagementSetting.forumChannelId}\`)`
      );
    } else {
      channelFields.push('• **구인구직 포럼**: 미설정');
    }

    if (channelManagementSetting.voiceCategoryId) {
      channelFields.push(
        `• **음성 카테고리**: <#${channelManagementSetting.voiceCategoryId}> (\`${channelManagementSetting.voiceCategoryId}\`)`
      );
    } else {
      channelFields.push('• **음성 카테고리**: 미설정');
    }

    if (channelManagementSetting.forumTagId) {
      channelFields.push(`• **포럼 태그 ID**: \`${channelManagementSetting.forumTagId}\``);
    } else {
      channelFields.push('• **포럼 태그 ID**: 미설정');
    }

    embed.addFields(
      {
        name: '📋 현재 관리 채널 설정',
        value: channelFields.join('\n'),
        inline: false,
      },
      {
        name: '📝 채널별 용도',
        value:
          '• **로그 채널**: 활동 보고서 및 로그가 전송되는 채널\n• **구인구직 포럼**: 구인구직 포스트가 생성되는 포럼 채널\n• **음성 카테고리**: 게임별 음성 채널이 생성될 카테고리\n• **포럼 태그 ID**: 구인구직 포스트에 적용될 태그',
        inline: false,
      },
      {
        name: '💡 사용 방법',
        value:
          '• 각 채널의 ID를 개별적으로 설정 가능\n• 필요한 채널만 선택적으로 설정 가능\n• 기존 설정을 수정하거나 전체 초기화 가능',
        inline: false,
      }
    );

    // 버튼들 생성
    const actionRow1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('management_channels_edit')
        .setLabel('✏️ 채널 설정 수정')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('management_channels_clear')
        .setLabel('🗑️ 전체 초기화')
        .setStyle(ButtonStyle.Danger)
    );

    const actionRow2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('settings_back_main')
        .setLabel('⬅️ 메인으로')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.update({
      embeds: [embed],
      components: [actionRow1, actionRow2],
    });
  }

  /**
   * 관리 채널 Modal 표시
   * @param interaction - 상호작용 객체
   * @param isEdit - 수정 모드 여부
   * @param currentSettings - 현재 채널 설정 (수정 모드일 때)
   */
  private async showManagementChannelsModal(
    interaction: ButtonInteraction,
    isEdit: boolean = false,
    currentSettings?: any
  ): Promise<void> {
    const modal = new ModalBuilder()
      .setCustomId(isEdit ? 'management_channels_edit_modal' : 'management_channels_add_modal')
      .setTitle(isEdit ? '✏️ 관리 채널 수정' : '⚙️ 관리 채널 설정');

    // 로그 채널 ID 입력
    const logChannelInput = new TextInputBuilder()
      .setCustomId('log_channel_id')
      .setLabel('로그 채널 ID (선택사항)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(20)
      .setPlaceholder('예: 1234567890123456789');

    if (isEdit && currentSettings?.logChannelId) {
      logChannelInput.setValue(currentSettings.logChannelId);
    }

    // 구인구직 포럼 채널 ID 입력
    const forumChannelInput = new TextInputBuilder()
      .setCustomId('forum_channel_id')
      .setLabel('구인구직 포럼 채널 ID (선택사항)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(20)
      .setPlaceholder('예: 1234567890123456789');

    if (isEdit && currentSettings?.forumChannelId) {
      forumChannelInput.setValue(currentSettings.forumChannelId);
    }

    // 음성 카테고리 ID 입력
    const voiceCategoryInput = new TextInputBuilder()
      .setCustomId('voice_category_id')
      .setLabel('게임 음성 카테고리 ID (선택사항)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(20)
      .setPlaceholder('예: 1234567890123456789');

    if (isEdit && currentSettings?.voiceCategoryId) {
      voiceCategoryInput.setValue(currentSettings.voiceCategoryId);
    }

    // 포럼 태그 ID 입력
    const forumTagInput = new TextInputBuilder()
      .setCustomId('forum_tag_id')
      .setLabel('포럼 태그 ID (선택사항)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(20)
      .setPlaceholder('예: 1234567890123456789');

    if (isEdit && currentSettings?.forumTagId) {
      forumTagInput.setValue(currentSettings.forumTagId);
    }

    // ActionRow에 입력 필드들 추가 (최대 5개까지만 가능)
    const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(logChannelInput);
    const secondActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
      forumChannelInput
    );
    const thirdActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
      voiceCategoryInput
    );
    const fourthActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(forumTagInput);

    modal.addComponents(firstActionRow, secondActionRow, thirdActionRow, fourthActionRow);

    await interaction.showModal(modal);
  }

  /**
   * 관리 채널 Modal 제출 처리
   * @param interaction - Modal 제출 상호작용 객체
   */
  async handleManagementChannelsModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    try {
      const guildId = interaction.guild?.id;
      if (!guildId) {
        throw new Error('길드 정보를 찾을 수 없습니다.');
      }

      const isEdit = interaction.customId === 'management_channels_edit_modal';

      // 각 채널 ID 값 추출
      const logChannelId = interaction.fields.getTextInputValue('log_channel_id')?.trim() || '';
      const forumChannelId = interaction.fields.getTextInputValue('forum_channel_id')?.trim() || '';
      const voiceCategoryId =
        interaction.fields.getTextInputValue('voice_category_id')?.trim() || '';
      const forumTagId = interaction.fields.getTextInputValue('forum_tag_id')?.trim() || '';

      // 입력된 채널 ID들 수집 및 검증
      const channelInputs = [
        { name: '로그 채널', id: logChannelId, field: 'logChannelId' },
        { name: '구인구직 포럼', id: forumChannelId, field: 'forumChannelId' },
        { name: '음성 카테고리', id: voiceCategoryId, field: 'voiceCategoryId' },
        { name: '포럼 태그', id: forumTagId, field: 'forumTagId' },
      ];

      const validatedChannels: any = {};
      const errors: string[] = [];

      // 각 채널 ID 검증
      for (const input of channelInputs) {
        if (input.id) {
          // Discord 채널/카테고리 ID 형식 검증 (17-20자리 숫자)
          if (!/^\d{17,20}$/.test(input.id)) {
            errors.push(`${input.name} ID가 올바르지 않습니다. (17-20자리 숫자여야 함)`);
          } else {
            // 길드 ID와 동일한지 확인
            if (input.id === guildId) {
              errors.push(
                `${input.name} ID가 길드 ID와 동일합니다. 올바른 채널 ID를 입력해주세요.`
              );
            } else {
              validatedChannels[input.field] = input.id;
            }
          }
        }
      }

      // 최소 하나 이상의 채널은 설정되어야 함
      if (Object.keys(validatedChannels).length === 0) {
        throw new Error('최소 하나 이상의 채널을 설정해야 합니다.');
      }

      // 입력 오류가 있으면 에러 출력
      if (errors.length > 0) {
        throw new Error(errors.join('\n'));
      }

      // 채널 존재 및 권한 검증
      const channelValidationErrors: string[] = [];

      for (const [field, channelId] of Object.entries(validatedChannels)) {
        try {
          const channel = await interaction.client.channels.fetch(channelId as string);

          if (!channel) {
            const channelName = channelInputs.find((input) => input.field === field)?.name || field;
            channelValidationErrors.push(
              `${channelName}: 채널을 찾을 수 없습니다. (ID: ${channelId})`
            );
            continue;
          }

          // 길드 채널인지 확인
          if (!(channel instanceof GuildChannel) || channel.guild.id !== guildId) {
            const channelName = channelInputs.find((input) => input.field === field)?.name || field;
            channelValidationErrors.push(
              `${channelName}: 다른 서버의 채널입니다. 이 서버의 채널을 입력해주세요.`
            );
            continue;
          }

          // 로그 채널의 경우 텍스트 기반 채널이어야 함
          if (field === 'logChannelId') {
            if (!channel.isTextBased()) {
              channelValidationErrors.push(
                `로그 채널: 텍스트 기반 채널이어야 합니다. (현재: ${channel.type})`
              );
              continue;
            }

            // 메시지 전송 권한 확인 (길드 채널인 경우만)
            if (
              channel instanceof GuildChannel &&
              !channel
                .permissionsFor(interaction.client.user)
                ?.has(PermissionFlagsBits.SendMessages)
            ) {
              channelValidationErrors.push(`로그 채널: 봇이 메시지를 전송할 권한이 없습니다.`);
              continue;
            }
          }

          // 포럼 채널의 경우 포럼 타입이어야 함
          if (field === 'forumChannelId') {
            if (channel.type !== 15) {
              // GUILD_FORUM
              channelValidationErrors.push(
                `구인구직 포럼: 포럼 채널이어야 합니다. (현재: ${channel.type})`
              );
              continue;
            }
          }

          // 음성 카테고리의 경우 카테고리 타입이어야 함
          if (field === 'voiceCategoryId') {
            if (channel.type !== 4) {
              // GUILD_CATEGORY
              channelValidationErrors.push(
                `음성 카테고리: 카테고리 채널이어야 합니다. (현재: ${channel.type})`
              );
              continue;
            }
          }
        } catch (error) {
          const channelName = channelInputs.find((input) => input.field === field)?.name || field;
          channelValidationErrors.push(
            `${channelName}: 채널 접근 중 오류가 발생했습니다. (${error instanceof Error ? error.message : '알 수 없는 오류'})`
          );
        }
      }

      // 채널 검증 오류가 있으면 에러 출력
      if (channelValidationErrors.length > 0) {
        throw new Error('채널 검증 실패:\n' + channelValidationErrors.join('\n'));
      }

      // 데이터베이스에 저장
      const result = await this.guildSettingsManager.setChannelManagement(
        guildId,
        validatedChannels,
        interaction.user.id,
        interaction.user.displayName
      );

      if (!result.isValid) {
        throw new Error(result.error || '관리 채널 설정 저장에 실패했습니다.');
      }

      // 로그 채널 설정이 변경된 경우 LogService 캐시 무효화
      if (validatedChannels.logChannelId && this.logService) {
        try {
          this.logService.clearChannelCache(guildId);
          console.log(`[SettingsCommand] 로그 채널 캐시 무효화 완료: ${guildId}`);
        } catch (error) {
          console.error('[SettingsCommand] 로그 채널 캐시 무효화 실패:', error);
          // 캐시 무효화 실패는 치명적이지 않으므로 계속 진행
        }
      }

      // 성공 응답
      const successEmbed = this.createManagementChannelsSuccessEmbed(
        validatedChannels,
        isEdit,
        result.warnings
      );

      await interaction.reply({
        embeds: [successEmbed],
        flags: MessageFlags.Ephemeral,
      });

      // 로그 기록 제거됨 - 음성 채널 활동과 관련 없는 관리 설정 로그
    } catch (error) {
      console.error('관리 채널 Modal 제출 처리 오류:', error);

      const errorMessage =
        error instanceof Error ? error.message : '관리 채널 설정 저장 중 오류가 발생했습니다.';
      const errorEmbed = this.createErrorEmbed(errorMessage);

      await interaction.reply({
        embeds: [errorEmbed],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * 관리 채널 설정 성공 Embed 생성
   * @param channelSettings - 채널 설정 객체
   * @param isEdit - 수정 여부
   * @param warnings - 경고 메시지들
   */
  private createManagementChannelsSuccessEmbed(
    channelSettings: any,
    isEdit: boolean,
    warnings?: string[]
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('✅ 관리 채널 설정 완료')
      .setColor(warnings && warnings.length > 0 ? Colors.Orange : Colors.Green)
      .addFields(
        {
          name: '⚙️ 설정된 채널 수',
          value: `**${Object.keys(channelSettings).length}개**`,
          inline: true,
        },
        {
          name: '📝 상태',
          value: isEdit ? '✏️ 수정됨' : '🆕 새로 설정됨',
          inline: true,
        },
        {
          name: '🔧 적용 효과',
          value: '즉시 적용됨',
          inline: true,
        }
      )
      .setTimestamp()
      .setFooter({ text: '관리 채널 설정이 성공적으로 저장되었습니다.' });

    // 설정된 채널들 표시
    const channelList: string[] = [];

    if (channelSettings.logChannelId) {
      channelList.push(`• **로그 채널**: <#${channelSettings.logChannelId}>`);
    }
    if (channelSettings.forumChannelId) {
      channelList.push(`• **구인구직 포럼**: <#${channelSettings.forumChannelId}>`);
    }
    if (channelSettings.voiceCategoryId) {
      channelList.push(`• **음성 카테고리**: <#${channelSettings.voiceCategoryId}>`);
    }
    if (channelSettings.forumTagId) {
      channelList.push(`• **포럼 태그 ID**: \`${channelSettings.forumTagId}\``);
    }

    if (channelList.length > 0) {
      embed.addFields({
        name: '📋 설정된 관리 채널',
        value: channelList.join('\n'),
        inline: false,
      });
    }

    // 경고사항이 있으면 추가
    if (warnings && warnings.length > 0) {
      embed.addFields({
        name: '⚠️ 경고사항',
        value: warnings.map((w) => `• ${w}`).join('\n'),
        inline: false,
      });
    }

    embed.addFields({
      name: '💡 채널별 용도',
      value:
        '• **로그 채널**: 활동 보고서 및 봇 로그 출력\n• **구인구직 포럼**: 자동 구인구직 포스트 생성\n• **음성 카테고리**: 게임별 임시 음성 채널 생성 위치\n• **포럼 태그**: 구인구직 포스트의 참가자 목록 표시용',
      inline: false,
    });

    return embed;
  }
}
