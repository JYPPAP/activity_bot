// src/services/IntegratedReportService.ts - Integration service for template and embed systems
import { injectable, inject } from 'tsyringe';
import { ChatInputCommandInteraction, TextChannel, EmbedBuilder } from 'discord.js';

import {
  IActivityReportTemplateService,
  ActivityReportTemplate,
  TemplateConfig,
  TemplateFormattingOptions
} from '../interfaces/IActivityReportTemplate';
import {
  IReliableEmbedSender,
  EmbedSendResult,
  ReliableEmbedSendOptions,
  ThreeSectionReport
} from '../interfaces/IReliableEmbedSender';
import { DI_TOKENS } from '../interfaces/index';
import { EmbedFactory, UserActivityData } from '../utils/embedBuilder';
import { COLORS } from '../config/constants';

// Integration service configuration
export interface IntegratedReportConfig {
  // Template settings
  templateConfig?: Partial<TemplateConfig>;
  formattingOptions?: Partial<TemplateFormattingOptions>;
  
  // Embed settings
  embedSendOptions?: Partial<ReliableEmbedSendOptions>;
  
  // Output preferences
  preferEmbeds?: boolean;
  includeTextFallback?: boolean;
  enableHybridMode?: boolean;
  
  // Performance settings
  maxMembersForEmbedMode?: number;
  enableTemplateCache?: boolean;
}

// Default integration configuration
export const DEFAULT_INTEGRATED_CONFIG: IntegratedReportConfig = {
  preferEmbeds: true,
  includeTextFallback: true,
  enableHybridMode: true,
  maxMembersForEmbedMode: 50,
  enableTemplateCache: true,
  templateConfig: {
    maxMembersPerSection: 25,
    enablePagination: true,
    pageSize: 10,
    timeFormat: 'korean',
    sortOrder: 'time_desc',
    alignmentStyle: 'table',
    useUnicodeEmojis: true
  },
  formattingOptions: {
    useKoreanNumbers: true,
    koreanDateFormat: 'short',
    nameColumnWidth: 20,
    timeColumnWidth: 12,
    highlightTopPerformers: true,
    nameTextStyle: 'plain',
    timeTextStyle: 'bold'
  },
  embedSendOptions: {
    maxRetries: 3,
    enableTextFallback: true,
    enableProgressTracking: true,
    strictValidation: true,
    autoTruncate: true
  }
};

@injectable()
export class IntegratedReportService {
  constructor(
    @inject(DI_TOKENS.IActivityReportTemplateService)
    private readonly templateService: IActivityReportTemplateService,
    
    @inject(DI_TOKENS.IReliableEmbedSender)
    private readonly embedSender: IReliableEmbedSender
  ) {}

  /**
   * Generate and send a comprehensive activity report using both template and embed systems
   */
  async generateAndSendIntegratedReport(
    target: ChatInputCommandInteraction | TextChannel,
    reportData: {
      roleFilter: string;
      activeUsers: UserActivityData[];
      inactiveUsers: UserActivityData[];
      afkUsers: UserActivityData[];
      dateRange: { startDate: Date; endDate: Date };
      minHours: number;
    },
    config: Partial<IntegratedReportConfig> = {}
  ): Promise<{
    templateResult?: ActivityReportTemplate;
    embedResult?: EmbedSendResult;
    textOutput?: string;
    success: boolean;
    mode: 'embeds' | 'text' | 'hybrid';
    executionTime: number;
  }> {
    const startTime = Date.now();
    const mergedConfig = { ...DEFAULT_INTEGRATED_CONFIG, ...config };
    const totalMembers = reportData.activeUsers.length + reportData.inactiveUsers.length + reportData.afkUsers.length;

    try {
      // Step 1: Create template for structured data
      const template = await this.templateService.createTemplate(
        reportData.roleFilter,
        reportData.activeUsers,
        reportData.inactiveUsers,
        reportData.afkUsers,
        reportData.dateRange,
        reportData.minHours,
        mergedConfig.templateConfig
      );

      // Step 2: Determine output mode based on configuration and member count
      const outputMode = this.determineOutputMode(totalMembers, mergedConfig);

      let embedResult: EmbedSendResult | undefined;
      let textOutput: string | undefined;

      switch (outputMode) {
        case 'embeds':
          embedResult = await this.sendAsEmbeds(target, template, mergedConfig);
          break;
          
        case 'text':
          textOutput = await this.sendAsText(target, template, mergedConfig);
          break;
          
        case 'hybrid':
          const hybridResult = await this.sendAsHybrid(target, template, mergedConfig);
          embedResult = hybridResult.embedResult;
          textOutput = hybridResult.textOutput;
          break;
      }

      return {
        templateResult: template,
        embedResult,
        textOutput,
        success: true,
        mode: outputMode,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      console.error('[IntegratedReportService] Report generation failed:', error);
      
      // Fallback to simple text output
      try {
        const fallbackText = this.createFallbackTextReport(reportData);
        await this.sendSimpleTextMessage(target, fallbackText);
        
        return {
          success: false,
          mode: 'text',
          textOutput: fallbackText,
          executionTime: Date.now() - startTime
        };
      } catch (fallbackError) {
        console.error('[IntegratedReportService] Fallback also failed:', fallbackError);
        
        return {
          success: false,
          mode: 'text',
          executionTime: Date.now() - startTime
        };
      }
    }
  }

  /**
   * Generate template-based text report for Discord embeds
   */
  async generateTemplateForEmbeds(
    reportData: {
      roleFilter: string;
      activeUsers: UserActivityData[];
      inactiveUsers: UserActivityData[];
      afkUsers: UserActivityData[];
      dateRange: { startDate: Date; endDate: Date };
      minHours: number;
    },
    config: Partial<TemplateConfig> = {}
  ): Promise<{
    template: ActivityReportTemplate;
    threeSectionReport: ThreeSectionReport;
  }> {
    // Create template with embed-optimized configuration
    const embedOptimizedConfig: Partial<TemplateConfig> = {
      maxMembersPerSection: 25, // Discord embed field limit
      enablePagination: false,  // Handled by embed chunking
      alignmentStyle: 'list',   // Better for embed fields
      ...config
    };

    const template = await this.templateService.createTemplate(
      reportData.roleFilter,
      reportData.activeUsers,
      reportData.inactiveUsers,
      reportData.afkUsers,
      reportData.dateRange,
      reportData.minHours,
      embedOptimizedConfig
    );

    // Convert template to ThreeSectionReport format
    const threeSectionReport = this.convertTemplateToThreeSectionReport(template, reportData);

    return { template, threeSectionReport };
  }

  /**
   * Get service performance statistics
   */
  getPerformanceStats() {
    return {
      templateService: 'Available',
      embeddedSender: this.embedSender.getStatistics(),
      integration: 'Active'
    };
  }

  // Private helper methods

  private determineOutputMode(
    totalMembers: number, 
    config: IntegratedReportConfig
  ): 'embeds' | 'text' | 'hybrid' {
    if (!config.preferEmbeds) {
      return 'text';
    }

    if (config.enableHybridMode && totalMembers > (config.maxMembersForEmbedMode || 50)) {
      return 'hybrid';
    }

    if (totalMembers > (config.maxMembersForEmbedMode || 50)) {
      return 'text';
    }

    return 'embeds';
  }

  private async sendAsEmbeds(
    target: ChatInputCommandInteraction | TextChannel,
    template: ActivityReportTemplate,
    config: IntegratedReportConfig
  ): Promise<EmbedSendResult> {
    // Create embeds using existing EmbedFactory
    const embeds = EmbedFactory.createActivityEmbeds({
      role: template.roleFilter,
      activeUsers: template.achievementSection.memberData,
      inactiveUsers: template.underperformanceSection.memberData,
      afkUsers: template.afkSection?.memberData || [],
      startDate: template.dateRange.startDate,
      endDate: template.dateRange.endDate,
      minHours: template.minHours,
      title: '활동 보고서'
    });

    // Add template-enhanced footer with statistics
    if (embeds.length > 0) {
      const lastEmbed = embeds[embeds.length - 1];
      const summaryText = this.createSummaryFooter(template.summary);
      lastEmbed.setFooter({ text: summaryText });
    }

    return await this.embedSender.sendEmbeds(target, embeds, config.embedSendOptions);
  }

  private async sendAsText(
    target: ChatInputCommandInteraction | TextChannel,
    template: ActivityReportTemplate,
    config: IntegratedReportConfig
  ): Promise<string> {
    const textOutput = this.templateService.formatTemplateAsText(
      template,
      config.formattingOptions
    );

    // Send as text message with potential chunking
    await this.sendTextMessage(target, textOutput);
    
    return textOutput;
  }

  private async sendAsHybrid(
    target: ChatInputCommandInteraction | TextChannel,
    template: ActivityReportTemplate,
    config: IntegratedReportConfig
  ): Promise<{
    embedResult?: EmbedSendResult;
    textOutput?: string;
  }> {
    // Send summary as embed, details as text
    const summaryEmbed = this.createSummaryEmbed(template);
    const embedResult = await this.embedSender.sendEmbeds(
      target, 
      [summaryEmbed], 
      config.embedSendOptions
    );

    // Send detailed breakdown as formatted text
    const detailText = this.createDetailedTextBreakdown(template, config.formattingOptions);
    await this.sendTextMessage(target, detailText);

    return {
      embedResult,
      textOutput: detailText
    };
  }

  private convertTemplateToThreeSectionReport(
    template: ActivityReportTemplate,
    reportData: {
      roleFilter: string;
      activeUsers: UserActivityData[];
      inactiveUsers: UserActivityData[];
      afkUsers: UserActivityData[];
      dateRange: { startDate: Date; endDate: Date };
      minHours: number;
    }
  ): ThreeSectionReport {
    // Create embeds for each section using the template data
    const achievementEmbeds = this.createSectionEmbeds(
      template.achievementSection, 
      reportData.dateRange,
      reportData.roleFilter
    );

    const underperformanceEmbeds = this.createSectionEmbeds(
      template.underperformanceSection,
      reportData.dateRange,
      reportData.roleFilter
    );

    let afkEmbeds: EmbedBuilder[] = [];
    if (template.afkSection) {
      afkEmbeds = this.createSectionEmbeds(
        template.afkSection,
        reportData.dateRange,
        reportData.roleFilter
      );
    }

    return {
      achievementSection: {
        title: template.achievementSection.title,
        embeds: achievementEmbeds,
        sectionType: 'achievement',
        priority: 'high'
      },
      underperformanceSection: {
        title: template.underperformanceSection.title,
        embeds: underperformanceEmbeds,
        sectionType: 'underperformance',
        priority: 'medium'
      },
      afkSection: template.afkSection ? {
        title: template.afkSection.title,
        embeds: afkEmbeds,
        sectionType: 'afk',
        priority: 'low'
      } : undefined,
      metadata: {
        reportId: template.reportId,
        generatedAt: template.generatedAt,
        totalMembers: template.summary.totalMembersProcessed,
        roleFilter: template.roleFilter,
        dateRange: template.dateRange
      }
    };
  }

  private createSectionEmbeds(
    section: any, 
    dateRange: { startDate: Date; endDate: Date },
    roleFilter: string
  ): EmbedBuilder[] {
    const embed = new EmbedBuilder()
      .setColor(section.color)
      .setTitle(`${section.emoji} ${section.title}`)
      .setDescription(section.description)
      .setTimestamp();

    // Add member fields
    if (section.memberData.length > 0) {
      const names = section.memberData.map((user: UserActivityData) => user.nickname || user.userId);
      const times = section.memberData.map((user: UserActivityData) => `${Math.floor(user.totalTime / (1000 * 60 * 60))}h ${Math.floor((user.totalTime % (1000 * 60 * 60)) / (1000 * 60))}m`);

      embed.addFields(
        { name: '이름', value: names.join('\n'), inline: true },
        { name: '활동시간', value: times.join('\n'), inline: true }
      );

      // Add AFK dates if applicable
      if (section.memberData.some((user: UserActivityData) => user.afkUntil)) {
        const afkDates = section.memberData.map((user: UserActivityData) => 
          user.afkUntil ? new Date(user.afkUntil).toLocaleDateString('ko-KR') : '-'
        );
        embed.addFields({ name: '해제예정일', value: afkDates.join('\n'), inline: true });
      }
    } else {
      embed.addFields({ name: '\u200B', value: '해당하는 멤버가 없습니다.' });
    }

    return [embed];
  }

  private createSummaryEmbed(template: ActivityReportTemplate): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle('📊 활동 보고서 요약')
      .setDescription(`**${template.roleFilter}** 역할 활동 현황`)
      .addFields(
        { name: '📈 총 처리 멤버', value: `${template.summary.totalMembersProcessed}명`, inline: true },
        { name: '✅ 기준 달성', value: `${template.summary.achievingMembers}명`, inline: true },
        { name: '❌ 기준 미달성', value: `${template.summary.underperformingMembers}명`, inline: true },
        { name: '💤 잠수 상태', value: `${template.summary.afkMembers}명`, inline: true },
        { name: '⏱️ 평균 활동시간', value: `${Math.floor(template.summary.averageActivityTime / (1000 * 60 * 60))}h ${Math.floor((template.summary.averageActivityTime % (1000 * 60 * 60)) / (1000 * 60))}m`, inline: true },
        { name: '🏆 최고 활동자', value: template.summary.topPerformer ? `${template.summary.topPerformer.name}` : '없음', inline: true }
      )
      .setFooter({ text: `보고서 ID: ${template.reportId}` })
      .setTimestamp();

    return embed;
  }

  private createDetailedTextBreakdown(
    template: ActivityReportTemplate,
    formattingOptions?: Partial<TemplateFormattingOptions>
  ): string {
    return this.templateService.formatTemplateAsText(template, formattingOptions);
  }

  private createSummaryFooter(summary: ActivityReportTemplate['summary']): string {
    return `총 ${summary.totalMembersProcessed}명 | 달성 ${summary.achievingMembers}명 | 미달성 ${summary.underperformingMembers}명 | 잠수 ${summary.afkMembers}명`;
  }

  private async sendTextMessage(
    target: ChatInputCommandInteraction | TextChannel,
    content: string
  ): Promise<void> {
    // Split content if too long for Discord
    const maxLength = 2000;
    if (content.length <= maxLength) {
      if (target instanceof ChatInputCommandInteraction) {
        if (target.deferred || target.replied) {
          await target.followUp({ content });
        } else {
          await target.reply({ content });
        }
      } else {
        await target.send({ content });
      }
    } else {
      // Split into multiple messages
      const chunks = this.splitText(content, maxLength);
      for (let i = 0; i < chunks.length; i++) {
        const chunkContent = i === 0 ? chunks[i] : `**계속 (${i + 1}/${chunks.length})**\n\n${chunks[i]}`;
        
        if (target instanceof ChatInputCommandInteraction) {
          if (target.deferred || target.replied || i > 0) {
            await target.followUp({ content: chunkContent });
          } else {
            await target.reply({ content: chunkContent });
          }
        } else {
          await target.send({ content: chunkContent });
        }
        
        // Add delay between chunks
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
  }

  private async sendSimpleTextMessage(
    target: ChatInputCommandInteraction | TextChannel,
    content: string
  ): Promise<void> {
    if (target instanceof ChatInputCommandInteraction) {
      if (target.deferred || target.replied) {
        await target.followUp({ content });
      } else {
        await target.reply({ content });
      }
    } else {
      await target.send({ content });
    }
  }

  private splitText(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let currentChunk = '';
    const lines = text.split('\n');
    
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

  private createFallbackTextReport(reportData: {
    roleFilter: string;
    activeUsers: UserActivityData[];
    inactiveUsers: UserActivityData[];
    afkUsers: UserActivityData[];
    dateRange: { startDate: Date; endDate: Date };
    minHours: number;
  }): string {
    const lines: string[] = [];
    
    lines.push('⚠️ **보고서 생성 중 오류 발생 - 간단한 형식으로 출력**\n');
    lines.push(`**역할:** ${reportData.roleFilter}`);
    lines.push(`**기간:** ${reportData.dateRange.startDate.toLocaleDateString('ko-KR')} ~ ${reportData.dateRange.endDate.toLocaleDateString('ko-KR')}`);
    lines.push(`**최소 활동 시간:** ${reportData.minHours}시간\n`);
    
    lines.push(`✅ **활동 기준 달성 멤버 (${reportData.activeUsers.length}명)**`);
    if (reportData.activeUsers.length > 0) {
      reportData.activeUsers.forEach(user => {
        const hours = Math.floor(user.totalTime / (1000 * 60 * 60));
        const minutes = Math.floor((user.totalTime % (1000 * 60 * 60)) / (1000 * 60));
        lines.push(`- ${user.nickname || user.userId}: ${hours}h ${minutes}m`);
      });
    } else {
      lines.push('- 없음');
    }
    
    lines.push(`\n❌ **활동 기준 미달성 멤버 (${reportData.inactiveUsers.length}명)**`);
    if (reportData.inactiveUsers.length > 0) {
      reportData.inactiveUsers.forEach(user => {
        const hours = Math.floor(user.totalTime / (1000 * 60 * 60));
        const minutes = Math.floor((user.totalTime % (1000 * 60 * 60)) / (1000 * 60));
        lines.push(`- ${user.nickname || user.userId}: ${hours}h ${minutes}m`);
      });
    } else {
      lines.push('- 없음');
    }
    
    if (reportData.afkUsers.length > 0) {
      lines.push(`\n💤 **잠수 중인 멤버 (${reportData.afkUsers.length}명)**`);
      reportData.afkUsers.forEach(user => {
        const hours = Math.floor(user.totalTime / (1000 * 60 * 60));
        const minutes = Math.floor((user.totalTime % (1000 * 60 * 60)) / (1000 * 60));
        const afkDate = user.afkUntil ? new Date(user.afkUntil).toLocaleDateString('ko-KR') : '미정';
        lines.push(`- ${user.nickname || user.userId}: ${hours}h ${minutes}m (해제: ${afkDate})`);
      });
    }
    
    return lines.join('\n');
  }
}