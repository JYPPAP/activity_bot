// src/ui/ButtonHandler.js - 버튼 인터랙션 처리
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { DiscordConstants } from '../config/DiscordConstants.js';
import { RecruitmentConfig } from '../config/RecruitmentConfig.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';
import { RecruitmentUIBuilder } from './RecruitmentUIBuilder.js';

export class ButtonHandler {
  constructor(voiceChannelManager, recruitmentService, modalHandler) {
    this.voiceChannelManager = voiceChannelManager;
    this.recruitmentService = recruitmentService;
    this.modalHandler = modalHandler;
  }
  
  /**
   * 역할 태그 버튼 처리 (다중 선택 지원)
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Promise<void>}
   */
  async handleRoleTagButtons(interaction) {
    try {
      const customId = interaction.customId;

      // 완료 버튼 처리
      if (this.isCompleteButton(customId)) {
        await this.handleCompleteButton(interaction, customId);
        return;
      }

      // 태그 선택/해제 처리
      await this.handleTagToggle(interaction, customId);

    } catch (error) {
      console.error('[ButtonHandler] 역할 태그 버튼 처리 오류:', error);
      await SafeInteraction.safeReply(interaction, 
        SafeInteraction.createErrorResponse('버튼 처리', error)
      );
    }
  }
  
  /**
   * 완료 버튼인지 확인
   * @param {string} customId - 커스텀 ID
   * @returns {boolean} - 완료 버튼 여부
   */
  isCompleteButton(customId) {
    return customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_COMPLETE) ||
           customId === DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE;
  }
  
  /**
   * 완료 버튼 처리
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @param {string} customId - 커스텀 ID
   * @returns {Promise<void>}
   */
  async handleCompleteButton(interaction, customId) {
    const selectedTags = this.extractSelectedTags(interaction);
    
    if (customId === DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE) {
      // 독립 구인구직 모달 표시
      await this.modalHandler.showStandaloneRecruitmentModal(interaction, selectedTags);
    } else {
      // 음성 채널 연동의 경우
      const parts = customId.split('_');
      const voiceChannelId = parts[2];
      const methodValue = parts.slice(3).join('_');
      
      if (methodValue.startsWith(DiscordConstants.METHOD_VALUES.NEW_FORUM_PREFIX)) {
        await this.modalHandler.showRecruitmentModal(interaction, voiceChannelId, selectedTags);
      } else if (methodValue.startsWith(DiscordConstants.METHOD_VALUES.EXISTING_FORUM_PREFIX)) {
        const methodParts = methodValue.split('_');
        const existingPostId = methodParts[3];
        await this.recruitmentService.linkToExistingForum(interaction, voiceChannelId, existingPostId, selectedTags);
      }
    }
  }
  
  /**
   * 태그 토글 처리
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @param {string} customId - 커스텀 ID
   * @returns {Promise<void>}
   */
  async handleTagToggle(interaction, customId) {
    let selectedRole, voiceChannelId, methodValue;
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
    if (index > -1) {
      // 이미 선택된 태그 제거
      selectedTags.splice(index, 1);
    } else {
      // 새 태그 추가 (최대 개수 체크)
      if (selectedTags.length >= RecruitmentConfig.MAX_SELECTED_TAGS) {
        await SafeInteraction.safeReply(interaction, {
          content: RecruitmentConfig.MESSAGES.MAX_TAGS_EXCEEDED,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      selectedTags.push(selectedRole);
    }

    // UI 업데이트
    await this.updateTagSelectionUI(interaction, selectedTags, isStandalone, voiceChannelId, methodValue);
  }
  
  /**
   * 현재 선택된 태그들 추출
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Array<string>} - 선택된 태그 배열
   */
  extractSelectedTags(interaction) {
    const embed = EmbedBuilder.from(interaction.message.embeds[0]);
    const description = embed.data.description;
    const selectedTagsMatch = description.match(/선택된 태그: \*\*(.*?)\*\*/);
    
    let selectedTags = [];
    if (selectedTagsMatch && selectedTagsMatch[1] !== '없음') {
      selectedTags = selectedTagsMatch[1].split(', ');
    }
    
    return selectedTags;
  }
  
  /**
   * 태그 선택 UI 업데이트
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @param {Array<string>} selectedTags - 선택된 태그 배열
   * @param {boolean} isStandalone - 독립 모드 여부
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {string} methodValue - 메서드 값
   * @returns {Promise<void>}
   */
  async updateTagSelectionUI(interaction, selectedTags, isStandalone, voiceChannelId, methodValue) {
    // 임베드 업데이트
    const embed = RecruitmentUIBuilder.createRoleTagSelectionEmbed(selectedTags, isStandalone);
    
    // 버튼 업데이트
    const components = RecruitmentUIBuilder.createRoleTagButtons(
      selectedTags, 
      voiceChannelId, 
      methodValue, 
      isStandalone
    );

    await SafeInteraction.safeUpdate(interaction, {
      embeds: [embed],
      components: components
    });
  }
  
  /**
   * 음성 채널 관련 버튼 처리
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Promise<void>}
   */
  async handleVoiceChannelButtons(interaction) {
    try {
      const customId = interaction.customId;
      
      if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_SPECTATE)) {
        await this.handleSpectateButton(interaction);
      } else {
        console.warn(`[ButtonHandler] 알 수 없는 음성 채널 버튼: ${customId}`);
      }
      
    } catch (error) {
      console.error('[ButtonHandler] 음성 채널 버튼 처리 오류:', error);
      await SafeInteraction.safeReply(interaction, 
        SafeInteraction.createErrorResponse('음성 채널 버튼 처리', error)
      );
    }
  }
  
  /**
   * 관전 모드 버튼 처리
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Promise<void>}
   */
  async handleSpectateButton(interaction) {
    const voiceChannelId = interaction.customId.split('_')[2];
    const voiceChannel = await interaction.client.channels.fetch(voiceChannelId);
    
    if (!voiceChannel) {
      await SafeInteraction.safeReply(interaction, {
        content: RecruitmentConfig.MESSAGES.VOICE_CHANNEL_NOT_FOUND,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const member = interaction.member;
    const result = await this.voiceChannelManager.setSpectatorMode(member);
    
    if (result.success) {
      await SafeInteraction.safeReply(interaction, {
        content: `${RecruitmentConfig.MESSAGES.SPECTATOR_MODE_SET}\n🔊 음성 채널: **${voiceChannel.name}**\n📝 닉네임: "${result.newNickname}"`,
        flags: MessageFlags.Ephemeral
      });
    } else if (result.alreadySpectator) {
      await SafeInteraction.safeReply(interaction, {
        content: RecruitmentConfig.MESSAGES.ALREADY_SPECTATOR,
        flags: MessageFlags.Ephemeral
      });
    } else {
      await SafeInteraction.safeReply(interaction, {
        content: `${RecruitmentConfig.MESSAGES.NICKNAME_CHANGE_FAILED}\n🔊 음성 채널: **${voiceChannel.name}**\n💡 수동으로 닉네임을 "${result.newNickname}"로 변경해주세요.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }
  
  
  /**
   * 버튼 처리 라우팅
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Promise<void>}
   */
  async routeButtonInteraction(interaction) {
    const customId = interaction.customId;
    
    // 역할 태그 관련 버튼
    if (this.isRoleTagButton(customId)) {
      await this.handleRoleTagButtons(interaction);
    }
    // 음성 채널 관련 버튼
    else if (this.isVoiceChannelButton(customId)) {
      await this.handleVoiceChannelButtons(interaction);
    }
    else {
      console.warn(`[ButtonHandler] 처리되지 않은 버튼: ${customId}`);
    }
  }
  
  /**
   * 역할 태그 버튼인지 확인
   * @param {string} customId - 커스텀 ID
   * @returns {boolean} - 역할 태그 버튼 여부
   */
  isRoleTagButton(customId) {
    return customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_BUTTON) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_COMPLETE) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_BUTTON) ||
           customId === DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE;
  }
  
  /**
   * 음성 채널 버튼인지 확인
   * @param {string} customId - 커스텀 ID
   * @returns {boolean} - 음성 채널 버튼 여부
   */
  isVoiceChannelButton(customId) {
    return customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_SPECTATE);
  }
}