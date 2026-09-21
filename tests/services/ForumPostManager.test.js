import { describe, expect, it, vi } from 'vitest';
import { DiscordConstants } from '../../src/config/DiscordConstants.js';
import { ForumPostManager } from '../../src/services/ForumPostManager.js';

const createManager = (fetch = vi.fn()) => new ForumPostManager(
  { channels: { fetch }, guilds: { cache: { first: vi.fn() } } },
  'fch',
  'tag',
  {}
);

describe('ForumPostManager', () => {
  it('generates a title from a member display name', () => {
    const manager = createManager();

    expect(manager.generatePostTitle({
      author: { displayName: '[관전] 홍길동', username: 'fallback' },
      title: '같이 게임해요'
    })).toBe('[홍길동] 같이 게임해요');
  });

  it('falls back to the author username when displayName is absent', () => {
    const manager = createManager();

    expect(manager.generatePostTitle({
      author: { username: 'player' },
      title: '한 명 모집'
    })).toBe('[player] 한 명 모집');
  });

  it('creates participation buttons with the configured custom ID prefixes', () => {
    const manager = createManager();
    const row = manager.createParticipationButtons('thread');
    const prefixes = [
      DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_JOIN,
      DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_LEAVE,
      DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_WAIT
    ];

    expect(row.components.map(button => button.data.custom_id)).toEqual(
      prefixes.map(prefix => `${prefix}thread`)
    );
  });

  it('omits the close button from recruiter buttons when includeClose is false', () => {
    const manager = createManager();
    const row = manager.createRecruiterButtons('thread', 'rid', false);

    expect(row.components).toHaveLength(1);
    expect(row.components[0].data.custom_id).toBe(
      `${DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_EDIT_PREMEMBERS}thread_rid`
    );
  });

  it('returns false when fetching a post fails', async () => {
    const manager = createManager(vi.fn().mockRejectedValueOnce(new Error('fetch failed')));

    await expect(manager.postExists('thread')).resolves.toBe(false);
  });

  it('keeps all ten external delegation methods available', () => {
    const manager = createManager();
    const methods = [
      'createForumPost',
      'sendEmojiParticipantUpdate',
      'sendWaitlistUpdate',
      'getPostInfo',
      'archivePost',
      'sendParticipantChangeNotification',
      'sendVoiceChannelLinkMessage',
      'sendParticipantUpdateMessage',
      'postExists',
      'getExistingPostsFilteredByUser'
    ];

    for (const method of methods) {
      expect(manager[method]).toBeTypeOf('function');
    }
  });
});
