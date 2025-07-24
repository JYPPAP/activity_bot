// src/commands/FeatureStatusCommand.ts - 기능 상태 조회 명령어
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { injectable, inject } from 'tsyringe';

import { FeatureManagerService, Features } from '../services/FeatureManagerService';

import {
  CommandBase,
  CommandMetadata,
  CommandResult,
  CommandExecutionOptions,
  CommandServices,
} from './CommandBase';

/**
 * 기능 상태 조회 명령어
 * 현재 활성화된 기능들과 비활성화된 기능들을 표시
 */
@injectable()
export class FeatureStatusCommand extends CommandBase {
  public readonly metadata: CommandMetadata = {
    name: '기능상태',
    description: '현재 활성화된 기능들과 비활성화된 기능들을 확인합니다',
    category: '시스템',
    adminOnly: false,
    guildOnly: false,
    devOnly: false,
    usage: '/기능상태 [카테고리] [상세]',
    examples: ['/기능상태', '/기능상태 core true'],
  };

  constructor(@inject(FeatureManagerService) private featureManager: FeatureManagerService) {
    // Note: services will be injected later when the command is registered
    super({} as CommandServices);
  }

  /**
   * 슬래시 명령어 빌더
   */
  buildSlashCommand(): SlashCommandBuilder {
    const builder = new SlashCommandBuilder()
      .setName('기능상태')
      .setDescription('현재 활성화된 기능들과 비활성화된 기능들을 확인합니다');

    builder.addStringOption((option) =>
      option
        .setName('카테고리')
        .setDescription('특정 기능 카테고리만 표시')
        .setRequired(false)
        .addChoices(
          { name: '전체', value: 'all' },
          { name: '코어', value: 'core' },
          { name: '고급', value: 'advanced' },
          { name: '통계', value: 'stats' },
          { name: '알림', value: 'notifications' },
          { name: '데이터베이스', value: 'database' },
          { name: '개발도구', value: 'dev' }
        )
    );

    builder.addBooleanOption((option) =>
      option.setName('상세').setDescription('비활성화된 기능의 상세 이유를 표시').setRequired(false)
    );

    return builder;
  }

  /**
   * 명령어 실행
   */
  protected async executeCommand(
    interaction: ChatInputCommandInteraction,
    _options: CommandExecutionOptions
  ): Promise<CommandResult> {
    const startTime = Date.now();
    const category = interaction.options.getString('카테고리') || 'all';
    const detailed = interaction.options.getBoolean('상세') || false;

    try {
      const embed = await this.createFeatureStatusEmbed(category, detailed);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

      return {
        success: true,
        message: '기능 상태를 성공적으로 조회했습니다.',
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      console.error('[FeatureStatusCommand] 실행 오류:', error);
      await interaction.reply({
        content: '기능 상태를 조회하는 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });

      return {
        success: false,
        message: '기능 상태 조회 실패',
        error: error instanceof Error ? error : new Error(String(error)),
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * 기능 상태 임베드 생성
   */
  private async createFeatureStatusEmbed(
    category: string,
    detailed: boolean
  ): Promise<EmbedBuilder> {
    const stats = this.featureManager.getStats();
    const allStatuses = this.featureManager.getAllFeatureStatuses();

    const embed = new EmbedBuilder()
      .setTitle('🔧 기능 상태')
      .setColor(0x00ff00)
      .setTimestamp()
      .setFooter({ text: 'Discord Activity Bot' });

    // 통계 정보
    embed.addFields({
      name: '📊 전체 통계',
      value: [
        `총 기능 수: ${stats.totalFeatures}개`,
        `활성화: ${stats.enabledFeatures}개 (${stats.enabledPercentage}%)`,
        `비활성화: ${stats.disabledFeatures}개`,
      ].join('\n'),
      inline: false,
    });

    // 카테고리별 필터링
    const filteredFeatures = this.filterFeaturesByCategory(allStatuses, category);

    if (filteredFeatures.length === 0) {
      embed.addFields({
        name: '⚠️ 해당 카테고리',
        value: '선택한 카테고리에 기능이 없습니다.',
        inline: false,
      });
      return embed;
    }

    // 활성화된 기능들
    const enabledFeatures = filteredFeatures.filter((f) => f.enabled);
    if (enabledFeatures.length > 0) {
      const enabledList = enabledFeatures.map((f) => `✅ ${this.getFeatureDisplayName(f.feature)}`);
      embed.addFields({
        name: '🟢 활성화된 기능',
        value: enabledList.join('\n') || '없음',
        inline: true,
      });
    }

    // 비활성화된 기능들
    const disabledFeatures = filteredFeatures.filter((f) => !f.enabled);
    if (disabledFeatures.length > 0) {
      const disabledList = disabledFeatures.map((f) => {
        const name = this.getFeatureDisplayName(f.feature);
        if (detailed && f.reason) {
          return `❌ ${name}\n   └ ${f.reason}`;
        }
        return `❌ ${name}`;
      });

      embed.addFields({
        name: '🔴 비활성화된 기능',
        value: disabledList.join('\n') || '없음',
        inline: true,
      });
    }

    // 환경 정보
    const environment = process.env.NODE_ENV || 'development';
    embed.addFields({
      name: '🌍 환경 정보',
      value: [
        `현재 환경: ${environment}`,
        `설정 확인 시간: ${new Date().toLocaleString('ko-KR')}`,
      ].join('\n'),
      inline: false,
    });

    return embed;
  }

  /**
   * 카테고리별 기능 필터링
   */
  private filterFeaturesByCategory(features: any[], category: string): any[] {
    if (category === 'all') {
      return features;
    }

    const categoryMap: Record<string, Features[]> = {
      core: [Features.ACTIVITY_TRACKING, Features.VOICE_LOGGING, Features.SLASH_COMMANDS],
      advanced: [
        Features.EMOJI_REACTIONS,
        Features.FORUM_INTEGRATION,
        Features.AFK_MANAGEMENT,
        Features.USER_CLASSIFICATION,
      ],
      stats: [Features.DAILY_STATS, Features.WEEKLY_REPORTS, Features.ACTIVITY_ANALYTICS],
      notifications: [
        Features.SLACK_NOTIFICATIONS,
        Features.DISCORD_ALERTS,
        Features.ERROR_REPORTING,
      ],
      database: [Features.POSTGRESQL_SUPPORT, Features.REDIS_CACHING, Features.DATA_MIGRATION],
      dev: [Features.DEBUG_MODE, Features.PERFORMANCE_MONITORING, Features.API_ENDPOINTS],
    };

    const categoryFeatures = categoryMap[category] || [];
    return features.filter((f) => categoryFeatures.includes(f.feature));
  }

  /**
   * 기능 표시명 가져오기
   */
  private getFeatureDisplayName(feature: Features): string {
    const displayNames: Record<Features, string> = {
      [Features.ACTIVITY_TRACKING]: '활동 시간 추적',
      [Features.VOICE_LOGGING]: '음성 채널 로깅',
      [Features.SLASH_COMMANDS]: '슬래시 명령어',
      [Features.EMOJI_REACTIONS]: '이모지 반응',
      [Features.FORUM_INTEGRATION]: '포럼 통합',
      [Features.AFK_MANAGEMENT]: 'AFK 관리',
      [Features.USER_CLASSIFICATION]: '사용자 분류',
      [Features.DAILY_STATS]: '일일 통계',
      [Features.WEEKLY_REPORTS]: '주간 리포트',
      [Features.ACTIVITY_ANALYTICS]: '활동 분석',
      [Features.SLACK_NOTIFICATIONS]: 'Slack 알림',
      [Features.DISCORD_ALERTS]: 'Discord 알림',
      [Features.ERROR_REPORTING]: '오류 리포팅',
      [Features.POSTGRESQL_SUPPORT]: 'PostgreSQL 지원',
      [Features.REDIS_CACHING]: 'Redis 캐싱',
      [Features.DATA_MIGRATION]: '데이터 마이그레이션',
      [Features.DEBUG_MODE]: '디버그 모드',
      [Features.PERFORMANCE_MONITORING]: '성능 모니터링',
      [Features.API_ENDPOINTS]: 'API 엔드포인트',
    };

    return displayNames[feature] || feature;
  }
}
