// src/config/commandPermissions.js - 명령어 권한 설정
import { PermissionsBitField } from 'discord.js';
import { config } from './env.js';

// 모든 명령어에 대한 전체 권한을 가진 역할들
export const SUPER_ADMIN_ROLES = ['사장'];

// 일반 사용자도 사용 가능한 명령어들 (역할 없이도 사용 가능)
export const PUBLIC_COMMANDS = ['구직', '팀짜기'];

// 특정 역할이 필요한 명령어들
export const ROLE_BASED_PERMISSIONS = {
  'gap_list': SUPER_ADMIN_ROLES,
  'gap_config': SUPER_ADMIN_ROLES,
  'gap_reset': SUPER_ADMIN_ROLES,
  'gap_save': SUPER_ADMIN_ROLES,
  '보고서': SUPER_ADMIN_ROLES,
  'gap_cycle': SUPER_ADMIN_ROLES,
  'gap_afk': SUPER_ADMIN_ROLES,
  'gap_calendar': SUPER_ADMIN_ROLES,
  'gap_stats': SUPER_ADMIN_ROLES,
  '시간체크': SUPER_ADMIN_ROLES,
};

/**
 * 명령어 실행 권한 확인
 * @param {GuildMember} member - 길드 멤버
 * @param {string} commandName - 명령어 이름
 * @returns {boolean} - 권한 보유 여부
 */
export function hasCommandPermission(member, commandName) {
  // 1. DEV_ID 사용자 확인 (모든 명령어 사용 가능)
  if (config.DEV_ID && member.id === config.DEV_ID) {
    return true;
  }
  
  // 2. "사장" 역할 확인 (모든 명령어 사용 가능)
  const isSuperAdmin = member.roles.cache.some(role => 
    SUPER_ADMIN_ROLES.includes(role.name)
  );
  
  if (isSuperAdmin) {
    return true;
  }
  
  // 3. 일반 사용자도 사용 가능한 명령어 확인
  if (PUBLIC_COMMANDS.includes(commandName)) {
    return true;
  }
  
  // 4. 특정 역할이 필요한 명령어 확인
  const allowedRoles = ROLE_BASED_PERMISSIONS[commandName];
  if (allowedRoles && allowedRoles.length > 0) {
    return member.roles.cache.some(role => 
      allowedRoles.includes(role.name)
    );
  }
  
  // 5. 정의되지 않은 명령어는 기본적으로 거부
  return false;
}

/**
 * 권한 부족 시 표시할 메시지 생성
 * @param {string} commandName - 명령어 이름
 * @returns {string} - 권한 부족 메시지
 */
export function getPermissionDeniedMessage(commandName) {
  const allowedRoles = ROLE_BASED_PERMISSIONS[commandName];
  
  if (!allowedRoles || allowedRoles.length === 0) {
    return '❌ 이 명령어를 사용할 권한이 없습니다.';
  }
  
  const roleList = [...allowedRoles].join(', ');
  return `❌ 이 명령어는 다음 역할이 필요합니다: ${roleList} (또는 개발자 권한)`;
}