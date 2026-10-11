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

  it('saves private-channel configuration without overwriting games or legacy stage roles', async () => {
    const saved = {guild_id: 'guild-1'};
    dbManager.query.mockResolvedValueOnce({rows: [saved]});
    const input = {
      welcomeChannelId: 'welcome', categoryId: 'category', reviewChannelId: 'review', maleRoleId: 'male',
      femaleRoleId: 'female', pendingRoleId: 'pending', memberRoleId: 'member', rulesText: 'Be kind.',
      reviewManagerUserId: '987654321098765432'
    };

    await expect(repository.saveConfig('guild-1', input)).resolves.toBe(saved);

    expect(dbManager.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (guild_id) DO UPDATE SET'),
      ['guild-1', 'welcome', 'category', 'review', 'male', 'female', 'pending', 'member', 'Be kind.', '987654321098765432']
    );
    const sql = dbManager.query.mock.calls[0][0];
    expect(sql).not.toContain('stage_role_ids=');
    expect(sql).not.toContain('game_roles=');
    expect(sql).toContain('review_manager_user_id=EXCLUDED.review_manager_user_id');
  });

  it('leaves the review manager nullable for configurations without an assigned user', async () => {
    dbManager.query.mockResolvedValue({rows: [{review_manager_user_id: null}]});
    const config = {
      welcomeChannelId: 'welcome', categoryId: 'category', reviewChannelId: 'review',
      maleRoleId: 'male', femaleRoleId: 'female', pendingRoleId: 'pending', memberRoleId: 'member', rulesText: 'Rules'
    };
    await expect(repository.saveConfig('guild', config)).resolves.toEqual({review_manager_user_id: null});
    expect(dbManager.query.mock.calls[0][1][9]).toBeNull();
    await repository.saveConfig('guild', {...config, reviewManagerUserId: null});
    expect(dbManager.query.mock.calls[1][1][9]).toBeNull();
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
    const sql = dbManager.query.mock.calls[0][0];
    expect(sql).toContain("role->>'roleId' <> $3");
    expect(sql).toContain("role->>'label' <> $2");
    expect(sql).toContain(') < 25');
    expect(sql).toContain('pending_role_id, member_role_id');
    expect(sql).toContain('jsonb_each_text');
  });

  it('rejects a game update when the atomic limit or role conflict prevents it', async () => {
    dbManager.query.mockResolvedValueOnce({rows: []});
    await expect(repository.addGameRole('guild-1', 'Game 26', 'new-role')).rejects.toThrow('최대 25개');
  });

  it('atomically replaces game roles only while the snapshot and reserved-role settings remain valid', async () => {
    const original = [{label: 'Old game', roleId: 'old-role'}];
    const games = [{label: 'New game', roleId: 'new-role'}, {label: 'Other game', roleId: 'other-role'}];
    dbManager.query.mockResolvedValueOnce({rows: [{game_roles: games}]});
    await expect(repository.updateGameRoles('guild', games, original)).resolves.toEqual(games);
    expect(dbManager.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE onboarding_configs'),
      ['guild', JSON.stringify(games), JSON.stringify(original)]);
    const sql = dbManager.query.mock.calls[0][0];
    expect(sql).toContain('enabled=true AND game_roles=$3::jsonb');
    expect(sql).toContain('game_roles=$2::jsonb');
    expect(sql).toContain('jsonb_array_elements($2::jsonb)');
    expect(sql).toContain('gender_male_role_id, gender_female_role_id, pending_role_id, member_role_id');
    expect(sql).toContain('jsonb_each_text');
    expect(sql).toContain("stage_role.value=game->>'roleId'");
  });

  it('returns null when concurrent edits, disabled configuration, or reserved roles prevent updating', async () => {
    dbManager.query.mockResolvedValueOnce({rows: []});
    await expect(repository.updateGameRoles('guild', [{label: 'Game', roleId: 'game-role'}], [])).resolves.toBeNull();
  });

  it.each([
    null, [], Array.from({length: 26}, (_, index) => ({label: `Game ${index}`, roleId: `role-${index}`})),
    [null], [{label: '', roleId: 'role'}], [{label: '  ', roleId: 'role'}],
    [{label: ' Game ', roleId: 'role'}], [{label: 'a'.repeat(101), roleId: 'role'}],
    [{label: 'Game', roleId: ''}], [{label: 'Game', roleId: 123}],
    [{label: 'Game', roleId: ' role '}],
    [{label: 'Same', roleId: 'role-a'}, {label: 'Same', roleId: 'role-b'}],
    [{label: 'A', roleId: 'same-role'}, {label: 'B', roleId: 'same-role'}]
  ])('rejects invalid game lists before issuing SQL: %j', async games => {
    await expect(repository.updateGameRoles('guild', games, [])).rejects.toThrow();
    expect(dbManager.query).not.toHaveBeenCalled();
  });

  it('accepts the 25-game and 100-character label limits exactly', async () => {
    const games = Array.from({length: 25}, (_, index) => ({
      label: `${index}`.padEnd(100, 'a'), roleId: `role-${index}`
    }));
    dbManager.query.mockResolvedValueOnce({rows: [{game_roles: games}]});
    await expect(repository.updateGameRoles('guild', games, [])).resolves.toEqual(games);
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

  it('persists recovery fields and explicit nulls while leaving omitted fields untouched', async () => {
    const row = {stage: 'games', message_id: null};
    dbManager.query.mockResolvedValueOnce({rows: [row]});
    await expect(repository.saveProgress('guild-1', 'user-1', {
      stage: 'games', gameRoleIds: ['role-1'], channelId: 'channel-1', messageId: null,
      reviewMessageId: 'review-1', rejectionReason: null, cleanupAt: null, reviewAction: 'approve',
      reviewedAt: undefined
    })).resolves.toBe(row);
    expect(dbManager.query.mock.calls[0][1]).toEqual([
      'guild-1', 'user-1', 'games', '["role-1"]', 'channel-1', null, 'review-1', null, null, 'approve'
    ]);
    const sql = dbManager.query.mock.calls[0][0];
    expect(sql).toContain('game_role_ids=$4::jsonb');
    expect(sql).toContain('message_id=$6');
    expect(sql).toContain('cleanup_at=$9');
    expect(sql).not.toContain('reviewed_at=');
    expect(sql).not.toContain('COALESCE');
  });

  it('rejects unknown patch fields before executing SQL', async () => {
    await expect(repository.saveProgress('guild', 'user', {'stage=approved': true})).rejects.toThrow('Unknown');
    expect(dbManager.query).not.toHaveBeenCalled();
  });

  it('persists the next rule page and revision, including an explicit reset', async () => {
    const row = {rule_index: 2, rules_revision: 'revision-1'};
    dbManager.query.mockResolvedValue({rows: [row]});
    await expect(repository.saveProgress('guild', 'user', {ruleIndex: 2, rulesRevision: 'revision-1'})).resolves.toBe(row);
    expect(dbManager.query.mock.calls[0][0]).toContain('rule_index=$3, rules_revision=$4');
    expect(dbManager.query.mock.calls[0][1]).toEqual(['guild', 'user', 2, 'revision-1']);
    await repository.saveProgress('guild', 'user', {ruleIndex: 0, rulesRevision: null, rulesAcceptedAt: null});
    expect(dbManager.query.mock.calls[1][1]).toEqual(['guild', 'user', 0, null, null]);
  });

  it('queries only explicitly enabled private configurations during recovery and cleanup', async () => {
    const rows = [{guild_id: 'guild', user_id: 'user', channel_id: 'channel'}];
    dbManager.query.mockResolvedValue({rows});
    await expect(repository.getActiveProgress()).resolves.toBe(rows);
    await expect(repository.getDueCleanup()).resolves.toBe(rows);
    for (const [sql] of dbManager.query.mock.calls) {
      expect(sql).toContain('config.enabled=true');
      expect(sql).toContain('config.category_id IS NOT NULL');
      expect(sql).toContain('progress.departed_at IS NULL');
    }
    expect(dbManager.query.mock.calls[0][0]).toContain("progress.stage <> 'approved' OR progress.channel_id IS NOT NULL");
    expect(dbManager.query.mock.calls[0][0]).toContain('OR progress.review_action IS NOT NULL');
    expect(dbManager.query.mock.calls[1][0]).toContain('progress.cleanup_at <= CURRENT_TIMESTAMP');
    expect(dbManager.query.mock.calls[1][0]).toContain('progress.review_action IS NULL');
  });

  it('persists the welcome message ID for idempotent publication', async () => {
    const row = {welcome_message_id: 'message-1'};
    dbManager.query.mockResolvedValueOnce({rows: [row]});
    await expect(repository.saveWelcomeMessage('guild', 'message-1')).resolves.toBe(row);
    expect(dbManager.query).toHaveBeenCalledWith(expect.stringContaining('welcome_message_id=$2'), ['guild', 'message-1']);
  });

  it('uses the locked connection for progress writes and unlocks after successful work', async () => {
    const connection = {query: vi.fn().mockResolvedValue({rows: [{stage: 'games'}]}), release: vi.fn()};
    dbManager.pool = {connect: vi.fn().mockResolvedValue(connection)};
    const result = await repository.withMemberLock('guild', 'user', scoped =>
      scoped.saveProgress('guild', 'user', {stage: 'games'})
    );
    expect(result).toEqual({stage: 'games'});
    expect(connection.query.mock.calls[0]).toEqual([
      'SELECT pg_advisory_lock(hashtext($1),hashtext($2))', ['guild', 'user']
    ]);
    expect(connection.query.mock.calls[1][0]).toContain('UPDATE onboarding_progress');
    expect(connection.query.mock.calls[2]).toEqual([
      'SELECT pg_advisory_unlock(hashtext($1),hashtext($2))', ['guild', 'user']
    ]);
    expect(connection.query.mock.calls.some(([sql]) => sql === 'BEGIN')).toBe(false);
    expect(connection.release).toHaveBeenCalledOnce();
    expect(dbManager.query).not.toHaveBeenCalled();
  });

  it('releases its advisory lock and connection if the operation throws', async () => {
    const connection = {query: vi.fn().mockResolvedValue({rows: []}), release: vi.fn()};
    dbManager.pool = {connect: vi.fn().mockResolvedValue(connection)};
    const failure = new Error('Discord failed');
    await expect(repository.withMemberLock('guild', 'user', async () => {throw failure;})).rejects.toBe(failure);
    expect(connection.query.mock.calls[1][0]).toContain('pg_advisory_unlock');
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it('releases the connection even when obtaining or releasing a lock fails', async () => {
    const connection = {query: vi.fn().mockRejectedValue(new Error('Connection failed')), release: vi.fn()};
    dbManager.pool = {connect: vi.fn().mockResolvedValue(connection)};
    const callback = vi.fn();
    await expect(repository.withMemberLock('guild', 'user', callback)).rejects.toThrow('Connection failed');
    expect(callback).not.toHaveBeenCalled();
    expect(connection.query).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();

    connection.query.mockReset().mockResolvedValueOnce({rows: []}).mockRejectedValueOnce(new Error('Unlock failed'));
    connection.release.mockClear();
    await expect(repository.withMemberLock('guild', 'user', async () => 'done')).rejects.toThrow('Unlock failed');
    expect(connection.release).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledWith(true);
  });

  it('destroys the connection when PostgreSQL reports that unlocking did not succeed', async () => {
    const connection = {
      query: vi.fn().mockResolvedValueOnce({rows: []}).mockResolvedValueOnce({rows: [{pg_advisory_unlock: false}]}),
      release: vi.fn()
    };
    dbManager.pool = {connect: vi.fn().mockResolvedValue(connection)};
    await expect(repository.withMemberLock('guild', 'user', async () => 'done')).rejects.toThrow('lock was not held');
    expect(connection.release).toHaveBeenCalledWith(true);
  });

  it('selects interrupted screens and decisions across stages without polling completed sessions', async () => {
    const rows = [{stage: 'approved', review_action: 'approve'}, {stage: 'application', message_id: null}];
    dbManager.query.mockResolvedValueOnce({rows});
    await expect(repository.getInterruptedProgress()).resolves.toBe(rows);
    const sql = dbManager.query.mock.calls[0][0];
    expect(sql).toContain("progress.stage='pending'");
    expect(sql).toContain('progress.review_action IS NOT NULL');
    expect(sql).toContain('progress.review_message_id IS NULL');
    expect(sql).toContain('progress.message_id IS NULL');
    expect(sql).toContain('progress.channel_id IS NULL');
    expect(sql).toContain("progress.stage <> 'approved'");
    expect(sql).toContain('config.category_id IS NOT NULL');
    expect(sql).toContain('progress.departed_at IS NULL');
  });

  it('persists departure and clears it explicitly when a user rejoins', async () => {
    const departedAt = new Date('2026-10-11T01:00:00Z');
    dbManager.query.mockResolvedValue({rows: [{departed_at: null}]});
    await repository.saveProgress('guild', 'user', {departedAt});
    await repository.saveProgress('guild', 'user', {departedAt: null});
    expect(dbManager.query.mock.calls[0][0]).toContain('departed_at=$3');
    expect(dbManager.query.mock.calls[0][1]).toEqual(['guild', 'user', departedAt]);
    expect(dbManager.query.mock.calls[1][1]).toEqual(['guild', 'user', null]);
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
