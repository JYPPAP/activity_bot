import {beforeEach, describe, expect, it, vi} from 'vitest';
import {MessageFlags} from 'discord.js';

vi.mock('../../src/utils/SafeInteraction.js', () => ({
  SafeInteraction: {
    safeDeferUpdate: vi.fn().mockResolvedValue(null),
    safeReply: vi.fn().mockResolvedValue(null)
  }
}));

import {OnboardingService} from '../../src/services/OnboardingService.js';
import {SafeInteraction} from '../../src/utils/SafeInteraction.js';

const config = {
  enabled: true,
  stage_role_ids: {
    gender: 'stage-gender',
    games: 'stage-games',
    rules: 'stage-rules',
    application: 'stage-application'
  },
  gender_male_role_id: 'gender-male',
  gender_female_role_id: 'gender-female',
  game_roles: [
    {label: 'League', roleId: 'game-lol'},
    {label: 'Valorant', roleId: 'game-valorant'}
  ],
  game_channel_id: 'channel-games',
  rules_channel_id: 'channel-rules',
  application_channel_id: 'channel-application',
  review_channel_id: 'channel-review',
  pending_role_id: 'role-pending',
  member_role_id: 'role-member'
};

const createMember = (roleIds = []) => ({
  id: 'user-1',
  user: {id: 'user-1', bot: false},
  guild: {id: 'guild-1'},
  roles: {
    cache: new Set(roleIds),
    add: vi.fn().mockResolvedValue(null),
    remove: vi.fn().mockResolvedValue(null)
  }
});

const createInteraction = ({customId = 'onboarding:gender', values = [], roleIds = []} = {}) => {
  const member = createMember(roleIds);
  const reviewChannel = {send: vi.fn().mockResolvedValue(null)};
  return {
    guildId: 'guild-1',
    user: {id: 'user-1'},
    customId,
    values,
    member,
    guild: {
      channels: {fetch: vi.fn().mockResolvedValue(reviewChannel)},
      members: {fetch: vi.fn().mockResolvedValue(member)}
    },
    message: {edit: vi.fn().mockResolvedValue(null)},
    reviewChannel
  };
};

describe('OnboardingService', () => {
  let repository;
  let service;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = {
      getConfig: vi.fn().mockResolvedValue(config),
      ensureProgress: vi.fn(),
      setStage: vi.fn().mockResolvedValue(null),
      getProgress: vi.fn()
    };
    service = new OnboardingService(repository);
  });

  it.todo('restores the persisted stage role when a member rejoins after leaving the guild');
  it.todo('allows only one review message when application interactions race');
  it.todo('does not create onboarding progress for an administrator reviewing another member');

  it('recognizes only onboarding custom IDs', () => {
    expect(service.isInteraction('onboarding:rules')).toBe(true);
    expect(service.isInteraction('forum_join_1')).toBe(false);
    expect(service.isInteraction()).toBe(false);
  });

  it('initializes a new human member at the gender stage', async () => {
    const member = createMember();
    repository.ensureProgress.mockResolvedValueOnce({stage: 'gender'});

    await service.handleMemberAdd(member);

    expect(repository.ensureProgress).toHaveBeenCalledWith('guild-1', 'user-1');
    expect(member.roles.add).toHaveBeenCalledWith('stage-gender');
  });

  it('ignores bot members without touching persistence', async () => {
    const member = createMember();
    member.user.bot = true;

    await service.handleMemberAdd(member);

    expect(repository.getConfig).not.toHaveBeenCalled();
    expect(repository.ensureProgress).not.toHaveBeenCalled();
  });

  it('does not re-add an entry role for resumed progress', async () => {
    const member = createMember();
    repository.ensureProgress.mockResolvedValueOnce({stage: 'games'});

    await service.handleMemberAdd(member);

    expect(member.roles.add).not.toHaveBeenCalled();
  });

  it('adds the next stage role before removing the current stage role', async () => {
    const member = createMember(['stage-gender']);
    const calls = [];
    member.roles.add.mockImplementation(async id => calls.push(['add', id]));
    member.roles.remove.mockImplementation(async id => calls.push(['remove', id]));

    await service.transition(member, config, 'stage-gender', 'stage-games');

    expect(calls).toEqual([['add', 'stage-games'], ['remove', 'stage-gender']]);
  });

  it('stores gender selection and advances to the games stage', async () => {
    const interaction = createInteraction({values: ['male'], roleIds: ['stage-gender']});

    await service.selectGender(interaction, config, {stage: 'gender'});

    expect(interaction.member.roles.add).toHaveBeenNthCalledWith(1, 'gender-male');
    expect(interaction.member.roles.add).toHaveBeenNthCalledWith(2, 'stage-games');
    expect(interaction.member.roles.remove).toHaveBeenCalledWith('stage-gender');
    expect(repository.setStage).toHaveBeenCalledWith(
      'guild-1', 'user-1', 'games', {genderRoleId: 'gender-male'}
    );
    expect(SafeInteraction.safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('<#channel-games>'),
      flags: MessageFlags.Ephemeral
    }));
  });

  it('filters unconfigured game role IDs before assigning and persisting', async () => {
    const interaction = createInteraction({
      customId: 'onboarding:games',
      values: ['game-lol', 'role-attacker'],
      roleIds: ['stage-games']
    });

    await service.selectGames(interaction, config, {stage: 'games'});

    expect(interaction.member.roles.add).toHaveBeenNthCalledWith(1, ['game-lol']);
    expect(repository.setStage).toHaveBeenCalledWith(
      'guild-1', 'user-1', 'rules', {gameRoleIds: ['game-lol']}
    );
  });

  it('does not advance when no selected game role is configured', async () => {
    const interaction = createInteraction({customId: 'onboarding:games', values: ['role-attacker']});

    await service.selectGames(interaction, config, {stage: 'games'});

    expect(interaction.member.roles.add).not.toHaveBeenCalled();
    expect(repository.setStage).not.toHaveBeenCalled();
    expect(SafeInteraction.safeReply).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({flags: MessageFlags.Ephemeral})
    );
  });

  it('rejects a stage action when persisted progress is at another stage', async () => {
    const interaction = createInteraction({values: ['female']});

    await service.selectGender(interaction, config, {stage: 'rules'});

    expect(interaction.member.roles.add).not.toHaveBeenCalled();
    expect(repository.setStage).not.toHaveBeenCalled();
    expect(SafeInteraction.safeReply).toHaveBeenCalledTimes(1);
  });

  it('submits one review message and records pending status', async () => {
    const interaction = createInteraction({customId: 'onboarding:apply', roleIds: ['stage-application']});

    await service.apply(interaction, config, {stage: 'application'});

    expect(repository.setStage).toHaveBeenCalledWith(
      'guild-1', 'user-1', 'pending', {applied: true}
    );
    expect(interaction.guild.channels.fetch).toHaveBeenCalledWith('channel-review');
    expect(interaction.reviewChannel.send).toHaveBeenCalledWith(expect.objectContaining({
      embeds: expect.any(Array),
      components: expect.any(Array)
    }));
  });

  it('prevents non-administrators from reviewing applications', async () => {
    const interaction = createInteraction({customId: 'onboarding:approve:user-2'});
    interaction.member.permissions = {has: vi.fn().mockReturnValue(false)};

    await service.review(interaction, config, true);

    expect(repository.getProgress).not.toHaveBeenCalled();
    expect(interaction.guild.members.fetch).not.toHaveBeenCalled();
  });

  it('approves a pending member and disables the review controls', async () => {
    const interaction = createInteraction({customId: 'onboarding:approve:user-2'});
    interaction.member.permissions = {has: vi.fn().mockReturnValue(true)};
    repository.getProgress.mockResolvedValueOnce({stage: 'pending'});

    await service.review(interaction, config, true);

    expect(interaction.guild.members.fetch).toHaveBeenCalledWith('user-2');
    expect(repository.setStage).toHaveBeenCalledWith(
      'guild-1', 'user-2', 'approved', {reviewedBy: 'user-1'}
    );
    expect(interaction.message.edit).toHaveBeenCalledWith({components: []});
  });

  it('builds each onboarding component with the expected custom ID', () => {
    const messages = service.buildMessages(config);

    expect(Object.keys(messages)).toEqual(['gender', 'games', 'rules', 'application']);
    expect(messages.gender.components[0].components[0].data.custom_id).toBe('onboarding:gender');
    expect(messages.games.components[0].components[0].data).toMatchObject({
      custom_id: 'onboarding:games',
      min_values: 1,
      max_values: 2
    });
    expect(messages.rules.components[0].components[0].data.custom_id).toBe('onboarding:rules');
    expect(messages.application.components[0].components[0].data.custom_id).toBe('onboarding:apply');
  });
});
