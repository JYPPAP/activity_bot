// src/services/jobPostCleanupService.js - 구인구직 카드 자동 정리 서비스
import { JobPostService } from './JobPostService.js';
import { ScheduleService } from './scheduleService.js';

export class JobPostCleanupService {
  constructor(client, dbManager) {
    this.client = client;
    this.dbManager = dbManager;
    this.jobPostService = new JobPostService(dbManager);
    this.scheduleService = new ScheduleService();
    
    // 정리 통계
    this.cleanupStats = {
      totalCleaned: 0,
      lastCleanupTime: null,
      lastCleanupCount: 0
    };
  }

  /**
   * 서비스 초기화 및 스케줄링 시작
   */
  async initialize() {
    await this.jobPostService.initialize();
    
    // 매시간 만료된 카드 정리 스케줄링
    this.scheduleHourlyCleanup();
    
    // 매일 자정 포괄적 정리 스케줄링
    this.scheduleDailyCleanup();
    
    // 초기 정리 실행
    await this.performInitialCleanup();
    
    console.log('[JobPostCleanupService] 구인구직 카드 자동 정리 서비스 초기화 완료');
  }

  /**
   * 매시간 만료된 카드 정리 스케줄링
   */
  scheduleHourlyCleanup() {
    const cleanupInterval = 60 * 60 * 1000; // 1시간
    
    const performHourlyCleanup = async () => {
      try {
        const deletedJobs = await this.cleanupExpiredJobPosts();
        if (deletedJobs.length > 0) {
          console.log(`[JobPostCleanupService] 시간별 정리: 만료된 카드 ${deletedJobs.length}개 삭제`);
        }
      } catch (error) {
        console.error('[JobPostCleanupService] 시간별 정리 오류:', error);
      }
    };

    // 즉시 실행 후 매시간 반복
    setInterval(performHourlyCleanup, cleanupInterval);
    console.log('[JobPostCleanupService] 매시간 정리 스케줄 등록 완료');
  }

  /**
   * 매일 자정 포괄적 정리 스케줄링
   */
  scheduleDailyCleanup() {
    this.scheduleService.scheduleDailyMidnight('jobpost_daily_cleanup', async () => {
      try {
        await this.performComprehensiveCleanup();
      } catch (error) {
        console.error('[JobPostCleanupService] 일일 정리 오류:', error);
      }
    });
  }

  /**
   * 초기 정리 실행 (봇 시작 시)
   */
  async performInitialCleanup() {
    try {
      console.log('[JobPostCleanupService] 초기 정리 시작...');
      
      const deletedJobs = await this.cleanupExpiredJobPosts();
      const orphanedCount = await this.cleanupOrphanedJobPosts();
      
      const totalCleaned = deletedJobs.length + orphanedCount;
      
      if (totalCleaned > 0) {
        console.log(`[JobPostCleanupService] 초기 정리 완료: 총 ${totalCleaned}개 카드 정리 (만료: ${deletedJobs.length}, 고아: ${orphanedCount})`);
      } else {
        console.log('[JobPostCleanupService] 초기 정리 완료: 정리할 카드 없음');
      }

      this.updateCleanupStats(totalCleaned);
      
    } catch (error) {
      console.error('[JobPostCleanupService] 초기 정리 오류:', error);
    }
  }

  /**
   * 포괄적 정리 실행 (일일)
   */
  async performComprehensiveCleanup() {
    try {
      console.log('[JobPostCleanupService] 일일 포괄적 정리 시작...');
      
      // 1. 만료된 카드 정리
      const expiredJobs = await this.cleanupExpiredJobPosts();
      
      // 2. 연동된 채널이 삭제된 카드 정리
      const orphanedJobs = await this.cleanupOrphanedJobPosts();
      
      // 3. 오래된 카드 정리 (생성된 지 7일 이상, 만료시간 무관)
      const oldJobs = await this.cleanupOldJobPosts();
      
      // 4. 데이터 무결성 검증
      const integrityIssues = await this.validateDataIntegrity();
      
      const totalCleaned = expiredJobs.length + orphanedJobs + oldJobs.length;
      
      console.log(`[JobPostCleanupService] 일일 정리 완료:`, {
        만료된카드: expiredJobs.length,
        고아카드: orphanedJobs,
        오래된카드: oldJobs.length,
        무결성문제: integrityIssues,
        총정리수: totalCleaned
      });

      this.updateCleanupStats(totalCleaned);
      
      // 관리자에게 정리 보고서 전송 (선택적)
      if (totalCleaned > 0 || integrityIssues > 0) {
        await this.sendCleanupReport({
          expired: expiredJobs.length,
          orphaned: orphanedJobs,
          old: oldJobs.length,
          integrity: integrityIssues,
          total: totalCleaned
        });
      }
      
    } catch (error) {
      console.error('[JobPostCleanupService] 일일 정리 오류:', error);
    }
  }

  /**
   * 만료된 구인구직 카드 정리
   * @returns {Array} 삭제된 카드 ID 목록
   */
  async cleanupExpiredJobPosts() {
    return await this.jobPostService.cleanupExpiredJobPosts();
  }

  /**
   * 연동된 채널이 삭제된 구인구직 카드 정리
   * @returns {number} 정리된 카드 수
   */
  async cleanupOrphanedJobPosts() {
    try {
      const allJobs = await this.jobPostService.getAllJobPosts(true); // 만료된 것도 포함
      let cleanedCount = 0;

      for (const job of allJobs) {
        if (job.channelId) {
          // 연동된 채널이 실제로 존재하는지 확인
          const channel = this.client.channels.cache.get(job.channelId);
          if (!channel) {
            // 채널이 삭제된 경우 카드도 삭제
            const success = await this.jobPostService.deleteJobPost(job.id);
            if (success) {
              cleanedCount++;
              console.log(`[JobPostCleanupService] 고아 카드 정리: ${job.id} (채널 ${job.channelId} 삭제됨)`);
            }
          }
        }
      }

      return cleanedCount;
      
    } catch (error) {
      console.error('[JobPostCleanupService] 고아 카드 정리 오류:', error);
      return 0;
    }
  }

  /**
   * 오래된 구인구직 카드 정리 (7일 이상)
   * @returns {Array} 삭제된 카드 정보 목록
   */
  async cleanupOldJobPosts() {
    try {
      const allJobs = await this.jobPostService.getAllJobPosts(true); // 만료된 것도 포함
      const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
      const deletedJobs = [];

      for (const job of allJobs) {
        if (job.createdAt < sevenDaysAgo) {
          const success = await this.jobPostService.deleteJobPost(job.id);
          if (success) {
            deletedJobs.push({
              id: job.id,
              title: job.title,
              createdAt: job.createdAt,
              age: Math.floor((Date.now() - job.createdAt) / (24 * 60 * 60 * 1000))
            });
            console.log(`[JobPostCleanupService] 오래된 카드 정리: ${job.id} (${deletedJobs[deletedJobs.length - 1].age}일 경과)`);
          }
        }
      }

      return deletedJobs;
      
    } catch (error) {
      console.error('[JobPostCleanupService] 오래된 카드 정리 오류:', error);
      return [];
    }
  }

  /**
   * 데이터 무결성 검증 및 수정
   * @returns {number} 수정된 문제 수
   */
  async validateDataIntegrity() {
    try {
      let issueCount = 0;
      const allJobs = await this.jobPostService.getAllJobPosts(true);

      // 1. 중복 channelId 검사 및 수정
      const channelMap = new Map();
      for (const job of allJobs) {
        if (job.channelId) {
          if (channelMap.has(job.channelId)) {
            // 중복 발견: 더 오래된 카드의 연동 해제
            const existingJob = channelMap.get(job.channelId);
            const olderJob = job.createdAt < existingJob.createdAt ? job : existingJob;
            
            await this.jobPostService.updateJobPost(olderJob.id, { channelId: null });
            issueCount++;
            console.log(`[JobPostCleanupService] 중복 channelId 수정: ${olderJob.id} 연동 해제`);
          } else {
            channelMap.set(job.channelId, job);
          }
        }
      }

      // 2. 잘못된 만료시간 수정
      for (const job of allJobs) {
        if (!job.expiresAt || job.expiresAt < job.createdAt) {
          // 잘못된 만료시간: 생성시간 + 24시간으로 수정
          const newExpiresAt = job.createdAt + (24 * 60 * 60 * 1000);
          await this.jobPostService.updateJobPost(job.id, { expiresAt: newExpiresAt });
          issueCount++;
          console.log(`[JobPostCleanupService] 잘못된 만료시간 수정: ${job.id}`);
        }
      }

      return issueCount;
      
    } catch (error) {
      console.error('[JobPostCleanupService] 데이터 무결성 검증 오류:', error);
      return 0;
    }
  }

  /**
   * 정리 통계 업데이트
   * @param {number} cleanedCount - 정리된 카드 수
   */
  updateCleanupStats(cleanedCount) {
    this.cleanupStats.totalCleaned += cleanedCount;
    this.cleanupStats.lastCleanupTime = Date.now();
    this.cleanupStats.lastCleanupCount = cleanedCount;
  }

  /**
   * 정리 보고서 전송 (관리자용)
   * @param {Object} stats - 정리 통계
   */
  async sendCleanupReport(stats) {
    try {
      // 로그 채널에 정리 보고서 전송 (선택적)
      const logChannelId = process.env.LOG_CHANNEL_ID;
      if (logChannelId) {
        const logChannel = this.client.channels.cache.get(logChannelId);
        if (logChannel) {
          const report = [
            '🧹 **구인구직 카드 일일 정리 보고서**',
            `📅 정리 시간: <t:${Math.floor(Date.now() / 1000)}:F>`,
            '',
            '📊 **정리 결과:**',
            `• 만료된 카드: ${stats.expired}개`,
            `• 고아 카드: ${stats.orphaned}개`,
            `• 오래된 카드: ${stats.old}개`,
            `• 무결성 문제: ${stats.integrity}개`,
            '',
            `🗑️ **총 정리된 카드: ${stats.total}개**`
          ].join('\n');

          await logChannel.send(report);
        }
      }
    } catch (error) {
      console.error('[JobPostCleanupService] 정리 보고서 전송 오류:', error);
    }
  }

  /**
   * 정리 통계 조회
   * @returns {Object} 정리 통계
   */
  getCleanupStats() {
    return {
      ...this.cleanupStats,
      nextCleanupTime: this.getNextCleanupTime()
    };
  }

  /**
   * 다음 정리 시간 계산
   * @returns {number} 다음 자정 타임스탬프
   */
  getNextCleanupTime() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.getTime();
  }

  /**
   * 수동 정리 실행
   * @param {Object} options - 정리 옵션
   * @returns {Object} 정리 결과
   */
  async performManualCleanup(options = {}) {
    const { 
      includeExpired = true, 
      includeOrphaned = true, 
      includeOld = false,
      validateIntegrity = true 
    } = options;

    try {
      const results = {
        expired: [],
        orphaned: 0,
        old: [],
        integrity: 0,
        total: 0
      };

      if (includeExpired) {
        results.expired = await this.cleanupExpiredJobPosts();
      }

      if (includeOrphaned) {
        results.orphaned = await this.cleanupOrphanedJobPosts();
      }

      if (includeOld) {
        results.old = await this.cleanupOldJobPosts();
      }

      if (validateIntegrity) {
        results.integrity = await this.validateDataIntegrity();
      }

      results.total = results.expired.length + results.orphaned + results.old.length;
      this.updateCleanupStats(results.total);

      console.log('[JobPostCleanupService] 수동 정리 완료:', results);
      return results;

    } catch (error) {
      console.error('[JobPostCleanupService] 수동 정리 오류:', error);
      throw error;
    }
  }

  /**
   * 서비스 종료
   */
  shutdown() {
    this.scheduleService.cancelAllTasks();
    console.log('[JobPostCleanupService] 정리 서비스 종료');
  }
}