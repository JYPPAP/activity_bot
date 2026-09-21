import { EmbedBuilder } from 'discord.js';
import { RecruitmentConfig } from '../../config/RecruitmentConfig.js';
import { TextProcessor } from '../../utils/TextProcessor.js';
import { formatParticipantList, formatParticipantChangeMessage, formatWaitlist } from '../../utils/formatters.js';
import { logger } from '../../config/logger-termux.js';

export class ForumPostNotifier {
  constructor(deps) {
    this.client = deps.client;
    this.forumChannelId = deps.forumChannelId;
    this.forumTagId = deps.forumTagId;
    this.databaseManager = deps.databaseManager;
    this.parent = deps.parent;
  }

  async sendParticipantUpdateMessage(postId, currentCount, maxCount, voiceChannelName) {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread() || thread.archived) {
        logger.warn(`[ForumPostManager] 스레드를 찾을 수 없거나 아카이브됨: ${postId}`);
        
        // 아카이브되거나 삭제된 스레드의 연동 정리
        await this.parent.queries._cleanupArchivedThread(postId);
        return false;
      }
      
      // 이전 참여자 수 메시지들 삭제
      await this.parent.tracker._deleteTrackedMessages(postId, 'participant_count');
      
      const timeString = TextProcessor.formatKoreanTime();
      const updateMessage = `# 👥 현재 참여자: ${currentCount}/${maxCount}명\n**⏰ 업데이트**: ${timeString}`;
      
      const sentMessage = await thread.send(updateMessage);
      
      // 새 메시지 추적 저장
      await this.parent.tracker._trackMessage(postId, 'participant_count', sentMessage.id);
      
      logger.info(`[ForumPostManager] 참여자 수 업데이트 메시지 전송 완료: ${postId} (${currentCount}/${maxCount})`);
      return true;
      
    } catch (error) {
      logger.error(`[ForumPostManager] 참여자 수 업데이트 메시지 전송 실패: ${postId}`, { error: error.message, stack: error.stack });
      return false;
    }
  }

  async sendVoiceChannelLinkMessage(postId, voiceChannelName, voiceChannelId, guildId, linkerId) {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread() || thread.archived) {
        logger.warn(`[ForumPostManager] 스레드를 찾을 수 없거나 아카이브됨: ${postId}`);
        
        // 아카이브되거나 삭제된 스레드의 연동 정리
        await this.parent.queries._cleanupArchivedThread(postId);
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
      logger.info(`[ForumPostManager] 음성 채널 연동 메시지 전송 완료: ${postId}`);
      return true;
      
    } catch (error) {
      logger.error(`[ForumPostManager] 음성 채널 연동 메시지 전송 실패: ${postId}`, { error: error.message, stack: error.stack });
      return false;
    }
  }

  async sendParticipantList(postId, participants) {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread()) {
        logger.warn(`[ForumPostManager] 스레드를 찾을 수 없음: ${postId}`);
        return false;
      }
      
      if (thread.archived) {
        logger.warn(`[ForumPostManager] 아카이브된 스레드: ${postId}`);
        return false;
      }
      
      // 참가자 목록 포맷팅
      const participantListText = formatParticipantList(participants);
      
      // 메시지 전송
      await thread.send(participantListText);
      
      logger.info(`[ForumPostManager] 참가자 목록 메시지 전송 완료: ${postId} (${participants.length}명)`);
      return true;
      
    } catch (error) {
      logger.error(`[ForumPostManager] 참가자 목록 메시지 전송 실패: ${postId}`, { error: error.message, stack: error.stack });
      return false;
    }
  }

  async sendEmojiParticipantUpdate(postId, participants, emojiName = '참가') {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread()) {
        logger.warn(`[ForumPostManager] 스레드를 찾을 수 없음: ${postId}`);
        return false;
      }
      
      if (thread.archived) {
        logger.warn(`[ForumPostManager] 아카이브된 스레드: ${postId}`);
        return false;
      }
      
      // 이전 참가자 목록 메시지 삭제 (참가자 멘션 버튼도 함께 삭제됨)
      await this.parent.tracker._deleteTrackedMessages(postId, 'emoji_reaction');

      const timeString = TextProcessor.formatKoreanTime();
      const participantListText = formatParticipantList(participants);
      const updateMessage = `${participantListText}\n**⏰ 업데이트**: ${timeString}`;

      // 새 참가자 목록 메시지 + 참가자 멘션 버튼
      const mentionRow = this.parent.builders.createMentionButton(postId);
      const sentMessage = await thread.send({
        content: updateMessage,
        components: [mentionRow]
      });

      // 새 메시지 추적 저장 (다음 업데이트 시 삭제됨)
      await this.parent.tracker._trackMessage(postId, 'emoji_reaction', sentMessage.id);

      logger.info(`[ForumPostManager] 참가자 목록 업데이트 완료: ${postId} (${participants.length}명)`);
      return true;
      
    } catch (error) {
      logger.error(`[ForumPostManager] 이모지 참가자 현황 업데이트 실패: ${postId}`, { error: error.message, stack: error.stack });
      return false;
    }
  }

  async sendWaitlistUpdate(postId, waitlist = []) {
    try {
      const thread = await this.client.channels.fetch(postId);

      if (!thread || !thread.isThread() || thread.archived) {
        logger.warn(`[ForumPostManager] 대기자 업데이트 불가 — 스레드 없음/아카이브: ${postId}`);
        return false;
      }

      // 기존 대기자 메시지 삭제
      await this.parent.tracker._deleteTrackedMessages(postId, 'waitlist');

      // 대기자가 없으면 메시지 삭제만 하고 종료
      const text = formatWaitlist(waitlist);
      if (!text) {
        logger.info(`[ForumPostManager] 대기자 없음 — 메시지 삭제 완료: ${postId}`);
        return true;
      }

      const sentMessage = await thread.send(text);
      await this.parent.tracker._trackMessage(postId, 'waitlist', sentMessage.id);

      logger.info(`[ForumPostManager] 대기자 목록 업데이트 완료: ${postId} (${waitlist.length}명)`);
      return true;
    } catch (error) {
      logger.error(`[ForumPostManager] 대기자 목록 업데이트 실패: ${postId}`, { error: error.message, stack: error.stack });
      return false;
    }
  }

  async sendParticipantChangeNotification(postId, joinedUsers = [], leftUsers = []) {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread()) {
        logger.warn(`[ForumPostManager] 스레드를 찾을 수 없음: ${postId}`);
        return false;
      }
      
      if (thread.archived) {
        logger.warn(`[ForumPostManager] 아카이브된 스레드: ${postId}`);
        return false;
      }

      // 변화가 없으면 메시지를 보내지 않음
      if (joinedUsers.length === 0 && leftUsers.length === 0) {
        logger.info(`[ForumPostManager] 참가자 변화가 없어 알림 메시지를 보내지 않음: ${postId}`);
        return true;
      }

      // 참가자 변화 메시지 포맷팅
      const changeMessage = formatParticipantChangeMessage(joinedUsers, leftUsers);
      
      // 메시지 전송
      const sentMessage = await thread.send(changeMessage);
      
      // participant_change 타입으로 메시지 추적 (삭제하지 않는 타입)
      await this.parent.tracker._trackMessage(postId, 'participant_change', sentMessage.id);
      
      logger.info(`[ForumPostManager] 참가자 변화 알림 메시지 전송 완료: ${postId} (참가: ${joinedUsers.length}명, 참가 취소: ${leftUsers.length}명)`);
      return true;
      
    } catch (error) {
      logger.error(`[ForumPostManager] 참가자 변화 알림 메시지 전송 실패: ${postId}`, { error: error.message, stack: error.stack });
      return false;
    }
  }
}
