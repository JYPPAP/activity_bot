// src/interfaces/IMemberFetchService.ts - Discord Member Fetch 최적화 서비스 인터페이스

import { Collection, Guild, GuildMember } from 'discord.js';

// 멤버 fetch 결과 인터페이스
export interface MemberFetchResult {
  success: boolean;
  members: Collection<string, GuildMember>;
  metadata: {
    totalCount: number;
    fetchTime: number;
    cacheHit: boolean;
    retryCount: number;
    fallbackUsed: boolean;
    source: 'cache' | 'full_fetch' | 'partial_fetch' | 'fallback';
  };
  error?: Error;
}

// 역할별 멤버 fetch 결과
export interface RoleMemberFetchResult {
  success: boolean;
  roleMembers: Collection<string, GuildMember>;
  metadata: {
    roleName: string;
    memberCount: number;
    fetchTime: number;
    filterTime: number;
    cacheHit: boolean;
    totalMembersChecked: number;
  };
  error?: Error;
}

// Progress tracking을 위한 인터페이스
export interface FetchProgress {
  operationId: string;
  stage: 'initializing' | 'fetching' | 'filtering' | 'caching' | 'completed' | 'failed';
  progress: number; // 0-100
  message: string;
  startTime: number;
  estimatedTimeRemaining?: number;
  currentCount?: number;
  totalCount?: number;
}

// 캐시 설정 인터페이스
export interface CacheConfig {
  defaultTTL: number; // milliseconds
  maxCacheSize: number;
  cleanupInterval: number;
  enableLRU: boolean;
}

// Retry 설정 인터페이스
export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  exponentialBase: number;
  jitter: boolean;
}

// Rate limiting 설정
export interface RateLimitConfig {
  maxConcurrentRequests: number;
  requestsPerMinute: number;
  burstLimit: number;
}

// 멤버 fetch 서비스 설정
export interface MemberFetchServiceConfig {
  cache: CacheConfig;
  retry: RetryConfig;
  rateLimit: RateLimitConfig;
  timeouts: {
    fullFetch: number;
    partialFetch: number;
    fallbackTimeout: number;
  };
  fallback: {
    enableProgressiveFetch: boolean;
    partialFetchLimit: number;
    useCacheAsLastResort: boolean;
  };
  monitoring: {
    enableMetrics: boolean;
    enableProgressTracking: boolean;
    logPerformanceWarnings: boolean;
    performanceThreshold: number; // milliseconds
  };
}

// 멤버 fetch 통계
export interface MemberFetchStatistics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  cacheHits: number;
  averageFetchTime: number;
  averageRetryCount: number;
  fallbackUsageCount: number;
  lastResetTime: number;
}

// Progress 콜백 함수 타입
export type ProgressCallback = (progress: FetchProgress) => void | Promise<void>;

// 필터 함수 타입
export type MemberFilter = (member: GuildMember) => boolean;

/**
 * Discord Member Fetch 최적화 서비스 인터페이스
 * 
 * 주요 기능:
 * - Exponential backoff retry mechanism
 * - Concurrent batch processing with rate limiting  
 * - Smart caching with TTL management
 * - Graceful fallback to partial data
 * - Progress tracking for long operations
 */
export interface IMemberFetchService {
  // 기본 멤버 fetch 메서드
  fetchGuildMembers(
    guild: Guild,
    options?: {
      forceRefresh?: boolean;
      timeout?: number;
      progressCallback?: ProgressCallback;
    }
  ): Promise<MemberFetchResult>;

  // 역할별 멤버 fetch (최적화됨)
  fetchRoleMembers(
    guild: Guild,
    roleName: string,
    options?: {
      forceRefresh?: boolean;
      progressCallback?: ProgressCallback;
    }
  ): Promise<RoleMemberFetchResult>;

  // 여러 역할의 멤버들을 배치로 fetch
  fetchMultipleRoleMembers(
    guild: Guild,
    roleNames: string[],
    options?: {
      concurrency?: number;
      progressCallback?: ProgressCallback;
    }
  ): Promise<Map<string, RoleMemberFetchResult>>;

  // 커스텀 필터로 멤버 fetch
  fetchMembersWithFilter(
    guild: Guild,
    filter: MemberFilter,
    options?: {
      progressCallback?: ProgressCallback;
    }
  ): Promise<MemberFetchResult>;

  // 캐시 관리
  clearCache(guildId?: string): void;
  getCacheStats(guildId?: string): {
    size: number;
    hitRate: number;
    oldestEntry: number;
    newestEntry: number;
  };
  
  // 통계 및 모니터링
  getStatistics(): MemberFetchStatistics;
  resetStatistics(): void;
  
  // 서비스 설정
  updateConfig(config: Partial<MemberFetchServiceConfig>): void;
  getConfig(): MemberFetchServiceConfig;
  
  // 헬스체크
  healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    cacheStatus: 'healthy' | 'full' | 'error';
    rateLimitStatus: 'normal' | 'throttled' | 'blocked';
    lastSuccessfulFetch?: number;
    errorCount: number;
  }>;

  // 진행 중인 작업 관리
  getActiveOperations(): FetchProgress[];
  cancelOperation(operationId: string): boolean;
}