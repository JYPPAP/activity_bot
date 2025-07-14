// JSON에서 SQLite로 데이터 마이그레이션 스크립트

import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';

import { DatabaseInitializer } from './init.js';
import { MigrationStatus } from '../types/sqlite.js';

// 기존 JSON 데이터 구조 타입
interface LegacyUserActivity {
  userId: string;
  totalTime: number;
  startTime: number | null;
  displayName?: string | null;
}

interface LegacyDatabase {
  user_activity: Record<string, LegacyUserActivity>;
  role_config: Record<string, any>;
  activity_logs: any[];
  reset_history: any[];
  log_members: Record<string, any>;
  afk_status: Record<string, any>;
  forum_messages: Record<string, any>;
  voice_channel_mappings: Record<string, any>;
  metadata?: {
    version?: string;
    created_at?: number;
    last_updated?: number;
  };
}

export class DatabaseMigrator {
  private dbPath: string;
  private jsonPath: string;
  private backupPath: string;
  private status: MigrationStatus;

  constructor(jsonPath: string = 'activity_bot.json', dbPath: string = 'activity_bot.sqlite') {
    this.jsonPath = path.resolve(jsonPath);
    this.dbPath = path.resolve(dbPath);
    this.backupPath = path.resolve(`${jsonPath}.backup.${Date.now()}`);

    this.status = {
      isRunning: false,
      progress: 0,
      currentStep: '',
      totalSteps: 8,
      startTime: 0,
      errors: [],
    };
  }

  /**
   * 전체 마이그레이션 프로세스 실행
   */
  async migrate(): Promise<boolean> {
    console.log('🚀 JSON에서 SQLite로 데이터 마이그레이션 시작');
    console.log(`📁 JSON 파일: ${this.jsonPath}`);
    console.log(`📁 SQLite 파일: ${this.dbPath}`);
    console.log(`📁 백업 파일: ${this.backupPath}`);

    this.status.isRunning = true;
    this.status.startTime = Date.now();

    try {
      // 1단계: JSON 파일 검증 및 백업
      await this.updateProgress(1, 'JSON 파일 검증 및 백업');
      const jsonData = await this.validateAndBackupJson();

      // 2단계: SQLite 데이터베이스 초기화
      await this.updateProgress(2, 'SQLite 데이터베이스 초기화');
      const connection = await this.initializeDatabase();

      // 3단계: 사용자 활동 데이터 마이그레이션
      await this.updateProgress(3, '사용자 활동 데이터 마이그레이션');
      await this.migrateUserActivities(connection.db, jsonData.user_activity);

      // 4단계: 활동 로그 마이그레이션
      await this.updateProgress(4, '활동 로그 마이그레이션');
      await this.migrateActivityLogs(connection.db, jsonData.activity_logs);

      // 5단계: 역할 설정 마이그레이션
      await this.updateProgress(5, '역할 설정 마이그레이션');
      await this.migrateRoleConfigs(connection.db, jsonData.role_config);

      // 6단계: 기타 데이터 마이그레이션
      await this.updateProgress(6, '기타 데이터 마이그레이션');
      await this.migrateOtherData(connection.db, jsonData);

      // 7단계: 데이터 무결성 검증
      await this.updateProgress(7, '데이터 무결성 검증');
      await this.verifyMigration(connection.db, jsonData);

      // 8단계: 마이그레이션 완료
      await this.updateProgress(8, '마이그레이션 완료');
      await this.finalizeMigration(connection.db);

      console.log('✅ 마이그레이션 성공적으로 완료!');
      console.log(`⏱️  소요 시간: ${(Date.now() - this.status.startTime) / 1000}초`);

      return true;
    } catch (error) {
      console.error('❌ 마이그레이션 실패:', error);
      this.status.errors.push({
        step: this.status.currentStep,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });
      return false;
    } finally {
      this.status.isRunning = false;
    }
  }

  /**
   * JSON 파일 검증 및 백업
   */
  private async validateAndBackupJson(): Promise<LegacyDatabase> {
    if (!fs.existsSync(this.jsonPath)) {
      throw new Error(`JSON 파일을 찾을 수 없습니다: ${this.jsonPath}`);
    }

    const stats = fs.statSync(this.jsonPath);
    console.log(`📊 JSON 파일 크기: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);

    // JSON 파일 백업
    fs.copyFileSync(this.jsonPath, this.backupPath);
    console.log(`💾 백업 완료: ${this.backupPath}`);

    // JSON 데이터 로드 및 검증
    const rawData = fs.readFileSync(this.jsonPath, 'utf8');
    const jsonData: LegacyDatabase = JSON.parse(rawData);

    // 기본 구조 검증
    if (!jsonData.user_activity) {
      throw new Error('user_activity 데이터가 없습니다');
    }

    const userCount = Object.keys(jsonData.user_activity).length;
    const logCount = jsonData.activity_logs?.length || 0;

    console.log(`👥 사용자 수: ${userCount}`);
    console.log(`📝 활동 로그 수: ${logCount}`);

    return jsonData;
  }

  /**
   * SQLite 데이터베이스 초기화
   */
  private async initializeDatabase() {
    // 기존 SQLite 파일이 있으면 백업
    if (fs.existsSync(this.dbPath)) {
      const sqliteBackupPath = `${this.dbPath}.backup.${Date.now()}`;
      fs.copyFileSync(this.dbPath, sqliteBackupPath);
      console.log(`🗄️  기존 SQLite 백업: ${sqliteBackupPath}`);
      fs.unlinkSync(this.dbPath); // 새로 생성하기 위해 삭제
    }

    const initializer = new DatabaseInitializer({
      database: this.dbPath,
      enableWAL: true,
      cacheSize: 4000, // 마이그레이션 중에는 더 큰 캐시 사용
    });

    return await initializer.initialize();
  }

  /**
   * 사용자 활동 데이터 마이그레이션
   */
  private async migrateUserActivities(
    db: sqlite3.Database,
    userActivities: Record<string, LegacyUserActivity>
  ): Promise<void> {
    const users = Object.entries(userActivities);
    console.log(`👥 ${users.length}명의 사용자 활동 데이터 마이그레이션 중...`);

    const insertSQL = `
      INSERT INTO user_activities (
        user_id, total_time, start_time, display_name, last_updated
      ) VALUES (?, ?, ?, ?, ?)
    `;

    const stmt = await this.prepare(db, insertSQL);
    const currentTime = Date.now();

    try {
      await this.runQuery(db, 'BEGIN TRANSACTION');

      for (const [userId, userData] of users) {
        await this.runStatement(stmt, [
          userId,
          userData.totalTime || 0,
          userData.startTime,
          userData.displayName || null,
          currentTime,
        ]);
      }

      await this.runQuery(db, 'COMMIT');
      console.log(`✅ 사용자 활동 데이터 마이그레이션 완료: ${users.length}건`);
    } catch (error) {
      await this.runQuery(db, 'ROLLBACK');
      throw error;
    } finally {
      stmt.finalize();
    }
  }

  /**
   * 활동 로그 마이그레이션
   */
  private async migrateActivityLogs(db: sqlite3.Database, activityLogs: any[]): Promise<void> {
    if (!activityLogs || activityLogs.length === 0) {
      console.log('📝 활동 로그 데이터가 없습니다. 건너뜁니다.');
      return;
    }

    console.log(`📝 ${activityLogs.length}개의 활동 로그 마이그레이션 중...`);

    const insertSQL = `
      INSERT INTO activity_logs (
        user_id, event_type, timestamp, channel_id, channel_name, 
        guild_id, session_duration, additional_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const stmt = await this.prepare(db, insertSQL);

    try {
      await this.runQuery(db, 'BEGIN TRANSACTION');

      for (const log of activityLogs) {
        await this.runStatement(stmt, [
          log.userId || log.user_id,
          log.eventType || log.event_type || 'unknown',
          log.timestamp || Date.now(),
          log.channelId || log.channel_id || null,
          log.channelName || log.channel_name || null,
          log.guildId || log.guild_id || null,
          log.sessionDuration || log.session_duration || null,
          log.additionalData ? JSON.stringify(log.additionalData) : null,
        ]);
      }

      await this.runQuery(db, 'COMMIT');
      console.log(`✅ 활동 로그 마이그레이션 완료: ${activityLogs.length}건`);
    } catch (error) {
      await this.runQuery(db, 'ROLLBACK');
      throw error;
    } finally {
      stmt.finalize();
    }
  }

  /**
   * 역할 설정 마이그레이션
   */
  private async migrateRoleConfigs(
    db: sqlite3.Database,
    roleConfigs: Record<string, any>
  ): Promise<void> {
    if (!roleConfigs || Object.keys(roleConfigs).length === 0) {
      console.log('🎭 역할 설정 데이터가 없습니다. 건너뜁니다.');
      return;
    }

    const roles = Object.entries(roleConfigs);
    console.log(`🎭 ${roles.length}개의 역할 설정 마이그레이션 중...`);

    const insertSQL = `
      INSERT INTO role_configs (role_id, role_name, config_data)
      VALUES (?, ?, ?)
    `;

    const stmt = await this.prepare(db, insertSQL);

    try {
      await this.runQuery(db, 'BEGIN TRANSACTION');

      for (const [roleId, config] of roles) {
        await this.runStatement(stmt, [
          roleId,
          config.roleName || config.name || null,
          JSON.stringify(config),
        ]);
      }

      await this.runQuery(db, 'COMMIT');
      console.log(`✅ 역할 설정 마이그레이션 완료: ${roles.length}건`);
    } catch (error) {
      await this.runQuery(db, 'ROLLBACK');
      throw error;
    } finally {
      stmt.finalize();
    }
  }

  /**
   * 기타 데이터 마이그레이션 (AFK, 포럼 메시지, 매핑 등)
   */
  private async migrateOtherData(db: sqlite3.Database, jsonData: LegacyDatabase): Promise<void> {
    // AFK 상태 마이그레이션
    if (jsonData.afk_status) {
      await this.migrateAfkStatus(db, jsonData.afk_status);
    }

    // 포럼 메시지 마이그레이션
    if (jsonData.forum_messages) {
      await this.migrateForumMessages(db, jsonData.forum_messages);
    }

    // 음성 채널 매핑 마이그레이션
    if (jsonData.voice_channel_mappings) {
      await this.migrateVoiceChannelMappings(db, jsonData.voice_channel_mappings);
    }

    // 로그 멤버 마이그레이션
    if (jsonData.log_members) {
      await this.migrateLogMembers(db, jsonData.log_members);
    }

    // 리셋 히스토리 마이그레이션
    if (jsonData.reset_history) {
      await this.migrateResetHistory(db, jsonData.reset_history);
    }
  }

  private async migrateAfkStatus(
    db: sqlite3.Database,
    afkData: Record<string, any>
  ): Promise<void> {
    const entries = Object.entries(afkData);
    if (entries.length === 0) return;

    console.log(`😴 ${entries.length}개의 AFK 상태 마이그레이션 중...`);

    const insertSQL = `
      INSERT INTO afk_status (user_id, is_afk, afk_since, reason, auto_afk)
      VALUES (?, ?, ?, ?, ?)
    `;

    const stmt = await this.prepare(db, insertSQL);

    try {
      await this.runQuery(db, 'BEGIN TRANSACTION');

      for (const [userId, afkInfo] of entries) {
        await this.runStatement(stmt, [
          userId,
          afkInfo.isAfk || false,
          afkInfo.afkSince || null,
          afkInfo.reason || null,
          afkInfo.autoAfk || false,
        ]);
      }

      await this.runQuery(db, 'COMMIT');
      console.log(`✅ AFK 상태 마이그레이션 완료: ${entries.length}건`);
    } catch (error) {
      await this.runQuery(db, 'ROLLBACK');
      throw error;
    } finally {
      stmt.finalize();
    }
  }

  // 다른 마이그레이션 메서드들도 유사한 패턴으로 구현...
  private async migrateForumMessages(
    _db: sqlite3.Database,
    _forumData: Record<string, any>
  ): Promise<void> {
    // 포럼 메시지 마이그레이션 로직
    console.log('📝 포럼 메시지 마이그레이션 건너뜀 (필요시 구현)');
  }

  private async migrateVoiceChannelMappings(
    _db: sqlite3.Database,
    _mappingData: Record<string, any>
  ): Promise<void> {
    // 음성 채널 매핑 마이그레이션 로직
    console.log('🔗 음성 채널 매핑 마이그레이션 건너뜀 (필요시 구현)');
  }

  private async migrateLogMembers(
    _db: sqlite3.Database,
    _logData: Record<string, any>
  ): Promise<void> {
    // 로그 멤버 마이그레이션 로직
    console.log('📋 로그 멤버 마이그레이션 건너뜀 (필요시 구현)');
  }

  private async migrateResetHistory(_db: sqlite3.Database, _resetData: any[]): Promise<void> {
    // 리셋 히스토리 마이그레이션 로직
    console.log('🔄 리셋 히스토리 마이그레이션 건너뜀 (필요시 구현)');
  }

  /**
   * 데이터 무결성 검증
   */
  private async verifyMigration(db: sqlite3.Database, originalData: LegacyDatabase): Promise<void> {
    console.log('🔍 데이터 무결성 검증 중...');

    // 사용자 수 검증
    const userCountResult = await this.getQuery(
      db,
      'SELECT COUNT(*) as count FROM user_activities'
    );
    const originalUserCount = Object.keys(originalData.user_activity).length;

    if (userCountResult.count !== originalUserCount) {
      throw new Error(
        `사용자 수 불일치: 원본 ${originalUserCount}, 마이그레이션 ${userCountResult.count}`
      );
    }

    // 총 활동 시간 검증
    const totalTimeResult = await this.getQuery(
      db,
      'SELECT SUM(total_time) as total FROM user_activities'
    );
    const originalTotalTime = Object.values(originalData.user_activity).reduce(
      (sum, user) => sum + (user.totalTime || 0),
      0
    );

    if (Math.abs(totalTimeResult.total - originalTotalTime) > 1000) {
      // 1초 오차 허용
      throw new Error(
        `총 활동 시간 불일치: 원본 ${originalTotalTime}, 마이그레이션 ${totalTimeResult.total}`
      );
    }

    console.log('✅ 데이터 무결성 검증 통과');
  }

  /**
   * 마이그레이션 완료 처리
   */
  private async finalizeMigration(db: sqlite3.Database): Promise<void> {
    // 마이그레이션 완료 기록
    const migrationRecord = {
      migration_date: Date.now(),
      source_file: this.jsonPath,
      backup_file: this.backupPath,
      migration_duration: Date.now() - this.status.startTime,
      status: 'completed',
    };

    await this.runQuery(
      db,
      "INSERT OR REPLACE INTO metadata (key, value) VALUES ('migration_info', ?)",
      [JSON.stringify(migrationRecord)]
    );

    // VACUUM으로 데이터베이스 최적화
    console.log('🧹 데이터베이스 최적화 중...');
    await this.runQuery(db, 'VACUUM');

    // 통계 업데이트
    await this.runQuery(db, 'ANALYZE');

    console.log('🎉 마이그레이션 완료 및 최적화 완료');
  }

  /**
   * 진행 상황 업데이트
   */
  private async updateProgress(step: number, message: string): Promise<void> {
    this.status.progress = Math.round((step / this.status.totalSteps) * 100);
    this.status.currentStep = message;

    console.log(`[${this.status.progress}%] ${message}`);
  }

  // SQLite 헬퍼 메서드들
  private runQuery(db: sqlite3.Database, sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ changes: this.changes, lastID: this.lastID });
      });
    });
  }

  private getQuery(db: sqlite3.Database, sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  private prepare(db: sqlite3.Database, sql: string): Promise<sqlite3.Statement> {
    return new Promise((resolve, reject) => {
      const stmt = db.prepare(sql, (err) => {
        if (err) reject(err);
        else resolve(stmt);
      });
    });
  }

  private runStatement(stmt: sqlite3.Statement, params: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      stmt.run(params, function (err) {
        if (err) reject(err);
        else resolve({ changes: this.changes, lastID: this.lastID });
      });
    });
  }

  /**
   * 마이그레이션 상태 조회
   */
  getStatus(): MigrationStatus {
    return { ...this.status };
  }
}
