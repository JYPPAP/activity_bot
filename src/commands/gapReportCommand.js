// src/commands/gapReportCommand.js - gap_report 명령어
import { MessageFlags, EmbedBuilder } from 'discord.js';
import { COLORS } from '../config/constants.js';
import { formatTime, formatKoreanDate, cleanRoleName } from '../utils/formatters.js';

export class GapReportCommand {
    constructor(dbManager, activityTracker) {
        this.db = dbManager;
        this.activityTracker = activityTracker;
    }

    /**
     * gap_report 명령어를 실행합니다.
     * @param {Interaction} interaction - 상호작용 객체
     */
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            // 역할 옵션 가져오기
            const roleOption = interaction.options.getString("role");
            const role = cleanRoleName(roleOption);

            // 실행 모드 가져오기 (테스트 모드 또는 리셋 포함 모드)
            const isTestMode = interaction.options.getBoolean("test_mode") ?? true;

            // 최신 데이터로 갱신
            await this.activityTracker.saveActivityData();

            // 역할 설정 가져오기
            const roleConfig = await this.db.getRoleConfig(role);
            if (!roleConfig) {
                return await interaction.followUp({
                    content: `역할 "${role}"에 대한 설정을 찾을 수 없습니다. 먼저 /gap_config 명령어로 설정해주세요.`,
                    flags: MessageFlags.Ephemeral,
                });
            }

            // 역할의 최소 활동 시간
            const minHours = roleConfig.minHours;
            const minActivityTime = minHours * 60 * 60 * 1000;

            // 마지막 리셋 시간 가져오기
            const lastResetTime = roleConfig.resetTime || Date.now() - (7 * 24 * 60 * 60 * 1000); // 기본값: 1주일 전

            // 현재 역할을 가진 멤버 가져오기
            const guild = interaction.guild;
            const members = await guild.members.fetch();
            const roleMembers = members.filter(member =>
                member.roles.cache.some(r => r.name === role)
            );

            // 활성/비활성/잠수 사용자 분류
            const activeUsers = [];
            const inactiveUsers = [];
            const afkUsers = []; // 잠수 사용자 배열 추가

            // 사용자 활동 데이터 조회 및 분류
            for (const [userId, member] of roleMembers.entries()) {
                const userActivity = await this.db.getUserActivity(userId);
                const afkStatus = await this.db.getUserAfkStatus(userId);

                const userData = {
                    userId,
                    nickname: member.displayName,
                    totalTime: userActivity ? userActivity.totalTime : 0
                };

                // 잠수 상태 확인
                if (afkStatus) {
                    const now = Date.now();
                    // 잠수 기간이 아직 유효한지 확인
                    if (afkStatus.afkUntil > now) {
                        // 잠수 해제 날짜 추가
                        userData.afkUntil = afkStatus.afkUntil;
                        afkUsers.push(userData);
                        continue; // 다음 사용자로 넘어감
                    } else {
                        // 잠수 기간이 만료되었으면 상태 해제
                        await this.db.clearUserAfkStatus(userId);

                        // 잠수 역할 제거
                        const afkRole = guild.roles.cache.find(role => role.name === "잠수");
                        if (afkRole && member.roles.cache.has(afkRole.id)) {
                            await member.roles.remove(afkRole);
                        }
                    }
                }

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
            afkUsers.sort((a, b) => b.totalTime - a.totalTime);

            // 보고서 생성 및 전송
            const reportEmbeds = this.createReportEmbeds(role, activeUsers, inactiveUsers, afkUsers, lastResetTime, minHours);

            if (isTestMode) { // 테스트 인 경우 보고서 전송 (서버 내 Embed로 전송)
                await interaction.followUp({
                    content: isTestMode ? "⚠️ 테스트 모드로 실행됩니다. 리셋 시간이 기록되지 않습니다." : "✅ 보고서가 생성되었습니다.",
                    embeds: reportEmbeds,
                    flags: MessageFlags.Ephemeral,
                });
            } else {
                // 날짜 채널에 전송
                const logChannelId = interaction.options.getChannel("log_channel")?.id || process.env.CALENDAR_LOG_CHANNEL_ID;
                if (logChannelId) {
                    const logChannel = await interaction.client.channels.fetch(logChannelId);
                    if (logChannel) {
                        await logChannel.send({
                            content: `🗓️ ${role} 역할 활동 보고서 (${isTestMode ? "테스트 모드" : "정식 출력"})`,
                            embeds: reportEmbeds
                        });
                    }
                }
            }

            // 테스트 모드가 아니고, 리셋 옵션이 켜져 있을 경우에만 리셋 시간 업데이트
            const resetOption = interaction.options.getBoolean("reset") ?? false;
            if (!isTestMode && resetOption) {
                await this.db.updateRoleResetTime(role, Date.now(), '보고서 출력 시 리셋');
                await interaction.followUp({
                    content: `✅ ${role} 역할의 활동 시간이 리셋되었습니다.`,
                    flags: MessageFlags.Ephemeral,
                });
            }

        } catch (error) {
            console.error('gap_report 명령어 실행 오류:', error);
            await interaction.followUp({
                content: '보고서 생성 중 오류가 발생했습니다.',
                flags: MessageFlags.Ephemeral,
            });
        }
    }

    /**
     * 활동 보고서 임베드를 생성합니다.
     * @param {string} role - 역할 이름
     * @param {Array<Object>} activeUsers - 활성 사용자 목록
     * @param {Array<Object>} inactiveUsers - 비활성 사용자 목록
     * @param {Array<Object>} afkUsers - 잠수 사용자 목록
     * @param {number} resetTime - 마지막 리셋 시간
     * @param {number} minHours - 최소 활동 시간(시)
     * @returns {Array<EmbedBuilder>} - 생성된 임베드 배열
     */
    createReportEmbeds(role, activeUsers, inactiveUsers, afkUsers, resetTime, minHours) {
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

        // 임베드 배열 (기본 임베드)
        const embeds = [activeEmbed, inactiveEmbed];

        // 잠수 사용자가 있을 경우에만 잠수 임베드 추가
        if (afkUsers.length > 0) {
            // 잠수 사용자 임베드
            const afkEmbed = new EmbedBuilder()
                .setColor('#808080') // 회색으로 설정
                .setTitle(`📊 ${role} 역할 활동 보고서 (${startDateStr} ~ ${endDateStr})`)
                .setDescription(`최소 활동 시간: ${minHours}시간`);

            // 잠수 멤버 정보 추가
            afkEmbed.addFields(
                { name: `💤 잠수 상태 멤버 (${afkUsers.length}명)`, value: '\u200B' }
            );

            afkEmbed.addFields(
                { name: '이름', value: afkUsers.map(user => user.nickname).join('\n'), inline: true },
                { name: '총 활동 시간', value: afkUsers.map(user => formatTime(user.totalTime)).join('\n'), inline: true },
                {
                    name: '잠수 해제 예정일',
                    value: afkUsers.map(user => formatSimpleDate(new Date(user.afkUntil))).join('\n'),
                    inline: true
                }
            );

            // 잠수 임베드 추가
            embeds.push(afkEmbed);
        }

        return embeds;
    }
}