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

// SQL 구문별 실행 함수
async function executeSqlStatements(client, sqlScript) {
  // SQL 스크립트를 구문별로 분할 (기본적인 방식)
  const statements = sqlScript
    .split(';')
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
  
  console.log(`📋 총 ${statements.length}개의 SQL 구문을 실행합니다.\n`);
  
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    
    try {
      // 구문 유형 감지 및 로그
      const statementType = detectStatementType(statement);
      console.log(`🔄 [${i + 1}/${statements.length}] ${statementType} 실행 중...`);
      
      // 실행할 SQL 구문 출력 (처음 100자)
      console.log(`   SQL: ${statement.substring(0, 100)}...`);
      
      // SQL 구문 실행
      const startTime = Date.now();
      await client.query(statement);
      const duration = Date.now() - startTime;
      
      console.log(`✅ [${i + 1}/${statements.length}] ${statementType} 완료 (${duration}ms)`);
      
    } catch (error) {
      console.error(`❌ [${i + 1}/${statements.length}] SQL 구문 실행 실패:`);
      console.error(`   구문: ${statement.substring(0, 200)}...`);
      console.error(`   에러: ${error.message}`);
      
      if (error.position) {
        console.error(`   위치: ${error.position}`);
      }
      if (error.detail) {
        console.error(`   상세: ${error.detail}`);
      }
      if (error.hint) {
        console.error(`   힌트: ${error.hint}`);
      }
      
      throw error;
    }
  }
}

// SQL 구문 유형 감지
function detectStatementType(statement) {
  const upperStatement = statement.toUpperCase().trim();
  
  if (upperStatement.startsWith('CREATE TABLE')) return '테이블 생성';
  if (upperStatement.startsWith('CREATE OR REPLACE FUNCTION')) return '함수 생성';
  if (upperStatement.startsWith('DROP FUNCTION')) return '함수 삭제';
  if (upperStatement.startsWith('CREATE INDEX')) return '인덱스 생성';
  if (upperStatement.startsWith('CREATE TRIGGER')) return '트리거 생성';
  if (upperStatement.startsWith('SELECT')) return '함수 호출';
  if (upperStatement.startsWith('DO $$')) return '스크립트 블록';
  
  return 'SQL 구문';
}

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
    
    // PostgreSQL NOTICE 메시지 캡처
    client.on('notice', (msg) => {
      console.log('📢 PostgreSQL:', msg.message);
    });
    
    await client.connect();
    console.log('✅ PostgreSQL 연결 성공');
    
    // SQL 스크립트 읽기
    const sqlPath = join(__dirname, 'init-database.sql');
    const sqlScript = readFileSync(sqlPath, 'utf8');
    
    console.log('🔄 데이터베이스 스키마 생성 중...');
    
    // SQL 스크립트를 구문별로 분할 실행
    await executeSqlStatements(client, sqlScript);
    
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
    console.error('\n❌ 데이터베이스 초기화 실패');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // 기본 에러 정보
    console.error(`🔴 에러 메시지: ${error.message}`);
    if (error.code) console.error(`🔴 에러 코드: ${error.code}`);
    if (error.severity) console.error(`🔴 심각도: ${error.severity}`);
    if (error.detail) console.error(`🔴 상세 정보: ${error.detail}`);
    if (error.hint) console.error(`🔴 해결 힌트: ${error.hint}`);
    if (error.position) console.error(`🔴 에러 위치: ${error.position}`);
    if (error.where) console.error(`🔴 발생 위치: ${error.where}`);
    
    // 전체 스택 트레이스 출력
    console.error('\n📋 전체 스택 트레이스:');
    console.error(error.stack);
    
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // 에러 코드별 맞춤 해결책
    if (error.code === 'ECONNREFUSED') {
      console.log('\n🔧 연결 거부 해결 방법:');
      console.log('1. PostgreSQL 서버가 실행 중인지 확인');
      console.log('2. 연결 정보가 올바른지 확인');
      console.log('3. 방화벽 설정 확인');
      console.log('4. pg_ctl start 또는 서비스 재시작');
    } else if (error.code === '28P01') {
      console.log('\n🔧 인증 실패 해결 방법:');
      console.log('1. 사용자명과 비밀번호가 올바른지 확인');
      console.log('2. 데이터베이스 권한 설정 확인');
      console.log('3. pg_hba.conf 설정 확인');
    } else if (error.code === '3D000') {
      console.log('\n🔧 데이터베이스 없음 해결 방법:');
      console.log('1. 데이터베이스가 생성되어 있는지 확인');
      console.log('2. CREATE DATABASE activity_bot; 실행');
    } else if (error.code === '42P01') {
      console.log('\n🔧 테이블/릴레이션 없음 해결 방법:');
      console.log('1. 의존하는 테이블이 먼저 생성되었는지 확인');
      console.log('2. 스키마 생성 순서 확인');
    } else if (error.code === '42601') {
      console.log('\n🔧 SQL 문법 오류 해결 방법:');
      console.log('1. SQL 구문을 다시 확인하세요');
      console.log('2. 괄호나 세미콜론 누락 확인');
      console.log('3. 예약어 사용 여부 확인');
    } else if (error.code === '42703') {
      console.log('\n🔧 컬럼/변수 없음 해결 방법:');
      console.log('1. 컬럼명이 올바른지 확인');
      console.log('2. 테이블 별칭 사용 여부 확인');
      console.log('3. 변수 스코프 확인 (함수 내부)');
    } else {
      console.log('\n🔧 일반적인 해결 방법:');
      console.log('1. 위의 상세 에러 정보를 확인하세요');
      console.log('2. PostgreSQL 로그를 확인하세요');
      console.log('3. SQL 구문과 스택 트레이스를 참고하여 문제를 해결하세요');
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