// PostgreSQL Database Manager - Repository Pattern Implementation
// Replaces the LowDB DatabaseManager with PostgreSQL support

import pg from 'pg';
const { Pool } = pg;

export class PostgreSQLDatabaseManager {
  constructor(connectionConfig = {}) {
    // Default configuration
    this.config = {
      user: process.env.POSTGRES_USER || 'discord_bot',
      password: process.env.POSTGRES_PASSWORD || 'password',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: process.env.POSTGRES_PORT || 5432,
      database: process.env.POSTGRES_DB || 'discord_activity_bot',
      ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 20,  // Maximum connections in pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      ...connectionConfig
    };

    this.pool = new Pool(this.config);
    this.client = null;

    // Setup pool event handlers
    this.setupPoolHandlers();
  }

  setupPoolHandlers() {
    this.pool.on('connect', () => {
      console.log('[PostgreSQL] 새 클라이언트 연결');
    });

    this.pool.on('error', (err) => {
      console.error('[PostgreSQL] 예기치 않은 클라이언트 오류:', err);
    });
  }

  /**
   * 데이터베이스 연결 및 초기화
   */
  async initialize() {
    try {
      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      
      console.log(`[PostgreSQL] 데이터베이스 연결 성공: ${this.config.host}:${this.config.port}/${this.config.database}`);
      return true;
    } catch (error) {
      console.error('[PostgreSQL] 데이터베이스 초기화 오류:', error);
      return false;
    }
  }

  /**
   * 데이터베이스 내 데이터 존재 확인
   */
  async hasAnyData() {
    try {
      const result = await this.pool.query('SELECT COUNT(*) as count FROM user_activities');
      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      console.error('[PostgreSQL] 데이터 존재 확인 오류:', error);
      return false;
    }
  }

  /**
   * 데이터베이스 연결 종료
   */
  async close() {
    try {
      await this.pool.end();
      console.log('[PostgreSQL] 데이터베이스 연결이 종료되었습니다.');
      return true;
    } catch (error) {
      console.error('[PostgreSQL] 연결 종료 오류:', error);
      return false;
    }
  }

  /**
   * 트랜잭션 시작
   */
  async beginTransaction() {
    try {
      this.client = await this.pool.connect();
      await this.client.query('BEGIN');
      return true;
    } catch (error) {
      console.error('[PostgreSQL] 트랜잭션 시작 오류:', error);
      if (this.client) {
        this.client.release();
        this.client = null;
      }
      return false;
    }
  }

  /**
   * 트랜잭션 커밋
   */
  async commitTransaction() {
    try {
      if (this.client) {
        await this.client.query('COMMIT');
        this.client.release();
        this.client = null;
      }
      return true;
    } catch (error) {
      console.error('[PostgreSQL] 트랜잭션 커밋 오류:', error);
      return false;
    }
  }

  /**
   * 트랜잭션 롤백
   */
  async rollbackTransaction() {
    try {
      if (this.client) {
        await this.client.query('ROLLBACK');
        this.client.release();
        this.client = null;
      }
      return true;
    } catch (error) {
      console.error('[PostgreSQL] 트랜잭션 롤백 오류:', error);
      return false;
    }
  }

  /**
   * 쿼리 실행 헬퍼 (트랜잭션 고려)
   */
  async query(text, params = []) {
    const queryClient = this.client || this.pool;
    return await queryClient.query(text, params);
  }

  // ======== 사용자 관련 메서드 ========

  /**
   * 사용자 생성 또는 업데이트
   */
  async upsertUser(userId, displayName) {
    try {
      await this.query(`
        INSERT INTO users (id, display_name)
        VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          updated_at = CURRENT_TIMESTAMP
      `, [userId, displayName]);
      return true;
    } catch (error) {
      console.error('[PostgreSQL] 사용자 업서트 오류:', error);
      return false;
    }
  }

  /**
   * 사용자 활동 데이터 가져오기
   */
  async getUserActivity(userId) {
    try {
      const result = await this.query(`
        SELECT ua.user_id, ua.total_time_ms as "totalTime", 
               ua.start_time as "startTime", u.display_name as "displayName"
        FROM user_activities ua
        JOIN users u ON ua.user_id = u.id
        WHERE ua.user_id = $1
      `, [userId]);

      return result.rows[0] || null;
    } catch (error) {
      console.error('[PostgreSQL] 사용자 활동 조회 오류:', error);
      return null;
    }
  }

  /**
   * 사용자 활동 데이터 업데이트/삽입
   */
  async updateUserActivity(userId, totalTime, startTime, displayName) {
    try {
      // Ensure user exists
      await this.upsertUser(userId, displayName);

      // Update activity
      await this.query(`
        INSERT INTO user_activities (user_id, total_time_ms, start_time)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE SET
          total_time_ms = EXCLUDED.total_time_ms,
          start_time = EXCLUDED.start_time,
          last_updated = CURRENT_TIMESTAMP
      `, [userId, totalTime, startTime ? new Date(startTime) : null]);

      return true;
    } catch (error) {
      console.error('[PostgreSQL] 사용자 활동 업데이트 오류:', error);
      return false;
    }
  }

  /**
   * 모든 사용자 활동 데이터 가져오기
   */
  async getAllUserActivity() {
    try {
      const result = await this.query(`
        SELECT ua.user_id as "userId", ua.total_time_ms as "totalTime",
               ua.start_time as "startTime", u.display_name as "displayName"
        FROM user_activities ua
        JOIN users u ON ua.user_id = u.id
        ORDER BY ua.total_time_ms DESC
      `);

      return result.rows;
    } catch (error) {
      console.error('[PostgreSQL] 전체 사용자 활동 조회 오류:', error);
      return [];
    }
  }

  /**
   * 사용자 활동 데이터 삭제
   */
  async deleteUserActivity(userId) {
    try {
      await this.query('DELETE FROM user_activities WHERE user_id = $1', [userId]);
      return true;
    } catch (error) {
      console.error('[PostgreSQL] 사용자 활동 삭제 오류:', error);
      return false;
    }
  }

  // ======== 역할 설정 관련 메서드 ========

  /**
   * 역할 설정 가져오기
   */
  async getRoleConfig(roleName) {
    try {
      const result = await this.query(`
        SELECT name as "roleName", min_hours as "minHours", 
               report_cycle as "reportCycle"
        FROM roles
        WHERE name = $1
      `, [roleName]);

      return result.rows[0] || null;
    } catch (error) {
      console.error('[PostgreSQL] 역할 설정 조회 오류:', error);
      return null;
    }
  }

  /**
   * 역할 설정 업데이트/삽입
   */
  async updateRoleConfig(roleName, minHours, resetTime = null, reportCycle = 1) {
    try {
      await this.query(`
        INSERT INTO roles (name, min_hours, report_cycle)
        VALUES ($1, $2, $3)
        ON CONFLICT (name) DO UPDATE SET
          min_hours = EXCLUDED.min_hours,
          report_cycle = EXCLUDED.report_cycle,
          updated_at = CURRENT_TIMESTAMP
      `, [roleName, minHours, reportCycle]);

      return true;
    } catch (error) {
      console.error('[PostgreSQL] 역할 설정 업데이트 오류:', error);
      return false;
    }
  }

  /**
   * 모든 역할 설정 가져오기
   */
  async getAllRoleConfigs() {
    try {
      const result = await this.query(`
        SELECT name as "roleName", min_hours as "minHours", 
               report_cycle as "reportCycle"
        FROM roles
        ORDER BY name
      `);

      return result.rows;
    } catch (error) {
      console.error('[PostgreSQL] 전체 역할 설정 조회 오류:', error);
      return [];
    }
  }

  /**
   * 역할 리셋 시간 업데이트
   */
  async updateRoleResetTime(roleName, resetTime, reason = '관리자에 의한 리셋') {
    try {
      // Record reset history
      await this.query(`
        INSERT INTO role_resets (id, role_name, reset_time, reason)
        VALUES (uuid_generate_v4(), $1, $2, $3)
      `, [roleName, new Date(resetTime), reason]);

      return true;
    } catch (error) {
      console.error('[PostgreSQL] 역할 리셋 시간 업데이트 오류:', error);
      return false;
    }
  }

  /**
   * 역할 리셋 이력 가져오기
   */
  async getRoleResetHistory(roleName, limit = 5) {
    try {
      const result = await this.query(`
        SELECT role_name as "roleName", reset_time as "resetTime", reason
        FROM role_resets
        WHERE role_name = $1
        ORDER BY reset_time DESC
        LIMIT $2
      `, [roleName, limit]);

      return result.rows;
    } catch (error) {
      console.error('[PostgreSQL] 역할 리셋 이력 조회 오류:', error);
      return [];
    }
  }

  // ======== 활동 로그 관련 메서드 ========

  /**
   * 활동 로그 기록하기
   */
  async logActivity(userId, eventType, channelId, channelName, members = []) {
    try {
      // Insert activity log
      const result = await this.query(`
        INSERT INTO activity_logs (user_id, event_type, channel_id, channel_name, members_count)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [userId, eventType, channelId, channelName, members.length]);

      const logId = result.rows[0].id;

      // Insert log members
      if (members.length > 0) {
        const memberValues = members.map((_, index) => 
          `($1, $${index + 2})`
        ).join(', ');

        await this.query(`
          INSERT INTO activity_log_members (log_id, user_id)
          VALUES ${memberValues}
          ON CONFLICT (log_id, user_id) DO NOTHING
        `, [logId, ...members]);
      }

      return logId;
    } catch (error) {
      console.error('[PostgreSQL] 활동 로그 기록 오류:', error);
      return null;
    }
  }

  /**
   * 특정 기간의 활동 로그 가져오기
   */
  async getActivityLogs(startTime, endTime, eventType = null) {
    try {
      let query = `
        SELECT al.id, al.user_id as "userId", al.event_type as "eventType",
               al.channel_id as "channelId", al.channel_name as "channelName",
               al.members_count as "membersCount", al.timestamp,
               ARRAY_AGG(alm.user_id) FILTER (WHERE alm.user_id IS NOT NULL) as members
        FROM activity_logs al
        LEFT JOIN activity_log_members alm ON al.id = alm.log_id
        WHERE al.timestamp >= $1 AND al.timestamp <= $2
      `;

      let params = [new Date(startTime), new Date(endTime)];

      if (eventType) {
        query += ' AND al.event_type = $3';
        params.push(eventType);
      }

      query += `
        GROUP BY al.id, al.user_id, al.event_type, al.channel_id, 
                 al.channel_name, al.members_count, al.timestamp
        ORDER BY al.timestamp DESC
      `;

      const result = await this.query(query, params);
      return result.rows.map(row => ({
        ...row,
        members: row.members || []
      }));
    } catch (error) {
      console.error('[PostgreSQL] 활동 로그 조회 오류:', error);
      return [];
    }
  }

  /**
   * 특정 기간 동안의 사용자 활동 시간 조회
   */
  async getUserActivityByDateRange(userId, startTime, endTime) {
    try {
      const result = await this.query(`
        WITH user_sessions AS (
          SELECT 
            user_id,
            event_type,
            timestamp,
            LAG(timestamp) OVER (PARTITION BY user_id ORDER BY timestamp) as prev_timestamp,
            LAG(event_type) OVER (PARTITION BY user_id ORDER BY timestamp) as prev_event_type
          FROM activity_logs
          WHERE user_id = $1 
            AND timestamp >= $2 
            AND timestamp <= $3
          ORDER BY timestamp
        ),
        session_durations AS (
          SELECT 
            CASE 
              WHEN event_type = 'LEAVE' AND prev_event_type = 'JOIN'
              THEN EXTRACT(EPOCH FROM (timestamp - prev_timestamp)) * 1000
              ELSE 0
            END as duration_ms
          FROM user_sessions
        )
        SELECT COALESCE(SUM(duration_ms), 0) as total_time
        FROM session_durations
      `, [userId, new Date(startTime), new Date(endTime)]);

      return parseInt(result.rows[0].total_time) || 0;
    } catch (error) {
      console.error('[PostgreSQL] 기간별 사용자 활동 시간 조회 오류:', error);
      return 0;
    }
  }

  // ======== AFK 상태 관리 메서드 ========

  /**
   * 사용자의 AFK 상태 설정
   */
  async setUserAfkStatus(userId, displayName, untilTimestamp) {
    try {
      await this.upsertUser(userId, displayName);

      await this.query(`
        INSERT INTO afk_status (user_id, afk_until)
        VALUES ($1, $2)
        ON CONFLICT (user_id) DO UPDATE SET
          afk_until = EXCLUDED.afk_until,
          updated_at = CURRENT_TIMESTAMP
      `, [userId, new Date(untilTimestamp)]);

      return true;
    } catch (error) {
      console.error('[PostgreSQL] AFK 상태 설정 오류:', error);
      return false;
    }
  }

  /**
   * 사용자의 AFK 상태 확인
   */
  async getUserAfkStatus(userId) {
    try {
      const result = await this.query(`
        SELECT a.user_id as "userId", u.display_name as "displayName",
               a.afk_until as "afkUntil", ua.total_time_ms as "totalTime"
        FROM afk_status a
        JOIN users u ON a.user_id = u.id
        LEFT JOIN user_activities ua ON a.user_id = ua.user_id
        WHERE a.user_id = $1 AND a.afk_until > CURRENT_TIMESTAMP
      `, [userId]);

      return result.rows[0] || null;
    } catch (error) {
      console.error('[PostgreSQL] AFK 상태 조회 오류:', error);
      return null;
    }
  }

  /**
   * 사용자의 AFK 상태 해제
   */
  async clearUserAfkStatus(userId) {
    try {
      await this.query('DELETE FROM afk_status WHERE user_id = $1', [userId]);
      return true;
    } catch (error) {
      console.error('[PostgreSQL] AFK 상태 해제 오류:', error);
      return false;
    }
  }

  /**
   * 모든 AFK 사용자 조회
   */
  async getAllAfkUsers() {
    try {
      const result = await this.query(`
        SELECT a.user_id as "userId", u.display_name as "displayName",
               a.afk_until as "afkUntil", COALESCE(ua.total_time_ms, 0) as "totalTime"
        FROM afk_status a
        JOIN users u ON a.user_id = u.id
        LEFT JOIN user_activities ua ON a.user_id = ua.user_id
        WHERE a.afk_until > CURRENT_TIMESTAMP
        ORDER BY a.afk_until
      `);

      return result.rows;
    } catch (error) {
      console.error('[PostgreSQL] 전체 AFK 사용자 조회 오류:', error);
      return [];
    }
  }

  /**
   * 만료된 AFK 상태 확인 및 해제
   */
  async clearExpiredAfkStatus() {
    try {
      const result = await this.query(`
        DELETE FROM afk_status 
        WHERE afk_until <= CURRENT_TIMESTAMP
        RETURNING user_id
      `);

      return result.rows.map(row => row.user_id);
    } catch (error) {
      console.error('[PostgreSQL] 만료된 AFK 상태 처리 오류:', error);
      return [];
    }
  }

  // ======== 호환성을 위한 메서드 ========

  /**
   * 데이터 새로고침 (PostgreSQL에서는 불필요하지만 호환성 유지)
   */
  forceReload() {
    // PostgreSQL은 자동으로 최신 데이터를 반환하므로 아무 작업 없음
    return;
  }

  /**
   * 데이터 새로고침 (호환성)
   */
  reloadData() {
    this.forceReload();
  }

  /**
   * 스마트 캐싱 (PostgreSQL에서는 불필요하지만 호환성 유지)
   */
  smartReload(forceReload = false) {
    // PostgreSQL 자체 캐싱 및 쿼리 옵티마이저가 처리
    return;
  }

  /**
   * 캐시 무효화 (호환성)
   */
  invalidateCache() {
    // PostgreSQL에서는 캐시 관리가 자동으로 처리됨
    return;
  }
}