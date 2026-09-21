import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ForumRepository } from '../../src/repositories/ForumRepository.js';

describe('ForumRepository facade contract', () => {
  it('exposes every forumRepo method called by DatabaseManager', () => {
    const databaseManagerSource = fs.readFileSync(
      new URL('../../src/services/DatabaseManager.js', import.meta.url),
      'utf8'
    );
    const methodNames = [...databaseManagerSource.matchAll(/forumRepo\.([A-Za-z0-9_]+)\(/g)]
      .map((match) => match[1]);
    const repository = new ForumRepository({ query: vi.fn() });

    expect(methodNames.length).toBeGreaterThan(0);
    expect([...new Set(methodNames)].filter((name) => typeof repository[name] !== 'function')).toEqual([]);
  });
});
