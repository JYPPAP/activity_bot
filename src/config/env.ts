// src/config/env.ts - 환경변수 처리
import path from 'path';
import { fileURLToPath } from 'url';

import dotenv from 'dotenv';

import { Config } from '../types/index';

// ES 모듈에서 __dirname 구현
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

// 환경에 따른 .env 파일 선택
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';

// 환경별 .env 파일만 로드 (DB 기반 설정 시스템 사용)
dotenv.config({ path: path.join(rootDir, envFile) });

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
// 선택적 환경변수 임시 변수
const devId = getOptionalEnvVar('DEV_ID');
const forumChannelId = getOptionalEnvVar('FORUM_CHANNEL_ID');
const voiceCategoryId = getOptionalEnvVar('VOICE_CATEGORY_ID');
const forumTagId = getOptionalEnvVar('FORUM_TAG_ID');
const postgresHost = getOptionalEnvVar('POSTGRES_HOST');
const postgresPort = getOptionalEnvVar('POSTGRES_PORT');
const postgresDb = getOptionalEnvVar('POSTGRES_DB');
const postgresUser = getOptionalEnvVar('POSTGRES_USER');
const postgresPassword = getOptionalEnvVar('POSTGRES_PASSWORD');
const postgresSsl = getOptionalEnvVar('POSTGRES_SSL');
const nodeEnv = getOptionalEnvVar('NODE_ENV');
const errsoleHost = getOptionalEnvVar('ERRSOLE_HOST');
const errsolePort = getOptionalEnvVar('ERRSOLE_PORT');
const enableSlackAlerts = getOptionalEnvVar('ENABLE_SLACK_ALERTS');
const slackWebhookUrl = getOptionalEnvVar('SLACK_WEBHOOK_URL');
const slackChannel = getOptionalEnvVar('SLACK_CHANNEL');
const slackMinLevel = getOptionalEnvVar('SLACK_MIN_LEVEL');
const phoneIp = getOptionalEnvVar('PHONE_IP');

export const config: Config = {
  // 필수 환경변수
  TOKEN: validateEnvVar('TOKEN', process.env.TOKEN),
  CLIENT_ID: validateEnvVar('CLIENT_ID', process.env.CLIENT_ID),
  LOG_CHANNEL_ID: validateEnvVar('LOG_CHANNEL_ID', process.env.LOG_CHANNEL_ID),

  // 주의: GUILDID, EXCLUDED_CHANNELS는 이제 GuildSettingsManager를 통해 DB에서 관리됩니다

  // 선택적 환경변수 (조건부 할당)
  ...(devId && { DEV_ID: devId }),
  // 주의: 아래 채널 ID들은 이제 데이터베이스에서 우선 관리되며, 환경변수는 fallback용입니다
  ...(forumChannelId && { FORUM_CHANNEL_ID: forumChannelId }),
  ...(voiceCategoryId && { VOICE_CATEGORY_ID: voiceCategoryId }),
  ...(forumTagId && { FORUM_TAG_ID: forumTagId }),

  // PostgreSQL 설정 (필수 환경변수)
  POSTGRES_HOST: validateEnvVar('POSTGRES_HOST', postgresHost),
  POSTGRES_PORT: validateEnvVar('POSTGRES_PORT', postgresPort),
  POSTGRES_DB: validateEnvVar('POSTGRES_DB', postgresDb),
  POSTGRES_USER: validateEnvVar('POSTGRES_USER', postgresUser),
  POSTGRES_PASSWORD: validateEnvVar('POSTGRES_PASSWORD', postgresPassword),
  POSTGRES_SSL: postgresSsl || 'false',

  ...(nodeEnv && { NODE_ENV: nodeEnv }),
  ...(errsoleHost && { ERRSOLE_HOST: errsoleHost }),
  ...(errsolePort && { ERRSOLE_PORT: errsolePort }),
  ...(enableSlackAlerts && { ENABLE_SLACK_ALERTS: enableSlackAlerts }),
  ...(slackWebhookUrl && { SLACK_WEBHOOK_URL: slackWebhookUrl }),
  ...(slackChannel && { SLACK_CHANNEL: slackChannel }),
  ...(slackMinLevel && { SLACK_MIN_LEVEL: slackMinLevel }),
  ...(phoneIp && { PHONE_IP: phoneIp }),
};

// 환경변수 설정 로깅 (개발 환경에서만)
if (process.env.NODE_ENV === 'development') {
  console.log('환경변수 설정 완료:', {
    TOKEN: config.TOKEN ? '설정됨' : '미설정',
    CLIENT_ID: config.CLIENT_ID ? '설정됨' : '미설정',
    LOG_CHANNEL_ID: config.LOG_CHANNEL_ID ? '설정됨' : '미설정',
    DEV_ID: config.DEV_ID ? '설정됨' : '미설정',
    // PostgreSQL 설정 (필수)
    POSTGRES_HOST: config.POSTGRES_HOST ? '설정됨' : '미설정',
    POSTGRES_PORT: config.POSTGRES_PORT ? '설정됨' : '미설정',
    POSTGRES_DB: config.POSTGRES_DB ? '설정됨' : '미설정',
    POSTGRES_USER: config.POSTGRES_USER ? '설정됨' : '미설정',
    POSTGRES_PASSWORD: config.POSTGRES_PASSWORD ? '설정됨' : '미설정',
    POSTGRES_SSL: config.POSTGRES_SSL || 'false',
    // 주의: 아래 값들은 이제 데이터베이스에서 관리되며 환경변수는 fallback용입니다
    FORUM_CHANNEL_ID: config.FORUM_CHANNEL_ID
      ? '환경변수 설정됨 (fallback)'
      : 'DB에서 관리 (환경변수 미설정)',
    VOICE_CATEGORY_ID: config.VOICE_CATEGORY_ID
      ? '환경변수 설정됨 (fallback)'
      : 'DB에서 관리 (환경변수 미설정)',
    FORUM_TAG_ID: config.FORUM_TAG_ID
      ? '환경변수 설정됨 (fallback)'
      : 'DB에서 관리 (환경변수 미설정)',
    NODE_ENV: config.NODE_ENV || 'development',
    ERRSOLE_HOST: config.ERRSOLE_HOST ? '설정됨' : '미설정',
    ERRSOLE_PORT: config.ERRSOLE_PORT ? '설정됨' : '미설정',
    ENABLE_SLACK_ALERTS: config.ENABLE_SLACK_ALERTS ? '설정됨' : '미설정',
    SLACK_WEBHOOK_URL: config.SLACK_WEBHOOK_URL ? '설정됨' : '미설정',
    SLACK_CHANNEL: config.SLACK_CHANNEL ? '설정됨' : '미설정',
    SLACK_MIN_LEVEL: config.SLACK_MIN_LEVEL ? '설정됨' : '미설정',
    PHONE_IP: config.PHONE_IP ? '설정됨' : '미설정',
  });

  // 데이터베이스 우선 설정에 대한 안내
  console.log('');
  console.log('📋 설정 관리 방식:');
  console.log(
    '   ✅ GUILDID, EXCLUDED_CHANNELS는 이제 GuildSettingsManager를 통해 DB에서 관리됩니다'
  );
  console.log(
    '   ✅ FORUM_CHANNEL_ID, VOICE_CATEGORY_ID, FORUM_TAG_ID는 GuildSettingsManager를 통해 DB에서 관리됩니다'
  );
  console.log('   📝 /설정 명령어로 길드별 채널 설정을 변경할 수 있습니다');
  console.log('   🔄 환경변수는 fallback 용도로만 사용됩니다');
  console.log('');
}

// 환경변수 검증 함수
export function validateConfig(): boolean {
  const requiredEnvVars: Array<keyof Config> = ['TOKEN', 'CLIENT_ID', 'LOG_CHANNEL_ID', 'POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD'];

  const missingEnvVars = requiredEnvVars.filter((varName) => !config[varName]);

  if (missingEnvVars.length > 0) {
    throw new Error(`필수 환경변수가 설정되지 않았습니다: ${missingEnvVars.join(', ')}`);
  }

  return true;
}

// 환경변수 값 가져오기 헬퍼 함수
export function getEnvVar(key: keyof Config): string | string[] | undefined {
  return config[key];
}

// 환경변수 값 안전하게 가져오기 헬퍼 함수
export function getRequiredEnvVar(key: keyof Config): string {
  const value = config[key];
  if (!value || typeof value !== 'string') {
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
