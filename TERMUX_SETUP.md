# 🤖 Termux Discord Bot 설정 가이드

**현재 버전**: 1.0.0 (Errsole 통합)  
**마지막 업데이트**: 2025-07-07

## 🚀 빠른 시작

### **1단계: Termux 환경 설정**
```bash
# Termux에서 필수 패키지 설치
npm run setup
```

### **2단계: 봇 실행**
```bash
# 한 번의 명령으로 업데이트 + 시작 + 외부 접근
npm run update
```

### **3단계: 대시보드 접속**
```bash
# 핸드폰 IP 확인
npm run ip

# 컴퓨터에서 브라우저 접속
# http://핸드폰IP:8002 (예: http://192.168.219.101:8002)
```

## 📋 실제 사용 가능한 명령어

### **🎯 주요 명령어**
```bash
# 메인 명령어 (코드 업데이트 + 봇 재시작)
npm run update

# PM2로 외부 접근 모드 시작
npm run external

# 핸드폰 IP 주소 확인
npm run ip

# Slack 알림 테스트
npm run slack
```

### **🔧 관리 명령어**
```bash
# PM2 상태 확인
npm run status

# 실시간 로그 확인
npm run logs

# PM2 재시작
npm run restart

# PM2 중지
npm run stop

# 개발 모드 (nodemon)
npm run dev

# Discord 명령어 등록
npm run register
```

### **🧪 테스트 명령어**
```bash
# 로거 테스트
npm run test

# Slack 알림 테스트
npm run slack
```

## 🌐 외부 접근 설정

### **현재 설정 (이미 구성됨)**
- **Errsole Host**: `0.0.0.0` (외부 접근 허용)
- **포트**: `8002`
- **외부 접근**: 같은 네트워크 내에서 가능

### **접속 방법**
```bash
# 1. 핸드폰 IP 확인
npm run ip
# 출력 예: 192.168.219.101

# 2. 컴퓨터 브라우저에서 접속
# http://192.168.219.101:8002
```

### **접속 테스트**
```bash
# 핸드폰에서 로컬 접속 테스트
curl http://localhost:8002

# 핸드폰에서 외부 IP 접속 테스트  
curl http://$(npm run ip --silent):8002
```

## 🔔 Slack 알림 설정

### **환경변수 확인 (.env 파일)**
```env
# Slack 알림 활성화
ENABLE_SLACK_ALERTS=true

# Slack Webhook URL
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# Slack 채널
SLACK_CHANNEL=#discord-bot-alerts

# 최소 알림 레벨
SLACK_MIN_LEVEL=error
```

### **Slack 알림 테스트**
```bash
# Slack으로 테스트 메시지 전송
npm run slack

# 성공 시 Slack 채널에 메시지 수신 확인
```

## 📊 모니터링 및 관리

### **시스템 상태 확인**
```bash
# PM2 프로세스 상태
npm run status

# 실시간 로그 모니터링
npm run logs

# 시스템 리소스 확인
free -h
df -h
```

### **Errsole 대시보드**
- **안드로이드 접속**: http://localhost:8002
- **컴퓨터 접속**: http://핸드폰IP:8002
- **로그 보관**: 180일 (6개월)
- **로그 파일**: `logs/discord-bot-prod.log.sqlite`

### **로그 파일 위치**
```bash
# PM2 로그
logs/combined.log
logs/out.log  
logs/error.log

# Errsole SQLite 로그
logs/discord-bot-prod.log.sqlite
logs/discord-bot-dev.log.sqlite
```

## 🛠 문제 해결

### **1. 봇이 시작되지 않는 경우**
```bash
# PM2 프로세스 완전 정리
pm2 delete all
pm2 kill

# 다시 시작
npm run update
```

### **2. 포트 충돌 오류**
```bash
# 포트 사용 프로세스 확인 (제한적)
ps aux | grep node

# PM2 프로세스 정리 후 재시작
pm2 delete discord-bot
npm run update
```

### **3. 외부 접근이 안 되는 경우**
```bash
# IP 주소 재확인
npm run ip

# 네트워크 연결 확인
ping 8.8.8.8

# .env 파일의 ERRSOLE_HOST 확인
# ERRSOLE_HOST=0.0.0.0 인지 확인
```

### **4. Slack 알림이 안 되는 경우**
```bash
# Slack 설정 테스트
npm run slack

# .env 파일 확인
# ENABLE_SLACK_ALERTS=true
# SLACK_WEBHOOK_URL이 올바른지 확인

# 수동 테스트
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"Test from Termux"}' \
  SLACK_WEBHOOK_URL
```

### **5. 메모리 부족 문제**
```bash
# 메모리 사용량 확인
free -h
pm2 list

# 메모리 정리
pm2 restart discord-bot
```

## ⚡ 성능 최적화

### **Termux 환경 최적화**
```bash
# 불필요한 패키지 정리
npm prune

# 캐시 정리  
npm cache clean --force

# Node.js 메모리 사용량 모니터링
pm2 monit
```

### **PM2 설정 (이미 최적화됨)**
- **메모리 제한**: 512MB
- **최대 재시작**: 5회
- **재시작 지연**: 6초
- **최소 업타임**: 30초

## 🔧 고급 설정

### **환경 변수 커스터마이징**
```bash
# 다른 포트 사용 시
export ERRSOLE_PORT=8003
npm run update

# 호스트 설정 변경 시  
export ERRSOLE_HOST=localhost  # 로컬만 접근
npm run update
```

### **개발 환경 설정**
```bash
# 개발 모드 (nodemon + 자동 재시작)
npm run dev

# 로거만 테스트
npm run test
```

## 📱 일반적인 사용 흐름

### **일상적인 봇 관리**
```bash
# 1. 코드 업데이트 및 봇 재시작
npm run update

# 2. 상태 확인
npm run status

# 3. 대시보드 접속하여 로그 확인
# http://핸드폰IP:8002

# 4. 필요시 Slack 알림 테스트
npm run slack
```

### **문제 발생 시 진단**
```bash
# 1. 현재 상태 확인
npm run status
npm run logs

# 2. 완전 재시작
pm2 delete all
npm run update

# 3. 접속 테스트
curl http://localhost:8002
```

## 🔒 보안 고려사항

### **✅ 안전한 사용법**
- **같은 Wi-Fi 네트워크 내에서만 외부 접근 가능**
- **공유기 방화벽으로 보호됨**
- **Slack webhook URL 보안 유지**

### **⚠️ 주의사항**  
- **공용 Wi-Fi에서 외부 접근 금지**
- **민감한 로그 정보 주의**
- **.env 파일 외부 공유 금지**

## 🎉 기능 요약

### **✅ 현재 구현된 기능**
- ✅ Errsole 로깅 시스템 (SQLite)
- ✅ 웹 대시보드 (포트 8002)
- ✅ 외부 네트워크 접근 (0.0.0.0 바인딩)
- ✅ Slack 실시간 알림
- ✅ 6개월 로그 보관
- ✅ PM2 프로세스 관리
- ✅ 자동 재시작 및 복구
- ✅ 환경변수 중앙 관리

### **🎯 주요 장점**
- **한 번의 명령어로 모든 기능 실행** (`npm run update`)
- **컴퓨터에서 핸드폰 봇 원격 모니터링**
- **실시간 Slack 알림으로 즉시 문제 인지**
- **SQLite 기반 안정적인 로그 저장**

---

## 🆘 긴급 복구 방법

모든 방법이 실패할 경우:

```bash
# 1. 모든 PM2 프로세스 종료
pm2 kill

# 2. 기본 노드 실행으로 테스트
node src/index.js

# 3. 정상 작동 확인 후 PM2 재시작
# Ctrl+C로 종료 후
npm run update
```

---

**📞 지원**: 이 가이드를 따라하면 Termux 환경에서 안정적으로 Discord Bot을 실행할 수 있습니다!  
**🔄 업데이트**: 새로운 기능 추가 시 이 문서를 업데이트하세요.