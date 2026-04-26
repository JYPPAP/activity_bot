// src/config/constants.js - 상수 정의
import path from 'path';
import {fileURLToPath} from 'url';

// ES 모듈에서 __dirname 구현
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

// 파일 경로 상수
export const PATHS = {
  ACTIVITY_INFO: path.join(ROOT_DIR, 'activity_info.json'),
  ROLE_CONFIG: path.join(ROOT_DIR, 'role_activity_config.json'),
};

// 시간 관련 상수 (밀리초 단위)
export const TIME = {
  LOG_DELAY: 3000,       // 3초 — 마지막 이벤트 후 이 시간 내 추가 이벤트 없으면 즉시 전송 (디바운스)
  LOG_MAX_WAIT: 10000,   // 10초 — 이벤트가 계속 와도 이 시간 후에는 강제 전송 (최대 대기)
  SAVE_ACTIVITY_DELAY: 60000, // 1분
};

// 색상 상수
export const COLORS = {
  ACTIVE: '#00FF00',
  INACTIVE: '#FF0000',
  SLEEP: '#D3D3D3',         // 잠수 상태 색상 (파스텔 톤 라이트 그레이)
  LOG: '#0099ff',           // 기본 로그 색상 (파란색)
  LOG_JOIN: '#4A86E8',      // 입장 로그 색상 (파스텔 파란색)
  LOG_RENAME: '#4A86E8',    // 이름 변경 로그 색상 (파스텔 파란색)
  LOG_LEAVE: '#E67C73',     // 퇴장 로그 색상 (파스텔 빨간색)
  LOG_CREATE: '#57BB8A',    // 생성 로그 색상 (파스텔 초록색)
};

// 메시지 타입 상수
export const MESSAGE_TYPES = {
  JOIN: '음성채널 입장',
  LEAVE: '음성채널 퇴장',
  CHANNEL_RENAME: '🔄 음성채널 이름 변경',
  CHANNEL_CREATE: '🤖 음성채널 생성',
};

// 기타 상수
export const FILTERS = {
  OBSERVATION: '[관전]',
  WAITING: '[대기]',
};