// src/services/logService.ts - 로깅 서비스 (TypeScript)
import { ChannelType, VoiceChannel, Channel, GuildMember, TextChannel, ThreadChannel } from 'discord.js';
import { TIME, COLORS, MESSAGE_TYPES } from '../config/constants.js';
import { EmbedFactory, LogEmbedData, LogEmbedOptions } from '../utils/embedBuilder.js';
import { logger } from '../config/logger-termux.js';
import { EnhancedClient } from '../types/discord.js';

// ====================
// 로그 서비스 타입
// ====================

export interface LogMessage {
  message: string;
  members: string[];
  eventType: string;
  timestamp: Date;
  channelId?: string;
  channelName?: string;
  userId?: string;
  metadata?: Record<string, any>;
}

export interface LogServiceOptions {
  logChannelId: string;
  batchSize?: number;
  logDelay?: number;
  maxRetries?: number;
  enableFileLogging?: boolean;
  enableConsoleLogging?: boolean;
  logLevel?: LogLevel;
  includeMetadata?: boolean;
}

export interface LogStats {
  totalMessages: number;
  sentMessages: number;
  failedMessages: number;
  lastSentAt?: Date;
  lastFailedAt?: Date;
  retryCount: number;
}

export interface LogFilter {
  eventTypes?: string[];
  channels?: string[];
  users?: string[];
  keywords?: string[];
  timeRange?: {
    start: Date;
    end: Date;
  };
}

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4
}

export enum LogEventType {
  JOIN = 'JOIN',
  LEAVE = 'LEAVE',
  CHANNEL_CREATE = 'CHANNEL_CREATE',
  CHANNEL_DELETE = 'CHANNEL_DELETE',
  CHANNEL_UPDATE = 'CHANNEL_UPDATE',
  CHANNEL_RENAME = 'CHANNEL_RENAME',
  MESSAGE_CREATE = 'MESSAGE_CREATE',
  MESSAGE_DELETE = 'MESSAGE_DELETE',
  MESSAGE_UPDATE = 'MESSAGE_UPDATE',
  ROLE_UPDATE = 'ROLE_UPDATE',
  USER_UPDATE = 'USER_UPDATE',
  GUILD_UPDATE = 'GUILD_UPDATE',
  INTERACTION = 'INTERACTION',
  ERROR = 'ERROR',
  WARNING = 'WARNING',
  INFO = 'INFO',
  DEBUG = 'DEBUG'
}

// ====================
// 로그 서비스 클래스
// ====================

export class LogService {
  private readonly client: EnhancedClient;
  private readonly options: Required<LogServiceOptions>;
  private readonly logMessages: LogMessage[] = [];
  private readonly stats: LogStats = {
    totalMessages: 0,
    sentMessages: 0,
    failedMessages: 0,
    retryCount: 0
  };
  
  private logTimeout: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private readonly messageHistory: LogMessage[] = [];
  private readonly maxHistorySize = 1000;

  constructor(client: EnhancedClient, options: LogServiceOptions) {
    this.client = client;
    this.options = {
      batchSize: 10,
      logDelay: TIME.LOG_DELAY,
      maxRetries: 3,
      enableFileLogging: true,
      enableConsoleLogging: true,
      logLevel: LogLevel.INFO,
      includeMetadata: true,
      ...options
    };

    // 초기화 검증
    this.validateOptions();
  }

  /**
   * 옵션 검증
   */
  private validateOptions(): void {
    if (!this.options.logChannelId) {
      throw new Error('로그 채널 ID가 필요합니다.');
    }

    if (this.options.batchSize < 1 || this.options.batchSize > 100) {
      throw new Error('배치 크기는 1-100 사이여야 합니다.');
    }

    if (this.options.logDelay < 1000 || this.options.logDelay > 300000) {
      throw new Error('로그 지연 시간은 1초-5분 사이여야 합니다.');
    }
  }

  /**
   * 음성 채널 활동을 로그에 기록합니다.
   * @param message - 로그 메시지
   * @param membersInChannel - 채널에 있는 멤버 목록
   * @param eventType - 이벤트 타입
   * @param metadata - 추가 메타데이터
   */
  logActivity(
    message: string,
    membersInChannel: string[] = [],
    eventType: string = '',
    metadata?: Record<string, any>
  ): void {
    try {
      // 채널 생성 메시지일 경우 멤버 목록을 표시하지 않음
      if (message.includes(MESSAGE_TYPES.CHANNEL_CREATE)) {
        membersInChannel = [];
      }

      const logMessage: LogMessage = {
        message,
        members: [...membersInChannel],
        eventType,
        timestamp: new Date(),
        metadata: this.options.includeMetadata ? { ...metadata } : undefined
      };

      // Errsole에 음성 활동 로그 기록
      if (this.options.enableFileLogging) {
        logger.voiceActivity(message, {
          eventType,
          memberCount: membersInChannel.length,
          members: membersInChannel,
          timestamp: logMessage.timestamp.toISOString(),
          metadata
        });
      }

      // 콘솔 로깅
      if (this.options.enableConsoleLogging) {
        console.log(`[LogService] ${eventType}: ${message}`);
      }

      // 로그 메시지 큐에 추가
      this.logMessages.push(logMessage);
      this.stats.totalMessages++;

      // 히스토리에 추가
      this.addToHistory(logMessage);

      // 배치 처리 스케줄링
      this.scheduleLogSending();

    } catch (error) {
      console.error('[LogService] 로그 기록 오류:', error);
      logger.error('로그 기록 오류', {
        error: error instanceof Error ? error.message : String(error),
        message,
        eventType
      });
    }
  }

  /**
   * 로그 전송 스케줄링
   */
  private scheduleLogSending(): void {
    // 이미 처리 중이면 스케줄링하지 않음
    if (this.isProcessing) return;

    // 이전 타임아웃 취소
    if (this.logTimeout) {
      clearTimeout(this.logTimeout);
    }

    // 배치 크기에 도달했거나 긴급 메시지가 있으면 즉시 전송
    if (this.logMessages.length >= this.options.batchSize || this.hasUrgentMessage()) {
      this.sendLogMessages();
    } else {
      // 일정 시간 후 로그 전송
      this.logTimeout = setTimeout(async () => {
        await this.sendLogMessages();
      }, this.options.logDelay);
    }
  }

  /**
   * 긴급 메시지가 있는지 확인
   */
  private hasUrgentMessage(): boolean {
    return this.logMessages.some(msg => 
      msg.eventType === LogEventType.ERROR || 
      msg.eventType === LogEventType.FATAL ||
      msg.message.includes('오류') ||
      msg.message.includes('실패')
    );
  }

  /**
   * 누적된 로그 메시지를 로그 채널로 전송합니다.
   */
  async sendLogMessages(): Promise<void> {
    if (this.isProcessing || this.logMessages.length === 0) return;

    this.isProcessing = true;
    
    try {
      const logChannel = await this.getLogChannel();
      if (!logChannel) {
        logger.error('로그 채널을 찾을 수 없습니다', {
          logChannelId: this.options.logChannelId,
          messageCount: this.logMessages.length
        });
        return;
      }

      logger.debug(`${this.logMessages.length}개의 로그 메시지를 Discord 채널로 전송`, {
        logChannelId: this.options.logChannelId,
        messageCount: this.logMessages.length
      });

      // 메시지 복사 후 원본 초기화
      const messagesToSend = [...this.logMessages];
      this.logMessages.length = 0;

      // 배치 단위로 전송
      const batches = this.createBatches(messagesToSend, this.options.batchSize);
      
      for (const batch of batches) {
        await this.sendBatch(logChannel, batch);
        
        // 배치 간 간격 (API 제한 방지)
        if (batches.length > 1) {
          await this.sleep(1000);
        }
      }

      this.stats.sentMessages += messagesToSend.length;
      this.stats.lastSentAt = new Date();

      logger.debug(`Discord 채널로 로그 전송 완료`);

    } catch (error) {
      this.stats.failedMessages += this.logMessages.length;
      this.stats.lastFailedAt = new Date();
      
      logger.error('Discord 로그 메시지 전송 오류', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        messageCount: this.logMessages.length
      });

      // 재시도 로직
      await this.handleSendFailure();
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 로그 채널을 가져옵니다.
   */
  private async getLogChannel(): Promise<TextChannel | ThreadChannel | null> {
    try {
      const channel = await this.client.channels.fetch(this.options.logChannelId);
      
      if (!channel) return null;
      
      if (channel.isTextBased() && 
          (channel.type === ChannelType.GuildText || 
           channel.type === ChannelType.PrivateThread ||
           channel.type === ChannelType.PublicThread)) {
        return channel as TextChannel | ThreadChannel;
      }
      
      return null;
    } catch (error) {
      logger.error('로그 채널 가져오기 오류', {
        channelId: this.options.logChannelId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * 배치 단위로 메시지 전송
   */
  private async sendBatch(
    channel: TextChannel | ThreadChannel,
    batch: LogMessage[]
  ): Promise<void> {
    for (const log of batch) {
      try {
        const colorCode = this.getColorForEventType(log.eventType, log.message);
        
        const embedData: LogEmbedData = {
          message: log.message,
          members: log.members,
          colorCode,
          timestamp: log.timestamp,
          channelName: log.channelName,
          action: log.eventType
        };

        const options: LogEmbedOptions = {
          includeMembers: log.members.length > 0,
          maxMembersShown: 20,
          showMemberCount: true,
          maxFieldLength: 1024
        };

        const embed = EmbedFactory.createLogEmbed(embedData, options);
        await channel.send({ embeds: [embed] });

      } catch (error) {
        logger.error('개별 로그 메시지 전송 오류', {
          error: error instanceof Error ? error.message : String(error),
          logMessage: log.message
        });
      }
    }
  }

  /**
   * 이벤트 타입에 따른 색상 결정
   */
  private getColorForEventType(eventType: string, message: string): string {
    if (eventType === LogEventType.JOIN || message.includes(MESSAGE_TYPES.JOIN)) {
      return COLORS.LOG_JOIN;
    } else if (eventType === LogEventType.LEAVE || message.includes(MESSAGE_TYPES.LEAVE)) {
      return COLORS.LOG_LEAVE;
    } else if (eventType === LogEventType.CHANNEL_CREATE || message.includes(MESSAGE_TYPES.CHANNEL_CREATE)) {
      return COLORS.LOG_CREATE;
    } else if (eventType === LogEventType.CHANNEL_RENAME || message.includes(MESSAGE_TYPES.CHANNEL_RENAME)) {
      return COLORS.LOG_RENAME;
    } else if (eventType === LogEventType.ERROR) {
      return COLORS.ERROR;
    } else if (eventType === LogEventType.WARNING) {
      return COLORS.WARNING;
    } else if (eventType === LogEventType.INFO) {
      return COLORS.INFO;
    }
    
    return COLORS.LOG; // 기본 색상
  }

  /**
   * 전송 실패 처리
   */
  private async handleSendFailure(): Promise<void> {
    this.stats.retryCount++;
    
    if (this.stats.retryCount <= this.options.maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, this.stats.retryCount), 30000);
      
      logger.info(`로그 전송 재시도 예정 (${this.stats.retryCount}/${this.options.maxRetries})`, {
        delay,
        messageCount: this.logMessages.length
      });
      
      setTimeout(() => {
        this.sendLogMessages();
      }, delay);
    } else {
      logger.error('로그 전송 최대 재시도 횟수 초과', {
        retryCount: this.stats.retryCount,
        messageCount: this.logMessages.length
      });
      
      // 메시지 버림
      this.logMessages.length = 0;
      this.stats.retryCount = 0;
    }
  }

  /**
   * 배치 생성
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    
    return batches;
  }

  /**
   * 지연 함수
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 히스토리에 메시지 추가
   */
  private addToHistory(message: LogMessage): void {
    this.messageHistory.push(message);
    
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory.shift();
    }
  }

  /**
   * 채널에 있는 멤버 목록을 가져옵니다.
   * @param channel - 음성 채널 객체
   * @returns 멤버 표시 이름 배열
   */
  async getVoiceChannelMembers(channel: VoiceChannel): Promise<string[]> {
    if (!channel) return [];

    try {
      const freshChannel = await channel.guild.channels.fetch(channel.id) as VoiceChannel;
      if (!freshChannel || !freshChannel.members) return [];
      
      return freshChannel.members.map((member: GuildMember) => member.displayName);
    } catch (error) {
      logger.error('채널 멤버 정보 가져오기 오류', {
        channelId: channel?.id,
        channelName: channel?.name,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * 채널 업데이트 이벤트 핸들러
   * @param oldChannel - 이전 채널 상태
   * @param newChannel - 새 채널 상태
   */
  async handleChannelUpdate(oldChannel: Channel, newChannel: Channel): Promise<void> {
    if (newChannel.type === ChannelType.GuildVoice) {
      const oldVoiceChannel = oldChannel as VoiceChannel;
      const newVoiceChannel = newChannel as VoiceChannel;
      
      if (oldVoiceChannel.name !== newVoiceChannel.name) {
        logger.discordEvent('음성 채널 이름 변경 감지', {
          oldName: oldVoiceChannel.name,
          newName: newVoiceChannel.name,
          channelId: newVoiceChannel.id,
          guildId: newVoiceChannel.guild.id
        });

        const membersInChannel = await this.getVoiceChannelMembers(newVoiceChannel);
        
        this.logActivity(
          `${MESSAGE_TYPES.CHANNEL_RENAME}: \` ${oldVoiceChannel.name} \` → \` ${newVoiceChannel.name} \``,
          membersInChannel,
          LogEventType.CHANNEL_RENAME,
          {
            oldName: oldVoiceChannel.name,
            newName: newVoiceChannel.name,
            channelId: newVoiceChannel.id,
            guildId: newVoiceChannel.guild.id
          }
        );
      }
    }
  }

  /**
   * 채널 생성 이벤트 핸들러
   * @param channel - 생성된 채널
   */
  async handleChannelCreate(channel: Channel): Promise<void> {
    if (channel.type === ChannelType.GuildVoice) {
      const voiceChannel = channel as VoiceChannel;
      
      logger.discordEvent('음성 채널 생성 감지', {
        channelName: voiceChannel.name,
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        parentId: voiceChannel.parentId
      });

      this.logActivity(
        `${MESSAGE_TYPES.CHANNEL_CREATE}: \` ${voiceChannel.name} \``,
        [],
        LogEventType.CHANNEL_CREATE,
        {
          channelName: voiceChannel.name,
          channelId: voiceChannel.id,
          guildId: voiceChannel.guild.id,
          parentId: voiceChannel.parentId
        }
      );
    }
  }

  /**
   * 채널 삭제 이벤트 핸들러
   * @param channel - 삭제된 채널
   */
  async handleChannelDelete(channel: Channel): Promise<void> {
    if (channel.type === ChannelType.GuildVoice) {
      const voiceChannel = channel as VoiceChannel;
      
      logger.discordEvent('음성 채널 삭제 감지', {
        channelName: voiceChannel.name,
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id
      });

      this.logActivity(
        `${MESSAGE_TYPES.CHANNEL_DELETE || '음성 채널 삭제'}: \` ${voiceChannel.name} \``,
        [],
        LogEventType.CHANNEL_DELETE,
        {
          channelName: voiceChannel.name,
          channelId: voiceChannel.id,
          guildId: voiceChannel.guild.id
        }
      );
    }
  }

  /**
   * 사용자 정의 로그 메시지 기록
   * @param level - 로그 레벨
   * @param message - 메시지
   * @param eventType - 이벤트 타입
   * @param metadata - 메타데이터
   */
  log(
    level: LogLevel,
    message: string,
    eventType: string = LogEventType.INFO,
    metadata?: Record<string, any>
  ): void {
    if (level < this.options.logLevel) return;

    const levelName = LogLevel[level];
    const logMessage = `[${levelName}] ${message}`;

    this.logActivity(logMessage, [], eventType, metadata);
  }

  /**
   * 디버그 로그
   */
  debug(message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, LogEventType.DEBUG, metadata);
  }

  /**
   * 정보 로그
   */
  info(message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, LogEventType.INFO, metadata);
  }

  /**
   * 경고 로그
   */
  warn(message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, LogEventType.WARNING, metadata);
  }

  /**
   * 오류 로그
   */
  error(message: string, error?: Error, metadata?: Record<string, any>): void {
    const errorData = error ? {
      message: error.message,
      stack: error.stack,
      name: error.name,
      ...metadata
    } : metadata;

    this.log(LogLevel.ERROR, message, LogEventType.ERROR, errorData);
  }

  /**
   * 치명적 오류 로그
   */
  fatal(message: string, error?: Error, metadata?: Record<string, any>): void {
    const errorData = error ? {
      message: error.message,
      stack: error.stack,
      name: error.name,
      ...metadata
    } : metadata;

    this.log(LogLevel.FATAL, message, LogEventType.FATAL, errorData);
  }

  /**
   * 통계 정보 가져오기
   */
  getStats(): LogStats {
    return { ...this.stats };
  }

  /**
   * 히스토리 조회
   */
  getHistory(filter?: LogFilter): LogMessage[] {
    let messages = [...this.messageHistory];

    if (filter) {
      messages = messages.filter(msg => {
        // 이벤트 타입 필터
        if (filter.eventTypes && !filter.eventTypes.includes(msg.eventType)) {
          return false;
        }

        // 채널 필터
        if (filter.channels && msg.channelId && !filter.channels.includes(msg.channelId)) {
          return false;
        }

        // 사용자 필터
        if (filter.users && msg.userId && !filter.users.includes(msg.userId)) {
          return false;
        }

        // 키워드 필터
        if (filter.keywords && !filter.keywords.some(keyword => 
          msg.message.toLowerCase().includes(keyword.toLowerCase())
        )) {
          return false;
        }

        // 시간 범위 필터
        if (filter.timeRange) {
          const msgTime = msg.timestamp.getTime();
          const startTime = filter.timeRange.start.getTime();
          const endTime = filter.timeRange.end.getTime();
          
          if (msgTime < startTime || msgTime > endTime) {
            return false;
          }
        }

        return true;
      });
    }

    return messages;
  }

  /**
   * 로그 레벨 변경
   */
  setLogLevel(level: LogLevel): void {
    this.options.logLevel = level;
    logger.info(`로그 레벨 변경: ${LogLevel[level]}`);
  }

  /**
   * 로그 채널 변경
   */
  setLogChannel(channelId: string): void {
    this.options.logChannelId = channelId;
    logger.info(`로그 채널 변경: ${channelId}`);
  }

  /**
   * 즉시 로그 전송
   */
  async flush(): Promise<void> {
    if (this.logTimeout) {
      clearTimeout(this.logTimeout);
      this.logTimeout = null;
    }
    
    await this.sendLogMessages();
  }

  /**
   * 정리 작업
   */
  async cleanup(): Promise<void> {
    if (this.logTimeout) {
      clearTimeout(this.logTimeout);
      this.logTimeout = null;
    }

    // 남은 메시지 전송
    if (this.logMessages.length > 0) {
      await this.sendLogMessages();
    }

    logger.info('[LogService] 정리 작업 완료');
  }
}

// ====================
// 유틸리티 함수
// ====================

/**
 * 로그 레벨을 문자열로 변환
 */
export function logLevelToString(level: LogLevel): string {
  return LogLevel[level];
}

/**
 * 문자열을 로그 레벨로 변환
 */
export function stringToLogLevel(level: string): LogLevel {
  const upperLevel = level.toUpperCase();
  return LogLevel[upperLevel as keyof typeof LogLevel] ?? LogLevel.INFO;
}

/**
 * 로그 메시지 포맷터
 */
export function formatLogMessage(
  level: LogLevel,
  message: string,
  metadata?: Record<string, any>
): string {
  const timestamp = new Date().toISOString();
  const levelName = LogLevel[level].padEnd(5);
  const metadataStr = metadata ? ` | ${JSON.stringify(metadata)}` : '';
  
  return `[${timestamp}] [${levelName}] ${message}${metadataStr}`;
}

/**
 * 로그 메시지 검증
 */
export function validateLogMessage(message: LogMessage): boolean {
  if (!message.message || typeof message.message !== 'string') {
    return false;
  }

  if (!message.eventType || typeof message.eventType !== 'string') {
    return false;
  }

  if (!message.timestamp || !(message.timestamp instanceof Date)) {
    return false;
  }

  if (!Array.isArray(message.members)) {
    return false;
  }

  return true;
}