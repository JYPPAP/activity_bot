// src/services/DatabaseManager.js - PostgreSQL 버전
// Facade 패턴: Repository들에 위임하여 하위 호환성 유지
import pkg from 'pg';
import {logger} from '../config/logger-termux.js';
import {config} from '../config/env.js';
import {ActivityRepository} from '../repositories/ActivityRepository.js';
import {ForumRepository} from '../repositories/ForumRepository.js';
import {ConfigRepository} from '../repositories/ConfigRepository.js';
import {AfkRepository} from '../repositories/AfkRepository.js';

const {Pool} = pkg;

export class DatabaseManager {
  constructor() {
    this.pool = null;
    this.isInitialized = false;

    // 캐싱 시스템 (성능 최적화용)
    this.cache = new Map();
    this.cacheTimeout = 30000; // 30초 캐시 유지
    this.lastCacheTime = 0;

    // Repository 인스턴스 초기화
    this.activityRepo = new ActivityRepository(this);
    this.forumRepo = new ForumRepository(this);
    this.configRepo = new ConfigRepository(this);
    this.afkRepo = new AfkRepository(this);
  }

  // ================================================================
  // Core 메서드 (DatabaseManager 고유 - 위임하지 않음)
  // ================================================================

  /**
   * 데이터베이스 연결 풀 초기화
   */
  async initialize() {
    try {
      if (!config.DATABASE_URL) {
        throw new Error('DATABASE_URL 환경 변수가 설정되지 않았습니다.');
      }

      this.pool = new Pool({
        connectionString: config.DATABASE_URL,
        min: 2,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
        ssl: process.env.NODE_ENV === 'production' ? {rejectUnauthorized: false} : false
      });

      // 연결 테스트
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();

      // 참가자 테이블 마이그레이션 실행 (pool 생성 후, isInitialized 설정 전)
      // query()는 this.pool 존재 여부로 가드하므로 이 시점에 호출 가능
      await this.forumRepo.ensureForumParticipantsTable();

      // 모든 초기화 완료 후 플래그 설정 — 부분 실패 시 상태 불일치 방지
      this.isInitialized = true;
      logger.databaseOperation('PostgreSQL 연결 풀 초기화 완료', {
        min: 2, max: 10, ssl: process.env.NODE_ENV === 'production'
      });

      return true;
    } catch (error) {
      logger.error('데이터베이스 초기화 실패', {error: error.message, stack: error.stack});
      throw error;
    }
  }

  /**
   * 연결 풀 종료
   */
  async close() {
    try {
      if (this.pool) {
        await this.pool.end();
        this.isInitialized = false;
        logger.databaseOperation('PostgreSQL 연결 풀 종료 완료');
      }
      return true;
    } catch (error) {
      logger.error('데이터베이스 종료 실패', {error: error.message, stack: error.stack});
      throw error;
    }
  }

  /**
   * 데이터베이스 쿼리 실행 (기본)
   */
  async query(text, params = []) {
    // isInitialized 대신 pool 존재 여부로 가드
    // → initialize() 내부에서 ensureForumParticipantsTable()이 query()를 호출할 수 있도록 허용
    // → isInitialized는 모든 초기화 완료 후에만 true가 되어 외부 호출과 구분
    if (!this.pool) {
      throw new Error('데이터베이스가 초기화되지 않았습니다.');
    }

    try {
      const start = Date.now();
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;

      logger.debug('PostgreSQL 쿼리 실행', {
        query: text.substring(0, 100),
        params: params.length,
        duration: `${duration}ms`,
        rows: result.rowCount
      });

      return result;
    } catch (error) {
      logger.error('PostgreSQL 쿼리 실행 실패', {
        error: error.message,
        query: text.substring(0, 100),
        params: params.length
      });
      throw error;
    }
  }

  /**
   * 트랜잭션 실행
   */
  async transaction(callback) {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('트랜잭션 롤백', {error: error.message});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 월별 활동 테이블 자동 생성
   */
  async ensureMonthlyTable(date = new Date()) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const tableSuffix = `${year}${month}`;
    const tableName = `user_activities_${tableSuffix}`;

    try {
      await this.query(`
        SELECT create_monthly_activity_table($1) as result
      `, [tableSuffix]);

      logger.debug('월별 테이블 확인/생성', {tableName});
      return tableName;
    } catch (error) {
      logger.error('월별 테이블 생성 실패', {tableName, error: error.message});
      throw error;
    }
  }

  /**
   * 스마트 캐싱 시스템
   */
  getCached(key, getter) {
    const now = Date.now();

    if ((now - this.lastCacheTime) > this.cacheTimeout) {
      this.cache.clear();
      this.lastCacheTime = now;
    }

    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    const data = getter();
    this.cache.set(key, data);
    return data;
  }

  /**
   * 캐시 무효화
   */
  invalidateCache() {
    this.cache.clear();
    this.lastCacheTime = Date.now();
  }

  // ================================================================
  // 사용자 관리 메서드 (DatabaseManager 고유 - 여러 Repository에서 공용)
  // ================================================================

  /**
   * 사용자 정보 조회/생성
   */
  async ensureUser(userId, username, guildId) {
    try {
      const result = await this.query(`
          INSERT INTO users (user_id, username, guild_id)
          VALUES ($1, $2, $3) ON CONFLICT (user_id)
        DO
          UPDATE SET
              username = EXCLUDED.username,
              updated_at = CURRENT_TIMESTAMP
              RETURNING *
      `, [userId, username, guildId]);

      return result.rows[0];
    } catch (error) {
      logger.error('사용자 생성/조회 실패', {userId, error: error.message});
      throw error;
    }
  }

  /**
   * 사용자 정보 조회
   */
  async getUserById(userId) {
    try {
      const result = await this.query(`
          SELECT *
          FROM users
          WHERE user_id = $1
      `, [userId]);

      return result.rows[0] || null;
    } catch (error) {
      logger.error('사용자 조회 실패', {userId, error: error.message});
      throw error;
    }
  }

  /**
   * 데이터 존재 확인 (호환성)
   */
  async hasAnyData() {
    try {
      const result = await this.query('SELECT COUNT(*) as count FROM users');
      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      logger.error('데이터 존재 확인 실패', {error: error.message});
      return false;
    }
  }

  // ================================================================
  // ActivityRepository 위임 메서드
  // ================================================================

  async updateDailyActivity(...args) { return this.activityRepo.updateDailyActivity(...args); }
  async getUserActivityByDateRange(...args) { return this.activityRepo.getUserActivityByDateRange(...args); }
  async getUserDailyActivityByDateRange(...args) { return this.activityRepo.getUserDailyActivityByDateRange(...args); }
  formatMinutesToTime(minutes) { return this.activityRepo.formatMinutesToTime(minutes); }
  async getAllUserActivity() { return this.activityRepo.getAllUserActivity(); }
  async getUserTotalActivityMinutes(...args) { return this.activityRepo.getUserTotalActivityMinutes(...args); }
  async getAllActiveUsersThisMonth(...args) { return this.activityRepo.getAllActiveUsersThisMonth(...args); }
  async getUserActivity(...args) { return this.activityRepo.getUserActivity(...args); }
  async updateUserActivity(...args) { return this.activityRepo.updateUserActivity(...args); }
  async getDailyActivityStats(...args) { return this.activityRepo.getDailyActivityStats(...args); }
  async getActivityLogs(...args) { return this.activityRepo.getActivityLogs(...args); }

  // ================================================================
  // ConfigRepository 위임 메서드
  // ================================================================

  async getGuildSettings(...args) { return this.configRepo.getGuildSettings(...args); }
  async updateGuildSettings(...args) { return this.configRepo.updateGuildSettings(...args); }
  async getRoleConfig(...args) { return this.configRepo.getRoleConfig(...args); }
  async updateRoleConfig(...args) { return this.configRepo.updateRoleConfig(...args); }
  async getAllRoleConfigs() { return this.configRepo.getAllRoleConfigs(); }
  async updateRoleResetTime(...args) { return this.configRepo.updateRoleResetTime(...args); }

  // ================================================================
  // AfkRepository 위임 메서드
  // ================================================================

  async setUserAfkStatus(...args) { return this.afkRepo.setUserAfkStatus(...args); }
  async getUserAfkStatus(...args) { return this.afkRepo.getUserAfkStatus(...args); }
  async clearUserAfkStatus(...args) { return this.afkRepo.clearUserAfkStatus(...args); }
  async getAllAfkUsers() { return this.afkRepo.getAllAfkUsers(); }
  async clearExpiredAfkStatus() { return this.afkRepo.clearExpiredAfkStatus(); }

  // ================================================================
  // ForumRepository 위임 메서드
  // ================================================================

  async createPostIntegration(...args) { return this.forumRepo.createPostIntegration(...args); }
  async getPostIntegration(...args) { return this.forumRepo.getPostIntegration(...args); }
  async deactivatePostIntegration(...args) { return this.forumRepo.deactivatePostIntegration(...args); }
  async addForumMessageId(...args) { return this.forumRepo.addForumMessageId(...args); }
  async getForumMessageIds(...args) { return this.forumRepo.getForumMessageIds(...args); }
  async getOrCreateForumRecord(...args) { return this.forumRepo.getOrCreateForumRecord(...args); }
  async createDefaultForumRecord(...args) { return this.forumRepo.createDefaultForumRecord(...args); }
  async linkVoiceChannel(...args) { return this.forumRepo.linkVoiceChannel(...args); }
  async setStandaloneMode(...args) { return this.forumRepo.setStandaloneMode(...args); }
  async trackForumMessage(...args) { return this.forumRepo.trackForumMessage(...args); }
  async getTrackedMessages(...args) { return this.forumRepo.getTrackedMessages(...args); }
  async clearTrackedMessages(...args) { return this.forumRepo.clearTrackedMessages(...args); }
  async ensureForumMapping(...args) { return this.forumRepo.ensureForumMapping(...args); }
  async getActiveMappingsByForumState(...args) { return this.forumRepo.getActiveMappingsByForumState(...args); }
  async getForumPostInfo(...args) { return this.forumRepo.getForumPostInfo(...args); }
  async ensureForumParticipantsTable() { return this.forumRepo.ensureForumParticipantsTable(); }
  async addParticipant(...args) { return this.forumRepo.addParticipant(...args); }
  async removeParticipant(...args) { return this.forumRepo.removeParticipant(...args); }
  async getParticipants(...args) { return this.forumRepo.getParticipants(...args); }
  async getParticipantNicknames(...args) { return this.forumRepo.getParticipantNicknames(...args); }
  async isParticipant(...args) { return this.forumRepo.isParticipant(...args); }
  async getParticipantCount(...args) { return this.forumRepo.getParticipantCount(...args); }
  async clearParticipants(...args) { return this.forumRepo.clearParticipants(...args); }
  async getAllActiveParticipants() { return this.forumRepo.getAllActiveParticipants(); }

  // 채널 매핑 호환성
  async saveChannelMapping(...args) { return this.forumRepo.saveChannelMapping(...args); }
  async getChannelMapping(...args) { return this.forumRepo.getChannelMapping(...args); }
  async removeChannelMapping(...args) { return this.forumRepo.removeChannelMapping(...args); }
  async updateLastParticipantCount(...args) { return this.forumRepo.updateLastParticipantCount(...args); }
  async getAllChannelMappings() { return this.forumRepo.getAllChannelMappings(); }

  // ================================================================
  // 레거시 호환성 스텁 메서드 (DatabaseManager 고유)
  // ================================================================

  // Transaction 관련 (Pool에서 자동 관리)
  async beginTransaction() { return true; }
  async commitTransaction() { return true; }
  async rollbackTransaction() { return true; }

  // Migration 관련
  async migrateFromJSON(activityData, roleConfigData) {
    logger.info('JSON 마이그레이션은 새로운 PostgreSQL 구조에서 지원하지 않습니다.');
    return true;
  }

  // 캐시 관련 호환성
  reloadData() { this.invalidateCache(); }
  forceReload() { this.invalidateCache(); }
  smartReload() { this.invalidateCache(); }
}
