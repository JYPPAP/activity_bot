import { describe, expect, it, vi } from 'vitest';
import { UserNicknameService } from '../../src/services/UserNicknameService.js';
import { PlatformTemplateService } from '../../src/services/PlatformTemplateService.js';
import { Collection } from 'discord.js';

describe('UserNicknameService 표시', () => {
  const user = { username: '현호', displayAvatarURL: () => 'https://example.com/avatar.png' };
  const account = {
    platform_id: 1, platform_name: '롤', display_order: 0,
    emoji_unicode: '<:N_Game_LeagueOfLegends:123456789012345678>',
    user_identifier: '고구마#자색고구마', full_url: null,
  };

  it.each(['createVoiceChannelNicknameEmbed', 'createMyNicknamesEmbed'])(
    '%s에서 ID만 코드 블록에 넣고 프로필 링크를 유지한다', (method) => {
      const service = new UserNicknameService({}, {});
      const single = service[method](user, null, [account]).embeds[0].toJSON();
      expect(single.fields[0]).toEqual({
        name: `${account.emoji_unicode} 롤`,
        value: 'ID:\n```\n고구마#자색고구마\n```', inline: false,
      });
      const multiple = service[method](user, null, [
        account, { ...account, user_identifier: '두번째#KR1', full_url: 'https://example.com/profile' },
      ]).embeds[0].toJSON();
      expect(multiple.fields[0].value).toBe(
        '1. ID:\n```\n고구마#자색고구마\n```\n2. ID:\n```\n두번째#KR1\n```\n[프로필 보기 🔗](https://example.com/profile)'
      );
    }
  );

  it.each(['getUserNicknames', 'getPlatformNicknames'])(
    '%s 조회 결과를 현재 서버 이모지로 변환한다', async (method) => {
      const emoji = { name: 'N_Game_LeagueOfLegends', id: '123456789012345678' };
      const client = { guilds: { cache: new Collection([
        ['guild', { emojis: { cache: new Collection([[emoji.id, emoji]]) } }],
      ]) } };
      const db = { query: vi.fn().mockResolvedValue({ rows: [
        { ...account, emoji_unicode: ':99_gap_game_league_of_legends:' },
      ] }) };
      const service = new UserNicknameService(db, new PlatformTemplateService(db, client));
      expect((await service[method]('guild', 'user', 1))[0].emoji_unicode).toBe(account.emoji_unicode);
    }
  );
});
