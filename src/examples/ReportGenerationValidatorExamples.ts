// src/examples/ReportGenerationValidatorExamples.ts - 보고서 생성 검증 시스템 사용 예제
import { 
  ChatInputCommandInteraction, 
  Collection, 
  GuildMember, 
  EmbedBuilder,
  TextChannel 
} from 'discord.js';
import { container } from 'tsyringe';

import { ReportGenerationValidator } from '../services/ReportGenerationValidator';
import type { 
  ReportValidationReport, 
  ValidationStep,
  ProgressCallback 
} from '../services/ReportGenerationValidator';
import { EmbedValidator } from '../utils/EmbedValidator';
import { EmbedFactory } from '../utils/embedBuilder';

/**
 * 보고서 생성 검증 시스템 사용 예제 모음
 */
export class ReportGenerationValidatorExamples {

  private validator: ReportGenerationValidator;

  constructor() {
    this.validator = container.resolve(ReportGenerationValidator);
  }

  /**
   * 예제 1: 기본 보고서 생성 검증
   */
  async example1_BasicReportValidation(
    interaction: ChatInputCommandInteraction,
    role: string,
    roleMembers: Collection<string, GuildMember>
  ): Promise<void> {
    console.log('🔍 예제 1: 기본 보고서 생성 검증');
    console.log('='.repeat(60));

    try {
      const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7일 전
      const endDate = new Date();

      console.log(`📊 검증 대상:`)
      console.log(`  • 역할: ${role}`);
      console.log(`  • 멤버 수: ${roleMembers.size}명`);
      console.log(`  • 기간: ${startDate.toLocaleDateString('ko-KR')} ~ ${endDate.toLocaleDateString('ko-KR')}`);
      console.log('');

      // 기본적인 진행 상황 콜백
      const progressCallback: ProgressCallback = (step: ValidationStep) => {
        const statusIcon = step.status === 'success' ? '✅' : 
                          step.status === 'warning' ? '⚠️' : 
                          step.status === 'failed' ? '❌' : '🔄';
        
        console.log(`${statusIcon} ${step.name} (${step.status.toUpperCase()})`);
        
        if (step.errors && step.errors.length > 0) {
          step.errors.forEach(error => console.log(`   ❌ ${error}`));
        }
        
        if (step.warnings && step.warnings.length > 0 && step.warnings.length <= 3) {
          step.warnings.forEach(warning => console.log(`   ⚠️ ${warning}`));
        }
      };

      // 검증 실행
      const validationStart = Date.now();
      const report = await this.validator.validateReportGeneration(
        interaction,
        role,
        roleMembers,
        startDate,
        endDate,
        progressCallback
      );
      const validationDuration = Date.now() - validationStart;

      console.log('');
      console.log('📋 **검증 완료 요약**');
      console.log(`  🏥 전체 상태: ${report.overallStatus.toUpperCase()}`);
      console.log(`  ⏱️ 검증 시간: ${validationDuration}ms`);
      console.log(`  📊 진행률: ${report.completedSteps}/${report.totalSteps} (${Math.round((report.completedSteps/report.totalSteps)*100)}%)`);
      console.log(`  ❌ 실패 단계: ${report.failedSteps}개`);
      console.log(`  ⚠️ 경고 단계: ${report.warningSteps}개`);

      // 분류 검증 결과
      const classValidation = report.summary.classificationValidation;
      console.log('');
      console.log('👥 **분류 검증 결과**');
      console.log(`  • 달성: ${classValidation.actualTotals.achieved}명`);
      console.log(`  • 미달성: ${classValidation.actualTotals.underperformed}명`);
      console.log(`  • 잠수: ${classValidation.actualTotals.afk}명`);
      console.log(`  • 총합: ${classValidation.actualTotals.total}명`);

      if (classValidation.discrepancies.length > 0) {
        console.log('  🔍 불일치 발견:');
        classValidation.discrepancies.forEach(disc => {
          console.log(`    • ${disc.field}: 예상 ${disc.expected}명, 실제 ${disc.actual}명 (차이: ${disc.difference})`);
        });
      }

      // 상호작용 상태
      const interactionValidation = report.summary.interactionValidation;
      console.log('');
      console.log('🤖 **Discord 상호작용 상태**');
      console.log(`  • 응답 가능: ${interactionValidation.canRespond ? 'YES' : 'NO'}`);
      console.log(`  • 남은 시간: ${Math.max(0, interactionValidation.timeRemaining)}ms`);
      console.log(`  • 지연됨: ${interactionValidation.hasDeferred ? 'YES' : 'NO'}`);
      console.log(`  • 응답됨: ${interactionValidation.hasReplied ? 'YES' : 'NO'}`);

      // 메시지 크기 정보
      const messageValidation = report.summary.messageValidation;
      console.log('');
      console.log('📄 **메시지 검증 결과**');
      console.log(`  • 임베드 수: ${messageValidation.totalEmbeds}개`);
      console.log(`  • 총 문자수: ${messageValidation.totalCharacters}자`);
      console.log(`  • 청킹 필요: ${messageValidation.chunksRequired > 1 ? `YES (${messageValidation.chunksRequired}개)` : 'NO'}`);
      console.log(`  • 예상 전송시간: ${Math.round(messageValidation.estimatedSendTime / 1000)}초`);

      // 중요 문제점 및 권장사항
      if (report.summary.criticalIssues.length > 0) {
        console.log('');
        console.log('🚨 **치명적 문제점**');
        report.summary.criticalIssues.forEach(issue => {
          console.log(`  • ${issue}`);
        });
      }

      if (report.summary.recommendations.length > 0) {
        console.log('');
        console.log('💡 **권장사항**');
        report.summary.recommendations.forEach(rec => {
          console.log(`  • ${rec}`);
        });
      }

      // 전송 권장 여부 결정
      console.log('');
      if (report.overallStatus === 'success') {
        console.log('✅ **권장사항: 안전하게 전송 진행**');
        await interaction.followUp({
          content: '✅ 보고서 검증 완료 - 모든 검증을 통과했습니다.',
          ephemeral: true
        });
      } else if (report.overallStatus === 'warning') {
        console.log('⚠️ **권장사항: 주의사항 검토 후 전송**');
        await interaction.followUp({
          content: '⚠️ 보고서 검증 완료 - 일부 경고사항이 있지만 전송 가능합니다.',
          ephemeral: true
        });
      } else {
        console.log('❌ **권장사항: 문제 해결 후 재시도**');
        await interaction.followUp({
          content: '❌ 보고서 검증 실패 - 문제를 해결한 후 다시 시도해주세요.',
          ephemeral: true
        });
      }

    } catch (error) {
      console.error('❌ 기본 검증 예제 오류:', error);
      await interaction.followUp({
        content: '⚠️ 검증 시스템에서 오류가 발생했습니다.',
        ephemeral: true
      });
    }

    console.log('');
  }

  /**
   * 예제 2: 실시간 진행 상황 모니터링
   */
  async example2_RealtimeProgressMonitoring(
    interaction: ChatInputCommandInteraction,
    role: string,
    roleMembers: Collection<string, GuildMember>
  ): Promise<void> {
    console.log('📊 예제 2: 실시간 진행 상황 모니터링');
    console.log('='.repeat(60));

    try {
      await interaction.deferReply({ ephemeral: true });

      const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const endDate = new Date();

      // 실시간 진행 상황 업데이트 메시지
      let progressMessage = await interaction.editReply({
        content: '🔄 보고서 생성 검증을 시작합니다...\n\n' +
                '📊 **진행 상황**\n' +
                '```\n' +
                '▱▱▱▱▱▱▱▱ 0% (0/8)\n' +
                '준비 중...\n' +
                '```'
      });

      // 진행 상황 콜백 - Discord 메시지 업데이트
      const progressCallback: ProgressCallback = async (step: ValidationStep) => {
        const statusIcon = step.status === 'success' ? '✅' : 
                          step.status === 'warning' ? '⚠️' : 
                          step.status === 'failed' ? '❌' : '🔄';
        
        console.log(`${statusIcon} ${step.name} (${step.duration || 0}ms)`);

        // 진행률 계산
        const report = Array.from((this.validator as any).activeValidation.values())[0];
        if (report) {
          const currentStep = report.completedSteps + report.failedSteps + report.warningSteps;
          const progress = Math.round((currentStep / report.totalSteps) * 100);
          const progressBar = '█'.repeat(Math.floor(progress / 12.5)) + '▱'.repeat(8 - Math.floor(progress / 12.5));
          
          try {
            await interaction.editReply({
              content: '🔍 보고서 생성 검증 진행 중...\n\n' +
                      '📊 **진행 상황**\n' +
                      '```\n' +
                      `${progressBar} ${progress}% (${currentStep}/${report.totalSteps})\n` +
                      `현재: ${step.name}\n` +
                      `상태: ${step.status.toUpperCase()}\n` +
                      '```\n\n' +
                      `⏱️ **최근 단계 소요시간**: ${step.duration || 0}ms`
            });
          } catch (editError) {
            console.log('메시지 업데이트 건너뜀 (Discord 제한)');
          }
        }
      };

      // 검증 실행
      const validationStart = Date.now();
      const report = await this.validator.validateReportGeneration(
        interaction,
        role,
        roleMembers,
        startDate,
        endDate,
        progressCallback
      );
      const validationDuration = Date.now() - validationStart;

      // 최종 결과 업데이트
      const finalStatusIcon = report.overallStatus === 'success' ? '✅' : 
                             report.overallStatus === 'warning' ? '⚠️' : '❌';
      
      const resultEmbed = new EmbedBuilder()
        .setTitle(`${finalStatusIcon} 보고서 생성 검증 완료`)
        .setColor(report.overallStatus === 'success' ? 0x00ff00 : 
                 report.overallStatus === 'warning' ? 0xffff00 : 0xff0000)
        .addFields(
          { 
            name: '📊 전체 결과', 
            value: `상태: **${report.overallStatus.toUpperCase()}**\n` +
                   `진행률: ${report.completedSteps}/${report.totalSteps} (${Math.round((report.completedSteps/report.totalSteps)*100)}%)\n` +
                   `소요시간: ${validationDuration}ms`,
            inline: false 
          },
          { 
            name: '👥 분류 결과', 
            value: `달성: ${report.summary.classificationValidation.actualTotals.achieved}명\n` +
                   `미달성: ${report.summary.classificationValidation.actualTotals.underperformed}명\n` +
                   `잠수: ${report.summary.classificationValidation.actualTotals.afk}명`,
            inline: true 
          },
          { 
            name: '📄 메시지 정보', 
            value: `임베드: ${report.summary.messageValidation.totalEmbeds}개\n` +
                   `문자수: ${report.summary.messageValidation.totalCharacters}자\n` +
                   `청킹: ${report.summary.messageValidation.chunksRequired > 1 ? 'YES' : 'NO'}`,
            inline: true 
          }
        )
        .setTimestamp();

      if (report.summary.criticalIssues.length > 0) {
        resultEmbed.addFields({
          name: '🚨 중요 문제점',
          value: report.summary.criticalIssues.slice(0, 3).join('\n') + 
                (report.summary.criticalIssues.length > 3 ? `\n... 외 ${report.summary.criticalIssues.length - 3}개 더` : ''),
          inline: false
        });
      }

      if (report.summary.recommendations.length > 0) {
        resultEmbed.addFields({
          name: '💡 권장사항',
          value: report.summary.recommendations.slice(0, 3).join('\n') + 
                (report.summary.recommendations.length > 3 ? `\n... 외 ${report.summary.recommendations.length - 3}개 더` : ''),
          inline: false
        });
      }

      await interaction.editReply({
        content: null,
        embeds: [resultEmbed]
      });

      console.log(`✅ 실시간 모니터링 예제 완료 (${validationDuration}ms)`);

    } catch (error) {
      console.error('❌ 실시간 모니터링 예제 오류:', error);
      await interaction.editReply({
        content: '⚠️ 실시간 모니터링 중 오류가 발생했습니다.',
        embeds: []
      });
    }

    console.log('');
  }

  /**
   * 예제 3: 상세 검증 보고서 생성 및 DM 전송
   */
  async example3_DetailedValidationReport(
    interaction: ChatInputCommandInteraction,
    role: string,
    roleMembers: Collection<string, GuildMember>
  ): Promise<void> {
    console.log('📋 예제 3: 상세 검증 보고서 생성');
    console.log('='.repeat(60));

    try {
      await interaction.deferReply({ ephemeral: true });

      const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const endDate = new Date();

      console.log('🔍 상세 검증 실행 중...');

      // 검증 실행 (진행 상황 콘솔 출력)
      const report = await this.validator.validateReportGeneration(
        interaction,
        role,
        roleMembers,
        startDate,
        endDate,
        (step) => {
          const icon = step.status === 'success' ? '✅' : 
                      step.status === 'warning' ? '⚠️' : 
                      step.status === 'failed' ? '❌' : '🔄';
          console.log(`  ${icon} ${step.name} (${step.duration || 0}ms)`);
        }
      );

      // 상세 텍스트 보고서 생성
      const detailedReport = this.validator.generateValidationReport(report);

      console.log('📄 상세 보고서 생성 완료');

      // 채널에 요약 전송
      const summaryEmbed = new EmbedBuilder()
        .setTitle('📋 보고서 검증 완료')
        .setDescription('상세 검증 보고서를 생성했습니다.')
        .addFields(
          { 
            name: '📊 요약', 
            value: `상태: ${report.overallStatus.toUpperCase()}\n` +
                   `완료: ${report.completedSteps}/${report.totalSteps}\n` +
                   `소요시간: ${report.totalDuration}ms`,
            inline: true 
          },
          { 
            name: '🔍 분석 결과', 
            value: `성공: ${report.completedSteps}개\n` +
                   `경고: ${report.warningSteps}개\n` +
                   `실패: ${report.failedSteps}개`,
            inline: true 
          }
        )
        .setColor(report.overallStatus === 'success' ? 0x00ff00 : 
                 report.overallStatus === 'warning' ? 0xffff00 : 0xff0000)
        .setFooter({ text: '상세 보고서는 DM으로 전송됩니다.' })
        .setTimestamp();

      await interaction.editReply({ embeds: [summaryEmbed] });

      // DM으로 상세 보고서 전송
      try {
        console.log('📤 상세 보고서 DM 전송 중...');
        
        // 보고서가 너무 길면 여러 메시지로 분할
        const maxLength = 1900; // Discord 메시지 제한 고려
        const reportParts = [];
        
        if (detailedReport.length <= maxLength) {
          reportParts.push(detailedReport);
        } else {
          const lines = detailedReport.split('\n');
          let currentPart = '';
          
          for (const line of lines) {
            if (currentPart.length + line.length + 1 <= maxLength) {
              currentPart += line + '\n';
            } else {
              if (currentPart) reportParts.push(currentPart);
              currentPart = line + '\n';
            }
          }
          if (currentPart) reportParts.push(currentPart);
        }

        for (let i = 0; i < reportParts.length; i++) {
          const part = reportParts[i];
          const embed = new EmbedBuilder()
            .setTitle(i === 0 ? '📋 상세 검증 보고서' : `📋 상세 검증 보고서 (${i + 1}/${reportParts.length})`)
            .setDescription(`\`\`\`\n${part}\n\`\`\``)
            .setColor(0x0099ff)
            .setTimestamp();

          await interaction.user.send({ embeds: [embed] });
          
          // 연속 전송 제한 방지
          if (i < reportParts.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        console.log(`✅ 상세 보고서 DM 전송 완료 (${reportParts.length}개 메시지)`);

        // 전송 완료 알림
        await interaction.followUp({
          content: '✅ 상세 검증 보고서가 DM으로 전송되었습니다.',
          ephemeral: true
        });

      } catch (dmError) {
        console.error('DM 전송 실패:', dmError);
        
        // DM 실패 시 채널에 요약된 보고서 전송
        const shortReport = detailedReport.substring(0, 1800) + (detailedReport.length > 1800 ? '\n\n... (내용 생략)' : '');
        
        const fallbackEmbed = new EmbedBuilder()
          .setTitle('📋 검증 보고서 (DM 전송 실패)')
          .setDescription(`\`\`\`\n${shortReport}\n\`\`\``)
          .setColor(0xff9900)
          .setFooter({ text: 'DM 설정을 확인해주세요. 전체 보고서는 DM으로만 전송됩니다.' })
          .setTimestamp();

        await interaction.followUp({ 
          embeds: [fallbackEmbed],
          ephemeral: true 
        });
      }

    } catch (error) {
      console.error('❌ 상세 보고서 예제 오류:', error);
      await interaction.editReply({
        content: '⚠️ 상세 검증 보고서 생성 중 오류가 발생했습니다.',
        embeds: []
      });
    }

    console.log('');
  }

  /**
   * 예제 4: 문제점 감지 및 자동 복구 제안
   */
  async example4_IssueDetectionAndRecovery(
    interaction: ChatInputCommandInteraction,
    role: string,
    roleMembers: Collection<string, GuildMember>
  ): Promise<void> {
    console.log('🔧 예제 4: 문제점 감지 및 자동 복구');
    console.log('='.repeat(60));

    try {
      await interaction.deferReply({ ephemeral: true });

      // 의도적으로 문제가 있는 시나리오 생성 (데모용)
      const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1년 전 (매우 긴 기간)
      const endDate = new Date();

      console.log('🔍 문제점 감지 테스트 시작...');

      let detectedIssues: string[] = [];
      let recoveryActions: string[] = [];

      const progressCallback: ProgressCallback = (step: ValidationStep) => {
        console.log(`🔍 ${step.name}: ${step.status}`);

        // 문제점 및 복구 방안 수집
        if (step.errors && step.errors.length > 0) {
          detectedIssues.push(...step.errors);
        }
        
        if (step.suggestions && step.suggestions.length > 0) {
          recoveryActions.push(...step.suggestions);
        }
      };

      const report = await this.validator.validateReportGeneration(
        interaction,
        role,
        roleMembers,
        startDate,
        endDate,
        progressCallback
      );

      console.log('🔍 문제점 분석 완료');

      // 문제점 분류 및 해결책 제안
      const issueCategories = {
        critical: [] as string[],
        performance: [] as string[],
        compatibility: [] as string[],
        optimization: [] as string[]
      };

      const solutions = {
        immediate: [] as string[],
        recommended: [] as string[],
        optional: [] as string[]
      };

      // 문제점 분류
      detectedIssues.forEach(issue => {
        if (issue.includes('시간 제한') || issue.includes('만료')) {
          issueCategories.critical.push(issue);
          solutions.immediate.push('즉시 deferReply() 호출하여 응답 시간 연장');
        } else if (issue.includes('처리 시간') || issue.includes('성능')) {
          issueCategories.performance.push(issue);
          solutions.recommended.push('쿼리 최적화 또는 캐싱 시스템 도입');
        } else if (issue.includes('필드 수') || issue.includes('문자 수')) {
          issueCategories.compatibility.push(issue);
          solutions.recommended.push('EmbedChunkingSystem 사용하여 자동 분할');
        } else {
          issueCategories.optimization.push(issue);
          solutions.optional.push('사용자 경험 개선을 위한 최적화');
        }
      });

      // 복구 방안 추가
      recoveryActions.forEach(action => {
        if (action.includes('즉시') || action.includes('긴급')) {
          solutions.immediate.push(action);
        } else if (action.includes('권장') || action.includes('추천')) {
          solutions.recommended.push(action);
        } else {
          solutions.optional.push(action);
        }
      });

      // 결과 임베드 생성
      const issueEmbed = new EmbedBuilder()
        .setTitle('🔧 문제점 감지 및 복구 분석')
        .setColor(report.overallStatus === 'failed' ? 0xff0000 : 0xff9900)
        .addFields(
          {
            name: '📊 전체 상황',
            value: `상태: ${report.overallStatus.toUpperCase()}\n` +
                   `감지된 문제: ${detectedIssues.length}개\n` +
                   `제안된 해결책: ${recoveryActions.length}개`,
            inline: false
          }
        );

      // 문제점 카테고리별 표시
      if (issueCategories.critical.length > 0) {
        issueEmbed.addFields({
          name: '🚨 치명적 문제',
          value: issueCategories.critical.slice(0, 3).join('\n') + 
                (issueCategories.critical.length > 3 ? `\n... 외 ${issueCategories.critical.length - 3}개` : ''),
          inline: false
        });
      }

      if (issueCategories.performance.length > 0) {
        issueEmbed.addFields({
          name: '⚡ 성능 문제',
          value: issueCategories.performance.slice(0, 2).join('\n') + 
                (issueCategories.performance.length > 2 ? `\n... 외 ${issueCategories.performance.length - 2}개` : ''),
          inline: true
        });
      }

      if (issueCategories.compatibility.length > 0) {
        issueEmbed.addFields({
          name: '🔧 호환성 문제',
          value: issueCategories.compatibility.slice(0, 2).join('\n') + 
                (issueCategories.compatibility.length > 2 ? `\n... 외 ${issueCategories.compatibility.length - 2}개` : ''),
          inline: true
        });
      }

      // 해결책 제시
      if (solutions.immediate.length > 0) {
        issueEmbed.addFields({
          name: '🆘 즉시 조치 필요',
          value: solutions.immediate.slice(0, 2).join('\n') + 
                (solutions.immediate.length > 2 ? `\n... 외 ${solutions.immediate.length - 2}개` : ''),
          inline: false
        });
      }

      if (solutions.recommended.length > 0) {
        issueEmbed.addFields({
          name: '💡 권장 조치',
          value: solutions.recommended.slice(0, 3).join('\n') + 
                (solutions.recommended.length > 3 ? `\n... 외 ${solutions.recommended.length - 3}개` : ''),
          inline: false
        });
      }

      issueEmbed.setFooter({ 
        text: `분석 완료: ${new Date().toLocaleString('ko-KR')} | 총 ${report.totalDuration}ms 소요` 
      });

      await interaction.editReply({ embeds: [issueEmbed] });

      // 자동 복구 가능한 항목들 제안
      if (report.overallStatus === 'warning' && solutions.immediate.length === 0) {
        console.log('💡 자동 복구 옵션 제공');
        
        const recoveryEmbed = new EmbedBuilder()
          .setTitle('🔄 자동 복구 옵션')
          .setDescription('일부 문제는 자동으로 해결할 수 있습니다.')
          .setColor(0x00ff00)
          .addFields(
            {
              name: '✨ 가능한 자동 복구',
              value: '• 임베드 자동 최적화\n' +
                     '• 필드 수 초과시 자동 청킹\n' +
                     '• 문자 수 초과시 자동 압축\n' +
                     '• 전송 시간 최적화',
              inline: false
            },
            {
              name: '⚙️ 권장 설정',
              value: '• EmbedChunkingSystem 활성화\n' +
                     '• 실시간 검증 모드 사용\n' +
                     '• 진행 상황 알림 설정',
              inline: false
            }
          )
          .setFooter({ text: '자동 복구는 향후 업데이트에서 지원될 예정입니다.' });

        await interaction.followUp({ 
          embeds: [recoveryEmbed],
          ephemeral: true 
        });
      }

      console.log(`✅ 문제점 감지 분석 완료 - ${detectedIssues.length}개 문제, ${recoveryActions.length}개 해결책`);

    } catch (error) {
      console.error('❌ 문제점 감지 예제 오류:', error);
      await interaction.editReply({
        content: '⚠️ 문제점 감지 시스템에서 오류가 발생했습니다.',
        embeds: []
      });
    }

    console.log('');
  }

  /**
   * 예제 5: 성능 벤치마킹 및 최적화 분석
   */
  async example5_PerformanceBenchmarking(
    interaction: ChatInputCommandInteraction,
    role: string,
    roleMembers: Collection<string, GuildMember>
  ): Promise<void> {
    console.log('⚡ 예제 5: 성능 벤치마킹 분석');
    console.log('='.repeat(60));

    try {
      await interaction.deferReply({ ephemeral: true });

      const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const endDate = new Date();

      // 성능 메트릭 수집
      const performanceMetrics = {
        validationTimes: [] as number[],
        stepTimes: new Map<string, number[]>(),
        memoryUsage: [] as number[],
        totalDuration: 0,
        throughput: 0
      };

      console.log('📊 성능 벤치마킹 시작...');

      const benchmarkStart = Date.now();
      let stepCount = 0;

      const performanceCallback: ProgressCallback = (step: ValidationStep) => {
        stepCount++;
        const stepTime = step.duration || 0;
        
        if (!performanceMetrics.stepTimes.has(step.stepId)) {
          performanceMetrics.stepTimes.set(step.stepId, []);
        }
        performanceMetrics.stepTimes.get(step.stepId)!.push(stepTime);

        // 메모리 사용량 추적
        const memUsage = process.memoryUsage();
        performanceMetrics.memoryUsage.push(Math.round(memUsage.heapUsed / 1024 / 1024));

        console.log(`⚡ ${step.name}: ${stepTime}ms (메모리: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB)`);
      };

      // 검증 실행
      const report = await this.validator.validateReportGeneration(
        interaction,
        role,
        roleMembers,
        startDate,
        endDate,
        performanceCallback
      );

      const benchmarkEnd = Date.now();
      performanceMetrics.totalDuration = benchmarkEnd - benchmarkStart;
      performanceMetrics.throughput = Math.round((roleMembers.size / performanceMetrics.totalDuration) * 1000); // 멤버/초

      console.log('📈 성능 분석 완료');

      // 성능 통계 계산
      const stats = {
        avgStepTime: Math.round(performanceMetrics.totalDuration / stepCount),
        maxMemoryUsage: Math.max(...performanceMetrics.memoryUsage),
        minMemoryUsage: Math.min(...performanceMetrics.memoryUsage),
        memoryDelta: Math.max(...performanceMetrics.memoryUsage) - Math.min(...performanceMetrics.memoryUsage)
      };

      // 가장 느린/빠른 단계 찾기
      let slowestStep = { name: '', time: 0 };
      let fastestStep = { name: '', time: Infinity };

      for (const [stepId, times] of performanceMetrics.stepTimes.entries()) {
        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        if (avgTime > slowestStep.time) {
          slowestStep = { name: stepId, time: avgTime };
        }
        if (avgTime < fastestStep.time) {
          fastestStep = { name: stepId, time: avgTime };
        }
      }

      // 성능 등급 결정
      let performanceGrade = 'A';
      let performanceColor = 0x00ff00;

      if (performanceMetrics.totalDuration > 15000) { // 15초 초과
        performanceGrade = 'C';
        performanceColor = 0xff0000;
      } else if (performanceMetrics.totalDuration > 10000) { // 10초 초과
        performanceGrade = 'B';
        performanceColor = 0xff9900;
      }

      // 성능 보고서 생성
      const performanceEmbed = new EmbedBuilder()
        .setTitle('⚡ 성능 벤치마킹 결과')
        .setColor(performanceColor)
        .addFields(
          {
            name: '📊 전체 성능',
            value: `등급: **${performanceGrade}**\n` +
                   `총 소요시간: ${performanceMetrics.totalDuration}ms\n` +
                   `처리량: ${performanceMetrics.throughput} 멤버/초\n` +
                   `평균 단계시간: ${stats.avgStepTime}ms`,
            inline: true
          },
          {
            name: '💾 메모리 사용량',
            value: `최대: ${stats.maxMemoryUsage}MB\n` +
                   `최소: ${stats.minMemoryUsage}MB\n` +
                   `증가량: ${stats.memoryDelta}MB`,
            inline: true
          },
          {
            name: '🏃‍♂️ 단계별 성능',
            value: `가장 느림: ${slowestStep.name.replace('_', ' ')} (${Math.round(slowestStep.time)}ms)\n` +
                   `가장 빠름: ${fastestStep.name.replace('_', ' ')} (${Math.round(fastestStep.time)}ms)`,
            inline: false
          }
        );

      // 성능 개선 제안
      const optimizationSuggestions = [];

      if (performanceMetrics.totalDuration > 10000) {
        optimizationSuggestions.push('전체 처리 시간이 깁니다 - 캐싱 시스템 도입을 고려하세요');
      }

      if (stats.memoryDelta > 100) {
        optimizationSuggestions.push('메모리 사용량 증가가 큽니다 - 가비지 컬렉션 최적화 필요');
      }

      if (slowestStep.time > 5000) {
        optimizationSuggestions.push(`${slowestStep.name} 단계가 매우 느립니다 - 해당 단계 최적화 필요`);
      }

      if (performanceMetrics.throughput < 10) {
        optimizationSuggestions.push('처리량이 낮습니다 - 배치 처리 또는 병렬 처리 고려');
      }

      if (optimizationSuggestions.length > 0) {
        performanceEmbed.addFields({
          name: '🔧 최적화 제안',
          value: optimizationSuggestions.slice(0, 4).join('\n') + 
                (optimizationSuggestions.length > 4 ? `\n... 외 ${optimizationSuggestions.length - 4}개` : ''),
          inline: false
        });
      }

      // 성능 비교 기준점
      performanceEmbed.addFields({
        name: '📈 성능 기준',
        value: `🏆 우수: < 5초\n` +
               `👍 양호: 5-10초\n` +
               `⚠️ 보통: 10-15초\n` +
               `❌ 개선필요: > 15초`,
        inline: true
      });

      performanceEmbed.setFooter({ 
        text: `벤치마킹 완료: ${new Date().toLocaleString('ko-KR')} | ${roleMembers.size}명 처리` 
      });

      await interaction.editReply({ embeds: [performanceEmbed] });

      // 상세 성능 데이터를 콘솔에 출력
      console.log('📊 **상세 성능 데이터**');
      console.log(`  총 처리시간: ${performanceMetrics.totalDuration}ms`);
      console.log(`  처리 멤버수: ${roleMembers.size}명`);
      console.log(`  처리량: ${performanceMetrics.throughput} 멤버/초`);
      console.log(`  메모리 사용량: ${stats.minMemoryUsage}MB → ${stats.maxMemoryUsage}MB`);
      console.log(`  성능 등급: ${performanceGrade}`);
      
      console.log('\n  단계별 소요시간:');
      for (const [stepId, times] of performanceMetrics.stepTimes.entries()) {
        const avgTime = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
        console.log(`    ${stepId}: ${avgTime}ms`);
      }

      console.log(`✅ 성능 벤치마킹 완료 - 등급: ${performanceGrade}`);

    } catch (error) {
      console.error('❌ 성능 벤치마킹 예제 오류:', error);
      await interaction.editReply({
        content: '⚠️ 성능 벤치마킹 중 오류가 발생했습니다.',
        embeds: []
      });
    }

    console.log('');
  }

  /**
   * 모든 예제 실행 (테스트용)
   */
  async runAllExamples(
    interaction: ChatInputCommandInteraction,
    role: string,
    roleMembers: Collection<string, GuildMember>
  ): Promise<void> {
    console.log('🚀 보고서 생성 검증 시스템 예제 전체 실행');
    console.log('='.repeat(80));

    try {
      await this.example1_BasicReportValidation(interaction, role, roleMembers);
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기

      await this.example2_RealtimeProgressMonitoring(interaction, role, roleMembers);
      await new Promise(resolve => setTimeout(resolve, 2000));

      await this.example3_DetailedValidationReport(interaction, role, roleMembers);
      await new Promise(resolve => setTimeout(resolve, 2000));

      await this.example4_IssueDetectionAndRecovery(interaction, role, roleMembers);
      await new Promise(resolve => setTimeout(resolve, 2000));

      await this.example5_PerformanceBenchmarking(interaction, role, roleMembers);

      console.log('✅ 모든 예제 실행 완료');
      console.log('='.repeat(80));

    } catch (error) {
      console.error('❌ 전체 예제 실행 중 오류:', error);
    }
  }
}

/**
 * 통합 실행 함수
 */
export async function runReportValidationExamples(
  interaction: ChatInputCommandInteraction,
  role: string,
  roleMembers: Collection<string, GuildMember>,
  exampleType: string = '1'
): Promise<void> {
  const examples = new ReportGenerationValidatorExamples();

  switch (exampleType) {
    case '1':
      await examples.example1_BasicReportValidation(interaction, role, roleMembers);
      break;
    case '2':
      await examples.example2_RealtimeProgressMonitoring(interaction, role, roleMembers);
      break;
    case '3':
      await examples.example3_DetailedValidationReport(interaction, role, roleMembers);
      break;
    case '4':
      await examples.example4_IssueDetectionAndRecovery(interaction, role, roleMembers);
      break;
    case '5':
      await examples.example5_PerformanceBenchmarking(interaction, role, roleMembers);
      break;
    case 'all':
      await examples.runAllExamples(interaction, role, roleMembers);
      break;
    default:
      await interaction.reply({
        content: '사용 가능한 예제: 1-5, all',
        ephemeral: true
      });
  }
}

/**
 * reportCommand.ts와 통합하기 위한 헬퍼 함수
 */
export async function integrateWithReportCommand(
  interaction: ChatInputCommandInteraction,
  role: string,
  roleMembers: Collection<string, GuildMember>,
  startDate: Date,
  endDate: Date,
  enableValidation: boolean = true
): Promise<{ shouldProceed: boolean; validationReport?: ReportValidationReport }> {
  if (!enableValidation) {
    return { shouldProceed: true };
  }

  console.log('🔍 보고서 생성 사전 검증 실행...');

  try {
    const validator = container.resolve(ReportGenerationValidator);
    
    const validationReport = await validator.validateReportGeneration(
      interaction,
      role,
      roleMembers,
      startDate,
      endDate,
      (step) => {
        console.log(`  ${step.status === 'success' ? '✅' : step.status === 'warning' ? '⚠️' : step.status === 'failed' ? '❌' : '🔄'} ${step.name}`);
      }
    );

    // 검증 결과에 따른 진행 결정
    if (validationReport.overallStatus === 'failed') {
      console.log('❌ 검증 실패 - 보고서 생성 중단');
      
      await interaction.followUp({
        content: '❌ **보고서 생성 검증 실패**\n\n' +
                '심각한 문제가 감지되어 보고서 생성을 중단합니다.\n' +
                '관리자에게 문의하거나 잠시 후 다시 시도해주세요.',
        ephemeral: true
      });

      return { shouldProceed: false, validationReport };
    } else if (validationReport.overallStatus === 'warning') {
      console.log('⚠️ 검증 경고 - 주의사항과 함께 진행');
      
      const warningCount = validationReport.warningSteps;
      await interaction.followUp({
        content: `⚠️ **검증 완료 (경고 ${warningCount}개)**\n\n` +
                '일부 경고사항이 있지만 보고서 생성을 진행합니다.\n' +
                '처리 시간이 평소보다 오래 걸릴 수 있습니다.',
        ephemeral: true
      });

      return { shouldProceed: true, validationReport };
    } else {
      console.log('✅ 검증 성공 - 안전하게 진행');
      return { shouldProceed: true, validationReport };
    }

  } catch (error) {
    console.error('검증 시스템 오류:', error);
    
    // 검증 시스템 오류시에도 보고서 생성은 진행
    await interaction.followUp({
      content: '⚠️ 검증 시스템에서 오류가 발생했지만 보고서 생성을 계속 진행합니다.',
      ephemeral: true
    });

    return { shouldProceed: true };
  }
}