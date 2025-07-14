// src/utils/dateUtils.ts - 날짜 관련 유틸리티 함수
import { TIME } from '../config/constants.js';

// ====================
// 날짜 형식 타입
// ====================

export type DateFormat = 'YYMMDD' | 'YYYY-MM-DD' | 'YYYY.MM.DD' | 'YYYY/MM/DD' | 'KOREAN';
export type TimeFormat = 'HH:MM' | 'HH:MM:SS' | 'HH:MM:SS.mmm' | 'ISO';

export interface DateRange {
  start: Date;
  end: Date;
}

export interface TimeSpan {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
}

export interface DateFormatOptions {
  locale?: string;
  timezone?: string;
  format?: DateFormat;
  includeTime?: boolean;
  includeSeconds?: boolean;
  includeMilliseconds?: boolean;
}

// ====================
// 날짜 파싱 함수
// ====================

/**
 * YYMMDD 형식의 문자열을 Date 객체로 변환합니다.
 * @param dateStr - YYMMDD 형식 날짜 문자열 (예: 250510)
 * @returns 변환된 Date 객체
 * @throws 유효하지 않은 형식이거나 날짜일 때 오류 발생
 */
export function parseYYMMDD(dateStr: string): Date {
  if (!dateStr || !/^\d{6}$/.test(dateStr)) {
    throw new Error('날짜는 YYMMDD 형식이어야 합니다. (예: 250510)');
  }

  const year = 2000 + parseInt(dateStr.substring(0, 2), 10);
  const month = parseInt(dateStr.substring(2, 4), 10) - 1; // JavaScript의 월은 0부터 시작
  const day = parseInt(dateStr.substring(4, 6), 10);

  const date = new Date(year, month, day);

  // 유효한 날짜인지 검증
  if (isNaN(date.getTime())) {
    throw new Error('유효하지 않은 날짜입니다.');
  }

  return date;
}

/**
 * 다양한 형식의 날짜 문자열을 Date 객체로 변환합니다.
 * @param dateStr - 날짜 문자열
 * @param format - 예상 형식 (선택사항)
 * @returns 변환된 Date 객체
 * @throws 유효하지 않은 날짜일 때 오류 발생
 */
export function parseDate(dateStr: string, format?: DateFormat): Date {
  if (!dateStr || typeof dateStr !== 'string') {
    throw new Error('유효한 날짜 문자열을 입력해주세요.');
  }

  let date: Date;

  if (format === 'YYMMDD' || /^\d{6}$/.test(dateStr)) {
    return parseYYMMDD(dateStr);
  }

  // ISO 형식 시도
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/.test(dateStr)) {
    date = new Date(dateStr);
  }
  // YYYY.MM.DD 형식
  else if (/^\d{4}\.\d{2}\.\d{2}$/.test(dateStr)) {
    const [year, month, day] = dateStr.split('.').map(Number);
    date = new Date(year, month - 1, day);
  }
  // YYYY/MM/DD 형식
  else if (/^\d{4}\/\d{2}\/\d{2}$/.test(dateStr)) {
    const [year, month, day] = dateStr.split('/').map(Number);
    date = new Date(year, month - 1, day);
  }
  // 기본 Date 생성자 사용
  else {
    date = new Date(dateStr);
  }

  if (isNaN(date.getTime())) {
    throw new Error(`유효하지 않은 날짜 형식입니다: ${dateStr}`);
  }

  return date;
}

/**
 * 타임스탬프를 Date 객체로 변환합니다.
 * @param timestamp - 타임스탬프 (밀리초 또는 초)
 * @returns 변환된 Date 객체
 */
export function parseTimestamp(timestamp: number): Date {
  // 타임스탬프가 초 단위인 경우 밀리초로 변환
  const ts = timestamp < 10000000000 ? timestamp * 1000 : timestamp;
  return new Date(ts);
}

// ====================
// 날짜 계산 함수
// ====================

/**
 * 지정된 날짜의 다음 일요일을 계산합니다.
 * 입력된 날짜가 일요일인 경우 다음 주 일요일을 반환합니다.
 * @param date - 기준 날짜
 * @returns 다음 일요일 날짜
 */
export function calculateNextSunday(date: Date): Date {
  const nextDate = new Date(date);
  const daysUntilSunday = 7 - nextDate.getDay();

  // 이미 일요일인 경우 다음 주 일요일로 설정
  if (daysUntilSunday === 7) {
    nextDate.setDate(nextDate.getDate() + 7);
  } else {
    nextDate.setDate(nextDate.getDate() + daysUntilSunday);
  }

  return nextDate;
}

/**
 * 지정된 날짜의 이전 일요일을 계산합니다.
 * @param date - 기준 날짜
 * @returns 이전 일요일 날짜
 */
export function calculatePreviousSunday(date: Date): Date {
  const prevDate = new Date(date);
  const daysSinceSunday = prevDate.getDay();

  if (daysSinceSunday === 0) {
    // 이미 일요일인 경우 이전 주 일요일로 설정
    prevDate.setDate(prevDate.getDate() - 7);
  } else {
    prevDate.setDate(prevDate.getDate() - daysSinceSunday);
  }

  return prevDate;
}

/**
 * 현재 시간으로부터 지정된 일 수만큼 후의 날짜를 반환합니다.
 * @param days - 더할 일 수
 * @returns 계산된 날짜
 */
export function addDays(days: number): Date;
export function addDays(date: Date, days: number): Date;
export function addDays(dateOrDays: Date | number, days?: number): Date {
  if (typeof dateOrDays === 'number') {
    const date = new Date();
    date.setDate(date.getDate() + dateOrDays);
    return date;
  } else {
    const date = new Date(dateOrDays);
    date.setDate(date.getDate() + (days || 0));
    return date;
  }
}

/**
 * 현재 시간으로부터 7일(일주일) 후의 날짜를 반환합니다.
 * @returns 현재로부터 7일 후 날짜
 */
export function getOneWeekLater(): Date {
  return addDays(7);
}

/**
 * 현재 시간으로부터 지정된 시간만큼 후의 날짜를 반환합니다.
 * @param milliseconds - 더할 밀리초
 * @returns 계산된 날짜
 */
export function addTime(milliseconds: number): Date;
export function addTime(date: Date, milliseconds: number): Date;
export function addTime(dateOrMs: Date | number, milliseconds?: number): Date {
  if (typeof dateOrMs === 'number') {
    return new Date(Date.now() + dateOrMs);
  } else {
    return new Date(dateOrMs.getTime() + (milliseconds || 0));
  }
}

/**
 * 두 날짜 사이의 차이를 계산합니다.
 * @param date1 - 첫 번째 날짜
 * @param date2 - 두 번째 날짜
 * @returns 차이 (밀리초)
 */
export function getTimeDifference(date1: Date, date2: Date): number {
  return Math.abs(date1.getTime() - date2.getTime());
}

/**
 * 두 날짜 사이의 차이를 상세하게 계산합니다.
 * @param date1 - 첫 번째 날짜
 * @param date2 - 두 번째 날짜
 * @returns 시간 차이 객체
 */
export function getDetailedTimeDifference(date1: Date, date2: Date): TimeSpan {
  const diff = getTimeDifference(date1, date2);

  const years = Math.floor(diff / TIME.YEAR);
  const months = Math.floor((diff % TIME.YEAR) / TIME.MONTH);
  const days = Math.floor((diff % TIME.MONTH) / TIME.DAY);
  const hours = Math.floor((diff % TIME.DAY) / TIME.HOUR);
  const minutes = Math.floor((diff % TIME.HOUR) / TIME.MINUTE);
  const seconds = Math.floor((diff % TIME.MINUTE) / TIME.SECOND);
  const milliseconds = diff % TIME.SECOND;

  return {
    years,
    months,
    days,
    hours,
    minutes,
    seconds,
    milliseconds,
  };
}

// ====================
// 날짜 비교 함수
// ====================

/**
 * 현재 날짜가 지정된 날짜보다 이후인지 확인합니다.
 * @param targetDate - 비교할 대상 날짜
 * @returns 현재 날짜가 대상 날짜보다 이후이면 true
 */
export function isAfterDate(targetDate: Date): boolean {
  const now = new Date();
  return now > targetDate;
}

/**
 * 현재 날짜가 지정된 날짜보다 이전인지 확인합니다.
 * @param targetDate - 비교할 대상 날짜
 * @returns 현재 날짜가 대상 날짜보다 이전이면 true
 */
export function isBeforeDate(targetDate: Date): boolean {
  const now = new Date();
  return now < targetDate;
}

/**
 * 두 날짜가 같은 날인지 확인합니다 (시간 제외).
 * @param date1 - 첫 번째 날짜
 * @param date2 - 두 번째 날짜
 * @returns 같은 날이면 true
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * 지정된 날짜가 오늘인지 확인합니다.
 * @param date - 확인할 날짜
 * @returns 오늘이면 true
 */
export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

/**
 * 지정된 날짜가 어제인지 확인합니다.
 * @param date - 확인할 날짜
 * @returns 어제이면 true
 */
export function isYesterday(date: Date): boolean {
  const yesterday = addDays(-1);
  return isSameDay(date, yesterday);
}

/**
 * 지정된 날짜가 주말인지 확인합니다.
 * @param date - 확인할 날짜
 * @returns 주말이면 true
 */
export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6; // 일요일(0) 또는 토요일(6)
}

/**
 * 날짜가 지정된 범위 내에 있는지 확인합니다.
 * @param date - 확인할 날짜
 * @param range - 날짜 범위
 * @returns 범위 내에 있으면 true
 */
export function isDateInRange(date: Date, range: DateRange): boolean {
  return date >= range.start && date <= range.end;
}

// ====================
// 날짜 형식 변환 함수
// ====================

/**
 * 날짜를 YYYY.MM.DD 형식의 문자열로 변환합니다.
 * @param date - 변환할 날짜
 * @returns YYYY.MM.DD 형식의 문자열
 */
export function formatSimpleDate(date: Date): string {
  return `${date.getFullYear()}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getDate().toString().padStart(2, '0')}`;
}

/**
 * 한국어 형식의 날짜 문자열로 변환합니다.
 * @param date - 변환할 날짜
 * @returns YYYY년 MM월 DD일 형식의 문자열
 */
export function formatKoreanDateString(date: Date): string {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

/**
 * 한국어 형식의 날짜시간 문자열로 변환합니다.
 * @param date - 변환할 날짜
 * @param includeSeconds - 초 포함 여부
 * @returns YYYY년 MM월 DD일 HH시 MM분 형식의 문자열
 */
export function formatKoreanDateTime(date: Date, includeSeconds: boolean = false): string {
  const dateStr = formatKoreanDateString(date);
  const timeStr = includeSeconds
    ? `${date.getHours()}시 ${date.getMinutes()}분 ${date.getSeconds()}초`
    : `${date.getHours()}시 ${date.getMinutes()}분`;
  return `${dateStr} ${timeStr}`;
}

/**
 * 날짜를 지정된 형식으로 변환합니다.
 * @param date - 변환할 날짜
 * @param format - 형식
 * @param options - 추가 옵션
 * @returns 형식화된 날짜 문자열
 */
export function formatDate(
  date: Date,
  format: DateFormat,
  _options: DateFormatOptions = {}
): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');

  switch (format) {
    case 'YYMMDD':
      return `${year.toString().slice(-2)}${month}${day}`;
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    case 'YYYY.MM.DD':
      return `${year}.${month}.${day}`;
    case 'YYYY/MM/DD':
      return `${year}/${month}/${day}`;
    case 'KOREAN':
      return formatKoreanDateString(date);
    default:
      return formatSimpleDate(date);
  }
}

/**
 * 시간을 지정된 형식으로 변환합니다.
 * @param date - 변환할 날짜
 * @param format - 시간 형식
 * @returns 형식화된 시간 문자열
 */
export function formatTime(date: Date, format: TimeFormat): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  const ms = date.getMilliseconds().toString().padStart(3, '0');

  switch (format) {
    case 'HH:MM':
      return `${hours}:${minutes}`;
    case 'HH:MM:SS':
      return `${hours}:${minutes}:${seconds}`;
    case 'HH:MM:SS.mmm':
      return `${hours}:${minutes}:${seconds}.${ms}`;
    case 'ISO':
      return date.toISOString();
    default:
      return `${hours}:${minutes}`;
  }
}

/**
 * 상대적인 시간을 문자열로 변환합니다.
 * @param date - 기준 날짜
 * @param now - 현재 시간 (선택사항)
 * @returns 상대적인 시간 문자열
 */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const diff = now.getTime() - date.getTime();
  const absDiff = Math.abs(diff);
  const isFuture = diff < 0;

  if (absDiff < TIME.MINUTE) {
    return isFuture ? '곧' : '방금 전';
  } else if (absDiff < TIME.HOUR) {
    const minutes = Math.floor(absDiff / TIME.MINUTE);
    return isFuture ? `${minutes}분 후` : `${minutes}분 전`;
  } else if (absDiff < TIME.DAY) {
    const hours = Math.floor(absDiff / TIME.HOUR);
    return isFuture ? `${hours}시간 후` : `${hours}시간 전`;
  } else if (absDiff < TIME.WEEK) {
    const days = Math.floor(absDiff / TIME.DAY);
    return isFuture ? `${days}일 후` : `${days}일 전`;
  } else if (absDiff < TIME.MONTH) {
    const weeks = Math.floor(absDiff / TIME.WEEK);
    return isFuture ? `${weeks}주 후` : `${weeks}주 전`;
  } else if (absDiff < TIME.YEAR) {
    const months = Math.floor(absDiff / TIME.MONTH);
    return isFuture ? `${months}달 후` : `${months}달 전`;
  } else {
    const years = Math.floor(absDiff / TIME.YEAR);
    return isFuture ? `${years}년 후` : `${years}년 전`;
  }
}

/**
 * 기간을 사람이 읽기 쉬운 형태로 변환합니다.
 * @param milliseconds - 기간 (밀리초)
 * @returns 읽기 쉬운 기간 문자열
 */
export function formatDuration(milliseconds: number): string {
  const timeSpan = getDetailedTimeDifference(new Date(0), new Date(milliseconds));
  const parts: string[] = [];

  if (timeSpan.years > 0) parts.push(`${timeSpan.years}년`);
  if (timeSpan.months > 0) parts.push(`${timeSpan.months}달`);
  if (timeSpan.days > 0) parts.push(`${timeSpan.days}일`);
  if (timeSpan.hours > 0) parts.push(`${timeSpan.hours}시간`);
  if (timeSpan.minutes > 0) parts.push(`${timeSpan.minutes}분`);
  if (timeSpan.seconds > 0 || parts.length === 0) parts.push(`${timeSpan.seconds}초`);

  return parts.join(' ');
}

// ====================
// 날짜 범위 유틸리티
// ====================

/**
 * 날짜 범위를 생성합니다.
 * @param start - 시작 날짜
 * @param end - 종료 날짜
 * @returns 날짜 범위 객체
 */
export function createDateRange(start: Date, end: Date): DateRange {
  return { start, end };
}

/**
 * 오늘의 날짜 범위를 생성합니다.
 * @returns 오늘의 시작과 끝 시간
 */
export function getTodayRange(): DateRange {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

/**
 * 이번 주의 날짜 범위를 생성합니다.
 * @returns 이번 주의 시작과 끝 시간
 */
export function getThisWeekRange(): DateRange {
  const now = new Date();
  const start = calculatePreviousSunday(now);
  start.setHours(0, 0, 0, 0);

  const end = calculateNextSunday(now);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

/**
 * 이번 달의 날짜 범위를 생성합니다.
 * @returns 이번 달의 시작과 끝 시간
 */
export function getThisMonthRange(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  start.setHours(0, 0, 0, 0);

  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

// ====================
// 타임존 관련 유틸리티
// ====================

/**
 * 한국 시간대로 변환합니다.
 * @param date - 변환할 날짜
 * @returns 한국 시간대의 날짜 문자열
 */
export function toKoreanTime(date: Date): string {
  return date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

/**
 * UTC 시간을 한국 시간으로 변환합니다.
 * @param utcDate - UTC 날짜
 * @returns 한국 시간대의 Date 객체
 */
export function utcToKorean(utcDate: Date): Date {
  const koreanTime = new Date(utcDate.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  return koreanTime;
}

/**
 * 한국 시간을 UTC 시간으로 변환합니다.
 * @param koreanDate - 한국 시간 날짜
 * @returns UTC 시간대의 Date 객체
 */
export function koreanToUtc(koreanDate: Date): Date {
  const utcTime = new Date(koreanDate.toLocaleString('en-US', { timeZone: 'UTC' }));
  return utcTime;
}

// ====================
// 검증 함수
// ====================

/**
 * 날짜 객체가 유효한지 확인합니다.
 * @param date - 확인할 날짜
 * @returns 유효한 날짜이면 true
 */
export function isValidDate(date: any): date is Date {
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * 날짜 문자열이 유효한 형식인지 확인합니다.
 * @param dateStr - 확인할 날짜 문자열
 * @param format - 예상 형식
 * @returns 유효한 형식이면 true
 */
export function isValidDateString(dateStr: string, format?: DateFormat): boolean {
  try {
    const date = parseDate(dateStr, format);
    return isValidDate(date);
  } catch {
    return false;
  }
}

/**
 * 날짜 범위가 유효한지 확인합니다.
 * @param range - 확인할 날짜 범위
 * @returns 유효한 범위이면 true
 */
export function isValidDateRange(range: DateRange): boolean {
  return isValidDate(range.start) && isValidDate(range.end) && range.start <= range.end;
}

// ====================
// 상수 및 기본값
// ====================

export const DEFAULT_DATE_FORMAT: DateFormat = 'YYYY.MM.DD';
export const DEFAULT_TIME_FORMAT: TimeFormat = 'HH:MM';
export const KOREAN_LOCALE = 'ko-KR';
export const SEOUL_TIMEZONE = 'Asia/Seoul';

/**
 * 한국 시간대의 현재 날짜를 반환합니다.
 * @returns 한국 시간대의 현재 Date 객체
 */
export function now(): Date {
  return new Date();
}

/**
 * 한국 시간대의 현재 타임스탬프를 반환합니다.
 * @returns 현재 타임스탬프 (밀리초)
 */
export function timestamp(): number {
  return Date.now();
}
