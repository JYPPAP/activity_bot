/**
 * Discord 이모지 파싱 및 검증 유틸리티
 */
export class EmojiParser {
  /**
   * Discord 이모지를 파싱하여 적절한 형식으로 변환
   * @param {string} emojiValue - <:name:id> 또는 유니코드 이모지
   * @param {string} fallback - 기본 이모지
   * @returns {string | object} - 유니코드 문자열 또는 {id, name} 객체
   */
  static parse(emojiValue, fallback = '🎮') {
    if (!emojiValue || typeof emojiValue !== 'string') {
      return fallback;
    }

    const trimmed = emojiValue.trim();

    // 커스텀 이모지 파싱: <:name:id> 또는 <a:name:id>
    const customMatch = trimmed.match(/^<(a)?:([a-zA-Z0-9_]+):([0-9]+)>$/);
    if (customMatch) {
      return {
        id: customMatch[3],
        name: customMatch[2],
        animated: !!customMatch[1]
      };
    }

    // 유니코드 이모지 (길이 체크)
    if (trimmed.length > 0 && trimmed.length <= 10) {
      return trimmed;
    }

    return fallback;
  }

  /**
   * 이모지 형식 검증
   * @param {string} emojiValue
   * @returns {{valid: boolean, error?: string}}
   */
  static validate(emojiValue) {
    if (!emojiValue || emojiValue.trim().length === 0) {
      return { valid: false, error: '❌ 이모지를 입력해주세요.' };
    }

    const trimmed = emojiValue.trim();

    // 커스텀 이모지 형식 체크
    const customMatch = trimmed.match(/^<(a)?:([a-zA-Z0-9_]+):([0-9]+)>$/);
    if (customMatch) {
      const name = customMatch[2];
      if (name.length > 30) {
        return {
          valid: false,
          error: `❌ 이모지 이름이 너무 깁니다 (최대 30자, 현재 ${name.length}자)\n현재: ${name}`
        };
      }
      return { valid: true };
    }

    // 유니코드 이모지 체크
    if (trimmed.length > 10) {
      return {
        valid: false,
        error: `❌ 유효하지 않은 이모지 형식입니다.\n\n올바른 형식:\n- 유니코드: 🎮 💬 🎯\n- 커스텀: <:이름:ID>`
      };
    }

    return { valid: true };
  }
}
