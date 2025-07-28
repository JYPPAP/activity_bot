// src/ui/ModalHandler.ts - 모달 처리 핸들러
import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
  RepliableInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  GuildMember,
  User,
} from 'discord.js';

import { DiscordConstants } from '../config/DiscordConstants.js';
import { RecruitmentConfig } from '../config/RecruitmentConfig.js';
import { ForumPostManager } from '../services/ForumPostManager.js';
import { RecruitmentService } from '../services/RecruitmentService.js';
import { DiscordAPIError } from '../types/discord.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';

// 구인구직 데이터 인터페이스
interface RecruitmentData {
  title: string;
  tags: string[]; // 배열로 변경하여 ForumPostManager와 타입 일치
  description: string;
  author: GuildMember | User;
  maxParticipants?: number;
  category?: string;
}

// 모달 검증 결과 인터페이스
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

// 모달 처리 결과 인터페이스
interface ModalHandleResult {
  success: boolean;
  action: 'standalone' | 'voiceChannel' | 'validation' | 'error';
  postId?: string;
  message?: string;
  error?: string;
  duration?: number;
  data?: any;
}

// 모달 통계 인터페이스
interface ModalStatistics {
  totalSubmissions: number;
  standaloneSubmissions: number;
  voiceChannelSubmissions: number;
  successfulSubmissions: number;
  failedSubmissions: number;
  validationErrors: number;
  averageResponseTime: number;
  lastSubmissionTime: Date;
  commonErrors: Record<string, number>;
}

// 입력 필드 구성 인터페이스
interface ModalFieldConfig {
  customId: string;
  label: string;
  placeholder: string;
  style: TextInputStyle;
  required: boolean;
  maxLength: number;
  minLength?: number;
  value?: string;
}

export class ModalHandler {
  private readonly recruitmentService: RecruitmentService;
  private readonly forumPostManager: ForumPostManager;

  // 재시도 설정
  private static readonly RETRY_CONFIG = {
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
  private modalStats: ModalStatistics = {
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

  private responseTimeSum: number = 0;
  private submissionHistory: Array<{
    timestamp: Date;
    type: 'standalone' | 'voiceChannel';
    userId: string;
    success: boolean;
    responseTime: number;
    error?: string;
  }> = [];

  constructor(recruitmentService: RecruitmentService, forumPostManager: ForumPostManager) {
    this.recruitmentService = recruitmentService;
    this.forumPostManager = forumPostManager;
  }

  /**
   * 재시도 메커니즘을 적용한 함수 실행
   * @param operation - 실행할 비동기 함수
   * @param context - 컨텍스트 (로그용)
   * @returns 실행 결과
   */
  private async withRetry<T>(operation: () => Promise<T>, context: string): Promise<T> {
    let lastError: any;
    let attempt = 0;

    while (attempt <= ModalHandler.RETRY_CONFIG.maxRetries) {
      try {
        if (attempt > 0) {
          // 재시도 간격 계산 (지수 백오프)
          const delay = Math.min(
            ModalHandler.RETRY_CONFIG.baseDelay *
              Math.pow(ModalHandler.RETRY_CONFIG.backoffMultiplier, attempt - 1),
            ModalHandler.RETRY_CONFIG.maxDelay
          );
          console.log(
            `[ModalHandler] ${context} 재시도 ${attempt}/${ModalHandler.RETRY_CONFIG.maxRetries} - ${delay}ms 대기`
          );
          await this.sleep(delay);
        }

        console.log(
          `[ModalHandler] ${context} 시도 ${attempt + 1}/${ModalHandler.RETRY_CONFIG.maxRetries + 1}`
        );
        const result = await operation();

        if (attempt > 0) {
          console.log(`[ModalHandler] ${context} 재시도 성공 (시도 횟수: ${attempt + 1})`);
        }

        return result;
      } catch (error: any) {
        lastError = error;
        attempt++;

        const shouldRetry = this.shouldRetryError(error, attempt);
        console.log(`[ModalHandler] ${context} 오류 발생:`, {
          error: error.message,
          code: error.code,
          status: error.status,
          attempt,
          maxRetries: ModalHandler.RETRY_CONFIG.maxRetries,
          shouldRetry,
        });

        if (!shouldRetry || attempt > ModalHandler.RETRY_CONFIG.maxRetries) {
          console.error(`[ModalHandler] ${context} 최종 실패 (시도 횟수: ${attempt})`, error);
          throw error;
        }
      }
    }

    throw lastError;
  }

  /**
   * 오류가 재시도 가능한지 판단
   * @param error - 발생한 오류
   * @param attempt - 현재 시도 횟수
   * @returns 재시도 가능 여부
   */
  private shouldRetryError(error: any, attempt: number): boolean {
    // 최대 재시도 횟수 초과
    if (attempt > ModalHandler.RETRY_CONFIG.maxRetries) {
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
    if (error.status && ModalHandler.RETRY_CONFIG.retryableCodes.includes(error.status)) {
      console.log(`[ModalHandler] HTTP 상태 ${error.status}는 재시도 가능`);
      return true;
    }

    // 오류 메시지 패턴 확인
    const errorMessage = (error.message || '').toLowerCase();
    const hasRetryablePattern = ModalHandler.RETRY_CONFIG.retryableErrors.some((pattern) =>
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
   * @param ms - 대기 시간 (밀리초)
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 구인구직 모달 생성 및 표시
   * @param interaction - 인터랙션 객체
   * @param voiceChannelId - 음성 채널 ID
   * @param selectedRoles - 선택된 게임 태그 배열
   */
  async showRecruitmentModal(
    interaction: RepliableInteraction,
    voiceChannelId: string,
    selectedRoles: string[] = []
  ): Promise<void> {
    try {
      const modal = new ModalBuilder()
        .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_MODAL}${voiceChannelId}`)
        .setTitle('새 구인구직 포럼 생성');

      const fields = this.createModalFields(selectedRoles);
      const actionRows = this.createActionRows(fields);

      modal.addComponents(...actionRows);

      await SafeInteraction.safeShowModal(interaction as ButtonInteraction, modal);
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
        } as DiscordAPIError)
      );
    }
  }

  /**
   * 독립 구인구직 모달 생성 및 표시
   * @param interaction - 인터랙션 객체
   * @param selectedRoles - 선택된 게임 태그 배열
   */
  async showStandaloneRecruitmentModal(
    interaction: RepliableInteraction,
    selectedRoles: string[] = []
  ): Promise<void> {
    try {
      const modal = new ModalBuilder()
        .setCustomId('standalone_recruitment_modal')
        .setTitle('구인구직 포럼 생성');

      const fields = this.createModalFields(selectedRoles);
      const actionRows = this.createActionRows(fields);

      modal.addComponents(...actionRows);

      await SafeInteraction.safeShowModal(interaction as ButtonInteraction, modal);
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
        } as DiscordAPIError)
      );
    }
  }

  /**
   * 모달 필드 구성 생성
   * @param selectedRoles - 선택된 게임 태그 배열
   * @returns 모달 필드 구성 배열
   */
  private createModalFields(selectedRoles: string[]): ModalFieldConfig[] {
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
   * @param fields - 모달 필드 구성 배열
   * @returns 액션 로우 배열
   */
  private createActionRows(fields: ModalFieldConfig[]): ActionRowBuilder<TextInputBuilder>[] {
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

      return new ActionRowBuilder<TextInputBuilder>().addComponents(textInput);
    });
  }

  /**
   * 모달 제출 처리
   * @param interaction - 모달 제출 인터랙션
   */
  async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<ModalHandleResult> {
    const startTime = Date.now();
    this.modalStats.totalSubmissions++;
    this.modalStats.lastSubmissionTime = new Date();

    try {
      const customId = interaction.customId;

      // 입력 값 추출 및 검증
      const recruitmentData = this.extractModalData(interaction);
      const validation = this.validateModalData(recruitmentData);

      if (!validation.valid) {
        this.modalStats.validationErrors++;
        this.recordValidationErrors(validation.errors);

        const errorMessage = this.createValidationErrorMessage(validation.errors);
        await SafeInteraction.safeReply(interaction, {
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });

        return this.recordSubmissionResult(interaction, 'validation', false, startTime, {
          errors: validation.errors,
        });
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
        } as DiscordAPIError)
      );

      return this.recordSubmissionResult(interaction, 'error', false, startTime, {
        error: errorMsg,
      });
    }
  }

  /**
   * 모달에서 데이터 추출
   * @param interaction - 모달 제출 인터랙션
   * @returns 추출된 데이터
   */
  private extractModalData(interaction: ModalSubmitInteraction): RecruitmentData {
    const title = interaction.fields.getTextInputValue('recruitment_title');
    const tags = interaction.fields.getTextInputValue('recruitment_tags') || '';
    const description = interaction.fields.getTextInputValue('recruitment_description') || '';

    // 태그 배열 생성
    const tagsArray = tags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

    // 최대 참여자 수 추출 시도
    const participantMatch = title.match(/(\d+)\/(\d+|[Nn])/);
    let maxParticipants: number | undefined;

    if (participantMatch) {
      const maxStr = participantMatch[2];
      if (maxStr.toLowerCase() !== 'n') {
        maxParticipants = parseInt(maxStr, 10);
      }
    }

    return {
      title: title.trim(),
      tags: tagsArray, // 배열로 변경하여 ForumPostManager와 타입 일치
      description: description.trim(),
      author: (interaction.member as GuildMember) || interaction.user,
      ...(maxParticipants !== undefined && { maxParticipants }),
    };
  }

  /**
   * 독립 구인구직 처리
   * @param interaction - 모달 제출 인터랙션
   * @param recruitmentData - 구인구직 데이터
   */
  private async handleStandaloneRecruitment(
    interaction: ModalSubmitInteraction,
    recruitmentData: RecruitmentData
  ): Promise<ModalHandleResult> {
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
        maxParticipants: (recruitmentData as any).maxParticipants,
        author: recruitmentData.author.displayName || (recruitmentData.author instanceof User ? recruitmentData.author.username : recruitmentData.author.user.username),
        guildId,
      });

      const createResult = await this.withRetry(
        () => this.forumPostManager.createForumPost(recruitmentData as any, undefined, guildId),
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
    } catch (error: any) {
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
   * @param interaction - 모달 제출 인터랙션
   * @param recruitmentData - 구인구직 데이터
   * @param voiceChannelId - 음성 채널 ID
   */
  private async handleVoiceChannelRecruitment(
    interaction: ModalSubmitInteraction,
    recruitmentData: RecruitmentData,
    voiceChannelId: string
  ): Promise<ModalHandleResult> {
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
        maxParticipants: (recruitmentData as any).maxParticipants,
        author: recruitmentData.author.displayName || (recruitmentData.author instanceof User ? recruitmentData.author.username : recruitmentData.author.user.username),
        voiceChannelId,
        guildId,
      });

      const result = await this.withRetry(
        () =>
          this.recruitmentService.createLinkedRecruitment(
            recruitmentData as any,
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
    } catch (error: any) {
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
   * @param recruitmentData - 구인구직 데이터
   * @returns 검증 결과
   */
  validateModalData(recruitmentData: RecruitmentData): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

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

    // 인원 수 패턴 검증
    if (recruitmentData.title && !recruitmentData.title.match(/\d+\/(\d+|[Nn])/)) {
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
   * @param errors - 에러 목록
   * @returns 에러 메시지
   */
  createValidationErrorMessage(errors: string[]): string {
    return `❌ 입력 값에 문제가 있습니다:\n\n${errors.map((error) => `• ${error}`).join('\n')}`;
  }

  /**
   * 모달 통계 조회
   * @returns 모달 통계
   */
  getModalStatistics(): ModalStatistics {
    return { ...this.modalStats };
  }

  /**
   * 제출 히스토리 조회
   * @param limit - 조회할 히스토리 수 제한
   * @returns 제출 히스토리
   */
  getSubmissionHistory(limit: number = 100): typeof this.submissionHistory {
    return this.submissionHistory
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * 사용자별 제출 통계 조회
   * @param userId - 사용자 ID
   * @returns 사용자별 통계
   */
  getUserSubmissionStats(userId: string): {
    totalSubmissions: number;
    successfulSubmissions: number;
    failedSubmissions: number;
    lastSubmission: Date | null;
    successRate: number;
  } {
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
  resetStatistics(): void {
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
   * @param interaction - 모달 제출 인터랙션
   * @param type - 제출 타입
   * @param success - 성공 여부
   * @param startTime - 시작 시간
   * @param data - 추가 데이터
   */
  private recordSubmissionResult(
    interaction: ModalSubmitInteraction,
    type: ModalHandleResult['action'],
    success: boolean,
    startTime: number,
    data?: any
  ): ModalHandleResult {
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
   * @param errors - 에러 목록
   */
  private recordValidationErrors(errors: string[]): void {
    errors.forEach((error) => {
      this.modalStats.commonErrors[error] = (this.modalStats.commonErrors[error] || 0) + 1;
    });
  }

  /**
   * 서비스 상태 체크
   * @returns 서비스 상태
   */
  healthCheck(): {
    isHealthy: boolean;
    totalSubmissions: number;
    successRate: number;
    validationErrorRate: number;
    averageResponseTime: number;
    lastActivity: Date;
    components: Record<string, boolean>;
  } {
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
