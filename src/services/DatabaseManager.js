// src/services/databaseManager.js - LowDB 버전
import low from 'lowdb';
import FileSync from 'lowdb/adapters/FileSync';
import path from 'path';

export class DatabaseManager {
    constructor() {
        this.dbPath = path.join(process.cwd(), 'activity_bot.json');
        this.adapter = new FileSync(this.dbPath);
        this.db = low(this.adapter);

        // 기본 데이터베이스 구조 설정
        this.db.defaults({
            user_activity: {},
            role_config: {},
            activity_logs: [],
            reset_history: [],
            log_members: {}
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
        // LowDB는 트랜잭션을 지원하지 않음
        return true;
    }

    /**
     * 트랜잭션 커밋 (LowDB에서는 필요 없지만 호환성을 위해 유지)
     */
    async commitTransaction() {
        // LowDB는 트랜잭션을 지원하지 않음
        return true;
    }

    /**
     * 트랜잭션 롤백 (LowDB에서는 필요 없지만 호환성을 위해 유지)
     */
    async rollbackTransaction() {
        // LowDB는 트랜잭션을 지원하지 않음
        return true;
    }

    // ======== 사용자 활동 관련 메서드 ========

    /**
     * 사용자 활동 데이터 가져오기
     */
    async getUserActivity(userId) {
        return this.db.get('user_activity').get(userId).value();
    }

    /**
     * 사용자 활동 데이터 업데이트/삽입
     */
    async updateUserActivity(userId, totalTime, startTime, displayName) {
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
        const activities = this.db.get('user_activity').value();
        return Object.values(activities);
    }

    /**
     * 특정 역할을 가진 사용자들의 활동 데이터 가져오기
     */
    async getUserActivityByRole(roleId, startTime, endTime) {
        // 외부에서 Guild 객체를 통해 멤버를 가져와야 함
        return await this.getAllUserActivity();
    }

    /**
     * 사용자 활동 데이터 삭제
     */
    async deleteUserActivity(userId) {
        this.db.get('user_activity').unset(userId).write();
        return true;
    }

    // ======== 역할 설정 관련 메서드 ========

    /**
     * 역할 설정 가져오기
     */
    async getRoleConfig(roleName) {
        return this.db.get('role_config').get(roleName).value();
    }

    /**
     * 역할 설정 업데이트/삽입
     */
    async updateRoleConfig(roleName, minHours, resetTime = null) {
        this.db.get('role_config')
            .set(roleName, {
                roleName,
                minHours,
                resetTime
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
        // 역할 설정 업데이트
        const roleConfig = await this.getRoleConfig(roleName);
        if (roleConfig) {
            await this.updateRoleConfig(roleName, roleConfig.minHours, resetTime);
        } else {
            await this.updateRoleConfig(roleName, 0, resetTime);
        }

        // 리셋 기록 추가
        this.db.get('reset_history')
            .push({
                id: Date.now(), // 고유한 ID 생성
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
            .filter({ roleName })
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
        const timestamp = Date.now();

        // 로그 항목 생성
        const logEntry = {
            id: timestamp + '-' + userId.slice(0, 6), // 타임스탬프와 사용자 ID 일부로 고유한 ID 생성
            userId,
            eventType,
            channelId,
            channelName,
            timestamp,
            membersCount: members.length
        };

        // 로그 항목 저장
        this.db.get('activity_logs')
            .push(logEntry)
            .write();

        // 멤버 목록 저장
        if (members.length > 0) {
            this.db.set(`log_members.${logEntry.id}`, members).write();
        }

        return logEntry.id;
    }

    /**
     * 특정 기간의 활동 로그 가져오기
     */
    async getActivityLogs(startTime, endTime, eventType = null) {
        let query = this.db.get('activity_logs')
            .filter(log => log.timestamp >= startTime && log.timestamp <= endTime);

        if (eventType) {
            query = query.filter({ eventType });
        }

        const logs = query.sortBy('timestamp').reverse().value();

        // 멤버 정보 추가
        return logs.map(log => {
            const members = this.db.get(`log_members.${log.id}`).value() || [];
            return { ...log, members };
        });
    }

    /**
     * 특정 사용자의 활동 로그 가져오기
     */
    async getUserActivityLogs(userId, limit = 100) {
        const logs = this.db.get('activity_logs')
            .filter({ userId })
            .sortBy('timestamp')
            .reverse()
            .take(limit)
            .value();

        // 멤버 정보 추가
        return logs.map(log => {
            const members = this.db.get(`log_members.${log.id}`).value() || [];
            return { ...log, members };
        });
    }

    /**
     * 날짜별 활동 통계 가져오기
     */
    async getDailyActivityStats(startTime, endTime) {
        const logs = this.db.get('activity_logs')
            .filter(log => log.timestamp >= startTime && log.timestamp <= endTime)
            .value();

        // 일별로 데이터 그룹화
        const dailyStats = {};
        logs.forEach(log => {
            const date = new Date(log.timestamp);
            const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD 형식

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

        // Set을 개수로 변환하여 반환
        return Object.values(dailyStats).map(stat => ({
            ...stat,
            uniqueUsers: stat.uniqueUsers.size
        }));
    }

    // 여기에 새로운 메서드들 추가

    /**
     * 특정 기간의 활동 멤버 목록 가져오기
     * @param {number} startTime - 시작 시간 (타임스탬프)
     * @param {number} endTime - 종료 시간 (타임스탬프)
     * @returns {Array<Object>} - 활동 멤버 정보 목록
     */
    async getActiveMembersForTimeRange(startTime, endTime) {
        try {
            // 해당 기간의 로그 가져오기
            const logs = this.db.get('activity_logs')
                .filter(log => log.timestamp >= startTime && log.timestamp <= endTime)
                .value();

            // 고유한 사용자 ID 추출
            const userIds = [...new Set(logs.map(log => log.userId))];

            // 사용자 활동 정보 조회
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
     * @param {number} startTime - 시작 시간 (타임스탬프)
     * @param {number} endTime - 종료 시간 (타임스탬프)
     * @param {number} limit - 최대 결과 수
     * @returns {Array<Object>} - 활동적인 채널 목록
     */
    async getMostActiveChannels(startTime, endTime, limit = 5) {
        try {
            // 로그 데이터 조회
            const logs = this.db.get('activity_logs')
                .filter(log => log.timestamp >= startTime && log.timestamp <= endTime)
                .value();

            // 채널별 활동 횟수 집계
            const channelCounts = {};
            logs.forEach(log => {
                if (!channelCounts[log.channelName]) {
                    channelCounts[log.channelName] = 0;
                }
                channelCounts[log.channelName]++;
            });

            // 활동 횟수 기준으로 정렬
            const sortedChannels = Object.entries(channelCounts)
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, limit);

            return sortedChannels;
        } catch (error) {
            console.error('활동적인 채널 조회 오류:', error);
            return [];
        }
    }

    // ======== 마이그레이션 메서드 ========

    /**
     * JSON 데이터에서 마이그레이션
     */
    async migrateFromJSON(activityData, roleConfigData) {
        try {
            // 사용자 활동 데이터 마이그레이션
            for (const [userId, data] of Object.entries(activityData)) {
                if (userId !== 'resetTimes') {
                    this.db.get('user_activity')
                        .set(userId, {
                            userId,
                            totalTime: data.totalTime || 0,
                            startTime: data.startTime || null,
                            displayName: null // 기존 데이터에 displayName이 없을 수 있음
                        })
                        .write();
                }
            }

            // 역할 구성 마이그레이션
            for (const [roleName, minHours] of Object.entries(roleConfigData)) {
                const resetTime = activityData.resetTimes && activityData.resetTimes[roleName]
                    ? activityData.resetTimes[roleName]
                    : null;

                this.db.get('role_config')
                    .set(roleName, {
                        roleName,
                        minHours,
                        resetTime
                    })
                    .write();

                // 리셋 이력에도 추가
                if (resetTime) {
                    this.db.get('reset_history')
                        .push({
                            id: Date.now() + '-' + roleName, // 고유한 ID 생성
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
}