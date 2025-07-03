// src/services/EmojiReactionService.js - 이모지 반응 처리 서비스
import { TextProcessor } from '../utils/TextProcessor.js';

export class EmojiReactionService {
  constructor(client, forumPostManager) {
    this.client = client;
    this.forumPostManager = forumPostManager;
    
    // 감지할 이모지 ID
    this.targetEmojiId = '1319891512573689917';
  }

  /**
   * 이모지 반응 추가 이벤트 처리
   * @param {MessageReaction} reaction - 반응 객체
   * @param {User} user - 반응한 사용자
   * @returns {Promise<void>}
   */
  async handleMessageReactionAdd(reaction, user) {
    try {
      // 봇 자신의 반응은 무시
      if (user.bot) {
        return;
      }

      // 특정 이모지 ID가 아니면 무시
      if (!this.isTargetEmoji(reaction)) {
        return;
      }

      // 포럼 스레드가 아니면 무시
      if (!this.isForumThread(reaction.message.channel)) {
        return;
      }

      console.log(`[EmojiReactionService] 참가 이모지 반응 감지: ${user.displayName || user.username} in ${reaction.message.channel.name}`);

      // 해당 이모지에 반응한 모든 사용자 가져오기
      const participants = await this.getReactionParticipants(reaction);

      // 참가자 목록 메시지 전송 (ForumPostManager를 통해)
      await this.forumPostManager.sendEmojiParticipantUpdate(reaction.message.channel.id, participants, '참가');

    } catch (error) {
      console.error('[EmojiReactionService] 이모지 반응 처리 오류:', error);
    }
  }

  /**
   * 이모지 반응 제거 이벤트 처리
   * @param {MessageReaction} reaction - 반응 객체
   * @param {User} user - 반응을 제거한 사용자
   * @returns {Promise<void>}
   */
  async handleMessageReactionRemove(reaction, user) {
    try {
      // 봇 자신의 반응은 무시
      if (user.bot) {
        return;
      }

      // 특정 이모지 ID가 아니면 무시
      if (!this.isTargetEmoji(reaction)) {
        return;
      }

      // 포럼 스레드가 아니면 무시
      if (!this.isForumThread(reaction.message.channel)) {
        return;
      }

      console.log(`[EmojiReactionService] 참가 이모지 반응 제거 감지: ${user.displayName || user.username} in ${reaction.message.channel.name}`);

      // 해당 이모지에 반응한 모든 사용자 가져오기
      const participants = await this.getReactionParticipants(reaction);

      // 참가자 목록 메시지 전송 (ForumPostManager를 통해)
      await this.forumPostManager.sendEmojiParticipantUpdate(reaction.message.channel.id, participants, '참가');

    } catch (error) {
      console.error('[EmojiReactionService] 이모지 반응 제거 처리 오류:', error);
    }
  }

  /**
   * 대상 이모지인지 확인
   * @param {MessageReaction} reaction - 반응 객체
   * @returns {boolean} - 대상 이모지 여부
   */
  isTargetEmoji(reaction) {
    // 커스텀 이모지인 경우 ID로 확인
    if (reaction.emoji.id) {
      return reaction.emoji.id === this.targetEmojiId;
    }
    
    // 유니코드 이모지인 경우 이름으로 확인 (필요시)
    return false;
  }

  /**
   * 포럼 스레드인지 확인
   * @param {Channel} channel - 채널 객체
   * @returns {boolean} - 포럼 스레드 여부
   */
  isForumThread(channel) {
    return channel && channel.isThread() && channel.parent && channel.parent.type === 15; // GuildForum
  }

  /**
   * 해당 이모지에 반응한 참가자들 가져오기
   * @param {MessageReaction} reaction - 반응 객체
   * @returns {Promise<Array<string>>} - 참가자 닉네임 배열
   */
  async getReactionParticipants(reaction) {
    try {
      // 반응이 부분적으로 로드된 경우 완전히 가져오기
      if (reaction.partial) {
        await reaction.fetch();
      }

      // 반응한 사용자들 가져오기
      const users = await reaction.users.fetch();
      
      // 봇 제외하고 사용자들만 필터링
      const realUsers = users.filter(user => !user.bot);

      // 길드 멤버 정보를 가져와서 닉네임 추출
      const guild = reaction.message.guild;
      const participants = [];

      for (const user of realUsers.values()) {
        try {
          const member = await guild.members.fetch(user.id);
          // 서버 닉네임이 있으면 사용, 없으면 전역 닉네임 사용
          const displayName = member.displayName || user.displayName || user.username;
          // 닉네임 정리 (태그 제거)
          const cleanedName = TextProcessor.cleanNickname(displayName);
          participants.push(cleanedName);
        } catch (error) {
          // 멤버를 가져오지 못한 경우 전역 닉네임 사용
          console.warn(`[EmojiReactionService] 멤버 정보 가져오기 실패: ${user.username}`);
          const cleanedName = TextProcessor.cleanNickname(user.displayName || user.username);
          participants.push(cleanedName);
        }
      }

      return participants;

    } catch (error) {
      console.error('[EmojiReactionService] 참가자 목록 가져오기 오류:', error);
      return [];
    }
  }


  /**
   * 특정 포스트의 특정 메시지에서 이모지 반응 참가자 가져오기
   * @param {string} channelId - 채널 ID
   * @param {string} messageId - 메시지 ID
   * @returns {Promise<Array<string>|null>} - 참가자 닉네임 배열 또는 null
   */
  async getParticipantsFromMessage(channelId, messageId) {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !this.isForumThread(channel)) {
        console.warn(`[EmojiReactionService] 유효하지 않은 포럼 스레드: ${channelId}`);
        return null;
      }

      const message = await channel.messages.fetch(messageId);
      if (!message) {
        console.warn(`[EmojiReactionService] 메시지를 찾을 수 없음: ${messageId}`);
        return null;
      }

      // 해당 이모지 반응 찾기
      const targetReaction = message.reactions.cache.find(reaction => 
        this.isTargetEmoji(reaction)
      );

      if (!targetReaction) {
        console.log(`[EmojiReactionService] 대상 이모지 반응이 없음: ${messageId}`);
        return [];
      }

      return await this.getReactionParticipants(targetReaction);

    } catch (error) {
      console.error('[EmojiReactionService] 메시지에서 참가자 가져오기 오류:', error);
      return null;
    }
  }
}