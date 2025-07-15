`src/bot.ts` 파일은 `activity_bot` 프로젝트의 **중심 제어 타워** 역할을 하는 핵심 파일입니다. 이 파일에 정의된 `Bot` 클래스는 봇 애플리케이션의 전체 생명주기를 관리하고, 모든 하위 서비스를 총괄하며, Discord 클라이언트와의 상호작용을 시작하는 진입점입니다.

### 주요 기능 및 역할

1.  **싱글톤(Singleton) 패턴 적용**: `Bot.instance` 정적 속성을 사용하여 봇 인스턴스가 단 하나만 생성되도록 보장합니다. 이를 통해 애플리케이션 전체에서 동일한 봇 인스턴스에 접근할 수 있습니다.

    ```typescript
    export class Bot {
      private static instance: Bot | null = null;

      constructor(token: string) {
        if (Bot.instance) {
          return Bot.instance;
        }
        // ... 초기화 로직
        Bot.instance = this;
      }

      static getInstance(): Bot | null {
        return Bot.instance;
      }
    }
    ```

2.  **Discord 클라이언트 초기화 및 관리**:
    *   `discord.js`의 `Client`를 생성하고, 필요한 `GatewayIntentBits`를 설정하여 봇이 서버의 어떤 정보에 접근할지 정의합니다.
    *   `discord-optimizer`의 `MemoryGuard`를 사용하여 클라이언트를 감싸, 메모리 사용량을 256MB로 제한하고 안정성을 높입니다.

3.  **의존성 주입(DI) 컨테이너 설정**:
    *   `constructor`에서 `setupContainer()`를 호출하여 `tsyringe` DI 컨테이너를 설정합니다.
    *   생성된 Discord 클라이언트 인스턴스를 `DIContainer.registerClient()`를 통해 컨테이너에 등록하여 다른 서비스들이 주입받아 사용할 수 있게 합니다.

4.  **서비스 초기화 및 관리**:
    *   `initializeServices()` 메서드에서 DI 컨테이너(`DIContainer.get()`)를 통해 필요한 모든 서비스(e.g., `IDatabaseManager`, `IActivityTracker`, `ICommandHandler` 등)의 인스턴스를 주입받습니다.
    *   주입받은 서비스들을 `this.services` 속성에 저장하여 봇의 다른 부분에서 쉽게 접근할 수 있도록 합니다.
    *   `EventManager`, `VoiceChannelForumIntegrationService`와 같이 아직 DI 컨테이너로 관리되지 않는 일부 서비스는 수동으로 생성합니다.

5.  **봇 초기화 프로세스 (`initialize()` 메서드)**:
    *   봇이 동작하는 데 필요한 모든 사전 작업을 비동기적으로 수행합니다.
    *   **순서**: Redis 연결 -> 데이터베이스 초기화 -> 데이터 마이그레이션(필요시) -> 이벤트 핸들러 등록 -> `ready` 이벤트 리스너 설정.
    *   각 단계의 성공 여부와 발생한 오류를 `InitializationResult` 객체에 기록하여 반환합니다.

6.  **이벤트 핸들러 등록 (`registerEventHandlers()` 메서드)**:
    *   `EventManager` 서비스를 사용하여 Discord에서 발생하는 다양한 이벤트(e.g., `VoiceStateUpdate`, `InteractionCreate`)와 해당 이벤트를 처리할 서비스의 메서드를 연결(바인딩)합니다.
    *   예를 들어, `Events.VoiceStateUpdate` 이벤트가 발생하면 `activityTracker`와 `voiceForumService`의 `handleVoiceStateUpdate` 메서드가 모두 호출되도록 등록합니다.

7.  **`ready` 이벤트 처리 (`setupReadyHandler()` 메서드)**:
    *   봇이 Discord에 성공적으로 로그인하고 준비되었을 때(`ClientReady` 이벤트) 단 한 번 실행될 로직을 설정합니다.
    *   이 시점에서 길드 정보를 가져와 `ActivityTracker`를 초기화하고, `CalendarLogService`, `VoiceChannelForumIntegrationService` 등 다른 서비스들의 최종 초기화 작업을 수행합니다.
    *   모든 준비가 완료되면 Prometheus, 성능 모니터링 서비스를 시작하고 최종 상태를 로깅합니다.

8.  **데이터 마이그레이션 (`migrateDataIfNeeded()` 메서드)**:
    *   기존 `activity_info.json`과 `role_activity_config.json` 파일이 존재하고, SQLite 데이터베이스에 데이터가 없는 경우에만 마이그레이션을 수행하여 데이터의 연속성을 보장합니다.

9.  **상태 관리 및 통계**:
    *   봇의 시작 시간, 가동 시간, 메모리 사용량, 서버 수 등의 통계를 `stats` 속성에서 관리합니다.
    *   `setupStatsUpdater()`를 통해 주기적으로 통계를 업데이트하고 `logDetailedStats()`로 상세 정보를 로깅합니다.

10. **안전한 종료 (`shutdown()` 메서드)**:
    *   프로세스가 종료될 때 호출되며, 모든 서비스의 리소스를 안전하게 해제합니다 (e.g., 데이터 저장, DB 연결 종료, 클라이언트 파괴).

### 구조 분석

`Bot` 클래스는 다음과 같은 구조로 설계되었습니다.

*   **생성자 (`constructor`)**:
    *   싱글톤 확인 및 토큰 유효성 검사.
    *   Discord 클라이언트 및 메모리 가드 설정.
    *   통계 객체 초기화.
    *   **DI 컨테이너 설정 및 서비스 인스턴스 생성 (가장 중요)**.
    *   정기적인 통계 업데이트 스케줄링.

*   **초기화 메서드 (`initialize`, `setupReadyHandler`)**:
    *   봇의 핵심 기능들이 동작하기 위한 비동기적인 준비 과정을 담당합니다. 서비스 간의 의존성을 고려하여 순차적으로 실행됩니다.

*   **서비스 관리 메서드 (`initializeServices`)**:
    *   DI 컨테이너를 통해 모든 서비스를 한 곳에서 중앙 관리하고 주입받는 역할을 합니다. 이는 코드의 유지보수성과 확장성을 크게 향상시킵니다.

*   **이벤트 처리 메서드 (`registerEventHandlers`)**:
    *   `EventManager`를 통해 이벤트와 핸들러를 분리하여, 각 서비스가 자신의 역할에만 집중할 수 있도록 합니다.

*   **상태 및 제어 메서드 (`login`, `shutdown`, `getStats`, `isReady`)**:
    *   봇의 외부 상태(로그인, 종료, 준비 상태)를 제어하고 내부 상태(통계)를 조회하는 인터페이스를 제공합니다.

### TypeScript 활용

`bot.ts` 파일은 TypeScript의 강력한 타입 시스템을 적극적으로 활용하여 코드의 안정성과 명확성을 높입니다.

- **인터페이스 기반 프로그래밍**: `BotServices`, `BotStats`와 같은 `interface`를 사용하여 봇이 사용하는 서비스들과 관리하는 데이터의 구조를 명확하게 정의합니다. 이를 통해 각 속성이 어떤 타입의 데이터를 가져야 하는지 컴파일 시점에 강제할 수 있습니다.

  ```typescript
  interface BotServices {
    redisService: IRedisService;
    dbManager: IDatabaseManager;
    logService: ILogService;
    // ... 기타 서비스
  }
  ```

- **타입 추론 및 명시적 타입**: `this.services`와 같은 속성은 `BotServices` 인터페이스로 타입을 명시하여, `this.services.dbManager`와 같은 코드에서 `dbManager`가 `IDatabaseManager` 인터페이스에 정의된 메서드들을 가지고 있음을 타입스크립트가 인지하고 자동 완성 및 타입 체크를 제공합니다.

- **DI 토큰 활용**: `DI_TOKENS.IRedisService`와 같이 `Symbol`을 사용하여 DI 컨테이너에서 서비스를 조회할 때 문자열 리터럴 대신 안전한 토큰을 사용합니다. 이는 오타로 인한 런타임 에러를 방지합니다.

결론적으로 `src/bot.ts`는 봇의 "두뇌"와 같으며, 모든 서비스와 설정을 조립하고, 봇의 전체적인 동작 흐름과 생명주기를 관리하는 매우 중요한 파일입니다.