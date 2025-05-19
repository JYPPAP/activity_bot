// src/services/activityTracker.js - 활동 추적 서비스 (SQLite 버전)
import {TIME, FILTERS, MESSAGE_TYPES} from '../config/constants.js';
import {config} from '../config/env.js';

export class ActivityTracker {
  constructor(client, dbManager, logService) {
    this.client = client;
    this.db = dbManager;
    this.logService = logService;
    this.channelActivityTime = new Map();
    this.saveActivityTimeout = null;
  }

  /**
   * 활동 데이터를 DB에서 로드
   */
  async loadActivityData() {
    try {
      const activities = await this.db.getAllUserActivity();

      // 로드된 데이터를 Map으로 변환하여 메모리에 저장
      this.channelActivityTime.clear();

      activities.forEach(activity => {
        this.channelActivityTime.set(activity.userId, {
          startTime: activity.startTime,
          totalTime: activity.totalTime
        });
      });

      console.log(`${activities.length}명의 사용자 활동 데이터를 로드했습니다.`);
    } catch (error) {
      console.error('활동 데이터 로드 오류:', error);
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
   * 활동 데이터를 DB에 저장
   */
  async saveActivityData() {
    const now = Date.now();

    try {
      // 트랜잭션 시작
      await this.db.beginTransaction();

      // 각 사용자의 활동 데이터 업데이트
      for (const [userId, userActivity] of this.channelActivityTime.entries()) {
        if (userActivity.startTime) {
          // 현재 DB에 저장된 데이터 확인
          const existingActivity = await this.db.getUserActivity(userId);
          const existingTotalTime = existingActivity ? existingActivity.totalTime : 0;

          // 새로운 totalTime 계산 (기존 + 새로 추가된 시간)
          const newTotalTime = existingTotalTime + (now - userActivity.startTime);

          // DB에 업데이트
          await this.db.updateUserActivity(
            userId,
            newTotalTime,
            now, // 현재 시간으로 startTime 업데이트
            userActivity.displayName || null
          );

          // 메모리 내 값도 업데이트
          userActivity.totalTime = newTotalTime;
          userActivity.startTime = now;
        } else if (userActivity.totalTime) {
          // 활동 중이 아닌 사용자의 기존 totalTime만 저장
          await this.db.updateUserActivity(
            userId,
            userActivity.totalTime,
            null,
            userActivity.displayName || null
          );
        }
      }

      // 트랜잭션 커밋
      await this.db.commitTransaction();
      console.log('활동 데이터가 성공적으로 저장되었습니다.');
    } catch (error) {
      // 오류 발생 시 롤백
      await this.db.rollbackTransaction();
      console.error('활동 데이터 저장 오류:', error);
    }
  }

  /**
   * 일정 시간 후 활동 데이터 저장 예약
   */
  debounceSaveActivityData() {
    // 기존 예약된 저장 작업 취소
    if (this.saveActivityTimeout) {
      clearTimeout(this.saveActivityTimeout);
    }

    // 10분 후 저장 작업 예약
    this.saveActivityTimeout = setTimeout(async () => {
      await this.saveActivityData();
    }, TIME.SAVE_ACTIVITY_DELAY);
  }

  /**
   * 특정 역할의 활동 데이터 초기화
   * @param {string} role - 초기화할 역할 이름
   */
  async clearAndReinitializeActivityData(role) {
    await this.saveActivityData(); // 초기화 전에 데이터 저장

    const now = Date.now();
    const guild = this.client.guilds.cache.get(config.GUILDID);

    try {
      // 역할 리셋 시간 업데이트
      await this.db.updateRoleResetTime(role, now, '관리자 명령으로 초기화');

      // 해당 역할을 가진 멤버들의 활동 시간 초기화
      const members = await guild.members.fetch();

      members.forEach(member => {
        const hasRole = member.roles.cache.some(r => r.name === role);

        if (hasRole) {
          const userId = member.id;
          if (this.channelActivityTime.has(userId)) {
            const userActivity = this.channelActivityTime.get(userId);

            // 현재 음성 채널에 있는 경우 startTime만 초기화
            if (member?.voice?.channelId && !config.EXCLUDED_CHANNELS.includes(member.voice.channelId)) {
              userActivity.startTime = now;
              userActivity.totalTime = 0;
            } else {
              // 음성 채널에 없는 경우 완전히 초기화
              userActivity.startTime = null;
              userActivity.totalTime = 0;
            }

            // DB에도 초기화된 데이터 저장
            this.db.updateUserActivity(userId, 0, userActivity.startTime, member.displayName);
          }
        }
      });

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

      // 메모리 데이터 로드
      await this.loadActivityData();

      // 길드의 모든 멤버 불러오기
      const members = await guild.members.fetch();

      // 역할 활동 설정 가져오기
      const roleConfigs = await this.db.getAllRoleConfigs();
      const trackedRoles = roleConfigs.map(config => config.roleName);

      // 멤버별 데이터 확인 및 초기화
      for (const [userId, member] of members.entries()) {
        const userRoles = member.roles.cache.map(role => role.name);

        // 사용자의 역할 중 추적 대상 역할이 있는지 확인
        const hasTrackedRole = userRoles.some(role => trackedRoles.includes(role));

        if (hasTrackedRole) {
          // 사용자가 메모리 캐시에 없으면 추가
          if (!this.channelActivityTime.has(userId)) {
            this.channelActivityTime.set(userId, {
              startTime: 0,
              totalTime: 0
            });

            // DB에도 초기 데이터 설정
            await this.db.updateUserActivity(userId, 0, null, member.displayName);
          }
        }
      }

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

    // 채널 입장 처리 (로그 기록용)
    if (this.isChannelJoin(oldState, newState)) {
      await this.handleChannelJoin(newState, member);
    }
    // 채널 퇴장 처리 (로그 기록용)
    else if (this.isChannelLeave(oldState, newState)) {
      await this.handleChannelLeave(oldState, member);
    }

    // 관전 또는 대기 상태인 멤버는 시간 추적에서 제외
    if (this.isObservationOrWaiting(member)) {
      return;
    }

    // // 활동 시간 추적
    // this.trackActivityTime(oldState, newState, userId, member, now);

    // 활동 시간 추적
    this.trackActivityTimeImproved(oldState, newState, userId, member, now);

    // 일정 시간 후 데이터 저장 예약
    this.debounceSaveActivityData();
  }

  // 같은 채널 내 상태 변경인지 확인
  isSameChannelUpdate(oldState, newState) {
    return oldState.channelId === newState.channelId && newState.channelId;
  }

  // 채널 입장인지 확인
  isChannelJoin(oldState, newState) {
    return newState.channelId && !config.EXCLUDED_CHANNELS.includes(newState.channelId);
  }

  // 채널 퇴장인지 확인
  isChannelLeave(oldState, newState) {
    return oldState.channelId && !config.EXCLUDED_CHANNELS.includes(oldState.channelId);
  }

  // 관전 또는 대기 상태인지 확인
  isObservationOrWaiting(member) {
    return member && (
      member.displayName.includes(FILTERS.OBSERVATION) ||
      member.displayName.includes(FILTERS.WAITING)
    );
  }

  // 채널 입장 처리
  async handleChannelJoin(newState, member) {
    const membersInChannel = await this.logService.getVoiceChannelMembers(newState.channel);
    const channelName = newState.channel ? newState.channel.name : '알 수 없는 채널';

    // 로그 메시지 생성
    const logMessage = `${MESSAGE_TYPES.JOIN}: \` ${member.displayName} \`님이 \` ${channelName} \`에 입장했습니다.`;

    // 로그 서비스를 통한 로깅
    this.logService.logActivity(logMessage, membersInChannel, 'JOIN');

    // 데이터베이스에도 로깅
    await this.db.logActivity(
      newState.id,
      'JOIN',
      newState.channelId,
      channelName,
      membersInChannel
    );
  }

  // 채널 퇴장 처리
  async handleChannelLeave(oldState, member) {
    const membersInChannel = await this.logService.getVoiceChannelMembers(oldState.channel);
    const channelName = oldState.channel ? oldState.channel.name : '알 수 없는 채널';

    // 로그 메시지 생성
    const logMessage = `${MESSAGE_TYPES.LEAVE}: \` ${member.displayName} \`님이 \` ${channelName} \`에서 퇴장했습니다.`;

    // 로그 서비스를 통한 로깅
    this.logService.logActivity(logMessage, membersInChannel, 'LEAVE');

    // 데이터베이스에도 로깅
    await this.db.logActivity(
      oldState.id,
      'LEAVE',
      oldState.channelId,
      channelName,
      membersInChannel
    );
  }

  // 활동 시간 추적
  trackActivityTime(oldState, newState, userId, member, now) {
    // 채널 입장 시 시간 기록 시작
    if (this.isChannelJoin(oldState, newState)) {
      this.startActivityTracking(userId, member, now);
    }
    // 채널 퇴장 시 시간 기록 종료
    else if (this.isChannelLeave(oldState, newState)) {
      this.endActivityTracking(userId, now);
    }
  }

  // 개선된 활동 시간 추적
  trackActivityTimeImproved(oldState, newState, userId, member, now) {
    // 사용자가 이전에 어떤 채널에도 없었고, 이제 채널에 입장한 경우만 시작 시간 설정
    if (this.isRealChannelJoin(oldState, newState)) {
      if (!this.channelActivityTime.has(userId)) {
        this.channelActivityTime.set(userId, {
          startTime: now,
          totalTime: 0,
          displayName: member.displayName
        });
      } else if (!this.channelActivityTime.get(userId).startTime) {
        const userActivity = this.channelActivityTime.get(userId);
        userActivity.startTime = now;
        userActivity.displayName = member.displayName;
      }
    }
    // 사용자가 모든 채널에서 완전히 퇴장한 경우만 종료 시간 설정
    else if (this.isRealChannelLeave(oldState, newState)) {
      if (this.channelActivityTime.has(userId) && this.channelActivityTime.get(userId).startTime) {
        const userActivity = this.channelActivityTime.get(userId);
        userActivity.totalTime += now - userActivity.startTime;
        userActivity.startTime = null;
      }
    }
    // 채널 간 이동인 경우 - 활동 시간 유지하며 필요시 복구
    else if (this.isChannelTransfer(oldState, newState)) {
      if (this.channelActivityTime.has(userId)) {
        const userActivity = this.channelActivityTime.get(userId);
        if (!userActivity.startTime) {
          // 예기치 않게 startTime이 없는 경우에 대한 복구 로직
          userActivity.startTime = now;
        }
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

  // 활동 추적 시작
  startActivityTracking(userId, member, now) {
    if (!this.channelActivityTime.has(userId)) {
      this.channelActivityTime.set(userId, {
        startTime: now,
        totalTime: 0,
        displayName: member.displayName
      });
    } else if (!this.channelActivityTime.get(userId).startTime) {
      const userActivity = this.channelActivityTime.get(userId);
      userActivity.startTime = now;
      userActivity.displayName = member.displayName;
    }
  }

  // 활동 추적 종료
  endActivityTracking(userId, now) {
    if (this.channelActivityTime.has(userId) && this.channelActivityTime.get(userId).startTime) {
      const userActivity = this.channelActivityTime.get(userId);
      userActivity.totalTime += now - userActivity.startTime;
      userActivity.startTime = null;
    }
  }

  /**
   * 길드 멤버 업데이트 이벤트 핸들러
   * @param {GuildMember} oldMember - 이전 멤버 상태
   * @param {GuildMember} newMember - 새 멤버 상태
   */
  async handleGuildMemberUpdate(oldMember, newMember) {
    const {id: userId} = newMember;
    const now = Date.now();

    // 멤버가 [관전] 또는 [대기] 상태로 변경된 경우
    if (newMember.displayName.includes(FILTERS.OBSERVATION) ||
      newMember.displayName.includes(FILTERS.WAITING)) {
      // 활동 시간 기록 중단
      if (this.channelActivityTime.has(userId) && this.channelActivityTime.get(userId).startTime) {
        const userActivity = this.channelActivityTime.get(userId);
        userActivity.totalTime += now - userActivity.startTime;
        userActivity.startTime = null;

        // DB에 업데이트
        await this.db.updateUserActivity(
          userId,
          userActivity.totalTime,
          null,
          newMember.displayName
        );
      }
    } else {
      // 정상 상태로 변경된 경우 & 음성 채널에 있는 경우
      const voiceState = newMember.voice;
      if (voiceState?.channelId && !config.EXCLUDED_CHANNELS.includes(voiceState.channelId)) {
        // 활동 시간 기록 시작/재개
        if (!this.channelActivityTime.has(userId)) {
          this.channelActivityTime.set(userId, {
            startTime: now,
            totalTime: 0,
            displayName: newMember.displayName
          });
        } else if (!this.channelActivityTime.get(userId).startTime) {
          this.channelActivityTime.get(userId).startTime = now;
          this.channelActivityTime.get(userId).displayName = newMember.displayName;
        }

        // DB에 업데이트
        await this.db.updateUserActivity(
          userId,
          this.channelActivityTime.get(userId).totalTime,
          now,
          newMember.displayName
        );

        this.debounceSaveActivityData();
      }
    }
  }

  async classifyUsersByRole(roleName, roleMembers) {
    try {
      // 역할에 필요한 최소 활동 시간 조회
      const roleConfig = await this.db.getRoleConfig(roleName);
      const minActivityHours = roleConfig ? roleConfig.minHours : 0;
      const minActivityTime = minActivityHours * 60 * 60 * 1000;

      // 리셋 시간 가져오기
      const resetTime = roleConfig ? roleConfig.resetTime : null;

      const activeUsers = [];
      const inactiveUsers = [];
      const afkUsers = []; // 잠수 멤버용 배열

      for (const [userId, member] of roleMembers.entries()) {
        // 사용자 활동 데이터 조회
        const userActivity = await this.db.getUserActivity(userId);
        const totalTime = userActivity ? userActivity.totalTime : 0;

        const userData = {
          userId,
          nickname: member.displayName,
          totalTime
        };

        // 잠수 역할이 있는 경우 afkUsers에 추가
        if (member.roles.cache.some(r => r.name.includes('잠수'))) {
          afkUsers.push(userData);
        }
        // 그 외는 활동 시간 기준으로 분류
        else if (totalTime >= minActivityTime) {
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
      // 모든 사용자 활동 정보 가져오기
      const activities = await this.db.getAllUserActivity();

      // 활성 멤버 정보 변환 (ID → 표시 이름)
      const activeMembers = [];

      for (const activity of activities) {
        // 총 활동 시간이 0보다 큰 사용자만 필터링
        if (activity.totalTime > 0) {
          // 멤버 표시 이름 가져오기 (없으면 ID 사용)
          let displayName = activity.displayName || activity.userId;

          // 디스코드에서 멤버 정보 가져오기 시도
          try {
            const guild = this.client.guilds.cache.get(config.GUILDID);
            if (guild) {
              const member = await guild.members.fetch(activity.userId).catch(() => null);
              if (member) {
                displayName = member.displayName;

                // DB에 표시 이름 업데이트
                await this.db.updateUserActivity(
                  activity.userId,
                  activity.totalTime,
                  activity.startTime,
                  displayName
                );
              }
            }
          } catch (error) {
            console.error(`사용자 정보 조회 실패: ${activity.userId}`, error);
          }

          activeMembers.push({
            userId: activity.userId,
            nickname: displayName,
            totalTime: activity.totalTime
          });
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