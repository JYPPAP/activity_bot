import { describe, expect, it } from 'vitest';
import { OnboardingUIBuilder } from '../../src/ui/OnboardingUIBuilder.js';

const config = {
  guild_id: 'guild', gender_male_role_id: 'male-role', gender_female_role_id: 'female-role',
  member_role_id: 'member-role', rules_text: '서로 존중하고 서버 규칙을 지켜 주세요.',
  game_roles: [{ label: '롤', roleId: 'lol' }, { label: '발로란트', roleId: 'valorant' }],
};
const progress = {
  guild_id: 'guild', user_id: 'user', stage: 'games', gender_role_id: 'male-role',
  game_role_ids: ['valorant', 'removed-game'], rules_accepted_at: '2026-10-11T12:00:00Z',
  applied_at: '2026-10-11T12:01:00Z',
};
const serialize = result => ({ ...result, embeds: result.embeds.map(embed => embed.toJSON()), components: result.components.map(component => component.toJSON()) });

describe('OnboardingUIBuilder', () => {
  it('저장된 게임 선택을 복원하고 설정에서 삭제된 선택은 제외한다', () => {
    const card = serialize(OnboardingUIBuilder.buildCard(config, progress));
    const select = card.components[0].components[0];
    expect(select.custom_id).toBe('onboarding:games');
    expect(select.min_values).toBe(1);
    expect(select.max_values).toBe(2);
    expect(select.options.map(option => [option.value, option.default])).toEqual([['lol', false], ['valorant', true]]);
    expect(card.components[1].components[1]).toMatchObject({ custom_id: 'onboarding:games:confirm', disabled: false });
    expect(card.embeds[0].fields.find(field => field.name === '선택한 게임').value).toBe('발로란트');
    expect(card.embeds[0].footer.text).toBe('onboarding-card:guild:user');
    expect(card.allowedMentions).toEqual({ parse: [] });
  });

  it('유효한 게임 선택이 없으면 선택 완료를 막고 빈 설정도 처리한다', () => {
    const card = serialize(OnboardingUIBuilder.buildCard(config, { ...progress, game_role_ids: ['removed-game'] }));
    expect(card.components[1].components[1].disabled).toBe(true);
    const empty = serialize(OnboardingUIBuilder.buildCard({ ...config, game_roles: [] }, progress));
    expect(empty.components).toHaveLength(1);
    expect(empty.components[0].components[1].disabled).toBe(true);
    expect(empty.embeds[0].description).toContain('등록된 게임이 없습니다');
  });

  it('게임 메뉴와 요약이 Discord 크기 제한을 넘지 않는다', () => {
    const games = Array.from({ length: 30 }, (_, index) => ({ label: '게임'.repeat(40), roleId: `game-${index}` }));
    const card = serialize(OnboardingUIBuilder.buildCard({ ...config, game_roles: games }, { ...progress, game_role_ids: games.map(game => game.roleId) }));
    expect(card.components[0].components[0].options).toHaveLength(25);
    expect(card.components[0].components[0].max_values).toBe(25);
    expect(card.embeds[0].fields[1].value.length).toBeLessThanOrEqual(1024);
  });

  it('성별 버튼과 규칙 안내에 올바른 동작을 연결한다', () => {
    const gender = serialize(OnboardingUIBuilder.buildCard(config, { ...progress, stage: 'gender' }));
    expect(gender.components[0].components.map(button => button.custom_id)).toEqual(['onboarding:gender:male', 'onboarding:gender:female']);
    const rules = serialize(OnboardingUIBuilder.buildCard(config, { ...progress, stage: 'rules' }));
    expect(rules.embeds[0].description).toBe(config.rules_text);
    expect(rules.components[0].components.map(button => button.custom_id)).toEqual(['onboarding:back:games', 'onboarding:rules']);
  });

  it('최종 확인에 선택 내용, 수정 버튼과 관리자 거절 사유를 표시한다', () => {
    const card = serialize(OnboardingUIBuilder.buildCard(config, { ...progress, stage: 'application', rejection_reason: '내용을 확인해 주세요.' }));
    expect(card.embeds[0].fields.map(field => field.value)).toEqual(['남성', '발로란트', '동의 완료', '내용을 확인해 주세요.']);
    expect(card.components[0].components.map(button => button.custom_id)).toEqual(['onboarding:back:gender', 'onboarding:back:games', 'onboarding:apply']);
  });

  it('심사 대기에서는 입력 버튼이 없고 승인 후에는 정리 시각과 닫기를 표시한다', () => {
    expect(OnboardingUIBuilder.buildCard(config, { ...progress, stage: 'pending' }).components).toEqual([]);
    const card = serialize(OnboardingUIBuilder.buildCard(config, { ...progress, stage: 'approved', cleanup_at: '2026-10-11T12:11:00Z' }));
    expect(card.components[0].components[0].custom_id).toBe('onboarding:close');
    expect(card.embeds[0].fields[0].value).toContain(':R>');
  });

  it('심사 메시지에 복구용 신청 시각과 처리 버튼을 넣고 처리 후에는 버튼을 제거한다', () => {
    const review = serialize(OnboardingUIBuilder.buildReview(config, progress));
    expect(review.embeds[0].footer.text).toBe('onboarding-review:guild:user:2026-10-11T12:01:00.000Z');
    expect(review.embeds[0].description).toContain('<@user>');
    expect(review.components[0].components.map(button => button.custom_id)).toEqual(['onboarding:approve:user', 'onboarding:reject:user']);
    expect(review.allowedMentions.parse).toEqual([]);
    const reviewed = serialize(OnboardingUIBuilder.buildReviewed(config, { ...progress, stage: 'approved', reviewed_by: 'admin', reviewed_at: '2026-10-11T12:02:00Z' }));
    expect(reviewed.components).toEqual([]);
    expect(reviewed.embeds[0].title).toContain('승인 완료');
    expect(reviewed.embeds[0].fields.find(field => field.name === '처리자').value).toBe('<@admin>');
  });

  it('공용 안내에서는 가입 시작과 이어하기 버튼을 제공한다', () => {
    const welcome = serialize(OnboardingUIBuilder.buildWelcome());
    expect(welcome.components[0].components[0]).toMatchObject({ custom_id: 'onboarding:start', label: '가입 시작 / 이어하기' });
    expect(welcome.allowedMentions.parse).toEqual([]);
  });
});
