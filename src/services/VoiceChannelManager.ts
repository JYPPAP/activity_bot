// src/services/VoiceChannelManager.ts - 음성 채널 관리
import { Client, Channel, VoiceState, GuildMember, ChannelType, Guild } from 'discord.js';
// import { DiscordConstants } from '../config/DiscordConstants.js'; // 미사용
// import { RecruitmentConfig } from '../config/RecruitmentConfig.js'; // 미사용

// 채널 변경 정보 인터페이스
interface ChannelChangeInfo {
  isTarget: boolean;
  nameChanged: boolean;
  limitChanged: boolean;
  oldName: string;
  newName: string;
  oldLimit: number;
  newLimit: number;
  categoryChanged?: boolean;
  oldParentId?: string | null;
  newParentId?: string | null;
}

// 음성 상태 변경 정보 인터페이스
interface VoiceStateChangeInfo {
  actionType: 'join' | 'leave' | 'move' | 'update' | null;
  channelId: string | null;
  oldChannelId: string | null;
  member: GuildMember | null;
  isTargetCategory: boolean;
  wasTargetCategory: boolean;
  userId: string;
  memberName: string;
  channelName?: string;
  oldChannelName?: string;
}

// 음성 채널 정보 인터페이스
interface VoiceChannelInfo {
  id: string;
  name: string;
  parentId: string | null;
  userLimit: number;
  memberCount: number;
  members: GuildMember[];
  isTargetCategory: boolean;
  guild: Guild;
  deleted?: boolean;
  channelId?: string;
  bitrate?: number;
  categoryName?: string;
  createdAt?: Date;
}

// 별명 변경 결과 인터페이스
interface NicknameChangeResult {
  success: boolean;
  oldNickname: string;
  newNickname: string;
  alreadySpectator?: boolean;
  alreadyWaiting?: boolean;
  alreadyNormal?: boolean;
  message?: string;
  error?: string;
}

// 채널 초기화 결과 인터페이스
interface ChannelResetResult {
  success: boolean;
  channelId: string;
  channelName?: string;
  disconnectedMembers: number;
  failedDisconnects: number;
  errors: string[];
  duration?: number;
}

// 채널 검증 결과 인터페이스
interface ChannelValidationResult {
  isValid: boolean;
  exists: boolean;
  isVoiceChannel: boolean;
  isTargetCategory: boolean;
  memberCount: number;
  error?: string;
}

// 멤버 관리 결과 인터페이스 (currently unused)
// interface MemberManagementResult {
//   success: boolean;
//   affected: number;
//   failed: number;
//   errors: string[];
//   details: Array<{
//     memberId: string;
//     memberName: string;
//     success: boolean;
//     error?: string;
//   }>;
// }

// 채널 통계 인터페이스
interface ChannelStatistics {
  totalChannels: number;
  targetCategoryChannels: number;
  totalMembers: number;
  averageMembersPerChannel: number;
  channelsWithMembers: number;
  emptyChannels: number;
  channels: Array<{
    id: string;
    name: string;
    memberCount: number;
    isActive: boolean;
  }>;
}

export class VoiceChannelManager {
  private readonly client: Client;
  private readonly voiceCategoryId: string;

  // 통계 및 모니터링
  private operationStats: {
    nicknameChanges: number;
    channelResets: number;
    memberDisconnects: number;
    errors: number;
  } = {
    nicknameChanges: 0,
    channelResets: 0,
    memberDisconnects: 0,
    errors: 0,
  };

  private lastOperationTime: Date = new Date();
  private channelCache: Map<string, { info: VoiceChannelInfo; timestamp: number }> = new Map();
  private readonly cacheTimeout: number = 2 * 60 * 1000; // 2분

  constructor(client: Client, voiceCategoryId: string) {
    this.client = client;
    this.voiceCategoryId = voiceCategoryId;

    console.log(`[VoiceChannelManager] 초기화됨 - 대상 카테고리 ID: ${this.voiceCategoryId}`);

    // 정기적으로 캐시 정리
    setInterval(
      () => {
        this.cleanupExpiredCache();
      },
      5 * 60 * 1000
    ); // 5분마다 실행
  }

  /**
   * 음성 채널 생성 이벤트 처리
   * @param channel - 생성된 채널
   * @returns 처리 대상 여부
   */
  isTargetVoiceChannel(channel: Channel): boolean {
    try {
      return (
        channel.type === ChannelType.GuildVoice &&
        'parentId' in channel &&
        channel.parentId === this.voiceCategoryId
      );
    } catch (error) {
      console.error('[VoiceChannelManager] 대상 채널 확인 오류:', error);
      return false;
    }
  }

  /**
   * 음성 채널 삭제 이벤트 처리
   * @param channel - 삭제된 채널
   * @returns 처리 대상 여부
   */
  shouldHandleChannelDeletion(channel: Channel): boolean {
    try {
      // 캐시에서 제거
      this.channelCache.delete(channel.id);
      return this.isTargetVoiceChannel(channel);
    } catch (error) {
      console.error('[VoiceChannelManager] 채널 삭제 처리 확인 오류:', error);
      return false;
    }
  }

  /**
   * 음성 채널 업데이트 이벤트 처리
   * @param oldChannel - 변경 전 채널
   * @param newChannel - 변경 후 채널
   * @returns 변경 정보
   */
  detectChannelChanges(oldChannel: Channel, newChannel: Channel): ChannelChangeInfo {
    try {
      const isTarget = this.isTargetVoiceChannel(newChannel);

      // 기본 변경 정보
      let nameChanged = false;
      let limitChanged = false;
      let categoryChanged = false;
      let oldName: string = '';
      let newName: string = '';
      let oldLimit = 0;
      let newLimit = 0;
      let oldParentId: string | null = null;
      let newParentId: string | null = null;

      if ('name' in oldChannel && 'name' in newChannel) {
        nameChanged = oldChannel.name !== newChannel.name;
        oldName = oldChannel.name || '';
        newName = newChannel.name || '';
      }

      if ('userLimit' in oldChannel && 'userLimit' in newChannel) {
        limitChanged = oldChannel.userLimit !== newChannel.userLimit;
        oldLimit = oldChannel.userLimit || 0;
        newLimit = newChannel.userLimit || 0;
      }

      if ('parentId' in oldChannel && 'parentId' in newChannel) {
        categoryChanged = oldChannel.parentId !== newChannel.parentId;
        oldParentId = oldChannel.parentId;
        newParentId = newChannel.parentId;
      }

      // 캐시 무효화
      if (nameChanged || limitChanged || categoryChanged) {
        this.channelCache.delete(newChannel.id);
      }

      return {
        isTarget,
        nameChanged,
        limitChanged,
        categoryChanged,
        oldName,
        newName,
        oldLimit,
        newLimit,
        oldParentId,
        newParentId,
      };
    } catch (error) {
      console.error('[VoiceChannelManager] 채널 변경 감지 오류:', error);
      return {
        isTarget: false,
        nameChanged: false,
        limitChanged: false,
        categoryChanged: false,
        oldName: '',
        newName: '',
        oldLimit: 0,
        newLimit: 0,
      };
    }
  }

  /**
   * 음성 상태 변경 이벤트 분석
   * @param oldState - 변경 전 음성 상태
   * @param newState - 변경 후 음성 상태
   * @returns 상태 변경 정보
   */
  analyzeVoiceStateChange(oldState: VoiceState, newState: VoiceState): VoiceStateChangeInfo {
    const result: VoiceStateChangeInfo = {
      actionType: null,
      channelId: null,
      oldChannelId: null,
      member: newState.member,
      isTargetCategory: false,
      wasTargetCategory: false,
      userId: newState.id,
      memberName: newState.member?.displayName || 'Unknown',
    };

    try {
      // 채널 입장
      if (!oldState.channel && newState.channel) {
        result.actionType = 'join';
        result.channelId = newState.channel.id;
        result.channelName = newState.channel.name;
        result.isTargetCategory = newState.channel.parentId === this.voiceCategoryId;

        console.log(
          `[VoiceChannelManager] 음성 채널 입장 분석: ${result.memberName} -> ${newState.channel.name} (카테고리 일치: ${result.isTargetCategory})`
        );
        console.log(
          `[VoiceChannelManager] 채널 정보 - 실제 parentId: ${newState.channel.parentId}, 설정된 voiceCategoryId: ${this.voiceCategoryId}`
        );
      }
      // 채널 퇴장
      else if (oldState.channel && !newState.channel) {
        result.actionType = 'leave';
        result.oldChannelId = oldState.channel.id;
        result.channelId = oldState.channel.id; // 퇴장한 채널을 channelId로도 설정
        result.oldChannelName = oldState.channel.name;
        result.wasTargetCategory = oldState.channel.parentId === this.voiceCategoryId;
        result.isTargetCategory = result.wasTargetCategory; // 호환성을 위해

        console.log(
          `[VoiceChannelManager] 음성 채널 퇴장 분석: ${result.memberName} <- ${oldState.channel.name} (카테고리 일치: ${result.wasTargetCategory})`
        );
      }
      // 채널 이동
      else if (
        oldState.channel &&
        newState.channel &&
        oldState.channel.id !== newState.channel.id
      ) {
        result.actionType = 'move';
        result.channelId = newState.channel.id;
        result.oldChannelId = oldState.channel.id;
        result.channelName = newState.channel.name;
        result.oldChannelName = oldState.channel.name;
        result.isTargetCategory = newState.channel.parentId === this.voiceCategoryId;
        result.wasTargetCategory = oldState.channel.parentId === this.voiceCategoryId;

        console.log(
          `[VoiceChannelManager] 음성 채널 이동 분석: ${result.memberName} ${oldState.channel.name} -> ${newState.channel.name} (이전 카테고리: ${result.wasTargetCategory}, 현재 카테고리: ${result.isTargetCategory})`
        );
      }
      // 상태 변경 (음소거, 화면 공유 등)
      else if (
        oldState.channel &&
        newState.channel &&
        oldState.channel.id === newState.channel.id
      ) {
        result.actionType = 'update';
        result.channelId = newState.channel.id;
        result.channelName = newState.channel.name;
        result.isTargetCategory = newState.channel.parentId === this.voiceCategoryId;

        // 상태 변경은 일반적으로 참여자 수에 영향을 주지 않으므로 로그를 최소화
        console.log(
          `[VoiceChannelManager] 음성 상태 변경: ${result.memberName} in ${newState.channel.name}`
        );
      }
    } catch (error) {
      console.error('[VoiceChannelManager] 음성 상태 변경 분석 오류:', error);
      this.operationStats.errors++;
    }

    return result;
  }

  /**
   * 음성 채널 정보 가져오기 (캐시 지원)
   * @param channelId - 채널 ID
   * @returns 채널 정보
   */
  async getVoiceChannelInfo(channelId: string): Promise<VoiceChannelInfo | null> {
    try {
      // 캐시 확인
      const cached = this.getCachedChannelInfo(channelId);
      if (cached) {
        return cached;
      }

      const channel = await this.client.channels.fetch(channelId);

      if (!channel || channel.type !== ChannelType.GuildVoice) {
        console.warn(`[VoiceChannelManager] 채널을 찾을 수 없거나 음성 채널이 아님: ${channelId}`);
        return null;
      }

      const voiceChannel = channel;
      const channelInfo: VoiceChannelInfo = {
        id: voiceChannel.id,
        name: voiceChannel.name,
        parentId: voiceChannel.parentId,
        userLimit: voiceChannel.userLimit || 0,
        memberCount: voiceChannel.members.size,
        members: Array.from(voiceChannel.members.values()),
        isTargetCategory: voiceChannel.parentId === this.voiceCategoryId,
        guild: voiceChannel.guild,
        bitrate: voiceChannel.bitrate,
        categoryName: voiceChannel.parent?.name || 'Unknown',
        createdAt: voiceChannel.createdAt || undefined,
      };

      // 캐시에 저장
      this.cacheChannelInfo(channelId, channelInfo);

      return channelInfo;
    } catch (error: any) {
      // 10003 에러 (Unknown Channel)는 채널이 삭제되었음을 의미
      if (error.code === 10003) {
        console.warn(`[VoiceChannelManager] 채널이 삭제되었거나 존재하지 않음: ${channelId}`);
        return {
          deleted: true,
          channelId,
          id: channelId,
          name: 'Deleted Channel',
          parentId: null,
          userLimit: 0,
          memberCount: 0,
          members: [],
          isTargetCategory: false,
          guild: null as any,
        };
      }

      console.error(`[VoiceChannelManager] 채널 정보 가져오기 실패: ${channelId}`, error);
      this.operationStats.errors++;
      return null;
    }
  }

  /**
   * 삭제된 채널 목록 확인
   * @param channelIds - 확인할 채널 ID 목록
   * @returns 삭제된 채널 ID 목록
   */
  async getDeletedChannels(channelIds: string[]): Promise<string[]> {
    const deletedChannels: string[] = [];

    for (const channelId of channelIds) {
      try {
        await this.client.channels.fetch(channelId);
      } catch (error: any) {
        if (error.code === 10003) {
          // Unknown Channel
          deletedChannels.push(channelId);
          // 캐시에서도 제거
          this.channelCache.delete(channelId);
        }
      }
    }

    return deletedChannels;
  }

  /**
   * 음성 채널 초기화 (모든 멤버 추방)
   * @param channelId - 채널 ID
   * @returns 초기화 결과
   */
  async resetVoiceChannel(channelId: string): Promise<ChannelResetResult> {
    const startTime = Date.now();
    const result: ChannelResetResult = {
      success: false,
      channelId,
      disconnectedMembers: 0,
      failedDisconnects: 0,
      errors: [],
    };

    try {
      const channelInfo = await this.getVoiceChannelInfo(channelId);

      if (!channelInfo || channelInfo.deleted) {
        result.errors.push('채널을 찾을 수 없음');
        return result;
      }

      result.channelName = channelInfo.name;

      // 모든 멤버 연결 해제
      const disconnectPromises = channelInfo.members.map(async (member) => {
        try {
          await member.voice.disconnect('채널 초기화');
          result.disconnectedMembers++;
          return { success: true, member: member.displayName };
        } catch (error) {
          const errorMsg = `멤버 연결 해제 실패: ${member.displayName}`;
          console.warn(`[VoiceChannelManager] ${errorMsg}`, error);
          result.errors.push(errorMsg);
          result.failedDisconnects++;
          return { success: false, member: member.displayName };
        }
      });

      await Promise.all(disconnectPromises);

      // 캐시 무효화
      this.channelCache.delete(channelId);

      result.success = result.failedDisconnects === 0;
      result.duration = Date.now() - startTime;

      this.operationStats.channelResets++;
      this.operationStats.memberDisconnects += result.disconnectedMembers;
      this.lastOperationTime = new Date();

      console.log(
        `[VoiceChannelManager] 음성 채널 초기화 완료: ${channelInfo.name} (${result.disconnectedMembers}명 연결 해제, ${result.failedDisconnects}명 실패)`
      );

      return result;
    } catch (error) {
      const errorMsg = `음성 채널 초기화 실패: ${channelId}`;
      console.error(`[VoiceChannelManager] ${errorMsg}`, error);
      result.errors.push(errorMsg);
      this.operationStats.errors++;
      return result;
    }
  }

  /**
   * 멤버 별명 변경
   * @param member - 대상 멤버
   * @param newNickname - 새 별명
   * @returns 성공 여부
   */
  async changeNickname(member: GuildMember, newNickname: string): Promise<boolean> {
    try {
      const oldNickname = member.displayName;
      await member.setNickname(newNickname);

      this.operationStats.nicknameChanges++;
      this.lastOperationTime = new Date();

      console.log(`[VoiceChannelManager] 별명 변경 성공: ${oldNickname} -> ${newNickname}`);
      return true;
    } catch (error) {
      console.error(
        `[VoiceChannelManager] 별명 변경 실패: ${member.displayName} -> ${newNickname}`,
        error
      );
      this.operationStats.errors++;
      return false;
    }
  }

  /**
   * 관전 모드로 별명 변경
   * @param member - 대상 멤버
   * @returns 변경 결과
   */
  async setSpectatorMode(member: GuildMember): Promise<NicknameChangeResult> {
    try {
      const currentNickname = member.nickname || member.user.displayName;
      let newNickname: string;

      if (currentNickname.startsWith('[대기]')) {
        newNickname = currentNickname.replace('[대기]', '[관전]');
      } else if (currentNickname.startsWith('[관전]')) {
        return {
          success: false,
          alreadySpectator: true,
          oldNickname: currentNickname,
          newNickname: currentNickname,
          message: '이미 관전 모드로 설정되어 있습니다.',
        };
      } else {
        newNickname = `[관전] ${currentNickname}`;
      }

      const success = await this.changeNickname(member, newNickname);

      return {
        success,
        alreadySpectator: false,
        oldNickname: currentNickname,
        newNickname,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '알 수 없는 오류';
      console.error('[VoiceChannelManager] 관전 모드 설정 오류:', error);
      this.operationStats.errors++;

      return {
        success: false,
        oldNickname: member.displayName,
        newNickname: member.displayName,
        error: errorMsg,
      };
    }
  }

  /**
   * 대기 모드로 별명 변경
   * @param member - 대상 멤버
   * @returns 변경 결과
   */
  async setWaitingMode(member: GuildMember): Promise<NicknameChangeResult> {
    try {
      const currentNickname = member.nickname || member.user.displayName;
      let newNickname: string;

      if (currentNickname.startsWith('[관전]')) {
        newNickname = currentNickname.replace('[관전]', '[대기]');
      } else if (currentNickname.startsWith('[대기]')) {
        return {
          success: false,
          alreadyWaiting: true,
          oldNickname: currentNickname,
          newNickname: currentNickname,
          message: '이미 대기 모드로 설정되어 있습니다.',
        };
      } else {
        newNickname = `[대기] ${currentNickname}`;
      }

      const success = await this.changeNickname(member, newNickname);

      return {
        success,
        alreadyWaiting: false,
        oldNickname: currentNickname,
        newNickname,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '알 수 없는 오류';
      console.error('[VoiceChannelManager] 대기 모드 설정 오류:', error);
      this.operationStats.errors++;

      return {
        success: false,
        oldNickname: member.displayName,
        newNickname: member.displayName,
        error: errorMsg,
      };
    }
  }

  /**
   * 정상 모드로 복구 (태그 제거)
   * @param member - 대상 멤버
   * @returns 변경 결과
   */
  async restoreNormalMode(member: GuildMember): Promise<NicknameChangeResult> {
    try {
      const currentNickname = member.nickname || member.user.displayName;
      let newNickname = currentNickname;

      // [대기] 또는 [관전] 태그 제거
      if (currentNickname.startsWith('[대기]')) {
        newNickname = currentNickname.replace('[대기]', '').trim();
      } else if (currentNickname.startsWith('[관전]')) {
        newNickname = currentNickname.replace('[관전]', '').trim();
      } else {
        return {
          success: false,
          alreadyNormal: true,
          oldNickname: currentNickname,
          newNickname: currentNickname,
          message: '이미 정상 모드입니다.',
        };
      }

      const success = await this.changeNickname(member, newNickname);

      return {
        success,
        alreadyNormal: false,
        oldNickname: currentNickname,
        newNickname,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '알 수 없는 오류';
      console.error('[VoiceChannelManager] 정상 모드 복구 오류:', error);
      this.operationStats.errors++;

      return {
        success: false,
        oldNickname: member.displayName,
        newNickname: member.displayName,
        error: errorMsg,
      };
    }
  }

  /**
   * 채널 검증
   * @param channelId - 채널 ID
   * @returns 검증 결과
   */
  async validateChannel(channelId: string): Promise<ChannelValidationResult> {
    try {
      const channelInfo = await this.getVoiceChannelInfo(channelId);

      if (!channelInfo) {
        return {
          isValid: false,
          exists: false,
          isVoiceChannel: false,
          isTargetCategory: false,
          memberCount: 0,
          error: '채널을 찾을 수 없음',
        };
      }

      if (channelInfo.deleted) {
        return {
          isValid: false,
          exists: false,
          isVoiceChannel: false,
          isTargetCategory: false,
          memberCount: 0,
          error: '채널이 삭제됨',
        };
      }

      return {
        isValid: true,
        exists: true,
        isVoiceChannel: true,
        isTargetCategory: channelInfo.isTargetCategory,
        memberCount: channelInfo.memberCount,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '알 수 없는 오류';
      console.error('[VoiceChannelManager] 채널 검증 오류:', error);

      return {
        isValid: false,
        exists: false,
        isVoiceChannel: false,
        isTargetCategory: false,
        memberCount: 0,
        error: errorMsg,
      };
    }
  }

  /**
   * 대상 카테고리의 모든 채널 통계 조회
   * @returns 채널 통계
   */
  async getChannelStatistics(): Promise<ChannelStatistics> {
    try {
      const guild = this.client.guilds.cache.first();
      if (!guild) {
        throw new Error('길드를 찾을 수 없음');
      }

      const allChannels = guild.channels.cache.filter(
        (channel) => channel.type === ChannelType.GuildVoice
      );

      const targetCategoryChannels = allChannels.filter(
        (channel) => 'parentId' in channel && channel.parentId === this.voiceCategoryId
      );

      let totalMembers = 0;
      let channelsWithMembers = 0;
      const channels: Array<{ id: string; name: string; memberCount: number; isActive: boolean }> =
        [];

      for (const channel of targetCategoryChannels.values()) {
        const voiceChannel = channel;
        const memberCount = voiceChannel.members.size;
        totalMembers += memberCount;

        if (memberCount > 0) {
          channelsWithMembers++;
        }

        channels.push({
          id: voiceChannel.id,
          name: voiceChannel.name,
          memberCount,
          isActive: memberCount > 0,
        });
      }

      return {
        totalChannels: allChannels.size,
        targetCategoryChannels: targetCategoryChannels.size,
        totalMembers,
        averageMembersPerChannel:
          targetCategoryChannels.size > 0 ? totalMembers / targetCategoryChannels.size : 0,
        channelsWithMembers,
        emptyChannels: targetCategoryChannels.size - channelsWithMembers,
        channels,
      };
    } catch (error) {
      console.error('[VoiceChannelManager] 채널 통계 조회 오류:', error);
      return {
        totalChannels: 0,
        targetCategoryChannels: 0,
        totalMembers: 0,
        averageMembersPerChannel: 0,
        channelsWithMembers: 0,
        emptyChannels: 0,
        channels: [],
      };
    }
  }

  /**
   * 운영 통계 조회
   * @returns 운영 통계
   */
  getOperationStats(): typeof this.operationStats & { lastOperationTime: Date } {
    return {
      ...this.operationStats,
      lastOperationTime: this.lastOperationTime,
    };
  }

  /**
   * 캐시된 채널 정보 조회
   * @param channelId - 채널 ID
   * @returns 캐시된 채널 정보
   */
  private getCachedChannelInfo(channelId: string): VoiceChannelInfo | null {
    const cached = this.channelCache.get(channelId);
    if (!cached) return null;

    // 캐시 만료 확인
    if (Date.now() - cached.timestamp > this.cacheTimeout) {
      this.channelCache.delete(channelId);
      return null;
    }

    return cached.info;
  }

  /**
   * 채널 정보 캐시에 저장
   * @param channelId - 채널 ID
   * @param info - 채널 정보
   */
  private cacheChannelInfo(channelId: string, info: VoiceChannelInfo): void {
    this.channelCache.set(channelId, {
      info,
      timestamp: Date.now(),
    });
  }

  /**
   * 만료된 캐시 정리
   */
  private cleanupExpiredCache(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [channelId, cached] of this.channelCache.entries()) {
      if (now - cached.timestamp > this.cacheTimeout) {
        this.channelCache.delete(channelId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[VoiceChannelManager] 만료된 캐시 정리: ${cleanedCount}개 항목 제거`);
    }
  }
}
