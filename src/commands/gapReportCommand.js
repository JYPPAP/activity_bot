// src/commands/gapReportCommand.js - gap_report 명령어
import { MessageFlags } from 'discord.js';
import { cleanRoleName } from '../utils/formatters.js';
import { EmbedFactory } from '../utils/embedBuilder.js';
import { CommandBase } from './CommandBase.js';

export class GapReportCommand extends CommandBase {
    constructor(dbManager, activityTracker) {
        super({ dbManager, activityTracker });
        this.userClassificationService = null;
    }

    /**
     * 의존성 주입을 위한 메서드
     * @param {UserClassificationService} userClassificationService - 사용자 분류 서비스
     */
    setUserClassificationService(userClassificationService) {
        this.userClassificationService = userClassificationService;
    }

    /**
     * gap_report 명령어의 실제 실행 로직
     * @param {Interaction} interaction - 상호작용 객체
     */
    async executeCommand(interaction) {
        // 역할 옵션 가져오기
        const roleOption = interaction.options.getString("role");
        const role = cleanRoleName(roleOption);

        // 날짜 옵션 가져오기
        const startDateStr = interaction.options.getString("start_date")?.trim();
        const endDateStr = interaction.options.getString("end_date")?.trim();

        // 디버깅을 위한 로그
        console.log('입력된 날짜:', startDateStr, endDateStr);

        // 실행 모드 가져오기 (테스트 모드 또는 리셋 포함 모드)
        const isTestMode = interaction.options.getBoolean("test_mode") ?? false;

        // 최신 데이터로 갱신
        await this.activityTracker.saveActivityData();

        // 역할 설정 가져오기
        const roleConfig = await this.dbManager.getRoleConfig(role);
        if (!roleConfig) {
            return await interaction.followUp({
                content: `역할 "${role}"에 대한 설정을 찾을 수 없습니다. 먼저 /gap_config 명령어로 설정해주세요.`,
                flags: MessageFlags.Ephemeral,
            });
        }

        // 현재 역할을 가진 멤버 가져오기
        const guild = interaction.guild;
        const members = await guild.members.fetch();

        // 특정 역할의 멤버 필터링
        const roleMembers = members.filter(member =>
            member.roles.cache.some(r => r.name === role)
        );

        // 날짜 범위 설정
        let startDate, endDate;

        if (startDateStr && endDateStr) {
            // 간단한 정규식 검증 먼저 수행
            if (!/^\d{6}$/.test(startDateStr)) {
                return await interaction.followUp({
                    content: `시작 날짜 형식이 올바르지 않습니다. '${startDateStr}'는 'YYMMDD' 형식이어야 합니다. (예: 250413)`,
                    flags: MessageFlags.Ephemeral,
                });
            }

            if (!/^\d{6}$/.test(endDateStr)) {
                return await interaction.followUp({
                    content: `종료 날짜 형식이 올바르지 않습니다. '${endDateStr}'는 'YYMMDD' 형식이어야 합니다. (예: 250420)`,
                    flags: MessageFlags.Ephemeral,
                });
            }

            // YYMMDD 형식의 날짜 처리
            try {
                // 수동으로 날짜 파싱
                const startYear = 2000 + parseInt(startDateStr.substring(0, 2), 10);
                const startMonth = parseInt(startDateStr.substring(2, 4), 10) - 1;
                const startDay = parseInt(startDateStr.substring(4, 6), 10);

                const endYear = 2000 + parseInt(endDateStr.substring(0, 2), 10);
                const endMonth = parseInt(endDateStr.substring(2, 4), 10) - 1;
                const endDay = parseInt(endDateStr.substring(4, 6), 10);

                startDate = new Date(startYear, startMonth, startDay, 0, 0, 0, 0);
                endDate = new Date(endYear, endMonth, endDay, 23, 59, 59, 999);

                // 날짜 유효성 검사
                if (isNaN(startDate.getTime())) {
                    throw new Error(`유효하지 않은 시작 날짜: ${startDateStr}`);
                }

                if (isNaN(endDate.getTime())) {
                    throw new Error(`유효하지 않은 종료 날짜: ${endDateStr}`);
                }

            } catch (error) {
                console.error('날짜 파싱 오류:', error);
                return await interaction.followUp({
                    content: `날짜 처리 중 오류가 발생했습니다: ${error.message}`,
                    flags: MessageFlags.Ephemeral,
                });
            }
        } else {
            // 날짜가 지정되지 않은 경우 기본값 사용 (마지막 리셋 시간부터 현재까지)
            startDate = roleConfig.resetTime ? new Date(roleConfig.resetTime) : new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
            endDate = new Date();
        }

        // 디버깅 로그
        console.log('파싱된 날짜:', startDate, endDate);

        // 사용자 분류 서비스로 사용자 분류 (날짜 범위 기준)
        const { activeUsers, inactiveUsers, afkUsers, minHours, reportCycle } =
            await this.userClassificationService.classifyUsersByDateRange(role, roleMembers, startDate, endDate);

        // 보고서 임베드 생성
        const reportEmbeds = EmbedFactory.createActivityEmbeds(
            role, activeUsers, inactiveUsers, afkUsers, startDate, endDate, minHours, reportCycle, '활동 보고서'
        );

        if (isTestMode) { // 테스트인 경우 보고서 전송 (서버 내 Embed로 전송)
            await interaction.followUp({
                content: isTestMode ? "⚠️ 테스트 모드로 실행됩니다. 리셋 시간이 기록되지 않습니다." : "✅ 보고서가 생성되었습니다.",
                embeds: reportEmbeds,
                flags: MessageFlags.Ephemeral,
            });
        } else {
            // 채널에 전송
            const logChannelId = interaction.options.getChannel("log_channel")?.id || process.env.CALENDAR_LOG_CHANNEL_ID;
            if (logChannelId) {
                const logChannel = await interaction.client.channels.fetch(logChannelId);
                if (logChannel) {
                    await logChannel.send({
                        content: `🗓️ ${role} 역할 활동 보고서 (정식 출력)`,
                        embeds: reportEmbeds
                    });
                }
            }
        }

        // 테스트 모드가 아니고, 리셋 옵션이 켜져 있을 경우에만 리셋 시간 업데이트
        const resetOption = interaction.options.getBoolean("reset") ?? false;
        if (!isTestMode && resetOption) {
            await this.dbManager.updateRoleResetTime(role, Date.now(), '보고서 출력 시 리셋');
            await interaction.followUp({
                content: `✅ ${role} 역할의 활동 시간이 리셋되었습니다.`,
                flags: MessageFlags.Ephemeral,
            });
        }
    }
}