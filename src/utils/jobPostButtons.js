// src/utils/jobPostButtons.js - 구인구직 카드 버튼 유틸리티
import { 
  ButtonBuilder, 
  ButtonStyle, 
  ActionRowBuilder 
} from 'discord.js';

/**
 * 구인구직 카드 버튼 생성 유틸리티
 */
export class JobPostButtonFactory {
  /**
   * 구인구직 카드용 버튼 ActionRow를 생성합니다.
   * @param {Object} jobPost - 구인구직 카드 데이터
   * @param {Object} options - 옵션
   * @param {boolean} options.showButtons - 버튼 표시 여부
   * @returns {ActionRowBuilder|null} - 버튼 ActionRow (channelId가 없으면 null)
   */
  static createJobPostButtons(jobPost, options = {}) {
    const { showButtons = true } = options;
    
    // channelId가 없으면 버튼을 표시하지 않음
    if (!jobPost.channelId || !showButtons) {
      return null;
    }

    // 입장 버튼
    const joinButton = new ButtonBuilder()
      .setCustomId(`jobpost_join_${jobPost.id}`)
      .setLabel('🎙️ 입장')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎙️');

    // 관전 버튼
    const spectateButton = new ButtonBuilder()
      .setCustomId(`jobpost_spectate_${jobPost.id}`)
      .setLabel('👁️ 관전')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('👁️');

    // 카드 정보 버튼 (선택적)
    const infoButton = new ButtonBuilder()
      .setCustomId(`jobpost_info_${jobPost.id}`)
      .setLabel('ℹ️ 정보')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('ℹ️');

    const actionRow = new ActionRowBuilder()
      .addComponents(joinButton, spectateButton, infoButton);

    return actionRow;
  }

  /**
   * 구인구직 카드 관리용 버튼을 생성합니다 (작성자용).
   * @param {Object} jobPost - 구인구직 카드 데이터
   * @param {string} userId - 현재 사용자 ID
   * @returns {ActionRowBuilder|null} - 관리 버튼 ActionRow
   */
  static createJobPostManagementButtons(jobPost, userId) {
    // 작성자가 아니면 관리 버튼을 표시하지 않음
    if (jobPost.authorId !== userId) {
      return null;
    }

    // 수정 버튼
    const editButton = new ButtonBuilder()
      .setCustomId(`jobpost_edit_${jobPost.id}`)
      .setLabel('✏️ 수정')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✏️');

    // 삭제 버튼
    const deleteButton = new ButtonBuilder()
      .setCustomId(`jobpost_delete_${jobPost.id}`)
      .setLabel('🗑️ 삭제')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️');

    // 연동 해제 버튼 (channelId가 있는 경우만)
    const buttons = [editButton, deleteButton];
    
    if (jobPost.channelId) {
      const unlinkButton = new ButtonBuilder()
        .setCustomId(`jobpost_unlink_${jobPost.id}`)
        .setLabel('🔗 연동해제')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔗');
      
      buttons.push(unlinkButton);
    }

    const actionRow = new ActionRowBuilder().addComponents(buttons);
    return actionRow;
  }

  /**
   * 버튼 customId를 파싱합니다.
   * @param {string} customId - 버튼 커스텀 ID
   * @returns {Object|null} - { action: string, jobId: string } 또는 null
   */
  static parseButtonCustomId(customId) {
    const parts = customId.split('_');
    
    if (parts.length >= 3 && parts[0] === 'jobpost') {
      return {
        action: parts[1], // join, spectate, info, edit, delete, unlink
        jobId: parts.slice(2).join('_') // 나머지 부분을 jobId로 사용
      };
    }
    
    return null;
  }

  /**
   * 버튼 상태를 업데이트합니다 (비활성화 등).
   * @param {ActionRowBuilder} actionRow - 기존 ActionRow
   * @param {Object} options - 업데이트 옵션
   * @param {boolean} options.disabled - 비활성화 여부
   * @param {string} options.disableReason - 비활성화 이유
   * @returns {ActionRowBuilder} - 업데이트된 ActionRow
   */
  static updateButtonStates(actionRow, options = {}) {
    const { disabled = false, disableReason = '' } = options;
    
    if (!actionRow || !actionRow.components) {
      return actionRow;
    }

    const updatedComponents = actionRow.components.map(component => {
      if (component instanceof ButtonBuilder) {
        const newButton = ButtonBuilder.from(component);
        
        if (disabled) {
          newButton.setDisabled(true);
          
          if (disableReason) {
            // 기존 라벨에 이유 추가 (Discord 라벨 길이 제한 고려)
            const currentLabel = component.data.label || '';
            const newLabel = `${currentLabel} (${disableReason})`;
            if (newLabel.length <= 80) { // Discord 버튼 라벨 제한
              newButton.setLabel(newLabel);
            }
          }
        }
        
        return newButton;
      }
      
      return component;
    });

    return new ActionRowBuilder().addComponents(updatedComponents);
  }

  /**
   * 음성채널 상태에 따른 버튼 상태를 결정합니다.
   * @param {Object} jobPost - 구인구직 카드 데이터
   * @param {VoiceChannel|null} voiceChannel - 음성채널 객체
   * @returns {Object} - { showButtons: boolean, disabled: boolean, disableReason: string }
   */
  static determineButtonState(jobPost, voiceChannel) {
    // channelId가 없으면 버튼을 표시하지 않음
    if (!jobPost.channelId) {
      return {
        showButtons: false,
        disabled: false,
        disableReason: ''
      };
    }

    // 음성채널이 존재하지 않으면 버튼 비활성화
    if (!voiceChannel) {
      return {
        showButtons: true,
        disabled: true,
        disableReason: '채널 없음'
      };
    }

    // 만료된 카드면 버튼 비활성화
    if (jobPost.expiresAt && jobPost.expiresAt <= Date.now()) {
      return {
        showButtons: true,
        disabled: true,
        disableReason: '만료됨'
      };
    }

    // 정상 상태
    return {
      showButtons: true,
      disabled: false,
      disableReason: ''
    };
  }

  /**
   * 성공 응답 메시지를 생성합니다.
   * @param {string} action - 수행된 액션
   * @param {Object} data - 결과 데이터
   * @returns {string} - 응답 메시지
   */
  static createSuccessMessage(action, data) {
    switch (action) {
      case 'join':
        return `🎙️ **${data.channelName}** 음성채널에 입장했습니다!`;
      
      case 'spectate':
        return `👁️ **${data.channelName}** 음성채널에 관전 모드로 입장했습니다!\n🔇 음소거가 자동으로 설정되었습니다.`;
      
      case 'info':
        return `ℹ️ **구인구직 카드 정보**\n` +
               `📌 제목: ${data.jobPost.title}\n` +
               `👥 모집인원: ${data.jobPost.memberCount}명\n` +
               `⏰ 시작시간: ${data.jobPost.startTime}\n` +
               `🎙️ 연동채널: <#${data.jobPost.channelId}>`;
      
      case 'edit':
        return `✏️ 구인구직 카드 수정 모달을 표시합니다.`;
      
      case 'delete':
        return `🗑️ 구인구직 카드 "${data.jobPost.title}"가 삭제되었습니다.`;
      
      case 'unlink':
        return `🔗 구인구직 카드 "${data.jobPost.title}"의 채널 연동이 해제되었습니다.`;
      
      default:
        return `✅ 작업이 완료되었습니다.`;
    }
  }

  /**
   * 에러 응답 메시지를 생성합니다.
   * @param {string} action - 시도된 액션
   * @param {string} error - 에러 메시지
   * @returns {string} - 에러 메시지
   */
  static createErrorMessage(action, error) {
    const actionNames = {
      join: '입장',
      spectate: '관전',
      info: '정보 조회',
      edit: '수정',
      delete: '삭제',
      unlink: '연동 해제'
    };

    const actionName = actionNames[action] || '작업';
    return `❌ **${actionName} 실패**: ${error}`;
  }
}