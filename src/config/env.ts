// src/config/env.ts - 환경변수 처리
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Config } from '../types/index.js';

// ES 모듈에서 __dirname 구현
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

// .env 파일 경로 명시적 지정
dotenv.config({ path: path.join(rootDir, '.env') });

// 환경변수 유효성 검증 함수
function validateEnvVar(varName: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`필수 환경변수가 설정되지 않았습니다: ${varName}`);
  }
  return value;
}

// 선택적 환경변수 처리 함수
function getOptionalEnvVar(varName: string): string | undefined {
  return process.env[varName] || undefined;
}

// 환경변수 설정 확인 및 기본값 제공
export const config: Config = {
  // 필수 환경변수
  TOKEN: validateEnvVar('TOKEN', process.env.TOKEN),
  GUILDID: validateEnvVar('GUILDID', process.env.GUILDID),
  CLIENT_ID: validateEnvVar('CLIENT_ID', process.env.CLIENT_ID),
  LOG_CHANNEL_ID: validateEnvVar('LOG_CHANNEL_ID', process.env.LOG_CHANNEL_ID),

  // 제외할 채널 ID 배열 (활동 시간 추적용)
  EXCLUDED_CHANNELS: [
    process.env.EXCLUDE_CHANNELID_1,
    process.env.EXCLUDE_CHANNELID_2,
    process.env.EXCLUDE_CHANNELID_3,
    process.env.EXCLUDE_CHANNELID_4,
    process.env.EXCLUDE_CHANNELID_5,
    process.env.EXCLUDE_CHANNELID_6,
  ].filter((id): id is string => Boolean(id)), // 타입 가드로 필터링

  // 제외할 채널 ID 배열 (로그 출력용)
  EXCLUDED_CHANNELS_FOR_LOGS: [
    process.env.EXCLUDE_CHANNELID_1,
    process.env.EXCLUDE_CHANNELID_2,
    process.env.EXCLUDE_CHANNELID_3,
  ].filter((id): id is string => Boolean(id)), // 타입 가드로 필터링

  // 선택적 환경변수
  DEV_ID: getOptionalEnvVar('DEV_ID'),
  CALENDAR_LOG_CHANNEL_ID: getOptionalEnvVar('CALENDAR_LOG_CHANNEL_ID'),

  // 구인구직 포럼 관련
  FORUM_CHANNEL_ID: getOptionalEnvVar('FORUM_CHANNEL_ID'),
  VOICE_CATEGORY_ID: getOptionalEnvVar('VOICE_CATEGORY_ID'),
  FORUM_TAG_ID: getOptionalEnvVar('FORUM_TAG_ID'),

  // Errsole 설정
  NODE_ENV: getOptionalEnvVar('NODE_ENV'),
  ERRSOLE_HOST: getOptionalEnvVar('ERRSOLE_HOST'),
  ERRSOLE_PORT: getOptionalEnvVar('ERRSOLE_PORT'),

  // Slack 알림 설정
  ENABLE_SLACK_ALERTS: getOptionalEnvVar('ENABLE_SLACK_ALERTS'),
  SLACK_WEBHOOK_URL: getOptionalEnvVar('SLACK_WEBHOOK_URL'),
  SLACK_CHANNEL: getOptionalEnvVar('SLACK_CHANNEL'),
  SLACK_MIN_LEVEL: getOptionalEnvVar('SLACK_MIN_LEVEL'),
  PHONE_IP: getOptionalEnvVar('PHONE_IP'), // 네트워크 설정
};

// 환경변수 설정 로깅 (개발 환경에서만)
if (process.env.NODE_ENV === 'development') {
  console.log('환경변수 설정 완료:', {
    TOKEN: config.TOKEN ? '설정됨' : '미설정',
    GUILDID: config.GUILDID ? '설정됨' : '미설정',
    CLIENT_ID: config.CLIENT_ID ? '설정됨' : '미설정',
    LOG_CHANNEL_ID: config.LOG_CHANNEL_ID ? '설정됨' : '미설정',
    EXCLUDED_CHANNELS_COUNT: config.EXCLUDED_CHANNELS.length,
    EXCLUDED_CHANNELS_FOR_LOGS_COUNT: config.EXCLUDED_CHANNELS_FOR_LOGS.length,
    DEV_ID: config.DEV_ID ? '설정됨' : '미설정',
    CALENDAR_LOG_CHANNEL_ID: config.CALENDAR_LOG_CHANNEL_ID ? '설정됨' : '미설정',
    FORUM_CHANNEL_ID: config.FORUM_CHANNEL_ID ? '설정됨' : '미설정',
    VOICE_CATEGORY_ID: config.VOICE_CATEGORY_ID ? '설정됨' : '미설정',
    FORUM_TAG_ID: config.FORUM_TAG_ID ? '설정됨' : '미설정',
    NODE_ENV: config.NODE_ENV || 'development',
    ERRSOLE_HOST: config.ERRSOLE_HOST ? '설정됨' : '미설정',
    ERRSOLE_PORT: config.ERRSOLE_PORT ? '설정됨' : '미설정',
    ENABLE_SLACK_ALERTS: config.ENABLE_SLACK_ALERTS ? '설정됨' : '미설정',
    SLACK_WEBHOOK_URL: config.SLACK_WEBHOOK_URL ? '설정됨' : '미설정',
    SLACK_CHANNEL: config.SLACK_CHANNEL ? '설정됨' : '미설정',
    SLACK_MIN_LEVEL: config.SLACK_MIN_LEVEL ? '설정됨' : '미설정',
    PHONE_IP: config.PHONE_IP ? '설정됨' : '미설정',
  });
}

// 환경변수 검증 함수
export function validateConfig(): boolean {
  const requiredEnvVars: Array<keyof Config> = [
    'TOKEN',
    'GUILDID',
    'LOG_CHANNEL_ID'
  ];

  const missingEnvVars = requiredEnvVars.filter(varName => !config[varName]);

  if (missingEnvVars.length > 0) {
    throw new Error(`필수 환경변수가 설정되지 않았습니다: ${missingEnvVars.join(', ')}`);
  }

  return true;
}

// 환경변수 값 가져오기 헬퍼 함수
export function getEnvVar(key: keyof Config): string | undefined {
  return config[key];
}

// 환경변수 값 안전하게 가져오기 헬퍼 함수
export function getRequiredEnvVar(key: keyof Config): string {
  const value = config[key];
  if (!value) {
    throw new Error(`필수 환경변수가 설정되지 않았습니다: ${key}`);
  }
  return value;
}

// 개발 환경 여부 확인
export function isDevelopment(): boolean {
  return config.NODE_ENV === 'development';
}

// 프로덕션 환경 여부 확인
export function isProduction(): boolean {
  return config.NODE_ENV === 'production';
}

// 테스트 환경 여부 확인
export function isTest(): boolean {
  return config.NODE_ENV === 'test';
}

// Slack 알림 활성화 여부 확인
export function isSlackAlertsEnabled(): boolean {
  return config.ENABLE_SLACK_ALERTS === 'true';
}

// 환경변수 업데이트 함수 (주의: 런타임 중 사용)
export function updateEnvVar(key: keyof Config, value: string | undefined): void {
  (config as any)[key] = value;
  if (isDevelopment()) {
    console.log(`환경변수 업데이트: ${key} = ${value ? '설정됨' : '미설정'}`);
  }
}

// 환경변수 초기화 실행
validateConfig();