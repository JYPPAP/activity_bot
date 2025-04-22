// src/services/UserClassificationService.js
import { calculateNextSunday } from '../utils/dateUtils.js';

export class UserClassificationService {
  constructor(dbManager, activityTracker) {
    this.db = dbManager;
    this.activityTracker = activityTracker;
  }

  /**
   * 사용자를 활성/비활성/잠수로 분류합니다.
   * @param {string} role - 역할 이름
   * @param {Collection<string, GuildMember>} roleMembers - 역할 멤버 컬렉션
   * @returns {Object} - 분류된 사용자 목록과 설정 정보
   */
  async classifyUsers(role, roleMembers) {
    // 역할 설정 가져오기
    const { minActivityTime, resetTime } = await this.getRoleSettings(role);

    const activeUsers = [];
    const inactiveUsers = [];
    const afkUsers = [];

    // 각 멤버 분류
    for (const [userId, member] of roleMembers.entries()) {
      const userData = await this.createBasicUserData(userId, member);

      // 잠수 역할 확인
      if (this.hasAfkRole(member)) {
        const userWithAfkStatus = await this.processAfkUser(userId, member, userData);
        afkUsers.push(userWithAfkStatus);
      } else {
        // 활성/비활성 분류
        this.classifyUserByActivityTime(userData, minActivityTime, activeUsers, inactiveUsers);
      }
    }

    // 활동 시간 기준으로 정렬
    this.sortUsersByActivityTime(activeUsers, inactiveUsers, afkUsers);

    return {
      activeUsers,
      inactiveUsers,
      afkUsers,
      resetTime,
      minHours: minActivityTime / (60 * 60 * 1000)
    };
  }

  /**
   * 특정 날짜 범위 내의 사용자를 활성/비활성/잠수로 분류합니다.
   * @param {string} role - 역할 이름
   * @param {Collection<string, GuildMember>} roleMembers - 역할 멤버 컬렉션
   * @param {Date|number} startDate - 시작 날짜
   * @param {Date|number} endDate - 종료 날짜
   * @returns {Object} - 분류된 사용자 목록과 설정 정보
   */
  async classifyUsersByDateRange(role, roleMembers, startDate, endDate) {
    // 역할 설정 가져오기
    const { minActivityTime, reportCycle } = await this.getRoleSettings(role);

    // 날짜 변환
    const { startOfDay, endOfDay } = this.convertDatesToTimeRange(startDate, endDate);

    const activeUsers = [];
    const inactiveUsers = [];
    const afkUsers = [];

    // 각 멤버 분류
    for (const [userId, member] of roleMembers.entries()) {
      const userData = await this.createUserDataByDateRange(userId, member, startOfDay, endOfDay);

      // 잠수 역할 확인
      if (this.hasAfkRole(member)) {
        const userWithAfkStatus = await this.processAfkUser(userId, member, userData);
        afkUsers.push(userWithAfkStatus);
      } else {
        // 활성/비활성 분류
        this.classifyUserByActivityTime(userData, minActivityTime, activeUsers, inactiveUsers);
      }
    }

    // 활동 시간 기준으로 정렬
    this.sortUsersByActivityTime(activeUsers, inactiveUsers, afkUsers);

    return {
      activeUsers,
      inactiveUsers,
      afkUsers,
      reportCycle,
      minHours: minActivityTime / (60 * 60 * 1000)
    };
  }

  /**
   * 역할 설정 가져오기
   * @param {string} role - 역할 이름
   * @returns {Object} - 역할 설정 객체
   */
  async getRoleSettings(role) {
    const roleConfig = await this.db.getRoleConfig(role);
    const minActivityHours = roleConfig?.minHours || 0;
    const minActivityTime = minActivityHours * 60 * 60 * 1000;
    const resetTime = roleConfig?.resetTime || null;
    const reportCycle = roleConfig?.reportCycle || null;

    return { minActivityTime, resetTime, reportCycle };
  }

  /**
   * 날짜를 시간 범위로 변환
   * @param {Date|number} startDate - 시작 날짜
   * @param {Date|number} endDate - 종료 날짜
   * @returns {Object} - 시작일과 종료일 객체
   */
  convertDatesToTimeRange(startDate, endDate) {
    const startTimestamp = startDate instanceof Date ? startDate.getTime() : Number(startDate);
    const endTimestamp = endDate instanceof Date ? endDate.getTime() : Number(endDate);

    const startOfDay = new Date(startTimestamp);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(endTimestamp);
    endOfDay.setHours(23, 59, 59, 999);

    return { startOfDay, endOfDay };
  }

  /**
   * 기본 사용자 데이터 생성
   * @param {string} userId - 사용자 ID
   * @param {GuildMember} member - 멤버 객체
   * @returns {Object} - 사용자 데이터 객체
   */
  async createBasicUserData(userId, member) {
    const userActivity = await this.db.getUserActivity(userId);

    return {
      userId,
      nickname: member.displayName,
      totalTime: userActivity?.totalTime || 0
    };
  }

  /**
   * 특정 날짜 범위의 사용자 데이터 생성
   * @param {string} userId - 사용자 ID
   * @param {GuildMember} member - 멤버 객체
   * @param {Date} startOfDay - 시작일
   * @param {Date} endOfDay - 종료일
   * @returns {Object} - 사용자 데이터 객체
   */
  async createUserDataByDateRange(userId, member, startOfDay, endOfDay) {
    const activityTime = await this.db.getUserActivityByDateRange(
        userId,
        startOfDay.getTime(),
        endOfDay.getTime()
    );

    return {
      userId,
      nickname: member.displayName,
      totalTime: activityTime || 0
    };
  }

  /**
   * 멤버가 잠수 역할을 가지고 있는지 확인
   * @param {GuildMember} member - 멤버 객체
   * @returns {boolean} - 잠수 역할 여부
   */
  hasAfkRole(member) {
    return member.roles.cache.some(r => r.name === "잠수");
  }

  /**
   * 잠수 사용자 처리
   * @param {string} userId - 사용자 ID
   * @param {GuildMember} member - 멤버 객체
   * @param {Object} userData - 사용자 데이터 객체
   * @returns {Object} - 업데이트된 사용자 데이터
   */
  async processAfkUser(userId, member, userData) {
    // DB 데이터 새로고침
    if (this?.db?.reloadData) {
      this.db.reloadData();
    }

    const afkStatus = await this.db.getUserAfkStatus(userId);

    if (afkStatus?.afkUntil) {
      userData.afkUntil = afkStatus.afkUntil;
    } else {
      // 해제 일정이 없으면 현재 날짜의 다음 일요일로 계산
      const nextSunday = calculateNextSunday(new Date());
      userData.afkUntil = nextSunday.getTime();

      // DB에 저장
      if (this.db.setUserAfkStatus) {
        await this.db.setUserAfkStatus(userId, member.displayName, userData.afkUntil);
      }
    }

    return userData;
  }

  /**
   * 활동 시간 기준으로 사용자 분류
   * @param {Object} userData - 사용자 데이터 객체
   * @param {number} minActivityTime - 최소 활동 시간(밀리초)
   * @param {Array} activeUsers - 활성 사용자 배열
   * @param {Array} inactiveUsers - 비활성 사용자 배열
   */
  classifyUserByActivityTime(userData, minActivityTime, activeUsers, inactiveUsers) {
    if (userData.totalTime >= minActivityTime) {
      activeUsers.push(userData);
    } else {
      inactiveUsers.push(userData);
    }
  }

  /**
   * 사용자 목록 정렬
   * @param {Array} activeUsers - 활성 사용자 배열
   * @param {Array} inactiveUsers - 비활성 사용자 배열
   * @param {Array} afkUsers - 잠수 사용자 배열
   */
  sortUsersByActivityTime(activeUsers, inactiveUsers, afkUsers) {
    activeUsers.sort((a, b) => b.totalTime - a.totalTime);
    inactiveUsers.sort((a, b) => b.totalTime - a.totalTime);
    afkUsers.sort((a, b) => b.totalTime - a.totalTime);
  }
}