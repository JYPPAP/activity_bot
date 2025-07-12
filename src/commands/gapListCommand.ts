// src/commands/gapListCommand.ts - gap_list 명령어 (잠수 기능 개선)
import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { EmbedFactory } from '../utils/embedBuilder.js';
import { cleanRoleName } from '../utils/formatters.js';
import { CommandBase, CommandServices, CommandResult, CommandExecutionOptions, CommandMetadata } from './CommandBase.js';
import { UserClassificationService } from '../services/UserClassificationService.js';

export class GapListCommand extends CommandBase {
  public readonly metadata: CommandMetadata = {
    name: 'gap_list',
    description: '역할별 활동 목록을 조회합니다.',
    category: 'activity',
    cooldown: 10,
    guildOnly: true,
    usage: '/gap_list role:<역할이름>',
    examples: [
      '/gap_list role:정규',
      '/gap_list role:준회원'
    ],
    aliases: ['활동목록', 'list']
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
      .addStringOption(option =>
        option
          .setName('role')
          .setDescription('조회할 역할 이름')
          .setRequired(true)
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
   * gap_list 명령어의 실제 실행 로직
   * @param interaction - 상호작용 객체
   * @param options - 실행 옵션
   */
  protected async executeCommand(interaction: ChatInputCommandInteraction, _options: CommandExecutionOptions): Promise<CommandResult> {
    try {
      // 서비스 의존성 확인
      if (!this.userClassificationService) {
        throw new Error('UserClassificationService가 초기화되지 않았습니다.');
      }

      // 역할 옵션 가져오기
      const roleOption = interaction.options.getString("role");
      if (!roleOption) {
        throw new Error('역할 옵션이 제공되지 않았습니다.');
      }

      const roles = roleOption.split(',').map(r => cleanRoleName(r.trim()));
      const guild = interaction.guild;

      if (!guild) {
        throw new Error('이 명령어는 서버에서만 사용할 수 있습니다.');
      }

      // 캐시 확인
      const cacheKey = `gap_list_${roles.join('_')}_${guild.id}`;
      const cached = this.getCached<any>(cacheKey);
      
      if (cached) {
        await this.sendActivityEmbeds(interaction, cached.embeds);
        return {
          success: true,
          message: '캐시된 활동 데이터를 전송했습니다.',
          data: cached
        };
      }

      // 활동 데이터 초기화
      await this.activityTracker.initializeActivityData(guild);

      // 역할 멤버 가져오기
      const members = await guild.members.fetch();
      const roleMembers = members.filter(member =>
        member.roles.cache.some(r => roles.includes(r.name))
      );

      // 역할 멤버가 없는 경우 처리
      if (roleMembers.size === 0) {
        return {
          success: false,
          message: `지정된 역할(${roles.join(', ')})을 가진 멤버가 없습니다.`
        };
      }

      // 현재 활동 데이터 저장
      await this.activityTracker.saveActivityData();

      // 최신 데이터로 활성/비활성/잠수 사용자 분류
      const classificationResult = await this.userClassificationService.classifyUsers(roles[0], roleMembers);
      const { activeUsers, inactiveUsers, afkUsers, resetTime, minHours, statistics } = classificationResult;

      // 임베드 생성
      const embeds = EmbedFactory.createActivityEmbeds({
        role: roles[0],
        activeUsers,
        inactiveUsers,
        afkUsers,
        startDate: resetTime,
        endDate: new Date(),
        minHours,
        title: '활동 목록'
      });

      // 통계 정보 추가 (옵션)
      if (statistics && this.config.enableDetailedStats) {
        const statsEmbed = EmbedFactory.createStatsEmbed(statistics);
        embeds.push(statsEmbed);
      }

      // 캐시 저장
      const cacheData = {
        embeds,
        timestamp: Date.now(),
        roleMembers: roleMembers.size,
        activeCount: activeUsers.length,
        inactiveCount: inactiveUsers.length,
        afkCount: afkUsers.length
      };
      this.setCached(cacheKey, cacheData);

      // 임베드 전송
      await this.sendActivityEmbeds(interaction, embeds);

      return {
        success: true,
        message: '활동 목록을 성공적으로 전송했습니다.',
        data: {
          totalMembers: roleMembers.size,
          activeUsers: activeUsers.length,
          inactiveUsers: inactiveUsers.length,
          afkUsers: afkUsers.length,
          roles: roles
        }
      };

    } catch (error) {
      console.error('GapListCommand 실행 오류:', error);
      return {
        success: false,
        message: '활동 목록 조회 중 오류가 발생했습니다.',
        error: error as Error
      };
    }
  }

  /**
   * 활동 임베드 전송
   * @param interaction - 상호작용 객체
   * @param embeds - 전송할 임베드 배열
   */
  private async sendActivityEmbeds(interaction: ChatInputCommandInteraction, embeds: any[]): Promise<void> {
    try {
      // DM으로 임베드 전송 시도
      for (const embed of embeds) {
        await interaction.user.send({ embeds: [embed] });
      }

      // 명령어 실행한 채널에 알림
      await interaction.followUp({
        content: '📩 활동 데이터 임베드를 DM으로 전송했습니다!',
        flags: MessageFlags.Ephemeral,
      });

    } catch (dmError) {
      console.warn('DM 전송 실패, 채널에서 직접 전송:', dmError);

      try {
        // DM 전송 실패 시 채널에서 직접 임베드 제공
        // 임베드가 너무 많은 경우 분할 전송
        const maxEmbedsPerMessage = 10;
        
        for (let i = 0; i < embeds.length; i += maxEmbedsPerMessage) {
          const embedBatch = embeds.slice(i, i + maxEmbedsPerMessage);
          
          if (i === 0) {
            await interaction.followUp({
              content: '📂 DM 전송에 실패했습니다. 여기에서 확인하세요:',
              embeds: embedBatch,
              flags: MessageFlags.Ephemeral,
            });
          } else {
            await interaction.followUp({
              embeds: embedBatch,
              flags: MessageFlags.Ephemeral,
            });
          }
        }

      } catch (followUpError) {
        console.error('팔로우업 전송도 실패:', followUpError);
        
        // 최후의 수단으로 간단한 텍스트 메시지 전송
        await interaction.followUp({
          content: '❌ 활동 데이터 전송에 실패했습니다. 잠시 후 다시 시도해주세요.',
          flags: MessageFlags.Ephemeral,
        });
        
        throw followUpError;
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
• 지정된 역할의 멤버들을 활성/비활성/잠수 상태로 분류하여 보여줍니다.
• 결과는 DM으로 전송되며, DM 전송이 실패할 경우 채널에서 확인할 수 있습니다.
• 여러 역할을 쉼표로 구분하여 조회할 수 있습니다.

**예시:**
${this.metadata.examples?.map(ex => `\`${ex}\``).join('\n')}

**쿨다운:** ${this.metadata.cooldown}초
**권한:** 서버 전용`;
  }

  /**
   * 설정 업데이트
   */
  public updateConfig(newConfig: any): void {
    super.updateConfig(newConfig);
    
    // 추가 설정 처리
    if (newConfig.enableDetailedStats !== undefined) {
      this.config.enableDetailedStats = newConfig.enableDetailedStats;
    }
  }
}