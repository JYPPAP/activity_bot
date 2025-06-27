// src/services/VoiceChannelManager.js - 음성 채널 관리
import { DiscordConstants } from '../config/DiscordConstants.js';
import { RecruitmentConfig } from '../config/RecruitmentConfig.js';

export class VoiceChannelManager {
  constructor(client, voiceCategoryId) {
    this.client = client;
    this.voiceCategoryId = voiceCategoryId;
  }
  
  /**
   * 음성 채널 생성 이벤트 처리
   * @param {Channel} channel - 생성된 채널
   * @returns {boolean} - 처리 대상 여부
   */
  isTargetVoiceChannel(channel) {
    return (
      channel.type === DiscordConstants.CHANNEL_TYPES.GUILD_VOICE &&
      channel.parentId === this.voiceCategoryId
    );
  }
  
  /**
   * 음성 채널 삭제 이벤트 처리
   * @param {Channel} channel - 삭제된 채널
   * @returns {boolean} - 처리 대상 여부
   */
  shouldHandleChannelDeletion(channel) {
    return this.isTargetVoiceChannel(channel);
  }
  
  /**
   * 음성 채널 업데이트 이벤트 처리
   * @param {Channel} oldChannel - 변경 전 채널
   * @param {Channel} newChannel - 변경 후 채널
   * @returns {Object} - 변경 정보
   */
  detectChannelChanges(oldChannel, newChannel) {
    const isTarget = this.isTargetVoiceChannel(newChannel);
    const nameChanged = oldChannel.name !== newChannel.name;
    const limitChanged = oldChannel.userLimit !== newChannel.userLimit;
    
    return {
      isTarget,
      nameChanged,
      limitChanged,
      oldName: oldChannel.name,
      newName: newChannel.name,
      oldLimit: oldChannel.userLimit,
      newLimit: newChannel.userLimit
    };
  }
  
  /**
   * 음성 상태 변경 이벤트 분석
   * @param {VoiceState} oldState - 변경 전 음성 상태
   * @param {VoiceState} newState - 변경 후 음성 상태
   * @returns {Object} - 상태 변경 정보
   */
  analyzeVoiceStateChange(oldState, newState) {
    const result = {
      actionType: null,
      channelId: null,
      oldChannelId: null,
      member: newState.member,
      isTargetCategory: false,
      wasTargetCategory: false
    };
    
    // 채널 입장
    if (!oldState.channel && newState.channel) {
      result.actionType = 'join';
      result.channelId = newState.channel.id;
      result.isTargetCategory = newState.channel.parentId === this.voiceCategoryId;
      console.log(`[VoiceChannelManager] 음성 채널 입장 분석: ${newState.member?.displayName} -> ${newState.channel.name} (카테고리 일치: ${result.isTargetCategory})`);
    }
    // 채널 퇴장
    else if (oldState.channel && !newState.channel) {
      result.actionType = 'leave';
      result.oldChannelId = oldState.channel.id;
      result.channelId = oldState.channel.id; // 퇴장한 채널을 channelId로도 설정
      result.wasTargetCategory = oldState.channel.parentId === this.voiceCategoryId;
      result.isTargetCategory = result.wasTargetCategory; // 호환성을 위해
      console.log(`[VoiceChannelManager] 음성 채널 퇴장 분석: ${newState.member?.displayName} <- ${oldState.channel.name} (카테고리 일치: ${result.wasTargetCategory})`);
    }
    // 채널 이동
    else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
      result.actionType = 'move';
      result.channelId = newState.channel.id;
      result.oldChannelId = oldState.channel.id;
      result.isTargetCategory = newState.channel.parentId === this.voiceCategoryId;
      result.wasTargetCategory = oldState.channel.parentId === this.voiceCategoryId;
      console.log(`[VoiceChannelManager] 음성 채널 이동 분석: ${newState.member?.displayName} ${oldState.channel.name} -> ${newState.channel.name} (이전 카테고리: ${result.wasTargetCategory}, 현재 카테고리: ${result.isTargetCategory})`);
    }
    // 상태 변경 (음소거, 화면 공유 등)
    else if (oldState.channel && newState.channel && oldState.channel.id === newState.channel.id) {
      result.actionType = 'update';
      result.channelId = newState.channel.id;
      result.isTargetCategory = newState.channel.parentId === this.voiceCategoryId;
      // 상태 변경은 일반적으로 참여자 수에 영향을 주지 않으므로 로그를 최소화
      console.log(`[VoiceChannelManager] 음성 상태 변경: ${newState.member?.displayName} in ${newState.channel.name}`);
    }
    
    return result;
  }
  
  /**
   * 음성 채널 정보 가져오기
   * @param {string} channelId - 채널 ID
   * @returns {Promise<Object|null>} - 채널 정보
   */
  async getVoiceChannelInfo(channelId) {
    try {
      const channel = await this.client.channels.fetch(channelId);
      
      if (!channel || channel.type !== DiscordConstants.CHANNEL_TYPES.GUILD_VOICE) {
        return null;
      }
      
      return {
        id: channel.id,
        name: channel.name,
        parentId: channel.parentId,
        userLimit: channel.userLimit,
        memberCount: channel.members.size,
        members: Array.from(channel.members.values()),
        isTargetCategory: channel.parentId === this.voiceCategoryId,
        guild: channel.guild
      };
    } catch (error) {
      console.error(`[VoiceChannelManager] 채널 정보 가져오기 실패: ${channelId}`, error);
      return null;
    }
  }
  
  /**
   * 삭제된 채널 목록 확인
   * @param {Array<string>} channelIds - 확인할 채널 ID 목록
   * @returns {Promise<Array<string>>} - 삭제된 채널 ID 목록
   */
  async getDeletedChannels(channelIds) {
    const deletedChannels = [];
    
    for (const channelId of channelIds) {
      try {
        await this.client.channels.fetch(channelId);
      } catch (error) {
        if (error.code === 10003) { // Unknown Channel
          deletedChannels.push(channelId);
        }
      }
    }
    
    return deletedChannels;
  }
  
  /**
   * 음성 채널 초기화 (모든 멤버 추방)
   * @param {string} channelId - 채널 ID
   * @returns {Promise<boolean>} - 성공 여부
   */
  async resetVoiceChannel(channelId) {
    try {
      const channelInfo = await this.getVoiceChannelInfo(channelId);
      
      if (!channelInfo) {
        console.error(`[VoiceChannelManager] 채널을 찾을 수 없음: ${channelId}`);
        return false;
      }
      
      // 모든 멤버 연결 해제
      const disconnectPromises = channelInfo.members.map(member => {
        return member.voice.disconnect('채널 초기화').catch(error => {
          console.warn(`[VoiceChannelManager] 멤버 연결 해제 실패: ${member.displayName}`, error);
        });
      });
      
      await Promise.all(disconnectPromises);
      
      console.log(`[VoiceChannelManager] 음성 채널 초기화 완료: ${channelInfo.name} (${channelInfo.members.length}명 연결 해제)`);
      return true;
      
    } catch (error) {
      console.error(`[VoiceChannelManager] 음성 채널 초기화 실패: ${channelId}`, error);
      return false;
    }
  }
  
  /**
   * 멤버 별명 변경
   * @param {GuildMember} member - 대상 멤버
   * @param {string} newNickname - 새 별명
   * @returns {Promise<boolean>} - 성공 여부
   */
  async changeNickname(member, newNickname) {
    try {
      await member.setNickname(newNickname);
      console.log(`[VoiceChannelManager] 별명 변경 성공: ${member.displayName} -> ${newNickname}`);
      return true;
    } catch (error) {
      console.error(`[VoiceChannelManager] 별명 변경 실패: ${member.displayName} -> ${newNickname}`, error);
      return false;
    }
  }
  
  /**
   * 관전 모드로 별명 변경
   * @param {GuildMember} member - 대상 멤버
   * @returns {Promise<Object>} - 변경 결과
   */
  async setSpectatorMode(member) {
    const currentNickname = member.nickname || member.user.displayName;
    let newNickname;
    
    if (currentNickname.startsWith('[대기]')) {
      newNickname = currentNickname.replace('[대기]', '[관전]');
    } else if (currentNickname.startsWith('[관전]')) {
      return {
        success: false,
        alreadySpectator: true,
        message: '이미 관전 모드로 설정되어 있습니다.'
      };
    } else {
      newNickname = `[관전] ${currentNickname}`;
    }
    
    const success = await this.changeNickname(member, newNickname);
    
    return {
      success,
      alreadySpectator: false,
      oldNickname: currentNickname,
      newNickname: newNickname
    };
  }
  
  /**
   * 대기 모드로 별명 변경
   * @param {GuildMember} member - 대상 멤버
   * @returns {Promise<Object>} - 변경 결과
   */
  async setWaitingMode(member) {
    const currentNickname = member.nickname || member.user.displayName;
    let newNickname;
    
    if (currentNickname.startsWith('[관전]')) {
      newNickname = currentNickname.replace('[관전]', '[대기]');
    } else if (currentNickname.startsWith('[대기]')) {
      return {
        success: false,
        alreadyWaiting: true,
        message: '이미 대기 모드로 설정되어 있습니다.'
      };
    } else {
      newNickname = `[대기] ${currentNickname}`;
    }
    
    const success = await this.changeNickname(member, newNickname);
    
    return {
      success,
      alreadyWaiting: false,
      oldNickname: currentNickname,
      newNickname: newNickname
    };
  }
  
  /**
   * 정상 모드로 복구 (태그 제거)
   * @param {GuildMember} member - 대상 멤버
   * @returns {Promise<Object>} - 변경 결과
   */
  async restoreNormalMode(member) {
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
        message: '이미 정상 모드입니다.'
      };
    }
    
    const success = await this.changeNickname(member, newNickname);
    
    return {
      success,
      alreadyNormal: false,
      oldNickname: currentNickname,
      newNickname: newNickname
    };
  }
}