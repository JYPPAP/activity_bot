import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseManager } from '../../src/services/DatabaseManager.js';

describe('DatabaseManager', () => {
  let dm;

  beforeEach(() => {
    dm = new DatabaseManager();
  });

  describe('attachPoolListeners', () => {
    it('registers an error listener on the pool', () => {
      const pool = { on: vi.fn() };

      dm.attachPoolListeners(pool);

      expect(pool.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
  });

  describe('query', () => {
    it('throws when the pool has not been initialized', async () => {
      await expect(dm.query('SELECT 1')).rejects.toThrow('데이터베이스가 초기화되지 않았습니다.');
    });

    it('passes text and params to the pool and returns its result unchanged', async () => {
      const result = { rows: [{ id: '1' }], rowCount: 1 };
      dm.pool = { query: vi.fn().mockResolvedValueOnce(result), connect: vi.fn() };

      await expect(dm.query('SELECT * FROM users WHERE user_id = $1', ['1'])).resolves.toBe(result);
      expect(dm.pool.query).toHaveBeenCalledWith('SELECT * FROM users WHERE user_id = $1', ['1']);
    });

    it('uses an empty params array by default', async () => {
      dm.pool = { query: vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 }), connect: vi.fn() };

      await dm.query('SELECT 1');

      expect(dm.pool.query).toHaveBeenCalledWith('SELECT 1', []);
    });

    it('rethrows the error from pool.query', async () => {
      const error = new Error('query failed');
      dm.pool = { query: vi.fn().mockRejectedValueOnce(error), connect: vi.fn() };

      await expect(dm.query('SELECT broken')).rejects.toBe(error);
    });
  });

  describe('transaction', () => {
    it('runs BEGIN, callback queries, and COMMIT in order and releases once', async () => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: vi.fn()
      };
      dm.pool = { query: vi.fn(), connect: vi.fn().mockResolvedValueOnce(client) };

      await dm.transaction(async transactionClient => {
        await transactionClient.query('INSERT INTO users VALUES ($1)', ['1']);
        await transactionClient.query('UPDATE users SET username = $1', ['name']);
      });

      expect(client.query.mock.calls).toEqual([
        ['BEGIN'],
        ['INSERT INTO users VALUES ($1)', ['1']],
        ['UPDATE users SET username = $1', ['name']],
        ['COMMIT']
      ]);
      expect(client.release).toHaveBeenCalledTimes(1);
    });

    it('returns the callback result unchanged', async () => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: vi.fn()
      };
      dm.pool = { query: vi.fn(), connect: vi.fn().mockResolvedValueOnce(client) };
      const callbackResult = { saved: true };

      await expect(dm.transaction(async () => callbackResult)).resolves.toBe(callbackResult);
    });

    it('rolls back, rethrows the callback error, and releases once', async () => {
      const error = new Error('callback failed');
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: vi.fn()
      };
      dm.pool = { query: vi.fn(), connect: vi.fn().mockResolvedValueOnce(client) };

      await expect(dm.transaction(async transactionClient => {
        await transactionClient.query('DELETE FROM users');
        throw error;
      })).rejects.toBe(error);

      expect(client.query.mock.calls).toEqual([
        ['BEGIN'],
        ['DELETE FROM users'],
        ['ROLLBACK']
      ]);
      expect(client.release).toHaveBeenCalledTimes(1);
    });
  });
});
