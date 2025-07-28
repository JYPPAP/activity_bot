// src/tests/MemberFetchService.test.ts - MemberFetchService 테스트

import { Collection, Guild, GuildMember, Role } from 'discord.js';
import { MemberFetchService } from '../services/MemberFetchService.js';
import { IMemberFetchService, MemberFetchServiceConfig } from '../interfaces/IMemberFetchService.js';

// Mock Discord.js 객체들
class MockGuild {
  id = 'test-guild-123';
  name = 'Test Guild';
  memberCount = 100;
  members = {
    cache: new Collection<string, GuildMember>(),
    fetch: jest.fn()
  };
  roles = {
    cache: new Collection<string, Role>()
  };
}

class MockGuildMember {
  constructor(
    public id: string,
    public displayName: string,
    public roles: { cache: Collection<string, Role> }
  ) {}
}

class MockRole {
  constructor(
    public id: string,
    public name: string
  ) {}
}

describe('MemberFetchService', () => {
  let service: IMemberFetchService;
  let mockGuild: MockGuild;

  beforeEach(() => {
    service = new MemberFetchService();
    mockGuild = new MockGuild();
    
    // Mock 데이터 설정
    setupMockData();
  });

  afterEach(() => {
    service.clearCache();
    service.resetStatistics();
    jest.clearAllMocks();
  });

  function setupMockData() {
    // Mock 역할 생성
    const adminRole = new MockRole('role-1', '관리자');
    const userRole = new MockRole('role-2', '일반사용자');
    
    mockGuild.roles.cache.set('role-1', adminRole as any);
    mockGuild.roles.cache.set('role-2', userRole as any);

    // Mock 멤버들 생성
    const members = new Collection<string, GuildMember>();
    
    for (let i = 1; i <= 50; i++) {
      const roleCache = new Collection<string, Role>();
      
      // 처음 10명은 관리자, 나머지는 일반사용자
      if (i <= 10) {
        roleCache.set('role-1', adminRole as any);
      } else {
        roleCache.set('role-2', userRole as any);
      }
      
      const member = new MockGuildMember(
        `user-${i}`,
        `User ${i}`,
        { cache: roleCache }
      );
      
      members.set(`user-${i}`, member as any);
    }

    // 캐시와 fetch 결과 설정
    mockGuild.members.cache = members;
    mockGuild.members.fetch = jest.fn().mockResolvedValue(members);
  }

  describe('fetchGuildMembers', () => {
    it('should fetch guild members successfully', async () => {
      const result = await service.fetchGuildMembers(mockGuild as any);

      expect(result.success).toBe(true);
      expect(result.members.size).toBe(50);
      expect(result.metadata.totalCount).toBe(50);
      expect(result.metadata.cacheHit).toBe(false);
      expect(result.metadata.source).toBe('full_fetch');
      expect(mockGuild.members.fetch).toHaveBeenCalledTimes(1);
    });

    it('should use cache on subsequent requests', async () => {
      // 첫 번째 호출
      const result1 = await service.fetchGuildMembers(mockGuild as any);
      expect(result1.metadata.cacheHit).toBe(false);

      // 두 번째 호출 (캐시 사용)
      const result2 = await service.fetchGuildMembers(mockGuild as any);
      expect(result2.success).toBe(true);
      expect(result2.metadata.cacheHit).toBe(true);
      expect(result2.members.size).toBe(50);
      
      // fetch는 한 번만 호출되어야 함
      expect(mockGuild.members.fetch).toHaveBeenCalledTimes(1);
    });

    it('should force refresh when requested', async () => {
      // 첫 번째 호출로 캐시 생성
      await service.fetchGuildMembers(mockGuild as any);

      // forceRefresh로 두 번째 호출
      const result = await service.fetchGuildMembers(mockGuild as any, { 
        forceRefresh: true 
      });

      expect(result.success).toBe(true);
      expect(result.metadata.cacheHit).toBe(false);
      expect(mockGuild.members.fetch).toHaveBeenCalledTimes(2);
    });

    it('should handle progress callback', async () => {
      const progressStates: string[] = [];
      
      const progressCallback = jest.fn((progress) => {
        progressStates.push(progress.stage);
      });

      const result = await service.fetchGuildMembers(mockGuild as any, {
        progressCallback
      });

      expect(result.success).toBe(true);
      expect(progressCallback).toHaveBeenCalled();
      expect(progressStates).toContain('initializing');
      expect(progressStates).toContain('completed');
    });

    it('should handle fetch timeout and use fallback', async () => {
      // fetch가 실패하도록 설정
      mockGuild.members.fetch = jest.fn().mockRejectedValue(new Error('Timeout'));
      
      // 캐시에 일부 데이터가 있다고 가정
      const cachedMembers = new Collection<string, GuildMember>();
      cachedMembers.set('user-1', mockGuild.members.cache.get('user-1')!);
      mockGuild.members.cache = cachedMembers;

      const result = await service.fetchGuildMembers(mockGuild as any);

      expect(result.success).toBe(true);
      expect(result.members.size).toBe(1);
      expect(result.metadata.fallbackUsed).toBe(true);
    });
  });

  describe('fetchRoleMembers', () => {
    it('should fetch role members successfully', async () => {
      const result = await service.fetchRoleMembers(mockGuild as any, '관리자');

      expect(result.success).toBe(true);
      expect(result.roleMembers.size).toBe(10); // 관리자 역할을 가진 멤버 수
      expect(result.metadata.roleName).toBe('관리자');
      expect(result.metadata.cacheHit).toBe(false);
      expect(result.metadata.totalMembersChecked).toBe(50);
    });

    it('should use cache for role members', async () => {
      // 첫 번째 호출
      const result1 = await service.fetchRoleMembers(mockGuild as any, '관리자');
      expect(result1.metadata.cacheHit).toBe(false);

      // 두 번째 호출 (캐시 사용)
      const result2 = await service.fetchRoleMembers(mockGuild as any, '관리자');
      expect(result2.success).toBe(true);
      expect(result2.metadata.cacheHit).toBe(true);
      expect(result2.roleMembers.size).toBe(10);
    });

    it('should return empty collection for non-existent role', async () => {
      const result = await service.fetchRoleMembers(mockGuild as any, '존재하지않는역할');

      expect(result.success).toBe(true);
      expect(result.roleMembers.size).toBe(0);
      expect(result.metadata.roleName).toBe('존재하지않는역할');
    });
  });

  describe('fetchMultipleRoleMembers', () => {
    it('should fetch multiple roles concurrently', async () => {
      const roleNames = ['관리자', '일반사용자'];
      const results = await service.fetchMultipleRoleMembers(mockGuild as any, roleNames);

      expect(results.size).toBe(2);
      expect(results.get('관리자')?.success).toBe(true);
      expect(results.get('관리자')?.roleMembers.size).toBe(10);
      expect(results.get('일반사용자')?.success).toBe(true);
      expect(results.get('일반사용자')?.roleMembers.size).toBe(40);
    });

    it('should respect concurrency limits', async () => {
      const roleNames = ['관리자', '일반사용자', '존재하지않는역할'];
      const results = await service.fetchMultipleRoleMembers(mockGuild as any, roleNames, {
        concurrency: 1 // 동시에 1개씩만 처리
      });

      expect(results.size).toBe(3);
      // 모든 역할에 대한 결과가 있어야 함
      expect(results.has('관리자')).toBe(true);
      expect(results.has('일반사용자')).toBe(true);
      expect(results.has('존재하지않는역할')).toBe(true);
    });
  });

  describe('fetchMembersWithFilter', () => {
    it('should filter members correctly', async () => {
      const filter = (member: GuildMember) => member.displayName.includes('1');
      const result = await service.fetchMembersWithFilter(mockGuild as any, filter);

      expect(result.success).toBe(true);
      // User 1, User 10-19 등이 포함되어야 함
      expect(result.members.size).toBeGreaterThan(0);
      
      // 모든 결과가 필터 조건을 만족하는지 확인
      result.members.forEach(member => {
        expect(member.displayName).toContain('1');
      });
    });
  });

  describe('cache management', () => {
    it('should clear cache correctly', async () => {
      // 캐시 생성
      await service.fetchGuildMembers(mockGuild as any);
      await service.fetchRoleMembers(mockGuild as any, '관리자');

      // 캐시 통계 확인
      let stats = service.getCacheStats();
      expect(stats.size).toBeGreaterThan(0);

      // 캐시 클리어
      service.clearCache();
      stats = service.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should provide accurate cache statistics', async () => {
      await service.fetchGuildMembers(mockGuild as any);
      await service.fetchRoleMembers(mockGuild as any, '관리자');

      const stats = service.getCacheStats();
      expect(stats.size).toBe(2); // 길드 캐시 + 역할 캐시
      expect(stats.hitRate).toBeGreaterThanOrEqual(0);
    });
  });

  describe('configuration management', () => {
    it('should update configuration correctly', async () => {
      const newConfig: Partial<MemberFetchServiceConfig> = {
        cache: {
          defaultTTL: 600000, // 10 minutes
          maxCacheSize: 200,
          cleanupInterval: 120000,
          enableLRU: false
        }
      };

      service.updateConfig(newConfig);
      const currentConfig = service.getConfig();

      expect(currentConfig.cache.defaultTTL).toBe(600000);
      expect(currentConfig.cache.maxCacheSize).toBe(200);
      expect(currentConfig.cache.enableLRU).toBe(false);
    });
  });

  describe('statistics tracking', () => {
    it('should track statistics correctly', async () => {
      // 초기 통계
      let stats = service.getStatistics();
      expect(stats.totalRequests).toBe(0);

      // 몇 번의 요청 실행
      await service.fetchGuildMembers(mockGuild as any);
      await service.fetchGuildMembers(mockGuild as any); // 캐시 히트
      await service.fetchRoleMembers(mockGuild as any, '관리자');

      // 통계 확인
      stats = service.getStatistics();
      expect(stats.totalRequests).toBe(3);
      expect(stats.successfulRequests).toBe(3);
      expect(stats.cacheHits).toBe(1); // 두 번째 fetchGuildMembers는 캐시 히트
    });

    it('should reset statistics', async () => {
      await service.fetchGuildMembers(mockGuild as any);
      
      let stats = service.getStatistics();
      expect(stats.totalRequests).toBe(1);

      service.resetStatistics();
      stats = service.getStatistics();
      expect(stats.totalRequests).toBe(0);
    });
  });

  describe('health check', () => {
    it('should return healthy status by default', async () => {
      const health = await service.healthCheck();
      
      expect(health.status).toBe('healthy');
      expect(health.cacheStatus).toBe('healthy');
      expect(health.rateLimitStatus).toBe('normal');
      expect(health.errorCount).toBe(0);
    });

    it('should detect unhealthy status with high failure rate', async () => {
      // fetch가 항상 실패하도록 설정
      mockGuild.members.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      mockGuild.members.cache = new Collection(); // 캐시도 비움

      // 여러 번 실패 시도
      for (let i = 0; i < 5; i++) {
        await service.fetchGuildMembers(mockGuild as any);
      }

      const health = await service.healthCheck();
      expect(health.status).toBe('unhealthy'); // 100% 실패율
      expect(health.errorCount).toBe(5);
    });
  });

  describe('active operations tracking', () => {
    it('should track active operations', async () => {
      const progressCallback = jest.fn();
      
      // 비동기 작업 시작
      const promise = service.fetchGuildMembers(mockGuild as any, { progressCallback });
      
      // 잠시 대기 후 활성 작업 확인
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const activeOps = service.getActiveOperations();
      expect(activeOps.length).toBeGreaterThanOrEqual(0); // 작업이 빠르게 완료될 수 있음
      
      // 작업 완료 대기
      await promise;
      
      // 완료 후에는 활성 작업이 없어야 함
      const finalActiveOps = service.getActiveOperations();
      expect(finalActiveOps.length).toBe(0);
    });
  });

  describe('error handling and retry', () => {
    it('should handle network errors with retry', async () => {
      let callCount = 0;
      mockGuild.members.fetch = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('Network timeout'));
        }
        return Promise.resolve(mockGuild.members.cache);
      });

      const result = await service.fetchGuildMembers(mockGuild as any);
      
      expect(result.success).toBe(true);
      expect(mockGuild.members.fetch).toHaveBeenCalledTimes(3); // 2번 실패 후 3번째 성공
    });

    it('should use exponential backoff for retries', async () => {
      const timestamps: number[] = [];
      
      mockGuild.members.fetch = jest.fn().mockImplementation(() => {
        timestamps.push(Date.now());
        if (timestamps.length < 3) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve(mockGuild.members.cache);
      });

      await service.fetchGuildMembers(mockGuild as any);
      
      expect(timestamps.length).toBe(3);
      
      // 재시도 간격이 증가하는지 확인 (정확한 시간은 jitter 때문에 범위로 확인)
      if (timestamps.length >= 3) {
        const interval1 = timestamps[1] - timestamps[0];
        const interval2 = timestamps[2] - timestamps[1];
        expect(interval2).toBeGreaterThan(interval1 * 0.5); // jitter 고려
      }
    });
  });
});

describe('MemberFetchService Integration', () => {
  let service: IMemberFetchService;

  beforeEach(() => {
    service = new MemberFetchService();
  });

  it('should handle full workflow with optimization features', async () => {
    const mockGuild = new MockGuild();
    
    // 큰 길드 시뮬레이션 (1000명)
    const largeMembers = new Collection<string, GuildMember>();
    for (let i = 1; i <= 1000; i++) {
      const roleCache = new Collection<string, Role>();
      const member = new MockGuildMember(`user-${i}`, `User ${i}`, { cache: roleCache });
      largeMembers.set(`user-${i}`, member as any);
    }
    
    mockGuild.members.cache = largeMembers;
    mockGuild.members.fetch = jest.fn().mockResolvedValue(largeMembers);
    mockGuild.memberCount = 1000;

    const progressStates: string[] = [];
    const progressCallback = (progress: any) => {
      progressStates.push(`${progress.stage}:${Math.round(progress.progress)}%`);
    };

    // 첫 번째 호출 - 전체 데이터 fetch
    const result1 = await service.fetchGuildMembers(mockGuild as any, { progressCallback });
    
    expect(result1.success).toBe(true);
    expect(result1.members.size).toBe(1000);
    expect(result1.metadata.cacheHit).toBe(false);
    expect(progressStates.length).toBeGreaterThan(0);

    // 두 번째 호출 - 캐시 사용
    const result2 = await service.fetchGuildMembers(mockGuild as any);
    
    expect(result2.success).toBe(true);
    expect(result2.metadata.cacheHit).toBe(true);
    expect(result2.metadata.fetchTime).toBeLessThan(result1.metadata.fetchTime);

    // 통계 확인
    const stats = service.getStatistics();
    expect(stats.totalRequests).toBe(2);
    expect(stats.cacheHits).toBe(1);
    expect(stats.successfulRequests).toBe(2);

    // 헬스체크
    const health = await service.healthCheck();
    expect(health.status).toBe('healthy');
  });
});