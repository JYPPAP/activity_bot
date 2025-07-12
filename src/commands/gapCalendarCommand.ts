// src/commands/gapCalendarCommand.ts - 달력 형태의 활동 보고서 명령어
import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder, TextChannel, ThreadChannel } from 'discord.js';
import { cleanRoleName } from '../utils/formatters.js';
import { CommandBase, CommandServices, CommandResult, CommandExecutionOptions, CommandMetadata } from './CommandBase.js';

// 보고서 생성 결과 인터페이스
interface CalendarReportResult {
  startDate: Date;
  endDate: Date;
  roles?: string[];
  reportType: 'role' | 'general';
  channel: TextChannel | ThreadChannel;
  duration: number;
}

// 날짜 유효성 검사 결과
interface DateValidationResult {
  isValid: boolean;
  error?: string;
  parsedStartDate?: Date;
  parsedEndDate?: Date;
}

// 보고서 생성 옵션
interface ReportGenerationOptions {
  startDate: Date;
  endDate: Date;
  roles?: string[];
  includeDetails?: boolean;
  includeStatistics?: boolean;
  includeCharts?: boolean;
  maxDays?: number;
}

export class GapCalendarCommand extends CommandBase {
  public readonly metadata: CommandMetadata = {
    name: 'gap_calendar',
    description: '달력 형태의 활동 보고서를 생성합니다.',
    category: 'activity',
    cooldown: 30,
    guildOnly: true,
    usage: '/gap_calendar start_date:<시작날짜> end_date:<종료날짜> [role:<역할>]',
    examples: [
      '/gap_calendar start_date:2024-01-01 end_date:2024-01-31',
      '/gap_calendar start_date:2024-01-01 end_date:2024-01-31 role:정규',
      '/gap_calendar start_date:2024-01-01 end_date:2024-01-31 role:정규,준회원'
    ],
    aliases: ['calendar', '달력', '활동달력']
  };

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
      .addStringOption(option =>
        option
          .setName('start_date')
          .setDescription('시작 날짜 (YYYY-MM-DD 형식)')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('end_date')
          .setDescription('종료 날짜 (YYYY-MM-DD 형식)')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('role')
          .setDescription('조회할 역할 (쉼표로 구분하여 여러 역할 가능)')
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('include_details')
          .setDescription('상세 정보 포함 여부')
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('include_statistics')
          .setDescription('통계 정보 포함 여부')
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('include_charts')
          .setDescription('차트 생성 여부')
          .setRequired(false)
      )
      .addIntegerOption(option =>
        option
          .setName('max_days')
          .setDescription('최대 조회 일수 (기본값: 31일)')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(365)
      ) as SlashCommandBuilder;
  }

  /**
   * gap_calendar 명령어의 실제 실행 로직
   * @param interaction - 상호작용 객체
   * @param options - 실행 옵션
   */
  protected async executeCommand(interaction: ChatInputCommandInteraction, _options: CommandExecutionOptions): Promise<CommandResult> {
    try {
      // 명령어 옵션 가져오기
      const startDateStr = interaction.options.getString("start_date");
      const endDateStr = interaction.options.getString("end_date");
      const roleOption = interaction.options.getString("role");
      const includeDetails = interaction.options.getBoolean("include_details") || false;
      const includeStatistics = interaction.options.getBoolean("include_statistics") || false;
      const includeCharts = interaction.options.getBoolean("include_charts") || false;
      const maxDays = interaction.options.getInteger("max_days") || 31;

      if (!startDateStr || !endDateStr) {
        return {
          success: false,
          message: "시작 날짜와 종료 날짜를 모두 입력해주세요."
        };
      }

      // 날짜 유효성 검사
      const dateValidation = this.validateDates(startDateStr, endDateStr, maxDays);
      if (!dateValidation.isValid) {
        return {
          success: false,
          message: dateValidation.error || "날짜 형식이 올바르지 않습니다."
        };
      }

      const { parsedStartDate, parsedEndDate } = dateValidation;
      if (!parsedStartDate || !parsedEndDate) {
        return {
          success: false,
          message: "날짜 파싱에 실패했습니다."
        };
      }

      // 채널 확인
      const channel = interaction.channel;
      if (!channel || !channel.isTextBased()) {
        return {
          success: false,
          message: "이 명령어는 텍스트 채널에서만 사용할 수 있습니다."
        };
      }

      // 캐시 확인
      const cacheKey = this.generateCacheKey(parsedStartDate, parsedEndDate, roleOption);
      const cached = this.getCached<CalendarReportResult>(cacheKey);
      
      if (cached) {
        await interaction.followUp({
          content: '📋 **캐시된 보고서를 사용합니다.**\n\n' +
                  `📅 **기간:** ${this.formatDateRange(parsedStartDate, parsedEndDate)}\n` +
                  `📊 **유형:** ${cached.reportType === 'role' ? '역할별 보고서' : '전체 활동 보고서'}\n` +
                  `⏱️ **생성 시간:** ${cached.duration}ms`,
          flags: MessageFlags.Ephemeral,
        });
        
        return {
          success: true,
          message: '캐시된 보고서를 전송했습니다.',
          data: cached
        };
      }

      const startTime = Date.now();

      // 보고서 생성 옵션 설정
      const reportOptions: ReportGenerationOptions = {
        startDate: parsedStartDate,
        endDate: parsedEndDate,
        includeDetails,
        includeStatistics,
        includeCharts,
        maxDays
      };

      // 역할별 보고서 또는 전체 보고서 생성
      let result: CalendarReportResult;
      
      if (roleOption) {
        const roles = roleOption.split(',').map(r => cleanRoleName(r.trim()));
        reportOptions.roles = roles;
        
        await interaction.followUp({
          content: `📊 **${roles.join(', ')} 역할의 활동 보고서를 생성합니다...**\n\n` +
                  `📅 **기간:** ${this.formatDateRange(parsedStartDate, parsedEndDate)}\n` +
                  `⏳ **예상 소요 시간:** ${this.estimateGenerationTime(parsedStartDate, parsedEndDate, roles.length)}초`,
          flags: MessageFlags.Ephemeral,
        });

        // 역할별 보고서 생성
        await this.calendarLogService.sendRoleActivityReport(
          parsedStartDate,
          parsedEndDate.getTime(),
          roles,
          channel as TextChannel | ThreadChannel
        );

        result = {
          startDate: parsedStartDate,
          endDate: parsedEndDate,
          roles,
          reportType: 'role',
          channel: channel as TextChannel | ThreadChannel,
          duration: Date.now() - startTime
        };
      } else {
        await interaction.followUp({
          content: `📊 **전체 활동 요약 보고서를 생성합니다...**\n\n` +
                  `📅 **기간:** ${this.formatDateRange(parsedStartDate, parsedEndDate)}\n` +
                  `⏳ **예상 소요 시간:** ${this.estimateGenerationTime(parsedStartDate, parsedEndDate)}초`,
          flags: MessageFlags.Ephemeral,
        });

        // 전체 활동 요약 보고서 생성
        await this.calendarLogService.sendDateRangeLog(
          parsedStartDate,
          parsedEndDate.getTime(),
          channel as TextChannel | ThreadChannel
        );

        result = {
          startDate: parsedStartDate,
          endDate: parsedEndDate,
          reportType: 'general',
          channel: channel as TextChannel | ThreadChannel,
          duration: Date.now() - startTime
        };
      }

      // 캐시 저장
      this.setCached(cacheKey, result);

      // 완료 알림
      await interaction.followUp({
        content: `✅ **보고서 생성이 완료되었습니다!**\n\n` +
                `📊 **유형:** ${result.reportType === 'role' ? '역할별 보고서' : '전체 활동 보고서'}\n` +
                `⏱️ **생성 시간:** ${result.duration}ms\n` +
                `📋 **결과:** 위의 메시지를 확인해주세요.`,
        flags: MessageFlags.Ephemeral,
      });

      // 로그 기록
      if (this.logService) {
        this.logService.logActivity(
          `달력 보고서 생성`,
          [interaction.user.id],
          'calendar_report',
          {
            startDate: parsedStartDate.toISOString(),
            endDate: parsedEndDate.toISOString(),
            roles: result.roles,
            reportType: result.reportType,
            duration: result.duration,
            includeDetails,
            includeStatistics,
            includeCharts
          }
        );
      }

      return {
        success: true,
        message: '활동 보고서가 성공적으로 생성되었습니다.',
        data: result
      };

    } catch (error) {
      console.error('gap_calendar 명령어 실행 오류:', error);
      
      const errorMessage = error instanceof Error ? error.message : '활동 보고서 생성 중 오류가 발생했습니다.';
      
      await interaction.followUp({
        content: `❌ ${errorMessage}`,
        flags: MessageFlags.Ephemeral,
      });

      return {
        success: false,
        message: errorMessage,
        error: error as Error
      };
    }
  }

  /**
   * 날짜 유효성 검사
   * @param startDateStr - 시작 날짜 문자열
   * @param endDateStr - 종료 날짜 문자열
   * @param maxDays - 최대 일수
   */
  private validateDates(startDateStr: string, endDateStr: string, maxDays: number): DateValidationResult {
    // 날짜 형식 검사 (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    
    if (!dateRegex.test(startDateStr)) {
      return {
        isValid: false,
        error: `시작 날짜 형식이 올바르지 않습니다. 'YYYY-MM-DD' 형식으로 입력해주세요. (입력값: ${startDateStr})`
      };
    }

    if (!dateRegex.test(endDateStr)) {
      return {
        isValid: false,
        error: `종료 날짜 형식이 올바르지 않습니다. 'YYYY-MM-DD' 형식으로 입력해주세요. (입력값: ${endDateStr})`
      };
    }

    // 날짜 파싱
    const parsedStartDate = new Date(startDateStr);
    const parsedEndDate = new Date(endDateStr);

    // 유효한 날짜인지 확인
    if (isNaN(parsedStartDate.getTime())) {
      return {
        isValid: false,
        error: `유효하지 않은 시작 날짜입니다: ${startDateStr}`
      };
    }

    if (isNaN(parsedEndDate.getTime())) {
      return {
        isValid: false,
        error: `유효하지 않은 종료 날짜입니다: ${endDateStr}`
      };
    }

    // 날짜 순서 확인
    if (parsedStartDate > parsedEndDate) {
      return {
        isValid: false,
        error: '시작 날짜가 종료 날짜보다 늦습니다.'
      };
    }

    // 날짜 범위 확인
    const daysDiff = Math.ceil((parsedEndDate.getTime() - parsedStartDate.getTime()) / (24 * 60 * 60 * 1000));
    if (daysDiff > maxDays) {
      return {
        isValid: false,
        error: `날짜 범위가 너무 깁니다. 최대 ${maxDays}일까지 가능합니다. (현재: ${daysDiff}일)`
      };
    }

    // 미래 날짜 확인
    const now = new Date();
    if (parsedStartDate > now) {
      return {
        isValid: false,
        error: '시작 날짜가 현재 날짜보다 미래입니다.'
      };
    }

    return {
      isValid: true,
      parsedStartDate,
      parsedEndDate
    };
  }

  /**
   * 캐시 키 생성
   * @param startDate - 시작 날짜
   * @param endDate - 종료 날짜
   * @param roleOption - 역할 옵션
   */
  private generateCacheKey(startDate: Date, endDate: Date, roleOption: string | null): string {
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];
    const roleStr = roleOption ? `_${roleOption.replace(/,/g, '_')}` : '';
    
    return `calendar_report_${startStr}_${endStr}${roleStr}`;
  }

  /**
   * 날짜 범위 포맷팅
   * @param startDate - 시작 날짜
   * @param endDate - 종료 날짜
   */
  private formatDateRange(startDate: Date, endDate: Date): string {
    const startStr = startDate.toLocaleDateString('ko-KR');
    const endStr = endDate.toLocaleDateString('ko-KR');
    return `${startStr} ~ ${endStr}`;
  }

  /**
   * 생성 시간 추정
   * @param startDate - 시작 날짜
   * @param endDate - 종료 날짜
   * @param roleCount - 역할 수 (선택사항)
   */
  private estimateGenerationTime(startDate: Date, endDate: Date, roleCount: number = 1): number {
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    const baseTime = Math.max(5, Math.ceil(daysDiff / 7)); // 주당 1초, 최소 5초
    return baseTime * roleCount;
  }

  /**
   * 미리보기 생성
   * @param interaction - 상호작용 객체
   * @param startDate - 시작 날짜
   * @param endDate - 종료 날짜
   */
  async generatePreview(interaction: ChatInputCommandInteraction, startDate: Date, endDate: Date): Promise<void> {
    try {
      const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
      const weeksDiff = Math.ceil(daysDiff / 7);
      
      const previewMessage = `📊 **보고서 미리보기**\n\n` +
                           `📅 **기간:** ${this.formatDateRange(startDate, endDate)}\n` +
                           `📆 **총 일수:** ${daysDiff}일\n` +
                           `📅 **총 주수:** ${weeksDiff}주\n` +
                           `⏱️ **예상 생성 시간:** ${this.estimateGenerationTime(startDate, endDate)}초\n\n` +
                           `계속 진행하시겠습니까?`;

      await interaction.followUp({
        content: previewMessage,
        flags: MessageFlags.Ephemeral,
      });

    } catch (error) {
      console.error('미리보기 생성 오류:', error);
    }
  }

  /**
   * 명령어 도움말 생성
   */
  public getHelp(): string {
    return `**${this.metadata.name}** - ${this.metadata.description}

**사용법:**
\`${this.metadata.usage}\`

**설명:**
• 지정된 기간의 활동 데이터를 달력 형태로 시각화합니다.
• 역할별 또는 전체 활동 보고서를 생성할 수 있습니다.
• 상세 정보, 통계, 차트를 선택적으로 포함할 수 있습니다.

**옵션:**
• \`start_date\`: 시작 날짜 (YYYY-MM-DD 형식, 필수)
• \`end_date\`: 종료 날짜 (YYYY-MM-DD 형식, 필수)
• \`role\`: 조회할 역할 (쉼표로 구분, 선택사항)
• \`include_details\`: 상세 정보 포함 여부 (선택사항)
• \`include_statistics\`: 통계 정보 포함 여부 (선택사항)
• \`include_charts\`: 차트 생성 여부 (선택사항)
• \`max_days\`: 최대 조회 일수 (선택사항, 기본값: 31일)

**예시:**
${this.metadata.examples?.map(ex => `\`${ex}\``).join('\n')}

**제한사항:**
• 최대 365일까지 조회 가능
• 미래 날짜는 조회할 수 없음
• 보고서 생성에 시간이 소요될 수 있음

**쿨다운:** ${this.metadata.cooldown}초
**권한:** 서버 전용`;
  }
}