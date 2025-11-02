// src/services/UserNicknameService.js - 사용자 닉네임 관리 서비스

import { NicknameConstants } from '../config/NicknameConstants.js';
import { EmbedBuilder } from 'discord.js';

export class UserNicknameService {
  constructor(dbManager, platformTemplateService) {
    this.dbManager = dbManager;
    this.platformTemplateService = platformTemplateService;
  }

  /**
   * 닉네임 추가
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 사용자 ID
   * @param {number} platformId - 플랫폼 ID
   * @param {string} userIdentifier - 사용자 식별자 (Steam ID 등)
   * @returns {Promise<Object>} - 생성된 닉네임 정보
   */
  async addNickname(guildId, userId, platformId, userIdentifier) {
    // 유효성 검증
    this.validateUserIdentifier(userIdentifier);

    // 플랫폼 확인
    const platform = await this.platformTemplateService.getPlatformById(platformId);
    if (!platform || platform.guild_id !== guildId) {
      throw new Error(NicknameConstants.MESSAGES.PLATFORM_NOT_FOUND);
    }

    // 사용자의 전체 닉네임 개수 확인
    const totalCount = await this.getUserNicknameCount(guildId, userId);
    if (totalCount >= NicknameConstants.LIMITS.MAX_NICKNAMES_PER_USER) {
      throw new Error(NicknameConstants.MESSAGES.NICKNAME_LIMIT_REACHED);
    }

    // 플랫폼별 계정 개수 확인
    const platformAccountCount = await this.getAccountCount(guildId, userId, platformId);
    if (platformAccountCount >= NicknameConstants.LIMITS.MAX_ACCOUNTS_PER_PLATFORM) {
      throw new Error(NicknameConstants.MESSAGES.ACCOUNT_LIMIT_REACHED);
    }

    // 동일한 user_identifier 중복 확인
    const duplicateCheck = `
      SELECT id FROM user_nicknames
      WHERE guild_id = $1 AND user_id = $2 AND platform_id = $3 AND user_identifier = $4
    `;
    const duplicateResult = await this.dbManager.query(duplicateCheck, [guildId, userId, platformId, userIdentifier]);
    if (duplicateResult.rows.length > 0) {
      throw new Error(NicknameConstants.MESSAGES.DUPLICATE_IDENTIFIER);
    }

    // URL 생성
    const fullUrl = this.platformTemplateService.generateUrl(platform, userIdentifier);

    const query = `
      INSERT INTO user_nicknames (guild_id, user_id, platform_id, user_identifier, full_url)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const values = [guildId, userId, platformId, userIdentifier, fullUrl];

    const result = await this.dbManager.query(query, values);
    return result.rows[0];
  }

  /**
   * 닉네임 수정
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 사용자 ID
   * @param {number} platformId - 플랫폼 ID
   * @param {string} newUserIdentifier - 새 사용자 식별자
   * @returns {Promise<Object>} - 수정된 닉네임 정보
   */
  async updateNickname(guildId, userId, platformId, newUserIdentifier) {
    // 유효성 검증
    this.validateUserIdentifier(newUserIdentifier);

    // 닉네임 존재 확인
    const nickname = await this.getNickname(guildId, userId, platformId);
    if (!nickname) {
      throw new Error(NicknameConstants.MESSAGES.NICKNAME_NOT_FOUND);
    }

    // 플랫폼 정보 가져오기
    const platform = await this.platformTemplateService.getPlatformById(platformId);
    if (!platform) {
      throw new Error(NicknameConstants.MESSAGES.PLATFORM_NOT_FOUND);
    }

    // URL 생성
    const fullUrl = this.platformTemplateService.generateUrl(platform, newUserIdentifier);

    const query = `
      UPDATE user_nicknames
      SET user_identifier = $1, full_url = $2
      WHERE guild_id = $3 AND user_id = $4 AND platform_id = $5
      RETURNING *
    `;

    const values = [newUserIdentifier, fullUrl, guildId, userId, platformId];

    const result = await this.dbManager.query(query, values);
    return result.rows[0];
  }

  /**
   * 닉네임 삭제
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 사용자 ID
   * @param {number} platformId - 플랫폼 ID
   * @returns {Promise<boolean>} - 삭제 성공 여부
   */
  async deleteNickname(guildId, userId, platformId) {
    const query = `
      DELETE FROM user_nicknames
      WHERE guild_id = $1 AND user_id = $2 AND platform_id = $3
      RETURNING id
    `;

    const result = await this.dbManager.query(query, [guildId, userId, platformId]);
    return result.rowCount > 0;
  }

  /**
   * 사용자의 특정 플랫폼 닉네임 조회 (첫 번째 계정만 반환)
   * @deprecated 다중 계정 지원으로 getPlatformNicknames 사용 권장
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 사용자 ID
   * @param {number} platformId - 플랫폼 ID
   * @returns {Promise<Object|null>} - 닉네임 정보
   */
  async getNickname(guildId, userId, platformId) {
    const query = `
      SELECT * FROM user_nicknames
      WHERE guild_id = $1 AND user_id = $2 AND platform_id = $3
      LIMIT 1
    `;

    const result = await this.dbManager.query(query, [guildId, userId, platformId]);
    return result.rows[0] || null;
  }

  /**
   * 특정 플랫폼의 계정 개수 조회
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 사용자 ID
   * @param {number} platformId - 플랫폼 ID
   * @returns {Promise<number>} - 계정 개수
   */
  async getAccountCount(guildId, userId, platformId) {
    const query = `
      SELECT COUNT(*) as count FROM user_nicknames
      WHERE guild_id = $1 AND user_id = $2 AND platform_id = $3
    `;

    const result = await this.dbManager.query(query, [guildId, userId, platformId]);
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * 특정 플랫폼의 모든 계정 조회 (플랫폼 정보 포함)
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 사용자 ID
   * @param {number} platformId - 플랫폼 ID
   * @returns {Promise<Array>} - 계정 목록
   */
  async getPlatformNicknames(guildId, userId, platformId) {
    const query = `
      SELECT
        un.*,
        pt.platform_name,
        pt.emoji_unicode
      FROM user_nicknames un
      JOIN platform_templates pt ON un.platform_id = pt.id
      WHERE un.guild_id = $1 AND un.user_id = $2 AND un.platform_id = $3
      ORDER BY un.created_at ASC
    `;

    const result = await this.dbManager.query(query, [guildId, userId, platformId]);
    return result.rows;
  }

  /**
   * ID로 특정 닉네임 수정
   * @param {number} id - 닉네임 ID
   * @param {string} newUserIdentifier - 새 사용자 식별자
   * @returns {Promise<Object>} - 수정된 닉네임 정보
   */
  async updateNicknameById(id, newUserIdentifier) {
    // 유효성 검증
    this.validateUserIdentifier(newUserIdentifier);

    // 기존 닉네임 정보 조회
    const getQuery = `
      SELECT un.*, pt.*
      FROM user_nicknames un
      JOIN platform_templates pt ON un.platform_id = pt.id
      WHERE un.id = $1
    `;

    const existingResult = await this.dbManager.query(getQuery, [id]);
    if (existingResult.rows.length === 0) {
      throw new Error(NicknameConstants.MESSAGES.NICKNAME_NOT_FOUND);
    }

    const nickname = existingResult.rows[0];

    // URL 생성
    const fullUrl = this.platformTemplateService.generateUrl(nickname, newUserIdentifier);

    // 업데이트
    const updateQuery = `
      UPDATE user_nicknames
      SET user_identifier = $1, full_url = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `;

    const result = await this.dbManager.query(updateQuery, [newUserIdentifier, fullUrl, id]);
    return result.rows[0];
  }

  /**
   * ID로 특정 닉네임 삭제
   * @param {number} id - 닉네임 ID
   * @returns {Promise<boolean>} - 삭제 성공 여부
   */
  async deleteNicknameById(id) {
    const query = `
      DELETE FROM user_nicknames
      WHERE id = $1
      RETURNING id
    `;

    const result = await this.dbManager.query(query, [id]);
    return result.rowCount > 0;
  }

  /**
   * 사용자의 모든 닉네임 조회 (플랫폼 정보 포함)
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 사용자 ID
   * @returns {Promise<Array>} - 닉네임 목록
   */
  async getUserNicknames(guildId, userId) {
    const query = `
      SELECT
        un.*,
        pt.platform_name,
        pt.emoji_unicode,
        pt.display_order
      FROM user_nicknames un
      JOIN platform_templates pt ON un.platform_id = pt.id
      WHERE un.guild_id = $1 AND un.user_id = $2
      ORDER BY pt.display_order ASC, un.created_at ASC
    `;

    const result = await this.dbManager.query(query, [guildId, userId]);
    return result.rows;
  }

  /**
   * 사용자의 닉네임 개수 조회
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 사용자 ID
   * @returns {Promise<number>} - 닉네임 개수
   */
  async getUserNicknameCount(guildId, userId) {
    const query = `
      SELECT COUNT(*) as count FROM user_nicknames
      WHERE guild_id = $1 AND user_id = $2
    `;

    const result = await this.dbManager.query(query, [guildId, userId]);
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * 사용자 식별자 유효성 검증
   * @param {string} userIdentifier - 사용자 식별자
   */
  validateUserIdentifier(userIdentifier) {
    if (!userIdentifier || userIdentifier.trim().length === 0) {
      throw new Error('사용자 ID는 필수입니다.');
    }

    if (userIdentifier.length > NicknameConstants.LIMITS.USER_IDENTIFIER_MAX) {
      throw new Error(`사용자 ID는 최대 ${NicknameConstants.LIMITS.USER_IDENTIFIER_MAX}자까지 가능합니다.`);
    }
  }

  /**
   * 음성 채널용 닉네임 임베드 생성 (플랫폼별 그룹화)
   * @param {Object} user - 사용자 정보
   * @param {Object} member - 길드 멤버 정보 (별명 표시용)
   * @param {Array} nicknames - 닉네임 목록
   * @returns {Object} - 임베드와 버튼
   */
  createVoiceChannelNicknameEmbed(user, member, nicknames) {
    const displayName = member?.displayName || user.displayName || user.username;

    const embed = new EmbedBuilder()
      .setColor(NicknameConstants.COLORS.INFO)
      .setAuthor({
        name: displayName,
        iconURL: user.displayAvatarURL()
      });

    if (nicknames.length === 0) {
      embed.setDescription('등록된 닉네임이 없습니다.');
      return { embeds: [embed] };
    }

    // 플랫폼별로 그룹화
    const groupedByPlatform = {};
    nicknames.forEach((nickname) => {
      const platformKey = `${nickname.platform_id}`;
      if (!groupedByPlatform[platformKey]) {
        groupedByPlatform[platformKey] = {
          platform_name: nickname.platform_name,
          emoji_unicode: nickname.emoji_unicode,
          display_order: nickname.display_order,
          accounts: [],
        };
      }
      groupedByPlatform[platformKey].accounts.push(nickname);
    });

    // 플랫폼별로 필드 추가
    Object.values(groupedByPlatform)
      .sort((a, b) => a.display_order - b.display_order)
      .forEach((platform) => {
        const emoji = platform.emoji_unicode || NicknameConstants.DEFAULT_EMOJIS.PLATFORM;

        // 계정이 1개인 경우
        if (platform.accounts.length === 1) {
          const account = platform.accounts[0];
          const value = account.full_url
            ? `ID: \`${account.user_identifier}\`\n[프로필 보기 ${NicknameConstants.DEFAULT_EMOJIS.LINK}](${account.full_url})`
            : `ID: \`${account.user_identifier}\``;

          embed.addFields({
            name: `${emoji} ${platform.platform_name}`,
            value: value,
            inline: false,
          });
        }
        // 계정이 여러 개인 경우
        else {
          const accountLines = platform.accounts.map((account, index) => {
            const linkText = account.full_url
              ? `[프로필 보기 ${NicknameConstants.DEFAULT_EMOJIS.LINK}](${account.full_url})`
              : '';
            return `${index + 1}. ID: \`${account.user_identifier}\`${linkText ? ' ' + linkText : ''}`;
          });

          embed.addFields({
            name: `${emoji} ${platform.platform_name} (${platform.accounts.length}개 계정)`,
            value: accountLines.join('\n'),
            inline: false,
          });
        }
      });

    return { embeds: [embed] };
  }

  /**
   * 내 정보 조회용 임베드 생성 (플랫폼별 그룹화)
   * @param {Object} user - 사용자 정보
   * @param {Object} member - 길드 멤버 정보 (별명 표시용)
   * @param {Array} nicknames - 닉네임 목록
   * @returns {Object} - 임베드와 버튼
   */
  createMyNicknamesEmbed(user, member, nicknames) {
    const displayName = member?.displayName || user.displayName || user.username;

    const embed = new EmbedBuilder()
      .setColor(NicknameConstants.COLORS.INFO)
      .setAuthor({
        name: displayName,
        iconURL: user.displayAvatarURL()
      });

    if (nicknames.length === 0) {
      embed.setDescription(NicknameConstants.MESSAGES.NO_NICKNAMES);
      return { embeds: [embed] };
    }

    // 플랫폼별로 그룹화
    const groupedByPlatform = {};
    nicknames.forEach((nickname) => {
      const platformKey = `${nickname.platform_id}`;
      if (!groupedByPlatform[platformKey]) {
        groupedByPlatform[platformKey] = {
          platform_name: nickname.platform_name,
          emoji_unicode: nickname.emoji_unicode,
          display_order: nickname.display_order,
          accounts: [],
        };
      }
      groupedByPlatform[platformKey].accounts.push(nickname);
    });

    // 플랫폼별로 필드 추가
    Object.values(groupedByPlatform)
      .sort((a, b) => a.display_order - b.display_order)
      .forEach((platform) => {
        const emoji = platform.emoji_unicode || NicknameConstants.DEFAULT_EMOJIS.PLATFORM;

        // 계정이 1개인 경우
        if (platform.accounts.length === 1) {
          const account = platform.accounts[0];
          const value = account.full_url
            ? `ID: \`${account.user_identifier}\`\n[프로필 보기 ${NicknameConstants.DEFAULT_EMOJIS.LINK}](${account.full_url})`
            : `ID: \`${account.user_identifier}\``;

          embed.addFields({
            name: `${emoji} ${platform.platform_name}`,
            value: value,
            inline: false,
          });
        }
        // 계정이 여러 개인 경우
        else {
          const accountLines = platform.accounts.map((account, index) => {
            const linkText = account.full_url
              ? `[프로필 보기 ${NicknameConstants.DEFAULT_EMOJIS.LINK}](${account.full_url})`
              : '';
            return `${index + 1}. ID: \`${account.user_identifier}\`${linkText ? ' ' + linkText : ''}`;
          });

          embed.addFields({
            name: `${emoji} ${platform.platform_name} (${platform.accounts.length}개 계정)`,
            value: accountLines.join('\n'),
            inline: false,
          });
        }
      });

    return { embeds: [embed] };
  }
}
