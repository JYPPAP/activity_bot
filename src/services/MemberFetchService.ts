// src/services/MemberFetchService.ts - Discord Member Fetch 최적화 서비스 구현

import { Collection, Guild, GuildMember } from 'discord.js';
import { injectable } from 'tsyringe';
import { 
  IMemberFetchService, 
  MemberFetchResult, 
  RoleMemberFetchResult,
  FetchProgress,
  MemberFetchServiceConfig,
  MemberFetchStatistics,
  ProgressCallback,
  MemberFilter
} from '../interfaces/IMemberFetchService';

// 캐시 엔트리 인터페이스
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  accessCount: number;
  lastAccessed: number;
}

// Rate limiter 클래스
class RateLimiter {
  private requests: number[] = [];
  private activeRequests = 0;

  constructor(
    private maxConcurrent: number,
    private requestsPerMinute: number,
    private burstLimit: number
  ) {}

  async acquire(): Promise<void> {
    return new Promise((resolve, reject) => {
      const now = Date.now();
      
      // 1분 이전 요청 제거
      this.requests = this.requests.filter(time => now - time < 60000);
      
      // Rate limit 체크
      if (this.requests.length >= this.requestsPerMinute) {
        const oldestRequest = Math.min(...this.requests);
        const waitTime = 60000 - (now - oldestRequest);
        setTimeout(() => this.acquire().then(resolve).catch(reject), waitTime);
        return;
      }
      
      // Concurrent limit 체크
      if (this.activeRequests >= this.maxConcurrent) {
        setTimeout(() => this.acquire().then(resolve).catch(reject), 100);
        return;
      }
      
      // Burst limit 체크
      const recentRequests = this.requests.filter(time => now - time < 1000);
      if (recentRequests.length >= this.burstLimit) {
        setTimeout(() => this.acquire().then(resolve).catch(reject), 1000);
        return;
      }
      
      this.requests.push(now);
      this.activeRequests++;
      resolve();
    });
  }

  release(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
  }
}

// Retry 유틸리티 클래스
class RetryManager {
  constructor(private config: MemberFetchServiceConfig['retry']) {}

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string = 'operation'
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt === this.config.maxRetries) {
          throw new Error(`${operationName} failed after ${this.config.maxRetries} retries: ${lastError.message}`);
        }
        
        const delay = this.calculateDelay(attempt);
        console.warn(`[MemberFetchService] ${operationName} attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error);
        
        await this.sleep(delay);
      }
    }
    
    throw lastError!;
  }

  private calculateDelay(attempt: number): number {
    const baseDelay = this.config.baseDelay * Math.pow(this.config.exponentialBase, attempt);
    const delay = Math.min(baseDelay, this.config.maxDelay);
    
    if (this.config.jitter) {
      // Add ±25% jitter
      const jitter = delay * 0.25 * (Math.random() * 2 - 1);
      return Math.max(0, delay + jitter);
    }
    
    return delay;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

@injectable()
export class MemberFetchService implements IMemberFetchService {
  private memberCache = new Map<string, CacheEntry<Collection<string, GuildMember>>>();
  private roleMemberCache = new Map<string, CacheEntry<Collection<string, GuildMember>>>();
  private activeOperations = new Map<string, FetchProgress>();
  private statistics: MemberFetchStatistics;
  private rateLimiter: RateLimiter;
  private retryManager: RetryManager;
  
  private config: MemberFetchServiceConfig = {
    cache: {
      defaultTTL: 300000, // 5 minutes
      maxCacheSize: 100,
      cleanupInterval: 60000, // 1 minute
      enableLRU: true
    },
    retry: {
      maxRetries: 3,
      baseDelay: 1000, // 1 second
      maxDelay: 30000, // 30 seconds
      exponentialBase: 2,
      jitter: true
    },
    rateLimit: {
      maxConcurrentRequests: 3,
      requestsPerMinute: 50,
      burstLimit: 5
    },
    timeouts: {
      fullFetch: 20000, // 20 seconds
      partialFetch: 10000, // 10 seconds
      fallbackTimeout: 5000 // 5 seconds
    },
    fallback: {
      enableProgressiveFetch: true,
      partialFetchLimit: 1000,
      useCacheAsLastResort: true
    },
    monitoring: {
      enableMetrics: true,
      enableProgressTracking: true,
      logPerformanceWarnings: true,
      performanceThreshold: 5000 // 5 seconds
    }
  };

  constructor() {
    this.statistics = this.initializeStatistics();
    this.rateLimiter = new RateLimiter(
      this.config.rateLimit.maxConcurrentRequests,
      this.config.rateLimit.requestsPerMinute,
      this.config.rateLimit.burstLimit
    );
    this.retryManager = new RetryManager(this.config.retry);
    
    // 정기적 캐시 정리
    setInterval(() => this.cleanupCache(), this.config.cache.cleanupInterval);
    
    console.log('[MemberFetchService] 서비스 초기화 완료');
  }

  async fetchGuildMembers(
    guild: Guild,
    options: {
      forceRefresh?: boolean;
      timeout?: number;
      progressCallback?: ProgressCallback;
    } = {}
  ): Promise<MemberFetchResult> {
    const startTime = Date.now();
    const operationId = `guild_${guild.id}_${startTime}`;
    const { forceRefresh = false, timeout = this.config.timeouts.fullFetch, progressCallback } = options;
    
    this.statistics.totalRequests++;
    
    try {
      // Progress tracking 시작
      if (progressCallback && this.config.monitoring.enableProgressTracking) {
        const progress: FetchProgress = {
          operationId,
          stage: 'initializing',
          progress: 0,
          message: '멤버 fetch 작업 초기화 중...',
          startTime
        };
        this.activeOperations.set(operationId, progress);
        await progressCallback(progress);
      }

      // 캐시 확인 (force refresh가 아닌 경우)
      if (!forceRefresh) {
        const cached = this.getCachedMembers(guild.id);
        if (cached) {
          console.log(`[MemberFetchService] 캐시 히트: ${guild.name} (${cached.size}명)`);
          this.statistics.cacheHits++;
          this.statistics.successfulRequests++;
          
          if (progressCallback) {
            await progressCallback({
              operationId,
              stage: 'completed',
              progress: 100,
              message: '캐시에서 멤버 데이터 로드 완료',
              startTime,
              currentCount: cached.size,
              totalCount: cached.size
            });
          }
          
          return {
            success: true,
            members: cached,
            metadata: {
              totalCount: cached.size,
              fetchTime: Date.now() - startTime,
              cacheHit: true,
              retryCount: 0,
              fallbackUsed: false,
              source: 'cache'
            }
          };
        }
      }

      // Rate limiter 획득
      await this.rateLimiter.acquire();

      try {
        if (progressCallback) {
          await progressCallback({
            operationId,
            stage: 'fetching',
            progress: 10,
            message: 'Discord API에서 멤버 데이터 가져오는 중...',
            startTime,
            estimatedTimeRemaining: timeout
          });
        }

        // Retry 메커니즘으로 멤버 fetch 실행
        const members = await this.retryManager.executeWithRetry(async () => {
          return await this.performMemberFetch(guild, timeout, progressCallback, operationId, startTime);
        }, `Guild members fetch for ${guild.name}`);

        // 캐시에 저장
        this.setCachedMembers(guild.id, members);
        
        this.statistics.successfulRequests++;
        const fetchTime = Date.now() - startTime;
        
        if (progressCallback) {
          await progressCallback({
            operationId,
            stage: 'completed',
            progress: 100,
            message: `멤버 fetch 완료 (${members.size}명)`,
            startTime,
            currentCount: members.size,
            totalCount: members.size
          });
        }

        // 성능 경고
        if (this.config.monitoring.logPerformanceWarnings && fetchTime > this.config.monitoring.performanceThreshold) {
          console.warn(`[MemberFetchService] 성능 경고: ${guild.name} fetch가 ${fetchTime}ms 소요됨`);
        }

        console.log(`[MemberFetchService] 멤버 fetch 성공: ${guild.name} (${members.size}명, ${fetchTime}ms)`);

        return {
          success: true,
          members,
          metadata: {
            totalCount: members.size,
            fetchTime,
            cacheHit: false,
            retryCount: 0, // RetryManager에서 관리되므로 정확한 카운트는 별도 추적 필요
            fallbackUsed: false,
            source: 'full_fetch'
          }
        };

      } finally {
        this.rateLimiter.release();
        this.activeOperations.delete(operationId);
      }

    } catch (error) {
      this.statistics.failedRequests++;
      console.error(`[MemberFetchService] 멤버 fetch 실패: ${guild.name}`, error);
      
      if (progressCallback) {
        await progressCallback({
          operationId,
          stage: 'failed',
          progress: 0,
          message: `멤버 fetch 실패: ${error instanceof Error ? error.message : 'Unknown error'}`,
          startTime
        });
      }
      
      this.activeOperations.delete(operationId);
      
      return {
        success: false,
        members: new Collection(),
        metadata: {
          totalCount: 0,
          fetchTime: Date.now() - startTime,
          cacheHit: false,
          retryCount: this.config.retry.maxRetries,
          fallbackUsed: false,
          source: 'full_fetch'
        },
        error: error as Error
      };
    }
  }

  private async performMemberFetch(
    guild: Guild, 
    timeout: number, 
    progressCallback?: ProgressCallback,
    operationId?: string,
    startTime?: number
  ): Promise<Collection<string, GuildMember>> {
    // Progressive fetch 전략
    if (this.config.fallback.enableProgressiveFetch) {
      // 1단계: 캐시 충분성 확인
      if (guild.members.cache.size > 0 && guild.memberCount) {
        const cacheRatio = guild.members.cache.size / guild.memberCount;
        if (cacheRatio >= 0.8) {
          console.log(`[MemberFetchService] 캐시 충분성 확인: ${Math.round(cacheRatio * 100)}%`);
          if (progressCallback && operationId && startTime) {
            await progressCallback({
              operationId,
              stage: 'fetching',
              progress: 50,
              message: '캐시된 데이터로 충분함',
              startTime,
              currentCount: guild.members.cache.size,
              totalCount: guild.memberCount
            });
          }
          return guild.members.cache;
        }
      }

      // 2단계: 전체 fetch 시도
      try {
        if (progressCallback && operationId && startTime) {
          await progressCallback({
            operationId,
            stage: 'fetching',
            progress: 30,
            message: '전체 멤버 데이터 가져오는 중...',
            startTime
          });
        }

        const fullFetchPromise = guild.members.fetch();
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error(`Full fetch timeout after ${timeout}ms`)), timeout)
        );

        const members = await Promise.race([fullFetchPromise, timeoutPromise]);
        
        if (progressCallback && operationId && startTime) {
          await progressCallback({
            operationId,
            stage: 'fetching',
            progress: 80,
            message: `전체 fetch 성공 (${members.size}명)`,
            startTime,
            currentCount: members.size,
            totalCount: members.size
          });
        }

        return members;
      } catch (fullFetchError) {
        console.warn(`[MemberFetchService] 전체 fetch 실패, 부분 fetch 시도:`, fullFetchError);
        
        // 3단계: 부분 fetch 시도
        try {
          if (progressCallback && operationId && startTime) {
            await progressCallback({
              operationId,
              stage: 'fetching',
              progress: 60,
              message: '부분 멤버 데이터 가져오는 중...',
              startTime
            });
          }

          const partialFetchPromise = guild.members.fetch({ limit: this.config.fallback.partialFetchLimit });
          const partialTimeoutPromise = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error(`Partial fetch timeout after ${this.config.timeouts.partialFetch}ms`)), this.config.timeouts.partialFetch)
          );

          const members = await Promise.race([partialFetchPromise, partialTimeoutPromise]);
          
          console.log(`[MemberFetchService] 부분 fetch 성공: ${members.size}명`);
          return members;
        } catch (partialFetchError) {
          console.warn(`[MemberFetchService] 부분 fetch도 실패:`, partialFetchError);
          
          // 4단계: 캐시 fallback (최후의 수단)
          if (this.config.fallback.useCacheAsLastResort && guild.members.cache.size > 0) {
            console.log(`[MemberFetchService] 캐시 fallback 사용: ${guild.members.cache.size}명`);
            return guild.members.cache;
          }
          
          const fullErrorMsg = fullFetchError instanceof Error ? fullFetchError.message : String(fullFetchError);
          const partialErrorMsg = partialFetchError instanceof Error ? partialFetchError.message : String(partialFetchError);
          throw new Error(`모든 fetch 방법 실패: Full(${fullErrorMsg}), Partial(${partialErrorMsg})`);
        }
      }
    } else {
      // 기본 전체 fetch
      return await guild.members.fetch();
    }
  }

  async fetchRoleMembers(
    guild: Guild,
    roleName: string,
    options: {
      forceRefresh?: boolean;
      progressCallback?: ProgressCallback;
    } = {}
  ): Promise<RoleMemberFetchResult> {
    const startTime = Date.now();
    const operationId = `role_${guild.id}_${roleName}_${startTime}`;
    const { forceRefresh = false, progressCallback } = options;
    
    try {
      if (progressCallback) {
        await progressCallback({
          operationId,
          stage: 'initializing',
          progress: 0,
          message: `역할 "${roleName}" 멤버 조회 시작`,
          startTime
        });
      }

      // 캐시 확인
      const cacheKey = `${guild.id}_${roleName}`;
      if (!forceRefresh) {
        const cached = this.getCachedRoleMembers(cacheKey);
        if (cached) {
          console.log(`[MemberFetchService] 역할 멤버 캐시 히트: ${roleName} (${cached.size}명)`);
          
          if (progressCallback) {
            await progressCallback({
              operationId,
              stage: 'completed',
              progress: 100,
              message: `캐시에서 역할 멤버 로드 완료 (${cached.size}명)`,
              startTime,
              currentCount: cached.size,
              totalCount: cached.size
            });
          }

          return {
            success: true,
            roleMembers: cached,
            metadata: {
              roleName,
              memberCount: cached.size,
              fetchTime: Date.now() - startTime,
              filterTime: 0,
              cacheHit: true,
              totalMembersChecked: cached.size
            }
          };
        }
      }

      // 전체 멤버 먼저 가져오기
      if (progressCallback) {
        await progressCallback({
          operationId,
          stage: 'fetching',
          progress: 20,
          message: '전체 멤버 데이터 가져오는 중...',
          startTime
        });
      }

      const memberFetchResult = await this.fetchGuildMembers(guild, { 
        forceRefresh,
        ...(progressCallback && {
          progressCallback: (progress) => {
            // 진행률을 20-80% 범위로 조정
            const adjustedProgress = { 
              ...progress, 
              progress: 20 + (progress.progress * 0.6) 
            };
            return progressCallback(adjustedProgress);
          }
        })
      });

      if (!memberFetchResult.success) {
        throw memberFetchResult.error || new Error('멤버 fetch 실패');
      }

      // 역할 필터링
      if (progressCallback) {
        await progressCallback({
          operationId,
          stage: 'filtering',
          progress: 85,
          message: `역할 "${roleName}" 필터링 중...`,
          startTime,
          totalCount: memberFetchResult.members.size
        });
      }

      const filterStartTime = Date.now();
      const roleMembers = memberFetchResult.members.filter(member => 
        member.roles.cache.some(role => role.name === roleName)
      );
      const filterTime = Date.now() - filterStartTime;

      // 캐시 저장
      this.setCachedRoleMembers(cacheKey, roleMembers);

      if (progressCallback) {
        await progressCallback({
          operationId,
          stage: 'completed',
          progress: 100,
          message: `역할 멤버 조회 완료 (${roleMembers.size}명)`,
          startTime,
          currentCount: roleMembers.size,
          totalCount: roleMembers.size
        });
      }

      const totalTime = Date.now() - startTime;
      console.log(`[MemberFetchService] 역할 멤버 조회 성공: ${roleName} (${roleMembers.size}명, ${totalTime}ms)`);

      return {
        success: true,
        roleMembers,
        metadata: {
          roleName,
          memberCount: roleMembers.size,
          fetchTime: totalTime,
          filterTime,
          cacheHit: false,
          totalMembersChecked: memberFetchResult.members.size
        }
      };

    } catch (error) {
      console.error(`[MemberFetchService] 역할 멤버 조회 실패: ${roleName}`, error);
      
      if (progressCallback) {
        await progressCallback({
          operationId,
          stage: 'failed',
          progress: 0,
          message: `역할 멤버 조회 실패: ${error instanceof Error ? error.message : 'Unknown error'}`,
          startTime
        });
      }

      return {
        success: false,
        roleMembers: new Collection(),
        metadata: {
          roleName,
          memberCount: 0,
          fetchTime: Date.now() - startTime,
          filterTime: 0,
          cacheHit: false,
          totalMembersChecked: 0
        },
        error: error as Error
      };
    }
  }

  async fetchMultipleRoleMembers(
    guild: Guild,
    roleNames: string[],
    options: {
      concurrency?: number;
      progressCallback?: ProgressCallback;
    } = {}
  ): Promise<Map<string, RoleMemberFetchResult>> {
    const { concurrency = this.config.rateLimit.maxConcurrentRequests, progressCallback } = options;
    const startTime = Date.now();
    const operationId = `multi_role_${guild.id}_${startTime}`;
    const results = new Map<string, RoleMemberFetchResult>();
    
    let completedCount = 0;
    
    if (progressCallback) {
      await progressCallback({
        operationId,
        stage: 'initializing',
        progress: 0,
        message: `${roleNames.length}개 역할의 멤버 조회 시작`,
        startTime,
        totalCount: roleNames.length
      });
    }

    // 배치 처리
    const batches: string[][] = [];
    for (let i = 0; i < roleNames.length; i += concurrency) {
      batches.push(roleNames.slice(i, i + concurrency));
    }

    for (const batch of batches) {
      const promises = batch.map(async (roleName) => {
        const result = await this.fetchRoleMembers(guild, roleName, {
          ...(progressCallback && {
            progressCallback: (_progress) => {
              completedCount++;
              const overallProgress = (completedCount / roleNames.length) * 100;
              return progressCallback({
                operationId,
                stage: 'fetching',
                progress: overallProgress,
                message: `역할 "${roleName}" 처리 중... (${completedCount}/${roleNames.length})`,
                startTime,
                currentCount: completedCount,
                totalCount: roleNames.length
              });
            }
          })
        });
        return { roleName, result };
      });

      const batchResults = await Promise.allSettled(promises);
      
      batchResults.forEach((settledResult, index) => {
        const roleName = batch[index];
        if (settledResult.status === 'fulfilled') {
          results.set(roleName, settledResult.value.result);
        } else {
          results.set(roleName, {
            success: false,
            roleMembers: new Collection(),
            metadata: {
              roleName,
              memberCount: 0,
              fetchTime: 0,
              filterTime: 0,
              cacheHit: false,
              totalMembersChecked: 0
            },
            error: settledResult.reason
          });
        }
      });
    }

    if (progressCallback) {
      await progressCallback({
        operationId,
        stage: 'completed',
        progress: 100,
        message: `모든 역할 멤버 조회 완료 (${results.size}개 역할)`,
        startTime,
        currentCount: results.size,
        totalCount: roleNames.length
      });
    }

    console.log(`[MemberFetchService] 다중 역할 멤버 조회 완료: ${results.size}개 역할, ${Date.now() - startTime}ms`);
    return results;
  }

  async fetchMembersWithFilter(
    guild: Guild,
    filter: MemberFilter,
    options: {
      progressCallback?: ProgressCallback;
    } = {}
  ): Promise<MemberFetchResult> {
    const startTime = Date.now();
    const operationId = `filter_${guild.id}_${startTime}`;
    const { progressCallback } = options;

    try {
      if (progressCallback) {
        await progressCallback({
          operationId,
          stage: 'initializing',
          progress: 0,
          message: '커스텀 필터로 멤버 조회 시작',
          startTime
        });
      }

      // 전체 멤버 가져오기
      const memberFetchResult = await this.fetchGuildMembers(guild, {
        ...(progressCallback && {
          progressCallback: (progress) => {
            const adjustedProgress = { 
              ...progress, 
              progress: progress.progress * 0.8 
            };
            return progressCallback(adjustedProgress);
          }
        })
      });

      if (!memberFetchResult.success) {
        throw memberFetchResult.error || new Error('멤버 fetch 실패');
      }

      // 필터 적용
      if (progressCallback) {
        await progressCallback({
          operationId,
          stage: 'filtering',
          progress: 85,
          message: '커스텀 필터 적용 중...',
          startTime,
          totalCount: memberFetchResult.members.size
        });
      }

      const filteredMembers = memberFetchResult.members.filter(filter);

      if (progressCallback) {
        await progressCallback({
          operationId,
          stage: 'completed',
          progress: 100,
          message: `필터링 완료 (${filteredMembers.size}명)`,
          startTime,
          currentCount: filteredMembers.size,
          totalCount: filteredMembers.size
        });
      }

      return {
        success: true,
        members: filteredMembers,
        metadata: {
          totalCount: filteredMembers.size,
          fetchTime: Date.now() - startTime,
          cacheHit: memberFetchResult.metadata.cacheHit,
          retryCount: memberFetchResult.metadata.retryCount,
          fallbackUsed: memberFetchResult.metadata.fallbackUsed,
          source: memberFetchResult.metadata.source
        }
      };

    } catch (error) {
      if (progressCallback) {
        await progressCallback({
          operationId,
          stage: 'failed',
          progress: 0,
          message: `필터 조회 실패: ${error instanceof Error ? error.message : 'Unknown error'}`,
          startTime
        });
      }

      return {
        success: false,
        members: new Collection(),
        metadata: {
          totalCount: 0,
          fetchTime: Date.now() - startTime,
          cacheHit: false,
          retryCount: 0,
          fallbackUsed: false,
          source: 'full_fetch'
        },
        error: error as Error
      };
    }
  }

  // 캐시 관리 메서드들
  private getCachedMembers(guildId: string): Collection<string, GuildMember> | null {
    const entry = this.memberCache.get(guildId);
    if (!entry) return null;
    
    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.memberCache.delete(guildId);
      return null;
    }
    
    entry.accessCount++;
    entry.lastAccessed = now;
    return entry.data;
  }

  private setCachedMembers(guildId: string, members: Collection<string, GuildMember>): void {
    const now = Date.now();
    
    // LRU 캐시 관리
    if (this.config.cache.enableLRU && this.memberCache.size >= this.config.cache.maxCacheSize) {
      this.evictLRU(this.memberCache);
    }
    
    this.memberCache.set(guildId, {
      data: members,
      timestamp: now,
      ttl: this.config.cache.defaultTTL,
      accessCount: 1,
      lastAccessed: now
    });
  }

  private getCachedRoleMembers(cacheKey: string): Collection<string, GuildMember> | null {
    const entry = this.roleMemberCache.get(cacheKey);
    if (!entry) return null;
    
    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.roleMemberCache.delete(cacheKey);
      return null;
    }
    
    entry.accessCount++;
    entry.lastAccessed = now;
    return entry.data;
  }

  private setCachedRoleMembers(cacheKey: string, members: Collection<string, GuildMember>): void {
    const now = Date.now();
    
    if (this.config.cache.enableLRU && this.roleMemberCache.size >= this.config.cache.maxCacheSize) {
      this.evictLRU(this.roleMemberCache);
    }
    
    this.roleMemberCache.set(cacheKey, {
      data: members,
      timestamp: now,
      ttl: this.config.cache.defaultTTL,
      accessCount: 1,
      lastAccessed: now
    });
  }

  private evictLRU<T>(cache: Map<string, CacheEntry<T>>): void {
    let oldestKey = '';
    let oldestTime = Date.now();
    
    for (const [key, entry] of cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      cache.delete(oldestKey);
      console.log(`[MemberFetchService] LRU 캐시 제거: ${oldestKey}`);
    }
  }

  private cleanupCache(): void {
    const now = Date.now();
    let cleanedCount = 0;
    
    // 멤버 캐시 정리
    for (const [key, entry] of this.memberCache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.memberCache.delete(key);
        cleanedCount++;
      }
    }
    
    // 역할 멤버 캐시 정리
    for (const [key, entry] of this.roleMemberCache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.roleMemberCache.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`[MemberFetchService] 캐시 정리 완료: ${cleanedCount}개 항목 제거`);
    }
  }

  clearCache(guildId?: string): void {
    if (guildId) {
      this.memberCache.delete(guildId);
      // 해당 길드의 역할 캐시도 정리
      for (const [key] of this.roleMemberCache.entries()) {
        if (key.startsWith(`${guildId}_`)) {
          this.roleMemberCache.delete(key);
        }
      }
      console.log(`[MemberFetchService] 길드 ${guildId} 캐시 정리 완료`);
    } else {
      this.memberCache.clear();
      this.roleMemberCache.clear();
      console.log('[MemberFetchService] 전체 캐시 정리 완료');
    }
  }

  getCacheStats(guildId?: string) {
    const relevantCaches = guildId 
      ? new Map([...this.memberCache.entries(), ...this.roleMemberCache.entries()].filter(([key]) => 
          key === guildId || key.startsWith(`${guildId}_`)
        ))
      : new Map([...this.memberCache.entries(), ...this.roleMemberCache.entries()]);

    if (relevantCaches.size === 0) {
      return { size: 0, hitRate: 0, oldestEntry: 0, newestEntry: 0 };
    }

    const entries = Array.from(relevantCaches.values());
    const totalAccess = entries.reduce((sum, entry) => sum + entry.accessCount, 0);
    const hitRate = totalAccess > 0 ? this.statistics.cacheHits / this.statistics.totalRequests : 0;
    const timestamps = entries.map(entry => entry.timestamp);
    
    return {
      size: relevantCaches.size,
      hitRate,
      oldestEntry: Math.min(...timestamps),
      newestEntry: Math.max(...timestamps)
    };
  }

  getStatistics(): MemberFetchStatistics {
    return { ...this.statistics };
  }

  resetStatistics(): void {
    this.statistics = this.initializeStatistics();
    console.log('[MemberFetchService] 통계 초기화 완료');
  }

  private initializeStatistics(): MemberFetchStatistics {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      cacheHits: 0,
      averageFetchTime: 0,
      averageRetryCount: 0,
      fallbackUsageCount: 0,
      lastResetTime: Date.now()
    };
  }

  updateConfig(config: Partial<MemberFetchServiceConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Rate limiter 재초기화
    if (config.rateLimit) {
      this.rateLimiter = new RateLimiter(
        this.config.rateLimit.maxConcurrentRequests,
        this.config.rateLimit.requestsPerMinute,
        this.config.rateLimit.burstLimit
      );
    }
    
    // Retry manager 재초기화
    if (config.retry) {
      this.retryManager = new RetryManager(this.config.retry);
    }
    
    console.log('[MemberFetchService] 설정 업데이트 완료');
  }

  getConfig(): MemberFetchServiceConfig {
    return { ...this.config };
  }

  async healthCheck() {
    const stats = this.getCacheStats();
    const now = Date.now();
    
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    // 실패율 확인
    const failureRate = this.statistics.totalRequests > 0 
      ? this.statistics.failedRequests / this.statistics.totalRequests 
      : 0;
    
    if (failureRate > 0.5) {
      status = 'unhealthy';
    } else if (failureRate > 0.2) {
      status = 'degraded';
    }
    
    return {
      status,
      cacheStatus: stats.size > this.config.cache.maxCacheSize * 0.9 ? 'full' : 'healthy',
      rateLimitStatus: 'normal', // Rate limiter 상태는 내부 구현에 따라 결정
      lastSuccessfulFetch: this.statistics.totalRequests > 0 ? now : undefined,
      errorCount: this.statistics.failedRequests
    };
  }

  getActiveOperations(): FetchProgress[] {
    return Array.from(this.activeOperations.values());
  }

  cancelOperation(operationId: string): boolean {
    if (this.activeOperations.has(operationId)) {
      this.activeOperations.delete(operationId);
      console.log(`[MemberFetchService] 작업 취소됨: ${operationId}`);
      return true;
    }
    return false;
  }
}