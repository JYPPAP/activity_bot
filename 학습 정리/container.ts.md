`src/di/container.ts` 파일은 `activity_bot` 프로젝트의 아키텍처에서 **서비스 등록 및 의존성 관리**라는 매우 중요한 역할을 담당합니다. 이 파일은 `tsyringe`라는 의존성 주입(Dependency Injection, DI) 라이브러리를 사용하여 프로젝트의 모든 서비스를 중앙에서 설정하고 관리합니다.

### 주요 기능 및 역할

1.  **중앙화된 서비스 등록 (`configureDIContainer` 함수)**:
    *   프로젝트에서 사용되는 모든 서비스 클래스를 DI 컨테이너에 **싱글톤(Singleton)**으로 등록합니다. 싱글톤으로 등록하면 애플리케이션 전체에서 해당 서비스의 인스턴스가 단 하나만 생성되어 메모리를 효율적으로 사용하고 상태를 일관되게 관리할 수 있습니다.
    *   **인터페이스와 구현체 분리**: `DI_TOKENS`에 정의된 `Symbol` 토큰을 사용하여, 실제 서비스 클래스(`SQLiteManager`)가 아닌 인터페이스(`IDatabaseManager`)에 의존하도록 코드를 작성할 수 있게 합니다. 이는 **느슨한 결합(Loose Coupling)**을 가능하게 하여, 나중에 `SQLiteManager`를 다른 데이터베이스 관리자(e.g., `PostgresManager`)로 교체하더라도 다른 서비스 코드의 변경을 최소화할 수 있습니다.

    ```typescript
    // 인터페이스(IDatabaseManager)를 키로, 실제 클래스(SQLiteManager)를 값으로 등록
    container.registerSingleton(DI_TOKENS.IDatabaseManager, SQLiteManager);
    container.registerSingleton(DI_TOKENS.ILogService, LogService);
    ```

2.  **설정 객체 주입**:
    *   단순한 서비스 클래스뿐만 아니라, `config` 파일에서 불러온 환경 설정이나 특정 서비스에 필요한 설정 객체(`LogServiceOptions`, `RedisConfig`)도 컨테이너에 등록합니다.
    *   이를 통해 서비스 클래스는 생성자에서 필요한 설정 값을 직접 주입받을 수 있어, 코드 내에서 `config` 모듈에 직접 의존할 필요가 없어집니다.

    ```typescript
    // LogService에 필요한 설정 객체를 DI_TOKENS.LogServiceConfig 토큰으로 등록
    const logServiceConfig: LogServiceOptions = { /* ... */ };
    container.registerInstance(DI_TOKENS.LogServiceConfig, logServiceConfig);
    ```

3.  **환경별 설정 분리 (`setupContainer` 함수)**:
    *   `process.env.NODE_ENV` 환경 변수 값을 확인하여, `development`, `production`, `test` 환경에 따라 다른 DI 설정을 적용할 수 있는 구조를 제공합니다.
    *   예를 들어, 테스트 환경에서는 실제 데이터베이스 대신 가짜(Mock) 데이터베이스 서비스를 주입하여 빠르고 독립적인 단위 테스트를 가능하게 할 수 있습니다.

4.  **DI 컨테이너 헬퍼 (`DIContainer` 객체)**:
    *   컨테이너의 기능을 더 쉽게 사용할 수 있도록 유용한 헬퍼 메서드들을 객체로 묶어 제공합니다.
    *   `get<T>(token)`: 제네릭을 사용하여 타입 추론이 가능한 상태로 서비스 인스턴스를 안전하게 가져옵니다.
    *   `registerClient(client)`: `Bot` 클래스에서 생성된 Discord `Client` 인스턴스를 외부에서 주입받아 컨테이너에 등록하는 전용 메서드입니다.
    *   `reset()`: 테스트 코드에서 각 테스트 케이스가 끝날 때마다 컨테이너의 상태를 초기화하여 테스트 간의 독립성을 보장하는 데 사용됩니다.

### 구조 분석

*   **`configureDIContainer()`**: 이 파일의 핵심 함수로, 모든 서비스와 설정 값을 `tsyringe`의 `container`에 등록하는 역할을 합니다. 서비스 간의 의존 관계가 이곳에서 정의됩니다.
*   **`setupContainer()`**: `configureDIContainer()`를 호출하고, 현재 실행 환경(개발, 프로덕션, 테스트)에 따라 추가적인 설정을 적용하는 역할을 합니다. 이 함수는 `src/bot.ts`에서 봇이 시작될 때 최초로 호출됩니다.
*   **`DIContainer`**: `container` 객체를 직접 사용하는 대신, 더 명확하고 사용하기 쉬운 API를 제공하는 래퍼(Wrapper) 객체입니다.

### TypeScript 활용

이 파일은 TypeScript의 주요 기능을 활용하여 DI 시스템의 안정성을 높입니다.

*   **인터페이스와 심볼 토큰**: `IDatabaseManager`와 같은 인터페이스와 `DI_TOKENS.IDatabaseManager` 같은 `Symbol` 토큰을 함께 사용하여, 문자열 기반의 주입 방식보다 훨씬 안전하고 리팩토링에 용이한 코드를 작성합니다.
*   **타입스크립트 데코레이터 (`@injectable`, `@inject`)**: 서비스 클래스 상단에 `@injectable()` 데코레이터를 붙여 해당 클래스가 DI 컨테이너에 의해 관리될 수 있음을 알립니다. 또한, 서비스의 생성자에서 `@inject(DI_TOKENS.SomeService)`와 같이 사용하여 어떤 의존성을 주입받을지 명시합니다.

    ```typescript
    // 예시: SQLiteManager 클래스
    @injectable()
    export class SQLiteManager implements IDatabaseManager {
      constructor(
        config: Partial<SQLiteConfig> = {},
        @inject(DI_TOKENS.IRedisService) redis: IRedisService
      ) {
        // ...
      }
    }
    ```

결론적으로 `src/di/container.ts`는 프로젝트의 모든 구성 요소를 조립하고 연결하는 **조립 라인**과 같은 역할을 합니다. 이 파일을 통해 각 서비스는 자신이 직접 의존성을 생성하고 관리할 필요 없이, 필요한 기능을 외부에서 주입받아 자신의 핵심 로직에만 집중할 수 있게 됩니다. 이는 현대적인 소프트웨어 아키텍처의 핵심 원칙인 **제어의 역전(Inversion of Control, IoC)**을 구현한 것입니다.