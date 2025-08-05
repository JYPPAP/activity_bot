// src/services/DatabaseManager.js - LowDB 버전 (잠수 상태 관리 개선)
import low from 'lowdb';
import FileSync from 'lowdb/adapters/FileSync.js';
import path from 'path';

export class DatabaseManager {
  constructor() {
    this.dbPath = path.join(process.cwd(), 'activity_bot.json');
    this.adapter = new FileSync(this.dbPath);
    this.db = low(this.adapter);

    // 캐싱 시스템
    this.cache = new Map();
    this.cacheTimeout = 30000; // 30초 캐시 유지
    this.lastCacheTime = 0;
    
    // 사용자별 활동 시간 캐시 (30분 디바운싱)
    this.userActivityCache = new Map(); // { cacheKey: { totalTime, lastFetch } }
    this.USER_CACHE_DURATION = 30 * 60 * 1000; // 30분

    // 기본 데이터베이스 구조 설정
    this.db.defaults({
      user_activity: {},
      role_config: {},
      activity_logs: [],
      reset_history: [],
      log_members: {},
      afk_status: {}, // 잠수 상태를 별도 테이블로 분리
      forum_messages: {}, // 포럼 메시지 추적 테이블
      voice_channel_mappings: {} // 음성 채널 - 포럼 포스트 매핑 테이블
    }).write();
  }

  /**
   * 데이터베이스 연결 및 초기화
   */
  async initialize() {
    try {
      console.log(`LowDB 데이터베이스가 ${this.dbPath}에 연결되었습니다.`);
      return true;
    } catch (error) {
      console.error('데이터베이스 초기화 오류:', error);
      return false;
    }
  }

  /**
   * 스마트 캐싱 시스템
   */
  smartReload(forceReload = false) {
    const now = Date.now();
    
    // 강제 새로고침이거나 캐시가 만료된 경우
    if (forceReload || (now - this.lastCacheTime) > this.cacheTimeout) {
      try {
        this.db.read();
        this.lastCacheTime = now;
        this.cache.clear(); // 캐시 초기화
      } catch (error) {
        console.error('[DB] 데이터 새로고침 실패:', error);
      }
    }
  }

  /**
   * 캐시된 데이터 가져오기
   */
  getCached(key, getter) {
    // 스마트 새로고침 (캐시 만료 확인)
    this.smartReload();
    
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    
    const data = getter();
    this.cache.set(key, data);
    return data;
  }

  /**
   * 쓰기 작업 시 캐시 무효화
   */
  invalidateCache() {
    this.cache.clear();
    this.smartReload(true); // 강제 새로고침
  }

  /**
   * 강제 데이터 새로고침 (기존 호환성)
   */
  forceReload() {
    this.smartReload(true);
  }

  /**
   * 데이터베이스 내 데이터 존재 확인
   */
  async hasAnyData() {
    return Object.keys(this.db.get('user_activity').value()).length > 0;
  }

  /**
   * 데이터베이스 연결 종료 (LowDB에서는 필요 없지만 호환성을 위해 유지)
   */
  async close() {
    console.log('데이터베이스 연결이 종료되었습니다.');
    return true;
  }

  /**
   * 트랜잭션 시작 (LowDB에서는 필요 없지만 호환성을 위해 유지)
   */
  async beginTransaction() {
    return true;
  }

  /**
   * 트랜잭션 커밋 (LowDB에서는 필요 없지만 호환성을 위해 유지)
   */
  async commitTransaction() {
    return true;
  }

  /**
   * 트랜잭션 롤백 (LowDB에서는 필요 없지만 호환성을 위해 유지)
   */
  async rollbackTransaction() {
    return true;
  }

  // ======== 사용자 활동 관련 메서드 ========

  /**
   * 사용자 활동 데이터 가져오기
   */
  async getUserActivity(userId) {
    return this.getCached(`user_activity_${userId}`, () => {
      return this.db.get('user_activity').get(userId).value();
    });
  }

  /**
   * 사용자 활동 데이터 업데이트/삽입
   */
  async updateUserActivity(userId, totalTime, startTime, displayName) {
    this.invalidateCache(); // 쓰기 작업 시 캐시 무효화
    this.db.get('user_activity')
        .set(userId, {
          userId,
          totalTime,
          startTime,
          displayName
        })
        .write();
    return true;
  }

  /**
   * 모든 사용자 활동 데이터 가져오기
   */
  async getAllUserActivity() {
    return this.getCached('all_user_activity', () => {
      const activities = this.db.get('user_activity').value();
      return Object.values(activities);
    });
  }

  /**
   * 특정 역할을 가진 사용자들의 활동 데이터 가져오기
   */
  async getUserActivityByRole(roleId, startTime, endTime) {
    return await this.getAllUserActivity();
  }

  /**
   * 사용자 활동 데이터 삭제
   */
  async deleteUserActivity(userId) {
    this.forceReload();
    this.db.get('user_activity').unset(userId).write();
    return true;
  }

  // ======== 역할 설정 관련 메서드 ========

  /**
   * 역할 설정 가져오기
   */
  async getRoleConfig(roleName) {
    return this.getCached(`role_config_${roleName}`, () => {
      return this.db.get('role_config').get(roleName).value();
    });
  }

  /**
   * 역할 설정 업데이트/삽입 (주기 필드 추가)
   */
  async updateRoleConfig(roleName, minHours, resetTime = null, reportCycle = 1) {
    this.invalidateCache(); // 쓰기 작업 시 캐시 무효화
    this.db.get('role_config')
        .set(roleName, {
          roleName,
          minHours,
          resetTime,
          reportCycle
        })
        .write();
    return true;
  }

  /**
   * 모든 역할 설정 가져오기
   */
  async getAllRoleConfigs() {
    const configs = this.db.get('role_config').value();
    return Object.values(configs);
  }

  /**
   * 역할 리셋 시간 업데이트
   */
  async updateRoleResetTime(roleName, resetTime, reason = '관리자에 의한 리셋') {
    this.forceReload();
    const roleConfig = await this.getRoleConfig(roleName);
    if (roleConfig) {
      await this.updateRoleConfig(roleName, roleConfig.minHours, resetTime);
    } else {
      await this.updateRoleConfig(roleName, 0, resetTime);
    }

    this.db.get('reset_history')
        .push({
          id: Date.now(),
          roleName,
          resetTime,
          reason
        })
        .write();

    return true;
  }

  /**
   * 역할 리셋 이력 가져오기
   */
  async getRoleResetHistory(roleName, limit = 5) {
    return this.db.get('reset_history')
               .filter({roleName})
               .sortBy('resetTime')
               .reverse()
               .take(limit)
               .value();
  }

  // ======== 활동 로그 관련 메서드 ========

  /**
   * 활동 로그 기록하기
   */
  async logActivity(userId, eventType, channelId, channelName, members = []) {
    this.forceReload();
    const timestamp = Date.now();

    const logEntry = {
      id: timestamp + '-' + userId.slice(0, 6),
      userId,
      eventType,
      channelId,
      channelName,
      timestamp,
      membersCount: members.length
    };

    this.db.get('activity_logs')
        .push(logEntry)
        .write();

    if (members.length > 0) {
      this.db.set(`log_members.${logEntry.id}`, members).write();
    }

    return logEntry.id;
  }

  /**
   * 특정 기간의 활동 로그 가져오기
   */
  async getActivityLogs(startTime, endTime, eventType = null) {
    this.forceReload(); // 보고서 생성 시 정확한 데이터 필요
    let query = this.db.get('activity_logs')
                    .filter(log => log.timestamp >= startTime && log.timestamp <= endTime);

    if (eventType) {
      query = query.filter({eventType});
    }

    const logs = query.sortBy('timestamp').reverse().value();

    return logs.map(log => {
      const members = this.db.get(`log_members.${log.id}`).value() || [];
      return {...log, members};
    });
  }

  /**
   * 특정 사용자의 활동 로그 가져오기
   */
  async getUserActivityLogs(userId, limit = 100) {
    this.forceReload(); // 사용자별 상세 조회 시 정확한 데이터 필요
    const logs = this.db.get('activity_logs')
                     .filter({userId})
                     .sortBy('timestamp')
                     .reverse()
                     .take(limit)
                     .value();

    return logs.map(log => {
      const members = this.db.get(`log_members.${log.id}`).value() || [];
      return {...log, members};
    });
  }

  /**
   * 날짜별 활동 통계 가져오기
   */
  async getDailyActivityStats(startTime, endTime) {
    this.forceReload(); // 통계 생성 시 정확한 데이터 필요
    const logs = this.db.get('activity_logs')
                     .filter(log => log.timestamp >= startTime && log.timestamp <= endTime)
                     .value();

    const dailyStats = {};
    logs.forEach(log => {
      const date = new Date(log.timestamp);
      const dateStr = date.toISOString().split('T')[0];

      if (!dailyStats[dateStr]) {
        dailyStats[dateStr] = {
          date: dateStr,
          totalEvents: 0,
          joins: 0,
          leaves: 0,
          uniqueUsers: new Set()
        };
      }

      dailyStats[dateStr].totalEvents++;

      if (log.eventType === 'JOIN') {
        dailyStats[dateStr].joins++;
      } else if (log.eventType === 'LEAVE') {
        dailyStats[dateStr].leaves++;
      }

      dailyStats[dateStr].uniqueUsers.add(log.userId);
    });

    return Object.values(dailyStats).map(stat => ({
      ...stat,
      uniqueUsers: stat.uniqueUsers.size
    }));
  }

  /**
   * 특정 기간 동안의 사용자 활동 시간 조회
   */
  async getUserActivityByDateRange(userId, startTime, endTime) {
    try {
      const now = Date.now();
      const cacheKey = `${userId}_${startTime}_${endTime}`;
      const cached = this.userActivityCache.get(cacheKey);
      
      // 캐시가 있고 30분이 안 지났으면 캐시된 값 반환
      if (cached && (now - cached.lastFetch) < this.USER_CACHE_DURATION) {
        const remainingTime = Math.round((this.USER_CACHE_DURATION - (now - cached.lastFetch)) / 1000);
        console.log(`[캐시 사용] 사용자 ${userId} - 캐시 만료까지 ${remainingTime}초 남음`);
        return cached.totalTime;
      }
      
      // 30분이 지났거나 캐시가 없으면 DB에서 읽기
      console.log(`[DB 조회] 사용자 ${userId} - 캐시 갱신 중...`);
      this.db.read(); // 파일에서 직접 읽기
      
      const logs = this.db.get('activity_logs')
                       .filter(log => log.userId === userId && log.timestamp >= startTime && log.timestamp <= endTime)
                       .value();

      let totalTime = 0;
      let joinTime = null;

      for (const log of logs) {
        if (log.eventType === 'JOIN') {
          joinTime = log.timestamp;
        } else if (log.eventType === 'LEAVE' && joinTime) {
          totalTime += log.timestamp - joinTime;
          joinTime = null;
        }
      }

      if (joinTime) {
        totalTime += Math.min(endTime, Date.now()) - joinTime;
      }
      
      // 캐시 업데이트
      this.userActivityCache.set(cacheKey, {
        totalTime: totalTime,
        lastFetch: now
      });
      
      console.log(`[DB 조회 완료] 사용자 ${userId} - 총 활동 시간: ${totalTime}ms`);

      return totalTime;
    } catch (error) {
      console.error('특정 기간 활동 시간 조회 오류:', error);
      return 0;
    }
  }

  /**
   * 특정 기간의 활동 멤버 목록 가져오기
   */
  async getActiveMembersForTimeRange(startTime, endTime) {
    try {
      this.forceReload(); // 활성 멤버 통계 시 정확한 데이터 필요
      const logs = this.db.get('activity_logs')
                       .filter(log => log.timestamp >= startTime && log.timestamp <= endTime)
                       .value();

      const userIds = [...new Set(logs.map(log => log.userId))];

      const activeMembers = [];
      for (const userId of userIds) {
        const userActivity = this.db.get('user_activity').get(userId).value();
        if (userActivity) {
          activeMembers.push({
            userId,
            displayName: userActivity.displayName || userId,
            totalTime: userActivity.totalTime || 0
          });
        }
      }

      return activeMembers;
    } catch (error) {
      console.error('활동 멤버 조회 오류:', error);
      return [];
    }
  }

  /**
   * 가장 활동적인 채널 조회
   */
  async getMostActiveChannels(startTime, endTime, limit = 5) {
    try {
      this.forceReload();
      const logs = this.db.get('activity_logs')
                       .filter(log => log.timestamp >= startTime && log.timestamp <= endTime)
                       .value();

      const channelCounts = {};
      logs.forEach(log => {
        if (!channelCounts[log.channelName]) {
          channelCounts[log.channelName] = 0;
        }
        channelCounts[log.channelName]++;
      });

      const sortedChannels = Object.entries(channelCounts)
                                   .map(([name, count]) => ({name, count}))
                                   .sort((a, b) => b.count - a.count)
                                   .slice(0, limit);

      return sortedChannels;
    } catch (error) {
      console.error('활동적인 채널 조회 오류:', error);
      return [];
    }
  }

  /**
   * 역할 보고서 주기 업데이트
   */
  async updateRoleReportCycle(roleName, reportCycle) {
    const roleConfig = await this.getRoleConfig(roleName);
    if (roleConfig) {
      await this.updateRoleConfig(
        roleName,
        roleConfig.minHours,
        roleConfig.resetTime,
        reportCycle
      );
      return true;
    }
    return false;
  }

  /**
   * 역할별 다음 보고서 예정 시간 확인
   */
  async getNextReportTime(roleName) {
    const roleConfig = await this.getRoleConfig(roleName);
    if (!roleConfig) return null;

    const reportCycle = roleConfig.reportCycle || 1;
    const lastResetTime = roleConfig.resetTime || Date.now();

    return lastResetTime + (reportCycle * 7 * 24 * 60 * 60 * 1000);
  }

  /**
   * JSON 데이터에서 마이그레이션
   */
  async migrateFromJSON(activityData, roleConfigData) {
    try {
      this.forceReload();

      // 사용자 활동 데이터 마이그레이션
      for (const [userId, data] of Object.entries(activityData)) {
        if (userId !== 'resetTimes') {
          this.db.get('user_activity')
              .set(userId, {
                userId,
                totalTime: data.totalTime || 0,
                startTime: data.startTime || null,
                displayName: null
              })
              .write();
        }
      }

      // 역할 구성 마이그레이션
      for (const [roleName, minHours] of Object.entries(roleConfigData)) {
        const resetTime = activityData?.resetTimes?.[roleName] || null;

        this.db.get('role_config')
            .set(roleName, {
              roleName,
              minHours,
              resetTime
            })
            .write();

        if (resetTime) {
          this.db.get('reset_history')
              .push({
                id: Date.now() + '-' + roleName,
                roleName,
                resetTime,
                reason: 'JSON 데이터 마이그레이션'
              })
              .write();
        }
      }

      console.log('JSON 데이터가 성공적으로 마이그레이션되었습니다.');
      return true;
    } catch (error) {
      console.error('JSON 데이터 마이그레이션 오류:', error);
      throw error;
    }
  }

  // ======== 잠수 상태 관리 메서드 (개선) ========

  /**
   * 사용자의 잠수 상태 설정 (별도 테이블 사용)
   */
  async setUserAfkStatus(userId, displayName, untilTimestamp) {
    try {
      this.forceReload();

      // afk_status 테이블에 별도 저장
      this.db.get('afk_status')
          .set(userId, {
            userId,
            displayName,
            afkUntil: untilTimestamp,
            createdAt: Date.now()
          })
          .write();

      console.log(`[DB] 잠수 상태 설정: ${userId}, until: ${new Date(untilTimestamp).toISOString()}`);
      return true;
    } catch (error) {
      console.error('[DB] 잠수 상태 설정 오류:', error);
      return false;
    }
  }

  /**
   * 사용자의 잠수 상태 확인 (별도 테이블에서 조회)
   */
  async getUserAfkStatus(userId) {
    try {
      this.forceReload();

      const afkData = this.db.get('afk_status').get(userId).value();

      console.log(`[DB] 잠수 상태 조회: ${userId}, 결과:`, afkData);

      if (!afkData || !afkData.afkUntil) {
        return null;
      }

      return {
        userId,
        displayName: afkData.displayName,
        afkUntil: afkData.afkUntil,
        totalTime: 0 // 필요한 경우 user_activity에서 조회
      };
    } catch (error) {
      console.error('[DB] 잠수 상태 조회 오류:', error);
      return null;
    }
  }

  /**
   * 사용자의 잠수 상태 해제 (별도 테이블에서 삭제)
   */
  async clearUserAfkStatus(userId) {
    try {
      this.forceReload();

      this.db.get('afk_status').unset(userId).write();

      console.log(`[DB] 잠수 상태 해제: ${userId}`);
      return true;
    } catch (error) {
      console.error('[DB] 잠수 상태 해제 오류:', error);
      return false;
    }
  }

  /**
   * 모든 잠수 사용자 조회 (별도 테이블에서 조회)
   */
  async getAllAfkUsers() {
    try {
      this.forceReload();

      const afkData = this.db.get('afk_status').value();
      const afkUsers = [];

      for (const [userId, data] of Object.entries(afkData)) {
        if (data.afkUntil) {
          // user_activity에서 totalTime 조회
          const userActivity = this.db.get('user_activity').get(userId).value();

          afkUsers.push({
            userId,
            displayName: data.displayName || userId,
            afkUntil: data.afkUntil,
            totalTime: userActivity?.totalTime || 0
          });
        }
      }

      return afkUsers;
    } catch (error) {
      console.error('[DB] 잠수 사용자 조회 오류:', error);
      return [];
    }
  }

  /**
   * 만료된 잠수 상태 확인 및 해제
   */
  async clearExpiredAfkStatus() {
    try {
      this.forceReload();

      const now = Date.now();
      const afkData = this.db.get('afk_status').value();
      const clearedUsers = [];

      for (const [userId, data] of Object.entries(afkData)) {
        if (data.afkUntil && data.afkUntil < now) {
          this.db.get('afk_status').unset(userId).write();
          clearedUsers.push(userId);
          console.log(`[DB] 잠수 상태 만료 해제: ${userId}`);
        }
      }

      return clearedUsers;
    } catch (error) {
      console.error('[DB] 잠수 상태 만료 처리 오류:', error);
      return [];
    }
  }

  /**
   * 데이터 새로고침 (호환성)
   */
  reloadData() {
    this.forceReload();
  }

  // ======== 포럼 메시지 추적 관련 메서드 ========

  /**
   * 포럼 메시지 ID 추적 저장
   * @param {string} threadId - 스레드 ID
   * @param {string} messageType - 메시지 타입 ('participant_count', 'emoji_reaction')
   * @param {string} messageId - 메시지 ID
   */
  async trackForumMessage(threadId, messageType, messageId) {
    try {
      this.invalidateCache();
      
      // threadId를 키로 하는 객체 구조: { threadId: { participant_count: [messageIds], emoji_reaction: [messageIds] } }
      const threadData = this.db.get('forum_messages').get(threadId).value() || {};
      
      if (!threadData[messageType]) {
        threadData[messageType] = [];
      }
      
      // 중복 메시지 ID 방지
      if (!threadData[messageType].includes(messageId)) {
        threadData[messageType].push(messageId);
      }
      
      this.db.get('forum_messages').set(threadId, threadData).write();
      
      console.log(`[DB] 포럼 메시지 추적 저장: ${threadId}, ${messageType}, ${messageId}`);
      return true;
    } catch (error) {
      console.error('[DB] 포럼 메시지 추적 저장 오류:', error);
      return false;
    }
  }

  /**
   * 특정 스레드의 추적된 메시지 ID들 가져오기
   * @param {string} threadId - 스레드 ID
   * @param {string} messageType - 메시지 타입
   * @returns {Array<string>} - 메시지 ID 배열
   */
  async getTrackedMessages(threadId, messageType) {
    try {
      this.smartReload();
      
      const threadData = this.db.get('forum_messages').get(threadId).value();
      if (!threadData || !threadData[messageType]) {
        return [];
      }
      
      return threadData[messageType] || [];
    } catch (error) {
      console.error('[DB] 추적된 메시지 조회 오류:', error);
      return [];
    }
  }

  /**
   * 특정 스레드의 특정 타입 메시지 추적 정보 삭제
   * @param {string} threadId - 스레드 ID
   * @param {string} messageType - 메시지 타입
   * @returns {Array<string>} - 삭제된 메시지 ID 배열
   */
  async clearTrackedMessages(threadId, messageType) {
    try {
      this.invalidateCache();
      
      const threadData = this.db.get('forum_messages').get(threadId).value();
      if (!threadData || !threadData[messageType]) {
        return [];
      }
      
      const messageIds = threadData[messageType] || [];
      
      // 해당 타입의 메시지 추적 정보 삭제
      delete threadData[messageType];
      
      // 스레드 데이터가 비어있으면 전체 삭제, 아니면 업데이트
      if (Object.keys(threadData).length === 0) {
        this.db.get('forum_messages').unset(threadId).write();
      } else {
        this.db.get('forum_messages').set(threadId, threadData).write();
      }
      
      console.log(`[DB] 추적된 메시지 삭제: ${threadId}, ${messageType}, ${messageIds.length}개`);
      return messageIds;
    } catch (error) {
      console.error('[DB] 추적된 메시지 삭제 오류:', error);
      return [];
    }
  }

  /**
   * 모든 포럼 메시지 추적 정보 삭제 (스레드 단위)
   * @param {string} threadId - 스레드 ID
   */
  async clearAllTrackedMessagesForThread(threadId) {
    try {
      this.invalidateCache();
      
      const threadData = this.db.get('forum_messages').get(threadId).value();
      if (!threadData) {
        return {};
      }
      
      this.db.get('forum_messages').unset(threadId).write();
      
      console.log(`[DB] 스레드의 모든 추적 메시지 삭제: ${threadId}`);
      return threadData;
    } catch (error) {
      console.error('[DB] 스레드 메시지 추적 정보 삭제 오류:', error);
      return {};
    }
  }

  // ======== 음성 채널 매핑 관련 메서드 ========

  /**
   * 음성 채널-포럼 포스트 매핑 저장
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {string} forumPostId - 포럼 포스트 ID
   * @param {number} lastParticipantCount - 마지막 참여자 수 (선택적)
   * @returns {Promise<boolean>} - 저장 성공 여부
   */
  async saveChannelMapping(voiceChannelId, forumPostId, lastParticipantCount = 0) {
    try {
      this.invalidateCache();
      
      const now = Date.now();
      const mappingData = {
        voice_channel_id: voiceChannelId,
        forum_post_id: forumPostId,
        created_at: now,
        last_updated: now,
        last_participant_count: lastParticipantCount
      };
      
      this.db.get('voice_channel_mappings')
          .set(voiceChannelId, mappingData)
          .write();
      
      console.log(`[DB] 채널 매핑 저장: ${voiceChannelId} -> ${forumPostId}`);
      return true;
    } catch (error) {
      console.error('[DB] 채널 매핑 저장 오류:', error);
      return false;
    }
  }

  /**
   * 음성 채널 매핑 정보 가져오기
   * @param {string} voiceChannelId - 음성 채널 ID
   * @returns {Promise<Object|null>} - 매핑 정보 또는 null
   */
  async getChannelMapping(voiceChannelId) {
    try {
      this.smartReload();
      
      const mappingData = this.db.get('voice_channel_mappings').get(voiceChannelId).value();
      return mappingData || null;
    } catch (error) {
      console.error('[DB] 채널 매핑 조회 오류:', error);
      return null;
    }
  }

  /**
   * 모든 음성 채널 매핑 가져오기
   * @returns {Promise<Array>} - 모든 매핑 배열
   */
  async getAllChannelMappings() {
    try {
      this.smartReload();
      
      const mappings = this.db.get('voice_channel_mappings').value();
      return Object.values(mappings);
    } catch (error) {
      console.error('[DB] 모든 채널 매핑 조회 오류:', error);
      return [];
    }
  }

  /**
   * 음성 채널 매핑 제거
   * @param {string} voiceChannelId - 음성 채널 ID
   * @returns {Promise<boolean>} - 제거 성공 여부
   */
  async removeChannelMapping(voiceChannelId) {
    try {
      this.invalidateCache();
      
      const existed = this.db.get('voice_channel_mappings').has(voiceChannelId).value();
      if (!existed) {
        return false;
      }
      
      this.db.get('voice_channel_mappings').unset(voiceChannelId).write();
      
      console.log(`[DB] 채널 매핑 제거: ${voiceChannelId}`);
      return true;
    } catch (error) {
      console.error('[DB] 채널 매핑 제거 오류:', error);
      return false;
    }
  }

  /**
   * 마지막 참여자 수 업데이트
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {number} participantCount - 참여자 수
   * @returns {Promise<boolean>} - 업데이트 성공 여부
   */
  async updateLastParticipantCount(voiceChannelId, participantCount) {
    try {
      this.invalidateCache();
      
      const mappingData = this.db.get('voice_channel_mappings').get(voiceChannelId).value();
      if (!mappingData) {
        console.log(`[DB] 매핑을 찾을 수 없음: ${voiceChannelId}`);
        return false;
      }
      
      mappingData.last_participant_count = participantCount;
      mappingData.last_updated = Date.now();
      
      this.db.get('voice_channel_mappings')
          .set(voiceChannelId, mappingData)
          .write();
      
      console.log(`[DB] 참여자 수 업데이트: ${voiceChannelId} -> ${participantCount}`);
      return true;
    } catch (error) {
      console.error('[DB] 참여자 수 업데이트 오류:', error);
      return false;
    }
  }

  /**
   * 포럼 포스트 ID로 음성 채널 ID 찾기
   * @param {string} forumPostId - 포럼 포스트 ID
   * @returns {Promise<string|null>} - 음성 채널 ID 또는 null
   */
  async getVoiceChannelIdByPostId(forumPostId) {
    try {
      this.smartReload();
      
      const mappings = this.db.get('voice_channel_mappings').value();
      
      for (const [channelId, data] of Object.entries(mappings)) {
        if (data.forum_post_id === forumPostId) {
          return channelId;
        }
      }
      
      return null;
    } catch (error) {
      console.error('[DB] 포스트 ID로 채널 ID 조회 오류:', error);
      return null;
    }
  }

  /**
   * 만료된 매핑 정리 (오래된 매핑들 제거)
   * @param {number} maxAge - 최대 보관 기간 (밀리초, 기본값: 7일)
   * @returns {Promise<number>} - 제거된 매핑 개수
   */
  async cleanupExpiredMappings(maxAge = 7 * 24 * 60 * 60 * 1000) {
    try {
      this.invalidateCache();
      
      const now = Date.now();
      const mappings = this.db.get('voice_channel_mappings').value();
      let cleanedCount = 0;
      
      for (const [channelId, data] of Object.entries(mappings)) {
        if (data.last_updated && (now - data.last_updated) > maxAge) {
          this.db.get('voice_channel_mappings').unset(channelId).write();
          cleanedCount++;
          console.log(`[DB] 만료된 매핑 제거: ${channelId} (${Math.round((now - data.last_updated) / (24 * 60 * 60 * 1000))}일 경과)`);
        }
      }
      
      if (cleanedCount > 0) {
        console.log(`[DB] 만료된 매핑 정리 완료: ${cleanedCount}개 제거`);
      }
      
      return cleanedCount;
    } catch (error) {
      console.error('[DB] 만료된 매핑 정리 오류:', error);
      return 0;
    }
  }
}