// ecosystem-termux.config.cjs - Termux 환경용 PM2 설정
module.exports = {
  apps: [{
    name: 'discord-bot',
    script: 'src/index-termux.js', // Termux 전용 진입점 사용
    
    // 환경 변수
    env: {
      NODE_ENV: 'development',
      
      // Errsole 웹 대시보드 포트
      ERRSOLE_PORT: 8001,
      
      // Termux 환경 표시
      PLATFORM: 'termux',
      
      // Discord Bot 환경변수들은 .env 파일에서 로드됨
    },
    
    env_production: {
      NODE_ENV: 'production',
      
      // 운영 환경 Errsole 설정
      ERRSOLE_PORT: 8001,
      
      // Termux 환경 표시
      PLATFORM: 'termux',
    },
    
    // PM2 설정 (Termux 최적화)
    instances: 1, // Discord Bot은 단일 인스턴스 권장
    exec_mode: 'fork',
    
    // 자동 재시작 설정
    autorestart: true,
    watch: false,
    max_memory_restart: '512M', // Termux는 메모리가 제한적이므로 낮게 설정
    
    // 로그 설정
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_type: 'json',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    merge_logs: true,
    
    // 크래시 시 재시작 지연 (Termux에서는 조금 더 길게)
    restart_delay: 6000,
    
    // 최대 재시작 횟수 (무한 재시작 방지)
    max_restarts: 5,
    min_uptime: '30s', // Termux에서는 시작 시간이 더 오래 걸릴 수 있음
    
    // Node.js 메모리 설정 (Termux 최적화)
    node_args: '--max-old-space-size=512',
    
    // 정상 종료 설정
    kill_timeout: 10000, // Termux에서는 종료 시간이 더 오래 걸릴 수 있음
    listen_timeout: 5000,
    
    // Termux 특화 설정
    cwd: '/data/data/com.termux/files/home/discord_bot',
    
    // 환경 파일 로드
    env_file: '.env'
  }]
};