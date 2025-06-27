// src/services/RecruitmentService.js - 구인구직 비즈니스 로직
import { MessageFlags } from 'discord.js';
import { DiscordConstants } from '../config/DiscordConstants.js';
import { RecruitmentConfig } from '../config/RecruitmentConfig.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';
import { RecruitmentUIBuilder } from '../ui/RecruitmentUIBuilder.js';
import { PermissionService } from './PermissionService.js';

export class RecruitmentService {
  constructor(client, forumPostManager, voiceChannelManager, mappingService, participantTracker) {
    this.client = client;
    this.forumPostManager = forumPostManager;
    this.voiceChannelManager = voiceChannelManager;
    this.mappingService = mappingService;
    this.participantTracker = participantTracker;
  }
  
  /**
   * 구인구직 연동 버튼 처리
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Promise<void>}
   */
  async handleVoiceConnectButton(interaction) {
    try {
      const voiceChannelId = interaction.customId.replace(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_CONNECT, '');
      
      // 권한 확인
      if (!PermissionService.hasRecruitmentPermission(interaction.user, interaction.member)) {
        await SafeInteraction.safeReply(interaction, {
          content: RecruitmentConfig.MESSAGES.NO_PERMISSION,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      
      // 음성 채널 정보 가져오기
      const voiceChannelInfo = await this.voiceChannelManager.getVoiceChannelInfo(voiceChannelId);
      if (!voiceChannelInfo) {
        await SafeInteraction.safeReply(interaction, {
          content: RecruitmentConfig.MESSAGES.VOICE_CHANNEL_NOT_FOUND,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      
      // 기존 포스트 목록 가져오기
      const existingPosts = await this.forumPostManager.getExistingPosts(7);
      
      // 연동 방법 선택 UI 생성
      const embed = RecruitmentUIBuilder.createMethodSelectionEmbed(voiceChannelInfo.name);
      const selectMenu = RecruitmentUIBuilder.createMethodSelectMenu(voiceChannelId, existingPosts);
      
      await SafeInteraction.safeReply(interaction, {
        embeds: [embed],
        components: [selectMenu],
        flags: MessageFlags.Ephemeral
      });
      
    } catch (error) {
      console.error('[RecruitmentService] 구인구직 연동 버튼 처리 오류:', error);
      await SafeInteraction.safeReply(interaction, 
        SafeInteraction.createErrorResponse('구인구직 연동', error)
      );
    }
  }
  
  /**
   * 연동 방법 선택 처리
   * @param {StringSelectMenuInteraction} interaction - 셀렉트 메뉴 인터랙션
   * @returns {Promise<void>}
   */
  async handleMethodSelection(interaction) {
    try {
      const voiceChannelId = interaction.customId.replace(DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_METHOD, '');
      const selectedValue = interaction.values[0];
      
      if (selectedValue === DiscordConstants.METHOD_VALUES.NEW_FORUM) {
        // 새 포럼 생성: 역할 태그 선택 UI로 전환
        const embed = RecruitmentUIBuilder.createRoleTagSelectionEmbed([], false);
        const components = RecruitmentUIBuilder.createRoleTagButtons([], voiceChannelId, selectedValue, false);
        
        await SafeInteraction.safeUpdate(interaction, {
          embeds: [embed],
          components: components
        });
        
      } else if (selectedValue.startsWith(DiscordConstants.METHOD_VALUES.EXISTING_FORUM_PREFIX)) {
        // 기존 포럼 선택: 바로 연동 처리
        const existingPostId = selectedValue.replace(DiscordConstants.METHOD_VALUES.EXISTING_FORUM_PREFIX, '');
        await this.linkToExistingForum(interaction, voiceChannelId, existingPostId, []);
        
      } else {
        console.warn(`[RecruitmentService] 알 수 없는 선택 값: ${selectedValue}`);
        await SafeInteraction.safeReply(interaction, {
          content: '❌ 잘못된 선택입니다. 다시 시도해주세요.',
          flags: MessageFlags.Ephemeral
        });
      }
      
    } catch (error) {
      console.error('[RecruitmentService] 연동 방법 선택 처리 오류:', error);
      await SafeInteraction.safeReply(interaction, 
        SafeInteraction.createErrorResponse('방법 선택', error)
      );
    }
  }
  
  /**
   * 음성 채널 연동 구인구직 생성
   * @param {Object} recruitmentData - 구인구직 데이터
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {string} linkerId - 연동한 사용자 ID
   * @returns {Promise<Object>} - 생성 결과
   */
  async createLinkedRecruitment(recruitmentData, voiceChannelId, linkerId) {
    try {
      // 음성 채널 정보 가져오기
      const voiceChannelInfo = await this.voiceChannelManager.getVoiceChannelInfo(voiceChannelId);
      if (!voiceChannelInfo) {
        return {
          success: false,
          message: RecruitmentConfig.MESSAGES.VOICE_CHANNEL_NOT_FOUND
        };
      }
      
      // 포럼 포스트 생성
      const postId = await this.forumPostManager.createForumPost(recruitmentData, voiceChannelId);
      if (!postId) {
        return {
          success: false,
          message: RecruitmentConfig.MESSAGES.LINK_FAILED
        };
      }
      
      // 채널-포스트 매핑 추가
      this.mappingService.addMapping(voiceChannelId, postId);
      
      console.log(`[RecruitmentService] 음성 채널 연동 구인구직 생성 완료: ${voiceChannelInfo.name} -> ${postId}`);
      
      return {
        success: true,
        postId: postId,
        message: RecruitmentConfig.MESSAGES.LINK_SUCCESS
      };
      
    } catch (error) {
      console.error('[RecruitmentService] 음성 채널 연동 구인구직 생성 오류:', error);
      return {
        success: false,
        message: RecruitmentConfig.MESSAGES.LINK_FAILED
      };
    }
  }
  
  /**
   * 기존 포럼에 연동
   * @param {Interaction} interaction - 인터랙션 객체
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {string} existingPostId - 기존 포스트 ID
   * @param {Array} selectedRoles - 선택된 역할 태그 배열
   * @returns {Promise<void>}
   */
  async linkToExistingForum(interaction, voiceChannelId, existingPostId, selectedRoles = []) {
    try {
      const [voiceChannelInfo, postInfo] = await Promise.all([
        this.voiceChannelManager.getVoiceChannelInfo(voiceChannelId),
        this.forumPostManager.getPostInfo(existingPostId)
      ]);

      if (!voiceChannelInfo || !postInfo) {
        await SafeInteraction.safeReply(interaction, {
          content: '❌ 채널 또는 포스트를 찾을 수 없습니다.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      // 음성 채널 연동 메시지 전송
      await this.forumPostManager.sendVoiceChannelLinkMessage(
        existingPostId,
        voiceChannelInfo.name,
        voiceChannelInfo.id,
        voiceChannelInfo.guild.id,
        interaction.user.id
      );

      // 채널-포스트 매핑 저장
      this.mappingService.addMapping(voiceChannelId, existingPostId);

      await SafeInteraction.safeReply(interaction, {
        content: `✅ 기존 구인구직에 성공적으로 연동되었습니다!\n🔗 포럼: <#${existingPostId}>`,
        flags: MessageFlags.Ephemeral
      });

      console.log(`[RecruitmentService] 기존 포럼 연동 완료: ${voiceChannelInfo.name} -> ${postInfo.name}`);
      
    } catch (error) {
      console.error('[RecruitmentService] 기존 포럼 연동 오류:', error);
      await SafeInteraction.safeReply(interaction, {
        content: RecruitmentConfig.MESSAGES.LINK_FAILED,
        flags: MessageFlags.Ephemeral
      });
    }
  }
  
  /**
   * 음성 상태 변경 이벤트 처리
   * @param {VoiceState} oldState - 변경 전 음성 상태
   * @param {VoiceState} newState - 변경 후 음성 상태
   * @returns {Promise<void>}
   */
  async handleVoiceStateUpdate(oldState, newState) {
    try {
      const userId = newState.id;
      const memberName = newState.member?.displayName || 'Unknown';
      
      console.log(`[RecruitmentService] 음성 상태 변경 감지: ${memberName} (${userId})`);
      
      const stateChange = this.voiceChannelManager.analyzeVoiceStateChange(oldState, newState);
      console.log(`[RecruitmentService] 상태 변경 분석:`, {
        isTargetCategory: stateChange.isTargetCategory,
        wasTargetCategory: stateChange.wasTargetCategory,
        channelId: stateChange.channelId,
        oldChannelId: stateChange.oldChannelId,
        actionType: stateChange.actionType
      });
      
      if (!stateChange.isTargetCategory && !stateChange.wasTargetCategory) {
        console.log(`[RecruitmentService] 대상 카테고리가 아니므로 무시`);
        return; // 대상 카테고리가 아니면 무시
      }
      
      // 참여자 수 업데이트가 필요한 채널들
      const channelsToUpdate = new Set();
      
      if (stateChange.channelId && this.mappingService.hasMapping(stateChange.channelId)) {
        channelsToUpdate.add(stateChange.channelId);
        console.log(`[RecruitmentService] 신규 채널 업데이트 대상: ${stateChange.channelId}`);
      }
      
      if (stateChange.oldChannelId && this.mappingService.hasMapping(stateChange.oldChannelId)) {
        channelsToUpdate.add(stateChange.oldChannelId);
        console.log(`[RecruitmentService] 이전 채널 업데이트 대상: ${stateChange.oldChannelId}`);
      }
      
      if (channelsToUpdate.size === 0) {
        console.log(`[RecruitmentService] 매핑된 채널이 없어서 업데이트 건너뜀`);
        return;
      }
      
      // 업데이트 큐에 추가
      console.log(`[RecruitmentService] ${channelsToUpdate.size}개 채널을 업데이트 큐에 추가`);
      for (const channelId of channelsToUpdate) {
        this.mappingService.queueUpdate(channelId);
      }
      
    } catch (error) {
      console.error('[RecruitmentService] 음성 상태 변경 처리 오류:', error);
    }
  }
  
  /**
   * 길드 멤버 업데이트 이벤트 처리 (별명 변경 시 실시간 갱신)
   * @param {GuildMember} oldMember - 변경 전 멤버 정보
   * @param {GuildMember} newMember - 변경 후 멤버 정보
   * @returns {Promise<void>}
   */
  async handleGuildMemberUpdate(oldMember, newMember) {
    try {
      console.log(`[RecruitmentService] 길드 멤버 업데이트 감지: ${oldMember.displayName} -> ${newMember.displayName}`);
      
      const tagChange = this.participantTracker.detectNicknameTagChange(oldMember, newMember);
      console.log(`[RecruitmentService] 태그 변경 분석:`, {
        changed: tagChange.changed,
        becameActive: tagChange.becameActive,
        becameInactive: tagChange.becameInactive,
        oldTags: tagChange.oldTags,
        newTags: tagChange.newTags
      });
      
      if (!tagChange.changed) {
        console.log(`[RecruitmentService] 태그 변경이 없어서 무시`);
        return; // 태그 변경이 없으면 무시
      }

      console.log(`[RecruitmentService] 멤버 별명 변경 감지: ${oldMember.displayName} -> ${newMember.displayName}`);

      // 사용자가 현재 음성 채널에 있는지 확인
      const voiceState = newMember.voice;
      if (!voiceState || !voiceState.channel) {
        console.log(`[RecruitmentService] 사용자가 음성 채널에 없어서 무시`);
        return;
      }

      const voiceChannelId = voiceState.channel.id;
      console.log(`[RecruitmentService] 사용자가 있는 음성 채널: ${voiceChannelId} (${voiceState.channel.name})`);
      
      // 매핑된 포럼 포스트가 있는지 확인
      if (!this.mappingService.hasMapping(voiceChannelId)) {
        console.log(`[RecruitmentService] 채널 ${voiceChannelId}에 매핑된 포럼 포스트가 없어서 무시`);
        return;
      }

      console.log(`[RecruitmentService] 대기/관전 태그 변경 감지 - 참여자 수 업데이트 실행: ${voiceChannelId}`);
      
      // 참여자 수 업데이트
      this.mappingService.queueUpdate(voiceChannelId);

    } catch (error) {
      console.error('[RecruitmentService] 길드 멤버 업데이트 처리 오류:', error);
    }
  }
  
  /**
   * 채널 생성 이벤트 처리
   * @param {Channel} channel - 생성된 채널
   * @returns {Promise<void>}
   */
  async handleChannelCreate(channel) {
    try {
      if (!this.voiceChannelManager.isTargetVoiceChannel(channel)) {
        return;
      }
      
      console.log(`[RecruitmentService] 음성 채널 생성 감지: ${channel.name} (ID: ${channel.id})`);
      
      // 구인구직 기능이 비활성화된 경우 임베드 전송 안함
      if (!RecruitmentConfig.RECRUITMENT_ENABLED) {
        console.log(`[RecruitmentService] 구인구직 기능 비활성화로 임베드 전송 안함: ${channel.name}`);
        return;
      }
      
      // 권한이 있는 사용자가 채널에 있는지 확인하고 임베드 전송
      setTimeout(async () => {
        await this.checkAndSendRecruitmentEmbed(channel);
      }, RecruitmentConfig.EMBED_SEND_DELAY);
      
    } catch (error) {
      console.error('[RecruitmentService] 채널 생성 처리 오류:', error);
    }
  }
  
  /**
   * 채널 삭제 이벤트 처리
   * @param {Channel} channel - 삭제된 채널
   * @returns {Promise<void>}
   */
  async handleChannelDelete(channel) {
    try {
      if (!this.voiceChannelManager.shouldHandleChannelDeletion(channel)) {
        return;
      }
      
      console.log(`[RecruitmentService] 음성 채널 삭제 감지: ${channel.name} (ID: ${channel.id})`);
      
      const postId = this.mappingService.getPostId(channel.id);
      if (postId) {
        // 포럼 포스트 아카이브
        await this.forumPostManager.archivePost(postId, '음성 채널 삭제됨');
        
        // 매핑 제거
        this.mappingService.removeMapping(channel.id);
        
        console.log(`[RecruitmentService] 채널 삭제로 인한 포스트 아카이브: ${postId}`);
      }
      
    } catch (error) {
      console.error('[RecruitmentService] 채널 삭제 처리 오류:', error);
    }
  }
  
  /**
   * 구인구직 임베드 전송 조건 확인 및 전송
   * @param {VoiceChannel} voiceChannel - 음성 채널
   * @returns {Promise<void>}
   */
  async checkAndSendRecruitmentEmbed(voiceChannel) {
    try {
      // 이미 임베드를 전송한 채널인지 확인
      if (this.sentEmbedChannels && this.sentEmbedChannels.has(voiceChannel.id)) {
        return;
      }
      
      // 권한이 있는 사용자가 채널에 있는지 확인
      let hasPermittedUser = false;
      for (const member of voiceChannel.members.values()) {
        if (PermissionService.hasRecruitmentPermission(member.user, member)) {
          hasPermittedUser = true;
          break;
        }
      }
      
      if (!hasPermittedUser) {
        console.log(`[RecruitmentService] 권한 있는 사용자가 없어서 임베드 전송 안함: ${voiceChannel.name}`);
        return;
      }
      
      // 구인구직 연동 임베드 전송
      const embed = RecruitmentUIBuilder.createInitialEmbed(voiceChannel.name);
      const components = RecruitmentUIBuilder.createInitialButtons(voiceChannel.id);
      
      await voiceChannel.send({
        embeds: [embed],
        components: components
      });
      
      // 전송한 채널로 마킹
      if (this.sentEmbedChannels) {
        this.sentEmbedChannels.add(voiceChannel.id);
      }
      
      console.log(`[RecruitmentService] 구인구직 임베드 전송 완료: ${voiceChannel.name}`);
      
    } catch (error) {
      console.error('[RecruitmentService] 구인구직 임베드 전송 오류:', error);
    }
  }
  
  /**
   * 정기 정리 작업 수행
   * @returns {Promise<void>}
   */
  async performPeriodicCleanup() {
    try {
      const result = await this.mappingService.performFullCleanup();
      
      if (result.totalCleaned > 0) {
        console.log(`[RecruitmentService] 정기 정리 작업 완료:`, result);
      }
      
    } catch (error) {
      console.error('[RecruitmentService] 정기 정리 작업 오류:', error);
    }
  }
  
  /**
   * 서비스 초기화 (정기 작업 등 설정)
   * @returns {void}}
   */
  initialize() {
    // 임베드 전송 추적을 위한 Set 초기화
    this.sentEmbedChannels = new Set();
    
    // 정기 정리 작업 설정
    setInterval(async () => {
      await this.performPeriodicCleanup();
    }, RecruitmentConfig.CLEANUP_INTERVAL);
    
    console.log(`[RecruitmentService] 서비스 초기화 완료`);
  }
}