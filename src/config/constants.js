// src/config/constants.js - 상수 정의
import path from 'path';
import { fileURLToPath } from 'url';

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
  LOG_DELAY: 300000, // 5분
  SAVE_ACTIVITY_DELAY: 600000, // 10분
};

// 색상 상수
export const COLORS = {
  ACTIVE: '#00FF00',
  INACTIVE: '#FF0000',
  LOG: '#0099ff',
};

// 메시지 타입 상수
export const MESSAGE_TYPES = {
  JOIN: '🔵 음성채널 입장',
  LEAVE: '🔴 음성채널 퇴장',
  CHANNEL_RENAME: '🔄 음성채널 이름 변경',
  CHANNEL_CREATE: '🤖 음성채널 생성',
};

// 기타 상수
export const FILTERS = {
  OBSERVATION: '[관전]',
  WAITING: '[대기]',
};