// src/services/eventManager.ts - 이벤트 관리 서비스 (TypeScript)
import { EventEmitter } from 'events';

import { Client } from 'discord.js';
import { injectable, inject } from 'tsyringe';

import { DI_TOKENS } from '../interfaces/index';
// EnhancedClient 제거됨 - 표준 Client 사용

// ====================
// 이벤트 관련 타입
// ====================

export type EventHandler<T extends any[] = any[]> = (...args: T) => void | Promise<void>;

export type EventHandlerWithError<T extends any[] = any[]> = (...args: T) => Promise<void>;

export interface EventListenerOptions {
  once?: boolean;
  priority?: number;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export interface EventStats {
  eventName: string;
  handlerCount: number;
  totalCalls: number;
  successCount: number;
  errorCount: number;
  lastCalled?: Date;
  lastError?: Date;
  averageExecutionTime?: number;
}

export interface EventManagerOptions {
  enableStats?: boolean;
  enableLogging?: boolean;
  enableRetry?: boolean;
  defaultTimeout?: number;
  defaultMaxRetries?: number;
  defaultRetryDelay?: number;
}

// ====================
// 이벤트 핸들러 정보
// ====================

interface EventHandlerInfo<T extends any[] = any[]> {
  handler: EventHandler<T>;
  options: EventListenerOptions;
  id: string;
  stats: {
    calls: number;
    successes: number;
    errors: number;
    lastCalled?: Date;
    lastError?: Date;
    totalExecutionTime: number;
  };
}

// ====================
// 이벤트 관리자 클래스
// ====================

@injectable()
export class EventManager extends EventEmitter {
  private readonly client: Client;
  private readonly handlers: Map<string, EventHandlerInfo[]> = new Map();
  private readonly options: EventManagerOptions;
  private readonly eventStats: Map<string, EventStats> = new Map();
  private nextId: number = 1;

  constructor(@inject(DI_TOKENS.DiscordClient) client: Client, options: EventManagerOptions = {}) {
    super();
    this.client = client;
    this.options = {
      enableStats: true,
      enableLogging: true,
      enableRetry: false,
      defaultTimeout: 30000, // 30초
      defaultMaxRetries: 3,
      defaultRetryDelay: 1000, // 1초
      ...options,
    };

    this.setMaxListeners(0); // 무제한 리스너 허용
  }

  /**
   * 이벤트 핸들러를 등록합니다.
   * @param event - 이벤트 이름
   * @param handler - 이벤트 핸들러 함수
   * @param options - 이벤트 리스너 옵션
   * @returns 핸들러 ID
   */
  registerHandler<T extends any[] = any[]>(
    event: string,
    handler: EventHandler<T>,
    options: EventListenerOptions = {}
  ): string {
    if (!event || typeof event !== 'string') {
      throw new Error('이벤트 이름은 문자열이어야 합니다.');
    }

    if (typeof handler !== 'function') {
      throw new Error('핸들러는 함수여야 합니다.');
    }

    const handlerId = `${event}_${this.nextId++}`;

    const handlerInfo: EventHandlerInfo<T> = {
      handler,
      options: {
        priority: options?.priority ?? 0,
        ...(options?.timeout !== undefined && { timeout: options.timeout }),
        ...(options?.maxRetries !== undefined && { maxRetries: options.maxRetries }),
        ...(options?.retryDelay !== undefined && { retryDelay: options.retryDelay }),
        ...(options?.once !== undefined && { once: options.once }),
      },
      id: handlerId,
      stats: {
        calls: 0,
        successes: 0,
        errors: 0,
        totalExecutionTime: 0,
      },
    };

    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }

    const eventHandlers = this.handlers.get(event)!;
    eventHandlers.push(handlerInfo);

    // 우선순위로 정렬 (높은 우선순위가 먼저)
    eventHandlers.sort((a, b) => (b.options.priority || 0) - (a.options.priority || 0));

    if (this.options.enableLogging) {
      console.log(`[EventManager] 이벤트 핸들러 등록: ${event} (ID: ${handlerId})`);
    }

    return handlerId;
  }

  /**
   * 한 번만 실행되는 이벤트 핸들러를 등록합니다.
   * @param event - 이벤트 이름
   * @param handler - 이벤트 핸들러 함수
   * @param options - 이벤트 리스너 옵션
   * @returns 핸들러 ID
   */
  registerOnce<T extends any[] = any[]>(
    event: string,
    handler: EventHandler<T>,
    options: EventListenerOptions = {}
  ): string {
    return this.registerHandler(event, handler, { ...options, once: true });
  }

  /**
   * 특정 핸들러를 제거합니다.
   * @param event - 이벤트 이름
   * @param handlerId - 제거할 핸들러 ID
   * @returns 제거 성공 여부
   */
  removeHandler(event: string, handlerId: string): boolean {
    const eventHandlers = this.handlers.get(event);
    if (!eventHandlers) return false;

    const index = eventHandlers.findIndex((info) => info.id === handlerId);
    if (index === -1) return false;

    eventHandlers.splice(index, 1);

    if (eventHandlers.length === 0) {
      this.handlers.delete(event);
    }

    if (this.options.enableLogging) {
      console.log(`[EventManager] 이벤트 핸들러 제거: ${event} (ID: ${handlerId})`);
    }

    return true;
  }

  /**
   * 모든 이벤트 핸들러를 초기화합니다.
   */
  initialize(): void {
    if (this.options.enableLogging) {
      console.log('[EventManager] 이벤트 핸들러 초기화 시작');
    }

    for (const [event, handlers] of this.handlers.entries()) {
      this.client.on(event, async (...args: any[]) => {
        await this.executeHandlers(event, handlers, args);
      });
    }

    // 클라이언트 오류 처리
    this.client.on('error', (error) => {
      console.error('[EventManager] 클라이언트 오류:', error);
      this.emit('clientError', error);
    });

    // 처리되지 않은 오류 처리
    this.client.on('warn', (warning) => {
      console.warn('[EventManager] 클라이언트 경고:', warning);
      this.emit('clientWarning', warning);
    });

    if (this.options.enableLogging) {
      console.log(`[EventManager] 이벤트 핸들러 초기화 완료: ${this.handlers.size}개 이벤트`);
    }
  }

  /**
   * 이벤트 핸들러들을 실행합니다.
   * @param event - 이벤트 이름
   * @param handlers - 핸들러 목록
   * @param args - 이벤트 인수
   */
  private async executeHandlers(
    event: string,
    handlers: EventHandlerInfo[],
    args: any[]
  ): Promise<void> {
    const startTime = Date.now();
    const toRemove: string[] = [];

    for (const handlerInfo of handlers) {
      const handlerStartTime = Date.now();

      try {
        // 통계 업데이트
        if (this.options.enableStats) {
          handlerInfo.stats.calls++;
          handlerInfo.stats.lastCalled = new Date();
        }

        // 타임아웃 설정
        if (handlerInfo.options.timeout && handlerInfo.options.timeout > 0) {
          await this.executeHandlerWithTimeout(handlerInfo, args);
        } else {
          await handlerInfo.handler(...args);
        }

        // 성공 통계 업데이트
        if (this.options.enableStats) {
          handlerInfo.stats.successes++;
          handlerInfo.stats.totalExecutionTime += Date.now() - handlerStartTime;
        }

        // 한 번만 실행하는 핸들러 제거 표시
        if (handlerInfo.options.once) {
          toRemove.push(handlerInfo.id);
        }
      } catch (error) {
        // 오류 통계 업데이트
        if (this.options.enableStats) {
          handlerInfo.stats.errors++;
          handlerInfo.stats.lastError = new Date();
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[EventManager] 이벤트 핸들러 오류 (${event}):`, errorMessage);

        // 재시도 로직
        if (
          this.options.enableRetry &&
          handlerInfo.options.maxRetries &&
          handlerInfo.options.maxRetries > 0
        ) {
          await this.retryHandler(handlerInfo, args, event);
        }

        // 오류 이벤트 발생
        this.emit('handlerError', {
          event,
          handlerId: handlerInfo.id,
          error,
          args,
        });
      }
    }

    // 한 번만 실행하는 핸들러들 제거
    for (const handlerId of toRemove) {
      this.removeHandler(event, handlerId);
    }

    // 전체 이벤트 통계 업데이트
    if (this.options.enableStats) {
      this.updateEventStats(event, handlers.length, Date.now() - startTime);
    }
  }

  /**
   * 타임아웃이 설정된 핸들러를 실행합니다.
   * @param handlerInfo - 핸들러 정보
   * @param args - 이벤트 인수
   */
  private async executeHandlerWithTimeout(
    handlerInfo: EventHandlerInfo,
    args: any[]
  ): Promise<void> {
    const timeout = handlerInfo.options.timeout!;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`핸들러 타임아웃 (${timeout}ms)`));
      }, timeout);

      Promise.resolve(handlerInfo.handler(...args))
        .then(() => {
          clearTimeout(timeoutId);
          resolve();
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * 핸들러를 재시도합니다.
   * @param handlerInfo - 핸들러 정보
   * @param args - 이벤트 인수
   * @param event - 이벤트 이름
   */
  private async retryHandler(
    handlerInfo: EventHandlerInfo,
    args: any[],
    event: string
  ): Promise<void> {
    const maxRetries = handlerInfo.options.maxRetries || 0;
    const retryDelay = handlerInfo.options.retryDelay || 1000;

    for (let retry = 1; retry <= maxRetries; retry++) {
      try {
        await new Promise((resolve) => setTimeout(resolve, retryDelay * retry));
        await handlerInfo.handler(...args);

        if (this.options.enableLogging) {
          console.log(`[EventManager] 핸들러 재시도 성공 (${event}, ${retry}/${maxRetries})`);
        }

        return; // 성공 시 종료
      } catch (error) {
        if (retry === maxRetries) {
          console.error(
            `[EventManager] 핸들러 재시도 실패 (${event}, ${retry}/${maxRetries}):`,
            error
          );
          throw error;
        }
      }
    }
  }

  /**
   * 이벤트 통계를 업데이트합니다.
   * @param event - 이벤트 이름
   * @param handlerCount - 핸들러 수
   * @param executionTime - 실행 시간
   */
  private updateEventStats(event: string, handlerCount: number, executionTime: number): void {
    if (!this.eventStats.has(event)) {
      this.eventStats.set(event, {
        eventName: event,
        handlerCount,
        totalCalls: 0,
        successCount: 0,
        errorCount: 0,
        averageExecutionTime: 0,
      });
    }

    const stats = this.eventStats.get(event)!;
    stats.totalCalls++;
    stats.lastCalled = new Date();

    // 평균 실행 시간 계산
    if (stats.averageExecutionTime) {
      stats.averageExecutionTime = (stats.averageExecutionTime + executionTime) / 2;
    } else {
      stats.averageExecutionTime = executionTime;
    }
  }

  /**
   * 특정 이벤트의 모든 핸들러를 제거합니다.
   * @param event - 제거할 이벤트 이름
   */
  clearHandlers(event: string): void {
    if (this.handlers.has(event)) {
      this.handlers.delete(event);

      if (this.options.enableLogging) {
        console.log(`[EventManager] 이벤트 핸들러 모두 제거: ${event}`);
      }
    }
  }

  /**
   * 모든 이벤트 핸들러를 제거합니다.
   */
  clearAllHandlers(): void {
    this.handlers.clear();
    this.eventStats.clear();

    if (this.options.enableLogging) {
      console.log('[EventManager] 모든 이벤트 핸들러 제거');
    }
  }

  /**
   * 등록된 이벤트 목록을 가져옵니다.
   * @returns 이벤트 이름 배열
   */
  getRegisteredEvents(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * 특정 이벤트의 핸들러 수를 가져옵니다.
   * @param event - 이벤트 이름
   * @returns 핸들러 수
   */
  getHandlerCount(event: string): number {
    const handlers = this.handlers.get(event);
    return handlers ? handlers.length : 0;
  }

  /**
   * 전체 핸들러 수를 가져옵니다.
   * @returns 전체 핸들러 수
   */
  getTotalHandlerCount(): number {
    let total = 0;
    for (const handlers of this.handlers.values()) {
      total += handlers.length;
    }
    return total;
  }

  /**
   * 이벤트 통계를 가져옵니다.
   * @param event - 이벤트 이름 (선택사항)
   * @returns 이벤트 통계 또는 전체 통계
   */
  getEventStats(event?: string): EventStats | EventStats[] {
    if (event) {
      return (
        this.eventStats.get(event) || {
          eventName: event,
          handlerCount: this.getHandlerCount(event),
          totalCalls: 0,
          successCount: 0,
          errorCount: 0,
        }
      );
    }

    return Array.from(this.eventStats.values());
  }

  /**
   * 핸들러 정보를 가져옵니다.
   * @param event - 이벤트 이름
   * @returns 핸들러 정보 배열
   */
  getHandlerInfo(event: string): Array<{
    id: string;
    options: EventListenerOptions;
    stats: EventHandlerInfo['stats'];
  }> {
    const handlers = this.handlers.get(event);
    if (!handlers) return [];

    return handlers.map((handler) => ({
      id: handler.id,
      options: handler.options,
      stats: handler.stats,
    }));
  }

  /**
   * 이벤트 매니저의 상태를 가져옵니다.
   * @returns 상태 정보
   */
  getStatus(): {
    totalEvents: number;
    totalHandlers: number;
    totalCalls: number;
    averageHandlersPerEvent: number;
    enabledFeatures: string[];
  } {
    const totalEvents = this.handlers.size;
    const totalHandlers = this.getTotalHandlerCount();
    const totalCalls = Array.from(this.eventStats.values()).reduce(
      (sum, stat) => sum + stat.totalCalls,
      0
    );

    const enabledFeatures: string[] = [];
    if (this.options.enableStats) enabledFeatures.push('통계');
    if (this.options.enableLogging) enabledFeatures.push('로깅');
    if (this.options.enableRetry) enabledFeatures.push('재시도');

    return {
      totalEvents,
      totalHandlers,
      totalCalls,
      averageHandlersPerEvent: totalEvents > 0 ? totalHandlers / totalEvents : 0,
      enabledFeatures,
    };
  }

  /**
   * 특정 이벤트를 강제로 발생시킵니다.
   * @param event - 이벤트 이름
   * @param args - 이벤트 인수
   */
  async emitEvent(event: string, ...args: any[]): Promise<void> {
    const handlers = this.handlers.get(event);
    if (!handlers) {
      if (this.options.enableLogging) {
        console.log(`[EventManager] 이벤트 핸들러 없음: ${event}`);
      }
      return;
    }

    await this.executeHandlers(event, handlers, args);
  }

  /**
   * 이벤트 핸들러 실행을 일시 중지합니다.
   * @param event - 이벤트 이름
   */
  pauseEvent(event: string): void {
    // 클라이언트에서 이벤트 리스너 제거
    this.client.removeAllListeners(event);

    if (this.options.enableLogging) {
      console.log(`[EventManager] 이벤트 일시 중지: ${event}`);
    }
  }

  /**
   * 이벤트 핸들러 실행을 재개합니다.
   * @param event - 이벤트 이름
   */
  resumeEvent(event: string): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      this.client.on(event, async (...args: any[]) => {
        await this.executeHandlers(event, handlers, args);
      });

      if (this.options.enableLogging) {
        console.log(`[EventManager] 이벤트 재개: ${event}`);
      }
    }
  }

  /**
   * 모든 이벤트를 일시 중지합니다.
   */
  pauseAllEvents(): void {
    for (const event of this.handlers.keys()) {
      this.pauseEvent(event);
    }
  }

  /**
   * 모든 이벤트를 재개합니다.
   */
  resumeAllEvents(): void {
    for (const event of this.handlers.keys()) {
      this.resumeEvent(event);
    }
  }

  /**
   * 정리 작업을 수행합니다.
   */
  cleanup(): void {
    this.clearAllHandlers();
    this.removeAllListeners();

    if (this.options.enableLogging) {
      console.log('[EventManager] 정리 작업 완료');
    }
  }
}

// ====================
// 유틸리티 함수
// ====================

/**
 * 이벤트 핸들러를 데코레이터로 등록합니다.
 * @param eventName - 이벤트 이름
 * @param options - 이벤트 옵션
 * @returns 데코레이터 함수
 */
export function EventHandler(eventName: string, options: EventListenerOptions = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: any[]) {
      return originalMethod.apply(this, args);
    };

    // 메타데이터 저장
    if (!target.constructor._eventHandlers) {
      target.constructor._eventHandlers = [];
    }

    target.constructor._eventHandlers.push({
      eventName,
      methodName: propertyKey,
      options,
    });
  };
}

/**
 * 이벤트 핸들러를 자동으로 등록합니다.
 * @param eventManager - 이벤트 매니저
 * @param target - 대상 객체
 */
export function registerEventHandlers(eventManager: EventManager, target: any): void {
  const eventHandlers = target.constructor._eventHandlers;

  if (!eventHandlers) return;

  for (const { eventName, methodName, options } of eventHandlers) {
    const handler = target[methodName].bind(target);
    eventManager.registerHandler(eventName, handler, options);
  }
}

/**
 * 이벤트 이름 상수
 */
export const DiscordEvents = {
  // 클라이언트 이벤트
  READY: 'ready',
  CLIENT_READY: 'clientReady',
  DISCONNECT: 'disconnect',
  ERROR: 'error',
  WARN: 'warn',
  DEBUG: 'debug',
  RATE_LIMIT: 'rateLimit',
  INVALID_REQUEST_WARNING: 'invalidRequestWarning',

  // 길드 이벤트
  GUILD_CREATE: 'guildCreate',
  GUILD_DELETE: 'guildDelete',
  GUILD_UPDATE: 'guildUpdate',
  GUILD_UNAVAILABLE: 'guildUnavailable',
  GUILD_AVAILABLE: 'guildAvailable',
  GUILD_MEMBER_ADD: 'guildMemberAdd',
  GUILD_MEMBER_REMOVE: 'guildMemberRemove',
  GUILD_MEMBER_UPDATE: 'guildMemberUpdate',
  GUILD_MEMBERS_CHUNK: 'guildMembersChunk',
  GUILD_INTEGRATIONS_UPDATE: 'guildIntegrationsUpdate',
  GUILD_ROLE_CREATE: 'roleCreate',
  GUILD_ROLE_DELETE: 'roleDelete',
  GUILD_ROLE_UPDATE: 'roleUpdate',
  GUILD_EMOJI_CREATE: 'emojiCreate',
  GUILD_EMOJI_DELETE: 'emojiDelete',
  GUILD_EMOJI_UPDATE: 'emojiUpdate',
  GUILD_BAN_ADD: 'guildBanAdd',
  GUILD_BAN_REMOVE: 'guildBanRemove',

  // 채널 이벤트
  CHANNEL_CREATE: 'channelCreate',
  CHANNEL_DELETE: 'channelDelete',
  CHANNEL_UPDATE: 'channelUpdate',
  CHANNEL_PINS_UPDATE: 'channelPinsUpdate',

  // 메시지 이벤트
  MESSAGE_CREATE: 'messageCreate',
  MESSAGE_DELETE: 'messageDelete',
  MESSAGE_UPDATE: 'messageUpdate',
  MESSAGE_BULK_DELETE: 'messageDeleteBulk',
  MESSAGE_REACTION_ADD: 'messageReactionAdd',
  MESSAGE_REACTION_REMOVE: 'messageReactionRemove',
  MESSAGE_REACTION_REMOVE_ALL: 'messageReactionRemoveAll',
  MESSAGE_REACTION_REMOVE_EMOJI: 'messageReactionRemoveEmoji',

  // 상호작용 이벤트
  INTERACTION_CREATE: 'interactionCreate',

  // 음성 이벤트
  VOICE_STATE_UPDATE: 'voiceStateUpdate',

  // 사용자 이벤트
  USER_UPDATE: 'userUpdate',
  PRESENCE_UPDATE: 'presenceUpdate',
  TYPING_START: 'typingStart',

  // 스레드 이벤트
  THREAD_CREATE: 'threadCreate',
  THREAD_DELETE: 'threadDelete',
  THREAD_UPDATE: 'threadUpdate',
  THREAD_LIST_SYNC: 'threadListSync',
  THREAD_MEMBER_UPDATE: 'threadMemberUpdate',
  THREAD_MEMBERS_UPDATE: 'threadMembersUpdate',

  // 스테이지 이벤트
  STAGE_INSTANCE_CREATE: 'stageInstanceCreate',
  STAGE_INSTANCE_UPDATE: 'stageInstanceUpdate',
  STAGE_INSTANCE_DELETE: 'stageInstanceDelete',

  // 스티커 이벤트
  STICKER_CREATE: 'stickerCreate',
  STICKER_DELETE: 'stickerDelete',
  STICKER_UPDATE: 'stickerUpdate',

  // 초대 이벤트
  INVITE_CREATE: 'inviteCreate',
  INVITE_DELETE: 'inviteDelete',

  // 웹훅 이벤트
  WEBHOOKS_UPDATE: 'webhooksUpdate',

  // 애플리케이션 명령 이벤트
  APPLICATION_COMMAND_PERMISSIONS_UPDATE: 'applicationCommandPermissionsUpdate',

  // 자동 조정 이벤트
  AUTO_MODERATION_RULE_CREATE: 'autoModerationRuleCreate',
  AUTO_MODERATION_RULE_DELETE: 'autoModerationRuleDelete',
  AUTO_MODERATION_RULE_UPDATE: 'autoModerationRuleUpdate',
  AUTO_MODERATION_ACTION_EXECUTION: 'autoModerationActionExecution',

  // 감사 로그 이벤트
  GUILD_AUDIT_LOG_ENTRY_CREATE: 'guildAuditLogEntryCreate',
} as const;

export type DiscordEventNames = (typeof DiscordEvents)[keyof typeof DiscordEvents];
