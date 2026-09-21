import { EmbedBuilder } from 'discord.js';
import { DiscordConstants } from '../../config/DiscordConstants.js';
import { RecruitmentConfig } from '../../config/RecruitmentConfig.js';
import { TextProcessor } from '../../utils/TextProcessor.js';
import { logger } from '../../config/logger-termux.js';

export class ForumPostQueries {
  constructor(deps) {
    this.client = deps.client;
    this.forumChannelId = deps.forumChannelId;
    this.forumTagId = deps.forumTagId;
    this.databaseManager = deps.databaseManager;
    this.parent = deps.parent;
  }

  async getExistingPosts(limit = 10) {
    try {
      const forumChannel = await this.client.channels.fetch(this.forumChannelId);
      
      if (!forumChannel || forumChannel.type !== DiscordConstants.CHANNEL_TYPES.GUILD_FORUM) {
        logger.error('[ForumPostManager] 포럼 채널을 찾을 수 없습니다.');
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
      logger.error('[ForumPostManager] 기존 포스트 목록 가져오기 실패', { error: error.message, stack: error.stack });
      return [];
    }
  }

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
      
      logger.info(`[ForumPostManager] 필터링된 포스트 목록: 총 ${filteredPosts.length}개 (사용자: ${userPosts.length}개, 다른 사용자: ${Math.min(remainingSlots, otherPosts.length)}개)`);
      
      return filteredPosts.slice(0, limit);
      
    } catch (error) {
      logger.error('[ForumPostManager] 필터링된 포스트 목록 가져오기 실패', { error: error.message, stack: error.stack });
      // 오류 발생 시 일반 메서드로 fallback
      return await this.getExistingPosts(limit);
    }
  }

  async postExists(postId) {
    try {
      const thread = await this.client.channels.fetch(postId);
      return thread && thread.isThread() && !thread.archived;
    } catch (error) {
      if (error.code === 10003) { // Unknown Channel
        return false;
      }
      logger.error(`[ForumPostManager] 포스트 존재 확인 실패: ${postId}`, { error: error.message, stack: error.stack });
      return false;
    }
  }

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
      logger.error(`[ForumPostManager] 포스트 정보 가져오기 실패: ${postId}`, { error: error.message, stack: error.stack });
      return null;
    }
  }

  async archivePost(postId, reason = '음성 채널 삭제됨', lockThread = true) {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread()) {
        logger.warn(`[ForumPostManager] 스레드를 찾을 수 없음: ${postId}`);
        return false;
      }
      
      if (thread.archived) {
        logger.info(`[ForumPostManager] 이미 아카이브된 스레드: ${postId}`);
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
          logger.info(`[ForumPostManager] 스레드 잠금 완료: ${postId}`);
        } catch (lockError) {
          logger.error(`[ForumPostManager] 스레드 잠금 실패: ${postId}`, { error: lockError.message, stack: lockError.stack });
          // 잠금 실패해도 아카이브는 계속 진행
        }
      }
      
      // 스레드 아카이브
      await thread.setArchived(true, reason);
      
      logger.info(`[ForumPostManager] 포럼 포스트 아카이브 완료: ${postId} (${reason})`);
      return true;
      
    } catch (error) {
      logger.error(`[ForumPostManager] 포럼 포스트 아카이브 실패: ${postId}`, { error: error.message, stack: error.stack });
      return false;
    }
  }

  async _cleanupArchivedThread(postId) {
    try {
      logger.info(`[ForumPostManager] 아카이브된 스레드 정리 시작: ${postId}`);
      
      // 데이터베이스에서 해당 포럼 포스트와 연결된 연동 정보 조회
      if (this.databaseManager) {
        const integration = await this.databaseManager.query(`
          SELECT voice_channel_id, forum_post_id 
          FROM post_integrations 
          WHERE forum_post_id = $1 AND is_active = true
        `, [postId]);
        
        if (integration.rows.length > 0) {
          const voiceChannelId = integration.rows[0].voice_channel_id;
          logger.info(`[ForumPostManager] 아카이브된 스레드와 연결된 음성 채널: ${voiceChannelId}`);
          
          // 포스트 연동 비활성화
          await this.databaseManager.query(`
            UPDATE post_integrations 
            SET is_active = false, archived_at = CURRENT_TIMESTAMP
            WHERE forum_post_id = $1 AND is_active = true
          `, [postId]);
          
          logger.info(`[ForumPostManager] 아카이브된 스레드의 연동 정보 비활성화 완료: ${postId}`);
        }
      }
      
      // 메시지 추적 정보 정리
      if (this.trackedMessages) {
        delete this.trackedMessages[postId];
      }
      
      logger.info(`[ForumPostManager] 아카이브된 스레드 정리 완료: ${postId}`);
    } catch (error) {
      logger.error(`[ForumPostManager] 아카이브된 스레드 정리 실패: ${postId}`, { error: error.message, stack: error.stack });
    }
  }
}
