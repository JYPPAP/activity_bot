// src/services/channelJobPostLinkService.js - 채널-구인구직 연동 서비스
import { ChannelSelectMenuFactory } from '../utils/channelSelectMenu.js';
import { JobPostModalFactory } from '../utils/jobPostModal.js';
import { EmbedFactory } from '../utils/embedBuilder.js';
import { JobPostService } from './JobPostService.js';

export class ChannelJobPostLinkService {
  constructor(client, dbManager, jobPostInteractionService) {
    this.client = client;
    this.dbManager = dbManager;
    this.jobPostInteractionService = jobPostInteractionService;
    this.jobPostService = new JobPostService(dbManager);
    
    // 진행 중인 연동 프로세스 추적 (30초 타임아웃)
    this.pendingLinks = new Map();
  }

  /**
   * 서비스 초기화
   */
  async initialize() {
    await this.jobPostService.initialize();
    console.log('[ChannelJobPostLinkService] 채널-구인구직 연동 서비스 초기화 완료');
  }

  /**
   * 음성 채널 생성 시 구인구직 연동 메뉴 표시
   * @param {VoiceChannel} channel - 생성된 음성 채널
   */
  async handleChannelCreate(channel) {
    try {
      // 음성 채널이 아닌 경우 무시
      if (channel.type !== 2) return; // ChannelType.GuildVoice = 2

      // 이미 연동된 채널인지 확인
      const existingJob = await this.jobPostService.getJobPostByChannelId(channel.id);
      if (existingJob) {
        console.log(`[ChannelJobPostLinkService] 채널 ${channel.name}은 이미 구인구직 카드와 연동됨`);
        return;
      }

      // 연동 가능한 구인구직 카드 조회 (channelId가 null인 카드들)
      const allJobPostsResult = await this.jobPostService.getAllJobPosts(false);
      const availableJobPosts = allJobPostsResult.data.filter(job => !job.channelId);

      // SelectMenu 생성
      const { embed, actionRow } = ChannelSelectMenuFactory.createJobPostSelectionMenu(
        channel.id,
        channel.name,
        availableJobPosts
      );

      // 적절한 텍스트 채널 찾기
      let textChannel = await this.findAppropriateTextChannel(channel);
      
      // 텍스트 채널을 찾지 못한 경우, 로그 채널을 강제로 사용
      if (!textChannel) {
        console.log(`[ChannelJobPostLinkService] 적절한 텍스트 채널을 찾지 못함, 로그 채널 사용 시도`);
        try {
          const { config } = await import('../config/env.js');
          if (config.LOG_CHANNEL_ID) {
            textChannel = await this.client.channels.fetch(config.LOG_CHANNEL_ID);
            console.log(`[ChannelJobPostLinkService] 로그 채널로 강제 전송: ${textChannel?.name}`);
          }
        } catch (error) {
          console.error('[ChannelJobPostLinkService] 로그 채널 로드 실패:', error);
        }
      }
      
      if (!textChannel) {
        console.log(`[ChannelJobPostLinkService] 채널 ${channel.name}에 대한 텍스트 채널을 전혀 찾을 수 없음`);
        return;
      }

      // 메시지 전송
      console.log(`[ChannelJobPostLinkService] ${textChannel.name} 채널에 메시지 전송 시도`);
      console.log(`[ChannelJobPostLinkService] 사용 가능한 구인구직 카드 수: ${availableJobPosts.length}`);
      
      const message = await textChannel.send({
        embeds: [embed],
        components: [actionRow]
      });
      
      console.log(`[ChannelJobPostLinkService] 메시지 전송 성공! 메시지 ID: ${message.id}`);

      // 30초 타임아웃 설정
      this.pendingLinks.set(channel.id, {
        messageId: message.id,
        channelId: channel.id,
        channelName: channel.name,
        textChannelId: textChannel.id,
        timestamp: Date.now()
      });

      // 60초 후 자동 정리 (30초에서 60초로 연장)
      setTimeout(async () => {
        await this.handleTimeout(channel.id);
      }, 60000);

      console.log(`[ChannelJobPostLinkService] 채널 ${channel.name}에 구인구직 연동 메뉴 표시`);

    } catch (error) {
      console.error('[ChannelJobPostLinkService] 채널 생성 처리 오류:', error);
    }
  }

  /**
   * SelectMenu 상호작용 처리
   * @param {StringSelectMenuInteraction} interaction - SelectMenu 상호작용
   */
  async handleSelectMenuInteraction(interaction) {
    try {
      // customId 파싱
      const parsed = ChannelSelectMenuFactory.parseSelectMenuCustomId(interaction.customId);
      if (!parsed || parsed.type !== 'channel_link') {
        return; // 관련 없는 SelectMenu
      }

      const channelId = parsed.channelId;
      const selectedValue = interaction.values[0];
      const { action, targetId } = ChannelSelectMenuFactory.parseSelectMenuValue(selectedValue);

      await interaction.deferReply({ ephemeral: true });

      // 진행 중인 연동 프로세스 확인
      const pendingLink = this.pendingLinks.get(channelId);
      if (!pendingLink) {
        await interaction.editReply({
          content: '❌ 연동 프로세스가 만료되었거나 찾을 수 없습니다.'
        });
        return;
      }

      // 채널 확인
      const channel = this.client.channels.cache.get(channelId);
      if (!channel) {
        await interaction.editReply({
          content: '❌ 해당 채널을 찾을 수 없습니다.'
        });
        this.pendingLinks.delete(channelId);
        return;
      }

      let result;
      switch (action) {
        case 'link_existing':
          result = await this.linkExistingJobPost(channel, targetId);
          break;
        case 'create_new':
          result = await this.createNewJobPost(interaction, channel);
          return; // 모달 표시로 인해 여기서 종료
        case 'skip':
          result = await this.skipLinking(channel);
          break;
        default:
          await interaction.editReply({
            content: '❌ 알 수 없는 액션입니다.'
          });
          return;
      }

      // 결과 처리
      if (result.success) {
        const successEmbed = ChannelSelectMenuFactory.createSuccessEmbed(action, result.data);
        await interaction.editReply({
          embeds: [successEmbed]
        });
        
        // 원본 메시지 수정 (SelectMenu 제거)
        await this.updateOriginalMessage(pendingLink, successEmbed);
      } else {
        const errorEmbed = ChannelSelectMenuFactory.createErrorEmbed(result.error);
        await interaction.editReply({
          embeds: [errorEmbed]
        });
      }

      // 진행 중인 프로세스 정리
      this.pendingLinks.delete(channelId);

    } catch (error) {
      console.error('[ChannelJobPostLinkService] SelectMenu 처리 오류:', error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ 처리 중 오류가 발생했습니다.',
          ephemeral: true
        });
      } else if (interaction.deferred) {
        await interaction.editReply({
          content: '❌ 처리 중 오류가 발생했습니다.'
        });
      }
    }
  }

  /**
   * 기존 구인구직 카드와 연동
   * @param {VoiceChannel} channel - 음성 채널
   * @param {string} jobId - 구인구직 카드 ID
   * @returns {Object} - 결과 { success: boolean, data?: Object, error?: string }
   */
  async linkExistingJobPost(channel, jobId) {
    try {
      // 구인구직 카드 확인
      const jobPost = await this.jobPostService.getJobPost(jobId);
      if (!jobPost) {
        return { success: false, error: '해당 구인구직 카드를 찾을 수 없습니다.' };
      }

      // 이미 다른 채널과 연동되어 있는지 확인
      if (jobPost.channelId) {
        return { success: false, error: '해당 구인구직 카드는 이미 다른 채널과 연동되어 있습니다.' };
      }

      // 채널과 카드 연동
      const updatedJobPost = await this.jobPostService.linkJobPostToChannel(jobId, channel.id);
      if (!updatedJobPost) {
        return { success: false, error: '채널 연동에 실패했습니다.' };
      }

      return {
        success: true,
        data: {
          channelName: channel.name,
          jobPost: updatedJobPost
        }
      };

    } catch (error) {
      console.error('[ChannelJobPostLinkService] 기존 카드 연동 오류:', error);
      return { success: false, error: '연동 처리 중 오류가 발생했습니다.' };
    }
  }

  /**
   * 새 구인구직 카드 생성 (모달 표시)
   * @param {Interaction} interaction - 상호작용 객체
   * @param {VoiceChannel} channel - 음성 채널
   * @returns {Object} - 결과 { success: boolean, data?: Object, error?: string }
   */
  async createNewJobPost(interaction, channel) {
    try {
      // 채널명을 기본 제목으로 하는 모달 표시
      await this.jobPostInteractionService.showJobPostCreateModal(
        interaction,
        channel.id,
        channel.name
      );

      // 모달이 표시되었으므로 진행 중인 프로세스는 유지
      // (모달 완료 후 자동으로 정리됨)
      
      return { success: true, data: { action: 'modal_shown' } };

    } catch (error) {
      console.error('[ChannelJobPostLinkService] 새 카드 생성 모달 오류:', error);
      return { success: false, error: '새 카드 생성 모달 표시 중 오류가 발생했습니다.' };
    }
  }

  /**
   * 연동 건너뛰기
   * @param {VoiceChannel} channel - 음성 채널
   * @returns {Object} - 결과 { success: boolean, data?: Object, error?: string }
   */
  async skipLinking(channel) {
    return {
      success: true,
      data: {
        channelName: channel.name
      }
    };
  }

  /**
   * 음성 채널 삭제 시 연동된 구인구직 카드 자동 삭제
   * @param {VoiceChannel} channel - 삭제된 음성 채널
   */
  async handleChannelDelete(channel) {
    try {
      // 음성 채널이 아닌 경우 무시
      if (channel.type !== 2) return; // ChannelType.GuildVoice = 2

      // 해당 채널과 연동된 구인구직 카드 찾기
      const success = await this.jobPostService.handleChannelDeletion(channel.id);
      
      if (success) {
        console.log(`[ChannelJobPostLinkService] 채널 ${channel.name} 삭제로 인한 연동 카드 자동 삭제 완료`);
      }

      // 진행 중인 연동 프로세스도 정리
      this.pendingLinks.delete(channel.id);

    } catch (error) {
      console.error('[ChannelJobPostLinkService] 채널 삭제 처리 오류:', error);
    }
  }

  /**
   * 타임아웃 처리
   * @param {string} channelId - 채널 ID
   */
  async handleTimeout(channelId) {
    try {
      const pendingLink = this.pendingLinks.get(channelId);
      if (!pendingLink) return;

      // 타임아웃 임베드로 원본 메시지 수정
      const timeoutEmbed = ChannelSelectMenuFactory.createTimeoutEmbed();
      await this.updateOriginalMessage(pendingLink, timeoutEmbed, true);

      // 진행 중인 프로세스 정리
      this.pendingLinks.delete(channelId);

      console.log(`[ChannelJobPostLinkService] 채널 ${pendingLink.channelName} 연동 프로세스 타임아웃`);

    } catch (error) {
      console.error('[ChannelJobPostLinkService] 타임아웃 처리 오류:', error);
    }
  }

  /**
   * 적절한 텍스트 채널 찾기
   * @param {VoiceChannel} voiceChannel - 음성 채널
   * @returns {TextChannel|null} - 텍스트 채널
   */
  async findAppropriateTextChannel(voiceChannel) {
    try {
      console.log(`[ChannelJobPostLinkService] ${voiceChannel.name} 채널에 대한 텍스트 채널 찾기 시작`);
      
      // 1. 같은 카테고리의 텍스트 채널 찾기
      if (voiceChannel.parent) {
        console.log(`[ChannelJobPostLinkService] 카테고리: ${voiceChannel.parent.name}`);
        const textChannels = voiceChannel.parent.children.cache.filter(
          ch => ch.type === 0
        );
        
        console.log(`[ChannelJobPostLinkService] 카테고리 내 텍스트 채널 수: ${textChannels.size}`);
        
        // 권한 체크를 추가로 수행
        for (const [id, channel] of textChannels) {
          try {
            const permissions = channel.permissionsFor(this.client.user);
            if (permissions && permissions.has(['SendMessages', 'ViewChannel'])) {
              console.log(`[ChannelJobPostLinkService] 사용 가능한 텍스트 채널 발견: ${channel.name}`);
              return channel;
            }
          } catch (permError) {
            console.log(`[ChannelJobPostLinkService] 채널 ${channel.name} 권한 확인 실패:`, permError.message);
          }
        }
      }

      // 2. 길드의 시스템 채널
      if (voiceChannel.guild.systemChannel) {
        console.log(`[ChannelJobPostLinkService] 시스템 채널 사용: ${voiceChannel.guild.systemChannel.name}`);
        return voiceChannel.guild.systemChannel;
      }

      // 3. 권한이 있는 첫 번째 텍스트 채널
      const guildTextChannels = voiceChannel.guild.channels.cache.filter(ch => ch.type === 0);
      console.log(`[ChannelJobPostLinkService] 길드 내 총 텍스트 채널 수: ${guildTextChannels.size}`);
      
      for (const [id, channel] of guildTextChannels) {
        try {
          const permissions = channel.permissionsFor(this.client.user);
          if (permissions && permissions.has(['SendMessages', 'ViewChannel'])) {
            console.log(`[ChannelJobPostLinkService] 사용 가능한 길드 텍스트 채널 발견: ${channel.name}`);
            return channel;
          }
        } catch (permError) {
          console.log(`[ChannelJobPostLinkService] 길드 채널 ${channel.name} 권한 확인 실패:`, permError.message);
        }
      }

      // 4. 마지막 수단: config에 설정된 로그 채널 사용
      try {
        const { config } = await import('../config/env.js');
        if (config.LOG_CHANNEL_ID) {
          const logChannel = await this.client.channels.fetch(config.LOG_CHANNEL_ID);
          if (logChannel) {
            console.log(`[ChannelJobPostLinkService] 로그 채널 사용: ${logChannel.name}`);
            return logChannel;
          }
        }
      } catch (configError) {
        console.log(`[ChannelJobPostLinkService] 로그 채널 로드 실패:`, configError.message);
      }

      console.log(`[ChannelJobPostLinkService] 사용 가능한 텍스트 채널을 찾을 수 없음`);
      return null;

    } catch (error) {
      console.error('[ChannelJobPostLinkService] 텍스트 채널 찾기 오류:', error);
      return null;
    }
  }

  /**
   * 원본 메시지 업데이트 (SelectMenu 제거)
   * @param {Object} pendingLink - 진행 중인 연동 정보
   * @param {EmbedBuilder} newEmbed - 새 임베드
   * @param {boolean} removeComponents - 컴포넌트 제거 여부
   */
  async updateOriginalMessage(pendingLink, newEmbed, removeComponents = true) {
    try {
      const textChannel = this.client.channels.cache.get(pendingLink.textChannelId);
      if (!textChannel) return;

      const message = await textChannel.messages.fetch(pendingLink.messageId);
      if (!message) return;

      const updateData = { embeds: [newEmbed] };
      if (removeComponents) {
        updateData.components = [];
      }

      await message.edit(updateData);

    } catch (error) {
      console.error('[ChannelJobPostLinkService] 원본 메시지 업데이트 오류:', error);
    }
  }

  /**
   * 만료된 진행 중인 프로세스 정리
   */
  cleanupExpiredProcesses() {
    const now = Date.now();
    const expiredThreshold = 35000; // 35초 (타임아웃 + 여유시간)

    for (const [channelId, pendingLink] of this.pendingLinks.entries()) {
      if (now - pendingLink.timestamp > expiredThreshold) {
        this.pendingLinks.delete(channelId);
        console.log(`[ChannelJobPostLinkService] 만료된 연동 프로세스 정리: ${pendingLink.channelName}`);
      }
    }
  }
}