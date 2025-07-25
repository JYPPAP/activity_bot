// src/services/ReportGenerationValidator.ts - 보고서 생성 과정 단계별 검증 시스템
import { 
  ChatInputCommandInteraction, 
  EmbedBuilder, 
  Collection, 
  GuildMember 
} from 'discord.js';
import { injectable, inject } from 'tsyringe';

import type { 
  UserClassificationResult, 
  UserData,
  IUserClassificationService 
} from '../interfaces/IUserClassificationService';
import { EmbedValidator } from '../utils/EmbedValidator';
import { DI_TOKENS } from '../interfaces/index';

// 검증 단계 정의
export interface ValidationStep {
  stepId: string;
  name: string;
  description: string;
  status: 'pending' | 'running' | 'success' | 'warning' | 'failed';
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  data?: any;
  metrics?: Record<string, any>;
  errors?: string[];
  warnings?: string[];
  suggestions?: string[];
  subSteps?: ValidationStep[];
}

// 데이터 분류 검증 결과
export interface ClassificationValidationResult {
  isValid: boolean;
  expectedTotals: {
    total: number;
    achieved: number;
    underperformed: number;
    afk: number;
  };
  actualTotals: {
    total: number;
    achieved: number;
    underperformed: number;
    afk: number;
  };
  discrepancies: {
    field: string;
    expected: number;
    actual: number;
    difference: number;
  }[];
  warnings: string[];
  suggestions: string[];
}

// Discord 상호작용 상태 검증 결과
export interface InteractionStateValidationResult {
  isValid: boolean;
  timeRemaining: number;
  hasDeferred: boolean;
  hasReplied: boolean;
  canRespond: boolean;
  warnings: string[];
  recommendations: string[];
}

// 메시지 크기 및 형식 검증 결과
export interface MessageValidationResult {
  isValid: boolean;
  embeds: {
    embedIndex: number;
    isValid: boolean;
    characterCount: number;
    fieldCount: number;
    violations: any[];
    warnings: any[];
  }[];
  totalCharacters: number;
  totalEmbeds: number;
  estimatedSendTime: number;
  chunksRequired: number;
  warnings: string[];
  suggestions: string[];
}

// 전체 검증 리포트
export interface ReportValidationReport {
  reportId: string;
  timestamp: Date;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  warningSteps: number;
  totalDuration: number;
  overallStatus: 'success' | 'warning' | 'failed';
  steps: ValidationStep[];
  summary: {
    classificationValidation: ClassificationValidationResult;
    interactionValidation: InteractionStateValidationResult;
    messageValidation: MessageValidationResult;
    criticalIssues: string[];
    recommendations: string[];
  };
}

// 실시간 진행 상황 콜백
export type ProgressCallback = (step: ValidationStep) => void;

@injectable()
export class ReportGenerationValidator {
  private userClassificationService: IUserClassificationService;
  private activeValidation: Map<string, ReportValidationReport> = new Map();

  constructor(
    @inject(DI_TOKENS.IUserClassificationService) userClassificationService: IUserClassificationService
  ) {
    this.userClassificationService = userClassificationService;
  }

  /**
   * 🔍 전체 보고서 생성 과정 검증
   */
  async validateReportGeneration(
    interaction: ChatInputCommandInteraction,
    role: string,
    roleMembers: Collection<string, GuildMember>,
    startDate: Date,
    endDate: Date,
    progressCallback?: ProgressCallback
  ): Promise<ReportValidationReport> {
    const reportId = `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = new Date();

    console.log(`[검증-디버깅] 보고서 생성 검증 시작: ${reportId}`);

    // 초기 리포트 생성
    const report: ReportValidationReport = {
      reportId,
      timestamp: startTime,
      totalSteps: 8,
      completedSteps: 0,
      failedSteps: 0,
      warningSteps: 0,
      totalDuration: 0,
      overallStatus: 'success',
      steps: [],
      summary: {
        classificationValidation: {
          isValid: true,
          expectedTotals: { total: 0, achieved: 0, underperformed: 0, afk: 0 },
          actualTotals: { total: 0, achieved: 0, underperformed: 0, afk: 0 },
          discrepancies: [],
          warnings: [],
          suggestions: []
        },
        interactionValidation: {
          isValid: true,
          timeRemaining: 0,
          hasDeferred: false,
          hasReplied: false,
          canRespond: true,
          warnings: [],
          recommendations: []
        },
        messageValidation: {
          isValid: true,
          embeds: [],
          totalCharacters: 0,
          totalEmbeds: 0,
          estimatedSendTime: 0,
          chunksRequired: 0,
          warnings: [],
          suggestions: []
        },
        criticalIssues: [],
        recommendations: []
      }
    };

    this.activeValidation.set(reportId, report);

    try {
      // 1단계: 입력 매개변수 검증
      await this.validateInputParameters(report, role, roleMembers, startDate, endDate, progressCallback);

      // 2단계: Discord 상호작용 상태 검증
      await this.validateInteractionState(report, interaction, progressCallback);

      // 3단계: 멤버 데이터 무결성 검증
      await this.validateMemberDataIntegrity(report, roleMembers, progressCallback);

      // 4단계: 사용자 분류 실행 및 검증
      const classificationResult = await this.validateUserClassification(
        report, role, roleMembers, startDate, endDate, progressCallback
      );

      // 5단계: 분류 결과 데이터 검증
      await this.validateClassificationData(report, classificationResult, progressCallback);

      // 6단계: 임베드 구조 사전 검증
      const embeds = await this.validateEmbedStructure(report, classificationResult, progressCallback);

      // 7단계: 메시지 크기 및 형식 검증
      await this.validateMessageSizeAndFormat(report, embeds, progressCallback);

      // 8단계: 최종 전송 준비 상태 검증
      await this.validateFinalSendReadiness(report, interaction, embeds, progressCallback);

      // 검증 완료 처리
      report.totalDuration = Date.now() - startTime.getTime();
      report.overallStatus = this.determineOverallStatus(report);

      console.log(`[검증-디버깅] 검증 완료: ${reportId}, 상태: ${report.overallStatus}, 소요시간: ${report.totalDuration}ms`);

    } catch (error) {
      console.error(`[검증-디버깅] 검증 중 치명적 오류: ${reportId}`, error);
      report.overallStatus = 'failed';
      report.summary.criticalIssues.push(`치명적 오류: ${error instanceof Error ? error.message : String(error)}`);
    }

    return report;
  }

  /**
   * 1단계: 입력 매개변수 검증
   */
  private async validateInputParameters(
    report: ReportValidationReport,
    role: string,
    roleMembers: Collection<string, GuildMember>,
    startDate: Date,
    endDate: Date,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    const step: ValidationStep = {
      stepId: 'input_validation',
      name: '입력 매개변수 검증',
      description: '보고서 생성에 필요한 기본 입력값들의 유효성을 검증합니다',
      status: 'running',
      startTime: new Date(),
      errors: [],
      warnings: [],
      suggestions: [],
      metrics: {},
      subSteps: []
    };

    try {
      progressCallback?.(step);

      // 역할 이름 검증
      const roleValidation: ValidationStep = {
        stepId: 'role_validation',
        name: '역할 이름 검증',
        description: '역할 이름의 유효성을 확인합니다',
        status: 'running',
        startTime: new Date()
      };

      if (!role || typeof role !== 'string' || role.trim().length === 0) {
        roleValidation.status = 'failed';
        roleValidation.errors = ['역할 이름이 비어있거나 유효하지 않습니다'];
        step.errors!.push('역할 이름 검증 실패');
      } else if (role.length > 100) {
        roleValidation.status = 'warning';
        roleValidation.warnings = ['역할 이름이 매우 깁니다 (100자 초과)'];
        step.warnings!.push('역할 이름이 비정상적으로 깁니다');
      } else {
        roleValidation.status = 'success';
      }

      roleValidation.endTime = new Date();
      roleValidation.duration = roleValidation.endTime.getTime() - roleValidation.startTime!.getTime();
      step.subSteps!.push(roleValidation);

      // 멤버 컬렉션 검증
      const memberValidation: ValidationStep = {
        stepId: 'member_collection_validation',
        name: '멤버 컬렉션 검증',
        description: '역할 멤버 데이터의 유효성을 확인합니다',
        status: 'running',
        startTime: new Date()
      };

      if (!roleMembers || roleMembers.size === 0) {
        memberValidation.status = 'failed';
        memberValidation.errors = ['역할 멤버가 없거나 컬렉션이 비어있습니다'];
        step.errors!.push('멤버 컬렉션 검증 실패');
      } else {
        const memberCount = roleMembers.size;
        if (memberCount > 1000) {
          memberValidation.status = 'warning';
          memberValidation.warnings = [`멤버 수가 매우 많습니다: ${memberCount}명 (성능에 영향을 줄 수 있음)`];
          step.warnings!.push('대용량 멤버 처리 필요');
        } else {
          memberValidation.status = 'success';
        }
        
        memberValidation.metrics = {
          memberCount,
          hasGuildInfo: roleMembers.first()?.guild ? true : false
        };
      }

      memberValidation.endTime = new Date();
      memberValidation.duration = memberValidation.endTime.getTime() - memberValidation.startTime!.getTime();
      step.subSteps!.push(memberValidation);

      // 날짜 범위 검증
      const dateValidation: ValidationStep = {
        stepId: 'date_range_validation',
        name: '날짜 범위 검증',
        description: '시작일과 종료일의 유효성을 확인합니다',
        status: 'running',
        startTime: new Date()
      };

      if (!startDate || !endDate) {
        dateValidation.status = 'failed';
        dateValidation.errors = ['시작일 또는 종료일이 누락되었습니다'];
        step.errors!.push('날짜 범위 검증 실패');
      } else if (startDate >= endDate) {
        dateValidation.status = 'failed';
        dateValidation.errors = ['시작일이 종료일보다 늦거나 같습니다'];
        step.errors!.push('잘못된 날짜 범위');
      } else {
        const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff > 90) {
          dateValidation.status = 'warning';
          dateValidation.warnings = [`날짜 범위가 매우 깁니다: ${daysDiff}일 (성능에 영향을 줄 수 있음)`];
          step.warnings!.push('긴 날짜 범위로 인한 성능 우려');
        } else {
          dateValidation.status = 'success';
        }
        
        dateValidation.metrics = {
          daysDifference: daysDiff,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString()
        };
      }

      dateValidation.endTime = new Date();
      dateValidation.duration = dateValidation.endTime.getTime() - dateValidation.startTime!.getTime();
      step.subSteps!.push(dateValidation);

      // 전체 단계 상태 결정
      const hasErrors = step.subSteps!.some(s => s.status === 'failed');
      const hasWarnings = step.subSteps!.some(s => s.status === 'warning');

      if (hasErrors) {
        step.status = 'failed';
        report.failedSteps++;
      } else if (hasWarnings) {
        step.status = 'warning';
        report.warningSteps++;
      } else {
        step.status = 'success';
        report.completedSteps++;
      }

      step.metrics = {
        role,
        memberCount: roleMembers?.size || 0,
        dateRange: endDate && startDate ? Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) : 0
      };

    } catch (error) {
      step.status = 'failed';
      step.errors!.push(`검증 중 오류: ${error instanceof Error ? error.message : String(error)}`);
      report.failedSteps++;
    }

    step.endTime = new Date();
    step.duration = step.endTime.getTime() - step.startTime!.getTime();
    report.steps.push(step);
    progressCallback?.(step);
  }

  /**
   * 2단계: Discord 상호작용 상태 검증
   */
  private async validateInteractionState(
    report: ReportValidationReport,
    interaction: ChatInputCommandInteraction,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    const step: ValidationStep = {
      stepId: 'interaction_state',
      name: 'Discord 상호작용 상태 검증',
      description: 'Discord 상호작용의 현재 상태와 응답 가능 여부를 확인합니다',
      status: 'running',
      startTime: new Date(),
      errors: [],
      warnings: [],
      suggestions: []
    };

    try {
      progressCallback?.(step);

      const now = Date.now();
      const interactionTime = interaction.createdTimestamp;
      const timeElapsed = now - interactionTime;
      const timeRemaining = 3000 - timeElapsed; // Discord 3초 제한

      const validationResult: InteractionStateValidationResult = {
        isValid: true,
        timeRemaining,
        hasDeferred: interaction.deferred,
        hasReplied: interaction.replied,
        canRespond: true,
        warnings: [],
        recommendations: []
      };

      // 시간 제한 검증
      if (timeRemaining <= 0 && !interaction.deferred && !interaction.replied) {
        validationResult.isValid = false;
        validationResult.canRespond = false;
        step.errors!.push('Discord 상호작용 시간 제한 초과 (3초)');
        validationResult.warnings.push('상호작용이 이미 만료되었습니다');
      } else if (timeRemaining < 1000 && !interaction.deferred) {
        validationResult.warnings.push('상호작용 시간이 거의 만료됩니다 (1초 미만 남음)');
        validationResult.recommendations.push('즉시 deferReply()를 호출하세요');
        step.warnings!.push('상호작용 시간 부족');
      }

      // 응답 상태 검증
      if (interaction.replied) {
        validationResult.warnings.push('이미 응답한 상호작용입니다');
        validationResult.recommendations.push('followUp() 또는 editReply()를 사용하세요');
      }

      if (!interaction.deferred && timeRemaining > 1000) {
        validationResult.recommendations.push('장시간 작업을 위해 deferReply()를 호출하는 것을 권장합니다');
      }

      // 길드 및 채널 상태 검증
      if (!interaction.guild) {
        step.errors!.push('길드 정보를 찾을 수 없습니다');
        validationResult.isValid = false;
      }

      if (!interaction.channel) {
        step.errors!.push('채널 정보를 찾을 수 없습니다');
        validationResult.isValid = false;
      }

      // 권한 검증
      if (interaction.guild && interaction.channel) {
        const botMember = interaction.guild.members.me;
        if (botMember && !interaction.channel.permissionsFor(botMember)?.has('SendMessages')) {
          step.errors!.push('봇이 이 채널에 메시지를 보낼 권한이 없습니다');
          validationResult.isValid = false;
        }

        if (botMember && !interaction.channel.permissionsFor(botMember)?.has('EmbedLinks')) {
          step.warnings!.push('봇이 임베드를 보낼 권한이 없습니다');
          validationResult.warnings.push('임베드 링크 권한이 없어 일반 텍스트로 전송됩니다');
        }
      }

      report.summary.interactionValidation = validationResult;

      step.metrics = {
        timeElapsed,
        timeRemaining,
        hasDeferred: interaction.deferred,
        hasReplied: interaction.replied,
        guildId: interaction.guild?.id,
        channelId: interaction.channel?.id
      };

      if (!validationResult.isValid) {
        step.status = 'failed';
        report.failedSteps++;
      } else if (validationResult.warnings.length > 0) {
        step.status = 'warning';
        report.warningSteps++;
      } else {
        step.status = 'success';
        report.completedSteps++;
      }

    } catch (error) {
      step.status = 'failed';
      step.errors!.push(`상호작용 상태 검증 중 오류: ${error instanceof Error ? error.message : String(error)}`);
      report.failedSteps++;
    }

    step.endTime = new Date();
    step.duration = step.endTime.getTime() - step.startTime!.getTime();
    report.steps.push(step);
    progressCallback?.(step);
  }

  /**
   * 3단계: 멤버 데이터 무결성 검증
   */
  private async validateMemberDataIntegrity(
    report: ReportValidationReport,
    roleMembers: Collection<string, GuildMember>,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    const step: ValidationStep = {
      stepId: 'member_data_integrity',
      name: '멤버 데이터 무결성 검증',
      description: '역할 멤버들의 데이터 무결성과 일관성을 확인합니다',
      status: 'running',
      startTime: new Date(),
      errors: [],
      warnings: [],
      suggestions: []
    };

    try {
      progressCallback?.(step);

      let validMembers = 0;
      let invalidMembers = 0;
      let membersWithoutNickname = 0;
      let membersWithLongNickname = 0;
      const duplicateIds: string[] = [];
      const seenIds = new Set<string>();

      for (const [userId, member] of roleMembers.entries()) {
        // 중복 ID 확인
        if (seenIds.has(userId)) {
          duplicateIds.push(userId);
        }
        seenIds.add(userId);

        // 멤버 유효성 확인
        if (!member || !member.user) {
          invalidMembers++;
          continue;
        }

        // 닉네임 확인
        if (!member.displayName || member.displayName.trim().length === 0) {
          membersWithoutNickname++;
        } else if (member.displayName.length > 32) {
          membersWithLongNickname++;
        }

        validMembers++;
      }

      // 중복 ID 오류
      if (duplicateIds.length > 0) {
        step.errors!.push(`중복된 사용자 ID 발견: ${duplicateIds.length}개`);
      }

      // 유효하지 않은 멤버 경고
      if (invalidMembers > 0) {
        step.warnings!.push(`유효하지 않은 멤버 데이터: ${invalidMembers}개`);
        step.suggestions!.push('멤버 컬렉션을 새로고침하여 최신 데이터를 가져오세요');
      }

      // 닉네임 문제 경고
      if (membersWithoutNickname > 0) {
        step.warnings!.push(`닉네임이 없는 멤버: ${membersWithoutNickname}개`);
      }

      if (membersWithLongNickname > 0) {
        step.warnings!.push(`닉네임이 긴 멤버: ${membersWithLongNickname}개 (32자 초과)`);
      }

      step.metrics = {
        totalMembers: roleMembers.size,
        validMembers,
        invalidMembers,
        membersWithoutNickname,
        membersWithLongNickname,
        duplicateIds: duplicateIds.length,
        dataIntegrityScore: Math.round((validMembers / Math.max(roleMembers.size, 1)) * 100)
      };

      if (duplicateIds.length > 0 || invalidMembers > validMembers) {
        step.status = 'failed';
        report.failedSteps++;
      } else if (step.warnings!.length > 0) {
        step.status = 'warning';
        report.warningSteps++;
      } else {
        step.status = 'success';
        report.completedSteps++;
      }

    } catch (error) {
      step.status = 'failed';
      step.errors!.push(`멤버 데이터 검증 중 오류: ${error instanceof Error ? error.message : String(error)}`);
      report.failedSteps++;
    }

    step.endTime = new Date();
    step.duration = step.endTime.getTime() - step.startTime!.getTime();
    report.steps.push(step);
    progressCallback?.(step);
  }

  /**
   * 4단계: 사용자 분류 실행 및 검증
   */
  private async validateUserClassification(
    report: ReportValidationReport,
    role: string,
    roleMembers: Collection<string, GuildMember>,
    startDate: Date,
    endDate: Date,
    progressCallback?: ProgressCallback
  ): Promise<UserClassificationResult> {
    const step: ValidationStep = {
      stepId: 'user_classification',
      name: '사용자 분류 실행 및 검증',
      description: '사용자 활동 데이터를 분류하고 결과를 검증합니다',
      status: 'running',
      startTime: new Date(),
      errors: [],
      warnings: [],
      suggestions: []
    };

    let classificationResult: UserClassificationResult | null = null;

    try {
      progressCallback?.(step);

      // 분류 서비스 실행
      const classificationStart = Date.now();
      classificationResult = await this.userClassificationService.classifyUsersByDateRange(
        role,
        roleMembers,
        startDate,
        endDate
      );
      const classificationDuration = Date.now() - classificationStart;

      // 분류 결과 기본 검증
      if (!classificationResult) {
        step.status = 'failed';
        step.errors!.push('사용자 분류 결과가 null 또는 undefined입니다');
        report.failedSteps++;
        return classificationResult!;
      }

      // 분류 결과 구조 검증
      const requiredFields = ['activeUsers', 'inactiveUsers', 'afkUsers'];
      for (const field of requiredFields) {
        if (!Array.isArray((classificationResult as any)[field])) {
          step.errors!.push(`분류 결과의 ${field} 필드가 배열이 아닙니다`);
        }
      }

      // 분류 성능 검증
      if (classificationDuration > 30000) { // 30초 초과
        step.warnings!.push(`분류 처리 시간이 매우 깁니다: ${classificationDuration}ms`);
        step.suggestions!.push('데이터베이스 인덱스 및 쿼리 최적화를 검토하세요');
      } else if (classificationDuration > 10000) { // 10초 초과
        step.warnings!.push(`분류 처리 시간이 깁니다: ${classificationDuration}ms`);
      }

      // 분류 결과 일관성 검증
      const totalClassified = classificationResult.activeUsers.length + 
                             classificationResult.inactiveUsers.length + 
                             classificationResult.afkUsers.length;
      
      if (totalClassified !== roleMembers.size) {
        const difference = Math.abs(totalClassified - roleMembers.size);
        if (difference > roleMembers.size * 0.1) { // 10% 이상 차이
          step.errors!.push(`분류된 사용자 수와 실제 멤버 수의 차이가 큽니다: ${difference}명`);
        } else {
          step.warnings!.push(`분류된 사용자 수와 실제 멤버 수 차이: ${difference}명`);
        }
      }

      step.metrics = {
        classificationDuration,
        originalMemberCount: roleMembers.size,
        classifiedTotalCount: totalClassified,
        activeCount: classificationResult.activeUsers.length,
        inactiveCount: classificationResult.inactiveUsers.length,
        afkCount: classificationResult.afkUsers.length,
        discrepancy: totalClassified - roleMembers.size,
        performanceScore: classificationDuration < 5000 ? 'excellent' : classificationDuration < 15000 ? 'good' : 'poor'
      };

      if (step.errors!.length > 0) {
        step.status = 'failed';
        report.failedSteps++;
      } else if (step.warnings!.length > 0) {
        step.status = 'warning';
        report.warningSteps++;
      } else {
        step.status = 'success';
        report.completedSteps++;
      }

    } catch (error) {
      step.status = 'failed';
      step.errors!.push(`사용자 분류 중 오류: ${error instanceof Error ? error.message : String(error)}`);
      report.failedSteps++;
    }

    step.endTime = new Date();
    step.duration = step.endTime.getTime() - step.startTime!.getTime();
    report.steps.push(step);
    progressCallback?.(step);

    return classificationResult!;
  }

  /**
   * 5단계: 분류 결과 데이터 검증 (달성/미달성/잠수)
   */
  private async validateClassificationData(
    report: ReportValidationReport,
    classificationResult: UserClassificationResult,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    const step: ValidationStep = {
      stepId: 'classification_data_validation',
      name: '분류 결과 데이터 검증',
      description: '달성/미달성/잠수 분류 결과의 정확성과 일관성을 검증합니다',
      status: 'running',
      startTime: new Date(),
      errors: [],
      warnings: [],
      suggestions: []
    };

    try {
      progressCallback?.(step);

      const validationResult: ClassificationValidationResult = {
        isValid: true,
        expectedTotals: { total: 0, achieved: 0, underperformed: 0, afk: 0 },
        actualTotals: { total: 0, achieved: 0, underperformed: 0, afk: 0 },
        discrepancies: [],
        warnings: [],
        suggestions: []
      };

      // 실제 카운트 계산
      validationResult.actualTotals = {
        achieved: classificationResult.activeUsers.length,
        underperformed: classificationResult.inactiveUsers.length,
        afk: classificationResult.afkUsers.length,
        total: classificationResult.activeUsers.length + 
               classificationResult.inactiveUsers.length + 
               classificationResult.afkUsers.length
      };

      // 예상 카운트 (통계가 있다면 사용)
      if (classificationResult.statistics) {
        validationResult.expectedTotals = {
          achieved: classificationResult.statistics.activeCount,
          underperformed: classificationResult.statistics.inactiveCount,
          afk: classificationResult.statistics.afkCount,
          total: classificationResult.statistics.totalUsers
        };
      } else {
        validationResult.expectedTotals = { ...validationResult.actualTotals };
      }

      // 불일치 검사
      const categories = [
        { key: 'achieved', name: '달성' },
        { key: 'underperformed', name: '미달성' },
        { key: 'afk', name: '잠수' },
        { key: 'total', name: '전체' }
      ] as const;

      for (const category of categories) {
        const expected = validationResult.expectedTotals[category.key];
        const actual = validationResult.actualTotals[category.key];
        const difference = actual - expected;

        if (difference !== 0) {
          validationResult.discrepancies.push({
            field: category.name,
            expected,
            actual,
            difference
          });
        }
      }

      // 데이터 품질 검증
      const totalUsers = validationResult.actualTotals.total;
      
      // 빈 분류 그룹 검증
      if (validationResult.actualTotals.achieved === 0 && totalUsers > 0) {
        validationResult.warnings.push('달성한 사용자가 없습니다 - 기준이 너무 높을 수 있습니다');
        step.warnings!.push('달성 사용자 없음');
      }

      if (validationResult.actualTotals.underperformed === 0 && totalUsers > 0) {
        validationResult.warnings.push('미달성 사용자가 없습니다 - 모든 사용자가 기준을 달성했습니다');
      }

      // 사용자 데이터 일관성 검증
      const allUsers = [
        ...classificationResult.activeUsers,
        ...classificationResult.inactiveUsers,
        ...classificationResult.afkUsers
      ];

      // 중복 사용자 검증
      const userIds = allUsers.map(user => user.userId);
      const uniqueUserIds = new Set(userIds);
      if (userIds.length !== uniqueUserIds.size) {
        const duplicateCount = userIds.length - uniqueUserIds.size;
        step.errors!.push(`중복된 사용자가 발견되었습니다: ${duplicateCount}명`);
        validationResult.isValid = false;
      }

      // 활동 시간 데이터 검증
      let usersWithInvalidTime = 0;
      let usersWithNegativeTime = 0;

      for (const user of allUsers) {
        if (typeof user.totalTime !== 'number') {
          usersWithInvalidTime++;
        } else if (user.totalTime < 0) {
          usersWithNegativeTime++;
        }
      }

      if (usersWithInvalidTime > 0) {
        step.errors!.push(`활동 시간이 유효하지 않은 사용자: ${usersWithInvalidTime}명`);
        validationResult.isValid = false;
      }

      if (usersWithNegativeTime > 0) {
        step.errors!.push(`음수 활동 시간을 가진 사용자: ${usersWithNegativeTime}명`);
        validationResult.isValid = false;
      }

      // AFK 사용자 특별 검증
      for (const afkUser of classificationResult.afkUsers) {
        if (!afkUser.isAfk) {
          step.warnings!.push(`AFK 그룹에 isAfk=false인 사용자 포함: ${afkUser.nickname}`);
        }
      }

      report.summary.classificationValidation = validationResult;

      step.metrics = {
        totalValidated: totalUsers,
        achievedCount: validationResult.actualTotals.achieved,
        underperformedCount: validationResult.actualTotals.underperformed,
        afkCount: validationResult.actualTotals.afk,
        discrepancyCount: validationResult.discrepancies.length,
        duplicateUsers: userIds.length - uniqueUserIds.size,
        dataQualityScore: Math.round(
          ((totalUsers - usersWithInvalidTime - usersWithNegativeTime) / Math.max(totalUsers, 1)) * 100
        )
      };

      if (!validationResult.isValid || step.errors!.length > 0) {
        step.status = 'failed';
        report.failedSteps++;
      } else if (validationResult.warnings.length > 0 || step.warnings!.length > 0) {
        step.status = 'warning';
        report.warningSteps++;
      } else {
        step.status = 'success';
        report.completedSteps++;
      }

    } catch (error) {
      step.status = 'failed';
      step.errors!.push(`분류 데이터 검증 중 오류: ${error instanceof Error ? error.message : String(error)}`);
      report.failedSteps++;
    }

    step.endTime = new Date();
    step.duration = step.endTime.getTime() - step.startTime!.getTime();
    report.steps.push(step);
    progressCallback?.(step);
  }

  /**
   * 6단계: 임베드 구조 사전 검증
   */
  private async validateEmbedStructure(
    report: ReportValidationReport,
    classificationResult: UserClassificationResult,
    progressCallback?: ProgressCallback
  ): Promise<EmbedBuilder[]> {
    const step: ValidationStep = {
      stepId: 'embed_structure_validation',
      name: '임베드 구조 사전 검증',
      description: '생성될 임베드의 구조와 Discord 제한 준수를 사전 검증합니다',
      status: 'running',
      startTime: new Date(),
      errors: [],
      warnings: [],
      suggestions: []
    };

    let embeds: EmbedBuilder[] = [];

    try {
      progressCallback?.(step);

      // EmbedFactory를 사용해 임베드 생성 (실제 전송 전 검증용)
      const { EmbedFactory } = await import('../utils/embedBuilder');
      
      const embedData = {
        role: classificationResult.reportCycle || 'test',
        activeUsers: classificationResult.activeUsers,
        inactiveUsers: classificationResult.inactiveUsers,
        afkUsers: classificationResult.afkUsers,
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        endDate: new Date(),
        minHours: classificationResult.minHours || 4,
        reportCycle: 1
      };

      embeds = EmbedFactory.createActivityEmbeds(embedData, {
        sortByTime: true,
        includeTimestamp: true,
        maxFieldLength: 1024
      });

      // 각 임베드 개별 검증
      const embedValidations: any[] = [];
      let totalViolations = 0;
      let totalWarnings = 0;

      for (let i = 0; i < embeds.length; i++) {
        const embed = embeds[i];
        const embedValidation = EmbedValidator.validateEmbed(embed, {
          strictMode: false,
          includeWarnings: true,
          validateUrls: true,
          checkAccessibility: true
        });

        embedValidations.push({
          embedIndex: i,
          isValid: embedValidation.isValid,
          characterCount: embedValidation.totalCharacters,
          fieldCount: embedValidation.totalFields,
          violations: embedValidation.violations,
          warnings: embedValidation.warnings
        });

        totalViolations += embedValidation.violations.length;
        totalWarnings += embedValidation.warnings.length;

        // 심각한 위반 사항 확인
        const criticalViolations = embedValidation.violations.filter(v => v.severity === 'critical');
        if (criticalViolations.length > 0) {
          step.errors!.push(`임베드 ${i + 1}: ${criticalViolations.length}개의 심각한 위반`);
          criticalViolations.forEach(violation => {
            step.errors!.push(`  - ${violation.message}`);
          });
        }

        // 경고 사항 확인
        if (embedValidation.warnings.length > 0) {
          step.warnings!.push(`임베드 ${i + 1}: ${embedValidation.warnings.length}개의 경고`);
        }
      }

      // 전체 임베드 세트 검증
      const totalCharacters = embedValidations.reduce((sum, ev) => sum + ev.characterCount, 0);
      const maxCharactersPerMessage = 6000;
      const maxEmbedsPerMessage = 10;

      if (embeds.length > maxEmbedsPerMessage) {
        step.warnings!.push(`임베드 수가 Discord 제한을 초과합니다: ${embeds.length}개 (최대 ${maxEmbedsPerMessage}개)`);
        step.suggestions!.push('임베드 청킹 시스템을 사용하여 여러 메시지로 분할하세요');
      }

      if (totalCharacters > maxCharactersPerMessage * embeds.length) {
        step.warnings!.push(`총 문자 수가 권장 한도를 초과합니다: ${totalCharacters}자`);
      }

      step.metrics = {
        embedCount: embeds.length,
        totalCharacters,
        totalViolations,
        totalWarnings,
        averageCharactersPerEmbed: Math.round(totalCharacters / Math.max(embeds.length, 1)),
        validEmbedCount: embedValidations.filter(ev => ev.isValid).length,
        structuralIntegrityScore: Math.round(
          (embedValidations.filter(ev => ev.isValid).length / Math.max(embeds.length, 1)) * 100
        )
      };

      if (totalViolations > 0) {
        step.status = 'failed';
        report.failedSteps++;
      } else if (totalWarnings > 0 || step.warnings!.length > 0) {
        step.status = 'warning';
        report.warningSteps++;
      } else {
        step.status = 'success';
        report.completedSteps++;
      }

    } catch (error) {
      step.status = 'failed';
      step.errors!.push(`임베드 구조 검증 중 오류: ${error instanceof Error ? error.message : String(error)}`);
      report.failedSteps++;
    }

    step.endTime = new Date();
    step.duration = step.endTime.getTime() - step.startTime!.getTime();
    report.steps.push(step);
    progressCallback?.(step);

    return embeds;
  }

  /**
   * 7단계: 메시지 크기 및 형식 검증
   */
  private async validateMessageSizeAndFormat(
    report: ReportValidationReport,
    embeds: EmbedBuilder[],
    progressCallback?: ProgressCallback
  ): Promise<void> {
    const step: ValidationStep = {
      stepId: 'message_size_format_validation',
      name: '메시지 크기 및 형식 검증',
      description: '최종 메시지의 크기, 형식, 전송 가능성을 검증합니다',
      status: 'running',
      startTime: new Date(),
      errors: [],
      warnings: [],
      suggestions: []
    };

    try {
      progressCallback?.(step);

      const validationResult: MessageValidationResult = {
        isValid: true,
        embeds: [],
        totalCharacters: 0,
        totalEmbeds: embeds.length,
        estimatedSendTime: 0,
        chunksRequired: 1,
        warnings: [],
        suggestions: []
      };

      // 각 임베드 검증
      for (let i = 0; i < embeds.length; i++) {
        const embed = embeds[i];
        const embedValidation = EmbedValidator.validateEmbed(embed, {
          strictMode: true,
          includeWarnings: true
        });

        const embedResult = {
          embedIndex: i,
          isValid: embedValidation.isValid,
          characterCount: embedValidation.totalCharacters,
          fieldCount: embedValidation.totalFields,
          violations: embedValidation.violations,
          warnings: embedValidation.warnings
        };

        validationResult.embeds.push(embedResult);
        validationResult.totalCharacters += embedValidation.totalCharacters;

        if (!embedValidation.isValid) {
          validationResult.isValid = false;
          step.errors!.push(`임베드 ${i + 1} 검증 실패: ${embedValidation.violations.length}개 위반`);
        }
      }

      // 청킹 필요성 평가
      const DISCORD_LIMITS = {
        MAX_EMBEDS_PER_MESSAGE: 10,
        MAX_CHARACTERS_PER_EMBED: 6000,
        MAX_FIELDS_PER_EMBED: 25
      };

      if (embeds.length > DISCORD_LIMITS.MAX_EMBEDS_PER_MESSAGE) {
        validationResult.chunksRequired = Math.ceil(embeds.length / DISCORD_LIMITS.MAX_EMBEDS_PER_MESSAGE);
        validationResult.warnings.push(`임베드 수가 한 메시지 제한을 초과하여 ${validationResult.chunksRequired}개 청크가 필요합니다`);
        step.warnings!.push('임베드 청킹 필요');
      }

      // 전송 시간 추정 (1초당 1개 임베드 + 네트워크 지연)
      validationResult.estimatedSendTime = (embeds.length * 1000) + (validationResult.chunksRequired * 500);

      if (validationResult.estimatedSendTime > 30000) { // 30초 초과
        validationResult.warnings.push(`예상 전송 시간이 깁니다: ${Math.round(validationResult.estimatedSendTime / 1000)}초`);
        validationResult.suggestions.push('사용자에게 진행 상황을 알리는 메시지를 먼저 보내는 것을 고려하세요');
      }

      // 형식 준수성 검증
      let formatIssues = 0;
      for (const embedResult of validationResult.embeds) {
        if (embedResult.fieldCount > DISCORD_LIMITS.MAX_FIELDS_PER_EMBED) {
          formatIssues++;
          step.errors!.push(`임베드 ${embedResult.embedIndex + 1}: 필드 수 초과 (${embedResult.fieldCount}/${DISCORD_LIMITS.MAX_FIELDS_PER_EMBED})`);
        }

        if (embedResult.characterCount > DISCORD_LIMITS.MAX_CHARACTERS_PER_EMBED) {
          formatIssues++;
          step.errors!.push(`임베드 ${embedResult.embedIndex + 1}: 문자 수 초과 (${embedResult.characterCount}/${DISCORD_LIMITS.MAX_CHARACTERS_PER_EMBED})`);
        }
      }

      if (formatIssues > 0) {
        validationResult.isValid = false;
        step.suggestions!.push('EmbedChunkingSystem을 사용하여 자동으로 청킹하고 전송하세요');
      }

      report.summary.messageValidation = validationResult;

      step.metrics = {
        totalEmbeds: embeds.length,
        totalCharacters: validationResult.totalCharacters,
        chunksRequired: validationResult.chunksRequired,
        estimatedSendTime: validationResult.estimatedSendTime,
        formatIssues,
        validEmbeds: validationResult.embeds.filter(e => e.isValid).length,
        averageCharactersPerEmbed: Math.round(validationResult.totalCharacters / Math.max(embeds.length, 1)),
        complianceScore: Math.round(
          (validationResult.embeds.filter(e => e.isValid).length / Math.max(embeds.length, 1)) * 100
        )
      };

      if (!validationResult.isValid || formatIssues > 0) {
        step.status = 'failed';
        report.failedSteps++;
      } else if (validationResult.warnings.length > 0 || step.warnings!.length > 0) {
        step.status = 'warning';
        report.warningSteps++;
      } else {
        step.status = 'success';
        report.completedSteps++;
      }

    } catch (error) {
      step.status = 'failed';
      step.errors!.push(`메시지 크기/형식 검증 중 오류: ${error instanceof Error ? error.message : String(error)}`);
      report.failedSteps++;
    }

    step.endTime = new Date();
    step.duration = step.endTime.getTime() - step.startTime!.getTime();
    report.steps.push(step);
    progressCallback?.(step);
  }

  /**
   * 8단계: 최종 전송 준비 상태 검증
   */
  private async validateFinalSendReadiness(
    report: ReportValidationReport,
    interaction: ChatInputCommandInteraction,
    embeds: EmbedBuilder[],
    progressCallback?: ProgressCallback
  ): Promise<void> {
    const step: ValidationStep = {
      stepId: 'final_send_readiness',
      name: '최종 전송 준비 상태 검증',
      description: '모든 준비가 완료되어 안전하게 전송할 수 있는지 최종 확인합니다',
      status: 'running',
      startTime: new Date(),
      errors: [],
      warnings: [],
      suggestions: []
    };

    try {
      progressCallback?.(step);

      // 상호작용 상태 재확인
      const now = Date.now();
      const timeElapsed = now - interaction.createdTimestamp;
      const canStillRespond = interaction.deferred || interaction.replied || timeElapsed < 3000;

      if (!canStillRespond) {
        step.errors!.push('Discord 상호작용이 만료되어 응답할 수 없습니다');
      }

      // 채널 권한 재확인
      if (interaction.channel && interaction.guild?.members.me) {
        const permissions = interaction.channel.permissionsFor(interaction.guild.members.me);
        if (!permissions?.has('SendMessages')) {
          step.errors!.push('메시지 전송 권한이 없습니다');
        }
        if (!permissions?.has('EmbedLinks')) {
          step.warnings!.push('임베드 링크 권한이 없어 일반 텍스트로 전송됩니다');
        }
      }

      // 임베드 최종 검증
      let readyEmbeds = 0;
      let problematicEmbeds = 0;

      for (let i = 0; i < embeds.length; i++) {
        const isValid = EmbedValidator.quickValidate(embeds[i]);
        if (isValid) {
          readyEmbeds++;
        } else {
          problematicEmbeds++;
          step.warnings!.push(`임베드 ${i + 1}에 여전히 문제가 있습니다`);
        }
      }

      // 전송 전략 결정
      const totalMessageCount = Math.ceil(embeds.length / 10); // 최대 10개 임베드/메시지
      const estimatedTotalTime = totalMessageCount * 1500; // 메시지당 1.5초 간격

      if (estimatedTotalTime > 60000) { // 1분 초과
        step.warnings!.push(`전송 완료까지 ${Math.round(estimatedTotalTime / 1000)}초 예상`);
        step.suggestions!.push('사용자에게 처리 중임을 알리는 메시지를 먼저 전송하세요');
      }

      // 메모리 및 리소스 확인
      const memoryUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
      
      if (heapUsedMB > 512) { // 512MB 이상
        step.warnings!.push(`메모리 사용량이 높습니다: ${heapUsedMB}MB`);
        step.suggestions!.push('가비지 컬렉션 또는 메모리 정리를 고려하세요');
      }

      // 최종 준비 상태 점수 계산
      let readinessScore = 100;
      
      if (step.errors!.length > 0) readinessScore -= step.errors!.length * 25;
      if (problematicEmbeds > 0) readinessScore -= problematicEmbeds * 10;
      if (step.warnings!.length > 0) readinessScore -= step.warnings!.length * 5;

      readinessScore = Math.max(0, readinessScore);

      step.metrics = {
        canRespond: canStillRespond,
        timeElapsed,
        readyEmbeds,
        problematicEmbeds,
        totalMessageCount,
        estimatedTotalTime,
        memoryUsageMB: heapUsedMB,
        readinessScore,
        recommendedAction: readinessScore >= 80 ? 'proceed' : readinessScore >= 60 ? 'proceed_with_caution' : 'abort'
      };

      if (step.errors!.length > 0 || readinessScore < 50) {
        step.status = 'failed';
        report.failedSteps++;
        report.summary.criticalIssues.push('전송 준비 상태 불량 - 전송 중단 권장');
      } else if (step.warnings!.length > 0 || readinessScore < 80) {
        step.status = 'warning';
        report.warningSteps++;
        report.summary.recommendations.push('주의사항을 검토한 후 전송 진행');
      } else {
        step.status = 'success';
        report.completedSteps++;
        report.summary.recommendations.push('전송 준비 완료 - 안전하게 진행 가능');
      }

    } catch (error) {
      step.status = 'failed';
      step.errors!.push(`최종 준비 상태 검증 중 오류: ${error instanceof Error ? error.message : String(error)}`);
      report.failedSteps++;
    }

    step.endTime = new Date();
    step.duration = step.endTime.getTime() - step.startTime!.getTime();
    report.steps.push(step);
    progressCallback?.(step);
  }

  /**
   * 전체 상태 결정
   */
  private determineOverallStatus(report: ReportValidationReport): 'success' | 'warning' | 'failed' {
    if (report.failedSteps > 0) {
      return 'failed';
    } else if (report.warningSteps > 0) {
      return 'warning';
    } else {
      return 'success';
    }
  }

  /**
   * 📊 실시간 진행 상황 모니터링
   */
  async monitorValidationProgress(
    reportId: string,
    callback: (progress: {
      reportId: string;
      currentStep: number;
      totalSteps: number;
      currentStepName: string;
      overallProgress: number;
      status: string;
    }) => void
  ): Promise<void> {
    const report = this.activeValidation.get(reportId);
    if (!report) return;

    const intervalId = setInterval(() => {
      const currentStep = report.completedSteps + report.failedSteps + report.warningSteps + 1;
      const overallProgress = Math.round((report.completedSteps / report.totalSteps) * 100);
      const runningStep = report.steps.find(s => s.status === 'running');
      
      callback({
        reportId,
        currentStep: Math.min(currentStep, report.totalSteps),
        totalSteps: report.totalSteps,
        currentStepName: runningStep?.name || '완료',
        overallProgress,
        status: report.overallStatus
      });

      // 검증 완료시 모니터링 중단
      if (report.completedSteps + report.failedSteps + report.warningSteps >= report.totalSteps) {
        clearInterval(intervalId);
        this.activeValidation.delete(reportId);
      }
    }, 500); // 500ms마다 업데이트
  }

  /**
   * 📋 검증 보고서 생성
   */
  generateValidationReport(report: ReportValidationReport): string {
    const { reportId, timestamp, overallStatus, steps, summary, totalDuration } = report;
    
    let reportText = `\n🔍 **보고서 생성 검증 리포트**\n`;
    reportText += `📋 ID: \`${reportId}\`\n`;
    reportText += `⏰ 검증 시각: ${timestamp.toLocaleString('ko-KR')}\n`;
    reportText += `🏥 전체 상태: **${overallStatus.toUpperCase()}**\n`;
    reportText += `⏱️ 총 소요시간: ${totalDuration}ms\n`;
    reportText += `📊 진행률: ${report.completedSteps}/${report.totalSteps} (${Math.round((report.completedSteps/report.totalSteps)*100)}%)\n\n`;

    // 단계별 상세 정보
    reportText += `📋 **단계별 검증 결과**\n`;
    steps.forEach((step, index) => {
      const statusIcon = step.status === 'success' ? '✅' : step.status === 'warning' ? '⚠️' : step.status === 'failed' ? '❌' : '🔄';
      reportText += `${statusIcon} **${index + 1}. ${step.name}** (${step.duration || 0}ms)\n`;
      
      if (step.errors && step.errors.length > 0) {
        reportText += `   ❌ 오류: ${step.errors.join(', ')}\n`;
      }
      
      if (step.warnings && step.warnings.length > 0) {
        reportText += `   ⚠️ 경고: ${step.warnings.join(', ')}\n`;
      }
      
      if (step.metrics) {
        const metricsStr = Object.entries(step.metrics)
          .slice(0, 3) // 상위 3개만 표시
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ');
        if (metricsStr) {
          reportText += `   📊 ${metricsStr}\n`;
        }
      }
      reportText += `\n`;
    });

    // 요약 정보
    reportText += `📈 **검증 요약**\n`;
    reportText += `• 분류 검증: ${summary.classificationValidation.isValid ? '✅ 통과' : '❌ 실패'}\n`;
    reportText += `• 상호작용 검증: ${summary.interactionValidation.isValid ? '✅ 통과' : '❌ 실패'}\n`;
    reportText += `• 메시지 검증: ${summary.messageValidation.isValid ? '✅ 통과' : '❌ 실패'}\n`;
    
    if (summary.criticalIssues.length > 0) {
      reportText += `\n🚨 **치명적 문제점**\n`;
      summary.criticalIssues.forEach(issue => {
        reportText += `• ${issue}\n`;
      });
    }

    if (summary.recommendations.length > 0) {
      reportText += `\n💡 **권장사항**\n`;
      summary.recommendations.forEach(rec => {
        reportText += `• ${rec}\n`;
      });
    }

    return reportText;
  }
}