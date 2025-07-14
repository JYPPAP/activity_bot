// src/services/RecruitmentService.ts - 구인구직 비즈니스 로직
import {
  Client,
  ButtonInteraction,
  StringSelectMenuInteraction,
  VoiceState,
  GuildMember,
  Channel,
  VoiceChannel,
  MessageFlags,
  RepliableInteraction,
  User,
  Guild,
} from 'discord.js';

import { DiscordConstants } from '../config/DiscordConstants.js';
import { RecruitmentConfig } from '../config/RecruitmentConfig.js';
import { DiscordAPIError } from '../types/discord.js';
import { RecruitmentUIBuilder } from '../ui/RecruitmentUIBuilder.js';
import { SafeInteraction } from '../utils/SafeInteraction.js';

import { PermissionService } from './PermissionService.js';

// 구인구직 데이터 인터페이스
interface RecruitmentData {
  title: string;
  description: string;
  author: User;
  tags?: string[];
  maxParticipants?: number;
  category?: string;
  priority?: 'low' | 'medium' | 'high';
  duration?: number;
  requirements?: string[];
  rewards?: string[];
}

// 음성 채널 정보 인터페이스
interface VoiceChannelInfo {
  id: string;
  name: string;
  members: Map<string, GuildMember>;
  guild: Guild;
  categoryId?: string;
  userLimit?: number;
  bitrate?: number;
  deleted?: boolean;
}

// 포스트 정보 인터페이스 (currently unused)
// interface PostInfo {
//   id: string;
//   name: string;
//   archived: boolean;
//   messageCount: number;
//   memberCount: number;
//   createdAt: Date;
//   lastMessageId: string | null;
//   ownerId: string;
// }

// 음성 상태 변경 분석 결과 인터페이스 (currently unused)
// interface VoiceStateChange {
//   isTargetCategory: boolean;
//   wasTargetCategory: boolean;
//   channelId?: string;
//   oldChannelId?: string;
//   actionType: 'join' | 'leave' | 'move' | 'unknown';
//   userId: string;
//   memberName: string;
// }

// 태그 변경 분석 결과 인터페이스 (currently unused)
// interface TagChangeAnalysis {
//   changed: boolean;
//   becameActive: boolean;
//   becameInactive: boolean;
//   oldTags: string[];
//   newTags: string[];
//   addedTags: string[];
//   removedTags: string[];
// }

// 구인구직 생성 결과 인터페이스
interface RecruitmentCreateResult {
  success: boolean;
  postId?: string;
  message: string;
  data?: {
    voiceChannelId: string;
    linkedUserId: string;
    createdAt: Date;
    estimatedParticipants?: number;
  };
  error?: string;
}

// 연동 결과 인터페이스 (currently unused)
// interface LinkResult {
//   success: boolean;
//   postId?: string;
//   voiceChannelId?: string;
//   message: string;
//   warnings?: string[];
//   error?: string;
// }

// 정리 작업 결과 인터페이스
interface CleanupResult {
  totalCleaned: number;
  deletedChannels: number;
  deletedPosts: number;
  remainingMappings: number;
  errors?: string[];
}

// 서비스 통계 인터페이스
interface ServiceStats {
  totalMappings: number;
  activeRecruitments: number;
  processedEvents: number;
  successfulLinks: number;
  failedLinks: number;
  cleanupCount: number;
  embedsSent: number;
  lastCleanup: Date;
}

// 이벤트 처리 결과 인터페이스
interface EventProcessResult {
  processed: boolean;
  channelsUpdated: string[];
  reason?: string;
  error?: string;
}

export class RecruitmentService {
  // private _client: Client; // Unused
  private forumPostManager: any;
  private voiceChannelManager: any;
  private mappingService: any;
  private participantTracker: any;
  private sentEmbedChannels: Set<string> = new Set();
  private eventHistory: Array<{ type: string; timestamp: Date; success: boolean; details?: any }> =
    [];
  private stats: ServiceStats;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private maxEventHistory: number = 500;
  private processingQueue: Map<string, Promise<any>> = new Map();

  constructor(
    _client: Client,
    forumPostManager: any,
    voiceChannelManager: any,
    mappingService: any,
    participantTracker: any
  ) {
    // this._client = client; // Unused
    this.forumPostManager = forumPostManager;
    this.voiceChannelManager = voiceChannelManager;
    this.mappingService = mappingService;
    this.participantTracker = participantTracker;

    // 통계 초기화
    this.stats = {
      totalMappings: 0,
      activeRecruitments: 0,
      processedEvents: 0,
      successfulLinks: 0,
      failedLinks: 0,
      cleanupCount: 0,
      embedsSent: 0,
      lastCleanup: new Date(),
    };
  }

  /**
   * 구인구직 연동 버튼 처리
   * @param interaction - 버튼 인터랙션
   */
  async handleVoiceConnectButton(interaction: ButtonInteraction): Promise<void> {
    try {
      const voiceChannelId = interaction.customId.replace(
        DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_CONNECT,
        ''
      );

      this.recordEvent('voice_connect_button', true, {
        voiceChannelId,
        userId: interaction.user.id,
      });

      // 권한 확인
      if (
        !PermissionService.hasRecruitmentPermission(
          interaction.user,
          interaction.member as GuildMember
        )
      ) {
        await SafeInteraction.safeReply(interaction, {
          content: RecruitmentConfig.MESSAGES.NO_PERMISSION,
          flags: MessageFlags.Ephemeral,
        });
        this.recordEvent('permission_denied', false, {
          userId: interaction.user.id,
          action: 'voice_connect',
        });
        return;
      }

      // 음성 채널 정보 가져오기
      const voiceChannelInfo = await this.voiceChannelManager.getVoiceChannelInfo(voiceChannelId);
      if (!voiceChannelInfo) {
        await SafeInteraction.safeReply(interaction, {
          content: RecruitmentConfig.MESSAGES.VOICE_CHANNEL_NOT_FOUND,
          flags: MessageFlags.Ephemeral,
        });
        this.recordEvent('voice_channel_not_found', false, { voiceChannelId });
        return;
      }

      // 중복 처리 방지
      const processKey = `connect_${voiceChannelId}_${interaction.user.id}`;
      if (this.processingQueue.has(processKey)) {
        await SafeInteraction.safeReply(interaction, {
          content: '⏳ 이미 처리 중입니다. 잠시만 기다려주세요.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const processPromise = this.processVoiceConnectRequest(
        interaction,
        voiceChannelId,
        voiceChannelInfo
      );
      this.processingQueue.set(processKey, processPromise);

      try {
        await processPromise;
      } finally {
        this.processingQueue.delete(processKey);
      }
    } catch (error) {
      console.error('[RecruitmentService] 구인구직 연동 버튼 처리 오류:', error);
      this.recordEvent('voice_connect_button', false, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      await SafeInteraction.safeReply(
        interaction,
        SafeInteraction.createErrorResponse('구인구직 연동', error as DiscordAPIError)
      );
    }
  }

  /**
   * 음성 연결 요청 처리
   * @param interaction - 인터랙션
   * @param voiceChannelId - 음성 채널 ID
   * @param voiceChannelInfo - 음성 채널 정보
   */
  private async processVoiceConnectRequest(
    interaction: ButtonInteraction,
    voiceChannelId: string,
    voiceChannelInfo: VoiceChannelInfo
  ): Promise<void> {
    // 기존 매핑 확인
    if (this.mappingService.hasMapping(voiceChannelId)) {
      const existingPostId = this.mappingService.getPostId(voiceChannelId);
      await SafeInteraction.safeReply(interaction, {
        content: `⚠️ 이 음성 채널은 이미 구인구직에 연동되어 있습니다.\n🔗 연결된 포스트: <#${existingPostId}>`,
        flags: MessageFlags.Ephemeral,
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
      flags: MessageFlags.Ephemeral,
    });
  }

  /**
   * 연동 방법 선택 처리
   * @param interaction - 셀렉트 메뉴 인터랙션
   */
  async handleMethodSelection(interaction: StringSelectMenuInteraction): Promise<void> {
    try {
      const voiceChannelId = interaction.customId.replace(
        DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_METHOD,
        ''
      );
      const selectedValue = interaction.values[0];

      this.recordEvent('method_selection', true, {
        voiceChannelId,
        selectedValue,
        userId: interaction.user.id,
      });

      if (selectedValue === DiscordConstants.METHOD_VALUES.NEW_FORUM) {
        // 새 포럼 생성: 역할 태그 선택 UI로 전환
        const embed = RecruitmentUIBuilder.createRoleTagSelectionEmbed([], false);
        const components = RecruitmentUIBuilder.createRoleTagButtons(
          [],
          voiceChannelId,
          selectedValue,
          false
        );

        await SafeInteraction.safeUpdate(interaction, {
          embeds: [embed],
          components,
        });
      } else if (selectedValue.startsWith(DiscordConstants.METHOD_VALUES.EXISTING_FORUM_PREFIX)) {
        // 기존 포럼 선택: 바로 연동 처리
        const existingPostId = selectedValue.replace(
          DiscordConstants.METHOD_VALUES.EXISTING_FORUM_PREFIX,
          ''
        );
        await this.linkToExistingForum(interaction, voiceChannelId, existingPostId, []);
      } else {
        console.warn(`[RecruitmentService] 알 수 없는 선택 값: ${selectedValue}`);
        this.recordEvent('unknown_selection_value', false, { selectedValue });

        await SafeInteraction.safeReply(interaction, {
          content: '❌ 잘못된 선택입니다. 다시 시도해주세요.',
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      console.error('[RecruitmentService] 연동 방법 선택 처리 오류:', error);
      this.recordEvent('method_selection', false, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      await SafeInteraction.safeReply(
        interaction,
        SafeInteraction.createErrorResponse('방법 선택', error as DiscordAPIError)
      );
    }
  }

  /**
   * 음성 채널 연동 구인구직 생성
   * @param recruitmentData - 구인구직 데이터
   * @param voiceChannelId - 음성 채널 ID
   * @param linkerId - 연동한 사용자 ID
   * @returns 생성 결과
   */
  async createLinkedRecruitment(
    recruitmentData: RecruitmentData,
    voiceChannelId: string,
    linkerId: string
  ): Promise<RecruitmentCreateResult> {
    try {
      // 입력 검증
      if (!recruitmentData.title || !recruitmentData.description) {
        return {
          success: false,
          message: '❌ 제목과 설명을 모두 입력해주세요.',
          error: 'Missing required fields',
        };
      }

      // 음성 채널 정보 가져오기
      const voiceChannelInfo = await this.voiceChannelManager.getVoiceChannelInfo(voiceChannelId);
      if (!voiceChannelInfo) {
        this.stats.failedLinks++;
        return {
          success: false,
          message: RecruitmentConfig.MESSAGES.VOICE_CHANNEL_NOT_FOUND,
          error: 'Voice channel not found',
        };
      }

      // 중복 매핑 확인
      if (this.mappingService.hasMapping(voiceChannelId)) {
        return {
          success: false,
          message: '❌ 이 음성 채널은 이미 다른 구인구직에 연동되어 있습니다.',
          error: 'Channel already mapped',
        };
      }

      // 포럼 포스트 생성
      const createResult = await this.forumPostManager.createForumPost(
        recruitmentData,
        voiceChannelId
      );
      const postId = typeof createResult === 'string' ? createResult : createResult?.postId;

      if (!postId) {
        this.stats.failedLinks++;
        return {
          success: false,
          message: RecruitmentConfig.MESSAGES.LINK_FAILED,
          error: 'Forum post creation failed',
        };
      }

      // 채널-포스트 매핑 추가
      const mappingSuccess = await this.mappingService.addMapping(voiceChannelId, postId);
      if (!mappingSuccess) {
        // 매핑 실패 시 포스트 아카이브
        await this.forumPostManager.archivePost(postId, '매핑 실패로 인한 자동 아카이브');
        this.stats.failedLinks++;
        return {
          success: false,
          message: '❌ 채널 매핑에 실패했습니다.',
          error: 'Mapping failed',
        };
      }

      // 통계 업데이트
      this.stats.successfulLinks++;
      this.stats.totalMappings++;
      this.stats.activeRecruitments++;

      console.log(
        `[RecruitmentService] 음성 채널 연동 구인구직 생성 완료: ${voiceChannelInfo.name} -> ${postId}`
      );
      this.recordEvent('recruitment_created', true, {
        voiceChannelId,
        postId,
        linkerId,
        title: recruitmentData.title,
      });

      return {
        success: true,
        postId,
        message: RecruitmentConfig.MESSAGES.LINK_SUCCESS,
        data: {
          voiceChannelId,
          linkedUserId: linkerId,
          createdAt: new Date(),
          estimatedParticipants: voiceChannelInfo.members.size,
        },
      };
    } catch (error) {
      console.error('[RecruitmentService] 음성 채널 연동 구인구직 생성 오류:', error);
      this.stats.failedLinks++;
      this.recordEvent('recruitment_created', false, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        message: RecruitmentConfig.MESSAGES.LINK_FAILED,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 기존 포럼에 연동
   * @param interaction - 인터랙션 객체
   * @param voiceChannelId - 음성 채널 ID
   * @param existingPostId - 기존 포스트 ID
   * @param selectedRoles - 선택된 역할 태그 배열
   */
  async linkToExistingForum(
    interaction: RepliableInteraction,
    voiceChannelId: string,
    existingPostId: string,
    _selectedRoles: string[] = []
  ): Promise<void> {
    try {
      // 즉시 defer 처리하여 3초 제한시간 해결
      await SafeInteraction.safeDeferReply(interaction, { ephemeral: true });

      // 병렬로 정보 가져오기
      const [voiceChannelInfo, postInfo] = await Promise.allSettled([
        this.voiceChannelManager.getVoiceChannelInfo(voiceChannelId),
        this.forumPostManager.getPostInfo(existingPostId),
      ]);

      // 결과 검증
      const voiceChannel = voiceChannelInfo.status === 'fulfilled' ? voiceChannelInfo.value : null;
      const post = postInfo.status === 'fulfilled' ? postInfo.value : null;

      if (!voiceChannel || !post) {
        if ('editReply' in interaction) {
          await interaction.editReply({
            content: '❌ 채널 또는 포스트를 찾을 수 없습니다.',
          });
        }
        this.recordEvent('link_to_existing_forum', false, {
          voiceChannelId,
          existingPostId,
          reason: 'Channel or post not found',
        });
        return;
      }

      // 포스트가 아카이브된 경우 확인
      if (post.archived) {
        if ('editReply' in interaction) {
          await interaction.editReply({
            content: '❌ 아카이브된 포스트에는 연동할 수 없습니다.',
          });
        }
        this.recordEvent('link_to_existing_forum', false, {
          voiceChannelId,
          existingPostId,
          reason: 'Post is archived',
        });
        return;
      }

      // 중복 매핑 확인
      if (this.mappingService.hasMapping(voiceChannelId)) {
        const currentPostId = this.mappingService.getPostId(voiceChannelId);
        if ('editReply' in interaction) {
          await interaction.editReply({
            content: `❌ 이 음성 채널은 이미 다른 구인구직에 연동되어 있습니다.\n현재 연결: <#${currentPostId}>`,
          });
        }
        return;
      }

      // 음성 채널 연동 메시지 전송
      const linkMessageSent = await this.forumPostManager.sendVoiceChannelLinkMessage(
        existingPostId,
        voiceChannel.name,
        voiceChannel.id,
        voiceChannel.guild.id,
        interaction.user.id
      );

      if (!linkMessageSent) {
        if ('editReply' in interaction) {
          await interaction.editReply({
            content: '❌ 연동 메시지 전송에 실패했습니다.',
          });
        }
        this.recordEvent('link_to_existing_forum', false, {
          voiceChannelId,
          existingPostId,
          reason: 'Link message send failed',
        });
        return;
      }

      // 채널-포스트 매핑 저장
      const mappingSuccess = await this.mappingService.addMapping(voiceChannelId, existingPostId);
      if (!mappingSuccess) {
        await interaction.editReply({
          content: '❌ 채널 매핑 저장에 실패했습니다.',
        });
        this.recordEvent('link_to_existing_forum', false, {
          voiceChannelId,
          existingPostId,
          reason: 'Mapping save failed',
        });
        return;
      }

      // 통계 업데이트
      this.stats.successfulLinks++;
      this.stats.totalMappings++;

      await interaction.editReply({
        content: `✅ 기존 구인구직에 성공적으로 연동되었습니다!\n🔗 포럼: <#${existingPostId}>\n⏰ 연동 시간: <t:${Math.floor(Date.now() / 1000)}:F>`,
      });

      console.log(`[RecruitmentService] 기존 포럼 연동 완료: ${voiceChannel.name} -> ${post.name}`);
      this.recordEvent('link_to_existing_forum', true, {
        voiceChannelId,
        existingPostId,
        userId: interaction.user.id,
        voiceChannelName: voiceChannel.name,
        postName: post.name,
      });
    } catch (error) {
      console.error('[RecruitmentService] 기존 포럼 연동 오류:', error);
      this.recordEvent('link_to_existing_forum', false, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      try {
        await interaction.editReply({
          content: RecruitmentConfig.MESSAGES.LINK_FAILED,
        });
      } catch (editError) {
        console.error('[RecruitmentService] 에러 응답 실패:', editError);
      }
    }
  }

  /**
   * 음성 상태 변경 이벤트 처리
   * @param oldState - 변경 전 음성 상태
   * @param newState - 변경 후 음성 상태
   */
  async handleVoiceStateUpdate(
    oldState: VoiceState,
    newState: VoiceState
  ): Promise<EventProcessResult> {
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
        actionType: stateChange.actionType,
      });

      if (!stateChange.isTargetCategory && !stateChange.wasTargetCategory) {
        console.log(`[RecruitmentService] 대상 카테고리가 아니므로 무시`);
        return {
          processed: false,
          channelsUpdated: [],
          reason: '대상 카테고리가 아님',
        };
      }

      // 참여자 수 업데이트가 필요한 채널들
      const channelsToUpdate = new Set<string>();

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
        return {
          processed: false,
          channelsUpdated: [],
          reason: '매핑된 채널 없음',
        };
      }

      // 업데이트 큐에 추가
      console.log(`[RecruitmentService] ${channelsToUpdate.size}개 채널을 업데이트 큐에 추가`);
      const channelsArray = Array.from(channelsToUpdate);

      for (const channelId of channelsToUpdate) {
        this.mappingService.queueUpdate(channelId);
      }

      this.stats.processedEvents++;
      this.recordEvent('voice_state_update', true, {
        userId,
        memberName,
        actionType: stateChange.actionType,
        channelsUpdated: channelsArray.length,
      });

      return {
        processed: true,
        channelsUpdated: channelsArray,
      };
    } catch (error) {
      console.error('[RecruitmentService] 음성 상태 변경 처리 오류:', error);
      this.recordEvent('voice_state_update', false, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        processed: false,
        channelsUpdated: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 길드 멤버 업데이트 이벤트 처리 (별명 변경 시 실시간 갱신)
   * @param oldMember - 변경 전 멤버 정보
   * @param newMember - 변경 후 멤버 정보
   */
  async handleGuildMemberUpdate(
    oldMember: GuildMember,
    newMember: GuildMember
  ): Promise<EventProcessResult> {
    try {
      console.log(
        `[RecruitmentService] 길드 멤버 업데이트 감지: ${oldMember.displayName} -> ${newMember.displayName}`
      );

      const tagChange = this.participantTracker.detectNicknameTagChange(oldMember, newMember);
      console.log(`[RecruitmentService] 태그 변경 분석:`, {
        changed: tagChange.changed,
        becameActive: tagChange.becameActive,
        becameInactive: tagChange.becameInactive,
        oldTags: tagChange.oldTags,
        newTags: tagChange.newTags,
      });

      if (!tagChange.changed) {
        console.log(`[RecruitmentService] 태그 변경이 없어서 무시`);
        return {
          processed: false,
          channelsUpdated: [],
          reason: '태그 변경 없음',
        };
      }

      console.log(
        `[RecruitmentService] 멤버 별명 변경 감지: ${oldMember.displayName} -> ${newMember.displayName}`
      );

      // 사용자가 현재 음성 채널에 있는지 확인
      const voiceState = newMember.voice;
      if (!voiceState?.channel) {
        console.log(`[RecruitmentService] 사용자가 음성 채널에 없어서 무시`);
        return {
          processed: false,
          channelsUpdated: [],
          reason: '음성 채널에 없음',
        };
      }

      const voiceChannelId = voiceState.channel.id;
      console.log(
        `[RecruitmentService] 사용자가 있는 음성 채널: ${voiceChannelId} (${voiceState.channel.name})`
      );

      // 매핑된 포럼 포스트가 있는지 확인
      if (!this.mappingService.hasMapping(voiceChannelId)) {
        console.log(
          `[RecruitmentService] 채널 ${voiceChannelId}에 매핑된 포럼 포스트가 없어서 무시`
        );
        return {
          processed: false,
          channelsUpdated: [],
          reason: '매핑된 포스트 없음',
        };
      }

      console.log(
        `[RecruitmentService] 대기/관전 태그 변경 감지 - 참여자 수 업데이트 실행: ${voiceChannelId}`
      );

      // 참여자 수 업데이트
      this.mappingService.queueUpdate(voiceChannelId);

      this.stats.processedEvents++;
      this.recordEvent('guild_member_update', true, {
        userId: newMember.id,
        oldDisplayName: oldMember.displayName,
        newDisplayName: newMember.displayName,
        voiceChannelId,
        tagChange: tagChange.changed,
      });

      return {
        processed: true,
        channelsUpdated: [voiceChannelId],
      };
    } catch (error) {
      console.error('[RecruitmentService] 길드 멤버 업데이트 처리 오류:', error);
      this.recordEvent('guild_member_update', false, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        processed: false,
        channelsUpdated: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 채널 생성 이벤트 처리
   * @param channel - 생성된 채널
   */
  async handleChannelCreate(channel: Channel): Promise<void> {
    try {
      if (!this.voiceChannelManager.isTargetVoiceChannel(channel)) {
        return;
      }

      const channelName = 'name' in channel ? channel.name : 'Unknown Channel';
      console.log(`[RecruitmentService] 음성 채널 생성 감지: ${channelName} (ID: ${channel.id})`);

      // 구인구직 기능이 비활성화된 경우 임베드 전송 안함
      if (!RecruitmentConfig.RECRUITMENT_ENABLED) {
        console.log(
          `[RecruitmentService] 구인구직 기능 비활성화로 임베드 전송 안함: ${channelName}`
        );
        this.recordEvent('channel_create', false, {
          channelId: channel.id,
          reason: 'Recruitment disabled',
        });
        return;
      }

      // 권한이 있는 사용자가 채널에 있는지 확인하고 임베드 전송
      setTimeout(async () => {
        await this.checkAndSendRecruitmentEmbed(channel as VoiceChannel);
      }, RecruitmentConfig.EMBED_SEND_DELAY);

      this.recordEvent('channel_create', true, {
        channelId: channel.id,
        channelName,
      });
    } catch (error) {
      console.error('[RecruitmentService] 채널 생성 처리 오류:', error);
      this.recordEvent('channel_create', false, {
        channelId: channel.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * 채널 삭제 이벤트 처리
   * @param channel - 삭제된 채널
   */
  async handleChannelDelete(channel: Channel): Promise<void> {
    try {
      if (!this.voiceChannelManager.shouldHandleChannelDeletion(channel)) {
        return;
      }

      const channelName = 'name' in channel ? channel.name : 'Unknown Channel';
      console.log(`[RecruitmentService] 음성 채널 삭제 감지: ${channelName} (ID: ${channel.id})`);

      const postId = this.mappingService.getPostId(channel.id);
      if (postId) {
        // 포럼 포스트 아카이브
        const archived = await this.forumPostManager.archivePost(postId, '음성 채널 삭제됨');

        // 매핑 제거
        const removed = await this.mappingService.removeMapping(channel.id);

        // 통계 업데이트
        if (removed) {
          this.stats.activeRecruitments = Math.max(0, this.stats.activeRecruitments - 1);
        }

        console.log(
          `[RecruitmentService] 채널 삭제로 인한 포스트 아카이브: ${postId} (아카이브 성공: ${archived}, 매핑 제거 성공: ${removed})`
        );

        this.recordEvent('channel_delete', true, {
          channelId: channel.id,
          channelName,
          postId,
          archived,
          mappingRemoved: removed,
        });
      } else {
        this.recordEvent('channel_delete', true, {
          channelId: channel.id,
          channelName,
          reason: 'No mapping found',
        });
      }

      // 임베드 전송 추적에서 제거
      this.sentEmbedChannels.delete(channel.id);
    } catch (error) {
      console.error('[RecruitmentService] 채널 삭제 처리 오류:', error);
      this.recordEvent('channel_delete', false, {
        channelId: channel.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * 구인구직 임베드 전송 조건 확인 및 전송
   * @param voiceChannel - 음성 채널
   */
  async checkAndSendRecruitmentEmbed(voiceChannel: VoiceChannel): Promise<void> {
    try {
      // 이미 임베드를 전송한 채널인지 확인
      if (this.sentEmbedChannels.has(voiceChannel.id)) {
        console.log(`[RecruitmentService] 이미 임베드를 전송한 채널: ${voiceChannel.name}`);
        return;
      }

      // 채널이 삭제되었는지 확인
      try {
        await voiceChannel.fetch();
      } catch (error) {
        console.log(`[RecruitmentService] 채널이 삭제되어 임베드 전송 취소: ${voiceChannel.id}`);
        return;
      }

      // 권한이 있는 사용자가 채널에 있는지 확인
      let hasPermittedUser = false;
      let permittedUsers = 0;

      for (const member of voiceChannel.members.values()) {
        if (PermissionService.hasRecruitmentPermission(member.user, member)) {
          hasPermittedUser = true;
          permittedUsers++;
        }
      }

      if (!hasPermittedUser) {
        console.log(
          `[RecruitmentService] 권한 있는 사용자가 없어서 임베드 전송 안함: ${voiceChannel.name}`
        );
        this.recordEvent('embed_send_skipped', false, {
          channelId: voiceChannel.id,
          reason: 'No permitted users',
          totalMembers: voiceChannel.members.size,
        });
        return;
      }

      // 구인구직 연동 임베드 전송
      const embed = RecruitmentUIBuilder.createInitialEmbed(voiceChannel.name);
      const components = RecruitmentUIBuilder.createInitialButtons(voiceChannel.id);

      const message = await voiceChannel.send({
        embeds: [embed],
        components,
      });

      // 전송한 채널로 마킹
      this.sentEmbedChannels.add(voiceChannel.id);
      this.stats.embedsSent++;

      console.log(
        `[RecruitmentService] 구인구직 임베드 전송 완료: ${voiceChannel.name} (권한 있는 사용자: ${permittedUsers}명)`
      );

      this.recordEvent('embed_sent', true, {
        channelId: voiceChannel.id,
        channelName: voiceChannel.name,
        messageId: message.id,
        permittedUsers,
        totalMembers: voiceChannel.members.size,
      });
    } catch (error) {
      console.error('[RecruitmentService] 구인구직 임베드 전송 오류:', error);
      this.recordEvent('embed_sent', false, {
        channelId: voiceChannel.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * 정기 정리 작업 수행
   */
  async performPeriodicCleanup(): Promise<CleanupResult> {
    try {
      console.log('[RecruitmentService] 정기 정리 작업 시작...');

      const result = await this.mappingService.performFullCleanup();

      // 통계 업데이트
      this.stats.cleanupCount++;
      this.stats.lastCleanup = new Date();
      this.stats.activeRecruitments = result.remainingMappings;

      // 만료된 임베드 추적 정리
      this.cleanupExpiredEmbedTracking();

      if (result.totalCleaned > 0) {
        console.log(`[RecruitmentService] 정기 정리 작업 완료:`, result);
        this.recordEvent('periodic_cleanup', true, result);
      }

      return result;
    } catch (error) {
      console.error('[RecruitmentService] 정기 정리 작업 오류:', error);
      this.recordEvent('periodic_cleanup', false, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        totalCleaned: 0,
        deletedChannels: 0,
        deletedPosts: 0,
        remainingMappings: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }

  /**
   * 만료된 임베드 추적 정리
   */
  private cleanupExpiredEmbedTracking(): void {
    // 현재는 간단하게 크기 제한만 적용
    if (this.sentEmbedChannels.size > 1000) {
      const channelsArray = Array.from(this.sentEmbedChannels);
      const toKeep = channelsArray.slice(-500); // 최근 500개만 유지
      this.sentEmbedChannels = new Set(toKeep);
      console.log(
        `[RecruitmentService] 임베드 추적 정리: ${channelsArray.length - 500}개 항목 제거`
      );
    }
  }

  /**
   * 이벤트 기록
   * @param type - 이벤트 타입
   * @param success - 성공 여부
   * @param details - 세부 정보
   */
  private recordEvent(type: string, success: boolean, details?: any): void {
    this.eventHistory.push({
      type,
      timestamp: new Date(),
      success,
      details,
    });

    // 히스토리 크기 제한
    if (this.eventHistory.length > this.maxEventHistory) {
      this.eventHistory = this.eventHistory.slice(-this.maxEventHistory);
    }
  }

  /**
   * 서비스 통계 조회
   * @returns 서비스 통계
   */
  getServiceStats(): ServiceStats & {
    recentEvents: Array<{ type: string; timestamp: Date; success: boolean }>;
    successRate: number;
    eventTypes: Record<string, number>;
  } {
    const recentEvents = this.eventHistory.slice(-20);
    const successCount = this.eventHistory.filter((e) => e.success).length;
    const successRate =
      this.eventHistory.length > 0 ? (successCount / this.eventHistory.length) * 100 : 0;

    const eventTypes: Record<string, number> = {};
    this.eventHistory.forEach((event) => {
      eventTypes[event.type] = (eventTypes[event.type] || 0) + 1;
    });

    return {
      ...this.stats,
      recentEvents,
      successRate,
      eventTypes,
    };
  }

  /**
   * 처리 큐 상태 조회
   * @returns 처리 큐 정보
   */
  getProcessingQueueStatus(): {
    queueSize: number;
    activeProcesses: string[];
  } {
    return {
      queueSize: this.processingQueue.size,
      activeProcesses: Array.from(this.processingQueue.keys()),
    };
  }

  /**
   * 서비스 초기화 (정기 작업 등 설정)
   */
  initialize(): void {
    console.log('[RecruitmentService] 서비스 초기화 시작...');

    // 임베드 전송 추적을 위한 Set 초기화
    this.sentEmbedChannels = new Set();

    // 정기 정리 작업 설정
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(async () => {
      await this.performPeriodicCleanup();
    }, RecruitmentConfig.CLEANUP_INTERVAL);

    // 통계 업데이트
    this.stats.totalMappings = this.mappingService.getMappingCount();
    this.stats.activeRecruitments = this.mappingService.getMappingCount();

    console.log(
      `[RecruitmentService] 서비스 초기화 완료 - 정리 간격: ${RecruitmentConfig.CLEANUP_INTERVAL}ms`
    );
    this.recordEvent('service_initialized', true, {
      cleanupInterval: RecruitmentConfig.CLEANUP_INTERVAL,
      initialMappings: this.stats.totalMappings,
    });
  }

  /**
   * 서비스 종료
   */
  destroy(): void {
    console.log('[RecruitmentService] 서비스 종료 중...');

    // 정기 작업 중지
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // 처리 중인 큐 정리
    this.processingQueue.clear();

    this.recordEvent('service_destroyed', true);
    console.log('[RecruitmentService] 서비스 종료 완료');
  }
}
