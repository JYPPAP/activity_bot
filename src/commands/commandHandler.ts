// src/commands/commandHandler.ts - 명령어 핸들러 수정
import {
  Client,
  Interaction,
  ChatInputCommandInteraction,
  PermissionsBitField,
  MessageFlags,
  GuildMember,
} from 'discord.js';
import { injectable, inject, container } from 'tsyringe';

import { hasCommandPermission, getPermissionDeniedMessage } from '../config/commandPermissions.js';
import { config } from '../config/env.js';
import type { IActivityTracker } from '../interfaces/IActivityTracker';
import type { IDatabaseManager } from '../interfaces/IDatabaseManager';
import type { ILogService } from '../interfaces/ILogService';
import { DI_TOKENS } from '../interfaces/index.js';
import type { IUserClassificationService } from '../interfaces/IUserClassificationService';
import { GuildSettingsManager } from '../services/GuildSettingsManager.js';
import { VoiceChannelForumIntegrationService } from '../services/VoiceChannelForumIntegrationService.js';
import type { IStreamingReportEngine } from '../interfaces/IStreamingReportEngine';
import type { DiscordStreamingService } from '../services/DiscordStreamingService';
import { ReportCommandIntegration } from '../services/ReportCommandIntegration.js';

import { CommandBase, CommandServices } from './CommandBase.js';
import { GapCheckCommand } from './gapCheckCommand.js';
import { JamsuCommand } from './jamsuCommand.js';
import { RecruitmentCommand } from './recruitmentCommand.js';
import { ReportCommand } from './reportCommand.js';
import { SettingsCommand } from './settingsCommand.js';

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
  setUserClassificationService?(service: any): void; // 타입 호환성을 위해 any 사용
  setGuildSettingsManager?(manager: GuildSettingsManager): void;
  setStreamingReportEngine?(engine: IStreamingReportEngine): void;
  setDiscordStreamingService?(service: DiscordStreamingService): void;
  setReportCommandIntegration?(integration: ReportCommandIntegration): void; // 누락된 메서드 추가
}

@injectable()
export class CommandHandler {
  private client: Client;
  private activityTracker: IActivityTracker;
  private dbManager: IDatabaseManager;
  private voiceForumService?: VoiceChannelForumIntegrationService;
  private logService: ILogService;
  private userClassificationService: IUserClassificationService;
  private guildSettingsManager: GuildSettingsManager;
  private streamingReportEngine: IStreamingReportEngine;
  private discordStreamingService: DiscordStreamingService;
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
    @inject(DI_TOKENS.DiscordClient) client: Client,
    @inject(DI_TOKENS.IActivityTracker) activityTracker: IActivityTracker,
    @inject(DI_TOKENS.IDatabaseManager) dbManager: IDatabaseManager,
    @inject(DI_TOKENS.ILogService) logService: ILogService,
    @inject(DI_TOKENS.IUserClassificationService)
    userClassificationService: IUserClassificationService,
    @inject(DI_TOKENS.IGuildSettingsManager) guildSettingsManager: GuildSettingsManager,
    @inject(DI_TOKENS.IStreamingReportEngine) streamingReportEngine: IStreamingReportEngine,
    @inject(DI_TOKENS.IDiscordStreamingService) discordStreamingService: DiscordStreamingService
  ) {
    const config: Partial<CommandHandlerConfig> = {};
    this.client = client;
    this.activityTracker = activityTracker;
    this.dbManager = dbManager;
    this.logService = logService;
    this.guildSettingsManager = guildSettingsManager;
    this.userClassificationService = userClassificationService;
    this.streamingReportEngine = streamingReportEngine;
    this.discordStreamingService = discordStreamingService;

    // 설정 초기화
    this.config = {
      enableStatistics: true,
      enableCaching: true,
      maxConcurrentCommands: 50,
      commandTimeout: 60000,
      enableRateLimit: true,
      globalRateLimit: 100,
      enableMetrics: true,
      logLevel: 'info',
      ...config,
    };

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

    // 정리 타이머
    setInterval(() => this.cleanup(), 60000); // 1분마다 정리
  }

  /**
   * VoiceChannelForumIntegrationService 설정
   * @param service - VoiceChannelForumIntegrationService 인스턴스
   */
  setVoiceForumService(service: VoiceChannelForumIntegrationService): void {
    this.voiceForumService = service;
    // VoiceChannelForumIntegrationService가 설정된 후에 명령어 초기화
    this.initializeCommands();
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
        logService: this.logService,
        guildSettingsManager: this.guildSettingsManager,
      };

      // 명령어 인스턴스 생성
      const jamsuCommand = new JamsuCommand(services);
      const settingsCommand = new SettingsCommand(services);
      const reportCommand = new ReportCommand(services) as ExtendedCommand;
      const gapCheckCommand = new GapCheckCommand(services);
      const recruitmentCommand = new RecruitmentCommand({
        ...services,
        voiceForumService: this.voiceForumService!,
      });

      // UserClassificationService 의존성 주입
      if (reportCommand.setUserClassificationService) {
        reportCommand.setUserClassificationService(this.userClassificationService);
      }

      // GuildSettingsManager 의존성 주입
      if (reportCommand.setGuildSettingsManager) {
        reportCommand.setGuildSettingsManager(this.guildSettingsManager);
      }

      // 스트리밍 서비스 의존성 주입
      if (reportCommand.setStreamingReportEngine) {
        reportCommand.setStreamingReportEngine(this.streamingReportEngine);
      }

      if (reportCommand.setDiscordStreamingService) {
        reportCommand.setDiscordStreamingService(this.discordStreamingService);
      }

      // ReportCommandIntegration 의존성 주입
      try {
        const reportCommandIntegration = container.resolve(ReportCommandIntegration);
        if (reportCommand.setReportCommandIntegration) {
          reportCommand.setReportCommandIntegration(reportCommandIntegration);
        }
      } catch (error) {
        console.error('[CommandHandler] ReportCommandIntegration 주입 실패:', error);
      }

      // 명령어 맵에 등록
      this.registerCommand('잠수', jamsuCommand);
      this.registerCommand('설정', settingsCommand);
      this.registerCommand('보고서', reportCommand);
      this.registerCommand('시간체크', gapCheckCommand);
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

      // 설정 관련 인터랙션 처리
      if (
        interaction.isButton() ||
        interaction.isStringSelectMenu() ||
        interaction.isModalSubmit()
      ) {
        await this.handleSettingsInteraction(interaction);
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
   * 설정 관련 인터랙션 처리
   * @param interaction - 인터랙션 객체
   */
  private async handleSettingsInteraction(interaction: Interaction): Promise<void> {
    // 설정 관련 custom ID 패턴 확인
    const settingsRelatedIds = [
      'settings_activity_time',
      'settings_game_list',
      'settings_exclude_channels',
      'settings_management_channels',
      'activity_time_add',
      'activity_time_edit',
      'activity_time_delete',
      'activity_time_role_toggle',
      'activity_time_delete_confirm',
      'activity_time_delete_cancel',
      'activity_time_add_modal',
      'activity_time_edit_modal',
      'game_list_edit',
      'game_list_clear',
      'game_list_add_modal',
      'game_list_edit_modal',
      'exclude_channels_edit',
      'exclude_channels_clear',
      'exclude_channels_add_modal',
      'exclude_channels_edit_modal',
      'management_channels_edit',
      'management_channels_clear',
      'management_channels_add_modal',
      'management_channels_edit_modal',
      'settings_back_main',
    ];

    let customId = '';
    if (interaction.isButton()) {
      customId = interaction.customId;
    } else if (interaction.isModalSubmit()) {
      customId = interaction.customId;
    } else if (interaction.isStringSelectMenu()) {
      customId = interaction.customId;
    }

    // 설정 관련 인터랙션인지 확인
    const isSettingsInteraction = settingsRelatedIds.some((id) => customId.includes(id));

    if (isSettingsInteraction) {
      // 설정 명령어 가져오기
      const settingsCommand = this.commands.get('설정') as SettingsCommand;
      if (settingsCommand) {
        await this.routeSettingsInteraction(interaction, settingsCommand);
        return;
      }
    }

    // 설정 관련이 아닌 경우 voiceForumService로 전달
    if (this.voiceForumService) {
      await this.voiceForumService.handleInteraction(interaction);
    }
  }

  /**
   * 설정 인터랙션을 적절한 핸들러로 라우팅
   * @param interaction - 인터랙션 객체
   * @param settingsCommand - 설정 명령어 인스턴스
   */
  private async routeSettingsInteraction(
    interaction: Interaction,
    settingsCommand: SettingsCommand
  ): Promise<void> {
    try {
      if (interaction.isButton()) {
        await this.handleSettingsButtonInteraction(interaction, settingsCommand);
      } else if (interaction.isModalSubmit()) {
        await this.handleSettingsModalInteraction(interaction, settingsCommand);
      }
    } catch (error) {
      console.error('설정 인터랙션 라우팅 오류:', error);

      // 에러 로깅
      if (this.logService) {
        this.logService.logActivity('설정 인터랙션 처리 오류', [], 'settings_interaction_error', {
          error: error instanceof Error ? error.message : String(error),
          customId: interaction.isButton()
            ? interaction.customId
            : interaction.isModalSubmit()
              ? interaction.customId
              : 'unknown',
        });
      }
    }
  }

  /**
   * 설정 버튼 인터랙션 처리
   * @param interaction - 버튼 인터랙션 객체
   * @param settingsCommand - 설정 명령어 인스턴스
   */
  private async handleSettingsButtonInteraction(
    interaction: any,
    settingsCommand: SettingsCommand
  ): Promise<void> {
    const { customId } = interaction;

    switch (customId) {
      // 메인 카테고리 버튼들
      case 'settings_activity_time':
        await settingsCommand.handleActivityTimeButton(interaction);
        break;
      case 'settings_game_list':
        await settingsCommand.handleGameListButton(interaction);
        break;
      case 'settings_exclude_channels':
        await settingsCommand.handleExcludeChannelsButton(interaction);
        break;
      case 'settings_management_channels':
        await settingsCommand.handleManagementChannelsButton(interaction);
        break;

      // 활동시간 관리 버튼들
      case 'activity_time_add':
        await (settingsCommand as any).showActivityTimeModal(interaction, false);
        break;
      case 'activity_time_edit':
        // 수정할 역할 선택 인터페이스를 위한 추가 구현 필요
        break;
      case 'activity_time_delete':
        await (settingsCommand as any).handleActivityTimeDeleteButton(interaction);
        break;

      // 게임 목록 관리 버튼들
      case 'game_list_edit':
        const guildId1 = interaction.guild?.id;
        if (guildId1) {
          const gameListSetting = await (settingsCommand as any).guildSettingsManager.getGameList(
            guildId1
          );
          if (gameListSetting) {
            await (settingsCommand as any).showGameListModal(
              interaction,
              true,
              gameListSetting.games
            );
          }
        }
        break;

      // 제외 채널 관리 버튼들
      case 'exclude_channels_edit':
        const guildId2 = interaction.guild?.id;
        if (guildId2) {
          const excludeChannelsSetting = await (
            settingsCommand as any
          ).guildSettingsManager.getExcludeChannels(guildId2);
          if (excludeChannelsSetting) {
            await (settingsCommand as any).showExcludeChannelsModal(
              interaction,
              true,
              excludeChannelsSetting
            );
          }
        }
        break;

      // 관리 채널 관리 버튼들
      case 'management_channels_edit':
        const guildId3 = interaction.guild?.id;
        if (guildId3) {
          const channelManagementSetting = await (
            settingsCommand as any
          ).guildSettingsManager.getChannelManagement(guildId3);
          if (channelManagementSetting) {
            await (settingsCommand as any).showManagementChannelsModal(
              interaction,
              true,
              channelManagementSetting
            );
          }
        }
        break;

      // 메인으로 돌아가기
      case 'settings_back_main':
        // 메인 인터페이스로 돌아가기
        await (settingsCommand as any).showMainSettingsInterface(interaction);
        break;

      default:
        // 활동시간 역할 선택/삭제 관련 버튼들 처리
        if (customId.startsWith('activity_time_role_toggle_')) {
          await (settingsCommand as any).handleActivityTimeRoleToggle(interaction);
          return;
        } else if (customId === 'activity_time_delete_confirm') {
          await (settingsCommand as any).handleActivityTimeDeleteConfirm(interaction);
          return;
        } else if (customId === 'activity_time_delete_cancel') {
          await (settingsCommand as any).handleActivityTimeDeleteCancel(interaction);
          return;
        }

        console.log('처리되지 않은 설정 버튼:', customId);
        break;
    }
  }

  /**
   * 설정 모달 인터랙션 처리
   * @param interaction - 모달 인터랙션 객체
   * @param settingsCommand - 설정 명령어 인스턴스
   */
  private async handleSettingsModalInteraction(
    interaction: any,
    settingsCommand: SettingsCommand
  ): Promise<void> {
    const { customId } = interaction;

    switch (customId) {
      case 'activity_time_add_modal':
      case 'activity_time_edit_modal':
        await settingsCommand.handleActivityTimeModalSubmit(interaction);
        break;
      case 'game_list_add_modal':
      case 'game_list_edit_modal':
        await settingsCommand.handleGameListModalSubmit(interaction);
        break;
      case 'exclude_channels_add_modal':
      case 'exclude_channels_edit_modal':
        await settingsCommand.handleExcludeChannelsModalSubmit(interaction);
        break;
      case 'management_channels_add_modal':
      case 'management_channels_edit_modal':
        await settingsCommand.handleManagementChannelsModalSubmit(interaction);
        break;
      default:
        console.log('처리되지 않은 설정 모달:', customId);
        break;
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

        // 명령어 실행 - 보고서 명령어는 공개 visibility 사용
        if (resolvedCommandName === '보고서') {
          await Promise.race([command.executeWithVisibility(interaction, {}, true), timeoutPromise]);
        } else {
          await Promise.race([command.execute(interaction), timeoutPromise]);
        }

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
