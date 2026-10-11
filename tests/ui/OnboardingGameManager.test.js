import {beforeEach, describe, expect, it, vi} from 'vitest';
import {MessageFlags, PermissionFlagsBits} from 'discord.js';

vi.mock('../../src/utils/SafeInteraction.js', () => ({SafeInteraction: {
  safeDeferReply: vi.fn(async () => {}),
  safeReply: vi.fn(async (interaction, options) => options),
  safeShowModal: vi.fn(async (interaction, modal) => modal),
}}));
vi.mock('../../src/config/commandPermissions.js', () => ({
  hasCommandPermission: vi.fn(member => Boolean(member?.canManage)),
}));

import {SafeInteraction} from '../../src/utils/SafeInteraction.js';
import {hasCommandPermission} from '../../src/config/commandPermissions.js';
import {DiscordConstants} from '../../src/config/DiscordConstants.js';
import {OnboardingGameManager} from '../../src/ui/OnboardingGameManager.js';

const IDS = DiscordConstants.CUSTOM_ID_PREFIXES;
const ROLE_A = '12345678901234567';
const ROLE_B = '12345678901234568';
const ROLE_C = '12345678901234569';

function fixture() {
  const guildId = '12345678901234570';
  const config = {
    enabled: true, category_id: 'category',
    gender_male_role_id: '12345678901234571', gender_female_role_id: '12345678901234572',
    pending_role_id: '12345678901234573', member_role_id: DiscordConstants.ROLE_IDS.MEMBER,
    stage_role_ids: {gender: '12345678901234574'},
    game_roles: [{label: '롤', roleId: ROLE_A}, {label: '발로란트', roleId: ROLE_B}],
  };
  const repository = {
    getConfig: vi.fn(async () => ({...config, game_roles: config.game_roles.map(game => ({...game}))})),
    addGameRole: vi.fn(async (guildId, label, roleId) => {
      config.game_roles = [...config.game_roles.filter(game => game.label !== label && game.roleId !== roleId), {label, roleId}];
      return config.game_roles;
    }),
    updateGameRoles: vi.fn(async (guildId, merged) => {config.game_roles = merged; return merged;}),
  };
  const bot = {permissions: {has: vi.fn(() => true)}, roles: {highest: {comparePositionTo: vi.fn(() => 1)}}};
  const guild = {id: guildId, members: {fetchMe: vi.fn(async () => bot)},
    roles: {fetch: vi.fn(async id => ({id, guild: {id: guildId}, managed: false, permissions: {has: () => false}}))}};
  const manager = new OnboardingGameManager(repository);
  const interaction = (customId, type = 'button', options = {}) => ({
    guildId, guild, user: {id: 'operator'}, member: {canManage: true}, customId,
    values: [ROLE_C], message: {embeds: manager.buildPanel(config).embeds.map(embed => embed.toJSON())},
    isButton: () => type === 'button', isRoleSelectMenu: () => type === 'select', isModalSubmit: () => type === 'modal',
    fields: {getTextInputValue: vi.fn(() => options.text || '')}, ...options,
  });
  const bulkId = () => manager.buildPanel(config).components[0].components[1].data.custom_id;
  return {config, repository, bot, guild, manager, interaction, bulkId};
}

describe('OnboardingGameManager', () => {
  let f;
  beforeEach(() => {vi.clearAllMocks(); f = fixture();});

  it('routes only game administration interactions', () => {
    expect(f.manager.isInteraction(IDS.ONBOARDING_GAME_ADD)).toBe(true);
    expect(f.manager.isInteraction('onboarding:games')).toBe(false);
    expect(f.manager.isInteraction()).toBe(false);
  });

  it.each(['button', 'select', 'modal'])('rechecks command permission for unauthorized %s actions before IO', async type => {
    const id = type === 'button' ? IDS.ONBOARDING_GAME_ADD : type === 'select' ? IDS.ONBOARDING_GAME_ROLE : `${IDS.ONBOARDING_GAME_NAME}${ROLE_C}`;
    const interaction = f.interaction(id, type, {member: {canManage: false}});
    await f.manager.handleInteraction(interaction);
    expect(hasCommandPermission).toHaveBeenCalledWith(interaction.member, '가입관리');
    expect(f.repository.getConfig).not.toHaveBeenCalled();
    expect(SafeInteraction.safeDeferReply).not.toHaveBeenCalled();
    expect(SafeInteraction.safeShowModal).not.toHaveBeenCalled();
    expect(f.repository.addGameRole).not.toHaveBeenCalled();
    expect(SafeInteraction.safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({flags: MessageFlags.Ephemeral}));
  });

  it('rejects DM and permission-removed panel requests', async () => {
    await f.manager.handleInteraction(f.interaction(IDS.ONBOARDING_GAME_ADD, 'button', {guild: null}));
    await f.manager.showPanel(f.interaction('command', 'button', {member: {canManage: false}}));
    expect(f.repository.getConfig).not.toHaveBeenCalled();
  });

  it('renders raw bulk-edit lines and bounded components with instructions', async () => {
    const result = await f.manager.showPanel(f.interaction('command'));
    const embed = result.embeds[0].toJSON();
    expect(embed.title).toBe('가입 게임 관리');
    expect(embed.description).toBe(`롤 | ${ROLE_A}\n발로란트 | ${ROLE_B}`);
    expect(embed.fields[1].value).toContain('기존 회원의 역할은 변경하지 않습니다');
    expect(result.components[0].components).toHaveLength(2);
    expect(f.bulkId().length).toBeLessThanOrEqual(100);
    expect(result.allowedMentions).toEqual({parse: []});
  });

  it('offers one role selection after deferring the add button', async () => {
    const result = await f.manager.handleInteraction(f.interaction(IDS.ONBOARDING_GAME_ADD));
    const menu = result.components[0].components[0].toJSON();
    expect(menu).toMatchObject({custom_id: IDS.ONBOARDING_GAME_ROLE, min_values: 1, max_values: 1});
    expect(SafeInteraction.safeDeferReply).toHaveBeenCalledTimes(1);
  });

  it('opens the name modal immediately after role selection, without defer or DB fetch', async () => {
    const modal = await f.manager.handleInteraction(f.interaction(IDS.ONBOARDING_GAME_ROLE, 'select'));
    expect(modal.toJSON().custom_id).toBe(`${IDS.ONBOARDING_GAME_NAME}${ROLE_C}`);
    expect(modal.toJSON().components[0].components[0]).toMatchObject({custom_id: 'game_name', max_length: 100});
    expect(SafeInteraction.safeDeferReply).not.toHaveBeenCalled();
    expect(f.repository.getConfig).not.toHaveBeenCalled();
  });

  it('opens a prefilled bulk modal immediately and does not fetch config first', async () => {
    const modal = await f.manager.handleInteraction(f.interaction(f.bulkId()));
    expect(modal.toJSON().components[0].components[0]).toMatchObject({custom_id: 'game_list', max_length: 4000,
      value: `롤 | ${ROLE_A}\n발로란트 | ${ROLE_B}`});
    expect(SafeInteraction.safeDeferReply).not.toHaveBeenCalled();
    expect(f.repository.getConfig).not.toHaveBeenCalled();
  });

  it('starts empty bulk input without copying the no-game sentinel', async () => {
    f.config.game_roles = [];
    const modal = await f.manager.handleInteraction(f.interaction(f.bulkId()));
    expect(modal.toJSON().components[0].components[0].value).toBeUndefined();
  });

  it('saves a trimmed single-game name and replaces the same label', async () => {
    await f.manager.handleInteraction(f.interaction(`${IDS.ONBOARDING_GAME_NAME}${ROLE_C}`, 'modal', {text: ' 롤 '}));
    expect(f.repository.addGameRole).toHaveBeenCalledWith(f.guild.id, '롤', ROLE_C);
    expect(f.config.game_roles).toEqual([{label: '발로란트', roleId: ROLE_B}, {label: '롤', roleId: ROLE_C}]);
    expect(SafeInteraction.safeDeferReply).toHaveBeenCalledTimes(1);
    expect(f.guild.roles.fetch).toHaveBeenCalledWith(ROLE_C);
  });

  it.each(['wrong-guild', 'everyone', 'managed', 'administrator', 'hierarchy', 'bot-permission', 'missing'])('blocks unsafe %s role selection before saving', async kind => {
    const id = kind === 'everyone' ? f.guild.id : ROLE_C;
    if (kind === 'bot-permission') f.bot.permissions.has.mockReturnValue(false);
    else if (kind === 'hierarchy') f.bot.roles.highest.comparePositionTo.mockReturnValue(0);
    else f.guild.roles.fetch.mockResolvedValueOnce(kind === 'missing' ? null : {
      id, guild: {id: kind === 'wrong-guild' ? 'other-guild' : f.guild.id}, managed: kind === 'managed',
      permissions: {has: permission => kind === 'administrator' && permission === PermissionFlagsBits.Administrator},
    });
    await f.manager.handleInteraction(f.interaction(`${IDS.ONBOARDING_GAME_NAME}${id}`, 'modal', {text: '새 게임'}));
    expect(f.repository.addGameRole).not.toHaveBeenCalled();
    expect(f.repository.updateGameRoles).not.toHaveBeenCalled();
  });

  it.each(['gender_male_role_id', 'gender_female_role_id', 'pending_role_id', 'member_role_id', 'stage'])('rejects reserved %s roles', async key => {
    const id = key === 'stage' ? f.config.stage_role_ids.gender : f.config[key];
    await f.manager.handleInteraction(f.interaction(`${IDS.ONBOARDING_GAME_NAME}${id}`, 'modal', {text: '게임'}));
    expect(f.repository.addGameRole).not.toHaveBeenCalled();
  });

  it('bulk renames and swaps names atomically while preserving omitted games', async () => {
    f.config.game_roles.push({label: '기타 게임', roleId: ROLE_C});
    const original = f.config.game_roles.map(game => ({...game}));
    await f.manager.handleInteraction(f.interaction(f.bulkId(), 'modal', {text: `발로란트 | ${ROLE_A}\n\n롤 | <@&${ROLE_B}>\n`}));
    expect(f.config.game_roles).toEqual([{label: '기타 게임', roleId: ROLE_C}, {label: '발로란트', roleId: ROLE_A}, {label: '롤', roleId: ROLE_B}]);
    expect(f.repository.updateGameRoles).toHaveBeenCalledWith(f.guild.id, f.config.game_roles, original);
    expect(f.repository.addGameRole).not.toHaveBeenCalled();
  });

  it('ignores empty bulk lines without deleting existing games', async () => {
    const original = [...f.config.game_roles];
    await f.manager.handleInteraction(f.interaction(f.bulkId(), 'modal', {text: ' \n\r\n'}));
    expect(f.config.game_roles).toEqual(original);
    expect(f.repository.updateGameRoles).not.toHaveBeenCalled();
  });

  it('leaves a new empty list unchanged when the bulk input is blank', async () => {
    f.config.game_roles = [];
    await f.manager.handleInteraction(f.interaction(f.bulkId(), 'modal', {text: ''}));
    expect(f.repository.updateGameRoles).not.toHaveBeenCalled();
    expect(SafeInteraction.safeReply.mock.calls.at(-1)[1].content).toContain('기존 목록을 유지');
  });

  it('refuses an outdated modal without validating roles or writing', async () => {
    const oldId = f.bulkId();
    f.config.game_roles.push({label: '다른 게임', roleId: ROLE_C});
    await f.manager.handleInteraction(f.interaction(oldId, 'modal', {text: `롤 | ${ROLE_A}`}));
    expect(f.guild.members.fetchMe).not.toHaveBeenCalled();
    expect(f.repository.updateGameRoles).not.toHaveBeenCalled();
    expect(SafeInteraction.safeReply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({content: expect.stringContaining('목록이 변경')}));
  });

  it('handles atomic update rejection if config changed after reading it', async () => {
    f.repository.updateGameRoles.mockResolvedValueOnce(null);
    await f.manager.handleInteraction(f.interaction(f.bulkId(), 'modal', {text: `롤 | ${ROLE_A}`}));
    expect(SafeInteraction.safeReply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({content: expect.stringContaining('역할 설정이 변경')}));
  });

  it('validates every merged role before writing, including unchanged omitted games', async () => {
    f.guild.roles.fetch.mockImplementation(async id => ({id, guild: {id: f.guild.id}, managed: id === ROLE_B, permissions: {has: () => false}}));
    await f.manager.handleInteraction(f.interaction(f.bulkId(), 'modal', {text: `롤 | ${ROLE_C}`}));
    expect(f.repository.updateGameRoles).not.toHaveBeenCalled();
    expect(f.config.game_roles).toEqual([{label: '롤', roleId: ROLE_A}, {label: '발로란트', roleId: ROLE_B}]);
  });

  it('reports a deleted Discord role without exposing the API failure', async () => {
    f.guild.roles.fetch.mockRejectedValueOnce(Object.assign(new Error('Unknown Role'), {code: 10011}));
    await f.manager.handleInteraction(f.interaction(`${IDS.ONBOARDING_GAME_NAME}${ROLE_C}`, 'modal', {text: '게임'}));
    expect(f.repository.addGameRole).not.toHaveBeenCalled();
    expect(SafeInteraction.safeReply.mock.calls.at(-1)[1].content).toContain('일반 역할을 선택');
  });

  it.each(['', '게임\n이름', '게임'.repeat(51)])('rejects invalid single-game names before role fetch', async text => {
    await f.manager.handleInteraction(f.interaction(`${IDS.ONBOARDING_GAME_NAME}${ROLE_C}`, 'modal', {text}));
    expect(f.guild.roles.fetch).not.toHaveBeenCalled();
    expect(f.repository.addGameRole).not.toHaveBeenCalled();
  });

  it('rejects malformed role selector values without deferring or showing a modal', async () => {
    await f.manager.handleInteraction(f.interaction(IDS.ONBOARDING_GAME_ROLE, 'select', {values: ['role-attacker']}));
    expect(SafeInteraction.safeDeferReply).not.toHaveBeenCalled();
    expect(SafeInteraction.safeShowModal).not.toHaveBeenCalled();
    expect(f.repository.getConfig).not.toHaveBeenCalled();
  });

  it.each([
    '형식 오류', ` | ${ROLE_A}`, `${'이름'.repeat(51)} | ${ROLE_A}`, '게임 | 잘못된역할',
    `같은이름 | ${ROLE_A}\n같은이름 | ${ROLE_B}`, `게임1 | ${ROLE_A}\n게임2 | ${ROLE_A}`,
  ])('rejects malformed bulk input without partial persistence', async text => {
    await f.manager.handleInteraction(f.interaction(f.bulkId(), 'modal', {text}));
    expect(f.repository.updateGameRoles).not.toHaveBeenCalled();
    expect(f.repository.addGameRole).not.toHaveBeenCalled();
  });

  it('enforces final merged and incoming list limits', async () => {
    const incoming = Array.from({length: 26}, (_, index) => `게임${index} | ${10000000000000000n + BigInt(index)}`).join('\n');
    await f.manager.handleInteraction(f.interaction(f.bulkId(), 'modal', {text: incoming}));
    expect(f.repository.updateGameRoles).not.toHaveBeenCalled();
    const twentyFourNew = incoming.split('\n').slice(0, 24).join('\n');
    await f.manager.handleInteraction(f.interaction(f.bulkId(), 'modal', {text: twentyFourNew}));
    expect(f.repository.updateGameRoles).not.toHaveBeenCalled();
  });

  it('does not expose SQL or unexpected internal errors in user messages', async () => {
    f.repository.addGameRole.mockRejectedValueOnce(new Error('SELECT SECRET_INTERNAL_QUERY'));
    await f.manager.handleInteraction(f.interaction(`${IDS.ONBOARDING_GAME_NAME}${ROLE_C}`, 'modal', {text: '새 게임'}));
    const lastReply = SafeInteraction.safeReply.mock.calls.at(-1)[1];
    expect(lastReply.content).not.toContain('SECRET_INTERNAL');
    expect(lastReply.content).toContain('저장하지 못했습니다');
  });
});
