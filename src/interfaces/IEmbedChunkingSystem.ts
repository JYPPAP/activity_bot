// src/interfaces/IEmbedChunkingSystem.ts - Discord embed chunking system interface
import { 
  EmbedBuilder, 
  ChatInputCommandInteraction, 
  TextChannel, 
  Message,
  ButtonBuilder,
  ActionRowBuilder
} from 'discord.js';

// Chunking configuration options
export interface EmbedChunkingConfig {
  // Field limitations
  maxFieldsPerEmbed: number;
  maxCharactersPerEmbed: number;
  maxDescriptionLength: number;
  maxTitleLength: number;
  
  // Sending behavior
  sendDelay: number;
  enableProgressive: boolean;
  enableNavigation: boolean;
  
  // File attachment fallback
  enableFileFallback: boolean;
  fileFallbackThreshold: number;
  attachmentFormat: 'txt' | 'json' | 'csv';
  
  // Navigation settings
  navigationTimeout: number;
  showPageNumbers: boolean;
  enableJumpToPage: boolean;
  
  // Performance settings
  maxChunksPerBatch: number;
  chunkProcessingDelay: number;
}

// Chunk metadata for navigation and tracking
export interface EmbedChunk {
  embedId: string;
  chunkIndex: number;
  totalChunks: number;
  embed: EmbedBuilder;
  characterCount: number;
  fieldCount: number;
  timestamp: Date;
  isOverLimit: boolean;
}

// Chunking result with navigation support
export interface ChunkingResult {
  chunks: EmbedChunk[];
  totalChunks: number;
  totalCharacters: number;
  totalFields: number;
  estimatedSendTime: number;
  requiresFileFallback: boolean;
  navigationEnabled: boolean;
  metadata: {
    originalDataSize: number;
    compressionRatio: number;
    chunkingStrategy: 'field_based' | 'character_based' | 'hybrid';
    generatedAt: Date;
  };
}

// Navigation state for paginated embeds
export interface NavigationState {
  sessionId: string;
  currentPage: number;
  totalPages: number;
  userId: string;
  channelId: string;
  messageId: string;
  chunks: EmbedChunk[];
  createdAt: Date;
  expiresAt: Date;
  isActive: boolean;
}

// File attachment data for large reports
export interface FileAttachmentData {
  filename: string;
  content: string | Buffer;
  size: number;
  format: 'txt' | 'json' | 'csv';
  encoding?: BufferEncoding;
  metadata: {
    originalEmbedCount: number;
    totalCharacters: number;
    compressionUsed: boolean;
    generatedAt: Date;
  };
}

// Progress tracking for chunking operations
export interface ChunkingProgress {
  stage: 'analyzing' | 'splitting' | 'validating' | 'preparing' | 'sending' | 'completed' | 'failed';
  processedChunks: number;
  totalChunks: number;
  currentChunkSize: number;
  estimatedTimeRemaining: number;
  bytesProcessed: number;
  totalBytes: number;
  errors: string[];
  warnings: string[];
}

// Service interface for embed chunking system
export interface IEmbedChunkingSystem {
  /**
   * Split large embed content into manageable chunks
   */
  chunkEmbeds(
    embeds: EmbedBuilder[],
    config?: Partial<EmbedChunkingConfig>
  ): Promise<ChunkingResult>;
  
  /**
   * Send chunked embeds with sequential delivery and navigation
   */
  sendChunkedEmbeds(
    target: ChatInputCommandInteraction | TextChannel,
    chunks: EmbedChunk[],
    config?: Partial<EmbedChunkingConfig>
  ): Promise<{
    messages: Message[];
    navigationState?: NavigationState;
    fallbackAttachment?: FileAttachmentData;
    success: boolean;
    sendTime: number;
  }>;
  
  /**
   * Create file attachment fallback for oversized reports
   */
  createFileAttachment(
    embeds: EmbedBuilder[],
    format: 'txt' | 'json' | 'csv',
    filename?: string
  ): Promise<FileAttachmentData>;
  
  /**
   * Handle navigation interactions (page buttons)
   */
  handleNavigation(
    interaction: any,
    navigationState: NavigationState
  ): Promise<void>;
  
  /**
   * Validate embed against Discord limits
   */
  validateEmbedLimits(
    embed: EmbedBuilder
  ): {
    isValid: boolean;
    violations: {
      type: 'fields' | 'characters' | 'title' | 'description' | 'footer';
      current: number;
      limit: number;
      severity: 'error' | 'warning';
    }[];
    totalCharacters: number;
    fieldCount: number;
  };
  
  /**
   * Create navigation buttons for paginated embeds
   */
  createNavigationButtons(
    currentPage: number,
    totalPages: number,
    sessionId: string
  ): ActionRowBuilder<ButtonBuilder>[];
  
  /**
   * Get active navigation sessions
   */
  getActiveNavigationSessions(): NavigationState[];
  
  /**
   * Clean up expired navigation sessions
   */
  cleanupExpiredSessions(): Promise<number>;
  
  /**
   * Get chunking system statistics
   */
  getStatistics(): {
    totalChunkingOperations: number;
    averageChunksPerOperation: number;
    fileFallbackUsage: number;
    navigationSessionsActive: number;
    averageProcessingTime: number;
    characterCompressionRatio: number;
  };
}

// Default chunking configuration
export const DEFAULT_CHUNKING_CONFIG: EmbedChunkingConfig = {
  maxFieldsPerEmbed: 25,
  maxCharactersPerEmbed: 6000,
  maxDescriptionLength: 4096,
  maxTitleLength: 256,
  sendDelay: 1000,
  enableProgressive: true,
  enableNavigation: true,
  enableFileFallback: true,
  fileFallbackThreshold: 10,
  attachmentFormat: 'txt',
  navigationTimeout: 300000, // 5 minutes
  showPageNumbers: true,
  enableJumpToPage: true,
  maxChunksPerBatch: 5,
  chunkProcessingDelay: 500
};

// Navigation button custom IDs
export const NAVIGATION_BUTTON_IDS = {
  FIRST_PAGE: 'chunk_nav_first',
  PREVIOUS_PAGE: 'chunk_nav_prev',
  NEXT_PAGE: 'chunk_nav_next',
  LAST_PAGE: 'chunk_nav_last',
  JUMP_TO_PAGE: 'chunk_nav_jump',
  CLOSE_SESSION: 'chunk_nav_close'
} as const;

// Error types for chunking system
export class EmbedChunkingError extends Error {
  constructor(
    message: string,
    public readonly chunkIndex?: number,
    public readonly totalChunks?: number,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'EmbedChunkingError';
  }
}

export class NavigationError extends Error {
  constructor(
    message: string,
    public readonly sessionId?: string,
    public readonly currentPage?: number
  ) {
    super(message);
    this.name = 'NavigationError';
  }
}

export class FileFallbackError extends Error {
  constructor(
    message: string,
    public readonly dataSize?: number,
    public readonly format?: string
  ) {
    super(message);
    this.name = 'FileFallbackError';
  }
}

// Utility types for better type safety
export type ChunkingStrategy = 'field_based' | 'character_based' | 'hybrid';
export type AttachmentFormat = 'txt' | 'json' | 'csv';
export type NavigationDirection = 'first' | 'previous' | 'next' | 'last' | 'jump';

// Event types for chunking progress tracking
export interface ChunkingProgressEvent {
  sessionId: string;
  progress: ChunkingProgress;
  timestamp: Date;
}