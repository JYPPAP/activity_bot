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
  NavigationState,
  FileAttachmentData
} from '../interfaces/IEmbedChunkingSystem.js';
import {
  IReliableEmbedSender,
  ThreeSectionReport,
  ReliableEmbedSendOptions
} from '../interfaces/IReliableEmbedSender.js';
import {
  IActivityReportTemplateService,
  ActivityReportTemplate,
  TemplateFormattingOptions
} from '../interfaces/IActivityReportTemplate.js';
import { DI_TOKENS } from '../interfaces/index.js';

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
        reliableSendOptions = {}
      } = options;

      // 보고서에서 임베드 생성 (ReliableEmbedSender 사용)
      const embedResult = await this.reliableEmbedSender.sendThreeSectionReport(
        target,
        report,
        {
          ...reliableSendOptions
        }
      );

      if (!embedResult.success) {
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

      // Since ReliableEmbedSender already processed the report, return the results
      return {
        success: true,
        messages: embedResult.messagesSent,
        chunkingUsed: embedResult.chunksCreated > 1,
        totalChunks: embedResult.chunksCreated,
        sendTime: Date.now() - startTime,
        compressionRatio: 1,
        fileFallbackUsed: embedResult.fallbackUsed
      };

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
          ...(sendResult.navigationState && { navigationState: sendResult.navigationState }),
          ...(sendResult.fallbackAttachment && { fallbackAttachment: sendResult.fallbackAttachment }),
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
        { name: '✅ 활동 기준 달성', value: `${template.summary.achievingMembers || 0}명`, inline: true },
        { name: '❌ 활동 기준 미달성', value: `${template.summary.underperformingMembers || 0}명`, inline: true },
        { name: '💤 잠수 중', value: `${template.summary.afkMembers || 0}명`, inline: true }
      ];
      
      mainEmbed.addFields(summaryFields);
    }

    embeds.push(mainEmbed);

    // 각 섹션을 별도 임베드로 생성
    if (template.achievementSection.memberData.length > 0) {
      const achievementEmbed = await this.createSectionEmbed(
        '✅ 활동 기준 달성 멤버',
        template.achievementSection,
        0x00ff00,
        options
      );
      embeds.push(achievementEmbed);
    }

    if (template.underperformanceSection.memberData.length > 0) {
      const underperformanceEmbed = await this.createSectionEmbed(
        '❌ 활동 기준 미달성 멤버',
        template.underperformanceSection,
        0xff0000,
        options
      );
      embeds.push(underperformanceEmbed);
    }

    if (template.afkSection && template.afkSection.memberData.length > 0) {
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
    const formattedContent = this.templateService.formatSectionAsText(section, {
      alignmentStyle: 'table',
      nameColumnWidth: 25, // Discord embed field limit
      ...options
    });

    embed.setDescription(formattedContent);

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
        await target.reply(options);
        // Get the actual message from the interaction response
        return await target.fetchReply() as Message;
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