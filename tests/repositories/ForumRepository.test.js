import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForumRepository } from '../../src/repositories/ForumRepository.js';

describe('ForumRepository', () => {
  let dbManager;
  let repository;

  beforeEach(() => {
    dbManager = {
      query: vi.fn(),
      transaction: vi.fn(),
      invalidateCache: vi.fn()
    };
    repository = new ForumRepository(dbManager);
  });

  describe('getPostIntegration', () => {
    it('returns the first active integration row', async () => {
      const row = { voice_channel_id: 'voice-1', forum_post_id: 'post-1' };
      dbManager.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      await expect(repository.getPostIntegration('voice-1')).resolves.toBe(row);
      expect(dbManager.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM post_integrations'),
        ['voice-1']
      );
    });

    it('returns null when no integration exists', async () => {
      dbManager.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(repository.getPostIntegration('voice-1')).resolves.toBeNull();
    });
  });

  describe('createPostIntegration', () => {
    it('inserts a new integration with parameters in contract order', async () => {
      const inserted = { id: 1, voice_channel_id: 'voice-1', forum_post_id: 'post-1' };
      dbManager.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [inserted], rowCount: 1 });

      await expect(repository.createPostIntegration(
        'guild-1', 'voice-1', 'post-1', 'forum-1'
      )).resolves.toBe(inserted);

      expect(dbManager.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('INSERT INTO post_integrations'),
        ['guild-1', 'voice-1', 'post-1', 'forum-1']
      );
      expect(dbManager.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('upserts when the same forum post is already linked to the same voice channel', async () => {
      const existing = { voice_channel_id: 'voice-1', forum_post_id: 'post-1' };
      const updated = { ...existing, forum_channel_id: 'forum-1' };
      dbManager.query
        .mockResolvedValueOnce({ rows: [existing], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [existing], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      await expect(repository.createPostIntegration(
        'guild-1', 'voice-1', 'post-1', 'forum-1'
      )).resolves.toBe(updated);

      expect(dbManager.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('ON CONFLICT (guild_id, voice_channel_id)'),
        ['guild-1', 'voice-1', 'post-1', 'forum-1']
      );
    });

    it('throws a conflict when the forum post is linked to another regular voice channel', async () => {
      dbManager.query
        .mockResolvedValueOnce({
          rows: [{ voice_channel_id: 'voice-other', forum_post_id: 'post-1' }],
          rowCount: 1
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const promise = repository.createPostIntegration('guild-1', 'voice-1', 'post-1', 'forum-1');

      await expect(promise).rejects.toMatchObject({
        code: '23505',
        constraint: 'post_integrations_guild_id_forum_post_id_key'
      });
      expect(dbManager.query).toHaveBeenCalledTimes(2);
    });
  });

  describe('participants', () => {
    it('adds a participant to forum_participants in parameter order', async () => {
      dbManager.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await expect(repository.addParticipant('post-1', 'user-1', 'nickname')).resolves.toBe(true);
      expect(dbManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO forum_participants'),
        ['post-1', 'user-1', 'nickname']
      );
    });

    it('removes a participant and returns true when a row was deleted', async () => {
      dbManager.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await expect(repository.removeParticipant('post-1', 'user-1')).resolves.toBe(true);
      expect(dbManager.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM forum_participants'),
        ['post-1', 'user-1']
      );
    });

    it('returns false when removing a missing participant', async () => {
      dbManager.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(repository.removeParticipant('post-1', 'user-1')).resolves.toBe(false);
    });

    it('returns true when the participant exists', async () => {
      dbManager.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 });

      await expect(repository.isParticipant('post-1', 'user-1')).resolves.toBe(true);
      expect(dbManager.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM forum_participants'),
        ['post-1', 'user-1']
      );
    });

    it('returns false when the participant does not exist', async () => {
      dbManager.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(repository.isParticipant('post-1', 'user-1')).resolves.toBe(false);
    });

    it('returns the parsed participant count', async () => {
      dbManager.query.mockResolvedValueOnce({ rows: [{ count: '7' }], rowCount: 1 });

      await expect(repository.getParticipantCount('post-1')).resolves.toBe(7);
      expect(dbManager.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM forum_participants'),
        ['post-1']
      );
    });
  });

  describe('waitlist', () => {
    it('adds a user to forum_waitlist in parameter order', async () => {
      dbManager.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await expect(repository.addToWaitlist('post-1', 'user-1', 'nickname')).resolves.toBe(true);
      expect(dbManager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO forum_waitlist'),
        ['post-1', 'user-1', 'nickname']
      );
    });

    it('returns true when the user is in the waitlist', async () => {
      dbManager.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 });

      await expect(repository.isInWaitlist('post-1', 'user-1')).resolves.toBe(true);
      expect(dbManager.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM forum_waitlist'),
        ['post-1', 'user-1']
      );
    });

    it('returns false when the user is not in the waitlist', async () => {
      dbManager.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(repository.isInWaitlist('post-1', 'user-1')).resolves.toBe(false);
    });
  });
});
