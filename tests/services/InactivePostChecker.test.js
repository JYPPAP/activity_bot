import {describe, expect, it, vi} from 'vitest';
import {InactivePostChecker} from '../../src/services/InactivePostChecker.js';

describe('InactivePostChecker', () => {
  it('구직게시판 외 카테고리의 포럼 스레드에는 비활동 알림을 보내지 않는다', async () => {
    const thread = {
      isThread: () => true,
      parent: {parentId: '1243883229757575178'},
      parentId: 'forum-channel',
      archived: false,
      locked: false,
      lastMessageId: '1',
      send: vi.fn()
    };
    const client = {channels: {fetch: vi.fn().mockResolvedValue(thread)}};
    const databaseManager = {query: vi.fn()};
    const checker = new InactivePostChecker(client, databaseManager);

    await checker._checkPost({forum_post_id: 'thread-1'}, Date.now());

    expect(thread.send).not.toHaveBeenCalled();
    expect(databaseManager.query).not.toHaveBeenCalled();
  });

  it('부모 포럼이 캐시에 없어도 카테고리를 조회해 구직게시판 외 글을 제외한다', async () => {
    const thread = {
      isThread: () => true,
      parent: null,
      parentId: 'forum-channel',
      archived: false,
      locked: false,
      lastMessageId: '1',
      send: vi.fn()
    };
    const client = {channels: {fetch: vi.fn()
      .mockResolvedValueOnce(thread)
      .mockResolvedValueOnce({parentId: '1243883229757575178'})}};
    const checker = new InactivePostChecker(client, {query: vi.fn()});

    await checker._checkPost({forum_post_id: 'thread-1'}, Date.now());

    expect(client.channels.fetch).toHaveBeenNthCalledWith(2, 'forum-channel');
    expect(thread.send).not.toHaveBeenCalled();
  });

  it('구직게시판 카테고리의 포스트는 비활동 검사를 계속한다', async () => {
    const thread = {
      isThread: () => true,
      parent: {parentId: '1243571860705251348'},
      archived: false,
      locked: false,
      lastMessageId: null,
      send: vi.fn()
    };
    const client = {channels: {fetch: vi.fn().mockResolvedValue(thread)}};
    const checker = new InactivePostChecker(client, {query: vi.fn()});

    await checker._checkPost({forum_post_id: 'thread-1'}, Date.now());

    expect(thread.isThread()).toBe(true);
    expect(client.channels.fetch).toHaveBeenCalledTimes(1);
  });
});
