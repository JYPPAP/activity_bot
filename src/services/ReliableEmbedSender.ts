// src/services/ReliableEmbedSender.ts - Reliable Discord embed sender implementation
import { 
  EmbedBuilder, 
  ChatInputCommandInteraction, 
  TextChannel, 
  Message,
  MessageFlags,
  Client
} from 'discord.js';
import { injectable, inject } from 'tsyringe';

import {
  IReliableEmbedSender,
  EmbedSendResult,
  EmbedSendProgress,
  ReportSectionData,
  ThreeSectionReport,
  ReliableEmbedSendOptions,
  DEFAULT_RELIABLE_EMBED_OPTIONS,
  EmbedValidationError,
  // EmbedSendError, // Commented out - unused
  EmbedChunkingError
} from '../interfaces/IReliableEmbedSender.js';
import { LIMITS } from '../config/constants.js';
import { calculateEmbedLength, /* isEmbedOverLimit, */ chunkEmbeds } from '../utils/embedBuilder.js';
import { DI_TOKENS } from '../interfaces/index.js';

// Performance and statistics tracking
interface ServiceStatistics {
  totalSends: number;
  successfulSends: number;
  totalRetries: number;
  fallbackUsage: number;
  totalExecutionTime: number;
  lastError?: string;
  validationErrors: number;
  chunkingOperations: number;
}

@injectable()
export class ReliableEmbedSender implements IReliableEmbedSender {
  private statistics: ServiceStatistics = {
    totalSends: 0,
    successfulSends: 0,
    totalRetries: 0,
    fallbackUsage: 0,
    totalExecutionTime: 0,
    validationErrors: 0,
    chunkingOperations: 0
  };

  // private readonly discordClient: Client; // Commented out - unused

  constructor(
    @inject(DI_TOKENS.DiscordClient) _discordClient: Client
  ) {
    // this.discordClient = discordClient; // Commented out - unused
  }

  /**
   * Send embeds with comprehensive reliability features
   */
  async sendEmbeds(
    target: ChatInputCommandInteraction | TextChannel,
    embeds: EmbedBuilder[],
    options: Partial<ReliableEmbedSendOptions> = {}
  ): Promise<EmbedSendResult> {
    const startTime = Date.now();
    const opts = { ...DEFAULT_RELIABLE_EMBED_OPTIONS, ...options };
    
    this.statistics.totalSends++;
    
    const result: EmbedSendResult = {
      success: false,
      messagesSent: [],
      errorMessages: [],
      fallbackUsed: false,
      totalEmbeds: embeds.length,
      chunksCreated: 0,
      retryAttempts: 0,
      executionTime: 0,
      validationErrors: []
    };

    try {
      // Stage 1: Progress tracking initialization
      if (opts.enableProgressTracking) {
        this.reportProgress({
          stage: 'validation',
          currentChunk: 0,
          totalChunks: 0,
          embedsProcessed: 0,
          totalEmbeds: embeds.length,
          retryAttempt: 0,
          maxRetries: opts.maxRetries,
          message: '임베드 유효성 검사 시작',
          timestamp: new Date()
        }, opts.progressCallback);
      }

      // Stage 2: Embed validation
      const validation = await this.validateEmbeds(embeds);
      if (!validation.isValid) {
        result.validationErrors = validation.errors;
        this.statistics.validationErrors++;
        
        if (opts.strictValidation) {
          throw new EmbedValidationError(
            `Embed validation failed: ${validation.errors.join(', ')}`,
            validation.errors
          );
        }
        
        // Use corrected embeds if auto-truncation is enabled
        if (opts.autoTruncate && validation.correctedEmbeds) {
          embeds = validation.correctedEmbeds;
        }
      }

      // Stage 3: Chunking
      if (opts.enableProgressTracking) {
        this.reportProgress({
          stage: 'chunking',
          currentChunk: 0,
          totalChunks: 0,
          embedsProcessed: 0,
          totalEmbeds: embeds.length,
          retryAttempt: 0,
          maxRetries: opts.maxRetries,
          message: '임베드 청크 생성 중',
          timestamp: new Date()
        }, opts.progressCallback);
      }

      const chunks = chunkEmbeds(embeds, opts.maxEmbedsPerMessage);
      result.chunksCreated = chunks.length;
      this.statistics.chunkingOperations++;

      // Stage 4: Send chunks with retry mechanism
      const messages: Message[] = [];
      let totalRetries = 0;

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        let chunkSent = false;
        let chunkRetries = 0;

        while (!chunkSent && chunkRetries <= opts.maxRetries) {
          try {
            if (opts.enableProgressTracking) {
              this.reportProgress({
                stage: chunkRetries > 0 ? 'retry' : 'sending',
                currentChunk: chunkIndex + 1,
                totalChunks: chunks.length,
                embedsProcessed: chunkIndex * opts.maxEmbedsPerMessage,
                totalEmbeds: embeds.length,
                retryAttempt: chunkRetries,
                maxRetries: opts.maxRetries,
                message: `청크 ${chunkIndex + 1}/${chunks.length} 전송 중${chunkRetries > 0 ? ` (재시도 ${chunkRetries})` : ''}`,
                timestamp: new Date()
              }, opts.progressCallback);
            }

            const message = await this.sendChunk(target, chunk, opts, chunkIndex > 0);
            messages.push(message);
            chunkSent = true;

            // Add delay between chunks to prevent rate limiting
            if (chunkIndex < chunks.length - 1 && opts.chunkDelayMs > 0) {
              await this.delay(opts.chunkDelayMs);
            }

          } catch (error) {
            chunkRetries++;
            totalRetries++;
            
            if (chunkRetries <= opts.maxRetries) {
              const delay = opts.retryDelayMs * Math.pow(opts.backoffMultiplier, chunkRetries - 1);
              await this.delay(delay);
            } else {
              throw new EmbedChunkingError(
                `Failed to send chunk ${chunkIndex + 1} after ${opts.maxRetries} retries`,
                chunkIndex,
                chunks.length
              );
            }
          }
        }
      }

      result.messagesSent = messages;
      result.retryAttempts = totalRetries;
      result.success = true;
      this.statistics.successfulSends++;
      this.statistics.totalRetries += totalRetries;

      if (opts.enableProgressTracking) {
        this.reportProgress({
          stage: 'completed',
          currentChunk: chunks.length,
          totalChunks: chunks.length,
          embedsProcessed: embeds.length,
          totalEmbeds: embeds.length,
          retryAttempt: 0,
          maxRetries: opts.maxRetries,
          message: `성공적으로 ${chunks.length}개 청크, ${embeds.length}개 임베드 전송 완료`,
          timestamp: new Date()
        }, opts.progressCallback);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
      result.errorMessages.push(errorMessage);
      this.statistics.lastError = errorMessage;

      // Attempt text fallback if enabled
      if (opts.enableTextFallback && !result.fallbackUsed) {
        try {
          if (opts.enableProgressTracking) {
            this.reportProgress({
              stage: 'fallback',
              currentChunk: 0,
              totalChunks: 1,
              embedsProcessed: 0,
              totalEmbeds: embeds.length,
              retryAttempt: 0,
              maxRetries: 0,
              message: '텍스트 형식으로 폴백 전송 시도',
              timestamp: new Date()
            }, opts.progressCallback);
          }

          const textContent = this.convertEmbedsToText(embeds);
          const fallbackMessage = await this.sendTextFallback(target, textContent, opts);
          
          result.messagesSent = [fallbackMessage];
          result.fallbackUsed = true;
          result.success = true;
          this.statistics.fallbackUsage++;

        } catch (fallbackError) {
          result.errorMessages.push(
            `Fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : '알 수 없는 오류'}`
          );
        }
      }

      if (!result.success && opts.enableProgressTracking) {
        this.reportProgress({
          stage: 'failed',
          currentChunk: 0,
          totalChunks: result.chunksCreated,
          embedsProcessed: 0,
          totalEmbeds: embeds.length,
          retryAttempt: result.retryAttempts,
          maxRetries: opts.maxRetries,
          message: `전송 실패: ${errorMessage}`,
          timestamp: new Date()
        }, opts.progressCallback);
      }
    }

    result.executionTime = Date.now() - startTime;
    this.statistics.totalExecutionTime += result.executionTime;

    return result;
  }

  /**
   * Send structured 3-section report optimized for Korean Discord bot
   */
  async sendThreeSectionReport(
    target: ChatInputCommandInteraction | TextChannel,
    report: ThreeSectionReport,
    options: Partial<ReliableEmbedSendOptions> = {}
  ): Promise<EmbedSendResult> {
    const opts = { ...DEFAULT_RELIABLE_EMBED_OPTIONS, ...options };
    
    // Create ordered sections based on priority and Korean business logic
    const sections: ReportSectionData[] = [
      report.achievementSection,     // 달성 - Always first (positive reinforcement)
      report.underperformanceSection // 미달성 - Second (improvement areas)
    ];
    
    // Add AFK section if it exists and has members
    if (report.afkSection && report.afkSection.embeds.length > 0) {
      sections.push(report.afkSection); // 잠수 - Last (temporary status)
    }

    // Combine all embeds in proper order
    const allEmbeds: EmbedBuilder[] = [];
    
    sections.forEach(section => {
      // Add section header if multiple sections exist
      if (sections.length > 1 && section.embeds.length > 0) {
        const sectionHeaderEmbed = new EmbedBuilder()
          .setColor(this.getSectionColor(section.sectionType))
          .setTitle(`📋 ${section.title}`)
          .setDescription(`${this.getSectionEmoji(section.sectionType)} ${this.getSectionDescription(section.sectionType)}`)
          .setTimestamp();
        
        allEmbeds.push(sectionHeaderEmbed);
      }
      
      allEmbeds.push(...section.embeds);
    });

    // Add metadata footer to last embed
    if (allEmbeds.length > 0) {
      const lastEmbed = allEmbeds[allEmbeds.length - 1];
      const metadata = report.metadata;
      
      lastEmbed.setFooter({
        text: `보고서 ID: ${metadata.reportId} | 생성일: ${metadata.generatedAt.toLocaleString('ko-KR')} | 총 ${metadata.totalMembers}명`
      });
    }

    // Send with enhanced progress tracking
    const enhancedOptions: Partial<ReliableEmbedSendOptions> = {
      ...opts
    };
    
    // Add progressCallback conditionally for exactOptionalPropertyTypes
    if (opts.progressCallback) {
      enhancedOptions.progressCallback = (progress) => {
        // Enhance progress messages for 3-section reports
        const enhancedProgress = {
          ...progress,
          message: this.enhance3SectionProgressMessage(progress, sections.length)
        };
        opts.progressCallback!(enhancedProgress);
      };
    }

    return this.sendEmbeds(target, allEmbeds, enhancedOptions);
  }

  /**
   * Comprehensive embed validation with auto-correction
   */
  async validateEmbeds(embeds: EmbedBuilder[]): Promise<{
    isValid: boolean;
    errors: string[];
    warnings: string[];
    correctedEmbeds?: EmbedBuilder[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const correctedEmbeds: EmbedBuilder[] = [];

    for (let i = 0; i < embeds.length; i++) {
      const embed = embeds[i];
      const embedData = embed.toJSON();
      let correctedEmbed = new EmbedBuilder(embedData);
      let needsCorrection = false;

      // Check total character limit
      const totalLength = calculateEmbedLength(embed);
      if (totalLength > LIMITS.MAX_EMBED_DESCRIPTION * 1.5) { // 6000 character limit
        errors.push(`Embed ${i + 1}: 총 문자 수 초과 (${totalLength}/${LIMITS.MAX_EMBED_DESCRIPTION * 1.5})`);
        needsCorrection = true;
      }

      // Check title length
      if (embedData.title && embedData.title.length > LIMITS.MAX_EMBED_TITLE) {
        errors.push(`Embed ${i + 1}: 제목 길이 초과 (${embedData.title.length}/${LIMITS.MAX_EMBED_TITLE})`);
        correctedEmbed.setTitle(embedData.title.substring(0, LIMITS.MAX_EMBED_TITLE - 3) + '...');
        needsCorrection = true;
      }

      // Check description length
      if (embedData.description && embedData.description.length > LIMITS.MAX_EMBED_DESCRIPTION) {
        errors.push(`Embed ${i + 1}: 설명 길이 초과 (${embedData.description.length}/${LIMITS.MAX_EMBED_DESCRIPTION})`);
        correctedEmbed.setDescription(embedData.description.substring(0, LIMITS.MAX_EMBED_DESCRIPTION - 3) + '...');
        needsCorrection = true;
      }

      // Check field count
      if (embedData.fields && embedData.fields.length > LIMITS.MAX_EMBED_FIELDS) {
        errors.push(`Embed ${i + 1}: 필드 수 초과 (${embedData.fields.length}/${LIMITS.MAX_EMBED_FIELDS})`);
        const truncatedFields = embedData.fields.slice(0, LIMITS.MAX_EMBED_FIELDS);
        correctedEmbed = new EmbedBuilder(embedData).setFields(truncatedFields);
        needsCorrection = true;
      }

      // Check individual field lengths
      if (embedData.fields) {
        let fieldsModified = false;
        const correctedFields = embedData.fields.map((field, fieldIndex) => {
          let correctedField = { ...field };
          
          if (field.name.length > 256) {
            warnings.push(`Embed ${i + 1}, Field ${fieldIndex + 1}: 필드 이름 길이 초과`);
            correctedField.name = field.name.substring(0, 253) + '...';
            fieldsModified = true;
          }
          
          if (field.value.length > 1024) {
            warnings.push(`Embed ${i + 1}, Field ${fieldIndex + 1}: 필드 값 길이 초과`);
            correctedField.value = field.value.substring(0, 1021) + '...';
            fieldsModified = true;
          }
          
          return correctedField;
        });

        if (fieldsModified) {
          correctedEmbed.setFields(correctedFields);
          needsCorrection = true;
        }
      }

      // Check footer length
      if (embedData.footer?.text && embedData.footer.text.length > LIMITS.MAX_EMBED_FOOTER) {
        warnings.push(`Embed ${i + 1}: 푸터 길이 초과`);
        const footerOptions: { text: string; iconURL?: string } = {
          text: embedData.footer.text.substring(0, LIMITS.MAX_EMBED_FOOTER - 3) + '...'
        };
        
        // Add iconURL conditionally for exactOptionalPropertyTypes
        if (embedData.footer.icon_url) {
          footerOptions.iconURL = embedData.footer.icon_url;
        }
        
        correctedEmbed.setFooter(footerOptions);
        needsCorrection = true;
      }

      correctedEmbeds.push(needsCorrection ? correctedEmbed : embed);
    }

    const result: {
      isValid: boolean;
      errors: string[];
      warnings: string[];
      correctedEmbeds?: EmbedBuilder[];
    } = {
      isValid: errors.length === 0,
      errors,
      warnings
    };

    // Add correctedEmbeds conditionally for exactOptionalPropertyTypes
    if (errors.length > 0) {
      result.correctedEmbeds = correctedEmbeds;
    }

    return result;
  }

  /**
   * Convert embeds to structured text format for fallback
   */
  convertEmbedsToText(embeds: EmbedBuilder[]): string {
    const textParts: string[] = [];
    
    embeds.forEach((embed, index) => {
      const data = embed.toJSON();
      const parts: string[] = [];
      
      // Add embed separator for multiple embeds
      if (index > 0) {
        parts.push('\n' + '='.repeat(50) + '\n');
      }
      
      // Title
      if (data.title) {
        parts.push(`**${data.title}**`);
      }
      
      // Description
      if (data.description) {
        parts.push(data.description);
      }
      
      // Fields
      if (data.fields && data.fields.length > 0) {
        parts.push(''); // Empty line before fields
        data.fields.forEach(field => {
          const fieldText = field.inline 
            ? `**${field.name}:** ${field.value}`
            : `**${field.name}**\n${field.value}`;
          parts.push(fieldText);
        });
      }
      
      // Footer
      if (data.footer?.text) {
        parts.push(''); // Empty line before footer
        parts.push(`*${data.footer.text}*`);
      }
      
      textParts.push(parts.join('\n'));
    });
    
    return textParts.join('\n');
  }

  /**
   * Get service statistics
   */
  getStatistics() {
    const successRate = this.statistics.totalSends > 0 
      ? (this.statistics.successfulSends / this.statistics.totalSends) * 100 
      : 0;
    
    const averageRetries = this.statistics.successfulSends > 0
      ? this.statistics.totalRetries / this.statistics.successfulSends
      : 0;
    
    const fallbackUsageRate = this.statistics.totalSends > 0
      ? (this.statistics.fallbackUsage / this.statistics.totalSends) * 100
      : 0;
    
    const averageExecutionTime = this.statistics.successfulSends > 0
      ? this.statistics.totalExecutionTime / this.statistics.successfulSends
      : 0;

    const result: {
      totalSends: number;
      successRate: number;
      averageRetries: number;
      fallbackUsageRate: number;
      averageExecutionTime: number;
      lastError?: string;
    } = {
      totalSends: this.statistics.totalSends,
      successRate: Math.round(successRate * 100) / 100,
      averageRetries: Math.round(averageRetries * 100) / 100,
      fallbackUsageRate: Math.round(fallbackUsageRate * 100) / 100,
      averageExecutionTime: Math.round(averageExecutionTime)
    };

    // Add lastError conditionally for exactOptionalPropertyTypes
    if (this.statistics.lastError) {
      result.lastError = this.statistics.lastError;
    }

    return result;
  }

  // Private helper methods

  private async sendChunk(
    target: ChatInputCommandInteraction | TextChannel,
    chunk: EmbedBuilder[],
    options: ReliableEmbedSendOptions,
    isFollowUp: boolean = false
  ): Promise<Message> {
    const messageOptions: any = {
      embeds: chunk,
      ...(options.allowedMentions && { allowedMentions: options.allowedMentions })
    };

    // Add flags conditionally
    if (options.ephemeral) {
      messageOptions.flags = MessageFlags.Ephemeral;
    }

    if (target instanceof ChatInputCommandInteraction) {
      if (target.deferred || target.replied || isFollowUp) {
        return await target.followUp(messageOptions) as unknown as Message;
      } else {
        return await target.reply(messageOptions) as unknown as Message;
      }
    } else {
      return await target.send(messageOptions);
    }
  }

  private async sendTextFallback(
    target: ChatInputCommandInteraction | TextChannel,
    content: string,
    options: ReliableEmbedSendOptions
  ): Promise<Message> {
    // Split content if it exceeds Discord's message limit
    const maxLength = 2000;
    if (content.length <= maxLength) {
      const messageOptions: any = {
        content: options.textFallbackTemplate 
          ? options.textFallbackTemplate.replace('{content}', content)
          : `⚠️ **임베드 전송 실패 - 텍스트 형식으로 전환**\n\n${content}`
      };

      // Add flags conditionally
      if (options.ephemeral) {
        messageOptions.flags = MessageFlags.Ephemeral;
      }

      if (target instanceof ChatInputCommandInteraction) {
        return target.deferred || target.replied 
          ? await target.followUp(messageOptions) as unknown as Message
          : await target.reply(messageOptions) as unknown as Message;
      } else {
        return await target.send(messageOptions);
      }
    } else {
      // Split long content into multiple messages
      const chunks = this.splitTextContent(content, maxLength - 100); // Reserve space for header
      const messages: Message[] = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const chunkContent = i === 0 
          ? `⚠️ **임베드 전송 실패 - 텍스트 형식으로 전환** (${i + 1}/${chunks.length})\n\n${chunks[i]}`
          : `**(계속 ${i + 1}/${chunks.length})**\n\n${chunks[i]}`;
          
        const messageOptions: any = {
          content: chunkContent
        };

        // Add flags conditionally
        if (options.ephemeral) {
          messageOptions.flags = MessageFlags.Ephemeral;
        }

        if (target instanceof ChatInputCommandInteraction) {
          const message = (target.deferred || target.replied || i > 0)
            ? await target.followUp(messageOptions) as unknown as Message
            : await target.reply(messageOptions) as unknown as Message;
          messages.push(message);
        } else {
          const message = await target.send(messageOptions);
          messages.push(message);
        }
        
        // Add delay between text chunks
        if (i < chunks.length - 1) {
          await this.delay(500);
        }
      }
      
      return messages[0]; // Return first message as primary result
    }
  }

  private splitTextContent(content: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let currentChunk = '';
    const lines = content.split('\n');
    
    for (const line of lines) {
      if ((currentChunk + line + '\n').length > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = line + '\n';
        } else {
          // Single line exceeds limit, force split
          chunks.push(line.substring(0, maxLength - 3) + '...');
        }
      } else {
        currentChunk += line + '\n';
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }

  private reportProgress(
    progress: EmbedSendProgress, 
    callback?: (progress: EmbedSendProgress) => void
  ): void {
    if (callback) {
      try {
        callback(progress);
      } catch (error) {
        console.warn('Progress callback error:', error);
      }
    }
  }

  private getSectionColor(sectionType: ReportSectionData['sectionType']): number {
    switch (sectionType) {
      case 'achievement': return 0x00ff00; // Green
      case 'underperformance': return 0xff0000; // Red  
      case 'afk': return 0xd3d3d3; // Light gray
      default: return 0x0099ff; // Blue
    }
  }

  private getSectionEmoji(sectionType: ReportSectionData['sectionType']): string {
    switch (sectionType) {
      case 'achievement': return '✅';
      case 'underperformance': return '❌';
      case 'afk': return '💤';
      default: return '📊';
    }
  }

  private getSectionDescription(sectionType: ReportSectionData['sectionType']): string {
    switch (sectionType) {
      case 'achievement': return '활동 기준을 달성한 멤버들입니다.';
      case 'underperformance': return '활동 기준에 미달한 멤버들입니다.';
      case 'afk': return '현재 잠수 상태인 멤버들입니다.';
      default: return '보고서 섹션입니다.';
    }
  }

  private enhance3SectionProgressMessage(
    progress: EmbedSendProgress, 
    sectionCount: number
  ): string {
    const baseMessage = progress.message;
    const sectionInfo = sectionCount > 1 ? ` (${sectionCount}개 섹션)` : '';
    
    switch (progress.stage) {
      case 'validation':
        return `3단계 보고서 검증 중${sectionInfo}: ${baseMessage}`;
      case 'chunking':
        return `3단계 보고서 청크 생성${sectionInfo}: ${baseMessage}`;
      case 'sending':
        return `3단계 보고서 전송 중${sectionInfo}: ${baseMessage}`;
      case 'completed':
        return `3단계 보고서 전송 완료${sectionInfo}: ${baseMessage}`;
      default:
        return `3단계 보고서${sectionInfo}: ${baseMessage}`;
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}