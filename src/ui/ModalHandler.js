// src/ui/ModalHandler.js - 모달 처리 핸들러 (JavaScript 버전)
import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} from 'discord.js';

import { DiscordConstants } from '../config/DiscordConstants.js';
import { RecruitmentConfig } from '../config/RecruitmentConfig.js';
import { ForumPostManager } from '../services/ForumPostManager.js';
import { RecruitmentService } from '../services/RecruitmentService.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';
import { validateAndSanitizeInput, VALIDATION_PRESETS, getValidationErrorMessage } from '../utils/inputValidator.js';

export class ModalHandler {
  constructor(recruitmentService, forumPostManager) {
    this.recruitmentService = recruitmentService;
    this.forumPostManager = forumPostManager;

    // 재시도 설정
    this.RETRY_CONFIG = {
      maxRetries: 3,
      baseDelay: 1000, // 1초
      maxDelay: 5000, // 5초
      backoffMultiplier: 2,
      retryableErrors: [
        'ENOTFOUND',
        'ETIMEDOUT',
        'ECONNRESET',
        'ECONNREFUSED',
        'rate_limit',
        'server_error',
        'timeout',
        'network_error',
      ],
      retryableCodes: [500, 502, 503, 504, 429], // 서버 오류, 레이트 리미트
    };

    // 통계 및 모니터링
    this.modalStats = {
      totalSubmissions: 0,
      standaloneSubmissions: 0,
      voiceChannelSubmissions: 0,
      successfulSubmissions: 0,
      failedSubmissions: 0,
      validationErrors: 0,
      averageResponseTime: 0,
      lastSubmissionTime: new Date(),
      commonErrors: {},
    };

    this.responseTimeSum = 0;
    this.submissionHistory = [];
  }

  /**
   * 재시도 메커니즘을 적용한 함수 실행
   * @param {Function} operation - 실행할 비동기 함수
   * @param {string} context - 컨텍스트 (로그용)
   * @returns {Promise} 실행 결과
   */
  async withRetry(operation, context) {
    let lastError;
    let attempt = 0;

    while (attempt <= this.RETRY_CONFIG.maxRetries) {
      try {
        if (attempt > 0) {
          // 재시도 간격 계산 (지수 백오프)
          const delay = Math.min(
            this.RETRY_CONFIG.baseDelay *
              Math.pow(this.RETRY_CONFIG.backoffMultiplier, attempt - 1),
            this.RETRY_CONFIG.maxDelay
          );
          console.log(
            `[ModalHandler] ${context} 재시도 ${attempt}/${this.RETRY_CONFIG.maxRetries} - ${delay}ms 대기`
          );
          await this.sleep(delay);
        }

        console.log(
          `[ModalHandler] ${context} 시도 ${attempt + 1}/${this.RETRY_CONFIG.maxRetries + 1}`
        );
        const result = await operation();

        if (attempt > 0) {
          console.log(`[ModalHandler] ${context} 재시도 성공 (시도 횟수: ${attempt + 1})`);
        }

        return result;
      } catch (error) {
        lastError = error;
        attempt++;

        const shouldRetry = this.shouldRetryError(error, attempt);
        console.log(`[ModalHandler] ${context} 오류 발생:`, {
          error: error.message,
          code: error.code,
          status: error.status,
          attempt,
          maxRetries: this.RETRY_CONFIG.maxRetries,
          shouldRetry,
        });

        if (!shouldRetry || attempt > this.RETRY_CONFIG.maxRetries) {
          console.error(`[ModalHandler] ${context} 최종 실패 (시도 횟수: ${attempt})`, error);
          throw error;
        }
      }
    }

    throw lastError;
  }

  /**
   * 오류가 재시도 가능한지 판단
   * @param {Error} error - 발생한 오류
   * @param {number} attempt - 현재 시도 횟수
   * @returns {boolean} 재시도 가능 여부
   */
  shouldRetryError(error, attempt) {
    // 최대 재시도 횟수 초과
    if (attempt > this.RETRY_CONFIG.maxRetries) {
      return false;
    }

    // Discord API 특정 오류 코드들
    const discordErrorCode = error.code;
    if (discordErrorCode) {
      // 재시도 불가능한 Discord 오류들
      const nonRetryableDiscordCodes = [
        10003, // Unknown Channel
        10008, // Unknown Message
        10013, // Unknown User
        10062, // Unknown Interaction
        40060, // Interaction has already been acknowledged
        50013, // Missing Permissions
        50035, // Invalid Form Body
      ];

      if (nonRetryableDiscordCodes.includes(discordErrorCode)) {
        console.log(`[ModalHandler] Discord 오류 코드 ${discordErrorCode}는 재시도 불가`);
        return false;
      }

      // 재시도 가능한 Discord 오류들
      const retryableDiscordCodes = [
        0, // 일반적인 네트워크 오류
        429, // Rate Limited
        500, // Internal Server Error
        502, // Bad Gateway
        503, // Service Unavailable
        504, // Gateway Timeout
      ];

      if (retryableDiscordCodes.includes(discordErrorCode)) {
        console.log(`[ModalHandler] Discord 오류 코드 ${discordErrorCode}는 재시도 가능`);
        return true;
      }
    }

    // HTTP 상태 코드 확인
    if (error.status && this.RETRY_CONFIG.retryableCodes.includes(error.status)) {
      console.log(`[ModalHandler] HTTP 상태 ${error.status}는 재시도 가능`);
      return true;
    }

    // 오류 메시지 패턴 확인
    const errorMessage = (error.message || '').toLowerCase();
    const hasRetryablePattern = this.RETRY_CONFIG.retryableErrors.some((pattern) =>
      errorMessage.includes(pattern.toLowerCase())
    );

    if (hasRetryablePattern) {
      console.log(`[ModalHandler] 오류 메시지 패턴이 재시도 가능: ${error.message}`);
      return true;
    }

    // 유효성 검사 오류는 재시도하지 않음
    if (
      errorMessage.includes('validation') ||
      errorMessage.includes('invalid') ||
      errorMessage.includes('잘못된') ||
      errorMessage.includes('형식') ||
      errorMessage.includes('필수')
    ) {
      console.log(`[ModalHandler] 유효성 검사 오류는 재시도 안함: ${error.message}`);
      return false;
    }

    // 기본적으로 재시도 안함
    console.log(`[ModalHandler] 알 수 없는 오류 - 재시도 안함: ${error.message}`);
    return false;
  }

  /**
   * 지정된 시간만큼 대기
   * @param {number} ms - 대기 시간 (밀리초)
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 구인구직 모달 생성 및 표시
   * @param {import('discord.js').RepliableInteraction} interaction - 인터랙션 객체
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {string[]} selectedRoles - 선택된 게임 태그 배열
   */
  async showRecruitmentModal(interaction, voiceChannelId, selectedRoles = []) {
    try {
      const modal = new ModalBuilder()
        .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_MODAL}${voiceChannelId}`)
        .setTitle('새 구인구직 포럼 생성');

      const fields = this.createModalFields(selectedRoles);
      const actionRows = this.createActionRows(fields);

      modal.addComponents(...actionRows);

      await SafeInteraction.safeShowModal(interaction, modal);
    } catch (error) {
      console.error('[ModalHandler] 모달 표시 오류:', error);
      await SafeInteraction.safeReply(
        interaction,
        SafeInteraction.createErrorResponse('모달 표시', {
          code: 0,
          message: error instanceof Error ? error.message : '알 수 없는 오류',
          status: 500,
          method: 'MODAL_DISPLAY',
          url: 'internal',
          rawError: error,
          requestBody: {},
          name: 'DiscordAPIError',
        })
      );
    }
  }

  /**
   * 독립 구인구직 모달 생성 및 표시
   * @param {import('discord.js').RepliableInteraction} interaction - 인터랙션 객체
   * @param {string[]} selectedRoles - 선택된 게임 태그 배열
   */
  async showStandaloneRecruitmentModal(interaction, selectedRoles = []) {
    try {
      const modal = new ModalBuilder()
        .setCustomId('standalone_recruitment_modal')
        .setTitle('구인구직 포럼 생성');

      const fields = this.createModalFields(selectedRoles);
      const actionRows = this.createActionRows(fields);

      modal.addComponents(...actionRows);

      await SafeInteraction.safeShowModal(interaction, modal);
    } catch (error) {
      console.error('[ModalHandler] 독립 모달 표시 오류:', error);
      await SafeInteraction.safeReply(
        interaction,
        SafeInteraction.createErrorResponse('모달 표시', {
          code: 0,
          message: error instanceof Error ? error.message : '알 수 없는 오류',
          status: 500,
          method: 'MODAL_DISPLAY',
          url: 'internal',
          rawError: error,
          requestBody: {},
          name: 'DiscordAPIError',
        })
      );
    }
  }

  /**
   * 모달 필드 구성 생성
   * @param {string[]} selectedRoles - 선택된 게임 태그 배열
   * @returns {Array} 모달 필드 구성 배열
   */
  createModalFields(selectedRoles) {
    const tagsValue = selectedRoles.length > 0 ? selectedRoles.join(', ') : '';

    return [
      {
        customId: 'recruitment_title',
        label: '제목 (현재 인원/최대 인원) 필수',
        placeholder: '예: 칼바람 1/5 오후 8시',
        style: TextInputStyle.Short,
        required: true,
        maxLength: DiscordConstants.LIMITS.MODAL_TITLE_MAX,
        minLength: 3,
      },
      {
        customId: 'recruitment_tags',
        label: '게임 태그 (수정 가능)',
        placeholder: '예: 롤, 배그, 옵치, 발로, 스팀',
        style: TextInputStyle.Short,
        required: false,
        maxLength: 100,
        value: tagsValue,
      },
      {
        customId: 'recruitment_description',
        label: '상세 설명',
        placeholder: '게임 모드, 티어, 기타 요구사항 등을 자유롭게 작성해주세요.',
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: DiscordConstants.LIMITS.MODAL_DESCRIPTION_MAX,
        minLength: 0,
      },
    ];
  }

  /**
   * 액션 로우 생성
   * @param {Array} fields - 모달 필드 구성 배열
   * @returns {ActionRowBuilder[]} 액션 로우 배열
   */
  createActionRows(fields) {
    return fields.map((field) => {
      const textInput = new TextInputBuilder()
        .setCustomId(field.customId)
        .setLabel(field.label)
        .setStyle(field.style)
        .setPlaceholder(field.placeholder)
        .setRequired(field.required)
        .setMaxLength(field.maxLength);

      if (field.minLength !== undefined) {
        textInput.setMinLength(field.minLength);
      }

      if (field.value) {
        textInput.setValue(field.value);
      }

      return new ActionRowBuilder().addComponents(textInput);
    });
  }

  /**
   * 모달 제출 처리
   * @param {import('discord.js').ModalSubmitInteraction} interaction - 모달 제출 인터랙션
   */
  async handleModalSubmit(interaction) {
    const startTime = Date.now();
    this.modalStats.totalSubmissions++;
    this.modalStats.lastSubmissionTime = new Date();

    try {
      const customId = interaction.customId;

      // 입력 값 추출 및 검증 (새로운 검증 시스템 사용)
      const recruitmentData = this.extractModalData(interaction);
      
      // 새로운 검증 시스템 결과 확인
      if (!recruitmentData.validationResult.isValid) {
        this.modalStats.validationErrors++;
        this.recordValidationErrors(recruitmentData.validationResult.errors);

        // 새로운 검증 시스템의 에러 메시지 사용
        const errorMessage = getValidationErrorMessage(
          recruitmentData.validationResult.errors,
          recruitmentData.validationResult.warnings,
          '구인구직 입력'
        );
        
        await SafeInteraction.safeReply(interaction, {
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });

        return this.recordSubmissionResult(interaction, 'validation', false, startTime, {
          errors: recruitmentData.validationResult.errors,
        });
      }

      // 기존 검증도 유지 (호환성을 위해)
      const rawTitle = interaction.fields.getTextInputValue('recruitment_title');
      const legacyValidation = this.validateModalData(recruitmentData, rawTitle);
      if (!legacyValidation.valid) {
        this.modalStats.validationErrors++;
        this.recordValidationErrors(legacyValidation.errors);

        const errorMessage = this.createValidationErrorMessage(legacyValidation.errors);
        await SafeInteraction.safeReply(interaction, {
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });

        return this.recordSubmissionResult(interaction, 'validation', false, startTime, {
          errors: legacyValidation.errors,
        });
      }

      // 입력이 정화되었다면 사용자에게 알림
      if (recruitmentData.validationResult.hasSanitization) {
        const warningMessage = getValidationErrorMessage(
          [],
          recruitmentData.validationResult.warnings,
          '구인구직 입력'
        );
        
        // 경고 메시지는 로그로만 출력 (사용자에게는 너무 방해가 될 수 있음)
        console.log(`[ModalHandler] 입력 정화 완료: ${warningMessage}`);
      }

      if (customId === 'standalone_recruitment_modal') {
        // 독립 구인구직 처리
        this.modalStats.standaloneSubmissions++;
        const result = await this.handleStandaloneRecruitment(interaction, recruitmentData);
        return this.recordSubmissionResult(
          interaction,
          'standalone',
          result.success,
          startTime,
          result
        );
      } else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_MODAL)) {
        // 음성 채널 연동 구인구직 처리
        this.modalStats.voiceChannelSubmissions++;
        const voiceChannelId = customId.replace(
          DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_MODAL,
          ''
        );
        const result = await this.handleVoiceChannelRecruitment(
          interaction,
          recruitmentData,
          voiceChannelId
        );
        return this.recordSubmissionResult(
          interaction,
          'voiceChannel',
          result.success,
          startTime,
          result
        );
      } else {
        console.warn(`[ModalHandler] 알 수 없는 모달 customId: ${customId}`);
        throw new Error(`Unknown modal customId: ${customId}`);
      }
    } catch (error) {
      console.error('[ModalHandler] 모달 제출 처리 오류:', error);
      const errorMsg = error instanceof Error ? error.message : '알 수 없는 오류';

      await SafeInteraction.safeReply(
        interaction,
        SafeInteraction.createErrorResponse('모달 처리', {
          code: 0,
          message: error instanceof Error ? error.message : '알 수 없는 오류',
          status: 500,
          method: 'MODAL_SUBMIT',
          url: 'internal',
          rawError: error,
          requestBody: {},
          name: 'DiscordAPIError',
        })
      );

      return this.recordSubmissionResult(interaction, 'error', false, startTime, {
        error: errorMsg,
      });
    }
  }

  /**
   * 모달에서 데이터 추출 (입력 검증 및 정화 포함)
   * @param {import('discord.js').ModalSubmitInteraction} interaction - 모달 제출 인터랙션
   * @returns {Object} 추출된 데이터 (validationResult 포함)
   */
  extractModalData(interaction) {
    // 원본 입력값 추출
    const rawTitle = interaction.fields.getTextInputValue('recruitment_title');
    const rawTags = interaction.fields.getTextInputValue('recruitment_tags') || '';
    const rawDescription = interaction.fields.getTextInputValue('recruitment_description') || '';

    // 디버깅: 추출된 원본 값들 확인
    console.log(`[ModalHandler] 원본 입력값 추출:`);
    console.log(`  - 제목: type=${typeof rawTitle}, value="${rawTitle}", length=${rawTitle?.length || 0}`);
    console.log(`  - 태그: type=${typeof rawTags}, value="${rawTags}", length=${rawTags?.length || 0}`);
    console.log(`  - 설명: type=${typeof rawDescription}, value="${rawDescription}", length=${rawDescription?.length || 0}`);

    // 입력 검증 및 정화
    const titleValidation = validateAndSanitizeInput(rawTitle, VALIDATION_PRESETS.TITLE);
    const tagsValidation = validateAndSanitizeInput(rawTags, {
      maxLength: 100,
      minLength: 0,
      allowUrls: false,
      strictMode: true,
      fieldName: '게임 태그'
    });
    const descriptionValidation = validateAndSanitizeInput(rawDescription, VALIDATION_PRESETS.CONTENT);

    // 정화된 데이터 사용
    const title = titleValidation.sanitizedText;
    const tags = tagsValidation.sanitizedText;
    const description = descriptionValidation.sanitizedText;

    // 태그 배열 생성 (정화된 데이터 사용)
    const tagsArray = tags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

    // 최대 참여자 수 추출 시도 (원본 텍스트 사용)
    const participantMatch = rawTitle.match(/(\d+)\/(\d+|[Nn])/);
    let maxParticipants;

    if (participantMatch) {
      const maxStr = participantMatch[2];
      if (maxStr.toLowerCase() !== 'n') {
        maxParticipants = parseInt(maxStr, 10);
      }
    }

    // 검증 결과 통합
    const validationResult = {
      isValid: titleValidation.isValid && tagsValidation.isValid && descriptionValidation.isValid,
      errors: [
        ...titleValidation.errors,
        ...tagsValidation.errors,
        ...descriptionValidation.errors
      ],
      warnings: [
        ...titleValidation.warnings,
        ...tagsValidation.warnings,
        ...descriptionValidation.warnings
      ],
      hasSanitization: titleValidation.warnings.length > 0 || 
                      tagsValidation.warnings.length > 0 || 
                      descriptionValidation.warnings.length > 0
    };

    return {
      title: title.trim(),
      tags: tagsArray, // 배열로 변경하여 ForumPostManager와 타입 일치
      description: description.trim(),
      author: interaction.member || interaction.user,
      validationResult, // 검증 결과 추가
      ...(maxParticipants !== undefined && { maxParticipants }),
    };
  }

  /**
   * 독립 구인구직 처리
   * @param {import('discord.js').ModalSubmitInteraction} interaction - 모달 제출 인터랙션
   * @param {Object} recruitmentData - 구인구직 데이터
   */
  async handleStandaloneRecruitment(interaction, recruitmentData) {
    try {
      console.log(`[ModalHandler] 독립 구인구직 시작 - 제목: "${recruitmentData.title}"`);
      await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      
      // 상호작용 컨텍스트에서 길드 ID 추출
      const guildId = interaction.guild?.id;
      console.log(`[ModalHandler] 상호작용에서 길드 ID 추출: ${guildId || 'none'}`);

      // 독립 포럼 포스트 생성 (재시도 메커니즘 적용)
      console.log(`[ModalHandler] ForumPostManager.createForumPost 호출 중...`);
      console.log(`[ModalHandler] 구인구직 데이터:`, {
        title: recruitmentData.title,
        description: recruitmentData.description,
        tags: recruitmentData.tags.join(', '), // 배열을 문자열로 변환하여 로그 표시
        maxParticipants: recruitmentData.maxParticipants,
        author: recruitmentData.author.displayName || (recruitmentData.author.username || recruitmentData.author.user?.username),
        guildId,
      });

      const createResult = await this.withRetry(
        () => this.forumPostManager.createForumPost(recruitmentData, undefined),
        '독립 포럼 포스트 생성'
      );

      console.log(`[ModalHandler] ForumPostManager.createForumPost 결과:`, {
        success: createResult.success,
        postId: createResult.postId,
        error: createResult.error,
        warnings: createResult.warnings,
      });

      if (createResult.success && createResult.postId) {
        await SafeInteraction.safeReply(interaction, {
          content: `✅ 구인구직 포럼이 성공적으로 생성되었습니다!\n🔗 포럼: <#${createResult.postId}>`,
          flags: MessageFlags.Ephemeral,
        });

        console.log(
          `[ModalHandler] 독립 구인구직 생성 완료: ${recruitmentData.title} (ID: ${createResult.postId})`
        );

        return {
          success: true,
          action: 'standalone',
          postId: createResult.postId,
          message: '독립 구인구직 생성 성공',
        };
      } else {
        console.error(`[ModalHandler] 포럼 포스트 생성 실패:`, {
          error: createResult.error,
          warnings: createResult.warnings,
          title: recruitmentData.title,
        });

        // 상세 오류 정보가 있으면 활용
        let errorMessage = createResult.error
          ? `❌ 구인구직 생성 실패: ${createResult.error}`
          : RecruitmentConfig.MESSAGES.LINK_FAILED;

        // 유효성 검사 오류인 경우 더 자세한 정보 제공
        if (createResult.error?.includes('participantPattern') || createResult.error?.includes('제목 형식')) {
          errorMessage +=
            `\n\n💡 **제목 형식 안내:**\n` +
            `• 올바른 형식: "게임명 1/5" 또는 "게임명 1/N"\n` +
            `• 현재인원/최대인원 형식이 포함되어야 합니다.`;
        } else if (createResult.error?.includes('forumChannelId') || createResult.error?.includes('포럼 채널')) {
          // 포럼 채널 설정 관련 오류
          errorMessage +=
            `\n\n⚙️ **설정 확인 필요:**\n` +
            `• 관리자가 포럼 채널을 설정하지 않았습니다.\n` +
            `• \`/설정\` → **관리 채널 지정** → **구인구직 포럼** 설정 필요\n` +
            `• 설정 후 다시 시도해주세요.`;
        }

        await SafeInteraction.safeReply(interaction, {
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });

        return {
          success: false,
          action: 'standalone',
          error: createResult.error || '포럼 포스트 생성 실패',
        };
      }
    } catch (error) {
      console.error('[ModalHandler] 독립 구인구직 처리 오류:', error);

      // 10008 에러는 메시지가 삭제되었음을 의미하므로 추가 응답을 시도하지 않음
      if (error.code === 10008) {
        console.warn('[ModalHandler] 원본 메시지가 삭제되었음 - 추가 응답을 시도하지 않음');
        return {
          success: false,
          action: 'standalone',
          error: '원본 메시지가 삭제됨',
        };
      }

      await SafeInteraction.safeReply(
        interaction,
        SafeInteraction.createErrorResponse('독립 구인구직 생성', error)
      );

      return {
        success: false,
        action: 'standalone',
        error: error instanceof Error ? error.message : '알 수 없는 오류',
      };
    }
  }

  /**
   * 음성 채널 연동 구인구직 처리
   * @param {import('discord.js').ModalSubmitInteraction} interaction - 모달 제출 인터랙션
   * @param {Object} recruitmentData - 구인구직 데이터
   * @param {string} voiceChannelId - 음성 채널 ID
   */
  async handleVoiceChannelRecruitment(interaction, recruitmentData, voiceChannelId) {
    try {
      console.log(
        `[ModalHandler] 음성 채널 연동 구인구직 시작 - 제목: "${recruitmentData.title}", 음성 채널: ${voiceChannelId}`
      );
      await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

      // 상호작용 컨텍스트에서 길드 ID 추출
      const guildId = interaction.guild?.id;
      console.log(`[ModalHandler] 상호작용에서 길드 ID 추출: ${guildId || 'none'}`);

      // 음성 채널 연동 포럼 포스트 생성 (재시도 메커니즘 적용)
      console.log(`[ModalHandler] RecruitmentService.createLinkedRecruitment 호출 중...`);
      console.log(`[ModalHandler] 구인구직 데이터:`, {
        title: recruitmentData.title,
        description: recruitmentData.description,
        tags: recruitmentData.tags.join(', '), // 배열을 문자열로 변환하여 로그 표시
        maxParticipants: recruitmentData.maxParticipants,
        author: recruitmentData.author.displayName || (recruitmentData.author.username || recruitmentData.author.user?.username),
        voiceChannelId,
        guildId,
      });

      const result = await this.withRetry(
        () =>
          this.recruitmentService.createLinkedRecruitment(
            recruitmentData,
            voiceChannelId,
            interaction.user.id,
            guildId
          ),
        '음성 채널 연동 포럼 포스트 생성'
      );

      console.log(`[ModalHandler] RecruitmentService.createLinkedRecruitment 결과:`, {
        success: result.success,
        postId: result.postId,
        message: result.message,
        error: result.error,
        data: result.data,
      });

      if (result.success && result.postId) {
        await SafeInteraction.safeReply(interaction, {
          content: `✅ 구인구직 포럼이 성공적으로 생성되고 음성 채널과 연동되었습니다!\n🔗 포럼: <#${result.postId}>`,
          flags: MessageFlags.Ephemeral,
        });

        console.log(
          `[ModalHandler] 음성 채널 연동 구인구직 생성 완료: ${recruitmentData.title} (ID: ${result.postId})`
        );

        return {
          success: true,
          action: 'voiceChannel',
          postId: result.postId,
          message: '음성 채널 연동 구인구직 생성 성공',
          data: result.data,
        };
      } else {
        console.error(`[ModalHandler] 음성 채널 연동 구인구직 생성 실패:`, {
          message: result.message,
          error: result.error,
          title: recruitmentData.title,
          voiceChannelId,
        });

        // 상세 오류 정보 활용
        let errorMessage = result.message || RecruitmentConfig.MESSAGES.LINK_FAILED;

        // 유효성 검사 오류인 경우 더 자세한 정보 제공
        if (result.error?.includes('participantPattern') || result.error?.includes('제목 형식')) {
          errorMessage +=
            `\n\n💡 **제목 형식 안내:**\n` +
            `• 올바른 형식: "게임명 1/5" 또는 "게임명 1/N"\n` +
            `• 현재인원/최대인원 형식이 포함되어야 합니다.`;
        } else if (result.error?.includes('forumChannelId') || result.error?.includes('포럼 채널')) {
          // 포럼 채널 설정 관련 오류
          errorMessage +=
            `\n\n⚙️ **설정 확인 필요:**\n` +
            `• 관리자가 포럼 채널을 설정하지 않았습니다.\n` +
            `• \`/설정\` → **관리 채널 지정** → **구인구직 포럼** 설정 필요\n` +
            `• 설정 후 다시 시도해주세요.`;
        }

        await SafeInteraction.safeReply(interaction, {
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });

        return {
          success: false,
          action: 'voiceChannel',
          error: result.error || '음성 채널 연동 실패',
        };
      }
    } catch (error) {
      console.error('[ModalHandler] 음성 채널 연동 구인구직 처리 오류:', error);

      // 10008 에러는 메시지가 삭제되었음을 의미하므로 추가 응답을 시도하지 않음
      if (error.code === 10008) {
        console.warn('[ModalHandler] 원본 메시지가 삭제되었음 - 추가 응답을 시도하지 않음');
        return {
          success: false,
          action: 'voiceChannel',
          error: '원본 메시지가 삭제됨',
        };
      }

      await SafeInteraction.safeReply(
        interaction,
        SafeInteraction.createErrorResponse('음성 채널 연동 구인구직 생성', error)
      );

      return {
        success: false,
        action: 'voiceChannel',
        error: error instanceof Error ? error.message : '알 수 없는 오류',
      };
    }
  }

  /**
   * 모달 입력 값 유효성 검증
   * @param {Object} recruitmentData - 구인구직 데이터
   * @param {string} rawTitle - 원본 제목 (이스케이프 처리 전)
   * @returns {Object} 검증 결과
   */
  validateModalData(recruitmentData, rawTitle) {
    const errors = [];
    const warnings = [];

    // 제목 검증
    if (!recruitmentData.title || recruitmentData.title.length < 3) {
      errors.push('제목은 최소 3글자 이상이어야 합니다.');
    }

    if (
      recruitmentData.title &&
      recruitmentData.title.length > DiscordConstants.LIMITS.MODAL_TITLE_MAX
    ) {
      errors.push(`제목은 최대 ${DiscordConstants.LIMITS.MODAL_TITLE_MAX}글자까지 가능합니다.`);
    }

    // 인원 수 패턴 검증 (원본 텍스트 사용)
    if (rawTitle && !rawTitle.match(/\d+\/(\d+|[Nn])/)) {
      errors.push('제목에 "현재인원/최대인원" 형식을 포함해주세요. (예: 1/5)');
    }

    // 설명 길이 검증
    if (
      recruitmentData.description &&
      recruitmentData.description.length > DiscordConstants.LIMITS.MODAL_DESCRIPTION_MAX
    ) {
      errors.push(
        `설명은 최대 ${DiscordConstants.LIMITS.MODAL_DESCRIPTION_MAX}글자까지 가능합니다.`
      );
    }

    // 태그 검증
    if (recruitmentData.tags && recruitmentData.tags.length > RecruitmentConfig.MAX_SELECTED_TAGS) {
      errors.push(
        `게임 태그는 최대 ${RecruitmentConfig.MAX_SELECTED_TAGS}개까지 선택할 수 있습니다.`
      );
    }

    // 경고 생성
    if (recruitmentData.title && recruitmentData.title.length < 10) {
      warnings.push('제목이 너무 짧을 수 있습니다. 더 구체적인 제목을 권장합니다.');
    }

    if (!recruitmentData.description || recruitmentData.description.length < 10) {
      warnings.push('상세 설명을 추가하면 더 많은 사람들이 관심을 가질 수 있습니다.');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 유효성 검증 에러 메시지 생성
   * @param {string[]} errors - 에러 목록
   * @returns {string} 에러 메시지
   */
  createValidationErrorMessage(errors) {
    return `❌ 입력 값에 문제가 있습니다:\n\n${errors.map((error) => `• ${error}`).join('\n')}`;
  }

  /**
   * 모달 통계 조회
   * @returns {Object} 모달 통계
   */
  getModalStatistics() {
    return { ...this.modalStats };
  }

  /**
   * 제출 히스토리 조회
   * @param {number} limit - 조회할 히스토리 수 제한
   * @returns {Array} 제출 히스토리
   */
  getSubmissionHistory(limit = 100) {
    return this.submissionHistory
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * 사용자별 제출 통계 조회
   * @param {string} userId - 사용자 ID
   * @returns {Object} 사용자별 통계
   */
  getUserSubmissionStats(userId) {
    const userSubmissions = this.submissionHistory.filter((entry) => entry.userId === userId);
    const successfulSubmissions = userSubmissions.filter((entry) => entry.success);

    return {
      totalSubmissions: userSubmissions.length,
      successfulSubmissions: successfulSubmissions.length,
      failedSubmissions: userSubmissions.length - successfulSubmissions.length,
      lastSubmission: userSubmissions.length > 0 ? userSubmissions[0].timestamp : null,
      successRate:
        userSubmissions.length > 0
          ? (successfulSubmissions.length / userSubmissions.length) * 100
          : 0,
    };
  }

  /**
   * 통계 초기화
   */
  resetStatistics() {
    this.modalStats = {
      totalSubmissions: 0,
      standaloneSubmissions: 0,
      voiceChannelSubmissions: 0,
      successfulSubmissions: 0,
      failedSubmissions: 0,
      validationErrors: 0,
      averageResponseTime: 0,
      lastSubmissionTime: new Date(),
      commonErrors: {},
    };

    this.responseTimeSum = 0;
    this.submissionHistory = [];
  }

  /**
   * 제출 결과 기록
   * @param {import('discord.js').ModalSubmitInteraction} interaction - 모달 제출 인터랙션
   * @param {string} type - 제출 타입
   * @param {boolean} success - 성공 여부
   * @param {number} startTime - 시작 시간
   * @param {any} data - 추가 데이터
   */
  recordSubmissionResult(interaction, type, success, startTime, data) {
    const responseTime = Date.now() - startTime;

    // 통계 업데이트
    if (success) {
      this.modalStats.successfulSubmissions++;
    } else {
      this.modalStats.failedSubmissions++;
    }

    this.responseTimeSum += responseTime;
    this.modalStats.averageResponseTime = this.responseTimeSum / this.modalStats.totalSubmissions;

    // 히스토리 기록
    this.submissionHistory.push({
      timestamp: new Date(),
      type: type === 'standalone' ? 'standalone' : 'voiceChannel',
      userId: interaction.user.id,
      success,
      responseTime,
      error: data?.error,
    });

    // 히스토리 크기 제한
    if (this.submissionHistory.length > 1000) {
      this.submissionHistory = this.submissionHistory.slice(-1000);
    }

    return {
      success,
      action: type,
      duration: responseTime,
      ...data,
    };
  }

  /**
   * 검증 에러 기록
   * @param {string[]} errors - 에러 목록
   */
  recordValidationErrors(errors) {
    errors.forEach((error) => {
      this.modalStats.commonErrors[error] = (this.modalStats.commonErrors[error] || 0) + 1;
    });
  }

  /**
   * 서비스 상태 체크
   * @returns {Object} 서비스 상태
   */
  healthCheck() {
    const successRate =
      this.modalStats.totalSubmissions > 0
        ? (this.modalStats.successfulSubmissions / this.modalStats.totalSubmissions) * 100
        : 100;

    const validationErrorRate =
      this.modalStats.totalSubmissions > 0
        ? (this.modalStats.validationErrors / this.modalStats.totalSubmissions) * 100
        : 0;

    return {
      isHealthy: successRate >= 90 && validationErrorRate <= 20,
      totalSubmissions: this.modalStats.totalSubmissions,
      successRate,
      validationErrorRate,
      averageResponseTime: this.modalStats.averageResponseTime,
      lastActivity: this.modalStats.lastSubmissionTime,
      components: {
        recruitmentService: !!this.recruitmentService,
        forumPostManager: !!this.forumPostManager,
      },
    };
  }
}