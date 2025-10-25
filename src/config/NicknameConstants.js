// src/config/NicknameConstants.js - 닉네임 관리 시스템 상수

export const NicknameConstants = {
  // Custom ID 접두사
  CUSTOM_ID_PREFIXES: {
    // 드롭다운
    MAIN_SELECT: 'nickname_main_',           // 메인 드롭다운
    PLATFORM_SELECT: 'nickname_platform_',   // 플랫폼 선택 드롭다운
    DELETE_SELECT: 'nickname_delete_',       // 삭제할 닉네임 선택 드롭다운

    // 버튼
    DELETE_BTN: 'nickname_delete_btn_',      // 삭제 버튼
    VIEW_BTN: 'nickname_view_btn_',          // 내 정보 조회 버튼
    EDIT: 'nickname_edit_',                  // 수정 버튼
    REMOVE: 'nickname_remove_',              // 개별 삭제 버튼
    VISIT: 'nickname_visit_',                // 프로필 방문 버튼

    // 모달
    ADD_MODAL: 'nickname_add_modal_',        // 등록 모달
    EDIT_MODAL: 'nickname_edit_modal_',      // 수정 모달
    ADMIN_ADD_MODAL: 'nickname_admin_add_',  // 관리자 플랫폼 추가 모달
    ADMIN_EDIT_MODAL: 'nickname_admin_edit_', // 관리자 플랫폼 수정 모달
  },

  // 특수 값
  SPECIAL_VALUES: {
    REGISTER: 'nickname_register',           // "닉네임 등록!" 선택 시
  },

  // 제한사항
  LIMITS: {
    PLATFORM_NAME_MAX: 100,                  // 플랫폼명 최대 길이
    USER_IDENTIFIER_MAX: 200,                // 사용자 ID 최대 길이
    BASE_URL_MAX: 500,                       // Base URL 최대 길이
    URL_PATTERN_MAX: 500,                    // URL 패턴 최대 길이
    FULL_URL_MAX: 700,                       // 전체 URL 최대 길이
    EMOJI_MAX: 50,                           // 이모지 최대 길이
    MAX_PLATFORMS_PER_GUILD: 25,             // 길드당 최대 플랫폼 수 (드롭다운 제한)
    MAX_NICKNAMES_PER_USER: 25,              // 사용자당 최대 닉네임 수
  },

  // 메시지
  MESSAGES: {
    // 성공 메시지
    PLATFORM_ADDED: '✅ 플랫폼이 성공적으로 등록되었습니다.',
    PLATFORM_UPDATED: '✅ 플랫폼 정보가 수정되었습니다.',
    PLATFORM_DELETED: '✅ 플랫폼이 삭제되었습니다.',
    NICKNAME_ADDED: '✅ 닉네임이 등록되었습니다!',
    NICKNAME_UPDATED: '✅ 닉네임이 수정되었습니다.',
    NICKNAME_DELETED: '✅ 닉네임이 삭제되었습니다.',

    // 에러 메시지
    NO_PLATFORMS: '❌ 등록된 플랫폼이 없습니다.\n관리자에게 플랫폼 등록을 요청하세요.',
    NO_NICKNAMES: 'ℹ️ 등록된 닉네임이 없습니다.',
    PLATFORM_LIMIT_REACHED: '❌ 최대 플랫폼 수에 도달했습니다.',
    NICKNAME_LIMIT_REACHED: '❌ 최대 닉네임 등록 수에 도달했습니다.',
    ALREADY_REGISTERED: '⚠️ 이미 해당 플랫폼에 닉네임이 등록되어 있습니다.',
    PLATFORM_NOT_FOUND: '❌ 플랫폼을 찾을 수 없습니다.',
    NICKNAME_NOT_FOUND: '❌ 닉네임을 찾을 수 없습니다.',
    INVALID_URL: '❌ 유효하지 않은 URL 형식입니다.',
    INVALID_INPUT: '❌ 입력값이 올바르지 않습니다.',
    PERMISSION_DENIED: '❌ 이 기능을 사용할 권한이 없습니다.',

    // 안내 메시지
    URL_PATTERN_HELP: '💡 URL 패턴 도움말:\n`{base_url}` - Base URL\n`{user_id}` - 사용자 ID\n\n예시: `{base_url}{user_id}/`',
  },

  // 임베드 색상
  COLORS: {
    PRIMARY: 0x5865F2,      // Discord 블루
    SUCCESS: 0x57F287,      // 성공 (초록)
    ERROR: 0xED4245,        // 에러 (빨강)
    WARNING: 0xFEE75C,      // 경고 (노랑)
    INFO: 0x5865F2,         // 정보 (파랑)
  },

  // 기본 이모지
  DEFAULT_EMOJIS: {
    PLATFORM: '🎮',
    STEAM: '🎮',
    DISCORD: '💬',
    EPIC: '🎯',
    BATTLENET: '⚔️',
    ORIGIN: '🔥',
    GOG: '📦',
    REGISTER: '➕',
    DELETE: '❌',
    VIEW: '📋',
    EDIT: '✏️',
    LINK: '🔗',
    COPY: '📋',
  },

  // URL 패턴 플레이스홀더
  URL_PLACEHOLDERS: {
    BASE_URL: '{base_url}',
    USER_ID: '{user_id}',
  },

  // 기본 URL 패턴
  DEFAULT_URL_PATTERN: '{base_url}{user_id}/',
};
