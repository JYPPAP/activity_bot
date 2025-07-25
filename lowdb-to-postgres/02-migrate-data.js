#!/usr/bin/env node
// LowDB to PostgreSQL Data Migration Script
// Migrates existing activity_bot.json data to PostgreSQL

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const LOWDB_FILE = path.join(__dirname, '..', 'activity_bot.json');
const BACKUP_DIR = path.join(__dirname, 'backups');

class PostgreSQLMigrator {
  constructor(connectionConfig) {
    this.pool = new Pool(connectionConfig);
    this.client = null;
  }

  async connect() {
    this.client = await this.pool.connect();
    console.log('✅ PostgreSQL 연결 성공');
  }

  async disconnect() {
    if (this.client) {
      this.client.release();
    }
    await this.pool.end();
    console.log('✅ PostgreSQL 연결 종료');
  }

  async loadLowDBData() {
    if (!fs.existsSync(LOWDB_FILE)) {
      throw new Error(`LowDB 파일을 찾을 수 없습니다: ${LOWDB_FILE}`);
    }

    const data = JSON.parse(fs.readFileSync(LOWDB_FILE, 'utf8'));
    console.log('✅ LowDB 데이터 로드 완료');
    
    return {
      userActivity: data.user_activity || {},
      roleConfig: data.role_config || {},
      activityLogs: data.activity_logs || [],
      resetHistory: data.reset_history || [],
      logMembers: data.log_members || {},
      afkStatus: data.afk_status || {},
      forumMessages: data.forum_messages || {},
      voiceChannelMappings: data.voice_channel_mappings || {}
    };
  }

  async createBackup() {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `lowdb-backup-${timestamp}.json`);
    
    fs.copyFileSync(LOWDB_FILE, backupFile);
    console.log(`✅ 백업 생성: ${backupFile}`);
    
    return backupFile;
  }

  async migrateUsers(userActivity) {
    console.log('👥 사용자 데이터 마이그레이션 시작...');
    
    const users = Object.values(userActivity);
    let migratedCount = 0;

    for (const user of users) {
      try {
        await this.client.query(`
          INSERT INTO users (id, display_name, created_at, updated_at)
          VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            updated_at = CURRENT_TIMESTAMP
        `, [user.userId, user.displayName]);

        migratedCount++;
      } catch (error) {
        console.error(`❌ 사용자 마이그레이션 오류 (${user.userId}):`, error.message);
      }
    }

    console.log(`✅ 사용자 마이그레이션 완료: ${migratedCount}/${users.length}`);
  }

  async migrateRoles(roleConfig) {
    console.log('🎭 역할 데이터 마이그레이션 시작...');
    
    const roles = Object.values(roleConfig);
    let migratedCount = 0;

    for (const role of roles) {
      try {
        await this.client.query(`
          INSERT INTO roles (name, min_hours, report_cycle, created_at, updated_at)
          VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (name) DO UPDATE SET
            min_hours = EXCLUDED.min_hours,
            report_cycle = EXCLUDED.report_cycle,
            updated_at = CURRENT_TIMESTAMP
        `, [role.roleName, role.minHours, role.reportCycle || 1]);

        migratedCount++;
      } catch (error) {
        console.error(`❌ 역할 마이그레이션 오류 (${role.roleName}):`, error.message);
      }
    }

    console.log(`✅ 역할 마이그레이션 완료: ${migratedCount}/${roles.length}`);
  }

  async migrateUserActivities(userActivity) {
    console.log('📊 사용자 활동 데이터 마이그레이션 시작...');
    
    const activities = Object.values(userActivity);
    let migratedCount = 0;

    for (const activity of activities) {
      try {
        await this.client.query(`
          INSERT INTO user_activities (user_id, total_time_ms, start_time, last_updated)
          VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
          ON CONFLICT (user_id) DO UPDATE SET
            total_time_ms = EXCLUDED.total_time_ms,
            start_time = EXCLUDED.start_time,
            last_updated = CURRENT_TIMESTAMP
        `, [
          activity.userId,
          activity.totalTime || 0,
          activity.startTime ? new Date(activity.startTime) : null
        ]);

        migratedCount++;
      } catch (error) {
        console.error(`❌ 활동 데이터 마이그레이션 오류 (${activity.userId}):`, error.message);
      }
    }

    console.log(`✅ 사용자 활동 마이그레이션 완료: ${migratedCount}/${activities.length}`);
  }

  async migrateActivityLogs(activityLogs, logMembers) {
    console.log('📝 활동 로그 마이그레이션 시작...');
    
    let migratedCount = 0;
    const memberInserts = [];

    for (const log of activityLogs) {
      try {
        // Insert activity log
        const logResult = await this.client.query(`
          INSERT INTO activity_logs (id, user_id, event_type, channel_id, channel_name, members_count, timestamp)
          VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6)
          RETURNING id
        `, [
          log.userId,
          log.eventType,
          log.channelId,
          log.channelName,
          log.membersCount || 0,
          new Date(log.timestamp)
        ]);

        const logId = logResult.rows[0].id;

        // Prepare member inserts for this log
        const members = logMembers[log.id] || [];
        for (const memberId of members) {
          memberInserts.push({
            logId,
            userId: memberId
          });
        }

        migratedCount++;
      } catch (error) {
        console.error(`❌ 활동 로그 마이그레이션 오류:`, error.message);
      }
    }

    // Batch insert log members
    if (memberInserts.length > 0) {
      console.log(`👥 로그 멤버 데이터 마이그레이션 (${memberInserts.length}개)...`);
      
      for (const member of memberInserts) {
        try {
          await this.client.query(`
            INSERT INTO activity_log_members (log_id, user_id)
            VALUES ($1, $2)
            ON CONFLICT (log_id, user_id) DO NOTHING
          `, [member.logId, member.userId]);
        } catch (error) {
          console.error(`❌ 로그 멤버 마이그레이션 오류:`, error.message);
        }
      }
    }

    console.log(`✅ 활동 로그 마이그레이션 완료: ${migratedCount}/${activityLogs.length}`);
  }

  async migrateResetHistory(resetHistory) {
    console.log('🔄 리셋 기록 마이그레이션 시작...');
    
    let migratedCount = 0;

    for (const reset of resetHistory) {
      try {
        await this.client.query(`
          INSERT INTO role_resets (id, role_name, reset_time, reason, created_at)
          VALUES (uuid_generate_v4(), $1, $2, $3, CURRENT_TIMESTAMP)
        `, [
          reset.roleName,
          new Date(reset.resetTime),
          reset.reason || 'Legacy data migration'
        ]);

        migratedCount++;
      } catch (error) {
        console.error(`❌ 리셋 기록 마이그레이션 오류:`, error.message);
      }
    }

    console.log(`✅ 리셋 기록 마이그레이션 완료: ${migratedCount}/${resetHistory.length}`);
  }

  async migrateAfkStatus(afkStatus) {
    console.log('😴 AFK 상태 마이그레이션 시작...');
    
    const afkUsers = Object.entries(afkStatus);
    let migratedCount = 0;

    for (const [userId, status] of afkUsers) {
      try {
        if (status.afkUntil) {
          await this.client.query(`
            INSERT INTO afk_status (user_id, afk_until, created_at, updated_at)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            ON CONFLICT (user_id) DO UPDATE SET
              afk_until = EXCLUDED.afk_until,
              updated_at = CURRENT_TIMESTAMP
          `, [
            userId,
            new Date(status.afkUntil),
            new Date(status.createdAt || Date.now())
          ]);

          migratedCount++;
        }
      } catch (error) {
        console.error(`❌ AFK 상태 마이그레이션 오류 (${userId}):`, error.message);
      }
    }

    console.log(`✅ AFK 상태 마이그레이션 완료: ${migratedCount}/${afkUsers.length}`);
  }

  async migrateForumMessages(forumMessages) {
    console.log('💬 포럼 메시지 마이그레이션 시작...');
    
    const threads = Object.entries(forumMessages);
    let migratedCount = 0;

    for (const [threadId, threadData] of threads) {
      try {
        for (const [messageType, messageIds] of Object.entries(threadData)) {
          for (const messageId of messageIds) {
            await this.client.query(`
              INSERT INTO forum_messages (thread_id, message_type, message_id, created_at)
              VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
              ON CONFLICT (thread_id, message_type, message_id) DO NOTHING
            `, [threadId, messageType, messageId]);

            migratedCount++;
          }
        }
      } catch (error) {
        console.error(`❌ 포럼 메시지 마이그레이션 오류 (${threadId}):`, error.message);
      }
    }

    console.log(`✅ 포럼 메시지 마이그레이션 완료: ${migratedCount}개`);
  }

  async migrateVoiceChannelMappings(voiceChannelMappings) {
    console.log('🔊 음성 채널 매핑 마이그레이션 시작...');
    
    const mappings = Object.entries(voiceChannelMappings);
    let migratedCount = 0;

    for (const [voiceChannelId, mappingData] of mappings) {
      try {
        await this.client.query(`
          INSERT INTO voice_channel_mappings (
            voice_channel_id, forum_post_id, last_participant_count, 
            created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (voice_channel_id) DO UPDATE SET
            forum_post_id = EXCLUDED.forum_post_id,
            last_participant_count = EXCLUDED.last_participant_count,
            updated_at = EXCLUDED.updated_at
        `, [
          voiceChannelId,
          mappingData.forum_post_id,
          mappingData.last_participant_count || 0,
          new Date(mappingData.created_at || Date.now()),
          new Date(mappingData.last_updated || Date.now())
        ]);

        migratedCount++;
      } catch (error) {
        console.error(`❌ 음성 채널 매핑 마이그레이션 오류 (${voiceChannelId}):`, error.message);
      }
    }

    console.log(`✅ 음성 채널 매핑 마이그레이션 완료: ${migratedCount}/${mappings.length}`);
  }

  async validateMigration() {
    console.log('🔍 마이그레이션 검증 시작...');
    
    const checks = [
      { table: 'users', query: 'SELECT COUNT(*) as count FROM users' },
      { table: 'roles', query: 'SELECT COUNT(*) as count FROM roles' },
      { table: 'user_activities', query: 'SELECT COUNT(*) as count FROM user_activities' },
      { table: 'activity_logs', query: 'SELECT COUNT(*) as count FROM activity_logs' },
      { table: 'role_resets', query: 'SELECT COUNT(*) as count FROM role_resets' },
      { table: 'afk_status', query: 'SELECT COUNT(*) as count FROM afk_status' },
      { table: 'forum_messages', query: 'SELECT COUNT(*) as count FROM forum_messages' },
      { table: 'voice_channel_mappings', query: 'SELECT COUNT(*) as count FROM voice_channel_mappings' }
    ];

    for (const check of checks) {
      try {
        const result = await this.client.query(check.query);
        const count = result.rows[0].count;
        console.log(`✅ ${check.table}: ${count}개 레코드`);
      } catch (error) {
        console.error(`❌ ${check.table} 검증 오류:`, error.message);
      }
    }
  }

  async runMigration() {
    try {
      console.log('🚀 LowDB → PostgreSQL 마이그레이션 시작');
      console.log('='.repeat(50));

      // 1. Connect to PostgreSQL
      await this.connect();

      // 2. Create backup
      await this.createBackup();

      // 3. Load LowDB data
      const data = await this.loadLowDBData();

      // 4. Begin transaction
      await this.client.query('BEGIN');

      try {
        // 5. Migrate data in dependency order
        await this.migrateUsers(data.userActivity);
        await this.migrateRoles(data.roleConfig);
        await this.migrateUserActivities(data.userActivity);
        await this.migrateActivityLogs(data.activityLogs, data.logMembers);
        await this.migrateResetHistory(data.resetHistory);
        await this.migrateAfkStatus(data.afkStatus);
        await this.migrateForumMessages(data.forumMessages);
        await this.migrateVoiceChannelMappings(data.voiceChannelMappings);

        // 6. Commit transaction
        await this.client.query('COMMIT');
        console.log('✅ 트랜잭션 커밋 완료');

        // 7. Validate migration
        await this.validateMigration();

        console.log('='.repeat(50));
        console.log('🎉 마이그레이션 성공적으로 완료!');

      } catch (error) {
        await this.client.query('ROLLBACK');
        throw error;
      }

    } catch (error) {
      console.error('💥 마이그레이션 실패:', error);
      throw error;
    } finally {
      await this.disconnect();
    }
  }
}

// Migration execution
async function main() {
  // PostgreSQL connection configuration
  const connectionConfig = {
    user: process.env.POSTGRES_USER || 'discord_bot',
    password: process.env.POSTGRES_PASSWORD || 'password',
    host: process.env.POSTGRES_HOST || 'localhost',
    port: process.env.POSTGRES_PORT || 5432,
    database: process.env.POSTGRES_DB || 'discord_activity_bot',
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false
  };

  console.log(`연결 정보: ${connectionConfig.user}@${connectionConfig.host}:${connectionConfig.port}/${connectionConfig.database}`);

  const migrator = new PostgreSQLMigrator(connectionConfig);
  
  try {
    await migrator.runMigration();
    process.exit(0);
  } catch (error) {
    console.error('마이그레이션 실행 실패:', error);
    process.exit(1);
  }
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default PostgreSQLMigrator;