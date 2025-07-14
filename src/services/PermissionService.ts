// src/services/PermissionService.ts - 권한 관리 서비스
import { User, GuildMember, PermissionFlagsBits } from 'discord.js';

import { RecruitmentConfig } from '../config/RecruitmentConfig.js';

// 권한 결과 인터페이스
interface PermissionResult {
  success: boolean;
  message: string;
  data?: any;
}

// 사용자 목록 결과 인터페이스
interface UserListResult extends PermissionResult {
  users: string[];
}

// 권한 요약 인터페이스
interface PermissionSummary {
  hasRecruitmentPermission: boolean;
  isAdmin: boolean;
  canManageChannels: boolean;
  canManageNicknames: boolean;
  canManageMessages: boolean;
  canManageRoles: boolean;
  canKickMembers: boolean;
  canBanMembers: boolean;
  canManageGuild: boolean;
  canViewAuditLog: boolean;
  isInAllowedList: boolean;
  recruitmentEnabled: boolean;
  permissions: string[];
  warnings: string[];
}

// 권한 수준 열거형
enum PermissionLevel {
  USER = 'user',
  MODERATOR = 'moderator',
  ADMIN = 'admin',
  OWNER = 'owner',
}

// 권한 체크 결과 인터페이스 (currently unused)
// interface PermissionCheck {
//   allowed: boolean;
//   reason: string;
//   level: PermissionLevel;
//   requiredLevel: PermissionLevel;
//   additionalInfo?: string;
// }

// 권한 감사 로그 인터페이스
interface PermissionAuditLog {
  userId: string;
  action: string;
  target?: string;
  result: boolean;
  timestamp: Date;
  reason?: string;
}

// 역할 기반 권한 설정 인터페이스
interface RolePermissionConfig {
  roleId: string;
  roleName: string;
  permissions: string[];
  priority: number;
  isActive: boolean;
}

export class PermissionService {
  private static auditLogs: PermissionAuditLog[] = [];
  private static maxAuditLogs: number = 1000;
  private static rolePermissions: Map<string, RolePermissionConfig> = new Map();
  private static permissionCache: Map<
    string,
    { permissions: PermissionSummary; timestamp: number }
  > = new Map();
  private static cacheTimeout: number = 5 * 60 * 1000; // 5분

  /**
   * 사용자가 구인구직 기능에 접근할 수 있는지 확인
   * @param user - 확인할 사용자
   * @param member - 길드 멤버 객체 (관리자 권한 확인용)
   * @returns 접근 가능 여부
   */
  static hasRecruitmentPermission(user: User, member: GuildMember | null = null): boolean {
    try {
      // 구인구직 기능이 비활성화된 경우
      if (!RecruitmentConfig.RECRUITMENT_ENABLED) {
        console.log(`[PermissionService] ❌ 구인구직 기능이 비활성화됨`);
        this.logPermissionCheck(user.id, 'recruitment_access', false, '기능 비활성화');
        return false;
      }

      // 캐시된 권한 확인
      const cached = this.getCachedPermissions(user.id);
      if (cached?.hasRecruitmentPermission !== undefined) {
        console.log(`[PermissionService] 📋 캐시된 권한 사용: ${user.displayName} (${user.id})`);
        return cached.hasRecruitmentPermission;
      }

      // 관리자 권한이 있는 경우 항상 허용
      if (member && this.hasAdminPermission(member)) {
        console.log(`[PermissionService] ✅ 관리자 권한: ${user.displayName} (${user.id})`);
        this.logPermissionCheck(user.id, 'recruitment_access', true, '관리자 권한');
        return true;
      }

      // 역할 기반 권한 확인
      if (member && this.hasRolePermission(member, 'recruitment')) {
        console.log(`[PermissionService] ✅ 역할 기반 권한: ${user.displayName} (${user.id})`);
        this.logPermissionCheck(user.id, 'recruitment_access', true, '역할 기반 권한');
        return true;
      }

      // 디버깅용: 특정 사용자만 허용하는 모드
      if (process.env.RECRUITMENT_RESTRICTED_MODE === 'true') {
        // 허용된 사용자 ID 목록에 있는 경우
        if (RecruitmentConfig.ALLOWED_USER_IDS.includes(user.id)) {
          console.log(`[PermissionService] ✅ 허용된 사용자: ${user.displayName} (${user.id})`);
          this.logPermissionCheck(user.id, 'recruitment_access', true, '허용된 사용자');
          return true;
        }

        console.log(
          `[PermissionService] ❌ 제한 모드에서 허용되지 않은 사용자: ${user.displayName} (${user.id})`
        );
        this.logPermissionCheck(user.id, 'recruitment_access', false, '제한 모드');
        return false;
      }

      // 구인구직 기능이 활성화된 경우 모든 사용자 접근 허용
      console.log(`[PermissionService] ✅ 구인구직 접근 허용: ${user.displayName} (${user.id})`);
      this.logPermissionCheck(user.id, 'recruitment_access', true, '기본 허용');
      return true;
    } catch (error) {
      console.error(`[PermissionService] 구인구직 권한 확인 오류:`, error);
      this.logPermissionCheck(user.id, 'recruitment_access', false, '오류 발생');
      return false;
    }
  }

  /**
   * 관리자 권한 확인
   * @param member - 길드 멤버 객체
   * @returns 관리자 권한 여부
   */
  static hasAdminPermission(member: GuildMember): boolean {
    return member.permissions.has(PermissionFlagsBits.Administrator);
  }

  /**
   * 역할 기반 권한 확인
   * @param member - 길드 멤버 객체
   * @param permission - 확인할 권한
   * @returns 권한 여부
   */
  static hasRolePermission(member: GuildMember, permission: string): boolean {
    for (const role of member.roles.cache.values()) {
      const roleConfig = this.rolePermissions.get(role.id);
      if (roleConfig && roleConfig.isActive && roleConfig.permissions.includes(permission)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 사용자가 특정 포럼 포스트를 관리할 수 있는지 확인
   * @param user - 확인할 사용자
   * @param member - 길드 멤버 객체
   * @param postOwnerId - 포스트 소유자 ID
   * @returns 관리 권한 여부
   */
  static canManagePost(user: User, member: GuildMember | null, postOwnerId: string): boolean {
    try {
      // 포스트 작성자인 경우
      if (user.id === postOwnerId) {
        this.logPermissionCheck(user.id, 'manage_post', true, '포스트 소유자');
        return true;
      }

      // 관리자 권한이 있는 경우
      if (member && this.hasAdminPermission(member)) {
        this.logPermissionCheck(user.id, 'manage_post', true, '관리자 권한');
        return true;
      }

      // 모더레이터 권한이 있는 경우
      if (member && member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        this.logPermissionCheck(user.id, 'manage_post', true, '모더레이터 권한');
        return true;
      }

      // 역할 기반 포스트 관리 권한
      if (member && this.hasRolePermission(member, 'manage_posts')) {
        this.logPermissionCheck(user.id, 'manage_post', true, '역할 기반 권한');
        return true;
      }

      this.logPermissionCheck(user.id, 'manage_post', false, '권한 없음');
      return false;
    } catch (error) {
      console.error(`[PermissionService] 포스트 관리 권한 확인 오류:`, error);
      this.logPermissionCheck(user.id, 'manage_post', false, '오류 발생');
      return false;
    }
  }

  /**
   * 사용자가 음성 채널을 관리할 수 있는지 확인
   * @param member - 길드 멤버 객체
   * @returns 관리 권한 여부
   */
  static canManageVoiceChannels(member: GuildMember | null): boolean {
    if (!member) return false;

    try {
      const hasPermission =
        member.permissions.has(PermissionFlagsBits.ManageChannels) ||
        member.permissions.has(PermissionFlagsBits.Administrator) ||
        this.hasRolePermission(member, 'manage_voice_channels');

      this.logPermissionCheck(
        member.id,
        'manage_voice_channels',
        hasPermission,
        hasPermission ? '권한 있음' : '권한 없음'
      );

      return hasPermission;
    } catch (error) {
      console.error(`[PermissionService] 음성 채널 관리 권한 확인 오류:`, error);
      this.logPermissionCheck(member.id, 'manage_voice_channels', false, '오류 발생');
      return false;
    }
  }

  /**
   * 사용자가 다른 멤버의 닉네임을 변경할 수 있는지 확인
   * @param member - 권한을 확인할 멤버
   * @param targetMember - 대상 멤버
   * @returns 닉네임 변경 권한 여부
   */
  static canManageNicknames(
    member: GuildMember | null,
    targetMember: GuildMember | null = null
  ): boolean {
    if (!member) return false;

    try {
      // 자신의 닉네임은 항상 변경 가능
      if (!targetMember || member.id === targetMember.id) {
        this.logPermissionCheck(member.id, 'manage_nickname', true, '자신의 닉네임');
        return true;
      }

      // 관리자나 닉네임 관리 권한이 있는 경우
      const hasPermission =
        member.permissions.has(PermissionFlagsBits.ManageNicknames) ||
        member.permissions.has(PermissionFlagsBits.Administrator) ||
        this.hasRolePermission(member, 'manage_nicknames');

      // 권한 계층 확인 (관리자는 다른 관리자의 닉네임 변경 불가)
      if (
        hasPermission &&
        targetMember &&
        this.hasAdminPermission(targetMember) &&
        !this.hasAdminPermission(member)
      ) {
        this.logPermissionCheck(member.id, 'manage_nickname', false, '대상이 상위 권한');
        return false;
      }

      this.logPermissionCheck(
        member.id,
        'manage_nickname',
        hasPermission,
        hasPermission ? '권한 있음' : '권한 없음'
      );

      return hasPermission;
    } catch (error) {
      console.error(`[PermissionService] 닉네임 관리 권한 확인 오류:`, error);
      this.logPermissionCheck(member.id, 'manage_nickname', false, '오류 발생');
      return false;
    }
  }

  /**
   * 구인구직 기능 활성화/비활성화
   * @param enabled - 활성화 여부
   * @param user - 변경 요청 사용자
   * @param member - 길드 멤버 객체
   * @returns 결과
   */
  static setRecruitmentEnabled(
    enabled: boolean,
    user: User,
    member: GuildMember | null
  ): PermissionResult {
    try {
      // 관리자만 기능 활성화/비활성화 가능
      if (!member || !this.hasAdminPermission(member)) {
        this.logPermissionCheck(user.id, 'set_recruitment_enabled', false, '관리자 권한 없음');
        return {
          success: false,
          message: '❌ 관리자만 구인구직 기능을 활성화/비활성화할 수 있습니다.',
        };
      }

      const previousState = RecruitmentConfig.RECRUITMENT_ENABLED;
      RecruitmentConfig.RECRUITMENT_ENABLED = enabled;
      const status = enabled ? '활성화' : '비활성화';

      // 권한 캐시 초기화 (설정 변경으로 인한)
      this.clearPermissionCache();

      console.log(`[PermissionService] 구인구직 기능 ${status}: ${user.displayName} (${user.id})`);
      this.logPermissionCheck(
        user.id,
        'set_recruitment_enabled',
        true,
        `${previousState} -> ${enabled}`
      );

      return {
        success: true,
        message: `✅ 구인구직 기능이 ${status}되었습니다.`,
        data: { previousState, newState: enabled },
      };
    } catch (error) {
      console.error(`[PermissionService] 구인구직 기능 설정 오류:`, error);
      this.logPermissionCheck(user.id, 'set_recruitment_enabled', false, '오류 발생');
      return {
        success: false,
        message: '❌ 설정 변경 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * 허용된 사용자 목록에 사용자 추가
   * @param userId - 추가할 사용자 ID
   * @param requestUser - 요청 사용자
   * @param requestMember - 요청 멤버 객체
   * @returns 결과
   */
  static addAllowedUser(
    userId: string,
    requestUser: User,
    requestMember: GuildMember | null
  ): PermissionResult {
    try {
      // 관리자만 사용자 추가 가능
      if (!requestMember || !this.hasAdminPermission(requestMember)) {
        this.logPermissionCheck(requestUser.id, 'add_allowed_user', false, '관리자 권한 없음');
        return {
          success: false,
          message: '❌ 관리자만 허용된 사용자를 추가할 수 있습니다.',
        };
      }

      // 입력 검증
      if (!userId || typeof userId !== 'string' || userId.length < 10) {
        return {
          success: false,
          message: '❌ 유효하지 않은 사용자 ID입니다.',
        };
      }

      // 이미 목록에 있는지 확인
      if (RecruitmentConfig.ALLOWED_USER_IDS.includes(userId)) {
        return {
          success: false,
          message: '⚠️ 해당 사용자는 이미 허용된 목록에 있습니다.',
        };
      }

      RecruitmentConfig.ALLOWED_USER_IDS.push(userId);

      // 해당 사용자의 권한 캐시 초기화
      this.clearUserPermissionCache(userId);

      console.log(
        `[PermissionService] 허용된 사용자 추가: ${userId} (요청자: ${requestUser.displayName})`
      );
      this.logPermissionCheck(requestUser.id, 'add_allowed_user', true, `추가된 사용자: ${userId}`);

      return {
        success: true,
        message: `✅ 사용자 <@${userId}>가 허용된 목록에 추가되었습니다.`,
        data: { addedUserId: userId, totalAllowed: RecruitmentConfig.ALLOWED_USER_IDS.length },
      };
    } catch (error) {
      console.error(`[PermissionService] 허용된 사용자 추가 오류:`, error);
      this.logPermissionCheck(requestUser.id, 'add_allowed_user', false, '오류 발생');
      return {
        success: false,
        message: '❌ 사용자 추가 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * 허용된 사용자 목록에서 사용자 제거
   * @param userId - 제거할 사용자 ID
   * @param requestUser - 요청 사용자
   * @param requestMember - 요청 멤버 객체
   * @returns 결과
   */
  static removeAllowedUser(
    userId: string,
    requestUser: User,
    requestMember: GuildMember | null
  ): PermissionResult {
    try {
      // 관리자만 사용자 제거 가능
      if (!requestMember || !this.hasAdminPermission(requestMember)) {
        this.logPermissionCheck(requestUser.id, 'remove_allowed_user', false, '관리자 권한 없음');
        return {
          success: false,
          message: '❌ 관리자만 허용된 사용자를 제거할 수 있습니다.',
        };
      }

      const index = RecruitmentConfig.ALLOWED_USER_IDS.indexOf(userId);
      if (index === -1) {
        return {
          success: false,
          message: '⚠️ 해당 사용자는 허용된 목록에 없습니다.',
        };
      }

      RecruitmentConfig.ALLOWED_USER_IDS.splice(index, 1);

      // 해당 사용자의 권한 캐시 초기화
      this.clearUserPermissionCache(userId);

      console.log(
        `[PermissionService] 허용된 사용자 제거: ${userId} (요청자: ${requestUser.displayName})`
      );
      this.logPermissionCheck(
        requestUser.id,
        'remove_allowed_user',
        true,
        `제거된 사용자: ${userId}`
      );

      return {
        success: true,
        message: `✅ 사용자 <@${userId}>가 허용된 목록에서 제거되었습니다.`,
        data: { removedUserId: userId, totalAllowed: RecruitmentConfig.ALLOWED_USER_IDS.length },
      };
    } catch (error) {
      console.error(`[PermissionService] 허용된 사용자 제거 오류:`, error);
      this.logPermissionCheck(requestUser.id, 'remove_allowed_user', false, '오류 발생');
      return {
        success: false,
        message: '❌ 사용자 제거 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * 현재 허용된 사용자 목록 가져오기
   * @param requestUser - 요청 사용자
   * @param requestMember - 요청 멤버 객체
   * @returns 결과
   */
  static getAllowedUsers(requestUser: User, requestMember: GuildMember | null): UserListResult {
    try {
      // 관리자만 목록 조회 가능
      if (!requestMember || !this.hasAdminPermission(requestMember)) {
        this.logPermissionCheck(requestUser.id, 'get_allowed_users', false, '관리자 권한 없음');
        return {
          success: false,
          users: [],
          message: '❌ 관리자만 허용된 사용자 목록을 조회할 수 있습니다.',
        };
      }

      this.logPermissionCheck(requestUser.id, 'get_allowed_users', true, '목록 조회');

      return {
        success: true,
        users: [...RecruitmentConfig.ALLOWED_USER_IDS],
        message: `📋 현재 허용된 사용자: ${RecruitmentConfig.ALLOWED_USER_IDS.length}명`,
        data: {
          totalUsers: RecruitmentConfig.ALLOWED_USER_IDS.length,
          restrictedMode: process.env.RECRUITMENT_RESTRICTED_MODE === 'true',
        },
      };
    } catch (error) {
      console.error(`[PermissionService] 허용된 사용자 목록 조회 오류:`, error);
      this.logPermissionCheck(requestUser.id, 'get_allowed_users', false, '오류 발생');
      return {
        success: false,
        users: [],
        message: '❌ 목록 조회 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * 권한 요약 정보 생성
   * @param user - 대상 사용자
   * @param member - 길드 멤버 객체
   * @returns 권한 요약
   */
  static getPermissionSummary(user: User, member: GuildMember | null): PermissionSummary {
    try {
      // 캐시 확인
      const cached = this.getCachedPermissions(user.id);
      if (cached) {
        return cached;
      }

      const permissions: string[] = [];
      const warnings: string[] = [];

      // 기본 권한들 확인
      const isAdmin = member ? this.hasAdminPermission(member) : false;
      const canManageChannels = member
        ? member.permissions.has(PermissionFlagsBits.ManageChannels)
        : false;
      const canManageNicknames = member
        ? member.permissions.has(PermissionFlagsBits.ManageNicknames)
        : false;
      const canManageMessages = member
        ? member.permissions.has(PermissionFlagsBits.ManageMessages)
        : false;
      const canManageRoles = member
        ? member.permissions.has(PermissionFlagsBits.ManageRoles)
        : false;
      const canKickMembers = member
        ? member.permissions.has(PermissionFlagsBits.KickMembers)
        : false;
      const canBanMembers = member ? member.permissions.has(PermissionFlagsBits.BanMembers) : false;
      const canManageGuild = member
        ? member.permissions.has(PermissionFlagsBits.ManageGuild)
        : false;
      const canViewAuditLog = member
        ? member.permissions.has(PermissionFlagsBits.ViewAuditLog)
        : false;

      // 권한 목록 구성
      if (isAdmin) permissions.push('Administrator');
      if (canManageChannels) permissions.push('Manage Channels');
      if (canManageNicknames) permissions.push('Manage Nicknames');
      if (canManageMessages) permissions.push('Manage Messages');
      if (canManageRoles) permissions.push('Manage Roles');
      if (canKickMembers) permissions.push('Kick Members');
      if (canBanMembers) permissions.push('Ban Members');
      if (canManageGuild) permissions.push('Manage Guild');
      if (canViewAuditLog) permissions.push('View Audit Log');

      // 역할 기반 권한 추가
      if (member) {
        for (const role of member.roles.cache.values()) {
          const roleConfig = this.rolePermissions.get(role.id);
          if (roleConfig?.isActive) {
            permissions.push(`Role: ${roleConfig.roleName}`);
          }
        }
      }

      // 경고 메시지 생성
      if (!member) {
        warnings.push('멤버 정보를 찾을 수 없습니다.');
      }

      if (
        process.env.RECRUITMENT_RESTRICTED_MODE === 'true' &&
        !RecruitmentConfig.ALLOWED_USER_IDS.includes(user.id) &&
        !isAdmin
      ) {
        warnings.push('제한 모드에서 구인구직 기능 접근이 제한됩니다.');
      }

      const summary: PermissionSummary = {
        hasRecruitmentPermission: this.hasRecruitmentPermission(user, member),
        isAdmin,
        canManageChannels,
        canManageNicknames,
        canManageMessages,
        canManageRoles,
        canKickMembers,
        canBanMembers,
        canManageGuild,
        canViewAuditLog,
        isInAllowedList: RecruitmentConfig.ALLOWED_USER_IDS.includes(user.id),
        recruitmentEnabled: RecruitmentConfig.RECRUITMENT_ENABLED,
        permissions,
        warnings,
      };

      // 캐시에 저장
      this.cachePermissions(user.id, summary);

      return summary;
    } catch (error) {
      console.error(`[PermissionService] 권한 요약 생성 오류:`, error);

      // 오류 발생 시 기본 권한 반환
      return {
        hasRecruitmentPermission: false,
        isAdmin: false,
        canManageChannels: false,
        canManageNicknames: false,
        canManageMessages: false,
        canManageRoles: false,
        canKickMembers: false,
        canBanMembers: false,
        canManageGuild: false,
        canViewAuditLog: false,
        isInAllowedList: false,
        recruitmentEnabled: RecruitmentConfig.RECRUITMENT_ENABLED,
        permissions: [],
        warnings: ['권한 정보 로드 중 오류가 발생했습니다.'],
      };
    }
  }

  /**
   * 사용자의 권한 수준 확인
   * @param user - 사용자
   * @param member - 멤버 객체
   * @returns 권한 수준
   */
  static getUserPermissionLevel(user: User, member: GuildMember | null): PermissionLevel {
    if (!member) return PermissionLevel.USER;

    if (member.guild.ownerId === user.id) return PermissionLevel.OWNER;
    if (this.hasAdminPermission(member)) return PermissionLevel.ADMIN;
    if (
      member.permissions.has(PermissionFlagsBits.ManageMessages) ||
      member.permissions.has(PermissionFlagsBits.ManageChannels)
    )
      return PermissionLevel.MODERATOR;

    return PermissionLevel.USER;
  }

  /**
   * 역할 기반 권한 설정 추가
   * @param roleId - 역할 ID
   * @param roleName - 역할 이름
   * @param permissions - 권한 목록
   * @param priority - 우선순위
   * @returns 설정 성공 여부
   */
  static addRolePermission(
    roleId: string,
    roleName: string,
    permissions: string[],
    priority: number = 0
  ): boolean {
    try {
      this.rolePermissions.set(roleId, {
        roleId,
        roleName,
        permissions,
        priority,
        isActive: true,
      });

      console.log(`[PermissionService] 역할 권한 설정 추가: ${roleName} (${roleId})`);
      return true;
    } catch (error) {
      console.error(`[PermissionService] 역할 권한 설정 추가 오류:`, error);
      return false;
    }
  }

  /**
   * 권한 감사 로그 기록
   * @param userId - 사용자 ID
   * @param action - 액션
   * @param result - 결과
   * @param reason - 사유
   * @param target - 대상
   */
  private static logPermissionCheck(
    userId: string,
    action: string,
    result: boolean,
    reason?: string,
    target?: string
  ): void {
    const log: PermissionAuditLog = {
      userId,
      action,
      result,
      timestamp: new Date(),
      ...(target && { target }),
      ...(reason && { reason }),
    };

    this.auditLogs.push(log);

    // 로그 크기 제한
    if (this.auditLogs.length > this.maxAuditLogs) {
      this.auditLogs = this.auditLogs.slice(-this.maxAuditLogs);
    }
  }

  /**
   * 권한 캐시 저장
   * @param userId - 사용자 ID
   * @param permissions - 권한 정보
   */
  private static cachePermissions(userId: string, permissions: PermissionSummary): void {
    this.permissionCache.set(userId, {
      permissions,
      timestamp: Date.now(),
    });
  }

  /**
   * 캐시된 권한 조회
   * @param userId - 사용자 ID
   * @returns 캐시된 권한 정보
   */
  private static getCachedPermissions(userId: string): PermissionSummary | null {
    const cached = this.permissionCache.get(userId);
    if (!cached) return null;

    // 캐시 만료 확인
    if (Date.now() - cached.timestamp > this.cacheTimeout) {
      this.permissionCache.delete(userId);
      return null;
    }

    return cached.permissions;
  }

  /**
   * 특정 사용자의 권한 캐시 초기화
   * @param userId - 사용자 ID
   */
  private static clearUserPermissionCache(userId: string): void {
    this.permissionCache.delete(userId);
  }

  /**
   * 모든 권한 캐시 초기화
   */
  private static clearPermissionCache(): void {
    this.permissionCache.clear();
  }

  /**
   * 권한 감사 로그 조회
   * @param userId - 사용자 ID (선택사항)
   * @param limit - 조회 제한
   * @returns 감사 로그
   */
  static getAuditLogs(userId?: string, limit: number = 100): PermissionAuditLog[] {
    let logs = this.auditLogs;

    if (userId) {
      logs = logs.filter((log) => log.userId === userId);
    }

    return logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, limit);
  }

  /**
   * 권한 통계 조회
   * @returns 권한 통계
   */
  static getPermissionStats(): {
    totalAuditLogs: number;
    recentActions: Record<string, number>;
    successRate: number;
    topUsers: Array<{ userId: string; actionCount: number }>;
    allowedUsersCount: number;
    recruitmentEnabled: boolean;
  } {
    const recentActions: Record<string, number> = {};
    let successCount = 0;

    this.auditLogs.forEach((log) => {
      recentActions[log.action] = (recentActions[log.action] || 0) + 1;
      if (log.result) successCount++;
    });

    const userActionCounts = new Map<string, number>();
    this.auditLogs.forEach((log) => {
      userActionCounts.set(log.userId, (userActionCounts.get(log.userId) || 0) + 1);
    });

    const topUsers = Array.from(userActionCounts.entries())
      .map(([userId, actionCount]) => ({ userId, actionCount }))
      .sort((a, b) => b.actionCount - a.actionCount)
      .slice(0, 10);

    return {
      totalAuditLogs: this.auditLogs.length,
      recentActions,
      successRate: this.auditLogs.length > 0 ? (successCount / this.auditLogs.length) * 100 : 0,
      topUsers,
      allowedUsersCount: RecruitmentConfig.ALLOWED_USER_IDS.length,
      recruitmentEnabled: RecruitmentConfig.RECRUITMENT_ENABLED,
    };
  }

  /**
   * 권한 시스템 초기화
   */
  static initialize(): void {
    console.log('[PermissionService] 권한 시스템 초기화 중...');

    // 기본 역할 권한 설정
    this.setupDefaultRolePermissions();

    // 캐시 정리 작업 스케줄링
    setInterval(
      () => {
        this.cleanupExpiredCache();
      },
      10 * 60 * 1000
    ); // 10분마다 실행

    console.log('[PermissionService] 권한 시스템 초기화 완료');
  }

  /**
   * 기본 역할 권한 설정
   */
  private static setupDefaultRolePermissions(): void {
    // 여기에 기본 역할 권한을 설정할 수 있습니다
    // 예: this.addRolePermission('roleId', 'roleName', ['permission1', 'permission2'], 1);
  }

  /**
   * 만료된 캐시 정리
   */
  private static cleanupExpiredCache(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [userId, cached] of this.permissionCache.entries()) {
      if (now - cached.timestamp > this.cacheTimeout) {
        this.permissionCache.delete(userId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[PermissionService] 만료된 캐시 정리: ${cleanedCount}개 항목 제거`);
    }
  }
}
