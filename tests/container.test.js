import { describe, expect, it, vi } from 'vitest';
import { createDIContainer } from '../src/container.js';

describe('DI container', () => {
  it('resolves the command handler with CLASSIC parameter names', () => {
    const client = {
      channels: { cache: new Map(), fetch: vi.fn() },
      guilds: { cache: new Map() },
      on: vi.fn(),
    };
    const container = createDIContainer(client);

    expect(() => container.resolve('commandHandler')).not.toThrow();
  });
});
