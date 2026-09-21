import { describe, it, expect } from 'vitest';
import {
  formatTime,
  formatKoreanDate,
  formatShortDate,
  formatMembersList,
  cleanRoleName,
  formatParticipantName,
  formatParticipantList,
  formatWaitlist,
  formatParticipantChangeMessage
} from '../../src/utils/formatters.js';

describe('formatters', () => {
  describe('formatTime', () => {
    it('should format 0 ms as 0시간 0분', () => {
      expect(formatTime(0)).toBe('0시간 0분');
    });

    it('should format less than 1 minute (e.g. 59.9 seconds) as 0시간 0분', () => {
      expect(formatTime(59999)).toBe('0시간 0분');
    });

    it('should format exactly 60 minutes as 1시간 0분', () => {
      expect(formatTime(60 * 60 * 1000)).toBe('1시간 0분');
    });

    it('should format large values correctly', () => {
      expect(formatTime(25 * 60 * 60 * 1000 + 30 * 60 * 1000)).toBe('25시간 30분');
    });
  });

  describe('formatKoreanDate', () => {
    it('should format fixed UTC date to Korean time string', () => {
      // 2026-01-01T00:00:00Z -> 2026-01-01 09:00:00 in Asia/Seoul
      const fixedDate = new Date('2026-01-01T00:00:00Z');
      const result = formatKoreanDate(fixedDate);
      // toLocaleString with ko-KR may vary slightly across node versions (e.g. "2026. 1. 1. 오전 9:00:00" or similar)
      // We will check for some key parts to avoid flakiness, or just match exactly if we know the Node format.
      // Typical format: 2026. 1. 1. 오전 9:00:00
      expect(result).toMatch(/2026.*1.*1.*9:00:00/);
    });
  });

  describe('formatShortDate', () => {
    it('should format fixed date to YYYY.MM.DD', () => {
      // Create date locally to avoid timezone issues with getFullYear/getMonth/getDate
      const fixedDate = new Date(2026, 0, 5); // 2026-01-05 local time
      expect(formatShortDate(fixedDate)).toBe('2026.01.05');
    });
  });

  describe('cleanRoleName', () => {
    it('should remove @ symbol from role name', () => {
      expect(cleanRoleName('@RoleName')).toBe('RoleName');
      expect(cleanRoleName('Role@Name@')).toBe('RoleName');
    });
  });

  describe('formatParticipantName', () => {
    it('should wrap nickname with backticks and spaces', () => {
      expect(formatParticipantName('Alice')).toBe(' ` Alice ` ');
    });
  });

  describe('formatMembersList', () => {
    it('should handle empty array', () => {
      expect(formatMembersList([])).toBe('**현재 멤버: (0명)**\n없음');
    });

    it('should handle 1 member', () => {
      expect(formatMembersList(['Alice'])).toBe('**현재 멤버: (1명)**\n` Alice `');
    });

    it('should handle multiple members', () => {
      expect(formatMembersList(['Alice', 'Bob'])).toBe('**현재 멤버: (2명)**\n` Alice ` ` Bob `');
    });
  });

  describe('formatParticipantList', () => {
    it('should handle empty or no participants', () => {
      expect(formatParticipantList([])).toBe('## 👥 **참가자(0명)**: 없음');
      expect(formatParticipantList()).toBe('## 👥 **참가자(0명)**: 없음');
    });

    it('should take only the first word of the name', () => {
      expect(formatParticipantList(['Alice in Wonderland', 'Bob Sponge'])).toBe('## 👥 **참가자(2명)**:  ` Alice ` , ` Bob ` ');
    });
  });

  describe('formatWaitlist', () => {
    it('should return null for empty waitlist', () => {
      expect(formatWaitlist([])).toBe(null);
      expect(formatWaitlist()).toBe(null);
    });

    it('should format waitlist taking only the first word of the name', () => {
      expect(formatWaitlist(['Charlie Brown', 'Dave'])).toBe('-# 📋 **대기자(2명)**:  ` Charlie ` , ` Dave ` ');
    });
  });

  describe('formatParticipantChangeMessage', () => {
    it('should handle joined only', () => {
      expect(formatParticipantChangeMessage(['Alice'], [])).toBe('-# Alice님이 참가했습니다.');
    });

    it('should handle left only', () => {
      expect(formatParticipantChangeMessage([], ['Bob'])).toBe('-# Bob님이 참가 취소했습니다.');
    });

    it('should handle both joined and left', () => {
      expect(formatParticipantChangeMessage(['Alice'], ['Bob'])).toBe('-# Alice님이 참가했습니다.\n-# Bob님이 참가 취소했습니다.');
    });

    it('should handle both empty', () => {
      expect(formatParticipantChangeMessage([], [])).toBe('');
    });
  });
});
