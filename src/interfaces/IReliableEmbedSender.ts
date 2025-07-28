// src/interfaces/IReliableEmbedSender.ts - Reliable Discord embed sender interface
import { 
  EmbedBuilder, 
  ChatInputCommandInteraction, 
  TextChannel, 
  Message
} from 'discord.js';

// Embed send result with detailed status
export interface EmbedSendResult {
  success: boolean;
  messagesSent: Message[];
  errorMessages: string[];
  fallbackUsed: boolean;
  totalEmbeds: number;
  chunksCreated: number;
  retryAttempts: number;
  executionTime: number;
  validationErrors: string[];
}

// Progress tracking for embed sending
export interface EmbedSendProgress {
  stage: 'validation' | 'chunking' | 'sending' | 'retry' | 'fallback' | 'completed' | 'failed';
  currentChunk: number;
  totalChunks: number;
  embedsProcessed: number;
  totalEmbeds: number;
  retryAttempt: number;
  maxRetries: number;
  message: string;
  timestamp: Date;
}

// Report structure for 3-section reports
export interface ReportSectionData {
  title: string;
  embeds: EmbedBuilder[];
  sectionType: 'achievement' | 'underperformance' | 'afk';
  priority: 'high' | 'medium' | 'low';
}

export interface ThreeSectionReport {
  achievementSection: ReportSectionData;
  underperformanceSection: ReportSectionData;
  afkSection?: ReportSectionData;
  metadata: {
    reportId: string;
    generatedAt: Date;
    totalMembers: number;
    dateRange: { start: Date; end: Date };
  };
}

// Send options with reliability features
export interface ReliableEmbedSendOptions {
  // Retry configuration
  maxRetries: number;
  retryDelayMs: number;
  backoffMultiplier: number;
  
  // Chunking configuration
  maxEmbedsPerMessage: number;
  chunkDelayMs: number;
  
  // Fallback configuration
  enableTextFallback: boolean;
  textFallbackTemplate?: string;
  
  // Progress tracking
  enableProgressTracking: boolean;
  progressCallback?: (progress: EmbedSendProgress) => void;
  
  // Discord options
  ephemeral?: boolean;
  silent?: boolean;
  allowedMentions?: any;
  
  // Validation options
  strictValidation: boolean;
  autoTruncate: boolean;
  
  // Error reporting
  reportErrors: boolean;
  errorChannel?: string;
}

// Default configuration
export const DEFAULT_RELIABLE_EMBED_OPTIONS: ReliableEmbedSendOptions = {
  maxRetries: 3,
  retryDelayMs: 1000,
  backoffMultiplier: 2,
  maxEmbedsPerMessage: 10,
  chunkDelayMs: 500,
  enableTextFallback: true,
  enableProgressTracking: true,
  strictValidation: true,
  autoTruncate: true,
  reportErrors: true,
  ephemeral: false,
  silent: false
};

// Service interface
export interface IReliableEmbedSender {
  /**
   * Send embeds with retry mechanism and fallback support
   */
  sendEmbeds(
    target: ChatInputCommandInteraction | TextChannel,
    embeds: EmbedBuilder[],
    options?: Partial<ReliableEmbedSendOptions>
  ): Promise<EmbedSendResult>;

  /**
   * Send structured 3-section report (달성/미달성/잠수)
   */
  sendThreeSectionReport(
    target: ChatInputCommandInteraction | TextChannel,
    report: ThreeSectionReport,
    options?: Partial<ReliableEmbedSendOptions>
  ): Promise<EmbedSendResult>;

  /**
   * Validate embeds against Discord limits
   */
  validateEmbeds(embeds: EmbedBuilder[]): Promise<{
    isValid: boolean;
    errors: string[];
    warnings: string[];
    correctedEmbeds?: EmbedBuilder[];
  }>;

  /**
   * Convert embeds to text format for fallback
   */
  convertEmbedsToText(embeds: EmbedBuilder[]): string;

  /**
   * Get service health and statistics
   */
  getStatistics(): {
    totalSends: number;
    successRate: number;
    averageRetries: number;
    fallbackUsageRate: number;
    averageExecutionTime: number;
    lastError?: string;
  };
}

// Error types for reliable embed sending
export class EmbedValidationError extends Error {
  constructor(
    message: string, 
    public readonly validationErrors: string[],
    public readonly embedIndex?: number
  ) {
    super(message);
    this.name = 'EmbedValidationError';
  }
}

export class EmbedSendError extends Error {
  constructor(
    message: string,
    public readonly retryAttempt: number,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'EmbedSendError';
  }
}

export class EmbedChunkingError extends Error {
  constructor(
    message: string,
    public readonly chunkIndex: number,
    public readonly totalChunks: number
  ) {
    super(message);
    this.name = 'EmbedChunkingError';
  }
}