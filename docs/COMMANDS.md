# 슬래시 명령어 목록

## 활동 추적 관련

### `/시간확인`
- **용도**: 이번 달 나의 활동 시간 확인 (개인용)
- **옵션**: 없음 (자동으로 이번 달 1일~오늘 기준)
- **파일**: `src/commands/TimeConfirmCommand.js`

### `/시간체크`
- **용도**: 특정 유저의 활동 시간 확인 (관리자용)
- **옵션**:
  - `user` (필수): 확인할 유저
  - `start_date` (선택): 시작일 (YYMMDD)
  - `end_date` (선택): 종료일 (YYMMDD)
- **파일**: `src/commands/TimeCheckCommand.js`

### `/보고서`
- **용도**: 서버 전체 활동 보고서 생성
- **옵션**:
  - `start_date` (필수): 시작일 (YYMMDD)
  - `end_date` (필수): 종료일 (YYMMDD)
  - `test_mode` (선택): 테스트 모드 (기본값: true)
  - `reset` (선택): 보고서 후 데이터 초기화
  - `log_channel` (선택): 출력 채널 지정
- **파일**: `src/commands/gapReportCommand.js`

## 구인구직

### `/구직`
- **용도**: 구인구직 포럼 게시글 생성
- **옵션**: 없음 (모달 UI로 입력)
- **파일**: `src/commands/recruitmentCommand.js`
- **동작**: 음성 채널과 포럼 게시글을 연동하여 참가자 관리

## 닉네임 관리

### `/닉네임설정`
- **용도**: 닉네임 관리 UI를 현재 채널에 설치
- **옵션**: 없음
- **파일**: `src/commands/NicknameSetupCommand.js`
- **동작**: 유저가 Steam, Discord 등 플랫폼 닉네임을 등록/수정할 수 있는 인터랙티브 패널 생성

### `/닉네임관리`
- **용도**: 관리자용 플랫폼 템플릿 관리
- **옵션**: 없음
- **파일**: `src/commands/NicknameManagementCommand.js`
- **동작**: 플랫폼 추가/수정/삭제, 유저 닉네임 조회

## 유틸리티

### `/팀짜기`
- **용도**: 음성 채널 멤버를 랜덤 팀으로 구성
- **옵션**:
  - `전체인원` (필수): 팀에 배정할 총 인원 (최소 2)
  - `팀수` (필수): 만들 팀 개수 (최소 2)
- **파일**: `src/commands/TeamCommand.js`
- **동작**: Fisher-Yates 셔플로 공정한 팀 배분, [관전] 태그 유저 자동 제외

## 명령어 권한

권한 설정 파일: `src/config/commandPermissions.js`
- 명령어별 실행 가능 역할/유저 제한 가능
- DEV_ID 유저는 모든 명령어 실행 가능
