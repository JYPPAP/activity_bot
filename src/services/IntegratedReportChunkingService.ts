// src/services/IntegratedReportChunkingService.ts - 통합 보고서 청킹 서비스
import { 
  EmbedBuilder, 
  ChatInputCommandInteraction, 
  TextChannel, 
  Message
} from 'discord.js';
import { injectable, inject } from 'tsyringe';

import {
  IEmbedChunkingSystem,
  EmbedChunkingConfig,
  ChunkingResult,
  NavigationState,
  FileAttachmentData
} from '../interfaces/IEmbedChunkingSystem';
import {
  IReliableEmbedSender,
  ThreeSectionReport,
  ReliableEmbedSendOptions,
  EmbedSendResult
} from '../interfaces/IReliableEmbedSender';
import {
  IActivityReportTemplateService,
  ActivityReportTemplate,
  TemplateFormattingOptions
} from '../interfaces/IActivityReportTemplate';
import { DI_TOKENS } from '../interfaces/index';

export interface IntegratedReportResult {
  success: boolean;
  messages: Message[];
  navigationState?: NavigationState;
  fallbackAttachment?: FileAttachmentData;
  chunkingUsed: boolean;
  totalChunks: number;
  sendTime: number;
  compressionRatio: number;
  fileFallbackUsed: boolean;
}

export interface IntegratedReportOptions {
  // Report generation options
  templateOptions?: Partial<TemplateFormattingOptions>;
  
  // Chunking options
  chunkingConfig?: Partial<EmbedChunkingConfig>;
  enableChunking?: boolean;
  chunkingThreshold?: number; // Number of embeds to trigger chunking
  
  // Reliable sender options
  reliableSendOptions?: Partial<ReliableEmbedSendOptions>;
  enableReliableSending?: boolean;
  
  // Combined options
  preferChunkingOverReliable?: boolean; // If true, use chunking for large reports instead of reliable sender
}

@injectable()
export class IntegratedReportChunkingService {
  constructor(
    @inject(DI_TOKENS.IEmbedChunkingSystem)
    private readonly chunkingSystem: IEmbedChunkingSystem,
    
    @inject(DI_TOKENS.IReliableEmbedSender)
    private readonly reliableEmbedSender: IReliableEmbedSender,
    
    @inject(DI_TOKENS.IActivityReportTemplateService)
    private readonly templateService: IActivityReportTemplateService
  ) {}

  /**
   * 3-섹션 보고서를 청킹과 신뢰성 있는 전송으로 처리
   */
  async sendThreeSectionReportWithChunking(
    target: ChatInputCommandInteraction | TextChannel,
    report: ThreeSectionReport,
    options: IntegratedReportOptions = {}
  ): Promise<IntegratedReportResult> {
    const startTime = Date.now();
    
    try {
      // 기본 옵션 설정
      const {
        enableChunking = true,
        chunkingThreshold = 3,
        enableReliableSending = true,
        preferChunkingOverReliable = true,
        chunkingConfig = {},
        reliableSendOptions = {}
      } = options;

      // 보고서에서 임베드 생성 (ReliableEmbedSender 사용)
      const embedResult = await this.reliableEmbedSender.sendThreeSectionReport(
        target,
        report,
        {
          ...reliableSendOptions,
          dryRun: true // 실제 전송하지 않고 임베드만 생성
        }
      );

      if (!embedResult.success || !embedResult.embeds) {
        return {
          success: false,
          messages: [],
          chunkingUsed: false,
          totalChunks: 0,
          sendTime: Date.now() - startTime,
          compressionRatio: 1,
          fileFallbackUsed: false
        };
      }

      const embeds = embedResult.embeds;
      
      // 청킹 사용 여부 결정
      const shouldUseChunking = enableChunking && (
        embeds.length >= chunkingThreshold ||
        this.exceedsEmbedLimits(embeds) ||
        preferChunkingOverReliable
      );

      if (shouldUseChunking) {
        // 청킹 시스템 사용
        const chunkingResult = await this.chunkingSystem.chunkEmbeds(embeds, chunkingConfig);
        
        const sendResult = await this.chunkingSystem.sendChunkedEmbeds(
          target,
          chunkingResult.chunks,
          chunkingConfig
        );

        return {
          success: sendResult.success,
          messages: sendResult.messages,
          navigationState: sendResult.navigationState,
          fallbackAttachment: sendResult.fallbackAttachment,
          chunkingUsed: true,
          totalChunks: chunkingResult.totalChunks,
          sendTime: Date.now() - startTime,
          compressionRatio: chunkingResult.metadata.compressionRatio,
          fileFallbackUsed: !!sendResult.fallbackAttachment
        };
      } else if (enableReliableSending) {
        // 신뢰성 있는 전송 사용
        const sendResult = await this.reliableEmbedSender.sendThreeSectionReport(
          target,
          report,
          reliableSendOptions
        );

        return {
          success: sendResult.success,
          messages: sendResult.messages || [],
          chunkingUsed: false,
          totalChunks: sendResult.embeds?.length || 0,
          sendTime: Date.now() - startTime,
          compressionRatio: 1,
          fileFallbackUsed: sendResult.fallbackUsed || false
        };
      } else {
        // 기본 전송 (권장하지 않음)
        const messages: Message[] = [];
        
        for (const embed of embeds) {
          const message = await this.sendMessage(target, { embeds: [embed] });
          messages.push(message);
        }

        return {
          success: true,
          messages,
          chunkingUsed: false,
          totalChunks: embeds.length,
          sendTime: Date.now() - startTime,
          compressionRatio: 1,
          fileFallbackUsed: false
        };
      }

    } catch (error) {
      console.error('[IntegratedReportChunkingService] Error sending report:', error);
      
      return {
        success: false,
        messages: [],
        chunkingUsed: false,
        totalChunks: 0,
        sendTime: Date.now() - startTime,
        compressionRatio: 1,
        fileFallbackUsed: false
      };
    }
  }

  /**
   * 활동 보고서 템플릿을 임베드로 변환하고 청킹으로 전송
   */
  async sendActivityReportTemplate(
    target: ChatInputCommandInteraction | TextChannel,
    template: ActivityReportTemplate,
    options: IntegratedReportOptions = {}
  ): Promise<IntegratedReportResult> {
    const startTime = Date.now();
    
    try {
      // 템플릿을 임베드로 변환
      const embeds = await this.convertTemplateToEmbeds(template, options.templateOptions);
      
      const {
        enableChunking = true,
        chunkingThreshold = 2,
        chunkingConfig = {}
      } = options;

      // 청킹 필요 여부 확인
      const shouldUseChunking = enableChunking && (
        embeds.length >= chunkingThreshold ||
        this.exceedsEmbedLimits(embeds)
      );

      if (shouldUseChunking) {
        // 청킹 시스템 사용
        const chunkingResult = await this.chunkingSystem.chunkEmbeds(embeds, chunkingConfig);
        
        const sendResult = await this.chunkingSystem.sendChunkedEmbeds(
          target,
          chunkingResult.chunks,
          chunkingConfig
        );

        return {
          success: sendResult.success,
          messages: sendResult.messages,
          navigationState: sendResult.navigationState,
          fallbackAttachment: sendResult.fallbackAttachment,
          chunkingUsed: true,
          totalChunks: chunkingResult.totalChunks,
          sendTime: Date.now() - startTime,
          compressionRatio: chunkingResult.metadata.compressionRatio,
          fileFallbackUsed: !!sendResult.fallbackAttachment
        };
      } else {
        // 기본 전송
        const messages: Message[] = [];
        
        for (const embed of embeds) {
          const message = await this.sendMessage(target, { embeds: [embed] });
          messages.push(message);
        }

        return {
          success: true,
          messages,
          chunkingUsed: false,
          totalChunks: embeds.length,
          sendTime: Date.now() - startTime,
          compressionRatio: 1,
          fileFallbackUsed: false
        };
      }

    } catch (error) {
      console.error('[IntegratedReportChunkingService] Error sending template report:', error);
      
      return {
        success: false,
        messages: [],
        chunkingUsed: false,
        totalChunks: 0,
        sendTime: Date.now() - startTime,
        compressionRatio: 1,
        fileFallbackUsed: false
      };
    }
  }

  /**
   * 임베드가 Discord 제한을 초과하는지 확인
   */
  private exceedsEmbedLimits(embeds: EmbedBuilder[]): boolean {
    for (const embed of embeds) {
      const validation = this.chunkingSystem.validateEmbedLimits(embed);
      if (!validation.isValid) {
        return true;
      }
    }
    return false;
  }

  /**
   * 활동 보고서 템플릿을 임베드로 변환
   */
  private async convertTemplateToEmbeds(
    template: ActivityReportTemplate,
    options?: Partial<TemplateFormattingOptions>
  ): Promise<EmbedBuilder[]> {
    const embeds: EmbedBuilder[] = [];
    
    // 메인 보고서 임베드 생성
    const mainEmbed = new EmbedBuilder()
      .setTitle(`📊 활동 보고서 - ${template.reportId}`)
      .setColor(0x00ff00)
      .setTimestamp();

    // 요약 정보 추가
    if (template.summary) {
      const summaryFields = [
        { name: '✅ 활동 기준 달성', value: `${template.summary.achievementCount || 0}명`, inline: true },
        { name: '❌ 활동 기준 미달성', value: `${template.summary.underperformanceCount || 0}명`, inline: true },
        { name: '💤 잠수 중', value: `${template.summary.afkCount || 0}명`, inline: true }
      ];
      
      mainEmbed.addFields(summaryFields);
    }

    embeds.push(mainEmbed);

    // 각 섹션을 별도 임베드로 생성
    if (template.achievementSection.members.length > 0) {
      const achievementEmbed = await this.createSectionEmbed(
        '✅ 활동 기준 달성 멤버',
        template.achievementSection,
        0x00ff00,
        options
      );
      embeds.push(achievementEmbed);
    }

    if (template.underperformanceSection.members.length > 0) {
      const underperformanceEmbed = await this.createSectionEmbed(
        '❌ 활동 기준 미달성 멤버',
        template.underperformanceSection,
        0xff0000,
        options
      );
      embeds.push(underperformanceEmbed);
    }

    if (template.afkSection && template.afkSection.members.length > 0) {
      const afkEmbed = await this.createSectionEmbed(
        '💤 잠수 중인 멤버',
        template.afkSection,
        0xd3d3d3,
        options
      );
      embeds.push(afkEmbed);
    }

    return embeds;
  }

  /**
   * 섹션 임베드 생성
   */
  private async createSectionEmbed(
    title: string,
    section: any,
    color: number,
    options?: Partial<TemplateFormattingOptions>
  ): Promise<EmbedBuilder> {
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color);

    // 템플릿 서비스를 사용하여 포맷팅
    const formattedContent = await this.templateService.formatSection(section, {
      format: 'table',
      includeHeader: true,
      maxMembersPerPage: 25, // Discord embed field limit
      sortBy: 'activity_time',
      sortOrder: 'desc',
      ...options
    });

    if (typeof formattedContent === 'string') {
      embed.setDescription(formattedContent);
    } else if (Array.isArray(formattedContent)) {
      // 페이지네이션된 결과 처리
      formattedContent.forEach((page, index) => {
        embed.addFields({
          name: `페이지 ${index + 1}`,
          value: page,
          inline: false
        });
      });
    }

    return embed;
  }

  /**
   * 메시지 전송 헬퍼
   */
  private async sendMessage(
    target: ChatInputCommandInteraction | TextChannel,
    options: any
  ): Promise<Message> {
    if (target instanceof ChatInputCommandInteraction) {
      if (target.deferred || target.replied) {
        return await target.followUp(options);
      } else {
        return await target.reply(options);
      }
    } else {
      return await target.send(options);
    }
  }

  /**
   * 통계 정보 조회
   */
  getIntegratedStatistics() {
    const chunkingStats = this.chunkingSystem.getStatistics();
    
    return {
      chunkingSystem: chunkingStats,
      integration: {
        totalIntegratedReports: 0, // TODO: 실제 통계 추가
        chunkingUsageRate: 0,
        averageCompressionRatio: 0,
        fileFallbackRate: 0
      }
    };
  }
}