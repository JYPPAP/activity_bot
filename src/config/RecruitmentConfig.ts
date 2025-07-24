// src/config/RecruitmentConfig.ts - 구인구직 기능 설정

// 메시지 설정 인터페이스
interface RecruitmentMessages {
  readonly RECRUITMENT_DISABLED: string;
  readonly NO_PERMISSION: string;
  readonly MAX_TAGS_EXCEEDED: string;
  readonly VOICE_CHANNEL_NOT_FOUND: string;
  readonly FORUM_POST_NOT_FOUND: string;
  readonly LINK_SUCCESS: string;
  readonly LINK_FAILED: string;
  readonly GENERIC_ERROR: string;
  readonly SPECTATOR_MODE_SET: string;
  readonly ALREADY_SPECTATOR: string;
  readonly NICKNAME_CHANGE_FAILED: string;
  readonly CLOSE_POST_SUCCESS: string;
  readonly CLOSE_POST_FAILED: string;
  readonly CLOSE_POST_REASON: string;
  readonly WAITING_MODE_SET: string;
  readonly ALREADY_WAITING: string;
  readonly NORMAL_MODE_RESTORED: string;
  readonly ALREADY_NORMAL: string;
  readonly PARTICIPANT_UPDATE_FAILED: string;
  readonly POST_ARCHIVED: string;
  readonly POST_ARCHIVE_FAILED: string;
}

// 색상 설정 인터페이스
interface RecruitmentColors {
  readonly SUCCESS: 0x00ff00;
  readonly ERROR: 0xff0000;
  readonly WARNING: 0xffb800;
  readonly INFO: 0x0099ff;
  readonly STANDALONE_POST: 0xffb800;
  readonly ACTIVE: 0x00ff7f;
  readonly INACTIVE: 0x808080;
  readonly PREMIUM: 0xffd700;
}

// 게임 태그 카테고리는 이제 DB에서 관리됩니다

// 구인구직 설정 인터페이스
interface RecruitmentSettings {
  enabled: boolean;
  restrictedMode: boolean;
  maxSelectedTags: number;
  cleanupInterval: number;
  embedSendDelay: number;
  maxRecruitmentDuration: number;
  autoArchiveAfter: number;
  maxParticipants: number;
  enableNotifications: boolean;
}

// 버튼 그리드 설정 인터페이스
interface ButtonGridConfig {
  readonly rows: number;
  readonly cols: number;
  readonly maxButtons: number;
  readonly style: 'compact' | 'standard' | 'extended';
}

// 검증 규칙 인터페이스
interface ValidationRules {
  readonly minTitleLength: number;
  readonly maxTitleLength: number;
  readonly minDescriptionLength: number;
  readonly maxDescriptionLength: number;
  readonly allowedTagPattern: RegExp;
  readonly participantPattern: RegExp;
  readonly forbiddenWords: string[];
}

export class RecruitmentConfig {
  // ========== 구인구직 기능 권한 설정 ==========
  static RECRUITMENT_ENABLED: boolean = true; // 구인구직 기능 활성화 여부

  // ========== 게임 태그 설정 ==========
  // 게임 태그는 이제 DB에서 관리됩니다

  // 게임 태그 카테고리는 이제 DB에서 관리됩니다

  // 최대 선택 가능한 태그 수
  static readonly MAX_SELECTED_TAGS: number = 5;

  // 버튼 그리드 설정 - 동적 계산
  /**
   * 태그 수에 따른 최적의 버튼 그리드 계산
   * @param tagCount - 태그 수
   * @returns 최적의 그리드 설정
   */
  static calculateOptimalButtonGrid(tagCount: number): ButtonGridConfig {
    // 최소 2x2, 최대 5x5 그리드
    if (tagCount <= 0) {
      return { rows: 2, cols: 2, maxButtons: 4, style: 'compact' };
    }

    if (tagCount <= 4) {
      return { rows: 2, cols: 2, maxButtons: 4, style: 'compact' };
    }

    if (tagCount <= 9) {
      return { rows: 3, cols: 3, maxButtons: 9, style: 'standard' };
    }

    if (tagCount <= 16) {
      return { rows: 4, cols: 4, maxButtons: 16, style: 'standard' };
    }

    return { rows: 5, cols: 5, maxButtons: 25, style: 'extended' };
  }

  // 기본 그리드 설정 (폴백용)
  static readonly DEFAULT_BUTTON_GRID_CONFIG: ButtonGridConfig = {
    rows: 4,
    cols: 4,
    maxButtons: 16,
    style: 'standard',
  } as const;

  // ========== 타이밍 설정 ==========
  static readonly CLEANUP_INTERVAL: number = 30000; // 30초마다 정리 작업
  static readonly EMBED_SEND_DELAY: number = 3000; // 3초 후 임베드 전송
  static readonly AUTO_ARCHIVE_DELAY: number = 3600000; // 1시간 후 자동 아카이브
  static readonly NOTIFICATION_COOLDOWN: number = 300000; // 5분 알림 쿨다운
  static readonly MAX_RECRUITMENT_DURATION: number = 86400000; // 24시간 최대 지속 시간

  // ========== 메시지 설정 ==========
  static readonly MESSAGES: RecruitmentMessages = {
    RECRUITMENT_DISABLED: '❌ 구인구직 기능이 비활성화되어 있습니다.',
    NO_PERMISSION: '❌ 이 기능을 사용할 권한이 없습니다.',
    MAX_TAGS_EXCEEDED: `❌ 최대 ${RecruitmentConfig.MAX_SELECTED_TAGS}개까지만 선택할 수 있습니다.`,
    VOICE_CHANNEL_NOT_FOUND: '❌ 음성 채널을 찾을 수 없습니다.',
    FORUM_POST_NOT_FOUND: '❌ 포럼 포스트를 찾을 수 없습니다.',
    LINK_SUCCESS: '✅ 성공적으로 연동되었습니다!',
    LINK_FAILED: '❌ 연동에 실패했습니다. 다시 시도해주세요.',
    GENERIC_ERROR: '❌ 오류가 발생했습니다. 다시 시도해주세요.',
    SPECTATOR_MODE_SET: '👁️ 관전 모드로 설정되었습니다!',
    ALREADY_SPECTATOR: '👁️ 이미 관전 모드로 설정되어 있습니다.',
    NICKNAME_CHANGE_FAILED: '❌ 닉네임 변경에 실패했습니다.',
    CLOSE_POST_SUCCESS: '🔒 포스트가 성공적으로 닫혔습니다.',
    CLOSE_POST_FAILED: '❌ 포스트 닫기에 실패했습니다.',
    CLOSE_POST_REASON: '수동 종료',
    WAITING_MODE_SET: '⏳ 대기 모드로 설정되었습니다!',
    ALREADY_WAITING: '⏳ 이미 대기 모드로 설정되어 있습니다.',
    NORMAL_MODE_RESTORED: '🔄 정상 모드로 복구되었습니다!',
    ALREADY_NORMAL: '✅ 이미 정상 모드입니다.',
    PARTICIPANT_UPDATE_FAILED: '❌ 참여자 정보 업데이트에 실패했습니다.',
    POST_ARCHIVED: '📦 포스트가 아카이브되었습니다.',
    POST_ARCHIVE_FAILED: '❌ 포스트 아카이브에 실패했습니다.',
  } as const;

  // ========== 색상 설정 ==========
  static readonly COLORS: RecruitmentColors = {
    SUCCESS: 0x00ff00,
    ERROR: 0xff0000,
    WARNING: 0xffb800,
    INFO: 0x0099ff,
    STANDALONE_POST: 0xffb800,
    ACTIVE: 0x00ff7f,
    INACTIVE: 0x808080,
    PREMIUM: 0xffd700,
  } as const;

  // ========== 검증 규칙 ==========
  static readonly VALIDATION_RULES: ValidationRules = {
    minTitleLength: 3,
    maxTitleLength: 100,
    minDescriptionLength: 0,
    maxDescriptionLength: 1000,
    allowedTagPattern: /^@[가-힣a-zA-Z0-9]+$/,
    participantPattern: /\d+\/(\d+|[Nn])/,
    forbiddenWords: ['spam', 'hack', 'cheat', '해킹', '치트', '스팸'],
  } as const;

  // ========== 기능 설정 ==========
  static readonly FEATURE_FLAGS = {
    ENABLE_AUTO_ARCHIVE: true,
    ENABLE_PARTICIPANT_NOTIFICATIONS: true,
    ENABLE_ROLE_MENTION: true,
    ENABLE_EMBED_THUMBNAILS: true,
    ENABLE_REACTION_TRACKING: true,
    ENABLE_VOICE_CHANNEL_MONITORING: true,
    ENABLE_ADVANCED_STATISTICS: true,
    ENABLE_BACKUP_CREATION: true,
  } as const;

  // ========== 제한 설정 ==========
  static readonly LIMITS = {
    MAX_CONCURRENT_RECRUITMENTS_PER_USER: 3,
    MAX_DAILY_RECRUITMENTS_PER_USER: 10,
    MAX_PARTICIPANTS_PER_RECRUITMENT: 50,
    MAX_FORUM_POSTS_TO_DISPLAY: 7,
    MAX_NOTIFICATION_RECIPIENTS: 100,
    MAX_TAG_LENGTH: 20,
    MAX_USERNAME_DISPLAY_LENGTH: 32,
    MAX_RECRUITMENT_TITLE_DISPLAY: 80,
  } as const;

  // ========== 유틸리티 메서드 ==========

  /**
   * 게임 태그가 유효한지 검증 (이제는 DB에서 확인해야 함)
   * @param tag - 검증할 태그
   * @returns 유효성 여부
   * @deprecated DB 기반 검증을 사용하세요
   */
  static isValidRoleTag(tag: string): boolean {
    // 더 이상 정적 배열로 검증하지 않음
    // 호출하는 쪽에서 DB 기반 검증을 사용해야 함
    console.warn('[RecruitmentConfig] isValidRoleTag is deprecated. Use DB-based validation.');
    return true; // 일단 모든 태그를 허용
  }

  /**
   * DB 기반 게임 태그 검증
   * @param tags - 검증할 태그 배열
   * @param guildId - 길드 ID
   * @returns 검증 결과
   */
  static async validateGameTags(
    tags: string[],
    guildId: string
  ): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];

    // 태그 수 제한 확인
    if (tags.length > this.MAX_SELECTED_TAGS) {
      errors.push(`최대 ${this.MAX_SELECTED_TAGS}개까지만 선택할 수 있습니다.`);
    }

    // 태그 패턴 검증
    const invalidTags = tags.filter((tag) => !this.VALIDATION_RULES.allowedTagPattern.test(tag));
    if (invalidTags.length > 0) {
      errors.push(`유효하지 않은 태그 형식: ${invalidTags.join(', ')}`);
    }

    // TODO: 여기서 GuildSettingsManager를 통해 실제 DB 검증 필요
    // 현재는 기본 검증만 수행
    console.warn(
      '[RecruitmentConfig] validateGameTags needs DB integration with GuildSettingsManager'
    );

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 선택된 태그들이 제한을 준수하는지 검증
   * @param selectedTags - 선택된 태그 배열
   * @returns 검증 결과
   */
  static validateSelectedTags(selectedTags: string[]): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (selectedTags.length > this.MAX_SELECTED_TAGS) {
      errors.push(`최대 ${this.MAX_SELECTED_TAGS}개까지만 선택할 수 있습니다.`);
    }

    const invalidTags = selectedTags.filter((tag) => !this.isValidRoleTag(tag));
    if (invalidTags.length > 0) {
      errors.push(`유효하지 않은 태그: ${invalidTags.join(', ')}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 구인구직 제목 검증
   * @param title - 검증할 제목
   * @returns 검증 결과
   */
  static validateRecruitmentTitle(title: string): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    console.log(`[RecruitmentConfig] 제목 검증 시작: "${title}"`);
    console.log(`[RecruitmentConfig] 제목 길이: ${title.length}`);

    if (title.length < this.VALIDATION_RULES.minTitleLength) {
      console.log(
        `[RecruitmentConfig] 제목 길이 부족: ${title.length} < ${this.VALIDATION_RULES.minTitleLength}`
      );
      errors.push(`제목은 최소 ${this.VALIDATION_RULES.minTitleLength}글자 이상이어야 합니다.`);
    }

    if (title.length > this.VALIDATION_RULES.maxTitleLength) {
      console.log(
        `[RecruitmentConfig] 제목 길이 초과: ${title.length} > ${this.VALIDATION_RULES.maxTitleLength}`
      );
      errors.push(`제목은 최대 ${this.VALIDATION_RULES.maxTitleLength}글자까지 가능합니다.`);
    }

    // 참가자 패턴 검증
    const participantPattern = this.VALIDATION_RULES.participantPattern;
    const patternMatch = participantPattern.test(title);
    console.log(`[RecruitmentConfig] 참가자 패턴 검증:`, {
      pattern: participantPattern.toString(),
      title,
      matches: patternMatch,
      matchResult: title.match(participantPattern),
    });

    if (!patternMatch) {
      console.log(
        `[RecruitmentConfig] 참가자 패턴 매칭 실패 - 제목: "${title}", 패턴: ${participantPattern}`
      );
      errors.push('제목에 "현재인원/최대인원" 형식을 포함해주세요. (예: 1/5, 1/N)');
    } else {
      console.log(`[RecruitmentConfig] 참가자 패턴 매칭 성공`);
    }

    // 금지된 단어 검사
    const forbiddenFound = this.VALIDATION_RULES.forbiddenWords.find((word) =>
      title.toLowerCase().includes(word.toLowerCase())
    );
    if (forbiddenFound) {
      errors.push(`금지된 단어가 포함되어 있습니다: ${forbiddenFound}`);
    }

    // 경고 사항
    if (title.length < 10) {
      warnings.push('더 구체적인 제목을 권장합니다.');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 설정 검증
   * @returns 검증 결과
   */
  static validateConfig(): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // 기본 설정 검증
      if (this.MAX_SELECTED_TAGS <= 0) {
        errors.push('MAX_SELECTED_TAGS는 0보다 커야 합니다.');
      }

      // 버튼 그리드 검증은 이제 동적으로 처리됨

      if (this.CLEANUP_INTERVAL < 10000) {
        warnings.push('CLEANUP_INTERVAL이 너무 짧을 수 있습니다 (권장: 30초 이상)');
      }

      // 타이밍 설정 검증
      if (this.AUTO_ARCHIVE_DELAY < this.CLEANUP_INTERVAL) {
        errors.push('AUTO_ARCHIVE_DELAY는 CLEANUP_INTERVAL보다 커야 합니다.');
      }

      // 제한 설정 검증
      Object.entries(this.LIMITS).forEach(([key, value]) => {
        if (typeof value !== 'number' || value <= 0) {
          errors.push(`Invalid limit value for ${key}: ${value}`);
        }
      });
    } catch (error) {
      errors.push(
        `Config validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 색상 값을 16진수 문자열로 변환
   * @param colorKey - 색상 키
   * @returns 16진수 색상 문자열
   */
  static getColorHex(colorKey: keyof RecruitmentColors): string {
    const color = this.COLORS[colorKey];
    return `#${color.toString(16).padStart(6, '0').toUpperCase()}`;
  }

  /**
   * 현재 설정 요약 조회
   * @returns 설정 요약
   */
  static getConfigSummary(): {
    enabled: boolean;
    maxTags: number;
    intervals: {
      cleanup: number;
      embedDelay: number;
      autoArchive: number;
    };
    limits: typeof RecruitmentConfig.LIMITS;
    features: typeof RecruitmentConfig.FEATURE_FLAGS;
  } {
    return {
      enabled: this.RECRUITMENT_ENABLED,
      maxTags: this.MAX_SELECTED_TAGS,
      intervals: {
        cleanup: this.CLEANUP_INTERVAL,
        embedDelay: this.EMBED_SEND_DELAY,
        autoArchive: this.AUTO_ARCHIVE_DELAY,
      },
      limits: this.LIMITS,
      features: this.FEATURE_FLAGS,
    };
  }
}

// 타입 내보내기
export type {
  RecruitmentMessages,
  RecruitmentColors,
  RecruitmentSettings,
  ButtonGridConfig,
  ValidationRules,
};

// 상수 값 타입 유틸리티
export type ColorKey = keyof typeof RecruitmentConfig.COLORS;
export type MessageKey = keyof typeof RecruitmentConfig.MESSAGES;
export type FeatureFlag = keyof typeof RecruitmentConfig.FEATURE_FLAGS;
export type LimitKey = keyof typeof RecruitmentConfig.LIMITS;
