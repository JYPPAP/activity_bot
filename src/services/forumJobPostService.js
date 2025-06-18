// src/services/forumJobPostService.js - 포럼 기반 구인구직 서비스
import { EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } from 'discord.js';
import { JobPostService } from './JobPostService.js';

export class ForumJobPostService {
  constructor(client, dbManager) {
    this.client = client;
    this.dbManager = dbManager;
    this.jobPostService = new JobPostService(dbManager);
    this.forumChannelId = '1377902213002690562'; // 구인구직-테스트 채널 ID
  }

  /**
   * 서비스 초기화
   */
  async initialize() {
    await this.jobPostService.initialize();
    console.log('[ForumJobPostService] 포럼 기반 구인구직 서비스 초기화 완료');
    
    // 포럼 채널 확인
    await this.verifyForumChannel();
  }

  /**
   * 포럼 채널 확인
   */
  async verifyForumChannel() {
    try {
      const forumChannel = await this.client.channels.fetch(this.forumChannelId).catch(() => null);
      
      if (!forumChannel) {
        console.log('[ForumJobPostService] 구인구직 포럼 채널을 찾을 수 없음');
        return;
      }

      console.log(`[ForumJobPostService] 포럼 채널 확인: ${forumChannel.name} (타입: ${forumChannel.type})`);
      
    } catch (error) {
      console.error('[ForumJobPostService] 포럼 채널 확인 오류:', error);
    }
  }

  /**
   * 음성 채널 생성 시 포럼 스레드 자동 생성
   * @param {VoiceChannel} voiceChannel - 생성된 음성 채널
   */
  async handleVoiceChannelCreate(voiceChannel) {
    try {
      // 음성 채널이 아니면 무시
      if (voiceChannel.type !== 2) { // ChannelType.GuildVoice
        return;
      }

      console.log(`[ForumJobPostService] 음성 채널 생성 감지: ${voiceChannel.name}`);

      // 10초 후 음성 채널에 사용자가 있는지 확인하고 포럼 스레드 생성
      setTimeout(async () => {
        try {
          // 음성 채널에 있는 사용자들 확인
          const voiceMembers = voiceChannel.members;
          console.log(`[ForumJobPostService] 음성 채널 ${voiceChannel.name}에 ${voiceMembers.size}명의 사용자 확인`);
          
          if (voiceMembers.size > 0) {
            // 사용자가 있으면 포럼에 스레드 생성
            await this.createForumThread(voiceChannel, voiceMembers);
          } else {
            console.log(`[ForumJobPostService] 음성 채널 ${voiceChannel.name}에 사용자가 없어 스레드 생성하지 않음`);
          }
          
        } catch (error) {
          console.error('[ForumJobPostService] 지연 스레드 생성 오류:', error);
        }
      }, 10000); // 10초 후 실행

    } catch (error) {
      console.error('[ForumJobPostService] 음성 채널 생성 처리 오류:', error);
    }
  }

  /**
   * 포럼 채널에 구인구직 스레드 생성
   * @param {VoiceChannel} voiceChannel - 음성 채널
   * @param {Collection} voiceMembers - 음성 채널의 멤버들
   */
  async createForumThread(voiceChannel, voiceMembers) {
    try {
      const forumChannel = await this.client.channels.fetch(this.forumChannelId).catch(() => null);
      
      if (!forumChannel) {
        console.log('[ForumJobPostService] 구인구직 포럼 채널을 찾을 수 없음');
        return;
      }

      // 이미 연동된 스레드가 있는지 확인
      const existingJobPost = await this.jobPostService.getJobPostByChannelId(voiceChannel.id);
      if (existingJobPost) {
        console.log(`[ForumJobPostService] 채널 ${voiceChannel.name}은 이미 구인구직과 연동됨`);
        return;
      }

      // 스레드 제목 생성 (음성 채널명 + 참여자 수)
      const threadTitle = `🎮 ${voiceChannel.name} (${voiceMembers.size}명 모집)`;
      
      // 참여자 목록 생성
      const memberList = voiceMembers.map(member => `• ${member.displayName}`).join('\n');
      
      // 구인구직 정보 임베드 생성
      const embed = new EmbedBuilder()
        .setColor('#00D166')
        .setTitle(`🎙️ ${voiceChannel.name}`)
        .setDescription(
          `음성 채널에서 함께 플레이할 멤버를 모집합니다!\n\n` +
          `**현재 참여자 (${voiceMembers.size}명):**\n${memberList}\n\n` +
          `아래 버튼을 클릭하여 참여하거나 관전해보세요!`
        )
        .addFields(
          {
            name: '📍 음성 채널',
            value: `<#${voiceChannel.id}>`,
            inline: true
          },
          {
            name: '👥 현재 인원',
            value: `${voiceMembers.size}명`,
            inline: true
          },
          {
            name: '⏰ 생성 시간',
            value: `<t:${Math.floor(Date.now() / 1000)}:R>`,
            inline: true
          }
        )
        .setFooter({ text: '음성 채널이 삭제되면 이 스레드도 자동으로 정리됩니다.' })
        .setTimestamp();

      // 입장/관전 버튼 생성
      const joinButton = new ButtonBuilder()
        .setCustomId(`voice_join_${voiceChannel.id}`)
        .setLabel('🎙️ 음성 채널 입장')
        .setStyle(ButtonStyle.Primary);

      const spectateButton = new ButtonBuilder()
        .setCustomId(`voice_spectate_${voiceChannel.id}`)
        .setLabel('👁️ 관전 모드')
        .setStyle(ButtonStyle.Secondary);

      const actionRow = new ActionRowBuilder()
        .addComponents(joinButton, spectateButton);

      // 포럼 스레드 생성
      const thread = await forumChannel.threads.create({
        name: threadTitle,
        message: {
          embeds: [embed],
          components: [actionRow]
        },
        autoArchiveDuration: 1440, // 24시간 후 자동 아카이브
        reason: `음성 채널 ${voiceChannel.name} 연동 스레드`
      });

      // 데이터베이스에 구인구직 카드 생성
      const jobPostData = {
        title: voiceChannel.name,
        memberCount: voiceMembers.size,
        startTime: '지금',
        description: `음성 채널에서 함께 플레이할 멤버 모집`,
        roleTags: '음성채널',
        channelId: voiceChannel.id,
        authorId: voiceMembers.first()?.id || this.client.user.id,
        threadId: thread.id, // 포럼 스레드 ID 추가
        expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24시간 후 만료
      };

      const jobPost = await this.jobPostService.createJobPost(jobPostData);

      console.log(`[ForumJobPostService] 포럼 스레드 생성 완료: ${thread.name}`);
      console.log(`[ForumJobPostService] 구인구직 카드 생성: ${jobPost.id}`);

      // 스레드 링크를 음성 채널 참여자들에게 DM으로 전송
      for (const [, member] of voiceMembers) {
        try {
          await member.send({
            content: `🎮 **${voiceChannel.name}** 구인구직 카드가 생성되었습니다!\n${thread.url}`
          });
        } catch (dmError) {
          console.log(`[ForumJobPostService] ${member.displayName}에게 DM 전송 실패`);
        }
      }

      return { thread, jobPost };

    } catch (error) {
      console.error('[ForumJobPostService] 포럼 스레드 생성 오류:', error);
      return null;
    }
  }

  /**
   * 음성 채널 삭제 시 연동된 스레드 정리
   * @param {VoiceChannel} voiceChannel - 삭제된 음성 채널
   */
  async handleVoiceChannelDelete(voiceChannel) {
    try {
      console.log(`[ForumJobPostService] 음성 채널 삭제 감지: ${voiceChannel.name}`);

      // 연동된 구인구직 카드 찾기
      const jobPost = await this.jobPostService.getJobPostByChannelId(voiceChannel.id);
      if (!jobPost) {
        console.log(`[ForumJobPostService] 채널 ${voiceChannel.name}에 연동된 구인구직 카드 없음`);
        return;
      }

      // 포럼 스레드 정리
      if (jobPost.threadId) {
        try {
          const forumChannel = await this.client.channels.fetch(this.forumChannelId);
          const thread = await forumChannel.threads.fetch(jobPost.threadId);
          
          if (thread) {
            // 스레드에 종료 메시지 전송
            const endEmbed = new EmbedBuilder()
              .setColor('#FF6B6B')
              .setTitle('🔚 음성 채널 종료')
              .setDescription(`연동된 음성 채널이 삭제되어 이 구인구직이 종료되었습니다.`)
              .setTimestamp();

            await thread.send({ embeds: [endEmbed] });
            
            // 스레드 아카이브
            await thread.setArchived(true, '연동된 음성 채널 삭제');
            console.log(`[ForumJobPostService] 스레드 아카이브 완료: ${thread.name}`);
          }
        } catch (threadError) {
          console.log(`[ForumJobPostService] 스레드 정리 중 오류:`, threadError.message);
        }
      }

      // 데이터베이스에서 구인구직 카드 삭제
      await this.jobPostService.deleteJobPost(jobPost.id);
      console.log(`[ForumJobPostService] 구인구직 카드 삭제 완료: ${jobPost.id}`);

    } catch (error) {
      console.error('[ForumJobPostService] 음성 채널 삭제 처리 오류:', error);
    }
  }

  /**
   * 음성 채널 버튼 상호작용 처리
   * @param {ButtonInteraction} interaction - 버튼 상호작용
   */
  async handleVoiceButtonInteraction(interaction) {
    try {
      if (!interaction.customId.startsWith('voice_')) {
        return; // 관련 없는 버튼
      }

      const [action, channelId] = interaction.customId.replace('voice_', '').split('_');
      
      await interaction.deferReply({ ephemeral: true });

      // 음성 채널 조회
      const voiceChannel = await interaction.guild.channels.fetch(channelId);
      if (!voiceChannel) {
        await interaction.editReply({
          content: '❌ 음성 채널을 찾을 수 없습니다. 채널이 삭제되었을 수 있습니다.'
        });
        return;
      }

      const member = interaction.member;

      if (action === 'join') {
        // 음성 채널 입장
        await member.voice.setChannel(voiceChannel);
        await interaction.editReply({
          content: `🎙️ **${voiceChannel.name}** 음성 채널에 입장했습니다!`
        });
        
      } else if (action === 'spectate') {
        // 관전 모드 (음성 채널 입장 + 음소거)
        await member.voice.setChannel(voiceChannel);
        await member.voice.setMute(true);
        
        // 닉네임에 [관전] 태그 추가
        await this.addSpectatorTag(member);
        
        await interaction.editReply({
          content: `👁️ **${voiceChannel.name}** 음성 채널에 관전 모드로 입장했습니다!`
        });
      }

      console.log(`[ForumJobPostService] ${member.displayName}이 ${voiceChannel.name} 채널에 ${action} 모드로 입장`);

    } catch (error) {
      console.error('[ForumJobPostService] 음성 버튼 상호작용 오류:', error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ 음성 채널 입장 중 오류가 발생했습니다.',
          ephemeral: true
        });
      } else {
        await interaction.editReply({
          content: '❌ 음성 채널 입장 중 오류가 발생했습니다.'
        });
      }
    }
  }

  /**
   * 관전 태그 추가
   * @param {GuildMember} member - 길드 멤버
   */
  async addSpectatorTag(member) {
    try {
      if (!member.manageable) return;

      const currentNickname = member.displayName;
      
      // 이미 [관전] 태그가 있는지 확인
      if (currentNickname.includes('[관전]')) {
        return;
      }

      // [대기] 태그 제거하고 [관전] 태그 추가
      let newNickname = currentNickname.replace(/\[대기\]/g, '').trim();
      newNickname = `[관전] ${newNickname}`;

      await member.setNickname(newNickname);
      console.log(`[ForumJobPostService] ${member.user.tag} 관전 태그 추가: "${currentNickname}" → "${newNickname}"`);

    } catch (error) {
      console.warn('[ForumJobPostService] 관전 태그 추가 실패:', error.message);
    }
  }
}