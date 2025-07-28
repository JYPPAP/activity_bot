# Discord Activity Bot Documentation

이 디렉토리는 Discord Activity Bot 프로젝트의 모든 문서를 체계적으로 정리한 곳입니다.

## 📁 문서 구조

### 🔧 [setup/](./setup/)
환경 설정 및 배포 관련 문서
- **[termux-production-setup.md](./setup/termux-production-setup.md)** - Termux 프로덕션 환경 설정 가이드
- **[TERMUX_SETUP.md](./setup/TERMUX_SETUP.md)** - 기본 Termux 설정 가이드

### 💻 [development/](./development/)
개발 환경 및 개발 도구 관련 문서
- **[CLAUDE.md](./development/CLAUDE.md)** - Claude Code 통합 가이드
- **[AGENTS.md](./development/AGENTS.md)** - AI 에이전트 활용 가이드
- **[GEMINI.md](./development/GEMINI.md)** - Gemini API 활용 가이드
- **[LOCAL_TEST_GUIDE.md](./development/LOCAL_TEST_GUIDE.md)** - 로컬 테스트 가이드
- **[project-analysis.md](./development/project-analysis.md)** - 프로젝트 분석 문서
- **[project-documentation.md](./development/project-documentation.md)** - 프로젝트 문서화 가이드

### 🔌 [api/](./api/)
API 및 서비스 관련 문서
- **[DiscordAPIClient.md](./api/DiscordAPIClient.md)** - Discord API 클라이언트 사용법
- **[async-job-queue.md](./api/async-job-queue.md)** - 비동기 작업 큐 시스템
- **[async-job-queue-integration.md](./api/async-job-queue-integration.md)** - 작업 큐 통합 가이드

### 🔍 [troubleshooting/](./troubleshooting/)
문제 해결 및 디버깅 가이드
- **[DISCORD_MEMBER_FETCH_TROUBLESHOOTING.md](./troubleshooting/DISCORD_MEMBER_FETCH_TROUBLESHOOTING.md)** - Discord 멤버 페치 문제 해결

### 🔄 [migration/](./migration/)
마이그레이션 및 서비스 통합 문서
- **[MEMBER_FETCH_SERVICE_INTEGRATION.md](./migration/MEMBER_FETCH_SERVICE_INTEGRATION.md)** - 멤버 페치 서비스 통합
- **[MEMBER_FETCH_SERVICE_MIGRATION_EXAMPLE.md](./migration/MEMBER_FETCH_SERVICE_MIGRATION_EXAMPLE.md)** - 마이그레이션 예제
- **[INTEGRATION_TEST_RESULTS.md](./migration/INTEGRATION_TEST_RESULTS.md)** - 통합 테스트 결과

### 🗄️ [database/](./database/)
데이터베이스 관련 문서
- **[postgresql-setup.md](./database/postgresql-setup.md)** - PostgreSQL 설정 및 관리 가이드

### 📊 [analysis/](./analysis/)
분석 리포트 및 성능 문서
- **[js-ts-comparison-report.md](./analysis/js-ts-comparison-report.md)** - JavaScript/TypeScript 비교 분석
- **[task-1-completion-summary.md](./analysis/task-1-completion-summary.md)** - 작업 완료 요약

### 📢 [recruitment/](./recruitment/)
모집 시스템 관련 문서
- **[recru.md](./recruitment/recru.md)** - 모집 기능 설명서

### 🔧 [patches/](./patches/)
패치 및 수정 사항 문서
- **[patch.MD](./patches/patch.MD)** - 패치 노트 및 수정 사항

## 🚀 빠른 시작

1. **새로운 개발자**라면: [development/](./development/) 폴더 문서부터 시작
2. **운영 환경 설정**이라면: [setup/](./setup/) 폴더 문서 참조
3. **문제 해결**이 필요하다면: [troubleshooting/](./troubleshooting/) 폴더 확인
4. **API 사용법**을 알고 싶다면: [api/](./api/) 폴더 참조

## 📋 문서 작성 가이드

새로운 문서를 작성할 때는 다음 규칙을 따라주세요:

1. **카테고리별 분류**: 적절한 하위 폴더에 배치
2. **명확한 제목**: 내용을 쉽게 파악할 수 있는 파일명 사용
3. **마크다운 형식**: 일관된 마크다운 포맷 사용
4. **목차 포함**: 긴 문서는 목차를 포함
5. **예제 코드**: 실제 사용 가능한 코드 예제 포함

## 🔄 문서 업데이트

문서를 업데이트할 때는:

1. 변경 사항을 git commit에 명확히 기록
2. 관련된 다른 문서도 함께 확인 및 업데이트
3. 이 README.md도 필요시 업데이트

---

📝 **문서 관련 질문이나 제안사항**이 있으면 이슈를 생성해주세요.