import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ButtonHandler } from '../../src/ui/ButtonHandler.js';
import { DiscordConstants } from '../../src/config/DiscordConstants.js';
import { logger } from '../../src/config/logger-termux.js';

describe('ButtonHandler', () => {
  let buttonHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    buttonHandler = new ButtonHandler({}, {}, {}, {}, {});
  });

  it('ROLE_BUTTON 접두를 역할 태그 핸들러로 라우팅한다', async () => {
    const roleTagSpy = vi.spyOn(buttonHandler.roleTagButtons, 'handleRoleTagButtons')
      .mockResolvedValue(undefined);

    await buttonHandler.routeButtonInteraction({
      customId: `${DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_BUTTON}tank`,
    });

    expect(roleTagSpy).toHaveBeenCalledOnce();
  });

  it('VOICE_CONNECT 접두를 음성 채널 핸들러로 라우팅한다', async () => {
    const voiceChannelSpy = vi.spyOn(buttonHandler.voiceChannelButtons, 'handleVoiceChannelButtons')
      .mockResolvedValue(undefined);

    await buttonHandler.routeButtonInteraction({
      customId: `${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_CONNECT}123456789`,
    });

    expect(voiceChannelSpy).toHaveBeenCalledOnce();
  });

  it('알 수 없는 customId는 경고만 남긴다', async () => {
    const roleTagSpy = vi.spyOn(buttonHandler.roleTagButtons, 'handleRoleTagButtons');
    const voiceChannelSpy = vi.spyOn(buttonHandler.voiceChannelButtons, 'handleVoiceChannelButtons');

    await buttonHandler.routeButtonInteraction({ customId: 'unknown_button' });

    expect(logger.warn).toHaveBeenCalledWith('[ButtonHandler] 처리되지 않은 버튼: unknown_button');
    expect(roleTagSpy).not.toHaveBeenCalled();
    expect(voiceChannelSpy).not.toHaveBeenCalled();
  });

  it('외부 호출용 Facade 메서드 3개를 유지한다', () => {
    expect(buttonHandler.routeButtonInteraction).toBeTypeOf('function');
    expect(buttonHandler.handleRoleTagButtons).toBeTypeOf('function');
    expect(buttonHandler.handlePreMembersSelectMenu).toBeTypeOf('function');
  });
});
