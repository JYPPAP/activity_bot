/** @type {import('jest').Config} */
export default {
  // TypeScript 지원
  preset: 'ts-jest',
  testEnvironment: 'node',
  
  // ES Modules 지원
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true
    }
  },
  
  // 테스트 파일 패턴
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/src/**/*.test.ts'
  ],
  
  // 변환 설정
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true
    }]
  },
  
  // 모듈 해석 설정
  moduleNameMapping: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  
  // 테스트 커버리지 설정
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/types/**',
    '!dist/**'
  ],
  
  // 테스트 환경 설정
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  
  // 타임아웃 설정
  testTimeout: 10000,
  
  // 병렬 실행 설정
  maxWorkers: '50%',
  
  // 무시할 패턴
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/'
  ],
  
  // 모듈 경로 무시 패턴
  modulePathIgnorePatterns: [
    '<rootDir>/dist/'
  ],
  
  // 캐시 디렉토리
  cacheDirectory: '<rootDir>/.jest-cache'
};