// src/ui/buttons/ForumPostButtons.js - 포럼 게시물 버튼 처리
import { DiscordConstants } from '../../config/DiscordConstants.js';
import { SafeInteraction } from '../../utils/SafeInteraction.js';
import { TextProcessor } from '../../utils/TextProcessor.js';
import { logger } from '../../config/logger-termux.js';

export class ForumPostButtons {
  constructor(deps) {
    this.emojiReactionService = deps.emojiReactionService;
    this.forumPostManager = deps.forumPostManager;
    this.parent = deps.parent;
  }

  /**
   * 참가하기 버튼 처리
   * @param {ButtonInteraction} interaction
   */
  async handleJoinButton(interaction) {
    try {
      const threadId = interaction.customId.replace(
        DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_JOIN,
        ''
      );

      // 사용자 정보 가져오기
      const member = interaction.member;
      const cleanedNickname = TextProcessor.cleanNickname(member.displayName);

      // 데이터베이스에서 참가자 정보 확인
      const databaseManager = this.forumPostManager.databaseManager;
      if (databaseManager) {
        const isAlreadyParticipant = await databaseManager.isParticipant(threadId, member.id);
        if (isAlreadyParticipant) {
          await SafeInteraction.safeReply(interaction, {
            content: '이미 참가 중입니다.',
            ephemeral: true
          });
          return;
        }

        // 데이터베이스에 참가자 추가
        await databaseManager.addParticipant(threadId, member.id, cleanedNickname);

        // 참가자로 전환 시 대기자 명단에서 자동 제거
        const wasWaiting = await databaseManager.isInWaitlist(threadId, member.id);
        if (wasWaiting) {
          await databaseManager.removeFromWaitlist(threadId, member.id);
          logger.info(`[ButtonHandler] 대기자 → 참가자 전환: ${cleanedNickname}`);
        }
      }

      // 현재 참가자 목록 가져오기 (데이터베이스 우선, 없으면 캐시)
      let participants;
      if (databaseManager) {
        participants = await databaseManager.getParticipantNicknames(threadId) || [];
      } else {
        participants = this.emojiReactionService.previousParticipants.get(threadId) || [];
      }

      // DB에 이미 추가되었으므로 조회된 목록을 그대로 사용
      const updatedParticipants = participants;

      // 캐시 업데이트 (하위 호환성)
      this.emojiReactionService.updateParticipantCache(threadId, updatedParticipants);

      // 데이터베이스에 참가자 목록 저장
      try {
        const databaseManager = this.forumPostManager.databaseManager;
        if (databaseManager) {
          await databaseManager.query(
            `UPDATE post_integrations
             SET participants = $1, updated_at = CURRENT_TIMESTAMP
             WHERE forum_post_id = $2`,
            [JSON.stringify(updatedParticipants), threadId]
          );
          logger.info(`[ButtonHandler] 참가자 DB 저장 완료: ${threadId}`);
        }
      } catch (dbError) {
        logger.error('[ButtonHandler] 참가자 DB 저장 실패', { error: dbError.message, stack: dbError.stack });
        // DB 실패해도 메모리 캐시는 유지되므로 봇 작동 계속
      }

      // 참가자 목록 메시지 업데이트
      await this.forumPostManager.sendEmojiParticipantUpdate(
        threadId,
        updatedParticipants,
        '참가'
      );

      // 변경 알림 메시지 전송
      await this.forumPostManager.sendParticipantChangeNotification(
        threadId,
        [cleanedNickname],  // joinedUsers
        []                  // leftUsers
      );

      // 참가자 변동 시 현재 대기자 목록 갱신 표시
      if (databaseManager) {
        const waitlistNicknames = await databaseManager.getWaitlistNicknames(threadId);
        if (waitlistNicknames.length > 0) {
          await this.forumPostManager.sendWaitlistUpdate(threadId, waitlistNicknames);
        }
      }

      // 인터랙션 응답 (조용히 처리)
      await SafeInteraction.safeDeferUpdate(interaction);

    } catch (error) {
      logger.error('[ButtonHandler] 참가하기 버튼 처리 중 오류', { error: error.message, stack: error.stack });
      await SafeInteraction.safeReply(interaction, {
        content: '❌ 참가 처리 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  }

  /**
   * 참가 취소 버튼 처리
   * @param {ButtonInteraction} interaction
   */
  async handleLeaveButton(interaction) {
    try {
      const threadId = interaction.customId.replace(
        DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_LEAVE,
        ''
      );

      // 사용자 정보 가져오기
      const member = interaction.member;
      const cleanedNickname = TextProcessor.cleanNickname(member.displayName);

      // 데이터베이스에서 참가자 정보 확인
      const databaseManager = this.forumPostManager.databaseManager;
      if (databaseManager) {
        const isParticipant = await databaseManager.isParticipant(threadId, member.id);
        if (!isParticipant) {
          await SafeInteraction.safeReply(interaction, {
            content: '참가 중이 아닙니다.',
            ephemeral: true
          });
          return;
        }

        // 데이터베이스에서 참가자 제거
        await databaseManager.removeParticipant(threadId, member.id);
      }

      // 현재 참가자 목록 가져오기 (데이터베이스 우선, 없으면 캐시)
      let participants;
      if (databaseManager) {
        participants = await databaseManager.getParticipantNicknames(threadId) || [];
      } else {
        participants = this.emojiReactionService.previousParticipants.get(threadId) || [];
      }

      // 참가 취소 처리 (닉네임 제거)
      const updatedParticipants = participants.filter(p => p !== cleanedNickname);

      // 캐시 업데이트 (하위 호환성)
      this.emojiReactionService.updateParticipantCache(threadId, updatedParticipants);

      // 데이터베이스에 참가자 목록 저장
      try {
        const databaseManager = this.forumPostManager.databaseManager;
        if (databaseManager) {
          await databaseManager.query(
            `UPDATE post_integrations
             SET participants = $1, updated_at = CURRENT_TIMESTAMP
             WHERE forum_post_id = $2`,
            [JSON.stringify(updatedParticipants), threadId]
          );
          logger.info(`[ButtonHandler] 참가자 DB 저장 완료: ${threadId}`);
        }
      } catch (dbError) {
        logger.error('[ButtonHandler] 참가자 DB 저장 실패', { error: dbError.message, stack: dbError.stack });
        // DB 실패해도 메모리 캐시는 유지되므로 봇 작동 계속
      }

      // 참가자 목록 메시지 업데이트
      await this.forumPostManager.sendEmojiParticipantUpdate(
        threadId,
        updatedParticipants,
        '참가 취소'
      );

      // 변경 알림 메시지 전송
      await this.forumPostManager.sendParticipantChangeNotification(
        threadId,
        [],                  // joinedUsers
        [cleanedNickname]    // leftUsers
      );

      // 참가자 변동 시 현재 대기자 목록 갱신 표시
      if (databaseManager) {
        const waitlistNicknames = await databaseManager.getWaitlistNicknames(threadId);
        if (waitlistNicknames.length > 0) {
          await this.forumPostManager.sendWaitlistUpdate(threadId, waitlistNicknames);
        }
      }

      // 인터랙션 응답 (조용히 처리)
      await SafeInteraction.safeDeferUpdate(interaction);

    } catch (error) {
      logger.error('[ButtonHandler] 참가 취소 버튼 처리 중 오류', { error: error.message, stack: error.stack });
      await SafeInteraction.safeReply(interaction, {
        content: '❌ 참가 취소 처리 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  }

  /**
   * 대기하기 버튼 처리 (포럼 대기자 명단 등록/취소 토글)
   * customId 형식: forum_wait_{threadId}
   * @param {ButtonInteraction} interaction
   */
  async handleForumWaitButton(interaction) {
    try {
      const threadId = interaction.customId.replace(
        DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_WAIT,
        ''
      );

      const member = interaction.member;
      const cleanedNickname = TextProcessor.cleanNickname(member.displayName);
      const databaseManager = this.forumPostManager.databaseManager;

      if (!databaseManager) {
        await SafeInteraction.safeReply(interaction, {
          content: '❌ 데이터베이스 연결이 없습니다.',
          ephemeral: true
        });
        return;
      }

      // 이미 참가 중이면 대기 불가
      const isParticipant = await databaseManager.isParticipant(threadId, member.id);
      if (isParticipant) {
        await SafeInteraction.safeReply(interaction, {
          content: '이미 참가 중입니다. 대기자 명단은 참가 중이 아닌 분들만 등록할 수 있습니다.',
          ephemeral: true
        });
        return;
      }

      // 대기자 토글: 이미 대기 중이면 취소, 아니면 등록
      const isWaiting = await databaseManager.isInWaitlist(threadId, member.id);
      if (isWaiting) {
        await databaseManager.removeFromWaitlist(threadId, member.id);
        logger.info(`[ButtonHandler] 대기자 취소: ${cleanedNickname} (${threadId})`);

        const waitlistNicknames = await databaseManager.getWaitlistNicknames(threadId);
        await this.forumPostManager.sendWaitlistUpdate(threadId, waitlistNicknames);

        await SafeInteraction.safeDeferUpdate(interaction);
      } else {
        await databaseManager.addToWaitlist(threadId, member.id, cleanedNickname);
        logger.info(`[ButtonHandler] 대기자 등록: ${cleanedNickname} (${threadId})`);

        const waitlistNicknames = await databaseManager.getWaitlistNicknames(threadId);
        await this.forumPostManager.sendWaitlistUpdate(threadId, waitlistNicknames);

        await SafeInteraction.safeDeferUpdate(interaction);
      }

    } catch (error) {
      logger.error('[ButtonHandler] 대기하기 버튼 처리 중 오류', { error: error.message, stack: error.stack });
      await SafeInteraction.safeReply(interaction, {
        content: '❌ 대기 처리 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  }

  /**
   * 참가자 멘션 버튼 처리
   * customId 형식: forum_mention_{threadId}
   * @param {ButtonInteraction} interaction
   */
  async handleMentionButton(interaction) {
    try {
      const threadId = interaction.customId.replace(
        DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_MENTION, ''
      );

      const databaseManager = this.forumPostManager.databaseManager;
      if (!databaseManager) {
        await SafeInteraction.safeReply(interaction, {
          content: '❌ 데이터베이스 연결이 없습니다.',
          ephemeral: true
        });
        return;
      }

      const participants = await databaseManager.getParticipants(threadId);
      if (!participants || participants.length === 0) {
        await SafeInteraction.safeReply(interaction, {
          content: '📢 현재 참가자가 없습니다.',
          ephemeral: true
        });
        return;
      }

      // 권한 확인: 참가자(모집자 포함) 또는 마왕 역할만 사용 가능
      const userIds = participants.map(p => p.userId);
      const isParticipant = userIds.includes(interaction.user.id);
      const isSuperAdmin = interaction.member?.roles?.cache?.some(role => role.name === '마왕') ?? false;

      if (!isParticipant && !isSuperAdmin) {
        await SafeInteraction.safeReply(interaction, {
          content: '⚠️ 참가자 또는 관리자만 멘션 버튼을 사용할 수 있습니다.',
          ephemeral: true
        });
        return;
      }

      const mentions = userIds.map(id => `<@${id}>`).join(' ');

      // 버튼 인터랙션 acknowledge (UI 스피너 제거)
      await SafeInteraction.safeDeferUpdate(interaction);

      // 스레드에 참가자 멘션 메시지 전송
      await interaction.channel.send({
        content: `📢 **참가자 멘션**: ${mentions}`,
        allowedMentions: { users: userIds }
      });

      // 멘션 메시지 아래에 참가자 목록과 멘션 버튼을 다시 배치
      // sendEmojiParticipantUpdate가 기존 추적 메시지를 삭제하고 새 메시지를 전송한다.
      const participantNicknames = participants.map(participant => participant.nickname);
      await this.forumPostManager.sendEmojiParticipantUpdate(
        threadId,
        participantNicknames,
        '참가자 멘션'
      );

      logger.info(`[ButtonHandler] 참가자 멘션 전송: threadId=${threadId}, ${userIds.length}명 (요청자: ${interaction.user.id}, 참가자=${isParticipant}, 관리자=${isSuperAdmin})`);

    } catch (error) {
      logger.error('[ButtonHandler] 참가자 멘션 버튼 처리 오류', { error: error.message, stack: error.stack });
      await SafeInteraction.safeReply(interaction, {
        content: '❌ 멘션 처리 중 오류가 발생했습니다.',
        ephemeral: true
      });
    }
  }
}
