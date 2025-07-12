// src/utils/embedBuilder.ts - 임베드 생성 유틸리티
import { EmbedBuilder, ColorResolvable } from 'discord.js';
import { COLORS } from '../config/constants.js';
import { formatTime, formatKoreanDate, formatMembersList, cleanRoleName } from './formatters.js';
import { formatSimpleDate } from './dateUtils.js';
import { EmbedConfig, EmbedFieldData } from '../types/discord.js';

// ====================
// 임베드 데이터 타입
// ====================

export interface ActivityEmbedData {
  role: string;
  users: UserActivityData[];
  resetTime: Date | number;
  minActivityTime: number;
}

export interface UserActivityData {
  userId: string;
  nickname?: string;
  totalTime: number;
  afkUntil?: Date | number;
  isAfk?: boolean;
}

export interface ActivityEmbedsData {
  role: string;
  activeUsers: UserActivityData[];
  inactiveUsers: UserActivityData[];
  afkUsers?: UserActivityData[];
  startDate: Date | number;
  endDate: Date | number;
  minHours: number;
  reportCycle?: number | null;
  title?: string;
}

export interface LogEmbedData {
  message: string;
  members: string[];
  colorCode?: ColorResolvable;
  timestamp?: Date;
  channelName?: string;
  action?: string;
}

export interface NotificationEmbedData {
  title: string;
  description: string;
  color?: ColorResolvable;
  timestamp?: Date;
  fields?: EmbedFieldData[];
  footer?: {
    text: string;
    iconURL?: string;
  };
  thumbnail?: string;
  image?: string;
}

export interface StatsEmbedData {
  title: string;
  description?: string;
  stats: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  color?: ColorResolvable;
  timestamp?: Date;
}

export interface ErrorEmbedData {
  error: string;
  details?: string;
  timestamp?: Date;
  command?: string;
  userId?: string;
}

// ====================
// 임베드 생성 옵션
// ====================

export interface EmbedOptions {
  includeTimestamp?: boolean;
  includeFooter?: boolean;
  maxFieldLength?: number;
  maxDescriptionLength?: number;
  truncateText?: string;
}

export interface ActivityEmbedOptions extends EmbedOptions {
  showEmptyMessage?: boolean;
  groupByStatus?: boolean;
  sortByTime?: boolean;
  includePercentage?: boolean;
}

export interface LogEmbedOptions extends EmbedOptions {
  includeMembers?: boolean;
  maxMembersShown?: number;
  showMemberCount?: boolean;
}

// ====================
// 팩토리 클래스
// ====================

/**
 * 팩토리 패턴을 사용한 임베드 생성 유틸리티
 */
export class EmbedFactory {
  private static readonly DEFAULT_OPTIONS: EmbedOptions = {
    includeTimestamp: true,
    includeFooter: true,
    maxFieldLength: 1024,
    maxDescriptionLength: 4096,
    truncateText: '...'
  };

  /**
   * 활동 데이터 임베드를 생성합니다.
   * @param type - 임베드 타입 ('active' 또는 'inactive')
   * @param data - 임베드에 표시할 데이터
   * @param options - 임베드 옵션
   * @returns 생성된 임베드
   */
  static createActivityEmbed(
    type: 'active' | 'inactive',
    data: ActivityEmbedData,
    options: ActivityEmbedOptions = {}
  ): EmbedBuilder {
    const { role, users, resetTime, minActivityTime } = data;
    const opts = { ...this.DEFAULT_OPTIONS, ...options };

    // 날짜 범위 설정 (시작일: 리셋 시간, 종료일: 현재)
    const now = new Date();
    const startDate = resetTime instanceof Date ? resetTime : new Date(resetTime);

    const startDateStr = formatSimpleDate(startDate);
    const endDateStr = formatSimpleDate(now);

    // 사용자 목록 정렬
    const sortedUsers = opts.sortByTime 
      ? [...users].sort((a, b) => b.totalTime - a.totalTime)
      : users;

    // 임베드 생성
    const embed = new EmbedBuilder()
      .setTitle(`📊 ${cleanRoleName(role)} 역할 활동 보고서 (${startDateStr} ~ ${endDateStr})`)
      .setDescription(`최소 활동 시간: ${minActivityTime}시간`)
      .setColor(type === 'active' ? COLORS.ACTIVE : COLORS.INACTIVE);

    // 상태별 헤더 추가
    const statusEmoji = type === 'active' ? '✅' : '❌';
    const statusText = type === 'active' ? '활동 기준 달성 멤버' : '활동 기준 미달성 멤버';
    
    embed.addFields({
      name: `${statusEmoji} ${statusText} (${sortedUsers.length}명)`,
      value: '\u200B'
    });

    // 데이터 표시
    if (sortedUsers.length > 0) {
      const names = sortedUsers.map(user => user.nickname || user.userId);
      const times = sortedUsers.map(user => formatTime(user.totalTime));
      
      // 필드 길이 제한 적용
      const nameField = this.limitFieldLength(names.join('\n'), opts.maxFieldLength!, opts.truncateText!);
      const timeField = this.limitFieldLength(times.join('\n'), opts.maxFieldLength!, opts.truncateText!);
      
      embed.addFields(
        { name: '이름', value: nameField, inline: true },
        { name: '총 활동 시간', value: timeField, inline: true }
      );
    } else if (opts.showEmptyMessage !== false) {
      embed.addFields({
        name: '\u200B',
        value: '기록된 멤버가 없습니다.',
        inline: false
      });
    }

    // 타임스탬프 추가
    if (opts.includeTimestamp) {
      embed.setTimestamp();
    }

    return embed;
  }

  /**
   * 활동 데이터 임베드 세트를 생성합니다.
   * @param data - 임베드 데이터
   * @param options - 임베드 옵션
   * @returns 생성된 임베드 배열
   */
  static createActivityEmbeds(
    data: ActivityEmbedsData,
    options: ActivityEmbedOptions = {}
  ): EmbedBuilder[] {
    const {
      role,
      activeUsers,
      inactiveUsers,
      afkUsers = [],
      startDate,
      endDate,
      minHours,
      reportCycle = null,
      title = '활동 목록'
    } = data;

    const opts = { ...this.DEFAULT_OPTIONS, ...options };

    // 날짜 문자열 생성
    const startDateObj = startDate instanceof Date ? startDate : new Date(startDate);
    const endDateObj = endDate instanceof Date ? endDate : new Date(endDate);

    const startDateStr = formatSimpleDate(startDateObj);
    const endDateStr = formatSimpleDate(endDateObj);
    const cleanedRoleName = cleanRoleName(role);

    // 주기 텍스트 생성
    const cycleText = this.formatReportCycle(reportCycle);

    // 기본 설명
    const description = `최소 활동 시간: ${minHours}시간\n보고서 출력 주기: ${cycleText}`;

    // 활성 사용자 임베드
    const activeEmbed = this.createUserListEmbed({
      title: `📊 ${cleanedRoleName} 역할 ${title} (${startDateStr} ~ ${endDateStr})`,
      description,
      users: activeUsers,
      color: COLORS.ACTIVE,
      statusEmoji: '✅',
      statusText: '활동 기준 달성 멤버',
      emptyMessage: '기준 달성 멤버가 없습니다.',
      options: opts
    });

    // 비활성 사용자 임베드
    const inactiveEmbed = this.createUserListEmbed({
      title: `📊 ${cleanedRoleName} 역할 ${title} (${startDateStr} ~ ${endDateStr})`,
      description,
      users: inactiveUsers,
      color: COLORS.INACTIVE,
      statusEmoji: '❌',
      statusText: '활동 기준 미달성 멤버',
      emptyMessage: '기준 미달성 멤버가 없습니다.',
      options: opts
    });

    const embeds = [activeEmbed, inactiveEmbed];

    // 잠수 사용자가 있을 경우에만 잠수 임베드 추가
    if (afkUsers && afkUsers.length > 0) {
      const afkEmbed = this.createAfkUserEmbed({
        title: `📊 ${cleanedRoleName} 역할 ${title} (${startDateStr} ~ ${endDateStr})`,
        description,
        users: afkUsers,
        options: opts
      });

      embeds.push(afkEmbed);
    }

    return embeds;
  }

  /**
   * 로그 메시지 임베드를 생성합니다.
   * @param data - 로그 데이터
   * @param options - 임베드 옵션
   * @returns 생성된 임베드
   */
  static createLogEmbed(
    data: LogEmbedData,
    options: LogEmbedOptions = {}
  ): EmbedBuilder {
    const {
      message,
      members,
      colorCode = COLORS.LOG,
      timestamp = new Date(),
      channelName,
      action
    } = data;

    const opts = { ...this.DEFAULT_OPTIONS, ...options };

    const embed = new EmbedBuilder()
      .setColor(colorCode)
      .setDescription(`**${message}**`);

    // 추가 정보 필드
    if (channelName) {
      embed.addFields({ name: '채널', value: channelName, inline: true });
    }

    if (action) {
      embed.addFields({ name: '동작', value: action, inline: true });
    }

    // 현재 음성 채널의 인원 목록
    if (opts.includeMembers !== false) {
      const membersToShow = opts.maxMembersShown 
        ? members.slice(0, opts.maxMembersShown)
        : members;

      const membersText = formatMembersList(membersToShow, {
        showCount: opts.showMemberCount !== false,
        maxLength: opts.maxFieldLength
      });

      embed.addFields({
        name: '👥 현재 남아있는 멤버',
        value: membersText
      });

      // 더 많은 멤버가 있는 경우 알림
      if (opts.maxMembersShown && members.length > opts.maxMembersShown) {
        embed.addFields({
          name: '\u200B',
          value: `외 ${members.length - opts.maxMembersShown}명 더...`,
          inline: false
        });
      }
    }

    // 푸터 추가
    if (opts.includeFooter) {
      embed.setFooter({
        text: `로그 기록 시간: ${formatKoreanDate(timestamp)}`
      });
    }

    // 타임스탬프 추가
    if (opts.includeTimestamp) {
      embed.setTimestamp(timestamp);
    }

    return embed;
  }

  /**
   * 단순 알림 임베드를 생성합니다.
   * @param data - 알림 데이터
   * @param options - 임베드 옵션
   * @returns 생성된 임베드
   */
  static createNotificationEmbed(
    data: NotificationEmbedData,
    options: EmbedOptions = {}
  ): EmbedBuilder {
    const {
      title,
      description,
      color = COLORS.LOG,
      timestamp = new Date(),
      fields = [],
      footer,
      thumbnail,
      image
    } = data;

    const opts = { ...this.DEFAULT_OPTIONS, ...options };

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title);

    // 설명 길이 제한
    const limitedDescription = this.limitFieldLength(
      description,
      opts.maxDescriptionLength!,
      opts.truncateText!
    );
    embed.setDescription(limitedDescription);

    // 필드 추가
    if (fields.length > 0) {
      const limitedFields = fields.map(field => ({
        ...field,
        value: this.limitFieldLength(field.value, opts.maxFieldLength!, opts.truncateText!)
      }));
      embed.addFields(limitedFields);
    }

    // 썸네일 및 이미지
    if (thumbnail) {
      embed.setThumbnail(thumbnail);
    }

    if (image) {
      embed.setImage(image);
    }

    // 푸터
    if (footer) {
      embed.setFooter(footer);
    }

    // 타임스탬프
    if (opts.includeTimestamp) {
      embed.setTimestamp(timestamp);
    }

    return embed;
  }

  /**
   * 통계 임베드를 생성합니다.
   * @param data - 통계 데이터
   * @param options - 임베드 옵션
   * @returns 생성된 임베드
   */
  static createStatsEmbed(
    data: StatsEmbedData,
    options: EmbedOptions = {}
  ): EmbedBuilder {
    const {
      title,
      description,
      stats,
      color = COLORS.INFO,
      timestamp = new Date()
    } = data;

    const opts = { ...this.DEFAULT_OPTIONS, ...options };

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title);

    if (description) {
      embed.setDescription(description);
    }

    // 통계 필드 추가
    const limitedStats = stats.map(stat => ({
      ...stat,
      value: this.limitFieldLength(stat.value, opts.maxFieldLength!, opts.truncateText!)
    }));

    embed.addFields(limitedStats);

    if (opts.includeTimestamp) {
      embed.setTimestamp(timestamp);
    }

    return embed;
  }

  /**
   * 오류 임베드를 생성합니다.
   * @param data - 오류 데이터
   * @param options - 임베드 옵션
   * @returns 생성된 임베드
   */
  static createErrorEmbed(
    data: ErrorEmbedData,
    options: EmbedOptions = {}
  ): EmbedBuilder {
    const {
      error,
      details,
      timestamp = new Date(),
      command,
      userId
    } = data;

    const opts = { ...this.DEFAULT_OPTIONS, ...options };

    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle('❌ 오류 발생')
      .setDescription(error);

    // 추가 정보
    if (details) {
      embed.addFields({
        name: '세부 정보',
        value: this.limitFieldLength(details, opts.maxFieldLength!, opts.truncateText!)
      });
    }

    if (command) {
      embed.addFields({ name: '명령어', value: command, inline: true });
    }

    if (userId) {
      embed.addFields({ name: '사용자', value: `<@${userId}>`, inline: true });
    }

    if (opts.includeTimestamp) {
      embed.setTimestamp(timestamp);
    }

    return embed;
  }

  /**
   * 성공 임베드를 생성합니다.
   * @param title - 제목
   * @param description - 설명
   * @param options - 임베드 옵션
   * @returns 생성된 임베드
   */
  static createSuccessEmbed(
    title: string,
    description: string,
    options: EmbedOptions = {}
  ): EmbedBuilder {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };

    const embed = new EmbedBuilder()
      .setColor(COLORS.SUCCESS)
      .setTitle(`✅ ${title}`)
      .setDescription(description);

    if (opts.includeTimestamp) {
      embed.setTimestamp();
    }

    return embed;
  }

  /**
   * 경고 임베드를 생성합니다.
   * @param title - 제목
   * @param description - 설명
   * @param options - 임베드 옵션
   * @returns 생성된 임베드
   */
  static createWarningEmbed(
    title: string,
    description: string,
    options: EmbedOptions = {}
  ): EmbedBuilder {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };

    const embed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle(`⚠️ ${title}`)
      .setDescription(description);

    if (opts.includeTimestamp) {
      embed.setTimestamp();
    }

    return embed;
  }

  /**
   * 정보 임베드를 생성합니다.
   * @param title - 제목
   * @param description - 설명
   * @param options - 임베드 옵션
   * @returns 생성된 임베드
   */
  static createInfoEmbed(
    title: string,
    description: string,
    options: EmbedOptions = {}
  ): EmbedBuilder {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };

    const embed = new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle(`ℹ️ ${title}`)
      .setDescription(description);

    if (opts.includeTimestamp) {
      embed.setTimestamp();
    }

    return embed;
  }

  // ====================
  // 헬퍼 메서드
  // ====================

  /**
   * 사용자 목록 임베드를 생성합니다.
   * @param params - 임베드 생성 파라미터
   * @returns 생성된 임베드
   */
  private static createUserListEmbed(params: {
    title: string;
    description: string;
    users: UserActivityData[];
    color: ColorResolvable;
    statusEmoji: string;
    statusText: string;
    emptyMessage: string;
    options: ActivityEmbedOptions;
  }): EmbedBuilder {
    const { title, description, users, color, statusEmoji, statusText, emptyMessage, options } = params;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description);

    // 사용자 정렬
    const sortedUsers = options.sortByTime 
      ? [...users].sort((a, b) => b.totalTime - a.totalTime)
      : users;

    embed.addFields({
      name: `${statusEmoji} ${statusText} (${sortedUsers.length}명)`,
      value: '\u200B'
    });

    if (sortedUsers.length > 0) {
      const names = sortedUsers.map(user => user.nickname || user.userId);
      const times = sortedUsers.map(user => formatTime(user.totalTime));
      
      embed.addFields(
        { 
          name: '이름', 
          value: this.limitFieldLength(names.join('\n'), options.maxFieldLength!, options.truncateText!), 
          inline: true 
        },
        { 
          name: '총 활동 시간', 
          value: this.limitFieldLength(times.join('\n'), options.maxFieldLength!, options.truncateText!), 
          inline: true 
        }
      );
    } else if (options.showEmptyMessage !== false) {
      embed.addFields({
        name: '\u200B',
        value: emptyMessage,
        inline: false
      });
    }

    if (options.includeTimestamp) {
      embed.setTimestamp();
    }

    return embed;
  }

  /**
   * 잠수 사용자 임베드를 생성합니다.
   * @param params - 임베드 생성 파라미터
   * @returns 생성된 임베드
   */
  private static createAfkUserEmbed(params: {
    title: string;
    description: string;
    users: UserActivityData[];
    options: ActivityEmbedOptions;
  }): EmbedBuilder {
    const { title, description, users, options } = params;

    const embed = new EmbedBuilder()
      .setColor(COLORS.SLEEP)
      .setTitle(title)
      .setDescription(description);

    embed.addFields({
      name: `💤 잠수 중인 멤버 (${users.length}명)`,
      value: '\u200B'
    });

    if (users.length > 0) {
      const names = users.map(user => user.nickname || user.userId);
      const times = users.map(user => formatTime(user.totalTime));
      const afkUntilDates = users.map(user => 
        formatSimpleDate(new Date(user.afkUntil || Date.now()))
      );
      
      embed.addFields(
        { 
          name: '이름', 
          value: this.limitFieldLength(names.join('\n'), options.maxFieldLength!, options.truncateText!), 
          inline: true 
        },
        { 
          name: '총 활동 시간', 
          value: this.limitFieldLength(times.join('\n'), options.maxFieldLength!, options.truncateText!), 
          inline: true 
        },
        {
          name: '잠수 해제 예정일',
          value: this.limitFieldLength(afkUntilDates.join('\n'), options.maxFieldLength!, options.truncateText!),
          inline: true
        }
      );
    }

    if (options.includeTimestamp) {
      embed.setTimestamp();
    }

    return embed;
  }

  /**
   * 보고서 주기를 포맷팅합니다.
   * @param cycle - 주기
   * @returns 포맷팅된 주기 텍스트
   */
  private static formatReportCycle(cycle: number | null): string {
    if (!cycle) return 'X';

    switch (cycle) {
      case 1:
        return '매주';
      case 2:
        return '격주';
      case 4:
        return '월간';
      default:
        return `${cycle}주마다`;
    }
  }

  /**
   * 필드 길이를 제한합니다.
   * @param text - 텍스트
   * @param maxLength - 최대 길이
   * @param truncateText - 잘림 표시 텍스트
   * @returns 제한된 텍스트
   */
  private static limitFieldLength(text: string, maxLength: number, truncateText: string): string {
    if (text.length <= maxLength) {
      return text;
    }

    return text.substring(0, maxLength - truncateText.length) + truncateText;
  }

  /**
   * 기본 임베드 구성을 생성합니다.
   * @param config - 임베드 구성
   * @returns 생성된 임베드
   */
  static createFromConfig(config: EmbedConfig): EmbedBuilder {
    const embed = new EmbedBuilder();

    if (config.title) embed.setTitle(config.title);
    if (config.description) embed.setDescription(config.description);
    if (config.color) embed.setColor(config.color);
    if (config.thumbnail) embed.setThumbnail(config.thumbnail);
    if (config.image) embed.setImage(config.image);
    if (config.timestamp) embed.setTimestamp(config.timestamp);
    if (config.footer) embed.setFooter(config.footer);
    if (config.author) embed.setAuthor(config.author);
    if (config.fields) embed.addFields(config.fields);

    return embed;
  }
}

// ====================
// 유틸리티 함수
// ====================

/**
 * 임베드 배열을 청크로 나눕니다.
 * @param embeds - 임베드 배열
 * @param chunkSize - 청크 크기
 * @returns 청크된 임베드 배열
 */
export function chunkEmbeds(embeds: EmbedBuilder[], chunkSize: number = 10): EmbedBuilder[][] {
  const chunks: EmbedBuilder[][] = [];
  
  for (let i = 0; i < embeds.length; i += chunkSize) {
    chunks.push(embeds.slice(i, i + chunkSize));
  }
  
  return chunks;
}

/**
 * 임베드의 총 문자 수를 계산합니다.
 * @param embed - 임베드
 * @returns 총 문자 수
 */
export function calculateEmbedLength(embed: EmbedBuilder): number {
  const data = embed.toJSON();
  let length = 0;
  
  if (data.title) length += data.title.length;
  if (data.description) length += data.description.length;
  if (data.footer?.text) length += data.footer.text.length;
  if (data.author?.name) length += data.author.name.length;
  
  if (data.fields) {
    for (const field of data.fields) {
      length += field.name.length + field.value.length;
    }
  }
  
  return length;
}

/**
 * 임베드가 Discord 제한을 초과하는지 확인합니다.
 * @param embed - 임베드
 * @returns 제한 초과 여부
 */
export function isEmbedOverLimit(embed: EmbedBuilder): boolean {
  const data = embed.toJSON();
  const totalLength = calculateEmbedLength(embed);
  
  if (totalLength > 6000) return true;
  if (data.title && data.title.length > 256) return true;
  if (data.description && data.description.length > 4096) return true;
  if (data.fields && data.fields.length > 25) return true;
  if (data.footer?.text && data.footer.text.length > 2048) return true;
  if (data.author?.name && data.author.name.length > 256) return true;
  
  if (data.fields) {
    for (const field of data.fields) {
      if (field.name.length > 256) return true;
      if (field.value.length > 1024) return true;
    }
  }
  
  return false;
}

/**
 * 임베드를 안전하게 생성합니다 (제한 검사 포함).
 * @param createFn - 임베드 생성 함수
 * @returns 생성된 임베드 또는 오류 임베드
 */
export function safeEmbedCreate(createFn: () => EmbedBuilder): EmbedBuilder {
  try {
    const embed = createFn();
    
    if (isEmbedOverLimit(embed)) {
      return EmbedFactory.createErrorEmbed({
        error: '임베드 생성 오류',
        details: '임베드가 Discord 제한을 초과했습니다.'
      });
    }
    
    return embed;
  } catch (error) {
    return EmbedFactory.createErrorEmbed({
      error: '임베드 생성 오류',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}