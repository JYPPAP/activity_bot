// src/services/calendarLogService.js - 달력 형태의 로그 서비스 (SQLite 버전)
import { EmbedBuilder } from 'discord.js';
import { COLORS } from '../config/constants.js';
import { formatKoreanDate } from '../utils/formatters.js';
import { config } from '../config/env.js';

/**
 * 달력 형태의 로그를 관리하는 서비스
 */
export class CalendarLogService {
    constructor(client, dbManager) {
        this.client = client;
        this.db = dbManager;
        this.calendarChannel = null;

        // 주간 요약 로그 타이머 설정
        this.initWeeklySummary();
    }

    /**
     * 달력 로그 채널 초기화
     */
    async initialize() {
        if (config.CALENDAR_LOG_CHANNEL_ID) {
            try {
                this.calendarChannel = await this.client.channels.fetch(config.CALENDAR_LOG_CHANNEL_ID);
                console.log(`달력 로그 채널이 초기화되었습니다: ${this.calendarChannel.name}`);
            } catch (error) {
                console.error('달력 로그 채널 초기화 오류:', error);
            }
        }
    }

    /**
     * 활동 로그를 DB에 기록
     * @param {string} message - 로그 메시지
     * @param {Array<string>} members - 채널 멤버 목록
     * @param {string} type - 로그 타입 (JOIN, LEAVE 등)
     * @param {string} channelId - 채널 ID
     * @param {string} channelName - 채널 이름
     * @param {string} userId - 사용자 ID
     */
    async archiveActivity(message, members, type, channelId, channelName, userId) {
        try {
            await this.db.logActivity(userId, type, channelId, channelName, members);
        } catch (error) {
            console.error('활동 로그 기록 오류:', error);
        }
    }

    /**
     * 날짜 키 포맷 (YYYY-MM-DD)
     * @param {Date} date - 날짜
     * @returns {string} - 포맷된 날짜 키
     */
    formatDateKey(date) {
        return date.toISOString().split('T')[0];
    }

    /**
     * 주간 요약 로그 초기화 (매주 일요일 자정에 실행)
     */
    initWeeklySummary() {
        // 다음 일요일 자정까지의 시간 계산
        const now = new Date();
        const daysUntilSunday = 7 - now.getDay();
        const nextSunday = new Date(now);
        nextSunday.setDate(now.getDate() + daysUntilSunday);
        nextSunday.setHours(0, 0, 0, 0);

        const timeUntilSunday = nextSunday.getTime() - now.getTime();

        // 타이머 설정
        setTimeout(() => {
            this.sendWeeklySummary();

            // 이후 매주 일요일마다 실행 (7일 간격)
            setInterval(() => {
                this.sendWeeklySummary();
            }, 7 * 24 * 60 * 60 * 1000);
        }, timeUntilSunday);

        console.log(`다음 주간 요약은 ${formatKoreanDate(nextSunday)}에 예정되어 있습니다.`);
    }

    /**
     * 주간 요약 로그 전송
     */
    async sendWeeklySummary() {
        if (!this.calendarChannel) return;

        try {
            // 지난 주 날짜 범위 계산
            const today = new Date();
            const lastSunday = new Date(today);
            lastSunday.setDate(today.getDate() - today.getDay());
            lastSunday.setHours(0, 0, 0, 0);

            const previousSunday = new Date(lastSunday);
            previousSunday.setDate(lastSunday.getDate() - 7);

            // 요약 데이터 생성
            const summary = await this.generateWeeklySummary(previousSunday.getTime(), lastSunday.getTime());

            // 요약 임베드 생성 및 전송
            const embed = this.createWeeklySummaryEmbed(summary, previousSunday, lastSunday);
            await this.calendarChannel.send({ embeds: [embed] });

            console.log(`주간 요약이 성공적으로 전송되었습니다 (${formatKoreanDate(previousSunday)} ~ ${formatKoreanDate(lastSunday)})`);
        } catch (error) {
            console.error('주간 요약 전송 오류:', error);
        }
    }

    /**
     * 주간 요약 데이터 생성 - SQLite 버전
     * @param {number} startTime - 시작 시간 (타임스탬프)
     * @param {number} endTime - 종료 시간 (타임스탬프)
     * @returns {Object} - 요약 데이터
     */
    async generateWeeklySummary(startTime, endTime) {
        try {
            // 기본 통계 가져오기
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

            // 가장 활동적인 사용자 조회 (JOIN + LEAVE 이벤트 기준)
            const activeUsersQuery = `
        SELECT userId, COUNT(*) as eventCount
        FROM activity_logs
        WHERE timestamp BETWEEN ? AND ?
        GROUP BY userId
        ORDER BY eventCount DESC
        LIMIT 5
      `;

            const activeUsers = await this.db.db.all(activeUsersQuery, startTime, endTime);

            // 사용자 ID를 표시 이름으로 변환
            const activeUserNames = [];
            for (const user of activeUsers) {
                const userActivity = await this.db.getUserActivity(user.userId);
                if (userActivity && userActivity.displayName) {
                    activeUserNames.push({
                        name: userActivity.displayName,
                        count: user.eventCount
                    });
                } else {
                    activeUserNames.push({
                        name: user.userId,
                        count: user.eventCount
                    });
                }
            }

            // 가장 활동적인 채널 조회
            const activeChannelsQuery = `
        SELECT channelName, COUNT(*) as eventCount
        FROM activity_logs
        WHERE timestamp BETWEEN ? AND ?
        GROUP BY channelName
        ORDER BY eventCount DESC
        LIMIT 5
      `;

            const activeChannels = await this.db.db.all(activeChannelsQuery, startTime, endTime);

            return {
                totalJoins,
                totalLeaves,
                activeDays,
                mostActiveUsers: activeUserNames,
                mostActiveChannel: activeChannels.map(channel => ({
                    name: channel.channelName,
                    count: channel.eventCount
                }))
            };
        } catch (error) {
            console.error('주간 요약 데이터 생성 오류:', error);
            return {
                totalJoins: 0,
                totalLeaves: 0,
                activeDays: 0,
                mostActiveUsers: [],
                mostActiveChannel: []
            };
        }
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
                        ? summary.mostActiveUsers.map(user => `${user.name}: ${user.count}회`).join('\n')
                        : '데이터 없음'
                },
                {
                    name: '🔊 가장 활동적인 채널',
                    value: summary.mostActiveChannel.length > 0
                        ? summary.mostActiveChannel.map(channel => `${channel.name}: ${channel.count}회`).join('\n')
                        : '데이터 없음'
                }
            )
            .setTimestamp();

        return embed;
    }

    /**
     * 특정 날짜 범위의 로그 조회하여 전송
     * @param {Date} startDate - 시작 날짜
     * @param {Date} endDate - 종료 날짜
     * @param {TextChannel} channel - 전송할 채널
     */
    async sendDateRangeLog(startDate, endTime, channel) {
        try {
            // 타임스탬프로 변환
            const startTime = startDate.getTime();

            // 날짜별 활동 통계 조회
            const dailyStats = await this.db.getDailyActivityStats(startTime, endTime);

            // 날짜별 활동 요약 생성
            const summaries = [];

            for (const day of dailyStats) {
                // 해당 날짜의 로그 조회
                const dayStart = new Date(day.date);
                const dayEnd = new Date(day.date);
                dayEnd.setHours(23, 59, 59, 999);

                // 해당 날짜의 활동적인 멤버 조회
                const activeMembers = await this.getActiveMembersForDay(dayStart.getTime(), dayEnd.getTime());

                summaries.push({
                    date: day.date,
                    totalJoins: day.joins,
                    totalLeaves: day.leaves,
                    channelChanges: day.totalEvents - day.joins - day.leaves,
                    activeMembers
                });
            }

            // 날짜별 임베드 생성 및 전송
            for (const summary of summaries) {
                if (summary.totalJoins > 0 || summary.totalLeaves > 0 || summary.channelChanges > 0) {
                    const embed = this.createDailySummaryEmbed(summary);
                    await channel.send({ embeds: [embed] });
                }
            }

            // 날짜 범위 요약 임베드 전송
            const rangeEmbed = this.createDateRangeSummaryEmbed(summaries, startDate, new Date(endTime));
            await channel.send({ embeds: [rangeEmbed] });
        } catch (error) {
            console.error('날짜 범위 로그 전송 오류:', error);
            await channel.send('요청한 날짜 범위의 로그를 처리하는 중 오류가 발생했습니다.');
        }
    }

    /**
     * 특정 날짜의 활동적인 멤버 조회
     * @param {number} startTime - 시작 시간 (타임스탬프)
     * @param {number} endTime - 종료 시간 (타임스탬프)
     * @returns {Array<string>} - 활동적인 멤버 이름 목록
     */
    async getActiveMembersForDay(startTime, endTime) {
        try {
            const query = `
        SELECT DISTINCT m.memberName
        FROM activity_logs a
        JOIN log_members m ON a.id = m.logId
        WHERE a.timestamp BETWEEN ? AND ?
      `;

            const result = await this.db.db.all(query, startTime, endTime);
            return result.map(row => row.memberName);
        } catch (error) {
            console.error('활동 멤버 조회 오류:', error);
            return [];
        }
    }

    /**
     * 일일 요약 임베드 생성
     * @param {Object} summary - 일일 요약 데이터
     * @returns {EmbedBuilder} - 생성된 임베드
     */
    createDailySummaryEmbed(summary) {
        const embed = new EmbedBuilder()
            .setColor(COLORS.LOG)
            .setTitle(`📆 ${summary.date} 활동 요약`)
            .addFields(
                { name: '📊 활동 통계', value: `입장: ${summary.totalJoins}회\n퇴장: ${summary.totalLeaves}회\n채널 변경: ${summary.channelChanges}회` },
                {
                    name: '👥 활동 멤버',
                    value: summary.activeMembers.length > 0
                        ? summary.activeMembers.slice(0, 10).join(', ') + (summary.activeMembers.length > 10 ? ` 외 ${summary.activeMembers.length - 10}명` : '')
                        : '활동 멤버 없음'
                }
            );

        return embed;
    }

    /**
     * 날짜 범위 요약 임베드 생성
     * @param {Array<Object>} summaries - 날짜별 요약 데이터 배열
     * @param {Date} startDate - 시작 날짜
     * @param {Date} endDate - 종료 날짜
     * @returns {EmbedBuilder} - 생성된 임베드
     */
    createDateRangeSummaryEmbed(summaries, startDate, endDate) {
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