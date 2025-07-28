// src/utils/SecurityValidator.ts - 보안 검증 유틸리티
import { logger } from '../config/logger-termux.js';

export interface ValidationResult {
  isValid: boolean;
  sanitizedValue?: any;
  error?: string;
  warnings?: string[];
}

export interface ValidationOptions {
  maxLength?: number;
  allowedChars?: RegExp;
  required?: boolean;
  customValidator?: (value: any) => boolean;
}

/**
 * 보안 검증 및 입력 sanitization 클래스
 */
export class SecurityValidator {
  // 기본 설정
  private static readonly DEFAULT_MAX_LENGTH = 1000;
  private static readonly ROLE_MAX_LENGTH = 50;
  private static readonly GAME_MAX_LENGTH = 30;
  // private static readonly CHANNEL_ID_LENGTH = 20; // 사용되지 않음

  // 허용된 문자 패턴
  private static readonly ALLOWED_ROLE_CHARS = /^[a-zA-Z0-9가-힣\s\-_]+$/;
  private static readonly ALLOWED_GAME_CHARS = /^[a-zA-Z0-9가-힣\s\-_,.]+$/;
  private static readonly CHANNEL_ID_PATTERN = /^[0-9]{17,20}$/;
  // private static readonly SAFE_TEXT_PATTERN = /^[a-zA-Z0-9가-힣\s\-_,.!?]+$/; // 사용되지 않음

  // 금지된 패턴 (SQL 인젝션, XSS 등)
  private static readonly FORBIDDEN_PATTERNS = [
    /script\s*>/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /\bSELECT\b/i,
    /\bINSERT\b/i,
    /\bUPDATE\b/i,
    /\bDELETE\b/i,
    /\bDROP\b/i,
    /\bCREATE\b/i,
    /\bALTER\b/i,
    /\bEXEC\b/i,
    /\bUNION\b/i,
    /--/,
    /\/\*/,
    /\*\//,
    /<\s*script/i,
    /<\s*iframe/i,
    /<\s*object/i,
    /<\s*embed/i,
  ];

  /**
   * 기본 문자열 sanitization
   */
  static sanitizeInput(input: string): ValidationResult {
    if (!input || typeof input !== 'string') {
      return {
        isValid: false,
        error: '입력값이 유효하지 않습니다.',
      };
    }

    // 길이 제한
    if (input.length > this.DEFAULT_MAX_LENGTH) {
      return {
        isValid: false,
        error: `입력값이 너무 깁니다. (최대 ${this.DEFAULT_MAX_LENGTH}자)`,
      };
    }

    // 금지된 패턴 검사
    for (const pattern of this.FORBIDDEN_PATTERNS) {
      if (pattern.test(input)) {
        logger.warn('[SecurityValidator] 보안 위험 패턴 감지', {
          pattern: pattern.source,
          input: input.substring(0, 50),
        });
        return {
          isValid: false,
          error: '보안상 허용되지 않는 문자가 포함되어 있습니다.',
        };
      }
    }

    // HTML 엔티티 이스케이핑
    const sanitized = input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');

    return {
      isValid: true,
      sanitizedValue: sanitized.trim(),
    };
  }

  /**
   * 역할 이름 검증
   */
  static validateRoleName(roleName: string): ValidationResult {
    const baseValidation = this.sanitizeInput(roleName);
    if (!baseValidation.isValid) {
      return baseValidation;
    }

    const sanitized = baseValidation.sanitizedValue as string;

    // 길이 제한
    if (sanitized.length > this.ROLE_MAX_LENGTH) {
      return {
        isValid: false,
        error: `역할 이름이 너무 깁니다. (최대 ${this.ROLE_MAX_LENGTH}자)`,
      };
    }

    // 빈 문자열 체크
    if (sanitized.length === 0) {
      return {
        isValid: false,
        error: '역할 이름을 입력해주세요.',
      };
    }

    // 허용된 문자 체크
    if (!this.ALLOWED_ROLE_CHARS.test(sanitized)) {
      return {
        isValid: false,
        error: '역할 이름에는 한글, 영문, 숫자, 하이픈, 언더스코어, 공백만 사용할 수 있습니다.',
      };
    }

    return {
      isValid: true,
      sanitizedValue: sanitized,
    };
  }

  /**
   * 활동 시간 검증
   */
  static validateHours(hours: number): ValidationResult {
    if (typeof hours !== 'number' || isNaN(hours)) {
      return {
        isValid: false,
        error: '시간은 숫자여야 합니다.',
      };
    }

    if (hours < 0) {
      return {
        isValid: false,
        error: '시간은 0 이상이어야 합니다.',
      };
    }

    if (hours > 168) {
      return {
        isValid: false,
        error: '시간은 168시간(7일)을 초과할 수 없습니다.',
      };
    }

    const warnings: string[] = [];
    if (hours > 100) {
      warnings.push('매우 높은 활동시간이 설정되었습니다.');
    }

    const result: ValidationResult = {
      isValid: true,
      sanitizedValue: hours,
    };

    if (warnings.length > 0) {
      result.warnings = warnings;
    }

    return result;
  }

  /**
   * 게임 목록 검증
   */
  static validateGameList(gameListInput: string): ValidationResult {
    const baseValidation = this.sanitizeInput(gameListInput);
    if (!baseValidation.isValid) {
      return baseValidation;
    }

    const sanitized = baseValidation.sanitizedValue as string;

    // 쉼표로 분리
    const games = sanitized
      .split(',')
      .map((game) => game.trim())
      .filter((game) => game.length > 0);

    if (games.length === 0) {
      return {
        isValid: false,
        error: '최소 하나의 게임을 입력해주세요.',
      };
    }

    if (games.length > 20) {
      return {
        isValid: false,
        error: '최대 20개의 게임까지 설정할 수 있습니다.',
      };
    }

    const validatedGames: string[] = [];
    const warnings: string[] = [];

    for (const game of games) {
      // 개별 게임 이름 길이 체크
      if (game.length > this.GAME_MAX_LENGTH) {
        warnings.push(`"${game}"이 너무 깁니다. (최대 ${this.GAME_MAX_LENGTH}자)`);
        continue;
      }

      // 허용된 문자 체크
      if (!this.ALLOWED_GAME_CHARS.test(game)) {
        warnings.push(`"${game}"에 허용되지 않는 문자가 포함되어 있습니다.`);
        continue;
      }

      validatedGames.push(game);
    }

    if (validatedGames.length === 0) {
      return {
        isValid: false,
        error: '유효한 게임 이름이 없습니다.',
        warnings,
      };
    }

    const result: ValidationResult = {
      isValid: true,
      sanitizedValue: validatedGames,
    };

    if (warnings.length > 0) {
      result.warnings = warnings;
    }

    return result;
  }

  /**
   * 단일 채널 ID 검증
   */
  static validateChannelId(channelId: string): ValidationResult {
    const baseValidation = this.sanitizeInput(channelId);
    if (!baseValidation.isValid) {
      return baseValidation;
    }

    const sanitized = (baseValidation.sanitizedValue as string).trim();

    // 빈 값 허용 (선택적 필드)
    if (sanitized.length === 0) {
      return {
        isValid: true,
        sanitizedValue: '',
      };
    }

    // 채널 ID 패턴 검증
    if (!this.CHANNEL_ID_PATTERN.test(sanitized)) {
      return {
        isValid: false,
        error: '채널 ID는 17-20자리 숫자여야 합니다.',
      };
    }

    return {
      isValid: true,
      sanitizedValue: sanitized,
    };
  }

  /**
   * 채널 ID 목록 검증
   */
  static validateChannelIds(channelIdsInput: string): ValidationResult {
    // 빈 값 또는 null/undefined 허용
    if (!channelIdsInput || channelIdsInput.trim() === '') {
      return {
        isValid: true,
        sanitizedValue: [],
      };
    }

    const baseValidation = this.sanitizeInput(channelIdsInput);
    if (!baseValidation.isValid) {
      return baseValidation;
    }

    const sanitized = baseValidation.sanitizedValue as string;

    // 쉼표로 분리
    const channelIds = sanitized
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    if (channelIds.length === 0) {
      return {
        isValid: true,
        sanitizedValue: [],
      };
    }

    if (channelIds.length > 50) {
      return {
        isValid: false,
        error: '최대 50개의 채널까지 설정할 수 있습니다.',
      };
    }

    const validatedChannelIds: string[] = [];
    const warnings: string[] = [];

    for (const channelId of channelIds) {
      // 채널 ID 패턴 체크
      if (!this.CHANNEL_ID_PATTERN.test(channelId)) {
        warnings.push(`"${channelId}"는 유효한 채널 ID가 아닙니다.`);
        continue;
      }

      validatedChannelIds.push(channelId);
    }

    if (validatedChannelIds.length === 0) {
      return {
        isValid: false,
        error: '유효한 채널 ID가 없습니다.',
        warnings,
      };
    }

    const result: ValidationResult = {
      isValid: true,
      sanitizedValue: validatedChannelIds,
    };

    if (warnings.length > 0) {
      result.warnings = warnings;
    }

    return result;
  }

  /**
   * 길드 ID 검증
   */
  static validateGuildId(guildId: string): ValidationResult {
    if (!guildId || typeof guildId !== 'string') {
      return {
        isValid: false,
        error: '길드 ID가 유효하지 않습니다.',
      };
    }

    if (!this.CHANNEL_ID_PATTERN.test(guildId)) {
      return {
        isValid: false,
        error: '길드 ID 형식이 올바르지 않습니다.',
      };
    }

    return {
      isValid: true,
      sanitizedValue: guildId,
    };
  }

  /**
   * 사용자 ID 검증
   */
  static validateUserId(userId: string): ValidationResult {
    if (!userId || typeof userId !== 'string') {
      return {
        isValid: false,
        error: '사용자 ID가 유효하지 않습니다.',
      };
    }

    if (!this.CHANNEL_ID_PATTERN.test(userId)) {
      return {
        isValid: false,
        error: '사용자 ID 형식이 올바르지 않습니다.',
      };
    }

    return {
      isValid: true,
      sanitizedValue: userId,
    };
  }

  /**
   * JSON 데이터 검증 및 sanitization
   */
  static validateJsonData(data: any): ValidationResult {
    try {
      // 순환 참조 체크
      JSON.stringify(data);

      // 객체 크기 제한 (1MB)
      const jsonString = JSON.stringify(data);
      if (jsonString.length > 1024 * 1024) {
        return {
          isValid: false,
          error: '데이터가 너무 큽니다.',
        };
      }

      return {
        isValid: true,
        sanitizedValue: data,
      };
    } catch (error) {
      return {
        isValid: false,
        error: '유효하지 않은 데이터 형식입니다.',
      };
    }
  }

  /**
   * 관리자 권한 검증
   */
  static validateAdminPermissions(member: any): ValidationResult {
    if (!member) {
      return {
        isValid: false,
        error: '멤버 정보를 찾을 수 없습니다.',
      };
    }

    if (!member.permissions?.has('Administrator')) {
      return {
        isValid: false,
        error: '관리자 권한이 필요합니다.',
      };
    }

    return {
      isValid: true,
      sanitizedValue: true,
    };
  }

  /**
   * 설정 타입 검증
   */
  static validateSettingType(settingType: string): ValidationResult {
    const allowedTypes = ['role_activity', 'game_list', 'exclude_channels'];

    if (!allowedTypes.includes(settingType)) {
      return {
        isValid: false,
        error: '지원되지 않는 설정 타입입니다.',
      };
    }

    return {
      isValid: true,
      sanitizedValue: settingType,
    };
  }
}
