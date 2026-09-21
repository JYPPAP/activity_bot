import { logger } from '../../config/logger-termux.js';

/**
 * 모달 처리 중 일시적인 외부 오류에 대한 재시도 정책을 담당한다.
 *
 * 책임:
 * - 기존 지수 백오프 설정을 소유한다.
 * - Discord 및 HTTP 오류의 재시도 가능 여부를 판별한다.
 * - 각 시도의 기존 로그 문구를 유지한다.
 * - 실제 비즈니스 흐름은 parent에 남겨 둔다.
 *
 * 이 클래스의 인스턴스는 ModalHandler Facade가 생성하고 소유한다.
 */
export class ModalRetryPolicy {
  constructor({ parent }) {
    this.parent = parent;
    this.RETRY_CONFIG = {
      maxRetries: 3, baseDelay: 1000, maxDelay: 5000, backoffMultiplier: 2,
      retryableErrors: ['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'rate_limit', 'server_error', 'timeout', 'network_error'],
      retryableCodes: [500, 502, 503, 504, 429],
    };
  }
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
          logger.info(
            `[ModalHandler] ${context} 재시도 ${attempt}/${this.RETRY_CONFIG.maxRetries} - ${delay}ms 대기`
          );
          await this.sleep(delay);
        }

        logger.info(
          `[ModalHandler] ${context} 시도 ${attempt + 1}/${this.RETRY_CONFIG.maxRetries + 1}`
        );
        const result = await operation();

        if (attempt > 0) {
          logger.info(`[ModalHandler] ${context} 재시도 성공 (시도 횟수: ${attempt + 1})`);
        }

        return result;
      } catch (error) {
        lastError = error;
        attempt++;

        const shouldRetry = this.shouldRetryError(error, attempt);
        logger.info(`[ModalHandler] ${context} 오류 발생`, {
          error: error.message,
          code: error.code,
          status: error.status,
          attempt,
          maxRetries: this.RETRY_CONFIG.maxRetries,
          shouldRetry,
        });

        if (!shouldRetry || attempt > this.RETRY_CONFIG.maxRetries) {
          logger.error(`[ModalHandler] ${context} 최종 실패 (시도 횟수: ${attempt})`, { error: error.message, stack: error.stack });
          throw error;
        }
      }
    }

    throw lastError;
  }
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
        logger.info(`[ModalHandler] Discord 오류 코드 ${discordErrorCode}는 재시도 불가`);
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
        logger.info(`[ModalHandler] Discord 오류 코드 ${discordErrorCode}는 재시도 가능`);
        return true;
      }
    }

    // HTTP 상태 코드 확인
    if (error.status && this.RETRY_CONFIG.retryableCodes.includes(error.status)) {
      logger.info(`[ModalHandler] HTTP 상태 ${error.status}는 재시도 가능`);
      return true;
    }

    // 오류 메시지 패턴 확인
    const errorMessage = (error.message || '').toLowerCase();
    const hasRetryablePattern = this.RETRY_CONFIG.retryableErrors.some((pattern) =>
      errorMessage.includes(pattern.toLowerCase())
    );

    if (hasRetryablePattern) {
      logger.info(`[ModalHandler] 오류 메시지 패턴이 재시도 가능: ${error.message}`);
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
      logger.info(`[ModalHandler] 유효성 검사 오류는 재시도 안함: ${error.message}`);
      return false;
    }

    // 기본적으로 재시도 안함
    logger.info(`[ModalHandler] 알 수 없는 오류 - 재시도 안함: ${error.message}`);
    return false;
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
