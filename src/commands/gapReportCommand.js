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

        // 실행 모드 가져오기 (테스트 모드 또는 리셋 포함 모드)
        const isTestMode = interaction.options.getBoolean("test_mode") ?? true;

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

        // 마지막 리셋 시간 가져오기
        const lastResetTime = roleConfig.resetTime || Date.now() - (7 * 24 * 60 * 60 * 1000); // 기본값: 1주일 전

        // 현재 역할을 가진 멤버 가져오기
        const guild = interaction.guild;
        const members = await guild.members.fetch();

        // 특정 역할의 멤버 필터링
        const roleMembers = members.filter(member =>
            member.roles.cache.some(r => r.name === role)
        );

        // 사용자 분류 서비스로 사용자 분류
        const { activeUsers, inactiveUsers, afkUsers, minHours } =
            await this.userClassificationService.classifyUsers(role, roleMembers);

        // 보고서 임베드 생성
        const reportEmbeds = EmbedFactory.createActivityEmbeds(
            role, activeUsers, inactiveUsers, afkUsers, lastResetTime, minHours, '활동 보고서'
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