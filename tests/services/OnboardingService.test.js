import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ChannelType, Collection, PermissionFlagsBits} from 'discord.js';

vi.mock('../../src/config/env.js', () => ({config: {ONBOARDING_CATEGORY_ID: ''}}));
vi.mock('../../src/config/OnboardingRules.js', () => ({
  loadOnboardingRules: vi.fn(async text => ({pages: [{title: '서버 규칙', content: text}], revision: 'rules-v1'})),
}));

vi.mock('../../src/utils/SafeInteraction.js', () => ({
  SafeInteraction: {
    safeDeferReply: vi.fn().mockResolvedValue(null),
    safeDeferUpdate: vi.fn().mockResolvedValue(null),
    safeReply: vi.fn().mockResolvedValue(null),
  },
}));

import {OnboardingService} from '../../src/services/OnboardingService.js';
import {OnboardingUIBuilder} from '../../src/ui/OnboardingUIBuilder.js';
import {SafeInteraction} from '../../src/utils/SafeInteraction.js';
import {loadOnboardingRules} from '../../src/config/OnboardingRules.js';
import {config as environment} from '../../src/config/env.js';

const fields = {
  channelId: 'channel_id', messageId: 'message_id', genderRoleId: 'gender_role_id',
  gameRoleIds: 'game_role_ids', rulesAcceptedAt: 'rules_accepted_at', appliedAt: 'applied_at',
  reviewMessageId: 'review_message_id', reviewAction: 'review_action', reviewedBy: 'reviewed_by',
  reviewedAt: 'reviewed_at', rejectionReason: 'rejection_reason', cleanupAt: 'cleanup_at', departedAt: 'departed_at',
  ruleIndex: 'rule_index', rulesRevision: 'rules_revision',
};

function createFixture() {
  const events = [];
  const config = {
    guild_id: 'guild', enabled: true, category_id: 'category', welcome_channel_id: 'welcome',
    review_channel_id: 'review', pending_role_id: 'pending-role', member_role_id: 'member-role',
    gender_male_role_id: 'male-role', gender_female_role_id: 'female-role',
    game_roles: [{label: '롤', roleId: 'lol-role'}, {label: '발로란트', roleId: 'valorant-role'}],
    stage_role_ids: {gender: 'old-gender'}, rules_text: '서로 존중해 주세요.',
  };
  const state = new Map();
  const locks = new Map();
  const repository = {
    getConfig: vi.fn(async () => ({...config})),
    getProgress: vi.fn(async (guildId, userId) => state.has(userId) ? {...state.get(userId)} : null),
    ensureProgress: vi.fn(async (guildId, userId) => {
      if (!state.has(userId)) state.set(userId, {guild_id: guildId, user_id: userId, stage: 'gender', game_role_ids: []});
      return {...state.get(userId)};
    }),
    saveProgress: vi.fn(async (guildId, userId, patch) => {
      events.push(['save', patch]);
      const progress = {...state.get(userId)};
      for (const [key, value] of Object.entries(patch)) progress[fields[key] || key] = value;
      state.set(userId, progress);
      return {...progress};
    }),
    saveWelcomeMessage: vi.fn(async (guildId, messageId) => { config.welcome_message_id = messageId; }),
    withMemberLock: vi.fn(async (guildId, userId, callback) => {
      const key = `${guildId}:${userId}`;
      const previous = locks.get(key) || Promise.resolve();
      const task = previous.catch(() => {}).then(() => callback(repository));
      locks.set(key, task);
      return task;
    }),
    getActiveProgress: vi.fn(async () => [...state.values()].filter(p => !p.departed_at
      && (p.stage !== 'approved' || p.channel_id || p.review_action))),
    getInterruptedProgress: vi.fn(async () => [...state.values()].filter(p => !p.departed_at
      && (p.review_action || (p.stage !== 'approved' && (!p.message_id || !p.channel_id))
        || (p.stage === 'pending' && !p.review_message_id)))),
    getDueCleanup: vi.fn(async () => [...state.values()].filter(p => p.cleanup_at && p.cleanup_at <= new Date())),
  };
  const channels = new Collection();
  const members = new Collection();
  let nextId = 0;
  const createChannel = (id, topic = null) => {
    const messages = new Collection();
    const channel = {id, type: ChannelType.GuildText, topic};
    const makeMessage = (payload, author = 'bot') => {
      const message = {
        id: `message-${++nextId}`, author: {id: author}, createdTimestamp: Date.now(),
        embeds: (payload.embeds || []).map(embed => embed.toJSON ? embed.toJSON() : embed),
        components: payload.components || [],
      };
      message.edit = vi.fn(async value => {
        message.embeds = (value.embeds || []).map(embed => embed.toJSON ? embed.toJSON() : embed);
        message.components = value.components || [];
        return message;
      });
      message.delete = vi.fn(async () => { events.push(['delete', message.id]); messages.delete(message.id); });
      messages.set(message.id, message);
      return message;
    };
    channel.messages = {cache: messages, fetch: vi.fn(async idOrOptions => typeof idOrOptions === 'string'
      ? messages.get(idOrOptions) || null
      : new Collection([...messages.entries()].reverse().slice(0, 100)))};
    channel.send = vi.fn(async value => {events.push(['send', id]); return makeMessage(value);});
    channel.delete = vi.fn(async () => { channels.delete(id); });
    channel.makeMessage = makeMessage;
    channels.set(id, channel);
    return channel;
  };
  const guild = {
    id: 'guild',
    channels: {
      cache: channels,
      fetch: vi.fn(async id => id ? channels.get(id) || null : channels),
      create: vi.fn(async options => {
        const channel = createChannel(`channel-${++nextId}`, options.topic);
        channel.creation = options;
        return channel;
      }),
    },
    members: {fetch: vi.fn(async id => members.get(id) || null), fetchMe: vi.fn(async () => ({roles: {highest: {comparePositionTo: () => 1}}}))},
    roles: {fetch: vi.fn(async id => ({id, managed: false, permissions: {has: () => false}}))},
  };
  const createMember = (id = 'user', admin = false) => {
    const member = {id, guild, user: {id, username: '새 회원', bot: false}, permissions: {has: () => admin}};
    member.roles = {
      cache: new Collection(),
      add: vi.fn(async ids => {for (const id of [ids].flat()) member.roles.cache.set(id, {id});}),
      remove: vi.fn(async ids => {for (const id of [ids].flat()) member.roles.cache.delete(id);}),
    };
    members.set(id, member);
    return member;
  };
  const member = createMember();
  const reviewer = createMember('admin', true);
  const welcome = createChannel('welcome');
  const review = createChannel('review');
  const client = {user: {id: 'bot'}, guilds: {cache: new Collection([['guild', guild]])}};
  const service = new OnboardingService(repository, client);
  const interaction = (customId, options = {}) => {
    const user = options.member || member;
    const progress = state.get('user');
    const channel = options.channel || channels.get(progress?.channel_id);
    return {
      guildId: guild.id, guild, member: user, user: user.user, channel, channelId: channel?.id,
      message: options.message || channel?.messages.cache.get(progress?.message_id),
      customId, values: options.values || [], deleteReply: vi.fn(async () => {}),
    };
  };
  const seed = async (patch = {}) => {
    const channel = createChannel('private', 'onboarding:guild:user');
    const progress = {
      guild_id: 'guild', user_id: 'user', stage: 'gender', channel_id: channel.id,
      game_role_ids: [], rule_index: 0, rules_revision: 'rules-v1', ...patch,
    };
    const card = channel.makeMessage(OnboardingUIBuilder.buildCard(config, progress));
    state.set('user', {...progress, message_id: card.id});
    if (progress.stage === 'pending') {
      const message = review.makeMessage(OnboardingUIBuilder.buildReview(config, progress));
      state.set('user', {...state.get('user'), review_message_id: message.id});
    }
    return channel;
  };
  const selected = {gender_role_id: 'male-role', game_role_ids: ['lol-role'], rules_accepted_at: new Date('2026-10-11T12:00:00Z')};
  return {service, repository, state, config, events, guild, client, member, reviewer, welcome, review, createChannel, createMember, interaction, seed, selected};
}

describe('OnboardingService private sessions', () => {
  let f;
  beforeEach(() => {
    vi.clearAllMocks();
    environment.ONBOARDING_CATEGORY_ID = '';
    loadOnboardingRules.mockImplementation(async text => ({pages: [{title: '서버 규칙', content: text}], revision: 'rules-v1'}));
    f = createFixture();
  });
  afterEach(() => { f.service.stop(); vi.useRealTimers(); });

  it('shows a private preview without creating channels or changing progress and roles', async () => {
    const action = f.interaction('onboarding:preview:0', {channel: f.welcome,
      message: f.welcome.makeMessage(OnboardingUIBuilder.buildWelcome(f.config))});
    await f.service.handleInteraction(action);
    expect(SafeInteraction.safeReply).toHaveBeenCalledWith(action, expect.objectContaining({flags: 64}));
    expect(f.guild.channels.create).not.toHaveBeenCalled();
    expect(f.repository.saveProgress).not.toHaveBeenCalled();
    expect(f.member.roles.add).not.toHaveBeenCalled();
    expect(f.repository.withMemberLock).not.toHaveBeenCalled();
    const navigation = f.interaction('onboarding:preview:1', {channel: f.welcome,
      message: {embeds: [{footer: {text: 'onboarding-preview'}}]}});
    await f.service.handleInteraction(navigation);
    expect(SafeInteraction.safeDeferUpdate).toHaveBeenCalledWith(navigation);
  });

  it('requires consent on each rule page and resets consent when files change', async () => {
    loadOnboardingRules.mockResolvedValue({pages: [{title: '첫째', content: '내용1'}, {title: '둘째', content: '내용2'}], revision: 'rules-v1'});
    await f.seed({stage: 'rules', ...f.selected});
    await f.service.handleInteraction(f.interaction('onboarding:rules'));
    expect(f.state.get('user')).toMatchObject({stage: 'rules', rule_index: 1});
    await f.service.handleInteraction(f.interaction('onboarding:rules'));
    expect(f.state.get('user').stage).toBe('application');
    loadOnboardingRules.mockResolvedValue({pages: [{title: '새 규칙', content: '새 내용'}], revision: 'rules-v2'});
    await f.service.handleInteraction(f.interaction('onboarding:apply'));
    expect(f.state.get('user')).toMatchObject({stage: 'rules', rule_index: 0, rules_revision: 'rules-v2', rules_accepted_at: null});
    expect(f.review.send).not.toHaveBeenCalled();
  });

  it('uses the environment category for new channels', async () => {
    environment.ONBOARDING_CATEGORY_ID = 'env-category';
    await f.service.openSession(f.member);
    expect(f.guild.channels.create).toHaveBeenCalledWith(expect.objectContaining({parent: 'env-category'}));
  });

  it('restores the rule page after restart and allows going back to reread', async () => {
    f.config.rules_pages = [{title: '첫째', content: '내용1'}, {title: '둘째', content: '내용2'}];
    loadOnboardingRules.mockResolvedValue({pages: f.config.rules_pages, revision: 'rules-v1'});
    await f.seed({stage: 'rules', rule_index: 1, ...f.selected, rules_accepted_at: null});
    await f.service.openSession(f.member);
    expect(f.state.get('user').rule_index).toBe(1);
    await f.service.handleInteraction(f.interaction('onboarding:rules:back'));
    expect(f.state.get('user')).toMatchObject({stage: 'rules', rule_index: 0, rules_accepted_at: null});
  });

  it('rejects preview outside the public onboarding channel', async () => {
    await f.seed();
    await f.service.handleInteraction(f.interaction('onboarding:preview:0'));
    expect(SafeInteraction.safeReply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({content: expect.stringContaining('가입 안내 채널')}));
    expect(f.repository.saveProgress).not.toHaveBeenCalled();
  });

  it('creates one private input-disabled session for a new member and ignores bots', async () => {
    await f.service.handleMemberAdd(f.member);
    const channel = f.guild.channels.cache.get(f.state.get('user').channel_id);
    expect(channel.creation.permissionOverwrites).toContainEqual({id: 'guild', deny: [PermissionFlagsBits.ViewChannel]});
    expect(channel.creation.permissionOverwrites.find(entry => entry.id === 'user')).toMatchObject({
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: expect.arrayContaining([PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads]),
    });
    expect(channel.messages.cache.size).toBe(1);
    await f.service.handleMemberAdd(f.member);
    expect(f.guild.channels.create).toHaveBeenCalledTimes(1);
    f.member.user.bot = true;
    await f.service.handleMemberAdd(f.member);
    expect(f.repository.ensureProgress).toHaveBeenCalledTimes(1);
  });

  it.each(['owner', 'channel', 'message'])('rejects actions without matching current %s', async mismatch => {
    await f.seed();
    const options = mismatch === 'owner' ? {member: f.reviewer}
      : mismatch === 'channel' ? {channel: f.welcome, message: {id: f.state.get('user').message_id}}
        : {message: {id: 'stale-message'}};
    await f.service.handleInteraction(f.interaction('onboarding:gender:male', options));
    expect(f.state.get('user').stage).toBe('gender');
    expect(f.repository.saveProgress).not.toHaveBeenCalled();
    expect(SafeInteraction.safeReply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({content: expect.stringContaining('현재 가입 화면')}));
  });

  it('records gender and replaces the card without granting roles before approval', async () => {
    const channel = await f.seed();
    await f.service.handleInteraction(f.interaction('onboarding:gender:male'));
    expect(f.state.get('user')).toMatchObject({stage: 'games', gender_role_id: 'male-role'});
    expect(f.member.roles.add).not.toHaveBeenCalled();
    expect(channel.messages.cache.size).toBe(1);
    expect([...channel.messages.cache.values()][0].embeds[0].title).toBe('게임 선택 · 2/4');
  });

  it('saves game choices without advancing until confirmation', async () => {
    await f.seed({stage: 'games', gender_role_id: 'male-role'});
    const oldId = f.state.get('user').message_id;
    await f.service.handleInteraction(f.interaction('onboarding:games', {values: ['lol-role', 'lol-role', 'valorant-role']}));
    expect(f.state.get('user')).toMatchObject({stage: 'games', game_role_ids: ['lol-role', 'valorant-role'], message_id: oldId});
    await f.service.handleInteraction(f.interaction('onboarding:games:confirm'));
    expect(f.state.get('user').stage).toBe('rules');
    expect(f.state.get('user').message_id).not.toBe(oldId);
  });

  it.each([['lol-role', 'attacker-role'], [], ['attacker-role']])('rejects invalid or empty injected game selections %j', async values => {
    await f.seed({stage: 'games', gender_role_id: 'male-role'});
    await f.service.handleInteraction(f.interaction('onboarding:games', {values}));
    expect(f.state.get('user').game_role_ids).toEqual([]);
    expect(f.repository.saveProgress).not.toHaveBeenCalled();
  });

  it('clears consent when editing earlier choices and requires fresh agreement', async () => {
    await f.seed({stage: 'application', ...f.selected});
    await f.service.handleInteraction(f.interaction('onboarding:back:games'));
    expect(f.state.get('user')).toMatchObject({stage: 'games', rules_accepted_at: null});
    await f.service.handleInteraction(f.interaction('onboarding:games:confirm'));
    await f.service.handleInteraction(f.interaction('onboarding:rules'));
    expect(f.state.get('user').stage).toBe('application');
    expect(f.state.get('user').rules_accepted_at).toBeInstanceOf(Date);
  });

  it('sends and persists a replacement before deleting the previous card', async () => {
    const channel = await f.seed();
    await f.service.replaceCard(channel, f.config, f.state.get('user'), f.repository);
    expect(f.events.map(event => event[0])).toEqual(['send', 'save', 'delete']);
    expect(channel.messages.cache.size).toBe(1);
  });

  it.each(['send', 'save'])('preserves the previous current card if replacement %s fails', async failure => {
    const channel = await f.seed();
    const oldId = f.state.get('user').message_id;
    if (failure === 'send') channel.send.mockRejectedValueOnce(new Error('Discord offline'));
    else f.repository.saveProgress.mockRejectedValueOnce(new Error('DB offline'));
    await expect(f.service.replaceCard(channel, f.config, f.state.get('user'), f.repository)).rejects.toThrow();
    expect(channel.messages.cache.has(oldId)).toBe(true);
    expect(f.state.get('user').message_id).toBe(oldId);
    expect(f.events.some(event => event[0] === 'delete')).toBe(false);
    if (failure === 'save') {
      await f.service.ensureCard(channel, f.config, f.state.get('user'), f.repository);
      expect(channel.messages.cache.size).toBe(1);
    }
  });

  it('recovers a failed old-card deletion while stale buttons cannot change state', async () => {
    const channel = await f.seed();
    const old = channel.messages.cache.get(f.state.get('user').message_id);
    old.delete.mockRejectedValueOnce(new Error('delete failed'));
    await f.service.handleInteraction(f.interaction('onboarding:gender:male'));
    expect(channel.messages.cache.size).toBe(2);
    await f.service.handleInteraction(f.interaction('onboarding:gender:female', {message: old}));
    expect(f.state.get('user').gender_role_id).toBe('male-role');
    await f.service.ensureCard(channel, f.config, f.state.get('user'), f.repository);
    expect(channel.messages.cache.size).toBe(1);
  });

  it('updates the public welcome message without duplicates even if its DB id is lost', async () => {
    const first = await f.service.publishWelcome(f.guild);
    f.config.welcome_message_id = null;
    const second = await f.service.publishWelcome(f.guild);
    expect(second.id).toBe(first.id);
    expect(f.welcome.send).toHaveBeenCalledTimes(1);
    expect(f.config.welcome_message_id).toBe(first.id);
  });

  it('serializes concurrent applications into one pending review message', async () => {
    await f.seed({stage: 'application', ...f.selected});
    const first = f.interaction('onboarding:apply');
    const second = f.interaction('onboarding:apply');
    await Promise.all([f.service.handleInteraction(first), f.service.handleInteraction(second)]);
    expect(f.state.get('user').stage).toBe('pending');
    expect(f.review.messages.cache.size).toBe(1);
    expect(f.member.roles.cache.has('pending-role')).toBe(true);
    expect(f.member.roles.cache.has('member-role')).toBe(false);
  });

  it.each(['permission', 'channel', 'message'])('refuses a review with invalid %s', async mismatch => {
    await f.seed({stage: 'pending', ...f.selected, applied_at: new Date()});
    const member = mismatch === 'permission' ? f.member : f.reviewer;
    const channel = mismatch === 'channel' ? f.welcome : f.review;
    const message = mismatch === 'message' ? {id: 'wrong-review'} : f.review.messages.cache.get(f.state.get('user').review_message_id);
    await f.service.handleInteraction(f.interaction('onboarding:approve:user', {member, channel, message}));
    expect(f.state.get('user').stage).toBe('pending');
    expect(f.member.roles.add).not.toHaveBeenCalled();
    expect(f.repository.ensureProgress).not.toHaveBeenCalled();
  });

  it('approves the selected roles once and records restart-safe ten-minute cleanup without reviewer progress', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T12:10:00Z'));
    await f.seed({stage: 'pending', ...f.selected, applied_at: new Date()});
    const review = f.review.messages.cache.get(f.state.get('user').review_message_id);
    const click = f.interaction('onboarding:approve:user', {member: f.reviewer, channel: f.review, message: review});
    await f.service.handleInteraction(click);
    expect(f.state.get('user')).toMatchObject({stage: 'approved', reviewed_by: 'admin', review_action: null, cleanup_at: new Date('2026-10-11T12:20:00Z')});
    expect([...f.member.roles.cache.keys()]).toEqual(['male-role', 'lol-role', 'member-role']);
    expect(review.components).toEqual([]);
    expect(f.state.has('admin')).toBe(false);
    expect(f.repository.ensureProgress).not.toHaveBeenCalled();
    await f.service.handleInteraction(click);
    expect(f.member.roles.add).toHaveBeenCalledTimes(1);
  });

  it.each(['approve', 'reject'])('allows the saved non-administrator review manager to %s', async action => {
    const manager = f.createMember('manager', false);
    f.config.review_manager_user_id = manager.id;
    await f.seed({stage: 'pending', ...f.selected, applied_at: new Date()});
    const message = f.review.messages.cache.get(f.state.get('user').review_message_id);
    await f.service.handleInteraction(f.interaction(`onboarding:${action}:user`, {member: manager, channel: f.review, message}));
    expect(f.state.get('user')).toMatchObject({stage: action === 'approve' ? 'approved' : 'application', reviewed_by: manager.id});
  });

  it('denies other non-administrators even when a review manager is configured', async () => {
    f.config.review_manager_user_id = 'manager';
    await f.seed({stage: 'pending', ...f.selected, applied_at: new Date()});
    const message = f.review.messages.cache.get(f.state.get('user').review_message_id);
    await f.service.handleInteraction(f.interaction('onboarding:approve:user', {channel: f.review, message}));
    expect(f.state.get('user').stage).toBe('pending');
    expect(f.repository.saveProgress).not.toHaveBeenCalled();
    expect(SafeInteraction.safeReply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({content: '관리자 또는 등록된 심사 담당자만 처리할 수 있습니다.'}));
  });

  it('rejects back to the editable application card and preserves the old review result', async () => {
    await f.seed({stage: 'pending', ...f.selected, applied_at: new Date()});
    const review = f.review.messages.cache.get(f.state.get('user').review_message_id);
    f.member.roles.cache.set('pending-role', {id: 'pending-role'});
    await f.service.handleInteraction(f.interaction('onboarding:reject:user', {member: f.reviewer, channel: f.review, message: review}));
    expect(f.state.get('user')).toMatchObject({stage: 'application', review_action: null, review_message_id: null, cleanup_at: null});
    expect(f.state.get('user').rejection_reason).toContain('거절');
    expect(f.member.roles.cache.has('pending-role')).toBe(false);
    expect(review.embeds[0].title).toContain('거절');
    expect(review.components).toEqual([]);
  });

  it('recovers orphan channel and card markers without creating duplicates', async () => {
    const channel = await f.seed({stage: 'games', gender_role_id: 'male-role'});
    const originalMessageId = f.state.get('user').message_id;
    f.state.set('user', {...f.state.get('user'), channel_id: null, message_id: null});
    await f.service.openSession(f.member);
    expect(f.state.get('user')).toMatchObject({channel_id: channel.id, message_id: originalMessageId, stage: 'games'});
    expect(f.guild.channels.create).not.toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('recovers an orphan review marker after its DB id is lost', async () => {
    await f.seed({stage: 'pending', ...f.selected, applied_at: new Date()});
    const id = f.state.get('user').review_message_id;
    f.state.set('user', {...f.state.get('user'), review_message_id: null});
    await f.service.openSession(f.member);
    expect(f.state.get('user').review_message_id).toBe(id);
    expect(f.review.send).not.toHaveBeenCalled();
  });

  it('does not delete unrelated channels on cleanup even if their ids were saved in progress', async () => {
    await f.seed({stage: 'approved', ...f.selected, cleanup_at: new Date(Date.now() - 1000)});
    f.state.set('user', {...f.state.get('user'), channel_id: 'welcome'});
    await f.service.maintenance();
    expect(f.welcome.delete).not.toHaveBeenCalled();
    expect(f.state.get('user').channel_id).toBe('welcome');
  });

  it('deletes only an expired owned session and clears its persisted ids', async () => {
    const channel = await f.seed({stage: 'approved', ...f.selected, cleanup_at: new Date(Date.now() - 1000)});
    await f.service.maintenance();
    expect(channel.delete).toHaveBeenCalledTimes(1);
    expect(f.state.get('user')).toMatchObject({channel_id: null, message_id: null, cleanup_at: null});
  });

  it('finishes a persisted approval action at startup', async () => {
    vi.useFakeTimers();
    await f.seed({stage: 'pending', ...f.selected, applied_at: new Date(), review_action: 'approve', reviewed_by: 'admin'});
    await f.service.initialize();
    expect(f.state.get('user')).toMatchObject({stage: 'approved', review_action: null});
    expect(f.member.roles.cache.has('member-role')).toBe(true);
    expect(f.service.cleanupTimer).not.toBeNull();
  });

  it('repairs a failed stage-card send from persisted progress during maintenance', async () => {
    const channel = await f.seed();
    channel.send.mockRejectedValueOnce(new Error('send interrupted'));
    await f.service.handleInteraction(f.interaction('onboarding:gender:male'));
    expect(f.state.get('user')).toMatchObject({stage: 'games', message_id: null});
    expect(channel.messages.cache.size).toBe(1);
    await f.service.maintenance();
    expect(f.state.get('user').message_id).not.toBeNull();
    expect(channel.messages.cache.size).toBe(1);
    expect([...channel.messages.cache.values()][0].embeds[0].title).toBe('게임 선택 · 2/4');
  });

  it.each(['approve', 'reject'])('recovers a %s after final stage was saved but review rendering failed', async action => {
    await f.seed({stage: 'pending', ...f.selected, applied_at: new Date()});
    const review = f.review.messages.cache.get(f.state.get('user').review_message_id);
    review.edit.mockRejectedValueOnce(new Error('review rendering failed'));
    await f.service.handleInteraction(f.interaction(`onboarding:${action}:user`, {
      member: f.reviewer, channel: f.review, message: review,
    }));
    expect(f.state.get('user')).toMatchObject({
      stage: action === 'approve' ? 'approved' : 'application', review_action: action, message_id: null,
    });
    const roleCalls = f.member.roles.add.mock.calls.length;
    await f.service.maintenance();
    expect(f.state.get('user').review_action).toBeNull();
    expect(f.state.get('user').message_id).not.toBeNull();
    expect(f.member.roles.add).toHaveBeenCalledTimes(roleCalls);
    expect(review.components).toEqual([]);
  });

  it.each(['managed', 'administrator', 'hierarchy', 'duplicate'])('blocks unsafe %s role assignments before submission', async type => {
    await f.seed({stage: 'application', ...f.selected});
    if (type === 'duplicate') f.config.pending_role_id = f.config.member_role_id;
    else if (type === 'hierarchy') f.guild.members.fetchMe.mockResolvedValueOnce({roles: {highest: {comparePositionTo: () => 0}}});
    else f.guild.roles.fetch.mockResolvedValueOnce({
      id: 'member-role', managed: type === 'managed', permissions: {has: () => type === 'administrator'},
    });
    await f.service.handleInteraction(f.interaction('onboarding:apply'));
    expect(f.state.get('user').stage).toBe('application');
    expect(f.member.roles.add).not.toHaveBeenCalled();
    expect(f.review.send).not.toHaveBeenCalled();
  });

  it('restores roles for approved returning members without opening another session', async () => {
    await f.seed({stage: 'approved', ...f.selected, departed_at: new Date()});
    expect(await f.service.openSession(f.member)).toBeNull();
    expect(f.state.get('user').departed_at).toBeNull();
    expect(f.member.roles.cache.has('member-role')).toBe(true);
    expect(f.guild.channels.create).not.toHaveBeenCalled();
  });

  it('restores only current valid roles when approved rejoin selections were retired or repurposed', async () => {
    await f.seed({stage: 'approved', gender_role_id: 'retired-gender',
      game_role_ids: ['retired-game', 'male-role'], rules_accepted_at: f.selected.rules_accepted_at,
      departed_at: new Date()});
    expect(await f.service.openSession(f.member)).toBeNull();
    expect([...f.member.roles.cache.keys()]).toEqual(['member-role']);
    expect(f.member.roles.add).toHaveBeenCalledWith(['member-role']);
    expect(f.guild.channels.create).not.toHaveBeenCalled();
    expect(f.state.get('user').departed_at).toBeNull();
  });

  it('cleans a departing member session but retains saved selections for rejoining', async () => {
    const channel = await f.seed({stage: 'games', ...f.selected});
    await f.service.handleMemberRemove(f.member);
    expect(channel.delete).toHaveBeenCalledTimes(1);
    expect(f.state.get('user')).toMatchObject({stage: 'games', channel_id: null, message_id: null, game_role_ids: ['lol-role']});
    expect(f.state.get('user').departed_at).toBeInstanceOf(Date);
  });

  it.each(['games', 'approved'])('retries failed %s departure deletion from the persisted recovery marker', async stage => {
    const channel = await f.seed({stage, ...f.selected});
    channel.delete.mockRejectedValueOnce(new Error('Discord delete offline'));
    await expect(f.service.handleMemberRemove(f.member)).rejects.toThrow('Discord delete offline');
    expect(f.state.get('user').message_id).toBeNull();
    expect(f.state.get('user').departed_at).toBeUndefined();
    f.guild.members.fetch.mockResolvedValue(null);
    await f.service.maintenance();
    expect(channel.delete).toHaveBeenCalledTimes(2);
    expect(f.state.get('user')).toMatchObject({channel_id: null, message_id: null, cleanup_at: null});
    expect(f.state.get('user').departed_at).toBeInstanceOf(Date);
  });
});
