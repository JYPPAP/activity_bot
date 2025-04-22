// src/utils/dateUtils.js - 날짜 관련 유틸리티 함수

/**
 * YYMMDD 형식의 문자열을 Date 객체로 변환합니다.
 * @param {string} dateStr - YYMMDD 형식 날짜 문자열 (예: 250510)
 * @returns {Date} - 변환된 Date 객체
 */
export function parseYYMMDD(dateStr) {
  if (!dateStr || !/^\d{6}$/.test(dateStr)) {
    throw new Error("날짜는 YYMMDD 형식이어야 합니다. (예: 250510)");
  }

  const year = 2000 + parseInt(dateStr.substring(0, 2), 10);
  const month = parseInt(dateStr.substring(2, 4), 10) - 1; // JavaScript의 월은 0부터 시작
  const day = parseInt(dateStr.substring(4, 6), 10);

  const date = new Date(year, month, day);

  // 유효한 날짜인지 검증
  if (isNaN(date.getTime())) {
    throw new Error("유효하지 않은 날짜입니다.");
  }

  return date;
}

/**
 * 지정된 날짜의 다음 일요일을 계산합니다.
 * 입력된 날짜가 일요일인 경우 다음 주 일요일을 반환합니다.
 * @param {Date} date - 기준 날짜
 * @returns {Date} - 다음 일요일 날짜
 */
export function calculateNextSunday(date) {
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
 * 날짜를 YYYY.MM.DD 형식의 문자열로 변환합니다.
 * @param {Date} date - 변환할 날짜
 * @returns {string} - YYYY.MM.DD 형식의 문자열
 */
export function formatSimpleDate(date) {
  return `${date.getFullYear()}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getDate().toString().padStart(2, '0')}`;
}

/**
 * 한국어 형식의 날짜 문자열로 변환합니다.
 * @param {Date} date - 변환할 날짜
 * @returns {string} - YYYY년 MM월 DD일 형식의 문자열
 */
export function formatKoreanDateString(date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

/**
 * 현재 시간으로부터 7일(일주일) 후의 날짜를 반환합니다.
 * @returns {Date} - 현재로부터 7일 후 날짜
 */
export function getOneWeekLater() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date;
}

/**
 * 현재 날짜가 지정된 날짜보다 이후인지 확인합니다.
 * @param {Date} targetDate - 비교할 대상 날짜
 * @returns {boolean} - 현재 날짜가 대상 날짜보다 이후이면 true
 */
export function isAfterDate(targetDate) {
  const now = new Date();
  return now > targetDate;
}