// SQLite 데이터베이스 관련 타입 정의

export interface SQLiteConfig {
  database: string;
  enableWAL?: boolean;
  timeout?: number;
  enableForeignKeys?: boolean;
  cacheSize?: number;
  busyTimeout?: number;
}

export interface DatabaseConnection {
  db: any; // sqlite3.Database 타입
  isConnected: boolean;
  lastError?: Error;
}

// 기본 테이블 인터페이스
export interface BaseTable {
  created_at: number;
  updated_at?: number;
}

// 사용자 활동 테이블
export interface UserActivityRow extends BaseTable {
  user_id: string;
  total_time: number;
  start_time: number | null;
  display_name: string | null;
  last_updated: number;
}

// 활동 로그 테이블
export interface ActivityLogRow extends BaseTable {
  id: number;
  user_id: string;
  event_type: 'join' | 'leave' | 'move' | 'switch' | 'disconnect';
  timestamp: number;
  channel_id: string | null;
  channel_name: string | null;
  guild_id: string | null;
  session_duration: number | null;
  additional_data: string | null; // JSON string
}

// 역할 설정 테이블
export interface RoleConfigRow extends BaseTable {
  role_id: string;
  role_name: string | null;
  config_data: string; // JSON string
  updated_at: number;
}

// AFK 상태 테이블
export interface AfkStatusRow extends BaseTable {
  user_id: string;
  is_afk: boolean;
  afk_since: number | null;
  reason: string | null;
  auto_afk: boolean;
  updated_at: number;
}

// 포럼 메시지 테이블
export interface ForumMessageRow extends BaseTable {
  message_id: string;
  channel_id: string;
  user_id: string;
  content: string | null;
  message_data: string | null; // JSON string
}

// 음성 채널 매핑 테이블
export interface VoiceChannelMappingRow extends BaseTable {
  voice_channel_id: string;
  forum_channel_id: string;
  mapping_data: string | null; // JSON string
  updated_at: number;
}

// 리셋 히스토리 테이블
export interface ResetHistoryRow extends BaseTable {
  id: number;
  reset_type: 'manual' | 'scheduled' | 'admin' | 'migration';
  reset_timestamp: number;
  admin_user_id: string | null;
  affected_users_count: number | null;
  backup_data: string | null; // JSON string
}

// 로그 멤버 테이블
export interface LogMemberRow extends BaseTable {
  user_id: string;
  log_data: string; // JSON string
  updated_at: number;
}

// 메타데이터 테이블
export interface MetadataRow {
  key: string;
  value: string;
  updated_at: number;
}

// 뷰 타입들
export interface ActiveUserView {
  user_id: string;
  display_name: string | null;
  start_time: number;
  total_time: number;
  current_session_time: number;
}

export interface UserStatisticsView {
  user_id: string;
  display_name: string | null;
  total_time: number;
  status: 'active' | 'inactive';
  last_updated: number;
}

export interface DailyActivityStatsView {
  activity_date: string;
  total_events: number;
  joins: number;
  leaves: number;
  unique_users: number;
  avg_session_duration: number | null;
}

// 쿼리 옵션들
export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: 'ASC' | 'DESC';
}

export interface UserActivityQueryOptions extends QueryOptions {
  includeInactive?: boolean;
  minTotalTime?: number;
  maxTotalTime?: number;
  startTimeAfter?: number;
  startTimeBefore?: number;
}

export interface ActivityLogQueryOptions extends QueryOptions {
  userId?: string;
  eventType?: string | string[];
  channelId?: string;
  timestampAfter?: number;
  timestampBefore?: number;
  includeDuration?: boolean;
}

// 트랜잭션 타입
export interface Transaction {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  run(sql: string, params?: any[]): Promise<any>;
  get(sql: string, params?: any[]): Promise<any>;
  all(sql: string, params?: any[]): Promise<any[]>;
}

// 성능 메트릭
export interface PerformanceMetrics {
  queryCount: number;
  totalQueryTime: number;
  averageQueryTime: number;
  slowQueries: Array<{
    sql: string;
    duration: number;
    timestamp: number;
  }>;
  cacheHitRate: number;
  memoryUsage: number;
}

// 백업 설정
export interface BackupConfig {
  enabled: boolean;
  interval: number; // milliseconds
  maxBackups: number;
  backupPath: string;
  compressionEnabled: boolean;
}

// 마이그레이션 상태
export interface MigrationStatus {
  isRunning: boolean;
  progress: number; // 0-100
  currentStep: string;
  totalSteps: number;
  startTime: number;
  estimatedCompletion?: number;
  errors: Array<{
    step: string;
    error: string;
    timestamp: number;
  }>;
}

// SQL 빌더 헬퍼 타입들
export interface WhereClause {
  column: string;
  operator:
    | '='
    | '!='
    | '>'
    | '<'
    | '>='
    | '<='
    | 'LIKE'
    | 'IN'
    | 'NOT IN'
    | 'IS NULL'
    | 'IS NOT NULL';
  value?: any;
}

export interface JoinClause {
  type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
  table: string;
  on: string;
}

export interface SelectOptions {
  columns?: string[];
  where?: WhereClause[];
  joins?: JoinClause[];
  groupBy?: string[];
  having?: WhereClause[];
  orderBy?: Array<{
    column: string;
    direction: 'ASC' | 'DESC';
  }>;
  limit?: number;
  offset?: number;
}
