// src/utils/formatters.ts - 포맷팅 유틸리티
import { TIME } from '../config/constants';

// ====================
// 포맷팅 옵션 타입
// ====================

export interface TimeFormatOptions {
  includeSeconds?: boolean;
  includeMilliseconds?: boolean;
  compact?: boolean;
  korean?: boolean;
}

export interface NumberFormatOptions {
  locale?: string;
  currency?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  useGrouping?: boolean;
}

export interface MemberListOptions {
  showCount?: boolean;
  showEmpty?: boolean;
  emptyText?: string;
  maxLength?: number;
  truncateText?: string;
}

export interface ParticipantListOptions {
  showCount?: boolean;
  showHeader?: boolean;
  emptyText?: string;
  separator?: string;
  wrapInBackticks?: boolean;
}

// ====================
// 시간 포맷팅 함수
// ====================

/**
 * 밀리초 단위의 시간을 읽기 쉬운 형식으로 변환합니다.
 * @param totalTime - 밀리초 단위의 시간
 * @param options - 포맷팅 옵션
 * @returns "시간 분" 형식의 문자열
 */
export function formatTime(totalTime: number, options: TimeFormatOptions = {}): string {
  const {
    includeSeconds = false,
    includeMilliseconds = false,
    compact = false,
    korean = true,
  } = options;

  if (totalTime < 0) {
    return korean ? '0초' : '0s';
  }

  const hours = Math.floor(totalTime / TIME.HOUR);
  const minutes = Math.floor((totalTime % TIME.HOUR) / TIME.MINUTE);
  const seconds = Math.floor((totalTime % TIME.MINUTE) / TIME.SECOND);
  const milliseconds = totalTime % TIME.SECOND;

  const parts: string[] = [];

  if (korean) {
    if (hours > 0) parts.push(`${hours}시간`);
    if (minutes > 0) parts.push(`${minutes}분`);
    if (includeSeconds && seconds > 0) parts.push(`${seconds}초`);
    if (includeMilliseconds && milliseconds > 0) parts.push(`${milliseconds}ms`);
  } else {
    if (hours > 0) parts.push(compact ? `${hours}h` : `${hours} hours`);
    if (minutes > 0) parts.push(compact ? `${minutes}m` : `${minutes} minutes`);
    if (includeSeconds && seconds > 0) parts.push(compact ? `${seconds}s` : `${seconds} seconds`);
    if (includeMilliseconds && milliseconds > 0) parts.push(`${milliseconds}ms`);
  }

  if (parts.length === 0) {
    return korean ? '0초' : '0s';
  }

  return parts.join(compact ? '' : ' ');
}

/**
 * 밀리초를 정확한 시간 형식으로 변환합니다.
 * @param ms - 밀리초
 * @returns HH:MM:SS 형식의 문자열
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  } else {
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
}

/**
 * 상대적인 시간을 포맷팅합니다.
 * @param timestamp - 타임스탬프
 * @param now - 현재 시간 (선택사항)
 * @returns 상대적인 시간 문자열
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const diff = now - timestamp;
  const absDiff = Math.abs(diff);
  const future = diff < 0;

  if (absDiff < TIME.MINUTE) {
    return future ? '곧' : '방금 전';
  } else if (absDiff < TIME.HOUR) {
    const minutes = Math.floor(absDiff / TIME.MINUTE);
    return future ? `${minutes}분 후` : `${minutes}분 전`;
  } else if (absDiff < TIME.DAY) {
    const hours = Math.floor(absDiff / TIME.HOUR);
    return future ? `${hours}시간 후` : `${hours}시간 전`;
  } else if (absDiff < TIME.WEEK) {
    const days = Math.floor(absDiff / TIME.DAY);
    return future ? `${days}일 후` : `${days}일 전`;
  } else {
    const date = new Date(timestamp);
    return formatShortDate(date);
  }
}

// ====================
// 날짜 포맷팅 함수
// ====================

/**
 * 날짜를 한국 표준시 형식으로 포맷팅합니다.
 * @param date - 포맷팅할 날짜 또는 타임스탬프
 * @returns 포맷팅된 날짜 문자열
 */
export function formatKoreanDate(date: Date | number): string {
  const dateObj = date instanceof Date ? date : new Date(date);
  return dateObj.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

/**
 * 날짜를 YYYY.MM.DD 형식으로 포맷팅합니다.
 * @param date - 포맷팅할 날짜 또는 타임스탬프
 * @returns YYYY.MM.DD 형식의 날짜 문자열
 */
export function formatShortDate(date: Date | number): string {
  const dateObj = date instanceof Date ? date : new Date(date);
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}.${month}.${day}`;
}

/**
 * 날짜를 YYYY-MM-DD HH:MM:SS 형식으로 포맷팅합니다.
 * @param date - 포맷팅할 날짜 또는 타임스탬프
 * @returns YYYY-MM-DD HH:MM:SS 형식의 날짜 문자열
 */
export function formatFullDate(date: Date | number): string {
  const dateObj = date instanceof Date ? date : new Date(date);
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const minutes = String(dateObj.getMinutes()).padStart(2, '0');
  const seconds = String(dateObj.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 날짜를 ISO 8601 형식으로 포맷팅합니다.
 * @param date - 포맷팅할 날짜 또는 타임스탬프
 * @returns ISO 8601 형식의 날짜 문자열
 */
export function formatISODate(date: Date | number): string {
  const dateObj = date instanceof Date ? date : new Date(date);
  return dateObj.toISOString();
}

// ====================
// 숫자 포맷팅 함수
// ====================

/**
 * 숫자를 천 단위 구분자와 함께 포맷팅합니다.
 * @param num - 포맷팅할 숫자
 * @param options - 포맷팅 옵션
 * @returns 포맷팅된 숫자 문자열
 */
export function formatNumber(num: number, options: NumberFormatOptions = {}): string {
  const {
    locale = 'ko-KR',
    currency,
    minimumFractionDigits = 0,
    maximumFractionDigits = 2,
    useGrouping = true,
  } = options;

  const formatOptions: Intl.NumberFormatOptions = {
    minimumFractionDigits,
    maximumFractionDigits,
    useGrouping,
  };

  if (currency) {
    formatOptions.style = 'currency';
    formatOptions.currency = currency;
  }

  return new Intl.NumberFormat(locale, formatOptions).format(num);
}

/**
 * 바이트 단위의 크기를 읽기 쉬운 형식으로 변환합니다.
 * @param bytes - 바이트 크기
 * @param decimals - 소수점 자리수
 * @returns 포맷팅된 크기 문자열
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * 퍼센트를 포맷팅합니다.
 * @param value - 값 (0-1 사이)
 * @param decimals - 소수점 자리수
 * @returns 퍼센트 문자열
 */
export function formatPercent(value: number, decimals: number = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

// ====================
// 멤버 및 참가자 포맷팅 함수
// ====================

/**
 * 멤버 목록 텍스트를 생성합니다.
 * @param members - 멤버 이름 배열
 * @param options - 포맷팅 옵션
 * @returns 포맷팅된 멤버 목록 문자열
 */
export function formatMembersList(members: string[] = [], options: MemberListOptions = {}): string {
  const {
    showCount = true,
    showEmpty = true,
    emptyText = '없음',
    maxLength = 2000,
    truncateText = '...',
  } = options;

  const count = members?.length || 0;

  if (count === 0 && !showEmpty) {
    return '';
  }

  const list = count > 0 ? members.map((member) => `\` ${member} \``).join(' ') : emptyText;

  let result = showCount ? `**현재 멤버: (${count}명)**\n${list}` : list;

  // 최대 길이 제한
  if (result.length > maxLength) {
    result = result.substring(0, maxLength - truncateText.length) + truncateText;
  }

  return result;
}

/**
 * 역할 이름에서 @ 기호를 제거합니다.
 * @param roleName - 역할 이름
 * @returns @ 기호가 제거된 역할 이름
 */
export function cleanRoleName(roleName: string): string {
  if (!roleName || typeof roleName !== 'string') {
    return '';
  }
  return roleName.replace(/@/g, '');
}

/**
 * 참가자 이름을 백틱과 공백으로 감싸서 포맷팅합니다.
 * @param nickname - 참가자 닉네임
 * @returns 백틱으로 감싸진 닉네임
 */
export function formatParticipantName(nickname: string): string {
  if (!nickname || typeof nickname !== 'string') {
    return '';
  }
  return ` \` ${nickname} \` `;
}

/**
 * 참가자 목록을 포맷팅합니다.
 * @param participants - 참가자 닉네임 배열
 * @param options - 포맷팅 옵션
 * @returns 포맷팅된 참가자 목록 문자열
 */
export function formatParticipantList(
  participants: string[] = [],
  options: ParticipantListOptions = {}
): string {
  const {
    showCount = true,
    showHeader = true,
    emptyText = '없음',
    separator = ',',
    wrapInBackticks = true,
  } = options;

  const count = participants?.length || 0;

  if (count === 0) {
    return showHeader ? `## 👥 **참가자(0명)**: ${emptyText}` : emptyText;
  }

  const formattedNames = participants
    .map((name) => (wrapInBackticks ? ` \` ${name} \` ` : name))
    .join(separator);

  if (!showHeader) {
    return formattedNames;
  }

  return showCount
    ? `## 👥 **참가자(${count}명)**: ${formattedNames}`
    : `## 👥 **참가자**: ${formattedNames}`;
}

// ====================
// 디스코드 포맷팅 함수
// ====================

/**
 * 사용자 멘션을 포맷팅합니다.
 * @param userId - 사용자 ID
 * @returns 사용자 멘션 문자열
 */
export function formatUserMention(userId: string): string {
  return `<@${userId}>`;
}

/**
 * 채널 멘션을 포맷팅합니다.
 * @param channelId - 채널 ID
 * @returns 채널 멘션 문자열
 */
export function formatChannelMention(channelId: string): string {
  return `<#${channelId}>`;
}

/**
 * 역할 멘션을 포맷팅합니다.
 * @param roleId - 역할 ID
 * @returns 역할 멘션 문자열
 */
export function formatRoleMention(roleId: string): string {
  return `<@&${roleId}>`;
}

/**
 * 타임스탬프를 디스코드 형식으로 포맷팅합니다.
 * @param timestamp - 타임스탬프
 * @param style - 디스코드 타임스탬프 스타일
 * @returns 디스코드 타임스탬프 문자열
 */
export function formatDiscordTimestamp(timestamp: number, style: string = 'f'): string {
  const seconds = Math.floor(timestamp / 1000);
  return `<t:${seconds}:${style}>`;
}

/**
 * 코드 블록을 포맷팅합니다.
 * @param code - 코드 내용
 * @param language - 언어 (선택사항)
 * @returns 코드 블록 문자열
 */
export function formatCodeBlock(code: string, language: string = ''): string {
  return `\`\`\`${language}\n${code}\n\`\`\``;
}

/**
 * 인라인 코드를 포맷팅합니다.
 * @param code - 코드 내용
 * @returns 인라인 코드 문자열
 */
export function formatInlineCode(code: string): string {
  return `\`${code}\``;
}

/**
 * 굵은 글씨를 포맷팅합니다.
 * @param text - 텍스트
 * @returns 굵은 글씨 문자열
 */
export function formatBold(text: string): string {
  return `**${text}**`;
}

/**
 * 기울임체를 포맷팅합니다.
 * @param text - 텍스트
 * @returns 기울임체 문자열
 */
export function formatItalic(text: string): string {
  return `*${text}*`;
}

/**
 * 밑줄을 포맷팅합니다.
 * @param text - 텍스트
 * @returns 밑줄 문자열
 */
export function formatUnderline(text: string): string {
  return `__${text}__`;
}

/**
 * 취소선을 포맷팅합니다.
 * @param text - 텍스트
 * @returns 취소선 문자열
 */
export function formatStrikethrough(text: string): string {
  return `~~${text}~~`;
}

/**
 * 스포일러를 포맷팅합니다.
 * @param text - 텍스트
 * @returns 스포일러 문자열
 */
export function formatSpoiler(text: string): string {
  return `||${text}||`;
}

// ====================
// 활동 관련 포맷팅 함수
// ====================

/**
 * 활동 통계를 포맷팅합니다.
 * @param totalTime - 총 시간 (밀리초)
 * @param sessions - 세션 수
 * @param avgTime - 평균 시간 (밀리초)
 * @returns 포맷팅된 활동 통계 문자열
 */
export function formatActivityStats(totalTime: number, sessions: number, avgTime: number): string {
  const total = formatTime(totalTime);
  const average = formatTime(avgTime);

  return `**총 활동 시간**: ${total}\n**세션 수**: ${sessions}회\n**평균 시간**: ${average}`;
}

/**
 * 활동 순위를 포맷팅합니다.
 * @param rank - 순위
 * @param name - 이름
 * @param time - 시간 (밀리초)
 * @param percentage - 퍼센트 (선택사항)
 * @returns 포맷팅된 순위 문자열
 */
export function formatActivityRank(
  rank: number,
  name: string,
  time: number,
  percentage?: number
): string {
  const timeStr = formatTime(time);
  const percentStr = percentage ? ` (${formatPercent(percentage)})` : '';

  // 순위별 이모지
  const rankEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '📊';

  return `${rankEmoji} **${rank}위**: ${name} - ${timeStr}${percentStr}`;
}

/**
 * 활동 상태를 포맷팅합니다.
 * @param isActive - 활동 중 여부
 * @param time - 시간 (밀리초)
 * @returns 포맷팅된 활동 상태 문자열
 */
export function formatActivityStatus(isActive: boolean, time: number): string {
  const timeStr = formatTime(time);
  const statusEmoji = isActive ? '🟢' : '🔴';
  const statusText = isActive ? '활동 중' : '비활성';

  return `${statusEmoji} **${statusText}** (${timeStr})`;
}

// ====================
// 리스트 포맷팅 함수
// ====================

/**
 * 배열을 줄 바꿈으로 구분된 리스트로 포맷팅합니다.
 * @param items - 아이템 배열
 * @param bullet - 불릿 문자
 * @returns 포맷팅된 리스트 문자열
 */
export function formatList(items: string[], bullet: string = '•'): string {
  return items.map((item) => `${bullet} ${item}`).join('\n');
}

/**
 * 배열을 번호가 매겨진 리스트로 포맷팅합니다.
 * @param items - 아이템 배열
 * @param startNumber - 시작 번호
 * @returns 포맷팅된 번호 리스트 문자열
 */
export function formatNumberedList(items: string[], startNumber: number = 1): string {
  return items.map((item, index) => `${startNumber + index}. ${item}`).join('\n');
}

/**
 * 키-값 쌍을 포맷팅합니다.
 * @param pairs - 키-값 쌍 객체
 * @param separator - 구분자
 * @returns 포맷팅된 키-값 쌍 문자열
 */
export function formatKeyValuePairs(pairs: Record<string, any>, separator: string = ': '): string {
  return Object.entries(pairs)
    .map(([key, value]) => `**${key}**${separator}${value}`)
    .join('\n');
}

// ====================
// 테이블 포맷팅 함수
// ====================

/**
 * 간단한 테이블을 포맷팅합니다.
 * @param headers - 헤더 배열
 * @param rows - 행 배열
 * @returns 포맷팅된 테이블 문자열
 */
export function formatTable(headers: string[], rows: string[][]): string {
  const headerRow = '| ' + headers.join(' | ') + ' |';
  const separatorRow = '| ' + headers.map(() => '---').join(' | ') + ' |';
  const dataRows = rows.map((row) => '| ' + row.join(' | ') + ' |');

  return [headerRow, separatorRow, ...dataRows].join('\n');
}

// ====================
// 프로그레스 바 포맷팅 함수
// ====================

/**
 * 프로그레스 바를 포맷팅합니다.
 * @param current - 현재 값
 * @param total - 총 값
 * @param length - 프로그레스 바 길이
 * @returns 포맷팅된 프로그레스 바 문자열
 */
export function formatProgressBar(current: number, total: number, length: number = 20): string {
  const percentage = Math.min(current / total, 1);
  const filled = Math.round(percentage * length);
  const empty = length - filled;

  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const percent = formatPercent(percentage);

  return `${bar} ${percent}`;
}

// ====================
// 유틸리티 함수
// ====================

/**
 * 텍스트를 지정된 길이로 자릅니다.
 * @param text - 텍스트
 * @param maxLength - 최대 길이
 * @param suffix - 접미사
 * @returns 자른 텍스트
 */
export function truncateText(text: string, maxLength: number, suffix: string = '...'): string {
  if (text.length <= maxLength) {
    return text;
  }

  return text.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * 텍스트를 이스케이프합니다.
 * @param text - 텍스트
 * @returns 이스케이프된 텍스트
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/([*_`~|\\])/g, '\\$1');
}

/**
 * HTML 태그를 제거합니다.
 * @param html - HTML 문자열
 * @returns 태그가 제거된 텍스트
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

/**
 * 공백을 정규화합니다.
 * @param text - 텍스트
 * @returns 정규화된 텍스트
 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// ====================
// 검증 함수
// ====================

/**
 * 문자열이 비어있는지 확인합니다.
 * @param str - 문자열
 * @returns 비어있으면 true
 */
export function isEmpty(str: string | null | undefined): boolean {
  return !str || str.trim().length === 0;
}

/**
 * 문자열이 유효한지 확인합니다.
 * @param str - 문자열
 * @returns 유효하면 true
 */
export function isValidString(str: any): str is string {
  return typeof str === 'string' && str.trim().length > 0;
}

/**
 * 안전한 문자열 변환을 수행합니다.
 * @param value - 변환할 값
 * @param defaultValue - 기본값
 * @returns 문자열
 */
export function safeString(value: any, defaultValue: string = ''): string {
  if (value === null || value === undefined) {
    return defaultValue;
  }

  return String(value);
}
