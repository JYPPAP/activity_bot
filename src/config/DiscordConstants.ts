// src/config/DiscordConstants.ts - Discord 관련 상수
import { ChannelType } from 'discord.js';

// 채널 타입 인터페이스
interface ChannelTypes {
  readonly GUILD_VOICE: ChannelType.GuildVoice;
  readonly GUILD_FORUM: ChannelType.GuildForum;
}

// 커스텀 ID 접두사 인터페이스
interface CustomIdPrefixes {
  readonly VOICE_CONNECT: 'voice_connect_';
  readonly VOICE_CLOSE: 'voice_close_';
  readonly VOICE_SPECTATE: 'voice_spectate_';
  readonly VOICE_WAIT: 'voice_wait_';
  readonly VOICE_RESET: 'voice_reset_';
  readonly RECRUITMENT_MODAL: 'recruitment_modal_';
  readonly RECRUITMENT_METHOD: 'recruitment_method_';
  readonly ROLE_BUTTON: 'role_btn_';
  readonly ROLE_COMPLETE: 'role_complete_';
  readonly STANDALONE_ROLE_BUTTON: 'standalone_role_btn_';
  readonly STANDALONE_ROLE_COMPLETE: 'standalone_role_complete';
  readonly EXISTING_POST_SELECT: 'existing_post_select_';
}

// 메서드 값 인터페이스
interface MethodValues {
  readonly NEW_FORUM: 'new_forum';
  readonly NEW_FORUM_PREFIX: 'new_forum_';
  readonly EXISTING_FORUM: 'existing_forum';
  readonly EXISTING_FORUM_PREFIX: 'existing_forum_';
}

// 이모지 인터페이스
interface Emojis {
  readonly VOICE: '🔊';
  readonly PARTICIPANTS: '👥';
  readonly TIME: '⏰';
  readonly LINK: '🔗';
  readonly TARGET: '🎯';
  readonly USER: '👤';
  readonly TAGS: '🏷️';
  readonly DESCRIPTION: '📝';
  readonly RECRUITER: '👤';
  readonly GAME: '🎮';
  readonly SUCCESS: '✅';
  readonly ERROR: '❌';
  readonly WARNING: '⚠️';
  readonly SPECTATOR: '👁️';
  readonly RESET: '🔄';
  readonly CONNECT: '🎯';
  readonly CLOSE: '🔒';
}

// 특수 태그 인터페이스
interface SpecialTags {
  readonly WAITING: '[대기]';
  readonly SPECTATING: '[관전]';
}

// Discord 제한사항 인터페이스
interface DiscordLimits {
  readonly EMBED_DESCRIPTION_MAX: 4096;
  readonly EMBED_FIELD_VALUE_MAX: 1024;
  readonly EMBED_TITLE_MAX: 256;
  readonly MODAL_TITLE_MAX: 100;
  readonly MODAL_DESCRIPTION_MAX: 1000;
  readonly BUTTON_LABEL_MAX: 80;
  readonly SELECT_OPTION_LABEL_MAX: 100;
}

// 추가 Discord 제한사항 (확장)
interface ExtendedDiscordLimits extends DiscordLimits {
  readonly MESSAGE_CONTENT_MAX: 2000;
  readonly EMBED_FIELDS_MAX: 25;
  readonly EMBED_FOOTER_MAX: 2048;
  readonly EMBED_AUTHOR_NAME_MAX: 256;
  readonly EMBEDS_PER_MESSAGE_MAX: 10;
  readonly COMPONENTS_PER_ACTION_ROW_MAX: 5;
  readonly ACTION_ROWS_PER_MESSAGE_MAX: 5;
  readonly SELECT_OPTIONS_MAX: 25;
  readonly ATTACHMENT_SIZE_MAX: 8388608; // 8MB in bytes
  readonly USERNAME_MAX: 32;
  readonly NICKNAME_MAX: 32;
  readonly GUILD_NAME_MAX: 100;
  readonly CHANNEL_NAME_MAX: 100;
  readonly ROLE_NAME_MAX: 100;
}

// 상수 검증 타입
type ValidateConstants<T> = {
  readonly [K in keyof T]: T[K];
};

export class DiscordConstants {
  // ========== 채널 타입 ==========
  static readonly CHANNEL_TYPES: ValidateConstants<ChannelTypes> = {
    GUILD_VOICE: ChannelType.GuildVoice,
    GUILD_FORUM: ChannelType.GuildForum,
  } as const;

  // ========== 커스텀 ID 접두사 ==========
  static readonly CUSTOM_ID_PREFIXES: ValidateConstants<CustomIdPrefixes> = {
    VOICE_CONNECT: 'voice_connect_',
    VOICE_CLOSE: 'voice_close_',
    VOICE_SPECTATE: 'voice_spectate_',
    VOICE_WAIT: 'voice_wait_',
    VOICE_RESET: 'voice_reset_',
    RECRUITMENT_MODAL: 'recruitment_modal_',
    RECRUITMENT_METHOD: 'recruitment_method_',
    ROLE_BUTTON: 'role_btn_',
    ROLE_COMPLETE: 'role_complete_',
    STANDALONE_ROLE_BUTTON: 'standalone_role_btn_',
    STANDALONE_ROLE_COMPLETE: 'standalone_role_complete',
    EXISTING_POST_SELECT: 'existing_post_select_',
  } as const;

  // ========== 메서드 값 ==========
  static readonly METHOD_VALUES: ValidateConstants<MethodValues> = {
    NEW_FORUM: 'new_forum',
    NEW_FORUM_PREFIX: 'new_forum_',
    EXISTING_FORUM: 'existing_forum',
    EXISTING_FORUM_PREFIX: 'existing_forum_',
  } as const;

  // ========== 이모지 ==========
  static readonly EMOJIS: ValidateConstants<Emojis> = {
    VOICE: '🔊',
    PARTICIPANTS: '👥',
    TIME: '⏰',
    LINK: '🔗',
    TARGET: '🎯',
    USER: '👤',
    TAGS: '🏷️',
    DESCRIPTION: '📝',
    RECRUITER: '👤',
    GAME: '🎮',
    SUCCESS: '✅',
    ERROR: '❌',
    WARNING: '⚠️',
    SPECTATOR: '👁️',
    RESET: '🔄',
    CONNECT: '🎯',
    CLOSE: '🔒',
  } as const;

  // ========== 특수 태그 ==========
  static readonly SPECIAL_TAGS: ValidateConstants<SpecialTags> = {
    WAITING: '[대기]',
    SPECTATING: '[관전]',
  } as const;

  // ========== Discord 제한사항 ==========
  static readonly LIMITS: ValidateConstants<ExtendedDiscordLimits> = {
    // 기본 제한사항
    EMBED_DESCRIPTION_MAX: 4096,
    EMBED_FIELD_VALUE_MAX: 1024,
    EMBED_TITLE_MAX: 256,
    MODAL_TITLE_MAX: 100,
    MODAL_DESCRIPTION_MAX: 1000,
    BUTTON_LABEL_MAX: 80,
    SELECT_OPTION_LABEL_MAX: 100,

    // 확장 제한사항
    MESSAGE_CONTENT_MAX: 2000,
    EMBED_FIELDS_MAX: 25,
    EMBED_FOOTER_MAX: 2048,
    EMBED_AUTHOR_NAME_MAX: 256,
    EMBEDS_PER_MESSAGE_MAX: 10,
    COMPONENTS_PER_ACTION_ROW_MAX: 5,
    ACTION_ROWS_PER_MESSAGE_MAX: 5,
    SELECT_OPTIONS_MAX: 25,
    ATTACHMENT_SIZE_MAX: 8388608,
    USERNAME_MAX: 32,
    NICKNAME_MAX: 32,
    GUILD_NAME_MAX: 100,
    CHANNEL_NAME_MAX: 100,
    ROLE_NAME_MAX: 100,
  } as const;

  // ========== 유틸리티 메서드 ==========

  /**
   * 커스텀 ID가 특정 접두사로 시작하는지 확인
   * @param customId - 확인할 커스텀 ID
   * @param prefix - 확인할 접두사
   * @returns 접두사로 시작하는지 여부
   */
  static hasPrefix(customId: string, prefix: string): boolean {
    return customId.startsWith(prefix);
  }

  /**
   * 커스텀 ID에서 접두사 제거
   * @param customId - 커스텀 ID
   * @param prefix - 제거할 접두사
   * @returns 접두사가 제거된 문자열
   */
  static removePrefix(customId: string, prefix: string): string {
    return customId.startsWith(prefix) ? customId.slice(prefix.length) : customId;
  }

  /**
   * 문자열이 Discord 제한사항을 준수하는지 검증
   * @param text - 검증할 텍스트
   * @param limitType - 제한 유형
   * @returns 검증 결과
   */
  static validateLength(
    text: string,
    limitType: keyof ExtendedDiscordLimits
  ): { valid: boolean; length: number; limit: number } {
    const limit = this.LIMITS[limitType];
    const length = text.length;

    return {
      valid: length <= limit,
      length,
      limit,
    };
  }

  /**
   * 텍스트를 Discord 제한사항에 맞게 자르기
   * @param text - 자를 텍스트
   * @param limitType - 제한 유형
   * @param suffix - 잘린 경우 추가할 접미사
   * @returns 잘린 텍스트
   */
  static truncateText(
    text: string,
    limitType: keyof ExtendedDiscordLimits,
    suffix: string = '...'
  ): string {
    const limit = this.LIMITS[limitType];

    if (text.length <= limit) {
      return text;
    }

    const maxLength = limit - suffix.length;
    return text.slice(0, maxLength) + suffix;
  }

  /**
   * 커스텀 ID 빌더
   * @param prefix - 접두사
   * @param ...parts - ID 구성 요소들
   * @returns 생성된 커스텀 ID
   */
  static buildCustomId(prefix: string, ...parts: (string | number)[]): string {
    return prefix + parts.join('_');
  }

  /**
   * 모든 상수 목록 조회
   * @returns 상수 그룹별 정보
   */
  static getAllConstants(): {
    channelTypes: typeof DiscordConstants.CHANNEL_TYPES;
    customIdPrefixes: typeof DiscordConstants.CUSTOM_ID_PREFIXES;
    methodValues: typeof DiscordConstants.METHOD_VALUES;
    emojis: typeof DiscordConstants.EMOJIS;
    specialTags: typeof DiscordConstants.SPECIAL_TAGS;
    limits: typeof DiscordConstants.LIMITS;
  } {
    return {
      channelTypes: this.CHANNEL_TYPES,
      customIdPrefixes: this.CUSTOM_ID_PREFIXES,
      methodValues: this.METHOD_VALUES,
      emojis: this.EMOJIS,
      specialTags: this.SPECIAL_TAGS,
      limits: this.LIMITS,
    };
  }

  /**
   * 상수 검증
   * @returns 모든 상수가 올바르게 정의되었는지 검증 결과
   */
  static validateConstants(): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // 채널 타입 검증
      Object.values(this.CHANNEL_TYPES).forEach((channelType) => {
        if (typeof channelType !== 'number') {
          errors.push(`Invalid channel type: ${channelType}`);
        }
      });

      // 커스텀 ID 접두사 검증
      Object.values(this.CUSTOM_ID_PREFIXES).forEach((prefix) => {
        if (typeof prefix !== 'string' || prefix.length === 0) {
          errors.push(`Invalid custom ID prefix: ${prefix}`);
        }
        if (prefix.length > 50) {
          warnings.push(`Long custom ID prefix: ${prefix}`);
        }
      });

      // 제한사항 검증
      Object.entries(this.LIMITS).forEach(([key, limit]) => {
        if (typeof limit !== 'number' || limit <= 0) {
          errors.push(`Invalid limit for ${key}: ${limit}`);
        }
      });
    } catch (error) {
      errors.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

// 타입 내보내기
export type {
  ChannelTypes,
  CustomIdPrefixes,
  MethodValues,
  Emojis,
  SpecialTags,
  DiscordLimits,
  ExtendedDiscordLimits,
};

// 상수 값 타입 유틸리티
export type CustomIdPrefix =
  (typeof DiscordConstants.CUSTOM_ID_PREFIXES)[keyof typeof DiscordConstants.CUSTOM_ID_PREFIXES];
export type MethodValue =
  (typeof DiscordConstants.METHOD_VALUES)[keyof typeof DiscordConstants.METHOD_VALUES];
export type EmojiValue = (typeof DiscordConstants.EMOJIS)[keyof typeof DiscordConstants.EMOJIS];
export type SpecialTag =
  (typeof DiscordConstants.SPECIAL_TAGS)[keyof typeof DiscordConstants.SPECIAL_TAGS];
export type LimitKey = keyof typeof DiscordConstants.LIMITS;
