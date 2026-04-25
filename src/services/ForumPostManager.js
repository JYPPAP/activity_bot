// src/services/ForumPostManager.js - 포럼 포스트 관리
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { DiscordConstants } from '../config/DiscordConstants.js';
import { RecruitmentConfig } from '../config/RecruitmentConfig.js';
import { TextProcessor } from '../utils/TextProcessor.js';
import { formatParticipantList, formatParticipantChangeMessage, formatWaitlist } from '../utils/formatters.js';

export class ForumPostManager {
  constructor(client, forumChannelId, forumTagId, databaseManager = null) {
    this.client = client;
    this.forumChannelId = forumChannelId;
    this.forumTagId = forumTagId;
    this.databaseManager = databaseManager;
  }
  
  /**
   * 포럼 포스트 생성
   * @param {Object} recruitmentData - 구인구직 데이터
   * @param {string} voiceChannelId - 음성 채널 ID (선택사항)
   * @param {string} specialType - 특수 구인구직 타입 (선택사항: '내전', '장기')
   * @returns {Promise<{success: boolean, postId?: string, error?: string}>} - 생성 결과
   */
  async createForumPost(recruitmentData, voiceChannelId = null, specialType = null) {
    try {
      const forumChannel = await this.client.channels.fetch(this.forumChannelId);
      
      if (!forumChannel || forumChannel.type !== DiscordConstants.CHANNEL_TYPES.GUILD_FORUM) {
        console.error('[ForumPostManager] 포럼 채널을 찾을 수 없거나 올바른 포럼 채널이 아닙니다.');
        return { success: false, error: '포럼 채널을 찾을 수 없습니다' };
      }
      
      const embed = await this.createPostEmbed(recruitmentData, voiceChannelId, specialType);
      const title = this.generatePostTitle(recruitmentData);
      
      // 역할 멘션 생성 및 역할 ID 추출
      let roleMentions = '';
      let roleIds = [];
      if (recruitmentData.tags) {
        const guild = forumChannel.guild;
        roleMentions = await TextProcessor.convertTagsToRoleMentions(recruitmentData.tags, guild);
        
        const roleMatches = roleMentions.match(/<@&(\d+)>/g);
        if (roleMatches) {
          roleIds = roleMatches.map(match => match.match(/\d+/)[0]);
        }
      }
      
      // 버튼 구성
      let components = [];

      // 첫 번째 행: 음성채널 버튼 또는 일반 버튼
      if (voiceChannelId) {
        // 음성 채널 연동된 경우: 음성 채널 버튼 사용
        const voiceChannelButtons = this.createVoiceChannelButtons(voiceChannelId);
        components.push(voiceChannelButtons);
      } else {
        // 독립 포럼 포스트: 범용 별명 변경 버튼 사용
        const generalButtons = this.createGeneralNicknameButtons();
        components.push(generalButtons);
      }

      // 두 번째 행: 모든 경우에 참가 버튼 추가 (모집자 ID 포함)
      const participationButtons = this.createParticipationButtons('temp', recruitmentData.author.id);
      components.push(participationButtons);
      
      const messageOptions = {
        content: roleMentions && roleIds.length > 0 ? roleMentions : undefined,  // 역할 멘션만
        embeds: [embed],
        components: components,
        allowedMentions: {
          roles: roleIds
        }
      };

      // 포럼 채널의 첫 번째 태그 사용 (태그가 필수인 경우 대비)
      const appliedTags = forumChannel.availableTags && forumChannel.availableTags.length > 0
        ? [forumChannel.availableTags[0].id]
        : [];

      const thread = await forumChannel.threads.create({
        name: title,
        appliedTags: appliedTags,
        message: messageOptions,
        autoArchiveDuration: 1440
      });

      // 참가 버튼들의 customId를 실제 threadId로 업데이트 (모든 포스트)
      try {
        const starterMessage = await thread.fetchStarterMessage();
        const updatedComponents = starterMessage.components.map((row, index) => {
          if (index === 1) { // 두 번째 행 (참가 버튼들)
            const buttons = row.components.map(button => {
              const isJoinButton = button.customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_JOIN);
              const isLeaveButton = button.customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_LEAVE);
              const isWaitButton = button.customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_WAIT);
              const isEditButton = button.customId.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_EDIT_PREMEMBERS);

              if (isJoinButton) {
                return ButtonBuilder.from(button).setCustomId(
                  `${DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_JOIN}${thread.id}`
                );
              } else if (isLeaveButton) {
                return ButtonBuilder.from(button).setCustomId(
                  `${DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_LEAVE}${thread.id}`
                );
              } else if (isWaitButton) {
                return ButtonBuilder.from(button).setCustomId(
                  `${DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_WAIT}${thread.id}`
                );
              } else if (isEditButton) {
                return ButtonBuilder.from(button).setCustomId(
                  `${DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_EDIT_PREMEMBERS}${thread.id}_${recruitmentData.author.id}`
                );
              }
              return ButtonBuilder.from(button);
            });
            return new ActionRowBuilder().addComponents(...buttons);
          }
          return ActionRowBuilder.from(row);
        });

        await starterMessage.edit({ components: updatedComponents });
        console.log(`[ForumPostManager] 참가 버튼들 customId 업데이트됨: ${thread.id}`);
      } catch (updateError) {
        console.error('[ForumPostManager] 참가 버튼 업데이트 실패:', updateError);
      }

      // 모집자를 스레드에 자동으로 추가
      try {
        await thread.members.add(recruitmentData.author.id);
        console.log(`[ForumPostManager] 모집자가 스레드에 추가됨: ${recruitmentData.author.displayName}`);
      } catch (addError) {
        console.warn('[ForumPostManager] 모집자를 스레드에 추가하는데 실패:', addError.message);
      }

      // 모집자 + 미리 모인 멤버 참가자 DB 자동 등록
      if (this.databaseManager) {
        try {
          // 모집자 자동 등록
          const recruiterName = TextProcessor.cleanNickname(
            recruitmentData.author.displayName || recruitmentData.author.username
          );
          await this.databaseManager.addParticipant(
            thread.id, recruitmentData.author.id, recruiterName
          );
          console.log(`[ForumPostManager] 모집자 참가자 자동 등록: ${recruiterName}`);

          // 미리 모인 멤버 자동 등록
          const preMemberIds = recruitmentData.preMemberIds || [];
          for (const userId of preMemberIds) {
            try {
              const member = await forumChannel.guild.members.fetch(userId);
              const memberName = TextProcessor.cleanNickname(
                member.displayName || member.user.username
              );
              await this.databaseManager.addParticipant(thread.id, userId, memberName);
              await thread.members.add(userId);
              console.log(`[ForumPostManager] 미리 모인 멤버 자동 등록: ${memberName}`);
            } catch (memberError) {
              console.warn(`[ForumPostManager] 미리 모인 멤버 추가 실패 (${userId}):`, memberError.message);
            }
          }

          // @name 형식으로 입력된 미리 모인 멤버 → guild.members.search()로 ID 해석
          const preMemberNames = recruitmentData.preMemberNames || [];
          console.log(`[ForumPostManager] @name 멤버 처리 시작: ${preMemberNames.length}명 [${preMemberNames.join(', ')}]`);
          for (const name of preMemberNames) {
            try {
              let matched = null;

              // 1차: Discord REST API 검색 (닉네임/username 기반)
              try {
                const searchResults = await forumChannel.guild.members.search({ query: name, limit: 10 });
                console.log(`[ForumPostManager] "${name}" API 검색 결과: ${searchResults.size}명`);

                // 정확히 일치하는 멤버 우선 탐색
                matched = searchResults.find(m => {
                  const cleanName = TextProcessor.cleanNickname(m.displayName || m.user.username);
                  const globalName = m.user.globalName || '';
                  return (
                    cleanName === name ||
                    m.user.username === name ||
                    globalName === name ||
                    TextProcessor.cleanNickname(globalName) === name
                  );
                }) ?? searchResults.first();
              } catch (apiErr) {
                console.warn(`[ForumPostManager] "${name}" API 검색 오류:`, apiErr.message);
              }

              // 2차 폴백: 캐시에서 검색 (글로벌 이름 / 부분 일치 포함)
              if (!matched) {
                console.log(`[ForumPostManager] "${name}" 캐시 폴백 검색 시도...`);
                matched = forumChannel.guild.members.cache.find(m => {
                  const cleanNick = TextProcessor.cleanNickname(m.displayName || m.user.username);
                  const globalName = m.user.globalName || '';
                  const cleanGlobal = TextProcessor.cleanNickname(globalName);
                  return (
                    cleanNick === name ||
                    m.user.username === name ||
                    globalName === name ||
                    cleanGlobal === name ||
                    cleanNick.includes(name) ||
                    cleanGlobal.includes(name)
                  );
                }) ?? null;
                if (matched) {
                  console.log(`[ForumPostManager] "${name}" 캐시에서 발견: ${matched.displayName} (${matched.id})`);
                }
              }

              if (matched && !preMemberIds.includes(matched.id)) {
                const memberName = TextProcessor.cleanNickname(matched.displayName || matched.user.username);
                await this.databaseManager.addParticipant(thread.id, matched.id, memberName);
                await thread.members.add(matched.id);
                preMemberIds.push(matched.id);
                console.log(`[ForumPostManager] @name 멤버 등록 성공: "${name}" → ${memberName} (${matched.id})`);
              } else if (!matched) {
                console.warn(`[ForumPostManager] @name으로 멤버를 찾을 수 없음: "${name}" (API+캐시 모두 실패)`);
              } else {
                console.log(`[ForumPostManager] "${name}" 이미 등록된 멤버 (${matched.id}), 스킵`);
              }
            } catch (nameSearchErr) {
              console.warn(`[ForumPostManager] @name 검색 실패 ("${name}"):`, nameSearchErr.message);
            }
          }

          // 미리 모인 멤버 멘션 메시지 전송 (핑 알림)
          if (preMemberIds.length > 0) {
            const mentions = preMemberIds.map(id => `<@${id}>`).join(' ');
            await thread.send({
              content: `📢 **미리 모인 멤버**: ${mentions}`,
              allowedMentions: { users: preMemberIds },
            });
          }

          // 초기 참가자 목록 메시지 전송 (모집자 + 미리 모인 멤버)
          const participantNicknames = await this.databaseManager.getParticipantNicknames(thread.id);
          const participantListMsg = formatParticipantList(participantNicknames);
          const maxCount = recruitmentData.maxParticipants ?? 'N';
          await thread.send(`${participantListMsg}\n-# (${participantNicknames.length}/${maxCount}명)`);
          console.log(`[ForumPostManager] 초기 참가자 목록 메시지 전송 완료: ${participantNicknames.length}명`);
        } catch (autoAddError) {
          console.warn('[ForumPostManager] 참가자 자동 등록 중 오류:', autoAddError.message);
        }
      }

      // 음성 채널이 있으면 별도 메시지로 네이티브 링크 추가
      if (voiceChannelId) {
        try {
          const voiceChannel = await this.client.channels.fetch(voiceChannelId);
          if (voiceChannel) {
            await thread.send(`🔊 **음성 채널**: https://discord.com/channels/${voiceChannel.guild.id}/${voiceChannelId}`);
            console.log(`[ForumPostManager] 음성 채널 링크 메시지 추가됨: ${voiceChannel.name}`);
          }
        } catch (linkError) {
          console.warn('[ForumPostManager] 음성 채널 링크 메시지 추가 실패:', linkError.message);
        }
      }
      
      // 참가 안내 메시지 추가
      try {
        const participationGuide = '**참가하기** 버튼을 눌러 참가하세요.';

        await thread.send(participationGuide);
        console.log(`[ForumPostManager] 참가 안내 메시지 추가됨: ${thread.name}`);
      } catch (guideError) {
        console.warn('[ForumPostManager] 참가 안내 메시지 추가 실패:', guideError.message);
      }
      
      // 독립형 포럼의 경우 데이터베이스에 매핑 정보 저장
      if (!voiceChannelId && this.databaseManager) {
        try {
          const mappingKey = `STANDALONE_${thread.id}`;
          await this.databaseManager.ensureForumMapping(
            mappingKey,       // voice_channel_id (STANDALONE_ prefix)
            thread.id,        // forum_post_id
            'standalone',     // forum_state
            true             // is_active
          );
          console.log(`[ForumPostManager] 독립형 포럼 매핑 저장 완료: ${mappingKey} -> ${thread.id}`);
        } catch (mappingError) {
          console.warn('[ForumPostManager] 독립형 포럼 매핑 저장 실패:', mappingError.message);
          // 매핑 실패해도 포럼 생성은 성공으로 처리
        }
      }

      console.log(`[ForumPostManager] 포럼 포스트 생성 완료: ${thread.name} (ID: ${thread.id})`);
      return { success: true, postId: thread.id };
      
    } catch (error) {
      console.error('[ForumPostManager] 포럼 포스트 생성 오류:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * 포럼 포스트 제목 생성
   * @param {Object} recruitmentData - 구인구직 데이터
   * @returns {string} - 생성된 제목
   */
  generatePostTitle(recruitmentData) {
    // 서버 멤버 객체면 서버 닉네임 사용, 아니면 전역명 사용
    const displayName = recruitmentData.author.displayName || recruitmentData.author.username;
    const cleanedNickname = TextProcessor.cleanNickname(displayName);
    return `[${cleanedNickname}] ${recruitmentData.title}`;
  }
  
  /**
   * 포럼 포스트 임베드 생성
   * @param {Object} recruitmentData - 구인구직 데이터
   * @param {string} voiceChannelId - 음성 채널 ID (선택사항)
   * @returns {Promise<EmbedBuilder>} - 생성된 임베드
   */
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
  
  /**
   * 음성 채널 상호작용 버튼 생성
   * @param {string} voiceChannelId - 음성 채널 ID
   * @returns {ActionRowBuilder} - 생성된 버튼 행
   */
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
  
  /**
   * 범용 별명 변경 버튼 생성 (채널 ID 없음)
   * @returns {ActionRowBuilder} - 생성된 버튼 행
   */
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

  /**
   * 참가 버튼들 생성 (독립 포럼용) - 참가하기 / 참가 취소 / 멤버 수정(모집자 전용) 3개 버튼
   * @param {string} threadId - 포럼 스레드 ID
   * @param {string} recruiterId - 모집자 Discord ID (멤버 수정 버튼에 인코딩)
   * @returns {ActionRowBuilder} 참가 버튼들을 포함한 ActionRow
   */
  createParticipationButtons(threadId, recruiterId = 'temp') {
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

    // 모집자 전용: 미리 모인 멤버 수정 버튼
    // customId 형식: forum_edit_premembers_{threadId}_{recruiterId}
    const editMembersButton = new ButtonBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_EDIT_PREMEMBERS}${threadId}_${recruiterId}`)
      .setLabel('멤버 수정')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✏️');

    return new ActionRowBuilder().addComponents(joinButton, leaveButton, waitButton, editMembersButton);
  }

  /**
   * 포럼 포스트에 참여자 수 업데이트 메시지 전송
   * @param {string} postId - 포스트 ID
   * @param {number} currentCount - 현재 참여자 수
   * @param {number|string} maxCount - 최대 참여자 수 (숫자 또는 'N'/'n')
   * @param {string} voiceChannelName - 음성 채널 이름
   * @returns {Promise<boolean>} - 성공 여부
   */
  async sendParticipantUpdateMessage(postId, currentCount, maxCount, voiceChannelName) {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread() || thread.archived) {
        console.warn(`[ForumPostManager] 스레드를 찾을 수 없거나 아카이브됨: ${postId}`);
        
        // 아카이브되거나 삭제된 스레드의 연동 정리
        await this._cleanupArchivedThread(postId);
        return false;
      }
      
      // 이전 참여자 수 메시지들 삭제
      await this._deleteTrackedMessages(postId, 'participant_count');
      
      const timeString = TextProcessor.formatKoreanTime();
      const updateMessage = `# 👥 현재 참여자: ${currentCount}/${maxCount}명\n**⏰ 업데이트**: ${timeString}`;
      
      const sentMessage = await thread.send(updateMessage);
      
      // 새 메시지 추적 저장
      await this._trackMessage(postId, 'participant_count', sentMessage.id);
      
      console.log(`[ForumPostManager] 참여자 수 업데이트 메시지 전송 완료: ${postId} (${currentCount}/${maxCount})`);
      return true;
      
    } catch (error) {
      console.error(`[ForumPostManager] 참여자 수 업데이트 메시지 전송 실패: ${postId}`, error);
      return false;
    }
  }
  
  /**
   * 포럼 포스트에 음성 채널 연동 메시지 전송
   * @param {string} postId - 포스트 ID
   * @param {string} voiceChannelName - 음성 채널 이름
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {string} guildId - 길드 ID
   * @param {string} linkerId - 연동한 사용자 ID
   * @returns {Promise<boolean>} - 성공 여부
   */
  async sendVoiceChannelLinkMessage(postId, voiceChannelName, voiceChannelId, guildId, linkerId) {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread() || thread.archived) {
        console.warn(`[ForumPostManager] 스레드를 찾을 수 없거나 아카이브됨: ${postId}`);
        
        // 아카이브되거나 삭제된 스레드의 연동 정리
        await this._cleanupArchivedThread(postId);
        return false;
      }
      
      const linkEmbed = new EmbedBuilder()
        .setTitle('🔊 음성 채널 연동')
        .setDescription('새로운 음성 채널이 이 구인구직에 연동되었습니다!')
        .addFields(
          { name: '👤 연동자', value: `<@${linkerId}>`, inline: true }
        )
        .setColor(RecruitmentConfig.COLORS.SUCCESS)
        .setTimestamp();
      
      // Embed와 별도로 네이티브 채널 링크 전송
      await thread.send({ embeds: [linkEmbed] });
      await thread.send(`🔊 **음성 채널**: https://discord.com/channels/${guildId}/${voiceChannelId}`);
      console.log(`[ForumPostManager] 음성 채널 연동 메시지 전송 완료: ${postId}`);
      return true;
      
    } catch (error) {
      console.error(`[ForumPostManager] 음성 채널 연동 메시지 전송 실패: ${postId}`, error);
      return false;
    }
  }
  
  /**
   * 기존 포럼 포스트 목록 가져오기
   * @param {number} limit - 가져올 포스트 수 (기본값: 10)
   * @returns {Promise<Array>} - 포스트 목록
   */
  async getExistingPosts(limit = 10) {
    try {
      const forumChannel = await this.client.channels.fetch(this.forumChannelId);
      
      if (!forumChannel || forumChannel.type !== DiscordConstants.CHANNEL_TYPES.GUILD_FORUM) {
        console.error('[ForumPostManager] 포럼 채널을 찾을 수 없습니다.');
        return [];
      }
      
      // 활성 스레드 가져오기
      const threads = await forumChannel.threads.fetchActive();
      const recentPosts = Array.from(threads.threads.values())
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
        .slice(0, limit);
      
      return recentPosts.map(thread => ({
        id: thread.id,
        name: thread.name,
        messageCount: thread.messageCount,
        memberCount: thread.memberCount,
        createdAt: thread.createdAt,
        lastMessageId: thread.lastMessageId
      }));
      
    } catch (error) {
      console.error('[ForumPostManager] 기존 포스트 목록 가져오기 실패:', error);
      return [];
    }
  }
  
  /**
   * 사용자 별명 기반으로 필터링된 기존 포럼 포스트 목록 가져오기
   * @param {number} limit - 가져올 포스트 수 (기본값: 15)
   * @param {string} userDisplayName - 필터링할 사용자 별명
   * @returns {Promise<Array>} - 필터링된 포스트 목록
   */
  async getExistingPostsFilteredByUser(limit = 15, userDisplayName = null) {
    try {
      // 전체 포스트 목록 가져오기 (더 많이 가져와서 필터링 후 부족할 경우 대비)
      const allPosts = await this.getExistingPosts(limit * 2);
      
      if (!userDisplayName || allPosts.length === 0) {
        return allPosts.slice(0, limit);
      }
      
      // 사용자 별명에서 태그 제거
      const cleanedUserName = TextProcessor.cleanNickname(userDisplayName);
      
      // 포스트를 두 그룹으로 나누기: 사용자 포스트와 다른 사용자 포스트
      const userPosts = [];
      const otherPosts = [];
      
      for (const post of allPosts) {
        // 포스트 제목에서 소유자 이름 추출
        const ownerName = TextProcessor.extractOwnerFromTitle(post.name);
        
        if (ownerName) {
          // 소유자 이름 정리 (태그 제거)
          const cleanedOwnerName = TextProcessor.cleanNickname(ownerName);
          
          // 대소문자 구분 없이 비교
          if (cleanedOwnerName.toLowerCase() === cleanedUserName.toLowerCase()) {
            userPosts.push(post);
          } else {
            otherPosts.push(post);
          }
        } else {
          // 소유자 이름을 추출할 수 없는 경우 다른 포스트로 분류
          otherPosts.push(post);
        }
      }
      
      // 사용자 포스트를 먼저 넣고, 부족한 만큼 다른 포스트로 채움
      const filteredPosts = [...userPosts];
      const remainingSlots = limit - userPosts.length;
      
      if (remainingSlots > 0) {
        filteredPosts.push(...otherPosts.slice(0, remainingSlots));
      }
      
      console.log(`[ForumPostManager] 필터링된 포스트 목록: 총 ${filteredPosts.length}개 (사용자: ${userPosts.length}개, 다른 사용자: ${Math.min(remainingSlots, otherPosts.length)}개)`);
      
      return filteredPosts.slice(0, limit);
      
    } catch (error) {
      console.error('[ForumPostManager] 필터링된 포스트 목록 가져오기 실패:', error);
      // 오류 발생 시 일반 메서드로 fallback
      return await this.getExistingPosts(limit);
    }
  }
  
  /**
   * 포럼 포스트 아카이브 처리
   * @param {string} postId - 포스트 ID
   * @param {string} reason - 아카이브 사유
   * @param {boolean} lockThread - 스레드 잠금 여부 (기본값: true)
   * @returns {Promise<boolean>} - 성공 여부
   */
  async archivePost(postId, reason = '음성 채널 삭제됨', lockThread = true) {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread()) {
        console.warn(`[ForumPostManager] 스레드를 찾을 수 없음: ${postId}`);
        return false;
      }
      
      if (thread.archived) {
        console.log(`[ForumPostManager] 이미 아카이브된 스레드: ${postId}`);
        return true;
      }
      
      // 아카이브 메시지 전송
      const archiveEmbed = new EmbedBuilder()
        .setTitle('🔒 구인구직 종료')
        .setDescription(`이 구인구직이 자동으로 종료되었습니다.\n**사유**: ${reason}\n\n${lockThread ? '📝 이 포스트는 잠금 처리되어 더 이상 메시지를 작성할 수 없습니다.' : ''}`)
        .setColor(RecruitmentConfig.COLORS.WARNING)
        .setTimestamp();
      
      await thread.send({ embeds: [archiveEmbed] });
      
      // 스레드 잠금 (옵션)
      if (lockThread && !thread.locked) {
        try {
          await thread.setLocked(true, reason);
          console.log(`[ForumPostManager] 스레드 잠금 완료: ${postId}`);
        } catch (lockError) {
          console.error(`[ForumPostManager] 스레드 잠금 실패: ${postId}`, lockError);
          // 잠금 실패해도 아카이브는 계속 진행
        }
      }
      
      // 스레드 아카이브
      await thread.setArchived(true, reason);
      
      console.log(`[ForumPostManager] 포럼 포스트 아카이브 완료: ${postId} (${reason})`);
      return true;
      
    } catch (error) {
      console.error(`[ForumPostManager] 포럼 포스트 아카이브 실패: ${postId}`, error);
      return false;
    }
  }
  
  /**
   * 포럼 포스트 존재 여부 확인
   * @param {string} postId - 포스트 ID
   * @returns {Promise<boolean>} - 존재 여부
   */
  async postExists(postId) {
    try {
      const thread = await this.client.channels.fetch(postId);
      return thread && thread.isThread() && !thread.archived;
    } catch (error) {
      if (error.code === 10003) { // Unknown Channel
        return false;
      }
      console.error(`[ForumPostManager] 포스트 존재 확인 실패: ${postId}`, error);
      return false;
    }
  }
  
  /**
   * 포럼 포스트 정보 가져오기
   * @param {string} postId - 포스트 ID
   * @returns {Promise<Object|null>} - 포스트 정보
   */
  async getPostInfo(postId) {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread()) {
        return null;
      }
      
      return {
        id: thread.id,
        name: thread.name,
        archived: thread.archived,
        messageCount: thread.messageCount,
        memberCount: thread.memberCount,
        createdAt: thread.createdAt,
        lastMessageId: thread.lastMessageId,
        ownerId: thread.ownerId
      };
      
    } catch (error) {
      console.error(`[ForumPostManager] 포스트 정보 가져오기 실패: ${postId}`, error);
      return null;
    }
  }

  /**
   * 포럼 포스트에 참가자 목록 메시지 전송
   * @param {string} postId - 포스트 ID
   * @param {Array<string>} participants - 참가자 닉네임 배열
   * @returns {Promise<boolean>} - 성공 여부
   */
  async sendParticipantList(postId, participants) {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread()) {
        console.warn(`[ForumPostManager] 스레드를 찾을 수 없음: ${postId}`);
        return false;
      }
      
      if (thread.archived) {
        console.warn(`[ForumPostManager] 아카이브된 스레드: ${postId}`);
        return false;
      }
      
      // 참가자 목록 포맷팅
      const participantListText = formatParticipantList(participants);
      
      // 메시지 전송
      await thread.send(participantListText);
      
      console.log(`[ForumPostManager] 참가자 목록 메시지 전송 완료: ${postId} (${participants.length}명)`);
      return true;
      
    } catch (error) {
      console.error(`[ForumPostManager] 참가자 목록 메시지 전송 실패: ${postId}`, error);
      return false;
    }
  }

  /**
   * 포럼 포스트에 참가자 수 업데이트 메시지 전송 (이모지 반응 기반)
   * @param {string} postId - 포스트 ID
   * @param {Array<string>} participants - 참가자 닉네임 배열
   * @param {string} emojiName - 이모지 이름 (기본값: '참가')
   * @returns {Promise<boolean>} - 성공 여부
   */
  async sendEmojiParticipantUpdate(postId, participants, emojiName = '참가') {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread()) {
        console.warn(`[ForumPostManager] 스레드를 찾을 수 없음: ${postId}`);
        return false;
      }
      
      if (thread.archived) {
        console.warn(`[ForumPostManager] 아카이브된 스레드: ${postId}`);
        return false;
      }
      
      // 이전 이모지 반응 메시지들 삭제
      await this._deleteTrackedMessages(postId, 'emoji_reaction');

      const timeString = TextProcessor.formatKoreanTime();
      const participantListText = formatParticipantList(participants);
      const updateMessage = `${participantListText}\n**⏰ 업데이트**: ${timeString}`;
      
      const sentMessage = await thread.send(updateMessage);
      
      // 새 메시지 추적 저장
      await this._trackMessage(postId, 'emoji_reaction', sentMessage.id);
      
      console.log(`[ForumPostManager] 이모지 참가자 현황 업데이트 완료: ${postId} (${participants.length}명)`);
      return true;
      
    } catch (error) {
      console.error(`[ForumPostManager] 이모지 참가자 현황 업데이트 실패: ${postId}`, error);
      return false;
    }
  }

  /**
   * 대기자 목록 메시지 전송/갱신 (추적 메시지로 관리)
   * @param {string} postId - 포럼 스레드 ID
   * @param {Array<string>} waitlist - 대기자 닉네임 배열
   * @returns {Promise<boolean>}
   */
  async sendWaitlistUpdate(postId, waitlist = []) {
    try {
      const thread = await this.client.channels.fetch(postId);

      if (!thread || !thread.isThread() || thread.archived) {
        console.warn(`[ForumPostManager] 대기자 업데이트 불가 — 스레드 없음/아카이브: ${postId}`);
        return false;
      }

      // 기존 대기자 메시지 삭제
      await this._deleteTrackedMessages(postId, 'waitlist');

      // 대기자가 없으면 메시지 삭제만 하고 종료
      const text = formatWaitlist(waitlist);
      if (!text) {
        console.log(`[ForumPostManager] 대기자 없음 — 메시지 삭제 완료: ${postId}`);
        return true;
      }

      const sentMessage = await thread.send(text);
      await this._trackMessage(postId, 'waitlist', sentMessage.id);

      console.log(`[ForumPostManager] 대기자 목록 업데이트 완료: ${postId} (${waitlist.length}명)`);
      return true;
    } catch (error) {
      console.error(`[ForumPostManager] 대기자 목록 업데이트 실패: ${postId}`, error);
      return false;
    }
  }

  // ======== 프라이빗 메서드: 메시지 추적 및 삭제 ========

  /**
   * 추적된 메시지들 삭제
   * @param {string} threadId - 스레드 ID
   * @param {string} messageType - 메시지 타입
   * @returns {Promise<boolean>} - 성공 여부
   * @private
   */
  async _deleteTrackedMessages(threadId, messageType) {
    if (!this.databaseManager) {
      console.warn('[ForumPostManager] DatabaseManager가 설정되지 않음');
      return false;
    }

    // 데이터베이스 초기화 상태 확인
    if (!this.databaseManager.isInitialized) {
      console.warn('[ForumPostManager] 데이터베이스가 초기화되지 않음');
      return false;
    }

    try {
      // 데이터베이스에서 추적된 메시지 ID들 가져오기
      const messageIds = await this.databaseManager.getTrackedMessages(threadId, messageType);
      
      if (messageIds.length === 0) {
        console.log(`[ForumPostManager] 삭제할 메시지가 없음: ${threadId}, ${messageType}`);
        return true; // 삭제할 메시지가 없음
      }

      // 스레드 가져오기 (재시도 로직 포함)
      let thread = null;
      for (let retry = 0; retry < 3; retry++) {
        try {
          thread = await this.client.channels.fetch(threadId);
          if (thread && thread.isThread()) {
            break;
          }
        } catch (fetchError) {
          if (fetchError.code === 10003) { // Unknown Channel
            console.warn(`[ForumPostManager] 스레드가 삭제됨: ${threadId}`);
            // 스레드가 삭제된 경우 추적 정보만 정리
            await this.databaseManager.clearTrackedMessages(threadId, messageType);
            return true;
          }
          
          if (retry === 2) throw fetchError;
          console.warn(`[ForumPostManager] 스레드 가져오기 재시도 ${retry + 1}/3: ${threadId}`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기
        }
      }

      if (!thread || !thread.isThread()) {
        console.warn(`[ForumPostManager] 유효하지 않은 스레드: ${threadId}`);
        // 유효하지 않은 스레드의 경우 추적 정보만 정리
        await this.databaseManager.clearTrackedMessages(threadId, messageType);
        return false;
      }

      let deletedCount = 0;
      let failedIds = [];
      
      // 각 메시지 삭제 시도 (배치 처리)
      const deletePromises = messageIds.map(async (messageId) => {
        try {
          const message = await thread.messages.fetch(messageId);
          if (message) {
            await message.delete();
            deletedCount++;
            console.log(`[ForumPostManager] 메시지 삭제 완료: ${messageId}`);
            return { success: true, messageId };
          }
        } catch (deleteError) {
          if (deleteError.code === 10008) { // Unknown Message
            console.log(`[ForumPostManager] 메시지가 이미 삭제됨: ${messageId}`);
            return { success: true, messageId }; // 이미 삭제된 것으로 간주
          } else {
            console.warn(`[ForumPostManager] 메시지 삭제 실패: ${messageId}`, deleteError.message);
            failedIds.push(messageId);
            return { success: false, messageId, error: deleteError.message };
          }
        }
      });

      // 모든 삭제 작업 완료 대기 (최대 10초)
      try {
        await Promise.allSettled(deletePromises);
      } catch (error) {
        console.error(`[ForumPostManager] 메시지 삭제 배치 처리 오류: ${threadId}`, error);
      }

      // 데이터베이스에서 추적 정보 삭제 (실패한 메시지가 있어도 진행)
      try {
        await this.databaseManager.clearTrackedMessages(threadId, messageType);
        console.log(`[ForumPostManager] 추적 정보 정리 완료: ${threadId}, ${messageType}`);
      } catch (clearError) {
        console.error(`[ForumPostManager] 추적 정보 정리 실패: ${threadId}, ${messageType}`, clearError);
        // 추적 정보 정리 실패해도 계속 진행
      }
      
      if (failedIds.length > 0) {
        console.warn(`[ForumPostManager] 일부 메시지 삭제 실패: ${threadId}, ${messageType}, 실패 ${failedIds.length}개: ${failedIds.join(', ')}`);
      }
      
      console.log(`[ForumPostManager] 추적된 메시지 삭제 완료: ${threadId}, ${messageType}, 성공 ${deletedCount}/${messageIds.length}개`);
      return failedIds.length === 0; // 모든 메시지가 성공적으로 삭제된 경우에만 true

    } catch (error) {
      console.error(`[ForumPostManager] 추적된 메시지 삭제 오류: ${threadId}, ${messageType}`, error);
      
      // 심각한 오류 발생 시에도 추적 정보는 정리 시도
      try {
        await this.databaseManager.clearTrackedMessages(threadId, messageType);
        console.log(`[ForumPostManager] 오류 발생 후 추적 정보 정리 완료: ${threadId}, ${messageType}`);
      } catch (clearError) {
        console.error(`[ForumPostManager] 오류 발생 후 추적 정보 정리 실패: ${threadId}, ${messageType}`, clearError);
      }
      
      return false;
    }
  }

  /**
   * 메시지 추적 저장
   * @param {string} threadId - 스레드 ID
   * @param {string} messageType - 메시지 타입
   * @param {string} messageId - 메시지 ID
   * @returns {Promise<boolean>} - 성공 여부
   * @private
   */
  async _trackMessage(threadId, messageType, messageId) {
    if (!this.databaseManager) {
      console.warn('[ForumPostManager] DatabaseManager가 설정되지 않음');
      return false;
    }

    try {
      await this.databaseManager.trackForumMessage(threadId, messageType, messageId);
      console.log(`[ForumPostManager] 메시지 추적 저장: ${threadId}, ${messageType}, ${messageId}`);
      return true;
    } catch (error) {
      console.error(`[ForumPostManager] 메시지 추적 저장 오류: ${threadId}, ${messageType}, ${messageId}`, error);
      return false;
    }
  }

  /**
   * 참가자 변화 알림 메시지를 전송합니다.
   * @param {string} postId - 포스트 ID
   * @param {Array<string>} joinedUsers - 참가한 사용자 닉네임 배열
   * @param {Array<string>} leftUsers - 참가 취소한 사용자 닉네임 배열
   * @returns {Promise<boolean>} - 성공 여부
   */
  async sendParticipantChangeNotification(postId, joinedUsers = [], leftUsers = []) {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread()) {
        console.warn(`[ForumPostManager] 스레드를 찾을 수 없음: ${postId}`);
        return false;
      }
      
      if (thread.archived) {
        console.warn(`[ForumPostManager] 아카이브된 스레드: ${postId}`);
        return false;
      }

      // 변화가 없으면 메시지를 보내지 않음
      if (joinedUsers.length === 0 && leftUsers.length === 0) {
        console.log(`[ForumPostManager] 참가자 변화가 없어 알림 메시지를 보내지 않음: ${postId}`);
        return true;
      }

      // 참가자 변화 메시지 포맷팅
      const changeMessage = formatParticipantChangeMessage(joinedUsers, leftUsers);
      
      // 메시지 전송
      const sentMessage = await thread.send(changeMessage);
      
      // participant_change 타입으로 메시지 추적 (삭제하지 않는 타입)
      await this._trackMessage(postId, 'participant_change', sentMessage.id);
      
      console.log(`[ForumPostManager] 참가자 변화 알림 메시지 전송 완료: ${postId} (참가: ${joinedUsers.length}명, 참가 취소: ${leftUsers.length}명)`);
      return true;
      
    } catch (error) {
      console.error(`[ForumPostManager] 참가자 변화 알림 메시지 전송 실패: ${postId}`, error);
      return false;
    }
  }

  /**
   * 아카이브되거나 삭제된 스레드의 연동 정리
   * @param {string} postId - 포럼 포스트 ID
   * @returns {Promise<void>}
   */
  async _cleanupArchivedThread(postId) {
    try {
      console.log(`[ForumPostManager] 아카이브된 스레드 정리 시작: ${postId}`);
      
      // 데이터베이스에서 해당 포럼 포스트와 연결된 연동 정보 조회
      if (this.databaseManager) {
        const integration = await this.databaseManager.query(`
          SELECT voice_channel_id, forum_post_id 
          FROM post_integrations 
          WHERE forum_post_id = $1 AND is_active = true
        `, [postId]);
        
        if (integration.rows.length > 0) {
          const voiceChannelId = integration.rows[0].voice_channel_id;
          console.log(`[ForumPostManager] 아카이브된 스레드와 연결된 음성 채널: ${voiceChannelId}`);
          
          // 포스트 연동 비활성화
          await this.databaseManager.query(`
            UPDATE post_integrations 
            SET is_active = false, archived_at = CURRENT_TIMESTAMP
            WHERE forum_post_id = $1 AND is_active = true
          `, [postId]);
          
          console.log(`[ForumPostManager] 아카이브된 스레드의 연동 정보 비활성화 완료: ${postId}`);
        }
      }
      
      // 메시지 추적 정보 정리
      if (this.trackedMessages) {
        delete this.trackedMessages[postId];
      }
      
      console.log(`[ForumPostManager] 아카이브된 스레드 정리 완료: ${postId}`);
    } catch (error) {
      console.error(`[ForumPostManager] 아카이브된 스레드 정리 실패: ${postId}`, error);
    }
  }
}