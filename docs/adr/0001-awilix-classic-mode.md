# 0001. Awilix DI를 CLASSIC Injection Mode로 운영한다

- **상태**: Accepted
- **날짜**: 2025-08-22
- **관련**: `src/container.js`, [11-invariants.md#i-01](../11-invariants.md)

## 컨텍스트

서비스·리포지토리·UI 핸들러가 20개 이상으로 늘면서 수동 new 체인으로는 의존성 순서 제어가 어려워졌다. 테스트 용이성과 싱글톤 라이프사이클 관리가 필요하다.

Awilix는 두 가지 주입 모드를 제공한다.
- `PROXY`: 런타임에 `proxy` 를 통해 속성 접근 시점에 해석. 구조분해 사용.
- `CLASSIC`: 생성자 파라미터 이름을 그대로 컨테이너 키로 매칭. 위치(positional) 기반.

## 검토한 옵션

### 옵션 1: PROXY + 구조분해 (`constructor({ client, dbManager })`)
- 장점: 파라미터 순서 무관, 리팩터링 안전.
- 단점: V8 JIT 최적화 저해(프록시 오버헤드), IDE 자동완성 약화, 일부 툴 체인(Node inspector)에서 디버깅 불편.

### 옵션 2: CLASSIC + strict (`constructor(client, dbManager)`)
- 장점: 단순, 오버헤드 없음, IDE 타입 추론 우수, `strict: true`로 등록 누락을 조기 감지.
- 단점: 파라미터 이름 변경 시 컨테이너 키와 불일치 위험.

### 옵션 3: 수동 DI (팩토리 함수 체인)
- 장점: 의존 없음.
- 단점: boilerplate 증가, 싱글톤 보장 로직을 직접 작성.

## 결정

**CLASSIC 모드 + `strict: true`** 를 채택한다.

## 근거

1. 본 프로젝트는 상대적으로 작고 서비스 이름이 명확히 정형화되어 있어 파라미터 이름과 키를 일치시키는 비용이 낮다.
2. Termux(ARM, 저사양)에서 런타임 오버헤드 최소화가 중요.
3. `strict` 옵션이 등록되지 않은 키를 참조 시 즉시 에러를 발생시켜 실수 비용을 초기화.

## 결과

- 긍정: 진입점에서 의존성 그래프가 선형으로 드러나 AI 에이전트가 파악하기 쉬움.
- 부정: 파라미터 이름 리팩터링 시 컨테이너 키도 동시에 수정 필요 → Invariant I-01로 강제.
- 재검토 조건: 서비스 수가 50개를 넘어 의존성 그래프가 급격히 복잡해질 때 PROXY 재평가.

## 참고

- Awilix docs — Injection Modes: https://github.com/jeffijoe/awilix#injection-modes
- Mark Seemann, *Dependency Injection Principles, Practices, and Patterns* (2019): Constructor Injection 관련.
