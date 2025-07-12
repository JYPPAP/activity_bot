// src/commands/recruitmentCommand.ts - 구인구직 명령어
import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder, User, GuildMember } from 'discord.js';
import { CommandBase, CommandServices, CommandResult, CommandExecutionOptions, CommandMetadata } from './CommandBase.js';

// 구인구직 통계 인터페이스
interface RecruitmentStats {
  totalPosts: number;
  activePosts: number;
  completedPosts: number;
  totalApplicants: number;
  averageApplicationsPerPost: number;
  mostActiveUser: string;
  mostPopularCategory: string;
}

// 구인구직 옵션 인터페이스
interface RecruitmentOptions {
  category?: string;
  priority?: 'low' | 'medium' | 'high';
  duration?: number;
  maxApplicants?: number;
  autoClose?: boolean;
}

// 구인구직 필터 인터페이스
interface RecruitmentFilter {
  category?: string;
  status?: 'active' | 'completed' | 'cancelled';
  userId?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

// 구인구직 결과 인터페이스
interface RecruitmentResult {
  postId: string;
  title: string;
  category: string;
  applicants: number;
  status: string;
  createdAt: Date;
  closedAt?: Date;
}

export class RecruitmentCommand extends CommandBase {
  public readonly metadata: CommandMetadata = {
    name: 'recruitment',
    description: '구인구직 게시글을 작성하고 관리합니다.',
    category: 'recruitment',
    cooldown: 30,
    guildOnly: true,
    usage: '/recruitment [action:<액션>] [category:<카테고리>]',
    examples: [
      '/recruitment',
      '/recruitment action:create',
      '/recruitment action:list',
      '/recruitment action:stats',
      '/recruitment action:manage'
    ],
    aliases: ['구인구직', 'job', 'hire']
  };

  private voiceForumService: any;

  constructor(services: CommandServices) {
    super(services);
    this.voiceForumService = services.voiceForumService;
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
          .setName('action')
          .setDescription('수행할 작업')
          .setRequired(false)
          .addChoices(
            { name: '새 게시글 작성', value: 'create' },
            { name: '내 게시글 목록', value: 'list' },
            { name: '통계 보기', value: 'stats' },
            { name: '게시글 관리', value: 'manage' },
            { name: '도움말', value: 'help' }
          )
      )
      .addStringOption(option =>
        option
          .setName('category')
          .setDescription('구인구직 카테고리')
          .setRequired(false)
          .addChoices(
            { name: '게임', value: 'game' },
            { name: '스터디', value: 'study' },
            { name: '프로젝트', value: 'project' },
            { name: '기타', value: 'other' }
          )
      )
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('특정 사용자의 게시글 조회')
          .setRequired(false)
      )
      .addIntegerOption(option =>
        option
          .setName('limit')
          .setDescription('조회할 게시글 수')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(50)
      ) as SlashCommandBuilder;
  }

  /**
   * recruitment 명령어의 실제 실행 로직
   * @param interaction - 상호작용 객체
   * @param options - 실행 옵션
   */
  protected async executeCommand(interaction: ChatInputCommandInteraction, options: CommandExecutionOptions): Promise<CommandResult> {
    try {
      // 권한 체크
      if (!this.hasRecruitmentPermission(interaction.user, interaction.member)) {
        await interaction.followUp({
          content: '❌ **구인구직 기능 접근 권한이 없습니다.**\n\n이 기능은 현재 베타 테스트 중으로 특정 사용자와 관리자만 이용할 수 있습니다.',
          flags: MessageFlags.Ephemeral
        });
        
        return {
          success: false,
          message: '구인구직 기능 접근 권한이 없습니다.'
        };
      }

      const action = interaction.options.getString('action') || 'create';
      const category = interaction.options.getString('category');
      const targetUser = interaction.options.getUser('user');
      const limit = interaction.options.getInteger('limit') || 10;

      // 캐시 확인
      const cacheKey = `recruitment_${action}_${category || 'all'}_${targetUser?.id || 'global'}_${limit}`;
      const cached = this.getCached<any>(cacheKey);
      
      if (cached && ['list', 'stats'].includes(action)) {
        await this.sendCachedResult(interaction, cached);
        return {
          success: true,
          message: '캐시된 데이터를 전송했습니다.',
          data: cached
        };
      }

      // 액션별 처리
      switch (action) {
        case 'create':
          return await this.handleCreateAction(interaction, category);
        case 'list':
          return await this.handleListAction(interaction, category, targetUser, limit);
        case 'stats':
          return await this.handleStatsAction(interaction, category);
        case 'manage':
          return await this.handleManageAction(interaction);
        case 'help':
          return await this.handleHelpAction(interaction);
        default:
          return await this.handleCreateAction(interaction, category);
      }

    } catch (error) {
      console.error(`${this.constructor.name} 명령어 실행 오류:`, error);
      
      const errorMessage = error instanceof Error ? error.message : '구인구직 명령어 실행 중 오류가 발생했습니다.';
      
      await interaction.followUp({
        content: `❌ ${errorMessage}`,
        flags: MessageFlags.Ephemeral
      });

      return {
        success: false,
        message: errorMessage,
        error: error as Error
      };
    }
  }

  /**
   * 새 게시글 작성 처리
   * @param interaction - 상호작용 객체
   * @param category - 카테고리
   */
  private async handleCreateAction(interaction: ChatInputCommandInteraction, category?: string): Promise<CommandResult> {
    try {
      // 모달 표시를 위해 defer 하지 않고 바로 실행
      await this.voiceForumService.showStandaloneRecruitmentModal(interaction, { category });
      
      return {
        success: true,
        message: '구인구직 게시글 작성 모달이 표시되었습니다.'
      };
    } catch (error) {
      console.error('구인구직 게시글 작성 오류:', error);
      throw error;
    }
  }

  /**
   * 게시글 목록 조회 처리
   * @param interaction - 상호작용 객체
   * @param category - 카테고리
   * @param targetUser - 대상 사용자
   * @param limit - 조회 제한
   */
  private async handleListAction(
    interaction: ChatInputCommandInteraction,
    category?: string,
    targetUser?: User,
    limit: number = 10
  ): Promise<CommandResult> {
    try {
      const filter: RecruitmentFilter = {};
      
      if (category) filter.category = category;
      if (targetUser) filter.userId = targetUser.id;
      
      const posts = await this.voiceForumService.getRecruitmentPosts(filter, limit);
      
      if (!posts || posts.length === 0) {
        await interaction.followUp({
          content: '📋 **구인구직 게시글이 없습니다.**\n\n새로운 게시글을 작성해보세요!',
          flags: MessageFlags.Ephemeral
        });
        
        return {
          success: true,
          message: '구인구직 게시글이 없습니다.'
        };
      }

      const embed = this.createRecruitmentListEmbed(posts, category, targetUser?.username);
      
      await interaction.followUp({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });

      // 캐시 저장
      const cacheKey = `recruitment_list_${category || 'all'}_${targetUser?.id || 'global'}_${limit}`;
      this.setCached(cacheKey, { posts, embed });

      return {
        success: true,
        message: '구인구직 게시글 목록을 조회했습니다.',
        data: { posts, totalCount: posts.length }
      };
    } catch (error) {
      console.error('구인구직 게시글 목록 조회 오류:', error);
      throw error;
    }
  }

  /**
   * 통계 조회 처리
   * @param interaction - 상호작용 객체
   * @param category - 카테고리
   */
  private async handleStatsAction(interaction: ChatInputCommandInteraction, category?: string): Promise<CommandResult> {
    try {
      const stats = await this.voiceForumService.getRecruitmentStats(category);
      
      const embed = this.createStatsEmbed(stats, category);
      
      await interaction.followUp({
        embeds: [embed],
        flags: MessageFlags.Ephemeral
      });

      // 캐시 저장
      const cacheKey = `recruitment_stats_${category || 'all'}`;
      this.setCached(cacheKey, { stats, embed });

      return {
        success: true,
        message: '구인구직 통계를 조회했습니다.',
        data: stats
      };
    } catch (error) {
      console.error('구인구직 통계 조회 오류:', error);
      throw error;
    }
  }

  /**
   * 게시글 관리 처리
   * @param interaction - 상호작용 객체
   */
  private async handleManageAction(interaction: ChatInputCommandInteraction): Promise<CommandResult> {
    try {
      const userPosts = await this.voiceForumService.getUserRecruitmentPosts(interaction.user.id, { status: 'active' });
      
      if (!userPosts || userPosts.length === 0) {
        await interaction.followUp({
          content: '📋 **관리할 수 있는 구인구직 게시글이 없습니다.**\n\n활성 상태인 게시글만 관리할 수 있습니다.',
          flags: MessageFlags.Ephemeral
        });
        
        return {
          success: true,
          message: '관리할 수 있는 게시글이 없습니다.'
        };
      }

      await this.voiceForumService.showRecruitmentManagementInterface(interaction, userPosts);
      
      return {
        success: true,
        message: '구인구직 게시글 관리 인터페이스가 표시되었습니다.',
        data: { managedPosts: userPosts.length }
      };
    } catch (error) {
      console.error('구인구직 게시글 관리 오류:', error);
      throw error;
    }
  }

  /**
   * 도움말 처리
   * @param interaction - 상호작용 객체
   */
  private async handleHelpAction(interaction: ChatInputCommandInteraction): Promise<CommandResult> {
    const helpMessage = this.getHelp();
    
    await interaction.followUp({
      content: helpMessage,
      flags: MessageFlags.Ephemeral
    });

    return {
      success: true,
      message: '도움말을 표시했습니다.'
    };
  }

  /**
   * 구인구직 권한 확인
   * @param user - 사용자
   * @param member - 멤버
   */
  private hasRecruitmentPermission(user: User, member: GuildMember | null): boolean {
    if (!this.voiceForumService) return false;
    return this.voiceForumService.hasRecruitmentPermission(user, member);
  }

  /**
   * 구인구직 목록 임베드 생성
   * @param posts - 게시글 목록
   * @param category - 카테고리
   * @param username - 사용자명
   */
  private createRecruitmentListEmbed(posts: RecruitmentResult[], category?: string, username?: string): any {
    const embed = {
      color: 0x00ff00,
      title: '📋 구인구직 게시글 목록',
      fields: [],
      footer: {
        text: `총 ${posts.length}개의 게시글`
      },
      timestamp: new Date().toISOString()
    };

    if (category) {
      embed.title += ` (${this.getCategoryDisplayName(category)})`;
    }

    if (username) {
      embed.title += ` - ${username}님의 게시글`;
    }

    posts.forEach((post, index) => {
      const statusEmoji = this.getStatusEmoji(post.status);
      const timeAgo = this.getTimeAgo(post.createdAt);
      
      embed.fields.push({
        name: `${index + 1}. ${statusEmoji} ${post.title}`,
        value: `📂 **카테고리:** ${this.getCategoryDisplayName(post.category)}\n` +
               `👥 **지원자:** ${post.applicants}명\n` +
               `📅 **작성일:** ${timeAgo}\n` +
               `📊 **상태:** ${this.getStatusDisplayName(post.status)}`,
        inline: true
      });
    });

    return embed;
  }

  /**
   * 통계 임베드 생성
   * @param stats - 통계 데이터
   * @param category - 카테고리
   */
  private createStatsEmbed(stats: RecruitmentStats, category?: string): any {
    const embed = {
      color: 0x0099ff,
      title: '📊 구인구직 통계',
      fields: [
        {
          name: '📈 전체 통계',
          value: `📝 **총 게시글:** ${stats.totalPosts}개\n` +
                 `🟢 **활성 게시글:** ${stats.activePosts}개\n` +
                 `✅ **완료 게시글:** ${stats.completedPosts}개\n` +
                 `👥 **총 지원자:** ${stats.totalApplicants}명`,
          inline: true
        },
        {
          name: '📊 평균 통계',
          value: `📊 **게시글당 평균 지원자:** ${stats.averageApplicationsPerPost.toFixed(1)}명\n` +
                 `👑 **최고 활동 사용자:** ${stats.mostActiveUser || '없음'}\n` +
                 `🔥 **인기 카테고리:** ${this.getCategoryDisplayName(stats.mostPopularCategory)}`,
          inline: true
        }
      ],
      footer: {
        text: category ? `${this.getCategoryDisplayName(category)} 카테고리` : '전체 카테고리'
      },
      timestamp: new Date().toISOString()
    };

    return embed;
  }

  /**
   * 캐시된 결과 전송
   * @param interaction - 상호작용 객체
   * @param cached - 캐시된 데이터
   */
  private async sendCachedResult(interaction: ChatInputCommandInteraction, cached: any): Promise<void> {
    await interaction.followUp({
      content: '📋 **캐시된 데이터를 사용합니다.**',
      embeds: [cached.embed],
      flags: MessageFlags.Ephemeral
    });
  }

  /**
   * 카테고리 표시명 반환
   * @param category - 카테고리
   */
  private getCategoryDisplayName(category?: string): string {
    const categoryNames: Record<string, string> = {
      game: '게임',
      study: '스터디',
      project: '프로젝트',
      other: '기타'
    };
    
    return categoryNames[category || 'other'] || '기타';
  }

  /**
   * 상태 이모지 반환
   * @param status - 상태
   */
  private getStatusEmoji(status: string): string {
    const statusEmojis: Record<string, string> = {
      active: '🟢',
      completed: '✅',
      cancelled: '❌',
      paused: '⏸️'
    };
    
    return statusEmojis[status] || '⚪';
  }

  /**
   * 상태 표시명 반환
   * @param status - 상태
   */
  private getStatusDisplayName(status: string): string {
    const statusNames: Record<string, string> = {
      active: '모집중',
      completed: '완료',
      cancelled: '취소',
      paused: '일시정지'
    };
    
    return statusNames[status] || '알 수 없음';
  }

  /**
   * 시간 경과 표시
   * @param date - 날짜
   */
  private getTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 60) {
      return `${diffMinutes}분 전`;
    } else if (diffHours < 24) {
      return `${diffHours}시간 전`;
    } else if (diffDays < 30) {
      return `${diffDays}일 전`;
    } else {
      return date.toLocaleDateString('ko-KR');
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
• 구인구직 게시글을 작성하고 관리할 수 있습니다.
• 다양한 카테고리로 분류하여 효율적으로 관리할 수 있습니다.
• 베타 테스트 중으로 특정 사용자만 이용 가능합니다.

**액션:**
• \`create\`: 새 게시글 작성 (기본값)
• \`list\`: 게시글 목록 조회
• \`stats\`: 통계 보기
• \`manage\`: 내 게시글 관리
• \`help\`: 도움말 보기

**옵션:**
• \`action\`: 수행할 작업 (선택사항)
• \`category\`: 카테고리 필터 (선택사항)
• \`user\`: 특정 사용자 게시글 조회 (선택사항)
• \`limit\`: 조회할 게시글 수 (선택사항)

**예시:**
${this.metadata.examples?.map(ex => `\`${ex}\``).join('\n')}

**카테고리:**
• 게임: 게임 관련 구인구직
• 스터디: 스터디 그룹 모집
• 프로젝트: 프로젝트 팀원 모집
• 기타: 기타 모집

**참고:**
• 현재 베타 테스트 중입니다
• 관리자 또는 허가된 사용자만 이용 가능합니다
• 게시글은 자동으로 관리됩니다

**권한:** 베타 테스터 또는 관리자
**쿨다운:** ${this.metadata.cooldown}초`;
  }
}