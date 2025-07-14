// src/config/constants.ts - 상수 정의
import path from 'path';
import { fileURLToPath } from 'url';

// ES 모듈에서 __dirname 구현
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

// ====================
// 파일 경로 상수
// ====================

export const PATHS = {
  ACTIVITY_INFO: path.join(ROOT_DIR, 'activity_info.json'),
  ROLE_CONFIG: path.join(ROOT_DIR, 'role_activity_config.json'),
  DATABASE: path.join(ROOT_DIR, 'activity_bot.json'),
  LOGS: path.join(ROOT_DIR, 'logs'),
  BACKUPS: path.join(ROOT_DIR, 'backups'),
  TEMP: path.join(ROOT_DIR, 'temp'),
  UPLOADS: path.join(ROOT_DIR, 'uploads'),
  EXPORTS: path.join(ROOT_DIR, 'exports'),
} as const;

// 파일 경로 타입
export type PathKey = keyof typeof PATHS;
export type PathValue = (typeof PATHS)[PathKey];

// ====================
// 시간 관련 상수 (밀리초 단위)
// ====================

export const TIME = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
  MONTH: 30 * 24 * 60 * 60 * 1000,
  YEAR: 365 * 24 * 60 * 60 * 1000,

  // 봇 동작 관련 시간
  LOG_DELAY: 30 * 1000, // 30초
  SAVE_ACTIVITY_DELAY: 60 * 1000, // 1분
  CACHE_TIMEOUT: 5 * 60 * 1000, // 5분
  BACKUP_INTERVAL: 24 * 60 * 60 * 1000, // 24시간
  CLEANUP_INTERVAL: 7 * 24 * 60 * 60 * 1000, // 7일

  // 타임아웃 관련
  COMMAND_TIMEOUT: 30 * 1000, // 30초
  DATABASE_TIMEOUT: 10 * 1000, // 10초
  API_TIMEOUT: 5 * 1000, // 5초

  // 재시도 관련
  RETRY_DELAY: 1 * 1000, // 1초
  MAX_RETRY_DELAY: 60 * 1000, // 60초
} as const;

// 시간 관련 타입
export type TimeKey = keyof typeof TIME;
export type TimeValue = (typeof TIME)[TimeKey];

// ====================
// 색상 상수
// ====================

export const COLORS = {
  // 활동 상태 색상
  ACTIVE: 0x00ff00, // 초록색
  INACTIVE: 0xff0000, // 빨간색
  SLEEP: 0xd3d3d3, // 잠수 상태 색상 (파스텔 톤 라이트 그레이)
  IDLE: 0xffff00, // 노란색

  // 로그 색상
  LOG: 0x0099ff, // 기본 로그 색상 (파란색)
  LOG_JOIN: 0x4a86e8, // 입장 로그 색상 (파스텔 파란색)
  LOG_RENAME: 0x4a86e8, // 이름 변경 로그 색상 (파스텔 파란색)
  LOG_LEAVE: 0xe67c73, // 퇴장 로그 색상 (파스텔 빨간색)
  LOG_CREATE: 0x57bb8a, // 생성 로그 색상 (파스텔 초록색)

  // 상태 색상
  SUCCESS: 0x00ff00, // 성공 색상 (초록색)
  ERROR: 0xff0000, // 오류 색상 (빨간색)
  WARNING: 0xffff00, // 경고 색상 (노란색)
  INFO: 0x0099ff, // 정보 색상 (파란색)

  // UI 색상
  PRIMARY: 0x5865f2, // 디스코드 기본 색상
  SECONDARY: 0x57f287, // 디스코드 보조 색상
  DANGER: 0xed4245, // 위험 색상
  BLURPLE: 0x5865f2, // 디스코드 블러플 색상

  // 투명도 색상
  TRANSPARENT: 0x000000, // 투명
  LIGHT_GREY: 0xf2f3f5, // 밝은 회색
  DARK_GREY: 0x36393f, // 어두운 회색
} as const;

// 색상 타입
export type ColorKey = keyof typeof COLORS;
export type ColorValue = (typeof COLORS)[ColorKey];

// ====================
// 메시지 타입 상수
// ====================

export const MESSAGE_TYPES = {
  JOIN: '음성채널 입장',
  LEAVE: '음성채널 퇴장',
  MOVE: '음성채널 이동',
  DISCONNECT: '음성채널 연결 해제',
  CHANNEL_RENAME: '🔄 음성채널 이름 변경',
  CHANNEL_CREATE: '🤖 음성채널 생성',
  CHANNEL_DELETE: '🗑️ 음성채널 삭제',
  ROLE_UPDATE: '🏷️ 역할 업데이트',
  PERMISSION_UPDATE: '🔐 권한 업데이트',
  BOT_START: '🤖 봇 시작',
  BOT_STOP: '🛑 봇 중지',
  BOT_RESTART: '🔄 봇 재시작',
  ERROR: '❌ 오류',
  WARNING: '⚠️ 경고',
  INFO: 'ℹ️ 정보',
  SUCCESS: '✅ 성공',
  DEBUG: '🐛 디버그',
} as const;

// 메시지 타입 타입
export type MessageTypeKey = keyof typeof MESSAGE_TYPES;
export type MessageTypeValue = (typeof MESSAGE_TYPES)[MessageTypeKey];

// ====================
// 필터 상수
// ====================

export const FILTERS = {
  OBSERVATION: '[관전]',
  WAITING: '[대기]',
  AFK: '[잠수]',
  BUSY: '[바쁨]',
  STREAMING: '[방송]',
  GAMING: '[게임]',
  STUDYING: '[공부]',
  WORKING: '[업무]',
  SLEEPING: '[수면]',
  EATING: '[식사]',
  MEETING: '[회의]',
  OFFLINE: '[오프라인]',
} as const;

// 필터 타입
export type FilterKey = keyof typeof FILTERS;
export type FilterValue = (typeof FILTERS)[FilterKey];

// ====================
// 활동 상태 상수
// ====================

export const ACTIVITY_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  AFK: 'afk',
  OFFLINE: 'offline',
  UNKNOWN: 'unknown',
} as const;

// 활동 상태 타입
export type ActivityStatusKey = keyof typeof ACTIVITY_STATUS;
export type ActivityStatusValue = (typeof ACTIVITY_STATUS)[ActivityStatusKey];

// ====================
// 권한 레벨 상수
// ====================

export const PERMISSION_LEVELS = {
  OWNER: 0,
  ADMIN: 1,
  MODERATOR: 2,
  MEMBER: 3,
  GUEST: 4,
} as const;

// 권한 레벨 타입
export type PermissionLevelKey = keyof typeof PERMISSION_LEVELS;
export type PermissionLevelValue = (typeof PERMISSION_LEVELS)[PermissionLevelKey];

// ====================
// 명령어 카테고리 상수
// ====================

export const COMMAND_CATEGORIES = {
  ACTIVITY: 'activity',
  CONFIGURATION: 'configuration',
  UTILITY: 'utility',
  MODERATION: 'moderation',
  RECRUITMENT: 'recruitment',
  STATISTICS: 'statistics',
  ADMIN: 'admin',
  DEBUG: 'debug',
} as const;

// 명령어 카테고리 타입
export type CommandCategoryKey = keyof typeof COMMAND_CATEGORIES;
export type CommandCategoryValue = (typeof COMMAND_CATEGORIES)[CommandCategoryKey];

// ====================
// 이벤트 타입 상수
// ====================

export const EVENT_TYPES = {
  VOICE_STATE_UPDATE: 'voiceStateUpdate',
  MEMBER_JOIN: 'memberJoin',
  MEMBER_LEAVE: 'memberLeave',
  MEMBER_UPDATE: 'memberUpdate',
  ROLE_UPDATE: 'roleUpdate',
  CHANNEL_CREATE: 'channelCreate',
  CHANNEL_UPDATE: 'channelUpdate',
  CHANNEL_DELETE: 'channelDelete',
  MESSAGE_CREATE: 'messageCreate',
  MESSAGE_UPDATE: 'messageUpdate',
  MESSAGE_DELETE: 'messageDelete',
  INTERACTION_CREATE: 'interactionCreate',
  READY: 'ready',
  ERROR: 'error',
  WARN: 'warn',
  DEBUG: 'debug',
} as const;

// 이벤트 타입 타입
export type EventTypeKey = keyof typeof EVENT_TYPES;
export type EventTypeValue = (typeof EVENT_TYPES)[EventTypeKey];

// ====================
// 데이터베이스 테이블 상수
// ====================

export const DATABASE_TABLES = {
  USER_ACTIVITY: 'user_activity',
  ROLE_CONFIG: 'role_config',
  ACTIVITY_LOGS: 'activity_logs',
  RESET_HISTORY: 'reset_history',
  LOG_MEMBERS: 'log_members',
  AFK_STATUS: 'afk_status',
  FORUM_MESSAGES: 'forum_messages',
  VOICE_CHANNEL_MAPPINGS: 'voice_channel_mappings',
  BOT_SETTINGS: 'bot_settings',
  MIGRATION_INFO: 'migration_info',
} as const;

// 데이터베이스 테이블 타입
export type DatabaseTableKey = keyof typeof DATABASE_TABLES;
export type DatabaseTableValue = (typeof DATABASE_TABLES)[DatabaseTableKey];

// ====================
// 로그 레벨 상수
// ====================

export const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4,
} as const;

// 로그 레벨 타입
export type LogLevelKey = keyof typeof LOG_LEVELS;
export type LogLevelValue = (typeof LOG_LEVELS)[LogLevelKey];

// ====================
// 제한 상수
// ====================

export const LIMITS = {
  MAX_EMBED_FIELDS: 25,
  MAX_EMBED_DESCRIPTION: 4096,
  MAX_EMBED_TITLE: 256,
  MAX_EMBED_FOOTER: 2048,
  MAX_EMBED_AUTHOR: 256,
  MAX_SELECT_OPTIONS: 25,
  MAX_BUTTONS_PER_ROW: 5,
  MAX_ROWS_PER_MESSAGE: 5,
  MAX_MODAL_COMPONENTS: 5,
  MAX_AUTOCOMPLETE_CHOICES: 25,
  MAX_COMMAND_NAME_LENGTH: 32,
  MAX_COMMAND_DESCRIPTION_LENGTH: 100,
  MAX_OPTION_NAME_LENGTH: 32,
  MAX_OPTION_DESCRIPTION_LENGTH: 100,
  MAX_CHOICE_NAME_LENGTH: 100,
  MAX_CHOICE_VALUE_LENGTH: 100,
  MAX_MESSAGE_LENGTH: 2000,
  MAX_REASON_LENGTH: 512,
  MAX_NICKNAME_LENGTH: 32,
  MAX_CHANNEL_NAME_LENGTH: 100,
  MAX_ROLE_NAME_LENGTH: 100,
  MAX_GUILD_NAME_LENGTH: 100,
  MAX_WEBHOOK_NAME_LENGTH: 80,
  MAX_WEBHOOK_AVATAR_SIZE: 8 * 1024 * 1024, // 8MB
  MAX_FILE_SIZE: 8 * 1024 * 1024, // 8MB
  MAX_ATTACHMENT_SIZE: 8 * 1024 * 1024, // 8MB
  MAX_BULK_DELETE_AGE: 14 * 24 * 60 * 60 * 1000, // 14일
  MAX_AUDIT_LOG_ENTRIES: 100,
  MAX_MEMBERS_PER_CHUNK: 1000,
  MAX_PRESENCES_PER_CHUNK: 1000,
  MAX_EMOJIS_PER_GUILD: 50,
  MAX_ROLES_PER_GUILD: 250,
  MAX_CHANNELS_PER_GUILD: 500,
  MAX_BANS_PER_GUILD: 1000,
  MAX_VOICE_USERS_PER_CHANNEL: 99,
  MAX_BITRATE: 384000,
  MAX_USER_LIMIT: 99,
  MAX_SLOWMODE_SECONDS: 21600, // 6시간
  MAX_TIMEOUT_SECONDS: 2419200, // 4주
} as const;

// 제한 타입
export type LimitKey = keyof typeof LIMITS;
export type LimitValue = (typeof LIMITS)[LimitKey];

// ====================
// 정규식 상수
// ====================

export const REGEX = {
  USER_ID: /^[0-9]{17,19}$/,
  CHANNEL_ID: /^[0-9]{17,19}$/,
  GUILD_ID: /^[0-9]{17,19}$/,
  ROLE_ID: /^[0-9]{17,19}$/,
  MESSAGE_ID: /^[0-9]{17,19}$/,
  EMOJI_ID: /^[0-9]{17,19}$/,
  WEBHOOK_ID: /^[0-9]{17,19}$/,
  APPLICATION_ID: /^[0-9]{17,19}$/,
  SNOWFLAKE: /^[0-9]{17,19}$/,
  USER_MENTION: /^<@!?([0-9]{17,19})>$/,
  CHANNEL_MENTION: /^<#([0-9]{17,19})>$/,
  ROLE_MENTION: /^<@&([0-9]{17,19})>$/,
  EMOJI_MENTION: /^<a?:[a-zA-Z0-9_]{2,32}:([0-9]{17,19})>$/,
  TIMESTAMP: /^<t:([0-9]{1,13})(?::[tTdDfFR])?>$/,
  MASKED_LINK: /^\[([^\]]+)\]\(([^)]+)\)$/,
  URL: /^https?:\/\/[^\s]+$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  IPV4: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
  IPV6: /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/,
  MAC_ADDRESS: /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  HEX_COLOR: /^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/,
  SEMANTIC_VERSION:
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
  DISCORD_INVITE:
    /^(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discordapp\.com\/invite)\/([a-zA-Z0-9-]+)$/,
  DISCORD_MESSAGE_LINK:
    /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/([0-9]{17,19})\/([0-9]{17,19})\/([0-9]{17,19})$/,
} as const;

// 정규식 타입
export type RegexKey = keyof typeof REGEX;
export type RegexValue = (typeof REGEX)[RegexKey];

// ====================
// 기본값 상수
// ====================

export const DEFAULTS = {
  ACTIVITY_THRESHOLD: 1, // 1시간
  CACHE_SIZE: 1000,
  CACHE_TTL: 300, // 5분
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000, // 1초
  BATCH_SIZE: 100,
  PAGE_SIZE: 10,
  MAX_RESULTS: 100,
  TIMEOUT: 30000, // 30초
  HEARTBEAT_INTERVAL: 60000, // 1분
  BACKUP_RETENTION: 7, // 7일
  LOG_RETENTION: 30, // 30일
  MAX_LOG_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_MEMORY_USAGE: 100 * 1024 * 1024, // 100MB
  MAX_CPU_USAGE: 80, // 80%
  MIN_DISK_SPACE: 1024 * 1024 * 1024, // 1GB
  CONNECTION_POOL_SIZE: 10,
  QUERY_TIMEOUT: 30000, // 30초
  TRANSACTION_TIMEOUT: 60000, // 1분
  LOCK_TIMEOUT: 10000, // 10초
  IDLE_TIMEOUT: 300000, // 5분
  KEEPALIVE_INTERVAL: 30000, // 30초
} as const;

// 기본값 타입
export type DefaultKey = keyof typeof DEFAULTS;
export type DefaultValue = (typeof DEFAULTS)[DefaultKey];

// ====================
// 유틸리티 함수
// ====================

// 색상 값을 16진수 문자열로 변환
export function colorToHex(color: ColorValue): string {
  return `#${color.toString(16).padStart(6, '0').toUpperCase()}`;
}

// 16진수 문자열을 색상 값으로 변환
export function hexToColor(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

// 시간 값을 사람이 읽기 쉬운 형태로 변환
export function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}일 ${hours % 24}시간 ${minutes % 60}분`;
  if (hours > 0) return `${hours}시간 ${minutes % 60}분`;
  if (minutes > 0) return `${minutes}분 ${seconds % 60}초`;
  return `${seconds}초`;
}

// 경로 검증
export function validatePath(pathKey: PathKey): boolean {
  const pathValue = PATHS[pathKey];
  return typeof pathValue === 'string' && pathValue.length > 0;
}

// 색상 검증
export function validateColor(color: unknown): color is ColorValue {
  return typeof color === 'number' && color >= 0 && color <= 0xffffff;
}

// 권한 레벨 비교
export function hasPermission(
  userLevel: PermissionLevelValue,
  requiredLevel: PermissionLevelValue
): boolean {
  return userLevel <= requiredLevel;
}

// 정규식 테스트
export function testRegex(pattern: RegexKey, input: string): boolean {
  return REGEX[pattern].test(input);
}

// 제한 확인
export function checkLimit(limitKey: LimitKey, value: number): boolean {
  return value <= LIMITS[limitKey];
}

// 모든 타입들은 이미 개별적으로 export되어 있습니다.
