import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscordConstants } from '../../../src/config/DiscordConstants.js';
import { ForumPostButtons } from '../../../src/ui/buttons/ForumPostButtons.js';
import { SafeInteraction } from '../../../src/utils/SafeInteraction.js';

describe('ForumPostButtons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('참가자 멘션 뒤에 참가자 목록과 멘션 버튼을 다시 배치한다', async () => {
    const participants = [
      { userId: 'user-1', nickname: '참가자1' },
      { userId: 'user-2', nickname: '참가자2' },
    ];
    const databaseManager = {
      getParticipants: vi.fn().mockResolvedValue(participants),
    };
    const forumPostManager = {
      databaseManager,
      sendEmojiParticipantUpdate: vi.fn().mockResolvedValue(true),
    };
    const channelSend = vi.fn().mockResolvedValue({ id: 'mention-message' });
    const interaction = {
      customId: `${DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_MENTION}thread-1`,
      user: { id: 'user-1' },
      member: { roles: { cache: { some: vi.fn().mockReturnValue(false) } } },
      channel: { send: channelSend },
    };
    const buttons = new ForumPostButtons({
      emojiReactionService: {},
      forumPostManager,
      parent: {},
    });
    vi.spyOn(SafeInteraction, 'safeDeferUpdate').mockResolvedValue(undefined);

    await buttons.handleMentionButton(interaction);

    expect(channelSend).toHaveBeenCalledWith({
      content: '📢 **참가자 멘션**: <@user-1> <@user-2>',
      allowedMentions: { users: ['user-1', 'user-2'] },
    });
    expect(forumPostManager.sendEmojiParticipantUpdate).toHaveBeenCalledWith(
      'thread-1',
      ['참가자1', '참가자2'],
      '참가자 멘션'
    );
    expect(channelSend.mock.invocationCallOrder[0]).toBeLessThan(
      forumPostManager.sendEmojiParticipantUpdate.mock.invocationCallOrder[0]
    );
  });
});
