// src/commands/CommandBase.js - 모든 명령어의 기본 기능 제공
import {MessageFlags} from 'discord.js';

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
      console.error(`${this.constructor.name} 명령어 실행 오류:`, error);

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
   * 오류 응답 전송
   * @param interaction - 상호작용 객체
   * @param {Error} error - 발생한 오류
   */
  async sendErrorResponse(interaction, error) {
    const errorMessage = '명령어 실행 중 오류가 발생했습니다.';

    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.followUp({
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (responseError) {
      console.error('오류 응답 전송 실패:', responseError);
    }
  }
}
