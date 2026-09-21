import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { DiscordConstants } from '../../config/DiscordConstants.js';
import { RecruitmentConfig } from '../../config/RecruitmentConfig.js';
import { TextProcessor } from '../../utils/TextProcessor.js';

export class ForumPostBuilders {
  constructor(deps) {
    this.client = deps.client;
    this.forumChannelId = deps.forumChannelId;
    this.forumTagId = deps.forumTagId;
    this.databaseManager = deps.databaseManager;
    this.parent = deps.parent;
  }

  generatePostTitle(recruitmentData) {
    // 서버 멤버 객체면 서버 닉네임 사용, 아니면 전역명 사용
    const displayName = recruitmentData.author.displayName || recruitmentData.author.username;
    const cleanedNickname = TextProcessor.cleanNickname(displayName);
    return `[${cleanedNickname}] ${recruitmentData.title}`;
  }

  async createPostEmbed(recruitmentData, voiceChannelId = null, specialType = null) {
    // 특수 타입 뱃지 추가
    const titlePrefix = specialType ? `[${specialType}] ` : '';
    let content = `# 🎮 ${titlePrefix}${recruitmentData.title}\n\n`;

    // embed에 역할 멘션 표시
    if (recruitmentData.tags) {
      const guild = this.client.guilds.cache.first();
      const roleMentions = await TextProcessor.convertTagsToRoleMentions(recruitmentData.tags, guild);
      content += `## 🏷️ 태그\n${roleMentions}\n\n`;
    }

    content += `## 📝 상세 설명\n${recruitmentData.description}\n\n`;

    // 미리 모인 멤버가 있으면 임베드에 표시
    if (recruitmentData.preMemberIds && recruitmentData.preMemberIds.length > 0) {
      const preMemberMentions = recruitmentData.preMemberIds.map(id => `<@${id}>`).join(' ');
      content += `## 👥 미리 모인 멤버\n${preMemberMentions}\n\n`;
    }

    content += `## 👤 모집자\n<@${recruitmentData.author.id}>`;

    const embed = new EmbedBuilder()
      .setDescription(content)
      // 특수 포스트는 Orange 색상으로 구분
      .setColor(specialType ? RecruitmentConfig.COLORS.STANDALONE_POST :
                (voiceChannelId ? RecruitmentConfig.COLORS.SUCCESS : RecruitmentConfig.COLORS.STANDALONE_POST))
      .setFooter({
        text: voiceChannelId ? '음성 채널과 연동된 구인구직입니다.' : '음성 채널에서 "구인구직 연동하기" 버튼을 클릭하여 연결하세요.',
        iconURL: recruitmentData.author.displayAvatarURL()
      });

    return embed;
  }

  createVoiceChannelButtons(voiceChannelId) {
    // 닫기 버튼 비활성화 (임시)
    // const closeButton = new ButtonBuilder()
    //   .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_CLOSE}${voiceChannelId}`)
    //   .setLabel(`${DiscordConstants.EMOJIS.CLOSE} 닫기`)
    //   .setStyle(ButtonStyle.Danger);

    const spectateButton = new ButtonBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_SPECTATE}${voiceChannelId}`)
      .setLabel(`${DiscordConstants.EMOJIS.SPECTATOR} 관전`)
      .setStyle(ButtonStyle.Secondary);

    const waitButton = new ButtonBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_WAIT}${voiceChannelId}`)
      .setLabel('⏳ 대기')
      .setStyle(ButtonStyle.Success);

    const resetButton = new ButtonBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_RESET}${voiceChannelId}`)
      .setLabel(`${DiscordConstants.EMOJIS.RESET} 초기화`)
      .setStyle(ButtonStyle.Primary);

    const deleteButton = new ButtonBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_DELETE}${voiceChannelId}`)
      .setLabel(`${DiscordConstants.EMOJIS.CLOSE} 닫기`)
      .setStyle(ButtonStyle.Danger);

    return new ActionRowBuilder().addComponents(spectateButton, waitButton, resetButton, deleteButton);
  }

  createGeneralNicknameButtons() {
    // 닫기 버튼 비활성화 (임시)
    // const closeButton = new ButtonBuilder()
    //   .setCustomId('general_close')
    //   .setLabel(`${DiscordConstants.EMOJIS.CLOSE} 닫기`)
    //   .setStyle(ButtonStyle.Danger);

    const spectateButton = new ButtonBuilder()
      .setCustomId('general_spectate')
      .setLabel(`${DiscordConstants.EMOJIS.SPECTATOR} 관전`)
      .setStyle(ButtonStyle.Secondary);

    const waitButton = new ButtonBuilder()
      .setCustomId('general_wait')
      .setLabel('⏳ 대기')
      .setStyle(ButtonStyle.Success);

    const resetButton = new ButtonBuilder()
      .setCustomId('general_reset')
      .setLabel(`${DiscordConstants.EMOJIS.RESET} 초기화`)
      .setStyle(ButtonStyle.Primary);

    const deleteButton = new ButtonBuilder()
      .setCustomId('general_delete')
      .setLabel(`${DiscordConstants.EMOJIS.CLOSE} 닫기`)
      .setStyle(ButtonStyle.Danger);

    return new ActionRowBuilder().addComponents(spectateButton, waitButton, resetButton, deleteButton);
  }

  createParticipationButtons(threadId) {
    const joinButton = new ButtonBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_JOIN}${threadId}`)
      .setLabel('참가하기')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('👥');

    const leaveButton = new ButtonBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_LEAVE}${threadId}`)
      .setLabel('참가 취소')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('👋');

    // 대기하기 버튼: 참가 불가 시 대기자 명단에 등록 (토글)
    const waitButton = new ButtonBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_WAIT}${threadId}`)
      .setLabel('대기하기')
      .setStyle(ButtonStyle.Success)
      .setEmoji('⏳');

    return new ActionRowBuilder().addComponents(joinButton, leaveButton, waitButton);
  }

  createRecruiterButtons(threadId, recruiterId = 'temp', includeClose = true) {
    // customId 형식: forum_edit_premembers_{threadId}_{recruiterId}
    const editMembersButton = new ButtonBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_EDIT_PREMEMBERS}${threadId}_${recruiterId}`)
      .setLabel('멤버 수정')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✏️');

    if (!includeClose) {
      return new ActionRowBuilder().addComponents(editMembersButton);
    }

    const closeButton = new ButtonBuilder()
      .setCustomId('general_delete')
      .setLabel(`${DiscordConstants.EMOJIS.CLOSE} 구직 닫기`)
      .setStyle(ButtonStyle.Danger);

    return new ActionRowBuilder().addComponents(editMembersButton, closeButton);
  }

  createMentionButton(threadId) {
    const mentionButton = new ButtonBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_MENTION}${threadId}`)
      .setLabel('참가자 멘션')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📢');

    return new ActionRowBuilder().addComponents(mentionButton);
  }
}
