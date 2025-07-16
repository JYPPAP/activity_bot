// SQLite 데이터베이스 초기화 스크립트

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import sqlite3 from 'sqlite3';

import { SQLiteConfig, DatabaseConnection } from '../types/sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DatabaseInitializer {
  private config: Required<SQLiteConfig>;
  private schemaPath: string;

  constructor(config: SQLiteConfig) {
    this.config = {
      database: config.database || 'activity_bot.sqlite',
      enableWAL: config.enableWAL ?? true,
      timeout: config.timeout ?? 30000,
      enableForeignKeys: config.enableForeignKeys ?? true,
      cacheSize: config.cacheSize ?? 2000,
      busyTimeout: config.busyTimeout ?? 10000,
    };

    this.schemaPath = path.join(__dirname, 'schema.sql');
  }

  /**
   * 데이터베이스 연결 및 초기화
   */
  async initialize(): Promise<DatabaseConnection> {
    return new Promise((resolve, reject) => {
      const dbPath = path.resolve(this.config.database);
      const isNewDatabase = !fs.existsSync(dbPath);

      console.log(`[DB] SQLite 데이터베이스 초기화: ${dbPath}`);
      console.log(`[DB] 새 데이터베이스: ${isNewDatabase ? 'YES' : 'NO'}`);

      const db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          console.error('[DB] 데이터베이스 연결 실패:', err);
          reject(err);
          return;
        }

        console.log('[DB] SQLite 데이터베이스 연결 성공');
        this.setupDatabase(db, isNewDatabase)
          .then(() => {
            resolve({
              db,
              isConnected: true,
            });
          })
          .catch(reject);
      });

      // 에러 핸들링
      db.on('error', (err) => {
        console.error('[DB] 데이터베이스 에러:', err);
      });
    });
  }

  /**
   * 데이터베이스 설정 및 스키마 적용
   */
  private async setupDatabase(db: sqlite3.Database, isNewDatabase: boolean): Promise<void> {
    try {
      // SQLite 최적화 설정
      await this.runQuery(db, 'PRAGMA journal_mode = WAL');
      await this.runQuery(db, 'PRAGMA synchronous = NORMAL');
      await this.runQuery(db, 'PRAGMA cache_size = -2000'); // 2MB 캐시
      await this.runQuery(db, 'PRAGMA foreign_keys = ON');
      await this.runQuery(db, `PRAGMA busy_timeout = ${this.config.busyTimeout}`);
      await this.runQuery(db, 'PRAGMA temp_store = MEMORY');
      await this.runQuery(db, 'PRAGMA mmap_size = 268435456'); // 256MB 메모리 맵

      console.log('[DB] SQLite 성능 최적화 설정 완료');

      // 스키마 적용
      if (isNewDatabase || (await this.needsSchemaUpdate(db))) {
        await this.applySchema(db);
        console.log('[DB] 데이터베이스 스키마 적용 완료');
      } else {
        console.log('[DB] 기존 스키마 사용');
      }

      // 인덱스 통계 업데이트
      await this.runQuery(db, 'ANALYZE');
      console.log('[DB] 인덱스 통계 업데이트 완료');
    } catch (error) {
      console.error('[DB] 데이터베이스 설정 실패:', error);
      throw error;
    }
  }

  /**
   * SQL 문을 정교하게 분리하는 메서드
   */
  private splitSQLStatements(sql: string): string[] {
    // 주석 제거
    const cleanedSQL = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

    // 세미콜론으로 문장 분리
    const statements = cleanedSQL
      .split(';')
      .map((stmt) => stmt.trim())
      .filter((stmt) => stmt.length > 0)
      .map((stmt) => stmt + ';'); // 세미콜론 다시 추가

    return statements;
  }

  /**
   * 스키마 업데이트 필요 여부 확인
   */
  private async needsSchemaUpdate(db: sqlite3.Database): Promise<boolean> {
    try {
      const result = await this.getQuery(
        db,
        "SELECT value FROM metadata WHERE key = 'schema_version'"
      );

      if (!result) {
        return true; // 메타데이터 테이블이 없으면 새 스키마 필요
      }

      const currentVersion = parseInt(result.value);
      const requiredVersion = 1; // schema.sql의 현재 버전

      return currentVersion < requiredVersion;
    } catch (error) {
      // 메타데이터 테이블이 없거나 다른 에러 발생 시 스키마 업데이트 필요
      return true;
    }
  }

  /**
   * 스키마 파일 적용
   */
  private async applySchema(db: sqlite3.Database): Promise<void> {
    try {
      const schemaSQL = fs.readFileSync(this.schemaPath, 'utf8');

      // SQL 문을 더 정교하게 분리하여 실행
      const statements = this.splitSQLStatements(schemaSQL);

      console.log(`[DB] ${statements.length}개의 SQL 문 실행 중...`);

      for (const statement of statements) {
        try {
          await this.runQuery(db, statement);
          console.log(`[DB] SQL 실행 성공: ${statement.substring(0, 30)}...`);
        } catch (error) {
          console.warn(`[DB] SQL 문 실행 경고: ${statement.substring(0, 50)}...`);
          console.warn(`[DB] 에러: ${error}`);
          // 일부 문은 이미 존재할 수 있으므로 계속 진행
        }
      }

      console.log('[DB] 스키마 적용 완료');
    } catch (error) {
      console.error('[DB] 스키마 파일 읽기 실패:', error);
      throw error;
    }
  }

  /**
   * 데이터베이스 무결성 검사
   */
  async checkIntegrity(db: sqlite3.Database): Promise<boolean> {
    try {
      const result = await this.getQuery(db, 'PRAGMA integrity_check');
      const isValid = result && result.integrity_check === 'ok';

      console.log(`[DB] 데이터베이스 무결성 검사: ${isValid ? 'PASS' : 'FAIL'}`);

      if (!isValid) {
        console.error('[DB] 데이터베이스 무결성 검사 결과:', result);
      }

      return isValid;
    } catch (error) {
      console.error('[DB] 무결성 검사 실패:', error);
      return false;
    }
  }

  /**
   * 데이터베이스 크기 및 통계 정보
   */
  async getDatabaseStats(db: sqlite3.Database): Promise<any> {
    try {
      const stats = await this.getQuery(
        db,
        `
        SELECT 
          page_count * page_size as database_size,
          page_count,
          page_size,
          freelist_count
        FROM pragma_page_count(), pragma_page_size(), pragma_freelist_count()
      `
      );

      const tableStats = await this.allQuery(
        db,
        `
        SELECT 
          name as table_name,
          (SELECT COUNT(*) FROM pragma_table_info(name)) as column_count
        FROM sqlite_master 
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      `
      );

      const indexStats = await this.allQuery(
        db,
        `
        SELECT 
          name as index_name,
          tbl_name as table_name
        FROM sqlite_master 
        WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
      `
      );

      return {
        database_size: stats.database_size,
        page_count: stats.page_count,
        page_size: stats.page_size,
        freelist_count: stats.freelist_count,
        tables: tableStats,
        indexes: indexStats,
        generated_at: Date.now(),
      };
    } catch (error) {
      console.error('[DB] 통계 정보 조회 실패:', error);
      return null;
    }
  }

  /**
   * Promise 기반 쿼리 실행 헬퍼
   */
  private runQuery(db: sqlite3.Database, sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) {
          reject(err);
        } else {
          resolve({ changes: this.changes, lastID: this.lastID });
        }
      });
    });
  }

  private getQuery(db: sqlite3.Database, sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  private allQuery(db: sqlite3.Database, sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * 데이터베이스 연결 종료
   */
  async close(db: sqlite3.Database): Promise<void> {
    return new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) {
          console.error('[DB] 데이터베이스 연결 종료 실패:', err);
          reject(err);
        } else {
          console.log('[DB] 데이터베이스 연결 종료 완료');
          resolve();
        }
      });
    });
  }

  /**
   * 백업 생성 (파일 복사 방식)
   */
  async createBackup(db: sqlite3.Database, backupPath: string): Promise<void> {
    try {
      // WAL 모드일 경우 체크포인트 실행
      await this.runQuery(db, 'PRAGMA wal_checkpoint(FULL)');

      // 단순 파일 복사로 백업 (sqlite3 backup API 대신)
      const fs = await import('fs');
      const currentDbPath = (db as any).filename || this.config.database;

      fs.copyFileSync(currentDbPath, backupPath);
      console.log(`[DB] 백업 생성 완료: ${backupPath}`);
    } catch (error) {
      console.error('[DB] 백업 생성 실패:', error);
      throw error;
    }
  }
}
