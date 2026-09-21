// src/ui/buttons/VoiceChannelButtons.js - 음성 채널 버튼 처리
import { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { DiscordConstants } from '../../config/DiscordConstants.js';
import { RecruitmentConfig } from '../../config/RecruitmentConfig.js';
import { SafeInteraction } from '../../utils/SafeInteraction.js';
import { TextProcessor } from '../../utils/TextProcessor.js';
import { config } from '../../config/env.js';
import { logger } from '../../config/logger-termux.js';

export class VoiceChannelButtons {
  constructor(deps) {
    this.voiceChannelManager = deps.voiceChannelManager;
    this.recruitmentService = deps.recruitmentService;
    this.forumPostManager = deps.forumPostManager;
    this.parent = deps.parent;
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
        logger.warn(`[ButtonHandler] 유효하지 않은 인터랙션: ${validation.reason}`);
        return;
      }

      const customId = interaction.customId;
      logger.info(`[ButtonHandler] 음성 채널 버튼 처리: ${customId}`);
      
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
      } else if (customId === DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_DELETE_CONFIRM) {
        await this.handleDeleteConfirmButton(interaction);
      } else if (customId === DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_DELETE_CANCEL) {
        await this.handleDeleteCancelButton(interaction);
      } else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_JOIN)) {
        await this.parent.forumPostButtons.handleJoinButton(interaction);
      } else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_LEAVE)) {
        await this.parent.forumPostButtons.handleLeaveButton(interaction);
      } else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_WAIT)) {
        await this.parent.forumPostButtons.handleForumWaitButton(interaction);
      } else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_EDIT_PREMEMBERS)) {
        await this.parent.preMembersButtons.handleEditPreMembersButton(interaction);
      } else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_MENTION)) {
        await this.parent.forumPostButtons.handleMentionButton(interaction);
      } else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_PARTICIPATE)) {
        // 하위 호환성을 위해 유지 (기존 포스트용)
        await this.parent.forumPostButtons.handleJoinButton(interaction);
      } else {
        logger.warn(`[ButtonHandler] 알 수 없는 음성 채널 버튼: ${customId}`);
      }
      
    } catch (error) {
      logger.error('[ButtonHandler] 음성 채널 버튼 처리 오류', { error: error.message, stack: error.stack });
      
      // 10062 에러는 별도 처리
      if (error.code === 10062) {
        logger.warn('[ButtonHandler] 만료된 인터랙션 - 에러 응답 생략');
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
        logger.warn(`[ButtonHandler] 채널 fetch 실패 (삭제된 채널일 수 있음): ${voiceChannelId}`);
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
      logger.warn(`[ButtonHandler] 채널 fetch 실패 (삭제된 채널일 수 있음): ${voiceChannelId}`);
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
        logger.warn(`[ButtonHandler] 채널 fetch 실패 (삭제된 채널일 수 있음): ${voiceChannelId}`);
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
  //       logger.info(`[ButtonHandler] 포스트 닫기 성공: ${postId}`);
  //     } else {
  //       await interaction.editReply({
  //         content: RecruitmentConfig.MESSAGES.CLOSE_POST_FAILED
  //       });
  //       logger.warn(`[ButtonHandler] 포스트 닫기 실패: ${postId}`);
  //     }
  //     
  //   } catch (error) {
  //     logger.error('[ButtonHandler] 포스트 닫기 오류', { error: error.message, stack: error.stack });
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
        logger.warn(`[ButtonHandler] 채널 fetch 실패 (삭제된 채널일 수 있음): ${voiceChannelId}`);
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
   * 포스트 닫기 버튼 처리 — 권한 확인 후 컨펌창 표시
   * @param {ButtonInteraction} interaction
   */
  async handleDeleteButton(interaction) {
    await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    try {
      if (!interaction.channel?.isThread()) {
        await interaction.editReply({ content: '❌ 포럼 포스트에서만 사용할 수 있습니다.' });
        return;
      }

      const postTitle = interaction.channel.name;
      const postOwner = TextProcessor.extractOwnerFromTitle(postTitle);
      if (!postOwner) {
        await interaction.editReply({ content: '❌ 포스트 소유자를 확인할 수 없습니다.' });
        return;
      }

      const cleanedClickerNickname = TextProcessor.cleanNickname(interaction.member.displayName);
      const isOwner = postOwner === cleanedClickerNickname;
      const isDev = config.DEV_ID && interaction.member.id === config.DEV_ID;
      const isSuperAdmin = interaction.member.roles.cache.some(r => r.name === '마왕');

      if (!isOwner && !isDev && !isSuperAdmin) {
        await interaction.editReply({
          content: `❌ 포스트를 닫을 권한이 없습니다.\n**포스트 소유자**: ${postOwner}\n**현재 사용자**: ${cleanedClickerNickname}`
        });
        return;
      }

      // 권한 확인 통과 → 컨펌 버튼 표시
      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_DELETE_CONFIRM)
          .setLabel('✅ 확인')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_DELETE_CANCEL)
          .setLabel('❌ 취소')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        content: `⚠️ **"${postTitle}"** 구직글을 정말 닫으시겠습니까?`,
        components: [confirmRow]
      });

    } catch (error) {
      logger.error('[ButtonHandler] 포스트 닫기 처리 오류', { error: error.message, stack: error.stack });
      await interaction.editReply({ content: '❌ 포스트 종료 중 오류가 발생했습니다.' });
    }
  }

  /**
   * 포스트 닫기 확인 버튼 처리 — 실제 아카이브 실행
   * @param {ButtonInteraction} interaction
   */
  async handleDeleteConfirmButton(interaction) {
    await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    try {
      if (!interaction.channel?.isThread()) {
        await interaction.editReply({ content: '❌ 포럼 포스트에서만 사용할 수 있습니다.', components: [] });
        return;
      }

      const postTitle = interaction.channel.name;
      const postOwner = TextProcessor.extractOwnerFromTitle(postTitle);
      const cleanedClickerNickname = TextProcessor.cleanNickname(interaction.member.displayName);
      const isOwner = postOwner === cleanedClickerNickname;
      const isDev = config.DEV_ID && interaction.member.id === config.DEV_ID;
      const isSuperAdmin = interaction.member.roles.cache.some(r => r.name === '마왕');

      if (!isOwner && !isDev && !isSuperAdmin) {
        await interaction.editReply({ content: '❌ 권한이 없습니다.', components: [] });
        return;
      }

      const closeReason = isOwner
        ? `포스트 소유자 [${cleanedClickerNickname}]이(가) 직접 종료`
        : `관리자 [${cleanedClickerNickname}]이(가) 종료`;

      const postId = interaction.channel.id;
      const archiveSuccess = await this.recruitmentService.forumPostManager.archivePost(postId, closeReason, true);

      if (archiveSuccess) {
        await interaction.editReply({
          content: `✅ 포스트가 종료되었습니다.\n📝 **포스트**: ${postTitle}\n👤 **종료자**: ${cleanedClickerNickname}`,
          components: []
        });
        logger.info(`[ButtonHandler] 포스트 닫기 확인 완료: ${postId} by ${cleanedClickerNickname}`);
      } else {
        await interaction.editReply({ content: '❌ 포스트 종료에 실패했습니다.', components: [] });
      }

    } catch (error) {
      logger.error('[ButtonHandler] 포스트 닫기 확인 처리 오류', { error: error.message, stack: error.stack });
      await interaction.editReply({ content: '❌ 오류가 발생했습니다.', components: [] });
    }
  }

  /**
   * 포스트 닫기 취소 버튼 처리
   * @param {ButtonInteraction} interaction
   */
  async handleDeleteCancelButton(interaction) {
    await SafeInteraction.safeDeferUpdate(interaction);
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
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_WAIT) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_EDIT_PREMEMBERS) ||
           customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_MENTION) ||
           customId === DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_DELETE_CONFIRM ||
           customId === DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_DELETE_CANCEL ||
           customId === 'general_wait' ||
           customId === 'general_spectate' ||
           customId === 'general_reset' ||
           customId === 'general_close' ||
           customId === 'general_delete';
  }
}

