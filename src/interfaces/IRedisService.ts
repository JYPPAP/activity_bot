// src/interfaces/IRedisService.ts - Redis 서비스 인터페이스

/**
 * Redis 설정 인터페이스
 */
export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  username?: string;
  retryDelayOnFailover?: number;
  maxRetriesPerRequest?: number;
  lazyConnect?: boolean;
  enableOfflineQueue?: boolean;
  connectTimeout?: number;
  commandTimeout?: number;
  family?: 4 | 6;
  keepAlive?: number;
  keyPrefix?: string;
}

/**
 * Rate Limiting 결과 인터페이스
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  totalHits: number;
}

/**
 * Redis 헬스체크 결과 인터페이스
 */
export interface RedisHealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  latency: number;
  memoryUsage?: number;
  connectedClients?: number;
  lastError?: string;
  uptime?: number;
}

/**
 * Redis 캐시 통계 인터페이스
 */
export interface RedisCacheStats {
  hitRate: number;
  missRate: number;
  totalKeys: number;
  memoryUsage: number;
  operationsPerSecond: number;
  averageLatency: number;
}

/**
 * Redis Pub/Sub 메시지 인터페이스
 */
export interface RedisMessage {
  channel: string;
  message: string;
  timestamp: number;
}

/**
 * Redis 서비스 인터페이스
 * Discord Bot의 캐싱, 세션 관리, Pub/Sub, Rate Limiting을 위한 Redis 서비스
 */
export interface IRedisService {
  // ===========================================
  // 연결 관리
  // ===========================================
  
  /**
   * Redis 서버에 연결
   * @returns 연결 성공 여부
   */
  connect(): Promise<boolean>;

  /**
   * Redis 서버 연결 종료
   */
  disconnect(): Promise<void>;

  /**
   * Redis 서버 상태 확인
   * @returns 헬스체크 결과
   */
  healthCheck(): Promise<RedisHealthStatus>;

  /**
   * 연결 상태 확인
   * @returns 연결 여부
   */
  isConnected(): boolean;

  // ===========================================
  // 기본 키-값 조작
  // ===========================================

  /**
   * 키의 값 조회
   * @param key 키
   * @returns 값 또는 null
   */
  get(key: string): Promise<string | null>;

  /**
   * 키에 값 저장
   * @param key 키
   * @param value 값
   * @param ttl TTL (초), 옵션
   * @returns 저장 성공 여부
   */
  set(key: string, value: string, ttl?: number): Promise<boolean>;

  /**
   * 키 삭제
   * @param key 키
   * @returns 삭제된 키 개수
   */
  del(key: string): Promise<number>;

  /**
   * 키 존재 여부 확인
   * @param key 키
   * @returns 존재 여부
   */
  exists(key: string): Promise<boolean>;

  /**
   * 키의 TTL 설정
   * @param key 키
   * @param ttl TTL (초)
   * @returns 설정 성공 여부
   */
  expire(key: string, ttl: number): Promise<boolean>;

  /**
   * 패턴으로 키 검색
   * @param pattern 검색 패턴
   * @returns 일치하는 키 배열
   */
  keys(pattern: string): Promise<string[]>;

  // ===========================================
  // 해시 조작 (세션 관리용)
  // ===========================================

  /**
   * 해시에 필드 설정
   * @param key 해시 키
   * @param field 필드명
   * @param value 값
   * @returns 설정 성공 여부
   */
  hset(key: string, field: string, value: string): Promise<boolean>;

  /**
   * 해시 여러 필드 일괄 설정
   * @param key 해시 키
   * @param fieldValues 필드-값 객체
   * @returns 설정 성공 여부
   */
  hmset(key: string, fieldValues: Record<string, string>): Promise<boolean>;

  /**
   * 해시 필드 값 조회
   * @param key 해시 키
   * @param field 필드명
   * @returns 값 또는 null
   */
  hget(key: string, field: string): Promise<string | null>;

  /**
   * 해시 모든 필드 조회
   * @param key 해시 키
   * @returns 필드-값 객체
   */
  hgetall(key: string): Promise<Record<string, string>>;

  /**
   * 해시 필드 삭제
   * @param key 해시 키
   * @param field 필드명
   * @returns 삭제된 필드 개수
   */
  hdel(key: string, field: string): Promise<number>;

  /**
   * 해시 필드 존재 여부 확인
   * @param key 해시 키
   * @param field 필드명
   * @returns 존재 여부
   */
  hexists(key: string, field: string): Promise<boolean>;

  // ===========================================
  // Pub/Sub (실시간 통신용)
  // ===========================================

  /**
   * 채널에 메시지 발행
   * @param channel 채널명
   * @param message 메시지
   * @returns 수신한 클라이언트 수
   */
  publish(channel: string, message: string): Promise<number>;

  /**
   * 채널 구독
   * @param channel 채널명
   * @param callback 메시지 수신 콜백
   */
  subscribe(channel: string, callback: (message: RedisMessage) => void): Promise<void>;

  /**
   * 채널 구독 해제
   * @param channel 채널명
   */
  unsubscribe(channel: string): Promise<void>;

  /**
   * 패턴으로 채널 구독
   * @param pattern 패턴
   * @param callback 메시지 수신 콜백
   */
  psubscribe(pattern: string, callback: (message: RedisMessage) => void): Promise<void>;

  // ===========================================
  // Rate Limiting
  // ===========================================

  /**
   * Rate Limiting 확인 및 적용
   * @param key Rate Limit 키
   * @param limit 제한 횟수
   * @param window 시간 윈도우 (초)
   * @returns Rate Limit 결과
   */
  rateLimit(key: string, limit: number, window: number): Promise<RateLimitResult>;

  /**
   * Sliding Window Rate Limiting
   * @param key Rate Limit 키
   * @param limit 제한 횟수
   * @param window 시간 윈도우 (초)
   * @returns Rate Limit 결과
   */
  slidingWindowRateLimit(key: string, limit: number, window: number): Promise<RateLimitResult>;

  // ===========================================
  // 리스트 조작 (로깅, 큐 관리용)
  // ===========================================

  /**
   * 리스트 왼쪽에 요소 추가
   * @param key 리스트 키
   * @param value 값
   * @returns 리스트 길이
   */
  lpush(key: string, value: string): Promise<number>;

  /**
   * 리스트 오른쪽에서 요소 제거 및 반환
   * @param key 리스트 키
   * @returns 제거된 값 또는 null
   */
  rpop(key: string): Promise<string | null>;

  /**
   * 리스트 길이 조회
   * @param key 리스트 키
   * @returns 리스트 길이
   */
  llen(key: string): Promise<number>;

  /**
   * 리스트 범위 조회
   * @param key 리스트 키
   * @param start 시작 인덱스
   * @param stop 종료 인덱스
   * @returns 값 배열
   */
  lrange(key: string, start: number, stop: number): Promise<string[]>;

  // ===========================================
  // 집합 조작 (중복 제거용)
  // ===========================================

  /**
   * 집합에 멤버 추가
   * @param key 집합 키
   * @param member 멤버
   * @returns 추가된 멤버 수
   */
  sadd(key: string, member: string): Promise<number>;

  /**
   * 집합에서 멤버 제거
   * @param key 집합 키
   * @param member 멤버
   * @returns 제거된 멤버 수
   */
  srem(key: string, member: string): Promise<number>;

  /**
   * 집합 멤버 존재 여부 확인
   * @param key 집합 키
   * @param member 멤버
   * @returns 존재 여부
   */
  sismember(key: string, member: string): Promise<boolean>;

  /**
   * 집합 모든 멤버 조회
   * @param key 집합 키
   * @returns 멤버 배열
   */
  smembers(key: string): Promise<string[]>;

  // ===========================================
  // 트랜잭션 및 배치 처리
  // ===========================================

  /**
   * 트랜잭션 시작
   * @returns 트랜잭션 객체
   */
  multi(): any;

  /**
   * 트랜잭션 실행
   * @param multi 트랜잭션 객체
   * @returns 실행 결과
   */
  exec(multi: any): Promise<any[]>;

  /**
   * 파이프라인 처리
   * @param commands 명령어 배열
   * @returns 실행 결과
   */
  pipeline(commands: Array<{cmd: string, args: any[]}>): Promise<any[]>;

  // ===========================================
  // 통계 및 모니터링
  // ===========================================

  /**
   * Redis 캐시 통계 조회
   * @returns 캐시 통계
   */
  getCacheStats(): Promise<RedisCacheStats>;

  /**
   * Redis 메모리 사용량 조회
   * @returns 메모리 사용량 (바이트)
   */
  getMemoryUsage(): Promise<number>;

  /**
   * Redis 정보 조회
   * @param section 정보 섹션 (옵션)
   * @returns Redis 정보
   */
  info(section?: string): Promise<string>;

  // ===========================================
  // 유틸리티
  // ===========================================

  /**
   * 모든 키 삭제 (개발용)
   * @returns 삭제된 키 개수
   */
  flushall(): Promise<number>;

  /**
   * 현재 데이터베이스의 모든 키 삭제
   * @returns 삭제된 키 개수
   */
  flushdb(): Promise<number>;

  /**
   * JSON 직렬화해서 저장
   * @param key 키
   * @param value 객체
   * @param ttl TTL (초), 옵션
   * @returns 저장 성공 여부
   */
  setJSON(key: string, value: any, ttl?: number): Promise<boolean>;

  /**
   * JSON 역직렬화해서 조회
   * @param key 키
   * @returns 파싱된 객체 또는 null
   */
  getJSON<T = any>(key: string): Promise<T | null>;
}