// src/commands/CommandBase.js - 모든 명령어의 기본 기능 제공
import {MessageFlags} from 'discord.js';
import {SafeInteraction} from '../utils/SafeInteraction.js';
import { logger } from '../config/logger-termux.js';

export class CommandBase {
  /**
   * 명령어 기본 클래스 생성자
   * @param {object} services - 필요한 서비스 객체들
   */
  constructor(services = {}) {
    // 서비스 초기화
    this.activityTracker = services.activityTracker;
    this.dbManager = services.dbManager;
    this.calendarLogService = services.calendarLogService;
    this.client = services.client;
  }

  /**
   * 명령어 실행을 위한 기본 메서드 (자식 클래스에서 오버라이드 해야 함)
   * @param interaction - 상호작용 객체
   */
  async execute(interaction) {
    await interaction.deferReply({flags: MessageFlags.Ephemeral});

    try {
      // 자식 클래스에서 실제 실행을 구현해야 함
      await this.executeCommand(interaction);
    } catch (error) {
      logger.error('명령어 실행 오류', { component: this.constructor.name, error: error.message, stack: error.stack, interactionId: interaction.id });

      // 에러 응답
      await this.sendErrorResponse(interaction, error);
    }
  }

  /**
   * 실제 명령어 실행 로직 (자식 클래스에서 구현해야 함)
   * @param interaction - 상호작용 객체
   */
  async executeCommand(interaction) {
    throw new Error('자식 클래스에서 executeCommand 메서드를 구현해야 합니다.');
  }

  /**
   * 오류 응답 전송 (SafeInteraction 사용)
   * @param interaction - 상호작용 객체
   * @param {Error} error - 발생한 오류
   */
  async sendErrorResponse(interaction, error) {
    const errorMessage = '명령어 실행 중 오류가 발생했습니다.';

    await SafeInteraction.safeReply(interaction, {
      content: errorMessage,
      flags: MessageFlags.Ephemeral,
    });
  }

  /**
   * 안전한 응답 전송
   * @param interaction - 상호작용 객체
   * @param options - 응답 옵션
   */
  async safeReply(interaction, options) {
    return await SafeInteraction.safeReply(interaction, options);
  }

  /**
   * 안전한 지연 응답
   * @param interaction - 상호작용 객체
   * @param options - 지연 옵션
   */
  async safeDeferReply(interaction, options = {}) {
    return await SafeInteraction.safeDeferReply(interaction, options);
  }

  /**
   * 안전한 후속 응답
   * @param interaction - 상호작용 객체
   * @param options - 응답 옵션
   */
  async safeFollowUp(interaction, options) {
    // SafeInteraction.safeReply가 자동으로 상태를 확인해서 followUp 또는 다른 적절한 메서드를 선택함
    return await SafeInteraction.safeReply(interaction, options);
  }
}
