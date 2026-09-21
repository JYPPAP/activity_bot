import { describe, it, expect } from 'vitest';
import { EmbedFactory } from '../../src/utils/embedBuilder.js';
import { COLORS } from '../../src/config/constants.js';

describe('EmbedFactory', () => {
  describe('splitUsersIntoPages', () => {
    it('should return 1 page for an empty array', () => {
      const pages = EmbedFactory.splitUsersIntoPages([]);
      expect(pages.length).toBe(1);
      expect(pages[0]).toEqual([]);
    });

    it('should split users when maxFieldLength is exceeded', () => {
      // Create a mock user that will take up 100 characters per line
      // formatTime takes totalTime and returns a string.
      // nickname length + timeStr length + 2
      // Let's create users that take up e.g. 50 characters
      const users = [
        { nickname: 'A'.repeat(40), totalTime: 0 }, // 40 + '0시간 0분' (7) + 2 = 49
        { nickname: 'B'.repeat(40), totalTime: 0 },
        { nickname: 'C'.repeat(40), totalTime: 0 }
      ];
      
      const pages = EmbedFactory.splitUsersIntoPages(users, 100);
      
      // page 1: A (49), B (49) -> 98 (<= 100)
      // page 2: C (49)
      expect(pages.length).toBe(2);
      expect(pages[0].length).toBe(2);
      expect(pages[0][0].nickname).toBe('A'.repeat(40));
      expect(pages[0][1].nickname).toBe('B'.repeat(40));
      expect(pages[1].length).toBe(1);
      expect(pages[1][0].nickname).toBe('C'.repeat(40));
    });

    it('should ensure each page string length is within maxFieldLength if possible', () => {
      const users = Array.from({ length: 10 }, (_, i) => ({ nickname: `User${i}`, totalTime: 3600000 }));
      const maxFieldLength = 50;
      const pages = EmbedFactory.splitUsersIntoPages(users, maxFieldLength);
      
      expect(pages.length).toBeGreaterThan(1);
      for (const page of pages) {
        let length = 0;
        for (const user of page) {
          length += user.nickname.length + '1시간 0분'.length + 2;
        }
        // Since we add user if empty even if it exceeds, we just check normal condition here
        // Each user takes ~16 chars. 3 users = 48 chars.
        expect(length).toBeLessThanOrEqual(maxFieldLength + 20); 
      }
    });
  });

  describe('createNotificationEmbed', () => {
    it('should create an embed with title, description, and color', () => {
      const embed = EmbedFactory.createNotificationEmbed('My Title', 'My Description', 0xff0000);
      const data = embed.data;
      
      expect(data.title).toBe('My Title');
      expect(data.description).toBe('My Description');
      expect(data.color).toBe(0xff0000);
    });

    it('should use default LOG color if not provided', () => {
      const embed = EmbedFactory.createNotificationEmbed('Title', 'Desc');
      const data = embed.data;
      
      expect(data.color).toBe(0x0099ff);
    });
  });

  describe('createLogEmbed', () => {
    it('should create a log embed with message and members', () => {
      const members = ['Alice', 'Bob'];
      const embed = EmbedFactory.createLogEmbed('Something happened', members, 0x00ff00);
      const data = embed.data;
      
      expect(data.description).toBe('**Something happened**');
      expect(data.color).toBe(0x00ff00);
      expect(data.fields).toBeDefined();
      
      const memberField = data.fields.find(f => f.name === '👥 현재 남아있는 멤버');
      expect(memberField).toBeDefined();
      expect(memberField.value).toContain('Alice');
      expect(memberField.value).toContain('Bob');
    });
  });
});
