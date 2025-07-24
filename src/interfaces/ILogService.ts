// src/interfaces/ILogService.ts - 로그 서비스 인터페이스

import type { Channel, VoiceChannel } from 'discord.js';

import type { LogMessage, LogFilter, LogLevel } from '../services/logService';

/**
 * 로그 서비스 인터페이스 (간소화 버전)
 * 현재 LogService 구현에 맞춘 핵심 메서드들
 */
export interface ILogService {
  // 기본 로깅 메서드 (LogService.logActivity에 맞춤)
  logActivity(
    message: string,
    membersInChannel?: string[],
    eventType?: string,
    metadata?: Record<string, any>
  ): void;

  // 특수 로깅 메서드
  debug(message: string, metadata?: Record<string, any>): void;
  info(message: string, metadata?: Record<string, any>): void;
  warn(message: string, metadata?: Record<string, any>): void;
  error(message: string, error?: Error, metadata?: Record<string, any>): void;
  fatal(message: string, error?: Error, metadata?: Record<string, any>): void;

  // Discord 이벤트 핸들러
  handleChannelUpdate(oldChannel: Channel, newChannel: Channel): Promise<void>;
  handleChannelCreate(channel: Channel): Promise<void>;
  handleChannelDelete(channel: Channel): Promise<void>;

  // 음성 채널 관련
  getVoiceChannelMembers(channel: VoiceChannel): Promise<string[]>;

  // 로그 관리
  getHistory(filter?: LogFilter): LogMessage[];

  // 설정 관리
  setLogLevel(level: LogLevel): void;
  setLogChannel(channelId: string): void;

  // 배치 처리
  flush(): Promise<void>;
  cleanup(): Promise<void>;

  // 캐시 관리
  clearChannelCache(guildId: string): void;
  clearAllChannelCache(): void;
  getCacheStats(): {
    size: number;
    entries: Array<{ guildId: string; channelId: string; age: number }>;
  };
  updateLogChannel(guildId: string, channelId: string): Promise<void>;
}
