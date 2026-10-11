import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder,
} from 'discord.js';
import { DiscordConstants } from '../config/DiscordConstants.js';

const IDS = DiscordConstants.CUSTOM_ID_PREFIXES;
const BLUE = 0x5865f2;
const GREEN = 0x57bb8a;

const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder()
  .setCustomId(id).setLabel(label).setStyle(style);
const row = (...buttons) => new ActionRowBuilder().addComponents(buttons);
const payload = (embed, components = []) => ({
  embeds: [embed], components, allowedMentions: { parse: [] },
});
const genderLabel = (config, progress) => {
  if (progress.gender_role_id === config.gender_male_role_id) return '남성';
  if (progress.gender_role_id === config.gender_female_role_id) return '여성';
  return '미선택';
};
const selectedGames = (config, progress) => (config.game_roles || [])
  .filter(game => (progress.game_role_ids || []).includes(game.roleId));
const timestamp = value => value ? `<t:${Math.floor(new Date(value).getTime() / 1000)}:f>` : '—';
const summary = (config, progress) => [
  { name: '성별', value: genderLabel(config, progress), inline: true },
  { name: '게임', value: selectedGames(config, progress).map(game => game.label).join(', ').slice(0, 1024) || '미선택' },
  { name: '규칙 동의', value: progress.rules_accepted_at ? '동의 완료' : '미동의', inline: true },
];

export class OnboardingUIBuilder {
  static buildWelcome() {
    return payload(new EmbedBuilder().setColor(BLUE).setTitle('서버 가입 안내')
      .setDescription('아래 버튼을 누르면 나만 볼 수 있는 가입 채널에서 안내를 받을 수 있습니다.\n진행 중인 가입 절차가 있다면 이어서 진행합니다.'),
    [row(button(IDS.ONBOARDING_START, '가입 시작 / 이어하기', ButtonStyle.Primary))]);
  }

  static buildCard(config, progress) {
    const embed = new EmbedBuilder().setColor(BLUE)
      .setFooter({ text: `onboarding-card:${progress.guild_id || config.guild_id}:${progress.user_id}` });
    let components = [];

    switch (progress.stage) {
      case 'gender':
        embed.setTitle('가입 안내 · 1 / 4').setDescription('본인의 성별을 선택해 주세요.');
        if (progress.gender_role_id) embed.addFields({ name: '이전 선택', value: genderLabel(config, progress) });
        components = [row(
          button(`${IDS.ONBOARDING_GENDER_CHOICE}male`, '남성', ButtonStyle.Primary),
          button(`${IDS.ONBOARDING_GENDER_CHOICE}female`, '여성', ButtonStyle.Primary),
        )];
        break;
      case 'games': {
        const games = (config.game_roles || []).slice(0, 25);
        const chosen = selectedGames({ game_roles: games }, progress);
        embed.setTitle('가입 안내 · 2 / 4')
          .setDescription(games.length ? '플레이하는 게임을 선택해 주세요.\n여러 게임을 선택한 뒤 선택 완료를 눌러 주세요.' : '등록된 게임이 없습니다. 관리자에게 게임 등록을 요청해 주세요.')
          .addFields({ name: '성별', value: genderLabel(config, progress), inline: true }, {
            name: '선택한 게임', value: chosen.map(game => game.label).join(', ').slice(0, 1024) || '미선택',
          });
        if (games.length) {
          components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(IDS.ONBOARDING_GAMES).setPlaceholder('플레이하는 게임 선택')
            .setMinValues(1).setMaxValues(games.length).addOptions(games.map(game => ({
              label: game.label, value: game.roleId,
              default: (progress.game_role_ids || []).includes(game.roleId),
            })))));
        }
        components.push(row(button(`${IDS.ONBOARDING_BACK}gender`, '이전'),
          button(IDS.ONBOARDING_GAMES_CONFIRM, '선택 완료', ButtonStyle.Primary).setDisabled(!chosen.length)));
        break;
      }
      case 'rules':
        embed.setTitle('가입 안내 · 3 / 4').setDescription(config.rules_text)
          .addFields({ name: '규칙 동의', value: '위 규칙을 읽고 동의한 뒤 계속해 주세요.' });
        components = [row(button(`${IDS.ONBOARDING_BACK}games`, '이전'),
          button(IDS.ONBOARDING_RULES, '동의하고 계속', ButtonStyle.Primary))];
        break;
      case 'application':
        embed.setTitle('가입 안내 · 4 / 4').setDescription('입력한 내용을 확인해 주세요.\n수정이 없다면 가입 신청을 눌러 주세요.')
          .addFields(summary(config, progress));
        if (progress.rejection_reason) embed.addFields({ name: '관리자 안내', value: progress.rejection_reason.slice(0, 1024) });
        components = [row(button(`${IDS.ONBOARDING_BACK}gender`, '성별 수정'),
          button(`${IDS.ONBOARDING_BACK}games`, '게임 수정'),
          button(IDS.ONBOARDING_APPLY, '가입 신청', ButtonStyle.Primary))];
        break;
      case 'pending':
        embed.setTitle('가입 신청 · 심사 대기').setDescription('가입 신청이 접수되었습니다.\n관리자가 확인할 때까지 기다려 주세요.')
          .addFields(summary(config, progress));
        break;
      case 'approved':
        embed.setColor(GREEN).setTitle('가입 완료').setDescription('가입이 승인되었습니다. 서버에 오신 것을 환영합니다!\n닫기를 누르면 이 가입 채널이 삭제됩니다.')
          .addFields({ name: '채널 자동 정리', value: progress.cleanup_at
            ? `<t:${Math.floor(new Date(progress.cleanup_at).getTime() / 1000)}:R> 자동 삭제됩니다.`
            : '승인 후 10분 뒤 자동 삭제됩니다.' });
        components = [row(button(IDS.ONBOARDING_CLOSE, '닫기'))];
        break;
      default:
        throw new Error(`알 수 없는 가입 단계: ${progress.stage}`);
    }
    return payload(embed, components);
  }

  static buildReview(config, progress) {
    const appliedAt = new Date(progress.applied_at).toISOString();
    const embed = new EmbedBuilder().setColor(BLUE).setTitle('신규 가입 신청')
      .setDescription(`<@${progress.user_id}> 님의 가입 신청입니다.`)
      .addFields(summary(config, progress),
        { name: '규칙 동의 시각', value: timestamp(progress.rules_accepted_at), inline: true },
        { name: '신청 시각', value: timestamp(progress.applied_at), inline: true })
      .setFooter({ text: `onboarding-review:${progress.guild_id || config.guild_id}:${progress.user_id}:${appliedAt}` });
    return payload(embed, [row(
      button(`${IDS.ONBOARDING_APPROVE}${progress.user_id}`, '승인', ButtonStyle.Success),
      button(`${IDS.ONBOARDING_REJECT}${progress.user_id}`, '거절', ButtonStyle.Danger),
    )]);
  }

  static buildReviewed(config, progress) {
    const result = this.buildReview(config, progress);
    const approved = progress.stage === 'approved';
    result.components = [];
    result.embeds[0].setTitle(approved ? '가입 신청 · 승인 완료' : '가입 신청 · 거절')
      .setColor(approved ? GREEN : BLUE)
      .addFields({ name: '처리자', value: progress.reviewed_by ? `<@${progress.reviewed_by}>` : '—', inline: true },
        { name: '처리 시각', value: timestamp(progress.reviewed_at), inline: true });
    if (!approved && progress.rejection_reason) {
      result.embeds[0].addFields({ name: '거절 사유', value: progress.rejection_reason.slice(0, 1024) });
    }
    return result;
  }
}
