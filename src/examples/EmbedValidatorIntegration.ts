// src/examples/EmbedValidatorIntegration.ts - Integration examples with existing systems
import { EmbedBuilder, ChatInputCommandInteraction } from 'discord.js';
import { container } from 'tsyringe';

import { EmbedValidator } from '../utils/EmbedValidator';
import { EmbedFactory } from '../utils/embedBuilder';
import { IReliableEmbedSender, ThreeSectionReport } from '../interfaces/IReliableEmbedSender';
import { IEmbedChunkingSystem } from '../interfaces/IEmbedChunkingSystem';
import { DI_TOKENS } from '../interfaces/index';

/**
 * Discord embed validator를 기존 시스템과 통합하는 예제
 */
export class EmbedValidatorIntegration {
  private reliableEmbedSender: IReliableEmbedSender;
  private chunkingSystem: IEmbedChunkingSystem;

  constructor() {
    this.reliableEmbedSender = container.resolve(DI_TOKENS.IReliableEmbedSender);
    this.chunkingSystem = container.resolve(DI_TOKENS.IEmbedChunkingSystem);
  }

  /**
   * 예제 1: EmbedFactory와 통합된 검증
   */
  async example1_ValidatedEmbedFactory(interaction: ChatInputCommandInteraction) {
    console.log('🏭 예제 1: EmbedFactory 통합 검증');
    console.log('=' .repeat(50));

    try {
      // 활동 데이터 생성 (많은 사용자로 제한 테스트)
      const activityData = {
        role: 'Developer',
        activeUsers: Array.from({ length: 30 }, (_, i) => ({
          userId: `user${i + 1}`,
          nickname: `Developer${i + 1}`,
          totalTime: (i + 1) * 2 * 3600000, // 시간 단위: 밀리초
          isAfk: false
        })),
        inactiveUsers: Array.from({ length: 20 }, (_, i) => ({
          userId: `inactive${i + 1}`,
          nickname: `InactiveDev${i + 1}`,
          totalTime: i * 0.5 * 3600000,
          isAfk: false
        })),
        afkUsers: Array.from({ length: 10 }, (_, i) => ({
          userId: `afk${i + 1}`,
          nickname: `AFKDev${i + 1}`,
          totalTime: i * 0.2 * 3600000,
          isAfk: true,
          afkUntil: new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000)
        })),
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        endDate: new Date(),
        minHours: 5,
        reportCycle: 1
      };

      // EmbedFactory로 임베드 생성
      const embeds = EmbedFactory.createActivityEmbeds(activityData, {
        sortByTime: true,
        includeTimestamp: true,
        maxFieldLength: 1024
      });

      console.log(`📊 생성된 임베드 수: ${embeds.length}개`);

      // 각 임베드 검증
      for (let i = 0; i < embeds.length; i++) {
        const embed = embeds[i];
        const validation = EmbedValidator.validateEmbed(embed, {
          strictMode: false,
          includeWarnings: true,
          enableOptimizationSuggestions: true
        });

        console.log(`\n임베드 ${i + 1} 검증 결과:`);
        console.log(`  ✅ 유효성: ${validation.isValid ? 'PASS' : 'FAIL'}`);
        console.log(`  📝 문자수: ${validation.totalCharacters}/6000`);
        console.log(`  📑 필드수: ${validation.totalFields}/25`);
        console.log(`  🏥 상태: ${validation.summary.overallHealth.toUpperCase()}`);

        if (validation.violations.length > 0) {
          console.log(`  ❌ 오류 ${validation.violations.length}개:`);
          validation.violations.forEach(violation => {
            console.log(`     • ${violation.message}`);
          });
        }

        if (validation.warnings.length > 0) {
          console.log(`  ⚠️ 경고 ${validation.warnings.length}개:`);
          validation.warnings.slice(0, 3).forEach(warning => {
            console.log(`     • ${warning.message}`);
          });
          if (validation.warnings.length > 3) {
            console.log(`     ... 외 ${validation.warnings.length - 3}개 더`);
          }
        }

        // 검증 실패시 최적화 적용
        if (!validation.isValid) {
          console.log(`  🔧 최적화 적용 중...`);
          const optimization = EmbedValidator.optimizeEmbed(embed);
          
          if (optimization.spacesSaved > 0) {
            console.log(`     💾 ${optimization.spacesSaved}자 절약`);
            console.log(`     ⚙️ ${optimization.optimizations.length}개 최적화 적용`);
            embeds[i] = optimization.optimizedEmbed;
          }
        }
      }

      // 검증된 임베드 전송
      console.log(`\n📤 검증된 임베드 전송 중...`);
      for (const embed of embeds) {
        await interaction.followUp({ embeds: [embed] });
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기
      }

      console.log(`✅ 모든 임베드 전송 완료`);

    } catch (error) {
      console.error('❌ EmbedFactory 통합 오류:', error);
      await interaction.followUp({
        content: '⚠️ 임베드 생성 및 검증 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  }

  /**
   * 예제 2: ReliableEmbedSender와 통합된 검증
   */
  async example2_ValidatedReliableEmbedSender(interaction: ChatInputCommandInteraction) {
    console.log('🛡️ 예제 2: ReliableEmbedSender 통합 검증');
    console.log('=' .repeat(50));

    try {
      // 큰 3-섹션 보고서 생성 (검증 필요한 수준)
      const report: ThreeSectionReport = {
        achievementSection: {
          title: '✅ 활동 기준 달성 멤버',
          members: Array.from({ length: 50 }, (_, i) => ({
            name: `달성자${i + 1}`,
            value: `${(i + 5)}시간 ${(i * 15) % 60}분`,
            extra: `연속 활동: ${i + 1}주`
          }))
        },
        underperformanceSection: {
          title: '❌ 활동 기준 미달성 멤버',
          members: Array.from({ length: 30 }, (_, i) => ({
            name: `미달성자${i + 1}`,
            value: `${i + 1}시간 ${(i * 20) % 60}분`,
            extra: `부족: ${5 - (i + 1)}시간`
          }))
        },
        afkSection: {
          title: '💤 잠수 중인 멤버',
          members: Array.from({ length: 15 }, (_, i) => ({
            name: `잠수자${i + 1}`,
            value: `${i}시간 ${(i * 10) % 60}분`,
            extra: `해제예정: ${new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000).toLocaleDateString('ko-KR')}`
          }))
        }
      };

      // ReliableEmbedSender 검증 통합 옵션
      const sendOptions = {
        validateBeforeSend: true, // 전송 전 검증 활성화
        optimizeOnValidationFailure: true, // 검증 실패시 자동 최적화
        validationOptions: {
          strictMode: false,
          includeWarnings: true,
          enableOptimizationSuggestions: true,
          maxRecommendedFields: 15, // 더 보수적인 제한
          maxRecommendedCharacters: 4000
        }
      };

      console.log(`📊 보고서 섹션:`);
      console.log(`  ✅ 달성: ${report.achievementSection.members.length}명`);
      console.log(`  ❌ 미달성: ${report.underperformanceSection.members.length}명`);
      console.log(`  💤 잠수: ${report.afkSection?.members.length || 0}명`);

      // 사전 검증을 위한 dry-run
      console.log(`\n🔍 사전 검증 실행 중...`);
      const dryRunResult = await this.reliableEmbedSender.sendThreeSectionReport(
        interaction,
        report,
        { ...sendOptions, dryRun: true }
      );

      if (dryRunResult.embeds) {
        let totalViolations = 0;
        let totalWarnings = 0;

        for (let i = 0; i < dryRunResult.embeds.length; i++) {
          const embed = dryRunResult.embeds[i];
          const validation = EmbedValidator.validateEmbed(embed, sendOptions.validationOptions);
          
          totalViolations += validation.violations.length;
          totalWarnings += validation.warnings.length;

          console.log(`  임베드 ${i + 1}: ${validation.isValid ? '✅' : '❌'} (${validation.summary.overallHealth})`);
        }

        console.log(`\n📋 사전 검증 결과:`);
        console.log(`  📊 총 임베드: ${dryRunResult.embeds.length}개`);
        console.log(`  ❌ 총 오류: ${totalViolations}개`);
        console.log(`  ⚠️ 총 경고: ${totalWarnings}개`);

        if (totalViolations > 0) {
          console.log(`  🔧 자동 최적화가 적용됩니다.`);
        }
      }

      // 실제 전송 (검증 및 최적화 포함)
      console.log(`\n📤 검증된 임베드 전송 중...`);
      const sendResult = await this.reliableEmbedSender.sendThreeSectionReport(
        interaction,
        report,
        sendOptions
      );

      if (sendResult.success) {
        console.log(`✅ 전송 성공:`);
        console.log(`  📨 메시지 수: ${sendResult.messages?.length || 0}개`);
        console.log(`  ⏱️ 전송 시간: ${sendResult.sendTime || 0}ms`);
        console.log(`  📝 문자 압축: ${sendResult.compressionUsed ? '적용됨' : '미적용'}`);
        console.log(`  📁 텍스트 폴백: ${sendResult.fallbackUsed ? '사용됨' : '미사용'}`);
      } else {
        console.log(`❌ 전송 실패: ${sendResult.error}`);
      }

    } catch (error) {
      console.error('❌ ReliableEmbedSender 통합 오류:', error);
      await interaction.followUp({
        content: '⚠️ 신뢰성 있는 임베드 전송 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  }

  /**
   * 예제 3: EmbedChunkingSystem과 통합된 검증
   */
  async example3_ValidatedEmbedChunking(interaction: ChatInputCommandInteraction) {
    console.log('🧩 예제 3: EmbedChunkingSystem 통합 검증');
    console.log('=' .repeat(50));

    try {
      // 매우 큰 임베드 생성 (청킹이 필요한 수준)
      const largeEmbeds: EmbedBuilder[] = [];

      for (let embedIndex = 0; embedIndex < 8; embedIndex++) {
        const embed = new EmbedBuilder()
          .setTitle(`📊 대용량 보고서 섹션 ${embedIndex + 1}`)
          .setDescription(`이것은 매우 큰 보고서의 ${embedIndex + 1}번째 섹션입니다. 이 섹션에는 많은 데이터가 포함되어 있으며, Discord의 임베드 제한을 테스트하기 위해 설계되었습니다.`)
          .setColor(embedIndex % 2 === 0 ? 0x00ff00 : 0x0099ff);

        // 각 임베드에 20개씩 필드 추가
        for (let fieldIndex = 0; fieldIndex < 20; fieldIndex++) {
          embed.addFields({
            name: `데이터 항목 ${embedIndex * 20 + fieldIndex + 1}`,
            value: `상세 정보: ${'X'.repeat(800)}`, // 긴 값으로 문자 제한 테스트
            inline: true
          });
        }

        largeEmbeds.push(embed);
      }

      console.log(`📊 생성된 대용량 임베드: ${largeEmbeds.length}개`);

      // 각 임베드 사전 검증
      console.log(`\n🔍 청킹 전 검증 실행 중...`);
      let needsChunking = false;
      let totalValidationIssues = 0;

      for (let i = 0; i < largeEmbeds.length; i++) {
        const embed = largeEmbeds[i];
        const validation = EmbedValidator.validateEmbed(embed, {
          strictMode: true,
          includeWarnings: true
        });

        console.log(`  임베드 ${i + 1}: ${validation.isValid ? '✅' : '❌'} (${validation.totalCharacters}자, ${validation.totalFields}필드)`);

        if (!validation.isValid) {
          needsChunking = true;
          totalValidationIssues += validation.violations.length;
        }
      }

      console.log(`\n📋 검증 결과:`);
      console.log(`  🧩 청킹 필요: ${needsChunking ? 'YES' : 'NO'}`);
      console.log(`  ❌ 총 검증 이슈: ${totalValidationIssues}개`);

      if (needsChunking) {
        console.log(`\n🔧 청킹 시스템 적용 중...`);
        
        // 청킹 시스템으로 처리
        const chunkingResult = await this.chunkingSystem.chunkEmbeds(largeEmbeds, {
          maxFieldsPerEmbed: 20,
          maxCharactersPerEmbed: 5000,
          enableFileFallback: true,
          fileFallbackThreshold: 10
        });

        console.log(`📦 청킹 완료:`);
        console.log(`  📊 총 청크: ${chunkingResult.totalChunks}개`);
        console.log(`  📝 총 문자수: ${chunkingResult.totalCharacters}자`);
        console.log(`  📁 파일 폴백 필요: ${chunkingResult.requiresFileFallback ? 'YES' : 'NO'}`);
        console.log(`  🧭 네비게이션 활성: ${chunkingResult.navigationEnabled ? 'YES' : 'NO'}`);

        // 청킹된 결과 검증
        console.log(`\n✅ 청킹된 임베드 검증 중...`);
        let allChunksValid = true;

        for (let i = 0; i < chunkingResult.chunks.length; i++) {
          const chunk = chunkingResult.chunks[i];
          const validation = EmbedValidator.validateEmbed(chunk.embed);
          
          if (!validation.isValid) {
            allChunksValid = false;
            console.log(`  ❌ 청크 ${i + 1} 검증 실패`);
          }
        }

        console.log(`📋 청킹 검증 결과: ${allChunksValid ? '✅ 모든 청크 유효' : '❌ 일부 청크 무효'}`);

        // 청킹된 임베드 전송
        if (allChunksValid) {
          console.log(`\n📤 청킹된 임베드 전송 중...`);
          const sendResult = await this.chunkingSystem.sendChunkedEmbeds(
            interaction,
            chunkingResult.chunks,
            {
              enableNavigation: true,
              sendDelay: 1500,
              enableFileFallback: true
            }
          );

          if (sendResult.success) {
            console.log(`✅ 청킹된 전송 성공:`);
            console.log(`  📨 메시지 수: ${sendResult.messages.length}개`);
            console.log(`  ⏱️ 전송 시간: ${sendResult.sendTime}ms`);
            console.log(`  🧭 네비게이션: ${sendResult.navigationState ? `${sendResult.navigationState.totalPages}페이지` : '비활성'}`);
            console.log(`  📁 파일 폴백: ${sendResult.fallbackAttachment ? '사용됨' : '미사용'}`);
          }
        }
      } else {
        console.log(`\n📤 일반 전송 (청킹 불필요)`);
        for (const embed of largeEmbeds) {
          await interaction.followUp({ embeds: [embed] });
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

    } catch (error) {
      console.error('❌ EmbedChunkingSystem 통합 오류:', error);
      await interaction.followUp({
        content: '⚠️ 임베드 청킹 시스템 처리 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  }

  /**
   * 예제 4: 실시간 검증 미들웨어
   */
  createValidationMiddleware() {
    return {
      /**
       * 임베드 전송 전 자동 검증
       */
      validateAndSend: async (
        interaction: ChatInputCommandInteraction,
        embeds: EmbedBuilder[],
        options: {
          autoOptimize?: boolean;
          strictMode?: boolean;
          allowPartialSend?: boolean;
        } = {}
      ) => {
        console.log('🛡️ 실시간 검증 미들웨어 실행');
        
        const validatedEmbeds: EmbedBuilder[] = [];
        const validationReports: string[] = [];

        for (let i = 0; i < embeds.length; i++) {
          const embed = embeds[i];
          const validation = EmbedValidator.validateEmbed(embed, {
            strictMode: options.strictMode || false,
            includeWarnings: true
          });

          console.log(`  임베드 ${i + 1}: ${validation.isValid ? '✅' : '❌'} (${validation.summary.overallHealth})`);

          if (validation.isValid) {
            validatedEmbeds.push(embed);
          } else if (options.autoOptimize) {
            console.log(`    🔧 자동 최적화 시도 중...`);
            const optimization = EmbedValidator.optimizeEmbed(embed);
            
            const revalidation = EmbedValidator.validateEmbed(optimization.optimizedEmbed);
            if (revalidation.isValid) {
              console.log(`    ✅ 최적화 성공 (${optimization.spacesSaved}자 절약)`);
              validatedEmbeds.push(optimization.optimizedEmbed);
            } else if (options.allowPartialSend) {
              console.log(`    ⚠️ 최적화 실패, 부분 전송 허용`);
              validatedEmbeds.push(embed);
            }
          } else if (options.allowPartialSend) {
            validatedEmbeds.push(embed);
          }

          // 검증 보고서 생성
          if (!validation.isValid) {
            const report = EmbedValidator.generateValidationReport(embed, { calculateScores: false });
            validationReports.push(`임베드 ${i + 1} 검증 보고서:\n${report}`);
          }
        }

        console.log(`📊 검증 결과: ${validatedEmbeds.length}/${embeds.length} 임베드 통과`);

        // 검증된 임베드 전송
        if (validatedEmbeds.length > 0) {
          for (const embed of validatedEmbeds) {
            await interaction.followUp({ embeds: [embed] });
          }
        }

        // 검증 실패 보고서 전송 (필요시)
        if (validationReports.length > 0 && validatedEmbeds.length < embeds.length) {
          await interaction.followUp({
            content: `⚠️ ${embeds.length - validatedEmbeds.length}개 임베드가 검증을 통과하지 못했습니다.\n\n` +
                    `검증 보고서는 DM으로 발송됩니다.`,
            ephemeral: true
          });

          // DM으로 상세 보고서 전송
          try {
            for (const report of validationReports) {
              await interaction.user.send(`\`\`\`\n${report}\n\`\`\``);
            }
          } catch (error) {
            console.log('DM 전송 실패, 채널에 요약 전송');
            await interaction.followUp({
              content: '📋 **검증 실패 요약**\n' +
                      `• 총 ${validationReports.length}개 임베드에서 검증 오류 발생\n` +
                      '• 주요 원인: Discord 제한 초과, URL 형식 오류, 접근성 문제\n' +
                      '• 권장 사항: 임베드 내용 축약, 필드 수 감소, URL 형식 확인',
              ephemeral: true
            });
          }
        }

        return {
          totalEmbeds: embeds.length,
          validatedEmbeds: validatedEmbeds.length,
          failedEmbeds: embeds.length - validatedEmbeds.length,
          reports: validationReports
        };
      }
    };
  }

  /**
   * 예제 5: 성능 벤치마크 비교
   */
  async example5_PerformanceBenchmark() {
    console.log('🏃‍♂️ 예제 5: 성능 벤치마크 비교');
    console.log('=' .repeat(50));

    // 테스트용 임베드들 생성
    const testEmbeds = [
      // 작은 임베드
      new EmbedBuilder().setTitle('Small').setDescription('Small embed').setColor(0x00ff00),
      
      // 중간 임베드
      new EmbedBuilder()
        .setTitle('Medium Embed')
        .setDescription('A'.repeat(1000))
        .setColor(0x00ff00)
        .addFields(
          { name: 'Field 1', value: 'Value 1', inline: true },
          { name: 'Field 2', value: 'Value 2', inline: true }
        ),
      
      // 큰 임베드
      new EmbedBuilder()
        .setTitle('Large Embed')
        .setDescription('B'.repeat(3000))
        .setColor(0x00ff00)
        .addFields(...Array.from({ length: 20 }, (_, i) => ({
          name: `Field ${i + 1}`,
          value: `Value ${i + 1}`.repeat(10),
          inline: true
        })))
    ];

    const iterations = 100;

    console.log(`🔬 ${iterations}회 반복 성능 테스트:`);

    for (let i = 0; i < testEmbeds.length; i++) {
      const embed = testEmbeds[i];
      const embedSize = EmbedValidator.validateEmbed(embed).totalCharacters;
      
      console.log(`\n📊 임베드 ${i + 1} (${embedSize}자):`);

      // 빠른 검증
      const quickStart = performance.now();
      for (let j = 0; j < iterations; j++) {
        EmbedValidator.quickValidate(embed);
      }
      const quickTime = performance.now() - quickStart;

      // 기본 검증
      const basicStart = performance.now();
      for (let j = 0; j < iterations; j++) {
        EmbedValidator.validateEmbed(embed, { calculateScores: false });
      }
      const basicTime = performance.now() - basicStart;

      // 전체 검증
      const fullStart = performance.now();
      for (let j = 0; j < iterations; j++) {
        EmbedValidator.validateEmbed(embed, {
          calculateScores: true,
          checkAccessibility: true,
          validateUrls: true
        });
      }
      const fullTime = performance.now() - fullStart;

      console.log(`  ⚡ 빠른 검증: ${quickTime.toFixed(2)}ms (${(quickTime/iterations).toFixed(4)}ms/회)`);
      console.log(`  🔍 기본 검증: ${basicTime.toFixed(2)}ms (${(basicTime/iterations).toFixed(4)}ms/회)`);
      console.log(`  🔬 전체 검증: ${fullTime.toFixed(2)}ms (${(fullTime/iterations).toFixed(4)}ms/회)`);
      console.log(`  📊 성능 비율: 1 : ${(basicTime/quickTime).toFixed(1)} : ${(fullTime/quickTime).toFixed(1)}`);
    }

    console.log(`\n📋 성능 요약:`);
    console.log(`  • 빠른 검증: 기본적인 Discord 제한만 확인, 최고 성능`);
    console.log(`  • 기본 검증: 표준 검증 + 경고, 균형잡힌 성능`);
    console.log(`  • 전체 검증: 모든 검증 + 점수 계산, 가장 포괄적`);
    console.log(`  • 권장 사항: 실시간 검증은 빠른 검증, 상세 분석은 전체 검증 사용`);
  }
}

/**
 * 통합 예제 실행 함수
 */
export async function runEmbedValidatorIntegrationExamples(interaction: ChatInputCommandInteraction) {
  const integration = new EmbedValidatorIntegration();
  
  const example = interaction.options.getString('example') || '1';
  
  switch (example) {
    case '1':
      await integration.example1_ValidatedEmbedFactory(interaction);
      break;
    case '2':
      await integration.example2_ValidatedReliableEmbedSender(interaction);
      break;
    case '3':
      await integration.example3_ValidatedEmbedChunking(interaction);
      break;
    case '4':
      const middleware = integration.createValidationMiddleware();
      const testEmbeds = [
        new EmbedBuilder().setTitle('Test 1').setColor(0x00ff00),
        new EmbedBuilder().setTitle('A'.repeat(300)).setColor(0xff0000) // Invalid
      ];
      await middleware.validateAndSend(interaction, testEmbeds, {
        autoOptimize: true,
        allowPartialSend: true
      });
      break;
    case '5':
      await integration.example5_PerformanceBenchmark();
      break;
    default:
      await interaction.reply({
        content: '사용 가능한 예제: 1-5',
        ephemeral: true
      });
  }
}