// src/services/jobPostCacheService.js - 구인구직 카드 캐싱 서비스
export class JobPostCacheService {
  constructor() {
    // 메모리 캐시
    this.cache = new Map();
    
    // 캐시 메타데이터
    this.metadata = new Map();
    
    // 캐시 설정
    this.config = {
      defaultTTL: 5 * 60 * 1000, // 5분
      maxCacheSize: 1000, // 최대 1000개 항목
      cleanupInterval: 10 * 60 * 1000, // 10분마다 정리
    };
    
    // 통계
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      evictions: 0,
      cleanups: 0
    };
    
    // 정리 타이머 시작
    this.startCleanupTimer();
  }

  /**
   * 캐시에서 값 조회
   * @param {string} key - 캐시 키
   * @returns {any|null} - 캐시된 값 또는 null
   */
  get(key) {
    const item = this.cache.get(key);
    const meta = this.metadata.get(key);
    
    if (!item || !meta) {
      this.stats.misses++;
      return null;
    }
    
    // TTL 확인
    if (Date.now() > meta.expiresAt) {
      this.delete(key);
      this.stats.misses++;
      return null;
    }
    
    // 액세스 시간 업데이트 (LRU용)
    meta.lastAccessed = Date.now();
    this.metadata.set(key, meta);
    
    this.stats.hits++;
    return item;
  }

  /**
   * 캐시에 값 저장
   * @param {string} key - 캐시 키
   * @param {any} value - 저장할 값
   * @param {number} ttl - TTL (밀리초, 선택적)
   */
  set(key, value, ttl = this.config.defaultTTL) {
    // 캐시 크기 제한 확인
    if (this.cache.size >= this.config.maxCacheSize && !this.cache.has(key)) {
      this.evictLRU();
    }
    
    const now = Date.now();
    
    this.cache.set(key, value);
    this.metadata.set(key, {
      createdAt: now,
      lastAccessed: now,
      expiresAt: now + ttl,
      ttl: ttl
    });
    
    this.stats.sets++;
  }

  /**
   * 캐시에서 항목 삭제
   * @param {string} key - 캐시 키
   * @returns {boolean} - 삭제 성공 여부
   */
  delete(key) {
    const hadKey = this.cache.has(key);
    this.cache.delete(key);
    this.metadata.delete(key);
    return hadKey;
  }

  /**
   * 특정 패턴으로 캐시 무효화
   * @param {string} pattern - 무효화할 키 패턴 (정규식)
   * @returns {number} - 무효화된 항목 수
   */
  invalidatePattern(pattern) {
    const regex = new RegExp(pattern);
    let count = 0;
    
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.delete(key);
        count++;
      }
    }
    
    console.log(`[JobPostCacheService] 패턴 "${pattern}"으로 ${count}개 항목 무효화`);
    return count;
  }

  /**
   * LRU 알고리즘으로 가장 오래된 항목 제거
   */
  evictLRU() {
    let oldestKey = null;
    let oldestTime = Date.now();
    
    for (const [key, meta] of this.metadata.entries()) {
      if (meta.lastAccessed < oldestTime) {
        oldestTime = meta.lastAccessed;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  /**
   * 만료된 항목 정리
   */
  cleanup() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [key, meta] of this.metadata.entries()) {
      if (now > meta.expiresAt) {
        this.delete(key);
        cleanedCount++;
      }
    }
    
    this.stats.cleanups++;
    
    if (cleanedCount > 0) {
      console.log(`[JobPostCacheService] 만료된 캐시 ${cleanedCount}개 정리`);
    }
  }

  /**
   * 정리 타이머 시작
   */
  startCleanupTimer() {
    setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  /**
   * 캐시 전체 초기화
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.metadata.clear();
    console.log(`[JobPostCacheService] 캐시 전체 초기화 (${size}개 항목)`);
  }

  /**
   * 캐시 통계 조회
   * @returns {Object} - 캐시 통계
   */
  getStats() {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? (this.stats.hits / totalRequests) * 100 : 0;
    
    return {
      ...this.stats,
      totalRequests,
      hitRate: Math.round(hitRate * 100) / 100,
      cacheSize: this.cache.size,
      memoryUsage: this.getMemoryUsage()
    };
  }

  /**
   * 메모리 사용량 추정
   * @returns {Object} - 메모리 사용량 정보
   */
  getMemoryUsage() {
    // 간단한 메모리 사용량 추정
    let estimatedBytes = 0;
    
    for (const [key, value] of this.cache.entries()) {
      estimatedBytes += this.estimateSize(key) + this.estimateSize(value);
    }
    
    for (const [key, meta] of this.metadata.entries()) {
      estimatedBytes += this.estimateSize(key) + this.estimateSize(meta);
    }
    
    return {
      estimatedBytes,
      estimatedKB: Math.round(estimatedBytes / 1024 * 100) / 100,
      estimatedMB: Math.round(estimatedBytes / (1024 * 1024) * 100) / 100
    };
  }

  /**
   * 객체 크기 추정
   * @param {any} obj - 크기를 추정할 객체
   * @returns {number} - 추정 바이트 수
   */
  estimateSize(obj) {
    if (typeof obj === 'string') {
      return obj.length * 2; // UTF-16
    } else if (typeof obj === 'number') {
      return 8;
    } else if (typeof obj === 'boolean') {
      return 4;
    } else if (obj && typeof obj === 'object') {
      return JSON.stringify(obj).length * 2;
    }
    return 0;
  }

  /**
   * 캐시 키 생성 도우미
   */
  static createKey(prefix, ...parts) {
    return `${prefix}:${parts.filter(Boolean).join(':')}`;
  }
}

/**
 * 구인구직 전용 캐시 래퍼
 */
export class JobPostCache {
  constructor() {
    this.cache = new JobPostCacheService();
  }

  // 개별 구인구직 카드 캐싱
  getJobPost(jobId) {
    return this.cache.get(JobPostCacheService.createKey('jobpost', jobId));
  }

  setJobPost(jobId, jobPost, ttl) {
    this.cache.set(JobPostCacheService.createKey('jobpost', jobId), jobPost, ttl);
  }

  invalidateJobPost(jobId) {
    return this.cache.delete(JobPostCacheService.createKey('jobpost', jobId));
  }

  // 카드 목록 캐싱
  getJobPostList(listType, params = {}) {
    const key = JobPostCacheService.createKey('jobpost_list', listType, JSON.stringify(params));
    return this.cache.get(key);
  }

  setJobPostList(listType, params = {}, jobPosts, ttl) {
    const key = JobPostCacheService.createKey('jobpost_list', listType, JSON.stringify(params));
    this.cache.set(key, jobPosts, ttl);
  }

  invalidateJobPostLists() {
    return this.cache.invalidatePattern('^jobpost_list:');
  }

  // 채널별 카드 캐싱
  getJobPostByChannel(channelId) {
    return this.cache.get(JobPostCacheService.createKey('jobpost_channel', channelId));
  }

  setJobPostByChannel(channelId, jobPost, ttl) {
    this.cache.set(JobPostCacheService.createKey('jobpost_channel', channelId), jobPost, ttl);
  }

  invalidateJobPostByChannel(channelId) {
    return this.cache.delete(JobPostCacheService.createKey('jobpost_channel', channelId));
  }

  // 작성자별 카드 캐싱
  getJobPostsByAuthor(authorId) {
    return this.cache.get(JobPostCacheService.createKey('jobpost_author', authorId));
  }

  setJobPostsByAuthor(authorId, jobPosts, ttl) {
    this.cache.set(JobPostCacheService.createKey('jobpost_author', authorId), jobPosts, ttl);
  }

  invalidateJobPostsByAuthor(authorId) {
    return this.cache.delete(JobPostCacheService.createKey('jobpost_author', authorId));
  }

  // 태그별 카드 캐싱
  getJobPostsByTag(tag) {
    return this.cache.get(JobPostCacheService.createKey('jobpost_tag', tag.toLowerCase()));
  }

  setJobPostsByTag(tag, jobPosts, ttl) {
    this.cache.set(JobPostCacheService.createKey('jobpost_tag', tag.toLowerCase()), jobPosts, ttl);
  }

  invalidateJobPostsByTag(tag) {
    return this.cache.delete(JobPostCacheService.createKey('jobpost_tag', tag.toLowerCase()));
  }

  // 카드 변경 시 관련 캐시 모두 무효화
  invalidateAllRelated(jobPost) {
    this.invalidateJobPost(jobPost.id);
    this.invalidateJobPostLists();
    
    if (jobPost.channelId) {
      this.invalidateJobPostByChannel(jobPost.channelId);
    }
    
    if (jobPost.authorId) {
      this.invalidateJobPostsByAuthor(jobPost.authorId);
    }
    
    if (jobPost.roleTags) {
      const tags = jobPost.roleTags.split(/[,\s]+/).filter(Boolean);
      tags.forEach(tag => this.invalidateJobPostsByTag(tag));
    }
  }

  // 통계 및 관리
  getStats() {
    return this.cache.getStats();
  }

  clear() {
    this.cache.clear();
  }
}