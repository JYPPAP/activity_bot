// src/utils/TimeActivityHelper.js - 시간 관련 명령어 공통 헬퍼
import { formatTime } from './formatters.js';
import { logger } from '../config/logger-termux.js';

export class TimeActivityHelper {
  
  /**
   * 기본 날짜 범위 계산 (이번 달 1일 ~ 오늘)
   * @returns {{startDate: Date, endDate: Date}}
   */
  static calculateDefaultDateRange() {
    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0, 0);
    const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    
    return { startDate, endDate };
  }

  /**
   * YYMMDD 형식의 날짜 문자열을 Date 객체로 변환
   * @param {string} dateString - YYMMDD 형식의 날짜 문자열
   * @param {boolean} isEndDate - 종료일인지 여부 (true면 23:59:59로 설정)
   * @returns {Date} - 변환된 Date 객체
   */
  static parseDate(dateString, isEndDate = false) {
    if (!dateString || dateString.length !== 6) {
      throw new Error('날짜는 YYMMDD 형식으로 입력해주세요. (예: 250101)');
    }

    const year = parseInt(dateString.substring(0, 2)) + 2000;
    const month = parseInt(dateString.substring(2, 4)) - 1; // 월은 0부터 시작
    const day = parseInt(dateString.substring(4, 6));

    if (isEndDate) {
      return new Date(year, month, day, 23, 59, 59, 999);
    } else {
      return new Date(year, month, day, 0, 0, 0, 0);
    }
  }

  /**
   * 날짜 범위 처리 (관리자용 명령어에서 사용)
   * @param {string|null} startDateOption - 시작 날짜 옵션
   * @param {string|null} endDateOption - 종료 날짜 옵션
   * @returns {{startDate: Date, endDate: Date, error?: string}}
   */
  static processDateRange(startDateOption, endDateOption) {
    // 날짜가 지정되지 않은 경우 자동 설정
    if (!startDateOption && !endDateOption) {
      return this.calculateDefaultDateRange();
    }

    // 시작일과 종료일이 모두 제공되어야 함
    if (!startDateOption || !endDateOption) {
      return {
        error: '❌ 날짜를 지정할 경우 시작일과 종료일을 모두 입력해주세요.',
        startDate: null,
        endDate: null
      };
    }

    try {
      const startDate = this.parseDate(startDateOption, false);
      const endDate = this.parseDate(endDateOption, true);

      // 날짜 유효성 검사
      if (startDate > endDate) {
        return {
          error: '❌ 시작일이 종료일보다 늦을 수 없습니다.',
          startDate: null,
          endDate: null
        };
      }

      return { startDate, endDate };
    } catch (error) {
      return {
        error: `❌ ${error.message}`,
        startDate: null,
        endDate: null
      };
    }
  }

  /**
   * 날짜를 YYYY.MM.DD 형식으로 포맷팅
   * @param {Date} startDate - 시작 날짜
   * @param {Date} endDate - 종료 날짜
   * @returns {string} - 포맷된 날짜 범위 메시지
   */
  static formatDateRange(startDate, endDate) {
    const startDateFormatted = `${startDate.getFullYear()}.${(startDate.getMonth() + 1).toString().padStart(2, '0')}.${startDate.getDate().toString().padStart(2, '0')}`;
    const endDateFormatted = `${endDate.getFullYear()}.${(endDate.getMonth() + 1).toString().padStart(2, '0')}.${endDate.getDate().toString().padStart(2, '0')}`;
    
    return ` ${startDateFormatted} ~ ${endDateFormatted} 기간`;
  }

  /**
   * 메모리와 DB 데이터 일관성 검증
   * @param {Object} activityTracker - ActivityTracker 인스턴스
   * @param {string} userId - 사용자 ID
   * @param {number} dbTotalTime - DB에서 조회한 총 시간 (밀리초)
   * @param {string} component - 컴포넌트 이름
   * @param {Object} additionalMeta - 추가 메타데이터
   */
  static validateDataConsistency(activityTracker, userId, dbTotalTime, component, additionalMeta = {}) {
    const memoryData = activityTracker.getMemoryActivityData(userId);
    
    if (memoryData) {
      const memoryTimeMinutes = Math.round(memoryData.totalTime / 1000 / 60);
      const dbTimeMinutes = Math.round(dbTotalTime / 1000 / 60);
      const timeDifference = Math.abs(memoryTimeMinutes - dbTimeMinutes);
      const percentageDiff = dbTimeMinutes > 0 ? (timeDifference / dbTimeMinutes) * 100 : 0;

      const logMeta = {
        component,
        userId,
        memoryTimeMinutes,
        dbTimeMinutes,
        timeDifference,
        percentageDiff: Math.round(percentageDiff),
        ...additionalMeta
      };

      if (percentageDiff > 10) { // 10% 이상 차이나는 경우 경고
        logger.warn('⚠️ 메모리-DB 데이터 불일치 감지', {
          ...logMeta,
          issue: 'DATA_INCONSISTENCY_WARNING'
        });
      } else {
        logger.info('✅ 메모리-DB 데이터 일관성 확인', logMeta);
      }
    }
  }

  /**
   * 응답 메시지 생성
   * @param {string} displayName - 사용자 표시명
   * @param {string} dateRangeMessage - 날짜 범위 메시지
   * @param {string} formattedTime - 포맷된 시간
   * @returns {string} - 완성된 응답 메시지
   */
  static createResponseMessage(displayName, dateRangeMessage, formattedTime) {
    return `${displayName}님의${dateRangeMessage} 활동 시간은 ${formattedTime} 입니다.`;
  }

  /**
   * 사용자 표시명 조회 (관리자용 명령어에서 사용)
   * @param {Object} guild - 길드 객체
   * @param {string} userId - 사용자 ID
   * @param {string} fallbackUsername - 기본 사용자명
   * @returns {Promise<string>} - 표시명
   */
  static async getUserDisplayName(guild, userId, fallbackUsername) {
    try {
      const member = await guild.members.fetch(userId);
      return member.displayName || fallbackUsername;
    } catch (error) {
      return fallbackUsername;
    }
  }

  /**
   * 명령어 실행 완료 로그 생성
   * @param {string} component - 컴포넌트 이름
   * @param {string} command - 명령어 이름
   * @param {Object} logData - 로그 데이터
   */
  static logCommandExecution(component, command, logData) {
    logger.info(`${component} 실행 완료`, {
      component,
      command,
      executionTime: new Date().toISOString(),
      ...logData
    });
  }

  /**
   * 명령어 에러 처리 및 로깅
   * @param {Object} interaction - Discord 인터랙션 객체
   * @param {Error} error - 에러 객체
   * @param {string} component - 컴포넌트 이름
   */
  static handleCommandError(interaction, error, component) {
    logger.error(`${component} 명령어 실행 오류`, {
      component,
      error: error.message,
      stack: error.stack,
      userId: interaction.user.id
    });
  }

  /**
   * 활동 시간 조회 및 검증 통합 처리
   * @param {Object} dbManager - 데이터베이스 매니저
   * @param {Object} activityTracker - ActivityTracker 인스턴스
   * @param {string} userId - 사용자 ID
   * @param {Date} startDate - 시작 날짜
   * @param {Date} endDate - 종료 날짜
   * @param {string} component - 컴포넌트 이름
   * @param {Object} additionalMeta - 추가 메타데이터
   * @returns {Promise<{totalTime: number, formattedTime: string}>}
   */
  static async getAndValidateActivityTime(dbManager, activityTracker, userId, startDate, endDate, component, additionalMeta = {}) {
    // DB에서 활동 시간 조회 (밀리초)
    const dbTime = await dbManager.getUserActivityByDateRange(
      userId,
      startDate.getTime(),
      endDate.getTime()
    );

    // 현재 세션 시간 조회 (분)
    const currentSessionMinutes = activityTracker ? activityTracker.getCurrentSessionTime(userId) : 0;
    const currentSessionTime = currentSessionMinutes * 60 * 1000; // 밀리초로 변환

    // 총 시간 계산
    const totalTime = dbTime + currentSessionTime;

    // 데이터 일관성 검증 (DB 시간만으로)
    this.validateDataConsistency(activityTracker, userId, dbTime, component, additionalMeta);

    // 시간 포맷팅
    const formattedTime = formatTime(totalTime);
    
    // 현재 세션 시간이 있으면 별도 표시
    let sessionInfo = '';
    if (currentSessionMinutes > 0) {
      sessionInfo = `\n   (현재 세션: +${currentSessionMinutes}분 진행중)`;
    }

    return { 
      totalTime, 
      formattedTime: formattedTime + sessionInfo,
      dbTime,
      currentSessionMinutes 
    };
  }
}