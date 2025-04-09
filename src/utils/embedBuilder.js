// src/utils/embedBuilder.js - 임베드 생성 유틸리티
import { EmbedBuilder } from 'discord.js';
import { COLORS } from '../config/constants.js';
import { formatTime, formatKoreanDate, formatMembersList } from './formatters.js';

/**
 * 팩토리 패턴을 사용한 임베드 생성 유틸리티
 */
export class EmbedFactory {
    /**
     * 활동 데이터 임베드를 생성합니다.
     * @param {string} type - 임베드 타입 ('active' 또는 'inactive')
     * @param {Object} data - 임베드에 표시할 데이터
     * @returns {EmbedBuilder} - 생성된 임베드
     */
    static createActivityEmbed(type, data) {
        const { role, users, resetTime, minActivityTime } = data;

        // 날짜 범위 설정 (시작일: 리셋 시간, 종료일: 현재)
        const now = new Date();
        const startDate = resetTime ? new Date(resetTime) : now;

        // 날짜 형식을 YYYY.MM.DD 형태로 포맷팅
        const formatSimpleDate = (date) => {
            return `${date.getFullYear()}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getDate().toString().padStart(2, '0')}`;
        };

        const startDateStr = formatSimpleDate(startDate);
        const endDateStr = formatSimpleDate(now);

        // 임베드 생성
        const embed = new EmbedBuilder()
            .setTitle(`📊 ${role} 역할 활동 보고서 (${startDateStr} ~ ${endDateStr})`)
            .setDescription(`최소 활동 시간: ${minActivityTime}시간`)
            .addFields(
                {
                    name: `${type === 'active' ? '✅ 활동 기준 달성 멤버' : '❌ 활동 기준 미달성 멤버'} (${users.length}명)`,
                    value: '\u200B'
                }
            );

        // 테이블 형식으로 데이터 표시
        if (users.length > 0) {
            embed.addFields(
                { name: '이름', value: users.map(user => user.nickname).join('\n'), inline: true },
                { name: '총 활동 시간', value: users.map(user => formatTime(user.totalTime)).join('\n'), inline: true }
            );
        } else {
            embed.addFields(
                { name: '\u200B', value: '기록된 멤버가 없습니다.', inline: false }
            );
        }

        // 임베드 색상 설정 (활성: 초록색, 비활성: 빨간색)
        embed.setColor(type === 'active' ? COLORS.ACTIVE : COLORS.INACTIVE);

        return embed;
    }

    /**
     * 로그 메시지 임베드를 생성합니다.
     * @param {string} message - 로그 메시지
     * @param {Array<string>} members - 채널에 있는 멤버 목록
     * @returns {EmbedBuilder} - 생성된 임베드
     */
    static createLogEmbed(message, members) {
        const embed = new EmbedBuilder()
            .setColor(COLORS.LOG)
            .setDescription(`**${message}**`)
            .setFooter({
                text: `로그 기록 시간: ${formatKoreanDate(new Date())}`
            });

        // 현재 음성 채널의 인원 목록
        const membersText = formatMembersList(members);
        embed.addFields({ name: '👥 현재 남아있는 멤버', value: membersText });

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