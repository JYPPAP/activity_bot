// src/commands/gapAfkCommand.js - gap_afk 명령어
import { MessageFlags } from 'discord.js';

export class GapAfkCommand {
    constructor(client, dbManager) {
        this.client = client;
        this.db = dbManager;
    }

    /**
     * gap_afk 명령어를 실행합니다.
     * @param {Interaction} interaction - 상호작용 객체
     */
    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            // 사용자 옵션 가져오기
            const targetUser = interaction.options.getUser("user");
            // 날짜 옵션 가져오기 (YYMMDD 형식)
            const dateStr = interaction.options.getString("until_date");

            if (!targetUser) {
                return await interaction.followUp({
                    content: "사용자를 지정해주세요.",
                    flags: MessageFlags.Ephemeral,
                });
            }

            if (!dateStr || !/^\d{6}$/.test(dateStr)) {
                return await interaction.followUp({
                    content: "날짜는 YYMMDD 형식으로 입력해주세요. (예: 250510)",
                    flags: MessageFlags.Ephemeral,
                });
            }

            // YYMMDD 형식 파싱
            const year = 2000 + parseInt(dateStr.substring(0, 2), 10);
            const month = parseInt(dateStr.substring(2, 4), 10) - 1; // JavaScript의 월은 0부터 시작
            const day = parseInt(dateStr.substring(4, 6), 10);

            // 지정된 날짜의 다음 일요일 계산
            const untilDate = new Date(year, month, day);
            const daysUntilSunday = 7 - untilDate.getDay();
            if (daysUntilSunday < 7) {
                untilDate.setDate(untilDate.getDate() + daysUntilSunday);
            }

            // 현재 날짜보다 과거인지 확인
            const now = new Date();
            if (untilDate < now) {
                return await interaction.followUp({
                    content: "지정한 날짜가 현재보다 과거입니다. 미래 날짜를 입력해주세요.",
                    flags: MessageFlags.Ephemeral,
                });
            }

            // 길드와 멤버 가져오기
            const guild = interaction.guild;
            const member = await guild.members.fetch(targetUser.id);

            if (!member) {
                return await interaction.followUp({
                    content: "해당 사용자를 서버에서 찾을 수 없습니다.",
                    flags: MessageFlags.Ephemeral,
                });
            }

            // 잠수 역할 찾기 또는 생성
            let afkRole = guild.roles.cache.find(role => role.name === "잠수");
            if (!afkRole) {
                // 역할이 없으면 생성
                try {
                    afkRole = await guild.roles.create({
                        name: "잠수",
                        reason: "잠수 상태 관리를 위한 역할"
                    });
                } catch (error) {
                    console.error("잠수 역할 생성 오류:", error);
                    return await interaction.followUp({
                        content: "잠수 역할을 생성할 수 없습니다. 권한을 확인해주세요.",
                        flags: MessageFlags.Ephemeral,
                    });
                }
            }

            // 역할 부여
            await member.roles.add(afkRole);

            // DB에 잠수 정보 저장
            await this.db.setUserAfkStatus(targetUser.id, member.displayName, untilDate.getTime());

            // 한국어 날짜 포맷
            const formattedDate = `${untilDate.getFullYear()}년 ${untilDate.getMonth() + 1}월 ${untilDate.getDate()}일`;

            await interaction.followUp({
                content: `${targetUser.username}님을 ${formattedDate}까지 잠수 상태로 설정했습니다.`,
                flags: MessageFlags.Ephemeral,
            });

        } catch (error) {
            console.error('gap_afk 명령어 실행 오류:', error);
            await interaction.followUp({
                content: '잠수 상태 설정 중 오류가 발생했습니다.',
                flags: MessageFlags.Ephemeral,
            });
        }
    }
}