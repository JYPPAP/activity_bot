// src/interfaces/ICommandHandler.ts - 명령어 핸들러 인터페이스

import type { Interaction, ChatInputCommandInteraction } from 'discord.js';

import type { CommandBase } from '../commands/CommandBase';

/**
 * 명령어 실행 결과 인터페이스
 */
export interface CommandExecutionResult {
  success: boolean;
  commandName: string;
  userId: string;
  executionTime: number;
  error?: Error;
}

/**
 * 명령어 핸들러 통계 인터페이스
 */
export interface CommandHandlerStatistics {
  totalCommands: number;
  successfulCommands: number;
  failedCommands: number;
  averageExecutionTime: number;
  commandUsage: Record<string, number>;
  errorTypes: Record<string, number>;
  userCommandCount: Record<string, number>;
}

/**
 * 명령어 핸들러 설정 인터페이스
 */
export interface CommandHandlerConfig {
  enableStatistics: boolean;
  enableCaching: boolean;
  maxConcurrentCommands: number;
  commandTimeout: number;
  enableRateLimit: boolean;
  globalRateLimit: number;
  enableMetrics: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * 명령어 핸들러 인터페이스
 * Discord 슬래시 명령어 처리를 위한 공통 인터페이스
 */
export interface ICommandHandler {
  // 인터랙션 처리
  handleInteraction(interaction: Interaction): Promise<void>;
  handleChatInputCommand(interaction: ChatInputCommandInteraction): Promise<CommandExecutionResult>;

  // 명령어 관리
  registerCommand(command: CommandBase): void;
  unregisterCommand(commandName: string): void;
  getCommand(commandName: string): CommandBase | undefined;
  getAllCommands(): Map<string, CommandBase>;

  // 별칭 관리
  addCommandAlias(alias: string, commandName: string): void;
  removeCommandAlias(alias: string): void;
  getCommandByAlias(alias: string): CommandBase | undefined;

  // 권한 검사
  checkCommandPermission(commandName: string, userId: string, guildId?: string): Promise<boolean>;
  hasGlobalPermission(userId: string): boolean;

  // 실행 제어
  executeCommand(
    commandName: string,
    interaction: ChatInputCommandInteraction
  ): Promise<CommandExecutionResult>;
  canExecuteCommand(commandName: string, userId: string): boolean;

  // 통계 및 모니터링
  getStatistics(): CommandHandlerStatistics;
  resetStatistics(): void;
  getCommandUsage(commandName?: string): Record<string, number>;

  // 설정 관리
  updateConfig(config: Partial<CommandHandlerConfig>): void;
  getConfig(): CommandHandlerConfig;

  // 레이트 리미팅
  isRateLimited(userId: string): boolean;
  getRateLimitStatus(userId: string): {
    limited: boolean;
    resetTime?: Date;
    remainingCalls?: number;
  };
  resetRateLimit(userId: string): void;

  // 큐 관리
  getQueueStatus(): { pending: number; active: number; completed: number };
  clearQueue(): void;

  // 에러 처리
  handleCommandError(error: Error, interaction: ChatInputCommandInteraction): Promise<void>;
  getRecentErrors(limit?: number): Array<{ error: Error; timestamp: Date; commandName: string }>;

  // 캐시 관리
  clearCache(): void;
  getCacheStats(): { size: number; hitRate: number };

  // 초기화 및 정리
  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  // 헬스 체크
  healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; details: Record<string, any> }>;
}
