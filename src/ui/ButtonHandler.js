// src/ui/ButtonHandler.js - 버튼 인터랙션 처리
import { EmbedBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { DiscordConstants } from '../config/DiscordConstants.js';
import { RecruitmentConfig } from '../config/RecruitmentConfig.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';
import { RecruitmentUIBuilder } from './RecruitmentUIBuilder.js';
import { TextProcessor } from '../utils/TextProcessor.js';
import { config } from '../config/env.js';

export class ButtonHandler {
  constructor(voiceChannelManager, recruitmentService, modalHandler, emojiReactionService, forumPostManager) {
    this.voiceChannelManager = voiceChannelManager;
    this.recruitmentService = recruitmentService;
    this.modalHandler = modalHandler;
    this.emojiReactionService = emojiReactionService;
    this.forumPostManager = forumPostManager;
  }

  /**
   * 포럼 스레드의 첫 메시지 가져오기
   * @param {string} threadId - 스레드 ID
   * @returns {Promise<Message|null>}
   */
  async getStarterMessage(threadId) {
    try {
      const thread = await this.forumPostManager.client.channels.fetch(threadId);
      if (!thread || !thread.isThread()) {
        console.warn(`[ButtonHandler] 스레드를 찾을 수 없음: ${threadId}`);
        return null;
      }

      const starterMessage = await thread.fetchStarterMessage();
      return starterMessage;
    } catch (error) {
      console.error('[ButtonHandler] 첫 메시지 가져오기 실패:', error);
      return null;
    }
  }

  /**
   * 역할 태그 버튼 처리 (다중 선택 지원)
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @returns {Promise<void>}
   */
  async handleRoleTagButtons(interaction) {
    try {
      const customId = interaction.customId;

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
           customId === DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE;
  }
  
  /**
   * 완료 버튼 처리
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   * @param {string} customId - 커스텀 ID
   * @returns {Promise<void>}
   */
  async handleCompleteButton(interaction, customId) {
    const selectedTags = this.extractSelectedTags(interaction);

    if (customId === DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE) {
      // 독립 구인구직 모달 표시
      await this.modalHandler.showStandaloneRecruitmentModal(interaction, selectedTags);
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
      selectedRole = customId.split('_')[3];
      isStandalone = true;
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
    const embed = RecruitmentUIBuilder.createRoleTagSelectionEmbed(selectedTags, isStandalone);
    
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
      
      // 소유자와 클릭자 비교
      if (postOwner !== cleanedClickerNickname) {
        await interaction.editReply({
          content: `❌ 포스트 소유자만 닫기가 가능합니다.\n**포스트 소유자**: ${postOwner}\n**현재 사용자**: ${cleanedClickerNickname}`
        });
        return;
      }
      
      // 포스트 아카이브 및 잠금 처리
      const postId = interaction.channel.id;
      const archiveSuccess = await this.recruitmentService.forumPostManager.archivePost(
        postId, 
        '포스트 소유자가 직접 종료',
        true
      );
      
      if (archiveSuccess) {
        await interaction.editReply({
          content: `✅ 포스트가 성공적으로 종료되었습니다.\n📝 **포스트**: ${postTitle}\n👤 **종료자**: ${cleanedClickerNickname}`
        });
        console.log(`[ButtonHandler] 포스트 삭제 성공: ${postId} by ${cleanedClickerNickname}`);
      } else {
        await interaction.editReply({
          content: '❌ 포스트 종료에 실패했습니다. 다시 시도해주세요.'
        });
        console.warn(`[ButtonHandler] 포스트 삭제 실패: ${postId}`);
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
        participants = await databaseManager.getParticipantNicknames(threadId);
      } else {
        participants = this.emojiReactionService.previousParticipants.get(threadId) || [];
        // 참가 처리
        const updatedParticipants = [...participants, cleanedNickname];
        participants = updatedParticipants;
      }

      // 캐시 업데이트 (하위 호환성)
      this.emojiReactionService.updateParticipantCache(threadId, participants);

      // 커스텀 이모지 반응 추가
      try {
        const starterMessage = await this.getStarterMessage(threadId);
        if (starterMessage) {
          const customEmojiId = '1319891512573689917';

          // 기존 반응 확인
          const existingReaction = starterMessage.reactions.cache
            .find(r => r.emoji.id === customEmojiId);

          if (existingReaction) {
            // 이미 반응이 있는 경우, 사용자가 반응했는지 확인
            const users = await existingReaction.users.fetch();
            const hasReacted = users.has(member.id);

            if (!hasReacted) {
              await starterMessage.react(customEmojiId);
              console.log(`[ButtonHandler] 이모지 추가: ${cleanedNickname}`);
            }
          } else {
            // 반응이 없는 경우 추가 (봇이 먼저 추가)
            await starterMessage.react(customEmojiId);
            console.log(`[ButtonHandler] 이모지 추가: ${cleanedNickname}`);
          }
        }
      } catch (emojiError) {
        console.warn('[ButtonHandler] 이모지 추가 실패:', emojiError);
        // 이모지 실패해도 버튼 동작은 계속 진행 (비필수 기능)
      }

      // 참가자 목록 메시지 업데이트
      await this.forumPostManager.sendEmojiParticipantUpdate(
        threadId,
        participants,
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
        participants = await databaseManager.getParticipantNicknames(threadId);
      } else {
        const cachedParticipants = this.emojiReactionService.previousParticipants.get(threadId) || [];
        // 참가 취소 처리
        participants = cachedParticipants.filter(p => p !== cleanedNickname);
      }

      // 캐시 업데이트 (하위 호환성)
      this.emojiReactionService.updateParticipantCache(threadId, participants);

      // 커스텀 이모지 반응 제거
      try {
        const starterMessage = await this.getStarterMessage(threadId);
        if (starterMessage) {
          const customEmojiId = '1319891512573689917';

          // 기존 반응 찾기
          const existingReaction = starterMessage.reactions.cache
            .find(r => r.emoji.id === customEmojiId);

          if (existingReaction) {
            const users = await existingReaction.users.fetch();
            const userReaction = users.get(member.id);

            if (userReaction) {
              await existingReaction.users.remove(member.id);
              console.log(`[ButtonHandler] 이모지 제거: ${cleanedNickname}`);
            }
          }
        }
      } catch (emojiError) {
        console.warn('[ButtonHandler] 이모지 제거 실패:', emojiError);
        // 이모지 실패해도 버튼 동작은 계속 진행 (비필수 기능)
      }

      // 참가자 목록 메시지 업데이트
      await this.forumPostManager.sendEmojiParticipantUpdate(
        threadId,
        participants,
        '참가'
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
           customId === DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE;
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