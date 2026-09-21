// src/ui/buttons/PreMembersButtons.js - 사전 멤버 버튼 처리
import { DiscordConstants } from '../../config/DiscordConstants.js';
import { SafeInteraction } from '../../utils/SafeInteraction.js';
import { TextProcessor } from '../../utils/TextProcessor.js';
import { formatParticipantList } from '../../utils/formatters.js';
import { logger } from '../../config/logger-termux.js';

export class PreMembersButtons {
  constructor(deps) {
    this.forumPostManager = deps.forumPostManager;
    this.parent = deps.parent;
  }

  /**
   * 미리 모인 멤버 수정 버튼 처리 (모집자 전용)
   * customId 형식: forum_edit_premembers_{threadId}_{recruiterId}
   * @param {ButtonInteraction} interaction
   */
  async handleEditPreMembersButton(interaction) {
    try {
      const withoutPrefix = interaction.customId.replace(
        DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_EDIT_PREMEMBERS, ''
      );
      const underscoreIdx = withoutPrefix.lastIndexOf('_');
      const threadId    = withoutPrefix.slice(0, underscoreIdx);
      const recruiterId = withoutPrefix.slice(underscoreIdx + 1);

      // 모집자 권한 확인
      if (interaction.user.id !== recruiterId) {
        await SafeInteraction.safeReply(interaction, {
          content: '⚠️ 모집자만 멤버를 수정할 수 있습니다.',
          ephemeral: true,
        });
        return;
      }

      const db = this.forumPostManager?.databaseManager;
      const currentParticipants = db
        ? (await db.getParticipants(threadId) ?? [])
        : [];

      const thread = await interaction.client.channels.fetch(threadId).catch(() => null);
      if (!thread) {
        await SafeInteraction.safeReply(interaction, {
          content: '❌ 스레드를 찾을 수 없습니다.',
          ephemeral: true,
        });
        return;
      }

      // ① 모집자에게만 보이는 ephemeral: 현재 참가자 목록을 복사하기 편한 형태로 출력
      const copyText = currentParticipants.length > 0
        ? currentParticipants.map(p => `@${p.nickname}`).join(' ')
        : '(참가자 없음)';

      await SafeInteraction.safeReply(interaction, {
        content: [
          `**📋 현재 참가자 목록** (${currentParticipants.length}명)`,
          `아래를 복사한 후 수정해서 채널에 입력해주세요:`,
          `\`\`\``,
          copyText,
          `\`\`\``,
        ].join('\n'),
        ephemeral: true,
      });

      // ② 스레드에 입력 안내 메시지 전송
      const promptMsg = await thread.send({
        content: [
          `**✏️ 멤버 수정** (<@${interaction.user.id}> 전용)`,
          `수정할 멤버를 **@닉네임** 형식으로 입력해주세요.`,
          `예) \`@무지 @현호\`  ←  비워서 전송하면 전원 제거`,
          `-# 5분 내에 입력이 없으면 자동 취소됩니다.`,
        ].join('\n'),
        allowedMentions: { users: [] },
      });

      // ③ 모집자의 다음 메시지 대기 (5분)
      let collected;
      try {
        collected = await thread.awaitMessages({
          filter: (m) => m.author.id === recruiterId,
          time: 5 * 60 * 1000,
          max: 1,
          errors: ['time'],
        });
      } catch {
        await promptMsg.edit({ content: '⏱️ 시간 초과로 멤버 수정이 취소됐습니다.' }).catch(() => {});
        return;
      }

      const reply = collected.first();

      // ① <@ID> 형식 파싱 (Discord 자동완성으로 선택한 멘션)
      const newUserIds = [...reply.mentions.users.keys()];

      // ② @name 형식 파싱 → guild.members.search()로 ID 해석
      //    (텍스트로 직접 입력한 "@무지 @현호" 처리)
      const rawWithoutMentions = reply.content.replace(/<@!?\d+>/g, '');
      const nameRegex = /@(\S+)/g;
      let nameMatch;
      while ((nameMatch = nameRegex.exec(rawWithoutMentions)) !== null) {
        const name = nameMatch[1];
        try {
          const results = await interaction.guild.members.search({ query: name, limit: 5 });
          const matched = results.find(m => {
            const clean = TextProcessor.cleanNickname(m.displayName || m.user.username);
            return clean === name || m.user.username === name;
          }) ?? results.first();
          if (matched && !newUserIds.includes(matched.id)) {
            newUserIds.push(matched.id);
          }
        } catch { /* 검색 실패 스킵 */ }
      }

      // 안내 메시지 + 입력 메시지 정리
      await promptMsg.delete().catch(() => {});
      await reply.delete().catch(() => {});

      if (!db) {
        await thread.send({ content: '❌ DB 연결 오류로 수정할 수 없습니다.' });
        return;
      }

      const currentIds = currentParticipants.map(p => p.userId);
      const toAdd    = newUserIds.filter(id => !currentIds.includes(id));
      const toRemove = currentIds.filter(id => !newUserIds.includes(id));

      for (const userId of toAdd) {
        try {
          const member = await interaction.guild.members.fetch(userId);
          const nickname = TextProcessor.cleanNickname(member.displayName || member.user.username);
          await db.addParticipant(threadId, userId, nickname);
          await thread.members.add(userId).catch(() => {});
        } catch { /* 스킵 */ }
      }

      for (const userId of toRemove) {
        await db.removeParticipant(threadId, userId).catch(() => {});
      }

      // ④ 이전 참가자 목록 메시지 삭제 후 새 목록 전송 (참가하기 버튼과 동일한 방식)
      const updatedNicknames = await db.getParticipantNicknames(threadId);
      await this.forumPostManager.sendEmojiParticipantUpdate(threadId, updatedNicknames, '멤버수정');

      logger.info(`[ButtonHandler] 멤버 수정 완료: threadId=${threadId}, 추가=${toAdd.length}, 제거=${toRemove.length}`);

    } catch (error) {
      logger.error('[ButtonHandler] 멤버 수정 버튼 처리 오류', { error: error.message, stack: error.stack });
    }
  }

  /**
   * 미리 모인 멤버 UserSelectMenu 인터랙션 처리
   * customId: premembers_user_select_{threadId}_{recruiterId}
   * @param {UserSelectMenuInteraction} interaction
   */
  async handlePreMembersSelectMenu(interaction) {
    // ① 가장 먼저 deferUpdate — 3초 제한을 15분으로 연장
    const deferResult = await SafeInteraction.safeDeferUpdate(interaction);
    // null 실패도 기존 catch 경로로 전달하여 후속 작업을 중단한다.
    if (deferResult === null) {
      throw new Error('인터랙션 지연 응답에 실패했습니다.');
    }

    try {
      const withoutPrefix = interaction.customId.replace(
        DiscordConstants.CUSTOM_ID_PREFIXES.PREMEMBERS_USER_SELECT, ''
      );
      const underscoreIdx = withoutPrefix.lastIndexOf('_');
      const threadId    = withoutPrefix.slice(0, underscoreIdx);
      const recruiterId = withoutPrefix.slice(underscoreIdx + 1);

      // 권한 재확인
      if (interaction.user.id !== recruiterId) {
        await interaction.editReply({ content: '⚠️ 모집자만 수정할 수 있습니다.', components: [] });
        return;
      }

      // interaction.values = Discord 서버가 resolve한 선택된 userId 배열
      const newUserIds = interaction.values;

      const db = this.forumPostManager?.databaseManager;
      if (!db) {
        await interaction.editReply({ content: '❌ DB 연결 오류가 발생했습니다.', components: [] });
        return;
      }

      const currentParticipants = await db.getParticipants(threadId) ?? [];
      const currentIds = currentParticipants.map(p => p.userId);

      const toAdd    = newUserIds.filter(id => !currentIds.includes(id));
      const toRemove = currentIds.filter(id => !newUserIds.includes(id));

      // ② DB 업데이트: 추가
      const thread = await interaction.client.channels.fetch(threadId).catch(() => null);
      for (const userId of toAdd) {
        try {
          const member = await interaction.guild.members.fetch(userId);
          const nickname = TextProcessor.cleanNickname(member.displayName || member.user.username);
          await db.addParticipant(threadId, userId, nickname);
          if (thread) await thread.members.add(userId).catch(() => {});
        } catch { /* 멤버 조회 실패 스킵 */ }
      }

      // ③ DB 업데이트: 제거
      for (const userId of toRemove) {
        await db.removeParticipant(threadId, userId).catch(() => {});
      }

      // ④ 스레드에 갱신된 참가자 목록 전송
      if (thread) {
        const updatedNicknames = await db.getParticipantNicknames(threadId);
        await thread.send(`${formatParticipantList(updatedNicknames)}\n-# (멤버 수정됨)`);
      }

      // ⑤ deferUpdate 이후 완료 결과는 editReply로 전송
      const lines = [
        `✅ **멤버 수정 완료**`,
        toAdd.length > 0    ? `추가: ${toAdd.map(id => `<@${id}>`).join(' ')}`    : null,
        toRemove.length > 0 ? `제거: ${toRemove.map(id => `<@${id}>`).join(' ')}` : null,
        toAdd.length === 0 && toRemove.length === 0 ? `변경사항 없음` : null,
      ].filter(Boolean);

      await interaction.editReply({ content: lines.join('\n'), components: [] });

      logger.info(`[ButtonHandler] 멤버 수정 완료: threadId=${threadId}, 추가=${toAdd.length}, 제거=${toRemove.length}`);

    } catch (error) {
      logger.error('[ButtonHandler] 멤버 SelectMenu 처리 오류', { error: error.message, stack: error.stack });
      // deferUpdate 이후 에러 시 editReply로 안내
      await interaction.editReply({
        content: '❌ 멤버 수정 처리 중 오류가 발생했습니다.',
        components: [],
      }).catch(() => {});
    }
  }
}

