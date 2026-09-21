import { MessageFlags } from 'discord.js';
import { DiscordConstants } from '../config/DiscordConstants.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';
import { getValidationErrorMessage } from '../utils/inputValidator.js';
import { logger } from '../config/logger-termux.js';
import { ModalRetryPolicy } from './modals/ModalRetryPolicy.js';
import { ModalStatistics } from './modals/ModalStatistics.js';
import { RecruitmentModalBuilder } from './modals/RecruitmentModalBuilder.js';
import { RecruitmentModalData } from './modals/RecruitmentModalData.js';
import { RecruitmentSubmitFlows } from './modals/RecruitmentSubmitFlows.js';
export class ModalHandler {
  constructor(recruitmentService, forumPostManager) {
    this.recruitmentService = recruitmentService;
    this.forumPostManager = forumPostManager;
    const deps = { recruitmentService, forumPostManager, parent: this };
    this.retry = new ModalRetryPolicy(deps);
    this.stats = new ModalStatistics(deps);
    this.builder = new RecruitmentModalBuilder(deps);
    this.data = new RecruitmentModalData(deps);
    this.flows = new RecruitmentSubmitFlows(deps);
  }
  async showRecruitmentModal(...args) { return this.builder.showRecruitmentModal(...args); }
  async showStandaloneRecruitmentModal(...args) { return this.builder.showStandaloneRecruitmentModal(...args); }
  async handleModalSubmit(interaction) {
    const startTime = Date.now();
    this.stats.modalStats.totalSubmissions++;
    this.stats.modalStats.lastSubmissionTime = new Date();

    try {
      const customId = interaction.customId;

      // [내전] 모달 처리
      if (customId.startsWith('scrimmage_recruitment_modal')) {
        const selectedTags = this.builder.extractTagsFromCustomId(customId);
        await this.recruitmentService.handleSpecialRecruitmentModalSubmit(interaction, 'scrimmage', selectedTags);
        return;
      }

      // [장기] 모달 처리
      if (customId.startsWith('long_term_recruitment_modal')) {
        const selectedTags = this.builder.extractTagsFromCustomId(customId);
        await this.recruitmentService.handleSpecialRecruitmentModalSubmit(interaction, 'long_term', selectedTags);
        return;
      }

      // 입력 값 추출 및 검증 (새로운 검증 시스템 사용)
      const recruitmentData = this.data.extractModalData(interaction);
      
      // 새로운 검증 시스템 결과 확인
      if (!recruitmentData.validationResult.isValid) {
        this.stats.modalStats.validationErrors++;
        this.stats.recordValidationErrors(recruitmentData.validationResult.errors);

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

        return this.stats.recordSubmissionResult(interaction, 'validation', false, startTime, {
          errors: recruitmentData.validationResult.errors,
        });
      }

      // 기존 검증도 유지 (호환성을 위해)
      const rawTitle = interaction.fields.getTextInputValue('recruitment_title');
      const legacyValidation = this.data.validateModalData(recruitmentData, rawTitle);
      if (!legacyValidation.valid) {
        this.stats.modalStats.validationErrors++;
        this.stats.recordValidationErrors(legacyValidation.errors);

        const errorMessage = this.data.createValidationErrorMessage(legacyValidation.errors);
        await SafeInteraction.safeReply(interaction, {
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });

        return this.stats.recordSubmissionResult(interaction, 'validation', false, startTime, {
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
        logger.info(`[ModalHandler] 입력 정화 완료: ${warningMessage}`);
      }

      if (customId === 'standalone_recruitment_modal') {
        // 독립 구인구직 처리
        this.stats.modalStats.standaloneSubmissions++;
        const result = await this.flows.handleStandaloneRecruitment(interaction, recruitmentData);
        return this.stats.recordSubmissionResult(
          interaction,
          'standalone',
          result.success,
          startTime,
          result
        );
      } else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_MODAL)) {
        // 음성 채널 연동 구인구직 처리
        this.stats.modalStats.voiceChannelSubmissions++;
        const voiceChannelId = customId.replace(
          DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_MODAL,
          ''
        );
        const result = await this.flows.handleVoiceChannelRecruitment(
          interaction,
          recruitmentData,
          voiceChannelId
        );
        return this.stats.recordSubmissionResult(
          interaction,
          'voiceChannel',
          result.success,
          startTime,
          result
        );
      } else {
        logger.warn(`[ModalHandler] 알 수 없는 모달 customId: ${customId}`);
        throw new Error(`Unknown modal customId: ${customId}`);
      }
    } catch (error) {
      logger.error('[ModalHandler] 모달 제출 처리 오류', { error: error.message, stack: error.stack });
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

      return this.stats.recordSubmissionResult(interaction, 'error', false, startTime, {
        error: errorMsg,
      });
    }
  }
  withRetry(...args) { return this.retry.withRetry(...args); }
  shouldRetryError(...args) { return this.retry.shouldRetryError(...args); }
  sleep(...args) { return this.retry.sleep(...args); }
  extractTagsFromCustomId(...args) { return this.builder.extractTagsFromCustomId(...args); }
  extractModalData(...args) { return this.data.extractModalData(...args); }
  validateModalData(...args) { return this.data.validateModalData(...args); }
  createValidationErrorMessage(...args) { return this.data.createValidationErrorMessage(...args); }
  handleStandaloneRecruitment(...args) { return this.flows.handleStandaloneRecruitment(...args); }
  handleVoiceChannelRecruitment(...args) { return this.flows.handleVoiceChannelRecruitment(...args); }
  getModalStatistics(...args) { return this.stats.getModalStatistics(...args); }
  getSubmissionHistory(...args) { return this.stats.getSubmissionHistory(...args); }
  getUserSubmissionStats(...args) { return this.stats.getUserSubmissionStats(...args); }
  resetStatistics(...args) { return this.stats.resetStatistics(...args); }
  recordSubmissionResult(...args) { return this.stats.recordSubmissionResult(...args); }
  recordValidationErrors(...args) { return this.stats.recordValidationErrors(...args); }
  healthCheck(...args) { return this.stats.healthCheck(...args); }
  static createModalFields(...args) { return RecruitmentModalBuilder.createModalFields(...args); }
  static createActionRows(...args) { return RecruitmentModalBuilder.createActionRows(...args); }
}
