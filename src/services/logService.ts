// src/services/logService.ts - 로깅 서비스 (TypeScript)
import {
  ChannelType,
  VoiceChannel,
  Channel,
  GuildMember,
  TextChannel,
  ThreadChannel,
} from 'discord.js';
import { injectable, inject } from 'tsyringe';

import { TIME, COLORS, MESSAGE_TYPES } from '../config/constants';
import { logger } from '../config/logger-termux';
import type { ILogService } from '../interfaces/ILogService';
import { DI_TOKENS } from '../interfaces/index';
import { EnhancedClient } from '../types/discord';
import { EmbedFactory, LogEmbedData, LogEmbedOptions } from '../utils/embedBuilder';

import { GuildSettingsManager } from './GuildSettingsManager';

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
  guildId?: string;
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
  FATAL = 4,
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
  FATAL = 'FATAL',
  WARNING = 'WARNING',
  INFO = 'INFO',
  DEBUG = 'DEBUG',
}

// ====================
// 로그 서비스 클래스
// ====================

@injectable()
export class LogService implements ILogService {
  private readonly client: EnhancedClient;
  private readonly options: Required<LogServiceOptions>;
  private readonly guildSettingsManager: GuildSettingsManager;
  private readonly logMessages: LogMessage[] = [];
  private readonly stats: LogStats = {
    totalMessages: 0,
    sentMessages: 0,
    failedMessages: 0,
    retryCount: 0,
  };

  private logTimeout: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private readonly messageHistory: LogMessage[] = [];
  private readonly maxHistorySize = 1000;

  // 로그 채널 ID 캐시 (길드 ID -> 채널 ID)
  private readonly channelIdCache = new Map<string, { channelId: string; timestamp: number }>();
  private readonly channelIdCacheTTL = 300000; // 5분 TTL

  constructor(
    @inject(DI_TOKENS.DiscordClient) client: EnhancedClient,
    @inject(DI_TOKENS.LogServiceConfig) options: LogServiceOptions,
    @inject(DI_TOKENS.IGuildSettingsManager) guildSettingsManager: GuildSettingsManager
  ) {
    this.client = client;
    this.guildSettingsManager = guildSettingsManager;
    this.options = {
      batchSize: 10,
      logDelay: TIME.LOG_DELAY,
      maxRetries: 3,
      enableFileLogging: true,
      enableConsoleLogging: true,
      logLevel: LogLevel.INFO,
      includeMetadata: true,
      ...options,
    };

    // 초기화 검증
    this.validateOptions();
  }

  /**
   * 길드별 로그 채널 ID를 가져옵니다 (캐시 사용)
   * @param guildId - 길드 ID
   * @returns 로그 채널 ID (없으면 기본값 사용)
   */
  private async getGuildLogChannelId(guildId?: string): Promise<string> {
    if (!guildId) {
      return this.options.logChannelId;
    }

    // 캐시 확인
    const cached = this.channelIdCache.get(guildId);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.channelIdCacheTTL) {
      logger.debug('[LogService] 캐시에서 로그 채널 ID 조회', {
        guildId,
        channelId: cached.channelId,
        cacheAge: now - cached.timestamp,
      });
      return cached.channelId;
    }

    try {
      logger.debug('[LogService] 데이터베이스에서 로그 채널 ID 조회', { guildId });
      const channelManagement = await this.guildSettingsManager.getChannelManagement(guildId);
      const channelId = channelManagement?.logChannelId || this.options.logChannelId;

      // 채널 ID가 길드 ID와 같은지 확인 (잘못된 설정 방지)
      if (channelId === guildId) {
        logger.warn('[LogService] 로그 채널 ID가 길드 ID와 같음 - 설정 확인 필요:', {
          guildId,
          channelId,
          message: '로그 채널이 올바르게 설정되지 않았습니다.',
        });
        // 빈 문자열을 캐시에 저장하여 반복 조회 방지
        this.channelIdCache.set(guildId, { channelId: '', timestamp: now });
        return '';
      }

      // 채널 ID 형식 검증 (Discord 채널 ID는 17-20자리 숫자)
      if (channelId && !/^\d{17,20}$/.test(channelId)) {
        logger.warn('[LogService] 로그 채널 ID 형식이 올바르지 않음:', {
          guildId,
          channelId,
          message: '채널 ID는 17-20자리 숫자여야 합니다.',
        });
        // 빈 문자열을 캐시에 저장하여 반복 조회 방지
        this.channelIdCache.set(guildId, { channelId: '', timestamp: now });
        return '';
      }

      // 유효한 채널 ID를 캐시에 저장
      this.channelIdCache.set(guildId, { channelId, timestamp: now });
      logger.debug('[LogService] 로그 채널 ID 캐시 업데이트', {
        guildId,
        channelId,
        cacheSize: this.channelIdCache.size,
      });

      return channelId;
    } catch (error) {
      logger.error('[LogService] 길드 설정 조회 실패:', {
        guildId,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.options.logChannelId;
    }
  }

  /**
   * 옵션 검증
   */
  private validateOptions(): void {
    if (!this.options.logChannelId) {
      throw new Error('로그 채널 ID가 필요합니다.');
    }

    // 채널 ID 형식 검증 (Discord 채널 ID는 17-20자리 숫자)
    if (!/^\d{17,20}$/.test(this.options.logChannelId)) {
      logger.warn('[LogService] 로그 채널 ID 형식이 올바르지 않음:', {
        channelId: this.options.logChannelId,
        message: '채널 ID는 17-20자리 숫자여야 합니다.',
      });
    }

    // 환경변수에서 길드 ID 가져와서 비교
    const guildId = process.env.GUILDID;
    if (guildId && this.options.logChannelId === guildId) {
      logger.error('[LogService] 로그 채널 ID가 길드 ID와 동일함 - 설정 오류:', {
        channelId: this.options.logChannelId,
        guildId,
        message: 'LOG_CHANNEL_ID에 길드 ID 대신 채널 ID를 설정해야 합니다.',
        solution: '길드 설정에서 올바른 로그 채널을 설정하거나 환경변수를 수정해주세요.',
      });

      // 치명적 오류 대신 경고로 변경 - 봇 시작을 차단하지 않음
      logger.warn(
        '[LogService] 환경변수 LOG_CHANNEL_ID 설정 오류로 인해 로그 전송이 비활성화됩니다.'
      );
      logger.warn(
        '[LogService] 봇은 정상적으로 시작되지만, 로그 전송을 위해 /설정 명령어를 사용하여 올바른 로그 채널을 설정해주세요.'
      );

      // 잘못된 채널 ID를 빈 문자열로 설정하여 로그 전송 차단
      this.options.logChannelId = '';
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
      // 디버깅: 로그 메시지 생성 과정 추적
      logger.debug('[LogService] 로그 메시지 생성 시작', {
        message: message.slice(0, 50) + '...',
        eventType,
        memberCount: membersInChannel.length,
        hasGuildId: Boolean(metadata?.guildId),
        guildId: metadata?.guildId || 'none',
        metadataKeys: metadata ? Object.keys(metadata) : [],
      });

      // 채널 생성 메시지일 경우 멤버 목록을 표시하지 않음
      if (message.includes(MESSAGE_TYPES.CHANNEL_CREATE)) {
        membersInChannel = [];
        logger.debug('[LogService] 채널 생성 메시지 - 멤버 목록 제거');
      }

      const logMessage: LogMessage = {
        message,
        members: [...membersInChannel],
        eventType,
        timestamp: new Date(),
        guildId: metadata?.guildId,
        ...(this.options.includeMetadata && metadata && { metadata: { ...metadata } }),
      };

      // 디버깅: 생성된 로그 메시지 정보
      logger.debug('[LogService] 로그 메시지 생성 완료', {
        messageId: `${eventType}_${logMessage.timestamp.getTime()}`,
        guildId: logMessage.guildId || 'default',
        hasMembers: logMessage.members.length > 0,
        queueSize: this.logMessages.length,
        totalMessages: this.stats.totalMessages + 1,
      });

      // Errsole에 음성 활동 로그 기록
      if (this.options.enableFileLogging) {
        logger.voiceActivity(message, {
          eventType,
          memberCount: membersInChannel.length,
          members: membersInChannel,
          timestamp: logMessage.timestamp.toISOString(),
          metadata,
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

      // 디버깅: 큐 상태 및 스케줄링 정보
      logger.debug('[LogService] 로그 메시지 큐 상태', {
        queueSize: this.logMessages.length,
        batchSize: this.options.batchSize,
        willSendImmediately:
          this.logMessages.length >= this.options.batchSize || this.hasUrgentMessage(),
        isProcessing: this.isProcessing,
        logDelay: this.options.logDelay,
      });

      // 배치 처리 스케줄링
      this.scheduleLogSending();
    } catch (error) {
      console.error('[LogService] 로그 기록 오류:', error);
      logger.error('로그 기록 오류', {
        error: error instanceof Error ? error.message : String(error),
        message,
        eventType,
        metadata,
        guildId: metadata?.guildId || 'none',
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
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
    return this.logMessages.some(
      (msg) =>
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
      // 메시지 복사 후 원본 초기화
      const messagesToSend = [...this.logMessages];
      this.logMessages.length = 0;

      // 중복 로그 제거 (같은 메시지, 타임스탬프, 이벤트 타입)
      const deduplicatedMessages = this.deduplicateLogMessages(messagesToSend);

      // 길드별로 메시지 그룹화
      const messagesByGuild = new Map<string, LogMessage[]>();

      for (const message of deduplicatedMessages) {
        const guildId = message.guildId || 'default';
        if (!messagesByGuild.has(guildId)) {
          messagesByGuild.set(guildId, []);
        }
        messagesByGuild.get(guildId)!.push(message);
      }

      logger.debug(
        `${messagesToSend.length}개의 로그 메시지를 ${messagesByGuild.size}개 길드로 전송`,
        {
          messageCount: messagesToSend.length,
          guildCount: messagesByGuild.size,
        }
      );

      // 각 길드별로 로그 전송
      for (const [guildId, messages] of messagesByGuild) {
        await this.sendGuildLogMessages(guildId === 'default' ? undefined : guildId, messages);
      }

      this.stats.sentMessages += messagesToSend.length;
      this.stats.lastSentAt = new Date();

      logger.debug(`Discord 채널로 로그 전송 완료`);
    } catch (error) {
      this.stats.failedMessages += this.logMessages.length;
      this.stats.lastFailedAt = new Date();

      logger.error('Discord 로그 메시지 전송 오류', {
        error: error instanceof Error ? error.message : String(error),
        messageCount: this.logMessages.length,
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      });

      // 재시도 로직
      await this.handleSendFailure();
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 중복 로그 메시지 제거
   * @param messages - 원본 메시지 배열
   * @returns 중복 제거된 메시지 배열
   */
  private deduplicateLogMessages(messages: LogMessage[]): LogMessage[] {
    if (messages.length === 0) return messages;

    // 메시지 해시 맵 생성 (키: 메시지 식별자, 값: 메시지 배열)
    const messageGroups = new Map<string, LogMessage[]>();

    for (const message of messages) {
      // 메시지 식별자 생성 (메시지 내용, 이벤트 타입, 타임스탬프, 멤버 목록)
      const messageKey = this.generateMessageKey(message);

      if (!messageGroups.has(messageKey)) {
        messageGroups.set(messageKey, []);
      }
      messageGroups.get(messageKey)!.push(message);
    }

    const deduplicatedMessages: LogMessage[] = [];

    // 각 그룹에서 최적의 메시지 선택
    for (const [messageKey, duplicateMessages] of messageGroups) {
      if (duplicateMessages.length === 1) {
        // 중복이 없는 경우 그대로 사용
        deduplicatedMessages.push(duplicateMessages[0]);
      } else {
        // 중복이 있는 경우 길드 ID가 있는 메시지를 우선 선택
        const bestMessage = this.selectBestMessage(duplicateMessages);
        deduplicatedMessages.push(bestMessage);

        logger.debug(`중복 로그 메시지 제거: ${duplicateMessages.length}개 → 1개`, {
          messageKey,
          originalCount: duplicateMessages.length,
          selectedMessage: {
            guildId: bestMessage.guildId || 'default',
            eventType: bestMessage.eventType,
            message: bestMessage.message.slice(0, 50) + '...',
          },
        });
      }
    }

    logger.debug(
      `로그 메시지 중복 제거 완료: ${messages.length}개 → ${deduplicatedMessages.length}개`,
      {
        originalCount: messages.length,
        deduplicatedCount: deduplicatedMessages.length,
        removedCount: messages.length - deduplicatedMessages.length,
      }
    );

    return deduplicatedMessages;
  }

  /**
   * 메시지 식별자 생성 (중복 검사용)
   * @param message - 로그 메시지
   * @returns 메시지 식별자
   */
  private generateMessageKey(message: LogMessage): string {
    // 타임스탬프를 초 단위로 반올림 (밀리초 차이 무시)
    const timestampSeconds = Math.floor(message.timestamp.getTime() / 1000);

    // 멤버 목록 정렬 후 문자열로 변환
    const sortedMembers = [...message.members].sort().join(',');

    return `${message.message}|${message.eventType}|${timestampSeconds}|${sortedMembers}`;
  }

  /**
   * 중복 메시지 중 최적의 메시지 선택
   * @param messages - 중복 메시지 배열
   * @returns 선택된 메시지
   */
  private selectBestMessage(messages: LogMessage[]): LogMessage {
    // 1. 길드 ID가 있는 메시지 우선
    const messagesWithGuildId = messages.filter((msg) => msg.guildId);
    if (messagesWithGuildId.length > 0) {
      return messagesWithGuildId[0];
    }

    // 2. 길드 ID가 없다면 가장 최근 메시지 선택
    return messages.reduce((latest, current) =>
      current.timestamp > latest.timestamp ? current : latest
    );
  }

  /**
   * 길드별 로그 메시지 전송
   * @param guildId - 길드 ID (없으면 기본 채널 사용)
   * @param messages - 전송할 메시지 배열
   */
  private async sendGuildLogMessages(
    guildId: string | undefined,
    messages: LogMessage[]
  ): Promise<void> {
    try {
      // default 길드 처리 시 로그 채널 ID 검증
      if (!guildId) {
        const logChannelId = this.options.logChannelId;

        // 환경변수에서 길드 ID 가져와서 비교
        const envGuildId = process.env.GUILDID;
        if (envGuildId && logChannelId === envGuildId) {
          logger.error(
            `[LogService] default 길드 로그 전송 실패 - 로그 채널 ID가 길드 ID와 동일함`,
            {
              guildId: 'default',
              channelId: logChannelId,
              envGuildId,
              messageCount: messages.length,
              reason: 'LOG_CHANNEL_ID에 길드 ID가 설정되어 있습니다.',
            }
          );
          return;
        }
      }

      const logChannel = await this.getLogChannel(guildId);
      if (!logChannel) {
        logger.warn(`로그 채널을 찾을 수 없습니다. Guild: ${guildId || 'default'}`, {
          guildId: guildId || 'default',
          messageCount: messages.length,
          reason: '로그 채널이 설정되지 않았거나 접근할 수 없습니다.',
        });
        return;
      }

      logger.debug(`로그 채널 확인됨: ${logChannel.name} (${logChannel.id})`, {
        guildId: guildId || 'default',
        channelId: logChannel.id,
        channelName: logChannel.name,
        messageCount: messages.length,
      });

      // 배치 단위로 전송
      const batches = this.createBatches(messages, this.options.batchSize);

      for (const batch of batches) {
        await this.sendBatch(logChannel, batch);

        // 배치 간 간격 (API 제한 방지)
        if (batches.length > 1) {
          await this.sleep(1000);
        }
      }

      logger.debug(`길드 ${guildId || 'default'}에 ${messages.length}개 메시지 전송 완료`, {
        guildId: guildId || 'default',
        channelId: logChannel.id,
        channelName: logChannel.name,
        messageCount: messages.length,
        batchCount: batches.length,
      });
    } catch (error) {
      logger.error(`길드별 로그 전송 실패. Guild: ${guildId || 'default'}`, {
        error: error instanceof Error ? error.message : String(error),
        messageCount: messages.length,
        guildId: guildId || 'default',
      });
      throw error;
    }
  }

  /**
   * 로그 채널을 가져옵니다.
   * @param guildId - 길드 ID (선택사항)
   */
  private async getLogChannel(guildId?: string): Promise<TextChannel | ThreadChannel | null> {
    try {
      const logChannelId = await this.getGuildLogChannelId(guildId);

      if (!logChannelId) {
        logger.warn('[LogService] 로그 채널 ID가 설정되지 않음', {
          guildId: guildId || 'default',
          message: '로그 채널이 설정되지 않았습니다.',
        });
        return null;
      }

      const channel = await this.client.channels.fetch(logChannelId);

      if (!channel) {
        logger.warn('[LogService] 로그 채널을 찾을 수 없음', {
          guildId: guildId || 'default',
          channelId: logChannelId,
        });
        return null;
      }

      if (
        channel.isTextBased() &&
        (channel.type === ChannelType.GuildText ||
          channel.type === ChannelType.PrivateThread ||
          channel.type === ChannelType.PublicThread)
      ) {
        return channel as TextChannel | ThreadChannel;
      }

      logger.warn('[LogService] 로그 채널이 텍스트 기반 채널이 아님', {
        guildId: guildId || 'default',
        channelId: logChannelId,
        channelType: channel.type,
      });
      return null;
    } catch (error) {
      const logChannelId = await this.getGuildLogChannelId(guildId);
      const errorLog: Record<string, any> = {
        channelId: logChannelId,
        error: error instanceof Error ? error.message : String(error),
      };

      if (guildId) {
        errorLog.guildId = guildId;
      }

      logger.error('로그 채널 가져오기 오류', errorLog);
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
          ...(log.channelName && { channelName: log.channelName }),
          action: log.eventType,
        };

        const options: LogEmbedOptions = {
          includeMembers: log.members.length > 0,
          maxMembersShown: 20,
          showMemberCount: true,
          maxFieldLength: 1024,
        };

        const embed = EmbedFactory.createLogEmbed(embedData, options);
        await channel.send({ embeds: [embed] });
      } catch (error) {
        logger.error('개별 로그 메시지 전송 오류', {
          error: error instanceof Error ? error.message : String(error),
          logMessage: log.message,
        });
      }
    }
  }

  /**
   * 이벤트 타입에 따른 색상 결정
   */
  private getColorForEventType(eventType: string, message: string): number {
    if (eventType === LogEventType.JOIN || message.includes(MESSAGE_TYPES.JOIN)) {
      return COLORS.LOG_JOIN;
    } else if (eventType === LogEventType.LEAVE || message.includes(MESSAGE_TYPES.LEAVE)) {
      return COLORS.LOG_LEAVE;
    } else if (
      eventType === LogEventType.CHANNEL_CREATE ||
      message.includes(MESSAGE_TYPES.CHANNEL_CREATE)
    ) {
      return COLORS.LOG_CREATE;
    } else if (
      eventType === LogEventType.CHANNEL_RENAME ||
      message.includes(MESSAGE_TYPES.CHANNEL_RENAME)
    ) {
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
        messageCount: this.logMessages.length,
      });

      setTimeout(() => {
        this.sendLogMessages();
      }, delay);
    } else {
      logger.error('로그 전송 최대 재시도 횟수 초과', {
        retryCount: this.stats.retryCount,
        messageCount: this.logMessages.length,
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
    return new Promise((resolve) => setTimeout(resolve, ms));
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
      const freshChannel = (await channel.guild.channels.fetch(channel.id)) as VoiceChannel;
      if (!freshChannel?.members) return [];

      return freshChannel.members.map((member: GuildMember) => member.displayName);
    } catch (error) {
      logger.error('채널 멤버 정보 가져오기 오류', {
        channelId: channel?.id,
        channelName: channel?.name,
        error: error instanceof Error ? error.message : String(error),
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
      const newVoiceChannel = newChannel;

      if (oldVoiceChannel.name !== newVoiceChannel.name) {
        logger.discordEvent('음성 채널 이름 변경 감지', {
          oldName: oldVoiceChannel.name,
          newName: newVoiceChannel.name,
          channelId: newVoiceChannel.id,
          guildId: newVoiceChannel.guild.id,
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
            guildId: newVoiceChannel.guild.id,
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
      const voiceChannel = channel;

      logger.discordEvent('음성 채널 생성 감지', {
        channelName: voiceChannel.name,
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        parentId: voiceChannel.parentId,
      });

      this.logActivity(
        `${MESSAGE_TYPES.CHANNEL_CREATE}: \` ${voiceChannel.name} \``,
        [],
        LogEventType.CHANNEL_CREATE,
        {
          channelName: voiceChannel.name,
          channelId: voiceChannel.id,
          guildId: voiceChannel.guild.id,
          parentId: voiceChannel.parentId,
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
      const voiceChannel = channel;

      logger.discordEvent('음성 채널 삭제 감지', {
        channelName: voiceChannel.name,
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
      });

      this.logActivity(
        `${MESSAGE_TYPES.CHANNEL_DELETE || '음성 채널 삭제'}: \` ${voiceChannel.name} \``,
        [],
        LogEventType.CHANNEL_DELETE,
        {
          channelName: voiceChannel.name,
          channelId: voiceChannel.id,
          guildId: voiceChannel.guild.id,
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
    const errorData = error
      ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
          ...metadata,
        }
      : metadata;

    this.log(LogLevel.ERROR, message, LogEventType.ERROR, errorData);
  }

  /**
   * 치명적 오류 로그
   */
  fatal(message: string, error?: Error, metadata?: Record<string, any>): void {
    const errorData = error
      ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
          ...metadata,
        }
      : metadata;

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
      messages = messages.filter((msg) => {
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
        if (
          filter.keywords &&
          !filter.keywords.some((keyword) =>
            msg.message.toLowerCase().includes(keyword.toLowerCase())
          )
        ) {
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

    // 캐시 정리
    this.channelIdCache.clear();

    logger.info('[LogService] 정리 작업 완료');
  }

  /**
   * 특정 길드의 로그 채널 ID 캐시를 무효화합니다
   * @param guildId - 길드 ID
   */
  clearChannelCache(guildId: string): void {
    if (this.channelIdCache.has(guildId)) {
      this.channelIdCache.delete(guildId);
      logger.debug('[LogService] 길드 로그 채널 캐시 무효화', { guildId });
    }
  }

  /**
   * 모든 로그 채널 ID 캐시를 무효화합니다
   */
  clearAllChannelCache(): void {
    const cacheSize = this.channelIdCache.size;
    this.channelIdCache.clear();
    logger.debug('[LogService] 모든 로그 채널 캐시 무효화', { clearedCount: cacheSize });
  }

  /**
   * 캐시 상태 정보를 가져옵니다
   */
  getCacheStats(): {
    size: number;
    entries: Array<{ guildId: string; channelId: string; age: number }>;
  } {
    const now = Date.now();
    const entries = Array.from(this.channelIdCache.entries()).map(([guildId, data]) => ({
      guildId,
      channelId: data.channelId,
      age: now - data.timestamp,
    }));

    return {
      size: this.channelIdCache.size,
      entries,
    };
  }

  /**
   * 길드의 로그 채널을 업데이트하고 캐시를 갱신합니다
   * @param guildId - 길드 ID
   * @param channelId - 새로운 채널 ID
   */
  async updateLogChannel(guildId: string, channelId: string): Promise<void> {
    try {
      // 캐시 무효화
      this.clearChannelCache(guildId);

      // 새 채널 ID 유효성 검증
      if (channelId && !/^\d{17,20}$/.test(channelId)) {
        throw new Error('채널 ID 형식이 올바르지 않습니다. 17-20자리 숫자여야 합니다.');
      }

      if (channelId === guildId) {
        throw new Error('로그 채널 ID가 길드 ID와 같을 수 없습니다.');
      }

      // 채널 접근 권한 확인
      if (channelId) {
        const channel = await this.client.channels.fetch(channelId);
        if (!channel) {
          throw new Error('지정된 채널을 찾을 수 없습니다.');
        }

        if (!channel.isTextBased()) {
          throw new Error('로그 채널은 텍스트 기반 채널이어야 합니다.');
        }
      }

      // 캐시에 새 값 저장
      this.channelIdCache.set(guildId, { channelId, timestamp: Date.now() });

      logger.info('[LogService] 길드 로그 채널 업데이트 완료', {
        guildId,
        channelId,
        message: '로그 채널이 성공적으로 업데이트되었습니다.',
      });
    } catch (error) {
      logger.error('[LogService] 길드 로그 채널 업데이트 실패', {
        guildId,
        channelId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
