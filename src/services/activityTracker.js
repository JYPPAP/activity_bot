// src/services/activityTracker.js - 활동 추적 서비스
import { PATHS, TIME, FILTERS, MESSAGE_TYPES } from '../config/constants.js';
import { config } from '../config/env.js';

export class ActivityTracker {
  constructor(client, fileManager, logService) {
    this.client = client;
    this.fileManager = fileManager;
    this.logService = logService;
    this.channelActivityTime = new Map();
    this.saveActivityTimeout = null;
    
    // 초기 데이터 로드
    this.loadActivityData();
    this.loadRoleActivityConfig();
  }

  /**
   * 저장된 활동 데이터를 로드합니다.
   */
  loadActivityData() {
    this.channelActivityTime = this.fileManager.loadMapFromJSON(PATHS.ACTIVITY_INFO);
  }

  /**
   * 역할 활동 설정을 로드합니다.
   */
  loadRoleActivityConfig() {
    this.roleActivityConfig = this.fileManager.loadJSON(PATHS.ROLE_CONFIG);
  }

  /**
   * 활동 데이터를 저장합니다.
   */
  async saveActivityData() {
    const now = Date.now();

    // 기존 활동 데이터 로드
    const existingActivityData = this.fileManager.loadMapFromJSON(PATHS.ACTIVITY_INFO);

    // 각 사용자의 startTime 기준으로 totalTime 업데이트
    for (const [userId, userActivity] of this.channelActivityTime) {
      if (userActivity.startTime) {
        const existingTotalTime = existingActivityData.get(userId)?.totalTime ?? 0;
        userActivity.totalTime = existingTotalTime + (now - userActivity.startTime);
        userActivity.startTime = now; // startTime을 현재 시간으로 재설정
      }
    }

    // 업데이트된 활동 데이터 저장
    this.fileManager.saveMapToJSON(PATHS.ACTIVITY_INFO, this.channelActivityTime);
  }

  /**
   * 일정 시간 후 활동 데이터 저장을 예약합니다.
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
   * 특정 역할의 활동 데이터를 초기화합니다.
   * @param {string} role - 초기화할 역할 이름
   */
  async clearAndReinitializeActivityData(role) {
    await this.saveActivityData(); // 초기화 전에 데이터 저장

    const now = Date.now();
    const guild = this.client.guilds.cache.get(config.GUILDID);

    this.channelActivityTime = new Map();
    
    try {
      const members = await guild.members.fetch();
      members.forEach(member => {
        const voiceState = member.voice;
        if (voiceState?.channelId && !config.EXCLUDED_CHANNELS.includes(voiceState.channelId)) {
          this.channelActivityTime.set(member.id, { startTime: now, totalTime: 0 });
        }
      });
    } catch (error) {
      console.error("길드 멤버 가져오기 오류:", error);
    }

    // 역할별 초기화 시간 저장
    const activityData = this.fileManager.loadMapFromJSON(PATHS.ACTIVITY_INFO);
    if (!activityData.has('resetTimes')) {
      activityData.set('resetTimes', {});
    }
    activityData.get('resetTimes')[role] = now;
    this.fileManager.saveMapToJSON(PATHS.ACTIVITY_INFO, activityData);
  }

  /**
   * 길드의 활동 데이터를 초기화합니다.
   * @param {Guild} guild - 디스코드 길드 객체
   */
  async initializeActivityData(guild) {
    // 역할 활동 설정 불러오기
    if (!this.fileManager.fileExists(PATHS.ROLE_CONFIG)) {
      console.error("❌ role_activity_config.json 파일이 없습니다.");
      return;
    }
    const roleActivityConfig = this.fileManager.loadJSON(PATHS.ROLE_CONFIG);

    // 기존 저장된 사용자 데이터 불러오기
    let activityData = this.fileManager.loadMapFromJSON(PATHS.ACTIVITY_INFO);

    try {
      // 길드의 모든 멤버 불러오기
      const members = await guild.members.fetch();

      members.forEach(member => {
        const userId = member.user.id;
        const userRoles = member.roles.cache.map(role => role.name);

        // 사용자의 역할 중 추적 대상 역할이 있는지 확인
        const hasTrackedRole = userRoles.some(role => 
          Object.prototype.hasOwnProperty.call(roleActivityConfig, role)
        );

        if (hasTrackedRole) {
          if (!activityData.has(userId)) {
            // 사용자가 활동 정보에 없으면 추가
            activityData.set(userId, {
              startTime: 0,
              totalTime: 0
            });
          }
        }
      });

      // 변경된 데이터 저장
      this.fileManager.saveMapToJSON(PATHS.ACTIVITY_INFO, activityData);
      console.log("✔ 활동 정보가 초기화되었습니다.");
    } catch (error) {
      console.error("활동 데이터 초기화 오류:", error);
    }
  }

  /**
   * 음성 상태 업데이트 이벤트 핸들러
   * @param {VoiceState} oldState - 이전 음성 상태
   * @param {VoiceState} newState - 새 음성 상태
   */
  async handleVoiceStateUpdate(oldState, newState) {
    const { id: userId } = newState;
    const now = Date.now();
    const { member } = newState;

    // 음성 채널 입장 로깅
    if (newState.channelId && !config.EXCLUDED_CHANNELS.includes(newState.channelId)) {
      const membersInChannel = await this.logService.getVoiceChannelMembers(newState.channel);
      this.logService.logActivity(
        `${MESSAGE_TYPES.JOIN}: ${member.displayName}님이 ${newState.channel.name}에 입장했습니다.`,
        membersInChannel
      );
    } 
    // 음성 채널 퇴장 로깅
    else if (oldState.channelId && !config.EXCLUDED_CHANNELS.includes(oldState.channelId)) {
      const membersInChannel = await this.logService.getVoiceChannelMembers(oldState.channel);
      this.logService.logActivity(
        `${MESSAGE_TYPES.LEAVE}: ${member.displayName}님이 ${oldState.channel.name}에서 퇴장했습니다.`,
        membersInChannel
      );
    }

    // [관전] 또는 [대기] 상태인 멤버는 시간 추적에서 제외
    if (member && (member.displayName.includes(FILTERS.OBSERVATION) || 
                   member.displayName.includes(FILTERS.WAITING))) {
      return;
    }

    // 시간 추적 로직
    if (newState.channelId && !config.EXCLUDED_CHANNELS.includes(newState.channelId)) {
      // 채널 입장 시 시간 기록 시작
      if (!this.channelActivityTime.has(userId)) {
        this.channelActivityTime.set(userId, { startTime: now, totalTime: 0 });
      } else if (!this.channelActivityTime.get(userId).startTime) {
        this.channelActivityTime.get(userId).startTime = now;
      }
    } else if (oldState.channelId && !config.EXCLUDED_CHANNELS.includes(oldState.channelId)) {
      // 채널 퇴장 시 시간 기록 종료
      if (this.channelActivityTime.has(userId) && this.channelActivityTime.get(userId).startTime) {
        const userActivity = this.channelActivityTime.get(userId);
        userActivity.totalTime += now - userActivity.startTime;
        userActivity.startTime = null;
      }
    }

    this.debounceSaveActivityData();
  }

  /**
   * 길드 멤버 업데이트 이벤트 핸들러
   * @param {GuildMember} oldMember - 이전 멤버 상태
   * @param {GuildMember} newMember - 새 멤버 상태
   */
  handleGuildMemberUpdate(oldMember, newMember) {
    const { id: userId } = newMember;
    const now = Date.now();

    // 멤버가 [관전] 또는 [대기] 상태로 변경된 경우
    if (newMember.displayName.includes(FILTERS.OBSERVATION) || 
        newMember.displayName.includes(FILTERS.WAITING)) {
      // 활동 시간 기록 중단
      if (this.channelActivityTime.has(userId) && this.channelActivityTime.get(userId).startTime) {
        const userActivity = this.channelActivityTime.get(userId);
        userActivity.totalTime += now - userActivity.startTime;
        userActivity.startTime = null;
      }
    } else {
      // 정상 상태로 변경된 경우 & 음성 채널에 있는 경우
      const voiceState = newMember.voice;
      if (voiceState?.channelId && !config.EXCLUDED_CHANNELS.includes(voiceState.channelId)) {
        // 활동 시간 기록 시작/재개
        if (!this.channelActivityTime.has(userId)) {
          this.channelActivityTime.set(userId, { startTime: now, totalTime: 0 });
        } else if (!this.channelActivityTime.get(userId).startTime) {
          this.channelActivityTime.get(userId).startTime = now;
        }
        this.debounceSaveActivityData();
      }
    }
  }
}