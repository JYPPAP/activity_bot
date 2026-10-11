// src/services/ParticipantTracker.js - 참여자 추적 및 관리
import { TextProcessor } from '../utils/TextProcessor.js';

export class ParticipantTracker {
  constructor(client) {
    this.client = client;
  }
  
  /**
   * 음성 채널의 실제 참여자 수 계산 (대기/관전 제외)
   * @param {VoiceChannel} voiceChannel - 음성 채널
   * @returns {number} - 실제 참여자 수
   */
  countActiveParticipants(voiceChannel) {
    if (!voiceChannel || !voiceChannel.members) {
      return 0;
    }
    
    let activeCount = 0;
    voiceChannel.members.forEach(member => {
      const displayName = member.displayName;
      
      // [관전] 태그만 제외하고 카운트 ([대기]는 포함)
      const { hasSpectateTag } = TextProcessor.checkSpecialTags(displayName);
      if (!hasSpectateTag) {
        activeCount++;
      }
    });
    
    return activeCount;
  }
  
  /**
   * 음성 채널의 전체 참여자 수 (대기/관전 포함)
   * @param {VoiceChannel} voiceChannel - 음성 채널
   * @returns {number} - 전체 참여자 수
   */
  // countTotalParticipants(voiceChannel) {
  //   if (!voiceChannel || !voiceChannel.members) {
  //     return 0;
  //   }
  //
  //   return voiceChannel.members.size;
  // }
  
  /**
   * 참여자 목록 가져오기 (구분별)
   * @param {VoiceChannel} voiceChannel - 음성 채널
   * @returns {Object} - { active: Array, waiting: Array, spectating: Array }
   */
  // getParticipantsByType(voiceChannel) {
  //   const result = {
  //     active: [],
  //     waiting: [],
  //     spectating: []
  //   };
  //
  //   if (!voiceChannel || !voiceChannel.members) {
  //     return result;
  //   }
  //
  //   voiceChannel.members.forEach(member => {
  //     const displayName = member.displayName;
  //     const { hasWaitTag, hasSpectateTag } = TextProcessor.checkSpecialTags(displayName);
  //
  //     if (hasWaitTag) {
  //       result.waiting.push({
  //         id: member.id,
  //         displayName: displayName,
  //         cleanName: TextProcessor.cleanNickname(displayName)
  //       });
  //     } else if (hasSpectateTag) {
  //       result.spectating.push({
  //         id: member.id,
  //         displayName: displayName,
  //         cleanName: TextProcessor.cleanNickname(displayName)
  //       });
  //     } else {
  //       result.active.push({
  //         id: member.id,
  //         displayName: displayName,
  //         cleanName: displayName
  //       });
  //     }
  //   });
  //
  //   return result;
  // }
  
  /**
   * 제목에서 최대 인원 수 추출
   * @param {string} title - 포스트 제목
   * @returns {number|string} - 최대 인원 수 (기본값: N) 또는 'N'/'n'
   */
  extractMaxParticipants(title) {
    if (!title) return 'N';
    
    // "1/4", "2/5", "1/N", "1/n" 같은 패턴에서 최대값 추출
    const match = title.match(/(\d+)\/(\d+|[Nn])/);
    if (match) {
      const maxValue = match[2];
      // N 또는 n인 경우 그대로 반환, 숫자인 경우 parseInt
      return /^[Nn]$/.test(maxValue) ? maxValue : parseInt(maxValue, 10);
    }
    
    return 'N'; // 기본값
  }
  
  /**
   * 제목에서 현재 인원 수 추출
   * @param {string} title - 포스트 제목
   * @returns {number} - 현재 인원 수 (기본값: 0)
   */
  extractCurrentParticipants(title) {
    if (!title) return 0;
    
    // "1/4", "2/5" 같은 패턴에서 현재값 추출
    const match = title.match(/(\d+)\/(\d+|[Nn])/);
    if (match) {
      return parseInt(match[1], 10);
    }
    
    return 0; // 기본값
  }
  
  /**
   * 참여자 수 변화 감지
   * @param {VoiceChannel} voiceChannel - 음성 채널
   * @param {number} previousCount - 이전 참여자 수
   * @returns {Object} - { changed: boolean, currentCount: number, difference: number }
   */
  // detectParticipantChange(voiceChannel, previousCount) {
  //   const currentCount = this.countActiveParticipants(voiceChannel);
  //   const difference = currentCount - previousCount;
  //
  //   return {
  //     changed: difference !== 0,
  //     currentCount,
  //     difference,
  //     increased: difference > 0,
  //     decreased: difference < 0
  //   };
  // }
  
  /**
   * 참여자 통계 생성
   * @param {VoiceChannel} voiceChannel - 음성 채널
   * @returns {Object} - 참여자 통계
   */
  // generateParticipantStats(voiceChannel) {
  //   const participants = this.getParticipantsByType(voiceChannel);
  //
  //   return {
  //     total: this.countTotalParticipants(voiceChannel),
  //     active: participants.active.length,
  //     waiting: participants.waiting.length,
  //     spectating: participants.spectating.length,
  //     participants: participants,
  //     summary: `활성: ${participants.active.length}, 대기: ${participants.waiting.length}, 관전: ${participants.spectating.length}`
  //   };
  // }
  
  /**
   * 참여자 목록을 텍스트로 포맷팅
   * @param {Object} participants - getParticipantsByType 결과
   * @returns {string} - 포맷팅된 참여자 목록
   */
  // formatParticipantList(participants) {
  //   let result = '';
  //
  //   if (participants.active.length > 0) {
  //     result += `**🎮 활성 참여자 (${participants.active.length}명)**\n`;
  //     participants.active.forEach((p, i) => {
  //       result += `${i + 1}. ${p.displayName}\n`;
  //     });
  //     result += '\n';
  //   }
  //
  //   if (participants.waiting.length > 0) {
  //     result += `**⏳ 대기 중 (${participants.waiting.length}명)**\n`;
  //     participants.waiting.forEach((p, i) => {
  //       result += `${i + 1}. ${p.displayName}\n`;
  //     });
  //     result += '\n';
  //   }
  //
  //   if (participants.spectating.length > 0) {
  //     result += `**👁️ 관전 중 (${participants.spectating.length}명)**\n`;
  //     participants.spectating.forEach((p, i) => {
  //       result += `${i + 1}. ${p.displayName}\n`;
  //     });
  //   }
  //
  //   return result || '참여자가 없습니다.';
  // }
  
  /**
   * 멤버 별명 변경 감지 (대기/관전 태그 변화)
   * @param {GuildMember} oldMember - 변경 전 멤버
   * @param {GuildMember} newMember - 변경 후 멤버
   * @returns {Object} - 변경 정보
   */
  detectNicknameTagChange(oldMember, newMember) {
    if (oldMember.displayName === newMember.displayName) {
      return { changed: false };
    }
    
    const oldTags = TextProcessor.checkSpecialTags(oldMember.displayName);
    const newTags = TextProcessor.checkSpecialTags(newMember.displayName);
    
    const tagStatusChanged = (
      oldTags.hasWaitTag !== newTags.hasWaitTag ||
      oldTags.hasSpectateTag !== newTags.hasSpectateTag
    );
    
    return {
      changed: tagStatusChanged,
      oldDisplayName: oldMember.displayName,
      newDisplayName: newMember.displayName,
      oldTags,
      newTags,
      becameActive: (oldTags.hasWaitTag || oldTags.hasSpectateTag) && (!newTags.hasWaitTag && !newTags.hasSpectateTag),
      becameInactive: (!oldTags.hasWaitTag && !oldTags.hasSpectateTag) && (newTags.hasWaitTag || newTags.hasSpectateTag)
    };
  }
}
