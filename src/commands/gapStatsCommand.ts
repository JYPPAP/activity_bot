// src/commands/gapStatsCommand.ts - 상세 통계 명령어
import { ChatInputCommandInteraction, MessageFlags, EmbedBuilder, SlashCommandBuilder, User } from 'discord.js';
import { COLORS } from '../config/constants.js';
import { formatTime, formatKoreanDate } from '../utils/formatters.js';
import { CommandBase, CommandServices, CommandResult, CommandExecutionOptions, CommandMetadata } from './CommandBase.js';

// 활동 로그 인터페이스
interface ActivityLog {
  timestamp: number;
  eventType: 'JOIN' | 'LEAVE';
  channelName: string;
  channelId: string;
  userId: string;
}

// 사용자 활동 통계 인터페이스
interface UserActivityStats {
  joins: number;
  leaves: number;
  activeDays: Set<string>;
  channelUsage: Map<string, number>;
  hourlyActivity: number[];
  totalEvents: number;
  recentLogs: ActivityLog[];
}

// 서버 통계 인터페이스
interface ServerStats {
  totalJoins: number;
  totalLeaves: number;
  activeDays: number;
  topActiveUsers: UserActivitySummary[];
  topChannels: ChannelActivity[];
  peakHours: HourlyActivity[];
}

// 사용자 활동 요약 인터페이스
interface UserActivitySummary {
  name: string;
  totalEvents: number;
  joins: number;
  leaves: number;
  userId: string;
}

// 채널 활동 인터페이스
interface ChannelActivity {
  channelName: string;
  eventCount: number;
}

// 시간대 활동 인터페이스
interface HourlyActivity {
  hour: string;
  eventCount: number;
}

// 일별 통계 인터페이스
interface DailyStats {
  date: string;
  joins: number;
  leaves: number;
  uniqueUsers: number;
}

export class GapStatsCommand extends CommandBase {
  public readonly metadata: CommandMetadata = {
    name: 'gap_stats',
    description: '상세한 활동 통계를 생성합니다.',
    category: 'activity',
    cooldown: 15,
    guildOnly: true,
    usage: '/gap_stats [days:<일수>] [user:<사용자>]',
    examples: [
      '/gap_stats',
      '/gap_stats days:14',
      '/gap_stats user:@사용자',
      '/gap_stats days:30 user:@사용자'
    ],
    aliases: ['stats', '통계']
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
      .addIntegerOption(option =>
        option
          .setName('days')
          .setDescription('조회할 일수 (기본값: 7일)')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(365)
      )
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('특정 사용자의 통계 조회')
          .setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('type')
          .setDescription('통계 유형')
          .setRequired(false)
          .addChoices(
            { name: '기본', value: 'basic' },
            { name: '상세', value: 'detailed' },
            { name: '시간대', value: 'hourly' },
            { name: '채널', value: 'channel' }
          )
      )
      .addBooleanOption(option =>
        option
          .setName('include_charts')
          .setDescription('차트 포함 여부')
          .setRequired(false)
      ) as SlashCommandBuilder;
  }

  /**
   * gap_stats 명령어의 실제 실행 로직
   * @param interaction - 상호작용 객체
   * @param options - 실행 옵션
   */
  protected async executeCommand(interaction: ChatInputCommandInteraction, options: CommandExecutionOptions): Promise<CommandResult> {
    try {
      // 기간 옵션 가져오기 (기본: 7일)
      const days = interaction.options.getInteger("days") || 7;
      const user = interaction.options.getUser("user");
      const type = interaction.options.getString("type") || 'basic';
      const includeCharts = interaction.options.getBoolean("include_charts") || false;

      // 날짜 범위 유효성 검사
      if (days < 1 || days > 365) {
        return {
          success: false,
          message: "일수는 1일부터 365일까지 입력할 수 있습니다."
        };
      }

      // 캐시 확인
      const cacheKey = `stats_${user?.id || 'global'}_${days}_${type}`;
      const cached = this.getCached<any>(cacheKey);
      
      if (cached) {
        await this.sendCachedStats(interaction, cached);
        return {
          success: true,
          message: '캐시된 통계를 전송했습니다.',
          data: cached
        };
      }

      // 날짜 범위 계산
      const now = new Date();
      const startDate = new Date(now);
      startDate.setDate(now.getDate() - days);
      startDate.setHours(0, 0, 0, 0);

      const startTime = startDate.getTime();
      const endTime = now.getTime();

      // 진행 상황 알림
      await interaction.followUp({
        content: `📊 **통계 생성 중...**\n\n` +
                `📅 **기간:** ${days}일\n` +
                `👤 **대상:** ${user ? user.username : '서버 전체'}\n` +
                `📋 **유형:** ${this.getTypeDisplayName(type)}\n` +
                `📈 **차트 포함:** ${includeCharts ? '예' : '아니오'}\n\n` +
                `⏳ **처리 중...**`,
        flags: MessageFlags.Ephemeral,
      });

      // 상세 통계 생성
      let result: any;
      if (user) {
        // 특정 사용자의 통계
        result = await this.generateUserStats(interaction, user, startTime, endTime, type, includeCharts);
      } else {
        // 전체 통계
        result = await this.generateGlobalStats(interaction, startTime, endTime, days, type, includeCharts);
      }

      // 캐시 저장
      this.setCached(cacheKey, result);

      // 로그 기록
      if (this.logService) {
        this.logService.logActivity(
          `통계 조회: ${user ? user.username : '서버 전체'}`,
          [interaction.user.id, ...(user ? [user.id] : [])],
          'stats_query',
          {
            days,
            user: user?.id,
            type,
            includeCharts
          }
        );
      }

      return {
        success: true,
        message: '통계가 성공적으로 생성되었습니다.',
        data: result
      };

    } catch (error) {
      console.error('gap_stats 명령어 실행 오류:', error);
      
      const errorMessage = error instanceof Error ? error.message : '통계 데이터 생성 중 오류가 발생했습니다.';
      
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
   * 특정 사용자의 상세 통계를 생성하고 전송합니다.
   * @param interaction - 상호작용 객체
   * @param user - 사용자
   * @param startTime - 시작 시간
   * @param endTime - 종료 시간
   * @param type - 통계 유형
   * @param includeCharts - 차트 포함 여부
   */
  private async generateUserStats(
    interaction: ChatInputCommandInteraction,
    user: User,
    startTime: number,
    endTime: number,
    type: string,
    includeCharts: boolean
  ): Promise<any> {
    // 사용자 활동 시간 조회
    const userActivity = await this.dbManager.getUserActivity(user.id);

    // 사용자 활동 로그 조회
    const logs = await this.dbManager.getUserActivityLogs(user.id, 1000);

    // 로그 필터링 (기간 내)
    const filteredLogs = logs.filter(log => log.timestamp >= startTime && log.timestamp <= endTime);

    // 통계 계산
    const stats = this.calculateUserStats(filteredLogs);

    // 임베드 생성
    const statsEmbed = this.createUserStatsEmbed(user, stats, startTime, endTime, type);

    // 통계 전송
    await interaction.followUp({
      embeds: [statsEmbed],
      flags: MessageFlags.Ephemeral,
    });

    return {
      user: user.id,
      stats,
      embed: statsEmbed
    };
  }

  /**
   * 서버 전체의 상세 통계를 생성하고 전송합니다.
   * @param interaction - 상호작용 객체
   * @param startTime - 시작 시간
   * @param endTime - 종료 시간
   * @param days - 일수
   * @param type - 통계 유형
   * @param includeCharts - 차트 포함 여부
   */
  private async generateGlobalStats(
    interaction: ChatInputCommandInteraction,
    startTime: number,
    endTime: number,
    days: number,
    type: string,
    includeCharts: boolean
  ): Promise<any> {
    // 일별 활동 통계 조회
    const dailyStats = await this.dbManager.getDailyActivityStats(startTime, endTime);

    // 서버 통계 계산
    const serverStats = await this.calculateServerStats(startTime, endTime, interaction);

    // 임베드 생성
    const statsEmbed = this.createServerStatsEmbed(serverStats, startTime, endTime, days, type);

    // 통계 전송
    await interaction.followUp({
      embeds: [statsEmbed],
      flags: MessageFlags.Ephemeral,
    });

    return {
      serverStats,
      dailyStats,
      embed: statsEmbed
    };
  }

  /**
   * 사용자 통계 계산
   * @param logs - 활동 로그 배열
   */
  private calculateUserStats(logs: ActivityLog[]): UserActivityStats {
    const stats: UserActivityStats = {
      joins: 0,
      leaves: 0,
      activeDays: new Set(),
      channelUsage: new Map(),
      hourlyActivity: Array(24).fill(0),
      totalEvents: logs.length,
      recentLogs: []
    };

    // 로그 분석
    logs.forEach(log => {
      // 입장/퇴장 카운트
      if (log.eventType === 'JOIN') {
        stats.joins++;
      } else if (log.eventType === 'LEAVE') {
        stats.leaves++;
      }

      // 활동 날짜 추가
      const date = new Date(log.timestamp).toISOString().split('T')[0];
      stats.activeDays.add(date);

      // 채널 사용 카운트
      const channelCount = stats.channelUsage.get(log.channelName) || 0;
      stats.channelUsage.set(log.channelName, channelCount + 1);

      // 시간대 활동 카운트
      const hour = new Date(log.timestamp).getHours();
      stats.hourlyActivity[hour]++;
    });

    // 최근 로그 (최대 5개)
    stats.recentLogs = logs
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);

    return stats;
  }

  /**
   * 서버 통계 계산
   * @param startTime - 시작 시간
   * @param endTime - 종료 시간
   * @param interaction - 상호작용 객체
   */
  private async calculateServerStats(startTime: number, endTime: number, interaction: ChatInputCommandInteraction): Promise<ServerStats> {
    // 일별 활동 통계 조회
    const dailyStats = await this.dbManager.getDailyActivityStats(startTime, endTime);

    // 총 입장/퇴장 횟수
    const totalJoins = dailyStats.reduce((sum, day) => sum + day.joins, 0);
    const totalLeaves = dailyStats.reduce((sum, day) => sum + day.leaves, 0);

    // 활동적인 사용자 조회
    const topActiveUsers = await this.getTopActiveUsers(startTime, endTime, interaction);

    // 가장 활동적인 채널 조회
    const topChannels = await this.getTopChannels(startTime, endTime);

    // 시간대별 활동 통계
    const peakHours = await this.getPeakHours(startTime, endTime);

    return {
      totalJoins,
      totalLeaves,
      activeDays: dailyStats.length,
      topActiveUsers,
      topChannels,
      peakHours
    };
  }

  /**
   * 상위 활동 사용자 조회
   * @param startTime - 시작 시간
   * @param endTime - 종료 시간
   * @param interaction - 상호작용 객체
   */
  private async getTopActiveUsers(startTime: number, endTime: number, interaction: ChatInputCommandInteraction): Promise<UserActivitySummary[]> {
    const activeUsersQuery = `
      SELECT userId, eventType, COUNT(*) as eventCount
      FROM activity_logs
      WHERE timestamp BETWEEN ? AND ?
      GROUP BY userId, eventType
    `;

    const userEvents = await this.dbManager.db.all(activeUsersQuery, startTime, endTime);

    // 사용자별 활동 합산
    const userActivityMap = new Map<string, { joins: number; leaves: number }>();
    for (const event of userEvents) {
      if (!userActivityMap.has(event.userId)) {
        userActivityMap.set(event.userId, { joins: 0, leaves: 0 });
      }

      const userData = userActivityMap.get(event.userId)!;
      if (event.eventType === 'JOIN') {
        userData.joins += event.eventCount;
      } else if (event.eventType === 'LEAVE') {
        userData.leaves += event.eventCount;
      }
    }

    // 사용자 ID를 표시 이름으로 변환
    const activeUsers: UserActivitySummary[] = [];
    for (const [userId, data] of userActivityMap.entries()) {
      const totalEvents = data.joins + data.leaves;

      // 사용자 데이터 조회
      const userActivity = await this.dbManager.getUserActivity(userId);

      // 디스코드 서버에서 직접 멤버 정보 가져오기
      let displayName = userActivity?.displayName || userId;
      try {
        const guild = interaction.guild;
        if (guild) {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (member) {
            displayName = member.displayName;
          }
        }
      } catch (error) {
        console.error(`사용자 정보 조회 실패: ${userId}`, error);
      }

      activeUsers.push({
        name: displayName,
        totalEvents,
        joins: data.joins,
        leaves: data.leaves,
        userId
      });
    }

    // 활동량 기준 정렬
    return activeUsers.sort((a, b) => b.totalEvents - a.totalEvents).slice(0, 5);
  }

  /**
   * 상위 채널 조회
   * @param startTime - 시작 시간
   * @param endTime - 종료 시간
   */
  private async getTopChannels(startTime: number, endTime: number): Promise<ChannelActivity[]> {
    const activeChannelsQuery = `
      SELECT channelName, COUNT(*) as eventCount
      FROM activity_logs
      WHERE timestamp BETWEEN ? AND ?
        AND channelName != '방-생성하기'
      GROUP BY channelName
      ORDER BY eventCount DESC
      LIMIT 5
    `;

    return await this.dbManager.db.all(activeChannelsQuery, startTime, endTime);
  }

  /**
   * 피크 시간대 조회
   * @param startTime - 시작 시간
   * @param endTime - 종료 시간
   */
  private async getPeakHours(startTime: number, endTime: number): Promise<HourlyActivity[]> {
    const hourlyStatsQuery = `
      SELECT strftime('%H', timestamp/1000, 'unixepoch', 'localtime') as hour, 
           COUNT(*) as eventCount
      FROM activity_logs
      WHERE timestamp BETWEEN ? AND ?
      GROUP BY hour
      ORDER BY eventCount DESC
      LIMIT 5
    `;

    return await this.dbManager.db.all(hourlyStatsQuery, startTime, endTime);
  }

  /**
   * 사용자 통계 임베드 생성
   * @param user - 사용자
   * @param stats - 통계 데이터
   * @param startTime - 시작 시간
   * @param endTime - 종료 시간
   * @param type - 통계 유형
   */
  private createUserStatsEmbed(user: User, stats: UserActivityStats, startTime: number, endTime: number, type: string): EmbedBuilder {
    // 자주 사용한 채널 TOP 5
    const topChannels = Array.from(stats.channelUsage.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // 활동 시간대 TOP 3
    const peakHours = stats.hourlyActivity
      .map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(item => `${item.hour}시 (${item.count}회)`);

    // 최근 활동 내역
    const recentLogs = stats.recentLogs.map(log => {
      const date = formatKoreanDate(new Date(log.timestamp));
      return `${date} - ${log.eventType === 'JOIN' ? '입장' : '퇴장'} (${log.channelName})`;
    });

    const embed = new EmbedBuilder()
      .setColor(COLORS.LOG)
      .setTitle(`📊 ${user.username}님의 활동 통계`)
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        {
          name: '📅 조회 기간',
          value: `${formatKoreanDate(new Date(startTime))} ~ ${formatKoreanDate(new Date(endTime))}`
        },
        {
          name: '📈 활동 요약',
          value: `입장: ${stats.joins}회\n퇴장: ${stats.leaves}회\n활동 일수: ${stats.activeDays.size}일`
        },
        {
          name: '🔊 자주 사용한 채널',
          value: topChannels.length > 0
            ? topChannels.map(([channel, count]) => `${channel}: ${count}회`).join('\n')
            : '데이터 없음'
        },
        {
          name: '⏰ 주요 활동 시간대',
          value: peakHours.length > 0 ? peakHours.join(', ') : '데이터 없음'
        }
      );

    if (recentLogs.length > 0) {
      embed.addFields({
        name: '🕒 최근 활동 내역',
        value: recentLogs.join('\n')
      });
    }

    return embed;
  }

  /**
   * 서버 통계 임베드 생성
   * @param stats - 서버 통계
   * @param startTime - 시작 시간
   * @param endTime - 종료 시간
   * @param days - 일수
   * @param type - 통계 유형
   */
  private createServerStatsEmbed(stats: ServerStats, startTime: number, endTime: number, days: number, type: string): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(COLORS.LOG)
      .setTitle(`📊 서버 활동 통계 (최근 ${days}일)`)
      .addFields(
        {
          name: '📅 조회 기간',
          value: `${formatKoreanDate(new Date(startTime))} ~ ${formatKoreanDate(new Date(endTime))}`
        },
        {
          name: '📈 활동 요약',
          value: `입장: ${stats.totalJoins}회\n퇴장: ${stats.totalLeaves}회\n활동 일수: ${stats.activeDays}일`
        },
        {
          name: '👥 가장 활동적인 사용자 TOP 5',
          value: stats.topActiveUsers.length > 0
            ? stats.topActiveUsers.map(user => `${user.name}: ${user.totalEvents}회 (입장 ${user.joins}회, 퇴장 ${user.leaves}회)`).join('\n')
            : '데이터 없음'
        },
        {
          name: '🔊 가장 활동적인 채널 TOP 5',
          value: stats.topChannels.length > 0
            ? stats.topChannels.map(channel => `${channel.channelName}: ${channel.eventCount}회`).join('\n')
            : '데이터 없음'
        },
        {
          name: '⏰ 가장 활발한 시간대 TOP 5',
          value: stats.peakHours.length > 0
            ? stats.peakHours.map(hour => `${hour.hour}시: ${hour.eventCount}회`).join('\n')
            : '데이터 없음'
        }
      );

    return embed;
  }

  /**
   * 캐시된 통계 전송
   * @param interaction - 상호작용 객체
   * @param cached - 캐시된 데이터
   */
  private async sendCachedStats(interaction: ChatInputCommandInteraction, cached: any): Promise<void> {
    await interaction.followUp({
      content: '📋 **캐시된 통계를 사용합니다.**',
      embeds: [cached.embed],
      flags: MessageFlags.Ephemeral,
    });
  }

  /**
   * 통계 유형 표시명 반환
   * @param type - 통계 유형
   */
  private getTypeDisplayName(type: string): string {
    switch (type) {
      case 'basic': return '기본 통계';
      case 'detailed': return '상세 통계';
      case 'hourly': return '시간대별 통계';
      case 'channel': return '채널별 통계';
      default: return '기본 통계';
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
• 서버 또는 특정 사용자의 상세한 활동 통계를 생성합니다.
• 일별, 시간대별, 채널별 활동 패턴을 분석합니다.
• 최근 활동 내역과 주요 통계를 제공합니다.

**옵션:**
• \`days\`: 조회할 일수 (1-365일, 기본값: 7일)
• \`user\`: 특정 사용자의 통계 조회 (선택사항)
• \`type\`: 통계 유형 (기본/상세/시간대/채널)
• \`include_charts\`: 차트 포함 여부 (선택사항)

**예시:**
${this.metadata.examples?.map(ex => `\`${ex}\``).join('\n')}

**기능:**
• 활동 요약 (입장/퇴장 횟수, 활동 일수)
• 상위 활동 사용자 및 채널 분석
• 시간대별 활동 패턴 분석
• 최근 활동 내역 제공

**권한:** 서버 전용
**쿨다운:** ${this.metadata.cooldown}초`;
  }
}