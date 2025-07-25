// src/commands/commandHandler.js - Performance-optimized command handler
import { PermissionsBitField, MessageFlags } from 'discord.js';
import { CommandRegistry } from './CommandRegistry.js';
import { UserClassificationService } from '../services/UserClassificationService.js';
import { hasCommandPermission, getPermissionDeniedMessage } from '../config/commandPermissions.js';
import { config } from '../config/env.js';
import { performance } from 'perf_hooks';

export class CommandHandler {
  constructor(client, activityTracker, dbManager, calendarLogService, voiceForumService) {
    this.client = client;
    this.activityTracker = activityTracker;
    this.dbManager = dbManager;
    this.calendarLogService = calendarLogService;
    this.voiceForumService = voiceForumService;

    // UserClassificationService 인스턴스 생성
    this.userClassificationService = new UserClassificationService(this.dbManager, this.activityTracker);

    // Performance metrics
    this.totalInteractions = 0;
    this.errorCount = 0;
    this.commandExecutionMetrics = new Map();

    // CommandRegistry 초기화
    this.commandRegistry = new CommandRegistry();
    this.initializationPromise = this.initializeCommands();
  }

  /**
   * Initialize commands asynchronously with performance monitoring
   */
  async initializeCommands() {
    try {
      const services = {
        client: this.client,
        activityTracker: this.activityTracker,
        dbManager: this.dbManager,
        calendarLogService: this.calendarLogService,
        voiceForumService: this.voiceForumService,
        userClassificationService: this.userClassificationService
      };

      await this.commandRegistry.initialize(services);
      console.log('✅ CommandHandler: Performance-optimized initialization complete');
    } catch (error) {
      console.error('❌ CommandHandler: Initialization failed:', error);
      throw error;
    }
  }

  /**
   * 사용자가 관리자 권한을 가지고 있는지 확인합니다.
   * @param interaction - 상호작용 객체
   * @returns {boolean} - 관리자 권한 또는 특정 사용자 여부
   */
  hasAdminPermission(interaction) {
    return (
      interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
      interaction.user.id === config.DEV_ID
    );
  }

  /**
   * 명령어 상호작용을 처리합니다.
   * @param interaction - 상호작용 객체
   */
  async handleInteraction(interaction) {
    // 명령어 상호작용인 경우 명령어 처리
    if (interaction.isCommand()) {
      await this.handleCommandInteraction(interaction);
      return;
    }
    
    // 기타 인터랙션 (버튼, 모달, 셀렉트 메뉴 등)은 voiceForumService로 전달
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
      await this.voiceForumService.handleInteraction(interaction);
      return;
    }
  }
  
  /**
   * 명령어 인터랙션 처리 (성능 최적화)
   * @param interaction - 명령어 인터랙션 객체
   */
  async handleCommandInteraction(interaction) {
    const startTime = performance.now();
    const { commandName } = interaction;
    let success = true;

    this.totalInteractions++;

    try {
      // Wait for initialization if still in progress
      if (this.initializationPromise) {
        await this.initializationPromise;
        this.initializationPromise = null;
      }

      // 권한 확인
      if (!hasCommandPermission(interaction.member, commandName)) {
        await interaction.reply({
          content: getPermissionDeniedMessage(commandName),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // 명령어 동적 로딩 및 실행
      const command = await this.commandRegistry.getCommand(commandName);
      if (command) {
        await command.execute(interaction);
      } else {
        console.warn(`⚠️ Command not found: ${commandName}`);
        success = false;
        await interaction.reply({
          content: "알 수 없는 명령어입니다.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      success = false;
      this.errorCount++;
      console.error("명령어 처리 오류:", error);

      // Enhanced error handling with context
      const errorMessage = this.getContextualErrorMessage(error, commandName);
      
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
      } catch (replyError) {
        console.error("응답 전송 실패:", replyError);
      }
    } finally {
      // Performance tracking
      const executionTime = performance.now() - startTime;
      this.updateCommandMetrics(commandName, executionTime, success);
      this.commandRegistry.trackExecution(commandName, executionTime, success);
    }
  }

  /**
   * Get contextual error message based on error type
   */
  getContextualErrorMessage(error, commandName) {
    // Network/API errors
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return "🌐 네트워크 연결 문제가 발생했습니다. 잠시 후 다시 시도해주세요.";
    }

    // Permission errors
    if (error.message?.includes('Missing Permissions')) {
      return "🔒 봇에게 필요한 권한이 없습니다. 관리자에게 문의해주세요.";
    }

    // Database errors
    if (error.message?.includes('database') || error.code?.includes('SQLITE')) {
      return "💾 데이터베이스 오류가 발생했습니다. 관리자에게 문의해주세요.";
    }

    // Rate limit errors
    if (error.code === 429) {
      return "⏰ 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
    }

    // Command-specific errors
    if (commandName === '시간체크' && error.message?.includes('활동')) {
      return "📊 활동 데이터를 불러오는 중 오류가 발생했습니다.";
    }

    // Generic fallback
    return "❌ 요청 수행 중 오류가 발생했습니다. 관리자에게 문의해주세요.";
  }

  /**
   * Update command execution metrics
   */
  updateCommandMetrics(commandName, executionTime, success) {
    if (!this.commandExecutionMetrics.has(commandName)) {
      this.commandExecutionMetrics.set(commandName, {
        totalExecutions: 0,
        totalTime: 0,
        errors: 0,
        averageTime: 0
      });
    }

    const metrics = this.commandExecutionMetrics.get(commandName);
    metrics.totalExecutions++;
    metrics.totalTime += executionTime;
    metrics.averageTime = metrics.totalTime / metrics.totalExecutions;
    
    if (!success) {
      metrics.errors++;
    }
  }

  /**
   * Get comprehensive performance analytics
   */
  getPerformanceAnalytics() {
    const registryAnalytics = this.commandRegistry.getAnalytics();
    
    return {
      ...registryAnalytics,
      totalInteractions: this.totalInteractions,
      errorRate: this.totalInteractions > 0 ? (this.errorCount / this.totalInteractions * 100).toFixed(2) + '%' : '0%',
      handlerMetrics: Object.fromEntries(this.commandExecutionMetrics),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
  }

  /**
   * Get command by name (async for lazy loading)
   */
  async getCommand(commandName) {
    if (this.initializationPromise) {
      await this.initializationPromise;
      this.initializationPromise = null;
    }
    return await this.commandRegistry.getCommand(commandName);
  }

  /**
   * Check if command exists
   */
  hasCommand(commandName) {
    return this.commandRegistry.hasCommand(commandName);
  }

  /**
   * Get all loaded commands (for compatibility)
   */
  get commands() {
    return this.commandRegistry.getAllCommands();
  }
}