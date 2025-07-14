// src/config/commandPermissions.ts - 명령어 권한 설정
import { GuildMember, PermissionsBitField } from 'discord.js';

// 권한 레벨 정의
export enum PermissionLevel {
  PUBLIC = 0, // 모든 사용자
  TRUSTED = 1, // 신뢰받는 사용자
  MODERATOR = 2, // 중간 관리자
  ADMIN = 3, // 관리자
  SUPER_ADMIN = 4, // 최고 관리자
}

// 역할 권한 매핑 인터페이스
interface RolePermissionMap {
  readonly [roleName: string]: PermissionLevel;
}

// 명령어 권한 요구사항 인터페이스
interface CommandPermissionConfig {
  readonly level: PermissionLevel;
  readonly specificRoles?: readonly string[];
  readonly discordPermissions?: readonly bigint[];
  readonly userIds?: readonly string[];
  readonly enabled: boolean;
  readonly description?: string;
}

// 권한 확인 결과 인터페이스
export interface PermissionCheckResult {
  hasPermission: boolean;
  reason?: string;
  requiredLevel?: PermissionLevel;
  requiredRoles?: string[];
  userLevel?: PermissionLevel;
  userRoles?: string[];
  missingDiscordPermissions?: string[];
}

// 권한 통계 인터페이스
interface PermissionStatistics {
  totalChecks: number;
  successfulChecks: number;
  deniedChecks: number;
  checksByCommand: Record<string, { allowed: number; denied: number }>;
  checksByLevel: Record<PermissionLevel, { allowed: number; denied: number }>;
  lastCheckTime: Date;
  mostUsedCommands: Array<{ command: string; uses: number }>;
}

// 상수 검증 타입
type ValidatePermissions<T> = {
  readonly [K in keyof T]: T[K];
};

export class CommandPermissions {
  // ========== 역할 권한 매핑 ==========
  private static readonly ROLE_PERMISSION_MAP: ValidatePermissions<RolePermissionMap> = {
    // 최고 관리자
    관리자: PermissionLevel.SUPER_ADMIN,
    봇관리자: PermissionLevel.SUPER_ADMIN,
    Administrator: PermissionLevel.SUPER_ADMIN,

    // 일반 관리자
    부관리자: PermissionLevel.ADMIN,
    Moderator: PermissionLevel.ADMIN,
    운영진: PermissionLevel.ADMIN,

    // 중간 관리자
    서브관리자: PermissionLevel.MODERATOR,
    Helper: PermissionLevel.MODERATOR,
    도우미: PermissionLevel.MODERATOR,

    // 신뢰받는 사용자
    VIP: PermissionLevel.TRUSTED,
    정회원: PermissionLevel.TRUSTED,
    Regular: PermissionLevel.TRUSTED,

    // 기본 사용자는 PUBLIC (별도 매핑 불필요)
  } as const;

  // ========== 명령어 권한 설정 ==========
  private static readonly COMMAND_PERMISSIONS: ValidatePermissions<
    Record<string, CommandPermissionConfig>
  > = {
    // 일반 사용자 명령어
    구직: {
      level: PermissionLevel.PUBLIC,
      enabled: true,
      description: '구인구직 기능 - 모든 사용자 사용 가능',
    },
    help: {
      level: PermissionLevel.PUBLIC,
      enabled: true,
      description: '도움말 명령어',
    },
    ping: {
      level: PermissionLevel.PUBLIC,
      enabled: true,
      description: '봇 상태 확인',
    },

    // 신뢰받는 사용자 명령어
    report: {
      level: PermissionLevel.TRUSTED,
      enabled: true,
      description: '간단한 보고서 조회',
    },

    // 중간 관리자 명령어
    kick: {
      level: PermissionLevel.MODERATOR,
      discordPermissions: [PermissionsBitField.Flags.KickMembers],
      enabled: true,
      description: '멤버 추방',
    },
    timeout: {
      level: PermissionLevel.MODERATOR,
      discordPermissions: [PermissionsBitField.Flags.ModerateMembers],
      enabled: true,
      description: '멤버 타임아웃',
    },

    // 관리자 명령어
    ban: {
      level: PermissionLevel.ADMIN,
      discordPermissions: [PermissionsBitField.Flags.BanMembers],
      enabled: true,
      description: '멤버 차단',
    },
    channel: {
      level: PermissionLevel.ADMIN,
      discordPermissions: [PermissionsBitField.Flags.ManageChannels],
      enabled: true,
      description: '채널 관리',
    },

    // 최고 관리자 명령어
    gap_list: {
      level: PermissionLevel.SUPER_ADMIN,
      enabled: true,
      description: '활동 목록 조회',
    },
    gap_config: {
      level: PermissionLevel.SUPER_ADMIN,
      enabled: true,
      description: '설정 관리',
    },
    gap_reset: {
      level: PermissionLevel.SUPER_ADMIN,
      enabled: true,
      description: '데이터 초기화',
    },
    gap_save: {
      level: PermissionLevel.SUPER_ADMIN,
      enabled: true,
      description: '데이터 저장',
    },
    gap_report: {
      level: PermissionLevel.SUPER_ADMIN,
      enabled: true,
      description: '활동 보고서 생성',
    },
    gap_afk: {
      level: PermissionLevel.SUPER_ADMIN,
      enabled: true,
      description: 'AFK 관리',
    },
    gap_calendar: {
      level: PermissionLevel.SUPER_ADMIN,
      enabled: true,
      description: '캘린더 보고서',
    },
    gap_stats: {
      level: PermissionLevel.SUPER_ADMIN,
      enabled: true,
      description: '통계 조회',
    },
    시간체크: {
      level: PermissionLevel.SUPER_ADMIN,
      enabled: true,
      description: '시간 확인',
    },

    // 특별 권한 명령어 (특정 사용자 ID 필요)
    system_shutdown: {
      level: PermissionLevel.SUPER_ADMIN,
      userIds: ['592666673627004939'], // 특정 사용자만
      enabled: false,
      description: '시스템 종료 (비활성화됨)',
    },
    database_backup: {
      level: PermissionLevel.SUPER_ADMIN,
      userIds: ['592666673627004939'],
      enabled: true,
      description: '데이터베이스 백업',
    },
  } as const;

  // ========== 통계 관리 ==========
  private static statistics: PermissionStatistics = {
    totalChecks: 0,
    successfulChecks: 0,
    deniedChecks: 0,
    checksByCommand: {},
    checksByLevel: {
      [PermissionLevel.PUBLIC]: { allowed: 0, denied: 0 },
      [PermissionLevel.TRUSTED]: { allowed: 0, denied: 0 },
      [PermissionLevel.MODERATOR]: { allowed: 0, denied: 0 },
      [PermissionLevel.ADMIN]: { allowed: 0, denied: 0 },
      [PermissionLevel.SUPER_ADMIN]: { allowed: 0, denied: 0 },
    },
    lastCheckTime: new Date(),
    mostUsedCommands: [],
  };

  // ========== 권한 확인 메서드 ==========

  /**
   * 사용자의 권한 레벨 계산
   * @param member - 길드 멤버
   * @returns 사용자의 권한 레벨
   */
  static getUserPermissionLevel(member: GuildMember): PermissionLevel {
    // 서버 소유자는 최고 권한
    if (member.guild.ownerId === member.id) {
      return PermissionLevel.SUPER_ADMIN;
    }

    // Administrator 권한이 있으면 최고 권한
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return PermissionLevel.SUPER_ADMIN;
    }

    // 역할 기반 권한 확인
    let maxLevel = PermissionLevel.PUBLIC;

    for (const role of member.roles.cache.values()) {
      const roleLevel = this.ROLE_PERMISSION_MAP[role.name];
      if (roleLevel !== undefined && roleLevel > maxLevel) {
        maxLevel = roleLevel;
      }
    }

    return maxLevel;
  }

  /**
   * 명령어 실행 권한 확인 (메인 메서드)
   * @param member - 길드 멤버
   * @param commandName - 명령어 이름
   * @returns 권한 확인 결과
   */
  static checkCommandPermission(member: GuildMember, commandName: string): PermissionCheckResult {
    this.updateStatistics(commandName, 'check');

    const commandConfig = this.COMMAND_PERMISSIONS[commandName];

    // 명령어가 정의되지 않은 경우
    if (!commandConfig) {
      this.updateStatistics(commandName, 'denied');
      return {
        hasPermission: false,
        reason: '정의되지 않은 명령어입니다.',
        userLevel: this.getUserPermissionLevel(member),
        userRoles: member.roles.cache.map((role) => role.name),
      };
    }

    // 명령어가 비활성화된 경우
    if (!commandConfig.enabled) {
      this.updateStatistics(commandName, 'denied');
      return {
        hasPermission: false,
        reason: '현재 비활성화된 명령어입니다.',
        requiredLevel: commandConfig.level,
        userLevel: this.getUserPermissionLevel(member),
        userRoles: member.roles.cache.map((role) => role.name),
      };
    }

    const userLevel = this.getUserPermissionLevel(member);
    const userRoles = member.roles.cache.map((role) => role.name);

    // 특정 사용자 ID 확인 (가장 높은 우선순위)
    if (commandConfig.userIds && commandConfig.userIds.length > 0) {
      if (!commandConfig.userIds.includes(member.id)) {
        this.updateStatistics(commandName, 'denied');
        return {
          hasPermission: false,
          reason: '이 명령어는 특정 사용자만 사용할 수 있습니다.',
          requiredLevel: commandConfig.level,
          userLevel,
          userRoles,
        };
      }
    }

    // 권한 레벨 확인
    if (userLevel < commandConfig.level) {
      this.updateStatistics(commandName, 'denied');
      return {
        hasPermission: false,
        reason: '권한 레벨이 부족합니다.',
        requiredLevel: commandConfig.level,
        userLevel,
        userRoles,
      };
    }

    // 특정 역할 요구사항 확인
    if (commandConfig.specificRoles && commandConfig.specificRoles.length > 0) {
      const hasRequiredRole = commandConfig.specificRoles.some((role) => userRoles.includes(role));

      if (!hasRequiredRole) {
        this.updateStatistics(commandName, 'denied');
        return {
          hasPermission: false,
          reason: '필요한 역할이 없습니다.',
          requiredRoles: [...commandConfig.specificRoles],
          userLevel,
          userRoles,
        };
      }
    }

    // Discord 권한 확인
    if (commandConfig.discordPermissions && commandConfig.discordPermissions.length > 0) {
      const missingPermissions: string[] = [];

      for (const permission of commandConfig.discordPermissions) {
        if (!member.permissions.has(permission)) {
          const permissionName = Object.keys(PermissionsBitField.Flags).find(
            (key) =>
              PermissionsBitField.Flags[key as keyof typeof PermissionsBitField.Flags] ===
              permission
          );
          if (permissionName) {
            missingPermissions.push(permissionName);
          }
        }
      }

      if (missingPermissions.length > 0) {
        this.updateStatistics(commandName, 'denied');
        return {
          hasPermission: false,
          reason: 'Discord 권한이 부족합니다.',
          missingDiscordPermissions: missingPermissions,
          userLevel,
          userRoles,
        };
      }
    }

    // 모든 검증 통과
    this.updateStatistics(commandName, 'allowed');
    return {
      hasPermission: true,
      userLevel,
      userRoles,
    };
  }

  /**
   * 이전 버전과의 호환성을 위한 메서드
   * @param member - 길드 멤버
   * @param commandName - 명령어 이름
   * @returns 권한 보유 여부
   */
  static hasCommandPermission(member: GuildMember, commandName: string): boolean {
    return this.checkCommandPermission(member, commandName).hasPermission;
  }

  /**
   * 권한 부족 시 표시할 메시지 생성
   * @param commandName - 명령어 이름
   * @param checkResult - 권한 확인 결과 (선택사항)
   * @returns 권한 부족 메시지
   */
  static getPermissionDeniedMessage(
    commandName: string,
    checkResult?: PermissionCheckResult
  ): string {
    if (checkResult?.reason) {
      let message = `❌ ${checkResult.reason}`;

      if (checkResult.requiredLevel !== undefined) {
        message += `\n필요 권한 레벨: ${PermissionLevel[checkResult.requiredLevel]}`;
      }

      if (checkResult.requiredRoles && checkResult.requiredRoles.length > 0) {
        message += `\n필요 역할: ${checkResult.requiredRoles.join(', ')}`;
      }

      if (
        checkResult.missingDiscordPermissions &&
        checkResult.missingDiscordPermissions.length > 0
      ) {
        message += `\n부족한 Discord 권한: ${checkResult.missingDiscordPermissions.join(', ')}`;
      }

      return message;
    }

    const commandConfig = this.COMMAND_PERMISSIONS[commandName];

    if (!commandConfig) {
      return '❌ 정의되지 않은 명령어입니다.';
    }

    if (!commandConfig.enabled) {
      return '❌ 현재 비활성화된 명령어입니다.';
    }

    return `❌ 이 명령어는 ${PermissionLevel[commandConfig.level]} 권한이 필요합니다.`;
  }

  // ========== 관리 메서드 ==========

  /**
   * 명령어 활성화/비활성화
   * @param commandName - 명령어 이름
   * @param enabled - 활성화 여부
   * @returns 변경 성공 여부
   */
  static setCommandEnabled(commandName: string, enabled: boolean): boolean {
    const config = this.COMMAND_PERMISSIONS[commandName] as any;
    if (config) {
      config.enabled = enabled;
      return true;
    }
    return false;
  }

  /**
   * 명령어 권한 레벨 변경
   * @param commandName - 명령어 이름
   * @param level - 새로운 권한 레벨
   * @returns 변경 성공 여부
   */
  static setCommandPermissionLevel(commandName: string, level: PermissionLevel): boolean {
    const config = this.COMMAND_PERMISSIONS[commandName] as any;
    if (config) {
      config.level = level;
      return true;
    }
    return false;
  }

  /**
   * 역할 권한 매핑 추가/변경
   * @param roleName - 역할 이름
   * @param level - 권한 레벨
   */
  static setRolePermissionLevel(roleName: string, level: PermissionLevel): void {
    (this.ROLE_PERMISSION_MAP as any)[roleName] = level;
  }

  // ========== 조회 메서드 ==========

  /**
   * 모든 명령어 목록 조회
   * @param level - 특정 권한 레벨 필터 (선택사항)
   * @returns 명령어 목록
   */
  static getAllCommands(level?: PermissionLevel): string[] {
    const commands = Object.keys(this.COMMAND_PERMISSIONS);

    if (level !== undefined) {
      return commands.filter((cmd) => this.COMMAND_PERMISSIONS[cmd].level === level);
    }

    return commands;
  }

  /**
   * 사용자가 사용 가능한 명령어 목록 조회
   * @param member - 길드 멤버
   * @returns 사용 가능한 명령어 목록
   */
  static getAvailableCommands(member: GuildMember): string[] {
    return Object.keys(this.COMMAND_PERMISSIONS).filter((commandName) =>
      this.hasCommandPermission(member, commandName)
    );
  }

  /**
   * 권한 설정 요약 조회
   * @returns 권한 설정 요약
   */
  static getPermissionSummary(): {
    totalCommands: number;
    enabledCommands: number;
    disabledCommands: number;
    commandsByLevel: Record<string, number>;
    totalRoles: number;
  } {
    const commands = Object.values(this.COMMAND_PERMISSIONS);
    const commandsByLevel: Record<string, number> = {};

    // 레벨별 명령어 수 계산
    for (const level of Object.values(PermissionLevel)) {
      if (typeof level === 'number') {
        const levelName = PermissionLevel[level];
        commandsByLevel[levelName] = commands.filter((cmd) => cmd.level === level).length;
      }
    }

    return {
      totalCommands: commands.length,
      enabledCommands: commands.filter((cmd) => cmd.enabled).length,
      disabledCommands: commands.filter((cmd) => !cmd.enabled).length,
      commandsByLevel,
      totalRoles: Object.keys(this.ROLE_PERMISSION_MAP).length,
    };
  }

  // ========== 통계 관리 ==========

  /**
   * 통계 업데이트
   * @param commandName - 명령어 이름
   * @param action - 액션 ('check', 'allowed', 'denied')
   */
  private static updateStatistics(
    commandName: string,
    action: 'check' | 'allowed' | 'denied'
  ): void {
    this.statistics.lastCheckTime = new Date();

    if (action === 'check') {
      this.statistics.totalChecks++;
    } else {
      if (action === 'allowed') {
        this.statistics.successfulChecks++;
      } else {
        this.statistics.deniedChecks++;
      }

      // 명령어별 통계
      if (!this.statistics.checksByCommand[commandName]) {
        this.statistics.checksByCommand[commandName] = { allowed: 0, denied: 0 };
      }
      this.statistics.checksByCommand[commandName][action]++;

      // 레벨별 통계
      const commandConfig = this.COMMAND_PERMISSIONS[commandName];
      if (commandConfig) {
        const level = commandConfig.level;
        if (!this.statistics.checksByLevel[level]) {
          this.statistics.checksByLevel[level] = { allowed: 0, denied: 0 };
        }
        this.statistics.checksByLevel[level][action]++;
      }

      // 인기 명령어 업데이트
      this.updateMostUsedCommands(commandName);
    }
  }

  /**
   * 인기 명령어 목록 업데이트
   * @param commandName - 명령어 이름
   */
  private static updateMostUsedCommands(commandName: string): void {
    const existing = this.statistics.mostUsedCommands.find((cmd) => cmd.command === commandName);

    if (existing) {
      existing.uses++;
    } else {
      this.statistics.mostUsedCommands.push({ command: commandName, uses: 1 });
    }

    // 사용량 순으로 정렬하고 상위 10개만 유지
    this.statistics.mostUsedCommands.sort((a, b) => b.uses - a.uses);
    this.statistics.mostUsedCommands = this.statistics.mostUsedCommands.slice(0, 10);
  }

  /**
   * 권한 통계 조회
   * @returns 권한 통계
   */
  static getPermissionStatistics(): PermissionStatistics {
    return { ...this.statistics };
  }

  /**
   * 통계 초기화
   */
  static resetStatistics(): void {
    this.statistics = {
      totalChecks: 0,
      successfulChecks: 0,
      deniedChecks: 0,
      checksByCommand: {},
      checksByLevel: {
        [PermissionLevel.PUBLIC]: { allowed: 0, denied: 0 },
        [PermissionLevel.TRUSTED]: { allowed: 0, denied: 0 },
        [PermissionLevel.MODERATOR]: { allowed: 0, denied: 0 },
        [PermissionLevel.ADMIN]: { allowed: 0, denied: 0 },
        [PermissionLevel.SUPER_ADMIN]: { allowed: 0, denied: 0 },
      },
      lastCheckTime: new Date(),
      mostUsedCommands: [],
    };
  }

  // ========== 검증 메서드 ==========

  /**
   * 권한 설정 검증
   * @returns 검증 결과
   */
  static validatePermissions(): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // 명령어 설정 검증
      Object.entries(this.COMMAND_PERMISSIONS).forEach(([commandName, config]) => {
        if (config.level < PermissionLevel.PUBLIC || config.level > PermissionLevel.SUPER_ADMIN) {
          errors.push(`Invalid permission level for command ${commandName}: ${config.level}`);
        }

        if (config.specificRoles && config.specificRoles.length === 0) {
          warnings.push(`Command ${commandName} has empty specificRoles array`);
        }

        if (config.userIds && config.userIds.length === 0) {
          warnings.push(`Command ${commandName} has empty userIds array`);
        }
      });

      // 역할 매핑 검증
      Object.entries(this.ROLE_PERMISSION_MAP).forEach(([roleName, level]) => {
        if (level < PermissionLevel.PUBLIC || level > PermissionLevel.SUPER_ADMIN) {
          errors.push(`Invalid permission level for role ${roleName}: ${level}`);
        }
      });
    } catch (error) {
      errors.push(
        `Permission validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

// ========== 이전 버전과의 호환성 ==========

// 이전 방식의 상수들 (하위 호환성)
export const SUPER_ADMIN_ROLES = Object.entries(CommandPermissions['ROLE_PERMISSION_MAP'])
  .filter(([_, level]) => level === PermissionLevel.SUPER_ADMIN)
  .map(([roleName, _]) => roleName);

export const PUBLIC_COMMANDS = CommandPermissions.getAllCommands(PermissionLevel.PUBLIC);

export const ROLE_BASED_PERMISSIONS = Object.fromEntries(
  Object.entries(CommandPermissions['COMMAND_PERMISSIONS']).map(([cmdName, config]) => [
    cmdName,
    Object.entries(CommandPermissions['ROLE_PERMISSION_MAP'])
      .filter(([_, level]) => level >= config.level)
      .map(([roleName, _]) => roleName),
  ])
);

// 이전 방식의 함수들 (하위 호환성)
export function hasCommandPermission(member: GuildMember, commandName: string): boolean {
  return CommandPermissions.hasCommandPermission(member, commandName);
}

export function getPermissionDeniedMessage(commandName: string): string {
  return CommandPermissions.getPermissionDeniedMessage(commandName);
}

// 타입 내보내기
export type { PermissionStatistics };

// 권한 레벨 타입 유틸리티
export type PermissionLevelType = PermissionLevel;
export type CommandName = keyof (typeof CommandPermissions)['COMMAND_PERMISSIONS'];
export type RoleName = keyof (typeof CommandPermissions)['ROLE_PERMISSION_MAP'];
