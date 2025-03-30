// src/commands/gapCalendarCommand.js - 달력 형태의 활동 보고서 명령어
import { MessageFlags } from 'discord.js';
import { cleanRoleName } from '../utils/formatters.js';

export class GapCalendarCommand {
    constructor(calendarLogService) {
        this.calendarLogService = calendarLogService;
    }

    /**
     * gap_calendar 명령어를 실행합니다.
     * @param {Interaction} interaction - 상호작용 객체
     */
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            // 명령어 옵션 가져오기
            const startDate = interaction.options.getString("start_date");
            const endDate = interaction.options.getString("end_date");
            const roleOption = interaction.options.getString("role");

            // 날짜 파싱
            const parsedStartDate = new Date(startDate);
            const parsedEndDate = new Date(endDate);

            // 유효한 날짜인지 확인
            if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
                await interaction.followUp({
                    content: '유효하지 않은 날짜 형식입니다. YYYY-MM-DD 형식으로 입력해주세요.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            // 역할이 제공된 경우 역할별 보고서 생성
            if (roleOption) {
                const roles = roleOption.split(',').map(r => cleanRoleName(r.trim()));

                await interaction.followUp({
                    content: `${roles.join(', ')} 역할의 활동 보고서를 생성합니다...`,
                    flags: MessageFlags.Ephemeral,
                });

                // 역할별 보고서 생성
                await this.calendarLogService.sendRoleActivityReport(
                    parsedStartDate,
                    parsedEndDate.getTime(),
                    roles,
                    interaction.channel
                );
            } else {
                // 전체 활동 요약 보고서 생성
                await interaction.followUp({
                    content: `${startDate} ~ ${endDate} 기간의 활동 요약을 생성합니다...`,
                    flags: MessageFlags.Ephemeral,
                });

                await this.calendarLogService.sendDateRangeLog(
                    parsedStartDate,
                    parsedEndDate.getTime(),
                    interaction.channel
                );
            }
        } catch (error) {
            console.error('gap_calendar 명령어 실행 오류:', error);
            await interaction.followUp({
                content: '활동 보고서 생성 중 오류가 발생했습니다.',
                flags: MessageFlags.Ephemeral,
            });
        }
    }
}