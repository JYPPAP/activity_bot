// src/utils/embedBuilder.js - 임베드 생성 유틸리티
import {EmbedBuilder} from 'discord.js';
import {COLORS} from '../config/constants.js';
import {formatTime, formatKoreanDate, formatMembersList, cleanRoleName} from './formatters.js';
import {formatSimpleDate} from './dateUtils.js';

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
    const {role, users, resetTime, minActivityTime} = data;

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
        {name: '이름', value: users.map(user => user.nickname).join('\n'), inline: true},
        {name: '총 활동 시간', value: users.map(user => formatTime(user.totalTime)).join('\n'), inline: true}
      );
    } else {
      embed.addFields(
        {name: '\u200B', value: '기록된 멤버가 없습니다.', inline: false}
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
      switch (reportCycle) {
      case 1:
        cycleText = '매주';
        break;
      case 2:
        cycleText = '격주';
        break;
      case 4:
        cycleText = '월간';
        break;
      default:
        cycleText = `${reportCycle}주마다`;
      }
    }

    const embeds = [];

    // 활성 사용자 페이지 생성
    const activeEmbeds = this.createUserPageEmbeds(
      activeUsers, 
      cleanedRoleName, 
      title, 
      startDateStr, 
      endDateStr, 
      minHours, 
      cycleText,
      '✅ 활동 기준 달성 멤버',
      COLORS.ACTIVE,
      '기준 달성 멤버가 없습니다.'
    );
    embeds.push(...activeEmbeds);

    // 비활성 사용자 페이지 생성
    const inactiveEmbeds = this.createUserPageEmbeds(
      inactiveUsers, 
      cleanedRoleName, 
      title, 
      startDateStr, 
      endDateStr, 
      minHours, 
      cycleText,
      '❌ 활동 기준 미달성 멤버',
      COLORS.INACTIVE,
      '기준 미달성 멤버가 없습니다.'
    );
    embeds.push(...inactiveEmbeds);

    // 잠수 사용자가 있을 경우에만 잠수 임베드 추가
    if (afkUsers && afkUsers.length > 0) {
      const afkEmbeds = this.createAfkUserPageEmbeds(
        afkUsers, 
        cleanedRoleName, 
        title, 
        startDateStr, 
        endDateStr, 
        minHours, 
        cycleText
      );
      embeds.push(...afkEmbeds);
    }

    return embeds;
  }

  /**
   * 사용자 목록을 페이지별로 분할하여 임베드 생성
   * @param {Array} users - 사용자 배열
   * @param {string} roleName - 역할 이름
   * @param {string} title - 제목
   * @param {string} startDateStr - 시작 날짜 문자열
   * @param {string} endDateStr - 종료 날짜 문자열
   * @param {number} minHours - 최소 시간
   * @param {string} cycleText - 주기 텍스트
   * @param {string} categoryName - 카테고리 이름
   * @param {string} color - 색상
   * @param {string} emptyMessage - 빈 메시지
   * @returns {Array<EmbedBuilder>} - 페이지별 임베드 배열
   */
  static createUserPageEmbeds(users, roleName, title, startDateStr, endDateStr, minHours, cycleText, categoryName, color, emptyMessage) {
    const embeds = [];
    
    if (users.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`📊 ${roleName} 역할 ${title} (${startDateStr} ~ ${endDateStr})`)
        .setDescription(`최소 활동 시간: ${minHours}시간\n보고서 출력 주기: ${cycleText}`)
        .addFields(
          {name: `${categoryName} (0명)`, value: '\u200B'},
          {name: '\u200B', value: emptyMessage, inline: false}
        );
      embeds.push(embed);
      return embeds;
    }

    // 사용자를 페이지별로 분할
    const userPages = this.splitUsersIntoPages(users, 900); // 900자로 제한하여 안전 마진 확보

    userPages.forEach((pageUsers, pageIndex) => {
      const pageInfo = userPages.length > 1 ? ` (${pageIndex + 1}/${userPages.length} 페이지)` : '';
      
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`📊 ${roleName} 역할 ${title} (${startDateStr} ~ ${endDateStr})`)
        .setDescription(`최소 활동 시간: ${minHours}시간\n보고서 출력 주기: ${cycleText}`)
        .addFields(
          {name: `${categoryName} (${users.length}명)${pageInfo}`, value: '\u200B'}
        );

      if (pageUsers.length > 0) {
        const names = pageUsers.map(user => user.nickname || user.userId).join('\n');
        const times = pageUsers.map(user => formatTime(user.totalTime)).join('\n');
        
        embed.addFields(
          {name: '이름', value: names, inline: true},
          {name: '총 활동 시간', value: times, inline: true}
        );
      }

      embeds.push(embed);
    });

    return embeds;
  }

  /**
   * 잠수 사용자 목록을 페이지별로 분할하여 임베드 생성
   * @param {Array} afkUsers - 잠수 사용자 배열
   * @param {string} roleName - 역할 이름
   * @param {string} title - 제목
   * @param {string} startDateStr - 시작 날짜 문자열
   * @param {string} endDateStr - 종료 날짜 문자열
   * @param {number} minHours - 최소 시간
   * @param {string} cycleText - 주기 텍스트
   * @returns {Array<EmbedBuilder>} - 페이지별 임베드 배열
   */
  static createAfkUserPageEmbeds(afkUsers, roleName, title, startDateStr, endDateStr, minHours, cycleText) {
    const embeds = [];
    
    // 잠수 사용자를 페이지별로 분할 (3개 필드이므로 더 작게)
    const userPages = this.splitUsersIntoPages(afkUsers, 600);

    userPages.forEach((pageUsers, pageIndex) => {
      const pageInfo = userPages.length > 1 ? ` (${pageIndex + 1}/${userPages.length} 페이지)` : '';
      
      const embed = new EmbedBuilder()
        .setColor(COLORS.SLEEP)
        .setTitle(`📊 ${roleName} 역할 ${title} (${startDateStr} ~ ${endDateStr})`)
        .setDescription(`최소 활동 시간: ${minHours}시간\n보고서 출력 주기: ${cycleText}`)
        .addFields(
          {name: `💤 잠수 중인 멤버 (${afkUsers.length}명)${pageInfo}`, value: '\u200B'}
        );

      if (pageUsers.length > 0) {
        const names = pageUsers.map(user => user.nickname || user.userId).join('\n');
        const times = pageUsers.map(user => formatTime(user.totalTime)).join('\n');
        const dates = pageUsers.map(user => formatSimpleDate(new Date(user.afkUntil || Date.now()))).join('\n');
        
        embed.addFields(
          {name: '이름', value: names, inline: true},
          {name: '총 활동 시간', value: times, inline: true},
          {name: '잠수 해제 예정일', value: dates, inline: true}
        );
      }

      embeds.push(embed);
    });

    return embeds;
  }

  /**
   * 사용자 배열을 페이지별로 분할
   * @param {Array} users - 사용자 배열
   * @param {number} maxFieldLength - 필드 최대 길이
   * @returns {Array<Array>} - 페이지별로 분할된 사용자 배열
   */
  static splitUsersIntoPages(users, maxFieldLength = 900) {
    const pages = [];
    let currentPage = [];
    let currentLength = 0;
    
    for (const user of users) {
      const nickname = user.nickname || user.userId;
      const timeStr = formatTime(user.totalTime);
      const userLineLength = nickname.length + timeStr.length + 2; // +2 for newlines
      
      if (currentLength + userLineLength > maxFieldLength && currentPage.length > 0) {
        pages.push([...currentPage]);
        currentPage = [user];
        currentLength = userLineLength;
      } else {
        currentPage.push(user);
        currentLength += userLineLength;
      }
    }
    
    if (currentPage.length > 0) {
      pages.push(currentPage);
    }
    
    return pages.length > 0 ? pages : [[]];
  }

  /**
   * 로그 메시지 임베드를 생성합니다.
   * @param {string} message - 로그 메시지
   * @param {Array<string>} members - 채널에 있는 멤버 목록
   * @param {string} colorCode - 임베드 색상 코드 (선택사항, 기본값: COLORS.LOG)
   * @returns {EmbedBuilder} - 생성된 임베드
   */
  static createLogEmbed(message, members, colorCode = COLORS.LOG) {
    const embed = new EmbedBuilder()
      .setColor(colorCode)
      .setDescription(`**${message}**`)
      .setFooter({
        text: `로그 기록 시간: ${formatKoreanDate(new Date())}`
      });

    // 현재 음성 채널의 인원 목록
    const membersText = formatMembersList(members);
    embed.addFields({name: '👥 현재 남아있는 멤버', value: membersText});

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