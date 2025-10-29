// src/services/PlatformTemplateService.js - 플랫폼 템플릿 관리 서비스

import { NicknameConstants } from '../config/NicknameConstants.js';

export class PlatformTemplateService {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  /**
   * 플랫폼 템플릿 추가
   * @param {string} guildId - 길드 ID
   * @param {Object} platformData - 플랫폼 데이터
   * @returns {Promise<Object>} - 생성된 플랫폼 정보
   */
  async addPlatform(guildId, platformData) {
    const { platformName, emojiUnicode, baseUrl, urlPattern } = platformData;

    // 유효성 검증
    this.validatePlatformData(platformData);

    // 길드의 플랫폼 개수 확인
    const count = await this.getPlatformCount(guildId);
    if (count >= NicknameConstants.LIMITS.MAX_PLATFORMS_PER_GUILD) {
      throw new Error(NicknameConstants.MESSAGES.PLATFORM_LIMIT_REACHED);
    }

    // 중복 확인
    const existing = await this.getPlatformByName(guildId, platformName);
    if (existing) {
      throw new Error(`이미 "${platformName}" 플랫폼이 존재합니다.`);
    }

    // 다음 display_order 계산
    const maxOrder = await this.getMaxDisplayOrder(guildId);
    const displayOrder = (maxOrder ?? -1) + 1;

    const query = `
      INSERT INTO platform_templates (guild_id, platform_name, emoji_unicode, base_url, url_pattern, display_order)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const values = [
      guildId,
      platformName,
      emojiUnicode || NicknameConstants.DEFAULT_EMOJIS.PLATFORM,
      baseUrl,
      urlPattern || NicknameConstants.DEFAULT_URL_PATTERN,
      displayOrder,
    ];

    const result = await this.dbManager.query(query, values);
    return result.rows[0];
  }

  /**
   * 플랫폼 템플릿 수정
   * @param {number} platformId - 플랫폼 ID
   * @param {string} guildId - 길드 ID
   * @param {Object} updateData - 수정할 데이터
   * @returns {Promise<Object>} - 수정된 플랫폼 정보
   */
  async updatePlatform(platformId, guildId, updateData) {
    const { platformName, emojiUnicode, baseUrl, urlPattern } = updateData;

    // 플랫폼 존재 확인
    const platform = await this.getPlatformById(platformId);
    if (!platform || platform.guild_id !== guildId) {
      throw new Error(NicknameConstants.MESSAGES.PLATFORM_NOT_FOUND);
    }

    // 유효성 검증
    if (platformName) {
      this.validatePlatformName(platformName);
    }
    if (baseUrl) {
      this.validateBaseUrl(baseUrl);
    }

    const query = `
      UPDATE platform_templates
      SET
        platform_name = COALESCE($1, platform_name),
        emoji_unicode = COALESCE($2, emoji_unicode),
        base_url = COALESCE($3, base_url),
        url_pattern = COALESCE($4, url_pattern)
      WHERE id = $5 AND guild_id = $6
      RETURNING *
    `;

    const values = [platformName, emojiUnicode, baseUrl, urlPattern, platformId, guildId];

    const result = await this.dbManager.query(query, values);
    return result.rows[0];
  }

  /**
   * 플랫폼 템플릿 삭제
   * @param {number} platformId - 플랫폼 ID
   * @param {string} guildId - 길드 ID
   * @returns {Promise<boolean>} - 삭제 성공 여부
   */
  async deletePlatform(platformId, guildId) {
    const query = `
      DELETE FROM platform_templates
      WHERE id = $1 AND guild_id = $2
      RETURNING id
    `;

    const result = await this.dbManager.query(query, [platformId, guildId]);
    return result.rowCount > 0;
  }

  /**
   * 플랫폼 템플릿 조회 (ID)
   * @param {number} platformId - 플랫폼 ID
   * @returns {Promise<Object|null>} - 플랫폼 정보
   */
  async getPlatformById(platformId) {
    const query = `
      SELECT * FROM platform_templates
      WHERE id = $1
    `;

    const result = await this.dbManager.query(query, [platformId]);
    return result.rows[0] || null;
  }

  /**
   * 플랫폼 템플릿 조회 (이름)
   * @param {string} guildId - 길드 ID
   * @param {string} platformName - 플랫폼명
   * @returns {Promise<Object|null>} - 플랫폼 정보
   */
  async getPlatformByName(guildId, platformName) {
    const query = `
      SELECT * FROM platform_templates
      WHERE guild_id = $1 AND platform_name = $2
    `;

    const result = await this.dbManager.query(query, [guildId, platformName]);
    return result.rows[0] || null;
  }

  /**
   * 길드의 모든 플랫폼 템플릿 조회
   * @param {string} guildId - 길드 ID
   * @returns {Promise<Array>} - 플랫폼 목록
   */
  async getAllPlatforms(guildId) {
    const query = `
      SELECT * FROM platform_templates
      WHERE guild_id = $1
      ORDER BY display_order ASC, created_at ASC
    `;

    const result = await this.dbManager.query(query, [guildId]);
    return result.rows;
  }

  /**
   * 길드의 플랫폼 개수 조회
   * @param {string} guildId - 길드 ID
   * @returns {Promise<number>} - 플랫폼 개수
   */
  async getPlatformCount(guildId) {
    const query = `
      SELECT COUNT(*) as count FROM platform_templates
      WHERE guild_id = $1
    `;

    const result = await this.dbManager.query(query, [guildId]);
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * 최대 display_order 조회
   * @param {string} guildId - 길드 ID
   * @returns {Promise<number|null>} - 최대 display_order
   */
  async getMaxDisplayOrder(guildId) {
    const query = `
      SELECT MAX(display_order) as max_order FROM platform_templates
      WHERE guild_id = $1
    `;

    const result = await this.dbManager.query(query, [guildId]);
    return result.rows[0]?.max_order;
  }

  /**
   * URL 생성
   * @param {Object} platform - 플랫폼 정보
   * @param {string} userId - 사용자 ID
   * @returns {string|null} - 생성된 URL (base_url이 없으면 null)
   */
  generateUrl(platform, userId) {
    const { base_url, url_pattern } = platform;

    // Base URL이 없으면 null 반환 (링크 없이 ID만 표시)
    if (!base_url || base_url.trim().length === 0) {
      return null;
    }

    let url = url_pattern || NicknameConstants.DEFAULT_URL_PATTERN;

    // 플레이스홀더 치환
    url = url.replace(NicknameConstants.URL_PLACEHOLDERS.BASE_URL, base_url);
    url = url.replace(NicknameConstants.URL_PLACEHOLDERS.USER_ID, userId);

    return url;
  }

  /**
   * 플랫폼 데이터 유효성 검증
   * @param {Object} platformData - 플랫폼 데이터
   */
  validatePlatformData(platformData) {
    const { platformName, baseUrl } = platformData;

    this.validatePlatformName(platformName);

    // Base URL이 제공된 경우에만 검증
    if (baseUrl) {
      this.validateBaseUrl(baseUrl);
    }
  }

  /**
   * 플랫폼명 유효성 검증
   * @param {string} platformName - 플랫폼명
   */
  validatePlatformName(platformName) {
    if (!platformName || platformName.trim().length === 0) {
      throw new Error('플랫폼명은 필수입니다.');
    }

    if (platformName.length > NicknameConstants.LIMITS.PLATFORM_NAME_MAX) {
      throw new Error(`플랫폼명은 최대 ${NicknameConstants.LIMITS.PLATFORM_NAME_MAX}자까지 가능합니다.`);
    }
  }

  /**
   * Base URL 유효성 검증
   * @param {string} baseUrl - Base URL
   */
  validateBaseUrl(baseUrl) {
    // Base URL이 비어있으면 검증 패스 (선택사항)
    if (!baseUrl || baseUrl.trim().length === 0) {
      return;
    }

    if (baseUrl.length > NicknameConstants.LIMITS.BASE_URL_MAX) {
      throw new Error(`Base URL은 최대 ${NicknameConstants.LIMITS.BASE_URL_MAX}자까지 가능합니다.`);
    }

    // URL 형식 간단 검증
    try {
      new URL(baseUrl);
    } catch (error) {
      throw new Error(NicknameConstants.MESSAGES.INVALID_URL);
    }
  }
}
