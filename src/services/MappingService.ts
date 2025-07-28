// src/services/MappingService.ts - 채널-포스트 매핑 관리
import { Client } from 'discord.js';

// 음성 채널 정보 인터페이스
interface VoiceChannelInfo {
  id: string;
  name: string;
  members?: Map<string, any>;
  parentId?: string;
  deleted?: boolean;
  categoryId?: string;
  userLimit?: number;
  bitrate?: number;
}

// 포럼 포스트 정보 인터페이스
interface PostInfo {
  id: string;
  name: string;
  archived: boolean;
  messageCount: number;
  memberCount: number;
  createdAt: Date;
  lastMessageId: string | null;
  ownerId: string;
  isActive?: boolean;
}

// 매핑 데이터 인터페이스
interface MappingData {
  voice_channel_id: string;
  forum_post_id: string;
  last_participant_count: number;
  created_at?: Date;
  updated_at?: Date;
}

// 매핑 세부 정보 인터페이스
interface MappingDetails {
  voiceChannelId: string;
  postId: string;
  voiceChannel: VoiceChannelInfo | null;
  post: PostInfo | null;
  hasQueuedUpdate: boolean;
  lastParticipantCount?: number;
  isValid: boolean;
  healthStatus: 'healthy' | 'warning' | 'error';
}

// 매핑 통계 인터페이스
interface MappingStats {
  totalMappings: number;
  queuedUpdates: number;
  healthyMappings: number;
  warningMappings: number;
  errorMappings: number;
  averageParticipants: number;
  mappings: Array<{
    channelId: string;
    postId: string;
    lastCount: number;
    isHealthy: boolean;
  }>;
}

// 로드 결과 인터페이스
interface LoadResult {
  success: boolean;
  loaded: number;
  validated: number;
  removed: number;
  error?: string;
  skipped?: boolean;
}

// 정리 결과 인터페이스
interface CleanupResult {
  deletedChannels: number;
  deletedPosts: number;
  totalCleaned: number;
  remainingMappings: number;
  skipped?: boolean;
  errors?: string[];
}

// 업데이트 큐 항목 인터페이스
interface QueuedUpdate {
  voiceChannelId: string;
  timer: NodeJS.Timeout;
  scheduledAt: Date;
  delay: number;
  retryCount: number;
}

// 매핑 검증 결과 인터페이스
interface ValidationResult {
  isValid: boolean;
  voiceChannelExists: boolean;
  postExists: boolean;
  postArchived: boolean;
  error?: string;
}

// 참가자 업데이트 결과 인터페이스 (currently unused)
// interface ParticipantUpdateResult {
//   success: boolean;
//   currentCount: number;
//   maxCount: number | string;
//   previousCount: number;
//   messageId?: string;
//   error?: string;
// }

export class MappingService {
  private client: Client;
  private voiceChannelManager: any;
  private forumPostManager: any;
  private databaseManager: any;
  private channelPostMap: Map<string, string> = new Map();
  private updateQueue: Map<string, QueuedUpdate> = new Map();
  private lastParticipantCounts: Map<string, number> = new Map();
  private mappingHealth: Map<string, 'healthy' | 'warning' | 'error'> = new Map();
  private updateHistory: Array<{
    channelId: string;
    timestamp: Date;
    success: boolean;
    error?: string;
  }> = [];
  private maxHistorySize: number = 100;
  private syncInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(
    client: Client,
    voiceChannelManager: any,
    forumPostManager: any,
    databaseManager: any
  ) {
    this.client = client;
    this.voiceChannelManager = voiceChannelManager;
    this.forumPostManager = forumPostManager;
    this.databaseManager = databaseManager;

    // 정기적인 동기화 및 헬스 체크 시작
    this.startPeriodicSync();
    this.startHealthCheck();
  }

  /**
   * 채널-포스트 매핑 추가
   * @param voiceChannelId - 음성 채널 ID
   * @param postId - 포럼 포스트 ID
   * @returns 추가 성공 여부
   */
  async addMapping(voiceChannelId: string, postId: string): Promise<boolean> {
    try {
      // 입력 검증
      if (!voiceChannelId || !postId) {
        console.error('[MappingService] 유효하지 않은 매핑 데이터');
        return false;
      }

      // 중복 매핑 확인
      if (this.channelPostMap.has(voiceChannelId)) {
        console.warn(`[MappingService] 이미 매핑된 채널: ${voiceChannelId}`);
        return false;
      }

      // 매핑 유효성 검증
      const validation = await this.validateMapping(voiceChannelId, postId);
      if (!validation.isValid) {
        console.error(`[MappingService] 매핑 검증 실패: ${validation.error}`);
        return false;
      }

      // 메모리에 추가
      this.channelPostMap.set(voiceChannelId, postId);
      this.mappingHealth.set(voiceChannelId, 'healthy');

      // 데이터베이스에 저장
      if (this.databaseManager) {
        const saved = await this.databaseManager.saveChannelMapping(voiceChannelId, postId, 0);
        if (!saved) {
          console.error(`[MappingService] 데이터베이스 저장 실패: ${voiceChannelId} -> ${postId}`);
          // 메모리에서도 제거
          this.channelPostMap.delete(voiceChannelId);
          this.mappingHealth.delete(voiceChannelId);
          return false;
        }
      }

      console.log(`[MappingService] 매핑 추가: ${voiceChannelId} -> ${postId}`);
      this.logCurrentMappings();

      // 즉시 참가자 수 업데이트 큐에 추가
      this.queueUpdate(voiceChannelId, 1000);

      return true;
    } catch (error) {
      console.error(`[MappingService] 매핑 추가 오류: ${voiceChannelId} -> ${postId}`, error);
      return false;
    }
  }

  /**
   * 매핑 유효성 검증
   * @param voiceChannelId - 음성 채널 ID
   * @param postId - 포럼 포스트 ID
   * @returns 검증 결과
   */
  private async validateMapping(voiceChannelId: string, postId: string): Promise<ValidationResult> {
    try {
      const [voiceChannelInfo, postInfo] = await Promise.allSettled([
        this.voiceChannelManager.getVoiceChannelInfo(voiceChannelId),
        this.forumPostManager.getPostInfo(postId),
      ]);

      const voiceChannelExists =
        voiceChannelInfo.status === 'fulfilled' && voiceChannelInfo.value !== null;
      const postExists = postInfo.status === 'fulfilled' && postInfo.value !== null;
      const postArchived =
        postExists && (postInfo as PromiseFulfilledResult<PostInfo>).value.archived;

      const isValid = voiceChannelExists && postExists && !postArchived;

      return {
        isValid,
        voiceChannelExists,
        postExists,
        postArchived,
        ...(!isValid && {
          error: `음성 채널 존재: ${voiceChannelExists}, 포스트 존재: ${postExists}, 포스트 아카이브됨: ${postArchived}`,
        }),
      };
    } catch (error) {
      return {
        isValid: false,
        voiceChannelExists: false,
        postExists: false,
        postArchived: false,
        error: error instanceof Error ? error.message : '알 수 없는 오류',
      };
    }
  }

  /**
   * 채널-포스트 매핑 제거
   * @param voiceChannelId - 음성 채널 ID
   * @returns 제거 성공 여부
   */
  async removeMapping(voiceChannelId: string): Promise<boolean> {
    try {
      const existed = this.channelPostMap.delete(voiceChannelId);

      if (existed) {
        // 관련 데이터들도 함께 제거
        this.lastParticipantCounts.delete(voiceChannelId);
        this.mappingHealth.delete(voiceChannelId);

        // 큐된 업데이트가 있다면 취소
        if (this.updateQueue.has(voiceChannelId)) {
          const queuedUpdate = this.updateQueue.get(voiceChannelId)!;
          clearTimeout(queuedUpdate.timer);
          this.updateQueue.delete(voiceChannelId);
        }

        // 데이터베이스에서도 제거
        if (this.databaseManager) {
          const removed = await this.databaseManager.removeChannelMapping(voiceChannelId);
          if (!removed) {
            console.warn(`[MappingService] 데이터베이스에서 매핑 제거 실패: ${voiceChannelId}`);
          }
        }

        console.log(`[MappingService] 매핑 제거: ${voiceChannelId}`);
        this.logCurrentMappings();
      }

      return existed;
    } catch (error) {
      console.error(`[MappingService] 매핑 제거 오류: ${voiceChannelId}`, error);
      return false;
    }
  }

  /**
   * 음성 채널에 연결된 포스트 ID 가져오기
   * @param voiceChannelId - 음성 채널 ID
   * @returns 포스트 ID 또는 null
   */
  getPostId(voiceChannelId: string): string | null {
    return this.channelPostMap.get(voiceChannelId) || null;
  }

  /**
   * 포스트에 연결된 음성 채널 ID 가져오기
   * @param postId - 포럼 포스트 ID
   * @returns 음성 채널 ID 또는 null
   */
  getVoiceChannelId(postId: string): string | null {
    for (const [channelId, mappedPostId] of this.channelPostMap.entries()) {
      if (mappedPostId === postId) {
        return channelId;
      }
    }
    return null;
  }

  /**
   * 특정 음성 채널이 매핑되어 있는지 확인
   * @param voiceChannelId - 음성 채널 ID
   * @returns 매핑 존재 여부
   */
  hasMapping(voiceChannelId: string): boolean {
    return this.channelPostMap.has(voiceChannelId);
  }

  /**
   * 모든 매핑 가져오기
   * @returns 전체 매핑 Map
   */
  getAllMappings(): Map<string, string> {
    return new Map(this.channelPostMap);
  }

  /**
   * 매핑 개수 가져오기
   * @returns 매핑 개수
   */
  getMappingCount(): number {
    return this.channelPostMap.size;
  }

  /**
   * 업데이트 큐에 추가
   * @param voiceChannelId - 음성 채널 ID
   * @param delay - 지연 시간 (밀리초)
   * @param retryCount - 재시도 횟수
   */
  queueUpdate(voiceChannelId: string, delay: number = 2000, retryCount: number = 0): void {
    // 기존 타이머가 있으면 제거
    if (this.updateQueue.has(voiceChannelId)) {
      const existingUpdate = this.updateQueue.get(voiceChannelId)!;
      clearTimeout(existingUpdate.timer);
    }

    // 새 타이머 설정
    const timer = setTimeout(async () => {
      await this.processQueuedUpdate(voiceChannelId, retryCount);
      this.updateQueue.delete(voiceChannelId);
    }, delay);

    const queuedUpdate: QueuedUpdate = {
      voiceChannelId,
      timer,
      scheduledAt: new Date(),
      delay,
      retryCount,
    };

    this.updateQueue.set(voiceChannelId, queuedUpdate);
    console.log(
      `[MappingService] 업데이트 큐에 추가: ${voiceChannelId} (${delay}ms 후 실행, 재시도: ${retryCount})`
    );
  }

  /**
   * 큐된 업데이트 처리
   * @param voiceChannelId - 음성 채널 ID
   * @param retryCount - 재시도 횟수
   */
  private async processQueuedUpdate(voiceChannelId: string, retryCount: number = 0): Promise<void> {
    try {
      console.log(
        `[MappingService] 큐된 업데이트 처리 시작: ${voiceChannelId} (재시도: ${retryCount})`
      );

      const postId = this.getPostId(voiceChannelId);
      if (!postId) {
        console.log(`[MappingService] 매핑된 포스트가 없음: ${voiceChannelId}`);
        this.recordUpdateHistory(voiceChannelId, false, '매핑된 포스트 없음');
        return;
      }

      console.log(`[MappingService] 매핑된 포스트 ID: ${postId}`);

      // 음성 채널 정보 가져오기
      const voiceChannelInfo = await this.voiceChannelManager.getVoiceChannelInfo(voiceChannelId);
      if (!voiceChannelInfo) {
        console.log(`[MappingService] 음성 채널을 찾을 수 없음: ${voiceChannelId}`);
        await this.removeMapping(voiceChannelId);
        this.recordUpdateHistory(voiceChannelId, false, '음성 채널 찾을 수 없음');
        return;
      }

      // 채널이 삭제된 경우 매핑 정리
      if (voiceChannelInfo.deleted) {
        console.log(`[MappingService] 삭제된 채널 매핑 정리: ${voiceChannelId}`);
        await this.removeMapping(voiceChannelId);
        this.recordUpdateHistory(voiceChannelId, false, '채널 삭제됨');
        return;
      }

      console.log(`[MappingService] 음성 채널 정보:`, {
        name: voiceChannelInfo.name,
        memberCount: voiceChannelInfo.members?.size || 0,
        categoryId: voiceChannelInfo.parentId,
      });

      // 참여자 수 계산
      const ParticipantTracker = (await import('./ParticipantTracker.js')).ParticipantTracker;
      const participantTracker = new ParticipantTracker(this.client);
      const currentCount = participantTracker.countActiveParticipants(voiceChannelInfo);

      console.log(`[MappingService] 활성 참여자 수: ${currentCount}`);

      // 제목에서 최대 인원 수 추출
      const postInfo = await this.forumPostManager.getPostInfo(postId);
      if (!postInfo) {
        console.log(`[MappingService] 포스트 정보를 가져올 수 없음: ${postId}`);
        await this.removeMapping(voiceChannelId);
        this.recordUpdateHistory(voiceChannelId, false, '포스트 정보 없음');
        return;
      }

      console.log(`[MappingService] 포스트 정보:`, {
        name: postInfo.name,
        archived: postInfo.archived,
        messageCount: postInfo.messageCount,
      });

      const maxCount = participantTracker.extractMaxParticipants(postInfo.name);
      console.log(`[MappingService] 최대 인원 수: ${maxCount}`);

      // 이전 참여자 수와 비교
      const lastCount = this.lastParticipantCounts.get(voiceChannelId) || 0;
      if (lastCount === currentCount) {
        console.log(
          `[MappingService] 참여자 수 변경 없음 (${currentCount}/${maxCount}), 메시지 전송 건너뛰기`
        );
        this.recordUpdateHistory(voiceChannelId, true, '참여자 수 변경 없음');
        this.mappingHealth.set(voiceChannelId, 'healthy');
        return;
      }

      // 참여자 수 업데이트 메시지 전송
      console.log(
        `[MappingService] 참여자 수 변경 감지: ${lastCount} -> ${currentCount}, 메시지 전송 시작...`
      );

      const updateResult = await this.forumPostManager.sendParticipantUpdateMessage(
        postId,
        currentCount,
        maxCount,
        voiceChannelInfo.name
      );

      if (
        updateResult &&
        (typeof updateResult === 'boolean' ? updateResult : updateResult.success)
      ) {
        // 성공적으로 전송된 경우에만 마지막 참여자 수 저장
        this.lastParticipantCounts.set(voiceChannelId, currentCount);

        // 데이터베이스에도 참여자 수 업데이트
        if (this.databaseManager) {
          const dbUpdated = await this.databaseManager.updateLastParticipantCount(
            voiceChannelId,
            currentCount
          );
          if (!dbUpdated) {
            console.warn(
              `[MappingService] 데이터베이스 참여자 수 업데이트 실패: ${voiceChannelId}`
            );
          }
        }

        console.log(
          `[MappingService] 참여자 수 업데이트 완료: ${voiceChannelId} -> ${postId} (${currentCount}/${maxCount})`
        );
        this.recordUpdateHistory(voiceChannelId, true);
        this.mappingHealth.set(voiceChannelId, 'healthy');
      } else {
        console.log(`[MappingService] 참여자 수 업데이트 실패: ${voiceChannelId} -> ${postId}`);
        this.recordUpdateHistory(voiceChannelId, false, '메시지 전송 실패');
        this.mappingHealth.set(voiceChannelId, 'error');

        // 재시도 로직
        if (retryCount < 3) {
          const retryDelay = Math.min(5000 * Math.pow(2, retryCount), 30000); // 지수 백오프
          console.log(`[MappingService] ${retryDelay}ms 후 재시도 예정 (${retryCount + 1}/3)`);
          this.queueUpdate(voiceChannelId, retryDelay, retryCount + 1);
        } else {
          console.error(`[MappingService] 최대 재시도 횟수 초과: ${voiceChannelId}`);
          this.mappingHealth.set(voiceChannelId, 'error');
        }
      }
    } catch (error) {
      console.error(`[MappingService] 큐된 업데이트 처리 오류: ${voiceChannelId}`, error);
      this.recordUpdateHistory(
        voiceChannelId,
        false,
        error instanceof Error ? error.message : '알 수 없는 오류'
      );
      this.mappingHealth.set(voiceChannelId, 'error');

      // 재시도 로직
      if (retryCount < 3) {
        const retryDelay = Math.min(5000 * Math.pow(2, retryCount), 30000);
        console.log(
          `[MappingService] 오류 발생, ${retryDelay}ms 후 재시도 예정 (${retryCount + 1}/3)`
        );
        this.queueUpdate(voiceChannelId, retryDelay, retryCount + 1);
      }
    }
  }

  /**
   * 업데이트 히스토리 기록
   * @param channelId - 채널 ID
   * @param success - 성공 여부
   * @param error - 오류 메시지
   */
  private recordUpdateHistory(channelId: string, success: boolean, error?: string): void {
    this.updateHistory.push({
      channelId,
      timestamp: new Date(),
      success,
      ...(error && { error }),
    });

    // 히스토리 크기 제한
    if (this.updateHistory.length > this.maxHistorySize) {
      this.updateHistory = this.updateHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * 삭제된 채널들 정리
   * @returns 정리된 매핑 개수
   */
  async cleanupDeletedChannels(): Promise<number> {
    const channelIds = Array.from(this.channelPostMap.keys());
    const deletedChannels = await this.voiceChannelManager.getDeletedChannels(channelIds);

    let cleanedCount = 0;
    const errors: string[] = [];

    for (const deletedChannelId of deletedChannels) {
      try {
        const postId = this.getPostId(deletedChannelId);

        // 포럼 포스트 아카이브
        if (postId) {
          const archived = await this.forumPostManager.archivePost(postId, '음성 채널 삭제됨');
          if (!archived) {
            errors.push(`포스트 아카이브 실패: ${postId}`);
          }
        }

        // 매핑 제거
        const removed = await this.removeMapping(deletedChannelId);
        if (removed) {
          cleanedCount++;
        }
      } catch (error) {
        const errorMsg = `채널 ${deletedChannelId} 정리 중 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`;
        errors.push(errorMsg);
        console.error(`[MappingService] ${errorMsg}`);
      }
    }

    if (cleanedCount > 0) {
      console.log(`[MappingService] 삭제된 채널 정리 완료: ${cleanedCount}개 매핑 제거`);
    }

    if (errors.length > 0) {
      console.warn(`[MappingService] 정리 중 오류 발생:`, errors);
    }

    return cleanedCount;
  }

  /**
   * 삭제된 포스트들 정리
   * @returns 정리된 매핑 개수
   */
  async cleanupDeletedPosts(): Promise<number> {
    let cleanedCount = 0;
    const errors: string[] = [];

    for (const [channelId, postId] of this.channelPostMap.entries()) {
      try {
        const postExists = await this.forumPostManager.postExists(postId);

        if (!postExists) {
          const removed = await this.removeMapping(channelId);
          if (removed) {
            cleanedCount++;
            console.log(
              `[MappingService] 삭제된 포스트로 인한 매핑 제거: ${channelId} -> ${postId}`
            );
          }
        }
      } catch (error) {
        const errorMsg = `포스트 ${postId} 확인 중 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`;
        errors.push(errorMsg);
        console.error(`[MappingService] ${errorMsg}`);
      }
    }

    if (cleanedCount > 0) {
      console.log(`[MappingService] 삭제된 포스트 정리 완료: ${cleanedCount}개 매핑 제거`);
    }

    if (errors.length > 0) {
      console.warn(`[MappingService] 정리 중 오류 발생:`, errors);
    }

    return cleanedCount;
  }

  /**
   * 전체 정리 작업 수행
   * @returns 정리 결과
   */
  async performFullCleanup(): Promise<CleanupResult> {
    const currentMappings = this.getMappingCount();

    // 매핑이 없으면 정리 작업 스킵
    if (currentMappings === 0) {
      console.log(`[MappingService] 매핑이 없어 정리 작업을 스킵합니다.`);
      return {
        deletedChannels: 0,
        deletedPosts: 0,
        totalCleaned: 0,
        remainingMappings: 0,
        skipped: true,
      };
    }

    console.log(`[MappingService] 전체 정리 작업 시작 (현재 매핑: ${currentMappings}개)`);

    const errors: string[] = [];

    try {
      const deletedChannels = await this.cleanupDeletedChannels();
      const deletedPosts = await this.cleanupDeletedPosts();

      const result: CleanupResult = {
        deletedChannels,
        deletedPosts,
        totalCleaned: deletedChannels + deletedPosts,
        remainingMappings: this.getMappingCount(),
        ...(errors.length > 0 && { errors }),
      };

      console.log(`[MappingService] 전체 정리 작업 완료:`, result);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '알 수 없는 오류';
      errors.push(errorMsg);
      console.error('[MappingService] 전체 정리 작업 중 오류:', error);

      return {
        deletedChannels: 0,
        deletedPosts: 0,
        totalCleaned: 0,
        remainingMappings: this.getMappingCount(),
        errors,
      };
    }
  }

  /**
   * 현재 매핑 상태 로깅
   */
  logCurrentMappings(): void {
    if (this.channelPostMap.size > 0) {
      console.log(
        `[MappingService] 현재 매핑 상태 (${this.channelPostMap.size}개):`,
        Array.from(this.channelPostMap.entries())
      );
    } else {
      console.log(`[MappingService] 현재 매핑된 채널 없음`);
    }
  }

  /**
   * 매핑 통계 가져오기
   * @returns 매핑 통계
   */
  getMappingStats(): MappingStats {
    const mappings = Array.from(this.channelPostMap.entries()).map(([channelId, postId]) => {
      const lastCount = this.lastParticipantCounts.get(channelId) || 0;
      const health = this.mappingHealth.get(channelId) || 'warning';

      return {
        channelId,
        postId,
        lastCount,
        isHealthy: health === 'healthy',
      };
    });

    const healthCounts = Array.from(this.mappingHealth.values()).reduce(
      (acc, health) => {
        acc[health]++;
        return acc;
      },
      { healthy: 0, warning: 0, error: 0 }
    );

    const totalParticipants = Array.from(this.lastParticipantCounts.values()).reduce(
      (sum, count) => sum + count,
      0
    );
    const averageParticipants =
      this.channelPostMap.size > 0 ? totalParticipants / this.channelPostMap.size : 0;

    return {
      totalMappings: this.getMappingCount(),
      queuedUpdates: this.updateQueue.size,
      healthyMappings: healthCounts.healthy,
      warningMappings: healthCounts.warning,
      errorMappings: healthCounts.error,
      averageParticipants,
      mappings,
    };
  }

  /**
   * 특정 매핑 상세 정보 가져오기
   * @param voiceChannelId - 음성 채널 ID
   * @returns 매핑 상세 정보
   */
  async getMappingDetails(voiceChannelId: string): Promise<MappingDetails | null> {
    const postId = this.getPostId(voiceChannelId);
    if (!postId) return null;

    try {
      const [voiceChannelInfo, postInfo] = await Promise.allSettled([
        this.voiceChannelManager.getVoiceChannelInfo(voiceChannelId),
        this.forumPostManager.getPostInfo(postId),
      ]);

      const voiceChannel = voiceChannelInfo.status === 'fulfilled' ? voiceChannelInfo.value : null;
      const post = postInfo.status === 'fulfilled' ? postInfo.value : null;

      const health = this.mappingHealth.get(voiceChannelId) || 'warning';
      const isValid = voiceChannel !== null && post !== null && !post.archived;

      return {
        voiceChannelId,
        postId,
        voiceChannel,
        post,
        hasQueuedUpdate: this.updateQueue.has(voiceChannelId),
        ...(this.lastParticipantCounts.has(voiceChannelId) &&
          this.lastParticipantCounts.get(voiceChannelId) !== undefined && {
            lastParticipantCount: this.lastParticipantCounts.get(voiceChannelId)!,
          }),
        isValid,
        healthStatus: health,
      };
    } catch (error) {
      console.error(`[MappingService] 매핑 상세 정보 가져오기 실패: ${voiceChannelId}`, error);
      return null;
    }
  }

  /**
   * Discord 클라이언트 준비 상태 확인
   * @returns 클라이언트가 준비되었는지 여부
   */
  private isClientReady(): boolean {
    if (!this.client) {
      console.warn('[MappingService] Discord 클라이언트가 없습니다.');
      return false;
    }

    if (!this.client.isReady()) {
      console.warn('[MappingService] Discord 클라이언트가 아직 준비되지 않았습니다.');
      return false;
    }

    if (!this.client.token) {
      console.warn('[MappingService] Discord 토큰이 없습니다.');
      return false;
    }

    return true;
  }

  /**
   * 데이터베이스에서 매핑 정보 로드 (봇 시작 시 복구)
   * @returns 로드 결과
   */
  async loadMappingsFromDatabase(): Promise<LoadResult> {
    if (!this.databaseManager) {
      console.warn('[MappingService] DatabaseManager가 없어 매핑 로드를 건너뜁니다.');
      return { success: false, loaded: 0, validated: 0, removed: 0 };
    }

    // Discord 클라이언트 준비 상태 확인
    if (!this.isClientReady()) {
      console.warn('[MappingService] Discord 클라이언트가 준비되지 않아 매핑 로드를 연기합니다.');
      return {
        success: false,
        loaded: 0,
        validated: 0,
        removed: 0,
        error: '클라이언트 준비되지 않음',
      };
    }

    try {
      console.log('[MappingService] 데이터베이스에서 매핑 로드 시작...');

      const savedMappings = await this.databaseManager.getAllChannelMappings();

      if (!Array.isArray(savedMappings)) {
        console.warn('[MappingService] 데이터베이스에서 유효하지 않은 매핑 데이터를 받았습니다.');
        return {
          success: false,
          loaded: 0,
          validated: 0,
          removed: 0,
          error: '유효하지 않은 데이터 형식',
        };
      }

      let loadedCount = 0;
      let validatedCount = 0;
      let removedCount = 0;

      for (const mapping of savedMappings) {
        const { voice_channel_id, forum_post_id, last_participant_count } = mapping as MappingData;

        // 필수 필드 검증
        if (!voice_channel_id || !forum_post_id) {
          console.warn(`[MappingService] 유효하지 않은 매핑 데이터 건너뛰기:`, mapping);
          continue;
        }

        try {
          // 매핑 유효성 검증
          const validation = await this.validateMapping(voice_channel_id, forum_post_id);

          if (validation.isValid) {
            // 유효한 매핑인 경우 메모리에 로드
            this.channelPostMap.set(voice_channel_id, forum_post_id);
            this.mappingHealth.set(voice_channel_id, 'healthy');

            if (last_participant_count !== undefined) {
              this.lastParticipantCounts.set(voice_channel_id, last_participant_count);
            }

            validatedCount++;
            console.log(`[MappingService] 매핑 복구: ${voice_channel_id} -> ${forum_post_id}`);
          } else {
            // 유효하지 않은 매핑인 경우 데이터베이스에서 제거
            try {
              await this.databaseManager.removeChannelMapping(voice_channel_id);
              removedCount++;
              console.log(
                `[MappingService] 유효하지 않은 매핑 제거: ${voice_channel_id} -> ${forum_post_id} (${validation.error})`
              );
            } catch (removeError) {
              console.error(`[MappingService] 매핑 제거 실패: ${voice_channel_id}`, removeError);
            }
          }

          loadedCount++;
        } catch (error) {
          console.error(
            `[MappingService] 매핑 검증 중 예상치 못한 오류: ${voice_channel_id} -> ${forum_post_id}`,
            error
          );

          // 일반적인 오류의 경우 해당 매핑만 제거하고 계속 진행
          try {
            await this.databaseManager.removeChannelMapping(voice_channel_id);
            removedCount++;
          } catch (removeError) {
            console.error(
              `[MappingService] 오류 발생 매핑 제거 실패: ${voice_channel_id}`,
              removeError
            );
          }
        }
      }

      const result: LoadResult = {
        success: true,
        loaded: loadedCount,
        validated: validatedCount,
        removed: removedCount,
      };

      console.log(`[MappingService] 매핑 로드 완료:`, result);
      this.logCurrentMappings();

      return result;
    } catch (error) {
      console.error('[MappingService] 매핑 로드 오류:', error);
      return {
        success: false,
        loaded: 0,
        validated: 0,
        removed: 0,
        error: error instanceof Error ? error.message : '알 수 없는 오류',
      };
    }
  }

  /**
   * 데이터베이스와 메모리 매핑 동기화
   * @returns 동기화 성공 여부
   */
  async syncWithDatabase(): Promise<boolean> {
    if (!this.databaseManager) {
      return false;
    }

    try {
      console.log('[MappingService] 데이터베이스 동기화 시작...');

      // 현재 메모리의 모든 매핑을 데이터베이스에 저장
      for (const [voiceChannelId, postId] of this.channelPostMap.entries()) {
        const lastCount = this.lastParticipantCounts.get(voiceChannelId) || 0;
        await this.databaseManager.saveChannelMapping(voiceChannelId, postId, lastCount);
      }

      console.log(`[MappingService] 데이터베이스 동기화 완료: ${this.channelPostMap.size}개 매핑`);
      return true;
    } catch (error) {
      console.error('[MappingService] 데이터베이스 동기화 오류:', error);
      return false;
    }
  }

  /**
   * 정기적인 동기화 시작
   */
  private startPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(
      async () => {
        await this.syncWithDatabase();
      },
      5 * 60 * 1000
    ); // 5분마다 동기화

    console.log('[MappingService] 정기적인 데이터베이스 동기화 시작 (5분 간격)');
  }

  /**
   * 헬스 체크 시작
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(
      async () => {
        await this.performHealthCheck();
      },
      10 * 60 * 1000
    ); // 10분마다 헬스 체크

    console.log('[MappingService] 정기적인 헬스 체크 시작 (10분 간격)');
  }

  /**
   * 헬스 체크 수행
   */
  private async performHealthCheck(): Promise<void> {
    console.log('[MappingService] 헬스 체크 시작...');

    for (const [channelId, postId] of this.channelPostMap.entries()) {
      try {
        const validation = await this.validateMapping(channelId, postId);

        if (validation.isValid) {
          this.mappingHealth.set(channelId, 'healthy');
        } else {
          this.mappingHealth.set(channelId, 'error');
          console.warn(
            `[MappingService] 헬스 체크 실패: ${channelId} -> ${postId} (${validation.error})`
          );
        }
      } catch (error) {
        this.mappingHealth.set(channelId, 'error');
        console.error(`[MappingService] 헬스 체크 오류: ${channelId}`, error);
      }
    }

    const stats = this.getMappingStats();
    console.log(
      `[MappingService] 헬스 체크 완료: 건강 ${stats.healthyMappings}, 경고 ${stats.warningMappings}, 오류 ${stats.errorMappings}`
    );
  }

  /**
   * 초기화 메서드 (서비스 시작 시 호출)
   * @returns 초기화 성공 여부
   */
  async initialize(): Promise<boolean> {
    try {
      console.log('[MappingService] 서비스 초기화 시작...');

      // 데이터베이스에서 기존 매핑 로드
      const loadResult = await this.loadMappingsFromDatabase();

      if (loadResult.success) {
        console.log(
          `[MappingService] 초기화 완료: ${loadResult.validated}개 매핑 복구, ${loadResult.removed}개 매핑 정리`
        );

        // 초기 헬스 체크 수행
        await this.performHealthCheck();

        return true;
      } else {
        console.error('[MappingService] 초기화 실패:', loadResult.error);
        return false;
      }
    } catch (error) {
      console.error('[MappingService] 초기화 오류:', error);
      return false;
    }
  }

  /**
   * 서비스 종료 시 정리
   */
  destroy(): void {
    console.log('[MappingService] 서비스 종료 중...');

    // 모든 큐된 업데이트 취소
    for (const [_channelId, queuedUpdate] of this.updateQueue.entries()) {
      clearTimeout(queuedUpdate.timer);
    }
    this.updateQueue.clear();

    // 정기적인 작업들 중지
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    console.log('[MappingService] 서비스 종료 완료');
  }

  /**
   * 업데이트 히스토리 조회
   * @param limit - 조회할 항목 수
   * @returns 업데이트 히스토리
   */
  getUpdateHistory(
    limit: number = 50
  ): Array<{ channelId: string; timestamp: Date; success: boolean; error?: string }> {
    return this.updateHistory
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * 큐된 업데이트 정보 조회
   * @returns 큐된 업데이트 목록
   */
  getQueuedUpdates(): Array<{
    channelId: string;
    scheduledAt: Date;
    delay: number;
    retryCount: number;
  }> {
    return Array.from(this.updateQueue.values()).map((update) => ({
      channelId: update.voiceChannelId,
      scheduledAt: update.scheduledAt,
      delay: update.delay,
      retryCount: update.retryCount,
    }));
  }
}
