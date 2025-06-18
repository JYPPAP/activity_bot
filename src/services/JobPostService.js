// src/services/JobPostService.js - 구인구직 카드 관리 서비스
import { JobPostCache } from './jobPostCacheService.js';

export class JobPostService {
  constructor(dbManager) {
    this.dbManager = dbManager;
    this.cache = new JobPostCache();
    
    // 페이징 설정
    this.defaultPageSize = 25;
    this.maxPageSize = 100;
  }

  /**
   * 구인구직 카드 초기화 (데이터베이스 스키마 설정)
   */
  async initialize() {
    try {
      this.dbManager.forceReload();
      
      // job_posts 테이블이 없으면 생성
      if (!this.dbManager.db.has('job_posts').value()) {
        this.dbManager.db.set('job_posts', {}).write();
      }
      
      console.log('[JobPostService] 구인구직 서비스 초기화 완료');
      return true;
    } catch (error) {
      console.error('[JobPostService] 초기화 오류:', error);
      return false;
    }
  }

  /**
   * 구인구직 카드 생성
   * @param {Object} jobPostData - 구인구직 데이터
   * @param {string} jobPostData.title - 제목
   * @param {number} jobPostData.memberCount - 인원수
   * @param {string} jobPostData.startTime - 시작시간
   * @param {string} jobPostData.description - 설명
   * @param {string} jobPostData.roleTags - 역할태그
   * @param {string} jobPostData.channelId - 음성채널 ID (선택)
   * @param {string} jobPostData.authorId - 작성자 ID
   * @param {number} jobPostData.expiresAt - 만료시간 (선택)
   * @returns {Object} 생성된 구인구직 카드 정보
   */
  async createJobPost(jobPostData) {
    try {
      this.dbManager.forceReload();
      
      const jobId = `job_${Date.now()}_${jobPostData.authorId.slice(0, 6)}`;
      const now = Date.now();
      
      // 기본 만료시간: 24시간 후
      const defaultExpiresAt = now + (24 * 60 * 60 * 1000);
      
      const jobPost = {
        id: jobId,
        title: jobPostData.title,
        memberCount: jobPostData.memberCount,
        startTime: jobPostData.startTime,
        description: jobPostData.description || '',
        roleTags: jobPostData.roleTags || '',
        channelId: jobPostData.channelId || null,
        authorId: jobPostData.authorId,
        createdAt: now,
        expiresAt: jobPostData.expiresAt || defaultExpiresAt
      };
      
      // 데이터베이스에 저장
      this.dbManager.db.get('job_posts')
        .set(jobId, jobPost)
        .write();
      
      console.log(`[JobPostService] 구인구직 카드 생성: ${jobId}, 제목: ${jobPost.title}`);
      return jobPost;
    } catch (error) {
      console.error('[JobPostService] 구인구직 카드 생성 오류:', error);
      throw error;
    }
  }

  /**
   * 구인구직 카드 조회 (ID로)
   * @param {string} jobId - 구인구직 카드 ID
   * @returns {Object|null} 구인구직 카드 정보
   */
  async getJobPost(jobId) {
    try {
      // 캐시에서 먼저 확인
      let jobPost = this.cache.getJobPost(jobId);
      if (jobPost) {
        return jobPost;
      }
      
      // 캐시에 없으면 DB에서 조회
      this.dbManager.forceReload();
      jobPost = this.dbManager.db.get('job_posts').get(jobId).value();
      
      // 캐시에 저장 (3분 TTL)
      if (jobPost) {
        this.cache.setJobPost(jobId, jobPost, 3 * 60 * 1000);
      }
      
      return jobPost;
    } catch (error) {
      console.error('[JobPostService] 구인구직 카드 조회 오류:', error);
      return null;
    }
  }

  /**
   * 모든 구인구직 카드 조회
   * @param {boolean} includeExpired - 만료된 카드 포함 여부
   * @param {Object} options - 추가 옵션
   * @param {number} options.page - 페이지 번호 (1부터 시작)
   * @param {number} options.limit - 페이지당 항목 수
   * @param {string} options.sortBy - 정렬 기준 (createdAt, expiresAt, title)
   * @param {string} options.sortOrder - 정렬 순서 (asc, desc)
   * @returns {Object} { data: Array, pagination: Object }
   */
  async getAllJobPosts(includeExpired = false, options = {}) {
    try {
      const {
        page = 1,
        limit = this.defaultPageSize,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = options;
      
      // 캐시 키 생성
      const cacheKey = `all_${includeExpired}_${page}_${limit}_${sortBy}_${sortOrder}`;
      let cachedResult = this.cache.getJobPostList('all', { includeExpired, page, limit, sortBy, sortOrder });
      
      if (cachedResult) {
        return cachedResult;
      }
      
      // DB에서 조회
      this.dbManager.forceReload();
      const jobPosts = this.dbManager.db.get('job_posts').value();
      const now = Date.now();
      
      let jobPostList = Object.values(jobPosts);
      
      // 만료 필터링
      if (!includeExpired) {
        jobPostList = jobPostList.filter(job => job.expiresAt > now);
      }
      
      // 정렬
      jobPostList.sort((a, b) => {
        let aVal = a[sortBy];
        let bVal = b[sortBy];
        
        if (typeof aVal === 'string') {
          aVal = aVal.toLowerCase();
          bVal = bVal.toLowerCase();
        }
        
        if (sortOrder === 'asc') {
          return aVal > bVal ? 1 : -1;
        } else {
          return aVal < bVal ? 1 : -1;
        }
      });
      
      // 페이징
      const totalItems = jobPostList.length;
      const totalPages = Math.ceil(totalItems / limit);
      const offset = (page - 1) * limit;
      const paginatedData = jobPostList.slice(offset, offset + limit);
      
      const result = {
        data: paginatedData,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems,
          itemsPerPage: limit,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1
        }
      };
      
      // 캐시에 저장 (2분 TTL)
      this.cache.setJobPostList('all', { includeExpired, page, limit, sortBy, sortOrder }, result, 2 * 60 * 1000);
      
      return result;
    } catch (error) {
      console.error('[JobPostService] 구인구직 카드 목록 조회 오류:', error);
      return { data: [], pagination: { currentPage: 1, totalPages: 0, totalItems: 0, itemsPerPage: limit, hasNextPage: false, hasPreviousPage: false } };
    }
  }

  /**
   * 채널 ID로 구인구직 카드 검색
   * @param {string} channelId - 음성채널 ID
   * @returns {Object|null} 연동된 구인구직 카드
   */
  async getJobPostByChannelId(channelId) {
    try {
      this.dbManager.forceReload();
      const jobPosts = this.dbManager.db.get('job_posts').value();
      
      const jobPost = Object.values(jobPosts).find(job => job.channelId === channelId);
      
      // 만료된 카드는 null 반환
      if (jobPost && jobPost.expiresAt <= Date.now()) {
        return null;
      }
      
      return jobPost || null;
    } catch (error) {
      console.error('[JobPostService] 채널별 구인구직 카드 조회 오류:', error);
      return null;
    }
  }

  /**
   * 구인구직 카드 업데이트
   * @param {string} jobId - 구인구직 카드 ID
   * @param {Object} updateData - 업데이트할 데이터
   * @returns {Object|null} 업데이트된 구인구직 카드
   */
  async updateJobPost(jobId, updateData) {
    try {
      this.dbManager.forceReload();
      
      const existingJob = this.dbManager.db.get('job_posts').get(jobId).value();
      if (!existingJob) {
        console.log(`[JobPostService] 존재하지 않는 구인구직 카드: ${jobId}`);
        return null;
      }
      
      // 업데이트할 수 있는 필드만 허용
      const allowedFields = ['title', 'memberCount', 'startTime', 'description', 'roleTags', 'channelId', 'expiresAt'];
      const filteredUpdate = {};
      
      for (const field of allowedFields) {
        if (updateData.hasOwnProperty(field)) {
          filteredUpdate[field] = updateData[field];
        }
      }
      
      const updatedJob = {
        ...existingJob,
        ...filteredUpdate
      };
      
      this.dbManager.db.get('job_posts')
        .set(jobId, updatedJob)
        .write();
      
      // 캐시 무효화
      this.cache.invalidateAllRelated(updatedJob);
      
      console.log(`[JobPostService] 구인구직 카드 업데이트: ${jobId}`);
      return updatedJob;
    } catch (error) {
      console.error('[JobPostService] 구인구직 카드 업데이트 오류:', error);
      return null;
    }
  }

  /**
   * 구인구직 카드 삭제
   * @param {string} jobId - 구인구직 카드 ID
   * @returns {boolean} 삭제 성공 여부
   */
  async deleteJobPost(jobId) {
    try {
      this.dbManager.forceReload();
      
      const existingJob = this.dbManager.db.get('job_posts').get(jobId).value();
      if (!existingJob) {
        return false;
      }
      
      // 캐시 무효화 (삭제 전에 수행)
      this.cache.invalidateAllRelated(existingJob);
      
      this.dbManager.db.get('job_posts').unset(jobId).write();
      
      console.log(`[JobPostService] 구인구직 카드 삭제: ${jobId}`);
      return true;
    } catch (error) {
      console.error('[JobPostService] 구인구직 카드 삭제 오류:', error);
      return false;
    }
  }

  /**
   * 채널 연동 설정 (채널 ID 업데이트)
   * @param {string} jobId - 구인구직 카드 ID
   * @param {string} channelId - 음성채널 ID
   * @returns {Object|null} 업데이트된 구인구직 카드
   */
  async linkJobPostToChannel(jobId, channelId) {
    try {
      // 해당 채널에 이미 연동된 카드가 있는지 확인
      const existingJob = await this.getJobPostByChannelId(channelId);
      if (existingJob && existingJob.id !== jobId) {
        throw new Error(`채널 ${channelId}에 이미 연동된 구인구직 카드가 있습니다: ${existingJob.id}`);
      }
      
      return await this.updateJobPost(jobId, { channelId });
    } catch (error) {
      console.error('[JobPostService] 채널 연동 오류:', error);
      throw error;
    }
  }

  /**
   * 채널 연동 해제
   * @param {string} channelId - 음성채널 ID
   * @returns {boolean} 해제 성공 여부
   */
  async unlinkJobPostFromChannel(channelId) {
    try {
      const jobPost = await this.getJobPostByChannelId(channelId);
      if (!jobPost) {
        return false;
      }
      
      await this.updateJobPost(jobPost.id, { channelId: null });
      return true;
    } catch (error) {
      console.error('[JobPostService] 채널 연동 해제 오류:', error);
      return false;
    }
  }

  /**
   * 만료된 구인구직 카드 정리
   * @returns {Array} 삭제된 카드 ID 목록
   */
  async cleanupExpiredJobPosts() {
    try {
      this.dbManager.forceReload();
      
      const jobPosts = this.dbManager.db.get('job_posts').value();
      const now = Date.now();
      const deletedJobs = [];
      
      for (const [jobId, jobPost] of Object.entries(jobPosts)) {
        if (jobPost.expiresAt <= now) {
          this.dbManager.db.get('job_posts').unset(jobId).write();
          deletedJobs.push(jobId);
          console.log(`[JobPostService] 만료된 구인구직 카드 삭제: ${jobId}`);
        }
      }
      
      if (deletedJobs.length > 0) {
        console.log(`[JobPostService] 만료된 구인구직 카드 ${deletedJobs.length}개 정리 완료`);
      }
      
      return deletedJobs;
    } catch (error) {
      console.error('[JobPostService] 만료된 구인구직 카드 정리 오류:', error);
      return [];
    }
  }

  /**
   * 특정 사용자의 구인구직 카드 조회
   * @param {string} authorId - 작성자 ID
   * @param {boolean} includeExpired - 만료된 카드 포함 여부
   * @returns {Array} 사용자의 구인구직 카드 목록
   */
  async getJobPostsByAuthor(authorId, includeExpired = false) {
    try {
      const allJobs = await this.getAllJobPosts(includeExpired);
      return allJobs.filter(job => job.authorId === authorId);
    } catch (error) {
      console.error('[JobPostService] 사용자별 구인구직 카드 조회 오류:', error);
      return [];
    }
  }

  /**
   * 역할 태그로 구인구직 카드 검색
   * @param {string} roleTag - 역할 태그
   * @param {boolean} includeExpired - 만료된 카드 포함 여부
   * @returns {Array} 해당 태그를 가진 구인구직 카드 목록
   */
  async getJobPostsByRoleTag(roleTag, includeExpired = false) {
    try {
      const allJobs = await this.getAllJobPosts(includeExpired);
      return allJobs.filter(job => 
        job.roleTags && job.roleTags.toLowerCase().includes(roleTag.toLowerCase())
      );
    } catch (error) {
      console.error('[JobPostService] 태그별 구인구직 카드 조회 오류:', error);
      return [];
    }
  }

  /**
   * 채널이 삭제될 때 연동된 구인구직 카드 자동 삭제
   * @param {string} channelId - 삭제된 음성채널 ID
   * @returns {boolean} 삭제 성공 여부
   */
  async handleChannelDeletion(channelId) {
    try {
      const jobPost = await this.getJobPostByChannelId(channelId);
      if (jobPost) {
        await this.deleteJobPost(jobPost.id);
        console.log(`[JobPostService] 채널 삭제로 인한 구인구직 카드 자동 삭제: ${jobPost.id}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[JobPostService] 채널 삭제 처리 오류:', error);
      return false;
    }
  }
}