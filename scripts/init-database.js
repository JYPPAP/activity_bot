#!/usr/bin/env node
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pkg from 'pg';
import dotenv from 'dotenv';

const { Client } = pkg;

// 환경 변수 로드
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function initializeDatabase() {
  let client;
  
  try {
    console.log('🔄 PostgreSQL 데이터베이스 초기화 시작...');
    
    // 데이터베이스 연결
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    
    if (!connectionString) {
      console.error('❌ DATABASE_URL 또는 POSTGRES_URL 환경 변수가 설정되지 않았습니다.');
      console.log('📝 .env 파일에 다음과 같이 설정해주세요:');
      console.log('   DATABASE_URL=postgresql://username:password@localhost:5432/activity_bot');
      process.exit(1);
    }
    
    client = new Client({
      connectionString,
      // SSL 설정 (클라우드 데이터베이스 사용 시)
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    await client.connect();
    console.log('✅ PostgreSQL 연결 성공');
    
    // SQL 스크립트 읽기
    const sqlPath = join(__dirname, 'init-database.sql');
    const sqlScript = readFileSync(sqlPath, 'utf8');
    
    console.log('🔄 데이터베이스 스키마 생성 중...');
    
    // SQL 스크립트 실행
    await client.query(sqlScript);
    
    console.log('✅ 데이터베이스 초기화 완료!');
    
    // 생성된 테이블 확인
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log('\n📋 생성된 테이블 목록:');
    tablesResult.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
    
    // 인덱스 확인
    const indexesResult = await client.query(`
      SELECT indexname, tablename
      FROM pg_indexes 
      WHERE schemaname = 'public' AND indexname NOT LIKE '%_pkey'
      ORDER BY tablename, indexname
    `);
    
    if (indexesResult.rows.length > 0) {
      console.log('\n🔍 생성된 인덱스 목록:');
      indexesResult.rows.forEach(row => {
        console.log(`  - ${row.indexname} (${row.tablename})`);
      });
    }
    
    console.log('\n🎉 PostgreSQL 마이그레이션 준비 완료!');
    console.log('💡 이제 DatabaseManager를 PostgreSQL용으로 재작성할 수 있습니다.');
    
  } catch (error) {
    console.error('❌ 데이터베이스 초기화 실패:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('\n🔧 해결 방법:');
      console.log('1. PostgreSQL 서버가 실행 중인지 확인');
      console.log('2. 연결 정보가 올바른지 확인');
      console.log('3. 방화벽 설정 확인');
    } else if (error.code === '28P01') {
      console.log('\n🔧 해결 방법:');
      console.log('1. 사용자명과 비밀번호가 올바른지 확인');
      console.log('2. 데이터베이스 권한 설정 확인');
    } else if (error.code === '3D000') {
      console.log('\n🔧 해결 방법:');
      console.log('1. 데이터베이스가 생성되어 있는지 확인');
      console.log('2. CREATE DATABASE activity_bot; 실행');
    }
    
    process.exit(1);
  } finally {
    if (client) {
      await client.end();
      console.log('🔌 데이터베이스 연결 종료');
    }
  }
}

// 스크립트 직접 실행 시에만 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  initializeDatabase();
}

export { initializeDatabase };