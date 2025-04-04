// src/config/env.js - 환경변수 처리
import dotenv from 'dotenv';

// .env 파일 로드
dotenv.config();

// 환경변수 설정 확인 및 기본값 제공
export const config = {
  // 필수 환경변수
  TOKEN: process.env.TOKEN,
  GUILDID: process.env.GUILDID,
  LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID,

  // 제외할 채널 ID 배열
  EXCLUDED_CHANNELS: [
    process.env.EXCLUDE_CHANNELID_1,
    process.env.EXCLUDE_CHANNELID_2,
    process.env.EXCLUDE_CHANNELID_3,
    process.env.EXCLUDE_CHANNELID_4,
    process.env.EXCLUDE_CHANNELID_5,
    process.env.EXCLUDE_CHANNELID_6, // 방-생성하기 채널 ID 추가
  ].filter(Boolean), // null 또는 undefined 값 제거

  // 개발자 ID
  DEV_ID: process.env.DEV_ID,

  // 목록 출력 채널
  CALENDAR_LOG_CHANNEL_ID: process.env.CALENDAR_LOG_CHANNEL_ID
};

// 필수 환경변수 확인
const requiredEnvVars = ['TOKEN', 'GUILDID', 'LOG_CHANNEL_ID'];
const missingEnvVars = requiredEnvVars.filter(varName => !config[varName]);

if (missingEnvVars.length > 0) {
  throw new Error(`필수 환경변수가 설정되지 않았습니다: ${missingEnvVars.join(', ')}`);
}