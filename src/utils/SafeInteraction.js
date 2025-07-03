// src/utils/SafeInteraction.js - 안전한 Discord 인터랙션 래퍼
import { MessageFlags } from 'discord.js';

export class SafeInteraction {
  // 처리 중인 인터랙션 추적
  static processingInteractions = new Set();

  /**
   * 중복 처리 방지
   * @param {Interaction} interaction - Discord 인터랙션
   * @returns {boolean} - 처리 가능 여부
   */
  static startProcessing(interaction) {
    if (!interaction?.id) return false;
    
    if (this.processingInteractions.has(interaction.id)) {
      console.warn(`[SafeInteraction] 중복 처리 방지: ${interaction.id}`);
      return false;
    }
    
    this.processingInteractions.add(interaction.id);
    
    // 30초 후 자동 정리
    setTimeout(() => {
      this.processingInteractions.delete(interaction.id);
    }, 30000);
    
    return true;
  }

  /**
   * 처리 완료 표시
   * @param {Interaction} interaction - Discord 인터랙션
   */
  static finishProcessing(interaction) {
    if (interaction?.id) {
      this.processingInteractions.delete(interaction.id);
    }
  }
  /**
   * 인터랙션 유효성 검사
   * @param {Interaction} interaction - Discord 인터랙션
   * @returns {Object} - 검사 결과
   */
  static validateInteraction(interaction) {
    if (!interaction) {
      return { valid: false, reason: 'Interaction is null' };
    }

    // 인터랙션 생성 시간 확인 (14분 제한)
    const createdAt = interaction.createdTimestamp;
    const now = Date.now();
    const age = now - createdAt;
    const maxAge = 14 * 60 * 1000; // 14분

    if (age > maxAge) {
      return { valid: false, reason: 'Interaction expired' };
    }

    // 인터랙션 ID 확인
    if (!interaction.id) {
      return { valid: false, reason: 'Missing interaction ID' };
    }

    return { valid: true };
  }

  /**
   * 안전한 인터랙션 응답
   * @param {Interaction} interaction - Discord 인터랙션
   * @param {Object} options - 응답 옵션
   * @returns {Promise<void>}
   */
  static async safeReply(interaction, options) {
    try {
      // 인터랙션 유효성 검사
      const validation = this.validateInteraction(interaction);
      if (!validation.valid) {
        console.warn(`[SafeInteraction] 유효하지 않은 인터랙션: ${validation.reason}`);
        return;
      }

      // 현재 상태 확인
      const state = this.getInteractionState(interaction);
      console.log(`[SafeInteraction] 인터랙션 상태: replied=${state.replied}, deferred=${state.deferred}`);

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
      
      // 10062 에러 (Unknown interaction)는 재시도하지 않음
      if (error.code === 10062) {
        console.warn('[SafeInteraction] 만료된 인터랙션 - 재시도하지 않음');
        return;
      }
      
      // 마지막 시도: 에러 메시지 전송
      try {
        const validation = this.validateInteraction(interaction);
        if (validation.valid && !interaction.replied && !interaction.deferred) {
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
      // 인터랙션 유효성 검사
      const validation = this.validateInteraction(interaction);
      if (!validation.valid) {
        console.warn(`[SafeInteraction] 유효하지 않은 인터랙션: ${validation.reason}`);
        return;
      }

      await interaction.update(options);
    } catch (error) {
      console.error('[SafeInteraction] 업데이트 중 오류:', error);
      
      // 10062 에러는 재시도하지 않음
      if (error.code === 10062) {
        console.warn('[SafeInteraction] 만료된 인터랙션 - 업데이트 재시도하지 않음');
        return;
      }
      
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
      // 인터랙션 유효성 검사
      const validation = this.validateInteraction(interaction);
      if (!validation.valid) {
        console.warn(`[SafeInteraction] 유효하지 않은 인터랙션: ${validation.reason}`);
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
      // 인터랙션 유효성 검사
      const validation = this.validateInteraction(interaction);
      if (!validation.valid) {
        console.warn(`[SafeInteraction] 유효하지 않은 인터랙션: ${validation.reason}`);
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
    // 상세 에러 로깅
    console.error(`[SafeInteraction] ${context} 오류:`, {
      message: error.message,
      code: error.code,
      status: error.status,
      method: error.method,
      url: error.url,
      stack: error.stack
    });
    
    // 에러 타입별 메시지
    let message = `❌ ${context} 중 오류가 발생했습니다.`;
    
    if (error.code === 10062) {
      message = '❌ 요청이 만료되었습니다. 다시 시도해주세요.';
    } else if (error.code === 40060) {
      message = '❌ 이미 처리된 요청입니다.';
    } else if (error.code === 50013) {
      message = '❌ 권한이 부족합니다.';
    }
    
    return {
      content: message,
      flags: MessageFlags.Ephemeral
    };
  }

  /**
   * 디버그 정보 출력
   * @param {Interaction} interaction - Discord 인터랙션
   * @param {string} context - 컨텍스트
   */
  static logDebugInfo(interaction, context) {
    if (!interaction) return;
    
    console.log(`[SafeInteraction] ${context} 디버그:`, {
      id: interaction.id,
      customId: interaction.customId,
      type: interaction.type,
      replied: interaction.replied,
      deferred: interaction.deferred,
      user: interaction.user?.username,
      channel: interaction.channel?.name,
      guild: interaction.guild?.name,
      createdAt: new Date(interaction.createdTimestamp).toISOString(),
      age: Date.now() - interaction.createdTimestamp
    });
  }
}