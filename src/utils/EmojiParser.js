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
      const emojiId = customMatch[3];
      const emojiName = customMatch[2];

      // ID가 유효한지 검증 (19자리 snowflake ID)
      if (!/^\d{17,19}$/.test(emojiId)) {
        console.warn(`[EmojiParser] Invalid emoji ID: ${emojiId}, using fallback`);
        return fallback;
      }

      // Discord API 호환 형식으로 반환 (animated 필드 제거)
      return {
        id: emojiId,
        name: emojiName
      };
    }

    // 유니코드 이모지 (길이 체크)
    if (trimmed.length > 0 && trimmed.length <= 10) {
      return trimmed;
    }

    return fallback;
  }

  /**
   * 이모지 입력을 서버 이모지로 변환 (사용자 편의 기능)
   * @param {string} emojiInput - 사용자 입력 (:name: 또는 <:name:id> 또는 유니코드)
   * @param {Guild} guild - Discord 서버
   * @returns {{emoji: string, error?: string}} - 변환된 이모지 또는 에러
   */
  static resolveEmoji(emojiInput, guild) {
    if (!emojiInput || typeof emojiInput !== 'string') {
      return { error: '❌ 이모지를 입력해주세요.' };
    }

    const trimmed = emojiInput.trim();

    // 이미 <:name:id> 형태면 그대로 반환
    if (trimmed.match(/^<a?:[a-zA-Z0-9_]+:[0-9]+>$/)) {
      return { emoji: trimmed };
    }

    // 유니코드 이모지면 그대로 반환
    if (trimmed.length > 0 && trimmed.length <= 10 && !trimmed.startsWith(':')) {
      return { emoji: trimmed };
    }

    // :name: 형태 처리 (사용자가 복사-붙여넣기한 경우)
    const shortcutMatch = trimmed.match(/^:([a-zA-Z0-9_]+):$/);
    if (shortcutMatch) {
      const emojiName = shortcutMatch[1];

      // 서버 이모지에서 찾기
      const foundEmoji = guild.emojis.cache.find(e => e.name === emojiName);

      if (foundEmoji) {
        // <:name:id> 또는 <a:name:id> 형태로 변환
        const prefix = foundEmoji.animated ? '<a:' : '<:';
        return { emoji: `${prefix}${foundEmoji.name}:${foundEmoji.id}>` };
      }

      return {
        error: `❌ 서버에서 \`:${emojiName}:\` 이모지를 찾을 수 없습니다.\n\n사용 가능한 방법:\n1. 유니코드 이모지 사용: 🎮 💬 🎯\n2. 서버 커스텀 이모지 복사-붙여넣기: :${emojiName}:\n3. 이모지를 Discord에서 우클릭 > 링크 복사`
      };
    }

    return {
      error: `❌ 유효하지 않은 이모지 형식입니다.\n\n올바른 형식:\n- 유니코드: 🎮 💬 🎯\n- 커스텀 (복사-붙여넣기): :wave_steam:`
    };
  }

  /**
   * 이모지 형식 검증 (저장 전 데이터베이스 형식 검증)
   * @param {string} emojiValue - 저장될 이모지 (<:name:id> 또는 유니코드)
   * @returns {{valid: boolean, error?: string}}
   */
  static validate(emojiValue) {
    if (!emojiValue || emojiValue.trim().length === 0) {
      return { valid: false, error: '❌ 이모지를 입력해주세요.' };
    }

    const trimmed = emojiValue.trim();

    // 커스텀 이모지 형식 체크 <:name:id> 또는 <a:name:id>
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
    if (trimmed.length <= 10) {
      return { valid: true };
    }

    return {
      valid: false,
      error: `❌ 유효하지 않은 이모지 형식입니다.\n\n올바른 형식:\n- 유니코드: 🎮 💬 🎯\n- 커스텀: <:이름:ID>`
    };
  }
}
