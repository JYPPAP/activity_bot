# 🚀 Termux Discord Bot 설정 가이드

## 📋 **빠른 해결 방법**

### **1단계: Errsole 패키지 설치 시도**
```bash
# Termux에서 실행
npm run termux:install-errsole
```

### **2단계: 설치 실패 시 Fallback 모드 사용**
```bash
# Errsole 없이 봇 실행
npm run fallback:start

# 또는 PM2로 실행
npm run fallback:pm2
```

### **3단계: 스마트 시작 (권장)**
```bash
# 자동으로 최적의 시작 방법 선택
npm run smart:termux
```

## 🛠️ **Termux 환경 문제 해결**

### **❌ "Cannot find package 'errsole'" 오류**

이 오류는 sqlite3 패키지가 Android 환경에서 컴파일되지 않아 발생합니다.

#### **해결 방법 1: Fallback 모드 사용**
```bash
# Errsole 없이 바로 실행
npm run fallback:start
```

#### **해결 방법 2: 패키지 강제 설치**
```bash
# 캐시 삭제 후 재설치
npm run termux:fix-packages
```

#### **해결 방법 3: 스마트 시작 사용**
```bash
# 환경을 자동 감지하여 최적 방법으로 시작
npm run smart:termux
```

### **❌ sqlite3 컴파일 오류**

```
node-pre-gyp: Falling back to source compile
gyp ERR! find Python
```

#### **해결 방법: Termux 전용 로거 사용**
```bash
# Termux 환경용 메모리 저장소 사용
npm run termux:start
```

## 📊 **사용 가능한 모드 비교**

| 모드 | 로깅 시스템 | 웹 대시보드 | Slack 알림 | 추천 상황 |
|------|-------------|-------------|------------|----------|
| **Errsole (Regular)** | ✅ SQLite | ✅ Yes | ✅ Yes | 일반 환경 |
| **Errsole (Termux)** | ✅ Memory | ✅ Yes | ✅ Yes | Termux 성공 시 |
| **Fallback** | ✅ Console | ❌ No | ❌ No | Termux 실패 시 |
| **Smart Start** | 🔄 Auto | 🔄 Auto | 🔄 Auto | **권장 방법** |

## 🎯 **권장 사용 흐름**

### **처음 설정할 때**
```bash
# 1. 스마트 시작으로 테스트
npm run smart:termux

# 2. 성공 시 PM2로 데몬화
# Errsole 사용 가능한 경우:
npm run termux:start:external

# Fallback 모드인 경우:
npm run fallback:pm2
```

### **이미 설정된 경우**
```bash
# 기존 봇 중지
pm2 stop discord-bot

# 스마트 시작으로 재시작
npm run smart:termux

# 또는 직접 Termux 모드로 시작
npm run termux:start:external
```

## 🔧 **고급 문제 해결**

### **Python/컴파일 관련 오류**
```bash
# Termux 환경 재설정
pkg update && pkg upgrade
pkg install python nodejs npm clang make

# Node.js 모듈 재설치
rm -rf node_modules package-lock.json
npm install --no-optional
```

### **메모리 부족 오류**
```bash
# PM2 메모리 제한 확인
pm2 list

# 메모리 제한 늘리기 (ecosystem-termux.config.cjs에서)
# max_memory_restart: '1G'  # 기본값: 512M
```

### **네트워크 접속 문제**
```bash
# IP 확인
npm run termux:ip

# 외부 접속 모드로 전환
npm run termux:switch:external

# 대시보드 URL 확인
npm run termux:dashboard:external
```

## 📱 **Termux 특화 명령어**

### **🔍 환경 진단**
```bash
# 시스템 정보 확인
echo "Node.js: $(node --version)"
echo "NPM: $(npm --version)"
echo "Platform: $(uname -a)"

# 패키지 설치 상태 확인
npm list errsole axios

# 메모리 사용량 확인
free -h
```

### **🚀 다양한 시작 방법**
```bash
# 1. 스마트 시작 (자동 감지)
npm run smart:termux

# 2. Termux Errsole 모드
npm run termux:start:external

# 3. Fallback 모드 (Errsole 없음)
npm run fallback:start

# 4. 기본 노드 실행
node src/index-fallback.js
```

### **📊 모니터링**
```bash
# PM2 상태 확인
npm run termux:status

# 로그 확인
npm run termux:logs

# 실시간 모니터링
npm run termux:monit
```

## ⚡ **성능 최적화**

### **Termux 환경 최적화**
```bash
# 1. 불필요한 패키지 정리
npm prune

# 2. 캐시 정리
npm cache clean --force

# 3. 메모리 사용량 모니터링
watch -n 5 'free -h && pm2 list'
```

### **PM2 최적화 설정**
```javascript
// ecosystem-termux.config.cjs에서 수정
max_memory_restart: '512M',  // 메모리 제한
max_restarts: 3,             // 최대 재시작 횟수
min_uptime: '30s',           // 최소 업타임
restart_delay: 5000          // 재시작 지연
```

## 🎉 **성공 확인 방법**

### **1. 봇 상태 확인**
```bash
npm run termux:status
# 또는
pm2 list
```

### **2. 로그 확인**
```bash
npm run termux:logs
# 또는
tail -f logs/combined.log
```

### **3. 대시보드 접속 (Errsole 사용 시)**
```bash
# IP 확인
npm run termux:ip

# 브라우저에서 접속
# http://핸드폰IP:8002
```

### **4. Discord에서 봇 응답 확인**
- Discord 서버에서 봇이 온라인 상태인지 확인
- `/gap help` 등의 명령어 테스트

---

## 🆘 **응급 복구 방법**

모든 방법이 실패할 경우:

```bash
# 1. 모든 PM2 프로세스 종료
pm2 kill

# 2. Fallback 모드로 직접 실행
node src/index-fallback.js

# 3. 봇이 작동하면 문제 해결 후 PM2 재시작
# Ctrl+C로 종료 후
npm run smart:termux
```

이 가이드를 따라하면 Termux 환경에서도 안정적으로 Discord Bot을 실행할 수 있습니다! 🎉