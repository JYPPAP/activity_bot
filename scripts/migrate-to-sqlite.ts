#!/usr/bin/env tsx
// 데이터베이스 마이그레이션 실행 스크립트

import { DatabaseMigrator } from '../src/database/migrator.js';
import { DatabaseInitializer } from '../src/database/init.js';

/**
 * 마이그레이션 실행 함수
 */
async function runMigration() {
  console.log('🚀 JSON에서 SQLite로 데이터베이스 마이그레이션 시작\n');

  const jsonPath = process.argv[2] || 'activity_bot.json';
  const sqlitePath = process.argv[3] || 'activity_bot.sqlite';

  const migrator = new DatabaseMigrator(jsonPath, sqlitePath);

  console.log('📋 마이그레이션 설정:');
  console.log(`   JSON 파일: ${jsonPath}`);
  console.log(`   SQLite 파일: ${sqlitePath}`);
  console.log('');

  // 사용자 확인
  if (process.argv.includes('--force') || await confirmMigration()) {
    const success = await migrator.migrate();
    
    if (success) {
      console.log('\n🎉 마이그레이션이 성공적으로 완료되었습니다!');
      console.log('\n📊 다음 단계:');
      console.log('1. npm run test - 데이터베이스 연결 테스트');
      console.log('2. npm run dev - 개발 서버 시작');
      console.log('3. 기존 JSON 파일 정리 (백업 확인 후)');
      
      process.exit(0);
    } else {
      console.log('\n❌ 마이그레이션이 실패했습니다.');
      console.log('백업 파일을 확인하고 문제를 해결한 후 다시 시도해주세요.');
      process.exit(1);
    }
  } else {
    console.log('마이그레이션이 취소되었습니다.');
    process.exit(0);
  }
}

/**
 * 사용자 확인 프롬프트
 */
async function confirmMigration(): Promise<boolean> {
  return new Promise((resolve) => {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('⚠️  기존 데이터베이스를 백업하고 마이그레이션을 진행하시겠습니까? (y/N): ', (answer: string) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * 데이터베이스 연결 테스트
 */
async function testDatabaseConnection() {
  console.log('🔍 SQLite 데이터베이스 연결 테스트 중...');

  try {
    const initializer = new DatabaseInitializer({
      database: process.argv[2] || 'activity_bot.sqlite'
    });

    const connection = await initializer.initialize();
    
    if (connection.isConnected) {
      // 기본 쿼리 테스트
      const stats = await initializer.getDatabaseStats(connection.db);
      
      console.log('✅ 데이터베이스 연결 성공!');
      console.log(`📊 데이터베이스 크기: ${(stats.database_size / 1024 / 1024).toFixed(2)}MB`);
      console.log(`📋 테이블 수: ${stats.tables.length}`);
      console.log(`🔍 인덱스 수: ${stats.indexes.length}`);

      await initializer.close(connection.db);
      return true;
    }
  } catch (error) {
    console.error('❌ 데이터베이스 연결 실패:', error);
    return false;
  }
}

/**
 * 마이그레이션 상태 확인
 */
async function checkMigrationStatus() {
  const sqlitePath = process.argv[2] || 'activity_bot.sqlite';
  
  try {
    const initializer = new DatabaseInitializer({ database: sqlitePath });
    const connection = await initializer.initialize();

    // 마이그레이션 정보 조회
    const migrationInfo = await new Promise((resolve, reject) => {
      connection.db.get(
        "SELECT value FROM metadata WHERE key = 'migration_info'",
        (err: any, row: any) => {
          if (err) reject(err);
          else resolve(row ? JSON.parse(row.value) : null);
        }
      );
    });

    if (migrationInfo) {
      console.log('📊 마이그레이션 정보:');
      console.log(JSON.stringify(migrationInfo, null, 2));
    } else {
      console.log('❌ 마이그레이션 정보를 찾을 수 없습니다.');
    }

    await initializer.close(connection.db);
  } catch (error) {
    console.error('❌ 마이그레이션 상태 확인 실패:', error);
  }
}

/**
 * 사용법 출력
 */
function printUsage() {
  console.log(`
🔄 데이터베이스 마이그레이션 도구

사용법:
  npm run migrate:to-sqlite [JSON파일] [SQLite파일]
  tsx scripts/migrate-to-sqlite.ts [옵션] [JSON파일] [SQLite파일]

옵션:
  --force          확인 없이 강제 실행
  --test           SQLite 연결 테스트만 실행
  --status         마이그레이션 상태 확인
  --help, -h       이 도움말 출력

예시:
  npm run migrate:to-sqlite
  npm run migrate:to-sqlite activity_bot.json activity_bot.sqlite
  tsx scripts/migrate-to-sqlite.ts --test activity_bot.sqlite
  tsx scripts/migrate-to-sqlite.ts --status activity_bot.sqlite
`);
}

// 메인 실행부
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  if (args.includes('--test')) {
    await testDatabaseConnection();
    return;
  }

  if (args.includes('--status')) {
    await checkMigrationStatus();
    return;
  }

  await runMigration();
}

// 스크립트 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('💥 예상치 못한 오류:', error);
    process.exit(1);
  });
}