// src/services/InactivePostChecker.js - 15일 비활동 구직글 알림 서비스
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { DiscordConstants } from '../config/DiscordConstants.js';
import { logger } from '../config/logger-termux.js';

const INACTIVE_DAYS = 15;
const INACTIVE_MS = INACTIVE_DAYS * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 매일 1회
const DISCORD_EPOCH = 1420070400000n;

/**
 * Discord 스노우플레이크 ID → Unix 타임스탬프(ms) 변환
 */
function snowflakeToTimestamp(id) {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

export class InactivePostChecker {
  constructor(client, databaseManager) {
    this.client = client;
    this.databaseManager = databaseManager;
    this._timer = null;
  }

  /**
   * 스케줄러 시작 — 봇 ready 이벤트 후 호출
   */
  start() {
    // 시작 시 즉시 1회 실행
    this._run().catch(err =>
      logger.error('[InactivePostChecker] 초기 실행 오류', { error: err.message })
    );
    // 이후 매일 실행
    this._timer = setInterval(() => {
      this._run().catch(err =>
        logger.error('[InactivePostChecker] 주기 실행 오류', { error: err.message })
      );
    }, CHECK_INTERVAL_MS);

    logger.info('[InactivePostChecker] 비활동 구직글 체커 시작 (매일 실행)');
  }

  /**
   * 스케줄러 정지 — 봇 shutdown 시 호출
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
      logger.info('[InactivePostChecker] 비활동 구직글 체커 정지');
    }
  }

  /**
   * 전체 활성 포스트 순회 및 비활동 체크
   */
  async _run() {
    logger.info('[InactivePostChecker] 비활동 구직글 체크 시작');

    const activePosts = await this.databaseManager.getActiveMappingsByForumState(
      ['standalone', 'voice_linked', 'created'],
      true
    );

    logger.info(`[InactivePostChecker] 활성 포스트 ${activePosts.length}개 확인 중`);

    const now = Date.now();

    for (const post of activePosts) {
      try {
        await this._checkPost(post, now);
      } catch (err) {
        logger.error('[InactivePostChecker] 포스트 체크 오류', {
          forumPostId: post.forum_post_id,
          error: err.message
        });
      }
    }

    logger.info('[InactivePostChecker] 비활동 구직글 체크 완료');
  }

  /**
   * 개별 포스트 비활동 여부 판별 및 경고 전송
   */
  async _checkPost(post, now) {
    const thread = await this.client.channels.fetch(post.forum_post_id).catch(() => null);

    // 스레드를 찾을 수 없거나 이미 아카이브/잠금된 경우 → DB 비활성화
    if (!thread || !thread.isThread()) {
      logger.debug(`[InactivePostChecker] 스레드 없음 — 스킵: ${post.forum_post_id}`);
      return;
    }

    if (thread.archived || thread.locked) {
      logger.debug(`[InactivePostChecker] 이미 닫힌 포스트 — DB 비활성화: ${post.forum_post_id}`);
      await this.databaseManager.query(
        `UPDATE post_integrations SET is_active = false WHERE forum_post_id = $1`,
        [post.forum_post_id]
      ).catch(() => {});
      return;
    }

    if (!thread.lastMessageId) return;

    // 마지막 메시지 시간 계산
    const lastMessageTs = snowflakeToTimestamp(thread.lastMessageId);
    const elapsed = now - lastMessageTs;
    const elapsedDays = Math.floor(elapsed / 86400000);

    if (elapsed < INACTIVE_MS) {
      logger.debug(`[InactivePostChecker] 활성 포스트 (${elapsedDays}일): ${thread.name}`);
      return;
    }

    // 15일 이상 비활동 → 경고 메시지 + 구직 닫기 버튼 전송
    logger.info(`[InactivePostChecker] 비활동 포스트 발견 (${elapsedDays}일): ${thread.name}`);

    // 모집자 ID: forum_participants에서 가장 먼저 참가한 유저 (모집자는 항상 첫 번째로 추가됨)
    let recruiterId = null;
    try {
      const recruiterResult = await this.databaseManager.query(
        `SELECT user_id FROM forum_participants WHERE forum_post_id = $1 ORDER BY joined_at ASC LIMIT 1`,
        [post.forum_post_id]
      );
      recruiterId = recruiterResult?.rows?.[0]?.user_id ?? null;
    } catch (err) {
      logger.warn('[InactivePostChecker] 모집자 조회 실패, 스킵', { error: err.message });
    }

    if (!recruiterId) {
      logger.warn(`[InactivePostChecker] 모집자 ID 없음 — 멘션 없이 전송: ${thread.name}`);
    }

    const embed = new EmbedBuilder()
      .setTitle('🔔 비활동 알림')
      .setDescription(
        `이 구직글이 **${elapsedDays}일간 활동**이 없습니다.\n\n` +
        `구직이 완료되었다면 **구직 닫기** 버튼을 눌러 종료해주세요.\n` +
        `계속 모집 중이라면 현황을 업데이트해주세요.`
      )
      .setColor(0xF5A623)
      .setTimestamp();

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('general_delete')
        .setLabel(`${DiscordConstants.EMOJIS.CLOSE} 구직 닫기`)
        .setStyle(ButtonStyle.Danger)
    );

    const mentionContent = recruiterId ? `<@${recruiterId}>` : null;
    const allowedUsers = recruiterId ? [recruiterId] : [];

    await thread.send({
      ...(mentionContent && { content: mentionContent }),
      embeds: [embed],
      components: [closeRow],
      allowedMentions: { users: allowedUsers }
    });

    logger.info(`[InactivePostChecker] 비활동 경고 전송 완료: ${thread.name} (recruiterId: ${recruiterId})`);
  }
}
