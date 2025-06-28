// src/ui/ModalHandler.js - 모달 처리 핸들러
import { 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  ActionRowBuilder,
  MessageFlags 
} from 'discord.js';
import { DiscordConstants } from '../config/DiscordConstants.js';
import { RecruitmentConfig } from '../config/RecruitmentConfig.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';

export class ModalHandler {
  constructor(recruitmentService, forumPostManager) {
    this.recruitmentService = recruitmentService;
    this.forumPostManager = forumPostManager;
  }
  
  /**
   * 구인구직 모달 생성 및 표시
   * @param {Interaction} interaction - 인터랙션 객체
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {Array} selectedRoles - 선택된 역할 태그 배열
   * @returns {Promise<void>}
   */
  async showRecruitmentModal(interaction, voiceChannelId, selectedRoles = []) {
    try {
      const modal = new ModalBuilder()
        .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_MODAL}${voiceChannelId}`)
        .setTitle('새 구인구직 포럼 생성');

      const titleInput = new TextInputBuilder()
        .setCustomId('recruitment_title')
        .setLabel('제목 (현재 인원/최대 인원) 필수')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('예: 칼바람 1/5 오후 8시')
        .setRequired(true)
        .setMaxLength(DiscordConstants.LIMITS.MODAL_TITLE_MAX);

      // 선택된 역할들은 이미 한글 value이므로 바로 사용
      let tagsValue = '';
      if (selectedRoles && selectedRoles.length > 0) {
        tagsValue = selectedRoles.join(', ');
      }

      const tagsInput = new TextInputBuilder()
        .setCustomId('recruitment_tags')
        .setLabel('역할 태그 (수정 가능)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('예: 롤, 배그, 옵치, 발로, 스팀')
        .setRequired(false)
        .setMaxLength(100)
        .setValue(tagsValue); // 선택된 태그들을 자동으로 입력

      const descriptionInput = new TextInputBuilder()
        .setCustomId('recruitment_description')
        .setLabel('상세 설명')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('게임 모드, 티어, 기타 요구사항 등을 자유롭게 작성해주세요.')
        .setRequired(false)
        .setMaxLength(DiscordConstants.LIMITS.MODAL_DESCRIPTION_MAX);

      const firstRow = new ActionRowBuilder().addComponents(titleInput);
      const secondRow = new ActionRowBuilder().addComponents(tagsInput);
      const thirdRow = new ActionRowBuilder().addComponents(descriptionInput);

      modal.addComponents(firstRow, secondRow, thirdRow);

      await SafeInteraction.safeShowModal(interaction, modal);
      
    } catch (error) {
      console.error('[ModalHandler] 모달 표시 오류:', error);
      await SafeInteraction.safeReply(interaction, 
        SafeInteraction.createErrorResponse('모달 표시', error)
      );
    }
  }
  
  /**
   * 독립 구인구직 모달 생성 및 표시
   * @param {Interaction} interaction - 인터랙션 객체
   * @param {Array} selectedRoles - 선택된 역할 태그 배열
   * @returns {Promise<void>}
   */
  async showStandaloneRecruitmentModal(interaction, selectedRoles = []) {
    try {
      const modal = new ModalBuilder()
        .setCustomId('standalone_recruitment_modal')
        .setTitle('구인구직 포럼 생성');

      const titleInput = new TextInputBuilder()
        .setCustomId('recruitment_title')
        .setLabel('제목 (현재 인원/최대 인원) 필수')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('예: 칼바람 1/5 오후 8시')
        .setRequired(true)
        .setMaxLength(DiscordConstants.LIMITS.MODAL_TITLE_MAX);

      let tagsValue = '';
      if (selectedRoles && selectedRoles.length > 0) {
        tagsValue = selectedRoles.join(', ');
      }

      const tagsInput = new TextInputBuilder()
        .setCustomId('recruitment_tags')
        .setLabel('역할 태그 (수정 가능)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('예: 롤, 배그, 옵치, 발로, 스팀')
        .setRequired(false)
        .setMaxLength(100)
        .setValue(tagsValue);

      const descriptionInput = new TextInputBuilder()
        .setCustomId('recruitment_description')
        .setLabel('상세 설명')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('게임 모드, 티어, 기타 요구사항 등을 자유롭게 작성해주세요.')
        .setRequired(false)
        .setMaxLength(DiscordConstants.LIMITS.MODAL_DESCRIPTION_MAX);

      const firstRow = new ActionRowBuilder().addComponents(titleInput);
      const secondRow = new ActionRowBuilder().addComponents(tagsInput);
      const thirdRow = new ActionRowBuilder().addComponents(descriptionInput);

      modal.addComponents(firstRow, secondRow, thirdRow);

      await SafeInteraction.safeShowModal(interaction, modal);
      
    } catch (error) {
      console.error('[ModalHandler] 독립 모달 표시 오류:', error);
      await SafeInteraction.safeReply(interaction, 
        SafeInteraction.createErrorResponse('모달 표시', error)
      );
    }
  }
  
  /**
   * 모달 제출 처리
   * @param {ModalSubmitInteraction} interaction - 모달 제출 인터랙션
   * @returns {Promise<void>}
   */
  async handleModalSubmit(interaction) {
    try {
      const customId = interaction.customId;
      
      // 입력 값 추출
      const recruitmentData = this.extractModalData(interaction);
      
      if (customId === 'standalone_recruitment_modal') {
        // 독립 구인구직 처리
        await this.handleStandaloneRecruitment(interaction, recruitmentData);
      } else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_MODAL)) {
        // 음성 채널 연동 구인구직 처리
        const voiceChannelId = customId.replace(DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_MODAL, '');
        await this.handleVoiceChannelRecruitment(interaction, recruitmentData, voiceChannelId);
      } else {
        console.warn(`[ModalHandler] 알 수 없는 모달 customId: ${customId}`);
      }
      
    } catch (error) {
      console.error('[ModalHandler] 모달 제출 처리 오류:', error);
      await SafeInteraction.safeReply(interaction, 
        SafeInteraction.createErrorResponse('모달 처리', error)
      );
    }
  }
  
  /**
   * 모달에서 데이터 추출
   * @param {ModalSubmitInteraction} interaction - 모달 제출 인터랙션
   * @returns {Object} - 추출된 데이터
   */
  extractModalData(interaction) {
    const title = interaction.fields.getTextInputValue('recruitment_title');
    const tags = interaction.fields.getTextInputValue('recruitment_tags') || '';
    const description = interaction.fields.getTextInputValue('recruitment_description') || '상세 설명이 제공되지 않았습니다.';
    
    return {
      title: title.trim(),
      tags: tags.trim(),
      description: description.trim(),
      author: interaction.member || interaction.user
    };
  }
  
  /**
   * 독립 구인구직 처리
   * @param {ModalSubmitInteraction} interaction - 모달 제출 인터랙션
   * @param {Object} recruitmentData - 구인구직 데이터
   * @returns {Promise<void>}
   */
  async handleStandaloneRecruitment(interaction, recruitmentData) {
    try {
      await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      
      // 독립 포럼 포스트 생성
      const postId = await this.forumPostManager.createForumPost(recruitmentData);
      
      if (postId) {
        await interaction.editReply({
          content: `✅ 구인구직 포럼이 성공적으로 생성되었습니다!\n🔗 포럼: <#${postId}>`
        });
        
        console.log(`[ModalHandler] 독립 구인구직 생성 완료: ${recruitmentData.title} (ID: ${postId})`);
      } else {
        await interaction.editReply({
          content: RecruitmentConfig.MESSAGES.LINK_FAILED
        });
      }
      
    } catch (error) {
      console.error('[ModalHandler] 독립 구인구직 처리 오류:', error);
      await SafeInteraction.safeReply(interaction, 
        SafeInteraction.createErrorResponse('독립 구인구직 생성', error)
      );
    }
  }
  
  /**
   * 음성 채널 연동 구인구직 처리
   * @param {ModalSubmitInteraction} interaction - 모달 제출 인터랙션
   * @param {Object} recruitmentData - 구인구직 데이터
   * @param {string} voiceChannelId - 음성 채널 ID
   * @returns {Promise<void>}
   */
  async handleVoiceChannelRecruitment(interaction, recruitmentData, voiceChannelId) {
    try {
      await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      
      // 음성 채널 연동 포럼 포스트 생성
      const result = await this.recruitmentService.createLinkedRecruitment(
        recruitmentData, 
        voiceChannelId, 
        interaction.user.id
      );
      
      if (result.success) {
        await interaction.editReply({
          content: `✅ 구인구직 포럼이 성공적으로 생성되고 음성 채널과 연동되었습니다!\n🔗 포럼: <#${result.postId}>`
        });
        
        console.log(`[ModalHandler] 음성 채널 연동 구인구직 생성 완료: ${recruitmentData.title} (ID: ${result.postId})`);
      } else {
        await interaction.editReply({
          content: result.message || RecruitmentConfig.MESSAGES.LINK_FAILED
        });
      }
      
    } catch (error) {
      console.error('[ModalHandler] 음성 채널 연동 구인구직 처리 오류:', error);
      await SafeInteraction.safeReply(interaction, 
        SafeInteraction.createErrorResponse('음성 채널 연동 구인구직 생성', error)
      );
    }
  }
  
  /**
   * 모달 입력 값 유효성 검증
   * @param {Object} recruitmentData - 구인구직 데이터
   * @returns {Object} - 검증 결과 { valid: boolean, errors: Array }
   */
  validateModalData(recruitmentData) {
    const errors = [];
    
    // 제목 검증
    if (!recruitmentData.title || recruitmentData.title.length < 3) {
      errors.push('제목은 최소 3글자 이상이어야 합니다.');
    }
    
    if (recruitmentData.title && recruitmentData.title.length > DiscordConstants.LIMITS.MODAL_TITLE_MAX) {
      errors.push(`제목은 최대 ${DiscordConstants.LIMITS.MODAL_TITLE_MAX}글자까지 가능합니다.`);
    }
    
    // 인원 수 패턴 검증
    if (recruitmentData.title && !recruitmentData.title.match(/\d+\/\d+/)) {
      errors.push('제목에 "현재인원/최대인원" 형식을 포함해주세요. (예: 1/5)');
    }
    
    // 설명 길이 검증
    if (recruitmentData.description && recruitmentData.description.length > DiscordConstants.LIMITS.MODAL_DESCRIPTION_MAX) {
      errors.push(`설명은 최대 ${DiscordConstants.LIMITS.MODAL_DESCRIPTION_MAX}글자까지 가능합니다.`);
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  /**
   * 유효성 검증 에러 메시지 생성
   * @param {Array} errors - 에러 목록
   * @returns {string} - 에러 메시지
   */
  createValidationErrorMessage(errors) {
    return `❌ 입력 값에 문제가 있습니다:\n\n${errors.map(error => `• ${error}`).join('\n')}`;
  }
}