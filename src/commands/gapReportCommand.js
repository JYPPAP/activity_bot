// src/commands/gapReportCommand.js - gap_report 명령어
import {MessageFlags} from 'discord.js';
import {cleanRoleName} from '../utils/formatters.js';
import {EmbedFactory} from '../utils/embedBuilder.js';
import {CommandBase} from './CommandBase.js';

export class GapReportCommand extends CommandBase {
  constructor(dbManager, activityTracker) {
    super({dbManager, activityTracker});
    this.userClassificationService = null;
  }

  /**
   * 의존성 주입을 위한 메서드
   * @param {UserClassificationService} userClassificationService - 사용자 분류 서비스
   */
  setUserClassificationService(userClassificationService) {
    this.userClassificationService = userClassificationService;
  }

  /**
   * 보고서 명령어의 실제 실행 로직
   * @param interaction - 상호작용 객체
   */
  async executeCommand(interaction) {
    // 명령어 옵션 가져오기
    const options = this.getCommandOptions(interaction);

    // 최신 데이터로 갱신
    await this.activityTracker.saveActivityData();

    // 30시간 기준 설정 가져오기
    const settings = await this.dbManager.getGuildSettings(interaction.guild.id);
    const minHours = settings?.monthly_target_hours || 30;

    // 전체 길드 멤버 가져오기
    const allMembers = await this.getAllMembers(interaction.guild);

    // 날짜 범위 설정
    const dateRange = await this.parseDateRange(options, { minHours }, interaction);
    if (!dateRange) {
      return; // 날짜 파싱에 실패한 경우 함수 종료
    }

    // 사용자 분류 및 보고서 생성
    const reportEmbeds = await this.generateReport("전체 서버", allMembers, dateRange, minHours);

    // 보고서 전송
    await this.sendReport(interaction, options, reportEmbeds);

    // 리셋 처리
    await this.handleReset(interaction, options);
  }

  // 명령어 옵션 가져오기
  getCommandOptions(interaction) {
    return {
      startDateStr: interaction.options.getString("start_date")?.trim(),
      endDateStr: interaction.options.getString("end_date")?.trim(),
      isTestMode: interaction.options.getBoolean("test_mode") ?? false,
      resetOption: interaction.options.getBoolean("reset") ?? false,
      logChannelId: interaction.options.getChannel("log_channel")?.id || process.env.CALENDAR_LOG_CHANNEL_ID
    };
  }

  // 역할 설정 유효성 검사 (더 이상 사용하지 않음)
  // validateRoleConfig(roleConfig, role, interaction) {
  //   if (!roleConfig) {
  //     interaction.followUp({
  //       content: `역할 "${role}"에 대한 설정을 찾을 수 없습니다. 먼저 /gap_config 명령어로 설정해주세요.`,
  //       flags: MessageFlags.Ephemeral,
  //     });
  //     return false;
  //   }
  //   return true;
  // }

  // 전체 길드 멤버 가져오기
  async getAllMembers(guild) {
    const members = await guild.members.fetch();
    // 봇이 아닌 실제 사용자만 반환
    return members.filter(member => !member.user.bot);
  }

  // 날짜 형식 검증
  validateDateFormat(dateStr, label, interaction) {
    if (!/^\d{6}$/.test(dateStr)) {
      interaction.followUp({
        content: `${label} 날짜 형식이 올바르지 않습니다. '${dateStr}'는 'YYMMDD' 형식이어야 합니다. (예: 250413)`,
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }
    return true;
  }

  // 날짜 범위 파싱
  async parseDateRange(options, roleConfig, interaction) {
    const { startDateStr, endDateStr } = options;

    // 날짜 옵션이 제공된 경우
    if (startDateStr && endDateStr) {
      // 날짜 형식 검증
      if (!this.validateDateFormat(startDateStr, '시작', interaction) ||
        !this.validateDateFormat(endDateStr, '종료', interaction)) {
        return null;
      }

      try {
        // 날짜 파싱
        const dates = this.parseYYMMDDDates(startDateStr, endDateStr);
        console.log('파싱된 날짜:', dates.startDate, dates.endDate);
        return dates;
      } catch (error) {
        console.error('날짜 파싱 오류:', error);
        interaction.followUp({
          content: `날짜 처리 중 오류가 발생했습니다: ${error.message}`,
          flags: MessageFlags.Ephemeral,
        });
        return null;
      }
    } else {
      // 날짜가 지정되지 않은 경우 기본값 사용
      return this.getDefaultDateRange(roleConfig);
    }
  }

  // YYMMDD 형식 날짜 파싱
  parseYYMMDDDates(startDateStr, endDateStr) {
    // 수동으로 날짜 파싱
    const startYear = 2000 + parseInt(startDateStr.substring(0, 2), 10);
    const startMonth = parseInt(startDateStr.substring(2, 4), 10) - 1;
    const startDay = parseInt(startDateStr.substring(4, 6), 10);

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

  // 기본 날짜 범위 반환
  getDefaultDateRange(roleConfig) {
    const startDate = roleConfig.resetTime
      ? new Date(roleConfig.resetTime)
      : new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
    const endDate = new Date();

    return { startDate, endDate };
  }

  // 전체 사용자 분류 (30시간 기준)
  async classifyAllUsers(allMembers, startDate, endDate, minHours) {
    const minActivityMinutes = minHours * 60;
    const activeUsers = [];
    const inactiveUsers = [];
    const afkUsers = [];

    for (const [userId, member] of allMembers.entries()) {
      try {
        // PostgreSQL에서 사용자 활동 분 조회 (날짜 범위 기준)
        const totalMinutes = await this.dbManager.getUserActivityByDateRange(userId, startDate, endDate);
        
        // 현재 활성 세션이 있다면 추가
        let currentSessionMinutes = 0;
        if (this.activityTracker.activeSessions?.has(userId)) {
          const session = this.activityTracker.activeSessions.get(userId);
          const sessionDuration = Date.now() - session.startTime;
          currentSessionMinutes = Math.floor(sessionDuration / (1000 * 60));
        }

        const totalWithCurrent = totalMinutes + currentSessionMinutes;

        const userData = {
          userId,
          nickname: member.displayName,
          totalTime: totalWithCurrent * 60 * 1000 // 호환성을 위해 밀리초로 변환
        };

        // 잠수 역할이 있는 경우 afkUsers에 추가
        if (member.roles.cache.some(r => r.name.includes('잠수'))) {
          afkUsers.push(userData);
        }
        // 그 외는 활동 시간 기준으로 분류
        else if (totalWithCurrent >= minActivityMinutes) {
          activeUsers.push(userData);
        } else {
          inactiveUsers.push(userData);
        }
      } catch (error) {
        console.error(`사용자 ${userId} 분류 중 오류:`, error);
      }
    }

    // 활동 시간 기준으로 정렬
    activeUsers.sort((a, b) => b.totalTime - a.totalTime);
    inactiveUsers.sort((a, b) => b.totalTime - a.totalTime);
    afkUsers.sort((a, b) => b.totalTime - a.totalTime);

    return { activeUsers, inactiveUsers, afkUsers };
  }

  // 보고서 생성
  async generateReport(roleName, allMembers, dateRange, minHours) {
    const { startDate, endDate } = dateRange;

    // 전체 사용자를 30시간 기준으로 분류
    const { activeUsers, inactiveUsers, afkUsers } = await this.classifyAllUsers(allMembers, startDate, endDate, minHours);

    // 보고서 임베드 생성
    return EmbedFactory.createActivityEmbeds(
      roleName, activeUsers, inactiveUsers, afkUsers, startDate, endDate, minHours, null, '활동 보고서'
    );
  }

  // 보고서 전송
  async sendReport(interaction, options, reportEmbeds) {
    if (options.isTestMode) {
      // 테스트인 경우 서버 내 Embed로 전송
      await interaction.followUp({
        content: "⚠️ 테스트 모드로 실행됩니다. 리셋 시간이 기록되지 않습니다.",
        embeds: reportEmbeds,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      // 채널에 전송
      if (options.logChannelId) {
        const logChannel = await interaction.client.channels.fetch(options.logChannelId);
        if (logChannel) {
          await logChannel.send({
            content: `🗓️ ${options.role} 역할 활동 보고서 (정식 출력)`,
            embeds: reportEmbeds
          });
        }
      }

      await interaction.followUp({
        content: "✅ 보고서가 생성되었습니다.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // 리셋 처리
  async handleReset(interaction, options) {
    // 전체 서버 보고서에서는 리셋 기능 비활성화
    if (!options.isTestMode && options.resetOption) {
      await interaction.followUp({
        content: `⚠️ 전체 서버 보고서에서는 리셋 기능을 사용할 수 없습니다.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}