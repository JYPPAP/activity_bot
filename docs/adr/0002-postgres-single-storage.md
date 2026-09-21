# 0002. JSON 파일 저장소를 폐기하고 PostgreSQL 단일 저장소로 전환

- **상태**: Accepted
- **날짜**: 2026-02-07
- **관련**: `migrations/20250101000001_init-core-tables.sql`, [`docs/archive/Database_Architecture_Changes.md`](../archive/Database_Architecture_Changes.md)

## 컨텍스트

초기 버전은 `activity_bot.json` (단일 JSON 파일)에 활동 시간을 기록했다. Termux에서의 운영 데이터가 누적되며 다음 문제가 발생:

- 파일 쓰기 원자성 부족 → PM2 재시작 타이밍에 **부분 기록** 손실 사례 관측.
- 파일 전체 rewrite → I/O 폭주, eMMC 수명에 불리.
- 동시 읽기·쓰기 시 Lost update.
- 분석 쿼리(집계) 시 전체 파싱 필요.

## 검토한 옵션

### 옵션 1: JSON + append-only 저널 (WAL 흉내)
- 장점: 외부 의존 없음.
- 단점: 커스텀 복구 로직, 집계 쿼리 여전히 비효율.

### 옵션 2: SQLite
- 장점: 파일 기반, 간단. Termux에서 네이티브 빌드 가능.
- 단점: 다중 연결 동시 쓰기 제약, 장기적 분석 확장성 낮음.

### 옵션 3: PostgreSQL (Termux-postgresql)
- 장점: 트랜잭션, 인덱스, 집계 내장. 외부 분석 도구 연결 용이.
- 단점: Termux에서 설치·운영 복잡. 메모리/디스크 상승.

## 결정

**PostgreSQL 단일 저장소로 전환**. JSON 파일은 **읽기 전용 레거시 아카이브**로 남기고 봇 시작 시 마이그레이션 경로만 유지한다.

## 근거

1. `pg` + `node-pg-migrate` 조합으로 스키마 진화가 버전 관리 가능.
2. 트랜잭션·UNIQUE 제약으로 중복 참가자 등 도메인 규칙을 DB 레벨에서 강제.
3. Termux에서도 `pkg install postgresql` 로 운영 가능함을 검증.
4. 관리자 대시보드·외부 분석에 표준 SQL 활용 가능.

## 결과

- 긍정: `monthly_activity`, `forum_participants` 등 엔티티가 테이블로 명확히 분리. 장애 시 복구도 `pg_dump` 기반으로 표준화.
- 부정: Termux 프로세스 구성이 복잡해짐 (`postgres` + `node` + `pm2`). 메모리 사용 증가 → [ADR 0003] 예정으로 Termux 튜닝 ADR 고려.
- 재검토 조건: Postgres 설치가 불가능한 환경(라즈베리파이 극저사양 등) 대상을 지원하게 될 때.

## 참고

- [Database Architecture Changes](../archive/Database_Architecture_Changes.md)
- [Migration Setup Guide](../archive/Migration_Setup_Guide.md)
- [PostgreSQL Migration Overview](../archive/PostgreSQL_Migration_Overview.md)
