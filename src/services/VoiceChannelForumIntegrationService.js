// src/services/VoiceChannelForumIntegrationService.js - 음성채널-포럼 통합 서비스 (리팩토링된 버전)
import { VoiceChannelManager } from './VoiceChannelManager.js';
import { ForumPostManager } from './ForumPostManager.js';
import { ParticipantTracker } from './ParticipantTracker.js';
import { MappingService } from './MappingService.js';
import { RecruitmentService } from './RecruitmentService.js';
import { PermissionService } from './PermissionService.js';
import { RecruitmentUIBuilder } from '../ui/RecruitmentUIBuilder.js';
import { InteractionRouter } from '../ui/InteractionRouter.js';
import { ModalHandler } from '../ui/ModalHandler.js';
import { ButtonHandler } from '../ui/ButtonHandler.js';
import { config } from '../config/env.js';

export class VoiceChannelForumIntegrationService {
  constructor(client, forumChannelId, voiceCategoryId) {
    this.client = client;
    this.forumChannelId = forumChannelId;
    this.voiceCategoryId = voiceCategoryId;
    
    // Core Services 초기화
    this.voiceChannelManager = new VoiceChannelManager(client, voiceCategoryId);
    this.forumPostManager = new ForumPostManager(client, forumChannelId, config.FORUM_TAG_ID);
    this.participantTracker = new ParticipantTracker(client);
    this.mappingService = new MappingService(client, this.voiceChannelManager, this.forumPostManager);
    
    // Business Logic Services 초기화
    this.recruitmentService = new RecruitmentService(
      client,
      this.forumPostManager,
      this.voiceChannelManager,
      this.mappingService,
      this.participantTracker
    );
    
    // UI Handlers 초기화
    this.modalHandler = new ModalHandler(this.recruitmentService, this.forumPostManager);
    this.buttonHandler = new ButtonHandler(this.voiceChannelManager, this.recruitmentService, this.modalHandler);
    this.interactionRouter = new InteractionRouter(this.buttonHandler, this.modalHandler, this.recruitmentService);
    
    // 서비스 초기화
    this.recruitmentService.initialize();
    
    console.log(`[VoiceForumService] 통합 서비스 초기화 완료`);
  }
  
  /**
   * ========== 권한 체크 메서드 (위임) ==========
   */
  hasRecruitmentPermission(user, member = null) {
    return PermissionService.hasRecruitmentPermission(user, member);
  }
  
  /**
   * ========== 이벤트 핸들러 메서드들 (위임) ==========
   */
  
  /**
   * 음성 채널 생성 이벤트 핸들러
   * @param {Channel} channel - 생성된 채널
   */
  async handleChannelCreate(channel) {
    await this.recruitmentService.handleChannelCreate(channel);
  }
  
  /**
   * 음성 채널 삭제 이벤트 핸들러
   * @param {Channel} channel - 삭제된 채널
   */
  async handleChannelDelete(channel) {
    await this.recruitmentService.handleChannelDelete(channel);
  }
  
  /**
   * 음성 상태 변경 이벤트 핸들러
   * @param {VoiceState} oldState - 변경 전 음성 상태
   * @param {VoiceState} newState - 변경 후 음성 상태
   */
  async handleVoiceStateUpdate(oldState, newState) {
    await this.recruitmentService.handleVoiceStateUpdate(oldState, newState);
  }
  
  /**
   * 길드 멤버 업데이트 이벤트 핸들러 (별명 변경 시 실시간 갱신)
   * @param {GuildMember} oldMember - 변경 전 멤버 정보
   * @param {GuildMember} newMember - 변경 후 멤버 정보
   */
  async handleGuildMemberUpdate(oldMember, newMember) {
    await this.recruitmentService.handleGuildMemberUpdate(oldMember, newMember);
  }
  
  /**
   * ========== 인터랙션 처리 메서드들 (위임) ==========
   */
  
  /**
   * 메인 인터랙션 핸들러
   * @param {Interaction} interaction - Discord 인터랙션
   */
  async handleInteraction(interaction) {
    try {
      // 권한 체크 및 전처리
      const canProceed = await InteractionRouter.preprocessInteraction(interaction, PermissionService);
      if (!canProceed) {
        return;
      }
      
      // 인터랙션 라우팅
      await this.interactionRouter.routeInteraction(interaction);
      
    } catch (error) {
      console.error('[VoiceForumService] 인터랙션 처리 오류:', error);
    }
  }
  
  /**
   * 역할 태그 버튼 처리 (하위 호환성을 위해 유지)
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   */
  async handleRoleTagButtons(interaction) {
    await this.buttonHandler.handleRoleTagButtons(interaction);
  }
  
  /**
   * ========== 유틸리티 메서드들 (위임) ==========
   */
  
  /**
   * 독립 구인구직 시작 - 역할 태그 선택 화면 표시
   * @param {Interaction} interaction - 인터랙션 객체
   * @returns {Promise<void>}
   */
  async showStandaloneRecruitmentModal(interaction) {
    try {
      // 권한 체크는 이미 RecruitmentCommand에서 했지만 추가 보안을 위해 다시 체크
      if (!this.hasRecruitmentPermission(interaction.user, interaction.member)) {
        await interaction.reply({
          content: '❌ **구인구직 기능 접근 권한이 없습니다.**\n\n이 기능은 현재 베타 테스트 중으로 특정 사용자와 관리자만 이용할 수 있습니다.',
          flags: 64 // MessageFlags.Ephemeral
        });
        return;
      }

      // 역할 태그 선택 화면 표시
      const embed = RecruitmentUIBuilder.createRoleTagSelectionEmbed([], true);
      const components = RecruitmentUIBuilder.createRoleTagButtons([], null, null, true);

      await interaction.reply({
        embeds: [embed],
        components: components,
        flags: 64 // MessageFlags.Ephemeral
      });
      
    } catch (error) {
      console.error('[VoiceForumService] 독립 구인구직 모달 표시 오류:', error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ 오류가 발생했습니다. 다시 시도해주세요.',
          flags: 64 // MessageFlags.Ephemeral
        });
      }
    }
  }
  
  /**
   * 독립적인 포럼 포스트 생성 (음성 채널 없이)
   * @param {Object} recruitmentData - 구인구직 데이터
   * @returns {Promise<string|null>} - 생성된 포스트 ID 또는 null
   */
  async createStandaloneForumPost(recruitmentData) {
    return await this.forumPostManager.createForumPost(recruitmentData);
  }
  
  /**
   * 삭제된 채널 정리
   * @returns {Promise<void>}
   */
  async cleanupDeletedChannels() {
    await this.mappingService.cleanupDeletedChannels();
  }
  
  /**
   * 참여자 수 업데이트 큐에 추가
   * @param {string} voiceChannelId - 음성 채널 ID
   * @returns {void}
   */
  queueParticipantUpdate(voiceChannelId) {
    this.mappingService.queueUpdate(voiceChannelId);
  }
  
  /**
   * ========== 서비스 상태 조회 메서드들 ==========
   */
  
  /**
   * 현재 매핑 상태 가져오기
   * @returns {Object} - 매핑 통계
   */
  getMappingStats() {
    return this.mappingService.getMappingStats();
  }
  
  /**
   * 특정 음성 채널의 매핑 정보 가져오기
   * @param {string} voiceChannelId - 음성 채널 ID
   * @returns {Promise<Object|null>} - 매핑 상세 정보
   */
  async getMappingDetails(voiceChannelId) {
    return await this.mappingService.getMappingDetails(voiceChannelId);
  }
  
  /**
   * 현재 서비스 상태 요약
   * @returns {Object} - 서비스 상태
   */
  getServiceStatus() {
    return {
      mappings: this.mappingService.getMappingStats(),
      recruitmentEnabled: PermissionService.hasRecruitmentPermission,
      components: {
        voiceChannelManager: !!this.voiceChannelManager,
        forumPostManager: !!this.forumPostManager,
        participantTracker: !!this.participantTracker,
        mappingService: !!this.mappingService,
        recruitmentService: !!this.recruitmentService,
        interactionRouter: !!this.interactionRouter
      }
    };
  }
  
  /**
   * ========== 디버깅 및 로깅 메서드들 ==========
   */
  
  /**
   * 현재 매핑 상태 로깅
   * @returns {void}
   */
  logMappingStatus() {
    this.mappingService.logCurrentMappings();
  }
  
  /**
   * 서비스 컴포넌트 상태 체크
   * @returns {boolean} - 모든 컴포넌트가 정상인지 여부
   */
  healthCheck() {
    const components = [
      this.voiceChannelManager,
      this.forumPostManager,
      this.participantTracker,
      this.mappingService,
      this.recruitmentService,
      this.interactionRouter
    ];
    
    const allHealthy = components.every(component => !!component);
    
    if (!allHealthy) {
      console.error('[VoiceForumService] 일부 컴포넌트가 초기화되지 않았습니다.');
    }
    
    return allHealthy;
  }
}