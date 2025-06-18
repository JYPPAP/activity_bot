// src/services/jobPostButtonService.js - 구인구직 버튼 상호작용 서비스
import { JobPostButtonFactory } from '../utils/jobPostButtons.js';
import { JobPostService } from './JobPostService.js';
import { FILTERS } from '../config/constants.js';

export class JobPostButtonService {
  constructor(client, dbManager, activityTracker) {
    this.client = client;
    this.dbManager = dbManager;
    this.activityTracker = activityTracker;
    this.jobPostService = new JobPostService(dbManager);
  }

  /**
   * 서비스 초기화
   */
  async initialize() {
    await this.jobPostService.initialize();
    console.log('[JobPostButtonService] 구인구직 버튼 서비스 초기화 완료');
  }

  /**
   * 버튼 상호작용 처리
   * @param {ButtonInteraction} interaction - 버튼 상호작용
   */
  async handleButtonInteraction(interaction) {
    try {
      // 새로 추가된 버튼들 처리
      if (interaction.customId === 'create_job_post_manual') {
        await this.handleManualJobPostCreation(interaction);
        return;
      }
      
      if (interaction.customId === 'list_job_posts') {
        await this.handleJobPostList(interaction);
        return;
      }
      
      const parsed = JobPostButtonFactory.parseButtonCustomId(interaction.customId);
      if (!parsed) {
        return; // 관련 없는 버튼
      }

      const { action, jobId } = parsed;

      await interaction.deferReply({ ephemeral: true });

      // 구인구직 카드 조회
      const jobPost = await this.jobPostService.getJobPost(jobId);
      if (!jobPost) {
        await interaction.editReply({
          content: JobPostButtonFactory.createErrorMessage(action, '해당 구인구직 카드를 찾을 수 없습니다.')
        });
        return;
      }

      // 만료된 카드 확인
      if (jobPost.expiresAt <= Date.now()) {
        await interaction.editReply({
          content: JobPostButtonFactory.createErrorMessage(action, '만료된 구인구직 카드입니다.')
        });
        return;
      }

      // 액션별 처리
      switch (action) {
        case 'join':
          await this.handleJoinButton(interaction, jobPost);
          break;
        case 'spectate':
          await this.handleSpectateButton(interaction, jobPost);
          break;
        case 'info':
          await this.handleInfoButton(interaction, jobPost);
          break;
        case 'edit':
          await this.handleEditButton(interaction, jobPost);
          break;
        case 'delete':
          await this.handleDeleteButton(interaction, jobPost);
          break;
        case 'unlink':
          await this.handleUnlinkButton(interaction, jobPost);
          break;
        default:
          await interaction.editReply({
            content: JobPostButtonFactory.createErrorMessage(action, '알 수 없는 액션입니다.')
          });
      }

    } catch (error) {
      console.error('[JobPostButtonService] 버튼 상호작용 처리 오류:', error);
      
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
   * 입장 버튼 처리
   * @param {ButtonInteraction} interaction - 버튼 상호작용
   * @param {Object} jobPost - 구인구직 카드 데이터
   */
  async handleJoinButton(interaction, jobPost) {
    try {
      // 음성채널 확인
      const voiceChannel = this.client.channels.cache.get(jobPost.channelId);
      if (!voiceChannel) {
        await interaction.editReply({
          content: JobPostButtonFactory.createErrorMessage('join', '연동된 음성채널을 찾을 수 없습니다.')
        });
        return;
      }

      // 사용자 권한 확인
      const member = interaction.member;
      if (!voiceChannel.permissionsFor(member).has(['Connect', 'Speak'])) {
        await interaction.editReply({
          content: JobPostButtonFactory.createErrorMessage('join', '해당 음성채널에 입장할 권한이 없습니다.')
        });
        return;
      }

      // 닉네임에서 태그 제거 ([대기], [관전] 제거)
      await this.cleanUserNickname(member);

      // 음성채널로 이동
      try {
        await member.voice.setChannel(voiceChannel);
        
        // 성공 응답
        await interaction.editReply({
          content: JobPostButtonFactory.createSuccessMessage('join', { 
            channelName: voiceChannel.name 
          })
        });

        console.log(`[JobPostButtonService] ${member.user.tag}이 ${voiceChannel.name} 채널에 입장`);

      } catch (voiceError) {
        await interaction.editReply({
          content: JobPostButtonFactory.createErrorMessage('join', '음성채널 이동에 실패했습니다.')
        });
      }

    } catch (error) {
      console.error('[JobPostButtonService] 입장 버튼 처리 오류:', error);
      await interaction.editReply({
        content: JobPostButtonFactory.createErrorMessage('join', '처리 중 오류가 발생했습니다.')
      });
    }
  }

  /**
   * 관전 버튼 처리
   * @param {ButtonInteraction} interaction - 버튼 상호작용
   * @param {Object} jobPost - 구인구직 카드 데이터
   */
  async handleSpectateButton(interaction, jobPost) {
    try {
      // 음성채널 확인
      const voiceChannel = this.client.channels.cache.get(jobPost.channelId);
      if (!voiceChannel) {
        await interaction.editReply({
          content: JobPostButtonFactory.createErrorMessage('spectate', '연동된 음성채널을 찾을 수 없습니다.')
        });
        return;
      }

      // 사용자 권한 확인
      const member = interaction.member;
      if (!voiceChannel.permissionsFor(member).has(['Connect'])) {
        await interaction.editReply({
          content: JobPostButtonFactory.createErrorMessage('spectate', '해당 음성채널에 입장할 권한이 없습니다.')
        });
        return;
      }

      // 닉네임에 [관전] 태그 추가
      await this.addSpectatorTag(member);

      // 음성채널로 이동
      try {
        await member.voice.setChannel(voiceChannel);
        
        // 음소거 설정 (서버 음소거)
        try {
          await member.voice.setMute(true);
        } catch (muteError) {
          console.warn('[JobPostButtonService] 음소거 설정 실패:', muteError);
          // 음소거 실패해도 입장은 성공으로 처리
        }
        
        // 성공 응답
        await interaction.editReply({
          content: JobPostButtonFactory.createSuccessMessage('spectate', { 
            channelName: voiceChannel.name 
          })
        });

        console.log(`[JobPostButtonService] ${member.user.tag}이 ${voiceChannel.name} 채널에 관전 모드로 입장`);

      } catch (voiceError) {
        await interaction.editReply({
          content: JobPostButtonFactory.createErrorMessage('spectate', '음성채널 이동에 실패했습니다.')
        });
      }

    } catch (error) {
      console.error('[JobPostButtonService] 관전 버튼 처리 오류:', error);
      await interaction.editReply({
        content: JobPostButtonFactory.createErrorMessage('spectate', '처리 중 오류가 발생했습니다.')
      });
    }
  }

  /**
   * 정보 버튼 처리
   * @param {ButtonInteraction} interaction - 버튼 상호작용
   * @param {Object} jobPost - 구인구직 카드 데이터
   */
  async handleInfoButton(interaction, jobPost) {
    try {
      await interaction.editReply({
        content: JobPostButtonFactory.createSuccessMessage('info', { jobPost })
      });

    } catch (error) {
      console.error('[JobPostButtonService] 정보 버튼 처리 오류:', error);
      await interaction.editReply({
        content: JobPostButtonFactory.createErrorMessage('info', '처리 중 오류가 발생했습니다.')
      });
    }
  }

  /**
   * 수정 버튼 처리 (작성자만)
   * @param {ButtonInteraction} interaction - 버튼 상호작용
   * @param {Object} jobPost - 구인구직 카드 데이터
   */
  async handleEditButton(interaction, jobPost) {
    try {
      // 권한 확인
      if (jobPost.authorId !== interaction.user.id) {
        await interaction.editReply({
          content: JobPostButtonFactory.createErrorMessage('edit', '자신이 작성한 구인구직 카드만 수정할 수 있습니다.')
        });
        return;
      }

      // 수정 모달 표시는 JobPostInteractionService에서 처리
      // 여기서는 임시로 메시지만 표시
      await interaction.editReply({
        content: JobPostButtonFactory.createSuccessMessage('edit', { jobPost })
      });

    } catch (error) {
      console.error('[JobPostButtonService] 수정 버튼 처리 오류:', error);
      await interaction.editReply({
        content: JobPostButtonFactory.createErrorMessage('edit', '처리 중 오류가 발생했습니다.')
      });
    }
  }

  /**
   * 삭제 버튼 처리 (작성자만)
   * @param {ButtonInteraction} interaction - 버튼 상호작용
   * @param {Object} jobPost - 구인구직 카드 데이터
   */
  async handleDeleteButton(interaction, jobPost) {
    try {
      // 권한 확인
      const isAuthor = jobPost.authorId === interaction.user.id;
      const isAdmin = interaction.member?.permissions?.has('ManageMessages');
      
      if (!isAuthor && !isAdmin) {
        await interaction.editReply({
          content: JobPostButtonFactory.createErrorMessage('delete', '자신이 작성한 구인구직 카드만 삭제할 수 있습니다.')
        });
        return;
      }

      // 카드 삭제
      const success = await this.jobPostService.deleteJobPost(jobPost.id);
      
      if (success) {
        await interaction.editReply({
          content: JobPostButtonFactory.createSuccessMessage('delete', { jobPost })
        });
      } else {
        await interaction.editReply({
          content: JobPostButtonFactory.createErrorMessage('delete', '삭제에 실패했습니다.')
        });
      }

    } catch (error) {
      console.error('[JobPostButtonService] 삭제 버튼 처리 오류:', error);
      await interaction.editReply({
        content: JobPostButtonFactory.createErrorMessage('delete', '처리 중 오류가 발생했습니다.')
      });
    }
  }

  /**
   * 연동 해제 버튼 처리 (작성자만)
   * @param {ButtonInteraction} interaction - 버튼 상호작용
   * @param {Object} jobPost - 구인구직 카드 데이터
   */
  async handleUnlinkButton(interaction, jobPost) {
    try {
      // 권한 확인
      if (jobPost.authorId !== interaction.user.id) {
        await interaction.editReply({
          content: JobPostButtonFactory.createErrorMessage('unlink', '자신이 작성한 구인구직 카드만 연동 해제할 수 있습니다.')
        });
        return;
      }

      // 채널 연동 해제
      const success = await this.jobPostService.unlinkJobPostFromChannel(jobPost.channelId);
      
      if (success) {
        await interaction.editReply({
          content: JobPostButtonFactory.createSuccessMessage('unlink', { jobPost })
        });
      } else {
        await interaction.editReply({
          content: JobPostButtonFactory.createErrorMessage('unlink', '연동 해제에 실패했습니다.')
        });
      }

    } catch (error) {
      console.error('[JobPostButtonService] 연동 해제 버튼 처리 오류:', error);
      await interaction.editReply({
        content: JobPostButtonFactory.createErrorMessage('unlink', '처리 중 오류가 발생했습니다.')
      });
    }
  }

  /**
   * 사용자 닉네임에서 태그 제거 ([대기], [관전] 제거)
   * @param {GuildMember} member - 길드 멤버
   */
  async cleanUserNickname(member) {
    try {
      const currentNickname = member.nickname || member.user.globalName || member.user.username;
      
      // 태그 제거
      let cleanNickname = currentNickname
        .replace(/\[대기\]/g, '')
        .replace(/\[관전\]/g, '')
        .replace(FILTERS.WAITING, '')
        .replace(FILTERS.OBSERVATION, '')
        .trim();

      // 닉네임이 변경된 경우에만 업데이트
      if (cleanNickname !== currentNickname && member.manageable) {
        await member.setNickname(cleanNickname);
        console.log(`[JobPostButtonService] ${member.user.tag} 닉네임 정리: "${currentNickname}" → "${cleanNickname}"`);
      }

    } catch (error) {
      console.warn('[JobPostButtonService] 닉네임 정리 실패:', error);
      // 닉네임 변경 실패는 치명적이지 않으므로 경고만 로그
    }
  }

  /**
   * 사용자 닉네임에 [관전] 태그 추가
   * @param {GuildMember} member - 길드 멤버
   */
  async addSpectatorTag(member) {
    try {
      const currentNickname = member.nickname || member.user.globalName || member.user.username;
      
      // 이미 [관전] 태그가 있는지 확인
      if (currentNickname.includes('[관전]') || currentNickname.includes(FILTERS.OBSERVATION)) {
        return; // 이미 태그가 있으면 추가하지 않음
      }

      // 기존 태그 제거 후 [관전] 태그 추가
      let newNickname = currentNickname
        .replace(/\[대기\]/g, '')
        .replace(FILTERS.WAITING, '')
        .trim();

      newNickname = `[관전] ${newNickname}`;

      // 닉네임 길이 제한 (32자)
      if (newNickname.length > 32) {
        const maxLength = 32 - '[관전] '.length;
        const trimmedName = newNickname.substring('[관전] '.length, maxLength + '[관전] '.length);
        newNickname = `[관전] ${trimmedName}`;
      }

      // 닉네임 변경
      if (member.manageable) {
        await member.setNickname(newNickname);
        console.log(`[JobPostButtonService] ${member.user.tag} 관전 태그 추가: "${currentNickname}" → "${newNickname}"`);
      }

    } catch (error) {
      console.warn('[JobPostButtonService] 관전 태그 추가 실패:', error);
      // 닉네임 변경 실패는 치명적이지 않으므로 경고만 로그
    }
  }

  /**
   * 수동 구인구직 카드 생성 처리
   * @param {ButtonInteraction} interaction - 버튼 상호작용
   */
  async handleManualJobPostCreation(interaction) {
    try {
      console.log('[JobPostButtonService] 수동 구인구직 카드 생성 요청');
      
      // jobPostInteractionService를 통해 모달 표시
      const jobPostInteractionService = this.client.jobPostInteractionService || 
        this.client.commandHandler?.jobPostInteractionService;
      
      if (jobPostInteractionService) {
        await jobPostInteractionService.showJobPostCreateModal(interaction);
      } else {
        await interaction.reply({
          content: '❌ 구인구직 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해주세요.',
          ephemeral: true
        });
      }
    } catch (error) {
      console.error('[JobPostButtonService] 수동 카드 생성 오류:', error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ 구인구직 카드 생성 중 오류가 발생했습니다.',
          ephemeral: true
        });
      }
    }
  }

  /**
   * 구인구직 카드 목록 표시 처리
   * @param {ButtonInteraction} interaction - 버튼 상호작용
   */
  async handleJobPostList(interaction) {
    try {
      console.log('[JobPostButtonService] 구인구직 카드 목록 요청');
      
      await interaction.deferReply({ ephemeral: true });
      
      // 현재 활성 카드 목록 조회
      const result = await this.jobPostService.getAllJobPosts(false, { limit: 10 });
      
      if (result.data.length === 0) {
        await interaction.editReply({
          content: '📋 현재 활성화된 구인구직 카드가 없습니다.\n\n"🎮 새 구인구직 카드 만들기" 버튼을 클릭하여 새 카드를 만들어보세요!'
        });
        return;
      }

      // 목록 임베드 생성
      const { EmbedBuilder } = require('discord.js');
      const embed = new EmbedBuilder()
        .setColor('#00D166')
        .setTitle('📋 현재 활성 구인구직 카드 목록')
        .setDescription(`총 ${result.data.length}개의 활성 카드가 있습니다.`)
        .setTimestamp();

      // 카드들을 필드로 추가
      result.data.forEach((job, index) => {
        const expiresIn = Math.floor((job.expiresAt - Date.now()) / (1000 * 60 * 60));
        const channelInfo = job.channelId ? '🔗 연동됨' : '⭕ 미연동';
        
        embed.addFields({
          name: `${index + 1}. ${job.title}`,
          value: [
            `👥 인원: ${job.memberCount}명`,
            `⏰ 시작: ${job.startTime}`,
            `🏷️ 태그: ${job.roleTags || '없음'}`,
            `📍 상태: ${channelInfo}`,
            `⏳ 만료: ${expiresIn}시간 후`
          ].join('\n'),
          inline: true
        });
      });

      await interaction.editReply({
        embeds: [embed]
      });

    } catch (error) {
      console.error('[JobPostButtonService] 카드 목록 표시 오류:', error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ 구인구직 카드 목록 조회 중 오류가 발생했습니다.',
          ephemeral: true
        });
      } else {
        await interaction.editReply({
          content: '❌ 구인구직 카드 목록 조회 중 오류가 발생했습니다.'
        });
      }
    }
  }
}