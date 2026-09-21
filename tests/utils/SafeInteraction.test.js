import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractionType, MessageFlags } from 'discord.js';
import { SafeInteraction } from '../../src/utils/SafeInteraction.js';

const createInteraction = (overrides = {}) => ({
  id: '123456789012345678',
  type: InteractionType.ApplicationCommand,
  createdTimestamp: Date.now(),
  replied: false,
  deferred: false,
  isRepliable: () => true,
  isButton: () => false,
  isStringSelectMenu: () => false,
  isModalSubmit: () => false,
  reply: vi.fn().mockResolvedValue('reply-result'),
  editReply: vi.fn().mockResolvedValue('edit-result'),
  followUp: vi.fn().mockResolvedValue('follow-up-result'),
  deferUpdate: vi.fn().mockResolvedValue('defer-update-result'),
  ...overrides,
});

describe('SafeInteraction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    SafeInteraction.processingInteractions.clear();
    SafeInteraction.processingStartTimes.clear();
    SafeInteraction.interactionStates.clear();
    SafeInteraction.responseAttempts.clear();
  });

  it('validates a current interaction', () => {
    expect(SafeInteraction.validateInteraction(createInteraction())).toEqual({ valid: true });
  });

  it('rejects a null interaction', () => {
    expect(SafeInteraction.validateInteraction(null)).toEqual({
      valid: false,
      reason: 'Interaction is null',
      code: 'NULL_INTERACTION',
    });
  });

  it('rejects an expired interaction', () => {
    const interaction = createInteraction({
      createdTimestamp: Date.now() - SafeInteraction.CONFIG.MAX_INTERACTION_AGE - 1,
    });

    expect(SafeInteraction.validateInteraction(interaction)).toEqual({
      valid: false,
      reason: 'Interaction expired',
      code: 'EXPIRED',
    });
  });

  it('prevents duplicate processing until processing finishes', () => {
    const interaction = createInteraction();

    expect(SafeInteraction.startProcessing(interaction)).toBe(true);
    expect(SafeInteraction.startProcessing(interaction)).toBe(false);
    SafeInteraction.finishProcessing(interaction);
    expect(SafeInteraction.startProcessing(interaction)).toBe(true);
  });

  it.each([
    ['replied', { replied: true }, 'followUp', 'follow-up-result'],
    ['deferred', { deferred: true }, 'editReply', 'edit-result'],
    ['new', {}, 'reply', 'reply-result'],
  ])('uses the correct safeReply branch for a %s interaction', async (_name, state, method, result) => {
    const interaction = createInteraction(state);

    await expect(SafeInteraction.safeReply(interaction, { content: 'ok' })).resolves.toBe(result);
    expect(interaction[method]).toHaveBeenCalledWith({ content: 'ok' });
  });

  it('creates an ephemeral error response', () => {
    expect(SafeInteraction.createErrorResponse('test', { code: 50013, message: 'denied' })).toEqual({
      content: '❌ 권한이 부족합니다.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('safely defers an update and returns its result', async () => {
    const interaction = createInteraction();

    await expect(SafeInteraction.safeDeferUpdate(interaction)).resolves.toBe('defer-update-result');
    expect(interaction.deferUpdate).toHaveBeenCalledOnce();
  });
});
