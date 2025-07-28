# 🚀 로컬 테스트 실행 가이드

**프로젝트**: Discord Activity Bot (TypeScript)  
**버전**: 1.0.0  
**마지막 업데이트**: 2025-01-17

---

## 📋 목차

1. [빠른 시작](#-빠른-시작)
2. [환경 설정 확인](#-환경-설정-확인)
3. [실행 명령어](#-실행-명령어)
4. [전체 기능 테스트](#-전체-기능-테스트)
5. [모니터링 및 로그](#-모니터링-및-로그)
6. [문제 해결](#-문제-해결)
7. [성능 테스트](#-성능-테스트)

---

## 🎯 빠른 시작

### **환경 분리 이해**
이 프로젝트는 **개발환경**과 **프로덕션환경**으로 분리되어 있습니다:

- **개발환경** (로컬 컴퓨터): `.env.development` 파일 사용
- **프로덕션환경** (Termux 서버): `.env.production` 파일 사용

### **1단계: 환경 확인**
```bash
# 프로젝트 루트 디렉터리로 이동
cd "/mnt/d/Personal Project/activity_bot"

# 환경 설정 파일 확인
ls -la .env.*
# 다음 파일들이 있어야 함:
# .env.development  (개발환경용)
# .env.production   (프로덕션환경용)
# .env.backup       (백업 파일)

# 필수 파일 확인
ls -la package.json     # 패키지 정보 확인
```

### **2단계: 의존성 설치**
```bash
# 의존성 설치 (처음 실행 시)
npm install

# dotenv-cli 설치 확인 (환경 분리에 필요)
npm ls dotenv-cli
```

### **3단계: Redis 서버 설치**
```
● 📋 Redis 설치 안내

  현재 상황에서는 사용자가 직접 터미널에서 설치해야 합니다. 아래 단계를 따라 진행해주세요:      

  🔧 Redis 설치 단계

  1. 패키지 목록 업데이트

  sudo apt update

  2. Redis 서버 설치

  sudo apt install redis-server

  3. Redis 서비스 시작 및 활성화

  sudo systemctl start redis-server
  sudo systemctl enable redis-server

  4. 설치 확인

  # Redis 버전 확인                                                                             
  redis-server --version

  # Redis 연결 테스트                                                                           
  redis-cli ping
  # 응답: PONG이 나오면 정상                                                                    

  # 서비스 상태 확인                                                                            
  sudo systemctl status redis-server

  🐳 Docker 대안 (권장)

  Docker가 더 간단하고 격리된 환경을 제공합니다:

  1. Docker 설치 (WSL2에서)

  # Docker 설치 스크립트 다운로드 및 실행                                                       
  curl -fsSL https://get.docker.com -o get-docker.sh
  sudo sh get-docker.sh

  # 사용자를 docker 그룹에 추가                                                                 
  sudo usermod -aG docker $USER

  # WSL 재시작 후 Docker 서비스 시작                                                            
  sudo service docker start

  2. Redis 컨테이너 실행

  # Redis 컨테이너 실행                                                                         
  docker run -d --name redis-server -p 6379:6379 redis:latest

  # 연결 테스트                                                                                 
  docker exec redis-server redis-cli ping
```


### **4단계: 개발환경에서 테스트 실행**
```bash
# 개발환경으로 실행 (.env.development 사용)
npm run dev

# 또는 파일 변경 감지 모드
npm run dev:watch

# 전체 품질 체크 + 빌드 + 개발환경 실행
npm run test
```

---

## 🔧 환경 설정 확인

### **개발환경 설정 (.env.development)**
로컬 컴퓨터에서 테스트할 때 사용하는 설정입니다:

```env
# 환경 구분
NODE_ENV=development

# Errsole 개발 환경 설정 (로컬 접속만)
ERRSOLE_HOST=localhost
ERRSOLE_PORT=8002

# Discord Bot 설정
TOKEN=your_discord_bot_token
CLIENT_ID=your_client_id
GUILDID=your_guild_id

# 개발용 로그 설정
LOG_LEVEL=debug
ENABLE_SLACK_ALERTS=false      # Slack 알림 비활성화
DEBUG=discord-bot:*            # 상세 디버깅

# Redis 설정 (개발용 DB 1번 사용)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=1

# 성능 모니터링 (개발환경에서는 비활성화)
ENABLE_PERFORMANCE_MONITORING=false
```

### **프로덕션환경 설정 (.env.production)**
Termux 서버에서 운영할 때 사용하는 설정입니다:

```env
# 환경 구분
NODE_ENV=production

# Errsole 프로덕션 환경 설정 (외부 접근 허용)
ERRSOLE_HOST=0.0.0.0
ERRSOLE_PORT=8002

# 프로덕션용 로그 설정
LOG_LEVEL=info
ENABLE_SLACK_ALERTS=true       # Slack 알림 활성화
SLACK_WEBHOOK_URL=your_webhook_url
SLACK_CHANNEL=#discord-bot-alert

# Redis 설정 (프로덕션용 DB 0번 사용)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0

# 성능 모니터링 활성화
ENABLE_PERFORMANCE_MONITORING=true
```

### **환경 변수 검증**
```bash
# 개발환경 설정 확인
cat .env.development | grep -E "(NODE_ENV|ERRSOLE_HOST|ENABLE_SLACK_ALERTS)"

# 프로덕션환경 설정 확인
cat .env.production | grep -E "(NODE_ENV|ERRSOLE_HOST|ENABLE_SLACK_ALERTS)"

# 환경 변수 로드 테스트 (개발환경)
npm run dev 2>&1 | grep "환경변수 검증"
```

---

## 🎮 실행 명령어

### **개발환경 명령어**

#### **1. 기본 개발 모드 (.env.development 사용)**
```bash
npm run dev
```
- **환경**: 개발환경 (.env.development)
- **특징**: localhost:8002, 상세 로그, Slack 알림 비활성화
- **용도**: 로컬 개발 및 테스트

#### **2. 감시 모드 (추천)**
```bash
npm run dev:watch
```
- **기능**: 파일 변경 시 자동 재시작
- **환경**: 개발환경 (.env.development)
- **장점**: 개발 중 편리함

#### **3. 개발환경 빌드 및 실행**
```bash
# 개발환경 빌드
npm run dev:build

# 개발환경 빌드 후 실행
npm run dev:start

# 개발환경 전체 테스트
npm run test
```

### **프로덕션환경 명령어**

#### **1. 프로덕션 빌드 및 PM2 실행**
```bash
npm run start:prod
```
- **환경**: 프로덕션환경 (.env.production)
- **특징**: 0.0.0.0:8002, 운영 로그, Slack 알림 활성화
- **용도**: Termux 서버 배포

#### **2. 프로덕션 환경 테스트**
```bash
npm run test:prod
```
- **기능**: 프로덕션 설정으로 품질 체크 + 빌드

#### **3. 명령어 등록**
```bash
# 개발환경 명령어 등록
npm run register

# 프로덕션환경 명령어 등록
npm run register:prod
```

### **공통 명령어**

#### **코드 품질 검사**
```bash
# 전체 품질 검사
npm run quality

# TypeScript 타입 체크
npm run type-check

# ESLint 검사
npm run lint

# ESLint 자동 수정
npm run lint:fix

# Prettier 포맷 검사
npm run format:check

# Prettier 자동 포맷팅
npm run format
```

#### **기본 빌드 및 실행**
```bash
# TypeScript 빌드
npm run build

# 빌드 결과물 실행 (환경변수 없이)
npm run start

# 빌드 결과물 정리
npm run clean
```

---

## 🧪 전체 기능 테스트

### **1. 환경별 테스트 절차**

#### **개발환경 테스트**
```bash
# 1. 코드 품질 확인
npm run quality

# 2. 개발모드 실행
npm run dev

# 3. 대시보드 접속 확인
# http://localhost:8002

# 4. 환경변수 확인
# 로그에서 "NODE_ENV: development" 확인
# "ERRSOLE_HOST: localhost" 확인
# "Slack 알림 비활성화" 확인
```

#### **프로덕션환경 테스트**
```bash
# 1. 프로덕션 테스트
npm run test:prod

# 2. 프로덕션 실행 (실제 서버에서)
npm run start:prod

# 3. 외부 대시보드 접속 확인
# http://핸드폰IP:8002

# 4. 환경변수 확인
# 로그에서 "NODE_ENV: production" 확인
# "ERRSOLE_HOST: 0.0.0.0" 확인
# "Slack 알림 활성화" 확인
```

### **2. Discord 기능 테스트**

#### **봇 시작 확인**
1. 봇 실행 후 콘솔 확인
2. Discord 서버에서 봇 온라인 상태 확인
3. 환경별 로그 패턴 확인

#### **슬래시 명령어 테스트**
```bash
# Discord 명령어 등록 (환경별)
npm run register      # 개발환경
npm run register:prod # 프로덕션환경

# Discord 서버에서 테스트할 명령어들:
# /구직 - 구직 포스트 생성
# /갭체크 - 활동 시간 체크
# /잠수 - 잠수 상태 설정
# /리포트 - 활동 보고서 생성
# /설정 - 봇 설정 변경
```

#### **음성 채널 활동 테스트**
1. 음성 채널 입장/퇴장
2. 활동 시간 누적 확인
3. 환경별 로그 기록 확인

---

## 📊 모니터링 및 로그

### **환경별 대시보드 접속**

#### **개발환경 대시보드**
```bash
# URL: http://localhost:8002
# 특징: 로컬에서만 접속 가능
# 로그 레벨: debug (상세한 로그)
# Slack 알림: 비활성화
```

#### **프로덕션환경 대시보드**
```bash
# URL: http://핸드폰IP:8002
# 예시: http://192.168.219.101:8002
# 특징: 같은 네트워크에서 접속 가능
# 로그 레벨: info (운영 로그)
# Slack 알림: 활성화
```

### **핸드폰 IP 확인 (Termux)**
```bash
# Termux에서 IP 확인
npm run ip

# 또는 직접 명령어
termux-wifi-connectioninfo | grep 'ip_address'
```

### **환경별 로그 패턴**

#### **개발환경 로그**
```
✅ Errsole 개발 환경 설정 완료 (Termux)
📊 대시보드 (localhost): http://localhost:8002
🔍 환경변수 검증:
   - NODE_ENV: development
   - ERRSOLE_HOST: localhost
   - ENABLE_SLACK_ALERTS: false
🔕 Slack 알림 비활성화
```

#### **프로덕션환경 로그**
```
✅ Errsole 운영 환경 설정 완료
📊 대시보드: http://핸드폰IP:8002
🔍 환경변수 검증:
   - NODE_ENV: production
   - ERRSOLE_HOST: 0.0.0.0
   - ENABLE_SLACK_ALERTS: true
🔔 Slack 알림 활성화: #discord-bot-alert
```

### **로그 파일 확인**
```bash
# 환경별 SQLite 로그 파일
ls -la logs/discord-bot-*.log.sqlite

# 개발환경: discord-bot-development.log.sqlite
# 프로덕션환경: discord-bot-production.log.sqlite
```

---

## 🔍 문제 해결

### **환경 분리 관련 문제**

#### **1. localhost:8002가 열리지 않는 경우**
```bash
# 개발환경 설정 확인
grep -E "ERRSOLE_HOST|ERRSOLE_PORT" .env.development

# 올바른 설정 확인:
# ERRSOLE_HOST=localhost
# ERRSOLE_PORT=8002

# 포트 사용 확인
netstat -tulpn | grep 8002
lsof -i :8002
```

#### **2. 잘못된 환경 파일 로드**
```bash
# 현재 로드된 환경 확인
npm run dev 2>&1 | grep "NODE_ENV"

# 올바른 출력:
# 개발환경: NODE_ENV: development
# 프로덕션환경: NODE_ENV: production

# dotenv-cli 작동 확인
npm ls dotenv-cli
```

#### **3. 환경변수가 적용되지 않는 경우**
```bash
# 환경 파일 존재 확인
ls -la .env.development .env.production

# 파일 권한 확인
chmod 644 .env.development .env.production

# 환경 파일 내용 확인
cat .env.development | head -10
cat .env.production | head -10
```

#### **4. Slack 알림 설정 문제**
```bash
# 개발환경: Slack 알림이 비활성화되어야 함
grep "ENABLE_SLACK_ALERTS" .env.development
# 출력: ENABLE_SLACK_ALERTS=false

# 프로덕션환경: Slack 알림이 활성화되어야 함
grep "ENABLE_SLACK_ALERTS" .env.production
# 출력: ENABLE_SLACK_ALERTS=true
```

### **일반적인 오류 및 해결 방법**

#### **1. Discord 토큰 오류**
```bash
# 증상: Bot token is invalid
# 해결: 환경별 TOKEN 확인
grep "TOKEN" .env.development
grep "TOKEN" .env.production
```

#### **2. 포트 충돌 오류**
```bash
# 증상: EADDRINUSE: address already in use :::8002
# 해결: 포트 사용 프로세스 확인
netstat -tulpn | grep 8002

# 또는 환경변수로 다른 포트 사용
# .env.development에서 ERRSOLE_PORT=8003으로 변경
```

#### **3. 환경별 데이터베이스 분리**
```bash
# 개발환경: Redis DB 1번 사용
grep "REDIS_DB" .env.development
# 출력: REDIS_DB=1

# 프로덕션환경: Redis DB 0번 사용
grep "REDIS_DB" .env.production
# 출력: REDIS_DB=0
```

### **디버깅 팁**

#### **1. 환경변수 디버깅**
```bash
# 개발환경 환경변수 전체 출력
npm run dev 2>&1 | grep -A 10 "환경변수 검증"

# 특정 환경변수 확인
npm run dev 2>&1 | grep -E "(NODE_ENV|ERRSOLE_HOST|SLACK)"
```

#### **2. 환경 전환 테스트**
```bash
# 개발 → 프로덕션 전환 테스트
npm run test        # 개발환경 테스트
npm run test:prod   # 프로덕션환경 테스트

# 결과 비교하여 환경 분리 확인
```

---

## 🚀 성능 테스트

### **환경별 성능 특성**

#### **개발환경 성능**
- 성능 모니터링: 비활성화 (개발에 집중)
- 로그 레벨: debug (상세함, 성능 영향 있음)
- Slack 알림: 비활성화 (네트워크 트래픽 감소)

#### **프로덕션환경 성능**
- 성능 모니터링: 활성화 (상세한 메트릭 수집)
- 로그 레벨: info (효율적)
- Slack 알림: 활성화 (중요 이벤트만)

### **환경별 성능 테스트**
```bash
# 개발환경 성능 테스트
npm run dev
# 메모리 사용량과 응답 시간 확인

# 프로덕션환경 성능 테스트
npm run start:prod
# PM2 모니터링과 성능 메트릭 확인
```

---

## 📋 환경별 테스트 체크리스트

### **개발환경 체크리스트**
- [ ] `.env.development` 파일 설정 완료
- [ ] `npm run dev`로 로컬 실행 성공
- [ ] `http://localhost:8002` 대시보드 접속
- [ ] 로그에서 "NODE_ENV: development" 확인
- [ ] 로그에서 "ERRSOLE_HOST: localhost" 확인
- [ ] Slack 알림 비활성화 확인
- [ ] 상세 디버그 로그 출력 확인
- [ ] Redis DB 1번 사용 확인

### **프로덕션환경 체크리스트**
- [ ] `.env.production` 파일 설정 완료
- [ ] `npm run test:prod` 성공
- [ ] 핸드폰 IP 확인 완료
- [ ] 로그에서 "NODE_ENV: production" 확인
- [ ] 로그에서 "ERRSOLE_HOST: 0.0.0.0" 확인
- [ ] Slack 웹훅 URL 설정 완료
- [ ] Slack 알림 활성화 확인
- [ ] Redis DB 0번 사용 확인

### **공통 기능 체크리스트**
- [ ] 봇 온라인 상태 확인
- [ ] 슬래시 명령어 등록 확인
- [ ] 음성 채널 활동 추적 테스트
- [ ] 포럼 연동 기능 테스트
- [ ] 데이터베이스 읽기/쓰기 테스트
- [ ] 환경별 대시보드 접속 확인

---

## 🎯 환경별 권장 워크플로우

### **개발 단계 (로컬 컴퓨터)**
1. `npm run quality` - 코드 품질 확인
2. `npm run dev:watch` - 개발 모드 실행
3. `http://localhost:8002` - 대시보드 확인
4. Discord에서 기능 테스트
5. 로그에서 환경설정 확인

### **배포 전 단계**
1. `npm run test` - 개발환경 전체 테스트
2. `npm run test:prod` - 프로덕션환경 테스트
3. 환경별 설정 차이 확인
4. 성능 및 안정성 확인

### **운영 단계 (Termux 서버)**
1. `npm run start:prod` - 프로덕션 실행
2. `http://핸드폰IP:8002` - 외부 대시보드 확인
3. Slack 알림 수신 확인
4. 성능 모니터링 지표 추적

---

## 💡 환경 분리 추가 팁

### **환경 파일 관리**
```bash
# 환경 파일 백업
cp .env.development .env.development.backup
cp .env.production .env.production.backup

# 환경 파일 비교
diff .env.development .env.production
```

### **환경별 데이터베이스**
- SQLite: 환경별로 다른 파일명 사용 가능
- Redis: DB 번호로 분리 (개발=1, 프로덕션=0)
- 로그: 환경별 SQLite 로그 파일 자동 분리

### **개발 효율성**
- 개발환경: 상세 로그로 디버깅 용이
- 프로덕션환경: 최적화된 로그로 성능 확보
- 환경 전환: npm script로 간편하게 전환

---

## 🆘 환경별 긴급 상황 대응

### **개발환경 문제**
```bash
# localhost:8002 접속 불가
netstat -tulpn | grep 8002
kill $(lsof -t -i:8002)
npm run dev

# 환경변수 로드 실패
rm node_modules/.cache -rf
npm install
npm run dev
```

### **프로덕션환경 문제**
```bash
# 외부 접속 불가
# Termux에서 확인
npm run ip
# 방화벽 설정 확인

# Slack 알림 실패
# .env.production의 SLACK_WEBHOOK_URL 확인
```

---

**📞 지원**: 환경 분리를 통해 개발과 운영을 안전하게 분리하여 관리할 수 있습니다!  
**🔄 업데이트**: 환경별 설정이나 새로운 기능 추가 시 이 문서를 업데이트하세요.
