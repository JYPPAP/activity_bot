// src/utils/embedBuilder.js - 임베드 생성 유틸리티
import { EmbedBuilder } from 'discord.js';
import { COLORS, MESSAGE_TYPES } from '../config/constants.js'; // MESSAGE_TYPES 추가
import { formatTime, formatKoreanDate, formatMembersList } from './formatters.js';

/**
 * 팩토리 패턴을 사용한 임베드 생성 유틸리티
 */
export class EmbedFactory {
    /**
     * 활동 데이터 임베드를 생성합니다.
     * @param {string} type - 임베드 타입 ('active' 또는 'inactive')
     * @param {Object} data - 임베드에 표시할
     * @returns {EmbedBuilder} - 생성된 임베드
     */
    static createActivityEmbed(type, data) {
        const { role, users, resetTime, minActivityTime } = data;
        const resetTimeFormatted = resetTime ? formatKoreanDate(resetTime) : 'N/A';

        const embed = new EmbedBuilder()
            .setTitle(`📊 활동 데이터 (역할: ${role})`)
            .setDescription(`마지막 리셋 시간: ${resetTimeFormatted}\n지정된 최소 활동 시간: ${minActivityTime}시간`)
            .addFields(
                { name: '상태', value: type === 'active' ? '달성' : '부족', inline: true },
                {
                    name: '이름',
                    value: users.map(user => user.nickname).join('\n') || '없음',
                    inline: true
                },
                {
                    name: '총 활동 시간',
                    value: users.map(user => formatTime(user.totalTime)).join('\n') || '없음',
                    inline: true
                }
            );

        // 임베드 색상 설정
        embed.setColor(type === 'active' ? COLORS.ACTIVE : COLORS.INACTIVE);

        return embed;
    }

    /**
     * 로그 메시지 임베드를 생성합니다.
     * @param {string} message - 로그 메시지
     * @param {Array<string>} members - 채널에 있는 멤버 목록
     * @param {string} color - 임베드 색상 (hex 코드)
     * @returns {EmbedBuilder} - 생성된 임베드
     */
    static createLogEmbed(message, members, color = COLORS.LOG) {
        const embed = new EmbedBuilder()
            .setColor(color)
            .setDescription(`**${message}**`)
            .setFooter({
                text: `로그 기록 시간: ${formatKoreanDate(new Date())}`
            });

        // 채널 생성 메시지일 경우 멤버 목록을 표시하지 않음
        if (!message.includes(MESSAGE_TYPES.CHANNEL_CREATE)) {
            // 현재 음성 채널의 인원 목록
            const membersText = members.length > 0
                ? `**현재 멤버 (${members.length}명):**\n${members.map(m => `\`${m}\``).join(' ')}`
                : `**현재 멤버 (0명)**`;

            embed.addFields({ name: '\u200B', value: membersText });
        }

        return embed;
    }

    /**
     * 단순 알림 임베드를 생성합니다.
     * @param {string} title - 임베드 제목
     * @param {string} description - 임베드 설명
     * @param {string} color - 임베드 색상 (hex 코드)
     * @returns {EmbedBuilder} - 생성된 임베드
     */
    static createNotificationEmbed(title, description, color = COLORS.LOG) {
        return new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(description)
            .setTimestamp();
    }
}