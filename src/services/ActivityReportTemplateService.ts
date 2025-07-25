// src/services/ActivityReportTemplateService.ts - Activity report template service implementation
import { injectable } from 'tsyringe';

import {
  IActivityReportTemplateService,
  ActivityReportTemplate,
  ReportSectionTemplate,
  PaginatedSection,
  TemplateConfig,
  TemplateFormattingOptions,
  DEFAULT_TEMPLATE_CONFIG,
  DEFAULT_FORMATTING_OPTIONS,
  TemplateValidationError,
  TemplateFormattingError,
  TemplatePaginationError
} from '../interfaces/IActivityReportTemplate';
import { UserActivityData } from '../utils/embedBuilder';
import { formatTime, formatTimeInHours } from '../utils/formatters';
import { COLORS } from '../config/constants';

// Template engine for consistent Korean formatting
interface KoreanTemplateEngine {
  formatMemberName(name: string, style: 'plain' | 'bold' | 'code' | 'italic'): string;
  formatActivityTime(timeMs: number, format: 'korean' | 'compact' | 'decimal'): string;
  formatDate(date: Date, format: 'short' | 'long' | 'relative'): string;
  createTableRow(name: string, time: string, date?: string, width?: number[]): string;
  alignText(text: string, width: number, alignment: 'left' | 'center' | 'right'): string;
}

@injectable()
export class ActivityReportTemplateService implements IActivityReportTemplateService {
  private readonly templateEngine: KoreanTemplateEngine;

  constructor() {
    this.templateEngine = this.createTemplateEngine();
  }

  /**
   * Create a new activity report template
   */
  async createTemplate(
    roleFilter: string,
    activeUsers: UserActivityData[],
    inactiveUsers: UserActivityData[],
    afkUsers: UserActivityData[],
    dateRange: { startDate: Date; endDate: Date },
    minHours: number,
    config: Partial<TemplateConfig> = {}
  ): Promise<ActivityReportTemplate> {
    const mergedConfig = { ...DEFAULT_TEMPLATE_CONFIG, ...config };
    
    // Validate configuration
    const validation = this.validateConfig(mergedConfig);
    if (!validation.isValid) {
      throw new TemplateValidationError(
        `Invalid template configuration: ${validation.errors.join(', ')}`,
        validation.errors
      );
    }

    // Sort user arrays according to configuration
    const sortedActiveUsers = this.sortUsers(activeUsers, mergedConfig.sortOrder!);
    const sortedInactiveUsers = this.sortUsers(inactiveUsers, mergedConfig.sortOrder!);
    const sortedAfkUsers = this.sortUsers(afkUsers, mergedConfig.sortOrder!);

    // Create section templates
    const achievementSection = this.createSectionTemplate(
      '✅',
      '활동 기준 달성 멤버',
      '최소 활동 시간을 달성한 멤버들입니다.',
      sortedActiveUsers,
      COLORS.ACTIVE,
      'high',
      mergedConfig
    );

    const underperformanceSection = this.createSectionTemplate(
      '❌',
      '활동 기준 미달성 멤버',
      '최소 활동 시간에 미달한 멤버들입니다.',
      sortedInactiveUsers,
      COLORS.INACTIVE,
      'medium',
      mergedConfig
    );

    let afkSection: ReportSectionTemplate | undefined;
    if (mergedConfig.enableAfkSection && sortedAfkUsers.length > 0) {
      afkSection = this.createSectionTemplate(
        '💤',
        '잠수 중인 멤버',
        '현재 잠수 상태인 멤버들입니다.',
        sortedAfkUsers,
        COLORS.SLEEP,
        'low',
        mergedConfig
      );
    }

    // Generate summary statistics
    const summary = this.generateSummaryStats(
      sortedActiveUsers,
      sortedInactiveUsers,
      sortedAfkUsers
    );

    // Create template
    const template: ActivityReportTemplate = {
      reportId: this.generateReportId(roleFilter, dateRange.startDate),
      generatedAt: new Date(),
      roleFilter,
      dateRange,
      minHours,
      achievementSection,
      underperformanceSection,
      afkSection,
      config: mergedConfig,
      summary
    };

    return template;
  }

  /**
   * Format template section as text
   */
  formatSectionAsText(
    section: ReportSectionTemplate,
    formatting: TemplateFormattingOptions = {}
  ): string {
    const opts = { ...DEFAULT_FORMATTING_OPTIONS, ...formatting };
    
    try {
      const lines: string[] = [];
      
      // Section header with emoji and count
      const header = this.formatSectionHeader(section, opts);
      lines.push(header);
      
      // Empty line for spacing
      lines.push('');
      
      // Check for empty section
      if (section.memberData.length === 0) {
        const emptyMessage = `${section.emoji} 해당하는 멤버가 없습니다.`;
        lines.push(emptyMessage);
        return lines.join('\n');
      }
      
      // Format member data based on alignment style
      switch (opts) {
        case 'table':
          lines.push(...this.formatAsTable(section, opts));
          break;
        case 'list':
          lines.push(...this.formatAsList(section, opts));
          break;
        case 'compact':
          lines.push(...this.formatAsCompact(section, opts));
          break;
        default:
          lines.push(...this.formatAsTable(section, opts));
      }
      
      return lines.join('\n');
      
    } catch (error) {
      throw new TemplateFormattingError(
        `Failed to format section ${section.title}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        section.title
      );
    }
  }

  /**
   * Format entire template as structured text
   */
  formatTemplateAsText(
    template: ActivityReportTemplate,
    formatting: TemplateFormattingOptions = {}
  ): string {
    const opts = { ...DEFAULT_FORMATTING_OPTIONS, ...formatting };
    const sections: string[] = [];
    
    // Report header
    const header = this.formatReportHeader(template, opts);
    sections.push(header);
    
    // Achievement section
    if (template.config.enableAchievementSection) {
      const achievementText = this.formatSectionAsText(template.achievementSection, opts);
      sections.push(achievementText);
    }
    
    // Underperformance section
    if (template.config.enableUnderperformanceSection) {
      const underperformanceText = this.formatSectionAsText(template.underperformanceSection, opts);
      sections.push(underperformanceText);
    }
    
    // AFK section
    if (template.config.enableAfkSection && template.afkSection) {
      const afkText = this.formatSectionAsText(template.afkSection, opts);
      sections.push(afkText);
    }
    
    // Summary statistics
    const summaryText = this.formatSummary(template.summary, opts);
    sections.push(summaryText);
    
    // Report footer
    const footer = this.formatReportFooter(template, opts);
    sections.push(footer);
    
    return sections.join('\n\n' + '═'.repeat(50) + '\n\n');
  }

  /**
   * Create paginated sections for large member lists
   */
  createPaginatedSection(
    section: ReportSectionTemplate,
    pageSize: number
  ): PaginatedSection {
    if (pageSize <= 0) {
      throw new TemplatePaginationError(
        'Page size must be positive',
        pageSize,
        section.memberData.length
      );
    }

    const totalMembers = section.memberData.length;
    const totalPages = Math.ceil(totalMembers / pageSize);
    const pages = [];

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      const startIndex = (pageNumber - 1) * pageSize;
      const endIndex = Math.min(startIndex + pageSize, totalMembers);
      const pageMembers = section.memberData.slice(startIndex, endIndex);

      // Create display text for this page
      const pageSection: ReportSectionTemplate = {
        ...section,
        memberData: pageMembers,
        title: `${section.title} (${pageNumber}/${totalPages} 페이지)`
      };

      const displayText = this.formatSectionAsText(pageSection);

      pages.push({
        pageNumber,
        totalPages,
        members: pageMembers,
        displayText
      });
    }

    return {
      section,
      pages,
      totalMembers
    };
  }

  /**
   * Generate template summary statistics
   */
  generateSummaryStats(
    activeUsers: UserActivityData[],
    inactiveUsers: UserActivityData[],
    afkUsers: UserActivityData[]
  ): ActivityReportTemplate['summary'] {
    const allUsers = [...activeUsers, ...inactiveUsers, ...afkUsers];
    const totalMembersProcessed = allUsers.length;
    
    // Calculate average activity time
    const totalActivityTime = allUsers.reduce((sum, user) => sum + user.totalTime, 0);
    const averageActivityTime = totalMembersProcessed > 0 ? totalActivityTime / totalMembersProcessed : 0;
    
    // Find top performer
    const topPerformer = allUsers.reduce((top, user) => {
      if (!top || user.totalTime > top.totalTime) {
        return {
          name: user.nickname || user.userId,
          activityTime: user.totalTime
        };
      }
      return top;
    }, null as { name: string; activityTime: number } | null);

    return {
      totalMembersProcessed,
      achievingMembers: activeUsers.length,
      underperformingMembers: inactiveUsers.length,
      afkMembers: afkUsers.length,
      averageActivityTime,
      topPerformer: topPerformer || undefined
    };
  }

  /**
   * Validate template configuration
   */
  validateConfig(config: TemplateConfig): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate pagination settings
    if (config.enablePagination && (!config.pageSize || config.pageSize <= 0)) {
      errors.push('Page size must be positive when pagination is enabled');
    }

    if (config.maxMembersPerSection && config.maxMembersPerSection <= 0) {
      errors.push('Max members per section must be positive');
    }

    // Validate enum values
    const validTimeFormats = ['korean', 'compact', 'decimal'] as const;
    if (config.timeFormat && !validTimeFormats.includes(config.timeFormat as any)) {
      errors.push(`Invalid time format: ${config.timeFormat}`);
    }

    const validSortOrders = ['time_desc', 'time_asc', 'name_asc', 'name_desc'] as const;
    if (config.sortOrder && !validSortOrders.includes(config.sortOrder as any)) {
      errors.push(`Invalid sort order: ${config.sortOrder}`);
    }

    const validAlignmentStyles = ['table', 'list', 'compact'] as const;
    if (config.alignmentStyle && !validAlignmentStyles.includes(config.alignmentStyle as any)) {
      errors.push(`Invalid alignment style: ${config.alignmentStyle}`);
    }

    // Warnings for potential issues
    if (config.pageSize && config.pageSize > 25) {
      warnings.push('Page size larger than 25 may cause Discord embed field limits');
    }

    if (config.maxMembersPerSection && config.maxMembersPerSection > 25) {
      warnings.push('Max members per section larger than 25 may cause Discord embed field limits');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Get default template configuration
   */
  getDefaultConfig(): TemplateConfig {
    return { ...DEFAULT_TEMPLATE_CONFIG };
  }

  // Private helper methods

  private createTemplateEngine(): KoreanTemplateEngine {
    return {
      formatMemberName: (name: string, style: 'plain' | 'bold' | 'code' | 'italic'): string => {
        switch (style) {
          case 'bold': return `**${name}**`;
          case 'code': return `\`${name}\``;
          case 'italic': return `*${name}*`;
          default: return name;
        }
      },

      formatActivityTime: (timeMs: number, format: 'korean' | 'compact' | 'decimal'): string => {
        switch (format) {
          case 'korean': return formatTime(timeMs);
          case 'compact': return formatTime(timeMs, { compact: true, korean: false });
          case 'decimal': return formatTimeInHours(timeMs);
          default: return formatTime(timeMs);
        }
      },

      formatDate: (date: Date, format: 'short' | 'long' | 'relative'): string => {
        switch (format) {
          case 'short': return date.toLocaleDateString('ko-KR');
          case 'long': return date.toLocaleDateString('ko-KR', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            weekday: 'long'
          });
          case 'relative': {
            const now = new Date();
            const diffDays = Math.floor((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays === 0) return '오늘';
            if (diffDays === 1) return '내일';
            if (diffDays === -1) return '어제';
            if (diffDays > 0) return `${diffDays}일 후`;
            return `${Math.abs(diffDays)}일 전`;
          }
          default: return date.toLocaleDateString('ko-KR');
        }
      },

      createTableRow: (name: string, time: string, date?: string, widths?: number[]): string => {
        const defaultWidths = [20, 12, 12];
        const columnWidths = widths || defaultWidths;
        
        const nameCol = this.alignText(name, columnWidths[0], 'left');
        const timeCol = this.alignText(time, columnWidths[1], 'right');
        
        if (date) {
          const dateCol = this.alignText(date, columnWidths[2], 'center');
          return `${nameCol} │ ${timeCol} │ ${dateCol}`;
        }
        
        return `${nameCol} │ ${timeCol}`;
      },

      alignText: (text: string, width: number, alignment: 'left' | 'center' | 'right'): string => {
        if (text.length >= width) {
          return text.substring(0, width - 3) + '...';
        }
        
        const padding = width - text.length;
        
        switch (alignment) {
          case 'left': return text + ' '.repeat(padding);
          case 'right': return ' '.repeat(padding) + text;
          case 'center': {
            const leftPad = Math.floor(padding / 2);
            const rightPad = padding - leftPad;
            return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
          }
          default: return text;
        }
      }
    };
  }

  private sortUsers(users: UserActivityData[], sortOrder: string): UserActivityData[] {
    const sorted = [...users];
    
    switch (sortOrder) {
      case 'time_desc':
        return sorted.sort((a, b) => b.totalTime - a.totalTime);
      case 'time_asc':
        return sorted.sort((a, b) => a.totalTime - b.totalTime);
      case 'name_asc':
        return sorted.sort((a, b) => (a.nickname || a.userId).localeCompare(b.nickname || b.userId));
      case 'name_desc':
        return sorted.sort((a, b) => (b.nickname || b.userId).localeCompare(a.nickname || a.userId));
      default:
        return sorted.sort((a, b) => b.totalTime - a.totalTime);
    }
  }

  private createSectionTemplate(
    emoji: string,
    title: string,
    description: string,
    memberData: UserActivityData[],
    color: number,
    priority: 'high' | 'medium' | 'low',
    config: TemplateConfig
  ): ReportSectionTemplate {
    // Apply member limit if configured
    let limitedMemberData = memberData;
    if (config.maxMembersPerSection && memberData.length > config.maxMembersPerSection) {
      limitedMemberData = memberData.slice(0, config.maxMembersPerSection);
    }

    return {
      emoji,
      title,
      description,
      memberData: limitedMemberData,
      showCount: config.showMemberCount ?? true,
      priority,
      color
    };
  }

  private formatSectionHeader(section: ReportSectionTemplate, opts: TemplateFormattingOptions): string {
    const emoji = section.emoji;
    const title = this.templateEngine.formatMemberName(section.title, opts.headerTextStyle || 'bold');
    const count = section.showCount ? ` (${section.memberData.length}명)` : '';
    
    return `${emoji} ${title}${count}`;
  }

  private formatAsTable(section: ReportSectionTemplate, opts: TemplateFormattingOptions): string[] {
    const lines: string[] = [];
    
    // Table header
    const nameHeader = this.templateEngine.alignText('이름', opts.nameColumnWidth || 20, 'left');
    const timeHeader = this.templateEngine.alignText('활동시간', opts.timeColumnWidth || 12, 'right');
    
    const hasAfkDates = section.memberData.some(user => user.afkUntil);
    
    if (hasAfkDates) {
      const dateHeader = this.templateEngine.alignText('해제예정일', opts.dateColumnWidth || 12, 'center');
      lines.push(`${nameHeader} │ ${timeHeader} │ ${dateHeader}`);
      lines.push('─'.repeat(opts.nameColumnWidth || 20) + '┼' + '─'.repeat(opts.timeColumnWidth || 12) + '┼' + '─'.repeat(opts.dateColumnWidth || 12));
    } else {
      lines.push(`${nameHeader} │ ${timeHeader}`);
      lines.push('─'.repeat(opts.nameColumnWidth || 20) + '┼' + '─'.repeat(opts.timeColumnWidth || 12));
    }
    
    // Table rows
    section.memberData.forEach((user, index) => {
      const name = this.templateEngine.formatMemberName(
        user.nickname || user.userId, 
        opts.nameTextStyle || 'plain'
      );
      const time = this.templateEngine.formatActivityTime(
        user.totalTime,
        'korean'
      );
      const formattedTime = this.templateEngine.formatMemberName(time, opts.timeTextStyle || 'bold');
      
      if (hasAfkDates && user.afkUntil) {
        const afkDate = this.templateEngine.formatDate(
          new Date(user.afkUntil),
          opts.koreanDateFormat || 'short'
        );
        lines.push(this.templateEngine.createTableRow(
          name, 
          formattedTime, 
          afkDate, 
          [opts.nameColumnWidth || 20, opts.timeColumnWidth || 12, opts.dateColumnWidth || 12]
        ));
      } else {
        lines.push(this.templateEngine.createTableRow(
          name, 
          formattedTime, 
          undefined,
          [opts.nameColumnWidth || 20, opts.timeColumnWidth || 12]
        ));
      }
    });
    
    return lines;
  }

  private formatAsList(section: ReportSectionTemplate, opts: TemplateFormattingOptions): string[] {
    const lines: string[] = [];
    
    section.memberData.forEach((user, index) => {
      const name = this.templateEngine.formatMemberName(
        user.nickname || user.userId,
        opts.nameTextStyle || 'plain'
      );
      const time = this.templateEngine.formatActivityTime(user.totalTime, 'korean');
      const formattedTime = this.templateEngine.formatMemberName(time, opts.timeTextStyle || 'bold');
      
      let line = `${index + 1}. ${name} - ${formattedTime}`;
      
      if (user.afkUntil) {
        const afkDate = this.templateEngine.formatDate(
          new Date(user.afkUntil),
          opts.koreanDateFormat || 'short'
        );
        line += ` (해제: ${afkDate})`;
      }
      
      lines.push(line);
    });
    
    return lines;
  }

  private formatAsCompact(section: ReportSectionTemplate, opts: TemplateFormattingOptions): string[] {
    const names = section.memberData.map(user => {
      const name = user.nickname || user.userId;
      const time = this.templateEngine.formatActivityTime(user.totalTime, 'compact');
      return `${name}(${time})`;
    });
    
    // Join names with commas, breaking into multiple lines if needed
    const maxLineLength = 60;
    const lines: string[] = [];
    let currentLine = '';
    
    names.forEach((nameWithTime, index) => {
      const separator = index === 0 ? '' : ', ';
      const addition = separator + nameWithTime;
      
      if (currentLine.length + addition.length > maxLineLength && currentLine) {
        lines.push(currentLine);
        currentLine = nameWithTime;
      } else {
        currentLine += addition;
      }
    });
    
    if (currentLine) {
      lines.push(currentLine);
    }
    
    return lines;
  }

  private formatReportHeader(template: ActivityReportTemplate, opts: TemplateFormattingOptions): string {
    const lines: string[] = [];
    
    lines.push('📊 **활동 보고서**');
    lines.push('');
    lines.push(`**역할:** ${template.roleFilter}`);
    lines.push(`**기간:** ${this.templateEngine.formatDate(template.dateRange.startDate, 'short')} ~ ${this.templateEngine.formatDate(template.dateRange.endDate, 'short')}`);
    lines.push(`**최소 활동 시간:** ${template.minHours}시간`);
    lines.push(`**생성일:** ${this.templateEngine.formatDate(template.generatedAt, 'long')}`);
    
    return lines.join('\n');
  }

  private formatSummary(summary: ActivityReportTemplate['summary'], opts: TemplateFormattingOptions): string {
    const lines: string[] = [];
    
    lines.push('📈 **요약 통계**');
    lines.push('');
    lines.push(`**총 처리된 멤버:** ${summary.totalMembersProcessed}명`);
    lines.push(`**기준 달성 멤버:** ${summary.achievingMembers}명`);
    lines.push(`**기준 미달성 멤버:** ${summary.underperformingMembers}명`);
    lines.push(`**잠수 상태 멤버:** ${summary.afkMembers}명`);
    lines.push(`**평균 활동 시간:** ${this.templateEngine.formatActivityTime(summary.averageActivityTime, 'korean')}`);
    
    if (summary.topPerformer) {
      lines.push(`**최고 활동자:** ${summary.topPerformer.name} (${this.templateEngine.formatActivityTime(summary.topPerformer.activityTime, 'korean')})`);
    }
    
    return lines.join('\n');
  }

  private formatReportFooter(template: ActivityReportTemplate, opts: TemplateFormattingOptions): string {
    return `*보고서 ID: ${template.reportId} | 생성 시간: ${template.generatedAt.toLocaleString('ko-KR')}*`;
  }

  private generateReportId(roleFilter: string, startDate: Date): string {
    const timestamp = Date.now().toString(36);
    const roleHash = roleFilter.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4);
    const dateHash = startDate.getTime().toString(36).substring(-4);
    return `TMPL_${roleHash}_${dateHash}_${timestamp}`.toUpperCase();
  }

  private alignText(text: string, width: number, alignment: 'left' | 'center' | 'right'): string {
    return this.templateEngine.alignText(text, width, alignment);
  }
}