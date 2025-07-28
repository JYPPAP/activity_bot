// src/services/EmbedChunkingSystem.ts - Discord embed chunking system implementation
import { 
  EmbedBuilder, 
  ChatInputCommandInteraction, 
  TextChannel, 
  Message,
  ButtonBuilder,
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonStyle
} from 'discord.js';
import { injectable } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';

import {
  IEmbedChunkingSystem,
  EmbedChunkingConfig,
  EmbedChunk,
  ChunkingResult,
  NavigationState,
  FileAttachmentData,
  DEFAULT_CHUNKING_CONFIG,
  NAVIGATION_BUTTON_IDS,
  EmbedChunkingError,
  NavigationError,
  FileFallbackError,
  ChunkingStrategy
} from '../interfaces/IEmbedChunkingSystem.js';
import { LIMITS } from '../config/constants.js';
import { calculateEmbedLength } from '../utils/embedBuilder.js';

// Performance and statistics tracking
interface ChunkingStatistics {
  totalOperations: number;
  totalChunksCreated: number;
  fileFallbackCount: number;
  navigationSessionsCreated: number;
  averageProcessingTime: number;
  totalCharactersProcessed: number;
  compressionSavings: number;
}

@injectable()
export class EmbedChunkingSystem implements IEmbedChunkingSystem {
  private activeNavigationSessions = new Map<string, NavigationState>();
  private statistics: ChunkingStatistics = {
    totalOperations: 0,
    totalChunksCreated: 0,
    fileFallbackCount: 0,
    navigationSessionsCreated: 0,
    averageProcessingTime: 0,
    totalCharactersProcessed: 0,
    compressionSavings: 0
  };

  constructor() {
    // Set up cleanup interval for expired navigation sessions
    setInterval(() => {
      this.cleanupExpiredSessions().catch(console.error);
    }, 60000); // Clean up every minute
  }

  /**
   * Split large embed content into manageable chunks
   */
  async chunkEmbeds(
    embeds: EmbedBuilder[],
    config: Partial<EmbedChunkingConfig> = {}
  ): Promise<ChunkingResult> {
    const startTime = Date.now();
    const mergedConfig = { ...DEFAULT_CHUNKING_CONFIG, ...config };
    
    this.statistics.totalOperations++;

    try {
      // Analyze input data
      const totalOriginalSize = embeds.reduce((sum, embed) => sum + calculateEmbedLength(embed), 0);

      // Determine chunking strategy
      const strategy = this.determineChunkingStrategy(embeds, mergedConfig);
      
      // Perform chunking based on strategy
      let chunks: EmbedChunk[];
      switch (strategy) {
        case 'field_based':
          chunks = await this.chunkByFields(embeds, mergedConfig);
          break;
        case 'character_based':
          chunks = await this.chunkByCharacters(embeds, mergedConfig);
          break;
        case 'hybrid':
          chunks = await this.chunkByHybrid(embeds, mergedConfig);
          break;
        default:
          throw new EmbedChunkingError(`Unknown chunking strategy: ${strategy}`);
      }

      // Calculate statistics
      const totalChunkedSize = chunks.reduce((sum, chunk) => sum + chunk.characterCount, 0);
      const compressionRatio = totalOriginalSize > 0 ? totalChunkedSize / totalOriginalSize : 1;
      const estimatedSendTime = chunks.length * mergedConfig.sendDelay;
      const requiresFileFallback = chunks.length > mergedConfig.fileFallbackThreshold;

      // Update statistics
      this.statistics.totalChunksCreated += chunks.length;
      this.statistics.totalCharactersProcessed += totalOriginalSize;
      this.statistics.compressionSavings += Math.max(0, totalOriginalSize - totalChunkedSize);

      const result: ChunkingResult = {
        chunks,
        totalChunks: chunks.length,
        totalCharacters: totalChunkedSize,
        totalFields: chunks.reduce((sum, chunk) => sum + chunk.fieldCount, 0),
        estimatedSendTime,
        requiresFileFallback,
        navigationEnabled: mergedConfig.enableNavigation && chunks.length > 1,
        metadata: {
          originalDataSize: totalOriginalSize,
          compressionRatio,
          chunkingStrategy: strategy,
          generatedAt: new Date()
        }
      };

      // Update average processing time
      const processingTime = Date.now() - startTime;
      this.statistics.averageProcessingTime = 
        (this.statistics.averageProcessingTime * (this.statistics.totalOperations - 1) + processingTime) / 
        this.statistics.totalOperations;

      return result;

    } catch (error) {
      throw new EmbedChunkingError(
        `Failed to chunk embeds: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        embeds.length,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Send chunked embeds with sequential delivery and navigation
   */
  async sendChunkedEmbeds(
    target: ChatInputCommandInteraction | TextChannel,
    chunks: EmbedChunk[],
    config: Partial<EmbedChunkingConfig> = {}
  ): Promise<{
    messages: Message[];
    navigationState?: NavigationState;
    fallbackAttachment?: FileAttachmentData;
    success: boolean;
    sendTime: number;
  }> {
    const startTime = Date.now();
    const mergedConfig = { ...DEFAULT_CHUNKING_CONFIG, ...config };
    const messages: Message[] = [];

    try {
      // Check if file fallback is needed
      if (mergedConfig.enableFileFallback && chunks.length > mergedConfig.fileFallbackThreshold) {
        const originalEmbeds = chunks.map(chunk => chunk.embed);
        const fallbackAttachment = await this.createFileAttachment(
          originalEmbeds,
          mergedConfig.attachmentFormat
        );

        // Send file attachment instead
        const attachmentBuilder = new AttachmentBuilder(
          Buffer.from(fallbackAttachment.content),
          { name: fallbackAttachment.filename }
        );

        const fallbackMessage = await this.sendMessage(target, {
          content: `📊 **보고서가 너무 커서 파일로 첨부됩니다**\n\n` +
                  `📁 **파일 정보:**\n` +
                  `• 파일명: ${fallbackAttachment.filename}\n` +
                  `• 크기: ${this.formatFileSize(fallbackAttachment.size)}\n` +
                  `• 형식: ${fallbackAttachment.format.toUpperCase()}\n` +
                  `• 원본 임베드: ${fallbackAttachment.metadata.originalEmbedCount}개\n` +
                  `• 총 문자 수: ${fallbackAttachment.metadata.totalCharacters.toLocaleString()}자`,
          files: [attachmentBuilder]
        });

        messages.push(fallbackMessage);
        this.statistics.fileFallbackCount++;

        return {
          messages,
          fallbackAttachment,
          success: true,
          sendTime: Date.now() - startTime
        };
      }

      // Send chunks sequentially
      let navigationState: NavigationState | undefined;

      if (mergedConfig.enableNavigation && chunks.length > 1) {
        // Create navigation session
        const sessionId = uuidv4();
        const currentUserId = target instanceof ChatInputCommandInteraction ? target.user.id : 'system';
        const channelId = target instanceof ChatInputCommandInteraction ? target.channelId : target.id;

        navigationState = {
          sessionId,
          currentPage: 1,
          totalPages: chunks.length,
          userId: currentUserId,
          channelId,
          messageId: '', // Will be set after first message
          chunks,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + mergedConfig.navigationTimeout),
          isActive: true
        };

        // Send first chunk with navigation
        const firstChunk = chunks[0];
        const navigationButtons = this.createNavigationButtons(1, chunks.length, sessionId);
        
        const firstMessage = await this.sendMessage(target, {
          embeds: [firstChunk.embed],
          components: navigationButtons
        });

        navigationState.messageId = firstMessage.id;
        this.activeNavigationSessions.set(sessionId, navigationState);
        messages.push(firstMessage);
        this.statistics.navigationSessionsCreated++;

      } else {
        // Send all chunks without navigation
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          
          // Add delay between chunks (except for first one)
          if (i > 0 && mergedConfig.sendDelay > 0) {
            await this.delay(mergedConfig.sendDelay);
          }

          // Add page information to embed if multiple chunks
          if (chunks.length > 1) {
            const pageInfo = `페이지 ${i + 1}/${chunks.length}`;
            const embedCopy = new EmbedBuilder(chunk.embed.toJSON());
            
            // Add page info to footer
            const existingFooter = embedCopy.toJSON().footer;
            const newFooterText = existingFooter 
              ? `${existingFooter.text} | ${pageInfo}`
              : pageInfo;
            
            const footerOptions: any = { text: newFooterText };
            if (existingFooter?.icon_url) {
              footerOptions.iconURL = existingFooter.icon_url;
            }
            embedCopy.setFooter(footerOptions);

            chunk.embed = embedCopy;
          }

          const message = await this.sendMessage(target, {
            embeds: [chunk.embed]
          });

          messages.push(message);
        }
      }

      const result: any = {
        messages,
        success: true,
        sendTime: Date.now() - startTime
      };
      if (navigationState) {
        result.navigationState = navigationState;
      }
      return result;

    } catch (error) {
      throw new EmbedChunkingError(
        `Failed to send chunked embeds: ${error instanceof Error ? error.message : 'Unknown error'}`,
        messages.length,
        chunks.length,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Create file attachment fallback for oversized reports
   */
  async createFileAttachment(
    embeds: EmbedBuilder[],
    format: 'txt' | 'json' | 'csv',
    filename?: string
  ): Promise<FileAttachmentData> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const defaultFilename = `discord-report-${timestamp}.${format}`;
      const finalFilename = filename || defaultFilename;

      let content: string;
      let totalCharacters = 0;

      switch (format) {
        case 'txt':
          content = this.convertEmbedsToText(embeds);
          break;
        case 'json':
          content = this.convertEmbedsToJSON(embeds);
          break;
        case 'csv':
          content = this.convertEmbedsToCSV(embeds);
          break;
        default:
          throw new FileFallbackError(`Unsupported format: ${format}`);
      }

      totalCharacters = embeds.reduce((sum, embed) => sum + calculateEmbedLength(embed), 0);

      return {
        filename: finalFilename,
        content,
        size: Buffer.byteLength(content, 'utf8'),
        format,
        encoding: 'utf8',
        metadata: {
          originalEmbedCount: embeds.length,
          totalCharacters,
          compressionUsed: false,
          generatedAt: new Date()
        }
      };

    } catch (error) {
      throw new FileFallbackError(
        `Failed to create file attachment: ${error instanceof Error ? error.message : 'Unknown error'}`,
        embeds.length,
        format
      );
    }
  }

  /**
   * Handle navigation interactions (page buttons)
   */
  async handleNavigation(
    interaction: any,
    navigationState: NavigationState
  ): Promise<void> {
    try {
      if (!navigationState.isActive) {
        await interaction.reply({
          content: '❌ 이 네비게이션 세션이 만료되었습니다.',
          ephemeral: true
        });
        return;
      }

      const customId = interaction.customId;
      let newPage = navigationState.currentPage;

      switch (customId) {
        case NAVIGATION_BUTTON_IDS.FIRST_PAGE:
          newPage = 1;
          break;
        case NAVIGATION_BUTTON_IDS.PREVIOUS_PAGE:
          newPage = Math.max(1, navigationState.currentPage - 1);
          break;
        case NAVIGATION_BUTTON_IDS.NEXT_PAGE:
          newPage = Math.min(navigationState.totalPages, navigationState.currentPage + 1);
          break;
        case NAVIGATION_BUTTON_IDS.LAST_PAGE:
          newPage = navigationState.totalPages;
          break;
        case NAVIGATION_BUTTON_IDS.CLOSE_SESSION:
          navigationState.isActive = false;
          await interaction.update({
            components: []
          });
          this.activeNavigationSessions.delete(navigationState.sessionId);
          return;
        default:
          throw new NavigationError(`Unknown navigation action: ${customId}`);
      }

      if (newPage === navigationState.currentPage) {
        await interaction.reply({
          content: '📋 이미 해당 페이지를 보고 있습니다.',
          ephemeral: true
        });
        return;
      }

      // Update page
      navigationState.currentPage = newPage;
      const chunk = navigationState.chunks[newPage - 1];
      const navigationButtons = this.createNavigationButtons(
        newPage, 
        navigationState.totalPages, 
        navigationState.sessionId
      );

      await interaction.update({
        embeds: [chunk.embed],
        components: navigationButtons
      });

      // Update navigation state
      this.activeNavigationSessions.set(navigationState.sessionId, navigationState);

    } catch (error) {
      throw new NavigationError(
        `Navigation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        navigationState.sessionId,
        navigationState.currentPage
      );
    }
  }

  /**
   * Validate embed against Discord limits
   */
  validateEmbedLimits(embed: EmbedBuilder): {
    isValid: boolean;
    violations: {
      type: 'fields' | 'characters' | 'title' | 'description' | 'footer';
      current: number;
      limit: number;
      severity: 'error' | 'warning';
    }[];
    totalCharacters: number;
    fieldCount: number;
  } {
    const data = embed.toJSON();
    const violations = [];
    const totalCharacters = calculateEmbedLength(embed);
    const fieldCount = data.fields?.length || 0;

    // Check total character limit
    if (totalCharacters > LIMITS.MAX_EMBED_DESCRIPTION * 1.5) { // 6000 character limit
      violations.push({
        type: 'characters' as const,
        current: totalCharacters,
        limit: LIMITS.MAX_EMBED_DESCRIPTION * 1.5,
        severity: 'error' as const
      });
    }

    // Check field count
    if (fieldCount > LIMITS.MAX_EMBED_FIELDS) {
      violations.push({
        type: 'fields' as const,
        current: fieldCount,
        limit: LIMITS.MAX_EMBED_FIELDS,
        severity: 'error' as const
      });
    }

    // Check title length
    if (data.title && data.title.length > LIMITS.MAX_EMBED_TITLE) {
      violations.push({
        type: 'title' as const,
        current: data.title.length,
        limit: LIMITS.MAX_EMBED_TITLE,
        severity: 'error' as const
      });
    }

    // Check description length
    if (data.description && data.description.length > LIMITS.MAX_EMBED_DESCRIPTION) {
      violations.push({
        type: 'description' as const,
        current: data.description.length,
        limit: LIMITS.MAX_EMBED_DESCRIPTION,
        severity: 'error' as const
      });
    }

    // Check footer length
    if (data.footer?.text && data.footer.text.length > LIMITS.MAX_EMBED_FOOTER) {
      violations.push({
        type: 'footer' as const,
        current: data.footer.text.length,
        limit: LIMITS.MAX_EMBED_FOOTER,
        severity: 'error' as const
      });
    }

    return {
      isValid: violations.filter(v => v.severity === 'error').length === 0,
      violations,
      totalCharacters,
      fieldCount
    };
  }

  /**
   * Create navigation buttons for paginated embeds
   */
  createNavigationButtons(
    currentPage: number,
    totalPages: number,
    sessionId: string
  ): ActionRowBuilder<ButtonBuilder>[] {
    const row = new ActionRowBuilder<ButtonBuilder>();

    // First page button
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${NAVIGATION_BUTTON_IDS.FIRST_PAGE}_${sessionId}`)
        .setLabel('⏮️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 1)
    );

    // Previous page button
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${NAVIGATION_BUTTON_IDS.PREVIOUS_PAGE}_${sessionId}`)
        .setLabel('◀️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 1)
    );

    // Page indicator (disabled button)
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`page_indicator_${sessionId}`)
        .setLabel(`${currentPage}/${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

    // Next page button
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${NAVIGATION_BUTTON_IDS.NEXT_PAGE}_${sessionId}`)
        .setLabel('▶️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === totalPages)
    );

    // Last page button
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${NAVIGATION_BUTTON_IDS.LAST_PAGE}_${sessionId}`)
        .setLabel('⏭️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === totalPages)
    );

    // Second row for close button
    const closeRow = new ActionRowBuilder<ButtonBuilder>();
    closeRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`${NAVIGATION_BUTTON_IDS.CLOSE_SESSION}_${sessionId}`)
        .setLabel('❌ 닫기')
        .setStyle(ButtonStyle.Danger)
    );

    return [row, closeRow];
  }

  /**
   * Get active navigation sessions
   */
  getActiveNavigationSessions(): NavigationState[] {
    return Array.from(this.activeNavigationSessions.values())
      .filter(session => session.isActive && session.expiresAt > new Date());
  }

  /**
   * Clean up expired navigation sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    const now = new Date();
    let cleanedCount = 0;

    for (const [sessionId, session] of this.activeNavigationSessions.entries()) {
      if (!session.isActive || session.expiresAt <= now) {
        this.activeNavigationSessions.delete(sessionId);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  /**
   * Get chunking system statistics
   */
  getStatistics() {
    const averageChunksPerOperation = this.statistics.totalOperations > 0 
      ? this.statistics.totalChunksCreated / this.statistics.totalOperations 
      : 0;
    
    const characterCompressionRatio = this.statistics.totalCharactersProcessed > 0
      ? this.statistics.compressionSavings / this.statistics.totalCharactersProcessed
      : 0;

    return {
      totalChunkingOperations: this.statistics.totalOperations,
      averageChunksPerOperation: Math.round(averageChunksPerOperation * 100) / 100,
      fileFallbackUsage: this.statistics.fileFallbackCount,
      navigationSessionsActive: this.getActiveNavigationSessions().length,
      averageProcessingTime: Math.round(this.statistics.averageProcessingTime),
      characterCompressionRatio: Math.round(characterCompressionRatio * 10000) / 100
    };
  }

  // Private helper methods

  private determineChunkingStrategy(
    embeds: EmbedBuilder[], 
    config: EmbedChunkingConfig
  ): ChunkingStrategy {
    const totalFields = embeds.reduce((sum, embed) => sum + (embed.toJSON().fields?.length || 0), 0);
    const totalCharacters = embeds.reduce((sum, embed) => sum + calculateEmbedLength(embed), 0);
    
    const fieldsExceedLimit = totalFields > config.maxFieldsPerEmbed;
    const charactersExceedLimit = totalCharacters > config.maxCharactersPerEmbed;

    if (fieldsExceedLimit && charactersExceedLimit) {
      return 'hybrid';
    } else if (fieldsExceedLimit) {
      return 'field_based';
    } else if (charactersExceedLimit) {
      return 'character_based';
    } else {
      return 'field_based'; // Default strategy
    }
  }

  private async chunkByFields(
    embeds: EmbedBuilder[], 
    config: EmbedChunkingConfig
  ): Promise<EmbedChunk[]> {
    const chunks: EmbedChunk[] = [];
    let chunkIndex = 0;

    for (const embed of embeds) {
      const data = embed.toJSON();
      const fields = data.fields || [];
      
      if (fields.length <= config.maxFieldsPerEmbed) {
        // Embed fits in one chunk
        chunks.push(this.createEmbedChunk(embed, chunkIndex++, fields.length));
      } else {
        // Split fields across multiple chunks
        for (let i = 0; i < fields.length; i += config.maxFieldsPerEmbed) {
          const chunkFields = fields.slice(i, i + config.maxFieldsPerEmbed);
          const chunkEmbed = new EmbedBuilder(data)
            .setFields(chunkFields);
          
          chunks.push(this.createEmbedChunk(chunkEmbed, chunkIndex++, chunkFields.length));
        }
      }
    }

    // Update total chunks count
    chunks.forEach(chunk => {
      chunk.totalChunks = chunks.length;
    });

    return chunks;
  }

  private async chunkByCharacters(
    embeds: EmbedBuilder[], 
    config: EmbedChunkingConfig
  ): Promise<EmbedChunk[]> {
    const chunks: EmbedChunk[] = [];
    let chunkIndex = 0;

    for (const embed of embeds) {
      const totalLength = calculateEmbedLength(embed);
      
      if (totalLength <= config.maxCharactersPerEmbed) {
        // Embed fits in one chunk
        chunks.push(this.createEmbedChunk(embed, chunkIndex++, embed.toJSON().fields?.length || 0));
      } else {
        // Need to split by truncating description and fields
        const data = embed.toJSON();
        const fields = data.fields || [];
        
        // Create base embed without fields
        const baseEmbed = new EmbedBuilder(data).setFields([]);
        const baseLength = calculateEmbedLength(baseEmbed);
        
        let remainingSpace = config.maxCharactersPerEmbed - baseLength;
        let currentFields: any[] = [];
        
        for (const field of fields) {
          const fieldLength = field.name.length + field.value.length;
          
          if (remainingSpace >= fieldLength && currentFields.length < config.maxFieldsPerEmbed) {
            currentFields.push(field);
            remainingSpace -= fieldLength;
          } else {
            // Create chunk with current fields
            if (currentFields.length > 0) {
              const chunkEmbed = new EmbedBuilder(data).setFields(currentFields);
              chunks.push(this.createEmbedChunk(chunkEmbed, chunkIndex++, currentFields.length));
            }
            
            // Start new chunk
            currentFields = [field];
            remainingSpace = config.maxCharactersPerEmbed - baseLength - fieldLength;
          }
        }
        
        // Add remaining fields
        if (currentFields.length > 0) {
          const chunkEmbed = new EmbedBuilder(data).setFields(currentFields);
          chunks.push(this.createEmbedChunk(chunkEmbed, chunkIndex++, currentFields.length));
        }
      }
    }

    // Update total chunks count
    chunks.forEach(chunk => {
      chunk.totalChunks = chunks.length;
    });

    return chunks;
  }

  private async chunkByHybrid(
    embeds: EmbedBuilder[], 
    config: EmbedChunkingConfig
  ): Promise<EmbedChunk[]> {
    // First apply field-based chunking, then character-based validation
    let chunks = await this.chunkByFields(embeds, config);
    
    // Validate and re-chunk if character limits are exceeded
    const validatedChunks: EmbedChunk[] = [];
    let chunkIndex = 0;
    
    for (const chunk of chunks) {
      const validation = this.validateEmbedLimits(chunk.embed);
      
      if (validation.isValid) {
        validatedChunks.push({
          ...chunk,
          chunkIndex: chunkIndex++
        });
      } else {
        // Re-chunk this embed using character-based approach
        const rechunked = await this.chunkByCharacters([chunk.embed], config);
        for (const rechunkedChunk of rechunked) {
          validatedChunks.push({
            ...rechunkedChunk,
            chunkIndex: chunkIndex++
          });
        }
      }
    }

    // Update total chunks count
    validatedChunks.forEach(chunk => {
      chunk.totalChunks = validatedChunks.length;
    });

    return validatedChunks;
  }

  private createEmbedChunk(
    embed: EmbedBuilder, 
    chunkIndex: number, 
    fieldCount: number
  ): EmbedChunk {
    const characterCount = calculateEmbedLength(embed);
    const validation = this.validateEmbedLimits(embed);
    
    return {
      embedId: uuidv4(),
      chunkIndex,
      totalChunks: 0, // Will be updated later
      embed,
      characterCount,
      fieldCount,
      timestamp: new Date(),
      isOverLimit: !validation.isValid
    };
  }

  private convertEmbedsToText(embeds: EmbedBuilder[]): string {
    const lines: string[] = [];
    
    lines.push('Discord 보고서 텍스트 형식');
    lines.push('생성일: ' + new Date().toLocaleString('ko-KR'));
    lines.push('=' .repeat(50));
    lines.push('');
    
    embeds.forEach((embed, index) => {
      const data = embed.toJSON();
      
      lines.push(`[임베드 ${index + 1}]`);
      if (data.title) lines.push(`제목: ${data.title}`);
      if (data.description) lines.push(`설명: ${data.description}`);
      
      if (data.fields) {
        lines.push('필드:');
        data.fields.forEach(field => {
          lines.push(`  • ${field.name}: ${field.value}`);
        });
      }
      
      if (data.footer?.text) lines.push(`푸터: ${data.footer.text}`);
      lines.push('');
    });
    
    return lines.join('\n');
  }

  private convertEmbedsToJSON(embeds: EmbedBuilder[]): string {
    const data = {
      metadata: {
        generatedAt: new Date().toISOString(),
        totalEmbeds: embeds.length,
        format: 'json'
      },
      embeds: embeds.map(embed => embed.toJSON())
    };
    
    return JSON.stringify(data, null, 2);
  }

  private convertEmbedsToCSV(embeds: EmbedBuilder[]): string {
    const rows: string[] = [];
    rows.push('Index,Title,Description,FieldCount,CharacterCount');
    
    embeds.forEach((embed, index) => {
      const data = embed.toJSON();
      const fieldCount = data.fields?.length || 0;
      const characterCount = calculateEmbedLength(embed);
      
      const title = (data.title || '').replace(/"/g, '""');
      const description = (data.description || '').replace(/"/g, '""').substring(0, 100);
      
      rows.push(`${index + 1},"${title}","${description}",${fieldCount},${characterCount}`);
    });
    
    return rows.join('\n');
  }

  private async sendMessage(
    target: ChatInputCommandInteraction | TextChannel,
    options: any
  ): Promise<Message> {
    if (target instanceof ChatInputCommandInteraction) {
      if (target.deferred || target.replied) {
        return await target.followUp(options) as Message;
      } else {
        await target.reply(options);
        return await target.fetchReply() as Message;
      }
    } else {
      return await target.send(options);
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}