// src/services/ForumPostManager.ts - 포럼 포스트 관리
import {
  Client,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ForumChannel,
  ThreadChannel,
  ChannelType,
  User,
} from 'discord.js';

import { DiscordConstants } from '../config/DiscordConstants';
import { RecruitmentConfig } from '../config/RecruitmentConfig';
import { formatParticipantList } from '../utils/formatters';
import { TextProcessor } from '../utils/TextProcessor';

// 구인구직 데이터 인터페이스
interface RecruitmentData {
  title: string;
  description: string;
  author: User;
  tags?: string[];
  maxParticipants?: number;
  duration?: number;
  priority?: 'low' | 'medium' | 'high';
  category?: string;
  requirements?: string[];
  rewards?: string[];
  deadline?: Date;
}

// 포럼 포스트 정보 인터페이스
interface ForumPostInfo {
  id: string;
  name: string;
  archived: boolean;
  messageCount: number;
  memberCount: number;
  createdAt: Date;
  lastMessageId: string | null;
  ownerId: string;
  isActive: boolean;
  participantCount?: number;
  linkedVoiceChannelId?: string;
}

// 포럼 포스트 설정 인터페이스
interface ForumPostConfig {
  autoArchiveDuration: number;
  enableNotifications: boolean;
  maxParticipants: number;
  allowSpectators: boolean;
  requireApproval: boolean;
  customTags: string[];
}

// 메시지 추적 정보 인터페이스
interface TrackedMessage {
  threadId: string;
  messageType: string;
  messageId: string;
  createdAt: Date;
  content?: string;
}

// 포럼 통계 인터페이스
interface ForumStats {
  totalPosts: number;
  activePosts: number;
  archivedPosts: number;
  totalParticipants: number;
  averageParticipantsPerPost: number;
  mostActiveAuthors: string[];
  popularTags: string[];
  postsByCategory: Record<string, number>;
}

// 참가자 업데이트 결과 인터페이스
interface ParticipantUpdateResult {
  success: boolean;
  participantCount: number;
  messageId?: string;
  error?: string;
}

// 포럼 포스트 생성 결과 인터페이스
interface CreatePostResult {
  success: boolean;
  postId?: string;
  threadName?: string;
  error?: string;
  warnings?: string[];
}

// 아카이브 옵션 인터페이스
interface ArchiveOptions {
  reason?: string;
  lockThread?: boolean;
  sendNotification?: boolean;
  preserveMessages?: boolean;
}

export class ForumPostManager {
  private client: Client;
  private forumChannelId: string;
  private forumTagId: string;
  private databaseManager: any;
  private config: ForumPostConfig;
  private trackedMessages: Map<string, TrackedMessage[]> = new Map();
  private postStats: Map<string, ForumStats> = new Map();
  private participantCache: Map<string, string[]> = new Map();
  // private _notificationQueue: Array<{ postId: string; message: string; type: string }> = [];

  constructor(
    client: Client,
    forumChannelId: string,
    forumTagId: string,
    databaseManager: any = null
  ) {
    this.client = client;
    this.forumChannelId = forumChannelId;
    this.forumTagId = forumTagId;
    this.databaseManager = databaseManager;

    // 기본 설정 초기화
    this.config = {
      autoArchiveDuration: 1440, // 24시간
      enableNotifications: true,
      maxParticipants: 50,
      allowSpectators: true,
      requireApproval: false,
      customTags: [],
    };

    // 통계 초기화
    this.initializeStats();
  }

  /**
   * 포럼 포스트 생성
   * @param recruitmentData - 구인구직 데이터
   * @param voiceChannelId - 음성 채널 ID (선택사항)
   * @returns 생성된 포스트 ID
   */
  async createForumPost(
    recruitmentData: RecruitmentData,
    voiceChannelId?: string
  ): Promise<CreatePostResult> {
    try {
      const forumChannel = (await this.client.channels.fetch(this.forumChannelId)) as ForumChannel;

      if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
        return {
          success: false,
          error: '포럼 채널을 찾을 수 없거나 올바른 포럼 채널이 아닙니다.',
        };
      }

      // 입력 검증
      const validation = this.validateRecruitmentData(recruitmentData);
      if (!validation.isValid) {
        return {
          success: false,
          ...(validation.error && { error: validation.error }),
        };
      }

      const embed = await this.createPostEmbed(recruitmentData, voiceChannelId);
      const title = this.generatePostTitle(recruitmentData);
      const warnings: string[] = [];

      // 역할 멘션 생성 및 역할 ID 추출
      let roleMentions = '';
      let roleIds: string[] = [];

      if (recruitmentData.tags) {
        const guild = forumChannel.guild;
        const roleMentionResult = await TextProcessor.convertTagsToRoleMentions(
          recruitmentData.tags.join(', '),
          guild
        );
        roleMentions = roleMentionResult.mentions.join(' ');

        const roleMatches = roleMentions.match(/<@&(\d+)>/g);
        if (roleMatches) {
          roleIds = roleMatches.map((match) => match.match(/\d+/)?.[0] || '').filter(Boolean);
        }
      }

      // 버튼 구성
      const components = [];

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
        ...(roleMentions && roleIds.length > 0 && { content: roleMentions }),
        embeds: [embed],
        components,
        allowedMentions: {
          roles: roleIds,
        },
      };

      const thread = await forumChannel.threads.create({
        name: title,
        message: messageOptions,
        ...(this.forumTagId && { appliedTags: [this.forumTagId] }),
        autoArchiveDuration: this.config.autoArchiveDuration,
      });

      // 모집자를 스레드에 자동으로 추가
      try {
        await thread.members.add(recruitmentData.author.id);
        console.log(
          `[ForumPostManager] 모집자가 스레드에 추가됨: ${recruitmentData.author.displayName}`
        );
      } catch (addError) {
        console.warn('[ForumPostManager] 모집자를 스레드에 추가하는데 실패:', addError);
        warnings.push('모집자를 스레드에 추가하는데 실패했습니다.');
      }

      // 음성 채널이 있으면 별도 메시지로 네이티브 링크 추가
      if (voiceChannelId) {
        try {
          const voiceChannel = await this.client.channels.fetch(voiceChannelId);
          if (voiceChannel && 'guild' in voiceChannel && 'name' in voiceChannel) {
            await thread.send(
              `🔊 **음성 채널**: https://discord.com/channels/${voiceChannel.guild.id}/${voiceChannelId}`
            );
            console.log(`[ForumPostManager] 음성 채널 링크 메시지 추가됨: ${voiceChannel.name}`);
          }
        } catch (linkError) {
          console.warn('[ForumPostManager] 음성 채널 링크 메시지 추가 실패:', linkError);
          warnings.push('음성 채널 링크 메시지 추가에 실패했습니다.');
        }
      }

      // 참가 안내 메시지 추가
      try {
        const participationGuide =
          '<:GAP_2:1319891512573689917> 이모지를 누르면 실시간으로 참가자 목록이 업데이트됩니다.';

        await thread.send(participationGuide);
        console.log(`[ForumPostManager] 참가 안내 메시지 추가됨: ${thread.name}`);
      } catch (guideError) {
        console.warn('[ForumPostManager] 참가 안내 메시지 추가 실패:', guideError);
        warnings.push('참가 안내 메시지 추가에 실패했습니다.');
      }

      // 포럼 포스트 통계 업데이트
      await this.updateForumStats(thread.id, recruitmentData);

      // 데이터베이스에 포럼 포스트 정보 저장
      if (this.databaseManager) {
        try {
          await this.databaseManager.saveForumPost({
            postId: thread.id,
            authorId: recruitmentData.author.id,
            title: recruitmentData.title,
            voiceChannelId: voiceChannelId || null,
            createdAt: new Date(),
            isActive: true,
          });
        } catch (dbError) {
          console.warn('[ForumPostManager] 데이터베이스 저장 실패:', dbError);
          warnings.push('데이터베이스 저장에 실패했습니다.');
        }
      }

      console.log(`[ForumPostManager] 포럼 포스트 생성 완료: ${thread.name} (ID: ${thread.id})`);

      return {
        success: true,
        postId: thread.id,
        threadName: thread.name,
        ...(warnings.length > 0 && { warnings }),
      };
    } catch (error) {
      console.error('[ForumPostManager] 포럼 포스트 생성 오류:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : '포럼 포스트 생성 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * 구인구직 데이터 유효성 검사
   * @param data - 구인구직 데이터
   * @returns 검증 결과
   */
  private validateRecruitmentData(data: RecruitmentData): { isValid: boolean; error?: string } {
    if (!data.title || data.title.trim().length === 0) {
      return { isValid: false, error: '제목이 필요합니다.' };
    }

    if (data.title.length > 100) {
      return { isValid: false, error: '제목은 100자 이하여야 합니다.' };
    }

    if (!data.description || data.description.trim().length === 0) {
      return { isValid: false, error: '설명이 필요합니다.' };
    }

    if (data.description.length > 2000) {
      return { isValid: false, error: '설명은 2000자 이하여야 합니다.' };
    }

    if (!data.author) {
      return { isValid: false, error: '작성자 정보가 필요합니다.' };
    }

    if (data.maxParticipants && (data.maxParticipants < 1 || data.maxParticipants > 100)) {
      return { isValid: false, error: '최대 참가자 수는 1-100명 사이여야 합니다.' };
    }

    return { isValid: true };
  }

  /**
   * 포럼 포스트 제목 생성
   * @param recruitmentData - 구인구직 데이터
   * @returns 생성된 제목
   */
  private generatePostTitle(recruitmentData: RecruitmentData): string {
    // 서버 멤버 객체면 서버 닉네임 사용, 아니면 전역명 사용
    const displayName = recruitmentData.author.displayName || recruitmentData.author.username;
    const cleanedNickname = TextProcessor.cleanNickname(displayName);

    // 카테고리 태그 추가
    const categoryTag = recruitmentData.category ? `[${recruitmentData.category}]` : '';

    // 우선순위 이모지 추가
    const priorityEmoji = this.getPriorityEmoji(recruitmentData.priority);

    return `${priorityEmoji}${categoryTag}[${cleanedNickname}] ${recruitmentData.title}`;
  }

  /**
   * 우선순위 이모지 반환
   * @param priority - 우선순위
   * @returns 우선순위 이모지
   */
  private getPriorityEmoji(priority?: string): string {
    switch (priority) {
      case 'high':
        return '🔥';
      case 'medium':
        return '⚡';
      case 'low':
        return '💤';
      default:
        return '';
    }
  }

  /**
   * 포럼 포스트 임베드 생성
   * @param recruitmentData - 구인구직 데이터
   * @param voiceChannelId - 음성 채널 ID (선택사항)
   * @returns 생성된 임베드
   */
  private async createPostEmbed(
    recruitmentData: RecruitmentData,
    voiceChannelId?: string
  ): Promise<EmbedBuilder> {
    let content = `# 🎮 ${recruitmentData.title}\n\n`;

    // embed에 역할 멘션 표시
    if (recruitmentData.tags) {
      const guild = this.client.guilds.cache.first();
      if (guild) {
        const roleMentions = await TextProcessor.convertTagsToRoleMentions(
          recruitmentData.tags.join(', '),
          guild
        );
        content += `## 🏷️ 태그\n${roleMentions}\n\n`;
      }
    }

    content += `## 📝 상세 설명\n${recruitmentData.description}\n\n`;

    // 요구사항 추가
    if (recruitmentData.requirements && recruitmentData.requirements.length > 0) {
      content += `## 📋 요구사항\n`;
      recruitmentData.requirements.forEach((req) => {
        content += `• ${req}\n`;
      });
      content += '\n';
    }

    // 보상 추가
    if (recruitmentData.rewards && recruitmentData.rewards.length > 0) {
      content += `## 🎁 보상\n`;
      recruitmentData.rewards.forEach((reward) => {
        content += `• ${reward}\n`;
      });
      content += '\n';
    }

    // 마감일 추가
    if (recruitmentData.deadline) {
      content += `## ⏰ 마감일\n<t:${Math.floor(recruitmentData.deadline.getTime() / 1000)}:F>\n\n`;
    }

    // 최대 참가자 수 추가
    if (recruitmentData.maxParticipants) {
      content += `## 👥 최대 참가자\n${recruitmentData.maxParticipants}명\n\n`;
    }

    content += `## 👤 모집자\n<@${recruitmentData.author.id}>`;

    const embed = new EmbedBuilder()
      .setDescription(content)
      .setColor(
        voiceChannelId ? RecruitmentConfig.COLORS.SUCCESS : RecruitmentConfig.COLORS.STANDALONE_POST
      )
      .setFooter({
        text: voiceChannelId
          ? '음성 채널과 연동된 구인구직입니다.'
          : '음성 채널에서 "구인구직 연동하기" 버튼을 클릭하여 연결하세요.',
        iconURL: recruitmentData.author.displayAvatarURL(),
      })
      .setTimestamp();

    // 우선순위에 따른 색상 설정
    if (recruitmentData.priority === 'high') {
      embed.setColor(0xff0000); // 빨간색
    } else if (recruitmentData.priority === 'medium') {
      embed.setColor(0xffaa00); // 주황색
    }

    return embed;
  }

  /**
   * 음성 채널 상호작용 버튼 생성
   * @param voiceChannelId - 음성 채널 ID
   * @returns 생성된 버튼 행
   */
  private createVoiceChannelButtons(voiceChannelId: string): ActionRowBuilder<ButtonBuilder> {
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

    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      spectateButton,
      waitButton,
      resetButton
    );
  }

  /**
   * 범용 별명 변경 버튼 생성 (채널 ID 없음)
   * @returns 생성된 버튼 행
   */
  private createGeneralNicknameButtons(): ActionRowBuilder<ButtonBuilder> {
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

    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      spectateButton,
      waitButton,
      resetButton
    );
  }

  /**
   * 포럼 포스트에 참여자 수 업데이트 메시지 전송
   * @param postId - 포스트 ID
   * @param currentCount - 현재 참여자 수
   * @param maxCount - 최대 참여자 수
   * @param voiceChannelName - 음성 채널 이름
   * @returns 성공 여부
   */
  async sendParticipantUpdateMessage(
    postId: string,
    currentCount: number,
    maxCount: number | string,
    _voiceChannelName: string
  ): Promise<ParticipantUpdateResult> {
    try {
      const thread = (await this.client.channels.fetch(postId)) as ThreadChannel;

      if (!thread || !thread.isThread() || thread.archived) {
        return {
          success: false,
          participantCount: currentCount,
          error: `스레드를 찾을 수 없거나 아카이브됨: ${postId}`,
        };
      }

      // 이전 참여자 수 메시지들 삭제
      await this._deleteTrackedMessages(postId, 'participant_count');

      const timeString = TextProcessor.formatKoreanTime();
      const progressBar = this.createProgressBar(
        currentCount,
        typeof maxCount === 'number' ? maxCount : 100
      );

      const updateMessage =
        `# 👥 현재 참여자: ${currentCount}/${maxCount}명\n` +
        `${progressBar}\n` +
        `**⏰ 업데이트**: ${timeString}`;

      const sentMessage = await thread.send(updateMessage);

      // 새 메시지 추적 저장
      await this._trackMessage(postId, 'participant_count', sentMessage.id);

      console.log(
        `[ForumPostManager] 참여자 수 업데이트 메시지 전송 완료: ${postId} (${currentCount}/${maxCount})`
      );

      return {
        success: true,
        participantCount: currentCount,
        messageId: sentMessage.id,
      };
    } catch (error) {
      console.error(`[ForumPostManager] 참여자 수 업데이트 메시지 전송 실패: ${postId}`, error);
      return {
        success: false,
        participantCount: currentCount,
        error: error instanceof Error ? error.message : '알 수 없는 오류',
      };
    }
  }

  /**
   * 진행률 표시 바 생성
   * @param current - 현재 값
   * @param max - 최대 값
   * @returns 진행률 바 문자열
   */
  private createProgressBar(current: number, max: number): string {
    const percentage = Math.min((current / max) * 100, 100);
    const filledBlocks = Math.floor(percentage / 10);
    const emptyBlocks = 10 - filledBlocks;

    const filledChar = '█';
    const emptyChar = '░';

    return `[${filledChar.repeat(filledBlocks)}${emptyChar.repeat(emptyBlocks)}] ${percentage.toFixed(1)}%`;
  }

  /**
   * 포럼 포스트에 음성 채널 연동 메시지 전송
   * @param postId - 포스트 ID
   * @param voiceChannelName - 음성 채널 이름
   * @param voiceChannelId - 음성 채널 ID
   * @param guildId - 길드 ID
   * @param linkerId - 연동한 사용자 ID
   * @returns 성공 여부
   */
  async sendVoiceChannelLinkMessage(
    postId: string,
    voiceChannelName: string,
    voiceChannelId: string,
    guildId: string,
    linkerId: string
  ): Promise<boolean> {
    try {
      const thread = (await this.client.channels.fetch(postId)) as ThreadChannel;

      if (!thread || !thread.isThread() || thread.archived) {
        console.warn(`[ForumPostManager] 스레드를 찾을 수 없거나 아카이브됨: ${postId}`);
        return false;
      }

      const linkEmbed = new EmbedBuilder()
        .setTitle('🔊 음성 채널 연동')
        .setDescription('새로운 음성 채널이 이 구인구직에 연동되었습니다!')
        .addFields(
          { name: '📢 채널명', value: voiceChannelName, inline: true },
          { name: '👤 연동자', value: `<@${linkerId}>`, inline: true },
          { name: '🕐 연동 시간', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
        )
        .setColor(RecruitmentConfig.COLORS.SUCCESS)
        .setTimestamp();

      // Embed와 별도로 네이티브 채널 링크 전송
      await thread.send({ embeds: [linkEmbed] });
      await thread.send(
        `🔊 **음성 채널**: https://discord.com/channels/${guildId}/${voiceChannelId}`
      );

      console.log(`[ForumPostManager] 음성 채널 연동 메시지 전송 완료: ${postId}`);
      return true;
    } catch (error) {
      console.error(`[ForumPostManager] 음성 채널 연동 메시지 전송 실패: ${postId}`, error);
      return false;
    }
  }

  /**
   * 기존 포럼 포스트 목록 가져오기
   * @param limit - 가져올 포스트 수
   * @param includeArchived - 아카이브된 포스트 포함 여부
   * @returns 포스트 목록
   */
  async getExistingPosts(
    limit: number = 10,
    includeArchived: boolean = false
  ): Promise<ForumPostInfo[]> {
    try {
      const forumChannel = (await this.client.channels.fetch(this.forumChannelId)) as ForumChannel;

      if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
        console.error('[ForumPostManager] 포럼 채널을 찾을 수 없습니다.');
        return [];
      }

      // 활성 스레드 가져오기
      const activeThreads = await forumChannel.threads.fetchActive();
      let allThreads = Array.from(activeThreads.threads.values());

      // 아카이브된 스레드도 포함하는 경우
      if (includeArchived) {
        const archivedThreads = await forumChannel.threads.fetchArchived();
        allThreads = [...allThreads, ...Array.from(archivedThreads.threads.values())];
      }

      const recentPosts = allThreads
        .sort((a, b) => (b.createdTimestamp || 0) - (a.createdTimestamp || 0))
        .slice(0, limit);

      return recentPosts.map((thread) => ({
        id: thread.id,
        name: thread.name,
        archived: thread.archived ?? false,
        messageCount: thread.messageCount || 0,
        memberCount: thread.memberCount || 0,
        createdAt: thread.createdAt ?? new Date(),
        lastMessageId: thread.lastMessageId,
        ownerId: thread.ownerId,
        isActive: !(thread.archived ?? false),
        participantCount: this.participantCache.get(thread.id)?.length || 0,
      }));
    } catch (error) {
      console.error('[ForumPostManager] 기존 포스트 목록 가져오기 실패:', error);
      return [];
    }
  }

  /**
   * 포럼 포스트 아카이브 처리
   * @param postId - 포스트 ID
   * @param options - 아카이브 옵션
   * @returns 성공 여부
   */
  async archivePost(postId: string, options: ArchiveOptions = {}): Promise<boolean> {
    try {
      const thread = (await this.client.channels.fetch(postId)) as ThreadChannel;

      if (!thread?.isThread()) {
        console.warn(`[ForumPostManager] 스레드를 찾을 수 없음: ${postId}`);
        return false;
      }

      if (thread.archived) {
        console.log(`[ForumPostManager] 이미 아카이브된 스레드: ${postId}`);
        return true;
      }

      const {
        reason = '음성 채널 삭제됨',
        lockThread = true,
        sendNotification = true,
        preserveMessages = false,
      } = options;

      // 아카이브 메시지 전송
      if (sendNotification) {
        const archiveEmbed = new EmbedBuilder()
          .setTitle('🔒 구인구직 종료')
          .setDescription(
            `이 구인구직이 자동으로 종료되었습니다.\n` +
              `**사유**: ${reason}\n` +
              `**종료 시간**: <t:${Math.floor(Date.now() / 1000)}:F>\n\n` +
              `${lockThread ? '📝 이 포스트는 잠금 처리되어 더 이상 메시지를 작성할 수 없습니다.' : ''}`
          )
          .setColor(RecruitmentConfig.COLORS.WARNING)
          .setTimestamp();

        await thread.send({ embeds: [archiveEmbed] });
      }

      // 메시지 정리 (선택적)
      if (!preserveMessages) {
        await this._cleanupTrackedMessages(postId);
      }

      // 스레드 잠금 (옵션)
      if (lockThread && !thread.locked) {
        try {
          await thread.setLocked(true, reason);
          console.log(`[ForumPostManager] 스레드 잠금 완료: ${postId}`);
        } catch (lockError) {
          console.error(`[ForumPostManager] 스레드 잠금 실패: ${postId}`, lockError);
        }
      }

      // 스레드 아카이브
      await thread.setArchived(true, reason);

      // 캐시에서 제거
      this.participantCache.delete(postId);

      // 데이터베이스 업데이트
      if (this.databaseManager) {
        try {
          await this.databaseManager.updateForumPost(postId, {
            isActive: false,
            archivedAt: new Date(),
            archiveReason: reason,
          });
        } catch (dbError) {
          console.warn('[ForumPostManager] 데이터베이스 업데이트 실패:', dbError);
        }
      }

      console.log(`[ForumPostManager] 포럼 포스트 아카이브 완료: ${postId} (${reason})`);
      return true;
    } catch (error) {
      console.error(`[ForumPostManager] 포럼 포스트 아카이브 실패: ${postId}`, error);
      return false;
    }
  }

  /**
   * 포럼 포스트 존재 여부 확인
   * @param postId - 포스트 ID
   * @returns 존재 여부
   */
  async postExists(postId: string): Promise<boolean> {
    try {
      const thread = (await this.client.channels.fetch(postId)) as ThreadChannel;
      return thread !== null && thread.isThread() && !thread.archived;
    } catch (error: any) {
      if (error.code === 10003) {
        // Unknown Channel
        return false;
      }
      console.error(`[ForumPostManager] 포스트 존재 확인 실패: ${postId}`, error);
      return false;
    }
  }

  /**
   * 포럼 포스트 정보 가져오기
   * @param postId - 포스트 ID
   * @returns 포스트 정보
   */
  async getPostInfo(postId: string): Promise<ForumPostInfo | null> {
    try {
      const thread = (await this.client.channels.fetch(postId)) as ThreadChannel;

      if (!thread?.isThread()) {
        return null;
      }

      return {
        id: thread.id,
        name: thread.name,
        archived: thread.archived ?? false,
        messageCount: thread.messageCount || 0,
        memberCount: thread.memberCount || 0,
        createdAt: thread.createdAt ?? new Date(),
        lastMessageId: thread.lastMessageId,
        ownerId: thread.ownerId,
        isActive: !thread.archived,
        participantCount: this.participantCache.get(thread.id)?.length || 0,
      };
    } catch (error) {
      console.error(`[ForumPostManager] 포스트 정보 가져오기 실패: ${postId}`, error);
      return null;
    }
  }

  /**
   * 포럼 포스트에 참가자 목록 메시지 전송
   * @param postId - 포스트 ID
   * @param participants - 참가자 닉네임 배열
   * @returns 성공 여부
   */
  async sendParticipantList(postId: string, participants: string[]): Promise<boolean> {
    try {
      const thread = (await this.client.channels.fetch(postId)) as ThreadChannel;

      if (!thread?.isThread()) {
        console.warn(`[ForumPostManager] 스레드를 찾을 수 없음: ${postId}`);
        return false;
      }

      if (thread.archived) {
        console.warn(`[ForumPostManager] 아카이브된 스레드: ${postId}`);
        return false;
      }

      // 참가자 목록 캐시 업데이트
      this.participantCache.set(postId, participants);

      // 참가자 목록 포맷팅
      const participantListText = formatParticipantList(participants);

      // 메시지 전송
      await thread.send(participantListText);

      console.log(
        `[ForumPostManager] 참가자 목록 메시지 전송 완료: ${postId} (${participants.length}명)`
      );
      return true;
    } catch (error) {
      console.error(`[ForumPostManager] 참가자 목록 메시지 전송 실패: ${postId}`, error);
      return false;
    }
  }

  /**
   * 포럼 포스트에 참가자 수 업데이트 메시지 전송 (이모지 반응 기반)
   * @param postId - 포스트 ID
   * @param participants - 참가자 닉네임 배열
   * @param emojiName - 이모지 이름
   * @returns 성공 여부
   */
  async sendEmojiParticipantUpdate(
    postId: string,
    participants: string[],
    _emojiName: string = '참가'
  ): Promise<ParticipantUpdateResult> {
    try {
      const thread = (await this.client.channels.fetch(postId)) as ThreadChannel;

      if (!thread?.isThread()) {
        return {
          success: false,
          participantCount: participants.length,
          error: `스레드를 찾을 수 없음: ${postId}`,
        };
      }

      if (thread.archived) {
        return {
          success: false,
          participantCount: participants.length,
          error: `아카이브된 스레드: ${postId}`,
        };
      }

      // 참가자 목록 캐시 업데이트
      this.participantCache.set(postId, participants);

      // 이전 이모지 반응 메시지들 삭제
      await this._deleteTrackedMessages(postId, 'emoji_reaction');

      const timeString = TextProcessor.formatKoreanTime();
      const participantListText = formatParticipantList(participants);
      const updateMessage = `${participantListText}\n**⏰ 업데이트**: ${timeString}`;

      const sentMessage = await thread.send(updateMessage);

      // 새 메시지 추적 저장
      await this._trackMessage(postId, 'emoji_reaction', sentMessage.id);

      console.log(
        `[ForumPostManager] 이모지 참가자 현황 업데이트 완료: ${postId} (${participants.length}명)`
      );

      return {
        success: true,
        participantCount: participants.length,
        messageId: sentMessage.id,
      };
    } catch (error) {
      console.error(`[ForumPostManager] 이모지 참가자 현황 업데이트 실패: ${postId}`, error);
      return {
        success: false,
        participantCount: participants.length,
        error: error instanceof Error ? error.message : '알 수 없는 오류',
      };
    }
  }

  /**
   * 포럼 통계 초기화
   */
  private initializeStats(): void {
    this.postStats.clear();
    this.participantCache.clear();
    this.trackedMessages.clear();
    // this._notificationQueue = [];
  }

  /**
   * 포럼 통계 업데이트
   * @param postId - 포스트 ID
   * @param recruitmentData - 구인구직 데이터
   */
  private async updateForumStats(_postId: string, recruitmentData: RecruitmentData): Promise<void> {
    try {
      const stats = this.postStats.get('global') || this.createEmptyStats();

      stats.totalPosts++;
      stats.activePosts++;

      if (recruitmentData.category) {
        stats.postsByCategory[recruitmentData.category] =
          (stats.postsByCategory[recruitmentData.category] || 0) + 1;
      }

      if (recruitmentData.tags) {
        recruitmentData.tags.forEach((tag) => {
          const index = stats.popularTags.indexOf(tag);
          if (index === -1) {
            stats.popularTags.push(tag);
          }
        });
      }

      this.postStats.set('global', stats);
    } catch (error) {
      console.error('[ForumPostManager] 포럼 통계 업데이트 실패:', error);
    }
  }

  /**
   * 빈 통계 객체 생성
   * @returns 빈 통계 객체
   */
  private createEmptyStats(): ForumStats {
    return {
      totalPosts: 0,
      activePosts: 0,
      archivedPosts: 0,
      totalParticipants: 0,
      averageParticipantsPerPost: 0,
      mostActiveAuthors: [],
      popularTags: [],
      postsByCategory: {},
    };
  }

  /**
   * 추적된 메시지들 삭제
   * @param threadId - 스레드 ID
   * @param messageType - 메시지 타입
   * @returns 성공 여부
   */
  private async _deleteTrackedMessages(threadId: string, messageType: string): Promise<boolean> {
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
      const thread = (await this.client.channels.fetch(threadId)) as ThreadChannel;
      if (!thread?.isThread()) {
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
        } catch (deleteError: any) {
          if (deleteError.code === 10008) {
            // Unknown Message
            console.log(`[ForumPostManager] 메시지가 이미 삭제됨: ${messageId}`);
          } else {
            console.warn(`[ForumPostManager] 메시지 삭제 실패: ${messageId}`, deleteError.message);
          }
        }
      }

      // 데이터베이스에서 추적 정보 삭제
      await this.databaseManager.clearTrackedMessages(threadId, messageType);

      console.log(
        `[ForumPostManager] 추적된 메시지 삭제 완료: ${threadId}, ${messageType}, ${deletedCount}/${messageIds.length}개`
      );
      return true;
    } catch (error) {
      console.error(
        `[ForumPostManager] 추적된 메시지 삭제 오류: ${threadId}, ${messageType}`,
        error
      );
      return false;
    }
  }

  /**
   * 메시지 추적 저장
   * @param threadId - 스레드 ID
   * @param messageType - 메시지 타입
   * @param messageId - 메시지 ID
   * @returns 성공 여부
   */
  private async _trackMessage(
    threadId: string,
    messageType: string,
    messageId: string
  ): Promise<boolean> {
    if (!this.databaseManager) {
      console.warn('[ForumPostManager] DatabaseManager가 설정되지 않음');
      return false;
    }

    try {
      await this.databaseManager.trackForumMessage(threadId, messageType, messageId);
      console.log(`[ForumPostManager] 메시지 추적 저장: ${threadId}, ${messageType}, ${messageId}`);
      return true;
    } catch (error) {
      console.error(
        `[ForumPostManager] 메시지 추적 저장 오류: ${threadId}, ${messageType}, ${messageId}`,
        error
      );
      return false;
    }
  }

  /**
   * 추적된 메시지 정리
   * @param threadId - 스레드 ID
   */
  private async _cleanupTrackedMessages(threadId: string): Promise<void> {
    const messageTypes = ['participant_count', 'emoji_reaction', 'notification'];

    for (const messageType of messageTypes) {
      await this._deleteTrackedMessages(threadId, messageType);
    }
  }

  /**
   * 포럼 설정 업데이트
   * @param newConfig - 새로운 설정
   */
  public updateConfig(newConfig: Partial<ForumPostConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('[ForumPostManager] 설정 업데이트 완료:', this.config);
  }

  /**
   * 포럼 전체 통계 조회
   * @returns 포럼 통계
   */
  public getForumStats(): ForumStats {
    return this.postStats.get('global') || this.createEmptyStats();
  }

  /**
   * 활성 포럼 포스트 수 조회
   * @returns 활성 포스트 수
   */
  public getActivePostCount(): number {
    return this.participantCache.size;
  }

  /**
   * 알림 전송
   * @param postId - 포스트 ID
   * @param message - 알림 메시지
   * @param type - 알림 타입
   */
  public async sendNotification(postId: string, message: string, _type: string): Promise<boolean> {
    if (!this.config.enableNotifications) {
      return false;
    }

    try {
      const thread = (await this.client.channels.fetch(postId)) as ThreadChannel;
      if (!thread || !thread.isThread() || thread.archived) {
        return false;
      }

      await thread.send(message);
      return true;
    } catch (error) {
      console.error(`[ForumPostManager] 알림 전송 실패: ${postId}`, error);
      return false;
    }
  }
}
