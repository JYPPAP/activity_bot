// src/services/OptimizedMemberFetchService.ts - 최적화된 멤버 가져오기 서비스
import { 
  Guild, 
  GuildMember, 
  Collection, 
  Role 
} from 'discord.js';
import { injectable, inject } from 'tsyringe';

import type { IRedisService } from '../interfaces/IRedisService';
import { DI_TOKENS } from '../interfaces/index';

// 가져오기 전략 인터페이스
interface FetchStrategy {
  name: string;
  timeout: number;
  execute(guild: Guild, options?: FetchOptions): Promise<Collection<string, GuildMember>>;
}

// 가져오기 옵션
interface FetchOptions {
  roleName?: string;
  limit?: number;
  forceRefresh?: boolean;
  abortSignal?: AbortSignal;
}

// 성능 메트릭
interface FetchMetrics {
  totalRequests: number;
  successfulFetches: number;
  timeouts: number;
  cacheHits: number;
  averageResponseTime: number;
  slowQueries: number;
  strategiesUsed: Map<string, number>;
}

// 캐시 데이터 구조
interface CachedMemberData {
  data: [string, any][];
  timestamp: number;
  count: number;
  guildId: string;
  roleName?: string;
}

// 회로 차단기 상태
interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailure: number;
  successCount: number;
  threshold: number;
}

@injectable()
export class OptimizedMemberFetchService {
  private redisService: IRedisService;
  private metrics: FetchMetrics;
  private circuitBreakers: Map<string, CircuitBreakerState>;
  private cacheWarmupIntervals: Map<string, NodeJS.Timeout>;

  // 최적화된 타임아웃 설정
  private readonly TIMEOUTS = {
    FULL_FETCH: 8000,      // 8초 (기존 30초 → 8초)
    PARTIAL_FETCH: 5000,   // 5초 (기존 10초 → 5초)
    CACHE_ACCESS: 1000,    // 1초 (캐시 접근)
    CHUNK_DELAY: 200,      // 청크 간 지연 (레이트 리밋 방지)
  };

  private readonly LIMITS = {
    FULL_FETCH_LIMIT: 2000,     // 전체 가져오기 제한
    PARTIAL_FETCH_LIMIT: 500,   // 부분 가져오기 제한
    CHUNK_SIZE: 100,            // 청크 크기
    MAX_CHUNKS: 20,             // 최대 청크 수
    CACHE_TTL: 1800,            // 캐시 TTL (30분)
    ROLE_CACHE_TTL: 600,        // 역할 캐시 TTL (10분)
  };

  constructor(
    @inject(DI_TOKENS.IRedisService) redisService: IRedisService
  ) {
    this.redisService = redisService;
    this.metrics = this.initializeMetrics();
    this.circuitBreakers = new Map();
    this.cacheWarmupIntervals = new Map();

    console.log('[OptimizedMemberFetch] 최적화된 멤버 가져오기 서비스 초기화 완료');
  }

  /**
   * 🚀 최적화된 멤버 가져오기 (병렬 전략)
   */
  async getRoleMembers(
    guild: Guild, 
    roleName: string, 
    options: FetchOptions = {}
  ): Promise<Collection<string, GuildMember>> {
    const startTime = Date.now();
    const guildId = guild.id;
    
    console.log(`[OptimizedFetch] 멤버 가져오기 시작: ${roleName} (길드: ${guildId})`);
    
    try {
      this.metrics.totalRequests++;

      // 회로 차단기 확인
      if (this.isCircuitOpen(guildId)) {
        console.log(`[OptimizedFetch] 회로 차단기 열림, 캐시만 사용: ${guildId}`);
        return await this.getCachedRoleMembers(guildId, roleName);
      }

      // 병렬 전략 실행 (순차가 아닌 동시 실행)
      const strategies = this.createFetchStrategies(guild, roleName, options);
      const results = await this.executeParallelStrategies(strategies);
      
      // 가장 빠른 성공한 결과 사용
      const members = this.selectBestResult(results);
      
      if (members && members.size > 0) {
        // 성공 시 캐시 업데이트
        await this.updateMemberCache(guildId, roleName, members);
        this.recordSuccess(guildId, Date.now() - startTime);
        
        console.log(`[OptimizedFetch] 성공: ${members.size}명 (${Date.now() - startTime}ms)`);
        return members;
      } else {
        throw new Error('모든 가져오기 전략 실패');
      }

    } catch (error) {
      this.recordFailure(guildId, error);
      console.error(`[OptimizedFetch] 실패 (${Date.now() - startTime}ms):`, error);
      
      // 최후 수단: 캐시 사용
      const cachedMembers = await this.getCachedRoleMembers(guildId, roleName);
      if (cachedMembers.size > 0) {
        console.log(`[OptimizedFetch] 캐시 폴백 사용: ${cachedMembers.size}명`);
        return cachedMembers;
      }
      
      throw error;
    }
  }

  /**
   * 병렬 전략 생성
   */
  private createFetchStrategies(
    guild: Guild, 
    roleName: string, 
    options: FetchOptions
  ): FetchStrategy[] {
    const strategies: FetchStrategy[] = [];

    // 1. 캐시 우선 전략 (가장 빠름)
    strategies.push({
      name: 'cache',
      timeout: this.TIMEOUTS.CACHE_ACCESS,
      execute: async () => {
        const cached = await this.getCachedRoleMembers(guild.id, roleName);
        if (cached.size === 0) {
          throw new Error('캐시에 데이터 없음');
        }
        return cached;
      }
    });

    // 2. 역할 직접 접근 전략 (중간 속도)
    strategies.push({
      name: 'role_direct',
      timeout: this.TIMEOUTS.PARTIAL_FETCH,
      execute: async () => {
        const role = guild.roles.cache.find(r => r.name === roleName);
        if (!role) {
          throw new Error(`역할 '${roleName}'을 찾을 수 없음`);
        }
        
        if (role.members.size === 0) {
          // 역할 멤버가 캐시되지 않은 경우 부분 fetch 시도
          await guild.members.fetch({ limit: this.LIMITS.PARTIAL_FETCH_LIMIT });
        }
        
        return role.members;
      }
    });

    // 3. 부분 fetch 전략 (중간 속도)
    if (!options.forceRefresh) {
      strategies.push({
        name: 'partial_fetch',
        timeout: this.TIMEOUTS.PARTIAL_FETCH,
        execute: async () => {
          const members = await guild.members.fetch({ 
            limit: this.LIMITS.PARTIAL_FETCH_LIMIT 
          });
          return this.filterMembersByRole(members, roleName);
        }
      });
    }

    // 4. 전체 fetch 전략 (가장 느림, 가장 정확)
    strategies.push({
      name: 'full_fetch',
      timeout: this.TIMEOUTS.FULL_FETCH,
      execute: async () => {
        const members = await guild.members.fetch({ 
          limit: this.LIMITS.FULL_FETCH_LIMIT 
        });
        return this.filterMembersByRole(members, roleName);
      }
    });

    return strategies;
  }

  /**
   * 병렬 전략 실행
   */
  private async executeParallelStrategies(
    strategies: FetchStrategy[]
  ): Promise<Array<{ strategy: string; result?: Collection<string, GuildMember>; error?: Error }>> {
    const promises = strategies.map(async (strategy) => {
      try {
        console.log(`[ParallelFetch] ${strategy.name} 전략 시작 (${strategy.timeout}ms 타임아웃)`);
        
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`${strategy.name} 타임아웃`)), strategy.timeout);
        });

        const result = await Promise.race([
          strategy.execute(),
          timeoutPromise
        ]);

        console.log(`[ParallelFetch] ${strategy.name} 성공: ${result.size}명`);
        this.metrics.strategiesUsed.set(strategy.name, (this.metrics.strategiesUsed.get(strategy.name) || 0) + 1);
        
        return { strategy: strategy.name, result };
      } catch (error) {
        console.log(`[ParallelFetch] ${strategy.name} 실패:`, error instanceof Error ? error.message : String(error));
        return { strategy: strategy.name, error: error instanceof Error ? error : new Error(String(error)) };
      }
    });

    // 모든 전략을 병렬로 실행하되, 첫 번째 성공한 결과를 우선적으로 처리
    const results = await Promise.allSettled(promises);
    
    return results.map(result => 
      result.status === 'fulfilled' ? result.value : { strategy: 'unknown', error: new Error('전략 실행 실패') }
    );
  }

  /**
   * 최적 결과 선택
   */
  private selectBestResult(
    results: Array<{ strategy: string; result?: Collection<string, GuildMember>; error?: Error }>
  ): Collection<string, GuildMember> | null {
    // 우선순위: 결과가 있는 전략 중 가장 많은 멤버를 가진 것
    const successfulResults = results.filter(r => r.result && r.result.size > 0);
    
    if (successfulResults.length === 0) {
      return null;
    }

    // 가장 많은 멤버를 가진 결과 선택
    const bestResult = successfulResults.reduce((best, current) => {
      return (current.result!.size > best.result!.size) ? current : best;
    });

    console.log(`[OptimizedFetch] 최적 결과 선택: ${bestResult.strategy} (${bestResult.result!.size}명)`);
    return bestResult.result!;
  }

  /**
   * 역할별 멤버 필터링
   */
  private filterMembersByRole(
    members: Collection<string, GuildMember>, 
    roleName: string
  ): Collection<string, GuildMember> {
    return members.filter(member => 
      member.roles.cache.some(role => role.name === roleName)
    );
  }

  /**
   * 🔄 백그라운드 캐시 워밍업 시작
   */
  async startCacheWarming(guild: Guild, roleNames: string[]): Promise<void> {
    const guildId = guild.id;
    
    // 기존 워밍업 중단
    this.stopCacheWarming(guildId);
    
    console.log(`[CacheWarming] 백그라운드 캐시 워밍업 시작: ${guildId}`);
    
    // 즉시 한 번 실행
    await this.performCacheWarming(guild, roleNames);
    
    // 주기적 워밍업 설정 (4분마다)
    const interval = setInterval(async () => {
      try {
        await this.performCacheWarming(guild, roleNames);
      } catch (error) {
        console.warn(`[CacheWarming] 실패 (${guildId}):`, error);
      }
    }, 4 * 60 * 1000); // 4분
    
    this.cacheWarmupIntervals.set(guildId, interval);
  }

  /**
   * 캐시 워밍업 중단
   */
  stopCacheWarming(guildId: string): void {
    const interval = this.cacheWarmupIntervals.get(guildId);
    if (interval) {
      clearInterval(interval);
      this.cacheWarmupIntervals.delete(guildId);
      console.log(`[CacheWarming] 워밍업 중단: ${guildId}`);
    }
  }

  /**
   * 캐시 워밍업 실행
   */
  private async performCacheWarming(guild: Guild, roleNames: string[]): Promise<void> {
    const startTime = Date.now();
    console.log(`[CacheWarming] 워밍업 시작: ${guild.id}`);
    
    try {
      // 점진적 멤버 로딩 (청크 단위)
      const allMembers = await this.progressiveLoadMembers(guild);
      
      // 전체 멤버 캐시 업데이트
      await this.updateMemberCache(guild.id, undefined, allMembers);
      
      // 역할별 캐시 업데이트
      for (const roleName of roleNames) {
        const roleMembers = this.filterMembersByRole(allMembers, roleName);
        if (roleMembers.size > 0) {
          await this.updateMemberCache(guild.id, roleName, roleMembers);
        }
      }
      
      const duration = Date.now() - startTime;
      console.log(`[CacheWarming] 완료: ${allMembers.size}명, ${roleNames.length}개 역할 (${duration}ms)`);
      
    } catch (error) {
      console.error(`[CacheWarming] 실패:`, error);
    }
  }

  /**
   * 점진적 멤버 로딩
   */
  private async progressiveLoadMembers(guild: Guild): Promise<Collection<string, GuildMember>> {
    let allMembers = new Collection<string, GuildMember>();
    let lastMemberId: string | undefined;
    
    for (let chunk = 0; chunk < this.LIMITS.MAX_CHUNKS; chunk++) {
      try {
        const members = await guild.members.fetch({
          limit: this.LIMITS.CHUNK_SIZE,
          after: lastMemberId
        });
        
        if (members.size === 0) {
          break; // 더 이상 멤버가 없음
        }
        
        allMembers = allMembers.concat(members);
        lastMemberId = members.lastKey();
        
        console.log(`[ProgressiveLoad] 청크 ${chunk + 1}: ${members.size}명 (총 ${allMembers.size}명)`);
        
        // 레이트 리밋 방지를 위한 지연
        if (chunk < this.LIMITS.MAX_CHUNKS - 1) {
          await new Promise(resolve => setTimeout(resolve, this.TIMEOUTS.CHUNK_DELAY));
        }
        
      } catch (error) {
        console.warn(`[ProgressiveLoad] 청크 ${chunk} 실패:`, error);
        break;
      }
    }
    
    return allMembers;
  }

  /**
   * 📦 캐시된 역할 멤버 가져오기
   */
  private async getCachedRoleMembers(
    guildId: string, 
    roleName?: string
  ): Promise<Collection<string, GuildMember>> {
    try {
      const cacheKey = roleName 
        ? `role_members:${guildId}:${roleName}`
        : `all_members:${guildId}`;
      
      const cached = await this.redisService.get(cacheKey);
      if (!cached) {
        return new Collection();
      }
      
      const cacheData: CachedMemberData = JSON.parse(cached);
      const age = Date.now() - cacheData.timestamp;
      
      // 캐시가 너무 오래된 경우 (30분 초과)
      if (age > this.LIMITS.CACHE_TTL * 1000) {
        console.log(`[Cache] 만료된 캐시 무시: ${cacheKey} (${Math.round(age / 1000)}초 경과)`);
        return new Collection();
      }
      
      // 캐시 데이터를 Collection으로 복원
      const members = new Collection<string, GuildMember>(cacheData.data as [string, GuildMember][]);
      
      this.metrics.cacheHits++;
      console.log(`[Cache] 캐시 히트: ${cacheKey}, ${members.size}명 (${Math.round(age / 1000)}초 전)`);
      
      return members;
      
    } catch (error) {
      console.warn('[Cache] 캐시 읽기 실패:', error);
      return new Collection();
    }
  }

  /**
   * 멤버 캐시 업데이트
   */
  private async updateMemberCache(
    guildId: string, 
    roleName: string | undefined, 
    members: Collection<string, GuildMember>
  ): Promise<void> {
    try {
      const cacheKey = roleName 
        ? `role_members:${guildId}:${roleName}`
        : `all_members:${guildId}`;
      
      const cacheData: CachedMemberData = {
        data: Array.from(members.entries()),
        timestamp: Date.now(),
        count: members.size,
        guildId,
        roleName
      };
      
      const ttl = roleName ? this.LIMITS.ROLE_CACHE_TTL : this.LIMITS.CACHE_TTL;
      await this.redisService.setex(cacheKey, ttl, JSON.stringify(cacheData));
      
      console.log(`[Cache] 캐시 업데이트: ${cacheKey}, ${members.size}명 (TTL: ${ttl}초)`);
      
    } catch (error) {
      console.warn('[Cache] 캐시 저장 실패:', error);
    }
  }

  /**
   * 🔌 회로 차단기 관리
   */
  private isCircuitOpen(guildId: string): boolean {
    const breaker = this.circuitBreakers.get(guildId);
    if (!breaker) {
      return false;
    }
    
    if (breaker.state === 'open') {
      // 30초 후 half-open 상태로 전환
      if (Date.now() - breaker.lastFailure > 30000) {
        breaker.state = 'half-open';
        breaker.successCount = 0;
        console.log(`[CircuitBreaker] Half-open 상태로 전환: ${guildId}`);
      }
      return breaker.state === 'open';
    }
    
    return false;
  }

  private recordSuccess(guildId: string, responseTime: number): void {
    this.metrics.successfulFetches++;
    this.metrics.averageResponseTime = 
      (this.metrics.averageResponseTime * (this.metrics.successfulFetches - 1) + responseTime) / 
      this.metrics.successfulFetches;
    
    if (responseTime > 5000) {
      this.metrics.slowQueries++;
    }
    
    // 회로 차단기 성공 기록
    const breaker = this.circuitBreakers.get(guildId);
    if (breaker) {
      if (breaker.state === 'half-open') {
        breaker.successCount++;
        if (breaker.successCount >= 3) {
          breaker.state = 'closed';
          breaker.failures = 0;
          console.log(`[CircuitBreaker] Closed 상태로 복구: ${guildId}`);
        }
      } else if (breaker.state === 'closed') {
        breaker.failures = Math.max(0, breaker.failures - 1);
      }
    }
  }

  private recordFailure(guildId: string, error: any): void {
    if (error?.message?.includes('timeout')) {
      this.metrics.timeouts++;
    }
    
    // 회로 차단기 실패 기록
    let breaker = this.circuitBreakers.get(guildId);
    if (!breaker) {
      breaker = {
        state: 'closed',
        failures: 0,
        lastFailure: 0,
        successCount: 0,
        threshold: 3
      };
      this.circuitBreakers.set(guildId, breaker);
    }
    
    breaker.failures++;
    breaker.lastFailure = Date.now();
    
    if (breaker.failures >= breaker.threshold && breaker.state === 'closed') {
      breaker.state = 'open';
      console.log(`[CircuitBreaker] Open 상태로 전환: ${guildId} (실패 ${breaker.failures}회)`);
    }
  }

  /**
   * 📊 성능 메트릭 조회
   */
  getPerformanceMetrics(): FetchMetrics {
    return { ...this.metrics };
  }

  /**
   * 🔄 메트릭 초기화
   */
  resetMetrics(): void {
    this.metrics = this.initializeMetrics();
    console.log('[OptimizedFetch] 성능 메트릭 초기화됨');
  }

  /**
   * 🧹 정리 작업
   */
  dispose(): void {
    // 모든 캐시 워밍업 중단
    for (const [guildId] of this.cacheWarmupIntervals) {
      this.stopCacheWarming(guildId);
    }
    
    console.log('[OptimizedFetch] 정리 작업 완료');
  }

  private initializeMetrics(): FetchMetrics {
    return {
      totalRequests: 0,
      successfulFetches: 0,
      timeouts: 0,
      cacheHits: 0,
      averageResponseTime: 0,
      slowQueries: 0,
      strategiesUsed: new Map()
    };
  }
}