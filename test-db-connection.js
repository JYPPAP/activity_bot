#!/usr/bin/env node
// 간단한 데이터베이스 연결 테스트

import dotenv from 'dotenv';
import pkg from 'pg';

const { Client } = pkg;

// 환경 변수 로드
dotenv.config();

async function testDatabaseConnection() {
    console.log('🔍 PostgreSQL 연결 테스트 시작...\n');
    
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    console.log('📡 연결 문자열:', connectionString?.replace(/\/\/.*:.*@/, '//***:***@'));
    
    let client;
    
    try {
        console.log('⏳ 연결 시도 중...');
        
        client = new Client({
            connectionString,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            // 연결 타임아웃 설정
            connectionTimeoutMillis: 5000,
        });
        
        await client.connect();
        console.log('✅ PostgreSQL 연결 성공!');
        
        // 기본 쿼리 테스트
        console.log('\n📊 데이터베이스 정보:');
        const result = await client.query('SELECT version()');
        console.log('버전:', result.rows[0].version.split(' ').slice(0, 2).join(' '));
        
        // 테이블 목록 확인
        const tables = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);
        
        console.log('\n📋 기존 테이블:');
        if (tables.rows.length === 0) {
            console.log('  (테이블이 없습니다. npm run init-db를 실행하세요)');
        } else {
            tables.rows.forEach(row => {
                console.log(`  - ${row.table_name}`);
            });
        }
        
        console.log('\n🎉 데이터베이스 연결 테스트 성공!');
        
    } catch (error) {
        console.error('\n❌ 연결 실패:', error.message);
        
        if (error.code === 'ECONNREFUSED') {
            console.log('\n🔧 해결 방법:');
            console.log('1. PostgreSQL 서버 실행 확인: pg_isready -h localhost -p 5432');
            console.log('2. 서비스 시작: sudo service postgresql start');
        } else if (error.code === '28P01') {
            console.log('\n🔧 해결 방법:');
            console.log('1. 사용자명과 비밀번호가 올바른지 확인');
            console.log('2. .env 파일의 DATABASE_URL 확인');
        } else if (error.code === '3D000') {
            console.log('\n🔧 해결 방법:');
            console.log('1. 데이터베이스 생성: createdb activity_bot');
            console.log('2. 또는 다른 기존 데이터베이스 사용');
        }
        
        process.exit(1);
    } finally {
        if (client) {
            await client.end();
            console.log('🔌 연결 종료');
        }
    }
}

// 실행
testDatabaseConnection();