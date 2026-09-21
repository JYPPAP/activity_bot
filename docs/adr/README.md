# Architecture Decision Records (ADR)

> 이 디렉토리는 *"왜 이렇게 설계했는가"* 를 기록한다.
> 포맷: Michael Nygard, *Documenting Architecture Decisions* (2011).

## 규칙

1. 파일명: `NNNN-kebab-case-title.md` (NNNN = 4자리 순번).
2. 상태는 `Proposed` → `Accepted` → (필요 시) `Superseded by NNNN` 순으로 전이.
3. 결정을 번복하려면 **새 ADR**을 만들어 기존 ADR을 Superseded 처리. 원본은 수정하지 않는다.
4. ADR 추가 시 이 README 하단 목록에도 링크 추가.

## 템플릿

`template.md` 를 복사해 시작한다.

## 기록된 결정

| # | 제목 | 상태 | 날짜 |
|---|---|---|---|
| 0001 | [Awilix CLASSIC Injection Mode 채택](./0001-awilix-classic-mode.md) | Accepted | 2025-08 |
| 0002 | [PostgreSQL + JSON 이중 저장에서 PG 단일화로 전환](./0002-postgres-single-storage.md) | Accepted | 2025-02 |
| 0003 | [테스트 전략: Vitest + 순수 로직·mock 우선](./0003-test-strategy.md) | Accepted | 2026-09 |

---

## 참고

- Michael Nygard, *Documenting Architecture Decisions*: https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- adr-tools: https://github.com/npryce/adr-tools
