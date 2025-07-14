// ecosystem.config.js - PM2 설정 (Errsole 적용)
module.exports = {
  apps: [{
    name: 'discord-bot',
    script: 'dist/index.js',
    
    // 환경 변수
    env: {
      NODE_ENV: 'development',
      
      // Errsole 웹 대시보드 포트
      ERRSOLE_PORT: 8002,
      
      // Discord Bot 환경변수들은 .env 파일에서 로드됨
      // TOKEN, GUILDID, CLIENT_ID, LOG_CHANNEL_ID 등
    },
    
    env_production: {
      NODE_ENV: 'production',
      
      // 운영 환경 Errsole 설정
      ERRSOLE_PORT: 8002,
      
      // 운영 환경에서는 MongoDB 사용 (Phase 2에서 구현)
      // MONGODB_URL: 'mongodb://localhost:27017/discord-bot-logs'
    },
    
    // PM2 설정
    instances: 1, // Discord Bot은 단일 인스턴스 권장
    exec_mode: 'fork',
    
    // 자동 재시작 설정
    autorestart: true,
    watch: false, // 파일 변경 감지 비활성화 (운영 환경에서는 false 권장)
    max_memory_restart: '1G',
    
    // 로그 설정 (Errsole과 병행)
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_type: 'json',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // 기존 PM2 로그와 Errsole 로그 병행 사용
    merge_logs: true,
    
    // 크래시 시 재시작 지연 (4초)
    restart_delay: 4000,
    
    // 최대 재시작 횟수 (무한 재시작 방지)
    max_restarts: 10,
    min_uptime: '10s',
    
    // Node.js 메모리 설정
    node_args: '--max-old-space-size=1024',
    
    // 정상 종료 설정
    kill_timeout: 5000,
    listen_timeout: 3000,
    
    // 환경별 추가 설정
    error_file: './logs/discord-bot-error.log',
    out_file: './logs/discord-bot-out.log',
    log_file: './logs/discord-bot-combined.log',
    
    // 로그 로테이션 설정
    max_size: '10M',
    retain: 180, // 180일치 로그 보관
    
    // 서버 재시작 시 자동 시작
    startup: 'user',
    
    // Errsole 대시보드 포트 충돌 방지
    env_file: '.env'
  }, {
    // TypeScript 개발용 설정
    name: 'discord-bot-dev',
    script: 'src/index.ts',
    interpreter: 'tsx',
    
    // 개발 환경 변수
    env: {
      NODE_ENV: 'development',
      ERRSOLE_PORT: 8003, // 개발용 포트
    },
    
    // 개발 환경 최적화
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: ['src/**/*.ts', 'src/**/*.js'], // TypeScript 파일 감시
    ignore_watch: ['node_modules', 'logs', 'dist'],
    max_memory_restart: '512M',
    
    // 빠른 재시작
    restart_delay: 1000,
    max_restarts: 5,
    min_uptime: '5s',
    
    // 개발용 로그
    log_file: './logs/dev-combined.log',
    out_file: './logs/dev-out.log',
    error_file: './logs/dev-error.log',
    
    env_file: '.env'
  }],
  
  deploy: {
    production: {
      // Termux 환경 설정
      user: process.env.USER || 'u0_a383', // Termux 기본 사용자
      host: 'localhost', // 로컬 배포
      ref: 'origin/master',
      repo: 'https://github.com/JYPPAP/activity_bot.git',
      path: '/data/data/com.termux/files/home/discord_bot',
      
      // 배포 후 실행할 명령어들
      'pre-setup': 'ls -la', // 배포 전 디렉토리 확인
      'post-setup': 'ls -la && pwd', // 배포 후 디렉토리 확인  
      'pre-deploy': 'git fetch --all', // 배포 전 최신 코드 가져오기
      'post-deploy': 'npm install && npm run build && npm run pm2:stop; npm run pm2:start --env production && npm run pm2:logs',
      
      // 배포 관련 설정
      ssh_options: 'ForwardAgent=yes', // SSH 에이전트 포워딩
      
      // Termux 환경에서는 SSH 없이 로컬 배포이므로 실제로는 사용하지 않을 수 있음
      // 대신 수동으로 git pull && npm run pm2:restart 사용 권장
    },
    
    // 개발 환경용 배포 설정 (선택사항)
    development: {
      user: process.env.USER || 'u0_a383',
      host: 'localhost', 
      ref: 'origin/master',
      repo: 'https://github.com/JYPPAP/activity_bot.git',
      path: '/data/data/com.termux/files/home/discord_bot',
      'post-deploy': 'npm install && npm run build && npm run pm2:start',
    }
  }
};