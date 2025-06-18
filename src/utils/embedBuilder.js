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

    // 활성 사용자 임베드
    const activeEmbed = new EmbedBuilder()
      .setColor(COLORS.ACTIVE)
      .setTitle(`📊 ${cleanedRoleName} 역할 ${title} (${startDateStr} ~ ${endDateStr})`)
      .setDescription(`최소 활동 시간: ${minHours}시간\n보고서 출력 주기: ${cycleText}`);

    activeEmbed.addFields(
      {name: `✅ 활동 기준 달성 멤버 (${activeUsers.length}명)`, value: '\u200B'}
    );

    if (activeUsers.length > 0) {
      activeEmbed.addFields(
        {name: '이름', value: activeUsers.map(user => user.nickname || user.userId).join('\n'), inline: true},
        {name: '총 활동 시간', value: activeUsers.map(user => formatTime(user.totalTime)).join('\n'), inline: true}
      );
    } else {
      activeEmbed.addFields(
        {name: '\u200B', value: '기준 달성 멤버가 없습니다.', inline: false}
      );
    }

    // 비활성 사용자 임베드
    const inactiveEmbed = new EmbedBuilder()
      .setColor(COLORS.INACTIVE)
      .setTitle(`📊 ${cleanedRoleName} 역할 ${title} (${startDateStr} ~ ${endDateStr})`)
      .setDescription(`최소 활동 시간: ${minHours}시간\n보고서 출력 주기: ${cycleText}`);

    inactiveEmbed.addFields(
      {name: `❌ 활동 기준 미달성 멤버 (${inactiveUsers.length}명)`, value: '\u200B'}
    );

    if (inactiveUsers.length > 0) {
      inactiveEmbed.addFields(
        {name: '이름', value: inactiveUsers.map(user => user.nickname || user.userId).join('\n'), inline: true},
        {name: '총 활동 시간', value: inactiveUsers.map(user => formatTime(user.totalTime)).join('\n'), inline: true}
      );
    } else {
      inactiveEmbed.addFields(
        {name: '\u200B', value: '기준 미달성 멤버가 없습니다.', inline: false}
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
        {name: `💤 잠수 중인 멤버 (${afkUsers.length}명)`, value: '\u200B'}
      );

      if (afkUsers.length > 0) {
        afkEmbed.addFields(
          {name: '이름', value: afkUsers.map(user => user.nickname || user.userId).join('\n'), inline: true},
          {name: '총 활동 시간', value: afkUsers.map(user => formatTime(user.totalTime)).join('\n'), inline: true},
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

  /**
   * 구인구직 카드 임베드를 생성합니다.
   * @param {Object} jobPost - 구인구직 카드 데이터
   * @param {Object} options - 추가 옵션
   * @param {boolean} options.showButtons - 버튼 표시 여부
   * @param {VoiceChannel|null} options.voiceChannel - 음성채널 객체
   * @returns {Object} - { embed: EmbedBuilder, actionRow: ActionRowBuilder|null }
   */
  static createJobPostEmbed(jobPost, options = {}) {
    const { showButtons = false, voiceChannel = null } = options;
    
    const embed = new EmbedBuilder()
      .setColor('#5865F2') // Discord 브랜드 색상
      .setTitle(`🎯 ${jobPost.title}`)
      .setTimestamp(jobPost.createdAt);

    // 기본 정보 필드들
    const fields = [
      {
        name: '👥 모집 인원',
        value: `${jobPost.memberCount}명`,
        inline: true
      },
      {
        name: '⏰ 시작 시간',
        value: jobPost.startTime,
        inline: true
      }
    ];

    // 역할 태그가 있으면 추가
    if (jobPost.roleTags && jobPost.roleTags.trim()) {
      fields.push({
        name: '🏷️ 역할 태그',
        value: jobPost.roleTags,
        inline: true
      });
    }

    // 설명이 있으면 추가
    if (jobPost.description && jobPost.description.trim()) {
      fields.push({
        name: '📝 상세 설명',
        value: jobPost.description.length > 1024 
          ? jobPost.description.substring(0, 1021) + '...'
          : jobPost.description,
        inline: false
      });
    }

    // 음성 채널 연동 상태
    const channelStatus = jobPost.channelId 
      ? '🔗 음성채널 연동됨'
      : '🔄 음성채널 미연동';
    
    fields.push({
      name: '🎙️ 음성채널 상태',
      value: channelStatus,
      inline: true
    });

    // 만료 시간 표시
    const expiresAt = new Date(jobPost.expiresAt);
    fields.push({
      name: '⏳ 만료 시간',
      value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>`,
      inline: true
    });

    embed.addFields(fields);

    // 작성자 정보
    embed.setFooter({
      text: `작성자 ID: ${jobPost.authorId} | 카드 ID: ${jobPost.id}`
    });

    // 버튼 생성 (showButtons가 true이고 channelId가 있는 경우)
    let actionRow = null;
    if (showButtons && jobPost.channelId) {
      // JobPostButtonFactory import가 필요하지만 순환 참조 방지를 위해 여기서는 생성하지 않음
      // 대신 호출하는 곳에서 별도로 버튼을 생성하도록 함
    }

    return { embed, actionRow };
  }

  /**
   * 구인구직 카드 목록 임베드를 생성합니다.
   * @param {Array} jobPosts - 구인구직 카드 목록
   * @param {Object} options - 추가 옵션
   * @returns {EmbedBuilder} - 생성된 임베드
   */
  static createJobPostListEmbed(jobPosts, options = {}) {
    const { title = '📋 현재 활성 구인구직 목록', showExpired = false } = options;
    
    const embed = new EmbedBuilder()
      .setColor('#00D166') // 밝은 초록색
      .setTitle(title)
      .setTimestamp();

    if (jobPosts.length === 0) {
      embed.setDescription('현재 활성화된 구인구직이 없습니다.');
      return embed;
    }

    // 최대 25개 필드 제한 (Discord 제한)
    const displayJobs = jobPosts.slice(0, 25);
    
    displayJobs.forEach((job, index) => {
      const channelStatus = job.channelId ? '🔗' : '🔄';
      const expiresAt = new Date(job.expiresAt);
      const isExpired = expiresAt.getTime() <= Date.now();
      const statusIcon = isExpired ? '⏰' : '🎯';
      
      embed.addFields({
        name: `${statusIcon} ${job.title}`,
        value: [
          `👥 인원: ${job.memberCount}명`,
          `⏰ 시작: ${job.startTime}`,
          `${channelStatus} 채널 연동${job.channelId ? '됨' : ' 안됨'}`,
          `⏳ 만료: <t:${Math.floor(expiresAt.getTime() / 1000)}:R>`
        ].join('\n'),
        inline: true
      });
    });

    if (jobPosts.length > 25) {
      embed.setDescription(`총 ${jobPosts.length}개 중 25개만 표시됩니다.`);
    }

    return embed;
  }
}