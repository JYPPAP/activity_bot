// src/utils/jobPostModal.js - 구인구직 모달 생성 유틸리티
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';

/**
 * 구인구직 관련 모달 생성 유틸리티
 */
export class JobPostModalFactory {
  /**
   * 구인구직 카드 생성 모달을 생성합니다.
   * @param {Object} options - 모달 옵션
   * @param {string} options.customId - 모달 커스텀 ID
   * @param {string} options.defaultTitle - 기본 제목 (선택)
   * @param {string} options.defaultChannelId - 기본 채널 ID (선택, 숨김)
   * @returns {ModalBuilder} - 생성된 모달
   */
  static createJobPostModal(options = {}) {
    const { 
      customId = 'jobpost_create_modal',
      defaultTitle = '',
      defaultChannelId = ''
    } = options;

    const modal = new ModalBuilder()
      .setCustomId(customId)
      .setTitle('🎯 구인구직 카드 생성');

    // 제목 입력 필드
    const titleInput = new TextInputBuilder()
      .setCustomId('jobpost_title')
      .setLabel('제목')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('예: 발로란트 경쟁전 같이할 분!')
      .setRequired(true)
      .setMaxLength(100);

    if (defaultTitle) {
      titleInput.setValue(defaultTitle);
    }

    // 인원수 입력 필드
    const memberCountInput = new TextInputBuilder()
      .setCustomId('jobpost_member_count')
      .setLabel('모집 인원 (숫자만)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('예: 4')
      .setRequired(true)
      .setMaxLength(2);

    // 시작시간 입력 필드
    const startTimeInput = new TextInputBuilder()
      .setCustomId('jobpost_start_time')
      .setLabel('시작 시간')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('예: 오후 8시, 지금 바로, 20:00')
      .setRequired(true)
      .setMaxLength(50);

    // 설명 입력 필드 (선택사항)
    const descriptionInput = new TextInputBuilder()
      .setCustomId('jobpost_description')
      .setLabel('상세 설명 (선택사항)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('예: 다이아 이상만, 디스코드 필수, 즐겜 위주')
      .setRequired(false)
      .setMaxLength(500);

    // 역할 태그 입력 필드 (선택사항)
    const roleTagsInput = new TextInputBuilder()
      .setCustomId('jobpost_role_tags')
      .setLabel('역할 태그 (선택사항)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('예: 탱커, 딜러, 서포터')
      .setRequired(false)
      .setMaxLength(100);

    // 채널 ID는 숨김 필드로 처리 (사용자에게 보이지 않음)
    // 필요시 modal의 customId에 채널 정보를 인코딩하여 전달

    // ActionRow에 TextInput 추가 (각각 별도의 ActionRow에 추가해야 함)
    const firstActionRow = new ActionRowBuilder().addComponents(titleInput);
    const secondActionRow = new ActionRowBuilder().addComponents(memberCountInput);
    const thirdActionRow = new ActionRowBuilder().addComponents(startTimeInput);
    const fourthActionRow = new ActionRowBuilder().addComponents(descriptionInput);
    const fifthActionRow = new ActionRowBuilder().addComponents(roleTagsInput);

    modal.addComponents(
      firstActionRow,
      secondActionRow,
      thirdActionRow,
      fourthActionRow,
      fifthActionRow
    );

    return modal;
  }

  /**
   * 구인구직 카드 수정 모달을 생성합니다.
   * @param {Object} jobPost - 기존 구인구직 카드 데이터
   * @param {string} customId - 모달 커스텀 ID
   * @returns {ModalBuilder} - 생성된 모달
   */
  static createJobPostEditModal(jobPost, customId = 'jobpost_edit_modal') {
    const modal = new ModalBuilder()
      .setCustomId(`${customId}_${jobPost.id}`)
      .setTitle('✏️ 구인구직 카드 수정');

    // 제목 입력 필드 (기존 값으로 채움)
    const titleInput = new TextInputBuilder()
      .setCustomId('jobpost_title')
      .setLabel('제목')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('예: 발로란트 경쟁전 같이할 분!')
      .setRequired(true)
      .setMaxLength(100)
      .setValue(jobPost.title);

    // 인원수 입력 필드 (기존 값으로 채움)
    const memberCountInput = new TextInputBuilder()
      .setCustomId('jobpost_member_count')
      .setLabel('모집 인원 (숫자만)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('예: 4')
      .setRequired(true)
      .setMaxLength(2)
      .setValue(jobPost.memberCount.toString());

    // 시작시간 입력 필드 (기존 값으로 채움)
    const startTimeInput = new TextInputBuilder()
      .setCustomId('jobpost_start_time')
      .setLabel('시작 시간')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('예: 오후 8시, 지금 바로, 20:00')
      .setRequired(true)
      .setMaxLength(50)
      .setValue(jobPost.startTime);

    // 설명 입력 필드 (기존 값으로 채움)
    const descriptionInput = new TextInputBuilder()
      .setCustomId('jobpost_description')
      .setLabel('상세 설명 (선택사항)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('예: 다이아 이상만, 디스코드 필수, 즐겜 위주')
      .setRequired(false)
      .setMaxLength(500);

    if (jobPost.description) {
      descriptionInput.setValue(jobPost.description);
    }

    // 역할 태그 입력 필드 (기존 값으로 채움)
    const roleTagsInput = new TextInputBuilder()
      .setCustomId('jobpost_role_tags')
      .setLabel('역할 태그 (선택사항)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('예: 탱커, 딜러, 서포터')
      .setRequired(false)
      .setMaxLength(100);

    if (jobPost.roleTags) {
      roleTagsInput.setValue(jobPost.roleTags);
    }

    // ActionRow에 TextInput 추가
    const firstActionRow = new ActionRowBuilder().addComponents(titleInput);
    const secondActionRow = new ActionRowBuilder().addComponents(memberCountInput);
    const thirdActionRow = new ActionRowBuilder().addComponents(startTimeInput);
    const fourthActionRow = new ActionRowBuilder().addComponents(descriptionInput);
    const fifthActionRow = new ActionRowBuilder().addComponents(roleTagsInput);

    modal.addComponents(
      firstActionRow,
      secondActionRow,
      thirdActionRow,
      fourthActionRow,
      fifthActionRow
    );

    return modal;
  }

  /**
   * 모달 제출 데이터를 검증합니다.
   * @param {Object} formData - 모달에서 제출된 데이터
   * @returns {Object} - 검증 결과 { isValid: boolean, errors: string[], data: Object }
   */
  static validateJobPostData(formData) {
    const errors = [];
    const data = {};

    // 제목 검증
    if (!formData.jobpost_title || formData.jobpost_title.trim().length === 0) {
      errors.push('제목은 필수 입력 항목입니다.');
    } else if (formData.jobpost_title.trim().length > 100) {
      errors.push('제목은 100자 이하로 입력해주세요.');
    } else {
      data.title = formData.jobpost_title.trim();
    }

    // 인원수 검증
    if (!formData.jobpost_member_count || formData.jobpost_member_count.trim().length === 0) {
      errors.push('모집 인원은 필수 입력 항목입니다.');
    } else {
      const memberCount = parseInt(formData.jobpost_member_count.trim());
      if (isNaN(memberCount) || memberCount < 1 || memberCount > 99) {
        errors.push('모집 인원은 1~99 사이의 숫자로 입력해주세요.');
      } else {
        data.memberCount = memberCount;
      }
    }

    // 시작시간 검증
    if (!formData.jobpost_start_time || formData.jobpost_start_time.trim().length === 0) {
      errors.push('시작 시간은 필수 입력 항목입니다.');
    } else if (formData.jobpost_start_time.trim().length > 50) {
      errors.push('시작 시간은 50자 이하로 입력해주세요.');
    } else {
      data.startTime = formData.jobpost_start_time.trim();
    }

    // 설명 검증 (선택사항)
    if (formData.jobpost_description && formData.jobpost_description.trim().length > 500) {
      errors.push('상세 설명은 500자 이하로 입력해주세요.');
    } else {
      data.description = formData.jobpost_description ? formData.jobpost_description.trim() : '';
    }

    // 역할 태그 검증 (선택사항)
    if (formData.jobpost_role_tags && formData.jobpost_role_tags.trim().length > 100) {
      errors.push('역할 태그는 100자 이하로 입력해주세요.');
    } else {
      data.roleTags = formData.jobpost_role_tags ? formData.jobpost_role_tags.trim() : '';
    }

    return {
      isValid: errors.length === 0,
      errors,
      data
    };
  }

  /**
   * 채널 정보를 포함한 커스텀 ID를 생성합니다.
   * @param {string} baseId - 기본 ID
   * @param {string} channelId - 채널 ID (선택)
   * @returns {string} - 인코딩된 커스텀 ID
   */
  static createCustomId(baseId, channelId = null) {
    if (channelId) {
      // 채널 ID를 base64로 인코딩하여 포함
      const encodedChannelId = Buffer.from(channelId).toString('base64');
      return `${baseId}_ch_${encodedChannelId}`;
    }
    return baseId;
  }

  /**
   * 커스텀 ID에서 채널 정보를 추출합니다.
   * @param {string} customId - 인코딩된 커스텀 ID
   * @returns {Object} - { baseId: string, channelId: string|null }
   */
  static parseCustomId(customId) {
    const parts = customId.split('_ch_');
    if (parts.length === 2) {
      try {
        const channelId = Buffer.from(parts[1], 'base64').toString();
        return {
          baseId: parts[0],
          channelId
        };
      } catch {
        // 디코딩 실패시 baseId만 반환
        return {
          baseId: customId,
          channelId: null
        };
      }
    }
    return {
      baseId: customId,
      channelId: null
    };
  }
}