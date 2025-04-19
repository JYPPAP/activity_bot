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
    const roleConfig = await this.db.getRoleConfig(role);

    // 역할에 필요한 최소 활동 시간(밀리초)
    const minActivityHours = roleConfig ? roleConfig.minHours : 0;
    const minActivityTime = minActivityHours * 60 * 60 * 1000;

    // 리셋 시간 가져오기
    const resetTime = roleConfig ? roleConfig.resetTime : null;

    const activeUsers = [];
    const inactiveUsers = [];
    const afkUsers = []; // 잠수 멤버용 배열

    // 각 멤버 분류
    for (const [userId, member] of roleMembers.entries()) {
      // 사용자 활동 데이터 조회
      const userActivity = await this.db.getUserActivity(userId);

      const userData = {
        userId,
        nickname: member.displayName,
        totalTime: userActivity ? userActivity.totalTime : 0
      };

      // 잠수 역할 확인
      const hasAfkRole = member.roles.cache.some(r => r.name === "잠수");

      if (hasAfkRole) {
        // 잠수 상태 정보 조회
        const afkStatus = await this.db.getUserAfkStatus(userId);

        if (afkStatus && afkStatus.afkUntil) {
          // DB에 저장된 잠수 해제 예정일 사용
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

        // 잠수 멤버 배열에 추가
        afkUsers.push(userData);
      } else {
        // 최소 활동 시간 기준으로 사용자 분류
        if (userData.totalTime >= minActivityTime) {
          activeUsers.push(userData);
        } else {
          inactiveUsers.push(userData);
        }
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
  }

  /**
   * 특정 기간 동안의 사용자 활동을 분류합니다.
   * @param {string} role - 역할 이름
   * @param {Collection<string, GuildMember>} roleMembers - 역할 멤버 컬렉션
   * @param {Date|number} startDate - 시작 날짜 또는 타임스탬프
   * @param {Date|number} endDate - 종료 날짜 또는 타임스탬프
   * @returns {Object} - 분류된 사용자 목록과 설정 정보
   */
  async classifyUsersByDateRange(role, roleMembers, startDate, endDate) {
    // 역할 설정 가져오기
    const roleConfig = await this.db.getRoleConfig(role);

    // 역할에 필요한 최소 활동 시간(밀리초)
    const minActivityHours = roleConfig ? roleConfig.minHours : 0;
    const minActivityTime = minActivityHours * 60 * 60 * 1000;

    // 보고서 출력 주기 가져오기
    const reportCycle = roleConfig ? roleConfig.reportCycle : null;

    // 시작 및 종료 날짜를 타임스탬프로 변환
    const startTimestamp = startDate instanceof Date ? startDate.getTime() : Number(startDate);
    const endTimestamp = endDate instanceof Date ? endDate.getTime() : Number(endDate);

    // 시작 날짜의 00:00:00으로 설정
    const startOfDay = new Date(startTimestamp);
    startOfDay.setHours(0, 0, 0, 0);

    // 종료 날짜의 23:59:59.999로 설정
    const endOfDay = new Date(endTimestamp);
    endOfDay.setHours(23, 59, 59, 999);

    const activeUsers = [];
    const inactiveUsers = [];
    const afkUsers = []; // 잠수 멤버용 배열

    // 각 멤버 분류
    for (const [userId, member] of roleMembers.entries()) {
      // 특정 기간의 활동 시간 조회
      const activityTime = await this.db.getUserActivityByDateRange(userId, startOfDay.getTime(), endOfDay.getTime());

      const userData = {
        userId,
        nickname: member.displayName,
        totalTime: activityTime || 0
      };

      // 잠수 역할 확인
      const hasAfkRole = member.roles.cache.some(r => r.name === "잠수");

      if (hasAfkRole) {
        // 잠수 상태 정보 조회
        const afkStatus = await this.db.getUserAfkStatus(userId);

        if (afkStatus && afkStatus.afkUntil) {
          // DB에 저장된 잠수 해제 예정일 사용
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

        // 잠수 멤버 배열에 추가
        afkUsers.push(userData);
      } else {
        // 최소 활동 시간 기준으로 사용자 분류
        if (userData.totalTime >= minActivityTime) {
          activeUsers.push(userData);
        } else {
          inactiveUsers.push(userData);
        }
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
      startDate: startOfDay.getTime(),
      endDate: endOfDay.getTime(),
      minHours: minActivityHours,
      reportCycle: reportCycle
    };
  }
}