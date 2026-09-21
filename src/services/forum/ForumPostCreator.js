import { ActionRowBuilder, ButtonBuilder } from 'discord.js';
import { DiscordConstants } from '../../config/DiscordConstants.js';
import { TextProcessor } from '../../utils/TextProcessor.js';
import { formatParticipantList } from '../../utils/formatters.js';
import { logger } from '../../config/logger-termux.js';

export class ForumPostCreator {
  constructor(deps) {
    this.client = deps.client;
    this.forumChannelId = deps.forumChannelId;
    this.forumTagId = deps.forumTagId;
    this.databaseManager = deps.databaseManager;
    this.parent = deps.parent;
  }

  async createForumPost(recruitmentData, voiceChannelId = null, specialType = null) {
    try {
      const forumChannel = await this.client.channels.fetch(this.forumChannelId);
      
      if (!forumChannel || forumChannel.type !== DiscordConstants.CHANNEL_TYPES.GUILD_FORUM) {
        logger.error('[ForumPostManager] 포럼 채널을 찾을 수 없거나 올바른 포럼 채널이 아닙니다.');
        return { success: false, error: '포럼 채널을 찾을 수 없습니다' };
      }
      
      const embed = await this.parent.builders.createPostEmbed(recruitmentData, voiceChannelId, specialType);
      const title = this.parent.builders.generatePostTitle(recruitmentData);
      
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

      // 독립/음성채널 연동 포스트 모두 동일한 버튼 구조
      // (음성채널 댓글에 이미 관전/대기/초기화 버튼이 있으므로 포스트에서는 생략)
      // Row 1: 참가하기 / 참가 취소 / 대기하기
      // Row 2: 멤버 수정 / 닫기
      components.push(this.parent.builders.createParticipationButtons('temp'));
      components.push(this.parent.builders.createRecruiterButtons('temp', recruitmentData.author.id, true));
      
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

      // 모든 행을 순회하며 'temp' placeholder를 실제 threadId로 교체
      try {
        const starterMessage = await thread.fetchStarterMessage();
        const P = DiscordConstants.CUSTOM_ID_PREFIXES;
        const updatedComponents = starterMessage.components.map(row => {
          const buttons = row.components.map(button => {
            const id = button.customId;
            if (id.startsWith(P.FORUM_JOIN)) {
              return ButtonBuilder.from(button).setCustomId(`${P.FORUM_JOIN}${thread.id}`);
            } else if (id.startsWith(P.FORUM_LEAVE)) {
              return ButtonBuilder.from(button).setCustomId(`${P.FORUM_LEAVE}${thread.id}`);
            } else if (id.startsWith(P.FORUM_WAIT)) {
              return ButtonBuilder.from(button).setCustomId(`${P.FORUM_WAIT}${thread.id}`);
            } else if (id.startsWith(P.FORUM_EDIT_PREMEMBERS)) {
              return ButtonBuilder.from(button).setCustomId(
                `${P.FORUM_EDIT_PREMEMBERS}${thread.id}_${recruitmentData.author.id}`
              );
            }
            return ButtonBuilder.from(button);
          });
          return new ActionRowBuilder().addComponents(...buttons);
        });

        await starterMessage.edit({ components: updatedComponents });
        logger.info(`[ForumPostManager] 버튼 customId 업데이트됨: ${thread.id}`);
      } catch (updateError) {
        logger.error('[ForumPostManager] 버튼 customId 업데이트 실패', { error: updateError.message, stack: updateError.stack });
      }

      // 모집자를 스레드에 자동으로 추가
      try {
        await thread.members.add(recruitmentData.author.id);
        logger.info(`[ForumPostManager] 모집자가 스레드에 추가됨: ${recruitmentData.author.displayName}`);
      } catch (addError) {
        logger.warn('[ForumPostManager] 모집자를 스레드에 추가하는데 실패', { error: addError.message });
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
          logger.info(`[ForumPostManager] 모집자 참가자 자동 등록: ${recruiterName}`);

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
              logger.info(`[ForumPostManager] 미리 모인 멤버 자동 등록: ${memberName}`);
            } catch (memberError) {
              logger.warn(`[ForumPostManager] 미리 모인 멤버 추가 실패 (${userId})`, { error: memberError.message });
            }
          }

          // @name 형식으로 입력된 미리 모인 멤버 → guild.members.search()로 ID 해석
          const preMemberNames = recruitmentData.preMemberNames || [];
          logger.info(`[ForumPostManager] @name 멤버 처리 시작: ${preMemberNames.length}명 [${preMemberNames.join(', ')}]`);
          for (const name of preMemberNames) {
            try {
              let matched = null;

              // 1차: Discord REST API 검색 (닉네임/username 기반)
              try {
                const searchResults = await forumChannel.guild.members.search({ query: name, limit: 10 });
                logger.info(`[ForumPostManager] "${name}" API 검색 결과: ${searchResults.size}명`);

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
                logger.warn(`[ForumPostManager] "${name}" API 검색 오류`, { error: apiErr.message });
              }

              // 2차 폴백: 캐시에서 검색 (글로벌 이름 / 부분 일치 포함)
              if (!matched) {
                logger.info(`[ForumPostManager] "${name}" 캐시 폴백 검색 시도...`);
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
                  logger.info(`[ForumPostManager] "${name}" 캐시에서 발견: ${matched.displayName} (${matched.id})`);
                }
              }

              if (matched && !preMemberIds.includes(matched.id)) {
                const memberName = TextProcessor.cleanNickname(matched.displayName || matched.user.username);
                await this.databaseManager.addParticipant(thread.id, matched.id, memberName);
                await thread.members.add(matched.id);
                preMemberIds.push(matched.id);
                logger.info(`[ForumPostManager] @name 멤버 등록 성공: "${name}" → ${memberName} (${matched.id})`);
              } else if (!matched) {
                logger.warn(`[ForumPostManager] @name으로 멤버를 찾을 수 없음: "${name}" (API+캐시 모두 실패)`);
              } else {
                logger.info(`[ForumPostManager] "${name}" 이미 등록된 멤버 (${matched.id}), 스킵`);
              }
            } catch (nameSearchErr) {
              logger.warn(`[ForumPostManager] @name 검색 실패 ("${name}")`, { error: nameSearchErr.message });
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

          // 초기 참가자 목록 메시지 전송 (모집자 + 미리 모인 멤버) + 참가자 멘션 버튼
          const participantNicknames = await this.databaseManager.getParticipantNicknames(thread.id);
          const participantListMsg = formatParticipantList(participantNicknames);
          const maxCount = recruitmentData.maxParticipants ?? 'N';
          const mentionRow = this.parent.builders.createMentionButton(thread.id);
          const initParticipantMsg = await thread.send({
            content: `${participantListMsg}\n-# (${participantNicknames.length}/${maxCount}명)`,
            components: [mentionRow]
          });
          // 추적 등록: 다음 참가자 업데이트 시 자동 삭제됨
          await this.parent.tracker._trackMessage(thread.id, 'emoji_reaction', initParticipantMsg.id);
          logger.info(`[ForumPostManager] 초기 참가자 목록 메시지 전송 완료: ${participantNicknames.length}명`);
        } catch (autoAddError) {
          logger.warn('[ForumPostManager] 참가자 자동 등록 중 오류', { error: autoAddError.message });
        }
      }

      // 음성 채널이 있으면 별도 메시지로 네이티브 링크 추가
      if (voiceChannelId) {
        try {
          const voiceChannel = await this.client.channels.fetch(voiceChannelId);
          if (voiceChannel) {
            await thread.send(`🔊 **음성 채널**: https://discord.com/channels/${voiceChannel.guild.id}/${voiceChannelId}`);
            logger.info(`[ForumPostManager] 음성 채널 링크 메시지 추가됨: ${voiceChannel.name}`);
          }
        } catch (linkError) {
          logger.warn('[ForumPostManager] 음성 채널 링크 메시지 추가 실패', { error: linkError.message });
        }
      }
      
      // 참가 안내 메시지 추가
      try {
        const participationGuide = '**참가하기** 버튼을 눌러 참가하세요.';

        await thread.send(participationGuide);
        logger.info(`[ForumPostManager] 참가 안내 메시지 추가됨: ${thread.name}`);
      } catch (guideError) {
        logger.warn('[ForumPostManager] 참가 안내 메시지 추가 실패', { error: guideError.message });
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
          logger.info(`[ForumPostManager] 독립형 포럼 매핑 저장 완료: ${mappingKey} -> ${thread.id}`);
        } catch (mappingError) {
          logger.warn('[ForumPostManager] 독립형 포럼 매핑 저장 실패', { error: mappingError.message });
          // 매핑 실패해도 포럼 생성은 성공으로 처리
        }
      }

      logger.info(`[ForumPostManager] 포럼 포스트 생성 완료: ${thread.name} (ID: ${thread.id})`);
      return { success: true, postId: thread.id };
      
    } catch (error) {
      logger.error('[ForumPostManager] 포럼 포스트 생성 오류', { error: error.message, stack: error.stack });
      return { success: false, error: error.message };
    }
  }
}
