// src/services/MappingService.js - 채널-포스트 매핑 관리
export class MappingService {
  constructor(client, voiceChannelManager, forumPostManager) {
    this.client = client;
    this.voiceChannelManager = voiceChannelManager;
    this.forumPostManager = forumPostManager;
    this.channelPostMap = new Map(); // 음성채널 ID -> 포럼 포스트 ID 매핑
    this.updateQueue = new Map(); // 업데이트 큐 (중복 방지)
    this.lastParticipantCounts = new Map(); // 음성채널 ID -> 마지막 전송된 참여자 수
  }
  
  /**
   * 채널-포스트 매핑 추가
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {string} postId - 포럼 포스트 ID
   * @returns {void}
   */
  addMapping(voiceChannelId, postId) {
    this.channelPostMap.set(voiceChannelId, postId);
    console.log(`[MappingService] 매핑 추가: ${voiceChannelId} -> ${postId}`);
    this.logCurrentMappings();
  }
  
  /**
   * 채널-포스트 매핑 제거
   * @param {string} voiceChannelId - 음성 채널 ID
   * @returns {boolean} - 제거 성공 여부
   */
  removeMapping(voiceChannelId) {
    const existed = this.channelPostMap.delete(voiceChannelId);
    if (existed) {
      // 참여자 수 기록도 함께 제거
      this.lastParticipantCounts.delete(voiceChannelId);
      console.log(`[MappingService] 매핑 제거: ${voiceChannelId}`);
      this.logCurrentMappings();
    }
    return existed;
  }
  
  /**
   * 음성 채널에 연결된 포스트 ID 가져오기
   * @param {string} voiceChannelId - 음성 채널 ID
   * @returns {string|null} - 포스트 ID 또는 null
   */
  getPostId(voiceChannelId) {
    return this.channelPostMap.get(voiceChannelId) || null;
  }
  
  /**
   * 포스트에 연결된 음성 채널 ID 가져오기
   * @param {string} postId - 포럼 포스트 ID
   * @returns {string|null} - 음성 채널 ID 또는 null
   */
  getVoiceChannelId(postId) {
    for (const [channelId, mappedPostId] of this.channelPostMap.entries()) {
      if (mappedPostId === postId) {
        return channelId;
      }
    }
    return null;
  }
  
  /**
   * 특정 음성 채널이 매핑되어 있는지 확인
   * @param {string} voiceChannelId - 음성 채널 ID
   * @returns {boolean} - 매핑 존재 여부
   */
  hasMapping(voiceChannelId) {
    return this.channelPostMap.has(voiceChannelId);
  }
  
  /**
   * 모든 매핑 가져오기
   * @returns {Map} - 전체 매핑 Map
   */
  getAllMappings() {
    return new Map(this.channelPostMap);
  }
  
  /**
   * 매핑 개수 가져오기
   * @returns {number} - 매핑 개수
   */
  getMappingCount() {
    return this.channelPostMap.size;
  }
  
  /**
   * 업데이트 큐에 추가
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {number} delay - 지연 시간 (밀리초)
   * @returns {void}
   */
  queueUpdate(voiceChannelId, delay = 2000) {
    // 기존 타이머가 있으면 제거
    if (this.updateQueue.has(voiceChannelId)) {
      clearTimeout(this.updateQueue.get(voiceChannelId));
    }
    
    // 새 타이머 설정
    const timer = setTimeout(async () => {
      await this.processQueuedUpdate(voiceChannelId);
      this.updateQueue.delete(voiceChannelId);
    }, delay);
    
    this.updateQueue.set(voiceChannelId, timer);
    console.log(`[MappingService] 업데이트 큐에 추가: ${voiceChannelId} (${delay}ms 후 실행)`);
  }
  
  /**
   * 큐된 업데이트 처리
   * @param {string} voiceChannelId - 음성 채널 ID
   * @returns {Promise<void>}
   */
  async processQueuedUpdate(voiceChannelId) {
    try {
      console.log(`[MappingService] 큐된 업데이트 처리 시작: ${voiceChannelId}`);
      
      const postId = this.getPostId(voiceChannelId);
      if (!postId) {
        console.log(`[MappingService] 매핑된 포스트가 없음: ${voiceChannelId}`);
        console.log(`[MappingService] 현재 매핑 상태:`, Array.from(this.channelPostMap.entries()));
        return;
      }
      
      console.log(`[MappingService] 매핑된 포스트 ID: ${postId}`);
      
      // 음성 채널 정보 가져오기
      const voiceChannelInfo = await this.voiceChannelManager.getVoiceChannelInfo(voiceChannelId);
      if (!voiceChannelInfo) {
        console.log(`[MappingService] 음성 채널을 찾을 수 없음: ${voiceChannelId}`);
        this.removeMapping(voiceChannelId);
        return;
      }
      
      console.log(`[MappingService] 음성 채널 정보:`, {
        name: voiceChannelInfo.name,
        memberCount: voiceChannelInfo.members?.size || 0,
        categoryId: voiceChannelInfo.parentId
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
        this.removeMapping(voiceChannelId);
        return;
      }
      
      console.log(`[MappingService] 포스트 정보:`, {
        name: postInfo.name,
        archived: postInfo.archived,
        messageCount: postInfo.messageCount
      });
      
      const maxCount = participantTracker.extractMaxParticipants(postInfo.name);
      console.log(`[MappingService] 최대 인원 수: ${maxCount}`);
      
      // 이전 참여자 수와 비교
      const lastCount = this.lastParticipantCounts.get(voiceChannelId);
      if (lastCount === currentCount) {
        console.log(`[MappingService] 참여자 수 변경 없음 (${currentCount}/${maxCount}), 메시지 전송 건너뛰기`);
        return;
      }
      
      // 참여자 수 업데이트 메시지 전송
      console.log(`[MappingService] 참여자 수 변경 감지: ${lastCount} -> ${currentCount}, 메시지 전송 시작...`);
      const updateResult = await this.forumPostManager.sendParticipantUpdateMessage(
        postId, 
        currentCount, 
        maxCount, 
        voiceChannelInfo.name
      );
      
      if (updateResult) {
        // 성공적으로 전송된 경우에만 마지막 참여자 수 저장
        this.lastParticipantCounts.set(voiceChannelId, currentCount);
        console.log(`[MappingService] 참여자 수 업데이트 완료: ${voiceChannelId} -> ${postId} (${currentCount}/${maxCount})`);
      } else {
        console.log(`[MappingService] 참여자 수 업데이트 실패: ${voiceChannelId} -> ${postId}`);
      }
      
    } catch (error) {
      console.error(`[MappingService] 큐된 업데이트 처리 오류: ${voiceChannelId}`, error);
    }
  }
  
  /**
   * 삭제된 채널들 정리
   * @returns {Promise<number>} - 정리된 매핑 개수
   */
  async cleanupDeletedChannels() {
    const channelIds = Array.from(this.channelPostMap.keys());
    const deletedChannels = await this.voiceChannelManager.getDeletedChannels(channelIds);
    
    let cleanedCount = 0;
    for (const deletedChannelId of deletedChannels) {
      const postId = this.getPostId(deletedChannelId);
      
      // 포럼 포스트 아카이브
      if (postId) {
        await this.forumPostManager.archivePost(postId, '음성 채널 삭제됨');
      }
      
      // 매핑 제거
      this.removeMapping(deletedChannelId);
      cleanedCount++;
    }
    
    if (cleanedCount > 0) {
      console.log(`[MappingService] 삭제된 채널 정리 완료: ${cleanedCount}개 매핑 제거`);
    }
    
    return cleanedCount;
  }
  
  /**
   * 삭제된 포스트들 정리
   * @returns {Promise<number>} - 정리된 매핑 개수
   */
  async cleanupDeletedPosts() {
    let cleanedCount = 0;
    
    for (const [channelId, postId] of this.channelPostMap.entries()) {
      const postExists = await this.forumPostManager.postExists(postId);
      
      if (!postExists) {
        this.removeMapping(channelId);
        cleanedCount++;
        console.log(`[MappingService] 삭제된 포스트로 인한 매핑 제거: ${channelId} -> ${postId}`);
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`[MappingService] 삭제된 포스트 정리 완료: ${cleanedCount}개 매핑 제거`);
    }
    
    return cleanedCount;
  }
  
  /**
   * 전체 정리 작업 수행
   * @returns {Promise<Object>} - 정리 결과
   */
  async performFullCleanup() {
    console.log(`[MappingService] 전체 정리 작업 시작 (현재 매핑: ${this.getMappingCount()}개)`);
    
    const deletedChannels = await this.cleanupDeletedChannels();
    const deletedPosts = await this.cleanupDeletedPosts();
    
    const result = {
      deletedChannels,
      deletedPosts,
      totalCleaned: deletedChannels + deletedPosts,
      remainingMappings: this.getMappingCount()
    };
    
    console.log(`[MappingService] 전체 정리 작업 완료:`, result);
    return result;
  }
  
  /**
   * 현재 매핑 상태 로깅
   * @returns {void}
   */
  logCurrentMappings() {
    if (this.channelPostMap.size > 0) {
      console.log(`[MappingService] 현재 매핑 상태 (${this.channelPostMap.size}개):`, 
        Array.from(this.channelPostMap.entries()));
    } else {
      console.log(`[MappingService] 현재 매핑된 채널 없음`);
    }
  }
  
  /**
   * 매핑 통계 가져오기
   * @returns {Object} - 매핑 통계
   */
  getMappingStats() {
    return {
      totalMappings: this.getMappingCount(),
      queuedUpdates: this.updateQueue.size,
      mappings: Array.from(this.channelPostMap.entries()).map(([channelId, postId]) => ({
        channelId,
        postId
      }))
    };
  }
  
  /**
   * 특정 매핑 상세 정보 가져오기
   * @param {string} voiceChannelId - 음성 채널 ID
   * @returns {Promise<Object|null>} - 매핑 상세 정보
   */
  async getMappingDetails(voiceChannelId) {
    const postId = this.getPostId(voiceChannelId);
    if (!postId) return null;
    
    try {
      const [voiceChannelInfo, postInfo] = await Promise.all([
        this.voiceChannelManager.getVoiceChannelInfo(voiceChannelId),
        this.forumPostManager.getPostInfo(postId)
      ]);
      
      return {
        voiceChannelId,
        postId,
        voiceChannel: voiceChannelInfo,
        post: postInfo,
        hasQueuedUpdate: this.updateQueue.has(voiceChannelId)
      };
      
    } catch (error) {
      console.error(`[MappingService] 매핑 상세 정보 가져오기 실패: ${voiceChannelId}`, error);
      return null;
    }
  }
}