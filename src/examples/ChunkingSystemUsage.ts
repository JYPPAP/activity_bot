// src/examples/ChunkingSystemUsage.ts - Discord embed chunking system usage examples
import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { container } from 'tsyringe';

import { IEmbedChunkingSystem } from '../interfaces/IEmbedChunkingSystem';
import { IReliableEmbedSender, ThreeSectionReport } from '../interfaces/IReliableEmbedSender';
import { IntegratedReportChunkingService } from '../services/IntegratedReportChunkingService';
import { DI_TOKENS } from '../interfaces/index';

/**
 * Discord embed chunking system 사용 예제 모음
 */
export class ChunkingSystemUsageExamples {
  private chunkingSystem: IEmbedChunkingSystem;
  private reliableEmbedSender: IReliableEmbedSender;
  private integratedService: IntegratedReportChunkingService;

  constructor() {
    this.chunkingSystem = container.resolve(DI_TOKENS.IEmbedChunkingSystem);
    this.reliableEmbedSender = container.resolve(DI_TOKENS.IReliableEmbedSender);
    this.integratedService = container.resolve(IntegratedReportChunkingService);
  }

  /**
   * 예제 1: 기본 임베드 청킹 사용법
   */
  async example1_BasicChunking(interaction: ChatInputCommandInteraction) {
    // 큰 임베드 생성 (필드가 25개를 초과하는 경우)
    const largeEmbed = new EmbedBuilder()
      .setTitle('📊 대용량 활동 보고서')
      .setDescription('이 보고서는 많은 멤버 데이터를 포함합니다.')
      .setColor(0x00ff00);

    // 50개의 필드 추가 (Discord 제한 25개 초과)
    for (let i = 1; i <= 50; i++) {
      largeEmbed.addFields({
        name: `멤버 ${i}`,
        value: `활동시간: ${i * 2}시간 ${(i * 30) % 60}분`,
        inline: true
      });
    }

    try {
      // 청킹 시스템으로 분할
      const chunkingResult = await this.chunkingSystem.chunkEmbeds([largeEmbed], {
        maxFieldsPerEmbed: 25,
        enableNavigation: true,
        sendDelay: 1000
      });

      console.log(`✅ 청킹 완료: ${chunkingResult.totalChunks}개 청크 생성`);
      console.log(`📊 압축률: ${Math.round(chunkingResult.metadata.compressionRatio * 100)}%`);

      // 청킹된 임베드 전송
      const sendResult = await this.chunkingSystem.sendChunkedEmbeds(
        interaction,
        chunkingResult.chunks,
        {
          enableNavigation: true,
          navigationTimeout: 300000 // 5분
        }
      );

      if (sendResult.success) {
        console.log(`✅ 전송 완료: ${sendResult.messages.length}개 메시지`);
        if (sendResult.navigationState) {
          console.log(`🧭 네비게이션 세션 생성: ${sendResult.navigationState.sessionId}`);
        }
      }

    } catch (error) {
      console.error('❌ 청킹 시스템 오류:', error);
      await interaction.followUp({
        content: '⚠️ 보고서 전송 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  }

  /**
   * 예제 2: 3-섹션 보고서와 청킹 통합 사용법
   */
  async example2_IntegratedThreeSectionReport(interaction: ChatInputCommandInteraction) {
    // 3-섹션 보고서 데이터 생성
    const report: ThreeSectionReport = {
      achievementSection: {
        title: '✅ 활동 기준 달성 멤버',
        members: Array.from({ length: 30 }, (_, i) => ({
          name: `달성멤버${i + 1}`,
          value: `${(i + 1) * 2}시간 ${(i * 15) % 60}분`,
          extra: `역할: 정회원`
        }))
      },
      underperformanceSection: {
        title: '❌ 활동 기준 미달성 멤버',
        members: Array.from({ length: 20 }, (_, i) => ({
          name: `미달성멤버${i + 1}`,
          value: `${i + 1}시간 ${(i * 20) % 60}분`,
          extra: `부족: ${5 - (i + 1)}시간`
        }))
      },
      afkSection: {
        title: '💤 잠수 중인 멤버',
        members: Array.from({ length: 15 }, (_, i) => ({
          name: `잠수멤버${i + 1}`,
          value: `${i}시간 ${(i * 10) % 60}분`,
          extra: `해제예정: ${new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000).toLocaleDateString('ko-KR')}`
        }))
      }
    };

    try {
      // 통합 서비스 사용
      const result = await this.integratedService.sendThreeSectionReportWithChunking(
        interaction,
        report,
        {
          enableChunking: true,
          chunkingThreshold: 2, // 2개 이상 임베드시 청킹 사용
          preferChunkingOverReliable: true,
          chunkingConfig: {
            maxFieldsPerEmbed: 25,
            enableNavigation: true,
            enableFileFallback: true,
            fileFallbackThreshold: 5
          }
        }
      );

      if (result.success) {
        console.log(`✅ 통합 보고서 전송 완료`);
        console.log(`📊 청킹 사용: ${result.chunkingUsed ? 'Yes' : 'No'}`);
        console.log(`📦 총 청크: ${result.totalChunks}개`);
        console.log(`📁 파일 폴백: ${result.fileFallbackUsed ? 'Yes' : 'No'}`);
        console.log(`⏱️ 전송 시간: ${result.sendTime}ms`);
        
        if (result.navigationState) {
          console.log(`🧭 네비게이션 활성: ${result.navigationState.totalPages}페이지`);
        }
      }

    } catch (error) {
      console.error('❌ 통합 보고서 오류:', error);
      await interaction.followUp({
        content: '⚠️ 통합 보고서 전송 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  }

  /**
   * 예제 3: 파일 폴백 시스템 사용법 (매우 큰 보고서)
   */
  async example3_FileFallbackSystem(interaction: ChatInputCommandInteraction) {
    // 매우 큰 임베드 생성 (파일 폴백이 필요한 수준)
    const massiveEmbeds: EmbedBuilder[] = [];

    for (let embedIndex = 0; embedIndex < 12; embedIndex++) {
      const embed = new EmbedBuilder()
        .setTitle(`📊 대용량 보고서 파트 ${embedIndex + 1}`)
        .setDescription(`이것은 매우 큰 보고서의 ${embedIndex + 1}번째 파트입니다.`)
        .setColor(embedIndex % 2 === 0 ? 0x00ff00 : 0x0099ff);

      // 각 임베드에 25개 필드 추가
      for (let fieldIndex = 0; fieldIndex < 25; fieldIndex++) {
        embed.addFields({
          name: `데이터 ${embedIndex * 25 + fieldIndex + 1}`,
          value: `상세 정보: ${Math.random().toString(36).substring(2, 15)}`,
          inline: true
        });
      }

      massiveEmbeds.push(embed);
    }

    try {
      // 청킹 시스템 사용 (파일 폴백 활성화)
      const chunkingResult = await this.chunkingSystem.chunkEmbeds(massiveEmbeds, {
        enableFileFallback: true,
        fileFallbackThreshold: 10, // 10개 청크 초과시 파일로 전환
        attachmentFormat: 'txt'
      });

      const sendResult = await this.chunkingSystem.sendChunkedEmbeds(
        interaction,
        chunkingResult.chunks,
        {
          enableFileFallback: true,
          fileFallbackThreshold: 10,
          attachmentFormat: 'txt'
        }
      );

      if (sendResult.fallbackAttachment) {
        console.log(`📁 파일 폴백 사용됨:`);
        console.log(`  - 파일명: ${sendResult.fallbackAttachment.filename}`);
        console.log(`  - 크기: ${Math.round(sendResult.fallbackAttachment.size / 1024)}KB`);
        console.log(`  - 형식: ${sendResult.fallbackAttachment.format}`);
        console.log(`  - 원본 임베드: ${sendResult.fallbackAttachment.metadata.originalEmbedCount}개`);
      }

    } catch (error) {
      console.error('❌ 파일 폴백 시스템 오류:', error);
      await interaction.followUp({
        content: '⚠️ 대용량 보고서 처리 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  }

  /**
   * 예제 4: 네비게이션 시스템 모니터링
   */
  async example4_NavigationMonitoring() {
    // 활성 네비게이션 세션 조회
    const activeSessions = this.chunkingSystem.getActiveNavigationSessions();
    
    console.log(`🧭 활성 네비게이션 세션: ${activeSessions.length}개`);
    
    activeSessions.forEach((session, index) => {
      console.log(`  세션 ${index + 1}:`);
      console.log(`    - ID: ${session.sessionId}`);
      console.log(`    - 현재 페이지: ${session.currentPage}/${session.totalPages}`);
      console.log(`    - 사용자: ${session.userId}`);
      console.log(`    - 생성시간: ${session.createdAt.toLocaleString('ko-KR')}`);
      console.log(`    - 만료시간: ${session.expiresAt.toLocaleString('ko-KR')}`);
      console.log(`    - 활성 상태: ${session.isActive ? '활성' : '비활성'}`);
    });

    // 만료된 세션 정리
    const cleanedCount = await this.chunkingSystem.cleanupExpiredSessions();
    console.log(`🧹 정리된 세션: ${cleanedCount}개`);

    // 청킹 시스템 통계
    const stats = this.chunkingSystem.getStatistics();
    console.log(`📊 청킹 시스템 통계:`);
    console.log(`  - 총 청킹 작업: ${stats.totalChunkingOperations}회`);
    console.log(`  - 평균 청크 수: ${stats.averageChunksPerOperation}개`);
    console.log(`  - 파일 폴백 사용: ${stats.fileFallbackUsage}회`);
    console.log(`  - 평균 처리 시간: ${stats.averageProcessingTime}ms`);
    console.log(`  - 문자 압축률: ${stats.characterCompressionRatio}%`);
  }

  /**
   * 예제 5: 오류 처리 및 복구
   */
  async example5_ErrorHandlingAndRecovery(interaction: ChatInputCommandInteraction) {
    try {
      // 의도적으로 문제가 있는 임베드 생성
      const problematicEmbed = new EmbedBuilder()
        .setTitle('A'.repeat(300)) // 제목 길이 초과
        .setDescription('B'.repeat(5000)) // 설명 길이 초과
        .setColor(0x00ff00);

      // 100개 필드 추가 (Discord 제한 25개 대폭 초과)
      for (let i = 0; i < 100; i++) {
        problematicEmbed.addFields({
          name: `Field ${i}`,
          value: 'C'.repeat(1000), // 필드 값 길이 초과
          inline: true
        });
      }

      // 청킹 시스템의 검증 기능 사용
      const validation = this.chunkingSystem.validateEmbedLimits(problematicEmbed);
      
      if (!validation.isValid) {
        console.log(`❌ 임베드 검증 실패:`);
        validation.violations.forEach(violation => {
          console.log(`  - ${violation.type}: ${violation.current}/${violation.limit} (${violation.severity})`);
        });
      }

      // 하이브리드 청킹 전략으로 문제 해결
      const chunkingResult = await this.chunkingSystem.chunkEmbeds([problematicEmbed], {
        maxFieldsPerEmbed: 20, // 보수적인 필드 제한
        maxCharactersPerEmbed: 5000, // 보수적인 문자 제한
        enableFileFallback: true,
        fileFallbackThreshold: 3
      });

      console.log(`✅ 문제 해결됨: ${chunkingResult.totalChunks}개 청크로 분할`);
      console.log(`📊 전략: ${chunkingResult.metadata.chunkingStrategy}`);

      // 안전하게 전송
      const sendResult = await this.chunkingSystem.sendChunkedEmbeds(
        interaction,
        chunkingResult.chunks,
        {
          enableFileFallback: true,
          sendDelay: 2000 // 여유있는 전송 간격
        }
      );

      if (sendResult.success) {
        console.log(`✅ 복구 전송 성공`);
      }

    } catch (error) {
      console.error('❌ 오류 처리 실패:', error);
      
      // 최후 수단: 텍스트 메시지로 폴백
      await interaction.followUp({
        content: '⚠️ 임베드 전송에 실패하여 텍스트로 전환합니다.\n\n' +
                '📊 **보고서 요약**\n' +
                '• 데이터가 Discord 제한을 초과했습니다.\n' +
                '• 자세한 내용은 관리자에게 문의하세요.',
        ephemeral: true
      });
    }
  }
}

/**
 * 사용법 예제를 실행하는 헬퍼 함수
 */
export async function runChunkingExamples(interaction: ChatInputCommandInteraction) {
  const examples = new ChunkingSystemUsageExamples();
  
  // 상황에 따라 적절한 예제 선택
  const embed = interaction.options.get('embed');
  const embedCount = embed ? parseInt(embed.value as string) : 1;
  
  if (embedCount <= 2) {
    await examples.example1_BasicChunking(interaction);
  } else if (embedCount <= 10) {
    await examples.example2_IntegratedThreeSectionReport(interaction);
  } else {
    await examples.example3_FileFallbackSystem(interaction);
  }
  
  // 통계 정보 출력
  await examples.example4_NavigationMonitoring();
}