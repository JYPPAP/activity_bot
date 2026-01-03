// src/config/env.js - 환경변수 처리
import dotenv from 'dotenv';
import path from 'path';
import {fileURLToPath} from 'url';

// ES 모듈에서 __dirname 구현
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

// .env 파일 경로 명시적 지정
dotenv.config({path: path.join(rootDir, '.env')});

// 환경변수 설정 확인 및 기본값 제공
export const config = {
  // 필수 환경변수
  TOKEN: process.env.TOKEN,
  GUILDID: process.env.GUILDID,
  CLIENT_ID: process.env.CLIENT_ID,
  LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID,

  // 제외할 채널 ID 배열 (활동 시간 추적용)
  EXCLUDED_CHANNELS: [
    process.env.EXCLUDE_CHANNELID_1,
    process.env.EXCLUDE_CHANNELID_2,
    process.env.EXCLUDE_CHANNELID_3,
    process.env.EXCLUDE_CHANNELID_4,
    process.env.EXCLUDE_CHANNELID_5,
    process.env.EXCLUDE_CHANNELID_6,
  ].filter(Boolean), // null 또는 undefined 값 제거

  // 제외할 채널 ID 배열 (로그 출력용)
  EXCLUDED_CHANNELS_FOR_LOGS: [
    process.env.EXCLUDE_CHANNELID_1,
    process.env.EXCLUDE_CHANNELID_2,
    process.env.EXCLUDE_CHANNELID_3,
  ].filter(Boolean), // null 또는 undefined 값 제거

  // 개발자 ID
  DEV_ID: process.env.DEV_ID,

  // 목록 출력 채널
  CALENDAR_LOG_CHANNEL_ID: process.env.CALENDAR_LOG_CHANNEL_ID,

  // 구인구직 포럼 관련
  FORUM_CHANNEL_ID: process.env.FORUM_CHANNEL_ID,
  VOICE_CATEGORY_ID: process.env.VOICE_CATEGORY_ID,
  FORUM_TAG_ID: process.env.FORUM_TAG_ID,
  SCRIMMAGE_FORUM_CHANNEL_ID: process.env.SCRIMMAGE_FORUM_CHANNEL_ID, // 내전 전용 포럼 채널
  LONG_TERM_FORUM_CHANNEL_ID: process.env.LONG_TERM_FORUM_CHANNEL_ID,  // 장기 전용 포럼 채널

  // Errsole 설정
  NODE_ENV: process.env.NODE_ENV,
  ERRSOLE_HOST: process.env.ERRSOLE_HOST,
  ERRSOLE_PORT: process.env.ERRSOLE_PORT,

  // Slack 알림 설정
  ENABLE_SLACK_ALERTS: process.env.ENABLE_SLACK_ALERTS,
  SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL,
  SLACK_CHANNEL: process.env.SLACK_CHANNEL,
  SLACK_MIN_LEVEL: process.env.SLACK_MIN_LEVEL,
  PHONE_IP: process.env.PHONE_IP, // 네트워크 설정

  // PostgreSQL 데이터베이스 설정
  DATABASE_URL: process.env.DATABASE_URL || process.env.POSTGRES_URL
};

// 필수 환경변수 확인
const requiredEnvVars = ['TOKEN', 'GUILDID', 'LOG_CHANNEL_ID', 'DATABASE_URL'];
const missingEnvVars = requiredEnvVars.filter(varName => !config[varName]);

if (missingEnvVars.length > 0) {
  throw new Error(`필수 환경변수가 설정되지 않았습니다: ${missingEnvVars.join(', ')}`);
}