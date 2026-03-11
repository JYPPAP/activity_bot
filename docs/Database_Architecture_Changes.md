# Database Architecture Changes

## 🏗️ 개요

Discord Activity Bot의 데이터베이스를 **LowDB (JSON 기반)**에서 **PostgreSQL (관계형 DB)**로 마이그레이션하면서 진행된 스키마 설계와 아키텍처 변경사항을 상세히 문서화합니다.

---

## 📊 Before vs After 비교

### 기존 LowDB 구조
```
📁 데이터 파일들
├── activity_bot.json          # 메인 활동 데이터
├── role_config.json          # 역할 설정
└── (기타 JSON 파일들)

📊 논리적 테이블 구조 (JSON 내부)
├── users                     # 사용자 정보
├── activity_logs            # 활동 로그 (중간 저장)
├── afk_status              # 잠수 상태
├── forum_messages          # 포럼 메시지
└── post_integrations       # 포스트 연동
```

### 신규 PostgreSQL 구조  
```sql
🗄️ PostgreSQL 데이터베이스
├── users                    # 사용자 정보 + 잠수 상태 통합
├── guild_settings          # 길드 설정
├── post_integrations       # 포스트 연동 + 포럼 메시지 통합
├── user_activities_202501  # 2025년 1월 활동 (자동 파티셔닝)
├── user_activities_202502  # 2025년 2월 활동 (자동 파티셔닝)
└── (미래 월별 테이블들)
```

---

## 🎯 핵심 설계 원칙

### 1. **단순화 (Simplification)**
- **테이블 통합**: 관련된 데이터를 단일 테이블로 집약
- **중간 저장소 제거**: activity_logs 테이블 완전 제거
- **실시간 저장**: 중간 단계 없이 직접 최종 테이블에 저장

### 2. **성능 최적화 (Performance)**
- **월별 파티셔닝**: 대용량 데이터 효율적 관리
- **전략적 인덱싱**: 쿼리 패턴 기반 복합 인덱스
- **JSONB 활용**: 일일 활동 데이터 구조화된 저장

### 3. **확장성 (Scalability)**
- **자동 파티셔닝**: 월별 테이블 자동 생성
- **유연한 스키마**: JSONB로 향후 데이터 구조 변경 대응
- **Connection Pool**: 동시 연결 최적화

---

## 🗂️ 상세 테이블 설계

### 1. **users** 테이블 (사용자 정보 + 잠수 상태 통합)

#### 설계 의도
기존의 `users`와 `afk_status` 테이블을 통합하여 사용자 관련 정보를 단일 테이블에서 관리

#### 스키마 구조
```sql
CREATE TABLE users (
    user_id VARCHAR(20) PRIMARY KEY,           -- Discord 사용자 ID
    username VARCHAR(100) NOT NULL,            -- 사용자명
    guild_id VARCHAR(20) NOT NULL,            -- 길드 ID
    first_joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- 잠수 상태 관리 (기존 afk_status 테이블 통합)
    inactive_start_date DATE NULL,             -- 잠수 시작 날짜
    inactive_end_date DATE NULL,               -- 잠수 종료 날짜 (NULL이면 진행중)
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 주요 변경사항
- **통합 관리**: 별도 afk_status 테이블 제거하고 users에 통합
- **날짜 기반**: 잠수 상태를 start/end date로 명확하게 관리
- **자동 타임스탬프**: created_at, updated_at 자동 관리

#### 인덱스 전략
```sql
-- 길드별 사용자 조회 최적화
CREATE INDEX idx_users_guild_id ON users(guild_id);

-- 잠수 상태 조회 최적화 (활성 잠수만)
CREATE INDEX idx_users_inactive_dates ON users(inactive_start_date, inactive_end_date) 
WHERE inactive_start_date IS NOT NULL;
```

---

### 2. **guild_settings** 테이블 (길드 설정)

#### 설계 의도
길드별 설정을 구조화하여 관리하고, JSONB를 활용해 복잡한 설정 데이터 저장

#### 스키마 구조
```sql
CREATE TABLE guild_settings (
    guild_id VARCHAR(20) PRIMARY KEY,
    guild_name VARCHAR(200),
    
    -- JSONB 활용한 유연한 설정 관리
    game_roles JSONB DEFAULT '[]'::jsonb,
    excluded_voice_channels JSONB DEFAULT '{"type1": [], "type2": []}'::jsonb,
    activity_tiers JSONB DEFAULT '{
        "tier1": {"min": 30, "max": null},
        "tier2": {"min": 20, "max": 29},
        "tier3": {"min": 15, "max": 19},
        "tier4": {"min": 10, "max": 14},
        "tier5": {"min": 0, "max": 9}
    }'::jsonb,
    
    -- 기본 설정
    log_channel_id VARCHAR(20),
    report_channel_id VARCHAR(20),
    timezone VARCHAR(50) DEFAULT 'Asia/Seoul',
    activity_tracking_enabled BOOLEAN DEFAULT true,
    monthly_target_hours INTEGER DEFAULT 30,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### JSONB 활용 장점
- **유연성**: 복잡한 설정 구조를 JSON으로 자유롭게 저장
- **쿼리 가능**: PostgreSQL JSONB 연산자로 부분 조회 가능
- **스키마 진화**: 새로운 설정 추가 시 테이블 구조 변경 불필요

---

### 3. **post_integrations** 테이블 (포스트 연동 + 포럼 메시지 통합)

#### 설계 의도
기존의 `post_integrations`와 `forum_messages` 테이블을 통합하여 포럼 관련 기능을 단일 테이블에서 관리

#### 스키마 구조
```sql
CREATE TABLE post_integrations (
    guild_id VARCHAR(20) NOT NULL,
    voice_channel_id VARCHAR(20) NOT NULL,
    forum_post_id VARCHAR(20) NOT NULL,        -- 포럼 포스트(스레드) ID
    forum_channel_id VARCHAR(20) NOT NULL,     -- 포럼 채널 ID
    
    -- 포럼 메시지 추적 (기존 forum_messages 통합)
    participant_message_ids JSONB DEFAULT '[]'::jsonb,    -- 참가자 수 메시지 ID들
    emoji_reaction_message_ids JSONB DEFAULT '[]'::jsonb, -- 이모지 반응 메시지 ID들
    other_message_types JSONB DEFAULT '{}'::jsonb,        -- 기타 메시지 타입들
    
    -- 연동 상태 및 아카이빙 관리
    is_active BOOLEAN DEFAULT true,             -- 연동 활성 상태
    archived_at TIMESTAMP NULL,                -- 아카이빙 처리 시간
    locked_at TIMESTAMP NULL,                  -- 스레드 잠금 시간
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY(guild_id, voice_channel_id),
    UNIQUE(guild_id, forum_post_id)            -- 포럼 포스트 중복 방지
);
```

#### 통합 효과
- **데이터 일관성**: 관련된 포럼 데이터를 단일 위치에서 관리
- **쿼리 최적화**: JOIN 연산 없이 필요한 모든 정보 조회 가능
- **메시지 추적**: JSONB 배열로 다양한 메시지 타입 효율적 관리

#### 인덱스 전략
```sql
-- 포럼 포스트 기반 조회 최적화
CREATE INDEX idx_post_integrations_forum_post ON post_integrations(forum_post_id);

-- 음성 채널 기반 조회 최적화
CREATE INDEX idx_post_integrations_voice_channel ON post_integrations(voice_channel_id);

-- 활성 연동만 조회 최적화
CREATE INDEX idx_post_integrations_active ON post_integrations(is_active) 
WHERE is_active = true;
```

---

### 4. **user_activities_YYYYMM** 테이블 (월별 활동 데이터)

#### 설계 의도
활동 데이터를 월별로 파티셔닝하여 성능을 유지하면서 무제한 데이터 누적이 가능하도록 설계

#### 동적 테이블 생성 전략
```sql
-- 월별 활동 테이블 생성 함수
CREATE OR REPLACE FUNCTION create_monthly_activity_table(table_suffix TEXT)
RETURNS VOID AS $$
DECLARE
    table_name TEXT;
BEGIN
    table_name := 'user_activities_' || table_suffix;
    
    -- 테이블 존재 확인 후 생성
    IF NOT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = table_name
    ) THEN
        EXECUTE format('
            CREATE TABLE %I (
                guild_id VARCHAR(20) NOT NULL,
                user_id VARCHAR(20) NOT NULL,
                username VARCHAR(100) NOT NULL,
                daily_voice_minutes JSONB DEFAULT ''{}''::jsonb, -- {"01": 120, "02": 45, ...}
                total_voice_minutes INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(guild_id, user_id)
            )', table_name);
        
        -- 성능 최적화 인덱스 생성
        EXECUTE format('CREATE INDEX idx_%I_user_id ON %I(user_id)', table_name, table_name);
        EXECUTE format('CREATE INDEX idx_%I_guild_id ON %I(guild_id)', table_name, table_name);
    END IF;
END;
$$ LANGUAGE plpgsql;
```

#### 월별 스키마 구조
```sql
-- 예시: user_activities_202501 테이블
CREATE TABLE user_activities_202501 (
    guild_id VARCHAR(20) NOT NULL,
    user_id VARCHAR(20) NOT NULL,
    username VARCHAR(100) NOT NULL,
    
    -- 일일 활동 분 수를 JSONB로 저장
    daily_voice_minutes JSONB DEFAULT '{}'::jsonb,  -- {"01": 120, "02": 45, ...}
    total_voice_minutes INTEGER DEFAULT 0,          -- 월 총합
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(guild_id, user_id)
);
```

#### JSONB 일일 데이터 구조
```json
{
    "01": 120,  // 1일: 120분
    "02": 45,   // 2일: 45분
    "03": 0,    // 3일: 0분
    "15": 230,  // 15일: 230분
    ...
}
```

#### 파티셔닝 장점
- **성능 유지**: 월별 분할로 쿼리 성능 일정 유지
- **무제한 확장**: 새로운 월이 오면 자동으로 새 테이블 생성
- **효율적 아카이빙**: 오래된 월 데이터 별도 아카이빙 가능
- **병렬 처리**: 월별 독립적 처리로 동시성 향상

---

## ⚡ 성능 최적화 전략

### 1. **인덱스 설계 철학**

#### 쿼리 패턴 분석
```sql
-- 주요 쿼리 패턴들
SELECT * FROM users WHERE guild_id = ?;                    -- 길드별 사용자 조회
SELECT * FROM post_integrations WHERE forum_post_id = ?;   -- 포럼 포스트 기반 조회  
SELECT * FROM user_activities_202501 WHERE user_id = ?;    -- 사용자별 활동 조회
```

#### 복합 인덱스 전략
```sql
-- 1. 사용자 조회 최적화
CREATE INDEX idx_users_guild_id ON users(guild_id);
CREATE INDEX idx_users_inactive_dates ON users(inactive_start_date, inactive_end_date) 
WHERE inactive_start_date IS NOT NULL;

-- 2. 포스트 연동 조회 최적화
CREATE INDEX idx_post_integrations_forum_post ON post_integrations(forum_post_id);
CREATE INDEX idx_post_integrations_voice_channel ON post_integrations(voice_channel_id);
CREATE INDEX idx_post_integrations_active ON post_integrations(is_active) 
WHERE is_active = true;

-- 3. 월별 활동 조회 최적화 (각 월별 테이블마다)
CREATE INDEX idx_user_activities_YYYYMM_user_id ON user_activities_YYYYMM(user_id);
CREATE INDEX idx_user_activities_YYYYMM_guild_id ON user_activities_YYYYMM(guild_id);
```

### 2. **JSONB 활용 최적화**

#### GIN 인덱스 전략
```sql
-- JSONB 필드의 효율적 검색을 위한 GIN 인덱스
CREATE INDEX idx_guild_settings_game_roles ON guild_settings USING GIN(game_roles);
CREATE INDEX idx_daily_voice_minutes ON user_activities_YYYYMM USING GIN(daily_voice_minutes);
```

#### JSONB 쿼리 최적화
```sql
-- 특정 날짜의 활동 데이터 조회
SELECT daily_voice_minutes->'15' as day_15_minutes 
FROM user_activities_202501 
WHERE user_id = 'user123';

-- 특정 게임 역할 확인
SELECT * FROM guild_settings 
WHERE game_roles @> '["게임역할1"]'::jsonb;
```

### 3. **Connection Pool 최적화**

#### Pool 설정 전략
```javascript
// DatabaseManager.js에서의 Connection Pool 설정
this.pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,                    // 최대 연결 수
    idleTimeoutMillis: 30000,   // 유휴 연결 타임아웃
    connectionTimeoutMillis: 2000, // 연결 타임아웃
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
```

---

## 🗑️ 제거된 구조들

### 1. **activity_logs 테이블 제거**

#### 제거 이유
```
기존 문제점:
1. 중간 저장소 역할만 수행 (시간 계산을 위한 임시 데이터)
2. 메모리 사용량 증가 (모든 세션 데이터 누적)
3. 복잡한 집계 로직 필요
4. 실시간성 부족 (배치 처리 방식)
```

#### 대안 솔루션
```
실시간 저장 방식:
Discord VoiceState → ActivityTracker → 즉시 user_activities_YYYYMM 저장
                     ↓
               activeSessions Map (현재 세션만 메모리 보관)
```

### 2. **forum_messages 테이블 제거**

#### 제거 이유
- `post_integrations`와 데이터 중복
- 별도 관리로 인한 일관성 문제
- JOIN 연산 오버헤드

#### 통합 솔루션
```sql
-- post_integrations 테이블에 JSONB로 통합
participant_message_ids JSONB DEFAULT '[]'::jsonb,    -- 참가자 수 메시지들
emoji_reaction_message_ids JSONB DEFAULT '[]'::jsonb, -- 이모지 반응 메시지들
other_message_types JSONB DEFAULT '{}'::jsonb         -- 기타 메시지 타입들
```

### 3. **afk_status 테이블 제거**

#### 통합 이유
- 사용자 정보와 밀접한 관련성
- 1:1 관계로 별도 테이블 불필요
- JOIN 연산 제거로 성능 향상

---

## 🔧 자동화 및 유지보수

### 1. **자동 테이블 생성**

#### 월별 테이블 자동 생성
```sql
-- 현재 월과 다음 월 테이블 미리 생성
SELECT create_monthly_activity_table(to_char(CURRENT_DATE, 'YYYYMM'));
SELECT create_monthly_activity_table(to_char(CURRENT_DATE + INTERVAL '1 month', 'YYYYMM'));
```

### 2. **자동 트리거**

#### updated_at 자동 업데이트
```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 모든 주요 테이블에 트리거 적용
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

### 3. **데이터 무결성 보장**

#### 제약조건 설정
```sql
-- 기본키 및 유니크 제약
PRIMARY KEY(guild_id, user_id),
UNIQUE(guild_id, forum_post_id),

-- 외래키 제약 (논리적)
-- 실제 Discord ID이므로 물리적 FK는 설정하지 않음

-- 체크 제약
CHECK (monthly_target_hours > 0),
CHECK (inactive_start_date <= inactive_end_date OR inactive_end_date IS NULL)
```

---

## 📈 성능 벤치마크 예상

### 쿼리 성능 개선 예상치
| 작업 | Before (LowDB) | After (PostgreSQL) | 개선율 |
|------|----------------|-------------------|--------|
| **사용자 조회** | 50-100ms | 5-10ms | **5-10배** |
| **활동 데이터 저장** | 20-50ms | 2-5ms | **4-10배** |
| **월별 통계 생성** | 500-1000ms | 50-100ms | **5-10배** |
| **포럼 메시지 추적** | 30-80ms | 5-15ms | **3-5배** |

### 메모리 사용량 개선
| 구분 | Before | After | 개선율 |
|------|--------|-------|--------|
| **활동 로그 저장** | 전체 히스토리 (수GB) | 현재 세션만 (수MB) | **100-1000배** |
| **JSON 파싱 오버헤드** | 매번 전체 파일 | 필요한 데이터만 | **10-50배** |

---

## 🚀 확장성 고려사항

### 1. **수직 확장 (Scale Up)**
- **Connection Pool**: 서버 리소스에 따른 동적 조정
- **인덱스 튜닝**: 실제 워크로드 기반 최적화
- **쿼리 최적화**: EXPLAIN ANALYZE 기반 성능 분석

### 2. **수평 확장 (Scale Out)**
- **읽기 복제본**: 읽기 전용 쿼리 분산 처리
- **샤딩 준비**: guild_id 기반 데이터 분산 가능
- **캐싱 레이어**: Redis 등을 활용한 쿼리 결과 캐싱

### 3. **데이터 아카이빙**
- **월별 아카이빙**: 오래된 활동 데이터 별도 저장
- **압축 저장**: PostgreSQL 테이블스페이스 압축
- **백업 전략**: pg_dump를 활용한 정기 백업

---

## 📋 마이그레이션 체크리스트

### ✅ 완료된 설계 항목
- [x] 통합 테이블 스키마 설계
- [x] 월별 파티셔닝 전략
- [x] 성능 최적화 인덱스 설계
- [x] JSONB 활용 데이터 구조
- [x] 자동화 스크립트 (테이블 생성/트리거)
- [x] 제약조건 및 데이터 무결성

### 🔄 향후 고도화 계획
- [ ] 실제 워크로드 기반 인덱스 튜닝
- [ ] 쿼리 성능 모니터링 시스템
- [ ] 자동 파티션 관리 스크립트
- [ ] 백업 및 복구 자동화
- [ ] 읽기 복제본 구성 (필요시)

---

*이 문서는 PostgreSQL 마이그레이션 프로젝트의 데이터베이스 아키텍처 변경사항을 상세히 기록합니다.*  
*마지막 업데이트: 2025년 1월*