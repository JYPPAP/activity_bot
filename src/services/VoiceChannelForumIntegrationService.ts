// src/services/VoiceChannelForumIntegrationService.ts - 음성채널-포럼 통합 서비스
import {
  Client,
  Channel,
  VoiceState,
  GuildMember,
  Interaction,
  ButtonInteraction,
  User,
  MessageFlags,
} from 'discord.js';

import { config } from '../config/env.js';
import { ButtonHandler } from '../ui/ButtonHandler.js';
import { InteractionRouter } from '../ui/InteractionRouter.js';
import { ModalHandler } from '../ui/ModalHandler.js';
import { RecruitmentUIBuilder } from '../ui/RecruitmentUIBuilder.js';

import { DatabaseManager } from './DatabaseManager.js';
import { ForumPostManager } from './ForumPostManager.js';
import { MappingService } from './MappingService.js';
import { ParticipantTracker } from './ParticipantTracker.js';
import { PermissionService } from './PermissionService.js';
import { RecruitmentService } from './RecruitmentService.js';
import { VoiceChannelManager } from './VoiceChannelManager.js';

// 구인구직 데이터 인터페이스
interface RecruitmentData {
  title: string;
  description: string;
  author: User;
  tags?: string[];
  maxParticipants?: number;
  category?: string;
  priority?: 'low' | 'medium' | 'high';
  duration?: number;
  requirements?: string[];
  rewards?: string[];
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

// 매핑 세부 정보 인터페이스
interface MappingDetails {
  voiceChannelId: string;
  postId: string;
  voiceChannel: any | null;
  post: any | null;
  hasQueuedUpdate: boolean;
  lastParticipantCount?: number;
  isValid: boolean;
  healthStatus: 'healthy' | 'warning' | 'error';
}

// 서비스 컴포넌트 상태 인터페이스
interface ServiceComponents {
  voiceChannelManager: boolean;
  forumPostManager: boolean;
  participantTracker: boolean;
  mappingService: boolean;
  recruitmentService: boolean;
  interactionRouter: boolean;
}

// 서비스 상태 인터페이스
interface ServiceStatus {
  mappings: MappingStats;
  recruitmentEnabled: any;
  components: ServiceComponents;
}

// 초기화 결과 인터페이스
interface InitializationResult {
  success: boolean;
  message?: string;
  error?: string;
  componentsInitialized: string[];
  componentsSkipped: string[];
}

// 헬스체크 결과 인터페이스
interface HealthCheckResult {
  isHealthy: boolean;
  healthyComponents: string[];
  unhealthyComponents: string[];
  warnings: string[];
  errors: string[];
  timestamp: Date;
}

// 서비스 통계 인터페이스
interface ServiceStatistics {
  uptime: number;
  totalInteractions: number;
  successfulInteractions: number;
  failedInteractions: number;
  averageResponseTime: number;
  componentHealth: Record<string, boolean>;
  lastActivity: Date;
}

export class VoiceChannelForumIntegrationService {
  // private readonly _client: Client; // Unused
  // private readonly _forumChannelId: string; // Unused
  // private readonly _voiceCategoryId: string; // Unused
  // private readonly _databaseManager: DatabaseManager | null; // Unused

  // Core Services
  private readonly voiceChannelManager: VoiceChannelManager;
  public readonly forumPostManager: ForumPostManager;
  private readonly participantTracker: ParticipantTracker;
  private readonly mappingService: MappingService;

  // Business Logic Services
  private readonly recruitmentService: RecruitmentService;

  // UI Handlers
  private readonly modalHandler: ModalHandler;
  private readonly buttonHandler: ButtonHandler;
  private readonly interactionRouter: InteractionRouter;

  // 서비스 통계 및 모니터링
  private serviceStartTime: Date = new Date();
  private interactionCount: number = 0;
  private successfulInteractions: number = 0;
  private failedInteractions: number = 0;
  // private _lastHealthCheck: Date = new Date(); // Unused
  private responseTimeSum: number = 0;

  constructor(
    _client: Client,
    _forumChannelId: string,
    _voiceCategoryId: string,
    _databaseManager: DatabaseManager | null = null
  ) {
    // this._client = _client; // Unused
    // this._forumChannelId = _forumChannelId; // Unused
    // this._voiceCategoryId = _voiceCategoryId; // Unused
    // this._databaseManager = _databaseManager; // Unused

    // Core Services 초기화
    this.voiceChannelManager = new VoiceChannelManager(_client, _voiceCategoryId);
    this.forumPostManager = new ForumPostManager(
      _client,
      _forumChannelId,
      config.FORUM_TAG_ID || '',
      _databaseManager
    );
    this.participantTracker = new ParticipantTracker(_client);
    this.mappingService = new MappingService(
      _client,
      this.voiceChannelManager,
      this.forumPostManager,
      _databaseManager
    );

    // Business Logic Services 초기화
    this.recruitmentService = new RecruitmentService(
      _client,
      this.forumPostManager,
      this.voiceChannelManager,
      this.mappingService,
      this.participantTracker
    );

    // UI Handlers 초기화
    this.modalHandler = new ModalHandler(this.recruitmentService, this.forumPostManager);
    this.buttonHandler = new ButtonHandler(
      this.voiceChannelManager,
      this.recruitmentService,
      this.modalHandler
    );
    this.interactionRouter = new InteractionRouter(
      this.buttonHandler,
      this.modalHandler,
      this.recruitmentService
    );

    // 서비스 초기화
    this.recruitmentService.initialize();

    console.log(`[VoiceForumService] 통합 서비스 기본 초기화 완료`);
  }

  /**
   * ========== 권한 체크 메서드 (위임) ==========
   */
  hasRecruitmentPermission(user: User, member: GuildMember | null = null): boolean {
    return PermissionService.hasRecruitmentPermission(user, member);
  }

  /**
   * ========== 이벤트 핸들러 메서드들 (위임) ==========
   */

  /**
   * 음성 채널 생성 이벤트 핸들러
   * @param channel - 생성된 채널
   */
  async handleChannelCreate(channel: Channel): Promise<void> {
    try {
      await this.recruitmentService.handleChannelCreate(channel);
      this.recordSuccessfulInteraction();
    } catch (error) {
      console.error('[VoiceForumService] 채널 생성 처리 오류:', error);
      this.recordFailedInteraction();
    }
  }

  /**
   * 음성 채널 삭제 이벤트 핸들러
   * @param channel - 삭제된 채널
   */
  async handleChannelDelete(channel: Channel): Promise<void> {
    try {
      await this.recruitmentService.handleChannelDelete(channel);
      this.recordSuccessfulInteraction();
    } catch (error) {
      console.error('[VoiceForumService] 채널 삭제 처리 오류:', error);
      this.recordFailedInteraction();
    }
  }

  /**
   * 음성 상태 변경 이벤트 핸들러
   * @param oldState - 변경 전 음성 상태
   * @param newState - 변경 후 음성 상태
   */
  async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    try {
      await this.recruitmentService.handleVoiceStateUpdate(oldState, newState);
      this.recordSuccessfulInteraction();
    } catch (error) {
      console.error('[VoiceForumService] 음성 상태 변경 처리 오류:', error);
      this.recordFailedInteraction();
    }
  }

  /**
   * 길드 멤버 업데이트 이벤트 핸들러 (별명 변경 시 실시간 갱신)
   * @param oldMember - 변경 전 멤버 정보
   * @param newMember - 변경 후 멤버 정보
   */
  async handleGuildMemberUpdate(oldMember: GuildMember, newMember: GuildMember): Promise<void> {
    try {
      await this.recruitmentService.handleGuildMemberUpdate(oldMember, newMember);
      this.recordSuccessfulInteraction();
    } catch (error) {
      console.error('[VoiceForumService] 길드 멤버 업데이트 처리 오류:', error);
      this.recordFailedInteraction();
    }
  }

  /**
   * ========== 인터랙션 처리 메서드들 (위임) ==========
   */

  /**
   * 메인 인터랙션 핸들러
   * @param interaction - Discord 인터랙션
   */
  async handleInteraction(interaction: Interaction): Promise<void> {
    const startTime = Date.now();

    try {
      this.interactionCount++;

      // 대응 가능한 인터랙션인지 확인
      if (!interaction.isRepliable()) {
        console.warn(
          '[VoiceChannelForumIntegrationService] 대응할 수 없는 인터랙션 타입:',
          interaction.type
        );
        return;
      }

      // 권한 체크 및 전처리
      const canProceed = await InteractionRouter.preprocessInteraction(
        interaction,
        PermissionService
      );
      if (!canProceed) {
        this.recordFailedInteraction();
        return;
      }

      // 인터랙션 라우팅
      await this.interactionRouter.routeInteraction(interaction);

      this.recordSuccessfulInteraction();
    } catch (error) {
      console.error('[VoiceForumService] 인터랙션 처리 오류:', error);
      this.recordFailedInteraction();
    } finally {
      const endTime = Date.now();
      this.recordResponseTime(endTime - startTime);
    }
  }

  /**
   * 역할 태그 버튼 처리 (하위 호환성을 위해 유지)
   * @param interaction - 버튼 인터랙션
   */
  async handleRoleTagButtons(interaction: ButtonInteraction): Promise<void> {
    try {
      await this.buttonHandler.handleRoleTagButtons(interaction);
      this.recordSuccessfulInteraction();
    } catch (error) {
      console.error('[VoiceForumService] 역할 태그 버튼 처리 오류:', error);
      this.recordFailedInteraction();
    }
  }

  /**
   * ========== 유틸리티 메서드들 (위임) ==========
   */

  /**
   * 독립 구인구직 시작 - 역할 태그 선택 화면 표시
   * @param interaction - 인터랙션 객체
   */
  async showStandaloneRecruitmentModal(interaction: Interaction): Promise<void> {
    try {
      // 권한 체크는 이미 RecruitmentCommand에서 했지만 추가 보안을 위해 다시 체크
      if (
        !this.hasRecruitmentPermission(interaction.user, interaction.member as GuildMember | null)
      ) {
        if (interaction.isRepliable()) {
          await interaction.reply({
            content:
              '❌ **구인구직 기능 접근 권한이 없습니다.**\n\n이 기능은 현재 베타 테스트 중으로 특정 사용자와 관리자만 이용할 수 있습니다.',
            flags: MessageFlags.Ephemeral,
          });
        }
        return;
      }

      // 역할 태그 선택 화면 표시
      const embed = RecruitmentUIBuilder.createRoleTagSelectionEmbed([], true);
      const components = RecruitmentUIBuilder.createRoleTagButtons([], null, null, true);

      if (interaction.isRepliable()) {
        await interaction.reply({
          embeds: [embed],
          components,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      console.error('[VoiceForumService] 독립 구인구직 모달 표시 오류:', error);

      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ 오류가 발생했습니다. 다시 시도해주세요.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }

  /**
   * 독립적인 포럼 포스트 생성 (음성 채널 없이)
   * @param recruitmentData - 구인구직 데이터
   * @returns 생성된 포스트 ID 또는 null
   */
  async createStandaloneForumPost(recruitmentData: RecruitmentData): Promise<string | null> {
    try {
      const result = await this.forumPostManager.createForumPost(recruitmentData);
      if (result.success && result.postId) {
        this.recordSuccessfulInteraction();
        return result.postId;
      }
      this.recordFailedInteraction();
      return null;
    } catch (error) {
      console.error('[VoiceForumService] 독립 포럼 포스트 생성 오류:', error);
      this.recordFailedInteraction();
      return null;
    }
  }

  /**
   * 삭제된 채널 정리
   */
  async cleanupDeletedChannels(): Promise<void> {
    try {
      const result = await this.mappingService.performFullCleanup();
      console.log(`[VoiceForumService] 삭제된 채널 정리 완료:`, result);
    } catch (error) {
      console.error('[VoiceForumService] 채널 정리 오류:', error);
    }
  }

  /**
   * 참여자 수 업데이트 큐에 추가
   * @param voiceChannelId - 음성 채널 ID
   */
  queueParticipantUpdate(voiceChannelId: string): void {
    try {
      this.mappingService.queueUpdate(voiceChannelId);
    } catch (error) {
      console.error('[VoiceForumService] 참여자 업데이트 큐 추가 오류:', error);
    }
  }

  /**
   * ========== 서비스 상태 조회 메서드들 ==========
   */

  /**
   * 현재 매핑 상태 가져오기
   * @returns 매핑 통계
   */
  getMappingStats(): MappingStats {
    try {
      return this.mappingService.getMappingStats();
    } catch (error) {
      console.error('[VoiceForumService] 매핑 통계 조회 오류:', error);
      return {
        totalMappings: 0,
        queuedUpdates: 0,
        healthyMappings: 0,
        warningMappings: 0,
        errorMappings: 0,
        averageParticipants: 0,
        mappings: [],
      };
    }
  }

  /**
   * 특정 음성 채널의 매핑 정보 가져오기
   * @param voiceChannelId - 음성 채널 ID
   * @returns 매핑 상세 정보
   */
  async getMappingDetails(voiceChannelId: string): Promise<MappingDetails | null> {
    try {
      return await this.mappingService.getMappingDetails(voiceChannelId);
    } catch (error) {
      console.error('[VoiceForumService] 매핑 세부 정보 조회 오류:', error);
      return null;
    }
  }

  /**
   * 현재 서비스 상태 요약
   * @returns 서비스 상태
   */
  getServiceStatus(): ServiceStatus {
    try {
      return {
        mappings: this.getMappingStats(),
        recruitmentEnabled: PermissionService.hasRecruitmentPermission,
        components: {
          voiceChannelManager: !!this.voiceChannelManager,
          forumPostManager: !!this.forumPostManager,
          participantTracker: !!this.participantTracker,
          mappingService: !!this.mappingService,
          recruitmentService: !!this.recruitmentService,
          interactionRouter: !!this.interactionRouter,
        },
      };
    } catch (error) {
      console.error('[VoiceForumService] 서비스 상태 조회 오류:', error);
      return {
        mappings: this.getMappingStats(),
        recruitmentEnabled: false,
        components: {
          voiceChannelManager: false,
          forumPostManager: false,
          participantTracker: false,
          mappingService: false,
          recruitmentService: false,
          interactionRouter: false,
        },
      };
    }
  }

  /**
   * 서비스 통계 조회
   * @returns 서비스 통계
   */
  getServiceStatistics(): ServiceStatistics {
    const uptime = Date.now() - this.serviceStartTime.getTime();
    const averageResponseTime =
      this.interactionCount > 0 ? this.responseTimeSum / this.interactionCount : 0;

    return {
      uptime,
      totalInteractions: this.interactionCount,
      successfulInteractions: this.successfulInteractions,
      failedInteractions: this.failedInteractions,
      averageResponseTime,
      componentHealth: {
        voiceChannelManager: !!this.voiceChannelManager,
        forumPostManager: !!this.forumPostManager,
        participantTracker: !!this.participantTracker,
        mappingService: !!this.mappingService,
        recruitmentService: !!this.recruitmentService,
        interactionRouter: !!this.interactionRouter,
      },
      lastActivity: new Date(),
    };
  }

  /**
   * ========== 디버깅 및 로깅 메서드들 ==========
   */

  /**
   * 현재 매핑 상태 로깅
   */
  logMappingStatus(): void {
    try {
      this.mappingService.logCurrentMappings();
    } catch (error) {
      console.error('[VoiceForumService] 매핑 상태 로깅 오류:', error);
    }
  }

  /**
   * MappingService 초기화 (비동기)
   */
  async initializeMappingService(): Promise<boolean> {
    try {
      console.log('[VoiceForumService] MappingService 초기화 시작...');

      if (this.mappingService && typeof this.mappingService.initialize === 'function') {
        const initResult = await this.mappingService.initialize();

        if (initResult) {
          console.log('[VoiceForumService] MappingService 초기화 성공');
          return true;
        } else {
          console.warn('[VoiceForumService] MappingService 초기화 실패');
          return false;
        }
      } else {
        console.warn('[VoiceForumService] MappingService 또는 initialize 메서드가 없습니다.');
        return false;
      }
    } catch (error) {
      console.error('[VoiceForumService] MappingService 초기화 오류:', error);
      return false;
    }
  }

  /**
   * 서비스 컴포넌트 상태 체크
   * @returns 모든 컴포넌트가 정상인지 여부
   */
  healthCheck(): boolean {
    try {
      // this._lastHealthCheck = new Date(); // Unused

      const components = [
        this.voiceChannelManager,
        this.forumPostManager,
        this.participantTracker,
        this.mappingService,
        this.recruitmentService,
        this.interactionRouter,
      ];

      const allHealthy = components.every((component) => !!component);

      if (!allHealthy) {
        console.error('[VoiceForumService] 일부 컴포넌트가 초기화되지 않았습니다.');
      }

      return allHealthy;
    } catch (error) {
      console.error('[VoiceForumService] 헬스체크 오류:', error);
      return false;
    }
  }

  /**
   * 상세 헬스체크 수행
   * @returns 상세 헬스체크 결과
   */
  detailedHealthCheck(): HealthCheckResult {
    const healthyComponents: string[] = [];
    const unhealthyComponents: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    try {
      // 각 컴포넌트 상태 확인
      if (this.voiceChannelManager) {
        healthyComponents.push('voiceChannelManager');
      } else {
        unhealthyComponents.push('voiceChannelManager');
        errors.push('VoiceChannelManager가 초기화되지 않았습니다.');
      }

      if (this.forumPostManager) {
        healthyComponents.push('forumPostManager');
      } else {
        unhealthyComponents.push('forumPostManager');
        errors.push('ForumPostManager가 초기화되지 않았습니다.');
      }

      if (this.participantTracker) {
        healthyComponents.push('participantTracker');
      } else {
        unhealthyComponents.push('participantTracker');
        errors.push('ParticipantTracker가 초기화되지 않았습니다.');
      }

      if (this.mappingService) {
        healthyComponents.push('mappingService');
      } else {
        unhealthyComponents.push('mappingService');
        errors.push('MappingService가 초기화되지 않았습니다.');
      }

      if (this.recruitmentService) {
        healthyComponents.push('recruitmentService');
      } else {
        unhealthyComponents.push('recruitmentService');
        errors.push('RecruitmentService가 초기화되지 않았습니다.');
      }

      if (this.interactionRouter) {
        healthyComponents.push('interactionRouter');
      } else {
        unhealthyComponents.push('interactionRouter');
        errors.push('InteractionRouter가 초기화되지 않았습니다.');
      }

      // 통계 기반 경고
      const failureRate =
        this.interactionCount > 0 ? (this.failedInteractions / this.interactionCount) * 100 : 0;
      if (failureRate > 10) {
        warnings.push(`높은 실패율: ${failureRate.toFixed(2)}%`);
      }

      const uptime = Date.now() - this.serviceStartTime.getTime();
      if (uptime < 60000) {
        // 1분 미만
        warnings.push('서비스 시작된 지 얼마 되지 않았습니다.');
      }

      return {
        isHealthy: unhealthyComponents.length === 0 && errors.length === 0,
        healthyComponents,
        unhealthyComponents,
        warnings,
        errors,
        timestamp: new Date(),
      };
    } catch (error) {
      console.error('[VoiceForumService] 상세 헬스체크 오류:', error);
      return {
        isHealthy: false,
        healthyComponents: [],
        unhealthyComponents: ['전체 시스템'],
        warnings: [],
        errors: ['헬스체크 수행 중 오류가 발생했습니다.'],
        timestamp: new Date(),
      };
    }
  }

  /**
   * 성공한 인터랙션 기록
   */
  private recordSuccessfulInteraction(): void {
    this.successfulInteractions++;
  }

  /**
   * 실패한 인터랙션 기록
   */
  private recordFailedInteraction(): void {
    this.failedInteractions++;
  }

  /**
   * 응답 시간 기록
   * @param responseTime - 응답 시간 (밀리초)
   */
  private recordResponseTime(responseTime: number): void {
    this.responseTimeSum += responseTime;
  }

  /**
   * 전체 서비스 초기화
   * @returns 초기화 결과
   */
  async initialize(): Promise<InitializationResult> {
    const componentsInitialized: string[] = [];
    const componentsSkipped: string[] = [];

    try {
      console.log('[VoiceForumService] 전체 서비스 초기화 시작...');

      // MappingService 초기화
      const mappingInitialized = await this.initializeMappingService();
      if (mappingInitialized) {
        componentsInitialized.push('MappingService');
      } else {
        componentsSkipped.push('MappingService');
      }

      // 기타 필요한 초기화 작업들...

      console.log('[VoiceForumService] 전체 서비스 초기화 완료');

      return {
        success: true,
        message: '서비스 초기화가 성공적으로 완료되었습니다.',
        componentsInitialized,
        componentsSkipped,
      };
    } catch (error) {
      console.error('[VoiceForumService] 서비스 초기화 오류:', error);

      return {
        success: false,
        error: error instanceof Error ? error.message : '알 수 없는 오류',
        componentsInitialized,
        componentsSkipped,
      };
    }
  }
}
