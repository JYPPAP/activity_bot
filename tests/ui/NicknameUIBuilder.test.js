import { describe, expect, it } from 'vitest';
import { NicknameConstants } from '../../src/config/NicknameConstants.js';
import {
  createActionButtons,
  createMainSelectMenu,
  createNicknameEmbed,
} from '../../src/ui/NicknameUIBuilder.js';

describe('NicknameUIBuilder', () => {
  it('공통 닉네임 UI를 생성한다', () => {
    const embed = createNicknameEmbed();
    const select = createMainSelectMenu('channel-1', [{
      id: '7',
      platform_name: 'Steam',
      emoji_unicode: '🎮',
    }]);

    expect(embed.data.title).toContain('닉네임 관리');
    expect(select.components[0].data.custom_id).toBe(
      `${NicknameConstants.CUSTOM_ID_PREFIXES.MAIN_SELECT}channel-1`
    );
    expect(select.components[0].options).toHaveLength(2);
  });

  it('관리자 여부에 맞는 버튼 수를 만든다', () => {
    expect(createActionButtons('channel-1').components).toHaveLength(3);
    expect(createActionButtons('channel-1', true).components).toHaveLength(5);
  });
});
