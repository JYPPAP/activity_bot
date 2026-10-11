import { describe, expect, it } from 'vitest';
import { OnboardingUIBuilder } from '../../src/ui/OnboardingUIBuilder.js';
import {ButtonStyle} from 'discord.js';

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
  it('게임 복수 선택을 모두 복원하고 체크 표시로 선택 내용을 보여준다', () => {
    const card = serialize(OnboardingUIBuilder.buildCard(config, {...progress, game_role_ids: ['lol', 'valorant']}));
    const menu = card.components[0].components[0];
    expect(menu.max_values).toBe(2);
    expect(menu.options.every(option => option.default)).toBe(true);
    expect(card.embeds[0].fields.find(field => field.name === '선택한 게임').value).toBe('☑️ 롤\n☑️ 발로란트');
    expect(card.embeds[0].title).toBe('게임 선택 · 2/4');
  });

  it('저장된 게임 선택을 복원하고 설정에서 삭제된 선택은 제외한다', () => {
    const card = serialize(OnboardingUIBuilder.buildCard(config, progress));
    const select = card.components[0].components[0];
    expect(select.custom_id).toBe('onboarding:games');
    expect(select.min_values).toBe(1);
    expect(select.max_values).toBe(2);
    expect(select.options.map(option => [option.value, option.default])).toEqual([['lol', false], ['valorant', true]]);
    expect(card.components[1].components[1]).toMatchObject({ custom_id: 'onboarding:games:confirm', disabled: false });
    expect(card.embeds[0].fields.find(field => field.name === '선택한 게임').value).toBe('☑️ 발로란트');
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
    expect(gender.components[0].components[0]).toMatchObject({style: ButtonStyle.Primary, emoji: {name: '♂️'}});
    expect(gender.components[0].components[1]).toMatchObject({style: ButtonStyle.Success, emoji: {name: '♀️'}});
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

  it('규칙 문서별 내용과 위치, 이전 규칙 및 마지막 동의 버튼을 표시한다', () => {
    const multi = {...config, rules_pages: [
      {title: '기본 규칙', content: '첫 번째 규칙입니다.'},
      {title: '활동 규칙', content: '두 번째 규칙입니다.'},
    ]};
    const first = serialize(OnboardingUIBuilder.buildCard(multi, {...progress, stage: 'rules'}));
    expect(first.embeds[0]).toMatchObject({title: '규칙 확인 · 3/4', author: {name: '규칙 1/2 · 기본 규칙'}, description: '첫 번째 규칙입니다.'});
    expect(first.embeds[0].fields[0].value).toContain('다음 규칙으로 이동');
    expect(first.components[0].components.map(button => button.custom_id)).toEqual(['onboarding:back:games', 'onboarding:rules']);
    expect(first.components[0].components[1].label).toBe('동의하고 다음 규칙');
    const last = serialize(OnboardingUIBuilder.buildCard(multi, {...progress, stage: 'rules', rule_index: 1}));
    expect(last.embeds[0].description).toBe('두 번째 규칙입니다.');
    expect(last.components[0].components[1].custom_id).toBe('onboarding:rules:back');
    expect(last.components[0].components[2]).toMatchObject({label: '동의하고 최종 확인', style: ButtonStyle.Success, emoji: {name: '✅'}});
    expect(last.embeds[0].author.name).toBe('규칙 2/2 · 활동 규칙');
    expect(last.embeds[0].fields[0].value).toContain('마지막 규칙');
  });

  it('긴 규칙 제목은 Discord 제한에 맞추고 잘못된 문서 순서는 거부한다', () => {
    const multi = {...config, rules_pages: [{title: '긴 제목'.repeat(100), content: '규칙'}]};
    const card = serialize(OnboardingUIBuilder.buildCard(multi, {...progress, stage: 'rules'}));
    expect(card.embeds[0].title.length).toBeLessThanOrEqual(256);
    expect(card.embeds[0].author.name.length).toBeLessThanOrEqual(256);
    expect(() => OnboardingUIBuilder.buildCard(multi, {...progress, stage: 'rules', rule_index: 1})).toThrow(RangeError);
  });

  it('공용 안내에 과정과 규칙 문서 수, 미리보기 버튼을 제공한다', () => {
    const welcome = serialize(OnboardingUIBuilder.buildWelcome({...config, rules_pages: [{title: '규칙', content: '내용'}]}));
    expect(welcome.embeds[0].fields[0].value).toContain('(1개 문서)');
    expect(welcome.components[0].components[1].custom_id).toBe('onboarding:preview:0');
  });

  it('미리보기에서는 실제 입력을 모두 막고 성별·게임·규칙 문서·신청 순으로 이동한다', () => {
    const multi = {...config, rules_pages: [
      {title: '기본 규칙', content: '첫 문서'},
      {title: '활동 규칙', content: '둘째 문서'},
    ]};
    for (let index = 0; index < 5; index++) {
      const preview = serialize(OnboardingUIBuilder.buildPreview(multi, index));
      expect(preview.embeds[0].title).toBe(['미리보기 · 성별 선택 · 1/4', '미리보기 · 게임 선택 · 2/4',
        '미리보기 · 규칙 확인 · 3/4', '미리보기 · 규칙 확인 · 3/4', '미리보기 · 최종 확인 · 4/4'][index]);
      expect(preview.embeds[0].footer.text).toBe('onboarding-preview');
      expect(preview.embeds[0].fields.at(-1).value).toContain('저장되지 않고');
      expect(preview.components.length).toBeLessThanOrEqual(5);
      const controls = preview.components.at(-1).components;
      expect(controls[0].disabled).toBe(index === 0);
      expect(controls[1].disabled).toBe(index === 4);
      for (const actionRow of preview.components.slice(0, -1)) {
        for (const component of actionRow.components) expect(component.disabled).toBe(true);
      }
    }
    expect(serialize(OnboardingUIBuilder.buildPreview(multi, 2)).embeds[0].description).toBe('첫 문서');
    expect(serialize(OnboardingUIBuilder.buildPreview(multi, 3)).embeds[0].description).toBe('둘째 문서');
    const application = serialize(OnboardingUIBuilder.buildPreview(multi, 4));
    expect(application.embeds[0].fields.map(field => field.value)).toEqual(expect.arrayContaining(['남성', '롤', '동의 완료']));
    expect(() => OnboardingUIBuilder.buildPreview(multi, -1)).toThrow(RangeError);
    expect(() => OnboardingUIBuilder.buildPreview(multi, 5)).toThrow(RangeError);
  });
});
