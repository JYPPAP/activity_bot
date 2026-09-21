import { describe, it, expect } from 'vitest';
import { TeamCommand } from '../../src/commands/TeamCommand.js';

describe('TeamCommand', () => {
  describe('makePairKey', () => {
    it('should create the same key regardless of the order of arguments', () => {
      expect(TeamCommand.makePairKey('Alice', 'Bob')).toBe(TeamCommand.makePairKey('Bob', 'Alice'));
    });

    it('should handle same arguments', () => {
      expect(TeamCommand.makePairKey('Alice', 'Alice')).toBe('Alice|||Alice');
    });

    it('should sort strings before creating the key', () => {
      expect(TeamCommand.makePairKey('B', 'A')).toBe('A|||B');
    });
  });

  describe('extractPairs', () => {
    it('should return 1 pair for a 2-person team', () => {
      const teams = [['Alice', 'Bob']];
      const pairs = TeamCommand.extractPairs(teams);
      expect(pairs.size).toBe(1);
      expect(pairs.has(TeamCommand.makePairKey('Alice', 'Bob'))).toBe(true);
    });

    it('should return 3 pairs for a 3-person team', () => {
      const teams = [['Alice', 'Bob', 'Charlie']];
      const pairs = TeamCommand.extractPairs(teams);
      expect(pairs.size).toBe(3);
      expect(pairs.has(TeamCommand.makePairKey('Alice', 'Bob'))).toBe(true);
      expect(pairs.has(TeamCommand.makePairKey('Bob', 'Charlie'))).toBe(true);
      expect(pairs.has(TeamCommand.makePairKey('Alice', 'Charlie'))).toBe(true);
    });

    it('should return 0 pairs for a 1-person team', () => {
      const teams = [['Alice']];
      const pairs = TeamCommand.extractPairs(teams);
      expect(pairs.size).toBe(0);
    });

    it('should return union of multiple teams', () => {
      const teams = [['Alice', 'Bob'], ['Charlie', 'Dave']];
      const pairs = TeamCommand.extractPairs(teams);
      expect(pairs.size).toBe(2);
      expect(pairs.has(TeamCommand.makePairKey('Alice', 'Bob'))).toBe(true);
      expect(pairs.has(TeamCommand.makePairKey('Charlie', 'Dave'))).toBe(true);
    });
  });

  describe('scoreTeams', () => {
    it('should return 0 when there is no overlap', () => {
      const teams = [['Alice', 'Bob'], ['Charlie', 'Dave']];
      const history = new Set([TeamCommand.makePairKey('Alice', 'Charlie')]);
      expect(TeamCommand.scoreTeams(teams, history)).toBe(0);
    });

    it('should return partial overlap count', () => {
      const teams = [['Alice', 'Bob'], ['Charlie', 'Dave']];
      const history = new Set([
        TeamCommand.makePairKey('Alice', 'Bob'),
        TeamCommand.makePairKey('Eve', 'Frank')
      ]);
      expect(TeamCommand.scoreTeams(teams, history)).toBe(1);
    });

    it('should return total overlap count', () => {
      const teams = [['Alice', 'Bob'], ['Charlie', 'Dave']];
      const history = new Set([
        TeamCommand.makePairKey('Alice', 'Bob'),
        TeamCommand.makePairKey('Charlie', 'Dave')
      ]);
      expect(TeamCommand.scoreTeams(teams, history)).toBe(2);
    });
  });

  describe('distribute', () => {
    it('should distribute people round-robin (7 people to 3 teams)', () => {
      const assignees = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
      const teams = TeamCommand.distribute(assignees, 3);
      expect(teams.length).toBe(3);
      expect(teams[0]).toEqual(['A', 'D', 'G']);
      expect(teams[1]).toEqual(['B', 'E']);
      expect(teams[2]).toEqual(['C', 'F']);
    });

    it('should handle empty input', () => {
      const teams = TeamCommand.distribute([], 3);
      expect(teams.length).toBe(3);
      expect(teams[0]).toEqual([]);
      expect(teams[1]).toEqual([]);
      expect(teams[2]).toEqual([]);
    });

    it('should handle teamCount > assignees', () => {
      const assignees = ['A', 'B'];
      const teams = TeamCommand.distribute(assignees, 3);
      expect(teams.length).toBe(3);
      expect(teams[0]).toEqual(['A']);
      expect(teams[1]).toEqual(['B']);
      expect(teams[2]).toEqual([]);
    });
  });

  describe('shuffle', () => {
    it('should preserve length and elements without checking order', () => {
      const arr = ['A', 'B', 'C', 'D', 'E'];
      const copy = [...arr];
      TeamCommand.shuffle(arr);
      expect(arr.length).toBe(copy.length);
      expect([...arr].sort()).toEqual(copy.sort());
    });
    
    it('should modify the original array in-place', () => {
      const arr = ['A', 'B', 'C', 'D', 'E'];
      const originalRef = arr;
      TeamCommand.shuffle(arr);
      expect(arr).toBe(originalRef);
    });
  });
});
