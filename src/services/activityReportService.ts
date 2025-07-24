// src/services/activityReportService.ts - 활동 보고서 서비스 (TypeScript)
import {
  EmbedBuilder,
  Guild,
  GuildMember,
  Collection,
  TextChannel,
  ThreadChannel,
} from 'discord.js';

import { COLORS } from '../config/constants';
import { config } from '../config/env';
import type { IDatabaseManager } from '../interfaces/IDatabaseManager';
import { EnhancedClient } from '../types/discord';
import { UserActivity } from '../types/index';
import { EmbedFactory, ActivityEmbedsData } from '../utils/embedBuilder';
import { formatKoreanDate, formatTime } from '../utils/formatters';

import { UserClassificationService } from './UserClassificationService';

// ====================
// 보고서 관련 타입
// ====================

export interface WeeklySummaryData {
  totalJoins: number;
  totalLeaves: number;
  activeDays: number;
  mostActiveUsers: TopUser[];
  mostActiveChannels: ChannelActivity[];
}

export interface TopUser {
  name: string;
  totalTime: number;
  userId?: string;
}

export interface ChannelActivity {
  name: string;
  count: number;
  channelId?: string;
}

export interface DailySummary {
  date: string;
  totalJoins: number;
  totalLeaves: number;
  totalEvents: number;
  uniqueUsers: number;
  activeMembers: string[];
  topChannels: ChannelActivity[];
}

export interface ReportOptions {
  includeAfkUsers?: boolean;
  sortByTime?: boolean;
  maxUsersPerReport?: number;
  maxChannelsPerReport?: number;
  includeStatistics?: boolean;
  customTitle?: string;
}

export interface ActivityReportData {
  roleName: string;
  activeUsers: ReportUser[];
  inactiveUsers: ReportUser[];
  afkUsers: ReportUser[];
  resetTime: number | null;
  minHours: number;
  reportCycle?: number;
  statistics?: ReportStatistics;
}

export interface ReportUser {
  userId: string;
  nickname: string;
  totalTime: number;
  lastActivity?: Date;
  status?: 'active' | 'inactive' | 'afk';
}

export interface ReportStatistics {
  totalUsers: number;
  activePercentage: number;
  averageActivityTime: number;
  mostActiveDay: string;
  leastActiveDay: string;
}

export interface DateRangeReport {
  startDate: Date;
  endDate: Date;
  summaries: DailySummary[];
  totalStatistics: WeeklySummaryData;
  trends: ReportTrends;
}

export interface ReportTrends {
  dailyGrowth: number;
  weeklyGrowth: number;
  peakActivityHour: number;
  mostActiveWeekday: string;
}

// ====================
// 활동 보고서 서비스 클래스
// ====================

export class ActivityReportService {
  private readonly client: EnhancedClient;
  private readonly db: IDatabaseManager;
  private userClassificationService?: UserClassificationService;

  constructor(client: EnhancedClient, dbManager: IDatabaseManager) {
    this.client = client;
    this.db = dbManager;
  }

  /**
   * UserClassificationService 설정
   */
  setUserClassificationService(service: UserClassificationService): void {
    this.userClassificationService = service;
  }

  /**
   * 역할별 활동 보고서 생성 및 전송
   */
  async generateRoleActivityReport(
    startDate: Date,
    endTime: number,
    roleNames: string[],
    channel: TextChannel | ThreadChannel,
    options: ReportOptions = {}
  ): Promise<void> {
    try {
      const guild = channel.guild;
      if (!guild) {
        throw new Error('길드 정보를 찾을 수 없습니다.');
      }

      for (const roleName of roleNames) {
        await this.generateSingleRoleReport(guild, roleName, startDate, endTime, channel, options);
      }
    } catch (error) {
      console.error('[ActivityReportService] 역할 활동 보고서 생성 오류:', error);
      await this.sendErrorMessage(channel, '역할 활동 보고서 생성 중 오류가 발생했습니다.');
    }
  }

  /**
   * 단일 역할 보고서 생성
   */
  private async generateSingleRoleReport(
    guild: Guild,
    roleName: string,
    startDate: Date,
    endTime: number,
    channel: TextChannel | ThreadChannel,
    options: ReportOptions
  ): Promise<void> {
    try {
      // 역할 객체 찾기
      const role = guild.roles.cache.find((r) => r.name === roleName);
      if (!role) {
        console.log(`[ActivityReportService] 역할 [${roleName}]을 찾을 수 없습니다.`);
        return;
      }

      // 역할을 가진 멤버 찾기
      const members = guild.members.cache.filter((member) => member.roles.cache.has(role.id));

      if (members.size === 0) {
        console.log(`[ActivityReportService] 역할 [${roleName}]에 멤버가 없습니다.`);
        return;
      }

      // 사용자 분류
      const classification = await this.classifyUsersForReport(roleName, members, options);

      // 임베드 생성 데이터 준비
      const embedData: ActivityEmbedsData = {
        role: roleName,
        activeUsers: classification.activeUsers.map((user) => ({
          userId: user.userId,
          nickname: user.nickname,
          totalTime: user.totalTime,
        })),
        inactiveUsers: classification.inactiveUsers.map((user) => ({
          userId: user.userId,
          nickname: user.nickname,
          totalTime: user.totalTime,
        })),
        startDate,
        endDate: new Date(endTime),
        minHours: classification.minHours,
        ...(options.includeAfkUsers &&
          classification.afkUsers.length > 0 && {
            afkUsers: classification.afkUsers.map((user) => ({
              userId: user.userId,
              nickname: user.nickname,
              totalTime: user.totalTime,
              afkUntil: Date.now() + 7 * 24 * 60 * 60 * 1000, // 임시값
            })),
          }),
        ...(classification.reportCycle && { reportCycle: classification.reportCycle }),
        ...(options.customTitle && { title: options.customTitle }),
      };

      // 임베드 생성 및 전송
      const reportEmbeds = EmbedFactory.createActivityEmbeds(embedData, {
        sortByTime: options.sortByTime ?? true,
        includeTimestamp: true,
        showEmptyMessage: true,
      });

      for (const embed of reportEmbeds) {
        await channel.send({ embeds: [embed] });
      }

      console.log(`[ActivityReportService] 역할 [${roleName}]의 활동 보고서가 전송되었습니다.`);
    } catch (error) {
      console.error(`[ActivityReportService] 역할 [${roleName}] 보고서 생성 오류:`, error);
    }
  }

  /**
   * 보고서용 사용자 분류
   */
  private async classifyUsersForReport(
    roleName: string,
    members: Collection<string, GuildMember>,
    options: ReportOptions
  ): Promise<{
    activeUsers: ReportUser[];
    inactiveUsers: ReportUser[];
    afkUsers: ReportUser[];
    minHours: number;
    reportCycle?: number;
  }> {
    if (this.userClassificationService) {
      // UserClassificationService 사용
      const classification = await this.userClassificationService.classifyUsers(roleName, members);

      return {
        activeUsers: classification.activeUsers.map((user) => ({
          userId: user.userId,
          nickname: user.nickname,
          totalTime: user.totalTime,
          status: 'active' as const,
        })),
        inactiveUsers: classification.inactiveUsers.map((user) => ({
          userId: user.userId,
          nickname: user.nickname,
          totalTime: user.totalTime,
          status: 'inactive' as const,
        })),
        afkUsers: classification.afkUsers.map((user) => ({
          userId: user.userId,
          nickname: user.nickname,
          totalTime: user.totalTime,
          status: 'afk' as const,
        })),
        minHours: classification.minHours,
        reportCycle: 1,
      };
    } else {
      // 직접 분류
      return await this.directClassifyUsers(roleName, members, options);
    }
  }

  /**
   * 직접 사용자 분류
   */
  private async directClassifyUsers(
    roleName: string,
    members: Collection<string, GuildMember>,
    options: ReportOptions
  ): Promise<{
    activeUsers: ReportUser[];
    inactiveUsers: ReportUser[];
    afkUsers: ReportUser[];
    minHours: number;
    reportCycle?: number;
  }> {
    try {
      const roleConfig = await this.db.getRoleConfig(roleName);
      const minActivityHours = roleConfig ? roleConfig.minHours : 0;
      const minActivityTime = minActivityHours * 60 * 60 * 1000;

      const activeUsers: ReportUser[] = [];
      const inactiveUsers: ReportUser[] = [];
      const afkUsers: ReportUser[] = [];

      for (const [userId, member] of members) {
        const userActivity = await this.db.getUserActivity(userId);
        const totalTime = userActivity ? userActivity.totalTime : 0;

        const reportUser: ReportUser = {
          userId,
          nickname: member.displayName,
          totalTime,
          status: 'inactive',
        };

        if (member.roles.cache.some((r) => r.name.includes('잠수'))) {
          reportUser.status = 'afk';
          afkUsers.push(reportUser);
        } else if (totalTime >= minActivityTime) {
          reportUser.status = 'active';
          activeUsers.push(reportUser);
        } else {
          inactiveUsers.push(reportUser);
        }
      }

      // 정렬
      const sortFn = (a: ReportUser, b: ReportUser) => b.totalTime - a.totalTime;
      if (options.sortByTime !== false) {
        activeUsers.sort(sortFn);
        inactiveUsers.sort(sortFn);
        afkUsers.sort(sortFn);
      }

      return {
        activeUsers,
        inactiveUsers,
        afkUsers,
        minHours: minActivityHours,
        reportCycle: Number(roleConfig?.reportCycle) || 1,
      };
    } catch (error) {
      console.error('[ActivityReportService] 사용자 분류 오류:', error);
      return {
        activeUsers: [],
        inactiveUsers: [],
        afkUsers: [],
        minHours: 0,
        reportCycle: 1,
      };
    }
  }

  /**
   * 주간 요약 보고서 생성 및 전송
   */
  async generateWeeklySummaryReport(
    startTime: number,
    endTime: number,
    channel: TextChannel | ThreadChannel,
    options: ReportOptions = {}
  ): Promise<void> {
    try {
      const summary = await this.getWeeklySummaryData(startTime, endTime);
      const embed = this.createWeeklySummaryEmbed(
        summary,
        new Date(startTime),
        new Date(endTime),
        options
      );

      await channel.send({ embeds: [embed] });
      console.log('[ActivityReportService] 주간 요약 보고서가 성공적으로 전송되었습니다.');
    } catch (error) {
      console.error('[ActivityReportService] 주간 요약 보고서 생성 오류:', error);
      await this.sendErrorMessage(channel, '주간 요약 보고서 생성 중 오류가 발생했습니다.');
    }
  }

  /**
   * 주간 요약 데이터 수집
   */
  async getWeeklySummaryData(startTime: number, endTime: number, guildId: string): Promise<WeeklySummaryData> {
    try {
      const dailyStats = await this.db.getDailyActivityStats(startTime, endTime);

      let totalJoins = 0;
      let totalLeaves = 0;
      let activeDays = 0;

      for (const day of dailyStats) {
        totalJoins += day.joins;
        totalLeaves += day.leaves;
        if (day.totalEvents > 0) activeDays++;
      }

      const activeUsers = await this.db.getAllUserActivity();
      const topUsers = await this.processTopUsers(activeUsers, 5, guildId);
      const activeChannelStats = await this.getMostActiveChannels(startTime, endTime, 5);

      return {
        totalJoins,
        totalLeaves,
        activeDays,
        mostActiveUsers: topUsers,
        mostActiveChannels: activeChannelStats,
      };
    } catch (error) {
      console.error('[ActivityReportService] 주간 요약 데이터 생성 오류:', error);
      return {
        totalJoins: 0,
        totalLeaves: 0,
        activeDays: 0,
        mostActiveUsers: [],
        mostActiveChannels: [],
      };
    }
  }

  /**
   * 상위 사용자 처리
   */
  private async processTopUsers(activeUsers: UserActivity[], limit: number, guildId: string): Promise<TopUser[]> {
    const guild = this.client.guilds.cache.get(guildId);

    if (guild) {
      for (const user of activeUsers) {
        if (!user.displayName || user.displayName === user.userId) {
          try {
            const member = await guild.members.fetch(user.userId);
            if (member) {
              user.displayName = member.displayName;
            }
          } catch (error) {
            // 멤버를 찾을 수 없는 경우 (탈퇴 등)
            console.warn(`[ActivityReportService] 사용자 정보 조회 실패: ${user.userId}`);
          }
        }
      }
    }

    return activeUsers
      .sort((a, b) => b.totalTime - a.totalTime)
      .slice(0, limit)
      .map((user) => ({
        name: user.displayName || user.userId,
        totalTime: user.totalTime,
        userId: user.userId,
      }));
  }

  /**
   * 가장 활동적인 채널 목록 조회
   */
  async getMostActiveChannels(
    startTime: number,
    endTime: number,
    limit: number = 5
  ): Promise<ChannelActivity[]> {
    try {
      const logs = await this.db.getActivityLogs({
        startDate: new Date(startTime),
        endDate: new Date(endTime),
      });
      const channelStats: { [key: string]: number } = {};

      for (const log of logs) {
        if (!channelStats[log.channelName]) {
          channelStats[log.channelName] = 0;
        }
        channelStats[log.channelName]++;
      }

      return Object.entries(channelStats)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
    } catch (error) {
      console.error('[ActivityReportService] 활동적인 채널 조회 오류:', error);
      return [];
    }
  }

  /**
   * 주간 요약 임베드 생성
   */
  private createWeeklySummaryEmbed(
    summary: WeeklySummaryData,
    startDate: Date,
    endDate: Date,
    options: ReportOptions = {}
  ): EmbedBuilder {
    const startDateStr = formatKoreanDate(startDate).split(' ')[0];
    const endDateStr = formatKoreanDate(endDate).split(' ')[0];

    const embed = new EmbedBuilder()
      .setColor(COLORS.LOG)
      .setTitle(`📅 주간 활동 요약 (${startDateStr} ~ ${endDateStr})`)
      .setDescription('지난 주의 음성 채널 활동 요약입니다.');

    // 총 활동 통계
    embed.addFields({
      name: '📊 총 활동 통계',
      value: `입장: ${summary.totalJoins}회\n퇴장: ${summary.totalLeaves}회\n활동 일수: ${summary.activeDays}일`,
      inline: false,
    });

    // 가장 활동적인 사용자
    if (summary.mostActiveUsers.length > 0) {
      const maxUsers = options.maxUsersPerReport || 5;
      const userList = summary.mostActiveUsers
        .slice(0, maxUsers)
        .map((user) => `${user.name}: ${formatTime(user.totalTime)}`)
        .join('\n');

      embed.addFields({
        name: '👥 가장 활동적인 사용자',
        value: userList,
        inline: false,
      });
    } else {
      embed.addFields({
        name: '👥 가장 활동적인 사용자',
        value: '데이터 없음',
        inline: false,
      });
    }

    // 가장 활동적인 채널
    if (summary.mostActiveChannels.length > 0) {
      const maxChannels = options.maxChannelsPerReport || 5;
      const channelList = summary.mostActiveChannels
        .slice(0, maxChannels)
        .map((channel) => `${channel.name}: ${channel.count}회`)
        .join('\n');

      embed.addFields({
        name: '🔊 가장 활동적인 채널',
        value: channelList,
        inline: false,
      });
    } else {
      embed.addFields({
        name: '🔊 가장 활동적인 채널',
        value: '데이터 없음',
        inline: false,
      });
    }

    embed.setTimestamp();
    return embed;
  }

  /**
   * 날짜 범위 보고서 생성
   */
  async generateDateRangeReport(
    startDate: Date,
    endDate: Date,
    channel: TextChannel | ThreadChannel,
    options: ReportOptions = {}
  ): Promise<void> {
    try {
      const startTime = startDate.getTime();
      const endTime = endDate.getTime();

      const reportData = await this.getDateRangeReportData(startTime, endTime);
      const embed = this.createDateRangeEmbed(reportData, options);

      await channel.send({ embeds: [embed] });
      console.log('[ActivityReportService] 날짜 범위 보고서가 성공적으로 전송되었습니다.');
    } catch (error) {
      console.error('[ActivityReportService] 날짜 범위 보고서 생성 오류:', error);
      await this.sendErrorMessage(channel, '날짜 범위 보고서 생성 중 오류가 발생했습니다.');
    }
  }

  /**
   * 날짜 범위 보고서 데이터 수집
   */
  private async getDateRangeReportData(
    startTime: number,
    endTime: number
  ): Promise<DateRangeReport> {
    try {
      const dailyStats = await this.db.getDailyActivityStats(startTime, endTime);
      const summaries: DailySummary[] = [];

      for (const stat of dailyStats) {
        const dayLogs = await this.db.getActivityLogs({
          startDate: new Date(new Date(stat.date).getTime()),
          endDate: new Date(new Date(stat.date).getTime() + 24 * 60 * 60 * 1000),
        });

        const activeMembers = [...new Set(dayLogs.map((log: any) => log.userId))] as string[];
        const topChannels = await this.getMostActiveChannels(
          new Date(stat.date).getTime(),
          new Date(stat.date).getTime() + 24 * 60 * 60 * 1000,
          3
        );

        summaries.push({
          date: stat.date,
          totalJoins: stat.joins,
          totalLeaves: stat.leaves,
          totalEvents: stat.totalEvents,
          uniqueUsers: stat.uniqueUsers,
          activeMembers,
          topChannels,
        });
      }

      const totalStatistics = await this.getWeeklySummaryData(startTime, endTime);
      const trends = this.calculateTrends(summaries);

      return {
        startDate: new Date(startTime),
        endDate: new Date(endTime),
        summaries,
        totalStatistics,
        trends,
      };
    } catch (error) {
      console.error('[ActivityReportService] 날짜 범위 데이터 수집 오류:', error);
      throw error;
    }
  }

  /**
   * 트렌드 계산
   */
  private calculateTrends(summaries: DailySummary[]): ReportTrends {
    if (summaries.length === 0) {
      return {
        dailyGrowth: 0,
        weeklyGrowth: 0,
        peakActivityHour: 12,
        mostActiveWeekday: '월요일',
      };
    }

    // 일일 성장률 (단순화)
    const firstDay = summaries[0];
    const lastDay = summaries[summaries.length - 1];
    const dailyGrowth =
      firstDay.totalEvents > 0
        ? ((lastDay.totalEvents - firstDay.totalEvents) / firstDay.totalEvents) * 100
        : 0;

    // 주간 성장률 (단순화)
    const weeklyGrowth = dailyGrowth * 7;

    // 가장 활동적인 요일 찾기
    const weekdayStats: { [key: string]: number } = {};
    for (const summary of summaries) {
      const date = new Date(summary.date);
      const weekday = date.toLocaleDateString('ko-KR', { weekday: 'long' });
      weekdayStats[weekday] = (weekdayStats[weekday] || 0) + summary.totalEvents;
    }

    const mostActiveWeekday =
      Object.entries(weekdayStats).sort(([, a], [, b]) => b - a)[0]?.[0] || '월요일';

    return {
      dailyGrowth: Math.round(dailyGrowth * 100) / 100,
      weeklyGrowth: Math.round(weeklyGrowth * 100) / 100,
      peakActivityHour: 12, // 실제 구현에서는 시간별 로그 분석 필요
      mostActiveWeekday,
    };
  }

  /**
   * 날짜 범위 임베드 생성
   */
  private createDateRangeEmbed(reportData: DateRangeReport, options: ReportOptions): EmbedBuilder {
    const { startDate, endDate, totalStatistics, trends } = reportData;
    const startDateStr = formatKoreanDate(startDate).split(' ')[0];
    const endDateStr = formatKoreanDate(endDate).split(' ')[0];

    const embed = new EmbedBuilder()
      .setColor(COLORS.LOG)
      .setTitle(`📅 활동 요약 (${startDateStr} ~ ${endDateStr})`)
      .setDescription('선택한 기간의 음성 채널 활동 요약입니다.');

    // 총 활동 통계
    embed.addFields({
      name: '📊 총 활동 통계',
      value: `입장: ${totalStatistics.totalJoins}회\n퇴장: ${totalStatistics.totalLeaves}회\n활동 일수: ${totalStatistics.activeDays}일`,
      inline: false,
    });

    // 가장 활동적인 사용자
    if (totalStatistics.mostActiveUsers.length > 0) {
      const userList = totalStatistics.mostActiveUsers
        .slice(0, 5)
        .map((user) => `${user.name}: ${formatTime(user.totalTime)}`)
        .join('\n');

      embed.addFields({
        name: '👥 가장 활동적인 사용자',
        value: userList,
        inline: false,
      });
    }

    // 트렌드 정보
    if (options.includeStatistics) {
      embed.addFields({
        name: '📈 활동 트렌드',
        value: `일일 성장률: ${trends.dailyGrowth > 0 ? '+' : ''}${trends.dailyGrowth}%\n가장 활동적인 요일: ${trends.mostActiveWeekday}`,
        inline: false,
      });
    }

    embed.setTimestamp();
    return embed;
  }

  /**
   * 역할 보고서 임베드 생성 (레거시 호환성)
   */
  createRoleReportEmbed(
    roleName: string,
    activeMembers: ReportUser[],
    inactiveMembers: ReportUser[],
    minHours: number,
    startDate: Date,
    endDate: Date
  ): EmbedBuilder {
    const startDateStr = formatKoreanDate(startDate).split(' ')[0];
    const endDateStr = formatKoreanDate(endDate).split(' ')[0];

    const embed = new EmbedBuilder()
      .setColor(COLORS.LOG)
      .setTitle(`📊 ${roleName} 역할 활동 보고서 (${startDateStr} ~ ${endDateStr})`)
      .setDescription(`최소 활동 시간: ${minHours}시간`);

    // 활성 멤버
    const activeValue =
      activeMembers.length > 0
        ? activeMembers.map((m) => `${m.nickname}: ${formatTime(m.totalTime)}`).join('\n')
        : '없음';

    embed.addFields({
      name: `✅ 활동 기준 달성 멤버 (${activeMembers.length}명)`,
      value: activeValue.length > 1024 ? activeValue.substring(0, 1020) + '...' : activeValue,
      inline: false,
    });

    // 비활성 멤버
    const inactiveValue =
      inactiveMembers.length > 0
        ? inactiveMembers.map((m) => `${m.nickname}: ${formatTime(m.totalTime)}`).join('\n')
        : '없음';

    embed.addFields({
      name: `❌ 활동 기준 미달성 멤버 (${inactiveMembers.length}명)`,
      value: inactiveValue.length > 1024 ? inactiveValue.substring(0, 1020) + '...' : inactiveValue,
      inline: false,
    });

    embed.setTimestamp();
    return embed;
  }

  /**
   * 상세 통계 보고서 생성
   */
  async generateDetailedStatisticsReport(
    startTime: number,
    endTime: number,
    channel: TextChannel | ThreadChannel
  ): Promise<void> {
    try {
      const stats = await this.getDetailedStatistics(startTime, endTime);
      const embed = this.createDetailedStatisticsEmbed(
        stats,
        new Date(startTime),
        new Date(endTime)
      );

      await channel.send({ embeds: [embed] });
      console.log('[ActivityReportService] 상세 통계 보고서가 성공적으로 전송되었습니다.');
    } catch (error) {
      console.error('[ActivityReportService] 상세 통계 보고서 생성 오류:', error);
      await this.sendErrorMessage(channel, '상세 통계 보고서 생성 중 오류가 발생했습니다.');
    }
  }

  /**
   * 상세 통계 데이터 수집
   */
  private async getDetailedStatistics(
    startTime: number,
    endTime: number
  ): Promise<ReportStatistics> {
    try {
      const allUsers = await this.db.getAllUserActivity();
      const logs = await this.db.getActivityLogs({
        startDate: new Date(startTime),
        endDate: new Date(endTime),
      });

      const totalUsers = allUsers.length;
      const activeUsers = allUsers.filter((user: any) => user.totalTime > 0);
      const activePercentage = totalUsers > 0 ? (activeUsers.length / totalUsers) * 100 : 0;

      const totalTime = activeUsers.reduce((sum: number, user: any) => sum + user.totalTime, 0);
      const averageActivityTime = activeUsers.length > 0 ? totalTime / activeUsers.length : 0;

      // 일별 활동 분석
      const dailyActivity: { [key: string]: number } = {};
      for (const log of logs) {
        const date = new Date(log.timestamp).toISOString().split('T')[0];
        dailyActivity[date] = (dailyActivity[date] || 0) + 1;
      }

      const sortedDays = Object.entries(dailyActivity).sort(([, a], [, b]) => b - a);
      const mostActiveDay = sortedDays[0]?.[0] || '';
      const leastActiveDay = sortedDays[sortedDays.length - 1]?.[0] || '';

      return {
        totalUsers,
        activePercentage: Math.round(activePercentage * 100) / 100,
        averageActivityTime,
        mostActiveDay,
        leastActiveDay,
      };
    } catch (error) {
      console.error('[ActivityReportService] 상세 통계 데이터 수집 오류:', error);
      return {
        totalUsers: 0,
        activePercentage: 0,
        averageActivityTime: 0,
        mostActiveDay: '',
        leastActiveDay: '',
      };
    }
  }

  /**
   * 상세 통계 임베드 생성
   */
  private createDetailedStatisticsEmbed(
    stats: ReportStatistics,
    startDate: Date,
    endDate: Date
  ): EmbedBuilder {
    const startDateStr = formatKoreanDate(startDate).split(' ')[0];
    const endDateStr = formatKoreanDate(endDate).split(' ')[0];

    return new EmbedBuilder()
      .setColor(COLORS.INFO)
      .setTitle(`📈 상세 활동 통계 (${startDateStr} ~ ${endDateStr})`)
      .setDescription('기간 내 활동에 대한 상세 분석입니다.')
      .addFields(
        {
          name: '👥 사용자 통계',
          value: `총 사용자: ${stats.totalUsers}명\n활성 사용자 비율: ${stats.activePercentage}%`,
          inline: true,
        },
        {
          name: '⏱️ 활동 시간',
          value: `평균 활동 시간: ${formatTime(stats.averageActivityTime)}`,
          inline: true,
        },
        {
          name: '📅 활동 패턴',
          value: `가장 활동적인 날: ${stats.mostActiveDay}\n가장 조용한 날: ${stats.leastActiveDay}`,
          inline: false,
        }
      )
      .setTimestamp();
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
      console.error('[ActivityReportService] 오류 메시지 전송 실패:', error);
    }
  }

  /**
   * 보고서 예약 전송
   */
  async scheduleReport(
    type: 'weekly' | 'monthly' | 'custom',
    schedule: string,
    channelId: string,
    _options: ReportOptions = {}
  ): Promise<void> {
    // 실제 구현에서는 cron job이나 스케줄러 사용
    console.log(
      `[ActivityReportService] 보고서 예약: ${type}, 스케줄: ${schedule}, 채널: ${channelId}`
    );
  }

  /**
   * 보고서 내보내기 (CSV, JSON 등)
   */
  async exportReportData(
    startTime: number,
    endTime: number,
    format: 'csv' | 'json' = 'json'
  ): Promise<string> {
    try {
      const data = await this.getWeeklySummaryData(startTime, endTime);

      if (format === 'json') {
        return JSON.stringify(data, null, 2);
      } else if (format === 'csv') {
        // CSV 변환 로직 (실제 구현에서는 라이브러리 사용 권장)
        let csv = 'Date,Joins,Leaves,Active Days\n';
        csv += `${new Date(startTime).toISOString()},${data.totalJoins},${data.totalLeaves},${data.activeDays}\n`;
        return csv;
      }

      return JSON.stringify(data);
    } catch (error) {
      console.error('[ActivityReportService] 보고서 내보내기 오류:', error);
      throw error;
    }
  }

  /**
   * 정리 작업
   */
  cleanup(): void {
    console.log('[ActivityReportService] 정리 작업 완료');
  }
}

// ====================
// 유틸리티 함수
// ====================

/**
 * 보고서 데이터 유효성 검사
 */
export function validateReportData(data: any): boolean {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const requiredFields = ['totalJoins', 'totalLeaves', 'activeDays'];
  return requiredFields.every((field) => typeof data[field] === 'number');
}

/**
 * 보고서 요약 생성
 */
export function generateReportSummary(data: WeeklySummaryData): string {
  return `
활동 요약:
- 총 입장: ${data.totalJoins}회
- 총 퇴장: ${data.totalLeaves}회  
- 활동 일수: ${data.activeDays}일
- 상위 사용자: ${data.mostActiveUsers.length}명
- 상위 채널: ${data.mostActiveChannels.length}개
  `.trim();
}

/**
 * 보고서 제목 생성
 */
export function generateReportTitle(
  type: string,
  startDate: Date,
  endDate: Date,
  roleName?: string
): string {
  const start = formatKoreanDate(startDate).split(' ')[0];
  const end = formatKoreanDate(endDate).split(' ')[0];

  if (roleName) {
    return `📊 ${roleName} 역할 ${type} (${start} ~ ${end})`;
  }

  return `📊 ${type} (${start} ~ ${end})`;
}
