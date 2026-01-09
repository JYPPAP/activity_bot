// 마이그레이션 실행 스크립트
import { config } from '../src/config/env.js';
import pkg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('마이그레이션 시작...');

    // 마이그레이션 파일 읽기
    const migrationPath = path.join(__dirname, 'add_forum_participants_table.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // 마이그레이션 실행
    await pool.query(migrationSQL);

    console.log('마이그레이션 완료!');
    console.log('forum_participants 테이블이 생성되었습니다.');

  } catch (error) {
    console.error('마이그레이션 실패:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

runMigration().catch(console.error);
