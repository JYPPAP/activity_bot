import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('../../src/utils/SafeInteraction.js', () => ({
  SafeInteraction: {
    safeDeferReply: vi.fn().mockResolvedValue(null),
    safeReply: vi.fn().mockResolvedValue(null)
  }
}));

import {OnboardingManagementCommand} from '../../src/commands/OnboardingManagementCommand.js';

describe('OnboardingManagementCommand', () => {
  let channel;
  let interaction;

  beforeEach(() => {
    channel = {
      send: vi.fn().mockResolvedValue(null),
      permissionOverwrites: {edit: vi.fn().mockResolvedValue(null)}
    };
    interaction = {
      guildId: 'guild-1',
      member: {
        id: 'admin-1',
        roles: {cache: {some: callback => callback({name: '사장'})}}
      },
      options: {getSubcommand: vi.fn().mockReturnValue('게시')},
      guild: {
        channels: {fetch: vi.fn().mockResolvedValue(channel)},
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

  it('stores the fixed channel for every public onboarding stage', async () => {
    const values = {
      심사채널: 'channel-review', 남성역할: 'role-male', 여성역할: 'role-female',
      대기역할: 'role-pending', 정회원역할: 'role-member', 성별단계역할: 'stage-gender',
      게임단계역할: 'stage-games', 규칙단계역할: 'stage-rules', 신청단계역할: 'stage-application'
    };
    interaction.options = {
      getSubcommand: vi.fn().mockReturnValue('설정'),
      get: vi.fn(name => ({value: values[name]}))
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
      gameChannelId: '1459874768449699861',
      rulesChannelId: '1459874768449699861',
      applicationChannelId: '1459874768449699861',
      reviewChannelId: 'channel-review'
    }));
    expect(interaction.guild.channels.fetch).toHaveBeenCalledWith('1459874768449699861');
    expect(channel.permissionOverwrites.edit).toHaveBeenCalledTimes(5);
  });

  it('posts every onboarding step in the fixed onboarding channel', async () => {
    const repository = {getConfig: vi.fn().mockResolvedValue({game_roles: [{}]})};
    const messages = {gender: {}, games: {}, rules: {}, application: {}};
    const service = {buildMessages: vi.fn().mockReturnValue(messages)};

    await new OnboardingManagementCommand(repository, service).execute(interaction);

    expect(interaction.guild.channels.fetch).toHaveBeenCalledWith('1459874768449699861');
    expect(channel.send.mock.calls.map(([message]) => message)).toEqual(Object.values(messages));
  });
});
