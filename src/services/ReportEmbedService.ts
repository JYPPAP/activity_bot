// src/services/ReportEmbedService.ts - Integration service for reliable report embed sending
import { ChatInputCommandInteraction } from 'discord.js';
import { injectable, inject } from 'tsyringe';

import {
  IReliableEmbedSender,
  ThreeSectionReport,
  ReportSectionData,
  EmbedSendResult,
  ReliableEmbedSendOptions
} from '../interfaces/IReliableEmbedSender.js';
import { DI_TOKENS } from '../interfaces/index.js';
import { EmbedFactory } from '../utils/embedBuilder.js';
import type { UserActivityData } from '../utils/embedBuilder';

// Date range interface for reports
interface DateRange {
  startDate: Date;
  endDate: Date;
}

// Report generation configuration
interface ReportConfiguration {
  role: string;
  dateRange: DateRange;
  minHours: number;
  reportCycle?: number | null;
  testMode?: boolean;
  enableProgressTracking?: boolean;
  maxRetries?: number;
}

// User classification result from existing service
interface UserClassificationResult {
  activeUsers: UserActivityData[];
  inactiveUsers: UserActivityData[];
  afkUsers: UserActivityData[];
  minHours: number;
  reportCycle?: string | null;
}

@injectable()
export class ReportEmbedService {
  constructor(
    @inject(DI_TOKENS.IReliableEmbedSender) 
    private readonly reliableEmbedSender: IReliableEmbedSender
  ) {}

  /**
   * Generate and send a 3-section activity report with reliability features
   */
  async generateAndSendReport(
    interaction: ChatInputCommandInteraction,
    config: ReportConfiguration,
    classificationResult: UserClassificationResult
  ): Promise<EmbedSendResult> {
    // Create the 3-section report structure
    const report = this.createThreeSectionReport(config, classificationResult);

    // Configure reliable sending options
    const sendOptions: Partial<ReliableEmbedSendOptions> = {
      maxRetries: config.maxRetries ?? 3,
      retryDelayMs: 1000,
      backoffMultiplier: 2,
      maxEmbedsPerMessage: 10,
      chunkDelayMs: 500,
      enableTextFallback: true,
      enableProgressTracking: config.enableProgressTracking ?? true,
      strictValidation: true,
      autoTruncate: true,
      reportErrors: true,
      ephemeral: config.testMode ?? false,
      textFallbackTemplate: this.createTextFallbackTemplate(config)
    };

    // Add progressCallback conditionally for exactOptionalPropertyTypes
    if (config.enableProgressTracking) {
      sendOptions.progressCallback = this.createProgressCallback(interaction);
    }

    try {
      // Send the report using the reliable embed sender
      const result = await this.reliableEmbedSender.sendThreeSectionReport(
        interaction,
        report,
        sendOptions
      );

      // Log statistics for monitoring
      this.logSendStatistics(config, result);

      return result;

    } catch (error) {
      console.error('[ReportEmbedService] Report sending failed:', error);
      
      // Return failure result
      return {
        success: false,
        messagesSent: [],
        errorMessages: [error instanceof Error ? error.message : '알 수 없는 오류'],
        fallbackUsed: false,
        totalEmbeds: 0,
        chunksCreated: 0,
        retryAttempts: 0,
        executionTime: 0,
        validationErrors: []
      };
    }
  }

  /**
   * Send test report with enhanced error reporting
   */
  async sendTestReport(
    interaction: ChatInputCommandInteraction,
    config: ReportConfiguration,
    classificationResult: UserClassificationResult
  ): Promise<EmbedSendResult> {
    console.log(`[ReportEmbedService] 테스트 보고서 전송 시작`);
    
    const testConfig = {
      ...config,
      testMode: true,
      enableProgressTracking: true,
      maxRetries: 1 // Faster failure for testing
    };

    const result = await this.generateAndSendReport(interaction, testConfig, classificationResult);

    // Add test mode footer to success message
    if (result.success && result.messagesSent.length > 0) {
      try {
        await interaction.followUp({
          content: 
            `🧪 **테스트 모드 완료**\n\n` +
            `✅ **전송 성공:** ${result.success}\n` +
            `📊 **전송된 임베드:** ${result.totalEmbeds}개\n` +
            `📦 **생성된 청크:** ${result.chunksCreated}개\n` +
            `🔄 **재시도 횟수:** ${result.retryAttempts}회\n` +
            `⏱️ **실행 시간:** ${result.executionTime}ms\n` +
            `📝 **폴백 사용:** ${result.fallbackUsed ? '예' : '아니오'}\n` +
            `${result.validationErrors.length > 0 ? `⚠️ **검증 경고:** ${result.validationErrors.length}개\n` : ''}` +
            `\n*리셋 시간이 기록되지 않았습니다.*`,
          flags: 64 // Ephemeral
        });
      } catch (followUpError) {
        console.warn('[ReportEmbedService] Test result follow-up failed:', followUpError);
      }
    }

    return result;
  }

  /**
   * Get service health and performance metrics
   */
  getServiceStatistics() {
    return this.reliableEmbedSender.getStatistics();
  }

  /**
   * Validate report embeds before sending
   */
  async validateReportEmbeds(
    config: ReportConfiguration,
    classificationResult: UserClassificationResult
  ) {
    const report = this.createThreeSectionReport(config, classificationResult);
    const allEmbeds = [
      ...report.achievementSection.embeds,
      ...report.underperformanceSection.embeds,
      ...(report.afkSection ? report.afkSection.embeds : [])
    ];

    return await this.reliableEmbedSender.validateEmbeds(allEmbeds);
  }

  // Private helper methods

  private createThreeSectionReport(
    config: ReportConfiguration,
    classificationResult: UserClassificationResult
  ): ThreeSectionReport {
    const reportId = this.generateReportId(config);
    
    // Prepare reportCycle for exactOptionalPropertyTypes
    const reportCycle = config.reportCycle ?? null;

    // Create achievement section (달성)
    const achievementEmbeds = EmbedFactory.createActivityEmbeds({
      role: config.role,
      activeUsers: classificationResult.activeUsers,
      inactiveUsers: [], // Only active users in achievement section
      afkUsers: [],
      startDate: config.dateRange.startDate,
      endDate: config.dateRange.endDate,
      minHours: config.minHours,
      reportCycle,
      title: '활동 달성 보고서'
    }).slice(0, 1); // Only take the active users embed

    // Create underperformance section (미달성)
    const underperformanceEmbeds = EmbedFactory.createActivityEmbeds({
      role: config.role,
      activeUsers: [], // Only inactive users in underperformance section
      inactiveUsers: classificationResult.inactiveUsers,
      afkUsers: [],
      startDate: config.dateRange.startDate,
      endDate: config.dateRange.endDate,
      minHours: config.minHours,
      reportCycle,
      title: '활동 미달성 보고서'
    }).slice(1, 2); // Only take the inactive users embed

    // Create AFK section if needed (잠수)
    let afkSection: ReportSectionData | undefined;
    if (classificationResult.afkUsers.length > 0) {
      const afkEmbeds = EmbedFactory.createActivityEmbeds({
        role: config.role,
        activeUsers: [],
        inactiveUsers: [],
        afkUsers: classificationResult.afkUsers,
        startDate: config.dateRange.startDate,
        endDate: config.dateRange.endDate,
        minHours: config.minHours,
        reportCycle,
        title: '잠수 상태 보고서'
      }).slice(2); // Take the AFK embed(s)

      afkSection = {
        title: '잠수 상태 멤버',
        embeds: afkEmbeds,
        sectionType: 'afk',
        priority: 'low'
      };
    }

    const result: ThreeSectionReport = {
      achievementSection: {
        title: '활동 기준 달성 멤버',
        embeds: achievementEmbeds,
        sectionType: 'achievement',
        priority: 'high'
      },
      underperformanceSection: {
        title: '활동 기준 미달성 멤버',
        embeds: underperformanceEmbeds,
        sectionType: 'underperformance',
        priority: 'medium'
      },
      metadata: {
        reportId,
        generatedAt: new Date(),
        totalMembers: classificationResult.activeUsers.length + 
                     classificationResult.inactiveUsers.length + 
                     classificationResult.afkUsers.length,
        dateRange: {
          start: config.dateRange.startDate,
          end: config.dateRange.endDate
        }
      }
    };

    // Add afkSection conditionally for exactOptionalPropertyTypes
    if (afkSection) {
      result.afkSection = afkSection;
    }

    return result;
  }

  private createTextFallbackTemplate(config: ReportConfiguration): string {
    return `⚠️ **임베드 전송 실패 - 텍스트 형식으로 전환**\n\n` +
           `📊 **${config.role} 역할 활동 보고서**\n` +
           `📅 **기간:** ${config.dateRange.startDate.toLocaleDateString('ko-KR')} ~ ${config.dateRange.endDate.toLocaleDateString('ko-KR')}\n` +
           `⏰ **최소 활동 시간:** ${config.minHours}시간\n\n` +
           `{content}`;
  }

  private createProgressCallback(interaction: ChatInputCommandInteraction) {
    let lastUpdateTime = 0;
    const updateThreshold = 2000; // Update every 2 seconds minimum

    return async (progress: any) => {
      const now = Date.now();
      if (now - lastUpdateTime < updateThreshold) return;
      lastUpdateTime = now;

      const progressPercentage = progress.totalChunks > 0 
        ? Math.round((progress.currentChunk / progress.totalChunks) * 100)
        : 0;

      const progressBar = this.createProgressBar(progressPercentage);

      try {
        // Only send progress updates for long-running operations
        if (progress.stage === 'sending' && progress.totalChunks > 2) {
          await interaction.followUp({
            content: 
              `📊 **보고서 전송 진행상황**\n\n` +
              `${progressBar} ${progressPercentage}%\n` +
              `📦 **진행상황:** ${progress.currentChunk}/${progress.totalChunks} 청크\n` +
              `📋 **단계:** ${this.translateProgressStage(progress.stage)}\n` +
              `💬 **상태:** ${progress.message}`,
            flags: 64 // Ephemeral
          });
        }
      } catch (error) {
        console.warn('[ReportEmbedService] Progress update failed:', error);
      }
    };
  }

  private createProgressBar(percentage: number): string {
    const filledLength = Math.round(percentage / 10);
    const emptyLength = 10 - filledLength;
    return '🟩'.repeat(filledLength) + '⬜'.repeat(emptyLength);
  }

  private translateProgressStage(stage: string): string {
    switch (stage) {
      case 'validation': return '검증 중';
      case 'chunking': return '청크 생성';
      case 'sending': return '전송 중';
      case 'retry': return '재시도 중';
      case 'fallback': return '폴백 처리';
      case 'completed': return '완료';
      case 'failed': return '실패';
      default: return stage;
    }
  }

  private generateReportId(config: ReportConfiguration): string {
    const timestamp = Date.now().toString(36);
    const roleHash = config.role.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4);
    const dateHash = config.dateRange.startDate.getTime().toString(36).substring(-4);
    return `RPT_${roleHash}_${dateHash}_${timestamp}`.toUpperCase();
  }

  private logSendStatistics(config: ReportConfiguration, result: EmbedSendResult): void {
    const stats = this.reliableEmbedSender.getStatistics();
    
    console.log(`[ReportEmbedService] 보고서 전송 통계:`);
    console.log(`  - 역할: ${config.role}`);
    console.log(`  - 성공: ${result.success}`);
    console.log(`  - 전송된 임베드: ${result.totalEmbeds}개`);
    console.log(`  - 청크 수: ${result.chunksCreated}개`);
    console.log(`  - 재시도 횟수: ${result.retryAttempts}회`);
    console.log(`  - 실행 시간: ${result.executionTime}ms`);
    console.log(`  - 폴백 사용: ${result.fallbackUsed}`);
    console.log(`  - 서비스 성공률: ${stats.successRate}%`);
    console.log(`  - 서비스 평균 재시도: ${stats.averageRetries}회`);
    console.log(`  - 폴백 사용률: ${stats.fallbackUsageRate}%`);
  }
}