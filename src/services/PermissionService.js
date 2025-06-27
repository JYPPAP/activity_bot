// src/services/PermissionService.js - 권한 관리 서비스
import { RecruitmentConfig } from '../config/RecruitmentConfig.js';

export class PermissionService {
  /**
   * 사용자가 구인구직 기능에 접근할 수 있는지 확인
   * @param {User} user - 확인할 사용자
   * @param {GuildMember} member - 길드 멤버 객체 (관리자 권한 확인용)
   * @returns {boolean} - 접근 가능 여부
   */
  static hasRecruitmentPermission(user, member = null) {
    // 구인구직 기능이 비활성화된 경우
    if (!RecruitmentConfig.RECRUITMENT_ENABLED) {
      console.log(`[PermissionService] ❌ 구인구직 기능이 비활성화됨`);
      return false;
    }

    // 허용된 사용자 ID 목록에 있는 경우
    if (RecruitmentConfig.ALLOWED_USER_IDS.includes(user.id)) {
      console.log(`[PermissionService] ✅ 허용된 사용자: ${user.displayName} (${user.id})`);
      return true;
    }

    // 관리자 권한이 있는 경우
    if (member && member.permissions.has('Administrator')) {
      console.log(`[PermissionService] ✅ 관리자 권한: ${user.displayName} (${user.id})`);
      return true;
    }

    console.log(`[PermissionService] ❌ 권한 없음: ${user.displayName} (${user.id})`);
    return false;
  }
  
  /**
   * 사용자가 특정 포럼 포스트를 관리할 수 있는지 확인
   * @param {User} user - 확인할 사용자
   * @param {GuildMember} member - 길드 멤버 객체
   * @param {string} postOwnerId - 포스트 소유자 ID
   * @returns {boolean} - 관리 권한 여부
   */
  static canManagePost(user, member, postOwnerId) {
    // 포스트 작성자인 경우
    if (user.id === postOwnerId) {
      return true;
    }
    
    // 관리자 권한이 있는 경우
    if (member && member.permissions.has('Administrator')) {
      return true;
    }
    
    // 모더레이터 권한이 있는 경우 (필요시 추가)
    if (member && member.permissions.has('ManageMessages')) {
      return true;
    }
    
    return false;
  }
  
  /**
   * 사용자가 음성 채널을 관리할 수 있는지 확인
   * @param {GuildMember} member - 길드 멤버 객체
   * @returns {boolean} - 관리 권한 여부
   */
  static canManageVoiceChannels(member) {
    if (!member) return false;
    
    return member.permissions.has('ManageChannels') || 
           member.permissions.has('Administrator');
  }
  
  /**
   * 사용자가 다른 멤버의 닉네임을 변경할 수 있는지 확인
   * @param {GuildMember} member - 권한을 확인할 멤버
   * @param {GuildMember} targetMember - 대상 멤버
   * @returns {boolean} - 닉네임 변경 권한 여부
   */
  static canManageNicknames(member, targetMember = null) {
    if (!member) return false;
    
    // 자신의 닉네임은 항상 변경 가능
    if (!targetMember || member.id === targetMember.id) {
      return true;
    }
    
    // 관리자나 닉네임 관리 권한이 있는 경우
    return member.permissions.has('ManageNicknames') || 
           member.permissions.has('Administrator');
  }
  
  /**
   * 구인구직 기능 활성화/비활성화
   * @param {boolean} enabled - 활성화 여부
   * @param {User} user - 변경 요청 사용자
   * @param {GuildMember} member - 길드 멤버 객체
   * @returns {Object} - 결과 { success: boolean, message: string }
   */
  static setRecruitmentEnabled(enabled, user, member) {
    // 관리자만 기능 활성화/비활성화 가능
    if (!member || !member.permissions.has('Administrator')) {
      return {
        success: false,
        message: '❌ 관리자만 구인구직 기능을 활성화/비활성화할 수 있습니다.'
      };
    }
    
    RecruitmentConfig.RECRUITMENT_ENABLED = enabled;
    const status = enabled ? '활성화' : '비활성화';
    
    console.log(`[PermissionService] 구인구직 기능 ${status}: ${user.displayName} (${user.id})`);
    
    return {
      success: true,
      message: `✅ 구인구직 기능이 ${status}되었습니다.`
    };
  }
  
  /**
   * 허용된 사용자 목록에 사용자 추가
   * @param {string} userId - 추가할 사용자 ID
   * @param {User} requestUser - 요청 사용자
   * @param {GuildMember} requestMember - 요청 멤버 객체
   * @returns {Object} - 결과 { success: boolean, message: string }
   */
  static addAllowedUser(userId, requestUser, requestMember) {
    // 관리자만 사용자 추가 가능
    if (!requestMember || !requestMember.permissions.has('Administrator')) {
      return {
        success: false,
        message: '❌ 관리자만 허용된 사용자를 추가할 수 있습니다.'
      };
    }
    
    // 이미 목록에 있는지 확인
    if (RecruitmentConfig.ALLOWED_USER_IDS.includes(userId)) {
      return {
        success: false,
        message: '⚠️ 해당 사용자는 이미 허용된 목록에 있습니다.'
      };
    }
    
    RecruitmentConfig.ALLOWED_USER_IDS.push(userId);
    
    console.log(`[PermissionService] 허용된 사용자 추가: ${userId} (요청자: ${requestUser.displayName})`);
    
    return {
      success: true,
      message: `✅ 사용자 <@${userId}>가 허용된 목록에 추가되었습니다.`
    };
  }
  
  /**
   * 허용된 사용자 목록에서 사용자 제거
   * @param {string} userId - 제거할 사용자 ID
   * @param {User} requestUser - 요청 사용자
   * @param {GuildMember} requestMember - 요청 멤버 객체
   * @returns {Object} - 결과 { success: boolean, message: string }
   */
  static removeAllowedUser(userId, requestUser, requestMember) {
    // 관리자만 사용자 제거 가능
    if (!requestMember || !requestMember.permissions.has('Administrator')) {
      return {
        success: false,
        message: '❌ 관리자만 허용된 사용자를 제거할 수 있습니다.'
      };
    }
    
    const index = RecruitmentConfig.ALLOWED_USER_IDS.indexOf(userId);
    if (index === -1) {
      return {
        success: false,
        message: '⚠️ 해당 사용자는 허용된 목록에 없습니다.'
      };
    }
    
    RecruitmentConfig.ALLOWED_USER_IDS.splice(index, 1);
    
    console.log(`[PermissionService] 허용된 사용자 제거: ${userId} (요청자: ${requestUser.displayName})`);
    
    return {
      success: true,
      message: `✅ 사용자 <@${userId}>가 허용된 목록에서 제거되었습니다.`
    };
  }
  
  /**
   * 현재 허용된 사용자 목록 가져오기
   * @param {User} requestUser - 요청 사용자
   * @param {GuildMember} requestMember - 요청 멤버 객체
   * @returns {Object} - 결과 { success: boolean, users: Array, message: string }
   */
  static getAllowedUsers(requestUser, requestMember) {
    // 관리자만 목록 조회 가능
    if (!requestMember || !requestMember.permissions.has('Administrator')) {
      return {
        success: false,
        users: [],
        message: '❌ 관리자만 허용된 사용자 목록을 조회할 수 있습니다.'
      };
    }
    
    return {
      success: true,
      users: [...RecruitmentConfig.ALLOWED_USER_IDS],
      message: `📋 현재 허용된 사용자: ${RecruitmentConfig.ALLOWED_USER_IDS.length}명`
    };
  }
  
  /**
   * 권한 요약 정보 생성
   * @param {User} user - 대상 사용자
   * @param {GuildMember} member - 길드 멤버 객체
   * @returns {Object} - 권한 요약
   */
  static getPermissionSummary(user, member) {
    return {
      hasRecruitmentPermission: this.hasRecruitmentPermission(user, member),
      isAdmin: member ? member.permissions.has('Administrator') : false,
      canManageChannels: member ? member.permissions.has('ManageChannels') : false,
      canManageNicknames: member ? member.permissions.has('ManageNicknames') : false,
      canManageMessages: member ? member.permissions.has('ManageMessages') : false,
      isInAllowedList: RecruitmentConfig.ALLOWED_USER_IDS.includes(user.id),
      recruitmentEnabled: RecruitmentConfig.RECRUITMENT_ENABLED
    };
  }
}