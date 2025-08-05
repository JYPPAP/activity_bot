// src/utils/TextProcessor.js - 텍스트 처리 유틸리티
import { DiscordConstants } from '../config/DiscordConstants.js';

export class TextProcessor {
  /**
   * 별명에서 [대기] 또는 [관전] 태그 제거
   * @param {string} displayName - 원본 별명
   * @returns {string} - 정리된 별명
   */
  static cleanNickname(displayName) {
    if (!displayName) return '';
    
    return displayName
      .replace(/^\[대기\]\s*/, '')
      .replace(/^\[관전\]\s*/, '');
  }
  
  /**
   * 태그를 역할 멘션으로 변환
   * @param {string|string[]} tags - 태그 문자열 (쉼표로 구분) 또는 태그 배열
   * @param {Guild} guild - 길드 객체
   * @returns {Promise<string>} - 역할 멘션 문자열
   */
  static async convertTagsToRoleMentions(tags, guild) {
    if (!tags || !guild) return '';
    
    try {
      // 배열인 경우 문자열로 변환
      const tagsString = Array.isArray(tags) ? tags.join(', ') : tags;
      const tagArray = tagsString.split(',').map(tag => tag.trim()).filter(tag => tag);
      const roleMentions = [];
      
      for (const tag of tagArray) {
        // 이미 @멘션 형태인 경우
        if (tag.startsWith('@')) {
          const roleName = tag.substring(1); // @ 제거
          const role = guild.roles.cache.find(r => 
            r.name.toLowerCase() === roleName.toLowerCase() || 
            r.name.includes(roleName)
          );
          
          if (role) {
            roleMentions.push(`<@&${role.id}>`);
          } else {
            roleMentions.push(`**${tag}**`); // 역할을 찾을 수 없으면 굵은 글씨로
          }
        } else {
          // 기존 로직 (@ 없는 경우)
          const role = guild.roles.cache.find(r => 
            r.name.toLowerCase() === tag.toLowerCase() || 
            r.name.includes(tag)
          );
          
          if (role) {
            roleMentions.push(`<@&${role.id}>`);
          } else {
            roleMentions.push(`**${tag}**`);
          }
        }
      }
      
      return roleMentions.join(' ');
    } catch (error) {
      console.error('태그를 역할 멘션으로 변환 중 오류:', error);
      return tags; // 오류 시 원본 반환
    }
  }
  
  /**
   * 참여자 목록을 포맷팅
   * @param {Array} participants - 참여자 배열
   * @returns {string} - 포맷팅된 참여자 목록
   */
  static formatParticipantList(participants) {
    if (!participants || participants.length === 0) {
      return '참여자가 없습니다.';
    }
    
    return participants
      .map((participant, index) => `${index + 1}. ${participant.displayName}`)
      .join('\n');
  }
  
  /**
   * 시간을 한국 시간으로 포맷팅
   * @param {Date} date - 날짜 객체 (선택사항, 기본값: 현재 시간)
   * @returns {string} - 포맷팅된 시간 문자열
   */
  static formatKoreanTime(date = new Date()) {
    return date.toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
  
  /**
   * 마크다운으로 큰 텍스트 생성
   * @param {string} text - 원본 텍스트
   * @param {string} level - 헤더 레벨 ('##', '###' 등)
   * @returns {string} - 마크다운 텍스트
   */
  static createLargeText(text, level = '##') {
    return `${level} ${text}`;
  }
  
  /**
   * 텍스트가 Discord 제한을 초과하는지 확인
   * @param {string} text - 확인할 텍스트
   * @param {number} limit - 제한 길이
   * @returns {boolean} - 제한 초과 여부
   */
  static exceedsLimit(text, limit) {
    return text && text.length > limit;
  }
  
  /**
   * 텍스트를 지정된 길이로 자르기
   * @param {string} text - 원본 텍스트
   * @param {number} maxLength - 최대 길이
   * @param {string} suffix - 자른 후 추가할 접미사
   * @returns {string} - 잘린 텍스트
   */
  static truncateText(text, maxLength, suffix = '...') {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength - suffix.length) + suffix;
  }
  
  /**
   * 별명에 특수 태그가 포함되어 있는지 확인
   * @param {string} displayName - 확인할 별명
   * @returns {object} - { hasWaitTag: boolean, hasSpectateTag: boolean }
   */
  static checkSpecialTags(displayName) {
    if (!displayName) return { hasWaitTag: false, hasSpectateTag: false };
    
    return {
      hasWaitTag: displayName.includes(DiscordConstants.SPECIAL_TAGS.WAITING),
      hasSpectateTag: displayName.includes(DiscordConstants.SPECIAL_TAGS.SPECTATING)
    };
  }
  
  /**
   * 별명에 대기/관전 태그가 있는지 확인
   * @param {string} displayName - 확인할 별명
   * @returns {boolean} - 태그 존재 여부
   */
  static hasWaitOrSpectateTag(displayName) {
    const { hasWaitTag, hasSpectateTag } = this.checkSpecialTags(displayName);
    return hasWaitTag || hasSpectateTag;
  }
}