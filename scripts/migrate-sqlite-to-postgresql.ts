#!/usr/bin/env npx tsx

/**
 * SQLite에서 PostgreSQL로 데이터 마이그레이션 스크립트
 * 
 * 사용법:
 * npm run migrate:sqlite-to-postgresql
 * 또는
 * npx tsx scripts/migrate-sqlite-to-postgresql.ts
 */

import sqlite3 from 'sqlite3';
import { Pool } from 'pg';
import path from 'path';
import fs from 'fs';

// PostgreSQL 연결 설정
const pgConfig = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'discord_bot_dev',
  user: process.env.POSTGRES_USER || 'discord_bot_dev',
  password: process.env.POSTGRES_PASSWORD || 'password_123',
  ssl: process.env.POSTGRES_SSL === 'true',
};

// SQLite 파일 경로
const sqliteDbPath = path.join(process.cwd(), 'activity_bot.sqlite');

interface MigrationStats {
  userActivity: number;
  roleConfig: number;
  activityLog: number;
  afkStatus: number;
  voiceChannelMapping: number;
  errors: string[];
}

/**
 * SQLite 데이터베이스 연결
 */
function connectSQLite(): Promise<sqlite3.Database> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(sqliteDbPath, (err) => {
      if (err) {
        reject(new Error(`SQLite 연결 실패: ${err.message}`));
      } else {
        console.log('✅ SQLite 데이터베이스 연결 성공');
        resolve(db);
      }
    });
  });
}

/**
 * PostgreSQL 데이터베이스 연결
 */
async function connectPostgreSQL(): Promise<Pool> {
  const pool = new Pool(pgConfig);
  
  try {
    // 연결 테스트
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    console.log('✅ PostgreSQL 데이터베이스 연결 성공');
    return pool;
  } catch (error) {
    throw new Error(`PostgreSQL 연결 실패: ${error}`);
  }
}

/**
 * SQLite에서 데이터 조회
 */
function querySQLite(db: sqlite3.Database, sql: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

/**
 * 사용자 활동 데이터 마이그레이션
 */
async function migrateUserActivity(sqliteDb: sqlite3.Database, pgPool: Pool): Promise<number> {
  try {
    console.log('📊 사용자 활동 데이터 마이그레이션 중...');
    
    const rows = await querySQLite(sqliteDb, 'SELECT * FROM user_activity');
    
    if (rows.length === 0) {
      console.log('ℹ️  사용자 활동 데이터가 없습니다.');
      return 0;
    }

    let migratedCount = 0;
    
    for (const row of rows) {
      try {
        await pgPool.query(`
          INSERT INTO user_activity (
            user_id, total_time, start_time, last_update, last_activity, 
            display_name, current_channel_id, session_start_time, 
            daily_time, weekly_time, monthly_time
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (user_id) DO UPDATE SET
            total_time = EXCLUDED.total_time,
            start_time = EXCLUDED.start_time,
            last_update = EXCLUDED.last_update,
            last_activity = EXCLUDED.last_activity,
            display_name = EXCLUDED.display_name,
            current_channel_id = EXCLUDED.current_channel_id,
            session_start_time = EXCLUDED.session_start_time,
            daily_time = EXCLUDED.daily_time,
            weekly_time = EXCLUDED.weekly_time,
            monthly_time = EXCLUDED.monthly_time
        `, [
          row.user_id,
          row.total_time || 0,
          row.start_time || null,
          row.last_update || Date.now(),
          row.last_activity || null,
          row.display_name || null,
          row.current_channel_id || null,
          row.session_start_time || null,
          row.daily_time || 0,
          row.weekly_time || 0,
          row.monthly_time || 0
        ]);
        
        migratedCount++;
      } catch (error) {
        console.error(`❌ 사용자 활동 데이터 마이그레이션 실패 (${row.user_id}):`, error);
      }
    }
    
    console.log(`✅ 사용자 활동 데이터 마이그레이션 완료: ${migratedCount}/${rows.length}`);
    return migratedCount;
  } catch (error) {
    console.error('❌ 사용자 활동 데이터 마이그레이션 실패:', error);
    throw error;
  }
}

/**
 * 역할 설정 데이터 마이그레이션
 */
async function migrateRoleConfig(sqliteDb: sqlite3.Database, pgPool: Pool): Promise<number> {
  try {
    console.log('🔧 역할 설정 데이터 마이그레이션 중...');
    
    const rows = await querySQLite(sqliteDb, 'SELECT * FROM role_config');
    
    if (rows.length === 0) {
      console.log('ℹ️  역할 설정 데이터가 없습니다.');
      return 0;
    }

    let migratedCount = 0;
    
    for (const row of rows) {
      try {
        await pgPool.query(`
          INSERT INTO role_config (
            role_name, min_hours, warning_threshold, allowed_afk_duration
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT (role_name) DO UPDATE SET
            min_hours = EXCLUDED.min_hours,
            warning_threshold = EXCLUDED.warning_threshold,
            allowed_afk_duration = EXCLUDED.allowed_afk_duration
        `, [
          row.role_name || row.roleName, // SQLite에서 컬럼명이 다를 수 있음
          row.min_hours || row.minHours || 0,
          row.warning_threshold || null,
          row.allowed_afk_duration || null
        ]);
        
        migratedCount++;
      } catch (error) {
        console.error(`❌ 역할 설정 데이터 마이그레이션 실패 (${row.role_name || row.roleName}):`, error);
      }
    }
    
    console.log(`✅ 역할 설정 데이터 마이그레이션 완료: ${migratedCount}/${rows.length}`);
    return migratedCount;
  } catch (error) {
    console.error('❌ 역할 설정 데이터 마이그레이션 실패:', error);
    throw error;
  }
}

/**
 * 활동 로그 데이터 마이그레이션
 */
async function migrateActivityLog(sqliteDb: sqlite3.Database, pgPool: Pool): Promise<number> {
  try {
    console.log('📝 활동 로그 데이터 마이그레이션 중...');
    
    // 최근 30일간의 로그만 마이그레이션 (성능 고려)
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const rows = await querySQLite(sqliteDb, 
      `SELECT * FROM activity_log WHERE timestamp > ${thirtyDaysAgo} ORDER BY timestamp DESC LIMIT 10000`
    );
    
    if (rows.length === 0) {
      console.log('ℹ️  최근 활동 로그 데이터가 없습니다.');
      return 0;
    }

    let migratedCount = 0;
    
    for (const row of rows) {
      try {
        await pgPool.query(`
          INSERT INTO activity_log (
            user_id, user_name, channel_id, channel_name, action, 
            timestamp, duration, additional_data
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          row.user_id,
          row.user_name || row.userName || null,
          row.channel_id || row.channelId || null,
          row.channel_name || row.channelName || null,
          row.action,
          row.timestamp,
          row.duration || null,
          row.additional_data || row.additionalData || null
        ]);
        
        migratedCount++;
      } catch (error) {
        console.error(`❌ 활동 로그 데이터 마이그레이션 실패 (ID: ${row.id}):`, error);
      }
    }
    
    console.log(`✅ 활동 로그 데이터 마이그레이션 완료: ${migratedCount}/${rows.length}`);
    return migratedCount;
  } catch (error) {
    console.error('❌ 활동 로그 데이터 마이그레이션 실패:', error);
    return 0; // 로그는 실패해도 계속 진행
  }
}

/**
 * AFK 상태 데이터 마이그레이션
 */
async function migrateAfkStatus(sqliteDb: sqlite3.Database, pgPool: Pool): Promise<number> {
  try {
    console.log('😴 AFK 상태 데이터 마이그레이션 중...');
    
    const rows = await querySQLite(sqliteDb, 'SELECT * FROM afk_status');
    
    if (rows.length === 0) {
      console.log('ℹ️  AFK 상태 데이터가 없습니다.');
      return 0;
    }

    let migratedCount = 0;
    
    for (const row of rows) {
      try {
        await pgPool.query(`
          INSERT INTO afk_status (
            user_id, is_afk, afk_start_time, afk_until, afk_reason, 
            total_afk_time, last_update
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (user_id) DO UPDATE SET
            is_afk = EXCLUDED.is_afk,
            afk_start_time = EXCLUDED.afk_start_time,
            afk_until = EXCLUDED.afk_until,
            afk_reason = EXCLUDED.afk_reason,
            total_afk_time = EXCLUDED.total_afk_time,
            last_update = EXCLUDED.last_update
        `, [
          row.user_id,
          row.is_afk || row.isAfk || false,
          row.afk_start_time || row.afkStartTime || null,
          row.afk_until || row.afkUntil || null,
          row.afk_reason || row.afkReason || null,
          row.total_afk_time || row.totalAfkTime || 0,
          row.last_update || row.lastUpdate || Date.now()
        ]);
        
        migratedCount++;
      } catch (error) {
        console.error(`❌ AFK 상태 데이터 마이그레이션 실패 (${row.user_id}):`, error);
      }
    }
    
    console.log(`✅ AFK 상태 데이터 마이그레이션 완료: ${migratedCount}/${rows.length}`);
    return migratedCount;
  } catch (error) {
    console.error('❌ AFK 상태 데이터 마이그레이션 실패:', error);
    return 0;
  }
}

/**
 * 음성 채널 매핑 데이터 마이그레이션
 */
async function migrateVoiceChannelMapping(sqliteDb: sqlite3.Database, pgPool: Pool): Promise<number> {
  try {
    console.log('🔗 음성 채널 매핑 데이터 마이그레이션 중...');
    
    const rows = await querySQLite(sqliteDb, 'SELECT * FROM voice_channel_mapping');
    
    if (rows.length === 0) {
      console.log('ℹ️  음성 채널 매핑 데이터가 없습니다.');
      return 0;
    }

    let migratedCount = 0;
    
    for (const row of rows) {
      try {
        await pgPool.query(`
          INSERT INTO voice_channel_mapping (
            channel_id, forum_post_id, thread_id, is_active
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT (channel_id) DO UPDATE SET
            forum_post_id = EXCLUDED.forum_post_id,
            thread_id = EXCLUDED.thread_id,
            is_active = EXCLUDED.is_active
        `, [
          row.channel_id || row.channelId,
          row.forum_post_id || row.forumPostId || null,
          row.thread_id || row.threadId || null,
          row.is_active !== undefined ? row.is_active : (row.isActive !== undefined ? row.isActive : true)
        ]);
        
        migratedCount++;
      } catch (error) {
        console.error(`❌ 음성 채널 매핑 데이터 마이그레이션 실패 (${row.channel_id || row.channelId}):`, error);
      }
    }
    
    console.log(`✅ 음성 채널 매핑 데이터 마이그레이션 완료: ${migratedCount}/${rows.length}`);
    return migratedCount;
  } catch (error) {
    console.error('❌ 음성 채널 매핑 데이터 마이그레이션 실패:', error);
    return 0;
  }
}

/**
 * SQLite 테이블 존재 여부 확인
 */
async function checkTableExists(sqliteDb: sqlite3.Database, tableName: string): Promise<boolean> {
  try {
    const result = await querySQLite(sqliteDb, 
      `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`
    );
    return result.length > 0;
  } catch (error) {
    return false;
  }
}

/**
 * 메인 마이그레이션 함수
 */
async function migrateDatabase(): Promise<void> {
  let sqliteDb: sqlite3.Database | null = null;
  let pgPool: Pool | null = null;
  
  try {
    console.log('🚀 SQLite에서 PostgreSQL로 데이터 마이그레이션 시작\n');
    
    // SQLite 파일 존재 확인
    if (!fs.existsSync(sqliteDbPath)) {
      console.log('ℹ️  SQLite 데이터베이스 파일이 존재하지 않습니다. 마이그레이션을 건너뜁니다.');
      return;
    }
    
    // 데이터베이스 연결
    sqliteDb = await connectSQLite();
    pgPool = await connectPostgreSQL();
    
    console.log('\n📋 마이그레이션 대상 테이블 확인 중...');
    
    const tables = [
      'user_activity',
      'role_config', 
      'activity_log',
      'afk_status',
      'voice_channel_mapping'
    ];
    
    const existingTables: string[] = [];
    for (const table of tables) {
      if (await checkTableExists(sqliteDb, table)) {
        existingTables.push(table);
        console.log(`✅ ${table} 테이블 발견`);
      } else {
        console.log(`⚠️  ${table} 테이블 없음`);
      }
    }
    
    if (existingTables.length === 0) {
      console.log('\n⚠️  마이그레이션할 테이블이 없습니다.');
      return;
    }
    
    console.log(`\n🔄 ${existingTables.length}개 테이블 마이그레이션 시작...\n`);
    
    const stats: MigrationStats = {
      userActivity: 0,
      roleConfig: 0,
      activityLog: 0,
      afkStatus: 0,
      voiceChannelMapping: 0,
      errors: []
    };
    
    // 트랜잭션 시작
    await pgPool.query('BEGIN');
    
    try {
      // 데이터 마이그레이션 실행
      if (existingTables.includes('user_activity')) {
        stats.userActivity = await migrateUserActivity(sqliteDb, pgPool);
      }
      
      if (existingTables.includes('role_config')) {
        stats.roleConfig = await migrateRoleConfig(sqliteDb, pgPool);
      }
      
      if (existingTables.includes('activity_log')) {
        stats.activityLog = await migrateActivityLog(sqliteDb, pgPool);
      }
      
      if (existingTables.includes('afk_status')) {
        stats.afkStatus = await migrateAfkStatus(sqliteDb, pgPool);
      }
      
      if (existingTables.includes('voice_channel_mapping')) {
        stats.voiceChannelMapping = await migrateVoiceChannelMapping(sqliteDb, pgPool);
      }
      
      // 트랜잭션 커밋
      await pgPool.query('COMMIT');
      
      console.log('\n🎉 마이그레이션 완료!\n');
      console.log('📊 마이그레이션 통계:');
      console.log(`   👥 사용자 활동: ${stats.userActivity}개`);
      console.log(`   🔧 역할 설정: ${stats.roleConfig}개`);
      console.log(`   📝 활동 로그: ${stats.activityLog}개`);
      console.log(`   😴 AFK 상태: ${stats.afkStatus}개`);
      console.log(`   🔗 음성 채널 매핑: ${stats.voiceChannelMapping}개`);
      
      const totalMigrated = stats.userActivity + stats.roleConfig + stats.activityLog + 
                           stats.afkStatus + stats.voiceChannelMapping;
      
      console.log(`\n✅ 총 ${totalMigrated}개 레코드가 성공적으로 마이그레이션되었습니다.`);
      
      if (stats.errors.length > 0) {
        console.log(`\n⚠️  ${stats.errors.length}개 오류 발생:`);
        stats.errors.forEach((error, index) => {
          console.log(`   ${index + 1}. ${error}`);
        });
      }
      
    } catch (error) {
      // 트랜잭션 롤백
      await pgPool.query('ROLLBACK');
      throw error;
    }
    
  } catch (error) {
    console.error('\n❌ 마이그레이션 실패:', error);
    process.exit(1);
  } finally {
    // 연결 종료
    if (sqliteDb) {
      sqliteDb.close((err) => {
        if (err) console.error('SQLite 연결 종료 실패:', err);
        else console.log('✅ SQLite 연결 종료');
      });
    }
    
    if (pgPool) {
      await pgPool.end();
      console.log('✅ PostgreSQL 연결 종료');
    }
  }
}

/**
 * 스크립트 실행
 */
// ES 모듈에서 직접 실행 감지
const isMainModule = process.argv[1] && process.argv[1].includes('migrate-sqlite-to-postgresql');

if (isMainModule) {
  console.log('🚀 마이그레이션 스크립트 시작...');
  migrateDatabase().catch((error) => {
    console.error('마이그레이션 실행 실패:', error);
    process.exit(1);
  });
}

export { migrateDatabase };