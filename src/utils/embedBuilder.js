// src/utils/embedBuilder.js - 임베드 생성 유틸리티
import { EmbedBuilder } from 'discord.js';
import { COLORS } from '../config/constants.js';
import { formatTime, formatKoreanDate, formatMembersList, cleanRoleName } from './formatters.js';
import { formatSimpleDate } from './dateUtils.js';

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

        const startDateStr = formatSimpleDate(startDate);
        const endDateStr = formatSimpleDate(now);

        // 임베드 생성
        const embed = new EmbedBuilder()
            .setTitle(`📊 ${cleanRoleName(role)} 역할 활동 보고서 (${startDateStr} ~ ${endDateStr})`)
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
     * 활동 데이터 임베드 세트를 생성합니다.
     * @param {string} role - 역할 이름
     * @param {Array<Object>} activeUsers - 활성 사용자 목록
     * @param {Array<Object>} inactiveUsers - 비활성 사용자 목록
     * @param {Array<Object>} afkUsers - 잠수 사용자 목록
     * @param {number|Date} startDate - 시작 날짜/시간
     * @param {number|Date} endDate - 종료 날짜/시간
     * @param {number} minHours - 최소 활동 시간(시)
     * @param {number|null} reportCycle - 보고서 출력 주기 (선택적)
     * @param {string} title - 임베드 제목 (선택적)
     * @returns {Array<EmbedBuilder>} - 생성된 임베드 배열
     */
    static createActivityEmbeds(role, activeUsers, inactiveUsers, afkUsers, startDate, endDate, minHours, reportCycle = null, title = '활동 목록') {
        // 날짜 문자열 생성
        const startDateObj = startDate instanceof Date ? startDate : new Date(startDate);
        const endDateObj = endDate instanceof Date ? endDate : new Date(endDate);

        const startDateStr = formatSimpleDate(startDateObj);
        const endDateStr = formatSimpleDate(endDateObj);
        const cleanedRoleName = cleanRoleName(role);

        // 주기 텍스트 생성
        let cycleText = 'X';
        if (reportCycle) {
            switch(reportCycle) {
                case 1: cycleText = '매주'; break;
                case 2: cycleText = '격주'; break;
                case 4: cycleText = '월간'; break;
                default: cycleText = `${reportCycle}주마다`;
            }
        }

        // 활성 사용자 임베드
        const activeEmbed = new EmbedBuilder()
            .setColor(COLORS.ACTIVE)
            .setTitle(`📊 ${cleanedRoleName} 역할 ${title} (${startDateStr} ~ ${endDateStr})`)
            .setDescription(`최소 활동 시간: ${minHours}시간\n보고서 출력 주기: ${cycleText}`);

        activeEmbed.addFields(
            { name: `✅ 활동 기준 달성 멤버 (${activeUsers.length}명)`, value: '\u200B' }
        );

        if (activeUsers.length > 0) {
            activeEmbed.addFields(
                { name: '이름', value: activeUsers.map(user => user.nickname || user.userId).join('\n'), inline: true },
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
            .setTitle(`📊 ${cleanedRoleName} 역할 ${title} (${startDateStr} ~ ${endDateStr})`)
            .setDescription(`최소 활동 시간: ${minHours}시간\n보고서 출력 주기: ${cycleText}`);

        inactiveEmbed.addFields(
            { name: `❌ 활동 기준 미달성 멤버 (${inactiveUsers.length}명)`, value: '\u200B' }
        );

        if (inactiveUsers.length > 0) {
            inactiveEmbed.addFields(
                { name: '이름', value: inactiveUsers.map(user => user.nickname || user.userId).join('\n'), inline: true },
                { name: '총 활동 시간', value: inactiveUsers.map(user => formatTime(user.totalTime)).join('\n'), inline: true }
            );
        } else {
            inactiveEmbed.addFields(
                { name: '\u200B', value: '기준 미달성 멤버가 없습니다.', inline: false }
            );
        }

        // 여기서 embeds 배열을 초기화해야 합니다!
        const embeds = [activeEmbed, inactiveEmbed];

        // 잠수 사용자가 있을 경우에만 잠수 임베드 추가
        if (afkUsers && afkUsers.length > 0) {
            // 잠수 사용자 임베드
            const afkEmbed = new EmbedBuilder()
                .setColor(COLORS.SLEEP)
                .setTitle(`📊 ${cleanedRoleName} 역할 ${title} (${startDateStr} ~ ${endDateStr})`)
                .setDescription(`최소 활동 시간: ${minHours}시간\n보고서 출력 주기: ${cycleText}`);

            afkEmbed.addFields(
                { name: `💤 잠수 중인 멤버 (${afkUsers.length}명)`, value: '\u200B' }
            );

            if (afkUsers.length > 0) {
                afkEmbed.addFields(
                    { name: '이름', value: afkUsers.map(user => user.nickname || user.userId).join('\n'), inline: true },
                    { name: '총 활동 시간', value: afkUsers.map(user => formatTime(user.totalTime)).join('\n'), inline: true },
                    {
                        name: '잠수 해제 예정일',
                        value: afkUsers.map(user => formatSimpleDate(new Date(user.afkUntil || Date.now()))).join('\n'),
                        inline: true
                    }
                );
            }

            // 잠수 임베드 추가
            embeds.push(afkEmbed);
        }

        return embeds;
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