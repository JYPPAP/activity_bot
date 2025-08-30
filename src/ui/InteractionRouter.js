// src/ui/InteractionRouter.js - 인터랙션 라우팅 관리
import { InteractionType, ComponentType, MessageFlags } from 'discord.js';
import { DiscordConstants } from '../config/DiscordConstants.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';

export class InteractionRouter {
  constructor(buttonHandler, modalHandler, recruitmentService) {
    this.buttonHandler = buttonHandler;
    this.modalHandler = modalHandler;
    this.recruitmentService = recruitmentService;
  }
  
  /**
   * 인터랙션 라우팅 메인 메서드
   * @param {Interaction} interaction - Discord 인터랙션
   * @returns {Promise<void>}
   */
  async routeInteraction(interaction) {
    try {
      // 인터랙션 타입에 따른 라우팅
      switch (interaction.type) {
        case InteractionType.MessageComponent:
          await this.routeComponentInteraction(interaction);
          break;
          
        case InteractionType.ModalSubmit:
          await this.modalHandler.handleModalSubmit(interaction);
          break;
          
        default:
          console.warn(`[InteractionRouter] 처리되지 않은 인터랙션 타입: ${interaction.type}`);
          break;
      }
      
    } catch (error) {
      console.error('[InteractionRouter] 인터랙션 라우팅 오류:', error);
      await SafeInteraction.safeReply(interaction, 
        SafeInteraction.createErrorResponse('인터랙션 처리', error)
      );
    }
  }
  
  /**
   * 컴포넌트 인터랙션 라우팅
   * @param {MessageComponentInteraction} interaction - 컴포넌트 인터랙션
   * @returns {Promise<void>}
   */
  async routeComponentInteraction(interaction) {
    switch (interaction.componentType) {
      case ComponentType.Button:
        await this.routeButtonInteraction(interaction);
        break;
        
      case ComponentType.StringSelect:
        await this.routeSelectMenuInteraction(interaction);
        break;
        
      default:
        console.warn(`[InteractionRouter] 처리되지 않은 컴포넌트 타입: ${interaction.componentType}`);
        break;
    }
  }
  
  /**
   * 버튼 인터랙션 라우팅
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Promise<void>}
   */
  async routeButtonInteraction(interaction) {
    const customId = interaction.customId;
    
    // 구인구직 연동 버튼
    if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_CONNECT)) {
      await this.recruitmentService.handleVoiceConnectButton(interaction);
    }
    // 방 만들기 버튼
    else if (customId.includes(DiscordConstants.CUSTOM_ID_PREFIXES.CREATE_ROOM)) {
      await this.buttonHandler.handleCreateRoomButton(interaction);
    }
    // 역할 태그 및 음성 채널 관련 버튼
    else {
      await this.buttonHandler.routeButtonInteraction(interaction);
    }
  }
  
  /**
   * 셀렉트 메뉴 인터랙션 라우팅
   * @param {StringSelectMenuInteraction} interaction - 셀렉트 메뉴 인터랙션
   * @returns {Promise<void>}
   */
  async routeSelectMenuInteraction(interaction) {
    const customId = interaction.customId;
    
    // 구인구직 방법 선택
    if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_METHOD)) {
      await this.recruitmentService.handleMethodSelection(interaction);
    }
    // 기존 포스트 선택
    else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.EXISTING_POST_SELECT)) {
      await this.recruitmentService.handleExistingPostSelection(interaction);
    }
    else {
      console.warn(`[InteractionRouter] 처리되지 않은 셀렉트 메뉴: ${customId}`);
    }
  }
  
  /**
   * 구인구직 관련 인터랙션인지 확인
   * @param {Interaction} interaction - Discord 인터랙션
   * @returns {boolean} - 구인구직 관련 여부
   */
  static isRecruitmentInteraction(interaction) {
    if (!interaction.customId) return false;
    
    const customId = interaction.customId;
    const recruitmentPrefixes = [
      DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_CONNECT,
      DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_SPECTATE,
      DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_RESET,
      DiscordConstants.CUSTOM_ID_PREFIXES.CREATE_ROOM,
      DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_MODAL,
      DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_METHOD,
      DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_BUTTON,
      DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_COMPLETE,
      DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_BUTTON,
      DiscordConstants.CUSTOM_ID_PREFIXES.EXISTING_POST_SELECT
    ];
    
    return recruitmentPrefixes.some(prefix => customId.startsWith(prefix) || customId.includes(prefix)) ||
           customId === DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE ||
           customId === 'standalone_recruitment_modal';
  }
  
  /**
   * 인터랙션 상태 로깅
   * @param {Interaction} interaction - Discord 인터랙션
   * @returns {void}
   */
  static logInteraction(interaction) {
    const user = interaction.user;
    const customId = interaction.customId || 'N/A';
    const type = interaction.type;
    const componentType = interaction.componentType || 'N/A';
    
    console.log(`[InteractionRouter] 인터랙션 수신: 사용자=${user.displayName} (${user.id}), 타입=${type}, 컴포넌트=${componentType}, customId=${customId}`);
  }
  
  /**
   * 권한이 있는 인터랙션인지 확인
   * @param {Interaction} interaction - Discord 인터랙션
   * @param {PermissionService} permissionService - 권한 서비스
   * @returns {Promise<boolean>} - 권한 여부
   */
  static async hasPermission(interaction, permissionService) {
    try {
      // 구인구직 관련 인터랙션이 아니면 허용
      if (!this.isRecruitmentInteraction(interaction)) {
        return true;
      }
      
      // 권한 체크
      return permissionService.hasRecruitmentPermission(interaction.user, interaction.member);
      
    } catch (error) {
      console.error('[InteractionRouter] 권한 확인 오류:', error);
      return false;
    }
  }
  
  /**
   * 인터랙션 전처리 (로깅, 권한 체크 등)
   * @param {Interaction} interaction - Discord 인터랙션
   * @param {PermissionService} permissionService - 권한 서비스
   * @returns {Promise<boolean>} - 처리 계속 여부
   */
  static async preprocessInteraction(interaction, permissionService) {
    // 인터랙션 로깅
    this.logInteraction(interaction);
    
    // 권한 체크
    const hasPermission = await this.hasPermission(interaction, permissionService);
    
    if (!hasPermission) {
      await SafeInteraction.safeReply(interaction, {
        content: '❌ 이 기능을 사용할 권한이 없습니다.',
        flags: MessageFlags.Ephemeral
      });
      return false;
    }
    
    return true;
  }
  
  /**
   * 에러 응답 생성
   * @param {string} context - 에러 컨텍스트
   * @param {Error} error - 에러 객체
   * @returns {Object} - Discord 응답 객체
   */
  static createErrorResponse(context, error) {
    return SafeInteraction.createErrorResponse(context, error);
  }
}