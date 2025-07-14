// src/commands/commandHandler.ts - 명령어 핸들러 수정
import {
  Client,
  Interaction,
  ChatInputCommandInteraction,
  PermissionsBitField,
  MessageFlags,
  GuildMember,
} from 'discord.js';

import { hasCommandPermission, getPermissionDeniedMessage } from '../config/commandPermissions.js';
import { config } from '../config/env.js';
import { ActivityTracker } from '../services/activityTracker.js';
import { CalendarLogService } from '../services/calendarLogService.js';
import { DatabaseManager } from '../services/DatabaseManager.js';
import { LogService } from '../services/logService.js';
import { UserClassificationService } from '../services/UserClassificationService.js';
import { VoiceChannelForumIntegrationService } from '../services/VoiceChannelForumIntegrationService.js';

import { CommandBase, CommandServices } from './CommandBase.js';
import { GapAfkCommand } from './gapAfkCommand.js';
import { GapCalendarCommand } from './gapCalendarCommand.js';
import { GapCheckCommand } from './gapCheckCommand.js';
import { GapConfigCommand } from './gapConfigCommand.js';
import { GapListCommand } from './gapListCommand.js';
import { GapReportCommand } from './gapReportCommand.js';
import { GapResetCommand } from './gapResetCommand.js';
import { GapSaveCommand } from './gapSaveCommand.js';
import { GapStatsCommand } from './gapStatsCommand.js';
import { RecruitmentCommand } from './recruitmentCommand.js';

// 명령어 핸들러 설정
interface CommandHandlerConfig {
  enableStatistics: boolean;
  enableCaching: boolean;
  maxConcurrentCommands: number;
  commandTimeout: number;
  enableRateLimit: boolean;
  globalRateLimit: number;
  enableMetrics: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

// 명령어 실행 결과
interface CommandExecutionResult {
  success: boolean;
  commandName: string;
  userId: string;
  executionTime: number;
  error?: Error;
}

// 명령어 통계
interface CommandHandlerStatistics {
  totalCommands: number;
  successfulCommands: number;
  failedCommands: number;
  averageExecutionTime: number;
  commandUsage: Record<string, number>;
  errorTypes: Record<string, number>;
  userCommandCount: Record<string, number>;
}

// 명령어 인터페이스 확장
interface ExtendedCommand extends CommandBase {
  setUserClassificationService?(service: UserClassificationService): void;
}

export class CommandHandler {
  private client: Client;
  private activityTracker: ActivityTracker;
  private dbManager: DatabaseManager;
  private calendarLogService: CalendarLogService;
  private voiceForumService: VoiceChannelForumIntegrationService;
  private logService: LogService | undefined;
  private userClassificationService: UserClassificationService;
  private config: CommandHandlerConfig;

  // 명령어 관리
  private commands: Map<string, CommandBase>;
  private commandAliases: Map<string, string>;

  // 통계 및 성능 추적
  private statistics: CommandHandlerStatistics;
  private executionQueue: Map<string, Promise<any>>;
  private rateLimitMap: Map<string, number[]>;
  private activeCommands: Set<string>;

  constructor(
    client: Client,
    activityTracker: ActivityTracker,
    dbManager: DatabaseManager,
    calendarLogService: CalendarLogService,
    voiceForumService: VoiceChannelForumIntegrationService,
    logService?: LogService,
    config: Partial<CommandHandlerConfig> = {}
  ) {
    this.client = client;
    this.activityTracker = activityTracker;
    this.dbManager = dbManager;
    this.calendarLogService = calendarLogService;
    this.voiceForumService = voiceForumService;
    this.logService = logService;

    // 설정 초기화
    this.config = {
      enableStatistics: true,
      enableCaching: true,
      maxConcurrentCommands: 50,
      commandTimeout: 30000,
      enableRateLimit: true,
      globalRateLimit: 100,
      enableMetrics: true,
      logLevel: 'info',
      ...config,
    };

    // UserClassificationService 인스턴스 생성
    this.userClassificationService = new UserClassificationService(
      this.dbManager,
      this.activityTracker
    );

    // 맵 초기화
    this.commands = new Map();
    this.commandAliases = new Map();
    this.executionQueue = new Map();
    this.rateLimitMap = new Map();
    this.activeCommands = new Set();

    // 통계 초기화
    this.statistics = {
      totalCommands: 0,
      successfulCommands: 0,
      failedCommands: 0,
      averageExecutionTime: 0,
      commandUsage: {},
      errorTypes: {},
      userCommandCount: {},
    };

    // 명령어 초기화
    this.initializeCommands();

    // 정리 타이머
    setInterval(() => this.cleanup(), 60000); // 1분마다 정리
  }

  /**
   * 명령어 초기화
   */
  private initializeCommands(): void {
    try {
      // 공통 서비스 객체
      const services: CommandServices = {
        client: this.client,
        activityTracker: this.activityTracker,
        dbManager: this.dbManager,
        calendarLogService: this.calendarLogService,
        logService: this.logService,
      };

      // 명령어 인스턴스 생성
      const gapListCommand = new GapListCommand(services) as ExtendedCommand;
      const gapConfigCommand = new GapConfigCommand(services);
      const gapResetCommand = new GapResetCommand(services);
      const gapCheckCommand = new GapCheckCommand(services);
      const gapSaveCommand = new GapSaveCommand(services);
      const gapCalendarCommand = new GapCalendarCommand(services);
      const gapStatsCommand = new GapStatsCommand(services);
      const gapReportCommand = new GapReportCommand(services) as ExtendedCommand;
      const gapAfkCommand = new GapAfkCommand(services);
      const recruitmentCommand = new RecruitmentCommand({
        ...services,
        voiceForumService: this.voiceForumService,
      });

      // UserClassificationService 의존성 주입
      if (gapListCommand.setUserClassificationService) {
        gapListCommand.setUserClassificationService(this.userClassificationService);
      }

      if (gapReportCommand.setUserClassificationService) {
        gapReportCommand.setUserClassificationService(this.userClassificationService);
      }

      // 명령어 맵에 등록
      this.registerCommand('gap_list', gapListCommand);
      this.registerCommand('gap_config', gapConfigCommand);
      this.registerCommand('gap_reset', gapResetCommand);
      this.registerCommand('시간체크', gapCheckCommand);
      this.registerCommand('gap_save', gapSaveCommand);
      this.registerCommand('gap_calendar', gapCalendarCommand);
      this.registerCommand('gap_stats', gapStatsCommand);
      this.registerCommand('gap_report', gapReportCommand);
      this.registerCommand('gap_afk', gapAfkCommand);
      this.registerCommand('구직', recruitmentCommand);

      console.log('명령어 초기화 완료:', [...this.commands.keys()]);
    } catch (error) {
      console.error('명령어 초기화 오류:', error);
    }
  }

  /**
   * 명령어 등록
   * @param name - 명령어 이름
   * @param command - 명령어 인스턴스
   * @param aliases - 명령어 별칭
   */
  private registerCommand(name: string, command: CommandBase, aliases: string[] = []): void {
    this.commands.set(name, command);

    // 별칭 등록
    for (const alias of aliases) {
      this.commandAliases.set(alias, name);
    }

    // 메타데이터에서 별칭 가져와서 등록
    if (command.metadata?.aliases) {
      for (const alias of command.metadata.aliases) {
        this.commandAliases.set(alias, name);
      }
    }
  }

  /**
   * 사용자가 관리자 권한을 가지고 있는지 확인합니다.
   * @param interaction - 상호작용 객체
   * @returns 관리자 권한 또는 특정 사용자 여부
   */
  hasAdminPermission(interaction: ChatInputCommandInteraction): boolean {
    const permissions = interaction.member?.permissions;
    return (
      (permissions &&
        typeof permissions !== 'string' &&
        permissions.has(PermissionsBitField.Flags.Administrator)) ||
      interaction.user.id === config.DEV_ID
    );
  }

  /**
   * 명령어 상호작용을 처리합니다.
   * @param interaction - 상호작용 객체
   */
  async handleInteraction(interaction: Interaction): Promise<void> {
    try {
      // 명령어 상호작용인 경우 명령어 처리
      if (interaction.isChatInputCommand()) {
        await this.handleCommandInteraction(interaction);
        return;
      }

      // 기타 인터랙션 (버튼, 모달, 셀렉트 메뉴 등)은 voiceForumService로 전달
      if (
        interaction.isButton() ||
        interaction.isStringSelectMenu() ||
        interaction.isModalSubmit()
      ) {
        await this.voiceForumService.handleInteraction(interaction);
        return;
      }
    } catch (error) {
      console.error('인터랙션 처리 오류:', error);

      // 에러 로깅
      if (this.logService) {
        this.logService.logActivity('인터랙션 처리 오류', [], 'interaction_error', {
          error: error instanceof Error ? error.message : String(error),
          interaction: interaction.type,
        });
      }
    }
  }

  /**
   * 명령어 인터랙션 처리
   * @param interaction - 명령어 인터랙션 객체
   */
  async handleCommandInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
    const startTime = Date.now();
    const { commandName } = interaction;

    try {
      // 레이트 리미트 확인
      if (this.config.enableRateLimit && !this.checkRateLimit(interaction)) {
        await interaction.reply({
          content: '명령어 실행 빈도 제한에 도달했습니다. 잠시 후 다시 시도해주세요.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // 동시 실행 제한 확인
      if (this.activeCommands.size >= this.config.maxConcurrentCommands) {
        await interaction.reply({
          content: '현재 처리 중인 명령어가 너무 많습니다. 잠시 후 다시 시도해주세요.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // 명령어 이름 해결 (별칭 포함)
      const resolvedCommandName = this.commandAliases.get(commandName) || commandName;

      // 권한 확인
      if (!interaction.member || !interaction.inGuild()) {
        await interaction.reply({
          content: '이 명령어는 서버에서만 사용할 수 있습니다.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // 타입 가드: APIInteractionGuildMember를 GuildMember로 변환
      if (!(interaction.member instanceof GuildMember)) {
        await interaction.reply({
          content: '멤버 정보를 불러올 수 없습니다.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!hasCommandPermission(interaction.member, resolvedCommandName)) {
        await interaction.reply({
          content: getPermissionDeniedMessage(resolvedCommandName),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // 명령어 실행
      const command = this.commands.get(resolvedCommandName);
      if (!command) {
        await interaction.reply({
          content: '존재하지 않는 명령어입니다.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // 실행 추적
      const executionId = `${interaction.user.id}-${Date.now()}`;
      this.activeCommands.add(executionId);

      try {
        // 타임아웃 설정
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Command timeout')), this.config.commandTimeout);
        });

        // 명령어 실행
        await Promise.race([command.execute(interaction), timeoutPromise]);

        // 성공 통계 업데이트
        this.updateStatistics({
          success: true,
          commandName: resolvedCommandName,
          userId: interaction.user.id,
          executionTime: Date.now() - startTime,
        });
      } finally {
        this.activeCommands.delete(executionId);
      }
    } catch (error) {
      console.error('명령어 처리 오류:', error);

      // 실패 통계 업데이트
      this.updateStatistics({
        success: false,
        commandName,
        userId: interaction.user.id,
        executionTime: Date.now() - startTime,
        error: error as Error,
      });

      // 에러 응답
      const errorMessage =
        error instanceof Error && error.message === 'Command timeout'
          ? '명령어 실행 시간이 초과되었습니다.'
          : '요청 수행 중 오류가 발생했습니다!';

      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: errorMessage,
            flags: MessageFlags.Ephemeral,
          });
        } else if (interaction.deferred) {
          await interaction.followUp({
            content: errorMessage,
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch (responseError) {
        console.error('에러 응답 전송 실패:', responseError);
      }
    }
  }

  /**
   * 레이트 리미트 확인
   * @param interaction - 상호작용 객체
   */
  private checkRateLimit(interaction: ChatInputCommandInteraction): boolean {
    const userId = interaction.user.id;
    const now = Date.now();
    const minute = 60 * 1000;

    if (!this.rateLimitMap.has(userId)) {
      this.rateLimitMap.set(userId, []);
    }

    const userRequests = this.rateLimitMap.get(userId)!;

    // 1분 이내의 요청만 유지
    const recentRequests = userRequests.filter((time) => now - time < minute);

    if (recentRequests.length >= this.config.globalRateLimit) {
      return false;
    }

    recentRequests.push(now);
    this.rateLimitMap.set(userId, recentRequests);

    return true;
  }

  /**
   * 통계 업데이트
   * @param result - 실행 결과
   */
  private updateStatistics(result: CommandExecutionResult): void {
    if (!this.config.enableStatistics) return;

    this.statistics.totalCommands++;

    if (result.success) {
      this.statistics.successfulCommands++;
    } else {
      this.statistics.failedCommands++;

      if (result.error) {
        const errorType = result.error.name || 'Unknown';
        this.statistics.errorTypes[errorType] = (this.statistics.errorTypes[errorType] || 0) + 1;
      }
    }

    // 명령어 사용 통계
    this.statistics.commandUsage[result.commandName] =
      (this.statistics.commandUsage[result.commandName] || 0) + 1;

    // 사용자별 명령어 사용 통계
    this.statistics.userCommandCount[result.userId] =
      (this.statistics.userCommandCount[result.userId] || 0) + 1;

    // 평균 실행 시간 계산
    const totalTime =
      this.statistics.averageExecutionTime * (this.statistics.totalCommands - 1) +
      result.executionTime;
    this.statistics.averageExecutionTime = totalTime / this.statistics.totalCommands;

    // 상세 로깅
    if (this.config.logLevel === 'debug') {
      console.log(`[CommandHandler] ${result.commandName} 실행 완료:`, {
        success: result.success,
        executionTime: result.executionTime,
        user: result.userId,
      });
    }
  }

  /**
   * 메모리 정리
   */
  private cleanup(): void {
    const now = Date.now();
    const hour = 60 * 60 * 1000;

    // 오래된 레이트 리미트 데이터 정리
    for (const [userId, requests] of this.rateLimitMap.entries()) {
      const recentRequests = requests.filter((time) => now - time < hour);
      if (recentRequests.length === 0) {
        this.rateLimitMap.delete(userId);
      } else {
        this.rateLimitMap.set(userId, recentRequests);
      }
    }

    // 실행 큐 정리
    for (const [key, promise] of this.executionQueue.entries()) {
      // 완료된 프로미스 제거
      promise
        .then(() => {
          this.executionQueue.delete(key);
        })
        .catch(() => {
          this.executionQueue.delete(key);
        });
    }
  }

  /**
   * 명령어 목록 조회
   */
  getCommandList(): string[] {
    return Array.from(this.commands.keys());
  }

  /**
   * 명령어 정보 조회
   * @param commandName - 명령어 이름
   */
  getCommandInfo(commandName: string): CommandBase | null {
    const resolvedName = this.commandAliases.get(commandName) || commandName;
    return this.commands.get(resolvedName) || null;
  }

  /**
   * 통계 조회
   */
  getStatistics(): CommandHandlerStatistics {
    return { ...this.statistics };
  }

  /**
   * 명령어 활성화/비활성화
   * @param commandName - 명령어 이름
   * @param enabled - 활성화 여부
   */
  setCommandEnabled(commandName: string, enabled: boolean): boolean {
    const command = this.commands.get(commandName);
    if (!command) return false;

    command.setEnabled(enabled);
    return true;
  }

  /**
   * 설정 업데이트
   * @param newConfig - 새로운 설정
   */
  updateConfig(newConfig: Partial<CommandHandlerConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 명령어 도움말 생성
   * @param commandName - 명령어 이름 (선택사항)
   */
  generateHelp(commandName?: string): string {
    if (commandName) {
      const command = this.getCommandInfo(commandName);
      if (!command) return '존재하지 않는 명령어입니다.';
      return command.getHelp();
    }

    let help = '**사용 가능한 명령어 목록:**\n\n';

    for (const [name, command] of this.commands.entries()) {
      help += `**${name}:** ${command.metadata.description}\n`;
    }

    return help;
  }

  /**
   * 서비스 상태 확인
   */
  getStatus(): {
    commandCount: number;
    activeCommands: number;
    statistics: CommandHandlerStatistics;
    rateLimitEntries: number;
  } {
    return {
      commandCount: this.commands.size,
      activeCommands: this.activeCommands.size,
      statistics: this.getStatistics(),
      rateLimitEntries: this.rateLimitMap.size,
    };
  }
}
