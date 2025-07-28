// src/interfaces/IActivityTracker.ts - 활동 추적 서비스 인터페이스

import type { VoiceState, GuildMember, Collection, Guild } from 'discord.js';

import type { UserClassification, ClassifiedUser } from '../services/activityTracker';

/**
 * 활동 추적 서비스 인터페이스 (간소화 버전)
 * 현재 ActivityTracker 구현에 맞춘 핵심 메서드들
 */
export interface IActivityTracker {
  // 초기화 및 이벤트 핸들러
  initializeActivityData(guild: Guild): Promise<void>;
  handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void>;
  handleGuildMemberUpdate(oldMember: GuildMember, newMember: GuildMember): Promise<void>;

  // 사용자 분류 (실제 메서드 시그니처에 맞춤)
  classifyUsersByRole(
    roleName: string,
    roleMembers: Collection<string, GuildMember>
  ): Promise<UserClassification>;

  // 데이터 저장 및 로드
  saveActivityData(): Promise<void>;
  loadActivityData(): Promise<void>;
  loadRoleActivityConfig(guildId?: string): Promise<void>;

  // Redis 세션 관리
  restoreActiveSessions(): Promise<void>;

  // 활동 데이터 관리
  getActiveMembersData(): Promise<ClassifiedUser[]>;
  clearAndReinitializeActivityData(role: string): Promise<void>;
  
  // 날짜 범위별 활동 사용자 ID 조회
  getActiveUserIds(guildId: string, startDate: string, endDate: string): Promise<Set<string>>;
}
