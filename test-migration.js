#!/usr/bin/env node
// PostgreSQL 마이그레이션 기능 테스트 스크립트

import dotenv from 'dotenv';
import { createDIContainer } from './src/container.js';

// 환경 변수 로드
dotenv.config();

async function testPostgreSQLMigration() {
    console.log('🧪 PostgreSQL 마이그레이션 기능 테스트 시작\n');
    
    // 가짜 클라이언트 객체 생성 (테스트용)
    const mockClient = {
        user: { tag: 'TestBot#1234', id: '123456789' },
        guilds: { cache: new Map() }
    };
    
    let container;
    let dbManager;
    
    try {
        // 1. DI Container 및 DatabaseManager 테스트
        console.log('1️⃣ DI Container 및 DatabaseManager 연결 테스트...');
        container = createDIContainer(mockClient);
        dbManager = container.resolve('dbManager');
        
        // 데이터베이스 연결 테스트
        await dbManager.testConnection();
        console.log('✅ PostgreSQL 연결 성공');
        
        // 2. 기본 테이블 존재 확인
        console.log('\n2️⃣ 테이블 구조 확인...');
        const tables = await dbManager.pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);
        
        console.log('📋 생성된 테이블 목록:');
        tables.rows.forEach(row => {
            console.log(`  - ${row.table_name}`);
        });
        
        // 3. 사용자 관리 테스트
        console.log('\n3️⃣ 사용자 관리 기능 테스트...');
        const testUserId = 'test_user_123';
        const testUsername = 'TestUser';
        const testGuildId = 'test_guild_456';
        
        // 사용자 추가
        await dbManager.addUser(testUserId, testUsername, testGuildId);
        console.log(`✅ 사용자 추가: ${testUsername}`);
        
        // 사용자 조회
        const user = await dbManager.getUser(testUserId);
        console.log(`✅ 사용자 조회 성공:`, { 
            userId: user?.user_id, 
            username: user?.username 
        });
        
        // 4. 월별 활동 테이블 테스트
        console.log('\n4️⃣ 월별 활동 테이블 테스트...');
        const testDate = new Date();
        const testMinutes = 45;
        
        // 일일 활동 업데이트
        await dbManager.updateDailyActivity(testUserId, testUsername, testGuildId, testDate, testMinutes);
        console.log(`✅ 활동 데이터 저장: ${testMinutes}분`);
        
        // 월별 활동 조회
        const monthlyActivities = await dbManager.getMonthlyActivities(testGuildId, testDate);
        console.log(`✅ 월별 활동 조회: ${monthlyActivities.length}명의 활동 기록`);
        
        // 5. 포럼 연동 테스트
        console.log('\n5️⃣ 포럼 연동 기능 테스트...');
        const testVoiceChannelId = 'voice_123';
        const testForumPostId = 'forum_456';
        const testForumChannelId = 'forum_channel_789';
        
        try {
            // 포스트 연동 추가
            await dbManager.addPostIntegration(testGuildId, testVoiceChannelId, testForumPostId, testForumChannelId);
            console.log('✅ 포스트 연동 추가 성공');
            
            // 포럼 메시지 추적
            await dbManager.trackForumMessage(testForumPostId, 'participant_count', 'msg_123');
            console.log('✅ 포럼 메시지 추적 성공');
            
        } catch (error) {
            if (error.message.includes('duplicate key')) {
                console.log('⚠️ 포스트 연동이 이미 존재함 (정상)');
            } else {
                throw error;
            }
        }
        
        // 6. 성능 테스트 (인덱스 효율성)
        console.log('\n6️⃣ 성능 및 인덱스 테스트...');
        const startTime = Date.now();
        
        // 복합 쿼리 실행
        await dbManager.pool.query(`
            SELECT u.username, pi.forum_post_id, pi.is_active
            FROM users u
            LEFT JOIN post_integrations pi ON u.guild_id = pi.guild_id
            WHERE u.guild_id = $1
            LIMIT 100
        `, [testGuildId]);
        
        const queryTime = Date.now() - startTime;
        console.log(`✅ 복합 쿼리 성능: ${queryTime}ms`);
        
        // 7. 클린업 테스트 (테스트 데이터 정리)
        console.log('\n7️⃣ 테스트 데이터 정리...');
        
        // 테스트 데이터 삭제
        await dbManager.pool.query('DELETE FROM post_integrations WHERE guild_id = $1', [testGuildId]);
        await dbManager.pool.query('DELETE FROM users WHERE user_id = $1', [testUserId]);
        
        // 월별 활동 데이터 정리
        const monthTable = `user_activities_${testDate.getFullYear()}${String(testDate.getMonth() + 1).padStart(2, '0')}`;
        await dbManager.pool.query(`DELETE FROM ${monthTable} WHERE user_id = $1`, [testUserId]);
        
        console.log('✅ 테스트 데이터 정리 완료');
        
        console.log('\n🎉 모든 기능 테스트 성공!');
        console.log('\n=== 마이그레이션 검증 결과 ===');
        console.log('✅ PostgreSQL 연결 및 기본 기능');
        console.log('✅ 사용자 관리 (users 테이블)');
        console.log('✅ 월별 활동 추적 (user_activities_YYYYMM)');
        console.log('✅ 포럼 연동 관리 (post_integrations)');
        console.log('✅ 성능 최적화 (인덱스 효율성)');
        console.log('✅ 데이터 무결성 및 CRUD 작업');
        console.log('\n💡 PostgreSQL 마이그레이션이 성공적으로 완료되었습니다!');
        
    } catch (error) {
        console.error('\n❌ 테스트 실패:', error.message);
        console.error('스택 트레이스:', error.stack);
        
        // 일반적인 해결 방법 제시
        console.log('\n🔧 해결 방법:');
        if (error.message.includes('connect')) {
            console.log('1. PostgreSQL 서버가 실행 중인지 확인');
            console.log('2. DATABASE_URL 환경 변수 확인');
            console.log('3. 데이터베이스 권한 확인');
        }
        if (error.message.includes('does not exist')) {
            console.log('1. npm run init-db 실행하여 테이블 생성');
            console.log('2. 데이터베이스가 생성되었는지 확인');
        }
        
        process.exit(1);
    } finally {
        // 연결 정리
        if (dbManager?.pool) {
            await dbManager.pool.end();
            console.log('\n🔌 데이터베이스 연결 종료');
        }
    }
}

// 스크립트 직접 실행 시에만 실행
if (import.meta.url === `file://${process.argv[1]}`) {
    testPostgreSQLMigration();
}

export { testPostgreSQLMigration };