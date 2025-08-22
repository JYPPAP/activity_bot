// ecosystem-termux.config.cjs - Termux 환경용 PM2 설정
module.exports = {
  apps: [{
    name: 'discord-bot',
    script: 'src/index.js',

    stop_exit_codes: [0],

    ignore_watch: [
      'node_modules',
      'logs',          // Errsole .sqlite 포함
      '*.sqlite',
      '*.db',
      '.env'
    ],
    
    // 환경 변수
    env: {
      NODE_ENV: 'development',
      
      // Errsole 웹 대시보드 설정
      ERRSOLE_PORT: 8002,
      ERRSOLE_HOST: 'localhost', // 기본값: 로컬 접속만
      
      // Termux 환경 표시
      PLATFORM: 'termux',
      
      // Discord Bot 환경변수들은 .env 파일에서 로드됨
    },
    
    env_production: {
      NODE_ENV: 'production',
      
      // 운영 환경 Errsole 설정
      ERRSOLE_PORT: 8002,
      ERRSOLE_HOST: '0.0.0.0', // 외부 접근 허용
      
      // Slack 알림 설정
      ENABLE_SLACK_ALERTS: 'true',
      
      // Termux 환경 표시
      PLATFORM: 'termux',
    },
    
    // PM2 설정 (Termux 최적화)
    instances: 1, // Discord Bot은 단일 인스턴스 권장
    exec_mode: 'fork',
    
    // 자동 재시작 설정 (메모리 누수 대응 강화)
    autorestart: true,
    watch: false,
    max_memory_restart: '256M', // 더 빈번한 재시작으로 메모리 누수 방지
    
    // 로그 설정
    out_file: './logs/pm2-out.log',
    error_file: './logs/pm2-error.log',
    log_type: 'json',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    merge_logs: false,
    
    // 크래시 시 재시작 지연 (더 빠른 복구를 위해 단축)
    exp_backoff_restart_delay: 2000,
    restart_delay: 3000,

    // 최대 재시작 횟수 (SQLite 잠금 문제 대응을 위해 증가)
    max_restarts: 10,
    min_uptime: '15s', // 더 빠른 재시작 판단
    
    // Node.js 메모리 설정 (PM2 메모리 제한과 일치)
    node_args: '--max-old-space-size=256 --expose-gc',
    
    // 정상 종료 설정
    kill_timeout: 10000, // Termux에서는 종료 시간이 더 오래 걸릴 수 있음
    listen_timeout: 5000,
    
    // Termux 특화 설정
    cwd: '/data/data/com.termux/files/home/discord_bot',
    
    // 환경 파일 로드
    env_file: '.env'
  }]
};