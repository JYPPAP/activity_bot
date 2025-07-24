#!/usr/bin/env npx tsx

/**
 * PostgreSQL 통합 테스트 스크립트
 * PostgreSQLManager의 주요 기능들을 테스트합니다.
 * 
 * 사용법:
 * npm run test:postgresql
 * 또는
 * npx tsx scripts/test-postgresql.ts
 */

import 'reflect-metadata';
import { container } from 'tsyringe';
import { PostgreSQLManager } from '../src/services/PostgreSQLManager.ts';
import { RedisService } from '../src/services/RedisService.ts';
import { DI_TOKENS } from '../src/interfaces/index.ts';
import type { RedisConfig } from '../src/interfaces/IRedisService.ts';
import type { UserActivity, RoleConfig } from '../src/types/index.ts';

interface TestResults {
  passed: number;
  failed: number;
  tests: Array<{
    name: string;
    status: 'PASS' | 'FAIL';
    message?: string;
    duration: number;
  }>;
}

/**
 * 테스트 결과 기록
 */
function recordTest(results: TestResults, name: string, status: 'PASS' | 'FAIL', message?: string, duration: number = 0) {
  results.tests.push({ name, status, message, duration });
  if (status === 'PASS') {
    results.passed++;
    console.log(`✅ ${name} (${duration}ms)`);
  } else {
    results.failed++;
    console.log(`❌ ${name}: ${message} (${duration}ms)`);
  }
}

/**
 * PostgreSQL 기본 연결 테스트
 */
async function testConnection(dbManager: PostgreSQLManager, results: TestResults): Promise<void> {
  const start = Date.now();
  try {
    const isInitialized = await dbManager.initialize();
    const duration = Date.now() - start;
    
    if (isInitialized) {
      recordTest(results, '데이터베이스 연결 및 초기화', 'PASS', undefined, duration);
    } else {
      recordTest(results, '데이터베이스 연결 및 초기화', 'FAIL', '초기화 실패', duration);
    }
  } catch (error) {
    const duration = Date.now() - start;
    recordTest(results, '데이터베이스 연결 및 초기화', 'FAIL', (error as Error).message, duration);
  }
}

/**
 * 헬스 체크 테스트
 */
async function testHealthCheck(dbManager: PostgreSQLManager, results: TestResults): Promise<void> {
  const start = Date.now();
  try {
    const health = await dbManager.healthCheck();
    const duration = Date.now() - start;
    
    if (health.status === 'healthy') {
      recordTest(results, '헬스 체크', 'PASS', `응답시간: ${health.details.responseTime}ms`, duration);
    } else {
      recordTest(results, '헬스 체크', 'FAIL', `상태: ${health.status}`, duration);
    }
  } catch (error) {
    const duration = Date.now() - start;
    recordTest(results, '헬스 체크', 'FAIL', (error as Error).message, duration);
  }
}

/**
 * 사용자 활동 데이터 CRUD 테스트
 */
async function testUserActivityCrud(dbManager: PostgreSQLManager, results: TestResults): Promise<void> {
  const testUserId = 'test_user_123456789';
  
  // CREATE 테스트
  const createStart = Date.now();
  try {
    const testActivity: Partial<UserActivity> = {
      totalTime: 3600000, // 1시간
      startTime: Date.now() - 3600000,
      displayName: 'Test User',
      lastUpdate: Date.now(),
    };
    
    const created = await dbManager.updateUserActivity(testUserId, testActivity);
    const createDuration = Date.now() - createStart;
    
    if (created) {
      recordTest(results, '사용자 활동 생성', 'PASS', undefined, createDuration);
    } else {
      recordTest(results, '사용자 활동 생성', 'FAIL', '생성 실패', createDuration);
      return;
    }
  } catch (error) {
    const createDuration = Date.now() - createStart;
    recordTest(results, '사용자 활동 생성', 'FAIL', (error as Error).message, createDuration);
    return;
  }
  
  // READ 테스트
  const readStart = Date.now();
  try {
    const activity = await dbManager.getUserActivity(testUserId);
    const readDuration = Date.now() - readStart;
    
    if (activity && activity.userId === testUserId) {
      recordTest(results, '사용자 활동 조회', 'PASS', `총 시간: ${activity.totalTime}ms`, readDuration);
    } else {
      recordTest(results, '사용자 활동 조회', 'FAIL', '조회 실패 또는 데이터 불일치', readDuration);
    }
  } catch (error) {
    const readDuration = Date.now() - readStart;
    recordTest(results, '사용자 활동 조회', 'FAIL', (error as Error).message, readDuration);
  }
  
  // UPDATE 테스트
  const updateStart = Date.now();
  try {
    const updated = await dbManager.updateUserActivity(testUserId, 7200000); // 2시간으로 업데이트
    const updateDuration = Date.now() - updateStart;
    
    if (updated) {
      recordTest(results, '사용자 활동 업데이트', 'PASS', undefined, updateDuration);
    } else {
      recordTest(results, '사용자 활동 업데이트', 'FAIL', '업데이트 실패', updateDuration);
    }
  } catch (error) {
    const updateDuration = Date.now() - updateStart;
    recordTest(results, '사용자 활동 업데이트', 'FAIL', (error as Error).message, updateDuration);
  }
  
  // DELETE 테스트
  const deleteStart = Date.now();
  try {
    const deleted = await dbManager.deleteUserActivity(testUserId);
    const deleteDuration = Date.now() - deleteStart;
    
    if (deleted) {
      recordTest(results, '사용자 활동 삭제', 'PASS', undefined, deleteDuration);
    } else {
      recordTest(results, '사용자 활동 삭제', 'FAIL', '삭제 실패', deleteDuration);
    }
  } catch (error) {
    const deleteDuration = Date.now() - deleteStart;
    recordTest(results, '사용자 활동 삭제', 'FAIL', (error as Error).message, deleteDuration);
  }
}

/**
 * 역할 설정 CRUD 테스트
 */
async function testRoleConfigCrud(dbManager: PostgreSQLManager, results: TestResults): Promise<void> {
  const testRoleName = 'test_role';
  
  // CREATE 테스트
  const createStart = Date.now();
  try {
    const created = await dbManager.updateRoleConfig(testRoleName, 10);
    const createDuration = Date.now() - createStart;
    
    if (created) {
      recordTest(results, '역할 설정 생성', 'PASS', undefined, createDuration);
    } else {
      recordTest(results, '역할 설정 생성', 'FAIL', '생성 실패', createDuration);
      return;
    }
  } catch (error) {
    const createDuration = Date.now() - createStart;
    recordTest(results, '역할 설정 생성', 'FAIL', (error as Error).message, createDuration);
    return;
  }
  
  // READ 테스트
  const readStart = Date.now();
  try {
    const config = await dbManager.getRoleConfig(testRoleName);
    const readDuration = Date.now() - readStart;
    
    if (config && config.roleName === testRoleName && config.minHours === 10) {
      recordTest(results, '역할 설정 조회', 'PASS', `최소시간: ${config.minHours}시간`, readDuration);
    } else {
      recordTest(results, '역할 설정 조회', 'FAIL', '조회 실패 또는 데이터 불일치', readDuration);
    }
  } catch (error) {
    const readDuration = Date.now() - readStart;
    recordTest(results, '역할 설정 조회', 'FAIL', (error as Error).message, readDuration);
  }
  
  // UPDATE 테스트  
  const updateStart = Date.now();
  try {
    const updated = await dbManager.updateRoleConfig(testRoleName, 15);
    const updateDuration = Date.now() - updateStart;
    
    if (updated) {
      // 업데이트된 값 확인
      const updatedConfig = await dbManager.getRoleConfig(testRoleName);
      if (updatedConfig && updatedConfig.minHours === 15) {
        recordTest(results, '역할 설정 업데이트', 'PASS', `새 값: ${updatedConfig.minHours}시간`, updateDuration);
      } else {
        recordTest(results, '역할 설정 업데이트', 'FAIL', '업데이트 값 확인 실패', updateDuration);
      }
    } else {
      recordTest(results, '역할 설정 업데이트', 'FAIL', '업데이트 실패', updateDuration);
    }
  } catch (error) {
    const updateDuration = Date.now() - updateStart;
    recordTest(results, '역할 설정 업데이트', 'FAIL', (error as Error).message, updateDuration);
  }
  
  // 정리: 테스트 데이터 삭제
  try {
    await dbManager.run('DELETE FROM role_config WHERE role_name = $1', [testRoleName]);
  } catch (error) {
    console.warn('테스트 데이터 정리 실패:', error);
  }
}

/**
 * AFK 상태 테스트
 */
async function testAfkStatus(dbManager: PostgreSQLManager, results: TestResults): Promise<void> {
  const testUserId = 'test_afk_user_123';
  
  const start = Date.now();
  try {
    // AFK 상태 설정
    const untilTimestamp = Date.now() + 3600000; // 1시간 후
    const setResult = await dbManager.setUserAfkStatus(testUserId, 'Test User', untilTimestamp);
    
    if (!setResult) {
      recordTest(results, 'AFK 상태 설정/조회', 'FAIL', 'AFK 설정 실패', Date.now() - start);
      return;
    }
    
    // AFK 상태 조회
    const afkStatus = await dbManager.getUserAfkStatus(testUserId);
    
    if (afkStatus && afkStatus.isAfk && afkStatus.afkUntil === untilTimestamp) {
      recordTest(results, 'AFK 상태 설정/조회', 'PASS', `AFK Until: ${new Date(untilTimestamp).toLocaleString()}`, Date.now() - start);
    } else {
      recordTest(results, 'AFK 상태 설정/조회', 'FAIL', 'AFK 상태 데이터 불일치', Date.now() - start);
    }
    
    // AFK 상태 해제
    const clearResult = await dbManager.clearUserAfkStatus(testUserId);
    
    if (clearResult) {
      const clearedStatus = await dbManager.getUserAfkStatus(testUserId);
      if (clearedStatus && !clearedStatus.isAfk) {
        console.log(`✅ AFK 상태 해제 성공`);
      }
    }
    
    // 정리
    await dbManager.run('DELETE FROM afk_status WHERE user_id = $1', [testUserId]);
    
  } catch (error) {
    recordTest(results, 'AFK 상태 설정/조회', 'FAIL', (error as Error).message, Date.now() - start);
  }
}

/**
 * 메인 테스트 함수
 */
async function runPostgreSQLTests(): Promise<void> {
  let dbManager: PostgreSQLManager | null = null;
  
  try {
    console.log('🧪 PostgreSQL 통합 테스트 시작\n');
    
    const results: TestResults = {
      passed: 0,
      failed: 0,
      tests: []
    };
    
    // Redis 설정 (Redis가 없어도 PostgreSQL은 동작하도록 fallback 모드 사용)
    const redisConfig: RedisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      db: parseInt(process.env.REDIS_DB || '1'),
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 5,
      lazyConnect: true,
      enableOfflineQueue: true,
      connectTimeout: 15000,
      commandTimeout: 8000,
      family: 4,
      keepAlive: 30000,
      keyPrefix: 'discord_bot:',
    };

    // DI 컨테이너 설정
    container.registerInstance(DI_TOKENS.RedisConfig, redisConfig);
    container.registerSingleton(DI_TOKENS.IRedisService, RedisService);
    
    // PostgreSQLManager 생성
    dbManager = container.resolve(PostgreSQLManager);
    
    console.log('🔧 테스트 환경 설정 완료\n');
    
    // 테스트 실행
    await testConnection(dbManager, results);
    await testHealthCheck(dbManager, results);
    await testUserActivityCrud(dbManager, results);
    await testRoleConfigCrud(dbManager, results);
    await testAfkStatus(dbManager, results);
    
    // 결과 출력
    console.log('\n📊 테스트 결과 요약:');
    console.log(`✅ 통과: ${results.passed}개`);
    console.log(`❌ 실패: ${results.failed}개`);
    console.log(`📈 성공률: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
    
    if (results.failed === 0) {
      console.log('\n🎉 모든 테스트가 성공했습니다!');
    } else {
      console.log('\n⚠️  일부 테스트가 실패했습니다:');
      results.tests
        .filter(test => test.status === 'FAIL')
        .forEach(test => console.log(`   - ${test.name}: ${test.message}`));
    }
    
  } catch (error) {
    console.error('\n❌ 테스트 실행 실패:', error);
    process.exit(1);
  } finally {
    // 연결 종료
    if (dbManager) {
      await dbManager.close();
      console.log('\n✅ PostgreSQL 연결 종료');
    }
  }
}

/**
 * 스크립트 실행
 */
const isMainModule = process.argv[1] && process.argv[1].includes('test-postgresql');

if (isMainModule) {
  console.log('🧪 PostgreSQL 통합 테스트 시작...');
  runPostgreSQLTests().catch((error) => {
    console.error('테스트 실행 실패:', error);
    process.exit(1);
  });
}

export { runPostgreSQLTests };