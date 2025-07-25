// src/services/DiscordStreamingService.ts - Discord Integration for Streaming Reports

import { 
  ChatInputCommandInteraction, 
  EmbedBuilder, 
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  InteractionResponse,
  Message
} from 'discord.js';
import { injectable } from 'tsyringe';

import type {
  StreamingProgress,
  PartialReportResult,
  StreamingReportResult,
  StreamingError,
  DiscordStreamingOptions,
  StreamingStage,
  DEFAULT_DISCORD_OPTIONS
} from '../interfaces/IStreamingReportEngine';

/**
 * Progress message context for managing Discord updates
 */
interface ProgressMessageContext {
  messageId?: string;
  lastUpdate: number;
  updateCount: number;
  embedHistory: EmbedBuilder[];
  progressMessage?: Message | InteractionResponse;
}

/**
 * Discord streaming service for real-time report updates
 */
@injectable()
export class DiscordStreamingService {
  private messageContexts = new Map<string, ProgressMessageContext>();
  private readonly MAX_EMBED_HISTORY = 3;
  private readonly MAX_UPDATE_FREQUENCY = 1000; // 1 second minimum between updates

  /**
   * Initialize streaming session with Discord
   */
  async initializeStreamingSession(
    interaction: ChatInputCommandInteraction,
    operationId: string,
    options: DiscordStreamingOptions
  ): Promise<void> {
    const context: ProgressMessageContext = {
      lastUpdate: 0,
      updateCount: 0,
      embedHistory: []
    };

    this.messageContexts.set(operationId, context);

    // Send initial progress message
    const initialEmbed = this.createProgressEmbed(
      {
        current: 0,
        total: 100,
        percentage: 0,
        message: '🚀 스트리밍 보고서 생성을 시작합니다...',
        stage: 'initializing' as StreamingStage,
        itemsProcessed: 0,
        processingRate: 0
      },
      options
    );

    const components = this.createProgressComponents(operationId, false);

    try {
      if (interaction.deferred || interaction.replied) {
        const response = await interaction.followUp({
          embeds: [initialEmbed],
          components: [components],
          flags: options.ephemeral ? MessageFlags.Ephemeral : undefined
        });
        
        if ('id' in response) {
          context.messageId = response.id;
          context.progressMessage = response;
        }
      } else {
        const response = await interaction.reply({
          embeds: [initialEmbed],
          components: [components],
          flags: options.ephemeral ? MessageFlags.Ephemeral : undefined
        });
        
        context.progressMessage = response;
      }

      console.log(`[DiscordStreaming] Initialized session for operation: ${operationId}`);
    } catch (error) {
      console.error(`[DiscordStreaming] Failed to initialize session:`, error);
      throw error;
    }
  }

  /**
   * Update progress in Discord
   */
  async updateProgress(
    operationId: string,
    progress: StreamingProgress,
    options: DiscordStreamingOptions
  ): Promise<void> {
    const context = this.messageContexts.get(operationId);
    if (!context) {
      console.warn(`[DiscordStreaming] No context found for operation: ${operationId}`);
      return;
    }

    const now = Date.now();
    
    // Rate limiting: don't update too frequently
    if (now - context.lastUpdate < Math.max(options.updateThrottle, this.MAX_UPDATE_FREQUENCY)) {
      return;
    }

    try {
      const progressEmbed = this.createProgressEmbed(progress, options);
      const components = this.createProgressComponents(operationId, progress.stage === 'completed');

      // Update the message
      if (context.progressMessage && 'edit' in context.progressMessage) {
        await context.progressMessage.edit({
          embeds: [progressEmbed],
          components: [components]
        });
      }

      // Add to embed history
      context.embedHistory.push(progressEmbed);
      if (context.embedHistory.length > this.MAX_EMBED_HISTORY) {
        context.embedHistory.shift();
      }

      context.lastUpdate = now;
      context.updateCount++;

      console.log(`[DiscordStreaming] Updated progress for ${operationId}: ${progress.percentage}%`);

    } catch (error) {
      console.error(`[DiscordStreaming] Failed to update progress:`, error);
      // Don't throw - streaming should continue even if updates fail
    }
  }

  /**
   * Send partial results
   */
  async sendPartialResult(
    operationId: string,
    partialResult: PartialReportResult,
    options: DiscordStreamingOptions
  ): Promise<void> {
    const context = this.messageContexts.get(operationId);
    if (!context?.progressMessage) {
      console.warn(`[DiscordStreaming] No context for partial result: ${operationId}`);
      return;
    }

    try {
      // Create partial result embed
      const partialEmbed = this.createPartialResultEmbed(partialResult, options);
      
      // Send partial results as a follow-up message
      if ('followUp' in context.progressMessage) {
        await context.progressMessage.followUp({
          embeds: [partialEmbed, ...(partialResult.embeds || []).slice(0, 3)], // Limit embeds
          flags: options.ephemeral ? MessageFlags.Ephemeral : undefined
        });
      }

      console.log(`[DiscordStreaming] Sent partial result for ${operationId}: batch ${partialResult.batchInfo?.batchNumber}`);

    } catch (error) {
      console.error(`[DiscordStreaming] Failed to send partial result:`, error);
    }
  }

  /**
   * Send final results
   */
  async sendFinalResult(
    operationId: string,
    result: StreamingReportResult,
    options: DiscordStreamingOptions
  ): Promise<void> {
    const context = this.messageContexts.get(operationId);
    if (!context?.progressMessage) {
      console.warn(`[DiscordStreaming] No context for final result: ${operationId}`);
      return;
    }

    try {
      // Create completion embed
      const completionEmbed = this.createCompletionEmbed(result, options);
      
      // Update progress message with completion status
      if ('edit' in context.progressMessage) {
        await context.progressMessage.edit({
          embeds: [completionEmbed],
          components: [this.createProgressComponents(operationId, true)]
        });
      }

      // Send final results
      if ('followUp' in context.progressMessage) {
        // Split embeds into chunks to avoid Discord limits
        const embedChunks = this.chunkEmbeds(result.embeds, options.maxEmbedsPerMessage);
        
        for (let i = 0; i < embedChunks.length; i++) {
          const chunk = embedChunks[i];
          const isLast = i === embedChunks.length - 1;
          
          await context.progressMessage.followUp({
            content: i === 0 ? '📊 **최종 보고서 결과**' : undefined,
            embeds: chunk,
            flags: options.ephemeral ? MessageFlags.Ephemeral : undefined,
            ...(isLast && {
              components: [this.createFinalResultComponents(result)]
            })
          });

          // Small delay between chunks
          if (!isLast) {
            await this.sleep(500);
          }
        }
      }

      console.log(`[DiscordStreaming] Sent final result for ${operationId}`);

    } catch (error) {
      console.error(`[DiscordStreaming] Failed to send final result:`, error);
    } finally {
      // Clean up context
      this.cleanupContext(operationId);
    }
  }

  /**
   * Handle streaming errors
   */
  async handleStreamingError(
    operationId: string,
    error: StreamingError,
    options: DiscordStreamingOptions
  ): Promise<void> {
    const context = this.messageContexts.get(operationId);
    if (!context?.progressMessage) {
      console.warn(`[DiscordStreaming] No context for error: ${operationId}`);
      return;
    }

    try {
      const errorEmbed = this.createErrorEmbed(error, options);

      // Update progress message with error
      if ('edit' in context.progressMessage) {
        await context.progressMessage.edit({
          embeds: [errorEmbed],
          components: [this.createProgressComponents(operationId, true, true)]
        });
      }

      console.log(`[DiscordStreaming] Handled error for ${operationId}: ${error.code}`);

    } catch (updateError) {
      console.error(`[DiscordStreaming] Failed to handle streaming error:`, updateError);
    } finally {
      // Clean up context
      this.cleanupContext(operationId);
    }
  }

  /**
   * Handle operation cancellation
   */
  async handleCancellation(
    operationId: string,
    options: DiscordStreamingOptions
  ): Promise<void> {
    const context = this.messageContexts.get(operationId);
    if (!context?.progressMessage) {
      return;
    }

    try {
      const cancelEmbed = new EmbedBuilder()
        .setTitle('⏹️ 작업 취소됨')
        .setDescription('스트리밍 보고서 생성이 사용자에 의해 취소되었습니다.')
        .setColor(0x808080)
        .setTimestamp()
        .setFooter({ text: '취소된 작업' });

      if ('edit' in context.progressMessage) {
        await context.progressMessage.edit({
          embeds: [cancelEmbed],
          components: []
        });
      }

      console.log(`[DiscordStreaming] Handled cancellation for ${operationId}`);

    } catch (error) {
      console.error(`[DiscordStreaming] Failed to handle cancellation:`, error);
    } finally {
      this.cleanupContext(operationId);
    }
  }

  /**
   * Create progress embed
   */
  private createProgressEmbed(
    progress: StreamingProgress,
    options: DiscordStreamingOptions
  ): EmbedBuilder {
    const template = { ...DEFAULT_DISCORD_OPTIONS.progressTemplate, ...options.progressTemplate };
    
    // Create progress bar
    const progressBar = this.createProgressBar(progress.percentage);
    
    // Format processing rate
    const rateText = progress.processingRate 
      ? `${progress.processingRate.toFixed(1)} 항목/초`
      : '계산 중...';

    // Format ETA
    const etaText = progress.estimatedTimeRemaining
      ? this.formatDuration(progress.estimatedTimeRemaining)
      : '알 수 없음';

    const embed = new EmbedBuilder()
      .setTitle(template?.title || '📊 보고서 생성 중...')
      .setColor(template?.color || 0x00AE86)
      .setDescription(
        `${progress.message}\n\n` +
        `${progressBar} **${progress.percentage}%**\n\n` +
        `**진행상황:** ${progress.current}/${progress.total}\n` +
        `**처리된 항목:** ${progress.itemsProcessed || 0}개\n` +
        `**처리 속도:** ${rateText}\n` +
        `**예상 남은 시간:** ${etaText}\n` +
        `**현재 단계:** ${this.getStageDisplayName(progress.stage)}`
      )
      .setTimestamp()
      .setFooter({ 
        text: template?.footer || '실시간 업데이트 • 언제든지 취소할 수 있습니다' 
      });

    return embed;
  }

  /**
   * Create partial result embed
   */
  private createPartialResultEmbed(
    partialResult: PartialReportResult,
    options: DiscordStreamingOptions
  ): EmbedBuilder {
    const batchInfo = partialResult.batchInfo;
    const stats = partialResult.statistics;

    const embed = new EmbedBuilder()
      .setTitle(`📋 부분 결과 (배치 ${batchInfo?.batchNumber}/${batchInfo?.totalBatches})`)
      .setColor(0x3498db)
      .setDescription(
        `현재까지 처리된 결과입니다.\n\n` +
        `**처리된 멤버:** ${stats?.totalMembers || 0}명\n` +
        `**활성 멤버:** ${stats?.activeMembers || 0}명\n` +
        `**비활성 멤버:** ${stats?.inactiveMembers || 0}명\n` +
        `**AFK 멤버:** ${stats?.afkMembers || 0}명\n\n` +
        `*최종 결과는 모든 배치 처리 후 제공됩니다.*`
      )
      .setTimestamp(partialResult.timestamp)
      .setFooter({ text: `부분 결과 ID: ${partialResult.id}` });

    return embed;
  }

  /**
   * Create completion embed
   */
  private createCompletionEmbed(
    result: StreamingReportResult,
    options: DiscordStreamingOptions
  ): EmbedBuilder {
    const stats = result.statistics;
    const metadata = result.metadata;

    const embed = new EmbedBuilder()
      .setTitle(result.success ? '✅ 보고서 생성 완료!' : '❌ 보고서 생성 실패')
      .setColor(result.success ? 0x00FF00 : 0xFF0000)
      .setDescription(
        result.success 
          ? `스트리밍 보고서가 성공적으로 생성되었습니다.\n\n` +
            `**총 멤버:** ${stats.totalMembers}명\n` +
            `**활성 멤버:** ${stats.activeMembers}명\n` +
            `**비활성 멤버:** ${stats.inactiveMembers}명\n` +
            `**AFK 멤버:** ${stats.afkMembers}명\n\n` +
            `**처리 시간:** ${this.formatDuration(stats.processingTime)}\n` +
            `**처리된 배치:** ${stats.batchesProcessed}개\n` +
            `**복구된 오류:** ${stats.errorsRecovered}개\n` +
            `**최대 메모리 사용량:** ${Math.round(stats.memoryPeak / 1024 / 1024)}MB`
          : `보고서 생성 중 오류가 발생했습니다.\n\n` +
            `**오류:** ${result.error?.message || '알 수 없는 오류'}\n` +
            `**단계:** ${this.getStageDisplayName(result.error?.stage || 'error')}`
      )
      .setTimestamp()
      .setFooter({ 
        text: `작업 ID: ${result.operationId} • 역할: ${metadata.role}` 
      });

    return embed;
  }

  /**
   * Create error embed
   */
  private createErrorEmbed(
    error: StreamingError,
    options: DiscordStreamingOptions
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('❌ 스트리밍 오류 발생')
      .setColor(0xFF0000)
      .setDescription(
        `보고서 생성 중 오류가 발생했습니다.\n\n` +
        `**오류 코드:** ${error.code}\n` +
        `**메시지:** ${error.message}\n` +
        `**단계:** ${this.getStageDisplayName(error.stage)}\n` +
        `**복구 가능:** ${error.recoverable ? '예' : '아니오'}\n` +
        `**재시도 횟수:** ${error.retryCount || 0}회`
      )
      .setTimestamp(error.timestamp)
      .setFooter({ text: '관리자에게 문의하세요' });

    return embed;
  }

  /**
   * Create progress action buttons
   */
  private createProgressComponents(
    operationId: string,
    isCompleted: boolean,
    hasError = false
  ): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>();

    if (!isCompleted && !hasError) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`streaming-cancel-${operationId}`)
          .setLabel('취소')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('⏹️'),
        
        new ButtonBuilder()
          .setCustomId(`streaming-status-${operationId}`)
          .setLabel('상태 확인')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📊')
      );
    } else if (isCompleted && !hasError) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`streaming-completed-${operationId}`)
          .setLabel('완료됨')
          .setStyle(ButtonStyle.Success)
          .setEmoji('✅')
          .setDisabled(true)
      );
    } else if (hasError) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`streaming-error-${operationId}`)
          .setLabel('오류 발생')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('❌')
          .setDisabled(true)
      );
    }

    return row;
  }

  /**
   * Create final result action buttons
   */
  private createFinalResultComponents(result: StreamingReportResult): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>();

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`report-export-${result.operationId}`)
        .setLabel('내보내기')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('💾'),
      
      new ButtonBuilder()
        .setCustomId(`report-share-${result.operationId}`)
        .setLabel('공유')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔗')
    );

    return row;
  }

  /**
   * Create progress bar visual
   */
  private createProgressBar(percentage: number): string {
    const totalBars = 20;
    const filledBars = Math.round((percentage / 100) * totalBars);
    const emptyBars = totalBars - filledBars;
    
    const filled = '█'.repeat(filledBars);
    const empty = '░'.repeat(emptyBars);
    
    return `\`${filled}${empty}\``;
  }

  /**
   * Get display name for streaming stage
   */
  private getStageDisplayName(stage: StreamingStage | string): string {
    const stageNames: Record<string, string> = {
      'initializing': '초기화 중',
      'fetching_members': '멤버 정보 수집',
      'processing_data': '데이터 처리 중',
      'generating_partial': '부분 결과 생성',
      'streaming_results': '결과 스트리밍',
      'finalizing': '최종 처리',
      'completed': '완료됨',
      'error': '오류 발생'
    };

    return stageNames[stage] || stage;
  }

  /**
   * Format duration in milliseconds to readable string
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}분 ${remainingSeconds}초`;
    } else {
      return `${remainingSeconds}초`;
    }
  }

  /**
   * Chunk embeds for Discord message limits
   */
  private chunkEmbeds(embeds: EmbedBuilder[], maxPerChunk: number): EmbedBuilder[][] {
    const chunks: EmbedBuilder[][] = [];
    
    for (let i = 0; i < embeds.length; i += maxPerChunk) {
      chunks.push(embeds.slice(i, i + maxPerChunk));
    }
    
    return chunks;
  }

  /**
   * Clean up message context
   */
  private cleanupContext(operationId: string): void {
    this.messageContexts.delete(operationId);
    console.log(`[DiscordStreaming] Cleaned up context for: ${operationId}`);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}