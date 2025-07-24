// src/services/RedisService.ts - Redis 서비스 구현체

import Redis from 'ioredis';
import { injectable, inject } from 'tsyringe';

import { logger } from '../config/logger-termux';
import { DI_TOKENS } from '../interfaces/index';
import type {
  IRedisService,
  RedisConfig,
  RateLimitResult,
  RedisHealthStatus,
  RedisCacheStats,
  RedisMessage,
} from '../interfaces/IRedisService';

/**
 * Redis 서비스 구현체
 * ioredis 라이브러리를 사용한 고성능 Redis 클라이언트
 */
@injectable()
export class RedisService implements IRedisService {
  private client: Redis | null = null;
  private subscriberClient: Redis | null = null;
  private readonly config: RedisConfig;
  private isInitialized = false;
  private connectionAttempts = 0;
  private readonly maxConnectionAttempts = 5;

  // 성능 모니터링
  private stats = {
    operations: 0,
    totalLatency: 0,
    errors: 0,
    cacheHits: 0,
    cacheMisses: 0,
    lastOperation: Date.now(),
  };

  // Pub/Sub 구독자 관리
  private subscribers: Map<string, (message: RedisMessage) => void> = new Map();
  private patternSubscribers: Map<string, (message: RedisMessage) => void> = new Map();

  // Fallback 메모리 캐시 (Redis 서버 없을 때 사용)
  private fallbackCache: Map<string, { value: any; expiry?: number }> = new Map();
  private fallbackCacheCleanupTimer: NodeJS.Timeout | null = null;

  constructor(@inject(DI_TOKENS.RedisConfig) config: RedisConfig) {
    this.config = {
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 5,
      lazyConnect: true,
      enableOfflineQueue: true,
      connectTimeout: 15000,
      commandTimeout: 8000,
      family: 4,
      keepAlive: 30000,
      keyPrefix: 'discord_bot:',
      ...config,
    };

    logger.info('RedisService 초기화', {
      host: this.config.host,
      port: this.config.port,
      db: this.config.db || 0,
    });

    // Fallback 캐시 cleanup 타이머 설정 (5분마다 만료된 항목 정리)
    this.fallbackCacheCleanupTimer = setInterval(
      () => {
        this.cleanupFallbackCache();
      },
      5 * 60 * 1000
    );
  }

  // ===========================================
  // 연결 관리
  // ===========================================

  async connect(): Promise<boolean> {
    if (this.isInitialized && this.client && this.client.status === 'ready') {
      logger.debug('Redis가 이미 연결되어 있습니다.');
      return true;
    }

    try {
      this.connectionAttempts++;
      logger.info(`Redis 연결 시도 ${this.connectionAttempts}/${this.maxConnectionAttempts}`, {
        host: this.config.host,
        port: this.config.port,
      });

      // 메인 클라이언트 생성 (ioredis 호환 옵션만 사용)
      const redisConfig: any = {
        host: this.config.host,
        port: this.config.port,
        family: this.config.family,
        keepAlive: this.config.keepAlive,
        ...(this.config.maxRetriesPerRequest !== undefined && {
          maxRetriesPerRequest: this.config.maxRetriesPerRequest,
        }),
        ...(this.config.lazyConnect !== undefined && { lazyConnect: this.config.lazyConnect }),
        ...(this.config.enableOfflineQueue !== undefined && {
          enableOfflineQueue: this.config.enableOfflineQueue,
        }),
        ...(this.config.connectTimeout !== undefined && {
          connectTimeout: this.config.connectTimeout,
        }),
        ...(this.config.commandTimeout !== undefined && {
          commandTimeout: this.config.commandTimeout,
        }),
        ...(this.config.password && { password: this.config.password }),
        ...(this.config.db !== undefined && { db: this.config.db }),
        ...(this.config.username && { username: this.config.username }),
        ...(this.config.keyPrefix && { keyPrefix: this.config.keyPrefix }),
      };

      logger.info('Redis 클라이언트 생성 설정:', {
        enableOfflineQueue: redisConfig.enableOfflineQueue,
        connectTimeout: redisConfig.connectTimeout,
        commandTimeout: redisConfig.commandTimeout,
        maxRetriesPerRequest: redisConfig.maxRetriesPerRequest,
      });

      this.client = new Redis(redisConfig);

      // Pub/Sub용 별도 클라이언트 생성
      const subscriberConfig: any = {
        ...redisConfig,
      };
      // keyPrefix 제거 (Pub/Sub용)
      delete subscriberConfig.keyPrefix;

      this.subscriberClient = new Redis(subscriberConfig);

      // 이벤트 핸들러 설정
      this.setupEventHandlers();

      // 연결 테스트
      await this.client.ping();
      await this.subscriberClient.ping();

      this.isInitialized = true;
      this.connectionAttempts = 0;

      logger.info('✅ Redis 연결 성공', {
        host: this.config.host,
        port: this.config.port,
        serverVersion: await this.getServerVersion(),
      });

      return true;
    } catch (error) {
      logger.error('❌ Redis 연결 실패', {
        error: error instanceof Error ? error.message : String(error),
        attempt: this.connectionAttempts,
        maxAttempts: this.maxConnectionAttempts,
      });

      if (this.connectionAttempts >= this.maxConnectionAttempts) {
        logger.warn('Redis 최대 연결 시도 횟수 초과. fallback 캐시 모드로 전환합니다.');
        logger.info('💡 Redis 서버를 시작하려면: redis-server 명령어를 실행하세요.');
        this.cleanup();
        return false;
      }

      // 재연결 시도
      await this.delay(1000 * this.connectionAttempts);
      return this.connect();
    }
  }

  async disconnect(): Promise<void> {
    logger.info('Redis 연결 종료 중...');

    try {
      if (this.subscriberClient) {
        await this.subscriberClient.quit();
        this.subscriberClient = null;
      }

      if (this.client) {
        await this.client.quit();
        this.client = null;
      }

      this.isInitialized = false;
      this.subscribers.clear();
      this.patternSubscribers.clear();

      logger.info('✅ Redis 연결 종료 완료');
    } catch (error) {
      logger.error('Redis 연결 종료 중 오류', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async healthCheck(): Promise<RedisHealthStatus> {
    const startTime = Date.now();

    try {
      if (!this.client || this.client.status !== 'ready') {
        return {
          status: 'unhealthy',
          latency: -1,
          lastError: 'Redis client not connected',
        };
      }

      await this.client.ping();
      const latency = Date.now() - startTime;

      const info = await this.client.info('memory');
      const memoryMatch = info.match(/used_memory:(\d+)/);
      const memoryUsage = memoryMatch ? parseInt(memoryMatch[1]) : 0;

      const clientsMatch = info.match(/connected_clients:(\d+)/);
      const connectedClients = clientsMatch ? parseInt(clientsMatch[1]) : 0;

      const uptimeMatch = info.match(/uptime_in_seconds:(\d+)/);
      const uptime = uptimeMatch ? parseInt(uptimeMatch[1]) : 0;

      return {
        status: latency < 100 ? 'healthy' : latency < 500 ? 'degraded' : 'unhealthy',
        latency,
        memoryUsage,
        connectedClients,
        uptime,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        latency: Date.now() - startTime,
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  isConnected(): boolean {
    return this.isInitialized && this.client?.status === 'ready';
  }

  // ===========================================
  // 기본 키-값 조작
  // ===========================================

  async get(key: string): Promise<string | null> {
    return this.executeWithMetrics('get', async () => {
      if (!this.client) {
        // Fallback 캐시 사용
        const result = this.getFallbackCache(key);
        if (result !== null) {
          this.stats.cacheHits++;
        } else {
          this.stats.cacheMisses++;
        }
        return result;
      }

      const result = await this.client.get(key);

      if (result !== null) {
        this.stats.cacheHits++;
      } else {
        this.stats.cacheMisses++;
      }

      return result;
    });
  }

  async set(key: string, value: string, ttl?: number): Promise<boolean> {
    return this.executeWithMetrics('set', async () => {
      if (!this.client) {
        // Fallback 캐시 사용
        this.setFallbackCache(key, value, ttl);
        return true;
      }

      let result: string;
      if (ttl) {
        result = await this.client.setex(key, ttl, value);
      } else {
        result = await this.client.set(key, value);
      }

      return result === 'OK';
    });
  }

  async del(key: string): Promise<number> {
    return this.executeWithMetrics('del', async () => {
      if (!this.client) {
        // Fallback 캐시 사용
        const existed = this.getFallbackCache(key) !== null;
        this.deleteFallbackCache(key);
        return existed ? 1 : 0;
      }

      return await this.client.del(key);
    });
  }

  async exists(key: string): Promise<boolean> {
    return this.executeWithMetrics('exists', async () => {
      if (!this.client) {
        // Fallback 캐시 사용
        return this.getFallbackCache(key) !== null;
      }

      const result = await this.client.exists(key);
      return result === 1;
    });
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    return this.executeWithMetrics('expire', async () => {
      if (!this.client) {
        // Fallback: Update existing fallback cache item's expiry
        const item = this.fallbackCache.get(key);
        if (item) {
          item.expiry = Date.now() + ttl * 1000;
          return true;
        }
        return false;
      }
      const result = await this.client.expire(key, ttl);
      return result === 1;
    });
  }

  async keys(pattern: string): Promise<string[]> {
    return this.executeWithMetrics('keys', async () => {
      if (!this.client) {
        // Fallback: Simple pattern matching on fallback cache keys
        const allKeys = Array.from(this.fallbackCache.keys());
        if (pattern === '*') {
          return allKeys;
        }
        // Simple glob pattern matching (basic implementation)
        const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
        return allKeys.filter((key) => regex.test(key));
      }

      const keys = await this.client.keys(pattern);

      // keyPrefix 제거
      if (this.config.keyPrefix) {
        return keys.map((key) => key.replace(this.config.keyPrefix!, ''));
      }

      return keys;
    });
  }

  // ===========================================
  // 해시 조작
  // ===========================================

  async hset(key: string, field: string, value: string): Promise<boolean> {
    return this.executeWithMetrics('hset', async () => {
      if (!this.client) {
        // Fallback: Store as nested object in fallback cache
        const existing = this.getFallbackCache(key) || {};
        existing[field] = value;
        this.setFallbackCache(key, existing);
        return true;
      }
      const result = await this.client.hset(key, field, value);
      return result >= 0;
    });
  }

  async hmset(key: string, fieldValues: Record<string, string>): Promise<boolean> {
    return this.executeWithMetrics('hmset', async () => {
      if (!this.client) {
        // Fallback: Store as object in fallback cache
        const existing = this.getFallbackCache(key) || {};
        Object.assign(existing, fieldValues);
        this.setFallbackCache(key, existing);
        return true;
      }
      const result = await this.client.hmset(key, fieldValues);
      return result === 'OK';
    });
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.executeWithMetrics('hget', async () => {
      if (!this.client) {
        // Fallback: Get field from object in fallback cache
        const obj = this.getFallbackCache(key);
        if (obj && typeof obj === 'object' && obj[field] !== undefined) {
          return obj[field];
        }
        return null;
      }
      return await this.client.hget(key, field);
    });
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.executeWithMetrics('hgetall', async () => {
      if (!this.client) {
        // Fallback: Get entire object from fallback cache
        const obj = this.getFallbackCache(key);
        return obj && typeof obj === 'object' ? obj : {};
      }
      return await this.client.hgetall(key);
    });
  }

  async hdel(key: string, field: string): Promise<number> {
    return this.executeWithMetrics('hdel', async () => {
      if (!this.client) {
        // Fallback: Delete field from object in fallback cache
        const obj = this.getFallbackCache(key);
        if (obj && typeof obj === 'object' && obj[field] !== undefined) {
          delete obj[field];
          this.setFallbackCache(key, obj);
          return 1;
        }
        return 0;
      }
      return await this.client.hdel(key, field);
    });
  }

  async hexists(key: string, field: string): Promise<boolean> {
    return this.executeWithMetrics('hexists', async () => {
      if (!this.client) {
        // Fallback: Check if field exists in object in fallback cache
        const obj = this.getFallbackCache(key);
        return obj && typeof obj === 'object' && obj[field] !== undefined;
      }
      const result = await this.client.hexists(key, field);
      return result === 1;
    });
  }

  // ===========================================
  // Pub/Sub
  // ===========================================

  async publish(channel: string, message: string): Promise<number> {
    return this.executeWithMetrics('publish', async () => {
      if (!this.client) {
        // Fallback: Pub/Sub is not supported in fallback mode
        logger.warn('Pub/Sub publish operation skipped - Redis not connected', {
          channel,
          messageLength: message.length,
        });
        return 0;
      }
      return await this.client.publish(channel, message);
    });
  }

  async subscribe(channel: string, callback: (message: RedisMessage) => void): Promise<void> {
    if (!this.subscriberClient) {
      logger.warn('Pub/Sub subscribe operation skipped - Redis not connected', {
        channel,
      });
      return;
    }

    this.subscribers.set(channel, callback);
    await this.subscriberClient.subscribe(channel);

    logger.debug(`Redis 채널 구독: ${channel}`);
  }

  async unsubscribe(channel: string): Promise<void> {
    if (!this.subscriberClient) {
      logger.warn('Pub/Sub unsubscribe operation skipped - Redis not connected', {
        channel,
      });
      return;
    }

    this.subscribers.delete(channel);
    await this.subscriberClient.unsubscribe(channel);

    logger.debug(`Redis 채널 구독 해제: ${channel}`);
  }

  async psubscribe(pattern: string, callback: (message: RedisMessage) => void): Promise<void> {
    if (!this.subscriberClient) {
      logger.warn('Pub/Sub pattern subscribe operation skipped - Redis not connected', {
        pattern,
      });
      return;
    }

    this.patternSubscribers.set(pattern, callback);
    await this.subscriberClient.psubscribe(pattern);

    logger.debug(`Redis 패턴 구독: ${pattern}`);
  }

  // ===========================================
  // Rate Limiting
  // ===========================================

  async rateLimit(key: string, limit: number, window: number): Promise<RateLimitResult> {
    return this.executeWithMetrics('rateLimit', async () => {
      if (!this.client) {
        // Fallback: Simple rate limiting with fallback cache
        const now = Date.now();
        const windowStart = Math.floor(now / (window * 1000)) * (window * 1000);
        const rateLimitKey = `${key}:${windowStart}`;

        const currentCount = (this.getFallbackCache(rateLimitKey) || 0) + 1;
        this.setFallbackCache(rateLimitKey, currentCount, window);

        const allowed = currentCount <= limit;
        const remaining = Math.max(0, limit - currentCount);
        const resetTime = windowStart + window * 1000;

        return {
          allowed,
          remaining,
          resetTime,
          totalHits: currentCount,
        };
      }

      const now = Date.now();
      const windowStart = Math.floor(now / (window * 1000)) * (window * 1000);
      const rateLimitKey = `${key}:${windowStart}`;

      const pipeline = this.client.pipeline();
      pipeline.incr(rateLimitKey);
      pipeline.expire(rateLimitKey, window);

      const results = await pipeline.exec();
      const currentCount = (results?.[0]?.[1] as number) || 0;

      const allowed = currentCount <= limit;
      const remaining = Math.max(0, limit - currentCount);
      const resetTime = windowStart + window * 1000;

      return {
        allowed,
        remaining,
        resetTime,
        totalHits: currentCount,
      };
    });
  }

  async slidingWindowRateLimit(
    key: string,
    limit: number,
    window: number
  ): Promise<RateLimitResult> {
    return this.executeWithMetrics('slidingWindowRateLimit', async () => {
      if (!this.client) {
        // Fallback: Simplified sliding window using fallback cache
        const now = Date.now();
        const windowStart = now - window * 1000;

        // Get existing timestamps
        const timestamps = (this.getFallbackCache(key) || []) as number[];

        // Remove old timestamps
        const validTimestamps = timestamps.filter((ts) => ts > windowStart);

        // Add current timestamp
        validTimestamps.push(now);

        // Store updated timestamps
        this.setFallbackCache(key, validTimestamps, window);

        const currentCount = validTimestamps.length;
        const allowed = currentCount <= limit;
        const remaining = Math.max(0, limit - currentCount);
        const resetTime = now + window * 1000;

        return {
          allowed,
          remaining,
          resetTime,
          totalHits: currentCount,
        };
      }

      const now = Date.now();
      const windowStart = now - window * 1000;

      const pipeline = this.client.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zadd(key, now, `${now}-${Math.random()}`);
      pipeline.zcard(key);
      pipeline.expire(key, window);

      const results = await pipeline.exec();
      const currentCount = (results?.[2]?.[1] as number) || 0;

      const allowed = currentCount <= limit;
      const remaining = Math.max(0, limit - currentCount);
      const resetTime = now + window * 1000;

      return {
        allowed,
        remaining,
        resetTime,
        totalHits: currentCount,
      };
    });
  }

  // ===========================================
  // 리스트 조작
  // ===========================================

  async lpush(key: string, value: string): Promise<number> {
    return this.executeWithMetrics('lpush', async () => {
      if (!this.client) {
        // Fallback: Use array in fallback cache
        const list = (this.getFallbackCache(key) || []) as string[];
        list.unshift(value);
        this.setFallbackCache(key, list);
        return list.length;
      }
      return await this.client.lpush(key, value);
    });
  }

  async rpop(key: string): Promise<string | null> {
    return this.executeWithMetrics('rpop', async () => {
      if (!this.client) {
        // Fallback: Use array in fallback cache
        const list = (this.getFallbackCache(key) || []) as string[];
        if (list.length === 0) return null;
        const value = list.pop();
        this.setFallbackCache(key, list);
        return value || null;
      }
      return await this.client.rpop(key);
    });
  }

  async llen(key: string): Promise<number> {
    return this.executeWithMetrics('llen', async () => {
      if (!this.client) {
        // Fallback: Use array in fallback cache
        const list = (this.getFallbackCache(key) || []) as string[];
        return list.length;
      }
      return await this.client.llen(key);
    });
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.executeWithMetrics('lrange', async () => {
      if (!this.client) {
        // Fallback: Use array in fallback cache
        const list = (this.getFallbackCache(key) || []) as string[];
        return list.slice(start, stop + 1);
      }
      return await this.client.lrange(key, start, stop);
    });
  }

  // ===========================================
  // 집합 조작
  // ===========================================

  async sadd(key: string, member: string): Promise<number> {
    return this.executeWithMetrics('sadd', async () => {
      if (!this.client) {
        // Fallback: Use Set in fallback cache
        const set = new Set(this.getFallbackCache(key) || []);
        const sizeBefore = set.size;
        set.add(member);
        this.setFallbackCache(key, Array.from(set));
        return set.size - sizeBefore;
      }
      return await this.client.sadd(key, member);
    });
  }

  async srem(key: string, member: string): Promise<number> {
    return this.executeWithMetrics('srem', async () => {
      if (!this.client) {
        // Fallback: Use Set in fallback cache
        const set = new Set(this.getFallbackCache(key) || []);
        const removed = set.delete(member);
        this.setFallbackCache(key, Array.from(set));
        return removed ? 1 : 0;
      }
      return await this.client.srem(key, member);
    });
  }

  async sismember(key: string, member: string): Promise<boolean> {
    return this.executeWithMetrics('sismember', async () => {
      if (!this.client) {
        // Fallback: Use Set in fallback cache
        const set = new Set(this.getFallbackCache(key) || []);
        return set.has(member);
      }
      const result = await this.client.sismember(key, member);
      return result === 1;
    });
  }

  async smembers(key: string): Promise<string[]> {
    return this.executeWithMetrics('smembers', async () => {
      if (!this.client) {
        // Fallback: Use Set in fallback cache
        const members = this.getFallbackCache(key) || [];
        return Array.from(new Set(members));
      }
      return await this.client.smembers(key);
    });
  }

  // ===========================================
  // 트랜잭션 및 배치 처리
  // ===========================================

  multi(): any {
    if (!this.client) {
      // Fallback: Return a mock multi object that queues operations
      logger.warn('Multi/transaction operations not supported in fallback mode');
      return {
        exec: async () => [],
        get: () => this,
        set: () => this,
        del: () => this,
        hset: () => this,
        hget: () => this,
        sadd: () => this,
        srem: () => this,
        lpush: () => this,
        rpop: () => this,
      };
    }
    return this.client.multi();
  }

  async exec(multi: any): Promise<any[]> {
    return this.executeWithMetrics('multi_exec', async () => {
      if (!this.client) {
        // Fallback: Return empty results for mock multi
        return [];
      }
      const results = await multi.exec();
      return results || [];
    });
  }

  async pipeline(commands: Array<{ cmd: string; args: any[] }>): Promise<any[]> {
    return this.executeWithMetrics('pipeline', async () => {
      if (!this.client) {
        // Fallback: Execute commands sequentially
        logger.warn(
          'Pipeline operations not fully supported in fallback mode - executing sequentially'
        );
        const results = [];
        for (const command of commands) {
          try {
            const result = await (this as any)[command.cmd](...command.args);
            results.push([null, result]);
          } catch (error) {
            results.push([error, null]);
          }
        }
        return results;
      }

      const pipeline = this.client.pipeline();
      for (const command of commands) {
        (pipeline as any)[command.cmd](...command.args);
      }

      const results = await pipeline.exec();
      return results || [];
    });
  }

  // ===========================================
  // 통계 및 모니터링
  // ===========================================

  async getCacheStats(): Promise<RedisCacheStats> {
    const totalOperations = this.stats.cacheHits + this.stats.cacheMisses;
    const hitRate = totalOperations > 0 ? this.stats.cacheHits / totalOperations : 0;
    const missRate = totalOperations > 0 ? this.stats.cacheMisses / totalOperations : 0;
    const averageLatency =
      this.stats.operations > 0 ? this.stats.totalLatency / this.stats.operations : 0;

    const memoryUsage = await this.getMemoryUsage();
    const totalKeys = await this.getTotalKeys();

    return {
      hitRate,
      missRate,
      totalKeys,
      memoryUsage,
      operationsPerSecond: this.calculateOPS(),
      averageLatency,
    };
  }

  async getMemoryUsage(): Promise<number> {
    try {
      if (!this.client) return 0;
      const info = await this.client.info('memory');
      const match = info.match(/used_memory:(\d+)/);
      return match ? parseInt(match[1]) : 0;
    } catch {
      return 0;
    }
  }

  async info(section?: string): Promise<string> {
    if (!this.client) {
      // Fallback: Return mock info
      return `# Fallback mode\r\nfallback_mode:1\r\nfallback_cache_size:${this.fallbackCache.size}\r\n`;
    }
    return section ? await this.client.info(section) : await this.client.info();
  }

  // ===========================================
  // 유틸리티
  // ===========================================

  async flushall(): Promise<number> {
    return this.executeWithMetrics('flushall', async () => {
      if (!this.client) {
        // Fallback: Clear fallback cache
        this.fallbackCache.clear();
        return 1;
      }
      await this.client.flushall();
      return 1;
    });
  }

  async flushdb(): Promise<number> {
    return this.executeWithMetrics('flushdb', async () => {
      if (!this.client) {
        // Fallback: Clear fallback cache
        this.fallbackCache.clear();
        return 1;
      }
      await this.client.flushdb();
      return 1;
    });
  }

  async setJSON(key: string, value: any, ttl?: number): Promise<boolean> {
    try {
      const serialized = JSON.stringify(value);
      return await this.set(key, serialized, ttl);
    } catch (error) {
      logger.error('JSON 직렬화 실패', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async getJSON<T = any>(key: string): Promise<T | null> {
    try {
      const serialized = await this.get(key);
      if (serialized === null) return null;
      return JSON.parse(serialized) as T;
    } catch (error) {
      logger.error('JSON 역직렬화 실패', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  // ===========================================
  // 내부 헬퍼 메서드
  // ===========================================

  private setupEventHandlers(): void {
    if (!this.client || !this.subscriberClient) return;

    // 메인 클라이언트 이벤트
    this.client.on('connect', () => {
      logger.info('Redis 메인 클라이언트 연결됨');
    });

    this.client.on('error', (error) => {
      logger.error('Redis 메인 클라이언트 오류', {
        error: error.message,
      });
      this.stats.errors++;
    });

    this.client.on('reconnecting', () => {
      logger.info('Redis 메인 클라이언트 재연결 중...');
    });

    // 구독 클라이언트 이벤트
    this.subscriberClient.on('message', (channel, message) => {
      const callback = this.subscribers.get(channel);
      if (callback) {
        callback({
          channel,
          message,
          timestamp: Date.now(),
        });
      }
    });

    this.subscriberClient.on('pmessage', (pattern, channel, message) => {
      const callback = this.patternSubscribers.get(pattern);
      if (callback) {
        callback({
          channel,
          message,
          timestamp: Date.now(),
        });
      }
    });

    this.subscriberClient.on('error', (error) => {
      logger.error('Redis 구독 클라이언트 오류', {
        error: error.message,
      });
    });
  }

  private async executeWithMetrics<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await fn();
      const latency = Date.now() - startTime;

      this.stats.operations++;
      this.stats.totalLatency += latency;
      this.stats.lastOperation = Date.now();

      if (latency > 100) {
        logger.warn(`Redis 느린 쿼리 감지`, {
          operation,
          latency: `${latency}ms`,
        });
      }

      return result;
    } catch (error) {
      this.stats.errors++;
      logger.error(`Redis ${operation} 실패`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async getServerVersion(): Promise<string> {
    try {
      if (!this.client) return 'unknown';
      const info = await this.client.info('server');
      const match = info.match(/redis_version:(.+)/);
      return match ? match[1].trim() : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private async getTotalKeys(): Promise<number> {
    try {
      if (!this.client) return 0;
      const info = await this.client.info('keyspace');
      const match = info.match(/keys=(\d+)/);
      return match ? parseInt(match[1]) : 0;
    } catch {
      return 0;
    }
  }

  private calculateOPS(): number {
    const timeDiff = (Date.now() - this.stats.lastOperation) / 1000;
    return timeDiff > 0 ? this.stats.operations / timeDiff : 0;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private cleanup(): void {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }

    if (this.subscriberClient) {
      this.subscriberClient.disconnect();
      this.subscriberClient = null;
    }

    if (this.fallbackCacheCleanupTimer) {
      clearInterval(this.fallbackCacheCleanupTimer);
      this.fallbackCacheCleanupTimer = null;
    }

    this.isInitialized = false;
    this.subscribers.clear();
    this.patternSubscribers.clear();
  }

  // ===========================================
  // Fallback 캐시 관련 메서드
  // ===========================================

  private cleanupFallbackCache(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, item] of this.fallbackCache.entries()) {
      if (item.expiry && item.expiry < now) {
        this.fallbackCache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`Fallback 캐시 정리 완료: ${cleanedCount}개 항목 삭제`);
    }
  }

  private setFallbackCache(key: string, value: any, ttlSeconds?: number): void {
    const item: { value: any; expiry?: number } = { value };
    if (ttlSeconds) {
      item.expiry = Date.now() + ttlSeconds * 1000;
    }
    this.fallbackCache.set(key, item);
  }

  private getFallbackCache(key: string): any | null {
    const item = this.fallbackCache.get(key);
    if (!item) return null;

    if (item.expiry && item.expiry < Date.now()) {
      this.fallbackCache.delete(key);
      return null;
    }

    return item.value;
  }

  private deleteFallbackCache(key: string): void {
    this.fallbackCache.delete(key);
  }
}
