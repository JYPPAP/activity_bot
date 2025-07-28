// src/utils/TextProcessor.ts - 텍스트 처리 유틸리티
import { Guild, Role } from 'discord.js';

import { LIMITS, REGEX } from '../config/constants.js';
import { DiscordConstants } from '../config/DiscordConstants.js';

// ====================
// 텍스트 처리 옵션 타입
// ====================

export interface NicknameCleanOptions {
  removeWaitTag?: boolean;
  removeSpectateTag?: boolean;
  removeCustomTags?: string[];
  preserveCase?: boolean;
}

export interface TagConversionOptions {
  fallbackToBold?: boolean;
  caseSensitive?: boolean;
  exactMatch?: boolean;
  includeRoleColor?: boolean;
}

export interface ParticipantFormatOptions {
  includeNumbers?: boolean;
  separator?: string;
  maxLength?: number;
  truncateText?: string;
}

export interface TextTruncateOptions {
  suffix?: string;
  preserveWords?: boolean;
  maxLines?: number;
}

export interface TimeFormatOptions {
  timeZone?: string;
  locale?: string;
  includeSeconds?: boolean;
  includeDate?: boolean;
  format?: 'short' | 'medium' | 'long' | 'full';
}

export interface MarkdownOptions {
  level?: number;
  style?: 'header' | 'bold' | 'italic' | 'code' | 'quote';
  escape?: boolean;
}

// ====================
// 검증 결과 타입
// ====================

export interface SpecialTagsResult {
  hasWaitTag: boolean;
  hasSpectateTag: boolean;
  hasCustomTags: boolean;
  foundTags: string[];
  cleanedText: string;
}

export interface TextValidationResult {
  isValid: boolean;
  length: number;
  exceedsLimit: boolean;
  limitType?: string;
  suggestions?: string[];
}

export interface RoleMentionResult {
  success: boolean;
  mentions: string[];
  notFound: string[];
  errors: string[];
}

// ====================
// 참여자 데이터 타입
// ====================

export interface Participant {
  id: string;
  displayName: string;
  nickname?: string;
  username?: string;
  discriminator?: string;
  avatar?: string;
  roles?: string[];
  joinedAt?: Date;
  isBot?: boolean;
}

// ====================
// 텍스트 처리 클래스
// ====================

export class TextProcessor {
  // 기본 특수 태그 패턴
  private static readonly DEFAULT_SPECIAL_TAGS = {
    WAITING: '[대기]',
    SPECTATING: '[관전]',
    AFK: '[잠수]',
    BUSY: '[바쁨]',
    STREAMING: '[방송]',
    GAMING: '[게임]',
    STUDYING: '[공부]',
    WORKING: '[업무]',
    SLEEPING: '[수면]',
    EATING: '[식사]',
    MEETING: '[회의]',
    OFFLINE: '[오프라인]',
  };

  // 특수 태그 정규식 (주석처리: 현재 미사용)
  // private static readonly SPECIAL_TAG_REGEX = /^\[([^\]]+)\]\s*/;

  /**
   * 별명에서 특수 태그들을 제거합니다.
   * @param displayName - 원본 별명
   * @param options - 정리 옵션
   * @returns 정리된 별명
   */
  static cleanNickname(displayName: string, options: NicknameCleanOptions = {}): string {
    if (!displayName || typeof displayName !== 'string') {
      return '';
    }

    const {
      removeWaitTag = true,
      removeSpectateTag = true,
      removeCustomTags = [],
      preserveCase = false,
    } = options;

    let cleaned = displayName;

    // 대기 태그 제거
    if (removeWaitTag) {
      cleaned = cleaned.replace(/^\[대기\]\s*/, '');
    }

    // 관전 태그 제거
    if (removeSpectateTag) {
      cleaned = cleaned.replace(/^\[관전\]\s*/, '');
    }

    // 사용자 정의 태그 제거
    if (removeCustomTags.length > 0) {
      for (const tag of removeCustomTags) {
        const regex = new RegExp(`^\\[${this.escapeRegExp(tag)}\\]\\s*`, preserveCase ? '' : 'i');
        cleaned = cleaned.replace(regex, '');
      }
    }

    return cleaned.trim();
  }

  /**
   * 별명에서 모든 태그를 제거합니다.
   * @param displayName - 원본 별명
   * @returns 정리된 별명
   */
  static removeAllTags(displayName: string): string {
    if (!displayName || typeof displayName !== 'string') {
      return '';
    }

    // 모든 [태그] 형태의 문자열을 제거
    return displayName.replace(/^\[([^\]]+)\]\s*/g, '').trim();
  }

  /**
   * 태그를 역할 멘션으로 변환합니다.
   * @param tags - 태그 문자열 (쉼표로 구분)
   * @param guild - 길드 객체
   * @param options - 변환 옵션
   * @returns 역할 멘션 결과
   */
  static async convertTagsToRoleMentions(
    tags: string,
    guild: Guild,
    options: TagConversionOptions = {}
  ): Promise<RoleMentionResult> {
    if (!tags || !guild) {
      return {
        success: false,
        mentions: [],
        notFound: [],
        errors: ['태그나 길드가 제공되지 않았습니다.'],
      };
    }

    const {
      fallbackToBold = true,
      caseSensitive = false,
      exactMatch = false,
      // includeRoleColor = false // 미사용 변수 주석 처리
    } = options;

    const result: RoleMentionResult = {
      success: true,
      mentions: [],
      notFound: [],
      errors: [],
    };

    try {
      const tagArray = tags
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

      for (const tag of tagArray) {
        let role: Role | undefined;
        let cleanTag = tag;

        // 이미 @멘션 형태인 경우 @ 제거
        if (tag.startsWith('@')) {
          cleanTag = tag.substring(1);
        }

        // 역할 찾기
        if (exactMatch) {
          role = guild.roles.cache.find((r) =>
            caseSensitive ? r.name === cleanTag : r.name.toLowerCase() === cleanTag.toLowerCase()
          );
        } else {
          role = guild.roles.cache.find((r) =>
            caseSensitive
              ? r.name.includes(cleanTag)
              : r.name.toLowerCase().includes(cleanTag.toLowerCase())
          );
        }

        if (role) {
          result.mentions.push(`<@&${role.id}>`);
        } else {
          result.notFound.push(tag);
          if (fallbackToBold) {
            result.mentions.push(`**${tag}**`);
          }
        }
      }

      result.success = result.errors.length === 0;
      return result;
    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : String(error));

      // 오류 시 원본 반환
      if (fallbackToBold) {
        result.mentions.push(`**${tags}**`);
      }

      return result;
    }
  }

  /**
   * 참여자 목록을 포맷팅합니다.
   * @param participants - 참여자 배열
   * @param options - 포맷팅 옵션
   * @returns 포맷팅된 참여자 목록
   */
  static formatParticipantList(
    participants: Participant[],
    options: ParticipantFormatOptions = {}
  ): string {
    if (!participants || participants.length === 0) {
      return '참여자가 없습니다.';
    }

    const {
      includeNumbers = true,
      separator = '\n',
      maxLength = LIMITS.MAX_EMBED_DESCRIPTION,
      truncateText = '...',
    } = options;

    const formatted = participants
      .map((participant, index) => {
        const displayName =
          participant.displayName || participant.nickname || participant.username || '알 수 없음';
        const cleanedName = this.cleanNickname(displayName);

        return includeNumbers ? `${index + 1}. ${cleanedName}` : cleanedName;
      })
      .join(separator);

    return this.truncateText(formatted, maxLength, { suffix: truncateText });
  }

  /**
   * 시간을 한국 시간으로 포맷팅합니다.
   * @param date - 날짜 객체 (선택사항, 기본값: 현재 시간)
   * @param options - 포맷팅 옵션
   * @returns 포맷팅된 시간 문자열
   */
  static formatKoreanTime(date: Date = new Date(), options: TimeFormatOptions = {}): string {
    const {
      timeZone = 'Asia/Seoul',
      locale = 'ko-KR',
      includeSeconds = true,
      includeDate = true,
      format = 'medium',
    } = options;

    // dateStyle/timeStyle 사용 (개별 옵션과 함께 사용 불가)
    const formatOptions: Intl.DateTimeFormatOptions = {
      timeZone,
    };

    // 포맷 스타일 적용
    switch (format) {
      case 'short':
        if (includeDate) formatOptions.dateStyle = 'short';
        formatOptions.timeStyle = 'short';
        break;
      case 'medium':
        if (includeDate) formatOptions.dateStyle = 'medium';
        formatOptions.timeStyle = 'medium';
        break;
      case 'long':
        if (includeDate) formatOptions.dateStyle = 'long';
        formatOptions.timeStyle = 'long';
        break;
      case 'full':
        if (includeDate) formatOptions.dateStyle = 'full';
        formatOptions.timeStyle = 'full';
        break;
      default:
        // 개별 옵션 사용 (dateStyle/timeStyle 대신)
        formatOptions.year = includeDate ? 'numeric' : undefined;
        formatOptions.month = includeDate ? '2-digit' : undefined;
        formatOptions.day = includeDate ? '2-digit' : undefined;
        formatOptions.hour = '2-digit';
        formatOptions.minute = '2-digit';
        formatOptions.second = includeSeconds ? '2-digit' : undefined;
        break;
    }

    return date.toLocaleString(locale, formatOptions);
  }

  /**
   * 마크다운으로 텍스트를 스타일링합니다.
   * @param text - 원본 텍스트
   * @param options - 마크다운 옵션
   * @returns 스타일링된 텍스트
   */
  static createMarkdownText(text: string, options: MarkdownOptions = {}): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    const { level = 2, style = 'header', escape = false } = options;

    const processedText = escape ? this.escapeMarkdown(text) : text;

    switch (style) {
      case 'header':
        const headerPrefix = '#'.repeat(Math.max(1, Math.min(6, level)));
        return `${headerPrefix} ${processedText}`;
      case 'bold':
        return `**${processedText}**`;
      case 'italic':
        return `*${processedText}*`;
      case 'code':
        return `\`${processedText}\``;
      case 'quote':
        return `> ${processedText}`;
      default:
        return processedText;
    }
  }

  /**
   * 마크다운으로 큰 텍스트를 생성합니다.
   * @param text - 원본 텍스트
   * @param level - 헤더 레벨
   * @returns 마크다운 텍스트
   */
  static createLargeText(text: string, level: number = 2): string {
    return this.createMarkdownText(text, { level, style: 'header' });
  }

  /**
   * 텍스트가 Discord 제한을 초과하는지 확인합니다.
   * @param text - 확인할 텍스트
   * @param limit - 제한 길이
   * @returns 제한 초과 여부
   */
  static exceedsLimit(text: string, limit: number): boolean {
    return text?.length > limit;
  }

  /**
   * 텍스트를 검증합니다.
   * @param text - 확인할 텍스트
   * @param type - 텍스트 타입
   * @returns 검증 결과
   */
  static validateText(
    text: string,
    type: 'message' | 'embed' | 'field' | 'title' = 'message'
  ): TextValidationResult {
    if (!text || typeof text !== 'string') {
      return {
        isValid: false,
        length: 0,
        exceedsLimit: false,
        suggestions: ['유효한 텍스트를 입력해주세요.'],
      };
    }

    const length = text.length;
    let limit: number;
    let limitType: string;

    switch (type) {
      case 'message':
        limit = LIMITS.MAX_MESSAGE_LENGTH;
        limitType = '메시지';
        break;
      case 'embed':
        limit = LIMITS.MAX_EMBED_DESCRIPTION;
        limitType = '임베드 설명';
        break;
      case 'field':
        limit = LIMITS.MAX_EMBED_FIELDS;
        limitType = '임베드 필드';
        break;
      case 'title':
        limit = LIMITS.MAX_EMBED_TITLE;
        limitType = '임베드 제목';
        break;
      default:
        limit = LIMITS.MAX_MESSAGE_LENGTH;
        limitType = '메시지';
    }

    const exceedsLimit = length > limit;
    const suggestions: string[] = [];

    if (exceedsLimit) {
      suggestions.push(`${limitType} 길이를 ${limit}자 이하로 줄여주세요.`);
      suggestions.push(`현재 길이: ${length}자, 초과: ${length - limit}자`);
    }

    return {
      isValid: !exceedsLimit,
      length,
      exceedsLimit,
      limitType,
      suggestions,
    };
  }

  /**
   * 텍스트를 지정된 길이로 자릅니다.
   * @param text - 원본 텍스트
   * @param maxLength - 최대 길이
   * @param options - 자르기 옵션
   * @returns 잘린 텍스트
   */
  static truncateText(text: string, maxLength: number, options: TextTruncateOptions = {}): string {
    if (!text || text.length <= maxLength) {
      return text;
    }

    const { suffix = '...', preserveWords = false, maxLines } = options;

    let truncated = text;

    // 줄 수 제한
    if (maxLines && maxLines > 0) {
      const lines = text.split('\n');
      if (lines.length > maxLines) {
        truncated = lines.slice(0, maxLines).join('\n');
      }
    }

    // 길이 제한
    if (truncated.length > maxLength) {
      const targetLength = maxLength - suffix.length;

      if (preserveWords) {
        // 단어 경계에서 자르기
        const words = truncated.substring(0, targetLength).split(' ');
        words.pop(); // 마지막 불완전한 단어 제거
        truncated = words.join(' ');
      } else {
        truncated = truncated.substring(0, targetLength);
      }

      truncated += suffix;
    }

    return truncated;
  }

  /**
   * 별명에 특수 태그가 포함되어 있는지 확인합니다.
   * @param displayName - 확인할 별명
   * @returns 태그 검사 결과
   */
  static checkSpecialTags(displayName: string): SpecialTagsResult {
    if (!displayName || typeof displayName !== 'string') {
      return {
        hasWaitTag: false,
        hasSpectateTag: false,
        hasCustomTags: false,
        foundTags: [],
        cleanedText: '',
      };
    }

    const foundTags: string[] = [];
    let cleanedText = displayName;

    // 기본 태그 확인
    const hasWaitTag = displayName.includes(DiscordConstants.SPECIAL_TAGS.WAITING);
    const hasSpectateTag = displayName.includes(DiscordConstants.SPECIAL_TAGS.SPECTATING);

    if (hasWaitTag) {
      foundTags.push(DiscordConstants.SPECIAL_TAGS.WAITING);
    }
    if (hasSpectateTag) {
      foundTags.push(DiscordConstants.SPECIAL_TAGS.SPECTATING);
    }

    // 추가 특수 태그 확인
    for (const [_key, tag] of Object.entries(this.DEFAULT_SPECIAL_TAGS)) {
      if (displayName.includes(tag) && !foundTags.includes(tag)) {
        foundTags.push(tag);
      }
    }

    // 모든 태그 제거
    cleanedText = this.removeAllTags(displayName);

    return {
      hasWaitTag,
      hasSpectateTag,
      hasCustomTags:
        foundTags.length > 2 || (foundTags.length > 0 && !hasWaitTag && !hasSpectateTag),
      foundTags,
      cleanedText,
    };
  }

  /**
   * 별명에 대기/관전 태그가 있는지 확인합니다.
   * @param displayName - 확인할 별명
   * @returns 태그 존재 여부
   */
  static hasWaitOrSpectateTag(displayName: string): boolean {
    const { hasWaitTag, hasSpectateTag } = this.checkSpecialTags(displayName);
    return hasWaitTag || hasSpectateTag;
  }

  /**
   * 마크다운 문자를 이스케이프합니다.
   * @param text - 원본 텍스트
   * @returns 이스케이프된 텍스트
   */
  static escapeMarkdown(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    return text.replace(/([*_`~|\\])/g, '\\$1');
  }

  /**
   * 정규식 특수 문자를 이스케이프합니다.
   * @param text - 원본 텍스트
   * @returns 이스케이프된 텍스트
   */
  static escapeRegExp(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * HTML 태그를 제거합니다.
   * @param html - HTML 문자열
   * @returns 태그가 제거된 텍스트
   */
  static stripHtml(html: string): string {
    if (!html || typeof html !== 'string') {
      return '';
    }

    return html.replace(/<[^>]*>/g, '');
  }

  /**
   * 공백을 정규화합니다.
   * @param text - 원본 텍스트
   * @returns 정규화된 텍스트
   */
  static normalizeWhitespace(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * 텍스트에서 멘션을 추출합니다.
   * @param text - 원본 텍스트
   * @returns 멘션 정보
   */
  static extractMentions(text: string): {
    users: string[];
    roles: string[];
    channels: string[];
    everyone: boolean;
    here: boolean;
  } {
    if (!text || typeof text !== 'string') {
      return {
        users: [],
        roles: [],
        channels: [],
        everyone: false,
        here: false,
      };
    }

    const users = [...text.matchAll(REGEX.USER_MENTION)].map((match) => match[1]);
    const roles = [...text.matchAll(REGEX.ROLE_MENTION)].map((match) => match[1]);
    const channels = [...text.matchAll(REGEX.CHANNEL_MENTION)].map((match) => match[1]);
    const everyone = text.includes('@everyone');
    const here = text.includes('@here');

    return {
      users,
      roles,
      channels,
      everyone,
      here,
    };
  }

  /**
   * 디스코드 ID가 유효한지 확인합니다.
   * @param id - 확인할 ID
   * @returns 유효성 여부
   */
  static isValidDiscordId(id: string): boolean {
    return REGEX.SNOWFLAKE.test(id);
  }

  /**
   * 텍스트를 안전하게 변환합니다.
   * @param value - 변환할 값
   * @param defaultValue - 기본값
   * @returns 안전한 문자열
   */
  static safeString(value: any, defaultValue: string = ''): string {
    if (value === null || value === undefined) {
      return defaultValue;
    }

    if (typeof value === 'string') {
      return value;
    }

    try {
      return String(value);
    } catch {
      return defaultValue;
    }
  }

  /**
   * 텍스트가 비어있는지 확인합니다.
   * @param text - 확인할 텍스트
   * @returns 비어있으면 true
   */
  static isEmpty(text: string | null | undefined): boolean {
    return !text || text.trim().length === 0;
  }

  /**
   * 텍스트가 유효한지 확인합니다.
   * @param text - 확인할 텍스트
   * @returns 유효하면 true
   */
  static isValidText(text: any): text is string {
    return typeof text === 'string' && text.trim().length > 0;
  }

  /**
   * 텍스트를 캐멀케이스로 변환합니다.
   * @param text - 원본 텍스트
   * @returns 캐멀케이스 텍스트
   */
  static toCamelCase(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    return text.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase());
  }

  /**
   * 텍스트를 파스칼케이스로 변환합니다.
   * @param text - 원본 텍스트
   * @returns 파스칼케이스 텍스트
   */
  static toPascalCase(text: string): string {
    const camelCase = this.toCamelCase(text);
    return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
  }

  /**
   * 텍스트를 케밥케이스로 변환합니다.
   * @param text - 원본 텍스트
   * @returns 케밥케이스 텍스트
   */
  static toKebabCase(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    return text
      .toLowerCase()
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * 텍스트를 스네이크케이스로 변환합니다.
   * @param text - 원본 텍스트
   * @returns 스네이크케이스 텍스트
   */
  static toSnakeCase(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    return text
      .toLowerCase()
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /**
   * 문자열의 해시를 생성합니다.
   * @param text - 원본 텍스트
   * @returns 해시 문자열
   */
  static simpleHash(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // 32비트 정수로 변환
    }

    return Math.abs(hash).toString(36);
  }

  /**
   * 두 문자열의 유사도를 계산합니다 (레벤슈타인 거리).
   * @param str1 - 첫 번째 문자열
   * @param str2 - 두 번째 문자열
   * @returns 유사도 (0-1)
   */
  static similarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    const maxLength = Math.max(str1.length, str2.length);
    if (maxLength === 0) return 1;

    const distance = this.levenshteinDistance(str1, str2);
    return (maxLength - distance) / maxLength;
  }

  /**
   * 레벤슈타인 거리를 계산합니다.
   * @param str1 - 첫 번째 문자열
   * @param str2 - 두 번째 문자열
   * @returns 레벤슈타인 거리
   */
  private static levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1)
      .fill(null)
      .map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) {
      matrix[0][i] = i;
    }

    for (let j = 0; j <= str2.length; j++) {
      matrix[j][0] = j;
    }

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // 삽입
          matrix[j - 1][i] + 1, // 삭제
          matrix[j - 1][i - 1] + indicator // 교체
        );
      }
    }

    return matrix[str2.length][str1.length];
  }
}
