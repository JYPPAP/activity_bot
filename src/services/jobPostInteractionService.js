// src/services/jobPostInteractionService.js - 구인구직 상호작용 처리 서비스
import { EmbedFactory } from '../utils/embedBuilder.js';
import { JobPostModalFactory } from '../utils/jobPostModal.js';
import { JobPostService } from './JobPostService.js';
import { JobPostEmbedWithButtons } from '../utils/jobPostEmbedWithButtons.js';

export class JobPostInteractionService {
  constructor(client, dbManager) {
    this.client = client;
    this.dbManager = dbManager;
    this.jobPostService = new JobPostService(dbManager);
  }

  /**
   * 서비스 초기화
   */
  async initialize() {
    return await this.jobPostService.initialize();
  }

  /**
   * 모달 제출 이벤트 처리
   * @param {ModalSubmitInteraction} interaction - 모달 상호작용
   */
  async handleModalSubmit(interaction) {
    try {
      const { customId } = interaction;
      
      // 커스텀 ID 파싱
      const { baseId, channelId } = JobPostModalFactory.parseCustomId(customId);
      
      if (baseId === 'jobpost_create_modal') {
        await this.handleJobPostCreate(interaction, channelId);
      } else if (baseId.startsWith('jobpost_edit_modal')) {
        await this.handleJobPostEdit(interaction);
      } else {
        await interaction.reply({
          content: '❌ 알 수 없는 모달 요청입니다.',
          ephemeral: true
        });
      }
    } catch (error) {
      console.error('[JobPostInteractionService] 모달 제출 처리 오류:', error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ 처리 중 오류가 발생했습니다.',
          ephemeral: true
        });
      }
    }
  }

  /**
   * 구인구직 카드 생성 처리
   * @param {ModalSubmitInteraction} interaction - 모달 상호작용
   * @param {string|null} channelId - 음성채널 ID
   */
  async handleJobPostCreate(interaction, channelId = null) {
    await interaction.deferReply({ ephemeral: true });

    try {
      // 모달 데이터 수집
      const formData = {};
      interaction.fields.fields.forEach((field, key) => {
        formData[key] = field.value;
      });

      // 데이터 검증
      const validation = JobPostModalFactory.validateJobPostData(formData);
      if (!validation.isValid) {
        await interaction.editReply({
          content: `❌ **입력 데이터 오류:**\n${validation.errors.map(err => `• ${err}`).join('\n')}`
        });
        return;
      }

      // 구인구직 카드 데이터 구성
      const jobPostData = {
        ...validation.data,
        authorId: interaction.user.id,
        channelId: channelId
      };

      // 채널 중복 확인 (channelId가 있는 경우)
      if (channelId) {
        const existingJob = await this.jobPostService.getJobPostByChannelId(channelId);
        if (existingJob) {
          await interaction.editReply({
            content: `❌ 해당 음성채널에 이미 연동된 구인구직 카드가 있습니다.\n**기존 카드:** ${existingJob.title}`
          });
          return;
        }
      }

      // 구인구직 카드 생성
      const jobPost = await this.jobPostService.createJobPost(jobPostData);
      
      // 채널별 전송 로직
      let targetChannel;
      let voiceChannel = null;
      
      if (channelId) {
        // 음성채널이 지정된 경우, 해당 채널의 텍스트 채널에서 전송
        voiceChannel = this.client.channels.cache.get(channelId);
        if (voiceChannel && voiceChannel.parent) {
          // 같은 카테고리의 텍스트 채널 찾기
          targetChannel = voiceChannel.parent.children.cache.find(
            ch => ch.type === 0 && ch.name.includes('일반') // 텍스트 채널 타입
          ) || interaction.channel;
        } else {
          targetChannel = interaction.channel;
        }
      } else {
        // 현재 채널에 전송
        targetChannel = interaction.channel;
      }

      // 구인구직 카드 전송 (버튼 포함)
      const sentMessage = await JobPostEmbedWithButtons.sendJobPostMessage(
        targetChannel, 
        jobPost, 
        { 
          showButtons: true, 
          voiceChannel: voiceChannel 
        }
      );

      // 성공 응답
      const responseContent = [
        '✅ **구인구직 카드가 성공적으로 생성되었습니다!**',
        `📌 **제목:** ${jobPost.title}`,
        `👥 **모집 인원:** ${jobPost.memberCount}명`,
        `⏰ **시작 시간:** ${jobPost.startTime}`,
        channelId ? '🔗 **음성채널에 연동됨**' : '🔄 **음성채널 미연동**',
        `🆔 **카드 ID:** \`${jobPost.id}\``,
        `📍 **전송 위치:** ${targetChannel}`
      ];

      await interaction.editReply({
        content: responseContent.join('\n')
      });

    } catch (error) {
      console.error('[JobPostInteractionService] 구인구직 카드 생성 오류:', error);
      await interaction.editReply({
        content: '❌ 구인구직 카드 생성 중 오류가 발생했습니다.'
      });
    }
  }

  /**
   * 구인구직 카드 수정 처리
   * @param {ModalSubmitInteraction} interaction - 모달 상호작용
   */
  async handleJobPostEdit(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      // 카드 ID 추출
      const customIdParts = interaction.customId.split('_');
      const jobId = customIdParts[customIdParts.length - 1];

      // 기존 카드 조회
      const existingJob = await this.jobPostService.getJobPost(jobId);
      if (!existingJob) {
        await interaction.editReply({
          content: '❌ 해당 구인구직 카드를 찾을 수 없습니다.'
        });
        return;
      }

      // 권한 확인 (작성자만 수정 가능)
      if (existingJob.authorId !== interaction.user.id) {
        await interaction.editReply({
          content: '❌ 자신이 작성한 구인구직 카드만 수정할 수 있습니다.'
        });
        return;
      }

      // 모달 데이터 수집
      const formData = {};
      interaction.fields.fields.forEach((field, key) => {
        formData[key] = field.value;
      });

      // 데이터 검증
      const validation = JobPostModalFactory.validateJobPostData(formData);
      if (!validation.isValid) {
        await interaction.editReply({
          content: `❌ **입력 데이터 오류:**\n${validation.errors.map(err => `• ${err}`).join('\n')}`
        });
        return;
      }

      // 구인구직 카드 업데이트
      const updatedJob = await this.jobPostService.updateJobPost(jobId, validation.data);
      
      if (!updatedJob) {
        await interaction.editReply({
          content: '❌ 구인구직 카드 수정에 실패했습니다.'
        });
        return;
      }

      // 성공 응답
      const responseContent = [
        '✅ **구인구직 카드가 성공적으로 수정되었습니다!**',
        `📌 **제목:** ${updatedJob.title}`,
        `👥 **모집 인원:** ${updatedJob.memberCount}명`,
        `⏰ **시작 시간:** ${updatedJob.startTime}`,
        `🆔 **카드 ID:** \`${updatedJob.id}\``
      ];

      await interaction.editReply({
        content: responseContent.join('\n')
      });

    } catch (error) {
      console.error('[JobPostInteractionService] 구인구직 카드 수정 오류:', error);
      await interaction.editReply({
        content: '❌ 구인구직 카드 수정 중 오류가 발생했습니다.'
      });
    }
  }

  /**
   * 구인구직 카드 생성 모달 표시
   * @param {Interaction} interaction - 상호작용 객체
   * @param {string|null} channelId - 음성채널 ID
   * @param {string} defaultTitle - 기본 제목
   */
  async showJobPostCreateModal(interaction, channelId = null, defaultTitle = '') {
    try {
      const customId = JobPostModalFactory.createCustomId('jobpost_create_modal', channelId);
      const modal = JobPostModalFactory.createJobPostModal({
        customId,
        defaultTitle,
        defaultChannelId: channelId
      });

      await interaction.showModal(modal);
    } catch (error) {
      console.error('[JobPostInteractionService] 모달 표시 오류:', error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ 모달 표시 중 오류가 발생했습니다.',
          ephemeral: true
        });
      }
    }
  }

  /**
   * 구인구직 카드 수정 모달 표시
   * @param {Interaction} interaction - 상호작용 객체
   * @param {string} jobId - 구인구직 카드 ID
   */
  async showJobPostEditModal(interaction, jobId) {
    try {
      const jobPost = await this.jobPostService.getJobPost(jobId);
      if (!jobPost) {
        await interaction.reply({
          content: '❌ 해당 구인구직 카드를 찾을 수 없습니다.',
          ephemeral: true
        });
        return;
      }

      // 권한 확인
      if (jobPost.authorId !== interaction.user.id) {
        await interaction.reply({
          content: '❌ 자신이 작성한 구인구직 카드만 수정할 수 있습니다.',
          ephemeral: true
        });
        return;
      }

      const modal = JobPostModalFactory.createJobPostEditModal(jobPost);
      await interaction.showModal(modal);
    } catch (error) {
      console.error('[JobPostInteractionService] 수정 모달 표시 오류:', error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ 모달 표시 중 오류가 발생했습니다.',
          ephemeral: true
        });
      }
    }
  }

  /**
   * 구인구직 카드 삭제
   * @param {Interaction} interaction - 상호작용 객체
   * @param {string} jobId - 구인구직 카드 ID
   */
  async deleteJobPost(interaction, jobId) {
    try {
      const jobPost = await this.jobPostService.getJobPost(jobId);
      if (!jobPost) {
        await interaction.reply({
          content: '❌ 해당 구인구직 카드를 찾을 수 없습니다.',
          ephemeral: true
        });
        return;
      }

      // 권한 확인 (작성자 또는 관리자)
      const isAuthor = jobPost.authorId === interaction.user.id;
      const isAdmin = interaction.member?.permissions?.has('ManageMessages');
      
      if (!isAuthor && !isAdmin) {
        await interaction.reply({
          content: '❌ 자신이 작성한 구인구직 카드만 삭제할 수 있습니다.',
          ephemeral: true
        });
        return;
      }

      // 카드 삭제
      const success = await this.jobPostService.deleteJobPost(jobId);
      
      if (success) {
        await interaction.reply({
          content: `✅ 구인구직 카드 "${jobPost.title}"가 삭제되었습니다.`,
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: '❌ 구인구직 카드 삭제에 실패했습니다.',
          ephemeral: true
        });
      }
    } catch (error) {
      console.error('[JobPostInteractionService] 구인구직 카드 삭제 오류:', error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ 구인구직 카드 삭제 중 오류가 발생했습니다.',
          ephemeral: true
        });
      }
    }
  }
}