// src/services/MappingService.js - 채널-포스트 매핑 관리
export class MappingService {
  constructor(client, voiceChannelManager, forumPostManager, databaseManager) {
    this.client = client;
    this.voiceChannelManager = voiceChannelManager;
    this.forumPostManager = forumPostManager;
    this.databaseManager = databaseManager;
    this.channelPostMap = new Map(); // 음성채널 ID -> 포럼 포스트 ID 매핑
    this.updateQueue = new Map(); // 업데이트 큐 (중복 방지)
    this.lastParticipantCounts = new Map(); // 음성채널 ID -> 마지막 전송된 참여자 수
  }
  
  /**
   * 채널-포스트 매핑 추가
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {string} postId - 포럼 포스트 ID
   * @returns {Promise<boolean>} - 추가 성공 여부
   */
  async addMapping(voiceChannelId, postId) {
    try {
      // 메모리에 추가
      this.channelPostMap.set(voiceChannelId, postId);
      
      // 데이터베이스에 저장
      if (this.databaseManager) {
        const saved = await this.databaseManager.saveChannelMapping(voiceChannelId, postId, 0);
        if (!saved) {
          console.error(`[MappingService] 데이터베이스 저장 실패: ${voiceChannelId} -> ${postId}`);
          // 메모리에서도 제거
          this.channelPostMap.delete(voiceChannelId);
          return false;
        }
      }
      
      console.log(`[MappingService] 매핑 추가: ${voiceChannelId} -> ${postId}`);
      this.logCurrentMappings();
      return true;
    } catch (error) {
      console.error(`[MappingService] 매핑 추가 오류: ${voiceChannelId} -> ${postId}`, error);
      return false;
    }
  }
  
  /**
   * 채널-포스트 매핑 제거
   * @param {string} voiceChannelId - 음성 채널 ID
   * @returns {Promise<boolean>} - 제거 성공 여부
   */
  async removeMapping(voiceChannelId) {
    try {
      const existed = this.channelPostMap.delete(voiceChannelId);
      
      if (existed) {
        // 참여자 수 기록도 함께 제거
        this.lastParticipantCounts.delete(voiceChannelId);
        
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
        
        // 데이터베이스에도 참여자 수 업데이트
        if (this.databaseManager) {
          const dbUpdated = await this.databaseManager.updateLastParticipantCount(voiceChannelId, currentCount);
          if (!dbUpdated) {
            console.warn(`[MappingService] 데이터베이스 참여자 수 업데이트 실패: ${voiceChannelId}`);
          }
        }
        
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
      await this.removeMapping(deletedChannelId);
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
        await this.removeMapping(channelId);
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
    const currentMappings = this.getMappingCount();
    
    // 매핑이 없으면 정리 작업 스킵
    if (currentMappings === 0) {
      console.log(`[MappingService] 매핑이 없어 정리 작업을 스킵합니다.`);
      return {
        deletedChannels: 0,
        deletedPosts: 0,
        totalCleaned: 0,
        remainingMappings: 0,
        skipped: true
      };
    }
    
    console.log(`[MappingService] 전체 정리 작업 시작 (현재 매핑: ${currentMappings}개)`);
    
    const deletedChannels = await this.cleanupDeletedChannels();
    const deletedPosts = await this.cleanupDeletedPosts();
    
    const result = {
      deletedChannels,
      deletedPosts,
      totalCleaned: deletedChannels + deletedPosts,
      remainingMappings: this.getMappingCount()
    };
    
    // console.log(`[MappingService] 전체 정리 작업 완료:`, result);
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

  // ======== 데이터베이스 지속성 관련 메서드 ========

  /**
   * Discord 클라이언트 준비 상태 확인
   * @returns {boolean} - 클라이언트가 준비되었는지 여부
   */
  isClientReady() {
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
   * @returns {Promise<Object>} - 로드 결과 { success: boolean, loaded: number, validated: number, removed: number }
   */
  async loadMappingsFromDatabase() {
    if (!this.databaseManager) {
      console.warn('[MappingService] DatabaseManager가 없어 매핑 로드를 건너뜁니다.');
      return { success: false, loaded: 0, validated: 0, removed: 0 };
    }

    // Discord 클라이언트 준비 상태 확인
    if (!this.isClientReady()) {
      console.warn('[MappingService] Discord 클라이언트가 준비되지 않아 매핑 로드를 연기합니다.');
      return { success: false, loaded: 0, validated: 0, removed: 0, error: '클라이언트 준비되지 않음' };
    }

    try {
      console.log('[MappingService] 데이터베이스에서 매핑 로드 시작...');
      
      const savedMappings = await this.databaseManager.getAllChannelMappings();
      
      if (!Array.isArray(savedMappings)) {
        console.warn('[MappingService] 데이터베이스에서 유효하지 않은 매핑 데이터를 받았습니다.');
        return { success: false, loaded: 0, validated: 0, removed: 0, error: '유효하지 않은 데이터 형식' };
      }
      
      let loadedCount = 0;
      let validatedCount = 0;
      let removedCount = 0;

      for (const mapping of savedMappings) {
        const { voice_channel_id, forum_post_id, last_participant_count } = mapping;
        
        // 필수 필드 검증
        if (!voice_channel_id || !forum_post_id) {
          console.warn(`[MappingService] 유효하지 않은 매핑 데이터 건너뛰기:`, mapping);
          continue;
        }
        
        try {
          // 음성 채널과 포럼 포스트가 여전히 존재하는지 확인
          let voiceChannelInfo = null;
          let postInfo = null;
          let channelCheckFailed = false;
          let postCheckFailed = false;

          // 개별적으로 API 호출하여 세밀한 오류 처리
          try {
            voiceChannelInfo = await this.voiceChannelManager.getVoiceChannelInfo(voice_channel_id);
          } catch (channelError) {
            channelCheckFailed = true;
            console.warn(`[MappingService] 채널 정보 확인 실패: ${voice_channel_id}`, channelError.message);
            
            // 토큰 관련 오류인 경우 더 이상 진행하지 않음
            if (channelError.message?.includes('token') || channelError.message?.includes('Token')) {
              console.error('[MappingService] 토큰 오류로 인해 매핑 로드를 중단합니다.');
              throw new Error('Discord API 토큰 오류');
            }
          }

          try {
            postInfo = await this.forumPostManager.getPostInfo(forum_post_id);
          } catch (postError) {
            postCheckFailed = true;
            console.warn(`[MappingService] 포스트 정보 확인 실패: ${forum_post_id}`, postError.message);
            
            // 토큰 관련 오류인 경우 더 이상 진행하지 않음
            if (postError.message?.includes('token') || postError.message?.includes('Token')) {
              console.error('[MappingService] 토큰 오류로 인해 매핑 로드를 중단합니다.');
              throw new Error('Discord API 토큰 오류');
            }
          }

          // 매핑 유효성 판단
          const isValidMapping = voiceChannelInfo && postInfo && !postInfo.archived && !channelCheckFailed && !postCheckFailed;

          if (isValidMapping) {
            // 유효한 매핑인 경우 메모리에 로드
            this.channelPostMap.set(voice_channel_id, forum_post_id);
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
              console.log(`[MappingService] 유효하지 않은 매핑 제거: ${voice_channel_id} -> ${forum_post_id} (채널체크실패: ${channelCheckFailed}, 포스트체크실패: ${postCheckFailed}, 채널존재: ${!!voiceChannelInfo}, 포스트존재: ${!!postInfo}, 아카이브됨: ${postInfo?.archived})`);
            } catch (removeError) {
              console.error(`[MappingService] 매핑 제거 실패: ${voice_channel_id}`, removeError);
            }
          }
          
          loadedCount++;
        } catch (error) {
          // 전체 매핑 로드 프로세스를 중단해야 하는 심각한 오류
          if (error.message === 'Discord API 토큰 오류') {
            throw error; // 상위로 전파
          }
          
          console.error(`[MappingService] 매핑 검증 중 예상치 못한 오류: ${voice_channel_id} -> ${forum_post_id}`, error);
          
          // 일반적인 오류의 경우 해당 매핑만 제거하고 계속 진행
          try {
            await this.databaseManager.removeChannelMapping(voice_channel_id);
            removedCount++;
          } catch (removeError) {
            console.error(`[MappingService] 오류 발생 매핑 제거 실패: ${voice_channel_id}`, removeError);
          }
        }
      }

      const result = {
        success: true,
        loaded: loadedCount,
        validated: validatedCount,
        removed: removedCount
      };

      console.log(`[MappingService] 매핑 로드 완료:`, result);
      this.logCurrentMappings();
      
      return result;
    } catch (error) {
      console.error('[MappingService] 매핑 로드 오류:', error);
      return { success: false, loaded: 0, validated: 0, removed: 0, error: error.message };
    }
  }

  /**
   * 데이터베이스와 메모리 매핑 동기화
   * @returns {Promise<boolean>} - 동기화 성공 여부
   */
  async syncWithDatabase() {
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
   * 초기화 메서드 (서비스 시작 시 호출)
   * @returns {Promise<boolean>} - 초기화 성공 여부
   */
  async initialize() {
    try {
      console.log('[MappingService] 서비스 초기화 시작...');
      
      // 데이터베이스에서 기존 매핑 로드
      const loadResult = await this.loadMappingsFromDatabase();
      
      if (loadResult.success) {
        console.log(`[MappingService] 초기화 완료: ${loadResult.validated}개 매핑 복구, ${loadResult.removed}개 매핑 정리`);
        return true;
      } else {
        console.error('[MappingService] 초기화 실패');
        return false;
      }
    } catch (error) {
      console.error('[MappingService] 초기화 오류:', error);
      return false;
    }
  }
}