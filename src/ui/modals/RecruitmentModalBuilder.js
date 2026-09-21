import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { DiscordConstants } from '../../config/DiscordConstants.js';
import { SafeInteraction } from '../../utils/SafeInteraction.js';
import { logger } from '../../config/logger-termux.js';

/**
 * 구인구직 모달의 필드와 ActionRow를 구성하고 표시한다.
 *
 * 책임:
 * - 음성 채널 연동 모달을 표시한다.
 * - 독립 구인구직 모달을 표시한다.
 * - 선택된 역할 태그를 기본 입력값으로 구성한다.
 * - 특수 구인구직 customId에서 태그를 추출한다.
 *
 * 표시 실패 시 기존 SafeInteraction 응답과 로그를 그대로 사용한다.
 */
export class RecruitmentModalBuilder {
  constructor({ parent }) { this.parent = parent; }
  async showRecruitmentModal(interaction, voiceChannelId, selectedRoles = []) {
    try {
      const modal = new ModalBuilder()
        .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_MODAL}${voiceChannelId}`)
        .setTitle('새 구인구직 포럼 생성');

      const fields = RecruitmentModalBuilder.createModalFields(selectedRoles);
      const actionRows = RecruitmentModalBuilder.createActionRows(fields);

      modal.addComponents(...actionRows);

      await SafeInteraction.safeShowModal(interaction, modal);
    } catch (error) {
      logger.error('[ModalHandler] 모달 표시 오류', { error: error.message, stack: error.stack });
      await SafeInteraction.safeReply(
        interaction,
        SafeInteraction.createErrorResponse('모달 표시', {
          code: 0,
          message: error instanceof Error ? error.message : '알 수 없는 오류',
          status: 500,
          method: 'MODAL_DISPLAY',
          url: 'internal',
          rawError: error,
          requestBody: {},
          name: 'DiscordAPIError',
        })
      );
    }
  }
  async showStandaloneRecruitmentModal(interaction, selectedRoles = []) {
    try {
      const modal = new ModalBuilder()
        .setCustomId('standalone_recruitment_modal')
        .setTitle('구인구직 포럼 생성');

      const fields = RecruitmentModalBuilder.createModalFields(selectedRoles);
      const actionRows = RecruitmentModalBuilder.createActionRows(fields);

      modal.addComponents(...actionRows);

      await SafeInteraction.safeShowModal(interaction, modal);
    } catch (error) {
      logger.error('[ModalHandler] 독립 모달 표시 오류', { error: error.message, stack: error.stack });
      await SafeInteraction.safeReply(
        interaction,
        SafeInteraction.createErrorResponse('모달 표시', {
          code: 0,
          message: error instanceof Error ? error.message : '알 수 없는 오류',
          status: 500,
          method: 'MODAL_DISPLAY',
          url: 'internal',
          rawError: error,
          requestBody: {},
          name: 'DiscordAPIError',
        })
      );
    }
  }
  static createModalFields(selectedRoles, customTitleLabel = null) {
    const tagsValue = selectedRoles.length > 0 ? selectedRoles.join(', ') : '';

    return [
      {
        customId: 'recruitment_title',
        label: customTitleLabel || '제목 (현재 인원/최대 인원) 필수',
        placeholder: '예: 칼바람 1/5 오후 8시',
        style: TextInputStyle.Short,
        required: true,
        maxLength: DiscordConstants.LIMITS.MODAL_TITLE_MAX,
        minLength: 3,
      },
      {
        customId: 'recruitment_tags',
        label: '게임 태그 (수정 가능)',
        placeholder: '예: 롤, 배그, 옵치, 발로, 스팀',
        style: TextInputStyle.Short,
        required: false,
        maxLength: 100,
        value: tagsValue,
      },
      {
        customId: 'recruitment_description',
        label: '상세 설명',
        placeholder: '게임 모드, 티어, 기타 요구사항 등을 자유롭게 작성해주세요.',
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: DiscordConstants.LIMITS.MODAL_DESCRIPTION_MAX,
        minLength: 0,
      },
      {
        customId: 'recruitment_premembers',
        label: '미리 모인 멤버 (선택)',
        placeholder: '닉네임을 @로 구분해서 입력 예) @무지 @현호',
        style: TextInputStyle.Short,
        required: false,
        maxLength: 500,
        minLength: 0,
      },
    ];
  }
  static createActionRows(fields) {
    return fields.map((field) => {
      const textInput = new TextInputBuilder()
        .setCustomId(field.customId)
        .setLabel(field.label)
        .setStyle(field.style)
        .setPlaceholder(field.placeholder)
        .setRequired(field.required)
        .setMaxLength(field.maxLength);

      if (field.minLength !== undefined) {
        textInput.setMinLength(field.minLength);
      }

      if (field.value) {
        textInput.setValue(field.value);
      }

      return new ActionRowBuilder().addComponents(textInput);
    });
  }
  extractTagsFromCustomId(customId) {
    const tagsMatch = customId.match(/_tags_(.+)$/);
    if (tagsMatch && tagsMatch[1]) {
      return tagsMatch[1].split(',');
    }
    return [];
  }
}
