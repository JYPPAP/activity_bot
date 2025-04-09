// src/commands/gapStatsCommand.js - 상세 통계 명령어
import {MessageFlags, EmbedBuilder} from 'discord.js';
import {COLORS} from '../config/constants.js';
import {formatTime, formatKoreanDate} from '../utils/formatters.js';

export class GapStatsCommand {
    constructor(dbManager) {
        this.db = dbManager;
    }

    /**
     * gap_stats 명령어를 실행합니다.
     * @param {Interaction} interaction - 상호작용 객체
     */
    async execute(interaction) {
        await interaction.deferReply({flags: MessageFlags.Ephemeral});

        try {
            // 기간 옵션 가져오기 (기본: 7일)
            const days = interaction.options.getInteger("days") || 7;

            // 사용자 옵션 가져오기 (선택사항)
            const user = interaction.options.getUser("user");

            // 오늘 날짜
            const now = new Date();

            // 시작 날짜 계산
            const startDate = new Date(now);
            startDate.setDate(now.getDate() - days);
            startDate.setHours(0, 0, 0, 0);

            // 타임스탬프로 변환
            const startTime = startDate.getTime();
            const endTime = now.getTime();

            // 상세 통계 생성
            if (user) {
                // 특정 사용자의 통계
                await this.sendUserStats(interaction, user, startTime, endTime);
            } else {
                // 전체 통계
                await this.sendGlobalStats(interaction, startTime, endTime, days);
            }
        } catch (error) {
            console.error('gap_stats 명령어 실행 오류:', error);
            await interaction.followUp({
                content: '통계 데이터 생성 중 오류가 발생했습니다.',
                flags: MessageFlags.Ephemeral,
            });
        }
    }

    /**
     * 특정 사용자의 상세 통계를 생성하고 전송합니다.
     */
    async sendUserStats(interaction, user, startTime, endTime) {
        // 사용자 활동 시간 조회
        const userActivity = await this.db.getUserActivity(user.id);

        // 사용자 활동 로그 조회
        const logs = await this.db.getUserActivityLogs(user.id, 100);

        // 로그 필터링 (기간 내)
        const filteredLogs = logs.filter(log => log.timestamp >= startTime && log.timestamp <= endTime);

        // 입장/퇴장 집계
        const joins = filteredLogs.filter(log => log.eventType === 'JOIN').length;
        const leaves = filteredLogs.filter(log => log.eventType === 'LEAVE').length;

        // 활동 날짜 집계
        const activeDays = new Set();
        filteredLogs.forEach(log => {
            const date = new Date(log.timestamp).toISOString().split('T')[0];
            activeDays.add(date);
        });

        // 자주 사용한 채널 집계
        const channelMap = new Map();
        filteredLogs.forEach(log => {
            const count = channelMap.get(log.channelName) || 0;
            channelMap.set(log.channelName, count + 1);
        });

        const topChannels = Array.from(channelMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        // 활동 시간대 집계
        const hourStats = Array(24).fill(0);
        filteredLogs.forEach(log => {
            const hour = new Date(log.timestamp).getHours();
            hourStats[hour]++;
        });

        const peakHours = hourStats
            .map((count, hour) => ({hour, count}))
            .sort((a, b) => b.count - a.count)
            .slice(0, 3)
            .map(item => `${item.hour}시 (${item.count}회)`);

        // 최근 활동 내역
        const recentLogs = filteredLogs
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 5)
            .map(log => {
                const date = formatKoreanDate(new Date(log.timestamp));
                return `${date} - ${log.eventType === 'JOIN' ? '입장' : '퇴장'} (${log.channelName})`;
            });

        // 임베드 생성
        const statsEmbed = new EmbedBuilder()
            .setColor(COLORS.LOG)
            .setTitle(`📊 ${user.username}님의 활동 통계`)
            .setThumbnail(user.displayAvatarURL())
            .addFields(
                {
                    name: '📅 조회 기간',
                    value: `${formatKoreanDate(new Date(startTime))} ~ ${formatKoreanDate(new Date(endTime))}`
                },
                {name: '⏱️ 총 활동 시간', value: formatTime(userActivity?.totalTime || 0)},
                {name: '📈 활동 요약', value: `입장: ${joins}회\n퇴장: ${leaves}회\n활동 일수: ${activeDays.size}일`},
                {
                    name: '🔊 자주 사용한 채널',
                    value: topChannels.length > 0
                        ? topChannels.map(([channel, count]) => `${channel}: ${count}회`).join('\n')
                        : '데이터 없음'
                },
                {
                    name: '⏰ 주요 활동 시간대',
                    value: peakHours.length > 0 ? peakHours.join(', ') : '데이터 없음'
                }
            );

        if (recentLogs.length > 0) {
            statsEmbed.addFields({name: '🕒 최근 활동 내역', value: recentLogs.join('\n')});
        }

        // 통계 전송
        await interaction.followUp({
            embeds: [statsEmbed],
            flags: MessageFlags.Ephemeral,
        });
    }

    /**
     * 서버 전체의 상세 통계를 생성하고 전송합니다.
     */
    async sendGlobalStats(interaction, startTime, endTime, days) {
        // 일별 활동 통계 조회
        const dailyStats = await this.db.getDailyActivityStats(startTime, endTime);

        // 총 입장/퇴장 횟수
        const totalJoins = dailyStats.reduce((sum, day) => sum + day.joins, 0);
        const totalLeaves = dailyStats.reduce((sum, day) => sum + day.leaves, 0);


        // 활동적인 사용자 조회 시 사용자 정보 가져오기 추가
        const activeUsersQuery = `
            SELECT userId, eventType, COUNT(*) as eventCount
            FROM activity_logs
            WHERE timestamp BETWEEN ? AND ?
            GROUP BY userId, eventType
        `;

        const userEvents = await this.db.db.all(activeUsersQuery, startTime, endTime);

        // 사용자별 활동 합산
        const userActivityMap = new Map();
        for (const event of userEvents) {
            if (!userActivityMap.has(event.userId)) {
                userActivityMap.set(event.userId, {joins: 0, leaves: 0});
            }

            const userData = userActivityMap.get(event.userId);
            if (event.eventType === 'JOIN') {
                userData.joins += event.eventCount;
            } else if (event.eventType === 'LEAVE') {
                userData.leaves += event.eventCount;
            }
        }

        // 사용자 ID를 표시 이름으로 변환
        const activeUsers = [];
        for (const [userId, data] of userActivityMap.entries()) {
            const totalEvents = data.joins + data.leaves;

            // 사용자 데이터 조회
            const userActivity = await this.db.getUserActivity(userId);

            // 디스코드 서버에서 직접 멤버 정보 가져오기 추가
            let displayName = userActivity?.displayName || userId;
            try {
                const guild = interaction.guild;
                if (guild) {
                    const member = await guild.members.fetch(userId).catch(() => null);
                    if (member) {
                        displayName = member.displayName;
                    }
                }
            } catch (error) {
                console.error(`사용자 정보 조회 실패: ${userId}`, error);
            }

            activeUsers.push({
                name: displayName,
                totalEvents,
                joins: data.joins,
                leaves: data.leaves
            });
        }

        // 활동량 기준 정렬
        activeUsers.sort((a, b) => b.totalEvents - a.totalEvents);
        const topActiveUsers = activeUsers.slice(0, 5);

        // 가장 활동적인 채널 조회
        const activeChannelsQuery = `
            SELECT channelName, COUNT(*) as eventCount
            FROM activity_logs
            WHERE timestamp BETWEEN ? AND ?
              AND channelName != '방-생성하기'
              AND channelId NOT IN (${config.EXCLUDED_CHANNELS.map(id => `'${id}'`).join(',')})
            GROUP BY channelName
            ORDER BY eventCount DESC
                LIMIT 5
        `;

        const topChannels = await this.db.db.all(activeChannelsQuery, startTime, endTime);

        // 시간대별 활동 통계
        const hourlyStatsQuery = `
            SELECT strftime('%H', timestamp/1000, 'unixepoch', 'localtime') as hour, 
             COUNT(*) as eventCount
            FROM activity_logs
            WHERE timestamp BETWEEN ? AND ?
            GROUP BY hour
            ORDER BY eventCount DESC
                LIMIT 5
        `;

        const peakHours = await this.db.db.all(hourlyStatsQuery, startTime, endTime);

        // 임베드 생성
        const statsEmbed = new EmbedBuilder()
            .setColor(COLORS.LOG)
            .setTitle(`📊 서버 활동 통계 (최근 ${days}일)`)
            .addFields(
                {
                    name: '📅 조회 기간',
                    value: `${formatKoreanDate(new Date(startTime))} ~ ${formatKoreanDate(new Date(endTime))}`
                },
                {name: '📈 활동 요약', value: `입장: ${totalJoins}회\n퇴장: ${totalLeaves}회\n활동 일수: ${dailyStats.length}일`},
                {
                    name: '👥 가장 활동적인 사용자 TOP 5',
                    value: topActiveUsers.length > 0
                        ? topActiveUsers.map(user => `${user.name}: ${user.totalEvents}회 (입장 ${user.joins}회, 퇴장 ${user.leaves}회)`).join('\n')
                        : '데이터 없음'
                },
                {
                    name: '🔊 가장 활동적인 채널 TOP 5',
                    value: topChannels.length > 0
                        ? topChannels.map(channel => `${channel.channelName}: ${channel.eventCount}회`).join('\n')
                        : '데이터 없음'
                },
                {
                    name: '⏰ 가장 활발한 시간대 TOP 5',
                    value: peakHours.length > 0
                        ? peakHours.map(hour => `${hour.hour}시: ${hour.eventCount}회`).join('\n')
                        : '데이터 없음'
                }
            );

        // 통계 전송
        await interaction.followUp({
            embeds: [statsEmbed],
            flags: MessageFlags.Ephemeral,
        });
    }
}