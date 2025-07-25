// src/commands/reportCommand.ts - 보고서 명령어
import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
  Collection,
  GuildMember,
  TextChannel,
} from 'discord.js';

// import { UserClassificationService } from '../services/UserClassificationService';
import { UserClassificationServiceOptimized as UserClassificationService } from '../services/UserClassificationServiceOptimized';
import { GuildSettingsManager } from '../services/GuildSettingsManager';
import { EmbedFactory } from '../utils/embedBuilder';
import { cleanRoleName } from '../utils/formatters';
import type { 
  IStreamingReportEngine,
  StreamingReportResult,
  StreamingProgress,
  DiscordStreamingOptions 
} from '../interfaces/IStreamingReportEngine';
import type { DiscordStreamingService } from '../services/DiscordStreamingService';
import { DI_TOKENS } from '../interfaces/index';

// Performance and reliability utilities
class PerformanceTracker {
  private timers = new Map<string, number>();
  
  start(operation: string): () => number {
    const startTime = performance.now();
    this.timers.set(operation, startTime);
    
    return (): number => {
      const endTime = performance.now();
      const duration = endTime - startTime;
      this.timers.delete(operation);
      return duration;
    };
  }
  
  measure<T>(operation: string, fn: () => T | Promise<T>): Promise<T> {
    const timer = this.start(operation);
    const result = fn();
    
    if (result instanceof Promise) {
      return result.finally(() => {
        const duration = timer();
        console.log(`[Performance] ${operation}: ${duration.toFixed(2)}ms`);
      });
    } else {
      const duration = timer();
      console.log(`[Performance] ${operation}: ${duration.toFixed(2)}ms`);
      return Promise.resolve(result);
    }
  }
}

class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private threshold = 5,
    private timeout = 60000,
    private monitor = 30000
  ) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
        console.log('[CircuitBreaker] Moving to half-open state');
      } else {
        throw new Error('Circuit breaker is open');
      }
    }
    
    try {
      const result = await operation();
      
      if (this.state === 'half-open') {
        this.reset();
        console.log('[CircuitBreaker] Reset to closed state');
      }
      
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
  
  private recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.threshold) {
      this.state = 'open';
      console.log(`[CircuitBreaker] Circuit opened after ${this.failures} failures`);
    }
  }
  
  private reset(): void {
    this.failures = 0;
    this.state = 'closed';
  }
  
  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime
    };
  }
}

class ResourceManager {
  private abortController: AbortController;
  private timeouts = new Set<NodeJS.Timeout>();
  private intervals = new Set<NodeJS.Timeout>();
  
  constructor(private timeoutMs = 300000) { // 5 minutes default
    this.abortController = new AbortController();
    
    // Auto-abort after timeout
    const timeoutId = setTimeout(() => {
      this.cleanup();
    }, this.timeoutMs);
    
    this.timeouts.add(timeoutId);
  }
  
  getAbortSignal(): AbortSignal {
    return this.abortController.signal;
  }
  
  addTimeout(callback: () => void, delay: number): NodeJS.Timeout {
    const timeoutId = setTimeout(callback, delay);
    this.timeouts.add(timeoutId);
    return timeoutId;
  }
  
  addInterval(callback: () => void, delay: number): NodeJS.Timeout {
    const intervalId = setInterval(callback, delay);
    this.intervals.add(intervalId);
    return intervalId;
  }
  
  cleanup(): void {
    this.abortController.abort();
    
    this.timeouts.forEach(timeoutId => clearTimeout(timeoutId));
    this.timeouts.clear();
    
    this.intervals.forEach(intervalId => clearInterval(intervalId));
    this.intervals.clear();
  }
}

import {
  CommandBase,
  CommandServices,
  CommandResult,
  CommandExecutionOptions,
  CommandMetadata,
} from './CommandBase';

// ⚡ 최적화된 멤버 가져오기 서비스
import { ReportCommandIntegration } from '../services/ReportCommandIntegration';

// 명령어 옵션 인터페이스
interface ReportCommandOptions {
  role: string;
  startDateStr: string;
  endDateStr: string;
  isTestMode: boolean;
  enableStreaming: boolean;
}

// 날짜 범위 인터페이스
interface DateRange {
  startDate: Date;
  endDate: Date;
}

// 보고서 생성 결과 인터페이스
interface ReportGenerationResult {
  role: string;
  dateRange: DateRange;
  reportEmbeds: any[];
  statistics?: {
    totalMembers: number;
    activeCount: number;
    inactiveCount: number;
    afkCount: number;
    averageActivity: number;
  };
  executionTime: number;
  testMode: boolean;
}

// 날짜 유효성 검사 결과
interface DateValidationResult {
  isValid: boolean;
  error?: string;
  dateRange?: DateRange;
}

export class ReportCommand extends CommandBase {
  public readonly metadata: CommandMetadata = {
    name: '보고서',
    description: '역할별 활동 보고서를 생성합니다.',
    category: 'administration',
    permissions: ['Administrator'],
    cooldown: 60,
    adminOnly: true,
    guildOnly: true,
    usage: '/보고서 role:<역할이름> start_date:<시작날짜> end_date:<종료날짜> [streaming:true]',
    examples: [
      '/보고서 role:정규 start_date:241201 end_date:241231',
      '/보고서 role:정규 start_date:241201 end_date:241231 test_mode:true',
      '/보고서 role:정규 start_date:241201 end_date:241231 streaming:true',
    ],
    aliases: ['report', '보고서'],
  };

  // Performance and reliability instances
  private performanceTracker = new PerformanceTracker();
  private circuitBreaker = new CircuitBreaker();
  
  // Constants for optimization
  private readonly FETCH_TIMEOUT = 30000; // 30 seconds
  private readonly MAX_MEMBERS_FETCH = 5000;
  private readonly MEMBER_CACHE_TTL = 300000; // 5 minutes
  private readonly memberCache = new Map<string, { data: Collection<string, GuildMember>; timestamp: number }>();

  private userClassificationService: UserClassificationService | null = null;
  private guildSettingsManager: GuildSettingsManager | null = null;
  private streamingReportEngine: IStreamingReportEngine | null = null;
  private discordStreamingService: DiscordStreamingService | null = null;
  private reportCommandIntegration: ReportCommandIntegration | null = null;

  constructor(services: CommandServices) {
    super(services);
  }

  /**
   * 슬래시 명령어 빌더 생성
   */
  buildSlashCommand(): SlashCommandBuilder {
    return new SlashCommandBuilder()
      .setName(this.metadata.name)
      .setDescription(this.metadata.description)
      .addStringOption((option) =>
        option.setName('role').setDescription('보고서를 생성할 역할 이름').setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('start_date')
          .setDescription('시작 날짜 (YYMMDD 형식, 예: 241201)')
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('end_date')
          .setDescription('종료 날짜 (YYMMDD 형식, 예: 241231)')
          .setRequired(true)
      )
      .addBooleanOption((option) =>
        option
          .setName('test_mode')
          .setDescription('테스트 모드 (리셋 시간 기록 안함)')
          .setRequired(false)
      )
      .addBooleanOption((option) =>
        option
          .setName('streaming')
          .setDescription('스트리밍 모드 (실시간 진행상황 표시)')
          .setRequired(false)
      ) as SlashCommandBuilder;
  }

  /**
   * 의존성 주입을 위한 메서드
   * @param userClassificationService - 사용자 분류 서비스
   */
  setUserClassificationService(userClassificationService: UserClassificationService): void {
    this.userClassificationService = userClassificationService;
  }

  /**
   * 의존성 주입을 위한 메서드
   * @param guildSettingsManager - 길드 설정 관리자
   */
  setGuildSettingsManager(guildSettingsManager: GuildSettingsManager): void {
    this.guildSettingsManager = guildSettingsManager;
  }

  /**
   * 의존성 주입을 위한 메서드
   * @param streamingReportEngine - 스트리밍 보고서 엔진
   */
  setStreamingReportEngine(streamingReportEngine: IStreamingReportEngine): void {
    this.streamingReportEngine = streamingReportEngine;
  }

  /**
   * 의존성 주입을 위한 메서드
   * @param discordStreamingService - 디스코드 스트리밍 서비스
   */
  setDiscordStreamingService(discordStreamingService: DiscordStreamingService): void {
    this.discordStreamingService = discordStreamingService;
  }

  /**
   * 의존성 주입을 위한 메서드
   * @param reportCommandIntegration - 보고서 명령어 통합 서비스
   */
  setReportCommandIntegration(reportCommandIntegration: ReportCommandIntegration): void {
    this.reportCommandIntegration = reportCommandIntegration;
  }

  /**
   * 보고서 명령어의 실제 실행 로직
   * @param interaction - 상호작용 객체
   * @param options - 실행 옵션
   */
  protected async executeCommand(
    interaction: ChatInputCommandInteraction,
    _options: CommandExecutionOptions
  ): Promise<CommandResult> {
    const startTime = Date.now();
    console.log(`[보고서] 명령어 시작: ${new Date().toISOString()}`);

    // Initialize resource manager for this operation
    const resourceManager = new ResourceManager();
    let commandOptions: ReportCommandOptions | undefined;

    try {
      // 명령어 옵션 가져오기
      commandOptions = this.getCommandOptions(interaction);

      // 서비스 의존성 확인
      if (!this.userClassificationService) {
        console.error(`[보고서] UserClassificationService가 초기화되지 않음`);
        throw new Error('UserClassificationService가 초기화되지 않았습니다.');
      }
      if (!this.guildSettingsManager) {
        console.error(`[보고서] GuildSettingsManager가 초기화되지 않음`);
        throw new Error('GuildSettingsManager가 초기화되지 않았습니다.');
      }
      if (!this.reportCommandIntegration) {
        console.error(`[보고서] ReportCommandIntegration이 초기화되지 않음`);
        throw new Error('ReportCommandIntegration이 초기화되지 않았습니다.');
      }
      
      // 스트리밍 모드 활성화시 추가 의존성 확인
      if (commandOptions.enableStreaming) {
        if (!this.streamingReportEngine || !this.discordStreamingService) {
          console.error(`[보고서] 스트리밍 서비스가 초기화되지 않음`);
          throw new Error('스트리밍 서비스가 초기화되지 않았습니다. 일반 모드를 사용하세요.');
        }
      }
      
      console.log(`[보고서] 서비스 의존성 확인 완료 (스트리밍: ${commandOptions.enableStreaming ? '활성화' : '비활성화'})`);
      console.log(`[보고서] 옵션 파싱 완료:`, {
        role: commandOptions.role,
        startDate: commandOptions.startDateStr,
        endDate: commandOptions.endDateStr,
        testMode: commandOptions.isTestMode,
      });

      // 캐시 확인 (스트리밍 모드에서는 캐시 비활성화)
      console.log(`[보고서] 캐시 확인 시작`);
      const cacheKey = this.generateCacheKey(commandOptions);
      const cached = !commandOptions.enableStreaming ? this.getCached<ReportGenerationResult>(cacheKey) : null;
      console.log(`[보고서] 캐시 키: ${cacheKey}, 캐시 존재: ${!!cached}, 스트리밍 모드: ${commandOptions.enableStreaming}`);

      if (cached && !commandOptions.isTestMode && !commandOptions.enableStreaming) {
        console.log(`[보고서] 캐시된 데이터 사용`);
        await this.sendCachedReport(interaction, cached);
        return {
          success: true,
          message: '캐시된 보고서를 전송했습니다.',
          data: cached,
        };
      }

      // 최신 데이터로 갱신
      console.log(`[보고서] 활동 데이터 저장 시작`);
      await this.activityTracker.saveActivityData();
      console.log(`[보고서] 활동 데이터 저장 완료`);

      // 역할 설정 가져오기
      console.log(`[보고서] 역할 설정 조회 시작: "${commandOptions.role}"`);
      console.log(`[보고서] 역할 이름 상세 정보:`, {
        original: interaction.options.getString('role'),
        cleaned: commandOptions.role,
        length: commandOptions.role.length,
        charCodes: Array.from(commandOptions.role).map((c) => c.charCodeAt(0)),
        hasSpaces: commandOptions.role.includes(' '),
        trimmed: commandOptions.role.trim(),
      });

      const roleConfigStartTime = Date.now();
      const roleConfig = await this.guildSettingsManager.getRoleActivityTime(
        interaction.guildId!,
        commandOptions.role
      );
      const roleConfigTime = Date.now() - roleConfigStartTime;

      console.log(`[보고서] 역할 설정 조회 완료: ${roleConfigTime}ms`);
      console.log(
        `[보고서] 조회된 설정:`,
        roleConfig
          ? {
              roleName: roleConfig.roleName || commandOptions.role,
              minHours: roleConfig.minHours,
              hasConfig: true,
            }
          : { hasConfig: false, result: null }
      );

      // 전체 역할 설정 목록도 확인 (디버깅용)
      try {
        console.log(`[보고서] 전체 역할 설정 조회 시작 (디버깅)`);
        const allRoleConfigs = await this.guildSettingsManager.getAllRoleActivityTimes(
          interaction.guildId!
        );
        console.log(
          `[보고서] 전체 역할 설정 목록:`,
          Object.entries(allRoleConfigs).map(([roleName, config]) => ({
            roleName: roleName,
            minHours: config.minHours,
          }))
        );
      } catch (debugError) {
        console.warn(`[보고서] 전체 역할 설정 조회 실패:`, debugError);
      }

      if (!this.validateRoleConfig(roleConfig, commandOptions.role, interaction)) {
        console.error(`[보고서] 역할 설정 검증 실패: ${commandOptions.role}`);
        return {
          success: false,
          message: `역할 "${commandOptions.role}"에 대한 설정을 찾을 수 없습니다.`,
        };
      }

      // ⚡ 최적화된 멤버 가져오기 (병렬 전략 사용)
      console.log(`[보고서] 최적화된 역할 멤버 조회 시작: ${commandOptions.role}`);
      const endMemberFetchTimer = this.performanceTracker.start('optimized_member_fetch');
      
      const reportPrepResult = await this.circuitBreaker.execute(async () => {
        return this.reportCommandIntegration!.prepareReportGeneration(
          interaction,
          commandOptions.role,
          new Date(), // startDate는 dateRange에서 사용됨
          new Date(), // endDate는 dateRange에서 사용됨
          {
            enableValidation: true,
            enableCacheWarming: true,
            forceRefresh: false
          }
        );
      });
      
      const memberFetchTime = endMemberFetchTimer();
      
      if (!reportPrepResult.success) {
        console.error(`[보고서] 최적화된 멤버 조회 실패: ${reportPrepResult.error}`);
        throw new Error(reportPrepResult.error || '멤버 조회에 실패했습니다.');
      }
      
      const roleMembers = reportPrepResult.roleMembers!;
      console.log(`[보고서] 최적화된 역할 멤버 조회 완료: ${roleMembers.size}명 (${memberFetchTime.toFixed(2)}ms)`);
      console.log(`[보고서] 사용된 전략: ${reportPrepResult.metrics.strategy}, 캐시 사용: ${reportPrepResult.metrics.cacheUsed}`);

      if (roleMembers.size === 0) {
        console.warn(`[보고서] 해당 역할 멤버 없음: ${commandOptions.role}`);
        return {
          success: false,
          message: `역할 "${commandOptions.role}"을 가진 멤버가 없습니다.`,
        };
      }

      // 날짜 범위 설정
      console.log(`[보고서] 날짜 범위 파싱 시작`);
      const dateValidation = await this.parseDateRange(commandOptions, roleConfig, interaction);
      console.log(`[보고서] 날짜 범위 파싱 완료:`, {
        isValid: dateValidation.isValid,
        dateRange: dateValidation.dateRange
          ? {
              start: dateValidation.dateRange.startDate.toISOString(),
              end: dateValidation.dateRange.endDate.toISOString(),
            }
          : null,
        error: dateValidation.error,
      });

      if (!dateValidation.isValid || !dateValidation.dateRange) {
        console.error(`[보고서] 날짜 범위 검증 실패:`, dateValidation.error);
        return {
          success: false,
          message: dateValidation.error || '날짜 범위 설정에 실패했습니다.',
        };
      }

      // 진행 상황 알림 (스트리밍 모드가 아닌 경우만)
      if (!commandOptions.enableStreaming) {
        console.log(`[보고서] 진행 상황 알림 전송`);
        await interaction.followUp({
          content:
            `📊 **보고서 생성 중...**\n\n` +
            `🎯 **역할:** ${commandOptions.role}\n` +
            `📅 **기간:** ${this.formatDateRange(dateValidation.dateRange)}\n` +
            `👥 **대상 멤버:** ${roleMembers.size}명\n` +
            `🧪 **테스트 모드:** ${commandOptions.isTestMode ? '활성화' : '비활성화'}\n` +
            `📡 **스트리밍 모드:** ${commandOptions.enableStreaming ? '활성화' : '비활성화'}\n\n` +
            `⏳ **예상 소요 시간:** ${this.estimateProcessingTime(roleMembers.size)}초`,
          flags: MessageFlags.Ephemeral,
        });
      }

      // 보고서 생성 방식 선택 (스트리밍 vs 일반)
      let reportEmbeds: any[];
      let reportGenTime: number;

      if (commandOptions.enableStreaming) {
        // 스트리밍 모드로 보고서 생성
        console.log(`[보고서] 스트리밍 보고서 생성 시작: ${new Date().toISOString()}`);
        const endReportGenTimer = this.performanceTracker.start('streaming_report_generation');

        const streamingResult = await this.generateStreamingReport(
          commandOptions.role,
          roleMembers,
          dateValidation.dateRange,
          interaction,
          resourceManager.getAbortSignal()
        );

        reportEmbeds = streamingResult.embeds;
        reportGenTime = endReportGenTimer();
        console.log(`[보고서] 스트리밍 보고서 생성 완료: ${reportGenTime.toFixed(2)}ms`);
      } else {
        // 일반 모드로 보고서 생성 (Performance Optimized)
        console.log(`[보고서] 일반 보고서 생성 시작: ${new Date().toISOString()}`);
        console.log(`[보고서] 생성 파라미터:`, {
          role: commandOptions.role,
          memberCount: roleMembers.size,
          startDate: dateValidation.dateRange.startDate.toISOString(),
          endDate: dateValidation.dateRange.endDate.toISOString(),
        });
        
        const endReportGenTimer = this.performanceTracker.start('report_generation');

        reportEmbeds = await this.circuitBreaker.execute(async () => {
          return this.generateReportOptimized(
            commandOptions.role,
            roleMembers,
            dateValidation.dateRange,
            resourceManager.getAbortSignal()
          );
        });

        reportGenTime = endReportGenTimer();
        console.log(
          `[보고서] 일반 보고서 생성 완료: ${new Date().toISOString()}, 소요시간: ${reportGenTime.toFixed(2)}ms`
        );
      }

      // 보고서 결과 생성
      const result: ReportGenerationResult = {
        role: commandOptions.role,
        dateRange: dateValidation.dateRange,
        reportEmbeds,
        executionTime: Date.now() - startTime,
        testMode: commandOptions.isTestMode,
      };

      // 캐시 저장 (테스트 모드가 아니고 스트리밍 모드가 아닌 경우만)
      if (!commandOptions.isTestMode && !commandOptions.enableStreaming) {
        this.setCached(cacheKey, result);
      }

      // 보고서 전송
      await this.sendReport(interaction, commandOptions, result);

      // 로그 기록 제거됨 - 음성 채널 활동과 관련 없는 보고서 생성 로그

      return {
        success: true,
        message: '활동 보고서가 성공적으로 생성되었습니다.',
        data: result,
      };
    } catch (error) {
      const errorDetails = {
        message: error instanceof Error ? error.message : '알 수 없는 오류',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
        executionTime: Date.now() - startTime,
        role: commandOptions?.role,
        memberCount: undefined as number | undefined,
        dateRange: undefined as any,
      };

      try {
        // 추가 컨텍스트 정보 수집
        if (commandOptions) {
          errorDetails.role = commandOptions.role;
          const roleMembers = await this.getRoleMembers(interaction.guild!, commandOptions.role);
          errorDetails.memberCount = roleMembers.size;
        }
      } catch (contextError) {
        console.warn('[보고서] 에러 컨텍스트 수집 실패:', contextError);
      }

      console.error('보고서 명령어 실행 오류:', errorDetails);

      const errorMessage =
        error instanceof Error ? error.message : '보고서 생성 중 오류가 발생했습니다.';

      // Discord에 상세한 에러 정보 전송
      await interaction.followUp({
        content:
          `❌ **보고서 생성 실패**\n\n` +
          `**오류:** ${errorMessage}\n` +
          `**시간:** ${errorDetails.timestamp}\n` +
          `**소요시간:** ${errorDetails.executionTime}ms\n` +
          `**역할:** ${errorDetails.role || 'N/A'}\n` +
          `**멤버수:** ${errorDetails.memberCount || 'N/A'}\n\n` +
          `콘솔 로그를 확인해주세요.`,
        flags: MessageFlags.Ephemeral,
      });

      return {
        success: false,
        message: errorMessage,
        error: error as Error,
      };
    } finally {
      // Always cleanup resources
      resourceManager.cleanup();
    }
  }

  /**
   * 명령어 옵션 가져오기
   * @param interaction - 상호작용 객체
   */
  private getCommandOptions(interaction: ChatInputCommandInteraction): ReportCommandOptions {
    const startDateStr = interaction.options.getString('start_date')?.trim();
    const endDateStr = interaction.options.getString('end_date')?.trim();

    if (!startDateStr || !endDateStr) {
      throw new Error('시작 날짜와 종료 날짜는 필수입니다.');
    }

    return {
      role: cleanRoleName(interaction.options.getString('role')!),
      startDateStr,
      endDateStr,
      isTestMode: interaction.options.getBoolean('test_mode') ?? false,
      enableStreaming: interaction.options.getBoolean('streaming') ?? false,
    };
  }

  /**
   * 역할 설정 유효성 검사
   * @param roleConfig - 역할 설정
   * @param role - 역할 이름
   * @param interaction - 상호작용 객체
   */
  private validateRoleConfig(
    roleConfig: any,
    role: string,
    interaction: ChatInputCommandInteraction
  ): boolean {
    if (!roleConfig) {
      interaction.followUp({
        content: `❌ 역할 "${role}"에 대한 설정을 찾을 수 없습니다. 먼저 /설정 명령어로 설정해주세요.`,
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }
    return true;
  }

  /**
   * Get cached members for a guild
   */
  private getCachedMembers(guildId: string): Collection<string, GuildMember> | null {
    const cached = this.memberCache.get(guildId);
    if (!cached) return null;
    
    const isExpired = Date.now() - cached.timestamp > this.MEMBER_CACHE_TTL;
    if (isExpired) {
      this.memberCache.delete(guildId);
      return null;
    }
    
    return cached.data;
  }
  
  /**
   * Cache members for a guild
   */
  private setCachedMembers(guildId: string, members: Collection<string, GuildMember>): void {
    this.memberCache.set(guildId, {
      data: members,
      timestamp: Date.now()
    });
  }
  
  /**
   * Fallback method for getting role members (non-optimized)
   */
  private async getRoleMembers(guild: NonNullable<ChatInputCommandInteraction['guild']>, role: string): Promise<Collection<string, GuildMember>> {
    // Use cached members if available
    const cachedMembers = this.getCachedMembers(guild.id);
    if (cachedMembers) {
      return await this.filterMembersByRole(cachedMembers, role, new AbortController().signal);
    }
    
    // Fallback to basic fetch
    const members = await guild.members.fetch({ limit: 1000 });
    this.setCachedMembers(guild.id, members);
    
    return await this.filterMembersByRole(members, role, new AbortController().signal);
  }

  /**
   * 역할 멤버 가져오기
   * @param guild - 길드
   * @param role - 역할 이름
   */
  private async getRoleMembersOptimized(
    guild: NonNullable<ChatInputCommandInteraction['guild']>,
    role: string,
    abortSignal: AbortSignal
  ): Promise<Collection<string, GuildMember>> {
    const startTime = Date.now();
    console.log(`[보고서] getRoleMembers 시작: ${new Date().toISOString()}`);
    console.log(`[보고서] 대상 역할: "${role}"`);
    console.log(`[보고서] 길드 ID: ${guild.id}`);
    console.log(`[보고서] 현재 캐시된 멤버 수: ${guild.members.cache.size}`);

    // Check for cached members first
    const cachedMembers = this.getCachedMembers(guild.id);
    if (cachedMembers) {
      console.log(`[보고서] 캐시된 멤버 데이터 사용: ${cachedMembers.size}명`);
      return await this.filterMembersByRole(cachedMembers, role, abortSignal);
    }

    let members: Collection<string, GuildMember>;

    // 단계별 fetch 전략
    try {
      // 1단계: 캐시 충분성 확인 (작은 서버는 캐시만으로도 충분할 수 있음)
      if (
        guild.members.cache.size > 0 &&
        guild.memberCount &&
        guild.members.cache.size >= guild.memberCount * 0.8
      ) {
        console.log(
          `[보고서] 캐시 충분성 확인: ${guild.members.cache.size}/${guild.memberCount} (${Math.round((guild.members.cache.size / guild.memberCount) * 100)}%)`
        );
        members = guild.members.cache;
        console.log(`[보고서] 캐시된 데이터로 충분 - fetch 생략`);
      } else {
        // 2단계: 전체 fetch 시도 (GuildMembers Intent 필요)
        const fetchStartTime = Date.now();
        console.log(`[보고서] 전체 멤버 fetch 시도 - ${this.FETCH_TIMEOUT/1000}초 타임아웃 설정`);

        const fetchPromise = Promise.race([
          guild.members.fetch({ limit: this.MAX_MEMBERS_FETCH }),
          new Promise<never>((_, reject) => {
            const timeoutId = setTimeout(
              () => reject(new Error(`Member fetch timeout after ${this.FETCH_TIMEOUT/1000} seconds`)), 
              this.FETCH_TIMEOUT
            );
            
            // Cleanup timeout if aborted
            abortSignal.addEventListener('abort', () => {
              clearTimeout(timeoutId);
              reject(new Error('Operation aborted'));
            });
          }),
        ]);

        try {
          if (abortSignal.aborted) {
            throw new Error('Operation aborted');
          }
          
          members = await fetchPromise;
          const fetchEndTime = Date.now();
          console.log(
            `[보고서] 전체 fetch 성공: ${fetchEndTime - fetchStartTime}ms, 총 멤버 수: ${members.size}`
          );
          
          // Cache the fetched members
          this.setCachedMembers(guild.id, members);
        } catch (fullFetchError) {
          console.warn(`[보고서] 전체 fetch 실패, 부분 fetch 시도:`, fullFetchError);

          // 3단계: 부분 fetch 시도 (제한된 수)
          try {
            if (abortSignal.aborted) {
              throw new Error('Operation aborted');
            }
            
            const partialFetchPromise = Promise.race([
              guild.members.fetch({ limit: Math.min(1000, this.MAX_MEMBERS_FETCH) }),
              new Promise<never>((_, reject) => {
                const timeoutId = setTimeout(
                  () => reject(new Error('Partial fetch timeout after 10 seconds')), 
                  10000
                );
                
                abortSignal.addEventListener('abort', () => {
                  clearTimeout(timeoutId);
                  reject(new Error('Operation aborted'));
                });
              }),
            ]);
            
            members = await partialFetchPromise;
            console.log(`[보고서] 부분 fetch 성공: ${members.size}명`);
            
            // Cache partial results
            this.setCachedMembers(guild.id, members);
          } catch (partialFetchError) {
            console.warn(`[보고서] 부분 fetch도 실패, 캐시 사용:`, partialFetchError);

            // 4단계: 캐시 사용 (최후의 수단)
            if (guild.members.cache.size > 0) {
              members = guild.members.cache;
              console.log(`[보고서] 캐시된 멤버 사용: ${members.size}명 (불완전할 수 있음)`);
            } else {
              throw new Error(
                `멤버 정보를 가져올 수 없습니다. GuildMembers Intent가 활성화되어 있는지 확인하세요.`
              );
            }
          }
        }
      }
    } catch (error) {
      console.error(`[보고서] 멤버 조회 완전 실패:`, error);
      throw error;
    }

    return await this.filterMembersByRole(members, role, abortSignal);
  }
  
  /**
   * Filter members by role (optimized for performance)
   */
  private async filterMembersByRole(
    members: Collection<string, GuildMember>,
    role: string,
    abortSignal: AbortSignal
  ): Promise<Collection<string, GuildMember>> {
    const filterStartTime = Date.now();
    console.log(`[보고서] 역할 필터링 시작: "${role}"`);

    const filteredMembers = new Collection<string, GuildMember>();
    const batchSize = 100; // Process in batches to avoid blocking
    const memberArray = Array.from(members.values());
    
    for (let i = 0; i < memberArray.length; i += batchSize) {
      if (abortSignal.aborted) {
        throw new Error('Operation aborted during filtering');
      }
      
      const batch = memberArray.slice(i, i + batchSize);
      
      for (const member of batch) {
        try {
          // Use more efficient role checking
          if (member.roles.cache.find(r => r.name === role)) {
            filteredMembers.set(member.id, member);
          }
        } catch (roleError) {
          console.warn(`[보고서] 멤버 ${member.id} 역할 확인 실패:`, roleError);
        }
      }
      
      // Yield to event loop between batches
      if (i + batchSize < memberArray.length) {
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    }

    const filterEndTime = Date.now();
    console.log(`[보고서] 역할 필터링 완료: ${filterEndTime - filterStartTime}ms`);
    console.log(`[보고서] 필터링 결과: ${filteredMembers.size}명 (전체: ${members.size}명 중)`);

    return filteredMembers;
  }

  /**
   * 날짜 형식 검증 (Performance Optimized)
   * @param dateStr - 날짜 문자열
   * @param label - 레이블
   */
  private validateDateFormat(dateStr: string, label: string): { isValid: boolean; error?: string } {
    // Optimized regex with pre-compiled pattern
    const YYMMDD_PATTERN = /^\d{6}$/;
    
    if (!YYMMDD_PATTERN.test(dateStr)) {
      return {
        isValid: false,
        error: `${label} 날짜 형식이 올바르지 않습니다. '${dateStr}'는 'YYMMDD' 형식이어야 합니다. (예: 250413)`,
      };
    }
    
    // Additional validation for month and day ranges
    const month = parseInt(dateStr.substring(2, 4), 10);
    const day = parseInt(dateStr.substring(4, 6), 10);
    
    if (month < 1 || month > 12) {
      return {
        isValid: false,
        error: `${label} 날짜의 월이 유효하지 않습니다. (${month})`
      };
    }
    
    if (day < 1 || day > 31) {
      return {
        isValid: false,
        error: `${label} 날짜의 일이 유효하지 않습니다. (${day})`
      };
    }
    
    return { isValid: true };
  }

  /**
   * 날짜 범위 파싱
   * @param options - 명령어 옵션
   * @param roleConfig - 역할 설정
   * @param interaction - 상호작용 객체
   */
  private async parseDateRange(
    options: ReportCommandOptions,
    _roleConfig: any,
    _interaction: ChatInputCommandInteraction
  ): Promise<DateValidationResult> {
    const { startDateStr, endDateStr } = options;

    // 날짜 형식 검증
    const startValidation = this.validateDateFormat(startDateStr, '시작');
    if (!startValidation.isValid) {
      return startValidation;
    }

    const endValidation = this.validateDateFormat(endDateStr, '종료');
    if (!endValidation.isValid) {
      return endValidation;
    }

    try {
      // 날짜 파싱
      const dateRange = this.parseYYMMDDDates(startDateStr, endDateStr);
      console.log('파싱된 날짜:', dateRange.startDate, dateRange.endDate);

      // 날짜 범위 유효성 검사
      const rangeValidation = this.validateDateRange(dateRange);
      if (!rangeValidation.isValid) {
        return rangeValidation;
      }

      return {
        isValid: true,
        dateRange,
      };
    } catch (error) {
      console.error('날짜 파싱 오류:', error);
      return {
        isValid: false,
        error: `날짜 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
      };
    }
  }

  /**
   * YYMMDD 형식 날짜 파싱
   * @param startDateStr - 시작 날짜 문자열
   * @param endDateStr - 종료 날짜 문자열
   */
  private parseYYMMDDDates(startDateStr: string, endDateStr: string): DateRange {
    // Pre-calculate commonly used values
    const currentYear = new Date().getFullYear();
    const century = Math.floor(currentYear / 100) * 100;
    
    // Parse start date components efficiently
    const startYY = parseInt(startDateStr.substring(0, 2), 10);
    const startMM = parseInt(startDateStr.substring(2, 4), 10);
    const startDD = parseInt(startDateStr.substring(4, 6), 10);
    
    // Parse end date components efficiently
    const endYY = parseInt(endDateStr.substring(0, 2), 10);
    const endMM = parseInt(endDateStr.substring(2, 4), 10);
    const endDD = parseInt(endDateStr.substring(4, 6), 10);
    
    // Smart year calculation (assume current century for most cases)
    const startYear = startYY < 50 ? century + startYY : century - 100 + startYY;
    const endYear = endYY < 50 ? century + endYY : century - 100 + endYY;
    
    // Create dates with proper time boundaries
    const startDate = new Date(startYear, startMM - 1, startDD, 0, 0, 0, 0);
    const endDate = new Date(endYear, endMM - 1, endDD, 23, 59, 59, 999);

    // Fast validity check using getTime()
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    
    if (isNaN(startTime)) {
      throw new Error(`유효하지 않은 시작 날짜: ${startDateStr} (연도: ${startYear}, 월: ${startMM}, 일: ${startDD})`);
    }

    if (isNaN(endTime)) {
      throw new Error(`유효하지 않은 종료 날짜: ${endDateStr} (연도: ${endYear}, 월: ${endMM}, 일: ${endDD})`);
    }
    
    // Verify the date components weren't adjusted by Date constructor
    if (startDate.getFullYear() !== startYear || 
        startDate.getMonth() !== startMM - 1 || 
        startDate.getDate() !== startDD) {
      throw new Error(`유효하지 않은 시작 날짜: ${startDateStr}`);
    }
    
    if (endDate.getFullYear() !== endYear || 
        endDate.getMonth() !== endMM - 1 || 
        endDate.getDate() !== endDD) {
      throw new Error(`유효하지 않은 종료 날짜: ${endDateStr}`);
    }

    return { startDate, endDate };
  }

  /**
   * 날짜 범위 유효성 검사
   * @param dateRange - 날짜 범위
   */
  private validateDateRange(dateRange: DateRange): DateValidationResult {
    const { startDate, endDate } = dateRange;

    // 시작 날짜가 종료 날짜보다 늦은지 확인
    if (startDate > endDate) {
      return {
        isValid: false,
        error: '시작 날짜가 종료 날짜보다 늦습니다.',
      };
    }

    // 날짜 범위 제한 (최대 1년)
    const maxRange = 365 * 24 * 60 * 60 * 1000; // 1년
    if (endDate.getTime() - startDate.getTime() > maxRange) {
      return {
        isValid: false,
        error: '날짜 범위는 최대 1년까지 가능합니다.',
      };
    }

    // 미래 날짜 확인
    const now = new Date();
    if (startDate > now) {
      return {
        isValid: false,
        error: '시작 날짜가 현재 날짜보다 미래입니다.',
      };
    }

    return { isValid: true };
  }

  /**
   * 스트리밍 보고서 생성
   * @param role - 역할 이름
   * @param roleMembers - 역할 멤버
   * @param dateRange - 날짜 범위
   * @param interaction - Discord 상호작용
   * @param abortSignal - 중단 신호
   */
  private async generateStreamingReport(
    role: string,
    roleMembers: Collection<string, GuildMember>,
    dateRange: DateRange,
    interaction: ChatInputCommandInteraction,
    abortSignal: AbortSignal
  ): Promise<{ embeds: any[] }> {
    const startTime = Date.now();
    console.log(`[보고서-스트리밍] 스트리밍 보고서 생성 시작`);

    if (!this.streamingReportEngine || !this.discordStreamingService) {
      throw new Error('스트리밍 서비스가 초기화되지 않았습니다.');
    }

    try {
      // Discord 스트리밍 옵션 설정
      const discordOptions = {
        interaction,
        ephemeral: true,
        updateThrottle: 2000, // 2초마다 업데이트
        maxEmbedsPerMessage: 10,
        progressTemplate: {
          title: '📊 실시간 보고서 생성 중...',
          color: 0x00AE86,
          footer: '실시간 업데이트 • 언제든지 취소 가능'
        }
      };

      // 스트리밍 보고서 엔진 이벤트 리스너 설정
      const handleProgress = (progress: any) => {
        console.log(`[보고서-스트리밍] 진행률: ${progress.percentage}% - ${progress.message}`);
      };

      const handlePartialResult = (partialResult: any) => {
        console.log(`[보고서-스트리밍] 부분 결과 수신: 배치 ${partialResult.batchInfo?.batchNumber}/${partialResult.batchInfo?.totalBatches}`);
      };

      const handleError = (error: any) => {
        console.error(`[보고서-스트리밍] 스트리밍 오류:`, error);
      };

      // 이벤트 리스너 등록
      this.streamingReportEngine.on('progress', handleProgress);
      this.streamingReportEngine.on('partial-result', handlePartialResult);
      this.streamingReportEngine.on('error', handleError);

      // Discord 스트리밍 서비스와 연동하여 실시간 업데이트 설정
      const handleProgressUpdate = async (progress: StreamingProgress) => {
        try {
          await this.discordStreamingService!.updateProgress(
            'streaming-report',
            progress,
            discordOptions
          );
        } catch (updateError) {
          console.warn(`[보고서-스트리밍] 진행률 업데이트 실패:`, updateError);
        }
      };

      const handlePartialResultUpdate = async (partialResult: any) => {
        try {
          await this.discordStreamingService!.sendPartialResult(
            'streaming-report',
            partialResult,
            discordOptions
          );
        } catch (updateError) {
          console.warn(`[보고서-스트리밍] 부분 결과 업데이트 실패:`, updateError);
        }
      };

      this.streamingReportEngine.on('progress', handleProgressUpdate);
      this.streamingReportEngine.on('partial-result', handlePartialResultUpdate);

      try {
        // Discord 스트리밍 세션 초기화
        await this.discordStreamingService.initializeStreamingSession(
          interaction,
          'streaming-report',
          discordOptions
        );

        // 스트리밍 보고서 생성 실행
        const streamingResult = await this.streamingReportEngine.generateReport(
          role,
          roleMembers,
          dateRange,
          {
            batchSize: 30, // 스트리밍용 작은 배치 크기
            enablePartialStreaming: true,
            enableErrorRecovery: true,
            maxRetries: 2,
            progressUpdateInterval: 1500,
            memoryCleanupThreshold: 150 // MB
          },
          discordOptions
        );

        // 최종 결과 전송
        await this.discordStreamingService.sendFinalResult(
          'streaming-report',
          streamingResult,
          discordOptions
        );

        console.log(`[보고서-스트리밍] 스트리밍 완료: ${Date.now() - startTime}ms`);

        return {
          embeds: streamingResult.embeds
        };

      } catch (streamingError) {
        console.error(`[보고서-스트리밍] 스트리밍 실행 오류:`, streamingError);

        // 오류 처리
        await this.discordStreamingService.handleStreamingError(
          'streaming-report',
          {
            code: 'STREAMING_FAILED',
            message: streamingError instanceof Error ? streamingError.message : '스트리밍 오류',
            stage: 'error' as any,
            recoverable: false,
            timestamp: new Date()
          },
          discordOptions
        );

        throw streamingError;
      } finally {
        // 이벤트 리스너 정리
        this.streamingReportEngine.off('progress', handleProgress);
        this.streamingReportEngine.off('partial-result', handlePartialResult);
        this.streamingReportEngine.off('error', handleError);
        this.streamingReportEngine.off('progress', handleProgressUpdate);
        this.streamingReportEngine.off('partial-result', handlePartialResultUpdate);
      }

    } catch (error) {
      console.error(`[보고서-스트리밍] 스트리밍 보고서 생성 실패:`, error);
      throw error;
    }
  }

  /**
   * 보고서 생성
   * @param role - 역할 이름
   * @param roleMembers - 역할 멤버
   * @param dateRange - 날짜 범위
   */
  private async generateReportOptimized(
    role: string,
    roleMembers: Collection<string, GuildMember>,
    dateRange: DateRange,
    abortSignal: AbortSignal
  ): Promise<any[]> {
    const startTime = Date.now();
    console.log(`[보고서] generateReport 시작: ${new Date().toISOString()}`);
    console.log(`[보고서] 역할: "${role}", 멤버 수: ${roleMembers.size}`);

    const { startDate, endDate } = dateRange;
    console.log(`[보고서] 날짜 범위: ${startDate.toISOString()} ~ ${endDate.toISOString()}`);

    // Check if operation was aborted
    if (abortSignal.aborted) {
      throw new Error('Report generation aborted');
    }
    
    // 사용자 분류 서비스로 사용자 분류 (날짜 범위 기준)
    const classificationStartTime = Date.now();
    console.log(`[보고서] UserClassificationService.classifyUsersByDateRange 호출 시작`);
    
    const classificationResult = await this.userClassificationService.classifyUsersByDateRange(
      role,
      roleMembers,
      startDate,
      endDate
    );
    
    const classificationEndTime = Date.now();
    console.log(
      `[보고서] UserClassificationService.classifyUsersByDateRange 완료: ${classificationEndTime - classificationStartTime}ms`
    );
    
    // Check again after async operation
    if (abortSignal.aborted) {
      throw new Error('Report generation aborted during classification');
    }

    const { activeUsers, inactiveUsers, afkUsers, minHours, reportCycle } = classificationResult;
    console.log(
      `[보고서] 분류 결과 - 활성: ${activeUsers.length}명, 비활성: ${inactiveUsers.length}명, AFK: ${afkUsers.length}명`
    );
    console.log(`[보고서] 최소 활동 시간: ${minHours}시간, 보고 주기: ${reportCycle || 'N/A'}`);

    // 보고서 임베드 생성
    const embedStartTime = Date.now();
    console.log(`[보고서] EmbedFactory.createActivityEmbeds 호출 시작`);
    const embeds = EmbedFactory.createActivityEmbeds({
      role,
      activeUsers,
      inactiveUsers,
      afkUsers,
      startDate,
      endDate,
      minHours,
      reportCycle: reportCycle ? parseInt(reportCycle) : null,
      title: '활동 보고서',
    });
    const embedEndTime = Date.now();
    console.log(
      `[보고서] EmbedFactory.createActivityEmbeds 완료: ${embedEndTime - embedStartTime}ms`
    );
    console.log(`[보고서] 생성된 임베드 수: ${embeds.length}`);
    console.log(`[보고서] generateReport 전체 소요시간: ${Date.now() - startTime}ms`);

    return embeds;
  }

  /**
   * 보고서 전송
   * @param interaction - 상호작용 객체
   * @param options - 명령어 옵션
   * @param result - 보고서 결과
   */
  private async sendReport(
    interaction: ChatInputCommandInteraction,
    options: ReportCommandOptions,
    result: ReportGenerationResult
  ): Promise<void> {
    if (options.isTestMode) {
      // 테스트인 경우 서버 내 Embed로 전송
      await interaction.followUp({
        content:
          `⚠️ **테스트 모드로 실행됩니다.**\n\n` +
          `📊 **실행 시간:** ${result.executionTime}ms\n` +
          `🔄 **리셋 시간이 기록되지 않습니다.**`,
        embeds: result.reportEmbeds,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      // 고정 채널에 전송
      const logChannelId = process.env.REPORT_CHANNEL_ID;
      if (logChannelId) {
        try {
          const logChannel = (await interaction.client.channels.fetch(logChannelId)) as TextChannel;
          if (logChannel?.isTextBased()) {
            await logChannel.send({
              content:
                `📊 **${options.role} 역할 활동 보고서**\n\n` +
                `📅 **기간:** ${this.formatDateRange(result.dateRange)}\n` +
                `⏱️ **생성 시간:** ${result.executionTime}ms`,
              embeds: result.reportEmbeds,
            });
          }
        } catch (error) {
          console.error('로그 채널 전송 실패:', error);
        }
      }

      // 성공 메시지
      let successMessage = `✅ **보고서가 성공적으로 생성되었습니다!**\n\n`;
      successMessage += `📊 **역할:** ${options.role}\n`;
      successMessage += `📅 **기간:** ${this.formatDateRange(result.dateRange)}\n`;
      successMessage += `⏱️ **생성 시간:** ${result.executionTime}ms\n`;

      if (logChannelId) {
        successMessage += `📢 **전송 채널:** <#${logChannelId}>\n`;
      }

      await interaction.followUp({
        content: successMessage,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * 캐시된 보고서 전송
   * @param interaction - 상호작용 객체
   * @param cached - 캐시된 결과
   */
  private async sendCachedReport(
    interaction: ChatInputCommandInteraction,
    cached: ReportGenerationResult
  ): Promise<void> {
    await interaction.followUp({
      content:
        `📋 **캐시된 보고서를 사용합니다.**\n\n` +
        `📊 **역할:** ${cached.role}\n` +
        `📅 **기간:** ${this.formatDateRange(cached.dateRange)}\n` +
        `⏱️ **원본 생성 시간:** ${cached.executionTime}ms\n` +
        `🔄 **캐시 사용으로 즉시 전송됩니다.**`,
      flags: MessageFlags.Ephemeral,
    });
  }

  /**
   * 캐시 키 생성
   * @param options - 명령어 옵션
   */
  private generateCacheKey(options: ReportCommandOptions): string {
    const dateKey = `${options.startDateStr}_${options.endDateStr}`;
    const modeKey = options.enableStreaming ? 'streaming' : 'normal';
    return `report_${options.role}_${dateKey}_${modeKey}`;
  }

  /**
   * 날짜 범위 포맷팅
   * @param dateRange - 날짜 범위
   */
  private formatDateRange(dateRange: DateRange): string {
    const startStr = dateRange.startDate.toLocaleDateString('ko-KR');
    const endStr = dateRange.endDate.toLocaleDateString('ko-KR');
    return `${startStr} ~ ${endStr}`;
  }

  /**
   * 처리 시간 추정
   * @param memberCount - 멤버 수
   */
  private estimateProcessingTime(memberCount: number): number {
    return Math.max(5, Math.ceil(memberCount / 10)); // 멤버 10명당 1초, 최소 5초
  }

  /**
   * 명령어 도움말 생성
   */
  public getHelp(): string {
    return `**${this.metadata.name}** - ${this.metadata.description}

**사용법:**
\`${this.metadata.usage}\`

**설명:**
• 지정된 역할의 활동 보고서를 생성합니다.
• 날짜 범위를 지정하여 특정 기간의 보고서를 생성할 수 있습니다.
• 테스트 모드에서는 리셋 시간이 기록되지 않습니다.
• 관리자 권한이 필요합니다.

**옵션:**
• \`role\`: 보고서를 생성할 역할 이름 (필수)
• \`start_date\`: 시작 날짜 (YYMMDD 형식, 필수)
• \`end_date\`: 종료 날짜 (YYMMDD 형식, 필수)
• \`test_mode\`: 테스트 모드 (선택사항)
• \`streaming\`: 스트리밍 모드 - 실시간 진행상황 표시 (선택사항)

**예시:**
${this.metadata.examples?.map((ex) => `\`${ex}\``).join('\n')}

**권한:** 관리자 전용
**쿨다운:** ${this.metadata.cooldown}초`;
  }
}
