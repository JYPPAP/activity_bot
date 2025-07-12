# GEMINI TypeScript 마이그레이션 가이드

## 1. 프로젝트 개요

이 문서는 **activity_bot** 프로젝트의 JavaScript에서 TypeScript로의 마이그레이션 작업을 지원하고, 발생하는 오류를 체계적으로 해결하기 위해 작성되었습니다. 이 봇은 Discord 채널의 사용자 활동을 추적하고, 다양한 명령어와 자동화된 기능을 제공합니다.

**현재 목표:** v2.0 업데이트의 일환으로 프로젝트 전체를 TypeScript로 전환하여 코드의 안정성과 유지보수성을 향상시키는 것입니다.

## 2. 현재 상태: TypeScript 컴파일 오류

`npm run type-check` 스크립트 실행 결과, 현재 다수의 TypeScript 컴파일 오류가 발생하고 있습니다. 이 오류들은 주로 다음과 같은 유형으로 분류할 수 있습니다.

*   **`exactOptionalPropertyTypes: true` 관련 오류:** `undefined`를 명시적으로 타입에 추가해야 합니다.
*   **타입 불일치:** 함수/메서드에 전달되는 인자의 타입이 예상과 다릅니다.
*   **존재하지 않는 속성/메서드 접근:** JavaScript에서는 가능했지만 TypeScript에서는 타입 정의에 없어 오류가 발생합니다.
*   **`any` 타입 사용:** 암시적으로 `any` 타입이 지정되어 발생하는 문제입니다.
*   **라이브러리 타입 정의 부재:** `lowdb`와 같이 타입 선언(`@types/...`)이 없는 라이브러리 사용으로 인한 오류입니다.
*   **선언되지 않은 변수/임포트:** 사용하지 않는 변수나 임포트가 남아있습니다.

## 3. 오류 해결 가이드

오류를 효율적으로 해결하기 위해 아래 가이드라인을 따릅니다.

### 3.1. `exactOptionalPropertyTypes` 오류 해결

`tsconfig.json`의 `"exactOptionalPropertyTypes": true` 옵션은 선택적 속성에 `undefined`를 할당할 수 없도록 합니다.

**오류 예시:**
```typescript
// Type 'LogService | undefined' is not assignable to type 'LogService' with 'exactOptionalPropertyTypes: true'.
someFunction(logService: LogService | undefined);
```

**해결책:**
해당 속성을 받는 객체나 함수의 타입 정의에 `undefined`를 명시적으로 추가합니다.

```typescript
// CommandServices 타입 정의
interface CommandServices {
  //...
  logService: LogService | undefined; // undefined 추가
}

// 또는 함수 매개변수 타입 수정
function someFunction(logService: LogService | undefined) {
  // ...
}
```

### 3.2. 타입 불일치 및 `null` 관련 오류

**오류 예시:**
```typescript
// Type 'GuildMember | APIInteractionGuildMember | null' is not assignable to parameter of type 'GuildMember'.
// Type 'null' is not assignable to type 'GuildMember'.
someFunction(interaction.member);
```

**해결책:**
값이 `null`일 가능성이 있는 경우, 타입 가드(type guard)를 사용하여 `null` 또는 예상치 못한 타입을 처리하는 로직을 추가합니다.

```typescript
const member = interaction.member;
if (member instanceof GuildMember) {
  someFunction(member);
} else {
  // member가 null이거나 다른 타입일 때의 처리
  console.error("부적절한 member 타입입니다.");
}
```

### 3.3. 존재하지 않는 속성 접근 오류

JavaScript에서는 객체에 동적으로 속성을 추가할 수 있었지만, TypeScript에서는 인터페이스나 타입에 정의된 속성에만 접근할 수 있습니다.

**오류 예시:**
```typescript
// Property 'voiceForumService' does not exist in type 'CommandServices'.
services.voiceForumService.doSomething();
```

**해결책:**
`CommandServices`와 같은 중앙 관리 타입에 해당 서비스나 속성을 추가합니다.

```typescript
// src/types/index.ts 또는 관련 타입 파일
export interface CommandServices {
  // ... 기존 서비스들
  voiceForumService?: VoiceChannelForumIntegrationService; // 새로운 서비스 추가
}
```

### 3.4. `lowdb` 타입 정의 부재

`lowdb` v1.0.0은 공식 타입 선언을 제공하지 않습니다.

**오류 예시:**
```typescript
// Could not find a declaration file for module 'lowdb'.
import low from 'lowdb';
```

**해결책:**
프로젝트 루트에 `types/lowdb.d.ts`와 같은 선언 파일을 생성하고 모듈을 선언합니다.

**`types/lowdb.d.ts`:**
```typescript
declare module 'lowdb' {
  const low: any;
  export default low;
}

declare module 'lowdb/adapters/FileSync' {
  const FileSync: any;
  export default FileSync;
}
```
그리고 `tsconfig.json`의 `include`에 `types/**/*.d.ts`를 추가하여 타입 선언 파일을 인식하도록 합니다.

### 3.5. `any` 타입의 암시적 사용

**오류 예시:**
```typescript
// Parameter 'backup' implicitly has an 'any' type.
backups.forEach((backup, index) => { ... });
```

**해결책:**
`backup`과 같은 매개변수에 명시적으로 타입을 지정합니다. 타입을 알 수 없는 경우, 먼저 `console.log` 등으로 구조를 파악한 후 적절한 인터페이스를 정의합니다.

> **⚠️ 중요: `any` 타입 사용 최소화**
> TypeScript의 가장 큰 장점은 정적 타입 검사를 통해 코드의 안정성을 높이는 것입니다. `any` 타입을 사용하면 이러한 장점이 사라지므로, **최대한** 사용을 지양해야 합니다.
> 
> 물론 마이그레이션 초기 단계나 외부 라이브러리 연동 시 불가피하게 `any`를 사용해야 할 수 있습니다. 하지만 이는 임시방편으로 생각하고, 가능한 한 빨리 구체적인 타입(예: `unknown`, `Record<string, unknown>`, 또는 직접 정의한 인터페이스)으로 대체하는 것을 목표로 해야 합니다.

```typescript
interface Backup {
  // backup 객체의 속성 정의
  id: string;
  timestamp: number;
  // ...
}

backups.forEach((backup: Backup, index: number) => {
  // ...
});
```

## 4. 권장 작업 순서

1.  **타입 정의 파일(`*.d.ts`) 생성:** `lowdb` 등 외부 라이브러리 타입 문제를 먼저 해결합니다.
2.  **핵심 타입/인터페이스 정의:** `src/types/` 폴더의 `CommandServices`, `UserActivity` 등 핵심 공유 타입을 먼저 수정하고 완성합니다.
3.  **서비스 클래스부터 수정:** `DatabaseManager`, `ActivityTracker` 등 다른 모듈에 의해 많이 사용되는 서비스 클래스의 오류를 먼저 해결합니다.
4.  **커맨드 핸들러 및 개별 명령어 수정:** 서비스 레이어가 안정화되면 이를 사용하는 커맨드 관련 파일들을 수정합니다.
5.  **UI 및 유틸리티 함수 수정:** 나머지 UI 컴포넌트(`ButtonHandler`, `ModalHandler`)와 유틸리티 함수들을 수정합니다.
6.  **반복적인 `type-check`:** 각 단계에서 `npm run type-check`를 실행하여 오류가 줄어드는지 확인하며 점진적으로 진행합니다.

## 5. 유용한 자료

*   **TypeScript 공식 문서:** [typescriptlang.org/docs](https://www.typescriptlang.org/docs/)
*   **Discord.js 공식 가이드:** [discordjs.guide](https://discordjs.guide/)
*   **Google 검색을 활용한 오류 해결:**
    *   오류 메시지를 복사하여 구글에 검색하면 유사한 문제에 대한 해결책(Stack Overflow 등)을 찾을 수 있습니다.
    *   **검색어 예시:**
        *   `typescript "Property '...' does not exist on type '...'. Did you mean '...'?"`
        *   `discord.js v14 typescript migration guide`
        *   `typescript exactOptionalPropertyTypes error`

---
*이 문서는 Gemini가 프로젝트의 TypeScript 마이그레이션을 돕기 위해 생성했습니다. 문제 발생 시 이 문서를 기준으로 논의하고 업데이트해 나갑니다.*
