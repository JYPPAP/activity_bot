# 10. Domain — 도메인과 유스케이스

> activity_bot이 *무엇을*, *누구를 위해*, *어떤 규칙으로* 수행하는지 정의한다.
> 코드의 `what`과 `how`는 `CODEBASE_MAP.md`에, **`why`와 `for whom`은 이 문서**에 둔다.

---

## 1. 도메인 개요

이 봇은 Discord 길드에서 세 가지 독립 도메인을 통합한다.

| # | 도메인 | 핵심 엔티티 | 주요 유스케이스 |
|---|---|---|---|
| A | **Activity Tracking** (활동 추적) | VoiceSession, MonthlyActivity, AfkState | 음성 채널 접속 시간 집계, 역할별 최소 활동 시간 관리 |
| B | **Recruitment** (구인구직) | ForumPost, VoiceChannel, Participant | 포럼 포스트 ↔ 음성 채널 매핑, 참가자 버튼 흐름 |
| C | **Nickname** (닉네임) | PlatformTemplate, UserNickname | 플랫폼 계정 기반 닉네임 자동화, 음성 채널 표시명 동기화 |

세 도메인은 **독립적으로 동작**하지만, Discord 이벤트 루프를 공유하기 때문에 DI 컨테이너 하나로 묶여 있다.

---

## 2. 도메인 A — Activity Tracking

### 2.1 목적
- 길드원이 음성 채널에서 **얼마나 활동했는지** 자동 집계.
- "최소 활동 시간"을 채우지 못한 유저를 역할별로 리포트 → 운영진이 액션.

### 2.2 핵심 유스케이스 (UC-A)

| ID | 유스케이스 | 트리거 |
|---|---|---|
| UC-A1 | 음성 접속/이탈 감지 → 세션 기록 | `voiceStateUpdate` |
| UC-A2 | AFK/이동 시 세션 유지·종료 처리 | `voiceStateUpdate` |
| UC-A3 | 월별 활동 시간 누적 | 세션 종료 시 |
| UC-A4 | 역할별 활동 리포트 조회 | `/gap_report`, `/gap_list` |
| UC-A5 | 개인 활동 시간 확인 | `/시간확인`, `/시간체크` |
| UC-A6 | 최소 활동 시간 설정 | `/gap_config` (관리자) |

### 2.3 도메인 용어

- **Session**: 한 유저가 음성 채널에 접속한 시점부터 이탈까지의 구간.
- **Excluded Channel**: 활동 집계에서 제외되는 채널 (`EXCLUDED_CHANNELS` env).
- **AFK**: 음소거·스피커 끔 또는 AFK 채널 이동 상태. 세션은 **지속되되 별도 플래그**.
- **Monthly Activity**: `(userId, yyyyMM)` 단위 누적 초.
- **Role Config**: 역할별 월 최소 활동 시간(분) 설정.

---

## 3. 도메인 B — Recruitment

### 3.1 목적
- 길드원이 게임/내전/장기 팀원을 모집할 때, **포럼 포스트 + 음성 채널**을 한 흐름으로 생성·관리.
- 참가/취소/관전/대기/닫기를 모두 **버튼 인터랙션**으로 처리하여 채팅 오염을 막는다.

### 3.2 핵심 유스케이스 (UC-B)

| ID | 유스케이스 | 트리거 |
|---|---|---|
| UC-B1 | 구직 모달 → 포럼 포스트 생성 | `/구직` |
| UC-B2 | 포스트에 음성 채널 자동 연동 | "연동" 선택 |
| UC-B3 | 내전/장기 전용 포럼 분리 | 모달 유형 |
| UC-B4 | 참가/참가 취소/멤버 수정 | 포스트 내 버튼 |
| UC-B5 | 관전·대기·초기화·닫기 | 음성 채널 버튼 |
| UC-B6 | 참가자 변경 시 닉네임 자동 갱신 | `ParticipantTracker` |
| UC-B7 | 팀짜기 (`TEAM_CHANNEL_IDS`) | `/팀짜기` |

### 3.3 도메인 용어

- **ForumPost**: Discord 포럼 스레드. 구직 글 1개 = 포럼 포스트 1개.
- **Voice-linked post**: `forum_state = 'voice_linked'`. 음성 채널에 종속.
- **Standalone post**: `forum_state = 'standalone'`. 음성 채널 없이 존재. `voice_channel_id = 'STANDALONE_{threadId}'`.
- **Pre-member (미리 모인 멤버)**: 모집 시점에 이미 참가 확정된 유저.
- **Participant**: `forum_participants` 테이블의 행. `(forum_post_id, user_id)` UNIQUE.
- **CustomId prefix**: 버튼·모달을 라우팅하기 위한 문자열 prefix (목록 → `CODEBASE_MAP.md`).

### 3.4 포스트 상태 전이

```
[모달 제출]
    ↓
  created ──(음성 연동)──► voice_linked ──(음성 삭제)──► archived(닫힘)
    └──(독립 선택)────► standalone ──(타임아웃/닫기)──► archived
```

---

## 4. 도메인 C — Nickname

### 4.1 목적
- 유저의 게임 플랫폼 계정(e.g. LoL ID, Steam ID)을 Discord 닉네임에 일관된 포맷으로 반영.
- 음성 채널 입장 시 닉네임 자동 동기화 (`VoiceChannelNicknameManager`).

### 4.2 핵심 유스케이스 (UC-C)

| ID | 유스케이스 | 트리거 |
|---|---|---|
| UC-C1 | 플랫폼 템플릿 등록 | `/닉관리` (관리자) |
| UC-C2 | 개인 닉네임 등록 | `/닉설정` |
| UC-C3 | 닉네임 조회/수정 | `/닉네임` |
| UC-C4 | 음성 채널 입장 시 닉네임 재적용 | `voiceStateUpdate` |
| UC-C5 | `[관전]`·`[대기]` 태그 정리 | `TextProcessor.cleanNickname` |

### 4.3 도메인 용어

- **Platform Template**: `{Platform} 이름` 형식의 표현 템플릿.
- **Cleaned nickname**: `[관전]`, `[대기]`, `(N)` 등 장식 접두사·접미사가 제거된 원본.

---

## 5. 도메인 간 상호작용 (교차 규칙)

| 상호작용 | 규칙 |
|---|---|
| 음성 채널 이탈 시 | A의 Session 종료 + B의 Participant 유지(사용자 의사로 취소해야 제거) + C의 닉네임 복원 |
| 포럼 포스트 닫힘 | B의 state → archived, A의 활동은 영향 없음 |
| 닉네임 변경 | A의 기록에는 `userId` 기반이므로 영향 없음 (이것이 *의도된 불변*) |

---

## 6. 비-도메인 (Out of Scope)

- 메시지 콘텐츠 분석·자동 모더레이션
- 음성 녹음·오디오 처리
- 외부 게임 API 연동 (LoL API 등 — 현재 없음, 향후 ADR 필요)
- 다국어 지원 (한국어 단일)

---

## 7. 용어 빠른 사전

| 용어 | 정의 |
|---|---|
| 길드(Guild) | Discord 서버 (도메인 모델 관점에서 동의어) |
| 인터랙션(Interaction) | 슬래시 커맨드, 버튼, 모달, 셀렉트 메뉴 응답 객체 |
| CustomId | 인터랙션 컴포넌트에 부착되는 라우팅 키 |
| Forum state | `post_integrations.forum_state` 컬럼 값 |
| Standalone | 음성 채널 없이 존재하는 포럼 포스트 |
| AFK 채널 | Discord가 지정한 자동 비활성 채널 |

---

## 8. 슬래시 커맨드

> 등록 정의는 `scripts/registerCommands.js`, 실행 권한은 `src/config/commandPermissions.js`가 기준이다.

| 커맨드 | 용도 | 주요 옵션 | 권한 |
|---|---|---|---|
| `/시간확인` | 이번 달 개인 활동 시간 확인 | 없음 | 기본 거부, `사장` 또는 `DEV_ID` |
| `/시간체크` | 특정 유저의 기간별 활동 시간 확인 | `user` 필수, `start_date`·`end_date` 선택 | `사장` 또는 `DEV_ID` |
| `/보고서` | 서버 활동 보고서 생성 | `start_date`·`end_date` 필수, `test_mode`·`reset`·`log_channel` 선택 | `사장` 또는 `DEV_ID` |
| `/구직` | 구인구직 포럼 포스트 생성 | 모달 입력 | 공개 |
| `/닉네임설정` | 현재 채널에 닉네임 관리 UI 설치 | 없음 | 기본 거부, `사장` 또는 `DEV_ID` |
| `/닉네임관리` | 플랫폼 템플릿 관리 | 없음 | `사장` 또는 `DEV_ID` |
| `/팀짜기` | 음성 채널 멤버를 무작위 팀으로 배정 | `전체인원`·`팀수` 필수 | 공개 |

`DEV_ID`와 `사장` 역할은 모든 커맨드를 실행할 수 있다. 권한 맵에 없고 공개 목록에도 없는 커맨드는 기본적으로 거부된다.

---

_작업 전 본인의 변경이 어느 도메인(A/B/C)에 속하는지 한 줄로 명시하면 의사결정이 빨라진다._
