// src/utils/jobPostEmbedWithButtons.js - 구인구직 카드 임베드+버튼 생성 유틸리티
import { EmbedFactory } from './embedBuilder.js';
import { JobPostButtonFactory } from './jobPostButtons.js';

/**
 * 구인구직 카드의 임베드와 버튼을 함께 생성하는 유틸리티
 */
export class JobPostEmbedWithButtons {
  /**
   * 구인구직 카드 임베드와 버튼을 함께 생성합니다.
   * @param {Object} jobPost - 구인구직 카드 데이터
   * @param {Object} options - 옵션
   * @param {boolean} options.showButtons - 버튼 표시 여부
   * @param {VoiceChannel|null} options.voiceChannel - 음성채널 객체
   * @param {string|null} options.userId - 현재 사용자 ID (관리 버튼용)
   * @param {boolean} options.showManagementButtons - 관리 버튼 표시 여부
   * @returns {Object} - { embeds: [EmbedBuilder], components: [ActionRowBuilder] }
   */
  static createJobPostMessage(jobPost, options = {}) {
    const { 
      showButtons = true, 
      voiceChannel = null, 
      userId = null, 
      showManagementButtons = false 
    } = options;

    // 임베드 생성
    const { embed } = EmbedFactory.createJobPostEmbed(jobPost, { 
      showButtons, 
      voiceChannel 
    });

    const components = [];

    // 버튼 상태 결정
    const buttonState = JobPostButtonFactory.determineButtonState(jobPost, voiceChannel);

    // 메인 버튼들 (입장, 관전, 정보)
    if (buttonState.showButtons) {
      let actionRow = JobPostButtonFactory.createJobPostButtons(jobPost, { showButtons: true });
      
      if (actionRow) {
        // 버튼 비활성화 처리
        if (buttonState.disabled) {
          actionRow = JobPostButtonFactory.updateButtonStates(actionRow, {
            disabled: true,
            disableReason: buttonState.disableReason
          });
        }
        
        components.push(actionRow);
      }
    }

    // 관리 버튼들 (수정, 삭제, 연동해제) - 작성자용
    if (showManagementButtons && userId) {
      const managementRow = JobPostButtonFactory.createJobPostManagementButtons(jobPost, userId);
      if (managementRow) {
        components.push(managementRow);
      }
    }

    return {
      embeds: [embed],
      components
    };
  }

  /**
   * 구인구직 카드 메시지를 업데이트합니다.
   * @param {Message} message - 업데이트할 메시지
   * @param {Object} jobPost - 구인구직 카드 데이터
   * @param {Object} options - 옵션
   * @returns {Promise<Message>} - 업데이트된 메시지
   */
  static async updateJobPostMessage(message, jobPost, options = {}) {
    try {
      const messageData = this.createJobPostMessage(jobPost, options);
      return await message.edit(messageData);
    } catch (error) {
      console.error('[JobPostEmbedWithButtons] 메시지 업데이트 오류:', error);
      throw error;
    }
  }

  /**
   * 구인구직 카드 메시지를 전송합니다.
   * @param {TextChannel} channel - 전송할 채널
   * @param {Object} jobPost - 구인구직 카드 데이터
   * @param {Object} options - 옵션
   * @returns {Promise<Message>} - 전송된 메시지
   */
  static async sendJobPostMessage(channel, jobPost, options = {}) {
    try {
      const messageData = this.createJobPostMessage(jobPost, options);
      return await channel.send(messageData);
    } catch (error) {
      console.error('[JobPostEmbedWithButtons] 메시지 전송 오류:', error);
      throw error;
    }
  }

  /**
   * 음성채널 정보를 조회합니다.
   * @param {Client} client - Discord 클라이언트
   * @param {string} channelId - 음성채널 ID
   * @returns {VoiceChannel|null} - 음성채널 객체
   */
  static getVoiceChannel(client, channelId) {
    if (!channelId) return null;
    
    try {
      const channel = client.channels.cache.get(channelId);
      return (channel && channel.type === 2) ? channel : null; // ChannelType.GuildVoice = 2
    } catch (error) {
      console.warn('[JobPostEmbedWithButtons] 음성채널 조회 오류:', error);
      return null;
    }
  }

  /**
   * 구인구직 카드 미리보기를 생성합니다 (버튼 없음).
   * @param {Object} jobPost - 구인구직 카드 데이터
   * @returns {Object} - { embeds: [EmbedBuilder] }
   */
  static createJobPostPreview(jobPost) {
    const { embed } = EmbedFactory.createJobPostEmbed(jobPost, { showButtons: false });
    
    return {
      embeds: [embed]
    };
  }
}