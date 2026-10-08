# Dependency security

## 2026-10-08 audit

`npm audit fix`로 패치 가능한 취약점을 갱신했고 개발 전용 `nodemon`은 Node의 내장
`--watch` 모드로 교체했다. 이 작업으로 critical 1건, low 1건과 패치가 제공되는 high
항목을 제거했다.

현재 `npm audit`에 남는 high 항목은 모두 `braces@3.0.3`의
`GHSA-vfj7-8cjw-p6xm`에서 파생된다. 이 advisory는 최신 배포 버전까지 영향을 받으며
패치 버전이 아직 없다. npm이 제안하는 `awilix@6.0.0`, `errsole@2.3.0` 설치는
보안 패치가 아니라 오래된 상위 패키지로의 강제 다운그레이드이므로 적용하지 않는다.

현재 노출 경로는 다음과 같다.

- `awilix -> fast-glob -> micromatch -> braces`
- `errsole -> http-proxy-middleware -> micromatch -> braces`

이 봇은 Awilix의 모듈 glob 로딩 API를 사용하지 않고 모든 의존성을 코드에서 직접
등록한다. Errsole 프록시의 glob 패턴 역시 사용자 입력으로 구성하지 않는다. 따라서
공격자가 중첩 brace 패턴을 주입할 현재 실행 경로는 없다.

새로운 `braces` 패치 버전이 배포되면 잠금 파일을 갱신하고 아래 명령으로 예외가
사라졌는지 확인한다.

```bash
npm update braces
npm audit
```
