// src/services/ReportCommandIntegration.ts - 보고서 명령어 최적화 통합 서비스
import { 
  ChatInputCommandInteraction, 
  Guild, 
  GuildMember, 
  Collection 
} from 'discord.js';
import { injectable, inject } from 'tsyringe';

import { OptimizedMemberFetchService } from './OptimizedMemberFetchService.js';
import { ReportGenerationValidator } from './ReportGenerationValidator.js';
import type { ReportValidationReport } from './ReportGenerationValidator';

interface ReportCommandResult {
  success: boolean;
  roleMembers?: Collection<string, GuildMember>;
  validationReport?: ReportValidationReport;
  error?: string;
  metrics: {
    memberFetchTime: number;
    memberCount: number;
    cacheUsed: boolean;
    strategy: string;
  };
}

@injectable()
export class ReportCommandIntegration {
  private optimizedFetch: OptimizedMemberFetchService;
  private validator: ReportGenerationValidator;

  constructor(
    @inject(OptimizedMemberFetchService) optimizedFetch: OptimizedMemberFetchService,
    @inject(ReportGenerationValidator) validator: ReportGenerationValidator
  ) {
    this.optimizedFetch = optimizedFetch;
    this.validator = validator;
  }

  /**
   * 🚀 최적화된 보고서 생성 준비
   */
  async prepareReportGeneration(
    interaction: ChatInputCommandInteraction,
    target: string,
    startDate: Date,
    endDate: Date,
    options: {
      enableValidation?: boolean;
      enableCacheWarming?: boolean;
      forceRefresh?: boolean;
    } = {}
  ): Promise<ReportCommandResult> {
    const startTime = Date.now();
    const guild = interaction.guild!;
    
    console.log(`[ReportIntegration] 보고서 생성 준비 시작: ${target}`);
    console.log(`[ReportIntegration] 옵션:`, options);

    try {
      // 1. 전체 길드 멤버 가져오기 (캐시 워밍업 생략)
      console.log(`[ReportIntegration] 전체 길드 멤버 가져오기...`);

      // 2. 최적화된 멤버 가져오기
      console.log(`[ReportIntegration] 멤버 가져오기 시작...`);
      const fetchStartTime = Date.now();
      
      const fetchOptions: any = {};
      // Add forceRefresh conditionally for exactOptionalPropertyTypes
      if (options.forceRefresh !== undefined) {
        fetchOptions.forceRefresh = options.forceRefresh;
      }
      
      const guildMembers = await this.optimizedFetch.getAllGuildMembers(guild, fetchOptions);

      const fetchDuration = Date.now() - fetchStartTime;
      console.log(`[ReportIntegration] 멤버 가져오기 완료: ${guildMembers.size}명 (${fetchDuration}ms)`);

      // 멤버가 없는 경우 조기 반환
      if (guildMembers.size === 0) {
        return {
          success: false,
          error: `길드에서 멤버를 찾을 수 없습니다.`,
          metrics: {
            memberFetchTime: fetchDuration,
            memberCount: 0,
            cacheUsed: false,
            strategy: 'unknown'
          }
        };
      }

      // 3. 검증 시스템 실행 (선택적)
      let validationReport: ReportValidationReport | undefined;
      
      if (options.enableValidation) {
        console.log(`[ReportIntegration] 보고서 검증 시작...`);
        
        try {
          validationReport = await this.validator.validateReportGeneration(
            interaction,
            target,
            guildMembers,
            startDate,
            endDate,
            (step) => {
              // 진행 상황을 콘솔에만 출력 (Discord 스팸 방지)
              console.log(`[Validation] ${step.name}: ${step.status}`);
            }
          );

          // 검증 실패시 중단
          if (validationReport.overallStatus === 'failed') {
            console.log(`[ReportIntegration] 검증 실패로 중단`);
            
            return {
              success: false,
              error: '보고서 생성 검증에서 치명적 문제가 발견되었습니다.',
              validationReport,
              metrics: {
                memberFetchTime: fetchDuration,
                memberCount: guildMembers.size,
                cacheUsed: this.wasCacheUsed(),
                strategy: this.getLastUsedStrategy()
              }
            };
          }

          // 경고가 있는 경우 알림
          if (validationReport.overallStatus === 'warning') {
            console.log(`[ReportIntegration] 검증 경고 ${validationReport.warningSteps}개, 계속 진행`);
            
            // 사용자에게 경고 알림
            await interaction.followUp({
              content: `⚠️ 보고서 생성 중 ${validationReport.warningSteps}개의 경고가 감지되었습니다. 처리 시간이 평소보다 오래 걸릴 수 있습니다.`,
              ephemeral: true
            });
          }

        } catch (validationError) {
          console.warn(`[ReportIntegration] 검증 시스템 오류:`, validationError);
          // 검증 실패해도 보고서 생성은 계속 진행
        }
      }

      // 4. 성능 메트릭 수집
      const performanceMetrics = this.optimizedFetch.getPerformanceMetrics();
      console.log(`[ReportIntegration] 성능 메트릭:`, {
        cacheHitRate: Math.round((performanceMetrics.cacheHits / Math.max(performanceMetrics.totalRequests, 1)) * 100),
        avgResponseTime: Math.round(performanceMetrics.averageResponseTime),
        timeouts: performanceMetrics.timeouts
      });

      const totalDuration = Date.now() - startTime;
      console.log(`[ReportIntegration] 준비 완료: ${totalDuration}ms`);

      const result: any = {
        success: true,
        roleMembers: guildMembers,
        metrics: {
          memberFetchTime: fetchDuration,
          memberCount: guildMembers.size,
          cacheUsed: this.wasCacheUsed(),
          strategy: this.getLastUsedStrategy()
        }
      };
      
      // Add validationReport conditionally for exactOptionalPropertyTypes
      if (validationReport) {
        result.validationReport = validationReport;
      }
      
      return result;

    } catch (error) {
      const totalDuration = Date.now() - startTime;
      console.error(`[ReportIntegration] 실패 (${totalDuration}ms):`, error);

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        metrics: {
          memberFetchTime: totalDuration,
          memberCount: 0,
          cacheUsed: false,
          strategy: 'failed'
        }
      };
    }
  }

  /**
   * 📊 실시간 진행 상황 알림
   */
  async sendProgressUpdate(
    interaction: ChatInputCommandInteraction,
    status: string,
    details?: {
      currentStep?: string;
      progress?: number;
      memberCount?: number;
    }
  ): Promise<void> {
    try {
      const progressBar = details?.progress 
        ? this.createProgressBar(details.progress)
        : '준비 중...';
      
      const content = `🔄 **보고서 생성 진행 중**\n\n` +
                     `📊 상태: ${status}\n` +
                     `${details?.currentStep ? `📝 현재: ${details.currentStep}\n` : ''}` +
                     `${details?.memberCount ? `👥 멤버: ${details.memberCount}명\n` : ''}` +
                     `\n진행률: ${progressBar}`;

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content });
      } else {
        await interaction.deferReply({ ephemeral: true });
        await interaction.editReply({ content });
      }
    } catch (error) {
      console.warn(`[ReportIntegration] 진행 상황 업데이트 실패:`, error);
    }
  }

  /**
   * 🔧 문제 감지 및 자동 복구 시도
   */
  async handleFetchFailure(
    guild: Guild,
    _target: string,
    originalError: Error
  ): Promise<Collection<string, GuildMember> | null> {
    console.log(`[ReportIntegration] 실패 복구 시도: ${originalError.message}`);

    try {
      // 1. 타임아웃 오류인 경우 재시도
      if (originalError.message.includes('timeout')) {
        console.log(`[ReportIntegration] 타임아웃 복구: 재시도`);
        
        // 잠시 대기 후 재시도
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        return await this.optimizedFetch.getAllGuildMembers(guild, {});
      }

      // 2. 권한 오류인 경우 부분 데이터로 시도
      if (originalError.message.includes('Missing Permissions') || 
          originalError.message.includes('GuildMembers Intent')) {
        console.log(`[ReportIntegration] 권한 부족: 제한된 모드로 시도`);
        // 캐시된 데이터만 사용
        return await this.optimizedFetch.getAllGuildMembers(guild, {});
      }

      // 3. 기타 오류의 경우 null 반환
      return null;

    } catch (recoveryError) {
      console.error(`[ReportIntegration] 복구 시도도 실패:`, recoveryError);
      return null;
    }
  }

  /**
   * 📈 성능 최적화 제안
   */
  getOptimizationRecommendations(): string[] {
    const metrics = this.optimizedFetch.getPerformanceMetrics();
    const recommendations: string[] = [];

    // 캐시 히트율이 낮은 경우
    const cacheHitRate = metrics.cacheHits / Math.max(metrics.totalRequests, 1);
    if (cacheHitRate < 0.5) {
      recommendations.push('캐시 워밍업을 활성화하여 응답 시간을 개선하세요');
    }

    // 타임아웃이 많은 경우
    if (metrics.timeouts > metrics.totalRequests * 0.2) {
      recommendations.push('네트워크 연결을 확인하고 Discord Intent 설정을 검토하세요');
    }

    // 평균 응답 시간이 긴 경우
    if (metrics.averageResponseTime > 5000) {
      recommendations.push('서버 성능을 확인하고 Redis 캐싱을 고려하세요');
    }

    // 느린 쿼리가 많은 경우
    if (metrics.slowQueries > metrics.totalRequests * 0.3) {
      recommendations.push('Discord API 호출을 최적화하고 배치 처리를 사용하세요');
    }

    return recommendations;
  }

  /**
   * 🧹 정리 작업
   */
  dispose(): void {
    this.optimizedFetch.dispose();
  }

  // Private helper methods

  private wasCacheUsed(): boolean {
    const metrics = this.optimizedFetch.getPerformanceMetrics();
    return metrics.cacheHits > 0;
  }

  private getLastUsedStrategy(): string {
    const metrics = this.optimizedFetch.getPerformanceMetrics();
    const strategies = Array.from(metrics.strategiesUsed.entries());
    
    if (strategies.length === 0) {
      return 'unknown';
    }

    // 가장 최근에 사용된 전략 반환 (가장 많이 사용된 것으로 추정)
    const mostUsed = strategies.reduce((max, current) => 
      current[1] > max[1] ? current : max
    );
    
    return mostUsed[0];
  }

  private createProgressBar(progress: number): string {
    const total = 20; // 20개 문자로 구성된 진행률 바
    const filled = Math.round((progress / 100) * total);
    const empty = total - filled;
    
    return `[${'█'.repeat(filled)}${'▱'.repeat(empty)}] ${progress}%`;
  }
}