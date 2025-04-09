// src/services/calendarLogService.js - 달력 형태의 로그 서비스 (리팩토링)
import { EmbedBuilder } from 'discord.js';
import { COLORS } from '../config/constants.js';
import { ScheduleService } from './scheduleService.js';
import { ActivityReportService } from './activityReportService.js';
import { config } from '../config/env.js';
import { formatKoreanDate } from '../utils/formatters.js';

/**
 * 달력 형태의 로그를 관리하는 서비스
 */
export class CalendarLogService {
    constructor(client, dbManager) {
        this.client = client;
        this.db = dbManager;
        this.calendarChannel = null;

        // 스케줄 서비스 초기화
        this.scheduleService = new ScheduleService();

        // 보고서 서비스 초기화
        this.reportService = new ActivityReportService(client, dbManager);
    }

    /**
     * 달력 로그 채널 초기화 및 스케줄 설정
     */
    async initialize() {
        // 채널 초기화
        if (config.CALENDAR_LOG_CHANNEL_ID) {
            try {
                this.calendarChannel = await this.client.channels.fetch(config.CALENDAR_LOG_CHANNEL_ID);
                console.log(`달력 로그 채널이 초기화되었습니다: ${this.calendarChannel.name}`);

                // 스케줄 설정
                this.initializeSchedules();
            } catch (error) {
                console.error('달력 로그 채널 초기화 오류:', error);
            }
        } else {
            console.warn('CALENDAR_LOG_CHANNEL_ID가 설정되지 않았습니다. 자동 보고서 기능이 비활성화됩니다.');
        }
    }

    /**
     * 스케줄 작업 초기화
     */
    initializeSchedules() {
        // 주간 요약 보고서 (매주 일요일 자정)
        this.scheduleService.scheduleWeekly('weekly-summary', 0, () => {
            if (this.calendarChannel) {
                this.sendWeeklySummary();
            }
        });

        // 역할별 보고서 (매일 자정 체크, 일요일에만 실행)
        this.scheduleService.scheduleDailyMidnight('role-reports', () => {
            if (this.calendarChannel) {
                const now = new Date();
                if (now.getDay() === 0) { // 일요일인 경우에만 실행
                    this.sendAllRoleReports();
                }
            }
        });

        console.log('자동 보고서 스케줄이 설정되었습니다.');
    }

    /**
     * 현재 날짜의 연도 기준 주차 계산
     * @param {Date} date - 날짜 객체
     * @returns {number} - 주차 번호
     */
    getWeekNumber(date) {
        const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
        const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
        return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
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
     * 주간 요약 보고서 전송
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

            // 주간 요약 보고서 생성 및 전송
            await this.reportService.generateWeeklySummaryReport(
                previousSunday.getTime(),
                lastSunday.getTime(),
                this.calendarChannel
            );

            console.log(`주간 요약이 성공적으로 전송되었습니다 (${formatKoreanDate(previousSunday)} ~ ${formatKoreanDate(lastSunday)})`);
        } catch (error) {
            console.error('주간 요약 전송 오류:', error);
        }
    }

    /**
     * 모든 역할에 대한 보고서 전송
     */
    async sendAllRoleReports() {
        try {
            if (!this.calendarChannel) return;

            // 추적 대상 역할 목록 가져오기
            const roleConfigs = await this.db.getAllRoleConfigs();
            const trackedRoles = roleConfigs.map(config => config.roleName);

            // 현재 날짜와 주 번호 계산
            const now = new Date();
            const weekNumber = this.getWeekNumber(now);

            // 역할별로 보고서 생성
            for (const roleName of trackedRoles) {
                // 역할별 보고서 주기 결정
                const interval = this.reportService.getRoleReportInterval(roleName);

                // 이번 주가 이 역할의 보고서 주인지 확인
                if (interval === 1 || weekNumber % interval === 0) {
                    // 지난 보고서 이후 기간 계산
                    const startDate = new Date(now);
                    startDate.setDate(now.getDate() - 7 * interval);
                    startDate.setHours(0, 0, 0, 0);

                    // 역할 활동 보고서 생성 및 전송
                    await this.sendRoleActivityReport(startDate, now.getTime(), [roleName]);

                    console.log(`역할 [${roleName}]의 ${interval}주 보고서가 생성되었습니다.`);
                }
            }
        } catch (error) {
            console.error('자동 역할 보고서 생성 오류:', error);
        }
    }

    /**
     * 역할별 활동 보고서 전송
     * @param {Date} startDate - 시작 날짜
     * @param {number} endTime - 종료 시간 (타임스탬프)
     * @param {Array<string>} roleNames - 역할 이름 배열
     * @param {TextChannel} channel - 전송할 채널 (선택사항)
     */
    async sendRoleActivityReport(startDate, endTime, roleNames, channel = null) {
        const targetChannel = channel || this.calendarChannel;
        if (!targetChannel) {
            console.error('보고서를 전송할 채널이 설정되지 않았습니다.');
            return;
        }

        await this.reportService.generateRoleActivityReport(
            startDate,
            endTime,
            roleNames,
            targetChannel
        );
    }

    /**
     * 특정 날짜 범위의 로그 조회하여 전송
     * @param {Date} startDate - 시작 날짜
     * @param {number} endTime - 종료 시간 (타임스탬프)
     * @param {TextChannel} channel - 전송할 채널
     */
    async sendDateRangeLog(startDate, endTime, channel) {
        try {
            // 날짜별 활동 통계 조회 및 요약 생성
            const dailySummaries = await this.getDailyActivitySummaries(startDate.getTime(), endTime);

            // 각 일별 요약 데이터 전송
            for (const summary of dailySummaries) {
                if (summary.hasActivity()) {
                    const embed = this.createDailySummaryEmbed(summary);
                    await channel.send({ embeds: [embed] });
                }
            }

            // 전체 기간 요약 임베드 전송
            const rangeEmbed = this.createDateRangeSummaryEmbed(dailySummaries, startDate, new Date(endTime));
            await channel.send({ embeds: [rangeEmbed] });
        } catch (error) {
            console.error('날짜 범위 로그 전송 오류:', error);
            await channel.send('요청한 날짜 범위의 로그를 처리하는 중 오류가 발생했습니다.');
        }
    }

    /**
     * 날짜별 활동 요약 데이터 생성
     * @param {number} startTime - 시작 시간 (타임스탬프)
     * @param {number} endTime - 종료 시간 (타임스탬프)
     * @returns {Array<DailyActivitySummary>} - 일별 활동 요약 데이터 배열
     */
    async getDailyActivitySummaries(startTime, endTime) {
        // 일별 통계 데이터 조회
        const dailyStats = await this.db.getDailyActivityStats(startTime, endTime);
        const summaries = [];

        for (const day of dailyStats) {
            // 해당 날짜의 시작/종료 시간 계산
            const dayDate = new Date(day.date);
            const dayEnd = new Date(day.date);
            dayEnd.setHours(23, 59, 59, 999);

            // 해당 날짜의 활동적인 멤버 조회
            const activeMembers = await this.getActiveMembersForDay(dayDate.getTime(), dayEnd.getTime());

            // 일별 요약 객체 생성
            summaries.push({
                date: day.date,
                totalJoins: day.joins,
                totalLeaves: day.leaves,
                channelChanges: day.totalEvents - day.joins - day.leaves,
                activeMembers,

                // 활동 여부 확인 메서드
                hasActivity() {
                    return this.totalJoins > 0 || this.totalLeaves > 0 || this.channelChanges > 0;
                }
            });
        }

        return summaries;
    }

    /**
     * 특정 날짜의 활동적인 멤버 조회
     * @param {number} startTime - 시작 시간 (타임스탬프)
     * @param {number} endTime - 종료 시간 (타임스탬프)
     * @returns {Array<string>} - 활동적인 멤버 이름 목록
     */
    async getActiveMembersForDay(startTime, endTime) {
        try {
            // 로그에서 사용자 ID 조회
            const logs = await this.db.getActivityLogs(startTime, endTime);

            // 고유한 사용자 ID 추출
            const userIds = [...new Set(logs.map(log => log.userId))];

            // 사용자 정보 조회
            const activeMembers = [];
            for (const userId of userIds) {
                const activity = await this.db.getUserActivity(userId);
                if (activity && activity.displayName) {
                    activeMembers.push(activity.displayName);
                } else if (userId) {
                    // 표시 이름이 없는 경우 사용자 ID 사용
                    activeMembers.push(userId);
                }
            }

            return activeMembers;
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
                { name: '📊 활동 통계', value: `입장: ${summary.totalJoins}회\n퇴장: ${summary.totalLeaves}회\n채널 변경: ${summary.channelChanges}회` }
            );

        // 활동 멤버가 있는 경우 추가
        if (summary.activeMembers && summary.activeMembers.length > 0) {
            const membersList = summary.activeMembers.slice(0, 10).join(', ');
            const extraCount = summary.activeMembers.length > 10 ? ` 외 ${summary.activeMembers.length - 10}명` : '';

            embed.addFields({
                name: '👥 활동 멤버',
                value: membersList + extraCount
            });
        } else {
            embed.addFields({
                name: '👥 활동 멤버',
                value: '활동 멤버 없음'
            });
        }

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
        const activeDays = summaries.filter(day => day.hasActivity()).length;

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
                { name: '📊 총 활동 통계', value: `입장: ${totalJoins}회\n퇴장: ${totalLeaves}회\n활동 일수: ${activeDays}일` }
            );

        // 활동적인 멤버가 있는 경우 추가
        if (mostActiveMembers.length > 0) {
            embed.addFields({
                name: '👥 가장 활동적인 멤버',
                value: mostActiveMembers.map(([member, days]) => `${member}: ${days}일`).join('\n')
            });
        } else {
            embed.addFields({
                name: '👥 가장 활동적인 멤버',
                value: '데이터 없음'
            });
        }

        embed.setTimestamp();
        return embed;
    }

    // 추가할 메서드 내용 (CalendarLogService.js)

    /**
     * 주간 요약 로그 초기화 (매일 자정에 실행하여 역할별 출력 주기 확인)
     */
    initWeeklySummary() {
        // 다음 자정까지의 시간 계산
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        const timeUntilMidnight = tomorrow.getTime() - now.getTime();

        // 타이머 설정
        setTimeout(async () => {
            await this.checkRoleReports();

            // 이후 매일 자정마다 실행
            setInterval(async () => {
                await this.checkRoleReports();
            }, 24 * 60 * 60 * 1000);
        }, timeUntilMidnight);

        console.log(`다음 보고서 확인은 ${formatKoreanDate(tomorrow)}에 예정되어 있습니다.`);
    }

    /**
     * 역할별 보고서 출력 확인 및 실행
     */
    async checkRoleReports() {
        try {
            // 모든 역할 설정 가져오기
            const roleConfigs = await this.db.getAllRoleConfigs();
            const today = new Date();

            for (const config of roleConfigs) {
                // 역할별 다음 보고서 예정 시간 확인
                const nextReportTime = await this.db.getNextReportTime(config.roleName);
                if (!nextReportTime) continue;

                const nextReportDate = new Date(nextReportTime);

                // 오늘이 보고서 출력일인지 확인
                if (today.getDate() === nextReportDate.getDate() &&
                    today.getMonth() === nextReportDate.getMonth() &&
                    today.getFullYear() === nextReportDate.getFullYear()) {

                    // 보고서 생성 및 출력
                    await this.generateAndSendRoleReport(config.roleName, false);

                    // 새로운 리셋 타임 설정 (자동 출력 시 리셋 포함)
                    await this.db.updateRoleResetTime(
                        config.roleName,
                        today.getTime(),
                        '자동 보고서 출력 시 리셋'
                    );

                    console.log(`${config.roleName} 역할의 자동 보고서가 출력되었습니다.`);
                }
            }
        } catch (error) {
            console.error('역할별 보고서 확인 오류:', error);
        }
    }

    /**
     * 역할별 보고서 생성 및 전송
     * @param {string} role - 역할 이름
     * @param {boolean} isTestMode - 테스트 모드 여부
     */
    async generateAndSendRoleReport(role, isTestMode = false) {
        try {
            if (!this.calendarChannel) return;

            // 역할 설정 가져오기
            const roleConfig = await this.db.getRoleConfig(role);
            if (!roleConfig) return;

            // 역할의 최소 활동 시간
            const minHours = roleConfig.minHours;
            const minActivityTime = minHours * 60 * 60 * 1000;

            // 마지막 리셋 시간 가져오기
            const lastResetTime = roleConfig.resetTime || Date.now() - (7 * 24 * 60 * 60 * 1000);

            // 현재 역할을 가진 멤버 가져오기
            const guild = this.client.guilds.cache.first();
            if (!guild) return;

            const members = await guild.members.fetch();
            const roleMembers = members.filter(member =>
                member.roles.cache.some(r => r.name === role)
            );

            // 활성/비활성 사용자 분류
            const activeUsers = [];
            const inactiveUsers = [];

            // 사용자 활동 데이터 조회 및 분류
            for (const [userId, member] of roleMembers.entries()) {
                const userActivity = await this.db.getUserActivity(userId);

                const userData = {
                    userId,
                    nickname: member.displayName,
                    totalTime: userActivity ? userActivity.totalTime : 0
                };

                // 최소 활동 시간 기준으로 사용자 분류
                if (userData.totalTime >= minActivityTime) {
                    activeUsers.push(userData);
                } else {
                    inactiveUsers.push(userData);
                }
            }

            // 활동 시간 기준으로 정렬
            activeUsers.sort((a, b) => b.totalTime - a.totalTime);
            inactiveUsers.sort((a, b) => b.totalTime - a.totalTime);

            // 보고서 생성
            const reportEmbeds = this.createRoleReportEmbeds(role, activeUsers, inactiveUsers, lastResetTime, minHours);

            // 보고서 전송
            await this.calendarChannel.send({
                content: `🗓️ ${role} 역할 활동 보고서 ${isTestMode ? "(테스트 모드)" : ""}`,
                embeds: reportEmbeds
            });

            return true;
        } catch (error) {
            console.error('역할별 보고서 생성 오류:', error);
            return false;
        }
    }

    /**
     * 역할별 보고서 임베드 생성
     * @param {string} role - 역할 이름
     * @param {Array<Object>} activeUsers - 활성 사용자 목록
     * @param {Array<Object>} inactiveUsers - 비활성 사용자 목록
     * @param {number} resetTime - 마지막 리셋 시간
     * @param {number} minHours - 최소 활동 시간(시)
     * @returns {Array<EmbedBuilder>} - 생성된 임베드 배열
     */
    createRoleReportEmbeds(role, activeUsers, inactiveUsers, resetTime, minHours) {
        // 날짜 범위 설정 (시작일: 리셋 시간, 종료일: 현재)
        const now = new Date();
        const startDate = resetTime ? new Date(resetTime) : now;

        // 날짜 형식을 YYYY.MM.DD 형태로 포맷팅
        const formatSimpleDate = (date) => {
            return `${date.getFullYear()}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getDate().toString().padStart(2, '0')}`;
        };

        const startDateStr = formatSimpleDate(startDate);
        const endDateStr = formatSimpleDate(now);

        // 활성 사용자 임베드
        const activeEmbed = new EmbedBuilder()
            .setColor(COLORS.ACTIVE)
            .setTitle(`📊 ${role} 역할 활동 보고서 (${startDateStr} ~ ${endDateStr})`)
            .setDescription(`최소 활동 시간: ${minHours}시간`);

        // 활성 멤버 정보 추가
        activeEmbed.addFields(
            { name: `✅ 활동 기준 달성 멤버 (${activeUsers.length}명)`, value: '\u200B' }
        );

        if (activeUsers.length > 0) {
            activeEmbed.addFields(
                { name: '이름', value: activeUsers.map(user => user.nickname).join('\n'), inline: true },
                { name: '총 활동 시간', value: activeUsers.map(user => formatTime(user.totalTime)).join('\n'), inline: true }
            );
        } else {
            activeEmbed.addFields(
                { name: '\u200B', value: '기준 달성 멤버가 없습니다.', inline: false }
            );
        }

        // 비활성 사용자 임베드
        const inactiveEmbed = new EmbedBuilder()
            .setColor(COLORS.INACTIVE)
            .setTitle(`📊 ${role} 역할 활동 보고서 (${startDateStr} ~ ${endDateStr})`)
            .setDescription(`최소 활동 시간: ${minHours}시간`);

        // 비활성 멤버 정보 추가
        inactiveEmbed.addFields(
            { name: `❌ 활동 기준 미달성 멤버 (${inactiveUsers.length}명)`, value: '\u200B' }
        );

        if (inactiveUsers.length > 0) {
            inactiveEmbed.addFields(
                { name: '이름', value: inactiveUsers.map(user => user.nickname).join('\n'), inline: true },
                { name: '총 활동 시간', value: inactiveUsers.map(user => formatTime(user.totalTime)).join('\n'), inline: true }
            );
        } else {
            inactiveEmbed.addFields(
                { name: '\u200B', value: '기준 미달성 멤버가 없습니다.', inline: false }
            );
        }

        return [activeEmbed, inactiveEmbed];
    }
}