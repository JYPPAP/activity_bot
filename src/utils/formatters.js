// src/utils/formatters.js - 포맷팅 유틸리티

/**
 * 밀리초 단위의 시간을 읽기 쉬운 형식으로 변환합니다.
 * @param {number} totalTime - 밀리초 단위의 시간
 * @returns {string} - "시간 분" 형식의 문자열
 */
export const formatTime = (totalTime) => {
  const hours = Math.floor(totalTime / 1000 / 60 / 60);
  const minutes = Math.floor((totalTime / 1000 / 60) % 60);
  return `${hours}시간 ${minutes}분`;
};

/**
 * 날짜를 한국 표준시 형식으로 포맷팅합니다.
 * @param {Date|number} date - 포맷팅할 날짜 또는 타임스탬프
 * @returns {string} - 포맷팅된 날짜 문자열
 */
export const formatKoreanDate = (date) => {
  const dateObj = date instanceof Date ? date : new Date(date);
  return dateObj.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
};

/**
 * 멤버 목록 텍스트를 생성합니다.
 * @param {Array<string>} members - 멤버 이름 배열
 * @returns {string} - 포맷팅된 멤버 목록 문자열
 */
export const formatMembersList = (members = []) => {
  const count = members?.length || 0;
  const list = count > 0 ? members.map(member => `\`${member}\``).join(' ') : '없음';
  return `**현재 멤버: (${count}명)**\n${list}`;
};

/**
 * 역할 이름에서 @ 기호를 제거합니다.
 * @param {string} roleName - 역할 이름
 * @returns {string} - @ 기호가 제거된 역할 이름
 */
export const cleanRoleName = (roleName) => {
  return roleName.replace(/@/g, '');
};