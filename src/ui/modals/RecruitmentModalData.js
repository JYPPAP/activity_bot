import { RecruitmentConfig } from '../../config/RecruitmentConfig.js';
import { validateAndSanitizeInput, VALIDATION_PRESETS } from '../../utils/inputValidator.js';
import { logger } from '../../config/logger-termux.js';

/**
 * 구인구직 모달 입력의 추출과 검증을 담당한다.
 *
 * 책임:
 * - 원본 필드와 미리 모인 멤버를 파싱한다.
 * - 공통 입력 검증기를 통해 값을 정화한다.
 * - 구인구직 도메인 규칙을 공통 검증 결과에 합친다.
 *
 * Discord ID는 파싱 이후에도 문자열로 유지한다.
 */
export class RecruitmentModalData {
  extractModalData(interaction) {
    // 원본 입력값 추출
    const rawTitle = interaction.fields.getTextInputValue('recruitment_title');
    const rawTags = interaction.fields.getTextInputValue('recruitment_tags') || '';
    const rawDescription = interaction.fields.getTextInputValue('recruitment_description') || '';
    const rawPreMembers = interaction.fields.getTextInputValue('recruitment_premembers') || '';

    // 미리 모인 멤버 멘션 파싱 (<@USER_ID> 또는 <@!USER_ID> 형식)
    const preMemberIds = [];
    const mentionRegex = /<@!?(\d+)>/g;
    let mentionMatch;
    while ((mentionMatch = mentionRegex.exec(rawPreMembers)) !== null) {
      const userId = mentionMatch[1];
      if (!preMemberIds.includes(userId)) {
        preMemberIds.push(userId);
      }
    }

    // @name 형식 파싱 (예: "@무지 @현호" - <@ID> 형식 제외 후 추출)
    const preMemberNames = [];
    const rawWithoutMentions = rawPreMembers.replace(/<@!?\d+>/g, '');
    const nameRegex = /@(\S+)/g;
    let nameMatch;
    while ((nameMatch = nameRegex.exec(rawWithoutMentions)) !== null) {
      const name = nameMatch[1];
      if (!preMemberNames.includes(name)) {
        preMemberNames.push(name);
      }
    }

    // 디버깅: 추출된 원본 값들 확인
    logger.info(`[ModalHandler] 원본 입력값 추출`);
    logger.info(`  - 제목: type=${typeof rawTitle}, value="${rawTitle}", length=${rawTitle?.length || 0}`);
    logger.info(`  - 태그: type=${typeof rawTags}, value="${rawTags}", length=${rawTags?.length || 0}`);
    logger.info(`  - 설명: type=${typeof rawDescription}, value="${rawDescription}", length=${rawDescription?.length || 0}`);
    logger.info(`  - 미리 모인 멤버: raw="${rawPreMembers}", 파싱된 ID 수=${preMemberIds.length}, 파싱된 @name 수=${preMemberNames.length}, names=[${preMemberNames.join(', ')}]`);

    // 입력 검증 및 정화
    const titleValidation = validateAndSanitizeInput(rawTitle, {
      ...VALIDATION_PRESETS.TITLE,
      minLength: 3,
    });
    const tagsValidation = validateAndSanitizeInput(rawTags, {
      maxLength: 100,
      minLength: 0,
      allowUrls: false,
      strictMode: true,
      fieldName: '게임 태그'
    });
    const descriptionValidation = validateAndSanitizeInput(rawDescription, {
      maxLength: 2000,
      minLength: 0, // 선택적 필드이므로 빈 문자열 허용
      allowUrls: true,
      strictMode: false,
      fieldName: '설명'
    });

    // 정화된 데이터 사용
    const title = titleValidation.sanitizedText;
    const tags = tagsValidation.sanitizedText;
    const description = descriptionValidation.sanitizedText;

    // 태그 배열 생성 (정화된 데이터 사용)
    const tagsArray = tags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

    // 최대 참여자 수 추출 시도 (원본 텍스트 사용)
    const participantMatch = rawTitle.match(/(\d+)\/(\d+|[Nn])/);
    let maxParticipants;

    if (participantMatch) {
      const maxStr = participantMatch[2];
      if (maxStr.toLowerCase() !== 'n') {
        maxParticipants = parseInt(maxStr, 10);
      }
    }

    const domainErrors = [];
    if (!/\d+\/(\d+|[Nn])/.test(rawTitle)) {
      domainErrors.push('제목에 "현재인원/최대인원" 형식을 포함해주세요. (예: 1/5)');
    }
    if (tagsArray.length > RecruitmentConfig.MAX_SELECTED_TAGS) {
      domainErrors.push(`게임 태그는 최대 ${RecruitmentConfig.MAX_SELECTED_TAGS}개까지 선택할 수 있습니다.`);
    }

    // 검증 결과 통합
    const errors = [
      ...titleValidation.errors,
      ...tagsValidation.errors,
      ...descriptionValidation.errors,
      ...domainErrors,
    ];
    const validationResult = {
      isValid: errors.length === 0,
      errors,
      warnings: [
        ...titleValidation.warnings,
        ...tagsValidation.warnings,
        ...descriptionValidation.warnings
      ],
      hasSanitization: titleValidation.warnings.length > 0 || 
                      tagsValidation.warnings.length > 0 || 
                      descriptionValidation.warnings.length > 0
    };

    return {
      title: title.trim(),
      tags: tagsArray, // 배열로 변경하여 ForumPostManager와 타입 일치
      description: description.trim(),
      author: interaction.member || interaction.user,
      preMemberIds,    // 미리 모인 멤버 Discord ID 배열 (<@ID> 형식)
      preMemberNames,  // 미리 모인 멤버 이름 배열 (@name 형식)
      validationResult, // 검증 결과 추가
      ...(maxParticipants !== undefined && { maxParticipants }),
    };
  }
}
