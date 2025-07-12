// src/commands/gapCheckCommand.ts - 시간체크 명령어 (수정)
import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder, User } from 'discord.js';
import { formatTime } from '../utils/formatters.js';
import { CommandBase, CommandServices, CommandResult, CommandExecutionOptions, CommandMetadata } from './CommandBase.js';

// 날짜 범위 인터페이스
interface DateRange {
  startDate: Date;
  endDate: Date;
  startDateStr: string;
  endDateStr: string;
}

// 활동 조회 결과
interface ActivityCheckResult {
  user: User;
  totalTime: number;
  dateRange?: DateRange;
  formattedTime: string;
  additionalInfo?: {
    averageDaily?: number;
    weeklyAverage?: number;
    peakActivity?: number;
    activeDays?: number;
  };
}

export class GapCheckCommand extends CommandBase {
  public readonly metadata: CommandMetadata = {
    name: '시간체크',
    description: '사용자의 활동 시간을 조회합니다.',
    category: 'activity',
    cooldown: 3,
    guildOnly: true,
    usage: '/시간체크 user:<사용자> [start_date:<시작날짜>] [end_date:<종료날짜>]',
    examples: [
      '/시간체크 user:@사용자',
      '/시간체크 user:@사용자 start_date:241201 end_date:241231'
    ],
    aliases: ['활동시간', 'checktime', 'time']
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
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('조회할 사용자')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('start_date')
          .setDescription('시작 날짜 (YYMMDD 형식, 예: 241201)')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('end_date')
          .setDescription('종료 날짜 (YYMMDD 형식, 예: 241231)')
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('detailed')
          .setDescription('상세 정보 표시 여부')
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('public')
          .setDescription('공개 응답 여부 (기본값: 비공개)')
          .setRequired(false)
      ) as SlashCommandBuilder;
  }

  /**
   * 시간체크 명령어의 실제 실행 로직
   * @param interaction - 상호작용 객체
   * @param options - 실행 옵션
   */
  protected async executeCommand(interaction: ChatInputCommandInteraction, options: CommandExecutionOptions): Promise<CommandResult> {
    try {
      // 명령어 옵션 가져오기
      const user = interaction.options.getUser("user");
      const startDateStr = interaction.options.getString("start_date")?.trim();
      const endDateStr = interaction.options.getString("end_date")?.trim();
      const detailed = interaction.options.getBoolean("detailed") || false;
      const isPublic = interaction.options.getBoolean("public") || false;

      if (!user) {
        throw new Error('사용자를 선택해야 합니다.');
      }

      const userId = user.id;

      // 캐시 확인
      const cacheKey = `activity_check_${userId}_${startDateStr || 'all'}_${endDateStr || 'all'}`;
      const cached = this.getCached<ActivityCheckResult>(cacheKey);
      
      if (cached) {
        await this.sendActivityResult(interaction, cached, isPublic);
        return {
          success: true,
          message: '캐시된 활동 데이터를 전송했습니다.',
          data: cached
        };
      }

      // 현재 활동 데이터 저장 (최신 데이터 확보)
      await this.activityTracker.saveActivityData();

      // 날짜 범위 처리
      let dateRange: DateRange | undefined;
      let totalTime: number;

      if (startDateStr && endDateStr) {
        // 날짜 형식 검증
        const dateValidation = this.validateDateRange(startDateStr, endDateStr);
        if (!dateValidation.isValid) {
          return {
            success: false,
            message: dateValidation.error || '날짜 형식이 올바르지 않습니다.'
          };
        }

        dateRange = this.parseYYMMDDDates(startDateStr, endDateStr);
        
        // 특정 기간의 활동 시간 조회
        totalTime = await this.dbManager.getUserActivityByDateRange(
          userId,
          dateRange.startDate.getTime(),
          dateRange.endDate.getTime()
        ) || 0;

      } else if (startDateStr || endDateStr) {
        // 시작 날짜 또는 종료 날짜만 제공된 경우
        return {
          success: false,
          message: '시작 날짜와 종료 날짜를 모두 제공하거나 둘 다 생략해야 합니다.'
        };
      } else {
        // 전체 활동 시간 조회
        const activity = await this.dbManager.getUserActivity(userId);
        totalTime = activity?.totalTime || 0;
      }

      // 활동 결과 객체 생성
      const result: ActivityCheckResult = {
        user,
        totalTime,
        dateRange,
        formattedTime: formatTime(totalTime)
      };

      // 상세 정보 생성
      if (detailed && dateRange) {
        result.additionalInfo = await this.generateDetailedInfo(userId, dateRange);
      }

      // 캐시 저장
      this.setCached(cacheKey, result);

      // 응답 전송
      await this.sendActivityResult(interaction, result, isPublic);

      // 로그 기록
      if (this.logService) {
        this.logService.logActivity(
          `활동 시간 조회: ${user.username}`,
          [interaction.user.id, userId],
          'activity_check',
          {
            target: userId,
            totalTime,
            dateRange: dateRange ? `${dateRange.startDateStr} ~ ${dateRange.endDateStr}` : 'all',
            detailed
          }
        );
      }

      return {
        success: true,
        message: '활동 시간 조회가 완료되었습니다.',
        data: result
      };

    } catch (error) {
      console.error('시간체크 명령어 실행 오류:', error);
      
      const errorMessage = error instanceof Error ? error.message : '활동 시간 확인 중 오류가 발생했습니다.';
      
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
   * 날짜 범위 유효성 검사
   * @param startDateStr - 시작 날짜 문자열
   * @param endDateStr - 종료 날짜 문자열
   */
  private validateDateRange(startDateStr: string, endDateStr: string): { isValid: boolean; error?: string } {
    // 형식 검증
    if (!/^\d{6}$/.test(startDateStr)) {
      return {
        isValid: false,
        error: `시작 날짜 형식이 올바르지 않습니다. '${startDateStr}'는 'YYMMDD' 형식이어야 합니다. (예: 241201)`
      };
    }

    if (!/^\d{6}$/.test(endDateStr)) {
      return {
        isValid: false,
        error: `종료 날짜 형식이 올바르지 않습니다. '${endDateStr}'는 'YYMMDD' 형식이어야 합니다. (예: 241231)`
      };
    }

    try {
      const { startDate, endDate } = this.parseYYMMDDDates(startDateStr, endDateStr);
      
      // 날짜 순서 확인
      if (startDate > endDate) {
        return {
          isValid: false,
          error: '시작 날짜가 종료 날짜보다 늦습니다.'
        };
      }

      // 날짜 범위 제한 (최대 1년)
      const maxRange = 365 * 24 * 60 * 60 * 1000; // 1년
      if (endDate.getTime() - startDate.getTime() > maxRange) {
        return {
          isValid: false,
          error: '날짜 범위는 최대 1년까지 가능합니다.'
        };
      }

      return { isValid: true };

    } catch (error) {
      return {
        isValid: false,
        error: error instanceof Error ? error.message : '날짜 파싱 중 오류가 발생했습니다.'
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

    return {
      startDate,
      endDate,
      startDateStr,
      endDateStr
    };
  }

  /**
   * 상세 정보 생성
   * @param userId - 사용자 ID
   * @param dateRange - 날짜 범위
   */
  private async generateDetailedInfo(userId: string, dateRange: DateRange): Promise<ActivityCheckResult['additionalInfo']> {
    try {
      const { startDate, endDate } = dateRange;
      const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
      
      // 일별 활동 데이터 수집
      const dailyActivities: number[] = [];
      for (let i = 0; i < totalDays; i++) {
        const dayStart = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
        
        const dayActivity = await this.dbManager.getUserActivityByDateRange(
          userId,
          dayStart.getTime(),
          dayEnd.getTime()
        ) || 0;
        
        dailyActivities.push(dayActivity);
      }

      // 통계 계산
      const totalActivity = dailyActivities.reduce((sum, activity) => sum + activity, 0);
      const activeDays = dailyActivities.filter(activity => activity > 0).length;
      const averageDaily = totalActivity / totalDays;
      const weeklyAverage = averageDaily * 7;
      const peakActivity = Math.max(...dailyActivities);

      return {
        averageDaily,
        weeklyAverage,
        peakActivity,
        activeDays
      };

    } catch (error) {
      console.error('상세 정보 생성 오류:', error);
      return undefined;
    }
  }

  /**
   * 활동 결과 전송
   * @param interaction - 상호작용 객체
   * @param result - 활동 조회 결과
   * @param isPublic - 공개 응답 여부
   */
  private async sendActivityResult(
    interaction: ChatInputCommandInteraction, 
    result: ActivityCheckResult, 
    isPublic: boolean
  ): Promise<void> {
    let message = `🕐 **${result.user.username}님의 활동 시간**\n\n`;

    // 기본 정보
    if (result.dateRange) {
      const { startDate, endDate } = result.dateRange;
      const startFormatted = `${startDate.getFullYear()}.${(startDate.getMonth() + 1).toString().padStart(2, '0')}.${startDate.getDate().toString().padStart(2, '0')}`;
      const endFormatted = `${endDate.getFullYear()}.${(endDate.getMonth() + 1).toString().padStart(2, '0')}.${endDate.getDate().toString().padStart(2, '0')}`;
      message += `📅 **기간:** ${startFormatted} ~ ${endFormatted}\n`;
    } else {
      message += `📅 **기간:** 전체 기간\n`;
    }

    message += `⏱️ **총 활동 시간:** ${result.formattedTime}\n`;

    // 상세 정보
    if (result.additionalInfo) {
      const info = result.additionalInfo;
      message += `\n📊 **상세 정보:**\n`;
      message += `• 일평균 활동: ${formatTime(info.averageDaily || 0)}\n`;
      message += `• 주평균 활동: ${formatTime(info.weeklyAverage || 0)}\n`;
      message += `• 최대 일일 활동: ${formatTime(info.peakActivity || 0)}\n`;
      message += `• 활동한 일수: ${info.activeDays || 0}일\n`;
    }

    // 시간대별 추천 (간단한 예시)
    if (result.totalTime > 0) {
      message += `\n💡 **평가:** ${this.getActivityEvaluation(result.totalTime, result.dateRange)}`;
    }

    await interaction.followUp({
      content: message,
      flags: isPublic ? undefined : MessageFlags.Ephemeral,
    });
  }

  /**
   * 활동 평가 메시지 생성
   * @param totalTime - 총 활동 시간
   * @param dateRange - 날짜 범위
   */
  private getActivityEvaluation(totalTime: number, dateRange?: DateRange): string {
    const hours = totalTime / (60 * 60 * 1000);
    
    if (dateRange) {
      const days = Math.ceil((dateRange.endDate.getTime() - dateRange.startDate.getTime()) / (24 * 60 * 60 * 1000));
      const dailyAverage = hours / days;
      
      if (dailyAverage >= 5) {
        return '매우 활발한 활동을 보이고 있습니다! 🔥';
      } else if (dailyAverage >= 2) {
        return '꾸준한 활동을 보이고 있습니다! 👍';
      } else if (dailyAverage >= 0.5) {
        return '적당한 활동을 보이고 있습니다. 📈';
      } else {
        return '활동이 다소 적습니다. 더 많은 참여 부탁드립니다! 💪';
      }
    } else {
      if (hours >= 100) {
        return '매우 오랜 기간 활동해주셨습니다! 🌟';
      } else if (hours >= 50) {
        return '상당한 활동 시간을 보유하고 계시네요! 👏';
      } else if (hours >= 10) {
        return '꾸준히 활동해주고 계시네요! 📊';
      } else {
        return '앞으로 더 많은 활동 부탁드립니다! 🚀';
      }
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
• 지정된 사용자의 활동 시간을 조회합니다.
• 날짜 범위를 지정하여 특정 기간의 활동 시간을 확인할 수 있습니다.
• 상세 정보 옵션으로 일평균, 주평균 등의 통계를 확인할 수 있습니다.

**옵션:**
• \`user\`: 조회할 사용자 (필수)
• \`start_date\`: 시작 날짜 (YYMMDD 형식, 선택사항)
• \`end_date\`: 종료 날짜 (YYMMDD 형식, 선택사항)
• \`detailed\`: 상세 정보 표시 여부 (선택사항)
• \`public\`: 공개 응답 여부 (선택사항, 기본값: 비공개)

**예시:**
${this.metadata.examples?.map(ex => `\`${ex}\``).join('\n')}

**쿨다운:** ${this.metadata.cooldown}초
**권한:** 서버 전용`;
  }
}