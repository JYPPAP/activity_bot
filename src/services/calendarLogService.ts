// src/services/calendarLogService.ts - 달력 형태의 로그 서비스 (TypeScript)
import { EmbedBuilder, Guild, GuildMember, TextChannel, ThreadChannel } from 'discord.js';

import { COLORS } from '../config/constants.js';
import { config } from '../config/env.js';
import { EnhancedClient } from '../types/discord.js';
import { UserActivity } from '../types/index.js';
import { formatKoreanDate } from '../utils/formatters.js';

import { ActivityReportService, ReportOptions } from './activityReportService.js';
import { DatabaseManager } from './DatabaseManager.js';

// ====================
// 달력 로그 관련 타입
// ====================

export interface DailySummary {
  date: string;
  totalJoins: number;
  totalLeaves: number;
  channelChanges: number;
  activeMembers: string[];
  topChannels?: ChannelSummary[];
  hourlyBreakdown?: HourlyActivity[];
}

export interface ChannelSummary {
  name: string;
  joinCount: number;
  leaveCount: number;
  totalActivity: number;
}

export interface HourlyActivity {
  hour: number;
  joinCount: number;
  leaveCount: number;
}

export interface WeekSummary {
  weekNumber: number;
  year: number;
  startDate: Date;
  endDate: Date;
  dailySummaries: DailySummary[];
  totalStatistics: WeeklyStatistics;
}

export interface WeeklyStatistics {
  totalJoins: number;
  totalLeaves: number;
  activeDays: number;
  peakDay: string;
  mostActiveMembers: MemberActivity[];
  averageDailyActivity: number;
}

export interface MemberActivity {
  name: string;
  userId: string;
  activeDays: number;
  totalActivities: number;
}

export interface CalendarLogOptions {
  enableHourlyBreakdown?: boolean;
  includeChannelStats?: boolean;
  maxMembersPerDay?: number;
  archiveDays?: number;
  enableAutoReports?: boolean;
}

export interface DateRangeQuery {
  startDate: Date;
  endDate: Date;
  includeWeekends?: boolean;
  timezone?: string;
}

// ====================
// 달력 로그 서비스 클래스
// ====================

export class CalendarLogService {
  private readonly client: EnhancedClient;
  private readonly db: DatabaseManager;
  private readonly reportService: ActivityReportService;
  private readonly options: Required<CalendarLogOptions>;

  private calendarChannel: TextChannel | ThreadChannel | null = null;
  // private _isInitialized = false; // Unused

  constructor(
    client: EnhancedClient,
    dbManager: DatabaseManager,
    options: CalendarLogOptions = {}
  ) {
    this.client = client;
    this.db = dbManager;
    this.reportService = new ActivityReportService(client, dbManager);
    this.options = {
      enableHourlyBreakdown: false,
      includeChannelStats: true,
      maxMembersPerDay: 20,
      archiveDays: 90,
      enableAutoReports: true,
      ...options,
    };
  }

  /**
   * 달력 로그 채널 초기화 및 스케줄 설정
   */
  async initialize(): Promise<void> {
    try {
      if (config.CALENDAR_LOG_CHANNEL_ID) {
        const channel = await this.client.channels.fetch(config.CALENDAR_LOG_CHANNEL_ID);

        if (channel?.isTextBased()) {
          this.calendarChannel = channel as TextChannel | ThreadChannel;
          // this._isInitialized = true; // Unused
          console.log(
            `[CalendarLogService] 달력 로그 채널이 초기화되었습니다: ${'name' in channel ? channel.name : 'DM'}`
          );
        } else {
          console.error('[CalendarLogService] 달력 로그 채널이 텍스트 채널이 아닙니다.');
        }
      } else {
        console.warn(
          '[CalendarLogService] CALENDAR_LOG_CHANNEL_ID가 설정되지 않았습니다. 자동 보고서 기능이 비활성화됩니다.'
        );
      }
    } catch (error) {
      console.error('[CalendarLogService] 달력 로그 채널 초기화 오류:', error);
    }
  }

  /**
   * 현재 날짜의 연도 기준 주차 계산
   */
  getWeekNumber(date: Date): number {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  /**
   * ISO 주차 계산 (ISO 8601 표준)
   */
  getISOWeekNumber(date: Date): { year: number; week: number } {
    const target = new Date(date.valueOf());
    const dayNumber = (date.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNumber + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
      target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
    }
    const weekNumber = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
    return { year: target.getFullYear(), week: weekNumber };
  }

  /**
   * 활동 로그를 DB에 기록
   */
  async archiveActivity(
    _message: string,
    members: string[],
    type: string,
    channelId: string,
    channelName: string,
    userId: string
  ): Promise<void> {
    try {
      await this.db.logActivity(userId, type, channelId, channelName, members);
    } catch (error) {
      console.error('[CalendarLogService] 활동 로그 기록 오류:', error);
    }
  }

  /**
   * 역할별 활동 보고서 전송
   */
  async sendRoleActivityReport(
    startDate: Date,
    endTime: number,
    roleNames: string[],
    channel?: TextChannel | ThreadChannel,
    options?: ReportOptions
  ): Promise<void> {
    const targetChannel = channel || this.calendarChannel;
    if (!targetChannel) {
      console.error('[CalendarLogService] 보고서를 전송할 채널이 설정되지 않았습니다.');
      return;
    }

    await this.reportService.generateRoleActivityReport(
      startDate,
      endTime,
      roleNames,
      targetChannel,
      options
    );
  }

  /**
   * 특정 날짜 범위의 로그 조회하여 전송
   */
  async sendDateRangeLog(
    startDate: Date,
    endTime: number,
    channel: TextChannel | ThreadChannel,
    query?: DateRangeQuery
  ): Promise<void> {
    try {
      const dailySummaries = await this.getDailyActivitySummaries(
        startDate.getTime(),
        endTime,
        query
      );

      // 각 일별 요약 데이터 전송
      for (const summary of dailySummaries) {
        if (this.hasActivity(summary)) {
          const embed = this.createDailySummaryEmbed(summary);
          await channel.send({ embeds: [embed] });
        }
      }

      // 전체 기간 요약 임베드 전송
      const rangeEmbed = this.createDateRangeSummaryEmbed(
        dailySummaries,
        startDate,
        new Date(endTime)
      );
      await channel.send({ embeds: [rangeEmbed] });
    } catch (error) {
      console.error('[CalendarLogService] 날짜 범위 로그 전송 오류:', error);
      await this.sendErrorMessage(
        channel,
        '요청한 날짜 범위의 로그를 처리하는 중 오류가 발생했습니다.'
      );
    }
  }

  /**
   * 주간 요약 보고서 생성
   */
  async generateWeeklySummary(
    startDate: Date,
    endDate: Date,
    channel?: TextChannel | ThreadChannel
  ): Promise<WeekSummary> {
    try {
      const targetChannel = channel || this.calendarChannel;
      const dailySummaries = await this.getDailyActivitySummaries(
        startDate.getTime(),
        endDate.getTime()
      );

      const weekSummary: WeekSummary = {
        weekNumber: this.getWeekNumber(startDate),
        year: startDate.getFullYear(),
        startDate,
        endDate,
        dailySummaries,
        totalStatistics: this.calculateWeeklyStatistics(dailySummaries),
      };

      if (targetChannel) {
        const embed = this.createWeeklySummaryEmbed(weekSummary);
        await targetChannel.send({ embeds: [embed] });
      }

      return weekSummary;
    } catch (error) {
      console.error('[CalendarLogService] 주간 요약 생성 오류:', error);
      throw error;
    }
  }

  /**
   * 날짜별 활동 요약 데이터 생성
   */
  async getDailyActivitySummaries(
    startTime: number,
    endTime: number,
    query?: DateRangeQuery
  ): Promise<DailySummary[]> {
    try {
      const dailyStats = await this.db.getDailyActivityStats(startTime, endTime);
      const summaries: DailySummary[] = [];

      for (const day of dailyStats) {
        const dayDate = new Date(day.date);
        const dayEnd = new Date(day.date);
        dayEnd.setHours(23, 59, 59, 999);

        // 주말 필터링
        if (query?.includeWeekends === false && this.isWeekend(dayDate)) {
          continue;
        }

        const activeMembers = await this.getActiveMembersForDay(
          dayDate.getTime(),
          dayEnd.getTime()
        );

        const summary: DailySummary = {
          date: day.date,
          totalJoins: day.joins,
          totalLeaves: day.leaves,
          channelChanges: day.totalEvents - day.joins - day.leaves,
          activeMembers: activeMembers.slice(0, this.options.maxMembersPerDay),
        };

        // 추가 옵션 처리
        if (this.options.includeChannelStats) {
          summary.topChannels = await this.getChannelStatsForDay(
            dayDate.getTime(),
            dayEnd.getTime()
          );
        }

        if (this.options.enableHourlyBreakdown) {
          summary.hourlyBreakdown = await this.getHourlyBreakdown(
            dayDate.getTime(),
            dayEnd.getTime()
          );
        }

        summaries.push(summary);
      }

      return summaries;
    } catch (error) {
      console.error('[CalendarLogService] 일일 활동 요약 생성 오류:', error);
      return [];
    }
  }

  /**
   * 특정 날짜의 활동적인 멤버 조회
   */
  async getActiveMembersForDay(startTime: number, endTime: number): Promise<string[]> {
    try {
      const logs = await this.db.getActivityLogs({
        startDate: new Date(startTime),
        endDate: new Date(endTime),
      });
      const userIds = [...new Set(logs.map((log) => log.userId))];
      const guild = this.client.guilds.cache.get(config.GUILDID);

      const activeMembers = await Promise.all(
        userIds.map((userId) => this.getMemberDisplayName(userId, guild))
      );

      return activeMembers.filter((name): name is string => name !== null);
    } catch (error) {
      console.error('[CalendarLogService] 활동 멤버 조회 오류:', error);
      return [];
    }
  }

  /**
   * 특정 날짜의 채널별 통계
   */
  private async getChannelStatsForDay(
    startTime: number,
    endTime: number
  ): Promise<ChannelSummary[]> {
    try {
      const logs = await this.db.getActivityLogs({
        startDate: new Date(startTime),
        endDate: new Date(endTime),
      });
      const channelStats: { [key: string]: ChannelSummary } = {};

      for (const log of logs) {
        if (!channelStats[log.channelName]) {
          channelStats[log.channelName] = {
            name: log.channelName,
            joinCount: 0,
            leaveCount: 0,
            totalActivity: 0,
          };
        }

        const stat = channelStats[log.channelName];
        if (log.action === 'join') {
          stat.joinCount++;
        } else if (log.action === 'leave') {
          stat.leaveCount++;
        }
        stat.totalActivity++;
      }

      return Object.values(channelStats)
        .sort((a, b) => b.totalActivity - a.totalActivity)
        .slice(0, 5);
    } catch (error) {
      console.error('[CalendarLogService] 채널 통계 조회 오류:', error);
      return [];
    }
  }

  /**
   * 시간별 활동 분석
   */
  private async getHourlyBreakdown(startTime: number, endTime: number): Promise<HourlyActivity[]> {
    try {
      const logs = await this.db.getActivityLogs({
        startDate: new Date(startTime),
        endDate: new Date(endTime),
      });
      const hourlyStats: HourlyActivity[] = Array(24)
        .fill(null)
        .map((_, hour) => ({
          hour,
          joinCount: 0,
          leaveCount: 0,
        }));

      for (const log of logs) {
        const hour = new Date(log.timestamp).getHours();
        if (log.action === 'join') {
          hourlyStats[hour].joinCount++;
        } else if (log.action === 'leave') {
          hourlyStats[hour].leaveCount++;
        }
      }

      return hourlyStats;
    } catch (error) {
      console.error('[CalendarLogService] 시간별 분석 오류:', error);
      return [];
    }
  }

  /**
   * 사용자 ID에 대한 표시 이름을 가져옵니다.
   */
  async getMemberDisplayName(userId: string, guild?: Guild): Promise<string | null> {
    try {
      // 데이터베이스에서 표시 이름 확인
      const activity = await this.db.getUserActivity(userId);

      if (activity?.displayName) {
        return activity.displayName;
      }

      // 길드에서 멤버 정보 가져오기
      if (guild) {
        const member = await this.fetchGuildMember(guild, userId);
        if (member) {
          // DB에 표시 이름 업데이트
          await this.updateMemberDisplayName(userId, member.displayName, activity);
          return member.displayName;
        }
      }

      return userId;
    } catch (error) {
      console.error(`[CalendarLogService] 사용자 ${userId}의 표시 이름 조회 실패:`, error);
      return userId;
    }
  }

  /**
   * 길드에서 멤버 정보를 가져옵니다.
   */
  async fetchGuildMember(guild: Guild, userId: string): Promise<GuildMember | null> {
    try {
      return await guild.members.fetch(userId);
    } catch (error) {
      // 멤버를 찾을 수 없는 경우 (탈퇴 등)
      return null;
    }
  }

  /**
   * 사용자의 표시 이름을 DB에 업데이트합니다.
   */
  async updateMemberDisplayName(
    userId: string,
    displayName: string,
    activity: UserActivity | null
  ): Promise<void> {
    if (activity) {
      await this.db.updateUserActivity(
        userId,
        activity.totalTime || 0,
        activity.startTime,
        displayName
      );
    } else {
      await this.db.updateUserActivity(userId, 0, null, displayName);
    }
  }

  /**
   * 주간 통계 계산
   */
  private calculateWeeklyStatistics(dailySummaries: DailySummary[]): WeeklyStatistics {
    const totalJoins = dailySummaries.reduce((sum, day) => sum + day.totalJoins, 0);
    const totalLeaves = dailySummaries.reduce((sum, day) => sum + day.totalLeaves, 0);
    const activeDays = dailySummaries.filter((day) => this.hasActivity(day)).length;

    // 가장 활동적인 날 찾기
    const peakDay = dailySummaries.reduce(
      (peak, day) => {
        const dayActivity = day.totalJoins + day.totalLeaves + day.channelChanges;
        const peakActivity = peak.totalJoins + peak.totalLeaves + peak.channelChanges;
        return dayActivity > peakActivity ? day : peak;
      },
      dailySummaries[0] || { totalJoins: 0, totalLeaves: 0, channelChanges: 0, date: '' }
    );

    // 가장 활동적인 멤버 집계
    const memberActivityMap = new Map<string, MemberActivity>();

    for (const day of dailySummaries) {
      for (const memberName of day.activeMembers) {
        const existing = memberActivityMap.get(memberName);
        if (existing) {
          existing.activeDays++;
          existing.totalActivities++;
        } else {
          memberActivityMap.set(memberName, {
            name: memberName,
            userId: '', // 실제 구현에서는 userId도 추적 필요
            activeDays: 1,
            totalActivities: 1,
          });
        }
      }
    }

    const mostActiveMembers = Array.from(memberActivityMap.values())
      .sort((a, b) => b.totalActivities - a.totalActivities)
      .slice(0, 5);

    const averageDailyActivity = activeDays > 0 ? (totalJoins + totalLeaves) / activeDays : 0;

    return {
      totalJoins,
      totalLeaves,
      activeDays,
      peakDay: peakDay.date,
      mostActiveMembers,
      averageDailyActivity: Math.round(averageDailyActivity * 100) / 100,
    };
  }

  /**
   * 활동 여부 확인
   */
  private hasActivity(summary: DailySummary): boolean {
    return summary.totalJoins > 0 || summary.totalLeaves > 0 || summary.channelChanges > 0;
  }

  /**
   * 주말 여부 확인
   */
  private isWeekend(date: Date): boolean {
    const day = date.getDay();
    return day === 0 || day === 6; // 일요일(0) 또는 토요일(6)
  }

  /**
   * 일일 요약 임베드 생성
   */
  createDailySummaryEmbed(summary: DailySummary): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(COLORS.LOG)
      .setTitle(`📆 ${summary.date} 활동 요약`)
      .addFields({
        name: '📊 활동 통계',
        value: `입장: ${summary.totalJoins}회\n퇴장: ${summary.totalLeaves}회\n채널 변경: ${summary.channelChanges}회`,
        inline: false,
      });

    // 활동 멤버 정보
    if (summary.activeMembers.length > 0) {
      const membersList = summary.activeMembers.slice(0, 10).join(', ');
      const extraCount =
        summary.activeMembers.length > 10 ? ` 외 ${summary.activeMembers.length - 10}명` : '';

      embed.addFields({
        name: '👥 활동 멤버',
        value: membersList + extraCount,
        inline: false,
      });
    } else {
      embed.addFields({
        name: '👥 활동 멤버',
        value: '활동 멤버 없음',
        inline: false,
      });
    }

    // 채널 통계 추가
    if (summary.topChannels && summary.topChannels.length > 0) {
      const channelStats = summary.topChannels
        .slice(0, 3)
        .map((ch) => `${ch.name}: ${ch.totalActivity}회`)
        .join('\n');

      embed.addFields({
        name: '🔊 활동적인 채널',
        value: channelStats,
        inline: true,
      });
    }

    // 시간별 분석 추가 (시각화)
    if (summary.hourlyBreakdown) {
      const peakHour = summary.hourlyBreakdown.reduce((peak, hour) => {
        const hourActivity = hour.joinCount + hour.leaveCount;
        const peakActivity = peak.joinCount + peak.leaveCount;
        return hourActivity > peakActivity ? hour : peak;
      });

      if (peakHour.joinCount + peakHour.leaveCount > 0) {
        embed.addFields({
          name: '⏰ 최고 활동 시간',
          value: `${peakHour.hour}시: ${peakHour.joinCount + peakHour.leaveCount}회`,
          inline: true,
        });
      }
    }

    return embed;
  }

  /**
   * 주간 요약 임베드 생성
   */
  createWeeklySummaryEmbed(weekSummary: WeekSummary): EmbedBuilder {
    const { totalStatistics: stats } = weekSummary;
    const startStr = formatKoreanDate(weekSummary.startDate).split(' ')[0];
    const endStr = formatKoreanDate(weekSummary.endDate).split(' ')[0];

    const embed = new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle(`📅 주간 활동 요약 (${weekSummary.year}년 ${weekSummary.weekNumber}주차)`)
      .setDescription(`기간: ${startStr} ~ ${endStr}`)
      .addFields(
        {
          name: '📊 주간 통계',
          value: `총 입장: ${stats.totalJoins}회\n총 퇴장: ${stats.totalLeaves}회\n활동 일수: ${stats.activeDays}일\n일평균 활동: ${stats.averageDailyActivity}회`,
          inline: false,
        },
        {
          name: '📈 최고 활동일',
          value: stats.peakDay || '데이터 없음',
          inline: true,
        }
      );

    // 가장 활동적인 멤버
    if (stats.mostActiveMembers.length > 0) {
      const memberList = stats.mostActiveMembers
        .map((member) => `${member.name}: ${member.activeDays}일`)
        .join('\n');

      embed.addFields({
        name: '👥 가장 활동적인 멤버',
        value: memberList,
        inline: false,
      });
    }

    embed.setTimestamp();
    return embed;
  }

  /**
   * 날짜 범위 요약 임베드 생성
   */
  createDateRangeSummaryEmbed(
    summaries: DailySummary[],
    startDate: Date,
    endDate: Date
  ): EmbedBuilder {
    const startDateStr = formatKoreanDate(startDate).split(' ')[0];
    const endDateStr = formatKoreanDate(endDate).split(' ')[0];

    // 전체 통계 집계
    const totalJoins = summaries.reduce((sum, day) => sum + day.totalJoins, 0);
    const totalLeaves = summaries.reduce((sum, day) => sum + day.totalLeaves, 0);
    const activeDays = summaries.filter((day) => this.hasActivity(day)).length;

    // 활동 멤버 집계
    const allActiveMembers = new Map<string, number>();
    for (const day of summaries) {
      for (const member of day.activeMembers) {
        const count = allActiveMembers.get(member) || 0;
        allActiveMembers.set(member, count + 1);
      }
    }

    // 가장 활동적인 멤버 5명
    const mostActiveMembers = Array.from(allActiveMembers.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const embed = new EmbedBuilder()
      .setColor(COLORS.LOG)
      .setTitle(`📅 활동 요약 (${startDateStr} ~ ${endDateStr})`)
      .setDescription('선택한 기간의 음성 채널 활동 요약입니다.')
      .addFields({
        name: '📊 총 활동 통계',
        value: `입장: ${totalJoins}회\n퇴장: ${totalLeaves}회\n활동 일수: ${activeDays}일`,
        inline: false,
      });

    // 활동적인 멤버가 있는 경우 추가
    if (mostActiveMembers.length > 0) {
      embed.addFields({
        name: '👥 가장 활동적인 멤버',
        value: mostActiveMembers.map(([member, days]) => `${member}: ${days}일`).join('\n'),
        inline: false,
      });
    } else {
      embed.addFields({
        name: '👥 가장 활동적인 멤버',
        value: '데이터 없음',
        inline: false,
      });
    }

    embed.setTimestamp();
    return embed;
  }

  /**
   * 월간 요약 보고서 생성
   */
  async generateMonthlySummary(
    year: number,
    month: number,
    channel?: TextChannel | ThreadChannel
  ): Promise<void> {
    try {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59, 999);

      const summaries = await this.getDailyActivitySummaries(
        startDate.getTime(),
        endDate.getTime()
      );

      const embed = this.createMonthlySummaryEmbed(summaries, year, month);

      const targetChannel = channel || this.calendarChannel;
      if (targetChannel) {
        await targetChannel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error('[CalendarLogService] 월간 요약 생성 오류:', error);
    }
  }

  /**
   * 월간 요약 임베드 생성
   */
  private createMonthlySummaryEmbed(
    summaries: DailySummary[],
    year: number,
    month: number
  ): EmbedBuilder {
    const totalJoins = summaries.reduce((sum, day) => sum + day.totalJoins, 0);
    const totalLeaves = summaries.reduce((sum, day) => sum + day.totalLeaves, 0);
    const activeDays = summaries.filter((day) => this.hasActivity(day)).length;

    // 주별 통계
    const weeklyData: { [key: number]: number } = {};
    summaries.forEach((day) => {
      const weekNum = this.getWeekNumber(new Date(day.date));
      weeklyData[weekNum] = (weeklyData[weekNum] || 0) + day.totalJoins + day.totalLeaves;
    });

    const embed = new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle(`📅 ${year}년 ${month}월 월간 활동 요약`)
      .addFields({
        name: '📊 월간 통계',
        value: `총 입장: ${totalJoins}회\n총 퇴장: ${totalLeaves}회\n활동 일수: ${activeDays}일`,
        inline: false,
      });

    // 주별 분석
    if (Object.keys(weeklyData).length > 0) {
      const weeklyStats = Object.entries(weeklyData)
        .map(([week, activity]) => `${week}주차: ${activity}회`)
        .join('\n');

      embed.addFields({
        name: '📈 주별 활동',
        value: weeklyStats,
        inline: false,
      });
    }

    embed.setTimestamp();
    return embed;
  }

  /**
   * 오류 메시지 전송
   */
  private async sendErrorMessage(
    channel: TextChannel | ThreadChannel,
    message: string
  ): Promise<void> {
    try {
      const embed = new EmbedBuilder()
        .setColor(COLORS.ERROR)
        .setTitle('❌ 오류 발생')
        .setDescription(message)
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('[CalendarLogService] 오류 메시지 전송 실패:', error);
    }
  }

  /**
   * 자동 정리 작업
   */
  async performCleanup(): Promise<void> {
    try {
      if (!this.options.enableAutoReports) return;

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.options.archiveDays);

      // 오래된 로그 정리 (실제 구현에서는 DB 정리 메서드 필요)
      console.log(`[CalendarLogService] ${cutoffDate.toISOString()} 이전 로그 정리 시작`);

      // TODO: 실제 DB 정리 로직 구현
    } catch (error) {
      console.error('[CalendarLogService] 정리 작업 오류:', error);
    }
  }

  /**
   * 정리 작업
   */
  cleanup(): void {
    console.log('[CalendarLogService] 정리 작업 완료');
  }
}

// ====================
// 유틸리티 함수
// ====================

/**
 * 날짜 범위 유효성 검사
 */
export function validateDateRange(startDate: Date, endDate: Date): boolean {
  return startDate <= endDate && startDate <= new Date();
}

/**
 * 활동 데이터 요약 생성
 */
export function summarizeActivityData(summaries: DailySummary[]): string {
  const totalDays = summaries.length;
  const activeDays = summaries.filter((s) => s.totalJoins > 0 || s.totalLeaves > 0).length;
  const totalActivity = summaries.reduce((sum, s) => sum + s.totalJoins + s.totalLeaves, 0);

  return `${totalDays}일 중 ${activeDays}일 활동, 총 ${totalActivity}회 이벤트`;
}

/**
 * 시간대별 활동 분석
 */
export function analyzeTimePatterns(hourlyData: HourlyActivity[]): {
  peakHour: number;
  quietHour: number;
  totalActivity: number;
} {
  let peakHour = 0;
  let quietHour = 0;
  let maxActivity = 0;
  let minActivity = Infinity;
  let totalActivity = 0;

  hourlyData.forEach((data, hour) => {
    const activity = data.joinCount + data.leaveCount;
    totalActivity += activity;

    if (activity > maxActivity) {
      maxActivity = activity;
      peakHour = hour;
    }

    if (activity < minActivity) {
      minActivity = activity;
      quietHour = hour;
    }
  });

  return { peakHour, quietHour, totalActivity };
}
