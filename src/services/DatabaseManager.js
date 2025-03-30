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

/**
 * 특정 역할을 가진 사용자들의 활동 데이터 가져오기
 * @param {string} roleId - 역할 ID (선택 사항)
 * @param {number} startTime - 시작 시간 (선택 사항)
 * @param {number} endTime - 종료 시간 (선택 사항)
 * @returns {Array} - 사용자 활동 데이터 배열
 */
async getUserActivityByRole(roleId, startTime, endTime) {
    // 모든 사용자 활동 데이터 가져오기
    const activities = await this.getAllUserActivity();

    // 역할별 필터링은 호출하는 쪽에서 처리
    return activities;
}