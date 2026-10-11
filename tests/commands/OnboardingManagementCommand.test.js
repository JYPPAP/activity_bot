import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/utils/SafeInteraction.js', () => ({
  SafeInteraction: {
    safeDeferReply: vi.fn().mockResolvedValue(null),
    safeReply: vi.fn().mockResolvedValue(null)
  }
}));

import {OnboardingManagementCommand} from '../../src/commands/OnboardingManagementCommand.js';

const settingValues = {
  게임채널: 'channel-games', 규칙채널: 'channel-rules', 신청채널: 'channel-application',
  심사채널: 'channel-review', 남성역할: 'role-male', 여성역할: 'role-female',
  대기역할: 'role-pending', 성별단계역할: 'stage-gender',
  게임단계역할: 'stage-games', 규칙단계역할: 'stage-rules', 신청단계역할: 'stage-application'
};

describe('OnboardingManagementCommand', () => {
  let channels;
  let interaction;

  beforeEach(() => {
    channels = new Map(['1459874768449699861', 'channel-games', 'channel-rules', 'channel-application']
      .map(id => [id, {
        id,
        send: vi.fn().mockResolvedValue(null),
        permissionOverwrites: {edit: vi.fn().mockResolvedValue(null)}
      }]));
    interaction = {
      guildId: 'guild-1',
      member: {
        id: 'admin-1',
        roles: {cache: {some: callback => callback({name: '사장'})}}
      },
      options: {getSubcommand: vi.fn().mockReturnValue('게시')},
      guild: {
        channels: {fetch: vi.fn(id => Promise.resolve(channels.get(id)))},
        roles: {everyone: 'everyone'}
      }
    };
  });

  it('rejects members without onboarding management permission', async () => {
    interaction.member.roles.cache.some = () => false;
    const repository = {getConfig: vi.fn()};

    await new OnboardingManagementCommand(repository, {}).execute(interaction);

    expect(repository.getConfig).not.toHaveBeenCalled();
    expect(interaction.guild.channels.fetch).not.toHaveBeenCalled();
  });

  it('stores a distinct channel for each onboarding stage and the fixed member role', async () => {
    interaction.options = {
      getSubcommand: vi.fn().mockReturnValue('설정'),
      get: vi.fn(name => ({value: settingValues[name]}))
    };
    const repository = {
      saveConfig: vi.fn().mockResolvedValue({
        stage_role_ids: {
          gender: 'stage-gender', games: 'stage-games',
          rules: 'stage-rules', application: 'stage-application'
        }
      })
    };

    await new OnboardingManagementCommand(repository, {}).execute(interaction);

    expect(repository.saveConfig).toHaveBeenCalledWith('guild-1', expect.objectContaining({
      welcomeChannelId: '1459874768449699861',
      gameChannelId: 'channel-games',
      rulesChannelId: 'channel-rules',
      applicationChannelId: 'channel-application',
      reviewChannelId: 'channel-review',
      memberRoleId: '1243633748344438855'
    }));
    expect(interaction.guild.channels.fetch.mock.calls.map(([id]) => id)).toEqual([
      '1459874768449699861', 'channel-games', 'channel-rules', 'channel-application'
    ]);
    for (const channel of channels.values()) {
      expect(channel.permissionOverwrites.edit).toHaveBeenCalledTimes(5);
    }
    expect(channels.get('1459874768449699861').permissionOverwrites.edit)
      .toHaveBeenCalledWith('stage-gender', {ViewChannel: true, SendMessages: false});
    expect(channels.get('1459874768449699861').permissionOverwrites.edit)
      .toHaveBeenCalledWith('stage-games', {ViewChannel: false, SendMessages: false});
  });

  it('rejects reused stage or review channels before saving', async () => {
    interaction.options = {
      getSubcommand: vi.fn().mockReturnValue('설정'),
      get: vi.fn(name => ({value: name === '게임채널'
        ? '1459874768449699861'
        : settingValues[name]}))
    };
    const repository = {saveConfig: vi.fn()};

    await new OnboardingManagementCommand(repository, {}).execute(interaction);

    expect(repository.saveConfig).not.toHaveBeenCalled();
    expect(interaction.guild.channels.fetch).not.toHaveBeenCalled();
  });

  it('rejects a role reused for multiple stages before saving', async () => {
    interaction.options = {
      getSubcommand: vi.fn().mockReturnValue('설정'),
      get: vi.fn(name => ({value: name === '게임단계역할'
        ? 'stage-gender'
        : settingValues[name]}))
    };
    const repository = {saveConfig: vi.fn()};

    await new OnboardingManagementCommand(repository, {}).execute(interaction);

    expect(repository.saveConfig).not.toHaveBeenCalled();
    expect(interaction.guild.channels.fetch).not.toHaveBeenCalled();
  });

  it('posts each onboarding step in its configured channel', async () => {
    const repository = {getConfig: vi.fn().mockResolvedValue({
      game_roles: [{}],
      welcome_channel_id: '1459874768449699861',
      game_channel_id: 'channel-games',
      rules_channel_id: 'channel-rules',
      application_channel_id: 'channel-application'
    })};
    const messages = {gender: {}, games: {}, rules: {}, application: {}};
    const service = {buildMessages: vi.fn().mockReturnValue(messages)};

    await new OnboardingManagementCommand(repository, service).execute(interaction);

    expect(channels.get('1459874768449699861').send).toHaveBeenCalledWith(messages.gender);
    expect(channels.get('channel-games').send).toHaveBeenCalledWith(messages.games);
    expect(channels.get('channel-rules').send).toHaveBeenCalledWith(messages.rules);
    expect(channels.get('channel-application').send).toHaveBeenCalledWith(messages.application);
  });
});
