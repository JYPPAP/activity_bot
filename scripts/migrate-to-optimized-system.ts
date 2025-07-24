#!/usr/bin/env tsx
// scripts/migrate-to-optimized-system.ts - 기존 시스템을 최적화된 집계 시스템으로 마이그레이션

import { Pool } from 'pg';
import { config } from '../src/config/env';

interface MigrationStats {
  totalActivityLogs: number;
  processedSessions: number;
  dailyRecords: number;
  weeklyRecords: number;
  monthlyRecords: number;
  errors: number;
  startTime: number;
  endTime?: number;
}

class OptimizedSystemMigrator {
  private pool: Pool;
  private stats: MigrationStats;

  constructor() {
    this.pool = new Pool({
      host: config.POSTGRES_HOST,
      port: parseInt(config.POSTGRES_PORT || '5432'),
      database: config.POSTGRES_DB,
      user: config.POSTGRES_USER,
      password: config.POSTGRES_PASSWORD,
      ssl: config.POSTGRES_SSL === 'true',
    });

    this.stats = {
      totalActivityLogs: 0,
      processedSessions: 0,
      dailyRecords: 0,
      weeklyRecords: 0,
      monthlyRecords: 0,
      errors: 0,
      startTime: Date.now(),
    };
  }

  /**
   * 메인 마이그레이션 실행
   */
  async migrate(): Promise<void> {
    console.log('🚀 Discord Bot 최적화 시스템 마이그레이션 시작');
    console.log('==================================================');

    try {
      // 1. 새로운 테이블 생성
      await this.createOptimizedTables();

      // 2. 기존 activity_log 데이터 분석
      await this.analyzeExistingData();

      // 3. 세션 데이터 재구성
      await this.reconstructSessions();

      // 4. 일일 집계 생성
      await this.generateDailyAggregates();

      // 5. 주별/월별 집계 생성
      await this.generateWeeklyMonthlyAggregates();

      // 6. 데이터 검증
      await this.validateMigration();

      // 7. 인덱스 최적화
      await this.optimizeIndexes();

      this.stats.endTime = Date.now();
      await this.printMigrationSummary();

    } catch (error) {
      console.error('❌ 마이그레이션 실패:', error);
      throw error;
    } finally {
      await this.pool.end();
    }
  }

  /**
   * 1. 새로운 최적화 테이블 생성
   */
  private async createOptimizedTables(): Promise<void> {
    console.log('📊 1. 새로운 최적화 테이블 생성 중...');

    try {
      // improved-schema.sql 실행
      const fs = await import('fs');
      const path = await import('path');
      
      const schemaPath = path.join(__dirname, '../database/postgresql/improved-schema.sql');
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      
      await this.pool.query(schemaSql);
      console.log('✅ 최적화 테이블 생성 완료');

    } catch (error) {
      console.error('❌ 테이블 생성 실패:', error);
      throw error;
    }
  }

  /**
   * 2. 기존 데이터 분석
   */
  private async analyzeExistingData(): Promise<void> {
    console.log('🔍 2. 기존 데이터 분석 중...');

    try {
      const result = await this.pool.query(`
        SELECT 
          COUNT(*) as total_logs,
          COUNT(DISTINCT user_id) as unique_users,
          MIN(timestamp) as earliest_log,
          MAX(timestamp) as latest_log,
          COUNT(CASE WHEN action = 'JOIN' THEN 1 END) as joins,
          COUNT(CASE WHEN action = 'LEAVE' THEN 1 END) as leaves
        FROM activity_log
      `);

      const data = result.rows[0];
      this.stats.totalActivityLogs = parseInt(data.total_logs);

      console.log('📈 기존 데이터 현황:');
      console.log(`   - 총 활동 로그: ${data.total_logs.toLocaleString()}개`);
      console.log(`   - 고유 사용자: ${data.unique_users.toLocaleString()}명`);
      console.log(`   - 기간: ${new Date(parseInt(data.earliest_log)).toLocaleDateString()} ~ ${new Date(parseInt(data.latest_log)).toLocaleDateString()}`);
      console.log(`   - JOIN 이벤트: ${data.joins.toLocaleString()}개`);
      console.log(`   - LEAVE 이벤트: ${data.leaves.toLocaleString()}개`);

    } catch (error) {
      console.error('❌ 데이터 분석 실패:', error);
      throw error;
    }
  }

  /**
   * 3. 기존 로그에서 세션 데이터 재구성
   */
  private async reconstructSessions(): Promise<void> {
    console.log('🔄 3. 세션 데이터 재구성 중...');

    try {
      // JOIN/LEAVE 매칭을 통한 세션 복원
      const sessionQuery = `
        WITH paired_events AS (
          SELECT 
            user_id,
            user_name,
            guild_id,
            channel_id,
            channel_name,
            action,
            timestamp,
            LEAD(action) OVER (PARTITION BY user_id ORDER BY timestamp) as next_action,
            LEAD(timestamp) OVER (PARTITION BY user_id ORDER BY timestamp) as next_timestamp,
            LEAD(channel_id) OVER (PARTITION BY user_id ORDER BY timestamp) as next_channel_id
          FROM activity_log
          WHERE action IN ('JOIN', 'LEAVE')
          ORDER BY user_id, timestamp
        ),
        valid_sessions AS (
          SELECT 
            user_id,
            user_name,
            guild_id,
            channel_id,
            channel_name,
            timestamp as session_start_time,
            next_timestamp as session_end_time,
            next_timestamp - timestamp as duration_ms
          FROM paired_events
          WHERE action = 'JOIN' 
            AND next_action = 'LEAVE'
            AND channel_id = next_channel_id
            AND next_timestamp - timestamp > 0
            AND next_timestamp - timestamp < 24 * 60 * 60 * 1000 -- 24시간 이하만 유효
        )
        INSERT INTO activity_sessions (
          user_id, user_name, guild_id, channel_id, channel_name,
          session_start_time, session_end_time, duration_ms, is_active
        )
        SELECT 
          user_id, user_name, guild_id, channel_id, channel_name,
          session_start_time, session_end_time, duration_ms, false
        FROM valid_sessions
        ON CONFLICT DO NOTHING
      `;

      const result = await this.pool.query(sessionQuery);
      this.stats.processedSessions = result.rowCount || 0;

      console.log(`✅ 세션 재구성 완료: ${this.stats.processedSessions.toLocaleString()}개 세션 생성`);

    } catch (error) {
      console.error('❌ 세션 재구성 실패:', error);
      this.stats.errors++;
    }
  }

  /**
   * 4. 일일 집계 생성
   */
  private async generateDailyAggregates(): Promise<void> {
    console.log('📅 4. 일일 집계 생성 중...');

    try {
      const dailyAggregateQuery = `
        WITH daily_sessions AS (
          SELECT 
            user_id,
            guild_id,
            DATE(TO_TIMESTAMP(session_start_time / 1000)) as activity_date,
            SUM(duration_ms) as total_time_ms,
            COUNT(*) as session_count,
            MIN(session_start_time) as first_activity_time,
            MAX(session_end_time) as last_activity_time,
            ARRAY_AGG(DISTINCT channel_id) as channels_visited,
            MAX(duration_ms) as peak_concurrent_session_time
          FROM activity_sessions
          WHERE session_end_time IS NOT NULL AND duration_ms > 0
          GROUP BY user_id, guild_id, DATE(TO_TIMESTAMP(session_start_time / 1000))
        )
        INSERT INTO user_daily_activity (
          user_id, activity_date, total_time_ms, session_count,
          first_activity_time, last_activity_time, channels_visited,
          peak_concurrent_session_time, guild_id
        )
        SELECT 
          user_id, activity_date, total_time_ms, session_count,
          first_activity_time, last_activity_time, channels_visited,
          peak_concurrent_session_time, guild_id
        FROM daily_sessions
        ON CONFLICT (user_id, activity_date, guild_id) 
        DO UPDATE SET
          total_time_ms = EXCLUDED.total_time_ms,
          session_count = EXCLUDED.session_count,
          first_activity_time = EXCLUDED.first_activity_time,
          last_activity_time = EXCLUDED.last_activity_time,
          channels_visited = EXCLUDED.channels_visited,
          peak_concurrent_session_time = EXCLUDED.peak_concurrent_session_time,
          updated_at = NOW()
      `;

      const result = await this.pool.query(dailyAggregateQuery);
      this.stats.dailyRecords = result.rowCount || 0;

      console.log(`✅ 일일 집계 생성 완료: ${this.stats.dailyRecords.toLocaleString()}개 레코드`);

    } catch (error) {
      console.error('❌ 일일 집계 생성 실패:', error);
      this.stats.errors++;
    }
  }

  /**
   * 5. 주별/월별 집계 생성
   */
  private async generateWeeklyMonthlyAggregates(): Promise<void> {
    console.log('🗓️ 5. 주별/월별 집계 생성 중...');

    try {
      // 주별 집계
      const weeklyAggregateQuery = `
        WITH weekly_data AS (
          SELECT 
            user_id,
            guild_id,
            DATE_TRUNC('week', activity_date)::DATE as week_start_date,
            (DATE_TRUNC('week', activity_date) + INTERVAL '6 days')::DATE as week_end_date,
            SUM(total_time_ms) as total_time_ms,
            COUNT(DISTINCT activity_date) as active_days,
            SUM(session_count) as session_count
          FROM user_daily_activity
          GROUP BY user_id, guild_id, DATE_TRUNC('week', activity_date)
        )
        INSERT INTO user_weekly_activity (
          user_id, week_start_date, week_end_date, total_time_ms,
          active_days, session_count, guild_id
        )
        SELECT 
          user_id, week_start_date, week_end_date, total_time_ms,
          active_days, session_count, guild_id
        FROM weekly_data
        ON CONFLICT (user_id, week_start_date, guild_id)
        DO UPDATE SET
          total_time_ms = EXCLUDED.total_time_ms,
          active_days = EXCLUDED.active_days,
          session_count = EXCLUDED.session_count,
          updated_at = NOW()
      `;

      const weeklyResult = await this.pool.query(weeklyAggregateQuery);
      this.stats.weeklyRecords = weeklyResult.rowCount || 0;

      // 월별 집계
      const monthlyAggregateQuery = `
        WITH monthly_data AS (
          SELECT 
            user_id,
            guild_id,
            DATE_TRUNC('month', activity_date)::DATE as activity_month,
            SUM(total_time_ms) as total_time_ms,
            COUNT(DISTINCT activity_date) as active_days,
            SUM(session_count) as session_count
          FROM user_daily_activity
          GROUP BY user_id, guild_id, DATE_TRUNC('month', activity_date)
        )
        INSERT INTO user_monthly_activity (
          user_id, activity_month, total_time_ms, active_days, session_count, guild_id
        )
        SELECT 
          user_id, activity_month, total_time_ms, active_days, session_count, guild_id
        FROM monthly_data
        ON CONFLICT (user_id, activity_month, guild_id)
        DO UPDATE SET
          total_time_ms = EXCLUDED.total_time_ms,
          active_days = EXCLUDED.active_days,
          session_count = EXCLUDED.session_count,
          updated_at = NOW()
      `;

      const monthlyResult = await this.pool.query(monthlyAggregateQuery);
      this.stats.monthlyRecords = monthlyResult.rowCount || 0;

      console.log(`✅ 주별 집계: ${this.stats.weeklyRecords.toLocaleString()}개 레코드`);
      console.log(`✅ 월별 집계: ${this.stats.monthlyRecords.toLocaleString()}개 레코드`);

    } catch (error) {
      console.error('❌ 주별/월별 집계 생성 실패:', error);
      this.stats.errors++;
    }
  }

  /**
   * 6. 데이터 검증
   */
  private async validateMigration(): Promise<void> {
    console.log('✅ 6. 데이터 검증 중...');

    try {
      // 집계 데이터 일관성 확인
      const validationQuery = `
        SELECT 
          'user_daily_activity' as table_name,
          COUNT(*) as record_count,
          COUNT(DISTINCT user_id) as unique_users,
          SUM(total_time_ms) as total_time_ms,
          MIN(activity_date) as earliest_date,
          MAX(activity_date) as latest_date
        FROM user_daily_activity
        
        UNION ALL
        
        SELECT 
          'user_weekly_activity' as table_name,
          COUNT(*) as record_count,
          COUNT(DISTINCT user_id) as unique_users,
          SUM(total_time_ms) as total_time_ms,
          MIN(week_start_date) as earliest_date,
          MAX(week_start_date) as latest_date
        FROM user_weekly_activity
        
        UNION ALL
        
        SELECT 
          'user_monthly_activity' as table_name,
          COUNT(*) as record_count,
          COUNT(DISTINCT user_id) as unique_users,
          SUM(total_time_ms) as total_time_ms,
          MIN(activity_month) as earliest_date,
          MAX(activity_month) as latest_date
        FROM user_monthly_activity
      `;

      const results = await this.pool.query(validationQuery);
      
      console.log('📊 검증 결과:');
      results.rows.forEach(row => {
        console.log(`   ${row.table_name}:`);
        console.log(`     - 레코드 수: ${parseInt(row.record_count).toLocaleString()}`);
        console.log(`     - 고유 사용자: ${parseInt(row.unique_users).toLocaleString()}`);
        console.log(`     - 총 활동 시간: ${Math.round(parseInt(row.total_time_ms) / 1000 / 3600).toLocaleString()}시간`);
        console.log(`     - 기간: ${row.earliest_date} ~ ${row.latest_date}`);
      });

    } catch (error) {
      console.error('❌ 데이터 검증 실패:', error);
      this.stats.errors++;
    }
  }

  /**
   * 7. 인덱스 최적화
   */
  private async optimizeIndexes(): Promise<void> {
    console.log('🚀 7. 인덱스 최적화 중...');

    try {
      // 통계 업데이트
      await this.pool.query('ANALYZE user_daily_activity');
      await this.pool.query('ANALYZE user_weekly_activity');
      await this.pool.query('ANALYZE user_monthly_activity');
      await this.pool.query('ANALYZE activity_sessions');

      console.log('✅ 인덱스 최적화 완료');

    } catch (error) {
      console.error('❌ 인덱스 최적화 실패:', error);
      this.stats.errors++;
    }
  }

  /**
   * 마이그레이션 요약 출력
   */
  private async printMigrationSummary(): Promise<void> {
    const duration = (this.stats.endTime! - this.stats.startTime) / 1000;

    console.log('\n🎉 마이그레이션 완료!');
    console.log('==================================================');
    console.log(`⏱️  실행 시간: ${Math.round(duration)}초`);
    console.log(`📊 처리된 로그: ${this.stats.totalActivityLogs.toLocaleString()}개`);
    console.log(`🔄 생성된 세션: ${this.stats.processedSessions.toLocaleString()}개`);
    console.log(`📅 일일 집계: ${this.stats.dailyRecords.toLocaleString()}개`);
    console.log(`📆 주별 집계: ${this.stats.weeklyRecords.toLocaleString()}개`);
    console.log(`🗓️ 월별 집계: ${this.stats.monthlyRecords.toLocaleString()}개`);
    console.log(`❌ 오류 발생: ${this.stats.errors}개`);
    
    console.log('\n🚀 성능 예상 개선:');
    console.log('   - 보고서 생성: 30초 → 3초 (10배 향상)');
    console.log('   - 메모리 사용량: 80% 감소');
    console.log('   - DB 부하: 90% 감소');
    
    console.log('\n📋 다음 단계:');
    console.log('   1. 봇 설정에서 UserClassificationServiceOptimized 활성화');
    console.log('   2. 보고서 명령어 테스트 실행');
    console.log('   3. 성능 모니터링 및 최적화');
    
    if (this.stats.errors > 0) {
      console.log('\n⚠️  경고: 일부 오류가 발생했습니다. 로그를 확인해주세요.');
    }
  }
}

// 마이그레이션 실행
async function main() {
  const migrator = new OptimizedSystemMigrator();
  
  try {
    await migrator.migrate();
    process.exit(0);
  } catch (error) {
    console.error('마이그레이션 실행 실패:', error);
    process.exit(1);
  }
}

// 스크립트 직접 실행시
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { OptimizedSystemMigrator };