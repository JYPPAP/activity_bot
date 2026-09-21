// src/ui/buttons/RoleTagButtons.js - 역할 태그 버튼 처리
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { DiscordConstants } from '../../config/DiscordConstants.js';
import { RecruitmentConfig } from '../../config/RecruitmentConfig.js';
import { SafeInteraction } from '../../utils/SafeInteraction.js';
import { RecruitmentUIBuilder } from '../RecruitmentUIBuilder.js';
import { logger } from '../../config/logger-termux.js';

export class RoleTagButtons {
  constructor(deps) {
    this.recruitmentService = deps.recruitmentService;
    this.modalHandler = deps.modalHandler;
    this.parent = deps.parent;
  }

  /**
   * 역할 태그 버튼 처리 (다중 선택 지원)
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Promise<void>}
   */
  async handleRoleTagButtons(interaction) {
    try {
      const customId = interaction.customId;

      // 특수 버튼 처리 ([장기], [내전])
      if (customId === 'special_longterm_button') {
        await this.recruitmentService.handleSpecialRecruitmentButton(interaction, 'long_term');
        return;
      } else if (customId === 'special_scrimmage_button') {
        await this.recruitmentService.handleSpecialRecruitmentButton(interaction, 'scrimmage');
        return;
      }

      // 완료 버튼 처리
      if (this.isCompleteButton(customId)) {
        await this.handleCompleteButton(interaction, customId);
        return;
      }

      // 태그 선택/해제 처리
      await this.handleTagToggle(interaction, customId);

    } catch (error) {
      logger.error('[ButtonHandler] 역할 태그 버튼 처리 오류', { error: error.message, stack: error.stack });
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
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE);
  }
  
  /**
   * 완료 버튼 처리
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @param {string} customId - 커스텀 ID
   * @returns {Promise<void>}
   */
  async handleCompleteButton(interaction, customId) {
    const selectedTags = this.extractSelectedTags(interaction);

    // === DEBUG: 상세 로깅 시작 ===
    logger.info(`\n[ButtonHandler] ===== 완료 버튼 처리 시작 =====`);
    logger.info(`[ButtonHandler] 받은 customId: "${customId}"`);
    logger.info(`[ButtonHandler] 선택된 태그: [${selectedTags.join(', ')}]`);
    logger.info(`[ButtonHandler] STANDALONE_ROLE_COMPLETE 프리픽스: "${DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE}"`);
    logger.info(`[ButtonHandler] startsWith 체크 결과: ${customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE)}`);

    if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE)) {
      logger.info(`[ButtonHandler] ✅ 독립 구인구직 브랜치 진입`);

      // 독립 구인구직: methodValue 파싱
      const parts = customId.split('_');
      // standalone_role_complete_scrimmage_new → ['standalone', 'role', 'complete', 'scrimmage', 'new']
      // standalone_role_complete → ['standalone', 'role', 'complete']

      logger.info(`[ButtonHandler] parts 배열: [${parts.join(', ')}]`);
      logger.info(`[ButtonHandler] parts.length: ${parts.length}`);

      if (parts.length > 3) {
        // methodValue가 있는 경우 (장기/내전)
        const methodValue = parts.slice(3).join('_');  // 'scrimmage_new' or 'longterm_new'

        logger.info(`[ButtonHandler] ✅ methodValue 존재 (parts.length > 3)`);
        logger.info(`[ButtonHandler] 파싱된 methodValue: "${methodValue}"`);

        if (methodValue === 'scrimmage_new') {
          logger.info(`[ButtonHandler] ✅✅ 내전 모달 표시 호출`);
          await this.recruitmentService.showSpecialRecruitmentModal(interaction, 'scrimmage', selectedTags);
        } else if (methodValue === 'longterm_new') {
          logger.info(`[ButtonHandler] ✅✅ 장기 모달 표시 호출`);
          await this.recruitmentService.showSpecialRecruitmentModal(interaction, 'long_term', selectedTags);
        } else {
          logger.warn(`[ButtonHandler] ⚠️ 알 수 없는 독립 구인구직 타입: "${methodValue}"`);
          await this.modalHandler.showStandaloneRecruitmentModal(interaction, selectedTags);
        }
      } else {
        // methodValue가 없는 경우 (일반 단기)
        logger.info(`[ButtonHandler] ℹ️ methodValue 없음 (parts.length <= 3) - 일반 단기 모달 표시`);
        await this.modalHandler.showStandaloneRecruitmentModal(interaction, selectedTags);
      }
    } else {
      // 음성 채널 연동 또는 특수 구인구직의 경우
      const parts = customId.split('_');
      const voiceChannelId = parts[2];
      const methodValue = parts.slice(3).join('_');

      logger.info(`[ButtonHandler] 완료 버튼 처리 - methodValue: "${methodValue}"`);

      if (methodValue === DiscordConstants.METHOD_VALUES.NEW_FORUM) {
        logger.info(`[ButtonHandler] 새 포럼 생성 모달 표시`);
        await this.modalHandler.showRecruitmentModal(interaction, voiceChannelId, selectedTags);
      } else if (methodValue === 'scrimmage_new') {
        logger.info(`[ButtonHandler] 내전 모달 표시`);
        await this.recruitmentService.showSpecialRecruitmentModal(interaction, 'scrimmage', selectedTags);
      } else if (methodValue === 'longterm_new') {
        logger.info(`[ButtonHandler] 장기 모달 표시`);
        await this.recruitmentService.showSpecialRecruitmentModal(interaction, 'long_term', selectedTags);
      } else if (methodValue.startsWith(DiscordConstants.METHOD_VALUES.EXISTING_FORUM_PREFIX)) {
        logger.info(`[ButtonHandler] 기존 포럼 연동 처리`);
        const existingPostId = methodValue.replace(DiscordConstants.METHOD_VALUES.EXISTING_FORUM_PREFIX, '');
        await this.recruitmentService.linkToExistingForum(interaction, voiceChannelId, existingPostId, selectedTags);
      } else {
        logger.warn(`[ButtonHandler] 알 수 없는 methodValue: "${methodValue}"`);
        await SafeInteraction.safeReply(interaction, {
          content: '❌ 알 수 없는 요청입니다. 다시 시도해주세요.',
          flags: MessageFlags.Ephemeral
        });
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
      // 독립 구인구직: customId 형식
      // - methodValue 있음: standalone_role_button_{tag}_{methodValue} (예: standalone_role_button_탱커_scrimmage_new)
      // - methodValue 없음: standalone_role_button_{tag} (예: standalone_role_button_탱커)
      const parts = customId.split('_');
      selectedRole = parts[3];

      // methodValue 파싱 (parts.length > 4이면 methodValue 존재)
      if (parts.length > 4) {
        methodValue = parts.slice(4).join('_');
      }

      isStandalone = true;
      logger.info(`[ButtonHandler] 독립 구인구직 태그 토글 - tag: "${selectedRole}", methodValue: "${methodValue}"`);
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
    const embed = RecruitmentUIBuilder.createRoleTagSelectionEmbed(selectedTags, isStandalone, methodValue);

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
   * 역할 태그 버튼인지 확인
   * @param {string} customId - 커스텀 ID
   * @returns {boolean} - 역할 태그 버튼 여부
   */
  isRoleTagButton(customId) {
    return customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_BUTTON) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_COMPLETE) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_BUTTON) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE) ||
           customId === 'special_longterm_button' ||
           customId === 'special_scrimmage_button';
  }
}

