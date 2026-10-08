import {beforeEach, describe, expect, it, vi} from 'vitest';
import {OnboardingRepository} from '../../src/repositories/OnboardingRepository.js';

describe('OnboardingRepository', () => {
  let dbManager;
  let repository;

  beforeEach(() => {
    dbManager = {query: vi.fn()};
    repository = new OnboardingRepository(dbManager);
  });

  it('returns the guild configuration or null', async () => {
    const row = {guild_id: 'guild-1', enabled: true};
    dbManager.query.mockResolvedValueOnce({rows: [row]});
    await expect(repository.getConfig('guild-1')).resolves.toBe(row);
    expect(dbManager.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM onboarding_configs'), ['guild-1']
    );

    dbManager.query.mockResolvedValueOnce({rows: []});
    await expect(repository.getConfig('guild-2')).resolves.toBeNull();
  });

  it('serializes stage role IDs when saving configuration', async () => {
    const saved = {guild_id: 'guild-1'};
    dbManager.query.mockResolvedValueOnce({rows: [saved]});
    const input = {
      welcomeChannelId: 'welcome', gameChannelId: 'games', rulesChannelId: 'rules',
      applicationChannelId: 'apply', reviewChannelId: 'review', maleRoleId: 'male',
      femaleRoleId: 'female', stageRoleIds: {gender: 'stage-gender'},
      pendingRoleId: 'pending', memberRoleId: 'member'
    };

    await expect(repository.saveConfig('guild-1', input)).resolves.toBe(saved);

    expect(dbManager.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (guild_id) DO UPDATE SET'),
      ['guild-1', 'welcome', 'games', 'rules', 'apply', 'review', 'male', 'female',
        JSON.stringify(input.stageRoleIds), 'pending', 'member']
    );
  });

  it('deduplicates game roles by role ID and label', async () => {
    const roles = [
      {label: 'Keep', roleId: 'role-keep'},
      {label: 'League', roleId: 'role-new'}
    ];
    dbManager.query.mockResolvedValueOnce({rows: [{game_roles: roles}]});

    await expect(repository.addGameRole('guild-1', 'League', 'role-new')).resolves.toEqual(roles);
    expect(dbManager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE onboarding_configs'),
      ['guild-1', 'League', 'role-new']
    );
  });

  it('creates or refreshes progress idempotently', async () => {
    const row = {guild_id: 'guild-1', user_id: 'user-1', stage: 'gender'};
    dbManager.query.mockResolvedValueOnce({rows: [row]});

    await expect(repository.ensureProgress('guild-1', 'user-1')).resolves.toBe(row);
    expect(dbManager.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (guild_id,user_id) DO UPDATE'),
      ['guild-1', 'user-1']
    );
  });

  it('maps optional transition fields to SQL parameters in contract order', async () => {
    const row = {stage: 'application'};
    dbManager.query.mockResolvedValueOnce({rows: [row]});

    await expect(repository.setStage('guild-1', 'user-1', 'application', {
      genderRoleId: 'female',
      gameRoleIds: ['lol', 'valorant'],
      rulesAccepted: true,
      applied: false,
      reviewedBy: 'admin-1',
      rejectionReason: 'retry'
    })).resolves.toBe(row);

    expect(dbManager.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE onboarding_progress'), [
      'guild-1', 'user-1', 'application', 'female', JSON.stringify(['lol', 'valorant']),
      true, false, 'admin-1', 'retry'
    ]);
  });

  it('returns progress or null by string snowflake IDs', async () => {
    const row = {guild_id: '123456789012345678', user_id: '987654321098765432'};
    dbManager.query.mockResolvedValueOnce({rows: [row]});
    await expect(repository.getProgress(row.guild_id, row.user_id)).resolves.toBe(row);
    expect(dbManager.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM onboarding_progress'), [row.guild_id, row.user_id]
    );

    dbManager.query.mockResolvedValueOnce({rows: []});
    await expect(repository.getProgress('guild-2', 'user-2')).resolves.toBeNull();
  });
});
