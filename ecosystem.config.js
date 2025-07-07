// ecosystem.config.js - PM2 설정 (Errsole 적용)
module.exports = {
  apps: [{
    name: 'discord-bot',
    script: 'src/index.js',
    
    // 환경 변수
    env: {
      NODE_ENV: 'development',
      
      // Errsole 웹 대시보드 포트
      ERRSOLE_PORT: 8001,
      
      // Discord Bot 환경변수들은 .env 파일에서 로드됨
      // TOKEN, GUILDID, CLIENT_ID, LOG_CHANNEL_ID 등
    },
    
    env_production: {
      NODE_ENV: 'production',
      
      // 운영 환경 Errsole 설정
      ERRSOLE_PORT: 8001,
      
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
    retain: 7, // 7일치 로그 보관
    
    // 서버 재시작 시 자동 시작
    startup: 'user',
    
    // Errsole 대시보드 포트 충돌 방지
    env_file: '.env'
  }],
  
  deploy: {
    production: {
      user: 'deploy',
      host: 'your-server.com',
      ref: 'origin/master',
      repo: 'git@github.com:your-username/discord-activity-bot.git',
      path: '/var/www/discord-activity-bot',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production'
    }
  }
};