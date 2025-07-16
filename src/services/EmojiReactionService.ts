// src/services/EmojiReactionService.ts - 이모지 반응 처리 서비스
import { Client, MessageReaction, User, Channel, ChannelType } from 'discord.js';

import { TextProcessor } from '../utils/TextProcessor';

// 이모지 반응 통계 인터페이스
interface EmojiReactionStats {
  totalReactions: number;
  uniqueUsers: number;
  averageReactionsPerUser: number;
  topReactors: UserReactionSummary[];
  reactionsByHour: number[];
  reactionsByDay: number[];
}

// 사용자 반응 요약 인터페이스
interface UserReactionSummary {
  userId: string;
  username: string;
  displayName: string;
  reactionCount: number;
  lastReaction: Date;
}

// 참가자 정보 인터페이스
interface ParticipantInfo {
  userId: string;
  username: string;
  displayName: string;
  cleanedName: string;
  joinedAt: Date;
  isActive: boolean;
}

// 이모지 설정 인터페이스
interface EmojiConfig {
  targetEmojiId: string;
  alternativeEmojis: string[];
  enableUnicodeEmojis: boolean;
  unicodeEmojis: string[];
}

// 반응 이벤트 인터페이스
interface ReactionEvent {
  messageId: string;
  channelId: string;
  userId: string;
  emojiId: string;
  type: 'add' | 'remove';
  timestamp: Date;
}

// 포럼 스레드 정보 인터페이스
interface ForumThreadInfo {
  channelId: string;
  threadName: string;
  parentForumId: string;
  participantCount: number;
  lastActivity: Date;
  isActive: boolean;
}

export class EmojiReactionService {
  private client: Client;
  private forumPostManager: any;
  private config: EmojiConfig;
  private reactionStats: Map<string, EmojiReactionStats> = new Map();
  private participantCache: Map<string, ParticipantInfo[]> = new Map();
  private reactionHistory: ReactionEvent[] = [];
  private maxHistorySize: number = 1000;

  constructor(client: Client, forumPostManager: any) {
    this.client = client;
    this.forumPostManager = forumPostManager;

    // 기본 이모지 설정
    this.config = {
      targetEmojiId: '1319891512573689917',
      alternativeEmojis: [],
      enableUnicodeEmojis: false,
      unicodeEmojis: ['👍', '✅', '🙋‍♂️', '🙋‍♀️'],
    };

    // 통계 초기화
    this.initializeStats();
  }

  /**
   * 이모지 반응 추가 이벤트 처리
   * @param reaction - 반응 객체
   * @param user - 반응한 사용자
   */
  async handleMessageReactionAdd(reaction: MessageReaction, user: User): Promise<void> {
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

      console.log(
        `[EmojiReactionService] 참가 이모지 반응 감지: ${user.displayName || user.username} in ${'name' in reaction.message.channel ? reaction.message.channel.name : 'DM'}`
      );

      // 반응 이벤트 기록
      this.recordReactionEvent(reaction, user, 'add');

      // 해당 이모지에 반응한 모든 사용자 가져오기
      const participants = await this.getReactionParticipants(reaction);

      // 참가자 캐시 업데이트
      this.updateParticipantCache(reaction.message.channel.id, participants);

      // 통계 업데이트
      this.updateReactionStats(reaction.message.channel.id, participants);

      // 참가자 목록 메시지 전송 (ForumPostManager를 통해)
      await this.forumPostManager.sendEmojiParticipantUpdate(
        reaction.message.channel.id,
        participants.map((p) => p.cleanedName),
        '참가'
      );

      // 참가자 알림 처리
      await this.handleParticipantNotification(reaction, user, 'join');
    } catch (error) {
      console.error('[EmojiReactionService] 이모지 반응 처리 오류:', error);
    }
  }

  /**
   * 이모지 반응 제거 이벤트 처리
   * @param reaction - 반응 객체
   * @param user - 반응을 제거한 사용자
   */
  async handleMessageReactionRemove(reaction: MessageReaction, user: User): Promise<void> {
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

      console.log(
        `[EmojiReactionService] 참가 이모지 반응 제거 감지: ${user.displayName || user.username} in ${'name' in reaction.message.channel ? reaction.message.channel.name : 'DM'}`
      );

      // 반응 이벤트 기록
      this.recordReactionEvent(reaction, user, 'remove');

      // 해당 이모지에 반응한 모든 사용자 가져오기
      const participants = await this.getReactionParticipants(reaction);

      // 참가자 캐시 업데이트
      this.updateParticipantCache(reaction.message.channel.id, participants);

      // 통계 업데이트
      this.updateReactionStats(reaction.message.channel.id, participants);

      // 참가자 목록 메시지 전송 (ForumPostManager를 통해)
      await this.forumPostManager.sendEmojiParticipantUpdate(
        reaction.message.channel.id,
        participants.map((p) => p.cleanedName),
        '참가'
      );

      // 참가자 알림 처리
      await this.handleParticipantNotification(reaction, user, 'leave');
    } catch (error) {
      console.error('[EmojiReactionService] 이모지 반응 제거 처리 오류:', error);
    }
  }

  /**
   * 대상 이모지인지 확인
   * @param reaction - 반응 객체
   * @returns 대상 이모지 여부
   */
  private isTargetEmoji(reaction: MessageReaction): boolean {
    // 커스텀 이모지인 경우 ID로 확인
    if (reaction.emoji.id) {
      return (
        reaction.emoji.id === this.config.targetEmojiId ||
        this.config.alternativeEmojis.includes(reaction.emoji.id)
      );
    }

    // 유니코드 이모지인 경우 이름으로 확인
    if (this.config.enableUnicodeEmojis && reaction.emoji.name) {
      return this.config.unicodeEmojis.includes(reaction.emoji.name);
    }

    return false;
  }

  /**
   * 포럼 스레드인지 확인
   * @param channel - 채널 객체
   * @returns 포럼 스레드 여부
   */
  private isForumThread(channel: Channel | null): boolean {
    return (
      channel !== null &&
      channel.isThread() &&
      channel.parent !== null &&
      channel.parent.type === ChannelType.GuildForum
    );
  }

  /**
   * 해당 이모지에 반응한 참가자들 가져오기
   * @param reaction - 반응 객체
   * @returns 참가자 정보 배열
   */
  private async getReactionParticipants(reaction: MessageReaction): Promise<ParticipantInfo[]> {
    try {
      // 반응이 부분적으로 로드된 경우 완전히 가져오기
      if (reaction.partial) {
        await reaction.fetch();
      }

      // 반응한 사용자들 가져오기
      const users = await reaction.users.fetch();

      // 봇 제외하고 사용자들만 필터링
      const realUsers = users.filter((user) => !user.bot);

      // 길드 멤버 정보를 가져와서 참가자 정보 구성
      const guild = reaction.message.guild;
      const participants: ParticipantInfo[] = [];

      if (!guild) {
        console.warn('[EmojiReactionService] 길드 정보를 찾을 수 없음');
        return participants;
      }

      for (const user of realUsers.values()) {
        try {
          const member = await guild.members.fetch(user.id);
          // 서버 닉네임이 있으면 사용, 없으면 전역 닉네임 사용
          const displayName = member.displayName || user.displayName || user.username;
          // 닉네임 정리 (태그 제거)
          const cleanedName = TextProcessor.cleanNickname(displayName);

          participants.push({
            userId: user.id,
            username: user.username,
            displayName,
            cleanedName,
            joinedAt: new Date(),
            isActive: true,
          });
        } catch (error) {
          // 멤버를 가져오지 못한 경우 전역 닉네임 사용
          console.warn(`[EmojiReactionService] 멤버 정보 가져오기 실패: ${user.username}`);
          const cleanedName = TextProcessor.cleanNickname(user.displayName || user.username);

          participants.push({
            userId: user.id,
            username: user.username,
            displayName: user.displayName || user.username,
            cleanedName,
            joinedAt: new Date(),
            isActive: false,
          });
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
   * @param channelId - 채널 ID
   * @param messageId - 메시지 ID
   * @returns 참가자 닉네임 배열 또는 null
   */
  async getParticipantsFromMessage(channelId: string, messageId: string): Promise<string[] | null> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !this.isForumThread(channel)) {
        console.warn(`[EmojiReactionService] 유효하지 않은 포럼 스레드: ${channelId}`);
        return null;
      }

      if (!('messages' in channel)) {
        console.warn(`[EmojiReactionService] 채널에 메시지 관리자가 없음: ${channelId}`);
        return null;
      }

      const message = await channel.messages.fetch(messageId);
      if (!message) {
        console.warn(`[EmojiReactionService] 메시지를 찾을 수 없음: ${messageId}`);
        return null;
      }

      // 해당 이모지 반응 찾기
      const targetReaction = message.reactions.cache.find((reaction) =>
        this.isTargetEmoji(reaction)
      );

      if (!targetReaction) {
        console.log(`[EmojiReactionService] 대상 이모지 반응이 없음: ${messageId}`);
        return [];
      }

      const participants = await this.getReactionParticipants(targetReaction);
      return participants.map((p) => p.cleanedName);
    } catch (error) {
      console.error('[EmojiReactionService] 메시지에서 참가자 가져오기 오류:', error);
      return null;
    }
  }

  /**
   * 반응 이벤트 기록
   * @param reaction - 반응 객체
   * @param user - 사용자
   * @param type - 이벤트 타입
   */
  private recordReactionEvent(reaction: MessageReaction, user: User, type: 'add' | 'remove'): void {
    const event: ReactionEvent = {
      messageId: reaction.message.id,
      channelId: reaction.message.channel.id,
      userId: user.id,
      emojiId: reaction.emoji.id || reaction.emoji.name || 'unknown',
      type,
      timestamp: new Date(),
    };

    this.reactionHistory.push(event);

    // 히스토리 크기 제한
    if (this.reactionHistory.length > this.maxHistorySize) {
      this.reactionHistory = this.reactionHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * 참가자 캐시 업데이트
   * @param channelId - 채널 ID
   * @param participants - 참가자 목록
   */
  private updateParticipantCache(channelId: string, participants: ParticipantInfo[]): void {
    this.participantCache.set(channelId, participants);
  }

  /**
   * 반응 통계 업데이트
   * @param channelId - 채널 ID
   * @param participants - 참가자 목록
   */
  private updateReactionStats(channelId: string, participants: ParticipantInfo[]): void {
    const stats = this.reactionStats.get(channelId) || this.createEmptyStats();

    stats.totalReactions = participants.length;
    stats.uniqueUsers = participants.length;
    stats.averageReactionsPerUser = participants.length > 0 ? 1 : 0;

    // 시간별 통계 업데이트
    const currentHour = new Date().getHours();
    stats.reactionsByHour[currentHour]++;

    // 일별 통계 업데이트
    const currentDay = new Date().getDay();
    stats.reactionsByDay[currentDay]++;

    this.reactionStats.set(channelId, stats);
  }

  /**
   * 참가자 알림 처리
   * @param reaction - 반응 객체
   * @param user - 사용자
   * @param action - 액션
   */
  private async handleParticipantNotification(
    reaction: MessageReaction,
    user: User,
    action: 'join' | 'leave'
  ): Promise<void> {
    try {
      if (!this.forumPostManager.shouldSendNotification) {
        return;
      }

      const actionText = action === 'join' ? '참가했습니다' : '참가를 취소했습니다';
      const emoji = action === 'join' ? '✅' : '❌';

      const notificationMessage = `${emoji} **${user.displayName || user.username}**님이 ${actionText}!`;

      await this.forumPostManager.sendNotification(
        reaction.message.channel.id,
        notificationMessage,
        'participant_update'
      );
    } catch (error) {
      console.error('[EmojiReactionService] 참가자 알림 처리 오류:', error);
    }
  }

  /**
   * 통계 초기화
   */
  private initializeStats(): void {
    // 기본 통계 구조 설정
    this.reactionStats.clear();
    this.participantCache.clear();
    this.reactionHistory = [];
  }

  /**
   * 빈 통계 객체 생성
   * @returns 빈 통계 객체
   */
  private createEmptyStats(): EmojiReactionStats {
    return {
      totalReactions: 0,
      uniqueUsers: 0,
      averageReactionsPerUser: 0,
      topReactors: [],
      reactionsByHour: Array(24).fill(0),
      reactionsByDay: Array(7).fill(0),
    };
  }

  /**
   * 채널의 반응 통계 조회
   * @param channelId - 채널 ID
   * @returns 반응 통계
   */
  public getReactionStats(channelId: string): EmojiReactionStats | null {
    return this.reactionStats.get(channelId) || null;
  }

  /**
   * 채널의 참가자 목록 조회
   * @param channelId - 채널 ID
   * @returns 참가자 목록
   */
  public getParticipants(channelId: string): ParticipantInfo[] {
    return this.participantCache.get(channelId) || [];
  }

  /**
   * 전체 반응 통계 조회
   * @returns 전체 반응 통계
   */
  public getGlobalStats(): {
    totalChannels: number;
    totalReactions: number;
    totalUniqueUsers: number;
    averageParticipantsPerChannel: number;
    mostActiveChannels: string[];
  } {
    const channels = Array.from(this.reactionStats.keys());
    const totalReactions = Array.from(this.reactionStats.values()).reduce(
      (sum, stats) => sum + stats.totalReactions,
      0
    );

    const uniqueUsers = new Set<string>();
    this.participantCache.forEach((participants) => {
      participants.forEach((p) => uniqueUsers.add(p.userId));
    });

    const averageParticipantsPerChannel =
      channels.length > 0 ? totalReactions / channels.length : 0;

    const mostActiveChannels = channels
      .sort(
        (a, b) =>
          (this.reactionStats.get(b)?.totalReactions || 0) -
          (this.reactionStats.get(a)?.totalReactions || 0)
      )
      .slice(0, 5);

    return {
      totalChannels: channels.length,
      totalReactions,
      totalUniqueUsers: uniqueUsers.size,
      averageParticipantsPerChannel,
      mostActiveChannels,
    };
  }

  /**
   * 이모지 설정 업데이트
   * @param config - 새로운 이모지 설정
   */
  public updateConfig(config: Partial<EmojiConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 반응 히스토리 조회
   * @param channelId - 채널 ID (선택사항)
   * @param limit - 조회 제한
   * @returns 반응 히스토리
   */
  public getReactionHistory(channelId?: string, limit: number = 100): ReactionEvent[] {
    let history = this.reactionHistory;

    if (channelId) {
      history = history.filter((event) => event.channelId === channelId);
    }

    return history.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, limit);
  }

  /**
   * 캐시 정리
   * @param maxAge - 최대 보관 시간 (밀리초)
   */
  public clearCache(maxAge: number = 24 * 60 * 60 * 1000): void {
    const now = Date.now();

    // 오래된 반응 히스토리 정리
    this.reactionHistory = this.reactionHistory.filter(
      (event) => now - event.timestamp.getTime() < maxAge
    );

    console.log(
      `[EmojiReactionService] 캐시 정리 완료: ${this.reactionHistory.length}개 이벤트 유지`
    );
  }

  /**
   * 포럼 스레드 정보 조회
   * @param channelId - 채널 ID
   * @returns 포럼 스레드 정보
   */
  public async getForumThreadInfo(channelId: string): Promise<ForumThreadInfo | null> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!this.isForumThread(channel)) {
        return null;
      }

      const participants = this.getParticipants(channelId);
      // const _stats = this.getReactionStats(channelId); // 미사용

      if (!channel) {
        console.warn(`[EmojiReactionService] 채널이 null입니다: ${channelId}`);
        return null;
      }

      return {
        channelId: channel.id,
        threadName: 'name' in channel ? (channel.name ?? 'Unknown') : 'Unknown',
        parentForumId: 'parentId' in channel ? (channel.parentId ?? '') : '',
        participantCount: participants.length,
        lastActivity: new Date(), // 실제로는 마지막 활동 시간을 추적해야 함
        isActive: participants.length > 0,
      };
    } catch (error) {
      console.error('[EmojiReactionService] 포럼 스레드 정보 조회 오류:', error);
      return null;
    }
  }
}
