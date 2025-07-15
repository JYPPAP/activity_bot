# activity_bot 프로젝트 분석

이 문서는 `activity_bot` 프로젝트의 전체적인 구조, 핵심 기능, 데이터 흐름을 분석하여 개발 및 유지보수 작업을 돕기 위해 작성되었습니다.

## 1. 프로젝트 개요

`activity_bot`은 Discord 사용자의 음성 채널 활동을 추적하고 관리하는 것을 주목적으로 하는 다기능 봇입니다. 주요 기능은 다음과 같습니다.

- **음성 채널 활동 시간 추적**: 사용자가 음성 채널에 머무는 시간을 자동으로 기록하고 통계를 생성합니다.
- **역할 기반 관리**: 특정 역할을 가진 사용자를 대상으로 활동 시간을 관리하고 보고서를 생성합니다.
- **구인/구직 시스템**: 음성 채널 활동과 연동하여 동적으로 구인/구직 포럼 게시글을 생성하고 관리합니다.
- **명령어 기반 상호작용**: 사용자는 다양한 슬래시 명령어를 통해 봇과 상호작용하여 데이터를 조회하거나 설정을 변경할 수 있습니다.

## 2. 기술 스택 및 아키텍처

- **언어**: TypeScript
- **프레임워크**: Node.js, Discord.js v14
- **데이터베이스**: SQLite (기존 JSON 기반에서 마이그레이션)
- **의존성 관리**: `tsyringe`를 사용한 DI (Dependency Injection)
- **핵심 아키텍처**: 서비스 지향 아키텍처 (Service-Oriented Architecture)

### 2.1. 아키텍처 특징

- **DI (Dependency Injection)**: `tsyringe` 라이브러리를 사용하여 서비스 간의 의존성을 외부에서 주입합니다 (`src/di/container.ts`). 이를 통해 모듈 간 결합도를 낮추고 테스트 용이성을 높입니다.
- **서비스 지향 구조**: 각 기능은 독립적인 서비스 클래스로 분리되어 있습니다 (`src/services/`). 예를 들어, `ActivityTracker`는 활동 추적, `RecruitmentService`는 구인/구직 로직을 담당하여 각자의 역할에 집중합니다.
- **명령어 핸들러 패턴**: 사용자의 슬래시 명령어는 `CommandHandler`(`src/commands/commandHandler.ts`)가 중앙에서 받아, 해당하는 명령어 파일(`src/commands/*.ts`)로 위임하여 처리합니다.
- **중앙화된 설정 및 권한 관리**: 환경변수, 상수, 명령어별 권한 등 프로젝트의 모든 설정은 `src/config/` 디렉토리에서 관리되어 일관성을 유지합니다.

## 3. TypeScript 활용 분석

이 프로젝트는 JavaScript에서 TypeScript로 마이그레이션하는 과정에 있으며, 타입스크립트의 주요 기능을 적극적으로 활용하여 코드의 안정성과 가독성을 높이고 있습니다.

- **강력한 타입 시스템**: `string`, `number`와 같은 기본 타입은 물론, `interface`와 `type`을 사용하여 복잡한 데이터 구조(e.g., `UserActivity`, `BotServices`)를 명확하게 정의합니다. 이를 통해 컴파일 시점에 타입 오류를 잡아내어 런타임 에러를 줄입니다.

  ```typescript
  // src/types/index.ts 예시
  export interface UserActivity {
    userId: string;
    totalTime: number;
    startTime: number | null;
    lastUpdate: number;
    displayName?: string;
  }
  ```

- **인터페이스(Interface)를 통한 추상화**: `src/interfaces/` 디렉토리에서 서비스의 규격(메서드 시그니처)을 정의합니다. 예를 들어, `IDatabaseManager` 인터페이스는 데이터베이스 관련 작업을 정의하고, `SQLiteManager`가 이를 구현합니다. 이를 통해 데이터베이스 구현체가 변경되더라도 다른 서비스 코드에 미치는 영향을 최소화합니다.

  ```typescript
  // src/interfaces/IDatabaseManager.ts 예시
  export interface IDatabaseManager {
    initialize(): Promise<boolean>;
    getUserActivity(userId: string): Promise<UserActivity | null>;
    // ...기타 메서드
  }
  ```

- **제네릭(Generics)**: `DIContainer.get<T>(token)`과 같이 제네릭을 사용하여 타입 안전성을 유지하면서도 유연하고 재사용 가능한 코드를 작성합니다. 서비스 조회 시 어떤 타입의 서비스가 반환될지 명확하게 알 수 있습니다.

- **Enum 활용**: `src/config/commandPermissions.ts`의 `PermissionLevel`과 같이 `enum`을 사용하여 권한 레벨과 같이 정해진 값들의 집합을 명명된 상수로 관리하여 코드의 가독성과 유지보수성을 높입니다.

  ```typescript
  // src/config/commandPermissions.ts 예시
  export enum PermissionLevel {
    PUBLIC = 0,
    TRUSTED = 1,
    MODERATOR = 2,
    ADMIN = 3,
    SUPER_ADMIN = 4,
  }
  ```

## 4. 디렉토리 및 주요 파일 분석

- **`src/index.ts`**: 애플리케이션의 최상위 진입점입니다. `reflect-metadata`를 임포트하여 DI 컨테이너를 활성화하고, 환경변수와 로거를 설정한 뒤, `Bot` 클래스의 인스턴스를 생성하여 봇을 실행합니다.

- **`src/bot.ts`**: 봇의 핵심 로직을 담고 있는 메인 클래스입니다. Discord 클라이언트를 초기화하고, DI 컨테이너를 설정하며, 모든 주요 서비스들을 주입받아 관리합니다. 봇의 생명주기(시작, 로그인, 종료)를 책임집니다.

- **`src/di/container.ts`**: `tsyringe`를 사용하여 모든 서비스를 등록하고 의존성을 설정하는 곳입니다. `IDatabaseManager`, `ILogService`와 같은 인터페이스와 실제 구현체(`SQLiteManager`, `LogService`)를 바인딩합니다.

- **`src/commands/`**: 모든 슬래시 명령어가 개별 파일로 구현되어 있습니다.
  - `CommandBase.ts`: 모든 명령어 클래스가 상속받는 기본 클래스로, 권한 검사, 쿨다운, 통계 등 공통 로직을 제공합니다.
  - `commandHandler.ts`: 모든 명령어를 로드하고, 사용자의 인터랙션에 따라 적절한 명령어를 실행하는 라우터 역할을 합니다.

- **`src/services/`**: 봇의 핵심 비즈니스 로직이 담겨 있습니다.
  - `activityTracker.ts`: 사용자의 음성 채널 입장/퇴장/이동 이벤트를 감지하여 활동 시간을 추적하고 기록합니다.
  - `SQLiteManager.ts`: SQLite 데이터베이스와의 모든 상호작용(CRUD)을 담당하는 데이터 접근 계층입니다.
  - `VoiceChannelForumIntegrationService.ts`: 이 프로젝트의 가장 복잡하고 핵심적인 서비스로, 여러 서비스를 조합하여 음성 채널 활동과 포럼 게시글을 연동하는 시나리오를 총괄합니다.
  - `RecruitmentService.ts`: 구인/구직 기능의 비즈니스 로직을 처리합니다.

- **`src/database/`**: 데이터베이스 관련 파일들이 위치합니다.
  - `schema.sql`: SQLite 데이터베이스의 전체 테이블 구조와 인덱스를 정의합니다.
  - `init.ts`: 데이터베이스 연결을 초기화하고 스키마를 적용합니다.
  - `migrator.ts`: 기존 JSON 파일 데이터베이스를 SQLite로 마이그레이션하는 로직을 포함합니다.

- **`src/ui/`**: 사용자와의 상호작용(UI)을 담당합니다.
  - `ButtonHandler.ts`, `ModalHandler.ts`: Discord의 버튼, 모달 컴포넌트 제출 이벤트를 각각 처리합니다.
  - `InteractionRouter.ts`: 모든 종류의 인터랙션을 받아 적절한 핸들러로 라우팅합니다.

## 5. 데이터 흐름 예시 (명령어 실행)

1.  사용자가 디스코드에서 `/시간체크` 명령어를 입력합니다.
2.  `interactionCreate` 이벤트가 발생하고, `EventManager`를 통해 `CommandHandler`의 `handleInteraction` 메서드가 호출됩니다.
3.  `CommandHandler`는 명령어 이름(`시간체크`)을 확인하고, `commandPermissions.ts`를 참조하여 사용자에게 실행 권한이 있는지 검사합니다.
4.  권한이 있으면, `commands` 맵에서 `GapCheckCommand` 인스턴스를 찾아 `execute` 메서드를 호출합니다.
5.  `GapCheckCommand`는 `SQLiteManager` 서비스를 통해 데이터베이스에서 사용자의 활동 시간을 조회합니다.
6.  조회된 데이터를 `formatTime` 유틸리티 함수로 가공하여 사용자에게 보기 좋은 형태로 응답합니다.

## 6. 프로젝트 분석을 위한 Gemini 프롬프트

이 프로젝트를 더 깊이 이해하기 위해 아래 프롬프트들을 활용할 수 있습니다.

- **전체 구조 및 데이터 흐름 분석**
  ```
  이 프로젝트의 전체적인 구조와 데이터 흐름을 `src/index.ts`와 `src/bot.ts`를 중심으로 설명해줘. 사용자가 디스코드에서 명령어를 입력했을 때 어떤 과정을 거쳐 처리되는지 알려줘.
  ```

- **핵심 기능 상세 분석 (음성/포럼 연동)**
  ```
  음성 채널과 포럼 게시글을 연동하는 기능의 동작 방식을 `VoiceChannelForumIntegrationService.ts`와 관련 서비스(`RecruitmentService`, `MappingService`)를 중심으로 상세히 설명해줘. 사용자가 음성 채널에 접속했을 때부터 포럼 게시글이 생성되기까지의 과정을 단계별로 알려줘.
  ```

- **TypeScript 활용 전략 분석**
  ```
  이 프로젝트에서 TypeScript가 어떻게 활용되고 있는지 `src/types/`와 `src/interfaces/` 디렉토리를 중심으로 설명해줘. `interface`, `type`, `enum` 등이 코드의 안정성과 유지보수성을 어떻게 향상시키는지 구체적인 예시 코드를 들어 설명해줘.
  ```

- **데이터베이스 스키마 분석**
  ```
  `src/database/schema.sql` 파일의 테이블 구조를 분석하고, 각 테이블이 어떤 데이터를 저장하며 서로 어떻게 관계를 맺고 있는지 설명해줘.
  ```

- **권한 시스템 분석**
  ```
  `src/config/commandPermissions.ts` 파일의 권한 시스템이 어떻게 동작하는지 설명해줘. `PermissionLevel`과 `COMMAND_PERMISSIONS`를 기반으로 사용자의 명령어 실행 가능 여부가 어떻게 결정되는지 예시를 들어 설명해줘.
  ```

- **특정 명령어 로직 분석**
  ```
  `/gap_report` 명령어의 전체 실행 과정을 `gapReportCommand.ts` 파일을 중심으로 설명해줘. 어떤 데이터를 어떻게 가공해서 보고서를 생성하는지 알려줘.
  ```
