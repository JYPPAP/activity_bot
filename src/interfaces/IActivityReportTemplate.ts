// src/interfaces/IActivityReportTemplate.ts - Activity report template system interface
import { UserActivityData } from '../utils/embedBuilder.js';

// Template system configuration
export interface TemplateConfig {
  // Member display settings
  maxMembersPerSection?: number;
  enablePagination?: boolean;
  pageSize?: number;
  
  // Time formatting options
  timeFormat?: 'korean' | 'compact' | 'decimal';
  includeSeconds?: boolean;
  
  // Display preferences
  showMemberCount?: boolean;
  showEmptyMessage?: boolean;
  sortOrder?: 'time_desc' | 'time_asc' | 'name_asc' | 'name_desc';
  
  // Section customization
  enableAchievementSection?: boolean;
  enableUnderperformanceSection?: boolean;
  enableAfkSection?: boolean;
  
  // Layout options
  alignmentStyle?: 'table' | 'list' | 'compact';
  useUnicodeEmojis?: boolean;
  columnSeparator?: string;
}

// Template section data structure
export interface ReportSectionTemplate {
  emoji: string;
  title: string;
  description: string;
  memberData: UserActivityData[];
  showCount: boolean;
  priority: 'high' | 'medium' | 'low';
  color: number;
}

// Paginated section for large member lists
export interface PaginatedSection {
  section: ReportSectionTemplate;
  pages: {
    pageNumber: number;
    totalPages: number;
    members: UserActivityData[];
    displayText: string;
  }[];
  totalMembers: number;
}

// Complete template structure
export interface ActivityReportTemplate {
  // Report metadata
  reportId: string;
  generatedAt: Date;
  dateRange: {
    startDate: Date;
    endDate: Date;
  };
  minHours: number;
  
  // Template sections
  achievementSection: ReportSectionTemplate;
  underperformanceSection: ReportSectionTemplate;
  afkSection?: ReportSectionTemplate;
  
  // Template configuration used
  config: TemplateConfig;
  
  // Summary statistics
  summary: {
    totalMembersProcessed: number;
    achievingMembers: number;
    underperformingMembers: number;
    afkMembers: number;
    averageActivityTime: number;
    topPerformer?: {
      name: string;
      activityTime: number;
    };
  };
}

// Template formatting options
export interface TemplateFormattingOptions {
  // Korean-specific formatting
  useKoreanNumbers?: boolean;
  koreanDateFormat?: 'short' | 'long' | 'relative';
  
  // Alignment and spacing
  alignmentStyle?: 'table' | 'list' | 'compact';
  nameColumnWidth?: number;
  timeColumnWidth?: number;
  dateColumnWidth?: number;
  columnPadding?: string;
  
  // Visual enhancements
  useProgressBars?: boolean;
  highlightTopPerformers?: boolean;
  showPercentageOfTarget?: boolean;
  
  // Text styling
  nameTextStyle?: 'plain' | 'bold' | 'code' | 'italic';
  timeTextStyle?: 'plain' | 'bold' | 'code' | 'italic';
  headerTextStyle?: 'plain' | 'bold' | 'code' | 'italic';
}

// Service interface for template system
export interface IActivityReportTemplateService {
  /**
   * Create a new activity report template
   */
  createTemplate(
    activeUsers: UserActivityData[],
    inactiveUsers: UserActivityData[],
    afkUsers: UserActivityData[],
    dateRange: { startDate: Date; endDate: Date },
    minHours: number,
    config?: Partial<TemplateConfig>
  ): Promise<ActivityReportTemplate>;
  
  /**
   * Format template section as text
   */
  formatSectionAsText(
    section: ReportSectionTemplate,
    formatting?: TemplateFormattingOptions
  ): string;
  
  /**
   * Format entire template as structured text
   */
  formatTemplateAsText(
    template: ActivityReportTemplate,
    formatting?: TemplateFormattingOptions
  ): string;
  
  /**
   * Create paginated sections for large member lists
   */
  createPaginatedSection(
    section: ReportSectionTemplate,
    pageSize: number
  ): PaginatedSection;
  
  /**
   * Generate template summary statistics
   */
  generateSummaryStats(
    activeUsers: UserActivityData[],
    inactiveUsers: UserActivityData[],
    afkUsers: UserActivityData[]
  ): ActivityReportTemplate['summary'];
  
  /**
   * Validate template configuration
   */
  validateConfig(config: TemplateConfig): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  };
  
  /**
   * Get default template configuration
   */
  getDefaultConfig(): TemplateConfig;
}

// Default template configuration
export const DEFAULT_TEMPLATE_CONFIG: TemplateConfig = {
  maxMembersPerSection: 25,
  enablePagination: true,
  pageSize: 10,
  timeFormat: 'korean',
  includeSeconds: false,
  showMemberCount: true,
  showEmptyMessage: true,
  sortOrder: 'time_desc',
  enableAchievementSection: true,
  enableUnderperformanceSection: true,
  enableAfkSection: true,
  alignmentStyle: 'table',
  useUnicodeEmojis: true,
  columnSeparator: ' | '
};

// Default formatting options
export const DEFAULT_FORMATTING_OPTIONS: TemplateFormattingOptions = {
  useKoreanNumbers: true,
  koreanDateFormat: 'short',
  alignmentStyle: 'table',
  nameColumnWidth: 20,
  timeColumnWidth: 12,
  dateColumnWidth: 12,
  columnPadding: ' ',
  useProgressBars: false,
  highlightTopPerformers: true,
  showPercentageOfTarget: true,
  nameTextStyle: 'plain',
  timeTextStyle: 'bold',
  headerTextStyle: 'bold'
};

// Template error types
export class TemplateValidationError extends Error {
  constructor(
    message: string,
    public readonly validationErrors: string[],
    public readonly configField?: string
  ) {
    super(message);
    this.name = 'TemplateValidationError';
  }
}

export class TemplateFormattingError extends Error {
  constructor(
    message: string,
    public readonly sectionType?: string,
    public readonly memberIndex?: number
  ) {
    super(message);
    this.name = 'TemplateFormattingError';
  }
}

export class TemplatePaginationError extends Error {
  constructor(
    message: string,
    public readonly pageSize: number,
    public readonly totalMembers: number
  ) {
    super(message);
    this.name = 'TemplatePaginationError';
  }
}