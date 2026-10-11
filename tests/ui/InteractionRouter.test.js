import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ComponentType, InteractionType} from 'discord.js';
import {InteractionRouter} from '../../src/ui/InteractionRouter.js';

describe('InteractionRouter onboarding game management', () => {
  let router, games, onboarding, modals;
  beforeEach(() => {
    games = {isInteraction: id => id.startsWith('onboarding:admin:games:'), handleInteraction: vi.fn()};
    onboarding = {isInteraction: id => id.startsWith('onboarding:'), handleInteraction: vi.fn()};
    modals = {handleModalSubmit: vi.fn()};
    router = new InteractionRouter({}, modals, {}, {}, {}, {}, onboarding, games);
  });

  it.each([
    [InteractionType.MessageComponent, ComponentType.Button, 'onboarding:admin:games:add'],
    [InteractionType.MessageComponent, ComponentType.RoleSelect, 'onboarding:admin:games:role'],
    [InteractionType.ModalSubmit, undefined, 'onboarding:admin:games:bulk:hash'],
  ])('routes management components to the dedicated handler before member onboarding', async (type, componentType, customId) => {
    const interaction = {type, componentType, customId};
    await router.routeInteraction(interaction);
    expect(games.handleInteraction).toHaveBeenCalledWith(interaction);
    expect(onboarding.handleInteraction).not.toHaveBeenCalled();
    expect(modals.handleModalSubmit).not.toHaveBeenCalled();
  });

  it('keeps ordinary onboarding buttons on the existing handler', async () => {
    const interaction = {type: InteractionType.MessageComponent, componentType: ComponentType.Button, customId: 'onboarding:rules'};
    await router.routeInteraction(interaction);
    expect(onboarding.handleInteraction).toHaveBeenCalledWith(interaction);
    expect(games.handleInteraction).not.toHaveBeenCalled();
  });
});
