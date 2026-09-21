import { vi } from 'vitest';

vi.mock('../src/config/logger-termux.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    alert: vi.fn(),
    botActivity: vi.fn(),
    voiceActivity: vi.fn(),
    commandExecution: vi.fn(),
    databaseOperation: vi.fn(),
    discordEvent: vi.fn(),
    withMeta: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      alert: vi.fn(),
    })),
  },
  default: {},
}));
