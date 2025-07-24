// src/ui/InteractionRouter.ts - 인터랙션 라우팅 관리
import {
  InteractionType,
  ComponentType,
  MessageFlags,
  Interaction,
  RepliableInteraction,
  MessageComponentInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  User,
  GuildMember,
} from 'discord.js';

import { DiscordConstants } from '../config/DiscordConstants';
import { PermissionService } from '../services/PermissionService';
import { RecruitmentService } from '../services/RecruitmentService';
import { DiscordAPIError } from '../types/discord';
import { SafeInteraction } from '../utils/SafeInteraction';

import { ButtonHandler } from './ButtonHandler';
import { ModalHandler } from './ModalHandler';

// 인터랙션 통계 인터페이스
interface InteractionStatistics {
  totalInteractions: number;
  buttonInteractions: number;
  modalInteractions: number;
  selectMenuInteractions: number;
  recruitmentInteractions: number;
  errorCount: number;
  averageResponseTime: number;
  lastInteractionTime: Date;
  topUsers: Array<{
    userId: string;
    username: string;
    interactionCount: number;
  }>;
}

// 인터랙션 로그 항목 인터페이스
interface InteractionLogEntry {
  timestamp: Date;
  userId: string;
  username: string;
  type: InteractionType;
  componentType?: ComponentType;
  customId: string;
  success: boolean;
  responseTime: number;
  error?: string;
}

// 라우팅 결과 인터페이스
interface RoutingResult {
  success: boolean;
  handled: boolean;
  responseTime: number;
  error?: string;
  route?: string;
}

// 권한 체크 결과 인터페이스
interface PermissionCheckResult {
  allowed: boolean;
  reason: string;
  isRecruitmentInteraction: boolean;
}

// 전처리 결과 인터페이스 (currently unused)
// interface PreprocessResult {
//   canProceed: boolean;
//   reason?: string;
//   permissionCheck: PermissionCheckResult;
//   logEntry: InteractionLogEntry;
// }

export class InteractionRouter {
  private readonly buttonHandler: ButtonHandler;
  private readonly modalHandler: ModalHandler;
  private readonly recruitmentService: RecruitmentService;

  // 통계 및 모니터링
  private interactionStats: InteractionStatistics = {
    totalInteractions: 0,
    buttonInteractions: 0,
    modalInteractions: 0,
    selectMenuInteractions: 0,
    recruitmentInteractions: 0,
    errorCount: 0,
    averageResponseTime: 0,
    lastInteractionTime: new Date(),
    topUsers: [],
  };

  private interactionLog: InteractionLogEntry[] = [];
  // private readonly maxLogEntries: number = 1000; // unused
  private responseTimeSum: number = 0;
  private userInteractionCounts: Map<string, number> = new Map();

  constructor(
    buttonHandler: ButtonHandler,
    modalHandler: ModalHandler,
    recruitmentService: RecruitmentService
  ) {
    this.buttonHandler = buttonHandler;
    this.modalHandler = modalHandler;
    this.recruitmentService = recruitmentService;
  }

  /**
   * 인터랙션 라우팅 메인 메서드
   * @param interaction - Discord 인터랙션
   */
  async routeInteraction(interaction: Interaction): Promise<RoutingResult> {
    const startTime = Date.now();
    let route = 'unknown';

    try {
      this.interactionStats.totalInteractions++;
      this.interactionStats.lastInteractionTime = new Date();

      // 인터랙션 타입에 따른 라우팅
      switch (interaction.type) {
        case InteractionType.MessageComponent:
          route = 'component';
          await this.routeComponentInteraction(interaction as MessageComponentInteraction);
          break;

        case InteractionType.ModalSubmit:
          route = 'modal';
          this.interactionStats.modalInteractions++;
          await this.modalHandler.handleModalSubmit(interaction);
          break;

        default:
          route = 'unhandled';
          console.warn(`[InteractionRouter] 처리되지 않은 인터랙션 타입: ${interaction.type}`);
          break;
      }

      const endTime = Date.now();
      const responseTime = endTime - startTime;
      this.recordResponseTime(responseTime);
      this.recordUserInteraction(interaction.user);

      return {
        success: true,
        handled: true,
        responseTime,
        route,
      };
    } catch (error) {
      console.error('[InteractionRouter] 인터랙션 라우팅 오류:', error);
      this.interactionStats.errorCount++;

      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';

      if (interaction.isRepliable()) {
        await SafeInteraction.safeReply(
          interaction,
          SafeInteraction.createErrorResponse('인터랙션 처리', {
            code: 0,
            message: error instanceof Error ? error.message : '알 수 없는 오류',
            status: 500,
            method: 'INTERACTION',
            url: 'internal',
            rawError: error,
            requestBody: {},
            name: 'DiscordAPIError',
          } as DiscordAPIError)
        );
      }

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      return {
        success: false,
        handled: true,
        responseTime,
        error: errorMessage,
        route,
      };
    }
  }

  /**
   * 컴포넌트 인터랙션 라우팅
   * @param interaction - 컴포넌트 인터랙션
   */
  private async routeComponentInteraction(interaction: MessageComponentInteraction): Promise<void> {
    switch (interaction.componentType) {
      case ComponentType.Button:
        this.interactionStats.buttonInteractions++;
        await this.routeButtonInteraction(interaction as ButtonInteraction);
        break;

      case ComponentType.StringSelect:
        this.interactionStats.selectMenuInteractions++;
        await this.routeSelectMenuInteraction(interaction as StringSelectMenuInteraction);
        break;

      default:
        console.warn(
          `[InteractionRouter] 처리되지 않은 컴포넌트 타입: ${interaction.componentType}`
        );
        break;
    }
  }

  /**
   * 버튼 인터랙션 라우팅
   * @param interaction - 버튼 인터랙션
   */
  private async routeButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;

    // 구인구직 연동 버튼
    if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_CONNECT)) {
      this.interactionStats.recruitmentInteractions++;
      await this.recruitmentService.handleVoiceConnectButton(interaction);
    }
    // 게임 태그 및 음성 채널 관련 버튼
    else {
      await this.buttonHandler.routeButtonInteraction(interaction);
    }
  }

  /**
   * 셀렉트 메뉴 인터랙션 라우팅
   * @param interaction - 셀렉트 메뉴 인터랙션
   */
  private async routeSelectMenuInteraction(
    interaction: StringSelectMenuInteraction
  ): Promise<void> {
    const customId = interaction.customId;

    // 구인구직 방법 선택
    if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_METHOD)) {
      this.interactionStats.recruitmentInteractions++;
      await this.recruitmentService.handleMethodSelection(interaction);
    }
    // 기존 포스트 선택
    else if (customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.EXISTING_POST_SELECT)) {
      this.interactionStats.recruitmentInteractions++;
      await this.recruitmentService.handleExistingPostSelection(interaction);
    } else {
      console.warn(`[InteractionRouter] 처리되지 않은 셀렉트 메뉴: ${customId}`);
    }
  }

  /**
   * 구인구직 관련 인터랙션인지 확인
   * @param interaction - Discord 인터랙션
   * @returns 구인구직 관련 여부
   */
  static isRecruitmentInteraction(interaction: Interaction): boolean {
    if (!('customId' in interaction) || !interaction.customId) return false;

    const customId = interaction.customId;
    const recruitmentPrefixes = [
      DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_CONNECT,
      DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_SPECTATE,
      DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_RESET,
      DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_MODAL,
      DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_METHOD,
      DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_BUTTON,
      DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_COMPLETE,
      DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_BUTTON,
      DiscordConstants.CUSTOM_ID_PREFIXES.EXISTING_POST_SELECT,
    ];

    return (
      recruitmentPrefixes.some((prefix) => customId.startsWith(prefix)) ||
      customId === DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE ||
      customId === 'standalone_recruitment_modal'
    );
  }

  /**
   * 인터랙션 상태 로깅
   * @param interaction - Discord 인터랙션
   */
  static logInteraction(interaction: Interaction): InteractionLogEntry {
    const user = interaction.user;
    const customId = ('customId' in interaction && interaction.customId) || 'N/A';
    const type = interaction.type;
    const componentType = 'componentType' in interaction ? interaction.componentType : undefined;

    console.log(
      `[InteractionRouter] 인터랙션 수신: 사용자=${user.displayName} (${user.id}), 타입=${type}, 컴포넌트=${componentType || 'N/A'}, customId=${customId}`
    );

    return {
      timestamp: new Date(),
      userId: user.id,
      username: user.displayName,
      type,
      customId,
      success: true,
      responseTime: 0,
      ...(componentType !== undefined && { componentType }),
    };
  }

  /**
   * 권한이 있는 인터랙션인지 확인
   * @param interaction - Discord 인터랙션
   * @param permissionService - 권한 서비스
   * @returns 권한 체크 결과
   */
  static async checkPermission(
    interaction: Interaction,
    permissionService: typeof PermissionService
  ): Promise<PermissionCheckResult> {
    try {
      const isRecruitmentInteraction = this.isRecruitmentInteraction(interaction);

      // 구인구직 관련 인터랙션이 아니면 허용
      if (!isRecruitmentInteraction) {
        return {
          allowed: true,
          reason: '구인구직 관련 인터랙션이 아님',
          isRecruitmentInteraction: false,
        };
      }

      // 권한 체크
      const hasPermission = permissionService.hasRecruitmentPermission(
        interaction.user,
        interaction.member as GuildMember | null
      );

      return {
        allowed: hasPermission,
        reason: hasPermission ? '권한 있음' : '권한 없음',
        isRecruitmentInteraction: true,
      };
    } catch (error) {
      console.error('[InteractionRouter] 권한 확인 오류:', error);
      return {
        allowed: false,
        reason: '권한 확인 중 오류 발생',
        isRecruitmentInteraction: false,
      };
    }
  }

  /**
   * 레거시 권한 체크 메서드 (하위 호환성)
   * @param interaction - Discord 인터랙션
   * @param permissionService - 권한 서비스
   * @returns 권한 여부
   */
  static async hasPermission(
    interaction: Interaction,
    permissionService: typeof PermissionService
  ): Promise<boolean> {
    const result = await this.checkPermission(interaction, permissionService);
    return result.allowed;
  }

  /**
   * 인터랙션 전처리 (로깅, 권한 체크 등)
   * @param interaction - Discord 인터랙션
   * @param permissionService - 권한 서비스
   * @returns 전처리 결과
   */
  static async preprocessInteraction(
    interaction: RepliableInteraction,
    permissionService: typeof PermissionService
  ): Promise<boolean> {
    try {
      // 인터랙션 로깅
      // const logEntry = this.logInteraction(interaction); // Unused

      // 권한 체크
      const permissionCheck = await this.checkPermission(interaction, permissionService);

      if (!permissionCheck.allowed) {
        await SafeInteraction.safeReply(interaction, {
          content: '❌ 이 기능을 사용할 권한이 없습니다.',
          flags: MessageFlags.Ephemeral,
        });
        return false;
      }

      return true;
    } catch (error) {
      console.error('[InteractionRouter] 인터랙션 전처리 오류:', error);

      try {
        await SafeInteraction.safeReply(interaction, {
          content: '❌ 인터랙션 처리 중 오류가 발생했습니다.',
          flags: MessageFlags.Ephemeral,
        });
      } catch (replyError) {
        console.error('[InteractionRouter] 에러 응답 전송 실패:', replyError);
      }

      return false;
    }
  }

  /**
   * 에러 응답 생성
   * @param context - 에러 컨텍스트
   * @param error - 에러 객체
   * @returns Discord 응답 객체
   */
  static createErrorResponse(context: string, error: Error): any {
    return SafeInteraction.createErrorResponse(context, {
      code: 0,
      message: error.message,
      status: 500,
      method: 'INTERACTION',
      url: 'internal',
      rawError: error,
      requestBody: {},
      name: 'DiscordAPIError',
    } as DiscordAPIError);
  }

  /**
   * 인터랙션 통계 조회
   * @returns 인터랙션 통계
   */
  getInteractionStatistics(): InteractionStatistics {
    // Top 사용자 업데이트
    this.updateTopUsers();

    return { ...this.interactionStats };
  }

  /**
   * 인터랙션 로그 조회
   * @param limit - 조회할 로그 수 제한
   * @returns 인터랙션 로그
   */
  getInteractionLog(limit: number = 100): InteractionLogEntry[] {
    return this.interactionLog
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * 특정 사용자의 인터랙션 로그 조회
   * @param userId - 사용자 ID
   * @param limit - 조회할 로그 수 제한
   * @returns 사용자별 인터랙션 로그
   */
  getUserInteractionLog(userId: string, limit: number = 50): InteractionLogEntry[] {
    return this.interactionLog
      .filter((entry) => entry.userId === userId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * 통계 초기화
   */
  resetStatistics(): void {
    this.interactionStats = {
      totalInteractions: 0,
      buttonInteractions: 0,
      modalInteractions: 0,
      selectMenuInteractions: 0,
      recruitmentInteractions: 0,
      errorCount: 0,
      averageResponseTime: 0,
      lastInteractionTime: new Date(),
      topUsers: [],
    };

    this.interactionLog = [];
    this.responseTimeSum = 0;
    this.userInteractionCounts.clear();
  }

  /**
   * 로그 항목 추가 (currently unused)
   * @param entry - 로그 항목
   */
  // private addLogEntry(entry: InteractionLogEntry): void {
  //   this.interactionLog.push(entry);
  //
  //   // 로그 크기 제한
  //   if (this.interactionLog.length > this.maxLogEntries) {
  //     this.interactionLog = this.interactionLog.slice(-this.maxLogEntries);
  //   }
  // }

  /**
   * 응답 시간 기록
   * @param responseTime - 응답 시간 (밀리초)
   */
  private recordResponseTime(responseTime: number): void {
    this.responseTimeSum += responseTime;
    this.interactionStats.averageResponseTime =
      this.responseTimeSum / this.interactionStats.totalInteractions;
  }

  /**
   * 사용자 인터랙션 기록
   * @param user - 사용자
   */
  private recordUserInteraction(user: User): void {
    const currentCount = this.userInteractionCounts.get(user.id) || 0;
    this.userInteractionCounts.set(user.id, currentCount + 1);
  }

  /**
   * Top 사용자 업데이트
   */
  private updateTopUsers(): void {
    const topUsers = Array.from(this.userInteractionCounts.entries())
      .map(([userId, count]) => {
        // 로그에서 최신 사용자명 찾기
        const latestLog = this.interactionLog
          .filter((entry) => entry.userId === userId)
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];

        return {
          userId,
          username: latestLog?.username || 'Unknown',
          interactionCount: count,
        };
      })
      .sort((a, b) => b.interactionCount - a.interactionCount)
      .slice(0, 10);

    this.interactionStats.topUsers = topUsers;
  }

  /**
   * 서비스 상태 체크
   * @returns 서비스 상태
   */
  healthCheck(): {
    isHealthy: boolean;
    components: Record<string, boolean>;
    lastActivity: Date;
    errorRate: number;
  } {
    const errorRate =
      this.interactionStats.totalInteractions > 0
        ? (this.interactionStats.errorCount / this.interactionStats.totalInteractions) * 100
        : 0;

    return {
      isHealthy: errorRate < 5, // 5% 미만의 에러율을 건강한 상태로 간주
      components: {
        buttonHandler: !!this.buttonHandler,
        modalHandler: !!this.modalHandler,
        recruitmentService: !!this.recruitmentService,
      },
      lastActivity: this.interactionStats.lastInteractionTime,
      errorRate,
    };
  }
}
