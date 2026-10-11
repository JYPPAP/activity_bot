import { describe, expect, it } from 'vitest';
import { RecruitmentConfig } from '../../../src/config/RecruitmentConfig.js';
import { RecruitmentModalData } from '../../../src/ui/modals/RecruitmentModalData.js';

function createInteraction({ title = '1/5 같이해요', tags = '', description = '' } = {}) {
  const values = {
    recruitment_title: title,
    recruitment_tags: tags,
    recruitment_description: description,
    recruitment_premembers: '',
  };

  return {
    fields: { getTextInputValue: (name) => values[name] },
    member: { id: 'member-1' },
    user: { id: 'user-1' },
  };
}

describe('RecruitmentModalData', () => {
  const data = new RecruitmentModalData();

  it('인원 형식이 없는 제목을 공통 검증 결과에서 거부한다', () => {
    const result = data.extractModalData(createInteraction({ title: '같이해요' }));

    expect(result.validationResult.isValid).toBe(false);
    expect(result.validationResult.errors).toContain(
      '제목에 "현재인원/최대인원" 형식을 포함해주세요. (예: 1/5)'
    );
  });

  it('허용 개수를 넘는 태그를 공통 검증 결과에서 거부한다', () => {
    const tags = Array.from(
      { length: RecruitmentConfig.MAX_SELECTED_TAGS + 1 },
      (_, index) => `tag${index}`
    ).join(',');
    const result = data.extractModalData(createInteraction({ tags }));

    expect(result.validationResult.isValid).toBe(false);
    expect(result.validationResult.errors).toContain(
      `게임 태그는 최대 ${RecruitmentConfig.MAX_SELECTED_TAGS}개까지 선택할 수 있습니다.`
    );
  });
});
