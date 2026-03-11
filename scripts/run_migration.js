// scripts/run_migration.js - 범용 마이그레이션 러너
// Usage:
//   node scripts/run_migration.js                      → 미적용 마이그레이션 전체 실행
//   node scripts/run_migration.js 006                  → 특정 번호 마이그레이션만 실행
//   node scripts/run_migration.js --status             → 적용 상태 확인
//   node scripts/run_migration.js --dry-run            → 실행 없이 미적용 목록 확인
import { config } from '../src/config/env.js';
import pkg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

/**
 * 마이그레이션 이력 테이블 생성
 */
async function ensureMigrationTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * 이미 적용된 마이그레이션 목록 조회
 */
async function getAppliedMigrations(pool) {
  const result = await pool.query(
    'SELECT filename FROM schema_migrations ORDER BY filename'
  );
  return new Set(result.rows.map(r => r.filename));
}

/**
 * migrations/ 디렉토리에서 SQL 파일 목록 조회 (정렬)
 */
function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`마이그레이션 디렉토리 없음: ${MIGRATIONS_DIR}`);
    return [];
  }

  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

/**
 * 마이그레이션 상태 출력
 */
async function showStatus(pool) {
  const applied = await getAppliedMigrations(pool);
  const files = getMigrationFiles();

  console.log('\n=== 마이그레이션 상태 ===\n');

  for (const file of files) {
    const status = applied.has(file) ? '✅ 적용됨' : '⬜ 미적용';
    console.log(`  ${status}  ${file}`);
  }

  const pending = files.filter(f => !applied.has(f));
  console.log(`\n총 ${files.length}개 중 ${applied.size}개 적용, ${pending.length}개 미적용\n`);
}

/**
 * 단일 마이그레이션 실행
 */
async function applyMigration(pool, filename) {
  const filePath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filePath, 'utf8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // SQL 실행
    await client.query(sql);

    // 이력 기록
    await client.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1)',
      [filename]
    );

    await client.query('COMMIT');
    console.log(`  ✅ ${filename} 적용 완료`);
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`  ❌ ${filename} 적용 실패:`, error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 메인 실행 함수
 */
async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isStatus = args.includes('--status');
  const targetNumber = args.find(a => /^\d+$/.test(a));

  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    await ensureMigrationTable(pool);

    // --status: 상태만 출력
    if (isStatus) {
      await showStatus(pool);
      return;
    }

    const applied = await getAppliedMigrations(pool);
    let files = getMigrationFiles();

    // 특정 번호 지정 시 필터링
    if (targetNumber) {
      const padded = targetNumber.padStart(6, '0');
      files = files.filter(f => f.includes(padded));
      if (files.length === 0) {
        console.error(`번호 ${targetNumber}에 해당하는 마이그레이션을 찾을 수 없습니다.`);
        process.exit(1);
      }
    }

    // 미적용 마이그레이션 필터링
    const pending = files.filter(f => !applied.has(f));

    if (pending.length === 0) {
      console.log('\n모든 마이그레이션이 이미 적용되었습니다. ✅\n');
      return;
    }

    console.log(`\n=== ${isDryRun ? '[DRY RUN] ' : ''}마이그레이션 실행 ===\n`);
    console.log(`미적용 마이그레이션 ${pending.length}개:\n`);

    for (const file of pending) {
      if (isDryRun) {
        console.log(`  🔹 ${file} (적용 예정)`);
      } else {
        await applyMigration(pool, file);
      }
    }

    if (isDryRun) {
      console.log('\n--dry-run 모드: 실제 적용되지 않았습니다.\n');
    } else {
      console.log(`\n마이그레이션 ${pending.length}개 적용 완료! ✅\n`);
    }

  } catch (error) {
    console.error('\n마이그레이션 실행 중 오류:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
