import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ChannelType, Collection, MessageFlags, OverwriteType, PermissionFlagsBits, PermissionsBitField} from 'discord.js';

vi.mock('../../src/utils/SafeInteraction.js', () => ({
  SafeInteraction: {safeDeferReply: vi.fn().mockResolvedValue(null), safeReply: vi.fn().mockResolvedValue(null)}
}));
vi.mock('../../src/config/OnboardingRules.js', () => ({loadOnboardingRules: vi.fn()}));

import {OnboardingManagementCommand} from '../../src/commands/OnboardingManagementCommand.js';
import {SafeInteraction} from '../../src/utils/SafeInteraction.js';
import {loadOnboardingRules} from '../../src/config/OnboardingRules.js';
import {config as environment} from '../../src/config/env.js';

describe('OnboardingManagementCommand', () => {
  let interaction, repository, service, gameManager, channels, roles, bot, command;
  const welcomeId = '1459874768449699861';
  const memberId = '1243633748344438855';
  const allowed = () => new PermissionsBitField(PermissionsBitField.All);
  const expectValidationError = async content => {
    await command.execute(interaction);
    expect(SafeInteraction.safeReply).toHaveBeenCalledWith(interaction, {
      content: expect.stringContaining(content), flags: MessageFlags.Ephemeral
    });
  };

  beforeEach(() => {
    environment.ONBOARDING_CATEGORY_ID = '';
    loadOnboardingRules.mockImplementation(legacy => {
      if (!legacy?.trim()) throw new Error('실제 서버 규칙을 입력해 주세요.');
      return {pages: [{title: '서버 규칙', content: legacy}], revision: 'legacy'};
    });
    const guild = {id: 'guild-1'};
    roles = new Collection(['guild-1', 'male', 'female', 'pending', memberId, 'game', 'legacy-stage']
      .map(id => [id, {id, guild, managed: false, permissions: new PermissionsBitField()}]));
    bot = {id: 'bot', permissions: allowed(), roles: {highest: {comparePositionTo: vi.fn().mockReturnValue(1)}}};
    channels = new Collection([welcomeId, 'category', 'review'].map(id => [id, {
      id, guild, type: id === 'category' ? ChannelType.GuildCategory : ChannelType.GuildText,
      permissionOverwrites: {edit: vi.fn().mockResolvedValue(null), cache: new Collection()},
      permissionsFor: vi.fn(subject => subject === bot || id !== 'review' ? allowed() : new PermissionsBitField())
    }]));
    guild.channels = {fetch: vi.fn(async id => channels.get(id))};
    guild.roles = {everyone: roles.get(guild.id), fetch: vi.fn(async id => id ? roles.get(id) : roles)};
    guild.members = {fetchMe: vi.fn().mockResolvedValue(bot), fetch: vi.fn()};
    const selectedRoles = {남성역할: 'male', 여성역할: 'female', 대기역할: 'pending', 역할: 'game'};
    interaction = {
      guildId: guild.id, guild, user: {id: 'admin'},
      member: {id: 'admin', roles: {cache: new Collection([['admin', {name: '사장'}]])}},
      options: {
        getSubcommand: vi.fn().mockReturnValue('설정'),
        getRole: vi.fn(name => roles.get(selectedRoles[name])),
        getChannel: vi.fn(name => channels.get(name === '가입카테고리' ? 'category' : 'review')),
        getString: vi.fn(name => name === '규칙' ? '서로 존중해 주세요.' : '롤')
      }
    };
    repository = {
      getConfig: vi.fn().mockResolvedValue({enabled: true, category_id: 'category', stage_role_ids: {gender: 'legacy-stage'}, game_roles: []}),
      saveConfig: vi.fn().mockResolvedValue({}), addGameRole: vi.fn().mockResolvedValue([{}])
    };
    service = {publishWelcome: vi.fn().mockResolvedValue({id: 'entry'}), restrictWelcome: vi.fn().mockResolvedValue()};
    gameManager = {showPanel: vi.fn().mockResolvedValue(null)};
    command = new OnboardingManagementCommand(repository, service, gameManager);
  });

  it('denies management without privileged role', async () => {
    interaction.member.roles.cache.clear();
    await command.execute(interaction);
    expect(repository.saveConfig).not.toHaveBeenCalled();
    expect(interaction.guild.members.fetchMe).not.toHaveBeenCalled();
  });

  it('saves private-channel configuration after restoring read-only welcome access', async () => {
    await command.execute(interaction);
    expect(repository.saveConfig).toHaveBeenCalledWith('guild-1', {
      welcomeChannelId: welcomeId, categoryId: 'category', reviewChannelId: 'review', reviewManagerUserId: 'admin',
      maleRoleId: 'male', femaleRoleId: 'female', pendingRoleId: 'pending', memberRoleId: memberId,
      rulesText: '서로 존중해 주세요.'
    });
    const edit = channels.get(welcomeId).permissionOverwrites.edit;
    expect(edit).toHaveBeenCalledWith(roles.get('guild-1'), {ViewChannel: true, SendMessages: false});
    expect(edit).toHaveBeenCalledWith('legacy-stage', {ViewChannel: null, SendMessages: false});
    expect(edit.mock.invocationCallOrder.at(-1)).toBeLessThan(repository.saveConfig.mock.invocationCallOrder[0]);
    expect(channels.get('category').permissionOverwrites.edit).not.toHaveBeenCalled();
    expect(channels.get('review').permissionOverwrites.edit).toHaveBeenCalledWith('admin', {ViewChannel: true, ReadMessageHistory: true});
  });

  it.each(['male', 'female', 'pending', memberId])('rejects uneditable role %s before permission writes', async id => {
    bot.roles.highest.comparePositionTo.mockImplementation(role => role.id === id ? 0 : 1);
    await expectValidationError('역할을 확인');
    expect(repository.saveConfig).not.toHaveBeenCalled();
    expect(channels.get(welcomeId).permissionOverwrites.edit).not.toHaveBeenCalled();
  });

  it.each(['managed', 'administrator', 'everyone', 'duplicate'])('rejects unsafe roles: %s', async kind => {
    if (kind === 'managed') roles.get('male').managed = true;
    if (kind === 'administrator') roles.get('male').permissions = allowed();
    if (kind === 'everyone') interaction.options.getRole.mockImplementation(() => roles.get('guild-1'));
    if (kind === 'duplicate') interaction.options.getRole.mockImplementation(() => roles.get('male'));
    await expectValidationError(kind === 'duplicate' || kind === 'everyone' ? '서로 달라야' : '역할을 확인');
    expect(repository.saveConfig).not.toHaveBeenCalled();
  });

  it('rejects public review channels without mutating permissions', async () => {
    channels.get('review').permissionsFor.mockReturnValue(allowed());
    await expectValidationError('일반 역할');
    expect(repository.saveConfig).not.toHaveBeenCalled();
    expect(channels.get(welcomeId).permissionOverwrites.edit).not.toHaveBeenCalled();
  });

  it('rejects review channels with an explicit regular-member access grant', async () => {
    const user = {id: 'regular', permissions: new PermissionsBitField()};
    channels.get('review').permissionOverwrites.cache.set(user.id, {id: user.id, type: OverwriteType.Member});
    interaction.guild.members.fetch.mockResolvedValue(user);
    channels.get('review').permissionsFor.mockImplementation(subject => subject === bot || subject === user ? allowed() : new PermissionsBitField());
    await expectValidationError('일반 사용자');
    expect(repository.saveConfig).not.toHaveBeenCalled();
  });

  it('allows the bot-owned managed role to access the review channel', async () => {
    const botRole = {id: 'bot-role', guild: interaction.guild, tags: {botId: bot.id}, managed: true, permissions: new PermissionsBitField()};
    roles.set(botRole.id, botRole);
    channels.get('review').permissionsFor.mockImplementation(subject => subject === bot || subject === botRole ? allowed() : new PermissionsBitField());
    await command.execute(interaction);
    expect(repository.saveConfig).toHaveBeenCalledOnce();
  });

  it('allows existing caller-only access and registers a reviewer without Administrator', async () => {
    const caller = {id: interaction.user.id, permissions: new PermissionsBitField()};
    channels.get('review').permissionOverwrites.cache.set(caller.id, {id: caller.id, type: OverwriteType.Member});
    channels.get('review').permissionsFor.mockImplementation(subject => subject === bot || subject === caller ? allowed() : new PermissionsBitField());
    await command.execute(interaction);
    expect(interaction.guild.members.fetch).not.toHaveBeenCalledWith(caller.id);
    expect(channels.get('review').permissionOverwrites.edit).toHaveBeenCalledWith(caller.id, {ViewChannel: true, ReadMessageHistory: true});
    expect(repository.saveConfig).toHaveBeenCalledWith('guild-1', expect.objectContaining({reviewManagerUserId: caller.id}));
  });

  it('does not save reviewer configuration when private reviewer access cannot be granted', async () => {
    channels.get('review').permissionOverwrites.edit.mockRejectedValue(new Error('Missing reviewer permissions'));
    await expect(command.execute(interaction)).rejects.toThrow('Missing reviewer permissions');
    expect(repository.saveConfig).not.toHaveBeenCalled();
    expect(channels.get(welcomeId).permissionOverwrites.edit).not.toHaveBeenCalled();
  });

  it('checks review overwrite-edit permission before trying to grant reviewer access', async () => {
    const reviewPermissions = allowed().remove([PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageRoles]);
    channels.get('review').permissionsFor.mockImplementation(subject => subject === bot ? reviewPermissions : new PermissionsBitField());
    await expectValidationError('채널별 권한');
    expect(channels.get('review').permissionOverwrites.edit).not.toHaveBeenCalled();
    expect(repository.saveConfig).not.toHaveBeenCalled();
  });

  it('does not activate configuration when welcome permission updates fail', async () => {
    channels.get(welcomeId).permissionOverwrites.edit.mockRejectedValue(new Error('Missing permissions'));
    await expect(command.execute(interaction)).rejects.toThrow('Missing permissions');
    expect(repository.saveConfig).not.toHaveBeenCalled();
  });

  it.each(['category', 'review', welcomeId])('rejects missing bot permissions in %s', async id => {
    channels.get(id).permissionsFor.mockReturnValue(new PermissionsBitField());
    await expectValidationError('채널별 권한');
    expect(repository.saveConfig).not.toHaveBeenCalled();
  });

  it('explains missing rules files and empty legacy server rules', async () => {
    interaction.options.getString.mockReturnValue('  ');
    await expectValidationError('서버 규칙');
    expect(repository.saveConfig).not.toHaveBeenCalled();
  });

  it('uses configured environment category before dropdown and persisted category', async () => {
    environment.ONBOARDING_CATEGORY_ID = 'category';
    interaction.options.getChannel.mockImplementation(name => name === '가입카테고리' ? {id: 'ignored'} : channels.get('review'));
    await command.execute(interaction);
    expect(repository.saveConfig).toHaveBeenCalledWith('guild-1', expect.objectContaining({categoryId: 'category'}));
    expect(interaction.guild.channels.fetch).not.toHaveBeenCalledWith('ignored');
  });

  it('reuses stored category and rules when optional inputs are absent', async () => {
    repository.getConfig.mockResolvedValue({category_id: 'category', rules_text: '저장된 규칙'});
    interaction.options.getString.mockReturnValue(null);
    interaction.options.getChannel.mockImplementation(name => name === '가입카테고리' ? null : channels.get('review'));
    await command.execute(interaction);
    expect(loadOnboardingRules).toHaveBeenCalledWith('저장된 규칙');
    expect(repository.saveConfig).toHaveBeenCalledWith('guild-1', expect.objectContaining({categoryId: 'category', rulesText: '저장된 규칙'}));
  });

  it('saves valid file rules when optional legacy rules are absent', async () => {
    loadOnboardingRules.mockReturnValue({pages: [{title: '규칙 1', content: '파일 규칙'}], revision: 'files'});
    interaction.options.getString.mockReturnValue(null);
    await command.execute(interaction);
    expect(repository.saveConfig).toHaveBeenCalledWith('guild-1', expect.objectContaining({rulesText: ''}));
  });

  it('explains missing category before channel permission mutations', async () => {
    repository.getConfig.mockResolvedValue(null);
    interaction.options.getChannel.mockImplementation(name => name === '가입카테고리' ? null : channels.get('review'));
    await expectValidationError('ONBOARDING_CATEGORY_ID');
    expect(repository.saveConfig).not.toHaveBeenCalled();
    expect(channels.get(welcomeId).permissionOverwrites.edit).not.toHaveBeenCalled();
  });

  it('explains malformed rule files and does not silently replace them with legacy text', async () => {
    loadOnboardingRules.mockImplementation(() => { throw new Error('01-rules.md: 3500자 초과'); });
    await expectValidationError('01-rules.md');
    expect(repository.saveConfig).not.toHaveBeenCalled();
  });

  it('rejects setup roles already assigned as games', async () => {
    repository.getConfig.mockResolvedValue({game_roles: [{roleId: 'male', label: '롤'}]});
    await expectValidationError('기존 게임 역할');
    expect(repository.saveConfig).not.toHaveBeenCalled();
  });

  it('publishes the welcome entry through the service', async () => {
    interaction.options.getSubcommand.mockReturnValue('게시');
    await command.execute(interaction);
    expect(service.publishWelcome).toHaveBeenCalledWith(interaction.guild);
  });

  it('allows updating a safe game role', async () => {
    interaction.options.getSubcommand.mockReturnValue('게임추가');
    await command.execute(interaction);
    expect(repository.addGameRole).toHaveBeenCalledWith('guild-1', '롤', 'game');
  });

  it('opens the game management panel when both options are omitted', async () => {
    interaction.options.getSubcommand.mockReturnValue('게임추가');
    interaction.options.getString.mockReturnValue(null);
    interaction.options.getRole.mockReturnValue(null);
    await command.execute(interaction);
    expect(SafeInteraction.safeDeferReply).toHaveBeenCalledWith(interaction, {ephemeral: true});
    expect(gameManager.showPanel).toHaveBeenCalledWith(interaction);
    expect(repository.addGameRole).not.toHaveBeenCalled();
  });

  it.each(['name', 'role'])('explains partially supplied game arguments: %s', async supplied => {
    interaction.options.getSubcommand.mockReturnValue('게임추가');
    if (supplied === 'name') interaction.options.getRole.mockReturnValue(null);
    else interaction.options.getString.mockReturnValue(null);
    await expectValidationError('이름과 역할을 함께 입력');
    expect(gameManager.showPanel).not.toHaveBeenCalled();
    expect(repository.addGameRole).not.toHaveBeenCalled();
  });

  it('rejects granting a reserved gender role as a game', async () => {
    interaction.options.getSubcommand.mockReturnValue('게임추가');
    repository.getConfig.mockResolvedValue({enabled: true, category_id: 'category', gender_male_role_id: 'game'});
    await expectValidationError('게임 역할');
    expect(repository.addGameRole).not.toHaveBeenCalled();
  });

  it.each([PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads,
    PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory])('explains missing server permission %s even when all channel permissions allow it', async permission => {
    bot.permissions.remove([PermissionFlagsBits.Administrator, permission]);
    await expectValidationError('봇 역할의 서버 권한');
    expect(repository.saveConfig).not.toHaveBeenCalled();
    expect(channels.get(welcomeId).permissionOverwrites.edit).not.toHaveBeenCalled();
  });

  it('explains unfinished setup before fetching or granting game roles', async () => {
    interaction.options.getSubcommand.mockReturnValue('게임추가');
    repository.getConfig.mockResolvedValue(null);
    await expectValidationError('/가입관리 설정');
    expect(interaction.guild.members.fetchMe).not.toHaveBeenCalled();
    expect(repository.addGameRole).not.toHaveBeenCalled();
  });

  it('explains game capacity and still allows replacing an existing game at capacity', async () => {
    interaction.options.getSubcommand.mockReturnValue('게임추가');
    const gameRoles = Array.from({length: 25}, (_, i) => ({roleId: `game-${i}`, label: `게임 ${i}`}));
    repository.getConfig.mockResolvedValue({enabled: true, category_id: 'category', game_roles: gameRoles});
    await expectValidationError('최대 25개');
    expect(repository.addGameRole).not.toHaveBeenCalled();
    interaction.options.getString.mockReturnValue('게임 0');
    await command.execute(interaction);
    expect(repository.addGameRole).toHaveBeenCalledWith('guild-1', '게임 0', 'game');
  });
});
