import {createHash} from 'node:crypto';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder,
  PermissionFlagsBits, RoleSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import {hasCommandPermission} from '../config/commandPermissions.js';
import {DiscordConstants} from '../config/DiscordConstants.js';
import {logger} from '../config/logger-termux.js';
import {SafeInteraction} from '../utils/SafeInteraction.js';

const IDS = DiscordConstants.CUSTOM_ID_PREFIXES;
const EMPTY_LIST = '등록된 게임이 없습니다.';
const digest = games => createHash('sha256').update(JSON.stringify(games)).digest('hex');
class GameInputError extends Error {}

export class OnboardingGameManager {
  constructor(onboardingRepository) {
    this.onboardingRepository = onboardingRepository;
  }

  isInteraction(customId = '') { return customId.startsWith(IDS.ONBOARDING_GAME_ADMIN); }

  canManage(interaction) {
    return Boolean(interaction.guild && interaction.member && hasCommandPermission(interaction.member, '가입관리'));
  }

  reply(interaction, options) {
    return SafeInteraction.safeReply(interaction, {
      ...(typeof options === 'string' ? {content: options, embeds: [], components: []} : options),
      flags: MessageFlags.Ephemeral, allowedMentions: {parse: []},
    });
  }

  buildPanel(config) {
    const games = config.game_roles || [];
    return {
      embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('가입 게임 관리')
        .setDescription(games.map(game => `${game.label} | ${game.roleId}`).join('\n') || EMPTY_LIST)
        .addFields({name: '수정 방법', value: '게임 추가는 역할을 선택한 뒤 이름을 입력합니다.\n일괄 수정은 한 줄에 게임 이름 | 역할 ID를 입력합니다.'},
          {name: '저장 안내', value: '비운 줄은 기존 게임을 삭제하지 않습니다. 같은 이름 또는 역할은 새 값으로 대체합니다.\n최대 25개까지 등록할 수 있으며 기존 회원의 역할은 변경하지 않습니다.'})],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(IDS.ONBOARDING_GAME_ADD).setLabel('게임 추가').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${IDS.ONBOARDING_GAME_BULK}${digest(games)}`).setLabel('일괄 수정').setStyle(ButtonStyle.Secondary),
      )],
    };
  }

  async getConfig(guildId) {
    const config = await this.onboardingRepository.getConfig(guildId);
    if (!config?.enabled || !config.category_id) throw new GameInputError('먼저 /가입관리 설정을 완료해 주세요.');
    return config;
  }

  async showPanel(interaction) {
    if (!this.canManage(interaction)) return this.reply(interaction, '사장 역할 또는 개발자 권한이 필요합니다. 서버 안에서 실행해 주세요.');
    try { return await this.reply(interaction, this.buildPanel(await this.getConfig(interaction.guildId))); }
    catch (error) { return this.handleError(interaction, error); }
  }

  async handleInteraction(interaction) {
    if (!this.canManage(interaction)) return this.reply(interaction, '사장 역할 또는 개발자 권한이 필요합니다. 서버 안에서 실행해 주세요.');
    try {
      const id = interaction.customId;
      if (interaction.isModalSubmit()) {
        await SafeInteraction.safeDeferReply(interaction, {ephemeral: true});
        return await this.saveModal(interaction);
      }
      if (id === IDS.ONBOARDING_GAME_ROLE && interaction.isRoleSelectMenu()) {
        const roleId = interaction.values?.[0];
        if (interaction.values?.length !== 1 || !/^\d{17,20}$/.test(roleId || '')) throw new GameInputError('역할을 하나 선택해 주세요.');
        const input = new TextInputBuilder().setCustomId('game_name').setLabel('게임 이름')
          .setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(100).setRequired(true);
        return SafeInteraction.safeShowModal(interaction, new ModalBuilder()
          .setCustomId(`${IDS.ONBOARDING_GAME_NAME}${roleId}`).setTitle('가입 게임 추가')
          .addComponents(new ActionRowBuilder().addComponents(input)));
      }
      if (id.startsWith(IDS.ONBOARDING_GAME_BULK) && interaction.isButton()) {
        if (!/^[a-f0-9]{64}$/.test(id.slice(IDS.ONBOARDING_GAME_BULK.length))) throw new GameInputError('게임 관리 화면을 다시 열어 주세요.');
        const body = interaction.message?.embeds?.[0]?.description;
        if (typeof body !== 'string' || body.length > 4000) throw new GameInputError('게임 관리 화면을 다시 열어 주세요.');
        const input = new TextInputBuilder().setCustomId('game_list').setLabel('게임 이름 | 역할 ID (한 줄에 한 게임)')
          .setStyle(TextInputStyle.Paragraph).setMaxLength(4000).setRequired(false);
        if (body !== EMPTY_LIST) input.setValue(body);
        return SafeInteraction.safeShowModal(interaction, new ModalBuilder().setCustomId(id).setTitle('가입 게임 일괄 수정')
          .addComponents(new ActionRowBuilder().addComponents(input)));
      }
      if (id === IDS.ONBOARDING_GAME_ADD && interaction.isButton()) {
        await SafeInteraction.safeDeferReply(interaction, {ephemeral: true});
        await this.getConfig(interaction.guildId);
        return this.reply(interaction, {content: '게임에 사용할 역할을 선택해 주세요.', components: [
          new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(IDS.ONBOARDING_GAME_ROLE)
            .setPlaceholder('게임 역할 선택').setMinValues(1).setMaxValues(1)),
        ]});
      }
      throw new GameInputError('게임 관리 화면을 다시 열어 주세요.');
    } catch (error) { return this.handleError(interaction, error); }
  }

  validateName(name) {
    if (!name || name.length > 100 || /[\r\n]/.test(name)) throw new GameInputError('게임 이름은 줄바꿈 없이 1~100자로 입력해 주세요.');
  }

  parseGames(text) {
    const games = [];
    for (const line of text.split(/\r?\n/).filter(line => line.trim())) {
      const separator = line.lastIndexOf('|');
      if (separator < 0) throw new GameInputError('한 줄에 게임 이름 | 역할 ID 형식으로 입력해 주세요.');
      const label = line.slice(0, separator).trim();
      this.validateName(label);
      const roleText = line.slice(separator + 1).trim();
      const match = /^(?:<@&(\d{17,20})>|(\d{17,20}))$/.exec(roleText);
      if (!match) throw new GameInputError('역할 ID 또는 역할 멘션(<@&역할ID>)을 입력해 주세요.');
      games.push({label, roleId: match[1] || match[2]});
    }
    if (games.length > 25) throw new GameInputError('게임 선택지는 최대 25개입니다.');
    if (new Set(games.map(game => game.label)).size !== games.length || new Set(games.map(game => game.roleId)).size !== games.length) {
      throw new GameInputError('입력한 게임 이름과 역할은 서로 중복되지 않아야 합니다.');
    }
    return games;
  }

  async validateRoles(interaction, config, games) {
    const bot = await interaction.guild.members.fetchMe();
    if (!bot.permissions.has(PermissionFlagsBits.ManageRoles)) throw new GameInputError('봇에 역할 관리 권한을 부여해 주세요.');
    const reserved = new Set([config.gender_male_role_id, config.gender_female_role_id, config.pending_role_id,
      config.member_role_id, DiscordConstants.ROLE_IDS.MEMBER, ...Object.values(config.stage_role_ids || {})]);
    for (const game of games) {
      if (reserved.has(game.roleId)) throw new GameInputError('게임 역할은 성별·대기·정회원·기존 단계 역할과 달라야 합니다.');
      const role = await interaction.guild.roles.fetch(game.roleId).catch(error => {
        if (Number(error.code) === 10011) return null;
        throw error;
      });
      if (!role || role.guild.id !== interaction.guildId || role.id === interaction.guildId || role.managed
        || role.permissions.has(PermissionFlagsBits.Administrator) || bot.roles.highest.comparePositionTo(role) <= 0) {
        throw new GameInputError('서버의 일반 역할을 선택하고 봇 역할을 그 위로 올려 주세요.');
      }
    }
  }

  async saveModal(interaction) {
    const config = await this.getConfig(interaction.guildId);
    const current = config.game_roles || [];
    let games;
    if (interaction.customId.startsWith(IDS.ONBOARDING_GAME_NAME)) {
      const roleId = interaction.customId.slice(IDS.ONBOARDING_GAME_NAME.length);
      if (!/^\d{17,20}$/.test(roleId)) throw new GameInputError('게임 역할을 다시 선택해 주세요.');
      const label = interaction.fields.getTextInputValue('game_name').trim();
      this.validateName(label);
      if (current.filter(game => game.label !== label && game.roleId !== roleId).length >= 25) throw new GameInputError('게임 선택지는 최대 25개입니다.');
      await this.validateRoles(interaction, config, [{label, roleId}]);
      games = await this.onboardingRepository.addGameRole(interaction.guildId, label, roleId);
    } else if (interaction.customId.startsWith(IDS.ONBOARDING_GAME_BULK)) {
      if (interaction.customId.slice(IDS.ONBOARDING_GAME_BULK.length) !== digest(current)) throw new GameInputError('게임 목록이 변경되었습니다. 게임 관리 화면을 다시 열어 주세요.');
      const incoming = this.parseGames(interaction.fields.getTextInputValue('game_list'));
      if (!incoming.length) return this.reply(interaction, {content: '입력한 게임이 없어 기존 목록을 유지했습니다.', ...this.buildPanel(config)});
      const names = new Set(incoming.map(game => game.label));
      const roles = new Set(incoming.map(game => game.roleId));
      const merged = [...current.filter(game => !names.has(game.label) && !roles.has(game.roleId)), ...incoming];
      if (merged.length > 25) throw new GameInputError('저장할 게임 선택지는 최대 25개입니다.');
      await this.validateRoles(interaction, config, merged);
      games = await this.onboardingRepository.updateGameRoles(interaction.guildId, merged, current);
      if (!games) throw new GameInputError('게임 목록이나 역할 설정이 변경되었습니다. 게임 관리 화면을 다시 열어 주세요.');
    } else throw new GameInputError('게임 관리 화면을 다시 열어 주세요.');
    return this.reply(interaction, {content: '게임 목록을 저장했습니다.', ...this.buildPanel({...config, game_roles: games})});
  }

  handleError(interaction, error) {
    if (error instanceof GameInputError) return this.reply(interaction, error.message);
    logger.error('가입 게임 관리 실패', {guildId: interaction.guildId, userId: interaction.user?.id,
      customId: interaction.customId, error: error.message, stack: error.stack});
    return this.reply(interaction, '게임 목록을 저장하지 못했습니다. 잠시 후 게임 관리 화면을 다시 열어 주세요.');
  }
}
