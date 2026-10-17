import { describe, expect, it, vi } from 'vitest';
import { Collection } from 'discord.js';
import { PlatformTemplateService } from '../../src/services/PlatformTemplateService.js';

describe('PlatformTemplateService 게임 이모지', () => {
  const current = { id: '123456789012345678', name: 'N_Game_LeagueOfLegends', animated: false };
  const client = { guilds: { cache: new Collection([
    ['guild', { emojis: { cache: new Collection([[current.id, current]]) } }],
  ]) } };

  it.each([
    ':99_gap_game_league_of_legends:',
    '<:99_gap_game_league_of_legends:987654321098765432>',
    ':N_Game_LeagueOfLegends:',
    'N_Game_LeagueOfLegends',
  ])('%s를 현재 서버의 N_Game 이모지로 표시한다', async (emoji_unicode) => {
    const row = { id: 1, guild_id: 'guild', emoji_unicode };
    const db = { query: vi.fn().mockResolvedValue({ rows: [row] }) };
    const service = new PlatformTemplateService(db, client);

    expect((await service.getAllPlatforms('guild'))[0].emoji_unicode)
      .toBe('<:N_Game_LeagueOfLegends:123456789012345678>');
    expect(row.emoji_unicode).toBe(emoji_unicode);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('서버에서 제공한 11개 이름을 구형 표기와 연결하고 TFT 두 이모지를 구분한다', async () => {
    const names = [
      ['battle_ground', 'BattleGround'],
      ['blizzard', 'Blizzard'],
      ['league_of_legends', 'LeagueOfLegends'],
      ['lost_ark', 'LostArk'],
      ['minecraft', 'Minecraft'],
      ['overwatch', 'OverWatch'],
      ['riot', 'Riot'],
      ['steam', 'Steam'],
      ['tft', 'TFT'],
      ['teamfight_tactics', 'TeamfightTactics'],
      ['valorant', 'Valorant'],
    ];
    const emojis = names.map(([, name], index) => ({
      id: `1234567890123456${String(index).padStart(2, '0')}`,
      name: `N_Game_${name}`, animated: false,
    }));
    const guildClient = { guilds: { cache: new Collection([
      ['guild', { emojis: { cache: new Collection(emojis.map(emoji => [emoji.id, emoji])) } }],
    ]) } };
    const db = { query: vi.fn().mockResolvedValue({ rows: names.map(([oldName]) => ({
      emoji_unicode: `:99_gap_game_${oldName}:`,
    })) }) };
    const service = new PlatformTemplateService(db, guildClient);

    expect((await service.getAllPlatforms('guild')).map(row => row.emoji_unicode))
      .toEqual(emojis.map(emoji => `<:${emoji.name}:${emoji.id}>`));
    for (const emoji of emojis) {
      expect(service.resolvePlatformEmoji({ emoji_unicode: `:${emoji.name}:` }, 'guild').emoji_unicode)
        .toBe(`<:${emoji.name}:${emoji.id}>`);
    }
  });

  it('다른 서버의 이모지를 사용하지 않고 미등록 게임은 기본 이모지로 표시한다', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [
      { emoji_unicode: ':99_gap_game_unknown:' }, { emoji_unicode: '💬' },
    ] }) };
    const service = new PlatformTemplateService(db, client);
    expect((await service.getAllPlatforms('other')).map(row => row.emoji_unicode))
      .toEqual(['🎮', '💬']);
  });
});
