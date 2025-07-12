// src/utils/SafeInteraction.ts - 안전한 Discord 인터랙션 래퍼
import { 
  RepliableInteraction, 
  MessageFlags, 
  ModalBuilder, 
  InteractionType,
  CommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  InteractionResponse,
  Message,
  DiscordAPIError
} from 'discord.js';

// 인터랙션 검증 결과 인터페이스
interface InteractionValidationResult {
  valid: boolean;
  reason?: string;
  code?: string;
}

// 인터랙션 상태 인터페이스
interface InteractionState {
  valid: boolean;
  replied: boolean;
  deferred: boolean;
  type: InteractionType;
  customId: string | null;
  age: number;
  expired: boolean;
}

// 에러 응답 옵션 인터페이스
interface ErrorResponseOptions {
  content: string;
  flags?: MessageFlags;
  ephemeral?: boolean;
}

// 처리 통계 인터페이스
interface ProcessingStatistics {
  totalProcessed: number;
  successfulReplies: number;
  failedReplies: number;
  expiredInteractions: number;
  duplicateInteractions: number;
  modalShows: number;
  deferredReplies: number;
  updates: number;
  errorsByCode: Record<number, number>;
  lastProcessedTime: Date;
  averageResponseTime: number;
  responseTimeHistory: number[];
}

// 디버그 정보 인터페이스
interface DebugInfo {
  id: string;
  customId: string | null;
  type: InteractionType;
  replied: boolean;
  deferred: boolean;
  user: string | null;
  channel: string | null;
  guild: string | null;
  createdAt: string;
  age: number;
  expired: boolean;
}

// 응답 타입 정의
type SafeReplyOptions = {
  content?: string;
  embeds?: any[];
  components?: any[];
  flags?: MessageFlags;
  ephemeral?: boolean;
  files?: any[];
  allowedMentions?: any;
};

export class SafeInteraction {
  // ========== 처리 상태 관리 ==========
  private static processingInteractions = new Set<string>();
  private static processingStartTimes = new Map<string, number>();
  
  // ========== 통계 관리 ==========
  private static statistics: ProcessingStatistics = {
    totalProcessed: 0,
    successfulReplies: 0,
    failedReplies: 0,
    expiredInteractions: 0,
    duplicateInteractions: 0,
    modalShows: 0,
    deferredReplies: 0,
    updates: 0,
    errorsByCode: {},
    lastProcessedTime: new Date(),
    averageResponseTime: 0,
    responseTimeHistory: []
  };

  // ========== 설정 상수 ==========
  private static readonly CONFIG = {
    MAX_INTERACTION_AGE: 14 * 60 * 1000, // 14분
    PROCESSING_TIMEOUT: 30000, // 30초
    MAX_RESPONSE_TIME_HISTORY: 100,
    RETRY_DELAY: 1000, // 1초
    MAX_RETRIES: 3
  };

  // ========== 중복 처리 방지 ==========

  /**
   * 인터랙션 처리 시작
   * @param interaction - Discord 인터랙션
   * @returns 처리 가능 여부
   */
  static startProcessing(interaction: RepliableInteraction): boolean {
    if (!interaction?.id) {
      console.warn('[SafeInteraction] 인터랙션 ID가 없습니다.');
      return false;
    }
    
    if (this.processingInteractions.has(interaction.id)) {
      this.statistics.duplicateInteractions++;
      console.warn(`[SafeInteraction] 중복 처리 방지: ${interaction.id}`);
      return false;
    }
    
    this.processingInteractions.add(interaction.id);
    this.processingStartTimes.set(interaction.id, Date.now());
    
    // 자동 정리 설정
    setTimeout(() => {
      this.finishProcessing(interaction);
    }, this.CONFIG.PROCESSING_TIMEOUT);
    
    return true;
  }

  /**
   * 인터랙션 처리 완료
   * @param interaction - Discord 인터랙션
   */
  static finishProcessing(interaction: RepliableInteraction): void {
    if (!interaction?.id) return;

    const startTime = this.processingStartTimes.get(interaction.id);
    if (startTime) {
      const responseTime = Date.now() - startTime;
      this.updateResponseTimeStatistics(responseTime);
      this.processingStartTimes.delete(interaction.id);
    }

    this.processingInteractions.delete(interaction.id);
  }

  /**
   * 처리 중인 인터랙션 확인
   * @param interaction - Discord 인터랙션
   * @returns 처리 중 여부
   */
  static isProcessing(interaction: RepliableInteraction): boolean {
    return interaction?.id ? this.processingInteractions.has(interaction.id) : false;
  }

  // ========== 인터랙션 검증 ==========

  /**
   * 인터랙션 유효성 검사
   * @param interaction - Discord 인터랙션
   * @returns 검사 결과
   */
  static validateInteraction(interaction: RepliableInteraction): InteractionValidationResult {
    if (!interaction) {
      return { valid: false, reason: 'Interaction is null', code: 'NULL_INTERACTION' };
    }

    if (!interaction.id) {
      return { valid: false, reason: 'Missing interaction ID', code: 'MISSING_ID' };
    }

    // 인터랙션 생성 시간 확인
    const createdAt = interaction.createdTimestamp;
    const now = Date.now();
    const age = now - createdAt;

    if (age > this.CONFIG.MAX_INTERACTION_AGE) {
      this.statistics.expiredInteractions++;
      return { valid: false, reason: 'Interaction expired', code: 'EXPIRED' };
    }

    // 인터랙션 타입 확인
    if (!Object.values(InteractionType).includes(interaction.type)) {
      return { valid: false, reason: 'Invalid interaction type', code: 'INVALID_TYPE' };
    }

    return { valid: true };
  }

  /**
   * 인터랙션 상태 조회
   * @param interaction - Discord 인터랙션
   * @returns 상태 정보
   */
  static getInteractionState(interaction: Interaction): InteractionState {
    if (!interaction) {
      return {
        valid: false,
        replied: false,
        deferred: false,
        type: InteractionType.Ping,
        customId: null,
        age: 0,
        expired: true
      };
    }

    const age = Date.now() - interaction.createdTimestamp;
    const expired = age > this.CONFIG.MAX_INTERACTION_AGE;
    
    return {
      valid: true,
      replied: interaction.replied,
      deferred: interaction.deferred,
      type: interaction.type,
      customId: interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit() 
        ? interaction.customId : null,
      age,
      expired
    };
  }

  // ========== 안전한 응답 메서드 ==========

  /**
   * 안전한 인터랙션 응답
   * @param interaction - Discord 인터랙션
   * @param options - 응답 옵션
   * @returns 처리 결과
   */
  static async safeReply(
    interaction: RepliableInteraction, 
    options: SafeReplyOptions
  ): Promise<InteractionResponse | Message | null> {
    const startTime = Date.now();
    
    try {
      // 통계 업데이트
      this.statistics.totalProcessed++;
      this.statistics.lastProcessedTime = new Date();

      // 인터랙션 유효성 검사
      const validation = this.validateInteraction(interaction);
      if (!validation.valid) {
        console.warn(`[SafeInteraction] 유효하지 않은 인터랙션: ${validation.reason}`);
        return null;
      }

      // 옵션 정규화
      const normalizedOptions = this.normalizeReplyOptions(options);

      // 현재 상태 확인
      const state = this.getInteractionState(interaction);
      console.log(`[SafeInteraction] 인터랙션 상태: replied=${state.replied}, deferred=${state.deferred}`);

      let result: InteractionResponse | Message;

      if (interaction.replied) {
        // 이미 응답한 경우 followUp 사용
        result = await interaction.followUp(normalizedOptions);
      } else if (interaction.deferred) {
        // 지연된 경우 editReply 사용
        result = await interaction.editReply(normalizedOptions);
      } else {
        // 첫 응답
        result = await interaction.reply(normalizedOptions);
      }

      this.statistics.successfulReplies++;
      return result;

    } catch (error) {
      this.statistics.failedReplies++;
      this.handleInteractionError(error as DiscordAPIError, 'reply');
      
      // 에러 처리 및 복구 시도
      const recovery = await this.attemptErrorRecovery(interaction, error as DiscordAPIError, options);
      return recovery;

    } finally {
      // 응답 시간 통계 업데이트
      const responseTime = Date.now() - startTime;
      this.updateResponseTimeStatistics(responseTime);
    }
  }

  /**
   * 안전한 인터랙션 업데이트
   * @param interaction - Discord 인터랙션
   * @param options - 업데이트 옵션
   * @returns 처리 결과
   */
  static async safeUpdate(
    interaction: ButtonInteraction | StringSelectMenuInteraction, 
    options: SafeReplyOptions
  ): Promise<InteractionResponse | null> {
    try {
      // 인터랙션 유효성 검사
      const validation = this.validateInteraction(interaction);
      if (!validation.valid) {
        console.warn(`[SafeInteraction] 유효하지 않은 인터랙션: ${validation.reason}`);
        return null;
      }

      const normalizedOptions = this.normalizeReplyOptions(options);
      const result = await interaction.update(normalizedOptions);
      
      this.statistics.updates++;
      return result;

    } catch (error) {
      this.handleInteractionError(error as DiscordAPIError, 'update');
      
      // 업데이트 실패 시 응답으로 대체
      return await this.safeReply(interaction, {
        content: '❌ 업데이트 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  }

  /**
   * 안전한 모달 표시
   * @param interaction - Discord 인터랙션
   * @param modal - 표시할 모달
   * @returns 처리 결과
   */
  static async safeShowModal(
    interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction, 
    modal: ModalBuilder
  ): Promise<void> {
    try {
      if (!interaction) {
        console.warn('[SafeInteraction] 인터랙션이 null입니다.');
        return;
      }

      // 인터랙션 유효성 검사
      const validation = this.validateInteraction(interaction);
      if (!validation.valid) {
        console.warn(`[SafeInteraction] 유효하지 않은 인터랙션: ${validation.reason}`);
        return;
      }

      await interaction.showModal(modal);
      this.statistics.modalShows++;

    } catch (error) {
      this.handleInteractionError(error as DiscordAPIError, 'showModal');
      
      await this.safeReply(interaction, {
        content: '❌ 모달 표시 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  }

  /**
   * 안전한 지연 응답
   * @param interaction - Discord 인터랙션
   * @param options - 지연 옵션
   * @returns 처리 결과
   */
  static async safeDeferReply(
    interaction: RepliableInteraction, 
    options: { ephemeral?: boolean } = {}
  ): Promise<InteractionResponse | null> {
    try {
      // 인터랙션 유효성 검사
      const validation = this.validateInteraction(interaction);
      if (!validation.valid) {
        console.warn(`[SafeInteraction] 유효하지 않은 인터랙션: ${validation.reason}`);
        return null;
      }

      if (!interaction.deferred && !interaction.replied) {
        const result = await interaction.deferReply(options);
        this.statistics.deferredReplies++;
        return result;
      }

      return null;

    } catch (error) {
      this.handleInteractionError(error as DiscordAPIError, 'deferReply');
      return null;
    }
  }

  /**
   * 안전한 지연 업데이트
   * @param interaction - Discord 인터랙션
   * @returns 처리 결과
   */
  static async safeDeferUpdate(
    interaction: ButtonInteraction | StringSelectMenuInteraction
  ): Promise<InteractionResponse | null> {
    try {
      // 인터랙션 유효성 검사
      const validation = this.validateInteraction(interaction);
      if (!validation.valid) {
        console.warn(`[SafeInteraction] 유효하지 않은 인터랙션: ${validation.reason}`);
        return null;
      }

      if (!interaction.deferred && !interaction.replied) {
        return await interaction.deferUpdate();
      }

      return null;

    } catch (error) {
      this.handleInteractionError(error as DiscordAPIError, 'deferUpdate');
      return null;
    }
  }

  // ========== 에러 처리 ==========

  /**
   * 인터랙션 에러 처리
   * @param error - Discord API 에러
   * @param context - 에러 발생 컨텍스트
   */
  private static handleInteractionError(error: DiscordAPIError, context: string): void {
    const errorCode = error.code || 0;
    
    // 에러 코드별 통계 업데이트
    this.statistics.errorsByCode[errorCode] = (this.statistics.errorsByCode[errorCode] || 0) + 1;

    console.error(`[SafeInteraction] ${context} 오류:`, {
      message: error.message,
      code: error.code,
      status: error.status,
      method: error.method,
      url: error.url,
      requestBody: error.requestBody
    });

    // 특정 에러 코드별 추가 처리
    switch (errorCode) {
      case 10062:
        console.warn('[SafeInteraction] 만료된 인터랙션 - 재시도하지 않음');
        this.statistics.expiredInteractions++;
        break;
      case 10008:
        console.warn('[SafeInteraction] 원본 메시지가 삭제되었음');
        break;
      case 40060:
        console.warn('[SafeInteraction] 이미 처리된 인터랙션');
        break;
      case 50013:
        console.warn('[SafeInteraction] 권한 부족');
        break;
      case 50035:
        console.warn('[SafeInteraction] 잘못된 폼 데이터');
        break;
    }
  }

  /**
   * 에러 복구 시도
   * @param interaction - Discord 인터랙션
   * @param error - 발생한 에러
   * @param originalOptions - 원본 옵션
   * @returns 복구 시도 결과
   */
  private static async attemptErrorRecovery(
    interaction: Interaction,
    error: DiscordAPIError,
    originalOptions: SafeReplyOptions
  ): Promise<InteractionResponse | Message | null> {
    const errorCode = error.code || 0;

    // 복구 불가능한 에러들
    const unrecoverableErrors = [10062, 10008, 40060];
    if (unrecoverableErrors.includes(errorCode)) {
      return null;
    }

    try {
      // 마지막 시도: 간단한 에러 메시지
      const validation = this.validateInteraction(interaction);
      if (validation.valid && !interaction.replied && !interaction.deferred) {
        return await interaction.reply({
          content: this.getErrorMessage(errorCode),
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (finalError) {
      console.error('[SafeInteraction] 최종 에러 복구 실패:', finalError);
    }

    return null;
  }

  /**
   * 에러 코드별 메시지 생성
   * @param errorCode - Discord API 에러 코드
   * @returns 사용자 친화적 에러 메시지
   */
  private static getErrorMessage(errorCode: number): string {
    const errorMessages: Record<number, string> = {
      10062: '❌ 요청이 만료되었습니다. 다시 시도해주세요.',
      40060: '❌ 이미 처리된 요청입니다.',
      50013: '❌ 권한이 부족합니다.',
      50035: '❌ 잘못된 입력 데이터입니다.',
      0: '❌ 처리 중 오류가 발생했습니다.'
    };

    return errorMessages[errorCode] || errorMessages[0];
  }

  /**
   * 상세 에러 응답 생성
   * @param context - 에러 발생 컨텍스트
   * @param error - 에러 객체
   * @returns 에러 응답 옵션
   */
  static createErrorResponse(context: string, error: DiscordAPIError): ErrorResponseOptions {
    this.handleInteractionError(error, context);
    
    return {
      content: this.getErrorMessage(error.code || 0),
      flags: MessageFlags.Ephemeral,
      ephemeral: true
    };
  }

  // ========== 유틸리티 메서드 ==========

  /**
   * 응답 옵션 정규화
   * @param options - 원본 옵션
   * @returns 정규화된 옵션
   */
  private static normalizeReplyOptions(options: SafeReplyOptions): any {
    const normalized = { ...options };

    // ephemeral을 flags로 변환
    if (normalized.ephemeral && !normalized.flags) {
      normalized.flags = MessageFlags.Ephemeral;
    }

    // ephemeral 속성 제거 (Discord.js에서 직접 지원하지 않음)
    delete normalized.ephemeral;

    return normalized;
  }

  /**
   * 응답 시간 통계 업데이트
   * @param responseTime - 응답 시간 (ms)
   */
  private static updateResponseTimeStatistics(responseTime: number): void {
    this.statistics.responseTimeHistory.push(responseTime);

    // 히스토리 크기 제한
    if (this.statistics.responseTimeHistory.length > this.CONFIG.MAX_RESPONSE_TIME_HISTORY) {
      this.statistics.responseTimeHistory.shift();
    }

    // 평균 응답 시간 계산
    const sum = this.statistics.responseTimeHistory.reduce((a, b) => a + b, 0);
    this.statistics.averageResponseTime = sum / this.statistics.responseTimeHistory.length;
  }

  /**
   * 디버그 정보 생성
   * @param interaction - Discord 인터랙션
   * @returns 디버그 정보
   */
  static getDebugInfo(interaction: Interaction): DebugInfo | null {
    if (!interaction) return null;

    const state = this.getInteractionState(interaction);
    
    return {
      id: interaction.id,
      customId: state.customId,
      type: interaction.type,
      replied: interaction.replied,
      deferred: interaction.deferred,
      user: interaction.user?.username || null,
      channel: 'channel' in interaction ? interaction.channel?.id || null : null,
      guild: interaction.guild?.name || null,
      createdAt: new Date(interaction.createdTimestamp).toISOString(),
      age: state.age,
      expired: state.expired
    };
  }

  /**
   * 디버그 정보 로깅
   * @param interaction - Discord 인터랙션
   * @param context - 컨텍스트
   */
  static logDebugInfo(interaction: Interaction, context: string): void {
    const debugInfo = this.getDebugInfo(interaction);
    if (debugInfo) {
      console.log(`[SafeInteraction] ${context} 디버그:`, debugInfo);
    }
  }

  // ========== 통계 및 모니터링 ==========

  /**
   * 처리 통계 조회
   * @returns 처리 통계
   */
  static getStatistics(): ProcessingStatistics {
    return { ...this.statistics };
  }

  /**
   * 통계 초기화
   */
  static resetStatistics(): void {
    this.statistics = {
      totalProcessed: 0,
      successfulReplies: 0,
      failedReplies: 0,
      expiredInteractions: 0,
      duplicateInteractions: 0,
      modalShows: 0,
      deferredReplies: 0,
      updates: 0,
      errorsByCode: {},
      lastProcessedTime: new Date(),
      averageResponseTime: 0,
      responseTimeHistory: []
    };
  }

  /**
   * 성공률 계산
   * @returns 성공률 (0-1)
   */
  static getSuccessRate(): number {
    const total = this.statistics.successfulReplies + this.statistics.failedReplies;
    return total > 0 ? this.statistics.successfulReplies / total : 0;
  }

  /**
   * 현재 처리 중인 인터랙션 수
   * @returns 처리 중인 인터랙션 수
   */
  static getActiveProcessingCount(): number {
    return this.processingInteractions.size;
  }

  /**
   * 처리 상태 정리 (메모리 누수 방지)
   */
  static cleanup(): void {
    const now = Date.now();
    const expiredThreshold = now - this.CONFIG.PROCESSING_TIMEOUT;

    // 만료된 처리 상태 정리
    for (const [interactionId, startTime] of this.processingStartTimes.entries()) {
      if (startTime < expiredThreshold) {
        this.processingInteractions.delete(interactionId);
        this.processingStartTimes.delete(interactionId);
      }
    }
  }

  /**
   * 상태 요약 조회
   * @returns 상태 요약
   */
  static getStatusSummary(): {
    activeProcessing: number;
    totalProcessed: number;
    successRate: number;
    averageResponseTime: number;
    commonErrors: Array<{ code: number; count: number; }>;
  } {
    const commonErrors = Object.entries(this.statistics.errorsByCode)
      .map(([code, count]) => ({ code: parseInt(code), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      activeProcessing: this.getActiveProcessingCount(),
      totalProcessed: this.statistics.totalProcessed,
      successRate: this.getSuccessRate(),
      averageResponseTime: this.statistics.averageResponseTime,
      commonErrors
    };
  }
}

// 타입 내보내기
export type {
  InteractionValidationResult,
  InteractionState,
  ErrorResponseOptions,
  ProcessingStatistics,
  DebugInfo,
  SafeReplyOptions
};