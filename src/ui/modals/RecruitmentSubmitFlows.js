import { MessageFlags } from 'discord.js';
import { RecruitmentConfig } from '../../config/RecruitmentConfig.js';
import { SafeInteraction } from '../../utils/SafeInteraction.js';
import { logger } from '../../config/logger-termux.js';

/**
 * 검증이 끝난 구인구직 제출의 생성 흐름을 실행한다.
 *
 * 책임:
 * - 독립 포럼 포스트 생성 흐름을 처리한다.
 * - 음성 채널 연동 포럼 포스트 생성 흐름을 처리한다.
 * - parent가 소유한 재시도 정책을 통해 외부 호출을 수행한다.
 * - 기존 SafeInteraction 응답과 결과 객체를 유지한다.
 *
 * 서비스 의존성은 Facade 생성자가 전달한 동일한 참조다.
 */
export class RecruitmentSubmitFlows {
  constructor({ recruitmentService, forumPostManager, parent }) {
    this.recruitmentService = recruitmentService;
    this.forumPostManager = forumPostManager;
    this.parent = parent;
  }
  async handleStandaloneRecruitment(interaction, recruitmentData) {
    try {
      logger.info(`[ModalHandler] 독립 구인구직 시작 - 제목: "${recruitmentData.title}"`);
      await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      
      // 상호작용 컨텍스트에서 길드 ID 추출
      const guildId = interaction.guild?.id;
      logger.info(`[ModalHandler] 상호작용에서 길드 ID 추출: ${guildId || 'none'}`);

      // 독립 포럼 포스트 생성 (재시도 메커니즘 적용)
      logger.info(`[ModalHandler] ForumPostManager.createForumPost 호출 중...`);
      logger.info(`[ModalHandler] 구인구직 데이터`, {
        title: recruitmentData.title,
        description: recruitmentData.description,
        tags: recruitmentData.tags.join(', '), // 배열을 문자열로 변환하여 로그 표시
        maxParticipants: recruitmentData.maxParticipants,
        author: recruitmentData.author.displayName || (recruitmentData.author.username || recruitmentData.author.user?.username),
        guildId,
      });

      const createResult = await this.parent.retry.withRetry(
        () => this.forumPostManager.createForumPost(recruitmentData, undefined),
        '독립 포럼 포스트 생성'
      );

      logger.info(`[ModalHandler] ForumPostManager.createForumPost 결과`, {
        success: createResult.success,
        postId: createResult.postId,
        error: createResult.error,
        warnings: createResult.warnings,
      });

      if (createResult.success && createResult.postId) {
        await SafeInteraction.safeReply(interaction, {
          content: `✅ 구인구직 포럼이 성공적으로 생성되었습니다!\n🔗 포럼: <#${createResult.postId}>`,
          flags: MessageFlags.Ephemeral,
        });

        logger.info(
          `[ModalHandler] 독립 구인구직 생성 완료: ${recruitmentData.title} (ID: ${createResult.postId})`
        );

        return {
          success: true,
          action: 'standalone',
          postId: createResult.postId,
          message: '독립 구인구직 생성 성공',
        };
      } else {
        logger.error(`[ModalHandler] 포럼 포스트 생성 실패`, {
          error: createResult.error,
          warnings: createResult.warnings,
          title: recruitmentData.title,
        });

        // 상세 오류 정보가 있으면 활용
        let errorMessage = createResult.error
          ? `❌ 구인구직 생성 실패: ${createResult.error}`
          : RecruitmentConfig.MESSAGES.LINK_FAILED;

        // 유효성 검사 오류인 경우 더 자세한 정보 제공
        if (createResult.error?.includes('participantPattern') || createResult.error?.includes('제목 형식')) {
          errorMessage +=
            `\n\n💡 **제목 형식 안내:**\n` +
            `• 올바른 형식: "게임명 1/5" 또는 "게임명 1/N"\n` +
            `• 현재인원/최대인원 형식이 포함되어야 합니다.`;
        } else if (createResult.error?.includes('forumChannelId') || createResult.error?.includes('포럼 채널')) {
          // 포럼 채널 설정 관련 오류
          errorMessage +=
            `\n\n⚙️ **설정 확인 필요:**\n` +
            `• 관리자가 포럼 채널을 설정하지 않았습니다.\n` +
            `• \`/설정\` → **관리 채널 지정** → **구인구직 포럼** 설정 필요\n` +
            `• 설정 후 다시 시도해주세요.`;
        }

        await SafeInteraction.safeReply(interaction, {
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });

        return {
          success: false,
          action: 'standalone',
          error: createResult.error || '포럼 포스트 생성 실패',
        };
      }
    } catch (error) {
      logger.error('[ModalHandler] 독립 구인구직 처리 오류', { error: error.message, stack: error.stack });

      // 10008 에러는 메시지가 삭제되었음을 의미하므로 추가 응답을 시도하지 않음
      if (error.code === 10008) {
        logger.warn('[ModalHandler] 원본 메시지가 삭제되었음 - 추가 응답을 시도하지 않음');
        return {
          success: false,
          action: 'standalone',
          error: '원본 메시지가 삭제됨',
        };
      }

      await SafeInteraction.safeReply(
        interaction,
        SafeInteraction.createErrorResponse('독립 구인구직 생성', error)
      );

      return {
        success: false,
        action: 'standalone',
        error: error instanceof Error ? error.message : '알 수 없는 오류',
      };
    }
  }
  async handleVoiceChannelRecruitment(interaction, recruitmentData, voiceChannelId) {
    try {
      logger.info(
        `[ModalHandler] 음성 채널 연동 구인구직 시작 - 제목: "${recruitmentData.title}", 음성 채널: ${voiceChannelId}`
      );
      await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

      // 상호작용 컨텍스트에서 길드 ID 추출
      const guildId = interaction.guild?.id;
      logger.info(`[ModalHandler] 상호작용에서 길드 ID 추출: ${guildId || 'none'}`);

      // 음성 채널 연동 포럼 포스트 생성 (재시도 메커니즘 적용)
      logger.info(`[ModalHandler] RecruitmentService.createLinkedRecruitment 호출 중...`);
      logger.info(`[ModalHandler] 구인구직 데이터`, {
        title: recruitmentData.title,
        description: recruitmentData.description,
        tags: recruitmentData.tags.join(', '), // 배열을 문자열로 변환하여 로그 표시
        maxParticipants: recruitmentData.maxParticipants,
        author: recruitmentData.author.displayName || (recruitmentData.author.username || recruitmentData.author.user?.username),
        voiceChannelId,
        guildId,
      });

      const result = await this.parent.retry.withRetry(
        () =>
          this.recruitmentService.createLinkedRecruitment(
            recruitmentData,
            voiceChannelId,
            interaction.user.id,
            guildId
          ),
        '음성 채널 연동 포럼 포스트 생성'
      );

      logger.info(`[ModalHandler] RecruitmentService.createLinkedRecruitment 결과`, {
        success: result.success,
        postId: result.postId,
        message: result.message,
        error: result.error,
        data: result.data,
      });

      if (result.success && result.postId) {
        await SafeInteraction.safeReply(interaction, {
          content: `✅ 구인구직 포럼이 성공적으로 생성되고 음성 채널과 연동되었습니다!\n🔗 포럼: <#${result.postId}>`,
          flags: MessageFlags.Ephemeral,
        });

        logger.info(
          `[ModalHandler] 음성 채널 연동 구인구직 생성 완료: ${recruitmentData.title} (ID: ${result.postId})`
        );

        return {
          success: true,
          action: 'voiceChannel',
          postId: result.postId,
          message: '음성 채널 연동 구인구직 생성 성공',
          data: result.data,
        };
      } else {
        logger.error(`[ModalHandler] 음성 채널 연동 구인구직 생성 실패`, {
          message: result.message,
          error: result.error,
          title: recruitmentData.title,
          voiceChannelId,
        });

        // 상세 오류 정보 활용
        let errorMessage = result.message || RecruitmentConfig.MESSAGES.LINK_FAILED;

        // 유효성 검사 오류인 경우 더 자세한 정보 제공
        if (result.error?.includes('participantPattern') || result.error?.includes('제목 형식')) {
          errorMessage +=
            `\n\n💡 **제목 형식 안내:**\n` +
            `• 올바른 형식: "게임명 1/5" 또는 "게임명 1/N"\n` +
            `• 현재인원/최대인원 형식이 포함되어야 합니다.`;
        } else if (result.error?.includes('forumChannelId') || result.error?.includes('포럼 채널')) {
          // 포럼 채널 설정 관련 오류
          errorMessage +=
            `\n\n⚙️ **설정 확인 필요:**\n` +
            `• 관리자가 포럼 채널을 설정하지 않았습니다.\n` +
            `• \`/설정\` → **관리 채널 지정** → **구인구직 포럼** 설정 필요\n` +
            `• 설정 후 다시 시도해주세요.`;
        }

        await SafeInteraction.safeReply(interaction, {
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });

        return {
          success: false,
          action: 'voiceChannel',
          error: result.error || '음성 채널 연동 실패',
        };
      }
    } catch (error) {
      logger.error('[ModalHandler] 음성 채널 연동 구인구직 처리 오류', { error: error.message, stack: error.stack });

      // 10008 에러는 메시지가 삭제되었음을 의미하므로 추가 응답을 시도하지 않음
      if (error.code === 10008) {
        logger.warn('[ModalHandler] 원본 메시지가 삭제되었음 - 추가 응답을 시도하지 않음');
        return {
          success: false,
          action: 'voiceChannel',
          error: '원본 메시지가 삭제됨',
        };
      }

      await SafeInteraction.safeReply(
        interaction,
        SafeInteraction.createErrorResponse('음성 채널 연동 구인구직 생성', error)
      );

      return {
        success: false,
        action: 'voiceChannel',
        error: error instanceof Error ? error.message : '알 수 없는 오류',
      };
    }
  }
}
