// src/services/RedisService.ts - Redis 서비스 구현체

import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';

import { logger } from '../config/logger-termux.js';
import { DI_TOKENS } from '../interfaces/index.js';
import type {
  IRedisService,
  RedisConfig,
  RateLimitResult,
  RedisHealthStatus,
  RedisCacheStats,
  RedisMessage,
} from '../interfaces/IRedisService.js';

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

  constructor(@inject(DI_TOKENS.RedisConfig) config: RedisConfig) {
    this.config = {
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 10000,
      commandTimeout: 5000,
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
      this.client = new Redis({
        host: this.config.host,
        port: this.config.port,
        ...(this.config.password && { password: this.config.password }),
        ...(this.config.db !== undefined && { db: this.config.db }),
        ...(this.config.username && { username: this.config.username }),
        ...(this.config.maxRetriesPerRequest !== undefined && { maxRetriesPerRequest: this.config.maxRetriesPerRequest }),
        ...(this.config.lazyConnect !== undefined && { lazyConnect: this.config.lazyConnect }),
        ...(this.config.enableOfflineQueue !== undefined && { enableOfflineQueue: this.config.enableOfflineQueue }),
        ...(this.config.connectTimeout !== undefined && { connectTimeout: this.config.connectTimeout }),
        ...(this.config.commandTimeout !== undefined && { commandTimeout: this.config.commandTimeout }),
        ...(this.config.family !== undefined && { family: this.config.family }),
        ...(this.config.keepAlive !== undefined && { keepAlive: this.config.keepAlive }),
        ...(this.config.keyPrefix && { keyPrefix: this.config.keyPrefix }),
      });

      // Pub/Sub용 별도 클라이언트 생성
      this.subscriberClient = new Redis({
        host: this.config.host,
        port: this.config.port,
        ...(this.config.password && { password: this.config.password }),
        ...(this.config.db !== undefined && { db: this.config.db }),
        ...(this.config.username && { username: this.config.username }),
        ...(this.config.lazyConnect !== undefined && { lazyConnect: this.config.lazyConnect }),
        ...(this.config.keyPrefix && { keyPrefix: this.config.keyPrefix }),
      });

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
        logger.error('Redis 최대 연결 시도 횟수 초과. 연결을 포기합니다.');
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
      if (!this.client) throw new Error('Redis client not initialized');
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
      if (!this.client) throw new Error('Redis client not initialized');
      
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
      if (!this.client) throw new Error('Redis client not initialized');
      return await this.client.del(key);
    });
  }

  async exists(key: string): Promise<boolean> {
    return this.executeWithMetrics('exists', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      const result = await this.client.exists(key);
      return result === 1;
    });
  }

  async expire(key: string, ttl: number): Promise<boolean> {
    return this.executeWithMetrics('expire', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      const result = await this.client.expire(key, ttl);
      return result === 1;
    });
  }

  async keys(pattern: string): Promise<string[]> {
    return this.executeWithMetrics('keys', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      const keys = await this.client.keys(pattern);
      
      // keyPrefix 제거
      if (this.config.keyPrefix) {
        return keys.map(key => key.replace(this.config.keyPrefix!, ''));
      }
      
      return keys;
    });
  }

  // ===========================================
  // 해시 조작
  // ===========================================

  async hset(key: string, field: string, value: string): Promise<boolean> {
    return this.executeWithMetrics('hset', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      const result = await this.client.hset(key, field, value);
      return result >= 0;
    });
  }

  async hmset(key: string, fieldValues: Record<string, string>): Promise<boolean> {
    return this.executeWithMetrics('hmset', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      const result = await this.client.hmset(key, fieldValues);
      return result === 'OK';
    });
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.executeWithMetrics('hget', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      return await this.client.hget(key, field);
    });
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.executeWithMetrics('hgetall', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      return await this.client.hgetall(key);
    });
  }

  async hdel(key: string, field: string): Promise<number> {
    return this.executeWithMetrics('hdel', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      return await this.client.hdel(key, field);
    });
  }

  async hexists(key: string, field: string): Promise<boolean> {
    return this.executeWithMetrics('hexists', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      const result = await this.client.hexists(key, field);
      return result === 1;
    });
  }

  // ===========================================
  // Pub/Sub
  // ===========================================

  async publish(channel: string, message: string): Promise<number> {
    return this.executeWithMetrics('publish', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      return await this.client.publish(channel, message);
    });
  }

  async subscribe(channel: string, callback: (message: RedisMessage) => void): Promise<void> {
    if (!this.subscriberClient) throw new Error('Redis subscriber client not initialized');
    
    this.subscribers.set(channel, callback);
    await this.subscriberClient.subscribe(channel);
    
    logger.debug(`Redis 채널 구독: ${channel}`);
  }

  async unsubscribe(channel: string): Promise<void> {
    if (!this.subscriberClient) throw new Error('Redis subscriber client not initialized');
    
    this.subscribers.delete(channel);
    await this.subscriberClient.unsubscribe(channel);
    
    logger.debug(`Redis 채널 구독 해제: ${channel}`);
  }

  async psubscribe(pattern: string, callback: (message: RedisMessage) => void): Promise<void> {
    if (!this.subscriberClient) throw new Error('Redis subscriber client not initialized');
    
    this.patternSubscribers.set(pattern, callback);
    await this.subscriberClient.psubscribe(pattern);
    
    logger.debug(`Redis 패턴 구독: ${pattern}`);
  }

  // ===========================================
  // Rate Limiting
  // ===========================================

  async rateLimit(key: string, limit: number, window: number): Promise<RateLimitResult> {
    return this.executeWithMetrics('rateLimit', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      
      const now = Date.now();
      const windowStart = Math.floor(now / (window * 1000)) * (window * 1000);
      const rateLimitKey = `${key}:${windowStart}`;
      
      const pipeline = this.client.pipeline();
      pipeline.incr(rateLimitKey);
      pipeline.expire(rateLimitKey, window);
      
      const results = await pipeline.exec();
      const currentCount = results?.[0]?.[1] as number || 0;
      
      const allowed = currentCount <= limit;
      const remaining = Math.max(0, limit - currentCount);
      const resetTime = windowStart + (window * 1000);
      
      return {
        allowed,
        remaining,
        resetTime,
        totalHits: currentCount,
      };
    });
  }

  async slidingWindowRateLimit(key: string, limit: number, window: number): Promise<RateLimitResult> {
    return this.executeWithMetrics('slidingWindowRateLimit', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      
      const now = Date.now();
      const windowStart = now - (window * 1000);
      
      const pipeline = this.client.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zadd(key, now, `${now}-${Math.random()}`);
      pipeline.zcard(key);
      pipeline.expire(key, window);
      
      const results = await pipeline.exec();
      const currentCount = results?.[2]?.[1] as number || 0;
      
      const allowed = currentCount <= limit;
      const remaining = Math.max(0, limit - currentCount);
      const resetTime = now + (window * 1000);
      
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
      if (!this.client) throw new Error('Redis client not initialized');
      return await this.client.lpush(key, value);
    });
  }

  async rpop(key: string): Promise<string | null> {
    return this.executeWithMetrics('rpop', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      return await this.client.rpop(key);
    });
  }

  async llen(key: string): Promise<number> {
    return this.executeWithMetrics('llen', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      return await this.client.llen(key);
    });
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.executeWithMetrics('lrange', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      return await this.client.lrange(key, start, stop);
    });
  }

  // ===========================================
  // 집합 조작
  // ===========================================

  async sadd(key: string, member: string): Promise<number> {
    return this.executeWithMetrics('sadd', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      return await this.client.sadd(key, member);
    });
  }

  async srem(key: string, member: string): Promise<number> {
    return this.executeWithMetrics('srem', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      return await this.client.srem(key, member);
    });
  }

  async sismember(key: string, member: string): Promise<boolean> {
    return this.executeWithMetrics('sismember', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      const result = await this.client.sismember(key, member);
      return result === 1;
    });
  }

  async smembers(key: string): Promise<string[]> {
    return this.executeWithMetrics('smembers', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      return await this.client.smembers(key);
    });
  }

  // ===========================================
  // 트랜잭션 및 배치 처리
  // ===========================================

  multi(): any {
    if (!this.client) throw new Error('Redis client not initialized');
    return this.client.multi();
  }

  async exec(multi: any): Promise<any[]> {
    return this.executeWithMetrics('multi_exec', async () => {
      const results = await multi.exec();
      return results || [];
    });
  }

  async pipeline(commands: Array<{cmd: string, args: any[]}>): Promise<any[]> {
    return this.executeWithMetrics('pipeline', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      
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
    const averageLatency = this.stats.operations > 0 ? this.stats.totalLatency / this.stats.operations : 0;

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
    if (!this.client) throw new Error('Redis client not initialized');
    return section ? await this.client.info(section) : await this.client.info();
  }

  // ===========================================
  // 유틸리티
  // ===========================================

  async flushall(): Promise<number> {
    return this.executeWithMetrics('flushall', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
      await this.client.flushall();
      return 1;
    });
  }

  async flushdb(): Promise<number> {
    return this.executeWithMetrics('flushdb', async () => {
      if (!this.client) throw new Error('Redis client not initialized');
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
    return new Promise(resolve => setTimeout(resolve, ms));
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
    
    this.isInitialized = false;
    this.subscribers.clear();
    this.patternSubscribers.clear();
  }
}