// src/services/VoiceChannelForumIntegrationService.js - 음성채널-포럼 통합 서비스
import { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle,
  StringSelectMenuBuilder,
  ChannelType 
} from 'discord.js';

export class VoiceChannelForumIntegrationService {
  constructor(client, forumChannelId, voiceCategoryId) {
    this.client = client;
    this.forumChannelId = forumChannelId; // 1385861379377987655
    this.voiceCategoryId = voiceCategoryId; // 1243578210684243970
    this.channelPostMap = new Map(); // 음성채널 ID -> 포럼 포스트 ID 매핑
  }

  /**
   * 음성 채널 생성 이벤트 핸들러
   * @param {Channel} channel - 생성된 채널
   */
  async handleChannelCreate(channel) {
    try {
      // 음성 채널이고 지정된 카테고리에 생성된 경우만 처리
      if (channel.type === ChannelType.GuildVoice && 
          channel.parentId === this.voiceCategoryId) {
        
        console.log(`음성 채널 생성 감지: ${channel.name} (ID: ${channel.id})`);
        
        // 5초 지연 후 임베드 메시지 전송
        setTimeout(async () => {
          await this.sendRecruitmentEmbed(channel);
        }, 5000);
      }
    } catch (error) {
      console.error('음성 채널 생성 처리 오류:', error);
    }
  }

  /**
   * 음성 채널 삭제 이벤트 핸들러
   * @param {Channel} channel - 삭제된 채널
   */
  async handleChannelDelete(channel) {
    try {
      // 음성 채널이고 매핑된 포럼 포스트가 있는 경우
      if (channel.type === ChannelType.GuildVoice && 
          this.channelPostMap.has(channel.id)) {
        
        console.log(`음성 채널 삭제 감지: ${channel.name} (ID: ${channel.id})`);
        
        const postId = this.channelPostMap.get(channel.id);
        await this.archiveForumPost(postId);
        
        // 매핑 제거
        this.channelPostMap.delete(channel.id);
      }
    } catch (error) {
      console.error('음성 채널 삭제 처리 오류:', error);
    }
  }

  /**
   * 음성 채널 업데이트 이벤트 핸들러
   * @param {Channel} oldChannel - 업데이트 전 채널
   * @param {Channel} newChannel - 업데이트 후 채널
   */
  async handleChannelUpdate(oldChannel, newChannel) {
    try {
      // 음성 채널이고 이름이 변경되었으며 매핑된 포럼이 있는 경우
      if (newChannel.type === ChannelType.GuildVoice && 
          oldChannel.name !== newChannel.name &&
          this.channelPostMap.has(newChannel.id)) {
        
        console.log(`음성 채널 이름 변경 감지: ${oldChannel.name} -> ${newChannel.name} (ID: ${newChannel.id})`);
        
        const postId = this.channelPostMap.get(newChannel.id);
        await this.updateVoiceChannelLink(postId, newChannel.name, newChannel.id, newChannel.guild.id);
      }
    } catch (error) {
      console.error('음성 채널 업데이트 처리 오류:', error);
    }
  }

  /**
   * 구인구직 연동 임베드 메시지를 음성 채널에 전송
   * @param {VoiceChannel} voiceChannel - 음성 채널
   */
  async sendRecruitmentEmbed(voiceChannel) {
    try {
      const embed = new EmbedBuilder()
        .setTitle('🎯 구인구직 연동')
        .setDescription('이 음성 채널을 구인구직 포럼에 연동하시겠습니까?')
        .addFields(
          { name: '📍 채널', value: voiceChannel.name, inline: true },
          { name: '🔗 바로가기', value: `<#${voiceChannel.id}>`, inline: true }
        )
        .setColor(0x5865F2)
        .setTimestamp();

      const button = new ButtonBuilder()
        .setCustomId(`recruitment_options_${voiceChannel.id}`)
        .setLabel('구인구직 연동하기')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📝');

      const row = new ActionRowBuilder().addComponents(button);

      await voiceChannel.send({
        embeds: [embed],
        components: [row]
      });

      console.log(`구인구직 임베드 전송 완료: ${voiceChannel.name}`);
    } catch (error) {
      console.error('구인구직 임베드 전송 오류:', error);
    }
  }

  /**
   * 활성화된 포럼 포스트 목록 가져오기
   * @returns {Array} - 활성화된 포럼 포스트 배열
   */
  async getActiveForumPosts() {
    try {
      const forumChannel = await this.client.channels.fetch(this.forumChannelId);
      
      if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
        return [];
      }

      // 활성화된 스레드만 가져오기
      const activeThreads = await forumChannel.threads.fetchActive();
      
      return activeThreads.threads
        .filter(thread => !thread.archived && !thread.locked)
        .map(thread => ({
          id: thread.id,
          name: thread.name,
          memberCount: thread.memberCount
        }))
        .slice(0, 15); // 드롭다운 최대 15개 제한
    } catch (error) {
      console.error('활성화된 포럼 포스트 조회 오류:', error);
      return [];
    }
  }

  /**
   * 버튼 인터랙션 처리 (1단계: 옵션 선택)
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   */
  async handleButtonInteraction(interaction) {
    try {
      if (!interaction.customId.startsWith('recruitment_options_')) {
        return;
      }

      const voiceChannelId = interaction.customId.split('_')[2];
      const voiceChannel = await this.client.channels.fetch(voiceChannelId);

      if (!voiceChannel) {
        await interaction.reply({
          content: '❌ 음성 채널을 찾을 수 없습니다.',
          ephemeral: true
        });
        return;
      }

      // 활성화된 포럼 포스트 가져오기
      const activePosts = await this.getActiveForumPosts();

      const embed = new EmbedBuilder()
        .setTitle('🎯 구인구직 연동 방법 선택')
        .setDescription('새로운 포럼을 생성하거나 기존 포럼에 연동할 수 있습니다.')
        .setColor(0x5865F2);

      const selectOptions = [
        {
          label: '🆕 새 구인구직 포럼 생성',
          description: '새로운 포럼 포스트를 생성합니다',
          value: `new_forum_${voiceChannelId}`
        }
      ];

      // 활성화된 포럼이 있으면 선택지에 추가
      if (activePosts.length > 0) {
        activePosts.forEach(post => {
          selectOptions.push({
            label: `🔗 ${post.name}`,
            description: `${post.name} 포럼에 연동`,
            value: `existing_forum_${voiceChannelId}_${post.id}`
          });
        });
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`recruitment_select_${voiceChannelId}`)
        .setPlaceholder('연동 방법을 선택하세요')
        .addOptions(selectOptions);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true
      });
    } catch (error) {
      console.error('버튼 인터랙션 처리 오류:', error);
      await interaction.reply({
        content: '❌ 오류가 발생했습니다. 다시 시도해주세요.',
        ephemeral: true
      });
    }
  }

  /**
   * 드롭다운 선택 처리
   * @param {StringSelectMenuInteraction} interaction - 드롭다운 인터랙션
   */
  async handleSelectMenuInteraction(interaction) {
    try {
      if (!interaction.customId.startsWith('recruitment_select_')) {
        return;
      }

      const selectedValue = interaction.values[0];
      const voiceChannelId = interaction.customId.split('_')[2];

      if (selectedValue.startsWith('new_forum_')) {
        // 새 포럼 생성 - 모달 표시
        await this.showRecruitmentModal(interaction, voiceChannelId);
      } else if (selectedValue.startsWith('existing_forum_')) {
        // 기존 포럼 연동
        const parts = selectedValue.split('_');
        const existingPostId = parts[3];
        await this.linkToExistingForum(interaction, voiceChannelId, existingPostId);
      }
    } catch (error) {
      console.error('드롭다운 선택 처리 오류:', error);
      await interaction.reply({
        content: '❌ 오류가 발생했습니다. 다시 시도해주세요.',
        ephemeral: true
      });
    }
  }

  /**
   * 독립적인 구인구직 모달 표시 (명령어용)
   * @param {Interaction} interaction - 인터랙션 객체
   */
  async showStandaloneRecruitmentModal(interaction) {
    try {
      const modal = new ModalBuilder()
        .setCustomId('standalone_recruitment_modal')
        .setTitle('구인구직 포럼 생성');

      const titleInput = new TextInputBuilder()
        .setCustomId('recruitment_title')
        .setLabel('제목')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('예: [롤] [3명] [오후 8시]')
        .setRequired(true)
        .setMaxLength(100);

      const tagsInput = new TextInputBuilder()
        .setCustomId('recruitment_tags')
        .setLabel('태그 (쉼표로 구분)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('예: 게임, 랭크, 캐주얼')
        .setRequired(false)
        .setMaxLength(100);

      const descriptionInput = new TextInputBuilder()
        .setCustomId('recruitment_description')
        .setLabel('상세 설명')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('게임 모드, 티어, 기타 요구사항 등을 자유롭게 작성해주세요.')
        .setRequired(false)
        .setMaxLength(1000);

      const firstRow = new ActionRowBuilder().addComponents(titleInput);
      const secondRow = new ActionRowBuilder().addComponents(tagsInput);
      const thirdRow = new ActionRowBuilder().addComponents(descriptionInput);

      modal.addComponents(firstRow, secondRow, thirdRow);

      await interaction.showModal(modal);
    } catch (error) {
      console.error('독립 모달 표시 오류:', error);
    }
  }

  /**
   * 구인구직 모달 표시 (새 포럼 생성용)
   * @param {Interaction} interaction - 인터랙션 객체
   * @param {string} voiceChannelId - 음성 채널 ID
   */
  async showRecruitmentModal(interaction, voiceChannelId) {
    try {
      const modal = new ModalBuilder()
        .setCustomId(`recruitment_modal_${voiceChannelId}`)
        .setTitle('새 구인구직 포럼 생성');

      const titleInput = new TextInputBuilder()
        .setCustomId('recruitment_title')
        .setLabel('제목')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('예: [롤] [3명] [오후 8시]')
        .setRequired(true)
        .setMaxLength(100);

      const tagsInput = new TextInputBuilder()
        .setCustomId('recruitment_tags')
        .setLabel('태그 (쉼표로 구분)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('예: 게임, 랭크, 캐주얼')
        .setRequired(false)
        .setMaxLength(100);

      const descriptionInput = new TextInputBuilder()
        .setCustomId('recruitment_description')
        .setLabel('상세 설명')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('게임 모드, 티어, 기타 요구사항 등을 자유롭게 작성해주세요.')
        .setRequired(false)
        .setMaxLength(1000);

      const firstRow = new ActionRowBuilder().addComponents(titleInput);
      const secondRow = new ActionRowBuilder().addComponents(tagsInput);
      const thirdRow = new ActionRowBuilder().addComponents(descriptionInput);

      modal.addComponents(firstRow, secondRow, thirdRow);

      await interaction.showModal(modal);
    } catch (error) {
      console.error('모달 표시 오류:', error);
    }
  }

  /**
   * 기존 포럼에 연동
   * @param {Interaction} interaction - 인터랙션 객체
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {string} existingPostId - 기존 포스트 ID
   */
  async linkToExistingForum(interaction, voiceChannelId, existingPostId) {
    try {
      const voiceChannel = await this.client.channels.fetch(voiceChannelId);
      const existingThread = await this.client.channels.fetch(existingPostId);

      if (!voiceChannel || !existingThread) {
        await interaction.reply({
          content: '❌ 채널을 찾을 수 없습니다.',
          ephemeral: true
        });
        return;
      }

      // 기존 포럼에 음성 채널 링크 추가
      const linkEmbed = new EmbedBuilder()
        .setTitle('🔊 음성 채널 연동')
        .setDescription(`새로운 음성 채널이 이 구인구직에 연동되었습니다!`)
        .addFields(
          { name: '🎯 연결된 음성 채널', value: `[${voiceChannel.name} 참여하기](https://discord.com/channels/${voiceChannel.guild.id}/${voiceChannel.id})`, inline: false },
          { name: '👤 연동자', value: `<@${interaction.user.id}>`, inline: true },
          { name: '⏰ 연동 시간', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
        )
        .setColor(0x00FF00)
        .setTimestamp();

      await existingThread.send({ embeds: [linkEmbed] });

      // 기존 포럼 포스트의 음성 채널 필드 업데이트
      await this.updateVoiceChannelLink(existingPostId, voiceChannel.name, voiceChannel.id, voiceChannel.guild.id);

      // 채널-포스트 매핑 저장
      this.channelPostMap.set(voiceChannelId, existingPostId);

      await interaction.reply({
        content: `✅ 기존 구인구직에 성공적으로 연동되었습니다!\n🔗 포럼: <#${existingPostId}>`,
        ephemeral: true
      });

      console.log(`기존 포럼 연동 완료: ${voiceChannel.name} -> ${existingThread.name}`);
    } catch (error) {
      console.error('기존 포럼 연동 오류:', error);
      await interaction.reply({
        content: '❌ 연동에 실패했습니다. 다시 시도해주세요.',
        ephemeral: true
      });
    }
  }

  /**
   * 독립적인 포럼 포스트 생성 (음성 채널 없이)
   * @param {Object} recruitmentData - 구인구직 데이터
   * @returns {string|null} - 생성된 포스트 ID 또는 null
   */
  async createStandaloneForumPost(recruitmentData) {
    try {
      const forumChannel = await this.client.channels.fetch(this.forumChannelId);
      
      if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
        console.error('포럼 채널을 찾을 수 없거나 올바른 포럼 채널이 아닙니다.');
        return null;
      }

      // 태그를 역할 멘션으로 변환 (길드 정보 필요)
      const guild = forumChannel.guild;
      const roleMentions = await this.convertTagsToRoleMentions(recruitmentData.tags, guild);
      const tagsText = roleMentions ? roleMentions : '';

      const embed = new EmbedBuilder()
        .setTitle(`🎮 ${recruitmentData.title}`)
        .addFields(
          { name: '📝 상세 설명', value: recruitmentData.description, inline: false },
          { name: '🔊 음성 채널', value: '음성 채널에서 연동 버튼을 클릭하면 자동으로 연결됩니다.', inline: false },
          { name: '👤 모집자', value: `<@${recruitmentData.author.id}>`, inline: true },
          { name: '⏰ 등록 시간', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
        )
        .setColor(0xFFB800) // 독립 포스트는 주황색으로 구분
        .setFooter({ 
          text: '음성 채널에서 "구인구직 연동하기" 버튼을 클릭하여 연결하세요.',
          iconURL: recruitmentData.author.displayAvatarURL()
        })
        .setTimestamp();

      // 태그가 있으면 설명 필드 위에 추가
      if (tagsText) {
        embed.spliceFields(0, 0, { name: '🏷️ 태그', value: tagsText, inline: false });
      }

      const thread = await forumChannel.threads.create({
        name: recruitmentData.title,
        message: {
          embeds: [embed]
        }
      });

      console.log(`독립 포럼 포스트 생성 완료: ${thread.name} (ID: ${thread.id})`);
      return thread.id;
    } catch (error) {
      console.error('독립 포럼 포스트 생성 오류:', error);
      return null;
    }
  }

  /**
   * 음성 채널 이름 실시간 업데이트
   * @param {string} postId - 포스트 ID
   * @param {string} newChannelName - 새로운 채널 이름
   * @param {string} channelId - 채널 ID
   * @param {string} guildId - 길드 ID
   */
  async updateVoiceChannelLink(postId, newChannelName, channelId, guildId) {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread() || thread.archived) {
        return;
      }

      // 스레드의 첫 번째 메시지 (임베드) 가져오기
      const messages = await thread.messages.fetch({ limit: 1 });
      const firstMessage = messages.first();
      
      if (!firstMessage || !firstMessage.embeds.length) {
        return;
      }

      const embed = EmbedBuilder.from(firstMessage.embeds[0]);
      
      // 음성 채널 필드 찾아서 업데이트
      const fieldIndex = embed.data.fields?.findIndex(field => 
        field.name === '🔊 음성 채널'
      );

      if (fieldIndex !== -1) {
        embed.data.fields[fieldIndex].value = `[${newChannelName} 참여하기](https://discord.com/channels/${guildId}/${channelId})`;
        
        await firstMessage.edit({ embeds: [embed] });
        console.log(`포럼 포스트 음성 채널 링크 업데이트: ${newChannelName} (ID: ${postId})`);
      }
    } catch (error) {
      console.error('음성 채널 링크 업데이트 오류:', error);
    }
  }

  /**
   * 모달 제출 처리
   * @param {ModalSubmitInteraction} interaction - 모달 제출 인터랙션
   */
  async handleModalSubmit(interaction) {
    try {
      // 독립적인 구인구직 모달 처리
      if (interaction.customId === 'standalone_recruitment_modal') {
        await this.handleStandaloneModalSubmit(interaction);
        return;
      }

      // 음성 채널 연동 모달 처리
      if (interaction.customId.startsWith('recruitment_modal_')) {
        await this.handleVoiceChannelModalSubmit(interaction);
        return;
      }
    } catch (error) {
      console.error('모달 제출 처리 오류:', error);
      await interaction.reply({
        content: '❌ 오류가 발생했습니다. 다시 시도해주세요.',
        ephemeral: true
      });
    }
  }

  /**
   * 독립적인 모달 제출 처리
   * @param {ModalSubmitInteraction} interaction - 모달 제출 인터랙션
   */
  async handleStandaloneModalSubmit(interaction) {
    // 모달 입력값 추출
    const title = interaction.fields.getTextInputValue('recruitment_title');
    const tags = interaction.fields.getTextInputValue('recruitment_tags') || '';
    const description = interaction.fields.getTextInputValue('recruitment_description') || '설명 없음';

    // 독립적인 포럼 포스트 생성
    const postId = await this.createStandaloneForumPost({
      title,
      tags,
      description,
      author: interaction.user
    });

    if (postId) {
      await interaction.reply({
        content: `✅ 구인구직 포럼이 성공적으로 생성되었습니다!\n🔗 포럼: <#${postId}>\n\n💡 음성 채널에서 "구인구직 연동하기" 버튼을 클릭하여 이 포럼과 연결할 수 있습니다.`,
        ephemeral: true
      });
    } else {
      await interaction.reply({
        content: '❌ 포럼 포스트 생성에 실패했습니다. 다시 시도해주세요.',
        ephemeral: true
      });
    }
  }

  /**
   * 음성 채널 연동 모달 제출 처리
   * @param {ModalSubmitInteraction} interaction - 모달 제출 인터랙션
   */
  async handleVoiceChannelModalSubmit(interaction) {
    const voiceChannelId = interaction.customId.split('_')[2];
    const voiceChannel = await this.client.channels.fetch(voiceChannelId);

    if (!voiceChannel) {
      await interaction.reply({
        content: '❌ 음성 채널을 찾을 수 없습니다.',
        ephemeral: true
      });
      return;
    }

    // 모달 입력값 추출
    const title = interaction.fields.getTextInputValue('recruitment_title');
    const tags = interaction.fields.getTextInputValue('recruitment_tags') || '';
    const description = interaction.fields.getTextInputValue('recruitment_description') || '설명 없음';

    // 포럼 채널에서 포스트 생성
    const postId = await this.createForumPost(voiceChannel, {
      title,
      tags,
      description,
      author: interaction.user
    });

    if (postId) {
      // 채널-포스트 매핑 저장
      this.channelPostMap.set(voiceChannelId, postId);

      await interaction.reply({
        content: `✅ 구인구직이 성공적으로 등록되었습니다!\n🔗 포럼: <#${postId}>`,
        ephemeral: true
      });
    } else {
      await interaction.reply({
        content: '❌ 포럼 포스트 생성에 실패했습니다. 다시 시도해주세요.',
        ephemeral: true
      });
    }
  }

  /**
   * 태그를 역할 멘션으로 변환
   * @param {string} tags - 쉼표로 구분된 태그 문자열
   * @param {Guild} guild - 디스코드 길드 객체
   * @returns {string} - 변환된 역할 멘션 문자열
   */
  async convertTagsToRoleMentions(tags, guild) {
    if (!tags || !tags.trim()) {
      return '';
    }

    const tagArray = tags.split(',').map(tag => tag.trim());
    const roleMentions = [];

    for (const tag of tagArray) {
      // 길드에서 태그와 일치하는 역할 찾기 (대소문자 구분 안함)
      const role = guild.roles.cache.find(r => 
        r.name.toLowerCase() === tag.toLowerCase()
      );

      if (role) {
        roleMentions.push(`<@&${role.id}>`);
      } else {
        // 역할이 없으면 그냥 텍스트로 표시
        roleMentions.push(`@${tag}`);
      }
    }

    return roleMentions.join(', ');
  }

  /**
   * 포럼 채널에 포스트 생성
   * @param {VoiceChannel} voiceChannel - 음성 채널
   * @param {Object} recruitmentData - 구인구직 데이터
   * @returns {string|null} - 생성된 포스트 ID 또는 null
   */
  async createForumPost(voiceChannel, recruitmentData) {
    try {
      const forumChannel = await this.client.channels.fetch(this.forumChannelId);
      
      if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
        console.error('포럼 채널을 찾을 수 없거나 올바른 포럼 채널이 아닙니다.');
        return null;
      }

      // 태그를 역할 멘션으로 변환
      const roleMentions = await this.convertTagsToRoleMentions(recruitmentData.tags, voiceChannel.guild);
      const tagsText = roleMentions ? roleMentions : '';

      const embed = new EmbedBuilder()
        .setTitle(`🎮 ${recruitmentData.title}`)
        .addFields(
          { name: '📝 상세 설명', value: recruitmentData.description, inline: false },
          { name: '🔊 음성 채널', value: `[${voiceChannel.name} 참여하기](https://discord.com/channels/${voiceChannel.guild.id}/${voiceChannel.id})`, inline: false },
          { name: '👤 모집자', value: `<@${recruitmentData.author.id}>`, inline: true },
          { name: '⏰ 등록 시간', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
        )
        .setColor(0x00FF00)
        .setFooter({ 
          text: '음성 채널이 삭제되면 이 포스트는 자동으로 아카이브됩니다.',
          iconURL: recruitmentData.author.displayAvatarURL()
        })
        .setTimestamp();

      // 태그가 있으면 설명 필드 위에 추가
      if (tagsText) {
        embed.spliceFields(0, 0, { name: '🏷️ 태그', value: tagsText, inline: false });
      }

      const thread = await forumChannel.threads.create({
        name: recruitmentData.title,
        message: {
          embeds: [embed]
        }
      });

      console.log(`포럼 포스트 생성 완료: ${thread.name} (ID: ${thread.id})`);
      return thread.id;
    } catch (error) {
      console.error('포럼 포스트 생성 오류:', error);
      return null;
    }
  }

  /**
   * 포럼 포스트 아카이브
   * @param {string} postId - 포스트 ID
   */
  async archiveForumPost(postId) {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread()) {
        console.error('스레드를 찾을 수 없습니다:', postId);
        return;
      }

      // 이미 아카이브되었거나 잠겨있는지 확인
      if (thread.archived) {
        console.log(`스레드가 이미 아카이브되어 있습니다: ${thread.name} (ID: ${postId})`);
        return;
      }

      // 아카이브 알림 메시지 전송 (스레드가 활성화되어 있을 때만)
      try {
        const archiveEmbed = new EmbedBuilder()
          .setTitle('📁 구인구직 종료')
          .setDescription('연결된 음성 채널이 삭제되어 이 구인구직이 자동으로 종료되었습니다.')
          .setColor(0xFF6B6B)
          .setTimestamp();

        await thread.send({ embeds: [archiveEmbed] });
      } catch (messageError) {
        console.warn('아카이브 메시지 전송 실패 (스레드가 이미 제한될 수 있음):', messageError.message);
      }

      // 스레드 아카이브 및 잠금
      try {
        if (!thread.archived) {
          await thread.setArchived(true);
        }
        if (!thread.locked) {
          await thread.setLocked(true);
        }
        console.log(`포럼 포스트 아카이브 완료: ${thread.name} (ID: ${postId})`);
      } catch (archiveError) {
        // 이미 아카이브된 경우의 에러는 무시
        if (archiveError.code === 50083) {
          console.log(`스레드가 이미 아카이브되어 있습니다: ${thread.name} (ID: ${postId})`);
        } else {
          console.error('스레드 아카이브 실패:', archiveError.message);
        }
      }
    } catch (error) {
      console.error('포럼 포스트 아카이브 처리 오류:', error.message);
    }
  }

  /**
   * 인터랙션 처리 (버튼, 드롭다운, 모달 통합)
   * @param {Interaction} interaction - 인터랙션 객체
   */
  async handleInteraction(interaction) {
    try {
      if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction);
      } else if (interaction.isStringSelectMenu()) {
        await this.handleSelectMenuInteraction(interaction);
      } else if (interaction.isModalSubmit()) {
        await this.handleModalSubmit(interaction);
      }
    } catch (error) {
      console.error('인터랙션 처리 오류:', error);
    }
  }
}