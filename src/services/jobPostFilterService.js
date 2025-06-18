// src/services/jobPostFilterService.js - 구인구직 카드 필터링 및 검색 서비스
import { JobPostService } from './JobPostService.js';

export class JobPostFilterService {
  constructor(dbManager) {
    this.dbManager = dbManager;
    this.jobPostService = new JobPostService(dbManager);
  }

  /**
   * 서비스 초기화
   */
  async initialize() {
    await this.jobPostService.initialize();
    console.log('[JobPostFilterService] 구인구직 필터링 서비스 초기화 완료');
  }

  /**
   * 역할 태그로 구인구직 카드 필터링
   * @param {string|Array} tags - 태그 문자열 또는 태그 배열
   * @param {Object} options - 필터링 옵션
   * @param {boolean} options.exactMatch - 정확히 일치하는 태그만 검색
   * @param {boolean} options.includeExpired - 만료된 카드 포함
   * @param {string} options.matchMode - 매칭 모드 ('any', 'all')
   * @param {number} options.page - 페이지 번호
   * @param {number} options.limit - 페이지당 항목 수
   * @returns {Object} { data: Array, pagination: Object, appliedFilters: Object }
   */
  async filterByRoleTags(tags, options = {}) {
    const {
      exactMatch = false,
      includeExpired = false,
      matchMode = 'any', // 'any': 하나라도 일치, 'all': 모두 일치
      page = 1,
      limit = 25
    } = options;

    try {
      // 태그 정규화
      const normalizedTags = this.normalizeTags(tags);
      if (normalizedTags.length === 0) {
        return this.createEmptyResult(page, limit, { tags: [], matchMode, exactMatch });
      }

      // 전체 카드 조회
      const allJobsResult = await this.jobPostService.getAllJobPosts(includeExpired, { limit: 1000 });
      let filteredJobs = allJobsResult.data;

      // 태그 필터링
      filteredJobs = filteredJobs.filter(job => {
        if (!job.roleTags || job.roleTags.trim() === '') {
          return false;
        }

        const jobTags = this.normalizeTags(job.roleTags);
        return this.matchTags(jobTags, normalizedTags, matchMode, exactMatch);
      });

      // 페이징 적용
      const totalItems = filteredJobs.length;
      const totalPages = Math.ceil(totalItems / limit);
      const offset = (page - 1) * limit;
      const paginatedData = filteredJobs.slice(offset, offset + limit);

      return {
        data: paginatedData,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems,
          itemsPerPage: limit,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1
        },
        appliedFilters: {
          tags: normalizedTags,
          matchMode,
          exactMatch,
          includeExpired
        }
      };

    } catch (error) {
      console.error('[JobPostFilterService] 태그 필터링 오류:', error);
      return this.createEmptyResult(page, limit, { tags: normalizedTags || [], matchMode, exactMatch });
    }
  }

  /**
   * 복합 필터링 (제목, 설명, 태그, 작성자 등)
   * @param {Object} filters - 필터 조건
   * @param {string} filters.keyword - 키워드 (제목, 설명에서 검색)
   * @param {string|Array} filters.tags - 역할 태그
   * @param {string} filters.authorId - 작성자 ID
   * @param {string} filters.channelId - 채널 ID
   * @param {number} filters.minMemberCount - 최소 인원수
   * @param {number} filters.maxMemberCount - 최대 인원수
   * @param {number} filters.createdAfter - 생성일 이후 (타임스탬프)
   * @param {number} filters.createdBefore - 생성일 이전 (타임스탬프)
   * @param {Object} options - 추가 옵션
   * @returns {Object} 필터링 결과
   */
  async filterJobPosts(filters = {}, options = {}) {
    const {
      keyword,
      tags,
      authorId,
      channelId,
      minMemberCount,
      maxMemberCount,
      createdAfter,
      createdBefore
    } = filters;

    const {
      includeExpired = false,
      page = 1,
      limit = 25,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = options;

    try {
      // 전체 카드 조회
      const allJobsResult = await this.jobPostService.getAllJobPosts(includeExpired, { limit: 1000 });
      let filteredJobs = allJobsResult.data;

      // 키워드 필터링 (제목, 설명)
      if (keyword && keyword.trim()) {
        const keywordLower = keyword.trim().toLowerCase();
        filteredJobs = filteredJobs.filter(job => {
          const titleMatch = job.title.toLowerCase().includes(keywordLower);
          const descMatch = job.description && job.description.toLowerCase().includes(keywordLower);
          return titleMatch || descMatch;
        });
      }

      // 태그 필터링
      if (tags) {
        const normalizedTags = this.normalizeTags(tags);
        if (normalizedTags.length > 0) {
          filteredJobs = filteredJobs.filter(job => {
            if (!job.roleTags || job.roleTags.trim() === '') {
              return false;
            }
            const jobTags = this.normalizeTags(job.roleTags);
            return this.matchTags(jobTags, normalizedTags, 'any', false);
          });
        }
      }

      // 작성자 필터링
      if (authorId) {
        filteredJobs = filteredJobs.filter(job => job.authorId === authorId);
      }

      // 채널 필터링
      if (channelId) {
        filteredJobs = filteredJobs.filter(job => job.channelId === channelId);
      }

      // 인원수 필터링
      if (minMemberCount !== undefined) {
        filteredJobs = filteredJobs.filter(job => job.memberCount >= minMemberCount);
      }
      if (maxMemberCount !== undefined) {
        filteredJobs = filteredJobs.filter(job => job.memberCount <= maxMemberCount);
      }

      // 생성일 필터링
      if (createdAfter) {
        filteredJobs = filteredJobs.filter(job => job.createdAt >= createdAfter);
      }
      if (createdBefore) {
        filteredJobs = filteredJobs.filter(job => job.createdAt <= createdBefore);
      }

      // 정렬
      filteredJobs.sort((a, b) => {
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

      // 페이징 적용
      const totalItems = filteredJobs.length;
      const totalPages = Math.ceil(totalItems / limit);
      const offset = (page - 1) * limit;
      const paginatedData = filteredJobs.slice(offset, offset + limit);

      return {
        data: paginatedData,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems,
          itemsPerPage: limit,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1
        },
        appliedFilters: filters,
        options
      };

    } catch (error) {
      console.error('[JobPostFilterService] 복합 필터링 오류:', error);
      return this.createEmptyResult(page, limit, filters);
    }
  }

  /**
   * 인기 태그 조회 (가장 많이 사용된 태그)
   * @param {number} limit - 반환할 태그 수
   * @param {boolean} includeExpired - 만료된 카드 포함
   * @returns {Array} 인기 태그 목록 { tag: string, count: number }
   */
  async getPopularTags(limit = 10, includeExpired = false) {
    try {
      const allJobsResult = await this.jobPostService.getAllJobPosts(includeExpired, { limit: 1000 });
      const tagCounts = new Map();

      // 모든 카드의 태그 수집
      allJobsResult.data.forEach(job => {
        if (job.roleTags && job.roleTags.trim()) {
          const tags = this.normalizeTags(job.roleTags);
          tags.forEach(tag => {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
          });
        }
      });

      // 빈도순으로 정렬
      const sortedTags = Array.from(tagCounts.entries())
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);

      return sortedTags;

    } catch (error) {
      console.error('[JobPostFilterService] 인기 태그 조회 오류:', error);
      return [];
    }
  }

  /**
   * 태그 자동완성 제안
   * @param {string} partial - 부분 태그 문자열
   * @param {number} limit - 반환할 제안 수
   * @returns {Array} 제안 태그 목록
   */
  async suggestTags(partial, limit = 5) {
    try {
      if (!partial || partial.trim().length < 1) {
        return [];
      }

      const partialLower = partial.trim().toLowerCase();
      const allJobsResult = await this.jobPostService.getAllJobPosts(false, { limit: 1000 });
      const tagSet = new Set();

      // 모든 카드의 태그 수집
      allJobsResult.data.forEach(job => {
        if (job.roleTags && job.roleTags.trim()) {
          const tags = this.normalizeTags(job.roleTags);
          tags.forEach(tag => tagSet.add(tag));
        }
      });

      // 부분 문자열과 일치하는 태그 필터링
      const suggestions = Array.from(tagSet)
        .filter(tag => tag.includes(partialLower))
        .sort((a, b) => {
          // 시작하는 태그를 우선순위로
          const aStartsWith = a.startsWith(partialLower);
          const bStartsWith = b.startsWith(partialLower);
          
          if (aStartsWith && !bStartsWith) return -1;
          if (!aStartsWith && bStartsWith) return 1;
          
          // 길이가 짧은 것을 우선순위로
          return a.length - b.length;
        })
        .slice(0, limit);

      return suggestions;

    } catch (error) {
      console.error('[JobPostFilterService] 태그 제안 오류:', error);
      return [];
    }
  }

  /**
   * 사용자별 권한 기반 필터링
   * @param {string} userId - 사용자 ID
   * @param {Array} userRoles - 사용자 역할 목록
   * @param {Object} options - 필터링 옵션
   * @returns {Object} 필터링 결과
   */
  async filterByUserPermissions(userId, userRoles = [], options = {}) {
    try {
      // 기본적으로 모든 카드 조회
      let filters = {};

      // 특정 역할에만 접근 가능한 카드가 있다면 여기서 필터링
      // 예: VIP 역할만 볼 수 있는 카드, 특정 게임 역할 등

      // 사용자가 관리자가 아니라면 본인 카드만 수정/삭제 가능
      const isAdmin = userRoles.some(role => 
        role.name.includes('관리') || role.name.includes('Admin') || role.permissions.has('Administrator')
      );

      if (!isAdmin && options.onlyEditable) {
        filters.authorId = userId;
      }

      return await this.filterJobPosts(filters, options);

    } catch (error) {
      console.error('[JobPostFilterService] 권한 기반 필터링 오류:', error);
      return this.createEmptyResult(options.page || 1, options.limit || 25, {});
    }
  }

  /**
   * 태그 정규화 (공백 제거, 소문자 변환, 중복 제거)
   * @param {string|Array} tags - 태그 문자열 또는 배열
   * @returns {Array} 정규화된 태그 배열
   */
  normalizeTags(tags) {
    if (!tags) return [];
    
    let tagArray;
    if (typeof tags === 'string') {
      // 콤마, 공백, 세미콜론으로 분리
      tagArray = tags.split(/[,;\s]+/);
    } else if (Array.isArray(tags)) {
      tagArray = tags;
    } else {
      return [];
    }

    return tagArray
      .map(tag => tag.trim().toLowerCase())
      .filter(tag => tag.length > 0)
      .filter((tag, index, arr) => arr.indexOf(tag) === index); // 중복 제거
  }

  /**
   * 태그 매칭 로직
   * @param {Array} jobTags - 카드의 태그 배열
   * @param {Array} searchTags - 검색할 태그 배열
   * @param {string} matchMode - 매칭 모드 ('any', 'all')
   * @param {boolean} exactMatch - 정확히 일치 여부
   * @returns {boolean} 매칭 결과
   */
  matchTags(jobTags, searchTags, matchMode = 'any', exactMatch = false) {
    if (searchTags.length === 0) return true;
    if (jobTags.length === 0) return false;

    if (matchMode === 'all') {
      // 모든 검색 태그가 카드에 있어야 함
      return searchTags.every(searchTag => {
        return jobTags.some(jobTag => {
          return exactMatch ? jobTag === searchTag : jobTag.includes(searchTag);
        });
      });
    } else {
      // 하나의 검색 태그라도 카드에 있으면 됨
      return searchTags.some(searchTag => {
        return jobTags.some(jobTag => {
          return exactMatch ? jobTag === searchTag : jobTag.includes(searchTag);
        });
      });
    }
  }

  /**
   * 빈 결과 객체 생성
   * @param {number} page - 페이지 번호
   * @param {number} limit - 페이지당 항목 수
   * @param {Object} filters - 적용된 필터
   * @returns {Object} 빈 결과 객체
   */
  createEmptyResult(page, limit, filters) {
    return {
      data: [],
      pagination: {
        currentPage: page,
        totalPages: 0,
        totalItems: 0,
        itemsPerPage: limit,
        hasNextPage: false,
        hasPreviousPage: false
      },
      appliedFilters: filters
    };
  }

  /**
   * 검색 통계 조회
   * @returns {Object} 검색 통계
   */
  async getSearchStats() {
    try {
      const allJobsResult = await this.jobPostService.getAllJobPosts(false, { limit: 1000 });
      const now = Date.now();
      
      // 기본 통계
      const stats = {
        totalJobs: allJobsResult.pagination.totalItems,
        activeJobs: allJobsResult.data.filter(job => job.expiresAt > now).length,
        expiredJobs: allJobsResult.data.filter(job => job.expiresAt <= now).length,
        linkedJobs: allJobsResult.data.filter(job => job.channelId).length,
        unlinkedJobs: allJobsResult.data.filter(job => !job.channelId).length,
        
        // 태그 통계
        totalUniqueTags: 0,
        averageTagsPerJob: 0,
        
        // 인원수 통계
        averageMemberCount: 0,
        mostCommonMemberCount: 0,
        
        // 시간 통계
        averageJobAge: 0,
        oldestJob: null,
        newestJob: null
      };

      // 태그 통계 계산
      const allTags = new Set();
      let totalTagCount = 0;
      
      allJobsResult.data.forEach(job => {
        if (job.roleTags && job.roleTags.trim()) {
          const tags = this.normalizeTags(job.roleTags);
          tags.forEach(tag => allTags.add(tag));
          totalTagCount += tags.length;
        }
      });

      stats.totalUniqueTags = allTags.size;
      stats.averageTagsPerJob = allJobsResult.data.length > 0 ? 
        Math.round((totalTagCount / allJobsResult.data.length) * 100) / 100 : 0;

      // 인원수 통계 계산
      if (allJobsResult.data.length > 0) {
        const memberCounts = allJobsResult.data.map(job => job.memberCount);
        const memberCountMap = new Map();
        
        memberCounts.forEach(count => {
          memberCountMap.set(count, (memberCountMap.get(count) || 0) + 1);
        });

        stats.averageMemberCount = Math.round(
          (memberCounts.reduce((sum, count) => sum + count, 0) / memberCounts.length) * 100
        ) / 100;

        stats.mostCommonMemberCount = Array.from(memberCountMap.entries())
          .sort((a, b) => b[1] - a[1])[0]?.[0] || 0;

        // 시간 통계 계산
        const ages = allJobsResult.data.map(job => now - job.createdAt);
        stats.averageJobAge = Math.round(
          (ages.reduce((sum, age) => sum + age, 0) / ages.length) / (1000 * 60 * 60)
        ); // 시간 단위

        const sortedByAge = allJobsResult.data.sort((a, b) => a.createdAt - b.createdAt);
        stats.oldestJob = sortedByAge[0];
        stats.newestJob = sortedByAge[sortedByAge.length - 1];
      }

      return stats;

    } catch (error) {
      console.error('[JobPostFilterService] 검색 통계 조회 오류:', error);
      return {};
    }
  }
}