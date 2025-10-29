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

    // 사용자의 닉네임 개수 확인
    const count = await this.getUserNicknameCount(guildId, userId);
    if (count >= NicknameConstants.LIMITS.MAX_NICKNAMES_PER_USER) {
      throw new Error(NicknameConstants.MESSAGES.NICKNAME_LIMIT_REACHED);
    }

    // 중복 확인
    const existing = await this.getNickname(guildId, userId, platformId);
    if (existing) {
      throw new Error(NicknameConstants.MESSAGES.ALREADY_REGISTERED);
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
   * 사용자의 특정 플랫폼 닉네임 조회
   * @param {string} guildId - 길드 ID
   * @param {string} userId - 사용자 ID
   * @param {number} platformId - 플랫폼 ID
   * @returns {Promise<Object|null>} - 닉네임 정보
   */
  async getNickname(guildId, userId, platformId) {
    const query = `
      SELECT * FROM user_nicknames
      WHERE guild_id = $1 AND user_id = $2 AND platform_id = $3
    `;

    const result = await this.dbManager.query(query, [guildId, userId, platformId]);
    return result.rows[0] || null;
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
   * 음성 채널용 닉네임 임베드 생성
   * @param {Object} user - 사용자 정보
   * @param {Array} nicknames - 닉네임 목록
   * @returns {Object} - 임베드와 버튼
   */
  createVoiceChannelNicknameEmbed(user, nicknames) {
    const embed = new EmbedBuilder()
      .setColor(NicknameConstants.COLORS.PRIMARY)
      .setTitle(`${NicknameConstants.DEFAULT_EMOJIS.VIEW} ${user.displayName || user.username}님의 게임 정보`)
      .setTimestamp();

    if (nicknames.length === 0) {
      embed.setDescription('등록된 닉네임이 없습니다.');
      return { embeds: [embed] };
    }

    // 필드 추가 - URL이 있으면 프로필 보기 링크 표시, 없으면 ID만 표시
    nicknames.forEach((nickname) => {
      const emoji = nickname.emoji_unicode || NicknameConstants.DEFAULT_EMOJIS.PLATFORM;
      const value = nickname.full_url
        ? `\`${nickname.user_identifier}\`\n[프로필 보기 ${NicknameConstants.DEFAULT_EMOJIS.LINK}](${nickname.full_url})`  // URL 있음
        : `\`${nickname.user_identifier}\``;  // URL 없음: ID만

      embed.addFields({
        name: `${emoji} ${nickname.platform_name}`,
        value: value,
        inline: true,
      });
    });

    return { embeds: [embed] };
  }

  /**
   * 내 정보 조회용 임베드 생성
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

    // 필드 추가 - URL이 있으면 프로필 보기 링크 표시, 없으면 ID만 표시
    nicknames.forEach((nickname) => {
      const emoji = nickname.emoji_unicode || NicknameConstants.DEFAULT_EMOJIS.PLATFORM;
      const value = nickname.full_url
        ? `ID: \`${nickname.user_identifier}\`\n[프로필 보기 ${NicknameConstants.DEFAULT_EMOJIS.LINK}](${nickname.full_url})`
        : `ID: \`${nickname.user_identifier}\``;

      embed.addFields({
        name: `${emoji} ${nickname.platform_name}`,
        value: value,
        inline: false,
      });
    });

    return { embeds: [embed] };
  }
}
