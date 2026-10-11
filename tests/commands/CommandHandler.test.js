import {describe, expect, it, vi} from 'vitest';
import {CommandHandler} from '../../src/commands/CommandHandler.js';

describe('CommandHandler game role selection entry', () => {
  it('forwards role selections from the gateway to the component router', async () => {
    const handler = {voiceChannelForumIntegrationService: {handleInteraction: vi.fn()}};
    const interaction = {
      isCommand: () => false, isButton: () => false, isStringSelectMenu: () => false,
      isRoleSelectMenu: () => true, isModalSubmit: () => false,
    };
    await CommandHandler.prototype.handleInteraction.call(handler, interaction);
    expect(handler.voiceChannelForumIntegrationService.handleInteraction).toHaveBeenCalledWith(interaction);
  });
});
