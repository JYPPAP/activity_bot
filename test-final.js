#!/usr/bin/env node
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the parsing functions from the actual script
// Since the script exports the main function, we'll just copy the parsing logic for testing

// PostgreSQL Dollar-Quoted String을 인식하는 스마트 SQL 파서
function splitSqlStatements(sqlScript) {
  console.log(`🔍 SQL 파싱 디버그: 총 ${sqlScript.length}자 분석 시작`);
  
  const statements = [];
  let current = '';
  let i = 0;
  let inDollarQuote = false;
  let dollarTag = '';
  let statementCount = 0;
  
  while (i < sqlScript.length) {
    const char = sqlScript[i];
    const remaining = sqlScript.slice(i);
    
    if (!inDollarQuote) {
      // Dollar-quoted string 시작 감지
      const dollarMatch = remaining.match(/^\$([^$]*)\$/);
      if (dollarMatch) {
        inDollarQuote = true;
        dollarTag = dollarMatch[0]; // 예: $$, $tag$
        current += dollarTag;
        i += dollarTag.length;
        console.log(`🔤 Dollar-quote 시작: ${dollarTag} (위치: ${i})`);
        continue;
      }
      
      // 일반 세미콜론으로 구문 분할
      if (char === ';') {
        const trimmed = current.trim();
        if (trimmed) {
          // 멀티라인 구문에서 SQL 키워드 검사 (주석이 포함된 구문도 처리)
          const hasSQL = /\b(CREATE|DROP|SELECT|INSERT|UPDATE|DELETE|ALTER|DO)\b/i.test(trimmed);
          
          if (hasSQL) {
            statementCount++;
            const preview = trimmed.substring(0, 80).replace(/\s+/g, ' ');
            console.log(`📝 SQL 구문 #${statementCount} 발견 (${trimmed.length}자): ${preview}...`);
            
            // CREATE TABLE 감지 디버그
            if (trimmed.toUpperCase().includes('CREATE TABLE')) {
              console.log(`🏗️  CREATE TABLE 감지! 구문 #${statementCount}`);
            }
            
            statements.push(trimmed);
          } else if (!trimmed.startsWith('--')) {
            // 주석이 아닌데 SQL 키워드도 없는 경우
            console.log(`❓ 알 수 없는 구문: ${trimmed.substring(0, 50)}`);
          } else {
            console.log(`❌ 순수 주석 구문 제외`);
          }
        } else {
          console.log(`❌ 빈 구문 제외`);
        }
        current = '';
        i++;
        continue;
      }
    } else {
      // Dollar-quoted string 끝 감지
      if (remaining.startsWith(dollarTag)) {
        inDollarQuote = false;
        current += dollarTag;
        i += dollarTag.length;
        console.log(`🔤 Dollar-quote 종료: ${dollarTag} (위치: ${i})`);
        dollarTag = '';
        continue;
      }
    }
    
    current += char;
    i++;
  }
  
  // 마지막 구문 처리
  const trimmed = current.trim();
  if (trimmed) {
    // 멀티라인 구문에서 SQL 키워드 검사 (주석이 포함된 구문도 처리)
    const hasSQL = /\b(CREATE|DROP|SELECT|INSERT|UPDATE|DELETE|ALTER|DO)\b/i.test(trimmed);
    
    if (hasSQL) {
      statementCount++;
      const preview = trimmed.substring(0, 80).replace(/\s+/g, ' ');
      console.log(`📝 마지막 SQL 구문 #${statementCount} (${trimmed.length}자): ${preview}...`);
      
      // CREATE TABLE 감지 디버그
      if (trimmed.toUpperCase().includes('CREATE TABLE')) {
        console.log(`🏗️  CREATE TABLE 감지! 마지막 구문 #${statementCount}`);
      }
      
      statements.push(trimmed);
    } else if (!trimmed.startsWith('--')) {
      // 주석이 아닌데 SQL 키워드도 없는 경우
      console.log(`❓ 마지막 알 수 없는 구문: ${trimmed.substring(0, 50)}`);
    } else {
      console.log(`❌ 마지막 순수 주석 구문 제외`);
    }
  } else {
    console.log(`❌ 마지막 빈 구문 제외`);
  }
  
  console.log(`🔍 파싱 완료: 총 ${statements.length}개 구문 발견`);
  
  // CREATE TABLE 구문 카운트 검증
  const createTableCount = statements.filter(stmt => 
    stmt.toUpperCase().trim().includes('CREATE TABLE')
  ).length;
  console.log(`🏗️  CREATE TABLE 구문 수: ${createTableCount}개`);
  
  return statements;
}

// SQL 구문 유형 감지 및 우선순위
function detectStatementType(statement) {
  const upperStatement = statement.toUpperCase().trim();
  const preview = statement.substring(0, 100).replace(/\s+/g, ' ');
  
  let result;
  
  // 주석을 포함한 구문에서도 SQL 키워드를 찾기 위해 includes() 사용
  // 더 구체적인 키워드부터 먼저 검사 (CREATE OR REPLACE FUNCTION이 CREATE TABLE보다 먼저)
  if (upperStatement.includes('DROP FUNCTION')) {
    result = { type: '함수 삭제', priority: 1 };
  } else if (upperStatement.includes('CREATE OR REPLACE FUNCTION')) {
    result = { type: '함수 생성', priority: 3 };
  } else if (upperStatement.includes('CREATE TABLE')) {
    result = { type: '테이블 생성', priority: 2 };
  } else if (upperStatement.includes('CREATE INDEX')) {
    result = { type: '인덱스 생성', priority: 4 };
  } else if (upperStatement.includes('CREATE TRIGGER')) {
    result = { type: '트리거 생성', priority: 5 };
  } else if (upperStatement.includes('SELECT ') && !upperStatement.includes('CREATE')) {
    result = { type: '함수 호출', priority: 6 };
  } else if (upperStatement.includes('DO $$')) {
    result = { type: '스크립트 블록', priority: 7 };
  } else {
    result = { type: 'SQL 구문', priority: 8 };
  }
  
  console.log(`🏷️  구문 분류: ${result.type} (우선순위: ${result.priority}) - ${preview}...`);
  return result;
}

// SQL 구문 스마트 정렬
function sortSqlStatements(statements) {
  // 각 구문에 유형과 우선순위 정보 추가
  const statementsWithMetadata = statements.map((statement, index) => {
    const metadata = detectStatementType(statement);
    return {
      statement,
      originalIndex: index,
      type: metadata.type,
      priority: metadata.priority
    };
  });
  
  // 우선순위별로 정렬 (낮은 숫자가 먼저 실행)
  const sortedStatements = statementsWithMetadata.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    // 같은 우선순위면 원래 순서 유지
    return a.originalIndex - b.originalIndex;
  });
  
  return sortedStatements;
}

// 테스트 실행
async function testFinalSolution() {
  try {
    console.log('🔄 최종 솔루션 테스트 시작...');
    
    // SQL 스크립트 읽기
    const sqlPath = join(__dirname, 'scripts/init-database.sql');
    const sqlScript = readFileSync(sqlPath, 'utf8');
    
    console.log('🔄 SQL 파싱 중...');
    
    // SQL 스크립트를 구문별로 분할
    const rawStatements = splitSqlStatements(sqlScript);
    
    console.log('\n🧠 스마트 정렬 적용 중...');
    const sortedStatements = sortSqlStatements(rawStatements);
    
    console.log('\n📊 실행 순서 확인:');
    console.log('   1순위: 함수 삭제 → 2순위: 테이블 생성 → 3순위: 함수 생성 → 4순위: 인덱스 생성 → ...');
    
    console.log('\n📋 정렬된 실행 순서:');
    sortedStatements.forEach((stmt, index) => {
      console.log(`${index + 1}. [우선순위 ${stmt.priority}] ${stmt.type} (원래 위치: ${stmt.originalIndex + 1})`);
    });
    
    // CREATE TABLE이 CREATE INDEX보다 먼저 오는지 확인
    const tableStatements = sortedStatements.filter(stmt => stmt.type === '테이블 생성');
    const indexStatements = sortedStatements.filter(stmt => stmt.type === '인덱스 생성');
    
    console.log('\n✅ 검증 결과:');
    console.log(`📊 총 구문 수: ${sortedStatements.length}개`);
    console.log(`🏗️  테이블 생성 구문: ${tableStatements.length}개 (우선순위 2)`);
    console.log(`🔍 인덱스 생성 구문: ${indexStatements.length}개 (우선순위 4)`);
    
    if (tableStatements.length > 0 && indexStatements.length > 0) {
      const firstTableIndex = sortedStatements.findIndex(stmt => stmt.type === '테이블 생성');
      const firstIndexIndex = sortedStatements.findIndex(stmt => stmt.type === '인덱스 생성');
      
      if (firstTableIndex < firstIndexIndex) {
        console.log(`✅ 실행 순서 올바름: CREATE TABLE(${firstTableIndex + 1}번째) → CREATE INDEX(${firstIndexIndex + 1}번째)`);
      } else {
        console.log(`❌ 실행 순서 문제: CREATE INDEX가 CREATE TABLE보다 먼저 실행됨`);
      }
    }
    
    console.log('\n🎉 최종 솔루션 테스트 완료!');
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error.message);
    console.error(error.stack);
  }
}

testFinalSolution();