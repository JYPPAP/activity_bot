// src/services/ParticipantTracker.ts - 참여자 추적 및 관리
import { Client, VoiceChannel, GuildMember, Collection } from 'discord.js';
import { TextProcessor } from '../utils/TextProcessor.js';
import { DiscordConstants } from '../config/DiscordConstants.js';

// 참여자 정보 인터페이스
interface ParticipantInfo {
  id: string;
  displayName: string;
  cleanName: string;
  joinedAt?: number;
  activeTime?: number;
}

// 참여자 유형별 분류
interface ParticipantsByType {
  active: ParticipantInfo[];
  waiting: ParticipantInfo[];
  spectating: ParticipantInfo[];
}

// 참여자 변화 감지 결과
interface ParticipantChange {
  changed: boolean;
  currentCount: number;
  difference: number;
  increased?: boolean;
  decreased?: boolean;
}

// 참여자 통계
interface ParticipantStats {
  total: number;
  active: number;
  waiting: number;
  spectating: number;
  participants: ParticipantsByType;
  summary: string;
  peakCount?: number;
  averageSessionTime?: number;
}

// 닉네임 태그 변화 감지 결과
interface NicknameTagChange {
  changed: boolean;
  oldDisplayName?: string;
  newDisplayName?: string;
  oldTags?: { hasWaitTag: boolean; hasSpectateTag: boolean };
  newTags?: { hasWaitTag: boolean; hasSpectateTag: boolean };
  becameActive?: boolean;
  becameInactive?: boolean;
}

// 참여자 추적 설정
interface ParticipantTrackerConfig {
  trackActiveTime: boolean;
  trackSessionHistory: boolean;
  maxHistoryEntries: number;
  autoCleanupInterval: number;
  enableStatistics: boolean;
  logTagChanges: boolean;
}

export class ParticipantTracker {
  private client: Client;
  private config: ParticipantTrackerConfig;
  private participantHistory: Map<string, ParticipantInfo[]>;
  private channelPeakCounts: Map<string, number>;
  private sessionStartTimes: Map<string, number>;
  private statistics: {
    totalParticipantChanges: number;
    tagChanges: number;
    peakConcurrentUsers: number;
    averageSessionTime: number;
    lastCleanup: number;
  };

  constructor(client: Client, config: Partial<ParticipantTrackerConfig> = {}) {
    this.client = client;
    this.config = {
      trackActiveTime: true,
      trackSessionHistory: true,
      maxHistoryEntries: 1000,
      autoCleanupInterval: 3600000, // 1시간
      enableStatistics: true,
      logTagChanges: true,
      ...config
    };
    
    this.participantHistory = new Map();
    this.channelPeakCounts = new Map();
    this.sessionStartTimes = new Map();
    this.statistics = {
      totalParticipantChanges: 0,
      tagChanges: 0,
      peakConcurrentUsers: 0,
      averageSessionTime: 0,
      lastCleanup: Date.now()
    };

    if (this.config.autoCleanupInterval > 0) {
      this.startAutoCleanup();
    }
  }

  /**
   * 음성 채널의 실제 참여자 수 계산 (대기/관전 제외)
   * @param voiceChannel - 음성 채널
   * @returns 실제 참여자 수
   */
  countActiveParticipants(voiceChannel: VoiceChannel | null): number {
    if (!voiceChannel?.members) {
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
    
    // 통계 업데이트
    if (this.config.enableStatistics) {
      this.updatePeakCount(voiceChannel.id, activeCount);
      if (activeCount > this.statistics.peakConcurrentUsers) {
        this.statistics.peakConcurrentUsers = activeCount;
      }
    }
    
    return activeCount;
  }

  /**
   * 음성 채널의 전체 참여자 수 (대기/관전 포함)
   * @param voiceChannel - 음성 채널
   * @returns 전체 참여자 수
   */
  countTotalParticipants(voiceChannel: VoiceChannel | null): number {
    if (!voiceChannel?.members) {
      return 0;
    }
    return voiceChannel.members.size;
  }

  /**
   * 참여자 목록 가져오기 (구분별)
   * @param voiceChannel - 음성 채널
   * @returns 유형별 참여자 목록
   */
  getParticipantsByType(voiceChannel: VoiceChannel | null): ParticipantsByType {
    const result: ParticipantsByType = {
      active: [],
      waiting: [],
      spectating: []
    };

    if (!voiceChannel?.members) {
      return result;
    }

    const now = Date.now();
    voiceChannel.members.forEach(member => {
      const displayName = member.displayName;
      const { hasWaitTag, hasSpectateTag } = TextProcessor.checkSpecialTags(displayName);

      const participantInfo: ParticipantInfo = {
        id: member.id,
        displayName: displayName,
        cleanName: TextProcessor.cleanNickname(displayName),
        joinedAt: this.sessionStartTimes.get(member.id) || now
      };

      if (this.config.trackActiveTime && this.sessionStartTimes.has(member.id)) {
        participantInfo.activeTime = now - this.sessionStartTimes.get(member.id)!;
      }

      if (hasWaitTag) {
        result.waiting.push(participantInfo);
      } else if (hasSpectateTag) {
        result.spectating.push(participantInfo);
      } else {
        result.active.push(participantInfo);
      }
    });

    return result;
  }

  /**
   * 제목에서 최대 인원 수 추출
   * @param title - 포스트 제목
   * @returns 최대 인원 수 (기본값: N) 또는 'N'/'n'
   */
  extractMaxParticipants(title: string | null): number | string {
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
   * @param title - 포스트 제목
   * @returns 현재 인원 수 (기본값: 0)
   */
  extractCurrentParticipants(title: string | null): number {
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
   * @param voiceChannel - 음성 채널
   * @param previousCount - 이전 참여자 수
   * @returns 변화 감지 결과
   */
  detectParticipantChange(voiceChannel: VoiceChannel | null, previousCount: number): ParticipantChange {
    const currentCount = this.countActiveParticipants(voiceChannel);
    const difference = currentCount - previousCount;

    if (this.config.enableStatistics && difference !== 0) {
      this.statistics.totalParticipantChanges++;
    }

    return {
      changed: difference !== 0,
      currentCount,
      difference,
      increased: difference > 0,
      decreased: difference < 0
    };
  }

  /**
   * 참여자 통계 생성
   * @param voiceChannel - 음성 채널
   * @returns 참여자 통계
   */
  generateParticipantStats(voiceChannel: VoiceChannel | null): ParticipantStats {
    const participants = this.getParticipantsByType(voiceChannel);
    const peakCount = voiceChannel ? this.channelPeakCounts.get(voiceChannel.id) || 0 : 0;
    
    // 평균 세션 시간 계산
    let averageSessionTime = 0;
    if (this.config.trackActiveTime) {
      const activeTimes = [
        ...participants.active,
        ...participants.waiting,
        ...participants.spectating
      ]
        .filter(p => p.activeTime !== undefined)
        .map(p => p.activeTime!);
      
      if (activeTimes.length > 0) {
        averageSessionTime = activeTimes.reduce((sum, time) => sum + time, 0) / activeTimes.length;
      }
    }

    return {
      total: this.countTotalParticipants(voiceChannel),
      active: participants.active.length,
      waiting: participants.waiting.length,
      spectating: participants.spectating.length,
      participants: participants,
      summary: `활성: ${participants.active.length}, 대기: ${participants.waiting.length}, 관전: ${participants.spectating.length}`,
      peakCount,
      averageSessionTime
    };
  }

  /**
   * 참여자 목록을 텍스트로 포맷팅
   * @param participants - getParticipantsByType 결과
   * @returns 포맷팅된 참여자 목록
   */
  formatParticipantList(participants: ParticipantsByType): string {
    let result = '';

    if (participants.active.length > 0) {
      result += `**🎮 활성 참여자 (${participants.active.length}명)**\n`;
      participants.active.forEach((p, i) => {
        let line = `${i + 1}. ${p.displayName}`;
        if (p.activeTime) {
          line += ` (${this.formatActiveTime(p.activeTime)})`;
        }
        result += line + '\n';
      });
      result += '\n';
    }

    if (participants.waiting.length > 0) {
      result += `**⏳ 대기 중 (${participants.waiting.length}명)**\n`;
      participants.waiting.forEach((p, i) => {
        let line = `${i + 1}. ${p.displayName}`;
        if (p.activeTime) {
          line += ` (${this.formatActiveTime(p.activeTime)})`;
        }
        result += line + '\n';
      });
      result += '\n';
    }

    if (participants.spectating.length > 0) {
      result += `**👁️ 관전 중 (${participants.spectating.length}명)**\n`;
      participants.spectating.forEach((p, i) => {
        let line = `${i + 1}. ${p.displayName}`;
        if (p.activeTime) {
          line += ` (${this.formatActiveTime(p.activeTime)})`;
        }
        result += line + '\n';
      });
    }

    return result || '참여자가 없습니다.';
  }

  /**
   * 멤버 별명 변경 감지 (대기/관전 태그 변화)
   * @param oldMember - 변경 전 멤버
   * @param newMember - 변경 후 멤버
   * @returns 변경 정보
   */
  detectNicknameTagChange(oldMember: GuildMember, newMember: GuildMember): NicknameTagChange {
    if (oldMember.displayName === newMember.displayName) {
      return { changed: false };
    }
    
    const oldTags = TextProcessor.checkSpecialTags(oldMember.displayName);
    const newTags = TextProcessor.checkSpecialTags(newMember.displayName);
    
    const tagStatusChanged = (
      oldTags.hasWaitTag !== newTags.hasWaitTag ||
      oldTags.hasSpectateTag !== newTags.hasSpectateTag
    );

    if (tagStatusChanged && this.config.enableStatistics) {
      this.statistics.tagChanges++;
    }
    
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

  /**
   * 참여자 세션 시작 추적
   * @param userId - 사용자 ID
   */
  trackSessionStart(userId: string): void {
    if (this.config.trackActiveTime) {
      this.sessionStartTimes.set(userId, Date.now());
    }
  }

  /**
   * 참여자 세션 종료 추적
   * @param userId - 사용자 ID
   * @returns 세션 시간 (밀리초)
   */
  trackSessionEnd(userId: string): number {
    if (!this.config.trackActiveTime) return 0;
    
    const startTime = this.sessionStartTimes.get(userId);
    if (!startTime) return 0;
    
    const sessionTime = Date.now() - startTime;
    this.sessionStartTimes.delete(userId);
    
    // 평균 세션 시간 업데이트
    if (this.config.enableStatistics) {
      this.updateAverageSessionTime(sessionTime);
    }
    
    return sessionTime;
  }

  /**
   * 참여자 히스토리 추가
   * @param channelId - 채널 ID
   * @param participant - 참여자 정보
   */
  addToHistory(channelId: string, participant: ParticipantInfo): void {
    if (!this.config.trackSessionHistory) return;
    
    if (!this.participantHistory.has(channelId)) {
      this.participantHistory.set(channelId, []);
    }
    
    const history = this.participantHistory.get(channelId)!;
    history.push({ ...participant, joinedAt: Date.now() });
    
    // 최대 항목 수 제한
    if (history.length > this.config.maxHistoryEntries) {
      history.shift();
    }
  }

  /**
   * 채널별 최대 참여자 수 업데이트
   * @param channelId - 채널 ID
   * @param count - 현재 참여자 수
   */
  private updatePeakCount(channelId: string, count: number): void {
    const currentPeak = this.channelPeakCounts.get(channelId) || 0;
    if (count > currentPeak) {
      this.channelPeakCounts.set(channelId, count);
    }
  }

  /**
   * 평균 세션 시간 업데이트
   * @param sessionTime - 세션 시간
   */
  private updateAverageSessionTime(sessionTime: number): void {
    const currentAverage = this.statistics.averageSessionTime;
    const totalChanges = this.statistics.totalParticipantChanges;
    
    if (totalChanges === 0) {
      this.statistics.averageSessionTime = sessionTime;
    } else {
      this.statistics.averageSessionTime = (currentAverage * totalChanges + sessionTime) / (totalChanges + 1);
    }
  }

  /**
   * 활성 시간 포맷팅
   * @param milliseconds - 밀리초
   * @returns 포맷팅된 시간 문자열
   */
  private formatActiveTime(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}시간 ${minutes % 60}분`;
    } else if (minutes > 0) {
      return `${minutes}분 ${seconds % 60}초`;
    } else {
      return `${seconds}초`;
    }
  }

  /**
   * 자동 정리 시작
   */
  private startAutoCleanup(): void {
    setInterval(() => {
      this.cleanup();
    }, this.config.autoCleanupInterval);
  }

  /**
   * 메모리 정리
   */
  cleanup(): void {
    const now = Date.now();
    const cutoffTime = now - (24 * 60 * 60 * 1000); // 24시간
    
    // 오래된 세션 시작 시간 제거
    for (const [userId, startTime] of this.sessionStartTimes.entries()) {
      if (startTime < cutoffTime) {
        this.sessionStartTimes.delete(userId);
      }
    }
    
    // 오래된 히스토리 제거
    for (const [channelId, history] of this.participantHistory.entries()) {
      const filteredHistory = history.filter(p => (p.joinedAt || 0) > cutoffTime);
      if (filteredHistory.length === 0) {
        this.participantHistory.delete(channelId);
      } else {
        this.participantHistory.set(channelId, filteredHistory);
      }
    }
    
    this.statistics.lastCleanup = now;
  }

  /**
   * 통계 가져오기
   * @returns 추적 통계
   */
  getStatistics(): typeof this.statistics {
    return { ...this.statistics };
  }

  /**
   * 설정 업데이트
   * @param newConfig - 새 설정
   */
  updateConfig(newConfig: Partial<ParticipantTrackerConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 채널 히스토리 가져오기
   * @param channelId - 채널 ID
   * @returns 참여자 히스토리
   */
  getChannelHistory(channelId: string): ParticipantInfo[] {
    return this.participantHistory.get(channelId) || [];
  }

  /**
   * 채널 최대 참여자 수 가져오기
   * @param channelId - 채널 ID
   * @returns 최대 참여자 수
   */
  getChannelPeakCount(channelId: string): number {
    return this.channelPeakCounts.get(channelId) || 0;
  }
}