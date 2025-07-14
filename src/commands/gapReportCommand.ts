// src/commands/gapReportCommand.ts - gap_report 명령어
import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
  Collection,
  GuildMember,
  TextChannel,
} from 'discord.js';

import { UserClassificationService } from '../services/UserClassificationService.js';
import { EmbedFactory } from '../utils/embedBuilder.js';
import { cleanRoleName } from '../utils/formatters.js';

import {
  CommandBase,
  CommandServices,
  CommandResult,
  CommandExecutionOptions,
  CommandMetadata,
} from './CommandBase.js';

// 명령어 옵션 인터페이스
interface ReportCommandOptions {
  role: string;
  startDateStr?: string;
  endDateStr?: string;
  isTestMode: boolean;
  resetOption: boolean;
  logChannelId?: string;
  includeStatistics?: boolean;
  includeCharts?: boolean;
  exportFormat?: 'embed' | 'csv' | 'json';
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

export class GapReportCommand extends CommandBase {
  public readonly metadata: CommandMetadata = {
    name: 'gap_report',
    description: '역할별 활동 보고서를 생성합니다.',
    category: 'administration',
    permissions: ['Administrator'],
    cooldown: 60,
    adminOnly: true,
    guildOnly: true,
    usage: '/gap_report role:<역할이름> [start_date:<시작날짜>] [end_date:<종료날짜>]',
    examples: [
      '/gap_report role:정규',
      '/gap_report role:정규 test_mode:true',
      '/gap_report role:정규 start_date:241201 end_date:241231',
      '/gap_report role:정규 reset:true log_channel:#보고서',
    ],
    aliases: ['report', '보고서'],
  };

  private userClassificationService: UserClassificationService | null = null;

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
          .setDescription('시작 날짜 (YYMMDD 형식, 선택사항)')
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName('end_date')
          .setDescription('종료 날짜 (YYMMDD 형식, 선택사항)')
          .setRequired(false)
      )
      .addBooleanOption((option) =>
        option
          .setName('test_mode')
          .setDescription('테스트 모드 (리셋 시간 기록 안함)')
          .setRequired(false)
      )
      .addBooleanOption((option) =>
        option.setName('reset').setDescription('보고서 생성 후 활동 시간 리셋').setRequired(false)
      )
      .addChannelOption((option) =>
        option.setName('log_channel').setDescription('보고서를 전송할 채널').setRequired(false)
      )
      .addBooleanOption((option) =>
        option
          .setName('include_statistics')
          .setDescription('통계 정보 포함 여부')
          .setRequired(false)
      )
      .addBooleanOption((option) =>
        option.setName('include_charts').setDescription('차트 생성 여부').setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName('export_format')
          .setDescription('내보내기 형식')
          .setRequired(false)
          .addChoices(
            { name: '임베드', value: 'embed' },
            { name: 'CSV', value: 'csv' },
            { name: 'JSON', value: 'json' }
          )
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
   * gap_report 명령어의 실제 실행 로직
   * @param interaction - 상호작용 객체
   * @param options - 실행 옵션
   */
  protected async executeCommand(
    interaction: ChatInputCommandInteraction,
    _options: CommandExecutionOptions
  ): Promise<CommandResult> {
    const startTime = Date.now();

    try {
      // 서비스 의존성 확인
      if (!this.userClassificationService) {
        throw new Error('UserClassificationService가 초기화되지 않았습니다.');
      }

      // 명령어 옵션 가져오기
      const commandOptions = this.getCommandOptions(interaction);

      // 캐시 확인
      const cacheKey = this.generateCacheKey(commandOptions);
      const cached = this.getCached<ReportGenerationResult>(cacheKey);

      if (cached && !commandOptions.isTestMode) {
        await this.sendCachedReport(interaction, cached);
        return {
          success: true,
          message: '캐시된 보고서를 전송했습니다.',
          data: cached,
        };
      }

      // 최신 데이터로 갱신
      await this.activityTracker.saveActivityData();

      // 역할 설정 가져오기
      const roleConfig = await this.dbManager.getRoleConfig(commandOptions.role);
      if (!this.validateRoleConfig(roleConfig, commandOptions.role, interaction)) {
        return {
          success: false,
          message: `역할 "${commandOptions.role}"에 대한 설정을 찾을 수 없습니다.`,
        };
      }

      // 현재 역할을 가진 멤버 가져오기
      const roleMembers = await this.getRoleMembers(interaction.guild!, commandOptions.role);
      if (roleMembers.size === 0) {
        return {
          success: false,
          message: `역할 "${commandOptions.role}"을 가진 멤버가 없습니다.`,
        };
      }

      // 날짜 범위 설정
      const dateValidation = await this.parseDateRange(commandOptions, roleConfig, interaction);
      if (!dateValidation.isValid || !dateValidation.dateRange) {
        return {
          success: false,
          message: dateValidation.error || '날짜 범위 설정에 실패했습니다.',
        };
      }

      // 진행 상황 알림
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
      const reportEmbeds = await this.generateReport(
        commandOptions.role,
        roleMembers,
        dateValidation.dateRange
      );

      // 통계 생성
      const statistics = commandOptions.includeStatistics
        ? await this.generateStatistics(roleMembers, dateValidation.dateRange)
        : undefined;

      // 보고서 결과 생성
      const result: ReportGenerationResult = {
        role: commandOptions.role,
        dateRange: dateValidation.dateRange,
        reportEmbeds,
        executionTime: Date.now() - startTime,
        testMode: commandOptions.isTestMode,
      };

      if (statistics) {
        result.statistics = statistics;
      }

      // 캐시 저장 (테스트 모드가 아닌 경우만)
      if (!commandOptions.isTestMode) {
        this.setCached(cacheKey, result);
      }

      // 보고서 전송
      await this.sendReport(interaction, commandOptions, result);

      // 리셋 처리
      await this.handleReset(interaction, commandOptions);

      // 로그 기록
      if (this.logService) {
        this.logService.logActivity(
          `활동 보고서 생성: ${commandOptions.role}`,
          [interaction.user.id],
          'report_generation',
          {
            role: commandOptions.role,
            dateRange: this.formatDateRange(dateValidation.dateRange),
            memberCount: roleMembers.size,
            testMode: commandOptions.isTestMode,
            executionTime: result.executionTime,
            statistics: result.statistics,
          }
        );
      }

      return {
        success: true,
        message: '활동 보고서가 성공적으로 생성되었습니다.',
        data: result,
      };
    } catch (error) {
      console.error('gap_report 명령어 실행 오류:', error);

      const errorMessage =
        error instanceof Error ? error.message : '보고서 생성 중 오류가 발생했습니다.';

      await interaction.followUp({
        content: `❌ ${errorMessage}`,
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
    const options: ReportCommandOptions = {
      role: cleanRoleName(interaction.options.getString('role')!),
      isTestMode: interaction.options.getBoolean('test_mode') ?? false,
      resetOption: interaction.options.getBoolean('reset') ?? false,
      includeStatistics: interaction.options.getBoolean('include_statistics') ?? false,
      includeCharts: interaction.options.getBoolean('include_charts') ?? false,
      exportFormat:
        (interaction.options.getString('export_format') as 'embed' | 'csv' | 'json') || 'embed',
    };

    const startDateStr = interaction.options.getString('start_date')?.trim();
    const endDateStr = interaction.options.getString('end_date')?.trim();
    const logChannelId =
      interaction.options.getChannel('log_channel')?.id || process.env.CALENDAR_LOG_CHANNEL_ID;

    if (startDateStr) options.startDateStr = startDateStr;
    if (endDateStr) options.endDateStr = endDateStr;
    if (logChannelId) options.logChannelId = logChannelId;

    return options;
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
        content: `❌ 역할 "${role}"에 대한 설정을 찾을 수 없습니다. 먼저 /gap_config 명령어로 설정해주세요.`,
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
    const members = await guild.members.fetch();
    return members.filter((member) => member.roles.cache.some((r) => r.name === role));
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
    roleConfig: any,
    _interaction: ChatInputCommandInteraction
  ): Promise<DateValidationResult> {
    const { startDateStr, endDateStr } = options;

    // 날짜 옵션이 제공된 경우
    if (startDateStr && endDateStr) {
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
    } else if (startDateStr || endDateStr) {
      // 시작 날짜 또는 종료 날짜만 제공된 경우
      return {
        isValid: false,
        error: '시작 날짜와 종료 날짜를 모두 제공하거나 둘 다 생략해야 합니다.',
      };
    } else {
      // 날짜가 지정되지 않은 경우 기본값 사용
      return {
        isValid: true,
        dateRange: this.getDefaultDateRange(roleConfig),
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
   * 기본 날짜 범위 반환
   * @param roleConfig - 역할 설정
   */
  private getDefaultDateRange(roleConfig: any): DateRange {
    const startDate = roleConfig.resetTime
      ? new Date(roleConfig.resetTime)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7일 전
    const endDate = new Date();

    return { startDate, endDate };
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
    const { startDate, endDate } = dateRange;

    // 사용자 분류 서비스로 사용자 분류 (날짜 범위 기준)
    const classificationResult = await this.userClassificationService!.classifyUsersByDateRange(
      role,
      roleMembers,
      startDate,
      endDate
    );

    const { activeUsers, inactiveUsers, afkUsers, minHours, reportCycle } = classificationResult;

    // 보고서 임베드 생성
    return EmbedFactory.createActivityEmbeds({
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
  }

  /**
   * 통계 생성
   * @param roleMembers - 역할 멤버
   * @param dateRange - 날짜 범위
   */
  private async generateStatistics(
    roleMembers: Collection<string, GuildMember>,
    _dateRange: DateRange
  ): Promise<ReportGenerationResult['statistics']> {
    // 간단한 통계 생성 (실제 구현에서는 더 상세한 통계 생성)
    const totalMembers = roleMembers.size;

    // 임시 통계 (실제 구현에서는 사용자 분류 결과를 사용)
    return {
      totalMembers,
      activeCount: 0,
      inactiveCount: 0,
      afkCount: 0,
      averageActivity: 0,
    };
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
      // 지정된 채널에 전송
      if (options.logChannelId) {
        try {
          const logChannel = (await interaction.client.channels.fetch(
            options.logChannelId
          )) as TextChannel;
          if (logChannel?.isTextBased()) {
            await logChannel.send({
              content:
                `📊 **${options.role} 역할 활동 보고서**\n\n` +
                `📅 **기간:** ${this.formatDateRange(result.dateRange)}\n` +
                `⏱️ **생성 시간:** ${result.executionTime}ms\n` +
                `🔢 **대상 멤버:** ${result.statistics?.totalMembers || 0}명`,
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

      if (result.statistics) {
        successMessage += `👥 **대상 멤버:** ${result.statistics.totalMembers}명\n`;
      }

      if (options.logChannelId) {
        successMessage += `📢 **전송 채널:** <#${options.logChannelId}>\n`;
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
   * 리셋 처리
   * @param interaction - 상호작용 객체
   * @param options - 명령어 옵션
   */
  private async handleReset(
    interaction: ChatInputCommandInteraction,
    options: ReportCommandOptions
  ): Promise<void> {
    // 테스트 모드가 아니고, 리셋 옵션이 켜져 있을 경우에만 리셋 시간 업데이트
    if (!options.isTestMode && options.resetOption) {
      try {
        await this.dbManager.updateRoleResetTime(options.role, Date.now(), '보고서 출력 시 리셋');
        await interaction.followUp({
          content: `🔄 **${options.role} 역할의 활동 시간이 리셋되었습니다.**`,
          flags: MessageFlags.Ephemeral,
        });
      } catch (error) {
        console.error('리셋 처리 실패:', error);
        await interaction.followUp({
          content: `❌ **활동 시간 리셋 중 오류가 발생했습니다.**`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }

  /**
   * 캐시 키 생성
   * @param options - 명령어 옵션
   */
  private generateCacheKey(options: ReportCommandOptions): string {
    const dateKey =
      options.startDateStr && options.endDateStr
        ? `${options.startDateStr}_${options.endDateStr}`
        : 'default';

    return `report_${options.role}_${dateKey}_${options.includeStatistics}_${options.includeCharts}`;
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
• \`start_date\`: 시작 날짜 (YYMMDD 형식, 선택사항)
• \`end_date\`: 종료 날짜 (YYMMDD 형식, 선택사항)
• \`test_mode\`: 테스트 모드 (선택사항)
• \`reset\`: 보고서 생성 후 활동 시간 리셋 (선택사항)
• \`log_channel\`: 보고서를 전송할 채널 (선택사항)
• \`include_statistics\`: 통계 정보 포함 여부 (선택사항)
• \`include_charts\`: 차트 생성 여부 (선택사항)
• \`export_format\`: 내보내기 형식 (선택사항)

**예시:**
${this.metadata.examples?.map((ex) => `\`${ex}\``).join('\n')}

**권한:** 관리자 전용
**쿨다운:** ${this.metadata.cooldown}초`;
  }
}
