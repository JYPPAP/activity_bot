import { describe, expect, it } from 'vitest';

import { TextProcessor } from '../../src/utils/TextProcessor.js';

describe('TextProcessor.cleanNickname', () => {
  it('removes a waiting tag and its following whitespace', () => {
    expect(TextProcessor.cleanNickname('[대기]   홍길동')).toBe('홍길동');
  });

  it('removes a spectating tag and its following whitespace', () => {
    expect(TextProcessor.cleanNickname('[관전] 홍길동')).toBe('홍길동');
  });

  it('returns an empty string for empty or undefined input', () => {
    expect(TextProcessor.cleanNickname('')).toBe('');
    expect(TextProcessor.cleanNickname(undefined)).toBe('');
  });

  it.todo('removes a numeric duplicate suffix such as (3)');
  it.todo('trims surrounding whitespace without a special tag');
});

describe('TextProcessor.truncateText', () => {
  it('leaves text shorter than the maximum unchanged', () => {
    expect(TextProcessor.truncateText('abcd', 5)).toBe('abcd');
  });

  it('leaves text exactly at the maximum unchanged', () => {
    expect(TextProcessor.truncateText('abcde', 5)).toBe('abcde');
  });

  it('truncates overlong text to the maximum including the suffix', () => {
    const result = TextProcessor.truncateText('abcdefghij', 7, '...');
    expect(result).toBe('abcd...');
    expect(result).toHaveLength(7);
  });
});

describe('TextProcessor tag and title helpers', () => {
  it('detects text that exceeds a limit', () => {
    expect(TextProcessor.exceedsLimit('abcd', 3)).toBe(true);
    expect(TextProcessor.exceedsLimit('abc', 3)).toBe(false);
  });

  it('reports waiting and spectating tags independently', () => {
    expect(TextProcessor.checkSpecialTags('[대기] user')).toEqual({
      hasWaitTag: true,
      hasSpectateTag: false,
    });
    expect(TextProcessor.checkSpecialTags('[관전] user')).toEqual({
      hasWaitTag: false,
      hasSpectateTag: true,
    });
  });

  it('reports whether either special tag exists', () => {
    expect(TextProcessor.hasWaitOrSpectateTag('plain user')).toBe(false);
    expect(TextProcessor.hasWaitOrSpectateTag('[관전] user')).toBe(true);
  });

  it('extracts owners from supported forum title forms', () => {
    expect(TextProcessor.extractOwnerFromTitle('[[관전] 무지] 테스트')).toBe('무지');
    expect(TextProcessor.extractOwnerFromTitle('[김태희] 롤체 1/8')).toBe('김태희');
    expect(TextProcessor.extractOwnerFromTitle('소유자 없음')).toBeNull();
  });
});
