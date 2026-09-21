/**
 * 모든 모달 제출 통계와 제출 히스토리의 단일 소유자다.
 *
 * 책임:
 * - 누적 제출 수와 성공·실패 수를 보관한다.
 * - 응답 시간 합계와 평균을 갱신한다.
 * - 사용자별 제출 히스토리를 조회한다.
 * - 검증 오류 빈도와 서비스 상태를 계산한다.
 *
 * Facade와 다른 모듈은 이 인스턴스의 같은 객체를 참조한다.
 * 통계 객체를 복사해 별도 상태로 관리하지 않는다.
 * 초기화 시에도 이 소유자 내부의 참조만 교체한다.
 * 외부 조회는 기존과 동일하게 얕은 복사본을 반환한다.
 * 제출 히스토리 제한 역시 기존 1000건을 유지한다.
 */
export class ModalStatistics {
  constructor({ parent } = {}) { this.parent = parent; this.resetStatistics(); }
  getModalStatistics() {
    return { ...this.modalStats };
  }
  getSubmissionHistory(limit = 100) {
    return this.submissionHistory
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }
  getUserSubmissionStats(userId) {
    const userSubmissions = this.submissionHistory.filter((entry) => entry.userId === userId);
    const successfulSubmissions = userSubmissions.filter((entry) => entry.success);

    return {
      totalSubmissions: userSubmissions.length,
      successfulSubmissions: successfulSubmissions.length,
      failedSubmissions: userSubmissions.length - successfulSubmissions.length,
      lastSubmission: userSubmissions.length > 0 ? userSubmissions[0].timestamp : null,
      successRate:
        userSubmissions.length > 0
          ? (successfulSubmissions.length / userSubmissions.length) * 100
          : 0,
    };
  }
  resetStatistics() {
    this.modalStats = {
      totalSubmissions: 0,
      standaloneSubmissions: 0,
      voiceChannelSubmissions: 0,
      successfulSubmissions: 0,
      failedSubmissions: 0,
      validationErrors: 0,
      averageResponseTime: 0,
      lastSubmissionTime: new Date(),
      commonErrors: {},
    };

    this.responseTimeSum = 0;
    this.submissionHistory = [];
  }
  recordSubmissionResult(interaction, type, success, startTime, data) {
    const responseTime = Date.now() - startTime;

    // 통계 업데이트
    if (success) {
      this.modalStats.successfulSubmissions++;
    } else {
      this.modalStats.failedSubmissions++;
    }

    this.responseTimeSum += responseTime;
    this.modalStats.averageResponseTime = this.responseTimeSum / this.modalStats.totalSubmissions;

    // 히스토리 기록
    this.submissionHistory.push({
      timestamp: new Date(),
      type: type === 'standalone' ? 'standalone' : 'voiceChannel',
      userId: interaction.user.id,
      success,
      responseTime,
      error: data?.error,
    });

    // 히스토리 크기 제한
    if (this.submissionHistory.length > 1000) {
      this.submissionHistory = this.submissionHistory.slice(-1000);
    }

    return {
      success,
      action: type,
      duration: responseTime,
      ...data,
    };
  }
  recordValidationErrors(errors) {
    errors.forEach((error) => {
      this.modalStats.commonErrors[error] = (this.modalStats.commonErrors[error] || 0) + 1;
    });
  }
  healthCheck() {
    const successRate =
      this.modalStats.totalSubmissions > 0
        ? (this.modalStats.successfulSubmissions / this.modalStats.totalSubmissions) * 100
        : 100;

    const validationErrorRate =
      this.modalStats.totalSubmissions > 0
        ? (this.modalStats.validationErrors / this.modalStats.totalSubmissions) * 100
        : 0;

    return {
      isHealthy: successRate >= 90 && validationErrorRate <= 20,
      totalSubmissions: this.modalStats.totalSubmissions,
      successRate,
      validationErrorRate,
      averageResponseTime: this.modalStats.averageResponseTime,
      lastActivity: this.modalStats.lastSubmissionTime,
      components: {
        recruitmentService: !!this.parent.recruitmentService,
        forumPostManager: !!this.parent.forumPostManager,
      },
    };
  }
}
