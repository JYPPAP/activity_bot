// src/services/activityTracker.js - 활동 추적 서비스 (PostgreSQL 버전)
import {TIME, FILTERS, MESSAGE_TYPES} from '../config/constants.js';
import {config} from '../config/env.js';

export class ActivityTracker {
  constructor(client, dbManager, logService) {
    this.client = client;
    this.db = dbManager;
    this.logService = logService;
    // 현재 활성 세션만 메모리에 저장 (userId -> {startTime, displayName})
    this.activeSessions = new Map();
  }

  /**
   * 현재 활성 세션 로드 (서버 재시작시 복구용)
   */
  async loadActiveSessions() {
    try {
      // 음성 채널에 현재 있는 사용자들의 세션을 복구
      const guild = this.client.guilds.cache.get(config.GUILDID);
      if (!guild) return;

      const members = await guild.members.fetch();
      const now = Date.now();

      for (const [userId, member] of members.entries()) {
        // 현재 음성 채널에 있고, 제외 대상이 아닌 경우
        if (member.voice?.channelId && 
            !config.EXCLUDED_CHANNELS.includes(member.voice.channelId) &&
            !this.isObservationOrWaiting(member)) {
          
          this.activeSessions.set(userId, {
            startTime: now,
            displayName: member.displayName
          });
        }
      }

      console.log(`${this.activeSessions.size}명의 활성 세션을 복구했습니다.`);
    } catch (error) {
      console.error('활성 세션 로드 오류:', error);
    }
  }

  /**
   * 역할 활동 설정을 DB에서 로드
   */
  async loadRoleActivityConfig() {
    try {
      const configs = await this.db.getAllRoleConfigs();
      this.roleActivityConfig = {};

      configs.forEach(config => {
        this.roleActivityConfig[config.roleName] = config.minHours;
      });

      console.log(`${configs.length}개의 역할 설정을 로드했습니다.`);
    } catch (error) {
      console.error('역할 설정 로드 오류:', error);
    }
  }

  /**
   * 세션 종료시 일일 활동 분을 즉시 DB에 업데이트
   */
  async saveSessionActivity(userId, sessionDurationMs, displayName, date = new Date()) {
    try {
      const minutes = Math.floor(sessionDurationMs / (1000 * 60));
      if (minutes > 0) {
        await this.db.updateDailyActivity(userId, displayName, config.GUILDID, date, minutes);
        console.log(`[ActivityTracker] ${displayName}님의 ${minutes}분 활동 기록 완료`);
      }
    } catch (error) {
      console.error('세션 활동 저장 오류:', error);
    }
  }

  /**
   * 특정 역할의 활동 데이터 초기화
   * @param {string} role - 초기화할 역할 이름
   */
  async clearAndReinitializeActivityData(role) {
    const now = Date.now();
    const guild = this.client.guilds.cache.get(config.GUILDID);

    try {
      // 역할 리셋 시간 업데이트
      await this.db.updateRoleResetTime(role, now, '관리자 명령으로 초기화');

      // 해당 역할을 가진 멤버들의 현재 세션 처리
      const members = await guild.members.fetch();

      for (const [userId, member] of members.entries()) {
        const hasRole = member.roles.cache.some(r => r.name === role);

        if (hasRole) {
          // 현재 활성 세션이 있다면 종료하고 새로 시작
          if (this.activeSessions.has(userId)) {
            const session = this.activeSessions.get(userId);
            const sessionDuration = now - session.startTime;
            
            // 현재 세션의 활동 분 저장
            await this.saveSessionActivity(userId, sessionDuration, member.displayName);
            
            // 현재 음성 채널에 있다면 새 세션 시작, 없다면 세션 제거
            if (member?.voice?.channelId && !config.EXCLUDED_CHANNELS.includes(member.voice.channelId)) {
              session.startTime = now;
              session.displayName = member.displayName;
            } else {
              this.activeSessions.delete(userId);
            }
          } else if (member?.voice?.channelId && !config.EXCLUDED_CHANNELS.includes(member.voice.channelId)) {
            // 세션이 없지만 음성 채널에 있다면 새 세션 시작
            this.activeSessions.set(userId, {
              startTime: now,
              displayName: member.displayName
            });
          }
        }
      }

      console.log(`역할 '${role}'의 활동 데이터가 초기화되었습니다.`);
    } catch (error) {
      console.error('활동 데이터 초기화 오류:', error);
    }
  }

  /**
   * 길드의 활동 데이터 초기화
   * @param {Guild} guild - 디스코드 길드 객체
   */
  async initializeActivityData(guild) {
    try {
      // 역할 활동 설정 불러오기
      await this.loadRoleActivityConfig();

      // 현재 활성 세션 로드 (서버 재시작시 음성 채널에 있는 사용자들)
      await this.loadActiveSessions();

      console.log("✔ 활동 정보가 초기화되었습니다.");
    } catch (error) {
      console.error("활동 데이터 초기화 오류:", error);
    }
  }

  /**
   * 음성 상태 업데이트 이벤트 핸들러
   * @param oldState - 이전 음성 상태
   * @param newState - 새 음성 상태
   */
  async handleVoiceStateUpdate(oldState, newState) {
    // 동일한 채널로의 이동 또는 자기 자신의 상태 변경(음소거 등)인 경우 처리하지 않음
    if (this.isSameChannelUpdate(oldState, newState)) {
      return;
    }

    const userId = newState.id;
    const member = newState.member;
    const now = Date.now();
    
    // 음성 상태 변경 로그 (주요 변경사항만)
    const actionType = this.isChannelJoin(oldState, newState) ? '입장' : 
                      this.isChannelLeave(oldState, newState) ? '퇴장' : '이동';
    console.log(`[ActivityTracker] 음성 채널 ${actionType}: ${member.displayName} (${userId})`);

    // 채널 입장 처리 (로그 기록용) - activity_logs 제거, Discord 로그만 유지
    if (this.isChannelJoin(oldState, newState)) {
      await this.handleChannelJoin(newState, member);
    }
    // 채널 퇴장 처리 (로그 기록용) - activity_logs 제거, Discord 로그만 유지
    else if (this.isChannelLeave(oldState, newState)) {
      await this.handleChannelLeave(oldState, member);
    }

    // 관전 또는 대기 상태인 멤버는 시간 추적에서 제외
    if (this.isObservationOrWaiting(member)) {
      return;
    }

    // 실시간 활동 시간 추적
    await this.trackActivityTimeRealtime(oldState, newState, userId, member, now);
  }

  // 같은 채널 내 상태 변경인지 확인
  isSameChannelUpdate(oldState, newState) {
    return oldState.channelId === newState.channelId && newState.channelId;
  }

  // 채널 입장인지 확인
  isChannelJoin(oldState, newState) {
    return newState.channelId && !config.EXCLUDED_CHANNELS_FOR_LOGS.includes(newState.channelId);
  }

  // 채널 퇴장인지 확인
  isChannelLeave(oldState, newState) {
    return oldState.channelId && !config.EXCLUDED_CHANNELS_FOR_LOGS.includes(oldState.channelId);
  }

  // 관전 또는 대기 상태인지 확인
  isObservationOrWaiting(member) {
    return member && (
      member.displayName.includes(FILTERS.OBSERVATION) ||
      member.displayName.includes(FILTERS.WAITING)
    );
  }

  // 채널 입장 처리 (Discord 로그만, activity_logs 제거)
  async handleChannelJoin(newState, member) {
    const membersInChannel = await this.logService.getVoiceChannelMembers(newState.channel);
    const channelName = newState.channel ? newState.channel.name : '알 수 없는 채널';

    // 로그 메시지 생성
    const logMessage = `${MESSAGE_TYPES.JOIN}: \` ${member.displayName} \`님이 \` ${channelName} \`에 입장했습니다.`;

    // 로그 서비스를 통한 Discord 채널 로깅만 수행
    this.logService.logActivity(logMessage, membersInChannel, 'JOIN');
  }

  // 채널 퇴장 처리 (Discord 로그만, activity_logs 제거)
  async handleChannelLeave(oldState, member) {
    const membersInChannel = await this.logService.getVoiceChannelMembers(oldState.channel);
    const channelName = oldState.channel ? oldState.channel.name : '알 수 없는 채널';

    // 로그 메시지 생성
    const logMessage = `${MESSAGE_TYPES.LEAVE}: \` ${member.displayName} \`님이 \` ${channelName} \`에서 퇴장했습니다.`;

    // 로그 서비스를 통한 Discord 채널 로깅만 수행
    this.logService.logActivity(logMessage, membersInChannel, 'LEAVE');
  }

  // 실시간 활동 시간 추적 (PostgreSQL 월별 테이블 직접 업데이트)
  async trackActivityTimeRealtime(oldState, newState, userId, member, now) {
    // 실제 채널 입장 (첫 입장만 감지)
    if (this.isRealChannelJoin(oldState, newState)) {
      this.activeSessions.set(userId, {
        startTime: now,
        displayName: member.displayName
      });
      console.log(`[ActivityTracker] ${member.displayName} 세션 시작`);
    }
    // 실제 채널 퇴장 (모든 채널에서 퇴장하는 경우만 감지)
    else if (this.isRealChannelLeave(oldState, newState)) {
      if (this.activeSessions.has(userId)) {
        const session = this.activeSessions.get(userId);
        const sessionDuration = now - session.startTime;
        
        // 즉시 PostgreSQL에 일일 활동 분 업데이트
        await this.saveSessionActivity(userId, sessionDuration, member.displayName);
        
        // 메모리에서 세션 제거
        this.activeSessions.delete(userId);
      }
    }
    // 채널 간 이동인 경우 - 세션 유지 (시간 계속 누적)
    else if (this.isChannelTransfer(oldState, newState)) {
      if (this.activeSessions.has(userId)) {
        // 표시 이름 업데이트만 수행, 세션 시간은 유지
        this.activeSessions.get(userId).displayName = member.displayName;
      }
    }
  }

  // 실제 채널 입장 (첫 입장만 감지)
  isRealChannelJoin(oldState, newState) {
    return !oldState.channelId &&
      newState.channelId &&
      !config.EXCLUDED_CHANNELS.includes(newState.channelId);
  }

  // 실제 채널 퇴장 (모든 채널에서 퇴장하는 경우만 감지)
  isRealChannelLeave(oldState, newState) {
    return oldState.channelId &&
      !config.EXCLUDED_CHANNELS.includes(oldState.channelId) &&
      !newState.channelId;
  }

  // 채널 간 이동 감지
  isChannelTransfer(oldState, newState) {
    return oldState.channelId && newState.channelId;
  }

  /**
   * 길드 멤버 업데이트 이벤트 핸들러
   * @param {GuildMember} oldMember - 이전 멤버 상태
   * @param {GuildMember} newMember - 새 멤버 상태
   */
  async handleGuildMemberUpdate(oldMember, newMember) {
    const {id: userId} = newMember;
    const now = Date.now();
    
    // 별명 변경이 있는 경우에만 로그 출력
    if (oldMember.displayName !== newMember.displayName) {
      console.log(`[ActivityTracker] 멤버 별명 변경: ${oldMember.displayName} → ${newMember.displayName} (${userId})`);
    }

    // 멤버가 [관전] 또는 [대기] 상태로 변경된 경우
    if (newMember.displayName.includes(FILTERS.OBSERVATION) ||
      newMember.displayName.includes(FILTERS.WAITING)) {
      // 활성 세션이 있다면 종료하고 저장
      if (this.activeSessions.has(userId)) {
        const session = this.activeSessions.get(userId);
        const sessionDuration = now - session.startTime;
        
        await this.saveSessionActivity(userId, sessionDuration, newMember.displayName);
        this.activeSessions.delete(userId);
        console.log(`[ActivityTracker] ${newMember.displayName} 관전/대기 상태로 세션 종료`);
      }
    } else {
      // 정상 상태로 변경된 경우 & 음성 채널에 있는 경우
      const voiceState = newMember.voice;
      if (voiceState?.channelId && !config.EXCLUDED_CHANNELS.includes(voiceState.channelId)) {
        // 활성 세션이 없다면 새로 시작
        if (!this.activeSessions.has(userId)) {
          this.activeSessions.set(userId, {
            startTime: now,
            displayName: newMember.displayName
          });
          console.log(`[ActivityTracker] ${newMember.displayName} 정상 상태로 세션 시작`);
        } else {
          // 기존 세션의 표시 이름만 업데이트
          this.activeSessions.get(userId).displayName = newMember.displayName;
        }
      }
    }
  }

  /**
   * 현재 활성 세션 정보 확인 (디버깅용)
   */
  getActiveSessionData(userId = null) {
    if (userId) {
      // 특정 사용자의 활성 세션 데이터 반환
      const session = this.activeSessions.get(userId);
      if (session) {
        const now = Date.now();
        const currentSessionTime = now - session.startTime;
        return {
          userId: userId,
          currentSessionTime: currentSessionTime,
          isCurrentlyActive: true,
          startTime: session.startTime,
          displayName: session.displayName
        };
      }
      return null;
    } else {
      // 모든 사용자의 활성 세션 데이터 반환
      const now = Date.now();
      const result = [];
      for (const [uid, session] of this.activeSessions.entries()) {
        const currentSessionTime = now - session.startTime;
        result.push({
          userId: uid,
          currentSessionTime: currentSessionTime,
          isCurrentlyActive: true,
          startTime: session.startTime,
          displayName: session.displayName
        });
      }
      return result;
    }
  }

  async classifyUsersByRole(roleName, roleMembers) {
    try {
      // 역할에 필요한 최소 활동 시간 조회
      const roleConfig = await this.db.getRoleConfig(roleName);
      const minActivityHours = roleConfig ? roleConfig.minHours : 0;
      const minActivityMinutes = minActivityHours * 60;

      // 리셋 시간 가져오기
      const resetTime = roleConfig ? roleConfig.resetTime : null;

      const activeUsers = [];
      const inactiveUsers = [];
      const afkUsers = []; // 잠수 멤버용 배열

      for (const [userId, member] of roleMembers.entries()) {
        // PostgreSQL에서 사용자 활동 분 조회 (현재 월 기준)
        const totalMinutes = await this.db.getUserTotalActivityMinutes(userId, config.GUILDID);
        
        // 현재 활성 세션이 있다면 추가
        let currentSessionMinutes = 0;
        if (this.activeSessions.has(userId)) {
          const session = this.activeSessions.get(userId);
          const sessionDuration = Date.now() - session.startTime;
          currentSessionMinutes = Math.floor(sessionDuration / (1000 * 60));
        }

        const totalWithCurrent = totalMinutes + currentSessionMinutes;

        const userData = {
          userId,
          nickname: member.displayName,
          totalTime: totalWithCurrent * 60 * 1000 // 호환성을 위해 밀리초로 변환
        };

        // 잠수 역할이 있는 경우 afkUsers에 추가
        if (member.roles.cache.some(r => r.name.includes('잠수'))) {
          afkUsers.push(userData);
        }
        // 그 외는 활동 시간 기준으로 분류
        else if (totalWithCurrent >= minActivityMinutes) {
          activeUsers.push(userData);
        } else {
          inactiveUsers.push(userData);
        }
      }

      // 활동 시간 기준으로 정렬
      activeUsers.sort((a, b) => b.totalTime - a.totalTime);
      inactiveUsers.sort((a, b) => b.totalTime - a.totalTime);
      afkUsers.sort((a, b) => b.totalTime - a.totalTime);

      return {
        activeUsers,
        inactiveUsers,
        afkUsers,
        resetTime,
        minHours: minActivityHours
      };
    } catch (error) {
      console.error('사용자 분류 오류:', error);
      return {activeUsers: [], inactiveUsers: [], afkUsers: [], resetTime: null, minHours: 0};
    }
  }

  async getActiveMembersData() {
    try {
      // PostgreSQL에서 모든 사용자의 활동 분 조회 (현재 월 기준)
      const activeMembers = await this.db.getAllActiveUsersThisMonth(config.GUILDID);

      const guild = this.client.guilds.cache.get(config.GUILDID);

      for (const member of activeMembers) {
        // 현재 활성 세션이 있다면 추가
        if (this.activeSessions.has(member.userId)) {
          const session = this.activeSessions.get(member.userId);
          const sessionDuration = Date.now() - session.startTime;
          const currentSessionMinutes = Math.floor(sessionDuration / (1000 * 60));
          member.totalMinutes += currentSessionMinutes;
        }

        // 호환성을 위해 밀리초로 변환
        member.totalTime = member.totalMinutes * 60 * 1000;

        // 디스코드에서 최신 표시 이름 가져오기 시도
        if (guild) {
          try {
            const discordMember = await guild.members.fetch(member.userId).catch(() => null);
            if (discordMember) {
              member.nickname = discordMember.displayName;
            }
          } catch (error) {
            console.error(`사용자 정보 조회 실패: ${member.userId}`, error);
          }
        }
      }

      // 활동 시간 기준으로 정렬
      activeMembers.sort((a, b) => b.totalTime - a.totalTime);

      return activeMembers;
    } catch (error) {
      console.error('활동 멤버 데이터 조회 오류:', error);
      return [];
    }
  }
}