#!/usr/bin/env npx tsx

/**
 * PostgreSQL 데이터베이스 초기화 스크립트
 * PostgreSQLManager를 사용하여 테이블을 생성합니다.
 * 
 * 사용법:
 * npm run init:postgresql
 * 또는
 * npx tsx scripts/init-postgresql.ts
 */

import 'reflect-metadata';
import { container } from 'tsyringe';
import { PostgreSQLManager } from '../src/services/PostgreSQLManager.ts';
import { RedisService } from '../src/services/RedisService.ts';
import { DI_TOKENS } from '../src/interfaces/index.ts';
import type { RedisConfig } from '../src/interfaces/IRedisService.ts';

/**
 * PostgreSQL 초기화 함수
 */
async function initializePostgreSQL(): Promise<void> {
  let dbManager: PostgreSQLManager | null = null;
  
  try {
    console.log('🚀 PostgreSQL 데이터베이스 초기화 시작\n');
    
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
    
    console.log('📦 PostgreSQLManager 인스턴스 생성 완료');
    
    // 데이터베이스 초기화 (테이블 생성)
    console.log('🔧 PostgreSQL 테이블 생성 중...');
    const isInitialized = await dbManager.initialize();
    
    if (isInitialized) {
      console.log('✅ PostgreSQL 데이터베이스 초기화 완료!');
      
      // 헬스 체크
      const healthCheck = await dbManager.healthCheck();
      console.log('🏥 헬스 체크 결과:', {
        status: healthCheck.status,
        responseTime: healthCheck.details.responseTime,
        connectionPoolSize: healthCheck.details.connectionPoolSize,
      });
      
      // 테이블 존재 확인
      console.log('\n📋 생성된 테이블 확인 중...');
      const tables = [
        'user_activity',
        'role_config',
        'activity_log',
        'afk_status',
        'voice_channel_mapping',
        'guild_settings',
        'settings_audit_log'
      ];
      
      for (const table of tables) {
        try {
          const result = await dbManager.get(`
            SELECT COUNT(*) as count 
            FROM information_schema.tables 
            WHERE table_name = $1 AND table_schema = 'public'
          `, [table]);
          
          if (result && result.count > 0) {
            console.log(`✅ ${table} 테이블 생성됨`);
          } else {
            console.log(`❌ ${table} 테이블 생성되지 않음`);
          }
        } catch (error) {
          console.log(`❌ ${table} 테이블 확인 실패:`, error);
        }
      }
      
    } else {
      console.error('❌ PostgreSQL 데이터베이스 초기화 실패');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ 초기화 실패:', error);
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
const isMainModule = process.argv[1] && process.argv[1].includes('init-postgresql');

if (isMainModule) {
  console.log('🚀 PostgreSQL 초기화 스크립트 시작...');
  initializePostgreSQL().catch((error) => {
    console.error('초기화 실행 실패:', error);
    process.exit(1);
  });
}

export { initializePostgreSQL };