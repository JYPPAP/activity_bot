import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModalHandler } from '../../src/ui/ModalHandler.js';

describe('ModalHandler', () => {
  let recruitmentService;
  let handler;

  beforeEach(() => {
    recruitmentService = {
      handleSpecialRecruitmentModalSubmit: vi.fn().mockResolvedValue(undefined),
    };
    handler = new ModalHandler(recruitmentService, {});
  });

  it('customId의 태그 목록을 추출한다', () => {
    expect(handler.extractTagsFromCustomId(
      'scrimmage_recruitment_modal_tags_tank,support'
    )).toEqual(['tank', 'support']);
  });

  it('태그가 없는 customId에서는 빈 목록을 반환한다', () => {
    expect(handler.extractTagsFromCustomId('scrimmage_recruitment_modal')).toEqual([]);
  });

  it('재시도 가능한 오류 코드를 판별한다', () => {
    expect(handler.shouldRetryError({ code: 503, message: 'server error' }, 1)).toBe(true);
  });

  it('재시도 불가능한 오류를 판별한다', () => {
    expect(handler.shouldRetryError({ code: 50013, message: 'Missing Permissions' }, 1)).toBe(false);
  });

  it('최대 시도 횟수를 넘으면 재시도하지 않는다', () => {
    expect(handler.shouldRetryError({ code: 503, message: 'server error' }, 4)).toBe(false);
  });

  it('내전 모달 제출을 scrimmage 타입과 태그로 전달한다', async () => {
    const interaction = {
      customId: 'scrimmage_recruitment_modal_tags_tank,support',
    };

    await handler.handleModalSubmit(interaction);

    expect(recruitmentService.handleSpecialRecruitmentModalSubmit)
      .toHaveBeenCalledWith(interaction, 'scrimmage', ['tank', 'support']);
  });

  it('초기 통계에 제출 수 0을 제공한다', () => {
    expect(handler.getModalStatistics()).toMatchObject({ totalSubmissions: 0 });
  });

  it('제출 디스패처와 통계 모듈이 같은 상태를 공유한다', async () => {
    await handler.handleModalSubmit({ customId: 'scrimmage_recruitment_modal' });

    expect(handler.getModalStatistics().totalSubmissions).toBe(1);
    expect(handler.stats.modalStats.totalSubmissions).toBe(1);
  });
});
