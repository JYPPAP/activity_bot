// src/services/activityReportService.js - 활동 보고서 서비스
import { EmbedBuilder } from 'discord.js';
import { COLORS } from '../config/constants.js';
import { formatKoreanDate, formatTime } from '../utils/formatters.js';

/**
 * 활동 보고서 생성을 담당하는 서비스
 */
export class ActivityReportService {
    constructor(client, dbManager) {
        this.client = client;
        this.db = dbManager;
    }

    /**
     * 역할별 보고서 주기 결정
     * @param {string} roleName - 역할 이름
     * @returns {number} - 주 단위 간격 (1 또는 2)
     */
    getRoleReportInterval(roleName) {
        const lowerRole = roleName.toLowerCase();

        // 인턴/사원은 매주, 그 외는 2주에 한 번
        if (lowerRole.includes('인턴') || lowerRole.includes('사원')) {
            return 1;
        }
        return 2;
    }

    /**
     * 역할별 활동 보고서 생성 및 전송
     * @param {Date} startDate - 시작 날짜
     * @param {number} endTime - 종료 시간 (타임스탬프)
     * @param {Array<string>} roleNames - 역할 이름 배열
     * @param {TextChannel} channel - 전송할 채널
     */
    async generateRoleActivityReport(startDate, endTime, roleNames, channel) {
        try {
            const guild = channel.guild;
            const startTime = startDate.getTime();

            // 각 역할별 보고서 생성
            for (const roleName of roleNames) {
                // 역할 객체 찾기
                const role = guild.roles.cache.find(r => r.name === roleName);
                if (!role) {
                    console.log(`역할 [${roleName}]을 찾을 수 없습니다.`);
                    continue;
                }

                // 역할을 가진 멤버 찾기
                const members = guild.members.cache.filter(member =>
                    member.roles.cache.has(role.id)
                );

                // 멤버가 없으면 건너뛰기
                if (members.size === 0) {
                    console.log(`역할 [${roleName}]에 멤버가 없습니다.`);
                    continue;
                }

                // 역할의 최소 활동 시간 가져오기
                const roleConfig = await this.db.getRoleConfig(roleName);
                const minHours = roleConfig ? roleConfig.minHours : 0;
                const minTime = minHours * 60 * 60 * 1000; // 밀리초 단위로 변환

                // 각 멤버의 활동 시간 가져오기
                const memberActivities = [];
                for (const [memberId, member] of members.entries()) {
                    const activity = await this.db.getUserActivity(memberId);
                    if (activity) {
                        memberActivities.push({
                            name: member.displayName,
                            id: memberId,
                            totalTime: activity.totalTime || 0,
                            active: activity.totalTime >= minTime
                        });
                    } else {
                        memberActivities.push({
                            name: member.displayName,
                            id: memberId,
                            totalTime: 0,
                            active: false
                        });
                    }
                }

                // 활동 시간 기준으로 정렬
                memberActivities.sort((a, b) => b.totalTime - a.totalTime);

                // 활성/비활성 멤버 분리
                const activeMembers = memberActivities.filter(m => m.active);
                const inactiveMembers = memberActivities.filter(m => !m.active);

                // 역할 보고서 임베드 생성
                const embed = this.createRoleReportEmbed(
                    roleName,
                    activeMembers,
                    inactiveMembers,
                    minHours,
                    startDate,
                    new Date(endTime)
                );

                // 임베드 전송
                await channel.send({ embeds: [embed] });

                console.log(`역할 [${roleName}]의 활동 보고서가 전송되었습니다.`);
            }
        } catch (error) {
            console.error('역할 활동 보고서 생성 오류:', error);
            await channel.send('역할 활동 보고서 생성 중 오류가 발생했습니다.');
        }
    }

    /**
     * 주간 요약 보고서 생성 및 전송
     * @param {number} startTime - 시작 시간 (타임스탬프)
     * @param {number} endTime - 종료 시간 (타임스탬프)
     * @param {TextChannel} channel - 전송할 채널
     */
    async generateWeeklySummaryReport(startTime, endTime, channel) {
        try {
            // 요약 데이터 생성
            const summary = await this.getWeeklySummaryData(startTime, endTime);

            // 요약 임베드 생성 및 전송
            const embed = this.createWeeklySummaryEmbed(
                summary,
                new Date(startTime),
                new Date(endTime)
            );

            await channel.send({ embeds: [embed] });

            console.log(`주간 요약 보고서가 성공적으로 전송되었습니다.`);
        } catch (error) {
            console.error('주간 요약 보고서 생성 오류:', error);
        }
    }

    /**
     * 주간 요약 데이터 수집
     * @param {number} startTime - 시작 시간 (타임스탬프)
     * @param {number} endTime - 종료 시간 (타임스탬프)
     * @returns {Object} - 요약 데이터
     */
    async getWeeklySummaryData(startTime, endTime) {
        try {
            // 일별 활동 통계 가져오기
            const dailyStats = await this.db.getDailyActivityStats(startTime, endTime);

            // 날짜별 통계 합산
            let totalJoins = 0;
            let totalLeaves = 0;
            let activeDays = 0;

            dailyStats.forEach(day => {
                totalJoins += day.joins;
                totalLeaves += day.leaves;
                if (day.totalEvents > 0) activeDays++;
            });

            // 가장 활동적인 사용자 조회
            const activeUsers = await this.db.getAllUserActivity();

            // 활동적인 사용자를 활동 시간 기준으로 정렬
            activeUsers.sort((a, b) => b.totalTime - a.totalTime);

            // 상위 5명 추출
            const topUsers = activeUsers.slice(0, 5).map(user => ({
                name: user.displayName || user.userId,
                totalTime: user.totalTime
            }));

            // 가장 활동적인 채널 조회
            const activeChannelStats = await this.getMostActiveChannels(startTime, endTime);

            return {
                totalJoins,
                totalLeaves,
                activeDays,
                mostActiveUsers: topUsers,
                mostActiveChannels: activeChannelStats
            };
        } catch (error) {
            console.error('주간 요약 데이터 생성 오류:', error);
            return {
                totalJoins: 0,
                totalLeaves: 0,
                activeDays: 0,
                mostActiveUsers: [],
                mostActiveChannels: []
            };
        }
    }

    /**
     * 가장 활동적인 채널 목록 조회
     * @param {number} startTime - 시작 시간 (타임스탬프)
     * @param {number} endTime - 종료 시간 (타임스탬프)
     * @param {number} limit - 최대 결과 수
     * @returns {Array<Object>} - 채널 통계 목록
     */
    async getMostActiveChannels(startTime, endTime, limit = 5) {
        try {
            // 로그 데이터 조회
            const logs = await this.db.getActivityLogs(startTime, endTime);

            // 채널별 이벤트 수 집계
            const channelStats = {};
            logs.forEach(log => {
                if (!channelStats[log.channelName]) {
                    channelStats[log.channelName] = 0;
                }
                channelStats[log.channelName]++;
            });

            // 활동량 기준으로 정렬
            return Object.entries(channelStats)
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, limit);
        } catch (error) {
            console.error('활동적인 채널 조회 오류:', error);
            return [];
        }
    }

    /**
     * 역할 보고서 임베드 생성
     * @param {string} roleName - 역할 이름
     * @param {Array<Object>} activeMembers - 활성 멤버 목록
     * @param {Array<Object>} inactiveMembers - 비활성 멤버 목록
     * @param {number} minHours - 최소 활동 시간
     * @param {Date} startDate - 시작 날짜
     * @param {Date} endDate - 종료 날짜
     * @returns {EmbedBuilder} - 생성된 임베드
     */
    createRoleReportEmbed(roleName, activeMembers, inactiveMembers, minHours, startDate, endDate) {
        const startDateStr = formatKoreanDate(startDate).split(' ')[0];
        const endDateStr = formatKoreanDate(endDate).split(' ')[0];

        const embed = new EmbedBuilder()
            .setColor(COLORS.LOG)
            .setTitle(`📊 ${roleName} 역할 활동 보고서 (${startDateStr} ~ ${endDateStr})`)
            .setDescription(`최소 활동 시간: ${minHours}시간`)
            .addFields(
                {
                    name: `✅ 활동 기준 달성 멤버 (${activeMembers.length}명)`,
                    value: activeMembers.length > 0
                        ? activeMembers.map(m => `${m.name}: ${formatTime(m.totalTime)}`).join('\n')
                        : '없음'
                },
                {
                    name: `❌ 활동 기준 미달성 멤버 (${inactiveMembers.length}명)`,
                    value: inactiveMembers.length > 0
                        ? inactiveMembers.map(m => `${m.name}: ${formatTime(m.totalTime)}`).join('\n')
                        : '없음'
                }
            )
            .setTimestamp();

        return embed;
    }

    /**
     * 주간 요약 임베드 생성
     * @param {Object} summary - 요약 데이터
     * @param {Date} startDate - 시작 날짜
     * @param {Date} endDate - 종료 날짜
     * @returns {EmbedBuilder} - 생성된 임베드
     */
    createWeeklySummaryEmbed(summary, startDate, endDate) {
        const startDateStr = formatKoreanDate(startDate).split(' ')[0]; // 날짜만 추출
        const endDateStr = formatKoreanDate(endDate).split(' ')[0]; // 날짜만 추출

        const embed = new EmbedBuilder()
            .setColor(COLORS.LOG)
            .setTitle(`📅 주간 활동 요약 (${startDateStr} ~ ${endDateStr})`)
            .setDescription(`지난 주의 음성 채널 활동 요약입니다.`)
            .addFields(
                { name: '📊 총 활동 통계', value: `입장: ${summary.totalJoins}회\n퇴장: ${summary.totalLeaves}회\n활동 일수: ${summary.activeDays}일` },
                {
                    name: '👥 가장 활동적인 사용자',
                    value: summary.mostActiveUsers.length > 0
                        ? summary.mostActiveUsers.map(user => `${user.name}: ${formatTime(user.totalTime)}`).join('\n')
                        : '데이터 없음'
                },
                {
                    name: '🔊 가장 활동적인 채널',
                    value: summary.mostActiveChannels.length > 0
                        ? summary.mostActiveChannels.map(channel => `${channel.name}: ${channel.count}회`).join('\n')
                        : '데이터 없음'
                }
            )
            .setTimestamp();

        return embed;
    }

    /**
     * 날짜 기간 보고서 임베드 생성
     * @param {Array<Object>} summaries - 날짜별 요약 데이터 배열
     * @param {Date} startDate - 시작 날짜
     * @param {Date} endDate - 종료 날짜
     * @returns {EmbedBuilder} - 생성된 임베드
     */
    createDateRangeEmbed(summaries, startDate, endDate) {
        const startDateStr = formatKoreanDate(startDate).split(' ')[0];
        const endDateStr = formatKoreanDate(endDate).split(' ')[0];

        // 전체 통계 집계
        const totalJoins = summaries.reduce((sum, day) => sum + day.totalJoins, 0);
        const totalLeaves = summaries.reduce((sum, day) => sum + day.totalLeaves, 0);
        const activeDays = summaries.filter(day => day.totalJoins > 0 || day.totalLeaves > 0).length;

        // 활동 멤버 집계
        const allActiveMembers = new Map();
        for (const day of summaries) {
            for (const member of day.activeMembers) {
                const count = allActiveMembers.get(member) || 0;
                allActiveMembers.set(member, count + 1);
            }
        }

        // 가장 활동적인 멤버 5명
        const mostActiveMembers = Array.from(allActiveMembers.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        const embed = new EmbedBuilder()
            .setColor(COLORS.LOG)
            .setTitle(`📅 활동 요약 (${startDateStr} ~ ${endDateStr})`)
            .setDescription(`선택한 기간의 음성 채널 활동 요약입니다.`)
            .addFields(
                { name: '📊 총 활동 통계', value: `입장: ${totalJoins}회\n퇴장: ${totalLeaves}회\n활동 일수: ${activeDays}일` },
                {
                    name: '👥 가장 활동적인 멤버',
                    value: mostActiveMembers.length > 0
                        ? mostActiveMembers.map(([member, days]) => `${member}: ${days}일`).join('\n')
                        : '데이터 없음'
                }
            )
            .setTimestamp();

        return embed;
    }
}