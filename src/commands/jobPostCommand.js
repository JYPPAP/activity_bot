// src/commands/jobPostCommand.js - 구인구직 명령어
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { CommandBase } from './CommandBase.js';
import { EmbedFactory } from '../utils/embedBuilder.js';
import { JobPostFilterService } from '../services/jobPostFilterService.js';

export class JobPostCommand extends CommandBase {
  constructor(services) {
    super(services);
    this.jobPostInteractionService = services.jobPostInteractionService;
    this.filterService = new JobPostFilterService(services.dbManager);
  }

  /**
   * 슬래시 명령어 정의
   */
  static get data() {
    return new SlashCommandBuilder()
      .setName('job_post')
      .setDescription('구인구직 카드 관리')
      .addSubcommand(subcommand =>
        subcommand
          .setName('create')
          .setDescription('새 구인구직 카드 생성')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('list')
          .setDescription('현재 활성 구인구직 목록 조회')
          .addBooleanOption(option =>
            option
              .setName('show_expired')
              .setDescription('만료된 카드도 표시할지 여부')
              .setRequired(false)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('delete')
          .setDescription('구인구직 카드 삭제')
          .addStringOption(option =>
            option
              .setName('job_id')
              .setDescription('삭제할 구인구직 카드 ID')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('cleanup')
          .setDescription('만료된 구인구직 카드 정리')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('search')
          .setDescription('구인구직 카드 검색')
          .addStringOption(option =>
            option
              .setName('keyword')
              .setDescription('검색할 키워드 (제목, 설명)')
              .setRequired(false)
          )
          .addStringOption(option =>
            option
              .setName('tags')
              .setDescription('역할 태그 (콤마로 구분)')
              .setRequired(false)
          )
          .addIntegerOption(option =>
            option
              .setName('member_count')
              .setDescription('모집 인원수')
              .setRequired(false)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('filter')
          .setDescription('고급 필터링으로 구인구직 카드 검색')
          .addStringOption(option =>
            option
              .setName('tags')
              .setDescription('역할 태그 (콤마로 구분)')
              .setRequired(false)
          )
          .addStringOption(option =>
            option
              .setName('match_mode')
              .setDescription('태그 매칭 모드')
              .setRequired(false)
              .addChoices(
                { name: '하나라도 일치 (any)', value: 'any' },
                { name: '모두 일치 (all)', value: 'all' }
              )
          )
          .addBooleanOption(option =>
            option
              .setName('exact_match')
              .setDescription('정확히 일치하는 태그만 검색')
              .setRequired(false)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('tags')
          .setDescription('인기 태그 조회')
          .addIntegerOption(option =>
            option
              .setName('limit')
              .setDescription('표시할 태그 수 (기본: 10)')
              .setRequired(false)
              .setMinValue(1)
              .setMaxValue(25)
          )
      );
  }

  /**
   * 명령어 실행
   */
  async executeCommand(interaction) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'create':
        await this.handleCreate(interaction);
        break;
      case 'list':
        await this.handleList(interaction);
        break;
      case 'delete':
        await this.handleDelete(interaction);
        break;
      case 'cleanup':
        await this.handleCleanup(interaction);
        break;
      case 'search':
        await this.handleSearch(interaction);
        break;
      case 'filter':
        await this.handleFilter(interaction);
        break;
      case 'tags':
        await this.handleTags(interaction);
        break;
      default:
        await interaction.editReply({
          content: '❌ 알 수 없는 하위 명령어입니다.'
        });
    }
  }

  /**
   * 구인구직 카드 생성 처리
   */
  async handleCreate(interaction) {
    try {
      // 모달 표시
      await this.jobPostInteractionService.showJobPostCreateModal(interaction);
    } catch (error) {
      console.error('[JobPostCommand] 생성 모달 표시 오류:', error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ 구인구직 카드 생성 모달 표시 중 오류가 발생했습니다.',
          ephemeral: true
        });
      }
    }
  }

  /**
   * 구인구직 카드 목록 조회 처리
   */
  async handleList(interaction) {
    try {
      const showExpired = interaction.options.getBoolean('show_expired') ?? false;
      
      // 구인구직 카드 목록 조회
      const result = await this.jobPostInteractionService.jobPostService.getAllJobPosts(showExpired);
      
      // 임베드 생성
      const title = showExpired ? '📋 전체 구인구직 목록 (만료 포함)' : '📋 현재 활성 구인구직 목록';
      const embed = EmbedFactory.createJobPostListEmbed(result.data, { title, showExpired });
      
      await interaction.editReply({
        embeds: [embed]
      });
      
    } catch (error) {
      console.error('[JobPostCommand] 목록 조회 오류:', error);
      await interaction.editReply({
        content: '❌ 구인구직 목록 조회 중 오류가 발생했습니다.'
      });
    }
  }

  /**
   * 구인구직 카드 삭제 처리
   */
  async handleDelete(interaction) {
    try {
      const jobId = interaction.options.getString('job_id');
      
      // 삭제 처리
      await this.jobPostInteractionService.deleteJobPost(interaction, jobId);
      
    } catch (error) {
      console.error('[JobPostCommand] 삭제 오류:', error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.editReply({
          content: '❌ 구인구직 카드 삭제 중 오류가 발생했습니다.'
        });
      }
    }
  }

  /**
   * 만료된 구인구직 카드 정리 처리
   */
  async handleCleanup(interaction) {
    try {
      // 만료된 카드 정리
      const deletedJobs = await this.jobPostInteractionService.jobPostService.cleanupExpiredJobPosts();
      
      if (deletedJobs.length === 0) {
        await interaction.editReply({
          content: '🗑️ 정리할 만료된 구인구직 카드가 없습니다.'
        });
      } else {
        await interaction.editReply({
          content: `🗑️ **만료된 구인구직 카드 ${deletedJobs.length}개를 정리했습니다.**\n\n` +
                   `정리된 카드 ID:\n${deletedJobs.map(id => `• \`${id}\``).join('\n')}`
        });
      }
      
    } catch (error) {
      console.error('[JobPostCommand] 정리 오류:', error);
      await interaction.editReply({
        content: '❌ 만료된 구인구직 카드 정리 중 오류가 발생했습니다.'
      });
    }
  }

  /**
   * 구인구직 카드 검색 처리
   */
  async handleSearch(interaction) {
    try {
      const keyword = interaction.options.getString('keyword');
      const tags = interaction.options.getString('tags');
      const memberCount = interaction.options.getInteger('member_count');

      // 필터 구성
      const filters = {};
      if (keyword) filters.keyword = keyword;
      if (tags) filters.tags = tags;
      if (memberCount) {
        filters.minMemberCount = memberCount;
        filters.maxMemberCount = memberCount;
      }

      // 검색 실행
      const result = await this.filterService.filterJobPosts(filters, { limit: 10 });

      if (result.data.length === 0) {
        await interaction.editReply({
          content: '🔍 검색 조건에 맞는 구인구직 카드를 찾을 수 없습니다.'
        });
        return;
      }

      // 결과 임베드 생성
      const embed = EmbedFactory.createJobPostListEmbed(result.data, {
        title: `🔍 검색 결과 (${result.pagination.totalItems}개 발견)`
      });

      // 적용된 필터 정보 추가
      const filterInfo = [];
      if (keyword) filterInfo.push(`키워드: "${keyword}"`);
      if (tags) filterInfo.push(`태그: "${tags}"`);
      if (memberCount) filterInfo.push(`인원: ${memberCount}명`);

      if (filterInfo.length > 0) {
        embed.setFooter({
          text: `적용된 필터: ${filterInfo.join(', ')}`
        });
      }

      await interaction.editReply({
        embeds: [embed]
      });

    } catch (error) {
      console.error('[JobPostCommand] 검색 오류:', error);
      await interaction.editReply({
        content: '❌ 구인구직 카드 검색 중 오류가 발생했습니다.'
      });
    }
  }

  /**
   * 고급 필터링 처리
   */
  async handleFilter(interaction) {
    try {
      const tags = interaction.options.getString('tags');
      const matchMode = interaction.options.getString('match_mode') || 'any';
      const exactMatch = interaction.options.getBoolean('exact_match') || false;

      if (!tags) {
        await interaction.editReply({
          content: '❌ 필터링할 태그를 입력해주세요.'
        });
        return;
      }

      // 태그 필터링 실행
      const result = await this.filterService.filterByRoleTags(tags, {
        matchMode,
        exactMatch,
        limit: 15
      });

      if (result.data.length === 0) {
        await interaction.editReply({
          content: `🔍 태그 "${tags}"에 맞는 구인구직 카드를 찾을 수 없습니다.`
        });
        return;
      }

      // 결과 임베드 생성
      const embed = EmbedFactory.createJobPostListEmbed(result.data, {
        title: `🏷️ 태그 필터링 결과 (${result.pagination.totalItems}개 발견)`
      });

      // 필터 정보 추가
      const matchModeText = matchMode === 'all' ? '모두 일치' : '하나라도 일치';
      const exactMatchText = exactMatch ? '정확히 일치' : '부분 일치';

      embed.setFooter({
        text: `태그: "${tags}" | 모드: ${matchModeText} | 매칭: ${exactMatchText}`
      });

      await interaction.editReply({
        embeds: [embed]
      });

    } catch (error) {
      console.error('[JobPostCommand] 필터링 오류:', error);
      await interaction.editReply({
        content: '❌ 구인구직 카드 필터링 중 오류가 발생했습니다.'
      });
    }
  }

  /**
   * 인기 태그 조회 처리
   */
  async handleTags(interaction) {
    try {
      const limit = interaction.options.getInteger('limit') || 10;

      // 인기 태그 조회
      const popularTags = await this.filterService.getPopularTags(limit);

      if (popularTags.length === 0) {
        await interaction.editReply({
          content: '📊 현재 사용된 태그가 없습니다.'
        });
        return;
      }

      // 태그 목록 임베드 생성
      const embed = new EmbedBuilder()
        .setColor('#00D166')
        .setTitle(`📊 인기 태그 TOP ${limit}`)
        .setDescription('현재 활성 구인구직 카드에서 가장 많이 사용된 태그들입니다.')
        .setTimestamp();

      const tagList = popularTags.map((tag, index) => {
        const medal = index < 3 ? ['🥇', '🥈', '🥉'][index] : `${index + 1}.`;
        return `${medal} **${tag.tag}** (${tag.count}개)`;
      }).join('\n');

      embed.addFields({
        name: '🏷️ 태그 순위',
        value: tagList,
        inline: false
      });

      // 검색 통계도 함께 표시
      const stats = await this.filterService.getSearchStats();
      if (stats.totalUniqueTags) {
        embed.addFields({
          name: '📈 태그 통계',
          value: [
            `• 전체 고유 태그: ${stats.totalUniqueTags}개`,
            `• 카드당 평균 태그: ${stats.averageTagsPerJob}개`,
            `• 전체 활성 카드: ${stats.activeJobs}개`
          ].join('\n'),
          inline: false
        });
      }

      await interaction.editReply({
        embeds: [embed]
      });

    } catch (error) {
      console.error('[JobPostCommand] 태그 조회 오류:', error);
      await interaction.editReply({
        content: '❌ 인기 태그 조회 중 오류가 발생했습니다.'
      });
    }
  }
}