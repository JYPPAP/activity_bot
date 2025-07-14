// src/ui/ButtonHandler.ts - 버튼 인터랙션 처리
import {
  EmbedBuilder,
  MessageFlags,
  ButtonInteraction,
  GuildMember,
  VoiceChannel,
} from 'discord.js';

import { DiscordConstants } from '../config/DiscordConstants.js';
import { config } from '../config/env.js';
import { RecruitmentConfig } from '../config/RecruitmentConfig.js';
import { RecruitmentService } from '../services/RecruitmentService.js';
import { VoiceChannelManager } from '../services/VoiceChannelManager.js';
import { DiscordAPIError } from '../types/discord.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';

import { ModalHandler } from './ModalHandler.js';
import { RecruitmentUIBuilder } from './RecruitmentUIBuilder.js';

// 버튼 처리 결과 인터페이스
interface ButtonHandleResult {
  success: boolean;
  action: string;
  message?: string;
  error?: string;
  duration?: number;
  data?: any;
}

// 닉네임 변경 결과 확장 인터페이스
interface NicknameChangeResult {
  success: boolean;
  oldNickname: string;
  newNickname: string;
  alreadySpectator?: boolean;
  alreadyWaiting?: boolean;
  alreadyNormal?: boolean;
  message?: string;
  error?: string;
}

// 태그 토글 결과 인터페이스
interface TagToggleResult {
  success: boolean;
  selectedTags: string[];
  action: 'added' | 'removed' | 'maxExceeded';
  toggledTag: string;
}

// 버튼 통계 인터페이스
interface ButtonStatistics {
  totalInteractions: number;
  roleTagInteractions: number;
  voiceChannelInteractions: number;
  recruitmentOptionsInteractions: number;
  successfulInteractions: number;
  failedInteractions: number;
  averageResponseTime: number;
  buttonTypes: Record<string, number>;
  lastInteractionTime: Date;
}

// 버튼 검증 결과 인터페이스
interface ButtonValidationResult {
  isValid: boolean;
  buttonType: 'roleTag' | 'voiceChannel' | 'recruitmentOptions' | 'unknown';
  customId: string;
  hasRequiredPermissions: boolean;
  error?: string;
}

export class ButtonHandler {
  private readonly voiceChannelManager: VoiceChannelManager;
  private readonly recruitmentService: RecruitmentService;
  private readonly modalHandler: ModalHandler;

  // 통계 및 모니터링
  private buttonStats: ButtonStatistics = {
    totalInteractions: 0,
    roleTagInteractions: 0,
    voiceChannelInteractions: 0,
    recruitmentOptionsInteractions: 0,
    successfulInteractions: 0,
    failedInteractions: 0,
    averageResponseTime: 0,
    buttonTypes: {},
    lastInteractionTime: new Date(),
  };

  private responseTimeSum: number = 0;
  private interactionHistory: Array<{
    timestamp: Date;
    customId: string;
    userId: string;
    success: boolean;
    responseTime: number;
  }> = [];

  constructor(
    voiceChannelManager: VoiceChannelManager,
    recruitmentService: RecruitmentService,
    modalHandler: ModalHandler
  ) {
    this.voiceChannelManager = voiceChannelManager;
    this.recruitmentService = recruitmentService;
    this.modalHandler = modalHandler;
  }

  /**
   * 역할 태그 버튼 처리 (다중 선택 지원)
   * @param interaction - 버튼 인터랙션
   */
  async handleRoleTagButtons(interaction: ButtonInteraction): Promise<ButtonHandleResult> {
    const startTime = Date.now();

    try {
      this.buttonStats.roleTagInteractions++;
      const customId = interaction.customId;

      // 완료 버튼 처리
      if (this.isCompleteButton(customId)) {
        const result = await this.handleCompleteButton(interaction, customId);
        return this.recordInteractionResult(interaction, 'complete', true, startTime, result);
      }

      // 태그 선택/해제 처리
      const toggleResult = await this.handleTagToggle(interaction, customId);
      return this.recordInteractionResult(
        interaction,
        'tagToggle',
        toggleResult.success,
        startTime,
        toggleResult
      );
    } catch (error) {
      console.error('[ButtonHandler] 역할 태그 버튼 처리 오류:', error);
      const errorMsg = error instanceof Error ? error.message : '알 수 없는 오류';

      await SafeInteraction.safeReply(
        interaction,
        SafeInteraction.createErrorResponse('버튼 처리', {
          code: 0,
          message: error instanceof Error ? error.message : '알 수 없는 오류',
          status: 500,
          method: 'BUTTON_INTERACTION',
          url: 'internal',
          rawError: error,
          requestBody: {},
          name: 'DiscordAPIError',
        } as DiscordAPIError)
      );

      return this.recordInteractionResult(interaction, 'roleTag', false, startTime, {
        error: errorMsg,
      });
    }
  }

  /**
   * 완료 버튼인지 확인
   * @param customId - 커스텀 ID
   * @returns 완료 버튼 여부
   */
  private isCompleteButton(customId: string): boolean {
    return (
      customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_COMPLETE) ||
      customId === DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE
    );
  }

  /**
   * 완료 버튼 처리
   * @param interaction - 버튼 인터랙션
   * @param customId - 커스텀 ID
   */
  private async handleCompleteButton(
    interaction: ButtonInteraction,
    customId: string
  ): Promise<any> {
    const selectedTags = this.extractSelectedTags(interaction);

    if (customId === DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE) {
      // 독립 구인구직 모달 표시
      return await this.modalHandler.showStandaloneRecruitmentModal(interaction, selectedTags);
    } else {
      // 음성 채널 연동의 경우
      const parts = customId.split('_');
      const voiceChannelId = parts[2];
      const methodValue = parts.slice(3).join('_');

      console.log(`[ButtonHandler] 완료 버튼 처리 - methodValue: "${methodValue}"`);

      if (methodValue === DiscordConstants.METHOD_VALUES.NEW_FORUM) {
        console.log(`[ButtonHandler] 새 포럼 생성 모달 표시`);
        return await this.modalHandler.showRecruitmentModal(
          interaction,
          voiceChannelId,
          selectedTags
        );
      } else if (methodValue.startsWith(DiscordConstants.METHOD_VALUES.EXISTING_FORUM_PREFIX)) {
        console.log(`[ButtonHandler] 기존 포럼 연동 처리`);
        const existingPostId = methodValue.replace(
          DiscordConstants.METHOD_VALUES.EXISTING_FORUM_PREFIX,
          ''
        );
        return await this.recruitmentService.linkToExistingForum(
          interaction,
          voiceChannelId,
          existingPostId,
          selectedTags
        );
      } else {
        console.warn(`[ButtonHandler] 알 수 없는 methodValue: "${methodValue}"`);
        await SafeInteraction.safeReply(interaction, {
          content: '❌ 알 수 없는 요청입니다. 다시 시도해주세요.',
          flags: MessageFlags.Ephemeral,
        });
        throw new Error(`Unknown methodValue: ${methodValue}`);
      }
    }
  }

  /**
   * 태그 토글 처리
   * @param interaction - 버튼 인터랙션
   * @param customId - 커스텀 ID
   */
  private async handleTagToggle(
    interaction: ButtonInteraction,
    customId: string
  ): Promise<TagToggleResult> {
    let selectedRole: string;
    let voiceChannelId: string | undefined;
    let methodValue: string | undefined;
    let isStandalone = false;

    if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_BUTTON)) {
      selectedRole = customId.split('_')[3];
      isStandalone = true;
    } else {
      const parts = customId.split('_');
      selectedRole = parts[2];
      voiceChannelId = parts[3];
      methodValue = parts.slice(4).join('_');
    }

    // 현재 선택된 태그들 추출
    const selectedTags = this.extractSelectedTags(interaction);

    // 태그 토글
    const index = selectedTags.indexOf(selectedRole);
    let action: 'added' | 'removed' | 'maxExceeded';

    if (index > -1) {
      // 이미 선택된 태그 제거
      selectedTags.splice(index, 1);
      action = 'removed';
    } else {
      // 새 태그 추가 (최대 개수 체크)
      if (selectedTags.length >= RecruitmentConfig.MAX_SELECTED_TAGS) {
        await SafeInteraction.safeReply(interaction, {
          content: RecruitmentConfig.MESSAGES.MAX_TAGS_EXCEEDED,
          flags: MessageFlags.Ephemeral,
        });
        return {
          success: false,
          selectedTags,
          action: 'maxExceeded',
          toggledTag: selectedRole,
        };
      }
      selectedTags.push(selectedRole);
      action = 'added';
    }

    // UI 업데이트
    await this.updateTagSelectionUI(
      interaction,
      selectedTags,
      isStandalone,
      voiceChannelId,
      methodValue
    );

    return {
      success: true,
      selectedTags,
      action,
      toggledTag: selectedRole,
    };
  }

  /**
   * 현재 선택된 태그들 추출
   * @param interaction - 버튼 인터랙션
   * @returns 선택된 태그 배열
   */
  private extractSelectedTags(interaction: ButtonInteraction): string[] {
    try {
      const embed = EmbedBuilder.from(interaction.message.embeds[0]);
      const description = embed.data.description || '';
      const selectedTagsMatch = description.match(/선택된 태그: \*\*(.*?)\*\*/);

      let selectedTags: string[] = [];
      if (selectedTagsMatch && selectedTagsMatch[1] !== '없음') {
        selectedTags = selectedTagsMatch[1].split(', ');
      }

      return selectedTags;
    } catch (error) {
      console.error('[ButtonHandler] 선택된 태그 추출 오류:', error);
      return [];
    }
  }

  /**
   * 태그 선택 UI 업데이트
   * @param interaction - 버튼 인터랙션
   * @param selectedTags - 선택된 태그 배열
   * @param isStandalone - 독립 모드 여부
   * @param voiceChannelId - 음성 채널 ID
   * @param methodValue - 메서드 값
   */
  private async updateTagSelectionUI(
    interaction: ButtonInteraction,
    selectedTags: string[],
    isStandalone: boolean,
    voiceChannelId?: string,
    methodValue?: string
  ): Promise<void> {
    // 임베드 업데이트
    const embed = RecruitmentUIBuilder.createRoleTagSelectionEmbed(selectedTags, isStandalone);

    // 버튼 업데이트
    const components = RecruitmentUIBuilder.createRoleTagButtons(
      selectedTags,
      voiceChannelId || null,
      methodValue || null,
      isStandalone
    );

    await SafeInteraction.safeUpdate(interaction, {
      embeds: [embed],
      components,
    });
  }

  /**
   * 음성 채널 관련 버튼 처리
   * @param interaction - 버튼 인터랙션
   */
  async handleVoiceChannelButtons(interaction: ButtonInteraction): Promise<ButtonHandleResult> {
    const startTime = Date.now();

    // 중복 처리 방지
    if (!SafeInteraction.startProcessing(interaction)) {
      return {
        success: false,
        action: 'voiceChannel',
        error: '이미 처리 중인 인터랙션',
      };
    }

    try {
      this.buttonStats.voiceChannelInteractions++;

      // 인터랙션 유효성 검사
      const validation = SafeInteraction.validateInteraction(interaction);
      if (!validation.valid) {
        console.warn(`[ButtonHandler] 유효하지 않은 인터랙션: ${validation.reason}`);
        return {
          success: false,
          action: 'voiceChannel',
          ...(validation.reason && { error: validation.reason }),
        };
      }

      const customId = interaction.customId;
      console.log(`[ButtonHandler] 음성 채널 버튼 처리: ${customId}`);

      let result: any;

      if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_CONNECT)) {
        result = await this.handleConnectButton(interaction);
      } else if (
        customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_SPECTATE) ||
        customId === 'general_spectate'
      ) {
        result = await this.handleSpectateButton(interaction);
      } else if (
        customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_WAIT) ||
        customId === 'general_wait'
      ) {
        result = await this.handleWaitButton(interaction);
      } else if (
        customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_RESET) ||
        customId === 'general_reset'
      ) {
        result = await this.handleResetButton(interaction);
      } else {
        console.warn(`[ButtonHandler] 알 수 없는 음성 채널 버튼: ${customId}`);
        throw new Error(`Unknown voice channel button: ${customId}`);
      }

      return this.recordInteractionResult(interaction, 'voiceChannel', true, startTime, result);
    } catch (error) {
      console.error('[ButtonHandler] 음성 채널 버튼 처리 오류:', error);

      // 10062 에러는 별도 처리
      if ((error as any).code === 10062) {
        console.warn('[ButtonHandler] 만료된 인터랙션 - 에러 응답 생략');
        return {
          success: false,
          action: 'voiceChannel',
          error: '만료된 인터랙션',
        };
      }

      const errorMsg = error instanceof Error ? error.message : '알 수 없는 오류';

      await SafeInteraction.safeReply(
        interaction,
        SafeInteraction.createErrorResponse('음성 채널 버튼 처리', {
          code: 0,
          message: error instanceof Error ? error.message : '알 수 없는 오류',
          status: 500,
          method: 'BUTTON_INTERACTION',
          url: 'internal',
          rawError: error,
          requestBody: {},
          name: 'DiscordAPIError',
        } as DiscordAPIError)
      );

      return this.recordInteractionResult(interaction, 'voiceChannel', false, startTime, {
        error: errorMsg,
      });
    } finally {
      // 처리 완료 표시
      SafeInteraction.finishProcessing(interaction);
    }
  }

  /**
   * 관전 모드 버튼 처리
   * @param interaction - 버튼 인터랙션
   */
  private async handleSpectateButton(
    interaction: ButtonInteraction
  ): Promise<NicknameChangeResult> {
    // 즉시 defer하여 3초 제한 해결
    await SafeInteraction.safeDeferReply(interaction, { ephemeral: true });

    const customId = interaction.customId;
    let channelInfo = '';

    // 범용 버튼인지 확인
    if (customId === 'general_spectate') {
      channelInfo = '🎮 일반 구인구직';
    } else {
      const voiceChannelId = customId.split('_')[2];
      let voiceChannel: VoiceChannel | null = null;
      let channelName = '삭제된 채널';

      // 안전한 채널 fetch
      try {
        const channel = await interaction.client.channels.fetch(voiceChannelId);
        if (channel && channel.isVoiceBased()) {
          voiceChannel = channel as VoiceChannel;
          channelName = voiceChannel.name;
        }
      } catch (error) {
        console.warn(`[ButtonHandler] 채널 fetch 실패 (삭제된 채널일 수 있음): ${voiceChannelId}`);
      }

      channelInfo = `🔊 음성 채널: **${channelName}**`;
    }

    const member = interaction.member as GuildMember;
    const result = await this.voiceChannelManager.setSpectatorMode(member);

    if (result.success) {
      await interaction.editReply({
        content: `${RecruitmentConfig.MESSAGES.SPECTATOR_MODE_SET}\n${channelInfo}\n📝 닉네임: "${result.newNickname}"`,
      });
    } else if (result.alreadySpectator) {
      await interaction.editReply({
        content: RecruitmentConfig.MESSAGES.ALREADY_SPECTATOR,
      });
    } else {
      await interaction.editReply({
        content: `${RecruitmentConfig.MESSAGES.NICKNAME_CHANGE_FAILED}\n${channelInfo}\n💡 수동으로 닉네임을 "${result.newNickname}"로 변경해주세요.`,
      });
    }

    return result;
  }

  /**
   * 참여하기 버튼 처리
   * @param interaction - 버튼 인터랙션
   */
  private async handleConnectButton(interaction: ButtonInteraction): Promise<NicknameChangeResult> {
    // 즉시 defer하여 3초 제한 해결
    await SafeInteraction.safeDeferReply(interaction, { ephemeral: true });

    const voiceChannelId = interaction.customId.split('_')[2];
    let voiceChannel: VoiceChannel | null = null;
    let channelName = '삭제된 채널';

    // 안전한 채널 fetch
    try {
      const channel = await interaction.client.channels.fetch(voiceChannelId);
      if (channel && channel.isVoiceBased()) {
        voiceChannel = channel as VoiceChannel;
        channelName = voiceChannel.name;
      }
    } catch (error) {
      console.warn(`[ButtonHandler] 채널 fetch 실패 (삭제된 채널일 수 있음): ${voiceChannelId}`);
    }

    const member = interaction.member as GuildMember;
    const result = await this.voiceChannelManager.restoreNormalMode(member);

    if (result.success) {
      await interaction.editReply({
        content: `✅ 참여 모드로 설정되었습니다!\n🔊 음성 채널: **${channelName}**\n📝 닉네임: "${result.newNickname}"`,
      });
    } else if (result.alreadyNormal) {
      await interaction.editReply({
        content: '이미 참여 모드입니다.',
      });
    } else {
      await interaction.editReply({
        content: `닉네임 변경에 실패했습니다.\n🔊 음성 채널: **${channelName}**\n💡 수동으로 닉네임을 "${result.newNickname}"로 변경해주세요.`,
      });
    }

    return result;
  }

  /**
   * 대기하기 버튼 처리
   * @param interaction - 버튼 인터랙션
   */
  private async handleWaitButton(interaction: ButtonInteraction): Promise<NicknameChangeResult> {
    // 즉시 defer하여 3초 제한 해결
    await SafeInteraction.safeDeferReply(interaction, { ephemeral: true });

    const customId = interaction.customId;
    let channelInfo = '';

    // 범용 버튼인지 확인
    if (customId === 'general_wait') {
      channelInfo = '🎮 일반 구인구직';
    } else {
      const voiceChannelId = customId.split('_')[2];
      let voiceChannel: VoiceChannel | null = null;
      let channelName = '삭제된 채널';

      // 안전한 채널 fetch
      try {
        const channel = await interaction.client.channels.fetch(voiceChannelId);
        if (channel && channel.isVoiceBased()) {
          voiceChannel = channel as VoiceChannel;
          channelName = voiceChannel.name;
        }
      } catch (error) {
        console.warn(`[ButtonHandler] 채널 fetch 실패 (삭제된 채널일 수 있음): ${voiceChannelId}`);
      }

      channelInfo = `🔊 음성 채널: **${channelName}**`;
    }

    const member = interaction.member as GuildMember;
    const result = await this.voiceChannelManager.setWaitingMode(member);

    if (result.success) {
      await interaction.editReply({
        content: `⏳ 대기 모드로 설정되었습니다!\n${channelInfo}\n📝 닉네임: "${result.newNickname}"`,
      });
    } else if (result.alreadyWaiting) {
      await interaction.editReply({
        content: '이미 대기 모드입니다.',
      });
    } else {
      await interaction.editReply({
        content: `닉네임 변경에 실패했습니다.\n${channelInfo}\n💡 수동으로 닉네임을 "${result.newNickname}"로 변경해주세요.`,
      });
    }

    return result;
  }

  /**
   * 초기화 버튼 처리
   * @param interaction - 버튼 인터랙션
   */
  private async handleResetButton(interaction: ButtonInteraction): Promise<NicknameChangeResult> {
    // 즉시 defer하여 3초 제한 해결
    await SafeInteraction.safeDeferReply(interaction, { ephemeral: true });

    const customId = interaction.customId;
    let channelInfo = '';

    // 범용 버튼인지 확인
    if (customId === 'general_reset') {
      channelInfo = '🎮 일반 구인구직';
    } else {
      const voiceChannelId = customId.split('_')[2];
      let voiceChannel: VoiceChannel | null = null;
      let channelName = '삭제된 채널';

      // 안전한 채널 fetch
      try {
        const channel = await interaction.client.channels.fetch(voiceChannelId);
        if (channel && channel.isVoiceBased()) {
          voiceChannel = channel as VoiceChannel;
          channelName = voiceChannel.name;
        }
      } catch (error) {
        console.warn(`[ButtonHandler] 채널 fetch 실패 (삭제된 채널일 수 있음): ${voiceChannelId}`);
      }

      channelInfo = `🔊 음성 채널: **${channelName}**`;
    }

    const member = interaction.member as GuildMember;
    const result = await this.voiceChannelManager.restoreNormalMode(member);

    if (result.success) {
      await interaction.editReply({
        content: `🔄 닉네임이 초기화되었습니다!\n${channelInfo}\n📝 닉네임: "${result.newNickname}"`,
      });
    } else if (result.alreadyNormal) {
      await interaction.editReply({
        content: '이미 정상 모드입니다.',
      });
    } else {
      await interaction.editReply({
        content: `닉네임 초기화에 실패했습니다.\n${channelInfo}\n💡 수동으로 닉네임을 "${result.newNickname}"로 변경해주세요.`,
      });
    }

    return result;
  }

  /**
   * 버튼 처리 라우팅
   * @param interaction - 버튼 인터랙션
   */
  async routeButtonInteraction(interaction: ButtonInteraction): Promise<ButtonHandleResult> {
    const startTime = Date.now();
    this.buttonStats.totalInteractions++;
    this.buttonStats.lastInteractionTime = new Date();

    const customId = interaction.customId;

    // 버튼 타입별 통계 업데이트
    this.updateButtonTypeStats(customId);

    try {
      // 역할 태그 관련 버튼
      if (this.isRoleTagButton(customId)) {
        return await this.handleRoleTagButtons(interaction);
      }
      // 음성 채널 관련 버튼
      else if (this.isVoiceChannelButton(customId)) {
        return await this.handleVoiceChannelButtons(interaction);
      }
      // recruitment_options 버튼 처리 (제외 채널 확인)
      else if (this.isRecruitmentOptionsButton(customId)) {
        return await this.handleRecruitmentOptionsButton(interaction);
      } else {
        console.warn(`[ButtonHandler] 처리되지 않은 버튼: ${customId}`);
        return {
          success: false,
          action: 'unknown',
          error: `처리되지 않은 버튼: ${customId}`,
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '알 수 없는 오류';
      return this.recordInteractionResult(interaction, 'error', false, startTime, {
        error: errorMsg,
      });
    }
  }

  /**
   * 역할 태그 버튼인지 확인
   * @param customId - 커스텀 ID
   * @returns 역할 태그 버튼 여부
   */
  isRoleTagButton(customId: string): boolean {
    return (
      customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_BUTTON) ||
      customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_COMPLETE) ||
      customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_BUTTON) ||
      customId === DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE
    );
  }

  /**
   * 음성 채널 버튼인지 확인
   * @param customId - 커스텀 ID
   * @returns 음성 채널 버튼 여부
   */
  isVoiceChannelButton(customId: string): boolean {
    return (
      customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_CONNECT) ||
      customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_CLOSE) ||
      customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_SPECTATE) ||
      customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_WAIT) ||
      customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_RESET) ||
      customId === 'general_wait' ||
      customId === 'general_spectate' ||
      customId === 'general_reset' ||
      customId === 'general_close'
    );
  }

  /**
   * recruitment_options 버튼인지 확인
   * @param customId - 커스텀 ID
   * @returns recruitment_options 버튼 여부
   */
  isRecruitmentOptionsButton(customId: string): boolean {
    return customId.startsWith('recruitment_options_');
  }

  /**
   * recruitment_options 버튼 처리 (제외 채널 확인)
   * @param interaction - 버튼 인터랙션
   */
  async handleRecruitmentOptionsButton(
    interaction: ButtonInteraction
  ): Promise<ButtonHandleResult> {
    const startTime = Date.now();
    this.buttonStats.recruitmentOptionsInteractions++;

    const customId = interaction.customId;

    // 버튼 customId에서 채널 ID 추출 (recruitment_options_${channelId} 형식)
    const channelId = customId.split('_')[2];

    // 제외 채널 확인
    if (config.EXCLUDED_CHANNELS.includes(channelId)) {
      // 제외 채널에서 오는 버튼은 조용히 무시
      return this.recordInteractionResult(interaction, 'excludedChannel', true, startTime, {
        message: '제외 채널에서 온 요청 무시',
      });
    }

    // 제외 채널이 아닌 경우 처리되지 않은 버튼으로 분류
    console.warn(`[ButtonHandler] 처리되지 않은 버튼: ${customId}`);

    return this.recordInteractionResult(interaction, 'unhandled', false, startTime, {
      error: `처리되지 않은 recruitment_options 버튼: ${customId}`,
    });
  }

  /**
   * 버튼 검증
   * @param interaction - 버튼 인터랙션
   * @returns 검증 결과
   */
  validateButton(interaction: ButtonInteraction): ButtonValidationResult {
    const customId = interaction.customId;

    let buttonType: ButtonValidationResult['buttonType'] = 'unknown';

    if (this.isRoleTagButton(customId)) {
      buttonType = 'roleTag';
    } else if (this.isVoiceChannelButton(customId)) {
      buttonType = 'voiceChannel';
    } else if (this.isRecruitmentOptionsButton(customId)) {
      buttonType = 'recruitmentOptions';
    }

    // 기본 권한 확인 (여기서는 모든 사용자에게 권한 부여)
    const hasRequiredPermissions = true;

    return {
      isValid: buttonType !== 'unknown',
      buttonType,
      customId,
      hasRequiredPermissions,
    };
  }

  /**
   * 버튼 통계 조회
   * @returns 버튼 통계
   */
  getButtonStatistics(): ButtonStatistics {
    return { ...this.buttonStats };
  }

  /**
   * 인터랙션 히스토리 조회
   * @param limit - 조회할 히스토리 수 제한
   * @returns 인터랙션 히스토리
   */
  getInteractionHistory(limit: number = 100): typeof this.interactionHistory {
    return this.interactionHistory
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * 통계 초기화
   */
  resetStatistics(): void {
    this.buttonStats = {
      totalInteractions: 0,
      roleTagInteractions: 0,
      voiceChannelInteractions: 0,
      recruitmentOptionsInteractions: 0,
      successfulInteractions: 0,
      failedInteractions: 0,
      averageResponseTime: 0,
      buttonTypes: {},
      lastInteractionTime: new Date(),
    };

    this.responseTimeSum = 0;
    this.interactionHistory = [];
  }

  /**
   * 인터랙션 결과 기록
   * @param interaction - 버튼 인터랙션
   * @param action - 액션 타입
   * @param success - 성공 여부
   * @param startTime - 시작 시간
   * @param data - 추가 데이터
   */
  private recordInteractionResult(
    interaction: ButtonInteraction,
    action: string,
    success: boolean,
    startTime: number,
    data?: any
  ): ButtonHandleResult {
    const responseTime = Date.now() - startTime;

    // 통계 업데이트
    if (success) {
      this.buttonStats.successfulInteractions++;
    } else {
      this.buttonStats.failedInteractions++;
    }

    this.responseTimeSum += responseTime;
    this.buttonStats.averageResponseTime =
      this.responseTimeSum / this.buttonStats.totalInteractions;

    // 히스토리 기록
    this.interactionHistory.push({
      timestamp: new Date(),
      customId: interaction.customId,
      userId: interaction.user.id,
      success,
      responseTime,
    });

    // 히스토리 크기 제한
    if (this.interactionHistory.length > 1000) {
      this.interactionHistory = this.interactionHistory.slice(-1000);
    }

    return {
      success,
      action,
      duration: responseTime,
      data,
      message: success ? `${action} 처리 성공` : `${action} 처리 실패`,
    };
  }

  /**
   * 버튼 타입별 통계 업데이트
   * @param customId - 커스텀 ID
   */
  private updateButtonTypeStats(customId: string): void {
    // 버튼 타입 추출
    let buttonType = 'unknown';

    if (customId.startsWith('voice_')) {
      buttonType = 'voice';
    } else if (customId.startsWith('role_')) {
      buttonType = 'role';
    } else if (customId.startsWith('recruitment_')) {
      buttonType = 'recruitment';
    } else if (customId.startsWith('standalone_')) {
      buttonType = 'standalone';
    } else if (customId.startsWith('general_')) {
      buttonType = 'general';
    }

    this.buttonStats.buttonTypes[buttonType] = (this.buttonStats.buttonTypes[buttonType] || 0) + 1;
  }

  /**
   * 서비스 상태 체크
   * @returns 서비스 상태
   */
  healthCheck(): {
    isHealthy: boolean;
    totalInteractions: number;
    successRate: number;
    averageResponseTime: number;
    lastActivity: Date;
    components: Record<string, boolean>;
  } {
    const successRate =
      this.buttonStats.totalInteractions > 0
        ? (this.buttonStats.successfulInteractions / this.buttonStats.totalInteractions) * 100
        : 100;

    return {
      isHealthy: successRate >= 95, // 95% 이상의 성공률을 건강한 상태로 간주
      totalInteractions: this.buttonStats.totalInteractions,
      successRate,
      averageResponseTime: this.buttonStats.averageResponseTime,
      lastActivity: this.buttonStats.lastInteractionTime,
      components: {
        voiceChannelManager: !!this.voiceChannelManager,
        recruitmentService: !!this.recruitmentService,
        modalHandler: !!this.modalHandler,
      },
    };
  }
}
