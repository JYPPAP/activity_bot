// src/services/RecruitmentService.js - 구인구직 비즈니스 로직
import {
  MessageFlags,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder
} from 'discord.js';
import { config } from '../config/env.js';
import { DiscordConstants } from '../config/DiscordConstants.js';
import { RecruitmentConfig } from '../config/RecruitmentConfig.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';
import { RecruitmentUIBuilder } from '../ui/RecruitmentUIBuilder.js';
import { ModalHandler } from '../ui/ModalHandler.js';
import { PermissionService } from './PermissionService.js';
import { ForumPostManager } from './ForumPostManager.js';
import { logger } from '../config/logger-termux.js';

export class RecruitmentService {
  constructor(client, forumPostManager, voiceChannelManager, mappingService, participantTracker) {
    this.client = client;
    this.forumPostManager = forumPostManager;
    this.voiceChannelManager = voiceChannelManager;
    this.mappingService = mappingService;
    this.participantTracker = participantTracker;

    // 특수 구인구직용 ForumPostManager 인스턴스 생성
    this.scrimmageForumManager = new ForumPostManager(
      client,
      config.SCRIMMAGE_FORUM_CHANNEL_ID,
      null, // 첫 번째 사용 가능한 태그 사용
      this.forumPostManager.databaseManager
    );

    this.longTermForumManager = new ForumPostManager(
      client,
      config.LONG_TERM_FORUM_CHANNEL_ID,
      null, // 첫 번째 사용 가능한 태그 사용
      this.forumPostManager.databaseManager
    );
  }
  
  /**
   * 구인구직 연동 버튼 처리
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Promise<void>}
   */
  async handleVoiceConnectButton(interaction) {
    try {
      // 즉시 defer 처리하여 3초 제한시간 해결
      await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      
      const voiceChannelId = interaction.customId.replace(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_CONNECT, '');
      
      // 권한 확인
      if (!PermissionService.hasRecruitmentPermission(interaction.user, interaction.member)) {
        await interaction.editReply({
          content: RecruitmentConfig.MESSAGES.NO_PERMISSION
        });
        return;
      }
      
      // 음성 채널 정보 가져오기
      const voiceChannelInfo = await this.voiceChannelManager.getVoiceChannelInfo(voiceChannelId);
      if (!voiceChannelInfo) {
        await interaction.editReply({
          content: RecruitmentConfig.MESSAGES.VOICE_CHANNEL_NOT_FOUND
        });
        return;
      }
      
      // 기존 포스트 목록 가져오기 (사용자 별명 기반 필터링 적용)
      const userDisplayName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
      const existingPosts = await this.forumPostManager.getExistingPostsFilteredByUser(15, userDisplayName);
      
      // 연동 방법 선택 UI 생성
      const embed = RecruitmentUIBuilder.createMethodSelectionEmbed(voiceChannelInfo.name);
      const selectMenu = RecruitmentUIBuilder.createMethodSelectMenu(voiceChannelId, existingPosts);
      
      await interaction.editReply({
        embeds: [embed],
        components: [selectMenu]
      });
      
    } catch (error) {
      logger.error('[RecruitmentService] 구인구직 연동 버튼 처리 오류', { error: error.message, stack: error.stack });
      if (interaction.deferred) {
        await interaction.editReply(
          SafeInteraction.createErrorResponse('구인구직 연동', error)
        );
      } else {
        await SafeInteraction.safeReply(interaction, 
          SafeInteraction.createErrorResponse('구인구직 연동', error)
        );
      }
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
        logger.warn(`[RecruitmentService] 알 수 없는 선택 값: ${selectedValue}`);
        await SafeInteraction.safeReply(interaction, {
          content: '❌ 잘못된 선택입니다. 다시 시도해주세요.',
          flags: MessageFlags.Ephemeral
        });
      }
      
    } catch (error) {
      logger.error('[RecruitmentService] 연동 방법 선택 처리 오류', { error: error.message, stack: error.stack });
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
      const createResult = await this.forumPostManager.createForumPost(recruitmentData, voiceChannelId);
      if (!createResult.success) {
        return {
          success: false,
          message: RecruitmentConfig.MESSAGES.LINK_FAILED
        };
      }
      
      // 채널-포스트 매핑 추가
      const mappingResult = await this.mappingService.addMapping(voiceChannelId, createResult.postId);
      
      if (!mappingResult.success) {
        return {
          success: false,
          message: mappingResult.message
        };
      }
      
      logger.info(`[RecruitmentService] 음성 채널 연동 구인구직 생성 완료: ${voiceChannelInfo.name} -> ${createResult.postId}`);
      
      return {
        success: true,
        postId: createResult.postId,
        message: RecruitmentConfig.MESSAGES.LINK_SUCCESS
      };
      
    } catch (error) {
      logger.error('[RecruitmentService] 음성 채널 연동 구인구직 생성 오류', { error: error.message, stack: error.stack });
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
      // 즉시 defer 처리하여 3초 제한시간 해결
      await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      
      const [voiceChannelInfo, postInfo] = await Promise.all([
        this.voiceChannelManager.getVoiceChannelInfo(voiceChannelId),
        this.forumPostManager.getPostInfo(existingPostId)
      ]);

      if (!voiceChannelInfo || !postInfo) {
        await interaction.editReply({
          content: '❌ 채널 또는 포스트를 찾을 수 없습니다.'
        });
        return;
      }

      // 트랜잭션 처리: DB 저장 먼저 시도
      logger.info(`[RecruitmentService] 연동 시도: ${voiceChannelInfo.name} -> ${postInfo.name}`, {
        voiceChannelId,
        existingPostId,
        userId: interaction.user.id
      });

      // 1단계: DB 매핑 저장 먼저 시도
      const mappingResult = await this.mappingService.addMapping(voiceChannelId, existingPostId);
      
      if (!mappingResult.success) {
        logger.warn(`[RecruitmentService] DB 매핑 저장 실패`, {
          voiceChannelId,
          existingPostId,
          error: mappingResult.error,
          message: mappingResult.message
        });
        await interaction.editReply({
          content: `❌ 연동 실패: ${mappingResult.message}`
        });
        return;
      }

      logger.info(`[RecruitmentService] DB 매핑 저장 성공`, { voiceChannelId, existingPostId });

      // 2단계: DB 저장 성공 후 포럼 메시지 전송
      try {
        await this.forumPostManager.sendVoiceChannelLinkMessage(
          existingPostId,
          voiceChannelInfo.name,
          voiceChannelInfo.id,
          voiceChannelInfo.guild.id,
          interaction.user.id
        );
        
        logger.info(`[RecruitmentService] 포럼 연동 메시지 전송 성공`, { 
          voiceChannelId, 
          existingPostId 
        });
      } catch (messageError) {
        logger.error(`[RecruitmentService] 포럼 메시지 전송 실패, 매핑 롤백`, {
          voiceChannelId,
          existingPostId,
          error: messageError.message
        });
        
        // 메시지 전송 실패 시 매핑 롤백
        await this.mappingService.removeMapping(voiceChannelId);
        
        await interaction.editReply({
          content: '❌ 연동 중 오류가 발생했습니다. 다시 시도해주세요.'
        });
        return;
      }

      await interaction.editReply({
        content: `✅ 기존 구인구직에 성공적으로 연동되었습니다!\n🔗 포럼: <#${existingPostId}>`
      });

      logger.info(`[RecruitmentService] 기존 포럼 연동 완료: ${voiceChannelInfo.name} -> ${postInfo.name}`, {
        voiceChannelId,
        voiceChannelName: voiceChannelInfo.name,
        forumPostId: existingPostId,
        forumPostName: postInfo.name,
        userId: interaction.user.id
      });
      
    } catch (error) {
      logger.error('[RecruitmentService] 기존 포럼 연동 오류:', {
        voiceChannelId,
        existingPostId,
        userId: interaction.user.id,
        error: error.message,
        stack: error.stack
      });
      try {
        await interaction.editReply({
          content: RecruitmentConfig.MESSAGES.LINK_FAILED
        });
      } catch (editError) {
        logger.error('[RecruitmentService] 에러 응답 실패', { error: editError.message, stack: editError.stack });
      }
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
      
      logger.info(`[RecruitmentService] 음성 상태 변경 감지: ${memberName} (${userId})`);
      
      const stateChange = this.voiceChannelManager.analyzeVoiceStateChange(oldState, newState);
      logger.info(`[RecruitmentService] 상태 변경 분석`, {
        isTargetCategory: stateChange.isTargetCategory,
        wasTargetCategory: stateChange.wasTargetCategory,
        channelId: stateChange.channelId,
        oldChannelId: stateChange.oldChannelId,
        actionType: stateChange.actionType
      });
      
      if (!stateChange.isTargetCategory && !stateChange.wasTargetCategory) {
        logger.info(`[RecruitmentService] 대상 카테고리가 아니므로 무시`);
        return; // 대상 카테고리가 아니면 무시
      }
      
      // 참여자 수 업데이트가 필요한 채널들
      const channelsToUpdate = new Set();
      
      if (stateChange.channelId && this.mappingService.hasMapping(stateChange.channelId)) {
        channelsToUpdate.add(stateChange.channelId);
        logger.info(`[RecruitmentService] 신규 채널 업데이트 대상: ${stateChange.channelId}`);
      }
      
      if (stateChange.oldChannelId && this.mappingService.hasMapping(stateChange.oldChannelId)) {
        channelsToUpdate.add(stateChange.oldChannelId);
        logger.info(`[RecruitmentService] 이전 채널 업데이트 대상: ${stateChange.oldChannelId}`);
      }
      
      if (channelsToUpdate.size === 0) {
        logger.info(`[RecruitmentService] 매핑된 채널이 없어서 업데이트 건너뜀`);
        return;
      }
      
      // 업데이트 큐에 추가
      logger.info(`[RecruitmentService] ${channelsToUpdate.size}개 채널을 업데이트 큐에 추가`);
      for (const channelId of channelsToUpdate) {
        this.mappingService.queueUpdate(channelId);
      }
      
    } catch (error) {
      logger.error('[RecruitmentService] 음성 상태 변경 처리 오류', { error: error.message, stack: error.stack });
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
      logger.info(`[RecruitmentService] 길드 멤버 업데이트 감지: ${oldMember.displayName} -> ${newMember.displayName}`);
      
      const tagChange = this.participantTracker.detectNicknameTagChange(oldMember, newMember);
      logger.info(`[RecruitmentService] 태그 변경 분석`, {
        changed: tagChange.changed,
        becameActive: tagChange.becameActive,
        becameInactive: tagChange.becameInactive,
        oldTags: tagChange.oldTags,
        newTags: tagChange.newTags
      });
      
      if (!tagChange.changed) {
        logger.info(`[RecruitmentService] 태그 변경이 없어서 무시`);
        return; // 태그 변경이 없으면 무시
      }

      logger.info(`[RecruitmentService] 멤버 별명 변경 감지: ${oldMember.displayName} -> ${newMember.displayName}`);

      // 사용자가 현재 음성 채널에 있는지 확인
      const voiceState = newMember.voice;
      if (!voiceState || !voiceState.channel) {
        logger.info(`[RecruitmentService] 사용자가 음성 채널에 없어서 무시`);
        return;
      }

      const voiceChannelId = voiceState.channel.id;
      logger.info(`[RecruitmentService] 사용자가 있는 음성 채널: ${voiceChannelId} (${voiceState.channel.name})`);
      
      // 매핑된 포럼 포스트가 있는지 확인
      if (!this.mappingService.hasMapping(voiceChannelId)) {
        logger.info(`[RecruitmentService] 채널 ${voiceChannelId}에 매핑된 포럼 포스트가 없어서 무시`);
        return;
      }

      logger.info(`[RecruitmentService] 대기/관전 태그 변경 감지 - 참여자 수 업데이트 실행: ${voiceChannelId}`);
      
      // 참여자 수 업데이트
      this.mappingService.queueUpdate(voiceChannelId);

    } catch (error) {
      logger.error('[RecruitmentService] 길드 멤버 업데이트 처리 오류', { error: error.message, stack: error.stack });
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
      
      logger.info(`[RecruitmentService] 음성 채널 생성 감지: ${channel.name} (ID: ${channel.id})`);
      
      // 구인구직 기능이 비활성화된 경우 임베드 전송 안함
      if (!RecruitmentConfig.RECRUITMENT_ENABLED) {
        logger.info(`[RecruitmentService] 구인구직 기능 비활성화로 임베드 전송 안함: ${channel.name}`);
        return;
      }
      
      // 권한이 있는 사용자가 채널에 있는지 확인하고 임베드 전송
      setTimeout(async () => {
        await this.checkAndSendRecruitmentEmbed(channel);
      }, RecruitmentConfig.EMBED_SEND_DELAY);
      
    } catch (error) {
      logger.error('[RecruitmentService] 채널 생성 처리 오류', { error: error.message, stack: error.stack });
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
        logger.debug(`[RecruitmentService] 채널 삭제 무시: ${channel.name} (${channel.id}) - 타입: ${channel.type}`);
        return;
      }
      
      logger.info(`[RecruitmentService] 음성 채널 삭제 감지: ${channel.name} (${channel.id})`, {
        channelId: channel.id,
        channelName: channel.name,
        guildId: channel.guild?.id
      });
      
      const postId = this.mappingService.getPostId(channel.id);
      if (postId) {
        logger.info(`[RecruitmentService] 연동된 포럼 포스트 발견: ${postId}`, {
          voiceChannelId: channel.id,
          forumPostId: postId
        });

        // 포럼 포스트 아카이브 (스레드 잠금 포함)
        const archiveSuccess = await this.forumPostManager.archivePost(
          postId, 
          '연결된 음성 채널이 삭제되었습니다', 
          true // 스레드 잠금
        );
        
        if (archiveSuccess) {
          logger.info(`[RecruitmentService] 포럼 포스트 아카이브 성공: ${postId}`, {
            voiceChannelId: channel.id,
            forumPostId: postId,
            reason: '음성 채널 삭제'
          });
        } else {
          logger.error(`[RecruitmentService] 포럼 포스트 아카이브 실패: ${postId}`, {
            voiceChannelId: channel.id,
            forumPostId: postId
          });
        }
        
        // 매핑 제거 (await 추가)
        const mappingRemoved = await this.mappingService.removeMapping(channel.id);
        
        if (mappingRemoved) {
          logger.info(`[RecruitmentService] 채널 매핑 제거 완료: ${channel.id}`);
        } else {
          logger.warn(`[RecruitmentService] 채널 매핑 제거 실패 또는 매핑이 없었음: ${channel.id}`);
        }
      } else {
        logger.debug(`[RecruitmentService] 삭제된 채널에 연동된 포럼 포스트 없음: ${channel.id}`);
      }
      
    } catch (error) {
      logger.error('[RecruitmentService] 채널 삭제 처리 오류', { error: error.message, stack: error.stack });
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
        logger.info(`[RecruitmentService] 권한 있는 사용자가 없어서 임베드 전송 안함: ${voiceChannel.name}`);
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
      
      logger.info(`[RecruitmentService] 구인구직 임베드 전송 완료: ${voiceChannel.name}`);
      
    } catch (error) {
      logger.error('[RecruitmentService] 구인구직 임베드 전송 오류', { error: error.message, stack: error.stack });
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
        logger.info(`[RecruitmentService] 정기 정리 작업 완료`, result);
      }

    } catch (error) {
      logger.error('[RecruitmentService] 정기 정리 작업 오류', { error: error.message, stack: error.stack });
    }
  }

  /**
   * [내전] 또는 [장기] 버튼 처리
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @param {string} type - 'scrimmage' 또는 'long_term'
   */
  async handleSpecialRecruitmentButton(interaction, type) {
    try {
      // 권한 체크
      if (!PermissionService.hasRecruitmentPermission(interaction.user, interaction.member)) {
        await SafeInteraction.safeReply(interaction, {
          content: RecruitmentConfig.MESSAGES.NO_PERMISSION,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      // 특수 타입용 methodValue 생성
      const specialMethodValue = type === 'scrimmage' ? 'scrimmage_new' : 'longterm_new';

      // 태그 선택 UI 표시 (타입에 따라 문구 변경)
      const embed = RecruitmentUIBuilder.createRoleTagSelectionEmbed([], true, specialMethodValue);

      const components = RecruitmentUIBuilder.createRoleTagButtons(
        [],
        null, // voiceChannelId 없음
        specialMethodValue, // 'scrimmage_new' 또는 'longterm_new'
        true // isStandalone = true (독립 구인구직)
      );

      await SafeInteraction.safeReply(interaction, {
        embeds: [embed],
        components: components,
        flags: MessageFlags.Ephemeral
      });

    } catch (error) {
      logger.error(`[RecruitmentService] [${type}] 버튼 처리 오류`, { error: error.message, stack: error.stack });
      await SafeInteraction.safeReply(interaction, {
        content: RecruitmentConfig.MESSAGES.GENERIC_ERROR,
        flags: MessageFlags.Ephemeral
      });
    }
  }

  /**
   * [내전] 또는 [장기] 모달 표시
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @param {string} type - 'scrimmage' 또는 'long_term'
   * @param {Array<string>} selectedRoles - 선택된 역할 태그 배열
   */
  async showSpecialRecruitmentModal(interaction, type, selectedRoles = []) {
    // 선택된 태그를 customId에 인코딩
    const tagsEncoded = selectedRoles.length > 0 ? `_tags_${selectedRoles.join(',')}` : '';
    const modalCustomId = type === 'scrimmage'
      ? `scrimmage_recruitment_modal${tagsEncoded}`
      : `long_term_recruitment_modal${tagsEncoded}`;

    const modalTitle = type === 'scrimmage' ? '[내전] 구인구직' : '[장기] 구인구직';

    const modal = new ModalBuilder()
      .setCustomId(modalCustomId)
      .setTitle(modalTitle);

    // ModalHandler의 createModalFields 재사용
    const customTitleLabel = selectedRoles.length > 0
      ? `제목 (선택된 태그: ${selectedRoles.join(', ')})`
      : null; // null이면 기본 라벨 사용

    const fields = ModalHandler.createModalFields(selectedRoles, customTitleLabel);
    const actionRows = ModalHandler.createActionRows(fields);

    modal.addComponents(...actionRows);

    await interaction.showModal(modal);
  }

  /**
   * [내전] 또는 [장기] 모달 제출 처리
   * @param {ModalSubmitInteraction} interaction - 모달 제출 인터랙션
   * @param {string} type - 'scrimmage' 또는 'long_term'
   * @param {Array<string>} selectedTags - 선택된 역할 태그 배열
   */
  async handleSpecialRecruitmentModalSubmit(interaction, type, selectedTags = []) {
    try {
      await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

      // 모달 입력 값 추출 (일반 구인구직과 동일)
      const title = interaction.fields.getTextInputValue('recruitment_title');
      const rawTags = interaction.fields.getTextInputValue('recruitment_tags') || '';
      const description = interaction.fields.getTextInputValue('recruitment_description') || '';

      // 태그 배열 생성 (일반 구인구직과 동일 로직)
      const tagsFromModal = rawTags
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

      // selectedTags와 모달 입력 태그 병합 (모달 입력이 우선)
      const finalTags = tagsFromModal.length > 0 ? tagsFromModal : selectedTags;

      // ForumPostManager 형식에 맞춘 recruitmentData 생성
      const recruitmentData = {
        title: title,
        description: description,
        tags: finalTags, // 최종 태그 배열
        author: {
          id: interaction.user.id,
          displayName: interaction.member.displayName, // 길드 별명 사용
          displayAvatarURL: () => interaction.user.displayAvatarURL()
        }
      };

      // 타입에 따라 ForumPostManager 선택
      const forumManager = type === 'scrimmage'
        ? this.scrimmageForumManager
        : this.longTermForumManager;

      const specialTypeLabel = type === 'scrimmage' ? '내전' : '장기';

      // ForumPostManager로 포스트 생성 (standalone 모드 + specialType)
      const result = await forumManager.createForumPost(
        recruitmentData,
        null, // voiceChannelId 없음 (standalone)
        specialTypeLabel // 특수 타입 라벨
      );

      if (result.success) {
        await SafeInteraction.safeReply(interaction, {
          content: `✅ [${specialTypeLabel}] 구인구직이 생성되었습니다!\nhttps://discord.com/channels/${interaction.guildId}/${result.postId}`,
          flags: MessageFlags.Ephemeral
        });
      } else {
        await SafeInteraction.safeReply(interaction, {
          content: `❌ [${specialTypeLabel}] 구인구직 생성에 실패했습니다: ${result.error}`,
          flags: MessageFlags.Ephemeral
        });
      }

    } catch (error) {
      logger.error(`[RecruitmentService] [${type}] 모달 제출 처리 오류`, { error: error.message, stack: error.stack });
      await SafeInteraction.safeReply(interaction, {
        content: RecruitmentConfig.MESSAGES.GENERIC_ERROR,
        flags: MessageFlags.Ephemeral
      });
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
    
    logger.info(`[RecruitmentService] 서비스 초기화 완료`);
  }
}