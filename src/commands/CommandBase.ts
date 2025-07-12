// src/commands/CommandBase.ts - 모든 명령어의 기본 기능 제공
import { Client, ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { ActivityTracker } from '../services/activityTracker.js';
import { DatabaseManager } from '../services/DatabaseManager.js';
import { CalendarLogService } from '../services/calendarLogService.js';
import { LogService } from '../services/logService.js';

// 서비스 컨테이너 인터페이스
export interface CommandServices {
  activityTracker: ActivityTracker;
  dbManager: DatabaseManager;
  calendarLogService: CalendarLogService;
  client: Client;
  logService?: LogService;
}

// 명령어 메타데이터 인터페이스
export interface CommandMetadata {
  name: string;
  description: string;
  category: string;
  permissions?: string[];
  cooldown?: number;
  adminOnly?: boolean;
  guildOnly?: boolean;
  devOnly?: boolean;
  usage?: string;
  examples?: string[];
  aliases?: string[];
}

// 명령어 실행 결과
export interface CommandResult {
  success: boolean;
  message?: string;
  data?: any;
  error?: Error;
  executionTime?: number;
}

// 명령어 실행 옵션
export interface CommandExecutionOptions {
  skipPermissionCheck?: boolean;
  skipCooldownCheck?: boolean;
  silent?: boolean;
  logExecution?: boolean;
  timeout?: number;
}

// 명령어 통계
export interface CommandStatistics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
  lastExecuted: number;
  errorCount: Record<string, number>;
}

// 명령어 기본 설정
export interface CommandConfig {
  enabled: boolean;
  maxExecutionsPerMinute: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  retryAttempts: number;
  retryDelay: number;
  enableStatistics: boolean;
  enableCaching: boolean;
  cacheTimeout: number;
  enableDetailedStats?: boolean;
}

export abstract class CommandBase {
  protected activityTracker: ActivityTracker;
  protected dbManager: DatabaseManager;
  protected calendarLogService: CalendarLogService;
  protected client: Client;
  protected logService?: LogService;
  
  // 명령어 메타데이터
  public abstract readonly metadata: CommandMetadata;
  
  // 명령어 설정
  protected config: CommandConfig;
  
  // 통계 및 성능 추적
  private statistics: CommandStatistics;
  private executionHistory: Map<string, number[]>;
  private lastExecutions: Map<string, number>;
  
  // 캐시 시스템
  private cache: Map<string, { data: any; timestamp: number }>;

  /**
   * 명령어 기본 클래스 생성자
   * @param services - 필요한 서비스 객체들
   * @param config - 명령어 설정
   */
  constructor(services: CommandServices, config: Partial<CommandConfig> = {}) {
    // 서비스 초기화
    this.activityTracker = services.activityTracker;
    this.dbManager = services.dbManager;
    this.calendarLogService = services.calendarLogService;
    this.client = services.client;
    this.logService = services.logService || undefined;
    
    // 설정 초기화
    this.config = {
      enabled: true,
      maxExecutionsPerMinute: 10,
      logLevel: 'info',
      retryAttempts: 3,
      retryDelay: 1000,
      enableStatistics: true,
      enableCaching: true,
      cacheTimeout: 300000, // 5분
      ...config
    };
    
    // 통계 초기화
    this.statistics = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageExecutionTime: 0,
      lastExecuted: 0,
      errorCount: {}
    };
    
    this.executionHistory = new Map();
    this.lastExecutions = new Map();
    this.cache = new Map();
    
    // 캐시 정리 타이머
    if (this.config.enableCaching) {
      setInterval(() => this.cleanupCache(), this.config.cacheTimeout);
    }
  }

  /**
   * 슬래시 명령어 빌더 생성 (자식 클래스에서 구현)
   */
  abstract buildSlashCommand(): SlashCommandBuilder;

  /**
   * 명령어 실행을 위한 기본 메서드
   * @param interaction - 상호작용 객체
   * @param options - 실행 옵션
   */
  async execute(interaction: ChatInputCommandInteraction, options: CommandExecutionOptions = {}): Promise<CommandResult> {
    const startTime = Date.now();
    
    // 명령어 비활성화 확인
    if (!this.config.enabled) {
      return {
        success: false,
        message: '이 명령어는 현재 비활성화되어 있습니다.',
        executionTime: Date.now() - startTime
      };
    }
    
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // 권한 검사
      if (!options.skipPermissionCheck && !await this.checkPermissions(interaction)) {
        return {
          success: false,
          message: '이 명령어를 실행할 권한이 없습니다.',
          executionTime: Date.now() - startTime
        };
      }
      
      // 쿨다운 검사
      if (!options.skipCooldownCheck && !this.checkCooldown(interaction)) {
        return {
          success: false,
          message: '명령어 쿨다운이 아직 남아있습니다.',
          executionTime: Date.now() - startTime
        };
      }
      
      // 실행 빈도 제한 확인
      if (!this.checkRateLimit(interaction)) {
        return {
          success: false,
          message: '명령어 실행 빈도 제한에 도달했습니다.',
          executionTime: Date.now() - startTime
        };
      }
      
      // 실제 명령어 실행
      const result = await this.executeWithRetry(interaction, options);
      
      // 통계 업데이트
      if (this.config.enableStatistics) {
        this.updateStatistics(result, Date.now() - startTime);
      }
      
      // 로그 기록
      if (options.logExecution !== false) {
        this.logExecution(interaction, result, Date.now() - startTime);
      }
      
      return {
        ...result,
        executionTime: Date.now() - startTime
      };
      
    } catch (error) {
      console.error(`${this.constructor.name} 명령어 실행 오류:`, error);
      
      // 에러 응답
      await this.sendErrorResponse(interaction, error as Error);
      
      const result: CommandResult = {
        success: false,
        error: error as Error,
        executionTime: Date.now() - startTime
      };
      
      // 통계 업데이트
      if (this.config.enableStatistics) {
        this.updateStatistics(result, Date.now() - startTime);
      }
      
      return result;
    }
  }

  /**
   * 실제 명령어 실행 로직 (자식 클래스에서 구현해야 함)
   * @param interaction - 상호작용 객체
   * @param options - 실행 옵션
   */
  protected abstract executeCommand(interaction: ChatInputCommandInteraction, options: CommandExecutionOptions): Promise<CommandResult>;

  /**
   * 재시도 로직을 포함한 명령어 실행
   * @param interaction - 상호작용 객체
   * @param options - 실행 옵션
   */
  private async executeWithRetry(interaction: ChatInputCommandInteraction, options: CommandExecutionOptions): Promise<CommandResult> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      try {
        return await this.executeCommand(interaction, options);
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < this.config.retryAttempts) {
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * (attempt + 1)));
          console.warn(`${this.constructor.name} 명령어 재시도 ${attempt + 1}/${this.config.retryAttempts}:`, error);
        }
      }
    }
    
    throw lastError;
  }

  /**
   * 권한 검사
   * @param interaction - 상호작용 객체
   */
  protected async checkPermissions(interaction: ChatInputCommandInteraction): Promise<boolean> {
    try {
      // 기본 권한 검사 로직
      if (this.metadata.adminOnly && interaction.member?.permissions && 
          typeof interaction.member.permissions !== 'string' && 
          !interaction.member.permissions.has('Administrator')) {
        return false;
      }
      
      if (this.metadata.guildOnly && !interaction.guild) {
        return false;
      }
      
      if (this.metadata.devOnly) {
        // 개발자 ID 확인 (실제 구현에서는 환경 변수나 설정에서 가져오기)
        const devIds = process.env.DEV_IDS?.split(',') || [];
        return devIds.includes(interaction.user.id);
      }
      
      // 특정 권한 확인
      if (this.metadata.permissions && interaction.member?.permissions && 
          typeof interaction.member.permissions !== 'string') {
        for (const permission of this.metadata.permissions) {
          if (!interaction.member.permissions.has(permission as any)) {
            return false;
          }
        }
      }
      
      return true;
    } catch (error) {
      console.error('권한 검사 오류:', error);
      return false;
    }
  }

  /**
   * 쿨다운 검사
   * @param interaction - 상호작용 객체
   */
  protected checkCooldown(interaction: ChatInputCommandInteraction): boolean {
    if (!this.metadata.cooldown) return true;
    
    const now = Date.now();
    const cooldownAmount = this.metadata.cooldown * 1000;
    const lastExecution = this.lastExecutions.get(interaction.user.id);
    
    if (lastExecution && now - lastExecution < cooldownAmount) {
      return false;
    }
    
    this.lastExecutions.set(interaction.user.id, now);
    return true;
  }

  /**
   * 실행 빈도 제한 확인
   * @param interaction - 상호작용 객체
   */
  private checkRateLimit(interaction: ChatInputCommandInteraction): boolean {
    const now = Date.now();
    const userId = interaction.user.id;
    const minute = 60 * 1000;
    
    if (!this.executionHistory.has(userId)) {
      this.executionHistory.set(userId, []);
    }
    
    const history = this.executionHistory.get(userId)!;
    
    // 1분 이내의 실행 기록만 유지
    const recentExecutions = history.filter(time => now - time < minute);
    
    if (recentExecutions.length >= this.config.maxExecutionsPerMinute) {
      return false;
    }
    
    recentExecutions.push(now);
    this.executionHistory.set(userId, recentExecutions);
    
    return true;
  }

  /**
   * 오류 응답 전송
   * @param interaction - 상호작용 객체
   * @param error - 발생한 오류
   */
  protected async sendErrorResponse(interaction: ChatInputCommandInteraction, error: Error): Promise<void> {
    const errorMessage = '명령어 실행 중 오류가 발생했습니다.';
    
    // 오류 로깅
    console.error('Command execution error:', error.message, error.stack);
    
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.followUp({
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (responseError) {
      console.error('오류 응답 전송 실패:', responseError);
    }
  }

  /**
   * 통계 업데이트
   * @param result - 실행 결과
   * @param executionTime - 실행 시간
   */
  private updateStatistics(result: CommandResult, executionTime: number): void {
    this.statistics.totalExecutions++;
    this.statistics.lastExecuted = Date.now();
    
    if (result.success) {
      this.statistics.successfulExecutions++;
    } else {
      this.statistics.failedExecutions++;
      
      if (result.error) {
        const errorName = result.error.name || 'Unknown';
        this.statistics.errorCount[errorName] = (this.statistics.errorCount[errorName] || 0) + 1;
      }
    }
    
    // 평균 실행 시간 계산
    const totalTime = this.statistics.averageExecutionTime * (this.statistics.totalExecutions - 1) + executionTime;
    this.statistics.averageExecutionTime = totalTime / this.statistics.totalExecutions;
  }

  /**
   * 실행 로그 기록
   * @param interaction - 상호작용 객체
   * @param result - 실행 결과
   * @param executionTime - 실행 시간
   */
  private logExecution(interaction: ChatInputCommandInteraction, result: CommandResult, executionTime: number): void {
    const logData = {
      command: this.metadata.name,
      user: interaction.user.tag,
      userId: interaction.user.id,
      guild: interaction.guild?.name || 'DM',
      success: result.success,
      executionTime,
      timestamp: new Date().toISOString()
    };
    
    if (this.config.logLevel === 'debug' || (this.config.logLevel === 'info' && result.success)) {
      console.log(`[Command] ${JSON.stringify(logData)}`);
    }
    
    if (this.logService) {
      this.logService.logActivity(
        `명령어 실행: ${this.metadata.name}`,
        [interaction.user.id],
        'command_execution',
        logData
      );
    }
  }

  /**
   * 캐시에서 데이터 조회
   * @param key - 캐시 키
   */
  protected getCached<T>(key: string): T | null {
    if (!this.config.enableCaching) return null;
    
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > this.config.cacheTimeout) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.data as T;
  }

  /**
   * 캐시에 데이터 저장
   * @param key - 캐시 키
   * @param data - 저장할 데이터
   */
  protected setCached<T>(key: string, data: T): void {
    if (!this.config.enableCaching) return;
    
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * 캐시 정리
   */
  private cleanupCache(): void {
    const now = Date.now();
    const expired: string[] = [];
    
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.config.cacheTimeout) {
        expired.push(key);
      }
    }
    
    expired.forEach(key => this.cache.delete(key));
  }

  /**
   * 명령어 통계 조회
   */
  public getStatistics(): CommandStatistics {
    return { ...this.statistics };
  }

  /**
   * 설정 업데이트
   * @param newConfig - 새로운 설정
   */
  public updateConfig(newConfig: Partial<CommandConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 캐시 수동 정리
   */
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * 명령어 활성화/비활성화
   * @param enabled - 활성화 여부
   */
  public setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * 명령어 도움말 생성
   */
  public getHelp(): string {
    let help = `**${this.metadata.name}**\n`;
    help += `${this.metadata.description}\n\n`;
    
    if (this.metadata.usage) {
      help += `**사용법:** ${this.metadata.usage}\n`;
    }
    
    if (this.metadata.examples) {
      help += `**예시:**\n${this.metadata.examples.map(ex => `• ${ex}`).join('\n')}\n`;
    }
    
    if (this.metadata.aliases) {
      help += `**별명:** ${this.metadata.aliases.join(', ')}\n`;
    }
    
    if (this.metadata.cooldown) {
      help += `**쿨다운:** ${this.metadata.cooldown}초\n`;
    }
    
    return help;
  }
}