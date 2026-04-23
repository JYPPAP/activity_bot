// src/ui/ButtonHandler.js - 버튼 인터랙션 처리
import { EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder } from 'discord.js';
import { DiscordConstants } from '../config/DiscordConstants.js';
import { RecruitmentConfig } from '../config/RecruitmentConfig.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';
import { RecruitmentUIBuilder } from './RecruitmentUIBuilder.js';
import { TextProcessor } from '../utils/TextProcessor.js';
import { formatParticipantList } from '../utils/formatters.js';
import { config } from '../config/env.js';
import { SUPER_ADMIN_ROLES } from '../config/commandPermissions.js';

export class ButtonHandler {
  constructor(voiceChannelManager, recruitmentService, modalHandler, emojiReactionService, forumPostManager) {
    this.voiceChannelManager = voiceChannelManager;
    this.recruitmentService = recruitmentService;
    this.modalHandler = modalHandler;
    this.emojiReactionService = emojiReactionService;
    this.forumPostManager = forumPostManager;
  }

  /**
   * 역할 태그 버튼 처리 (다중 선택 지원)
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Promise<void>}
   */
  async handleRoleTagButtons(interaction) {
    try {
      const customId = interaction.customId;

      // 특수 버튼 처리 ([장기], [내전])
      if (customId === 'special_longterm_button') {
        await this.recruitmentService.handleSpecialRecruitmentButton(interaction, 'long_term');
        return;
      } else if (customId === 'special_scrimmage_button') {
        await this.recruitmentService.handleSpecialRecruitmentButton(interaction, 'scrimmage');
        return;
      }

      // 완료 버튼 처리
      if (this.isCompleteButton(customId)) {
        await this.handleCompleteButton(interaction, customId);
        return;
      }

      // 태그 선택/해제 처리
      await this.handleTagToggle(interaction, customId);

    } catch (error) {
      console.error('[ButtonHandler] 역할 태그 버튼 처리 오류:', error);
      await SafeInteraction.safeReply(interaction,
        SafeInteraction.createErrorResponse('버튼 처리', error)
      );
    }
  }
  
  /**
   * 완료 버튼인지 확인
   * @param {string} customId - 커스텀 ID
   * @returns {boolean} - 완료 버튼 여부
   */
  isCompleteButton(customId) {
    return customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_COMPLETE) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE);
  }
  
  /**
   * 완료 버튼 처리
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @param {string} customId - 커스텀 ID
   * @returns {Promise<void>}
   */
  async handleCompleteButton(interaction, customId) {
    const selectedTags = this.extractSelectedTags(interaction);

    // === DEBUG: 상세 로깅 시작 ===
    console.log(`\n[ButtonHandler] ===== 완료 버튼 처리 시작 =====`);
    console.log(`[ButtonHandler] 받은 customId: "${customId}"`);
    console.log(`[ButtonHandler] 선택된 태그: [${selectedTags.join(', ')}]`);
    console.log(`[ButtonHandler] STANDALONE_ROLE_COMPLETE 프리픽스: "${DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE}"`);
    console.log(`[ButtonHandler] startsWith 체크 결과: ${customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE)}`);

    if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE)) {
      console.log(`[ButtonHandler] ✅ 독립 구인구직 브랜치 진입`);

      // 독립 구인구직: methodValue 파싱
      const parts = customId.split('_');
      // standalone_role_complete_scrimmage_new → ['standalone', 'role', 'complete', 'scrimmage', 'new']
      // standalone_role_complete → ['standalone', 'role', 'complete']

      console.log(`[ButtonHandler] parts 배열: [${parts.join(', ')}]`);
      console.log(`[ButtonHandler] parts.length: ${parts.length}`);

      if (parts.length > 3) {
        // methodValue가 있는 경우 (장기/내전)
        const methodValue = parts.slice(3).join('_');  // 'scrimmage_new' or 'longterm_new'

        console.log(`[ButtonHandler] ✅ methodValue 존재 (parts.length > 3)`);
        console.log(`[ButtonHandler] 파싱된 methodValue: "${methodValue}"`);

        if (methodValue === 'scrimmage_new') {
          console.log(`[ButtonHandler] ✅✅ 내전 모달 표시 호출`);
          await this.recruitmentService.showSpecialRecruitmentModal(interaction, 'scrimmage', selectedTags);
        } else if (methodValue === 'longterm_new') {
          console.log(`[ButtonHandler] ✅✅ 장기 모달 표시 호출`);
          await this.recruitmentService.showSpecialRecruitmentModal(interaction, 'long_term', selectedTags);
        } else {
          console.warn(`[ButtonHandler] ⚠️ 알 수 없는 독립 구인구직 타입: "${methodValue}"`);
          await this.modalHandler.showStandaloneRecruitmentModal(interaction, selectedTags);
        }
      } else {
        // methodValue가 없는 경우 (일반 단기)
        console.log(`[ButtonHandler] ℹ️ methodValue 없음 (parts.length <= 3) - 일반 단기 모달 표시`);
        await this.modalHandler.showStandaloneRecruitmentModal(interaction, selectedTags);
      }
    } else {
      // 음성 채널 연동 또는 특수 구인구직의 경우
      const parts = customId.split('_');
      const voiceChannelId = parts[2];
      const methodValue = parts.slice(3).join('_');

      console.log(`[ButtonHandler] 완료 버튼 처리 - methodValue: "${methodValue}"`);

      if (methodValue === DiscordConstants.METHOD_VALUES.NEW_FORUM) {
        console.log(`[ButtonHandler] 새 포럼 생성 모달 표시`);
        await this.modalHandler.showRecruitmentModal(interaction, voiceChannelId, selectedTags);
      } else if (methodValue === 'scrimmage_new') {
        console.log(`[ButtonHandler] 내전 모달 표시`);
        await this.recruitmentService.showSpecialRecruitmentModal(interaction, 'scrimmage', selectedTags);
      } else if (methodValue === 'longterm_new') {
        console.log(`[ButtonHandler] 장기 모달 표시`);
        await this.recruitmentService.showSpecialRecruitmentModal(interaction, 'long_term', selectedTags);
      } else if (methodValue.startsWith(DiscordConstants.METHOD_VALUES.EXISTING_FORUM_PREFIX)) {
        console.log(`[ButtonHandler] 기존 포럼 연동 처리`);
        const existingPostId = methodValue.replace(DiscordConstants.METHOD_VALUES.EXISTING_FORUM_PREFIX, '');
        await this.recruitmentService.linkToExistingForum(interaction, voiceChannelId, existingPostId, selectedTags);
      } else {
        console.warn(`[ButtonHandler] 알 수 없는 methodValue: "${methodValue}"`);
        await SafeInteraction.safeReply(interaction, {
          content: '❌ 알 수 없는 요청입니다. 다시 시도해주세요.',
          flags: MessageFlags.Ephemeral
        });
      }
    }
  }
  
  /**
   * 태그 토글 처리
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @param {string} customId - 커스텀 ID
   * @returns {Promise<void>}
   */
  async handleTagToggle(interaction, customId) {
    let selectedRole, voiceChannelId, methodValue;
    let isStandalone = false;

    if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_BUTTON)) {
      // 독립 구인구직: customId 형식
      // - methodValue 있음: standalone_role_button_{tag}_{methodValue} (예: standalone_role_button_탱커_scrimmage_new)
      // - methodValue 없음: standalone_role_button_{tag} (예: standalone_role_button_탱커)
      const parts = customId.split('_');
      selectedRole = parts[3];

      // methodValue 파싱 (parts.length > 4이면 methodValue 존재)
      if (parts.length > 4) {
        methodValue = parts.slice(4).join('_');
      }

      isStandalone = true;
      console.log(`[ButtonHandler] 독립 구인구직 태그 토글 - tag: "${selectedRole}", methodValue: "${methodValue}"`);
    } else {
      const parts = customId.split('_');
      selectedRole = parts[2];
      voiceChannelId = parts[3];
      methodValue = parts.slice(4).join('_');
    }

    // 현재 선택된 태그들 추출
    const selectedTags = this.extractSelectedTags(interaction);

    // 태그 토글
    const index = selectedTags.indexOf(selectedRole);
    if (index > -1) {
      // 이미 선택된 태그 제거
      selectedTags.splice(index, 1);
    } else {
      // 새 태그 추가 (최대 개수 체크)
      if (selectedTags.length >= RecruitmentConfig.MAX_SELECTED_TAGS) {
        await SafeInteraction.safeReply(interaction, {
          content: RecruitmentConfig.MESSAGES.MAX_TAGS_EXCEEDED,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      selectedTags.push(selectedRole);
    }

    // UI 업데이트
    await this.updateTagSelectionUI(interaction, selectedTags, isStandalone, voiceChannelId, methodValue);
  }
  
  /**
   * 현재 선택된 태그들 추출
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Array<string>} - 선택된 태그 배열
   */
  extractSelectedTags(interaction) {
    const embed = EmbedBuilder.from(interaction.message.embeds[0]);
    const description = embed.data.description;
    const selectedTagsMatch = description.match(/선택된 태그: \*\*(.*?)\*\*/);
    
    let selectedTags = [];
    if (selectedTagsMatch && selectedTagsMatch[1] !== '없음') {
      selectedTags = selectedTagsMatch[1].split(', ');
    }
    
    return selectedTags;
  }
  
  /**
   * 태그 선택 UI 업데이트
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @param {Array<string>} selectedTags - 선택된 태그 배열
   * @param {boolean} isStandalone - 독립 모드 여부
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {string} methodValue - 메서드 값
   * @returns {Promise<void>}
   */
  async updateTagSelectionUI(interaction, selectedTags, isStandalone, voiceChannelId, methodValue) {
    // 임베드 업데이트
    const embed = RecruitmentUIBuilder.createRoleTagSelectionEmbed(selectedTags, isStandalone, methodValue);

    // 버튼 업데이트
    const components = RecruitmentUIBuilder.createRoleTagButtons(
      selectedTags,
      voiceChannelId,
      methodValue,
      isStandalone
    );

    await SafeInteraction.safeUpdate(interaction, {
      embeds: [embed],
      components: components
    });
  }
  
  /**
   * 음성 채널 관련 버튼 처리
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Promise<void>}
   */
  async handleVoiceChannelButtons(interaction) {
    // 중복 처리 방지
    if (!SafeInteraction.startProcessing(interaction)) {
      return;
    }

    try {
      // 인터랙션 유효성 검사
      const validation = SafeInteraction.validateInteraction(interaction);
      if (!validation.valid) {
        console.warn(`[ButtonHandler] 유효하지 않은 인터랙션: ${validation.reason}`);
        return;
      }

      const customId = interaction.customId;
      console.log(`[ButtonHandler] 음성 채널 버튼 처리: ${customId}`);
      
      if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_CONNECT)) {
        await this.handleConnectButton(interaction);
      // 닫기 버튼 처리 비활성화 (임시)
      // } else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_CLOSE) || customId === 'general_close') {
      //   await this.handleCloseButton(interaction);
      } else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_SPECTATE) || customId === 'general_spectate') {
        await this.handleSpectateButton(interaction);
      } else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_WAIT) || customId === 'general_wait') {
        await this.handleWaitButton(interaction);
      } else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_RESET) || customId === 'general_reset') {
        await this.handleResetButton(interaction);
      } else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_DELETE) || customId === 'general_delete') {
        await this.handleDeleteButton(interaction);
      } else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_JOIN)) {
        await this.handleJoinButton(interaction);
      } else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_LEAVE)) {
        await this.handleLeaveButton(interaction);
      } else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_EDIT_PREMEMBERS)) {
        await this.handleEditPreMembersButton(interaction);
      } else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_PARTICIPATE)) {
        // 하위 호환성을 위해 유지 (기존 포스트용)
        await this.handleJoinButton(interaction);
      } else {
        console.warn(`[ButtonHandler] 알 수 없는 음성 채널 버튼: ${customId}`);
      }
      
    } catch (error) {
      console.error('[ButtonHandler] 음성 채널 버튼 처리 오류:', error);
      
      // 10062 에러는 별도 처리
      if (error.code === 10062) {
        console.warn('[ButtonHandler] 만료된 인터랙션 - 에러 응답 생략');
        return;
      }
      
      await SafeInteraction.safeReply(interaction, 
        SafeInteraction.createErrorResponse('음성 채널 버튼 처리', error)
      );
    } finally {
      // 처리 완료 표시
      SafeInteraction.finishProcessing(interaction);
    }
  }
  
  /**
   * 관전 모드 버튼 처리
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Promise<void>}
   */
  async handleSpectateButton(interaction) {
    // 즉시 defer하여 3초 제한 해결
    await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    
    const customId = interaction.customId;
    let channelInfo = '';
    
    // 범용 버튼인지 확인
    if (customId === 'general_spectate') {
      channelInfo = '🎮 일반 구인구직';
    } else {
      const voiceChannelId = customId.split('_')[2];
      let voiceChannel = null;
      let channelName = '삭제된 채널';
      
      // 안전한 채널 fetch
      try {
        voiceChannel = await interaction.client.channels.fetch(voiceChannelId);
        if (voiceChannel) {
          channelName = voiceChannel.name;
        }
      } catch (error) {
        console.warn(`[ButtonHandler] 채널 fetch 실패 (삭제된 채널일 수 있음): ${voiceChannelId}`);
      }
      
      channelInfo = `🔊 음성 채널: **${channelName}**`;
    }

    const member = interaction.member;
    const result = await this.voiceChannelManager.setSpectatorMode(member);
    
    if (result.success) {
      await interaction.editReply({
        content: `${RecruitmentConfig.MESSAGES.SPECTATOR_MODE_SET}\n${channelInfo}\n📝 닉네임: "${result.newNickname}"`
      });
    } else if (result.alreadySpectator) {
      await interaction.editReply({
        content: RecruitmentConfig.MESSAGES.ALREADY_SPECTATOR
      });
    } else {
      await interaction.editReply({
        content: `${RecruitmentConfig.MESSAGES.NICKNAME_CHANGE_FAILED}\n${channelInfo}\n💡 수동으로 닉네임을 "${result.newNickname}"로 변경해주세요.`
      });
    }
  }
  
  /**
   * 참여하기 버튼 처리
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Promise<void>}
   */
  async handleConnectButton(interaction) {
    // 즉시 defer하여 3초 제한 해결
    await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    
    const voiceChannelId = interaction.customId.split('_')[2];
    let voiceChannel = null;
    let channelName = '삭제된 채널';
    
    // 안전한 채널 fetch
    try {
      voiceChannel = await interaction.client.channels.fetch(voiceChannelId);
      if (voiceChannel) {
        channelName = voiceChannel.name;
      }
    } catch (error) {
      console.warn(`[ButtonHandler] 채널 fetch 실패 (삭제된 채널일 수 있음): ${voiceChannelId}`);
    }

    const member = interaction.member;
    const result = await this.voiceChannelManager.restoreNormalMode(member);
    
    if (result.success) {
      await interaction.editReply({
        content: `✅ 참여 모드로 설정되었습니다!\n🔊 음성 채널: **${channelName}**\n📝 닉네임: "${result.newNickname}"`
      });
    } else if (result.alreadyNormal) {
      await interaction.editReply({
        content: '이미 참여 모드입니다.'
      });
    } else {
      await interaction.editReply({
        content: `닉네임 변경에 실패했습니다.\n🔊 음성 채널: **${channelName}**\n💡 수동으로 닉네임을 "${result.newNickname}"로 변경해주세요.`
      });
    }
  }
  
  /**
   * 대기하기 버튼 처리
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Promise<void>}
   */
  async handleWaitButton(interaction) {
    // 즉시 defer하여 3초 제한 해결
    await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    
    const customId = interaction.customId;
    let channelInfo = '';
    
    // 범용 버튼인지 확인
    if (customId === 'general_wait') {
      channelInfo = '🎮 일반 구인구직';
    } else {
      const voiceChannelId = customId.split('_')[2];
      let voiceChannel = null;
      let channelName = '삭제된 채널';
      
      // 안전한 채널 fetch
      try {
        voiceChannel = await interaction.client.channels.fetch(voiceChannelId);
        if (voiceChannel) {
          channelName = voiceChannel.name;
        }
      } catch (error) {
        console.warn(`[ButtonHandler] 채널 fetch 실패 (삭제된 채널일 수 있음): ${voiceChannelId}`);
      }
      
      channelInfo = `🔊 음성 채널: **${channelName}**`;
    }

    const member = interaction.member;
    const result = await this.voiceChannelManager.setWaitingMode(member);
    
    if (result.success) {
      await interaction.editReply({
        content: `⏳ 대기 모드로 설정되었습니다!\n${channelInfo}\n📝 닉네임: "${result.newNickname}"`
      });
    } else if (result.alreadyWaiting) {
      await interaction.editReply({
        content: '이미 대기 모드입니다.'
      });
    } else {
      await interaction.editReply({
        content: `닉네임 변경에 실패했습니다.\n${channelInfo}\n💡 수동으로 닉네임을 "${result.newNickname}"로 변경해주세요.`
      });
    }
  }
  
  // 닫기 버튼 처리 비활성화 (임시)
  // /**
  //  * 포스트 닫기 버튼 처리
  //  * @param {ButtonInteraction} interaction - 버튼 인터랙션
  //  * @returns {Promise<void>}
  //  */
  // async handleCloseButton(interaction) {
  //   // 즉시 defer하여 3초 제한 해결
  //   await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
  //   
  //   try {
  //     // 현재 포스트가 포럼 스레드인지 확인
  //     if (!interaction.channel || !interaction.channel.isThread()) {
  //       await interaction.editReply({
  //         content: RecruitmentConfig.MESSAGES.CLOSE_POST_FAILED + '\n포럼 포스트에서만 사용할 수 있습니다.'
  //       });
  //       return;
  //     }

  //     const postId = interaction.channel.id;
  //     
  //     // RecruitmentService를 통해 ForumPostManager에 접근하여 포스트 아카이빙
  //     const archiveSuccess = await this.recruitmentService.forumPostManager.archivePost(
  //       postId, 
  //       RecruitmentConfig.MESSAGES.CLOSE_POST_REASON
  //     );

  //     if (archiveSuccess) {
  //       await interaction.editReply({
  //         content: RecruitmentConfig.MESSAGES.CLOSE_POST_SUCCESS
  //       });
  //       console.log(`[ButtonHandler] 포스트 닫기 성공: ${postId}`);
  //     } else {
  //       await interaction.editReply({
  //         content: RecruitmentConfig.MESSAGES.CLOSE_POST_FAILED
  //       });
  //       console.warn(`[ButtonHandler] 포스트 닫기 실패: ${postId}`);
  //     }
  //     
  //   } catch (error) {
  //     console.error('[ButtonHandler] 포스트 닫기 오류:', error);
  //     await interaction.editReply({
  //       content: RecruitmentConfig.MESSAGES.CLOSE_POST_FAILED + '\n오류가 발생했습니다.'
  //     });
  //   }
  // }
  
  /**
   * 초기화 버튼 처리
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Promise<void>}
   */
  async handleResetButton(interaction) {
    // 즉시 defer하여 3초 제한 해결
    await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    
    const customId = interaction.customId;
    let channelInfo = '';
    
    // 범용 버튼인지 확인
    if (customId === 'general_reset') {
      channelInfo = '🎮 일반 구인구직';
    } else {
      const voiceChannelId = customId.split('_')[2];
      let voiceChannel = null;
      let channelName = '삭제된 채널';
      
      // 안전한 채널 fetch
      try {
        voiceChannel = await interaction.client.channels.fetch(voiceChannelId);
        if (voiceChannel) {
          channelName = voiceChannel.name;
        }
      } catch (error) {
        console.warn(`[ButtonHandler] 채널 fetch 실패 (삭제된 채널일 수 있음): ${voiceChannelId}`);
      }
      
      channelInfo = `🔊 음성 채널: **${channelName}**`;
    }

    const member = interaction.member;
    const result = await this.voiceChannelManager.restoreNormalMode(member);
    
    if (result.success) {
      await interaction.editReply({
        content: `🔄 닉네임이 초기화되었습니다!\n${channelInfo}\n📝 닉네임: "${result.newNickname}"`
      });
    } else if (result.alreadyNormal) {
      await interaction.editReply({
        content: '이미 정상 모드입니다.'
      });
    } else {
      await interaction.editReply({
        content: `닉네임 초기화에 실패했습니다.\n${channelInfo}\n💡 수동으로 닉네임을 "${result.newNickname}"로 변경해주세요.`
      });
    }
  }
  
  /**
   * 포스트 삭제(닫기) 버튼 처리
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Promise<void>}
   */
  async handleDeleteButton(interaction) {
    // 즉시 defer하여 3초 제한 해결
    await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    
    try {
      // 현재 채널이 포럼 스레드인지 확인
      if (!interaction.channel || !interaction.channel.isThread()) {
        await interaction.editReply({
          content: '❌ 포럼 포스트에서만 사용할 수 있습니다.'
        });
        return;
      }
      
      const postTitle = interaction.channel.name;
      const clickerNickname = interaction.member.displayName;
      
      // 포스트 제목에서 실제 소유자 추출
      const postOwner = TextProcessor.extractOwnerFromTitle(postTitle);
      
      if (!postOwner) {
        await interaction.editReply({
          content: '❌ 포스트 소유자를 확인할 수 없습니다.'
        });
        return;
      }
      
      // 버튼을 클릭한 사용자의 닉네임 정리 (대기/관전 태그 제거)
      const cleanedClickerNickname = TextProcessor.cleanNickname(clickerNickname);

      // 닫기 권한 판별
      // ① 포스트 소유자  ② DEV_ID(무지)  ③ 사장 역할 보유자
      const isOwner = postOwner === cleanedClickerNickname;
      const isDev = config.DEV_ID && interaction.member.id === config.DEV_ID;
      const isSuperAdmin = interaction.member.roles.cache.some(role =>
        SUPER_ADMIN_ROLES.includes(role.name)
      );
      const canClose = isOwner || isDev || isSuperAdmin;

      if (!canClose) {
        await interaction.editReply({
          content: `❌ 포스트를 닫을 권한이 없습니다.\n**포스트 소유자**: ${postOwner}\n**현재 사용자**: ${cleanedClickerNickname}`
        });
        return;
      }

      // 종료 사유 생성 (누가 닫았는지 포함)
      let closeReason;
      if (isOwner) {
        closeReason = `포스트 소유자 [${cleanedClickerNickname}]이(가) 직접 종료`;
      } else if (isDev || isSuperAdmin) {
        closeReason = `관리자 [${cleanedClickerNickname}]이(가) 종료`;
      }

      // 포스트 아카이브 및 잠금 처리
      const postId = interaction.channel.id;
      const archiveSuccess = await this.recruitmentService.forumPostManager.archivePost(
        postId,
        closeReason,
        true
      );

      if (archiveSuccess) {
        await interaction.editReply({
          content: `✅ 포스트가 성공적으로 종료되었습니다.\n📝 **포스트**: ${postTitle}\n👤 **종료자**: ${cleanedClickerNickname}`
        });
        console.log(`[ButtonHandler] 포스트 닫기 성공: ${postId} by ${cleanedClickerNickname} (${isOwner ? '소유자' : '관리자'})`);
      } else {
        await interaction.editReply({
          content: '❌ 포스트 종료에 실패했습니다. 다시 시도해주세요.'
        });
        console.warn(`[ButtonHandler] 포스트 닫기 실패: ${postId}`);
      }
      
    } catch (error) {
      console.error('[ButtonHandler] 포스트 삭제 처리 오류:', error);
      await interaction.editReply({
        content: '❌ 포스트 종료 중 오류가 발생했습니다.'
      });
    }
  }

  /**
   * 참가하기 버튼 처리
   * @param {ButtonInteraction} interaction
   */
  async handleJoinButton(interaction) {
    try {
      const threadId = interaction.customId.replace(
        DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_JOIN,
        ''
      );

      // 사용자 정보 가져오기
      const member = interaction.member;
      const cleanedNickname = TextProcessor.cleanNickname(member.displayName);

      // 데이터베이스에서 참가자 정보 확인
      const databaseManager = this.forumPostManager.databaseManager;
      if (databaseManager) {
        const isAlreadyParticipant = await databaseManager.isParticipant(threadId, member.id);
        if (isAlreadyParticipant) {
          await SafeInteraction.safeReply(interaction, {
            content: '이미 참가 중입니다.',
            ephemeral: true
          });
          return;
        }

        // 데이터베이스에 참가자 추가
        await databaseManager.addParticipant(threadId, member.id, cleanedNickname);
      }

      // 현재 참가자 목록 가져오기 (데이터베이스 우선, 없으면 캐시)
      let participants;
      if (databaseManager) {
        participants = await databaseManager.getParticipantNicknames(threadId) || [];
      } else {
        participants = this.emojiReactionService.previousParticipants.get(threadId) || [];
      }

      // DB에 이미 추가되었으므로 조회된 목록을 그대로 사용
      const updatedParticipants = participants;

      // 캐시 업데이트 (하위 호환성)
      this.emojiReactionService.updateParticipantCache(threadId, updatedParticipants);

      // 데이터베이스에 참가자 목록 저장
      try {
        const databaseManager = this.forumPostManager.databaseManager;
        if (databaseManager) {
          await databaseManager.query(
            `UPDATE post_integrations
             SET participants = $1, updated_at = CURRENT_TIMESTAMP
             WHERE forum_post_id = $2`,
            [JSON.stringify(updatedParticipants), threadId]
          );
          console.log(`[ButtonHandler] 참가자 DB 저장 완료: ${threadId}`);
        }
      } catch (dbError) {
        console.error('[ButtonHandler] 참가자 DB 저장 실패:', dbError);
        // DB 실패해도 메모리 캐시는 유지되므로 봇 작동 계속
      }

      // 참가자 목록 메시지 업데이트
      await this.forumPostManager.sendEmojiParticipantUpdate(
        threadId,
        updatedParticipants,
        '참가'
      );

      // 변경 알림 메시지 전송
      await this.forumPostManager.sendParticipantChangeNotification(
        threadId,
        [cleanedNickname],  // joinedUsers
        []                  // leftUsers
      );

      // 인터랙션 응답 (조용히 처리)
      await SafeInteraction.safeDeferUpdate(interaction);

    } catch (error) {
      console.error('[ButtonHandler] 참가하기 버튼 처리 중 오류:', error);
      await SafeInteraction.safeReply(interaction, {
        content: '❌ 참가 처리 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  }

  /**
   * 참가 취소 버튼 처리
   * @param {ButtonInteraction} interaction
   */
  async handleLeaveButton(interaction) {
    try {
      const threadId = interaction.customId.replace(
        DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_LEAVE,
        ''
      );

      // 사용자 정보 가져오기
      const member = interaction.member;
      const cleanedNickname = TextProcessor.cleanNickname(member.displayName);

      // 데이터베이스에서 참가자 정보 확인
      const databaseManager = this.forumPostManager.databaseManager;
      if (databaseManager) {
        const isParticipant = await databaseManager.isParticipant(threadId, member.id);
        if (!isParticipant) {
          await SafeInteraction.safeReply(interaction, {
            content: '참가 중이 아닙니다.',
            ephemeral: true
          });
          return;
        }

        // 데이터베이스에서 참가자 제거
        await databaseManager.removeParticipant(threadId, member.id);
      }

      // 현재 참가자 목록 가져오기 (데이터베이스 우선, 없으면 캐시)
      let participants;
      if (databaseManager) {
        participants = await databaseManager.getParticipantNicknames(threadId) || [];
      } else {
        participants = this.emojiReactionService.previousParticipants.get(threadId) || [];
      }

      // 참가 취소 처리 (닉네임 제거)
      const updatedParticipants = participants.filter(p => p !== cleanedNickname);

      // 캐시 업데이트 (하위 호환성)
      this.emojiReactionService.updateParticipantCache(threadId, updatedParticipants);

      // 데이터베이스에 참가자 목록 저장
      try {
        const databaseManager = this.forumPostManager.databaseManager;
        if (databaseManager) {
          await databaseManager.query(
            `UPDATE post_integrations
             SET participants = $1, updated_at = CURRENT_TIMESTAMP
             WHERE forum_post_id = $2`,
            [JSON.stringify(updatedParticipants), threadId]
          );
          console.log(`[ButtonHandler] 참가자 DB 저장 완료: ${threadId}`);
        }
      } catch (dbError) {
        console.error('[ButtonHandler] 참가자 DB 저장 실패:', dbError);
        // DB 실패해도 메모리 캐시는 유지되므로 봇 작동 계속
      }

      // 참가자 목록 메시지 업데이트
      await this.forumPostManager.sendEmojiParticipantUpdate(
        threadId,
        updatedParticipants,
        '참가 취소'
      );

      // 변경 알림 메시지 전송
      await this.forumPostManager.sendParticipantChangeNotification(
        threadId,
        [],                  // joinedUsers
        [cleanedNickname]    // leftUsers
      );

      // 인터랙션 응답 (조용히 처리)
      await SafeInteraction.safeDeferUpdate(interaction);

    } catch (error) {
      console.error('[ButtonHandler] 참가 취소 버튼 처리 중 오류:', error);
      await SafeInteraction.safeReply(interaction, {
        content: '❌ 참가 취소 처리 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  }

  /**
   * 미리 모인 멤버 수정 버튼 처리 (모집자 전용)
   * customId 형식: forum_edit_premembers_{threadId}_{recruiterId}
   * @param {ButtonInteraction} interaction
   */
  async handleEditPreMembersButton(interaction) {
    try {
      const withoutPrefix = interaction.customId.replace(
        DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_EDIT_PREMEMBERS, ''
      );
      const underscoreIdx = withoutPrefix.lastIndexOf('_');
      const threadId    = withoutPrefix.slice(0, underscoreIdx);
      const recruiterId = withoutPrefix.slice(underscoreIdx + 1);

      // 모집자 권한 확인
      if (interaction.user.id !== recruiterId) {
        await SafeInteraction.safeReply(interaction, {
          content: '⚠️ 모집자만 멤버를 수정할 수 있습니다.',
          ephemeral: true,
        });
        return;
      }

      const db = this.forumPostManager?.databaseManager;
      const currentParticipants = db
        ? (await db.getParticipants(threadId) ?? [])
        : [];

      const thread = await interaction.client.channels.fetch(threadId).catch(() => null);
      if (!thread) {
        await SafeInteraction.safeReply(interaction, {
          content: '❌ 스레드를 찾을 수 없습니다.',
          ephemeral: true,
        });
        return;
      }

      // ① 모집자에게만 보이는 ephemeral: 현재 참가자 목록을 복사하기 편한 형태로 출력
      const copyText = currentParticipants.length > 0
        ? currentParticipants.map(p => `@${p.nickname}`).join(' ')
        : '(참가자 없음)';

      await SafeInteraction.safeReply(interaction, {
        content: [
          `**📋 현재 참가자 목록** (${currentParticipants.length}명)`,
          `아래를 복사한 후 수정해서 채널에 입력해주세요:`,
          `\`\`\``,
          copyText,
          `\`\`\``,
        ].join('\n'),
        ephemeral: true,
      });

      // ② 스레드에 입력 안내 메시지 전송
      const promptMsg = await thread.send({
        content: [
          `**✏️ 멤버 수정** (<@${interaction.user.id}> 전용)`,
          `수정할 멤버를 **@닉네임** 형식으로 입력해주세요.`,
          `예) \`@무지 @현호\`  ←  비워서 전송하면 전원 제거`,
          `-# 5분 내에 입력이 없으면 자동 취소됩니다.`,
        ].join('\n'),
        allowedMentions: { users: [] },
      });

      // ③ 모집자의 다음 메시지 대기 (5분)
      let collected;
      try {
        collected = await thread.awaitMessages({
          filter: (m) => m.author.id === recruiterId,
          time: 5 * 60 * 1000,
          max: 1,
          errors: ['time'],
        });
      } catch {
        await promptMsg.edit({ content: '⏱️ 시간 초과로 멤버 수정이 취소됐습니다.' }).catch(() => {});
        return;
      }

      const reply = collected.first();

      // ① <@ID> 형식 파싱 (Discord 자동완성으로 선택한 멘션)
      const newUserIds = [...reply.mentions.users.keys()];

      // ② @name 형식 파싱 → guild.members.search()로 ID 해석
      //    (텍스트로 직접 입력한 "@무지 @현호" 처리)
      const rawWithoutMentions = reply.content.replace(/<@!?\d+>/g, '');
      const nameRegex = /@(\S+)/g;
      let nameMatch;
      while ((nameMatch = nameRegex.exec(rawWithoutMentions)) !== null) {
        const name = nameMatch[1];
        try {
          const results = await interaction.guild.members.search({ query: name, limit: 5 });
          const matched = results.find(m => {
            const clean = TextProcessor.cleanNickname(m.displayName || m.user.username);
            return clean === name || m.user.username === name;
          }) ?? results.first();
          if (matched && !newUserIds.includes(matched.id)) {
            newUserIds.push(matched.id);
          }
        } catch { /* 검색 실패 스킵 */ }
      }

      // 안내 메시지 + 입력 메시지 정리
      await promptMsg.delete().catch(() => {});
      await reply.delete().catch(() => {});

      if (!db) {
        await thread.send({ content: '❌ DB 연결 오류로 수정할 수 없습니다.' });
        return;
      }

      const currentIds = currentParticipants.map(p => p.userId);
      const toAdd    = newUserIds.filter(id => !currentIds.includes(id));
      const toRemove = currentIds.filter(id => !newUserIds.includes(id));

      for (const userId of toAdd) {
        try {
          const member = await interaction.guild.members.fetch(userId);
          const nickname = TextProcessor.cleanNickname(member.displayName || member.user.username);
          await db.addParticipant(threadId, userId, nickname);
          await thread.members.add(userId).catch(() => {});
        } catch { /* 스킵 */ }
      }

      for (const userId of toRemove) {
        await db.removeParticipant(threadId, userId).catch(() => {});
      }

      // ④ 이전 참가자 목록 메시지 삭제 후 새 목록 전송 (참가하기 버튼과 동일한 방식)
      const updatedNicknames = await db.getParticipantNicknames(threadId);
      await this.forumPostManager.sendEmojiParticipantUpdate(threadId, updatedNicknames, '멤버수정');

      console.log(`[ButtonHandler] 멤버 수정 완료: threadId=${threadId}, 추가=${toAdd.length}, 제거=${toRemove.length}`);

    } catch (error) {
      console.error('[ButtonHandler] 멤버 수정 버튼 처리 오류:', error);
    }
  }

  /**
   * 미리 모인 멤버 UserSelectMenu 인터랙션 처리
   * customId: premembers_user_select_{threadId}_{recruiterId}
   * @param {UserSelectMenuInteraction} interaction
   */
  async handlePreMembersSelectMenu(interaction) {
    // ① 가장 먼저 deferUpdate — 3초 제한을 15분으로 연장
    await interaction.deferUpdate();

    try {
      const withoutPrefix = interaction.customId.replace(
        DiscordConstants.CUSTOM_ID_PREFIXES.PREMEMBERS_USER_SELECT, ''
      );
      const underscoreIdx = withoutPrefix.lastIndexOf('_');
      const threadId    = withoutPrefix.slice(0, underscoreIdx);
      const recruiterId = withoutPrefix.slice(underscoreIdx + 1);

      // 권한 재확인
      if (interaction.user.id !== recruiterId) {
        await interaction.editReply({ content: '⚠️ 모집자만 수정할 수 있습니다.', components: [] });
        return;
      }

      // interaction.values = Discord 서버가 resolve한 선택된 userId 배열
      const newUserIds = interaction.values;

      const db = this.forumPostManager?.databaseManager;
      if (!db) {
        await interaction.editReply({ content: '❌ DB 연결 오류가 발생했습니다.', components: [] });
        return;
      }

      const currentParticipants = await db.getParticipants(threadId) ?? [];
      const currentIds = currentParticipants.map(p => p.userId);

      const toAdd    = newUserIds.filter(id => !currentIds.includes(id));
      const toRemove = currentIds.filter(id => !newUserIds.includes(id));

      // ② DB 업데이트: 추가
      const thread = await interaction.client.channels.fetch(threadId).catch(() => null);
      for (const userId of toAdd) {
        try {
          const member = await interaction.guild.members.fetch(userId);
          const nickname = TextProcessor.cleanNickname(member.displayName || member.user.username);
          await db.addParticipant(threadId, userId, nickname);
          if (thread) await thread.members.add(userId).catch(() => {});
        } catch { /* 멤버 조회 실패 스킵 */ }
      }

      // ③ DB 업데이트: 제거
      for (const userId of toRemove) {
        await db.removeParticipant(threadId, userId).catch(() => {});
      }

      // ④ 스레드에 갱신된 참가자 목록 전송
      if (thread) {
        const updatedNicknames = await db.getParticipantNicknames(threadId);
        await thread.send(`${formatParticipantList(updatedNicknames)}\n-# (멤버 수정됨)`);
      }

      // ⑤ deferUpdate 이후 완료 결과는 editReply로 전송
      const lines = [
        `✅ **멤버 수정 완료**`,
        toAdd.length > 0    ? `추가: ${toAdd.map(id => `<@${id}>`).join(' ')}`    : null,
        toRemove.length > 0 ? `제거: ${toRemove.map(id => `<@${id}>`).join(' ')}` : null,
        toAdd.length === 0 && toRemove.length === 0 ? `변경사항 없음` : null,
      ].filter(Boolean);

      await interaction.editReply({ content: lines.join('\n'), components: [] });

      console.log(`[ButtonHandler] 멤버 수정 완료: threadId=${threadId}, 추가=${toAdd.length}, 제거=${toRemove.length}`);

    } catch (error) {
      console.error('[ButtonHandler] 멤버 SelectMenu 처리 오류:', error);
      // deferUpdate 이후 에러 시 editReply로 안내
      await interaction.editReply({
        content: '❌ 멤버 수정 처리 중 오류가 발생했습니다.',
        components: [],
      }).catch(() => {});
    }
  }

  /**
   * 버튼 처리 라우팅
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Promise<void>}
   */
  async routeButtonInteraction(interaction) {
    const customId = interaction.customId;
    
    // 역할 태그 관련 버튼
    if (this.isRoleTagButton(customId)) {
      await this.handleRoleTagButtons(interaction);
    }
    // 음성 채널 관련 버튼
    else if (this.isVoiceChannelButton(customId)) {
      await this.handleVoiceChannelButtons(interaction);
    }
    // recruitment_options 버튼 처리 (제외 채널 확인)
    else if (this.isRecruitmentOptionsButton(customId)) {
      await this.handleRecruitmentOptionsButton(interaction);
    }
    else {
      console.warn(`[ButtonHandler] 처리되지 않은 버튼: ${customId}`);
    }
  }
  
  /**
   * 역할 태그 버튼인지 확인
   * @param {string} customId - 커스텀 ID
   * @returns {boolean} - 역할 태그 버튼 여부
   */
  isRoleTagButton(customId) {
    return customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_BUTTON) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_COMPLETE) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_BUTTON) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE) ||
           customId === 'special_longterm_button' ||
           customId === 'special_scrimmage_button';
  }
  
  /**
   * 음성 채널 버튼인지 확인
   * @param {string} customId - 커스텀 ID
   * @returns {boolean} - 음성 채널 버튼 여부
   */
  isVoiceChannelButton(customId) {
    return customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_CONNECT) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_CLOSE) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_SPECTATE) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_WAIT) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_RESET) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_DELETE) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_PARTICIPATE) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_JOIN) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_LEAVE) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_EDIT_PREMEMBERS) ||
           customId === 'general_wait' ||
           customId === 'general_spectate' ||
           customId === 'general_reset' ||
           customId === 'general_close' ||
           customId === 'general_delete';
  }
  
  /**
   * recruitment_options 버튼인지 확인
   * @param {string} customId - 커스텀 ID
   * @returns {boolean} - recruitment_options 버튼 여부
   */
  isRecruitmentOptionsButton(customId) {
    return customId.startsWith('recruitment_options_');
  }
  
  /**
   * recruitment_options 버튼 처리 (제외 채널 확인)
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Promise<void>}
   */
  async handleRecruitmentOptionsButton(interaction) {
    const customId = interaction.customId;
    
    // 버튼 customId에서 채널 ID 추출 (recruitment_options_${channelId} 형식)
    const channelId = customId.split('_')[2];
    
    // 제외 채널 확인
    if (config.EXCLUDED_CHANNELS.includes(channelId)) {
      // 제외 채널에서 오는 버튼은 조용히 무시
      return;
    }
    
    // 제외 채널이 아닌 경우 처리되지 않은 버튼으로 분류
    console.warn(`[ButtonHandler] 처리되지 않은 버튼: ${customId}`);
  }
}