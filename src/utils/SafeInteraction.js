// src/utils/SafeInteraction.js - 안전한 Discord 인터랙션 래퍼
import { MessageFlags } from 'discord.js';

export class SafeInteraction {
  /**
   * 안전한 인터랙션 응답
   * @param {Interaction} interaction - Discord 인터랙션
   * @param {Object} options - 응답 옵션
   * @returns {Promise<void>}
   */
  static async safeReply(interaction, options) {
    try {
      if (!interaction) {
        console.warn('[SafeInteraction] 인터랙션이 null입니다.');
        return;
      }

      if (interaction.replied) {
        // 이미 응답한 경우 followUp 사용
        await interaction.followUp(options);
      } else if (interaction.deferred) {
        // 지연된 경우 editReply 사용
        await interaction.editReply(options);
      } else {
        // 첫 응답
        await interaction.reply(options);
      }
    } catch (error) {
      console.error('[SafeInteraction] 응답 중 오류:', error);
      
      // 마지막 시도: 에러 메시지 전송
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '❌ 처리 중 오류가 발생했습니다.',
            flags: MessageFlags.Ephemeral
          });
        }
      } catch (finalError) {
        console.error('[SafeInteraction] 최종 에러 응답 실패:', finalError);
      }
    }
  }
  
  /**
   * 안전한 인터랙션 업데이트
   * @param {Interaction} interaction - Discord 인터랙션
   * @param {Object} options - 업데이트 옵션
   * @returns {Promise<void>}
   */
  static async safeUpdate(interaction, options) {
    try {
      if (!interaction) {
        console.warn('[SafeInteraction] 인터랙션이 null입니다.');
        return;
      }

      await interaction.update(options);
    } catch (error) {
      console.error('[SafeInteraction] 업데이트 중 오류:', error);
      
      // 업데이트 실패 시 응답으로 대체
      await this.safeReply(interaction, {
        content: '❌ 업데이트 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
  
  /**
   * 안전한 모달 표시
   * @param {Interaction} interaction - Discord 인터랙션
   * @param {Modal} modal - 표시할 모달
   * @returns {Promise<void>}
   */
  static async safeShowModal(interaction, modal) {
    try {
      if (!interaction) {
        console.warn('[SafeInteraction] 인터랙션이 null입니다.');
        return;
      }

      await interaction.showModal(modal);
    } catch (error) {
      console.error('[SafeInteraction] 모달 표시 중 오류:', error);
      
      await this.safeReply(interaction, {
        content: '❌ 모달 표시 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral
      });
    }
  }
  
  /**
   * 안전한 지연 응답
   * @param {Interaction} interaction - Discord 인터랙션
   * @param {Object} options - 지연 옵션
   * @returns {Promise<void>}
   */
  static async safeDeferReply(interaction, options = {}) {
    try {
      if (!interaction) {
        console.warn('[SafeInteraction] 인터랙션이 null입니다.');
        return;
      }

      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply(options);
      }
    } catch (error) {
      console.error('[SafeInteraction] 지연 응답 중 오류:', error);
    }
  }
  
  /**
   * 안전한 지연 업데이트
   * @param {Interaction} interaction - Discord 인터랙션
   * @returns {Promise<void>}
   */
  static async safeDeferUpdate(interaction) {
    try {
      if (!interaction) {
        console.warn('[SafeInteraction] 인터랙션이 null입니다.');
        return;
      }

      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }
    } catch (error) {
      console.error('[SafeInteraction] 지연 업데이트 중 오류:', error);
    }
  }
  
  /**
   * 인터랙션 상태 확인
   * @param {Interaction} interaction - Discord 인터랙션
   * @returns {Object} - 상태 정보
   */
  static getInteractionState(interaction) {
    if (!interaction) {
      return { valid: false, replied: false, deferred: false };
    }
    
    return {
      valid: true,
      replied: interaction.replied,
      deferred: interaction.deferred,
      type: interaction.type,
      customId: interaction.customId || null
    };
  }
  
  /**
   * 에러 메시지 생성
   * @param {string} context - 에러 발생 컨텍스트
   * @param {Error} error - 에러 객체
   * @returns {Object} - 에러 응답 옵션
   */
  static createErrorResponse(context, error) {
    console.error(`[SafeInteraction] ${context} 오류:`, error);
    
    return {
      content: `❌ ${context} 중 오류가 발생했습니다. 다시 시도해주세요.`,
      flags: MessageFlags.Ephemeral
    };
  }
}