// src/config/RecruitmentConfig.js - 구인구직 기능 설정
export class RecruitmentConfig {
  // ========== 구인구직 기능 권한 설정 ==========
  static RECRUITMENT_ENABLED = true; // 구인구직 기능 활성화 여부 (true: 활성화, false: 비활성화)
  
  // 구인구직 기능 접근 허용 사용자 ID 목록
  static ALLOWED_USER_IDS = [
    '592666673627004939' // 특정 사용자 ID
  ];
  
  // ========== 역할 태그 설정 ==========
  static ROLE_TAG_VALUES = [
    '롤', '롤체', '배그', '발로',
    '옵치', '에펙', '마크', '스팀',
    '넥슨', 'RPG', '보드게임', '기타',
    '공포', '생존', '퍼즐'
  ];
  
  // 최대 선택 가능한 태그 수
  static MAX_SELECTED_TAGS = 5;
  
  // 버튼 그리드 설정 (4행 4열)
  static BUTTON_GRID_ROWS = 4;
  static BUTTON_GRID_COLS = 4;
  
  // ========== 타이밍 설정 ==========
  static CLEANUP_INTERVAL = 30000; // 30초마다 정리 작업
  static EMBED_SEND_DELAY = 5000; // 5초 후 임베드 전송
  
  // ========== 메시지 설정 ==========
  static MESSAGES = {
    RECRUITMENT_DISABLED: '❌ 구인구직 기능이 비활성화되어 있습니다.',
    NO_PERMISSION: '❌ 이 기능을 사용할 권한이 없습니다.',
    MAX_TAGS_EXCEEDED: `❌ 최대 ${this.MAX_SELECTED_TAGS}개까지만 선택할 수 있습니다.`,
    VOICE_CHANNEL_NOT_FOUND: '❌ 음성 채널을 찾을 수 없습니다.',
    FORUM_POST_NOT_FOUND: '❌ 포럼 포스트를 찾을 수 없습니다.',
    LINK_SUCCESS: '✅ 성공적으로 연동되었습니다!',
    LINK_FAILED: '❌ 연동에 실패했습니다. 다시 시도해주세요.',
    GENERIC_ERROR: '❌ 오류가 발생했습니다. 다시 시도해주세요.',
    SPECTATOR_MODE_SET: '👁️ 관전 모드로 설정되었습니다!',
    ALREADY_SPECTATOR: '👁️ 이미 관전 모드로 설정되어 있습니다.',
    NICKNAME_CHANGE_FAILED: '❌ 닉네임 변경에 실패했습니다.'
  };
  
  // ========== 색상 설정 ==========
  static COLORS = {
    SUCCESS: 0x00FF00,
    ERROR: 0xFF0000,
    WARNING: 0xFFB800,
    INFO: 0x0099FF,
    STANDALONE_POST: 0xFFB800
  };
}