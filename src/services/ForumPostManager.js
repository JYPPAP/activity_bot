// src/services/ForumPostManager.js - 포럼 포스트 관리
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { DiscordConstants } from '../config/DiscordConstants.js';
import { RecruitmentConfig } from '../config/RecruitmentConfig.js';
import { TextProcessor } from '../utils/TextProcessor.js';
import { formatParticipantList } from '../utils/formatters.js';

export class ForumPostManager {
  constructor(client, forumChannelId, forumTagId, databaseManager = null) {
    this.client = client;
    this.forumChannelId = forumChannelId;
    this.forumTagId = forumTagId;
    this.databaseManager = databaseManager;
  }
  
  /**
   * 포럼 포스트 생성
   * @param {Object} recruitmentData - 구인구직 데이터
   * @param {string} voiceChannelId - 음성 채널 ID (선택사항)
   * @returns {Promise<{success: boolean, postId?: string, error?: string}>} - 생성 결과
   */
  async createForumPost(recruitmentData, voiceChannelId = null) {
    try {
      const forumChannel = await this.client.channels.fetch(this.forumChannelId);
      
      if (!forumChannel || forumChannel.type !== DiscordConstants.CHANNEL_TYPES.GUILD_FORUM) {
        console.error('[ForumPostManager] 포럼 채널을 찾을 수 없거나 올바른 포럼 채널이 아닙니다.');
        return { success: false, error: '포럼 채널을 찾을 수 없습니다' };
      }
      
      const embed = await this.createPostEmbed(recruitmentData, voiceChannelId);
      const title = this.generatePostTitle(recruitmentData);
      
      // 역할 멘션 생성 및 역할 ID 추출
      let roleMentions = '';
      let roleIds = [];
      if (recruitmentData.tags) {
        const guild = forumChannel.guild;
        roleMentions = await TextProcessor.convertTagsToRoleMentions(recruitmentData.tags, guild);
        
        const roleMatches = roleMentions.match(/<@&(\d+)>/g);
        if (roleMatches) {
          roleIds = roleMatches.map(match => match.match(/\d+/)[0]);
        }
      }
      
      // 버튼 구성
      let components = [];
      
      if (voiceChannelId) {
        // 음성 채널 연동된 경우: 음성 채널 버튼 사용
        const voiceChannelButtons = this.createVoiceChannelButtons(voiceChannelId);
        components.push(voiceChannelButtons);
      } else {
        // 독립 포럼 포스트: 범용 별명 변경 버튼 사용
        const generalButtons = this.createGeneralNicknameButtons();
        components.push(generalButtons);
      }
      
      const messageOptions = { 
        content: roleMentions && roleIds.length > 0 ? roleMentions : undefined,  // 역할 멘션만
        embeds: [embed],
        components: components,
        allowedMentions: { 
          roles: roleIds 
        }
      };
      
      const thread = await forumChannel.threads.create({
        name: title,
        message: messageOptions,
        appliedTags: this.forumTagId ? [this.forumTagId] : undefined,
        autoArchiveDuration: 1440
      });
      
      // 모집자를 스레드에 자동으로 추가
      try {
        await thread.members.add(recruitmentData.author.id);
        console.log(`[ForumPostManager] 모집자가 스레드에 추가됨: ${recruitmentData.author.displayName}`);
      } catch (addError) {
        console.warn('[ForumPostManager] 모집자를 스레드에 추가하는데 실패:', addError.message);
      }
      
      // 음성 채널이 있으면 별도 메시지로 네이티브 링크 추가
      if (voiceChannelId) {
        try {
          const voiceChannel = await this.client.channels.fetch(voiceChannelId);
          if (voiceChannel) {
            await thread.send(`🔊 **음성 채널**: https://discord.com/channels/${voiceChannel.guild.id}/${voiceChannelId}`);
            console.log(`[ForumPostManager] 음성 채널 링크 메시지 추가됨: ${voiceChannel.name}`);
          }
        } catch (linkError) {
          console.warn('[ForumPostManager] 음성 채널 링크 메시지 추가 실패:', linkError.message);
        }
      }
      
      // 참가 안내 메시지 추가
      try {
        const participationGuide = 
          '<:GAP_2:1319891512573689917> 이모지를 누르면 실시간으로 참가자 목록이 업데이트됩니다.';
        
        await thread.send(participationGuide);
        console.log(`[ForumPostManager] 참가 안내 메시지 추가됨: ${thread.name}`);
      } catch (guideError) {
        console.warn('[ForumPostManager] 참가 안내 메시지 추가 실패:', guideError.message);
      }
      
      console.log(`[ForumPostManager] 포럼 포스트 생성 완료: ${thread.name} (ID: ${thread.id})`);
      return { success: true, postId: thread.id };
      
    } catch (error) {
      console.error('[ForumPostManager] 포럼 포스트 생성 오류:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * 포럼 포스트 제목 생성
   * @param {Object} recruitmentData - 구인구직 데이터
   * @returns {string} - 생성된 제목
   */
  generatePostTitle(recruitmentData) {
    // 서버 멤버 객체면 서버 닉네임 사용, 아니면 전역명 사용
    const displayName = recruitmentData.author.displayName || recruitmentData.author.username;
    const cleanedNickname = TextProcessor.cleanNickname(displayName);
    return `[${cleanedNickname}] ${recruitmentData.title}`;
  }
  
  /**
   * 포럼 포스트 임베드 생성
   * @param {Object} recruitmentData - 구인구직 데이터
   * @param {string} voiceChannelId - 음성 채널 ID (선택사항)
   * @returns {Promise<EmbedBuilder>} - 생성된 임베드
   */
  async createPostEmbed(recruitmentData, voiceChannelId = null) {
    let content = `# 🎮 ${recruitmentData.title}\n\n`;
    
    // embed에 역할 멘션 표시
    if (recruitmentData.tags) {
      const guild = this.client.guilds.cache.first();
      const roleMentions = await TextProcessor.convertTagsToRoleMentions(recruitmentData.tags, guild);
      content += `## 🏷️ 태그\n${roleMentions}\n\n`;
    }
    
    content += `## 📝 상세 설명\n${recruitmentData.description}\n\n`;
    
    content += `## 👤 모집자\n<@${recruitmentData.author.id}>`;
    
    const embed = new EmbedBuilder()
      .setDescription(content)
      .setColor(voiceChannelId ? RecruitmentConfig.COLORS.SUCCESS : RecruitmentConfig.COLORS.STANDALONE_POST)
      .setFooter({
        text: voiceChannelId ? '음성 채널과 연동된 구인구직입니다.' : '음성 채널에서 "구인구직 연동하기" 버튼을 클릭하여 연결하세요.',
        iconURL: recruitmentData.author.displayAvatarURL()
      });
    
    return embed;
  }
  
  /**
   * 음성 채널 상호작용 버튼 생성
   * @param {string} voiceChannelId - 음성 채널 ID
   * @returns {ActionRowBuilder} - 생성된 버튼 행
   */
  createVoiceChannelButtons(voiceChannelId) {
    // 닫기 버튼 비활성화 (임시)
    // const closeButton = new ButtonBuilder()
    //   .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_CLOSE}${voiceChannelId}`)
    //   .setLabel(`${DiscordConstants.EMOJIS.CLOSE} 닫기`)
    //   .setStyle(ButtonStyle.Danger);

    const spectateButton = new ButtonBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_SPECTATE}${voiceChannelId}`)
      .setLabel(`${DiscordConstants.EMOJIS.SPECTATOR} 관전`)
      .setStyle(ButtonStyle.Secondary);

    const waitButton = new ButtonBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_WAIT}${voiceChannelId}`)
      .setLabel('⏳ 대기')
      .setStyle(ButtonStyle.Success);

    const resetButton = new ButtonBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_RESET}${voiceChannelId}`)
      .setLabel(`${DiscordConstants.EMOJIS.RESET} 초기화`)
      .setStyle(ButtonStyle.Primary);

    const deleteButton = new ButtonBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_DELETE}${voiceChannelId}`)
      .setLabel(`${DiscordConstants.EMOJIS.CLOSE} 닫기`)
      .setStyle(ButtonStyle.Danger);

    return new ActionRowBuilder().addComponents(spectateButton, waitButton, resetButton, deleteButton);
  }
  
  /**
   * 범용 별명 변경 버튼 생성 (채널 ID 없음)
   * @returns {ActionRowBuilder} - 생성된 버튼 행
   */
  createGeneralNicknameButtons() {
    // 닫기 버튼 비활성화 (임시)
    // const closeButton = new ButtonBuilder()
    //   .setCustomId('general_close')
    //   .setLabel(`${DiscordConstants.EMOJIS.CLOSE} 닫기`)
    //   .setStyle(ButtonStyle.Danger);

    const spectateButton = new ButtonBuilder()
      .setCustomId('general_spectate')
      .setLabel(`${DiscordConstants.EMOJIS.SPECTATOR} 관전`)
      .setStyle(ButtonStyle.Secondary);

    const waitButton = new ButtonBuilder()
      .setCustomId('general_wait')
      .setLabel('⏳ 대기')
      .setStyle(ButtonStyle.Success);

    const resetButton = new ButtonBuilder()
      .setCustomId('general_reset')
      .setLabel(`${DiscordConstants.EMOJIS.RESET} 초기화`)
      .setStyle(ButtonStyle.Primary);

    const deleteButton = new ButtonBuilder()
      .setCustomId('general_delete')
      .setLabel(`${DiscordConstants.EMOJIS.CLOSE} 닫기`)
      .setStyle(ButtonStyle.Danger);

    return new ActionRowBuilder().addComponents(spectateButton, waitButton, resetButton, deleteButton);
  }
  
  /**
   * 포럼 포스트에 참여자 수 업데이트 메시지 전송
   * @param {string} postId - 포스트 ID
   * @param {number} currentCount - 현재 참여자 수
   * @param {number|string} maxCount - 최대 참여자 수 (숫자 또는 'N'/'n')
   * @param {string} voiceChannelName - 음성 채널 이름
   * @returns {Promise<boolean>} - 성공 여부
   */
  async sendParticipantUpdateMessage(postId, currentCount, maxCount, voiceChannelName) {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread() || thread.archived) {
        console.warn(`[ForumPostManager] 스레드를 찾을 수 없거나 아카이브됨: ${postId}`);
        return false;
      }
      
      // 이전 참여자 수 메시지들 삭제
      await this._deleteTrackedMessages(postId, 'participant_count');
      
      const timeString = TextProcessor.formatKoreanTime();
      const updateMessage = `# 👥 현재 참여자: ${currentCount}/${maxCount}명\n**⏰ 업데이트**: ${timeString}`;
      
      const sentMessage = await thread.send(updateMessage);
      
      // 새 메시지 추적 저장
      await this._trackMessage(postId, 'participant_count', sentMessage.id);
      
      console.log(`[ForumPostManager] 참여자 수 업데이트 메시지 전송 완료: ${postId} (${currentCount}/${maxCount})`);
      return true;
      
    } catch (error) {
      console.error(`[ForumPostManager] 참여자 수 업데이트 메시지 전송 실패: ${postId}`, error);
      return false;
    }
  }
  
  /**
   * 포럼 포스트에 음성 채널 연동 메시지 전송
   * @param {string} postId - 포스트 ID
   * @param {string} voiceChannelName - 음성 채널 이름
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {string} guildId - 길드 ID
   * @param {string} linkerId - 연동한 사용자 ID
   * @returns {Promise<boolean>} - 성공 여부
   */
  async sendVoiceChannelLinkMessage(postId, voiceChannelName, voiceChannelId, guildId, linkerId) {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread() || thread.archived) {
        console.warn(`[ForumPostManager] 스레드를 찾을 수 없거나 아카이브됨: ${postId}`);
        return false;
      }
      
      const linkEmbed = new EmbedBuilder()
        .setTitle('🔊 음성 채널 연동')
        .setDescription('새로운 음성 채널이 이 구인구직에 연동되었습니다!')
        .addFields(
          { name: '👤 연동자', value: `<@${linkerId}>`, inline: true }
        )
        .setColor(RecruitmentConfig.COLORS.SUCCESS)
        .setTimestamp();
      
      // Embed와 별도로 네이티브 채널 링크 전송
      await thread.send({ embeds: [linkEmbed] });
      await thread.send(`🔊 **음성 채널**: https://discord.com/channels/${guildId}/${voiceChannelId}`);
      console.log(`[ForumPostManager] 음성 채널 연동 메시지 전송 완료: ${postId}`);
      return true;
      
    } catch (error) {
      console.error(`[ForumPostManager] 음성 채널 연동 메시지 전송 실패: ${postId}`, error);
      return false;
    }
  }
  
  /**
   * 기존 포럼 포스트 목록 가져오기
   * @param {number} limit - 가져올 포스트 수 (기본값: 10)
   * @returns {Promise<Array>} - 포스트 목록
   */
  async getExistingPosts(limit = 10) {
    try {
      const forumChannel = await this.client.channels.fetch(this.forumChannelId);
      
      if (!forumChannel || forumChannel.type !== DiscordConstants.CHANNEL_TYPES.GUILD_FORUM) {
        console.error('[ForumPostManager] 포럼 채널을 찾을 수 없습니다.');
        return [];
      }
      
      // 활성 스레드 가져오기
      const threads = await forumChannel.threads.fetchActive();
      const recentPosts = Array.from(threads.threads.values())
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
        .slice(0, limit);
      
      return recentPosts.map(thread => ({
        id: thread.id,
        name: thread.name,
        messageCount: thread.messageCount,
        memberCount: thread.memberCount,
        createdAt: thread.createdAt,
        lastMessageId: thread.lastMessageId
      }));
      
    } catch (error) {
      console.error('[ForumPostManager] 기존 포스트 목록 가져오기 실패:', error);
      return [];
    }
  }
  
  /**
   * 포럼 포스트 아카이브 처리
   * @param {string} postId - 포스트 ID
   * @param {string} reason - 아카이브 사유
   * @param {boolean} lockThread - 스레드 잠금 여부 (기본값: true)
   * @returns {Promise<boolean>} - 성공 여부
   */
  async archivePost(postId, reason = '음성 채널 삭제됨', lockThread = true) {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread()) {
        console.warn(`[ForumPostManager] 스레드를 찾을 수 없음: ${postId}`);
        return false;
      }
      
      if (thread.archived) {
        console.log(`[ForumPostManager] 이미 아카이브된 스레드: ${postId}`);
        return true;
      }
      
      // 아카이브 메시지 전송
      const archiveEmbed = new EmbedBuilder()
        .setTitle('🔒 구인구직 종료')
        .setDescription(`이 구인구직이 자동으로 종료되었습니다.\n**사유**: ${reason}\n\n${lockThread ? '📝 이 포스트는 잠금 처리되어 더 이상 메시지를 작성할 수 없습니다.' : ''}`)
        .setColor(RecruitmentConfig.COLORS.WARNING)
        .setTimestamp();
      
      await thread.send({ embeds: [archiveEmbed] });
      
      // 스레드 잠금 (옵션)
      if (lockThread && !thread.locked) {
        try {
          await thread.setLocked(true, reason);
          console.log(`[ForumPostManager] 스레드 잠금 완료: ${postId}`);
        } catch (lockError) {
          console.error(`[ForumPostManager] 스레드 잠금 실패: ${postId}`, lockError);
          // 잠금 실패해도 아카이브는 계속 진행
        }
      }
      
      // 스레드 아카이브
      await thread.setArchived(true, reason);
      
      console.log(`[ForumPostManager] 포럼 포스트 아카이브 완료: ${postId} (${reason})`);
      return true;
      
    } catch (error) {
      console.error(`[ForumPostManager] 포럼 포스트 아카이브 실패: ${postId}`, error);
      return false;
    }
  }
  
  /**
   * 포럼 포스트 존재 여부 확인
   * @param {string} postId - 포스트 ID
   * @returns {Promise<boolean>} - 존재 여부
   */
  async postExists(postId) {
    try {
      const thread = await this.client.channels.fetch(postId);
      return thread && thread.isThread() && !thread.archived;
    } catch (error) {
      if (error.code === 10003) { // Unknown Channel
        return false;
      }
      console.error(`[ForumPostManager] 포스트 존재 확인 실패: ${postId}`, error);
      return false;
    }
  }
  
  /**
   * 포럼 포스트 정보 가져오기
   * @param {string} postId - 포스트 ID
   * @returns {Promise<Object|null>} - 포스트 정보
   */
  async getPostInfo(postId) {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread()) {
        return null;
      }
      
      return {
        id: thread.id,
        name: thread.name,
        archived: thread.archived,
        messageCount: thread.messageCount,
        memberCount: thread.memberCount,
        createdAt: thread.createdAt,
        lastMessageId: thread.lastMessageId,
        ownerId: thread.ownerId
      };
      
    } catch (error) {
      console.error(`[ForumPostManager] 포스트 정보 가져오기 실패: ${postId}`, error);
      return null;
    }
  }

  /**
   * 포럼 포스트에 참가자 목록 메시지 전송
   * @param {string} postId - 포스트 ID
   * @param {Array<string>} participants - 참가자 닉네임 배열
   * @returns {Promise<boolean>} - 성공 여부
   */
  async sendParticipantList(postId, participants) {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread()) {
        console.warn(`[ForumPostManager] 스레드를 찾을 수 없음: ${postId}`);
        return false;
      }
      
      if (thread.archived) {
        console.warn(`[ForumPostManager] 아카이브된 스레드: ${postId}`);
        return false;
      }
      
      // 참가자 목록 포맷팅
      const participantListText = formatParticipantList(participants);
      
      // 메시지 전송
      await thread.send(participantListText);
      
      console.log(`[ForumPostManager] 참가자 목록 메시지 전송 완료: ${postId} (${participants.length}명)`);
      return true;
      
    } catch (error) {
      console.error(`[ForumPostManager] 참가자 목록 메시지 전송 실패: ${postId}`, error);
      return false;
    }
  }

  /**
   * 포럼 포스트에 참가자 수 업데이트 메시지 전송 (이모지 반응 기반)
   * @param {string} postId - 포스트 ID
   * @param {Array<string>} participants - 참가자 닉네임 배열
   * @param {string} emojiName - 이모지 이름 (기본값: '참가')
   * @returns {Promise<boolean>} - 성공 여부
   */
  async sendEmojiParticipantUpdate(postId, participants, emojiName = '참가') {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread()) {
        console.warn(`[ForumPostManager] 스레드를 찾을 수 없음: ${postId}`);
        return false;
      }
      
      if (thread.archived) {
        console.warn(`[ForumPostManager] 아카이브된 스레드: ${postId}`);
        return false;
      }
      
      // 이전 이모지 반응 메시지들 삭제
      await this._deleteTrackedMessages(postId, 'emoji_reaction');

      const timeString = TextProcessor.formatKoreanTime();
      const participantListText = formatParticipantList(participants);
      const updateMessage = `${participantListText}\n**⏰ 업데이트**: ${timeString}`;
      
      const sentMessage = await thread.send(updateMessage);
      
      // 새 메시지 추적 저장
      await this._trackMessage(postId, 'emoji_reaction', sentMessage.id);
      
      console.log(`[ForumPostManager] 이모지 참가자 현황 업데이트 완료: ${postId} (${participants.length}명)`);
      return true;
      
    } catch (error) {
      console.error(`[ForumPostManager] 이모지 참가자 현황 업데이트 실패: ${postId}`, error);
      return false;
    }
  }

  // ======== 프라이빗 메서드: 메시지 추적 및 삭제 ========

  /**
   * 추적된 메시지들 삭제
   * @param {string} threadId - 스레드 ID
   * @param {string} messageType - 메시지 타입
   * @returns {Promise<boolean>} - 성공 여부
   * @private
   */
  async _deleteTrackedMessages(threadId, messageType) {
    if (!this.databaseManager) {
      console.warn('[ForumPostManager] DatabaseManager가 설정되지 않음');
      return false;
    }

    try {
      // 데이터베이스에서 추적된 메시지 ID들 가져오기
      const messageIds = await this.databaseManager.getTrackedMessages(threadId, messageType);
      
      if (messageIds.length === 0) {
        return true; // 삭제할 메시지가 없음
      }

      // 스레드 가져오기
      const thread = await this.client.channels.fetch(threadId);
      if (!thread || !thread.isThread()) {
        console.warn(`[ForumPostManager] 스레드를 찾을 수 없음: ${threadId}`);
        return false;
      }

      let deletedCount = 0;
      
      // 각 메시지 삭제 시도
      for (const messageId of messageIds) {
        try {
          const message = await thread.messages.fetch(messageId);
          if (message) {
            await message.delete();
            deletedCount++;
            console.log(`[ForumPostManager] 메시지 삭제 완료: ${messageId}`);
          }
        } catch (deleteError) {
          if (deleteError.code === 10008) { // Unknown Message
            console.log(`[ForumPostManager] 메시지가 이미 삭제됨: ${messageId}`);
          } else {
            console.warn(`[ForumPostManager] 메시지 삭제 실패: ${messageId}`, deleteError.message);
          }
        }
      }

      // 데이터베이스에서 추적 정보 삭제
      await this.databaseManager.clearTrackedMessages(threadId, messageType);
      
      console.log(`[ForumPostManager] 추적된 메시지 삭제 완료: ${threadId}, ${messageType}, ${deletedCount}/${messageIds.length}개`);
      return true;

    } catch (error) {
      console.error(`[ForumPostManager] 추적된 메시지 삭제 오류: ${threadId}, ${messageType}`, error);
      return false;
    }
  }

  /**
   * 메시지 추적 저장
   * @param {string} threadId - 스레드 ID
   * @param {string} messageType - 메시지 타입
   * @param {string} messageId - 메시지 ID
   * @returns {Promise<boolean>} - 성공 여부
   * @private
   */
  async _trackMessage(threadId, messageType, messageId) {
    if (!this.databaseManager) {
      console.warn('[ForumPostManager] DatabaseManager가 설정되지 않음');
      return false;
    }

    try {
      await this.databaseManager.trackForumMessage(threadId, messageType, messageId);
      console.log(`[ForumPostManager] 메시지 추적 저장: ${threadId}, ${messageType}, ${messageId}`);
      return true;
    } catch (error) {
      console.error(`[ForumPostManager] 메시지 추적 저장 오류: ${threadId}, ${messageType}, ${messageId}`, error);
      return false;
    }
  }
}