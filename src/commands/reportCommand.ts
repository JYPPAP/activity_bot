// src/commands/reportCommand.ts - 보고서 명령어
import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
  Collection,
  GuildMember,
  TextChannel,
} from 'discord.js';

// import { UserClassificationService } from '../services/UserClassificationService';
import { UserClassificationServiceOptimized as UserClassificationService } from '../services/UserClassificationServiceOptimized';
import { GuildSettingsManager } from '../services/GuildSettingsManager';
import { EmbedFactory } from '../utils/embedBuilder';
import { cleanRoleName } from '../utils/formatters';

import {
  CommandBase,
  CommandServices,
  CommandResult,
  CommandExecutionOptions,
  CommandMetadata,
} from './CommandBase';

// 명령어 옵션 인터페이스
interface ReportCommandOptions {
  role: string;
  startDateStr: string;
  endDateStr: string;
  isTestMode: boolean;
}

// 날짜 범위 인터페이스
interface DateRange {
  startDate: Date;
  endDate: Date;
}

// 보고서 생성 결과 인터페이스
interface ReportGenerationResult {
  role: string;
  dateRange: DateRange;
  reportEmbeds: any[];
  statistics?: {
    totalMembers: number;
    activeCount: number;
    inactiveCount: number;
    afkCount: number;
    averageActivity: number;
  };
  executionTime: number;
  testMode: boolean;
}

// 날짜 유효성 검사 결과
interface DateValidationResult {
  isValid: boolean;
  error?: string;
  dateRange?: DateRange;
}

export class ReportCommand extends CommandBase {
  public readonly metadata: CommandMetadata = {
    name: '보고서',
    description: '역할별 활동 보고서를 생성합니다.',
    category: 'administration',
    permissions: ['Administrator'],
    cooldown: 60,
    adminOnly: true,
    guildOnly: true,
    usage: '/보고서 role:<역할이름> start_date:<시작날짜> end_date:<종료날짜>',
    examples: [
      '/보고서 role:정규 start_date:241201 end_date:241231',
      '/보고서 role:정규 start_date:241201 end_date:241231 test_mode:true',
    ],
    aliases: ['report', '보고서'],
  };

  private userClassificationService: UserClassificationService | null = null;
  private guildSettingsManager: GuildSettingsManager | null = null;

  constructor(services: CommandServices) {
    super(services);
  }

  /**
   * 슬래시 명령어 빌더 생성
   */
  buildSlashCommand(): SlashCommandBuilder {
    return new SlashCommandBuilder()
      .setName(this.metadata.name)
      .setDescription(this.metadata.description)
      .addStringOption((option) =>
        option.setName('role').setDescription('보고서를 생성할 역할 이름').setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('start_date')
          .setDescription('시작 날짜 (YYMMDD 형식, 예: 241201)')
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('end_date')
          .setDescription('종료 날짜 (YYMMDD 형식, 예: 241231)')
          .setRequired(true)
      )
      .addBooleanOption((option) =>
        option
          .setName('test_mode')
          .setDescription('테스트 모드 (리셋 시간 기록 안함)')
          .setRequired(false)
      ) as SlashCommandBuilder;
  }

  /**
   * 의존성 주입을 위한 메서드
   * @param userClassificationService - 사용자 분류 서비스
   */
  setUserClassificationService(userClassificationService: UserClassificationService): void {
    this.userClassificationService = userClassificationService;
  }

  /**
   * 의존성 주입을 위한 메서드
   * @param guildSettingsManager - 길드 설정 관리자
   */
  setGuildSettingsManager(guildSettingsManager: GuildSettingsManager): void {
    this.guildSettingsManager = guildSettingsManager;
  }

  /**
   * 보고서 명령어의 실제 실행 로직
   * @param interaction - 상호작용 객체
   * @param options - 실행 옵션
   */
  protected async executeCommand(
    interaction: ChatInputCommandInteraction,
    _options: CommandExecutionOptions
  ): Promise<CommandResult> {
    const startTime = Date.now();
    console.log(`[보고서] 명령어 시작: ${new Date().toISOString()}`);

    let commandOptions: ReportCommandOptions | undefined;

    try {
      // 서비스 의존성 확인
      if (!this.userClassificationService) {
        console.error(`[보고서] UserClassificationService가 초기화되지 않음`);
        throw new Error('UserClassificationService가 초기화되지 않았습니다.');
      }
      if (!this.guildSettingsManager) {
        console.error(`[보고서] GuildSettingsManager가 초기화되지 않음`);
        throw new Error('GuildSettingsManager가 초기화되지 않았습니다.');
      }
      console.log(`[보고서] 서비스 의존성 확인 완료`);

      // 명령어 옵션 가져오기
      commandOptions = this.getCommandOptions(interaction);
      console.log(`[보고서] 옵션 파싱 완료:`, {
        role: commandOptions.role,
        startDate: commandOptions.startDateStr,
        endDate: commandOptions.endDateStr,
        testMode: commandOptions.isTestMode,
      });

      // 캐시 확인
      console.log(`[보고서] 캐시 확인 시작`);
      const cacheKey = this.generateCacheKey(commandOptions);
      const cached = this.getCached<ReportGenerationResult>(cacheKey);
      console.log(`[보고서] 캐시 키: ${cacheKey}, 캐시 존재: ${!!cached}`);

      if (cached && !commandOptions.isTestMode) {
        console.log(`[보고서] 캐시된 데이터 사용`);
        await this.sendCachedReport(interaction, cached);
        return {
          success: true,
          message: '캐시된 보고서를 전송했습니다.',
          data: cached,
        };
      }

      // 최신 데이터로 갱신
      console.log(`[보고서] 활동 데이터 저장 시작`);
      await this.activityTracker.saveActivityData();
      console.log(`[보고서] 활동 데이터 저장 완료`);

      // 역할 설정 가져오기
      console.log(`[보고서] 역할 설정 조회 시작: "${commandOptions.role}"`);
      console.log(`[보고서] 역할 이름 상세 정보:`, {
        original: interaction.options.getString('role'),
        cleaned: commandOptions.role,
        length: commandOptions.role.length,
        charCodes: [...commandOptions.role].map((c) => c.charCodeAt(0)),
        hasSpaces: commandOptions.role.includes(' '),
        trimmed: commandOptions.role.trim(),
      });

      const roleConfigStartTime = Date.now();
      const roleConfig = await this.guildSettingsManager.getRoleActivityTime(
        interaction.guildId!,
        commandOptions.role
      );
      const roleConfigTime = Date.now() - roleConfigStartTime;

      console.log(`[보고서] 역할 설정 조회 완료: ${roleConfigTime}ms`);
      console.log(
        `[보고서] 조회된 설정:`,
        roleConfig
          ? {
              roleName: roleConfig.roleName || commandOptions.role,
              minHours: roleConfig.minHours,
              hasConfig: true,
            }
          : { hasConfig: false, result: null }
      );

      // 전체 역할 설정 목록도 확인 (디버깅용)
      try {
        console.log(`[보고서] 전체 역할 설정 조회 시작 (디버깅)`);
        const allRoleConfigs = await this.guildSettingsManager.getAllRoleActivityTimes(
          interaction.guildId!
        );
        console.log(
          `[보고서] 전체 역할 설정 목록:`,
          Object.entries(allRoleConfigs).map(([roleName, config]) => ({
            roleName: roleName,
            minHours: config.minHours,
          }))
        );
      } catch (debugError) {
        console.warn(`[보고서] 전체 역할 설정 조회 실패:`, debugError);
      }

      if (!this.validateRoleConfig(roleConfig, commandOptions.role, interaction)) {
        console.error(`[보고서] 역할 설정 검증 실패: ${commandOptions.role}`);
        return {
          success: false,
          message: `역할 "${commandOptions.role}"에 대한 설정을 찾을 수 없습니다.`,
        };
      }

      // 현재 역할을 가진 멤버 가져오기
      console.log(`[보고서] 역할 멤버 조회 시작: ${commandOptions.role}`);
      const roleMembers = await this.getRoleMembers(interaction.guild!, commandOptions.role);
      console.log(`[보고서] 역할 멤버 조회 완료: ${roleMembers.size}명`);

      if (roleMembers.size === 0) {
        console.warn(`[보고서] 해당 역할 멤버 없음: ${commandOptions.role}`);
        return {
          success: false,
          message: `역할 "${commandOptions.role}"을 가진 멤버가 없습니다.`,
        };
      }

      // 날짜 범위 설정
      console.log(`[보고서] 날짜 범위 파싱 시작`);
      const dateValidation = await this.parseDateRange(commandOptions, roleConfig, interaction);
      console.log(`[보고서] 날짜 범위 파싱 완료:`, {
        isValid: dateValidation.isValid,
        dateRange: dateValidation.dateRange
          ? {
              start: dateValidation.dateRange.startDate.toISOString(),
              end: dateValidation.dateRange.endDate.toISOString(),
            }
          : null,
        error: dateValidation.error,
      });

      if (!dateValidation.isValid || !dateValidation.dateRange) {
        console.error(`[보고서] 날짜 범위 검증 실패:`, dateValidation.error);
        return {
          success: false,
          message: dateValidation.error || '날짜 범위 설정에 실패했습니다.',
        };
      }

      // 진행 상황 알림
      console.log(`[보고서] 진행 상황 알림 전송`);
      await interaction.followUp({
        content:
          `📊 **보고서 생성 중...**\n\n` +
          `🎯 **역할:** ${commandOptions.role}\n` +
          `📅 **기간:** ${this.formatDateRange(dateValidation.dateRange)}\n` +
          `👥 **대상 멤버:** ${roleMembers.size}명\n` +
          `🧪 **테스트 모드:** ${commandOptions.isTestMode ? '활성화' : '비활성화'}\n\n` +
          `⏳ **예상 소요 시간:** ${this.estimateProcessingTime(roleMembers.size)}초`,
        flags: MessageFlags.Ephemeral,
      });

      // 사용자 분류 및 보고서 생성
      console.log(`[보고서] 보고서 생성 시작: ${new Date().toISOString()}`);
      console.log(`[보고서] 생성 파라미터:`, {
        role: commandOptions.role,
        memberCount: roleMembers.size,
        startDate: dateValidation.dateRange.startDate.toISOString(),
        endDate: dateValidation.dateRange.endDate.toISOString(),
      });
      const reportStartTime = Date.now();

      const reportEmbeds = await this.generateReport(
        commandOptions.role,
        roleMembers,
        dateValidation.dateRange
      );

      const reportEndTime = Date.now();
      console.log(
        `[보고서] 보고서 생성 완료: ${new Date().toISOString()}, 소요시간: ${reportEndTime - reportStartTime}ms`
      );

      // 보고서 결과 생성
      const result: ReportGenerationResult = {
        role: commandOptions.role,
        dateRange: dateValidation.dateRange,
        reportEmbeds,
        executionTime: Date.now() - startTime,
        testMode: commandOptions.isTestMode,
      };

      // 캐시 저장 (테스트 모드가 아닌 경우만)
      if (!commandOptions.isTestMode) {
        this.setCached(cacheKey, result);
      }

      // 보고서 전송
      await this.sendReport(interaction, commandOptions, result);

      // 로그 기록 제거됨 - 음성 채널 활동과 관련 없는 보고서 생성 로그

      return {
        success: true,
        message: '활동 보고서가 성공적으로 생성되었습니다.',
        data: result,
      };
    } catch (error) {
      const errorDetails = {
        message: error instanceof Error ? error.message : '알 수 없는 오류',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
        executionTime: Date.now() - startTime,
        role: commandOptions?.role,
        memberCount: undefined as number | undefined,
        dateRange: undefined as any,
      };

      try {
        // 추가 컨텍스트 정보 수집
        if (commandOptions) {
          errorDetails.role = commandOptions.role;
          const roleMembers = await this.getRoleMembers(interaction.guild!, commandOptions.role);
          errorDetails.memberCount = roleMembers.size;
        }
      } catch (contextError) {
        console.warn('[보고서] 에러 컨텍스트 수집 실패:', contextError);
      }

      console.error('보고서 명령어 실행 오류:', errorDetails);

      const errorMessage =
        error instanceof Error ? error.message : '보고서 생성 중 오류가 발생했습니다.';

      // Discord에 상세한 에러 정보 전송
      await interaction.followUp({
        content:
          `❌ **보고서 생성 실패**\n\n` +
          `**오류:** ${errorMessage}\n` +
          `**시간:** ${errorDetails.timestamp}\n` +
          `**소요시간:** ${errorDetails.executionTime}ms\n` +
          `**역할:** ${errorDetails.role || 'N/A'}\n` +
          `**멤버수:** ${errorDetails.memberCount || 'N/A'}\n\n` +
          `콘솔 로그를 확인해주세요.`,
        flags: MessageFlags.Ephemeral,
      });

      return {
        success: false,
        message: errorMessage,
        error: error as Error,
      };
    }
  }

  /**
   * 명령어 옵션 가져오기
   * @param interaction - 상호작용 객체
   */
  private getCommandOptions(interaction: ChatInputCommandInteraction): ReportCommandOptions {
    const startDateStr = interaction.options.getString('start_date')?.trim();
    const endDateStr = interaction.options.getString('end_date')?.trim();

    if (!startDateStr || !endDateStr) {
      throw new Error('시작 날짜와 종료 날짜는 필수입니다.');
    }

    return {
      role: cleanRoleName(interaction.options.getString('role')!),
      startDateStr,
      endDateStr,
      isTestMode: interaction.options.getBoolean('test_mode') ?? false,
    };
  }

  /**
   * 역할 설정 유효성 검사
   * @param roleConfig - 역할 설정
   * @param role - 역할 이름
   * @param interaction - 상호작용 객체
   */
  private validateRoleConfig(
    roleConfig: any,
    role: string,
    interaction: ChatInputCommandInteraction
  ): boolean {
    if (!roleConfig) {
      interaction.followUp({
        content: `❌ 역할 "${role}"에 대한 설정을 찾을 수 없습니다. 먼저 /설정 명령어로 설정해주세요.`,
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }
    return true;
  }

  /**
   * 역할 멤버 가져오기
   * @param guild - 길드
   * @param role - 역할 이름
   */
  private async getRoleMembers(
    guild: NonNullable<ChatInputCommandInteraction['guild']>,
    role: string
  ): Promise<Collection<string, GuildMember>> {
    const startTime = Date.now();
    console.log(`[보고서] getRoleMembers 시작: ${new Date().toISOString()}`);
    console.log(`[보고서] 대상 역할: "${role}"`);
    console.log(`[보고서] 길드 ID: ${guild.id}`);
    console.log(`[보고서] 현재 캐시된 멤버 수: ${guild.members.cache.size}`);

    let members: Collection<string, GuildMember>;

    // 단계별 fetch 전략
    try {
      // 1단계: 캐시 충분성 확인 (작은 서버는 캐시만으로도 충분할 수 있음)
      if (
        guild.members.cache.size > 0 &&
        guild.memberCount &&
        guild.members.cache.size >= guild.memberCount * 0.8
      ) {
        console.log(
          `[보고서] 캐시 충분성 확인: ${guild.members.cache.size}/${guild.memberCount} (${Math.round((guild.members.cache.size / guild.memberCount) * 100)}%)`
        );
        members = guild.members.cache;
        console.log(`[보고서] 캐시된 데이터로 충분 - fetch 생략`);
      } else {
        // 2단계: 전체 fetch 시도 (GuildMembers Intent 필요)
        const fetchStartTime = Date.now();
        console.log(`[보고서] 전체 멤버 fetch 시도 - 20초 타임아웃 설정`);

        const fetchPromise = Promise.race([
          guild.members.fetch(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Member fetch timeout after 20 seconds')), 20000)
          ),
        ]);

        try {
          members = await fetchPromise;
          const fetchEndTime = Date.now();
          console.log(
            `[보고서] 전체 fetch 성공: ${fetchEndTime - fetchStartTime}ms, 총 멤버 수: ${members.size}`
          );
        } catch (fullFetchError) {
          console.warn(`[보고서] 전체 fetch 실패, 부분 fetch 시도:`, fullFetchError);

          // 3단계: 부분 fetch 시도 (제한된 수)
          try {
            members = await Promise.race([
              guild.members.fetch({ limit: 1000 }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Partial fetch timeout after 10 seconds')), 10000)
              ),
            ]);
            console.log(`[보고서] 부분 fetch 성공: ${members.size}명`);
          } catch (partialFetchError) {
            console.warn(`[보고서] 부분 fetch도 실패, 캐시 사용:`, partialFetchError);

            // 4단계: 캐시 사용 (최후의 수단)
            if (guild.members.cache.size > 0) {
              members = guild.members.cache;
              console.log(`[보고서] 캐시된 멤버 사용: ${members.size}명 (불완전할 수 있음)`);
            } else {
              throw new Error(
                `멤버 정보를 가져올 수 없습니다. GuildMembers Intent가 활성화되어 있는지 확인하세요.`
              );
            }
          }
        }
      }
    } catch (error) {
      console.error(`[보고서] 멤버 조회 완전 실패:`, error);
      throw error;
    }

    // 역할 필터링 시작
    const filterStartTime = Date.now();
    console.log(`[보고서] 역할 필터링 시작: "${role}"`);

    const filteredMembers = members.filter((member) => {
      try {
        const hasRole = member.roles.cache.some((r) => r.name === role);
        return hasRole;
      } catch (roleError) {
        console.warn(`[보고서] 멤버 ${member.id} 역할 확인 실패:`, roleError);
        return false;
      }
    });

    const filterEndTime = Date.now();

    console.log(`[보고서] 역할 필터링 완료: ${filterEndTime - filterStartTime}ms`);
    console.log(`[보고서] 필터링 결과: ${filteredMembers.size}명 (전체: ${members.size}명 중)`);
    console.log(`[보고서] getRoleMembers 전체 소요시간: ${Date.now() - startTime}ms`);

    return filteredMembers;
  }

  /**
   * 날짜 형식 검증
   * @param dateStr - 날짜 문자열
   * @param label - 레이블
   */
  private validateDateFormat(dateStr: string, label: string): { isValid: boolean; error?: string } {
    if (!/^\d{6}$/.test(dateStr)) {
      return {
        isValid: false,
        error: `${label} 날짜 형식이 올바르지 않습니다. '${dateStr}'는 'YYMMDD' 형식이어야 합니다. (예: 250413)`,
      };
    }
    return { isValid: true };
  }

  /**
   * 날짜 범위 파싱
   * @param options - 명령어 옵션
   * @param roleConfig - 역할 설정
   * @param interaction - 상호작용 객체
   */
  private async parseDateRange(
    options: ReportCommandOptions,
    _roleConfig: any,
    _interaction: ChatInputCommandInteraction
  ): Promise<DateValidationResult> {
    const { startDateStr, endDateStr } = options;

    // 날짜 형식 검증
    const startValidation = this.validateDateFormat(startDateStr, '시작');
    if (!startValidation.isValid) {
      return startValidation;
    }

    const endValidation = this.validateDateFormat(endDateStr, '종료');
    if (!endValidation.isValid) {
      return endValidation;
    }

    try {
      // 날짜 파싱
      const dateRange = this.parseYYMMDDDates(startDateStr, endDateStr);
      console.log('파싱된 날짜:', dateRange.startDate, dateRange.endDate);

      // 날짜 범위 유효성 검사
      const rangeValidation = this.validateDateRange(dateRange);
      if (!rangeValidation.isValid) {
        return rangeValidation;
      }

      return {
        isValid: true,
        dateRange,
      };
    } catch (error) {
      console.error('날짜 파싱 오류:', error);
      return {
        isValid: false,
        error: `날짜 처리 중 오류가 발생했습니다: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
      };
    }
  }

  /**
   * YYMMDD 형식 날짜 파싱
   * @param startDateStr - 시작 날짜 문자열
   * @param endDateStr - 종료 날짜 문자열
   */
  private parseYYMMDDDates(startDateStr: string, endDateStr: string): DateRange {
    // 시작 날짜 파싱
    const startYear = 2000 + parseInt(startDateStr.substring(0, 2), 10);
    const startMonth = parseInt(startDateStr.substring(2, 4), 10) - 1;
    const startDay = parseInt(startDateStr.substring(4, 6), 10);

    // 종료 날짜 파싱
    const endYear = 2000 + parseInt(endDateStr.substring(0, 2), 10);
    const endMonth = parseInt(endDateStr.substring(2, 4), 10) - 1;
    const endDay = parseInt(endDateStr.substring(4, 6), 10);

    const startDate = new Date(startYear, startMonth, startDay, 0, 0, 0, 0);
    const endDate = new Date(endYear, endMonth, endDay, 23, 59, 59, 999);

    // 날짜 유효성 검사
    if (isNaN(startDate.getTime())) {
      throw new Error(`유효하지 않은 시작 날짜: ${startDateStr}`);
    }

    if (isNaN(endDate.getTime())) {
      throw new Error(`유효하지 않은 종료 날짜: ${endDateStr}`);
    }

    return { startDate, endDate };
  }

  /**
   * 날짜 범위 유효성 검사
   * @param dateRange - 날짜 범위
   */
  private validateDateRange(dateRange: DateRange): DateValidationResult {
    const { startDate, endDate } = dateRange;

    // 시작 날짜가 종료 날짜보다 늦은지 확인
    if (startDate > endDate) {
      return {
        isValid: false,
        error: '시작 날짜가 종료 날짜보다 늦습니다.',
      };
    }

    // 날짜 범위 제한 (최대 1년)
    const maxRange = 365 * 24 * 60 * 60 * 1000; // 1년
    if (endDate.getTime() - startDate.getTime() > maxRange) {
      return {
        isValid: false,
        error: '날짜 범위는 최대 1년까지 가능합니다.',
      };
    }

    // 미래 날짜 확인
    const now = new Date();
    if (startDate > now) {
      return {
        isValid: false,
        error: '시작 날짜가 현재 날짜보다 미래입니다.',
      };
    }

    return { isValid: true };
  }

  /**
   * 보고서 생성
   * @param role - 역할 이름
   * @param roleMembers - 역할 멤버
   * @param dateRange - 날짜 범위
   */
  private async generateReport(
    role: string,
    roleMembers: Collection<string, GuildMember>,
    dateRange: DateRange
  ): Promise<any[]> {
    const startTime = Date.now();
    console.log(`[보고서] generateReport 시작: ${new Date().toISOString()}`);
    console.log(`[보고서] 역할: "${role}", 멤버 수: ${roleMembers.size}`);

    const { startDate, endDate } = dateRange;
    console.log(`[보고서] 날짜 범위: ${startDate.toISOString()} ~ ${endDate.toISOString()}`);

    // 사용자 분류 서비스로 사용자 분류 (날짜 범위 기준)
    const classificationStartTime = Date.now();
    console.log(`[보고서] UserClassificationService.classifyUsersByDateRange 호출 시작`);
    const classificationResult = await this.userClassificationService!.classifyUsersByDateRange(
      role,
      roleMembers,
      startDate,
      endDate
    );
    const classificationEndTime = Date.now();
    console.log(
      `[보고서] UserClassificationService.classifyUsersByDateRange 완료: ${classificationEndTime - classificationStartTime}ms`
    );

    const { activeUsers, inactiveUsers, afkUsers, minHours, reportCycle } = classificationResult;
    console.log(
      `[보고서] 분류 결과 - 활성: ${activeUsers.length}명, 비활성: ${inactiveUsers.length}명, AFK: ${afkUsers.length}명`
    );
    console.log(`[보고서] 최소 활동 시간: ${minHours}시간, 보고 주기: ${reportCycle || 'N/A'}`);

    // 보고서 임베드 생성
    const embedStartTime = Date.now();
    console.log(`[보고서] EmbedFactory.createActivityEmbeds 호출 시작`);
    const embeds = EmbedFactory.createActivityEmbeds({
      role,
      activeUsers,
      inactiveUsers,
      afkUsers,
      startDate,
      endDate,
      minHours,
      reportCycle: reportCycle ? parseInt(reportCycle) : null,
      title: '활동 보고서',
    });
    const embedEndTime = Date.now();
    console.log(
      `[보고서] EmbedFactory.createActivityEmbeds 완료: ${embedEndTime - embedStartTime}ms`
    );
    console.log(`[보고서] 생성된 임베드 수: ${embeds.length}`);
    console.log(`[보고서] generateReport 전체 소요시간: ${Date.now() - startTime}ms`);

    return embeds;
  }

  /**
   * 보고서 전송
   * @param interaction - 상호작용 객체
   * @param options - 명령어 옵션
   * @param result - 보고서 결과
   */
  private async sendReport(
    interaction: ChatInputCommandInteraction,
    options: ReportCommandOptions,
    result: ReportGenerationResult
  ): Promise<void> {
    if (options.isTestMode) {
      // 테스트인 경우 서버 내 Embed로 전송
      await interaction.followUp({
        content:
          `⚠️ **테스트 모드로 실행됩니다.**\n\n` +
          `📊 **실행 시간:** ${result.executionTime}ms\n` +
          `🔄 **리셋 시간이 기록되지 않습니다.**`,
        embeds: result.reportEmbeds,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      // 고정 채널에 전송
      const logChannelId = process.env.REPORT_CHANNEL_ID;
      if (logChannelId) {
        try {
          const logChannel = (await interaction.client.channels.fetch(logChannelId)) as TextChannel;
          if (logChannel?.isTextBased()) {
            await logChannel.send({
              content:
                `📊 **${options.role} 역할 활동 보고서**\n\n` +
                `📅 **기간:** ${this.formatDateRange(result.dateRange)}\n` +
                `⏱️ **생성 시간:** ${result.executionTime}ms`,
              embeds: result.reportEmbeds,
            });
          }
        } catch (error) {
          console.error('로그 채널 전송 실패:', error);
        }
      }

      // 성공 메시지
      let successMessage = `✅ **보고서가 성공적으로 생성되었습니다!**\n\n`;
      successMessage += `📊 **역할:** ${options.role}\n`;
      successMessage += `📅 **기간:** ${this.formatDateRange(result.dateRange)}\n`;
      successMessage += `⏱️ **생성 시간:** ${result.executionTime}ms\n`;

      if (logChannelId) {
        successMessage += `📢 **전송 채널:** <#${logChannelId}>\n`;
      }

      await interaction.followUp({
        content: successMessage,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * 캐시된 보고서 전송
   * @param interaction - 상호작용 객체
   * @param cached - 캐시된 결과
   */
  private async sendCachedReport(
    interaction: ChatInputCommandInteraction,
    cached: ReportGenerationResult
  ): Promise<void> {
    await interaction.followUp({
      content:
        `📋 **캐시된 보고서를 사용합니다.**\n\n` +
        `📊 **역할:** ${cached.role}\n` +
        `📅 **기간:** ${this.formatDateRange(cached.dateRange)}\n` +
        `⏱️ **원본 생성 시간:** ${cached.executionTime}ms\n` +
        `🔄 **캐시 사용으로 즉시 전송됩니다.**`,
      flags: MessageFlags.Ephemeral,
    });
  }

  /**
   * 캐시 키 생성
   * @param options - 명령어 옵션
   */
  private generateCacheKey(options: ReportCommandOptions): string {
    const dateKey = `${options.startDateStr}_${options.endDateStr}`;
    return `report_${options.role}_${dateKey}`;
  }

  /**
   * 날짜 범위 포맷팅
   * @param dateRange - 날짜 범위
   */
  private formatDateRange(dateRange: DateRange): string {
    const startStr = dateRange.startDate.toLocaleDateString('ko-KR');
    const endStr = dateRange.endDate.toLocaleDateString('ko-KR');
    return `${startStr} ~ ${endStr}`;
  }

  /**
   * 처리 시간 추정
   * @param memberCount - 멤버 수
   */
  private estimateProcessingTime(memberCount: number): number {
    return Math.max(5, Math.ceil(memberCount / 10)); // 멤버 10명당 1초, 최소 5초
  }

  /**
   * 명령어 도움말 생성
   */
  public getHelp(): string {
    return `**${this.metadata.name}** - ${this.metadata.description}

**사용법:**
\`${this.metadata.usage}\`

**설명:**
• 지정된 역할의 활동 보고서를 생성합니다.
• 날짜 범위를 지정하여 특정 기간의 보고서를 생성할 수 있습니다.
• 테스트 모드에서는 리셋 시간이 기록되지 않습니다.
• 관리자 권한이 필요합니다.

**옵션:**
• \`role\`: 보고서를 생성할 역할 이름 (필수)
• \`start_date\`: 시작 날짜 (YYMMDD 형식, 필수)
• \`end_date\`: 종료 날짜 (YYMMDD 형식, 필수)
• \`test_mode\`: 테스트 모드 (선택사항)

**예시:**
${this.metadata.examples?.map((ex) => `\`${ex}\``).join('\n')}

**권한:** 관리자 전용
**쿨다운:** ${this.metadata.cooldown}초`;
  }
}
