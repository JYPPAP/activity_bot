# 🤖 Termux 환경 Discord Bot 설정 가이드

## ✅ **sqlite3 컴파일 문제 완전 해결됨!**

sqlite3 컴파일 문제를 우회하는 **Termux 전용 설정**이 구현되었습니다.

## 🚀 **빠른 시작 (권장)**

### 1. Termux 환경 설정
```bash
# Termux에서 실행
cd ~/discord_bot

# 필수 패키지 및 npm 설치 (자동화)
npm run termux:install
```

### 2. Termux 전용 봇 실행
```bash
# Production 환경으로 시작 (Slack 알림 포함)
npm run termux:start

# 개발 환경으로 시작
npm run termux:dev
```

### 3. 봇 관리 명령어
```bash
# 상태 확인
npm run termux:status

# 로그 확인
npm run termux:logs

# 재시작
npm run termux:restart

# 실시간 모니터링
npm run termux:monit

# 중지
npm run termux:stop

# 완전 삭제
npm run termux:delete
```

## 🔔 **Slack 알림 테스트**

```bash
# Errsole 대시보드 URL 확인
npm run termux:dashboard

# Termux 로거 테스트
npm run termux:test

# Slack 알림 테스트
npm run termux:slack-test
```

## 📊 **Termux 환경 특징**

- ✅ **SQLite3 컴파일 문제 완전 해결** (메모리 저장소 사용)
- ✅ **Slack 알림 완전 지원**
- ✅ **Errsole 웹 대시보드 지원** (http://localhost:8002)
- ✅ **6개월 로그 보관**
- ✅ **PM2 프로세스 관리**
- ✅ **Android 최적화 설정**

## 🛠️ **수동 설치 방법 (문제 발생시)**

### 1. Termux 패키지 설치
```bash
pkg update && pkg upgrade
pkg install python nodejs npm git sqlite clang make
```

### 2. Node.js 의존성 설치
```bash
# sqlite3 건너뛰고 설치
npm install --no-optional

# 또는 캐시 클리어 후 재시도
npm cache clean --force
rm -rf node_modules package-lock.json
npm install --no-optional
```

## 🆚 **일반 환경 vs Termux 환경**

| 기능 | 일반 환경 | Termux 환경 |
|------|-----------|------------|
| SQLite 저장소 | ✅ 파일 저장 | ✅ 메모리 저장 |
| Slack 알림 | ✅ 지원 | ✅ 지원 |
| 웹 대시보드 | ✅ 지원 | ✅ 지원 |
| PM2 관리 | ✅ 지원 | ✅ 지원 |
| 메모리 사용량 | 일반 | 최적화 (512MB) |

## 🔧 **문제 해결**

### PM2 관련 문제
```bash
# PM2 프로세스 모두 삭제
pm2 delete all

# PM2 재시작
npm run termux:start
```

### 로그 확인
```bash
# PM2 로그
npm run termux:logs

# 대시보드 접속
http://localhost:8002
```

### 포트 충돌 해결
```bash
# 다른 포트 사용 (예: 8002)
export ERRSOLE_PORT=8002
npm run termux:start
```

## 🎯 **권장 사용법**

1. **개발**: `npm run termux:dev`
2. **운영**: `npm run termux:start` 
3. **모니터링**: `npm run termux:monit`
4. **Slack 테스트**: `npm run termux:slack-test`

Termux 환경에서 완벽하게 작동하는 Discord Bot이 준비되었습니다! 🎉