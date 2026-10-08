import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
  StringSelectMenuBuilder
} from 'discord.js';
import {SafeInteraction} from '../utils/SafeInteraction.js';
import {logger} from '../config/logger-termux.js';
import {DiscordConstants} from '../config/DiscordConstants.js';

const IDS = {
  gender: DiscordConstants.CUSTOM_ID_PREFIXES.ONBOARDING_GENDER,
  games: DiscordConstants.CUSTOM_ID_PREFIXES.ONBOARDING_GAMES,
  rules: DiscordConstants.CUSTOM_ID_PREFIXES.ONBOARDING_RULES,
  apply: DiscordConstants.CUSTOM_ID_PREFIXES.ONBOARDING_APPLY,
  approve: DiscordConstants.CUSTOM_ID_PREFIXES.ONBOARDING_APPROVE,
  reject: DiscordConstants.CUSTOM_ID_PREFIXES.ONBOARDING_REJECT
};

export class OnboardingService {
  constructor(onboardingRepository) {
    this.onboardingRepository = onboardingRepository;
  }

  isInteraction(customId = '') {
    return customId.startsWith('onboarding:');
  }

  async handleMemberAdd(member) {
    if (member.user.bot) return;
    const config = await this.onboardingRepository.getConfig(member.guild.id);
    if (!config?.enabled) return;
    const progress = await this.onboardingRepository.ensureProgress(member.guild.id, member.id);
    if (progress.stage === 'gender') await member.roles.add(config.stage_role_ids.gender);
  }

  async transition(member, config, fromRoleId, toRoleId) {
    if (toRoleId && !member.roles.cache.has(toRoleId)) await member.roles.add(toRoleId);
    if (fromRoleId && member.roles.cache.has(fromRoleId)) await member.roles.remove(fromRoleId);
  }

  async handleInteraction(interaction) {
    await SafeInteraction.safeDeferUpdate(interaction);
    const config = await this.onboardingRepository.getConfig(interaction.guildId);
    if (!config?.enabled) return SafeInteraction.safeReply(interaction, {content: '가입 절차가 설정되지 않았습니다.', flags: MessageFlags.Ephemeral});
    const progress = await this.onboardingRepository.ensureProgress(interaction.guildId, interaction.user.id);
    try {
      if (interaction.customId === IDS.gender) return await this.selectGender(interaction, config, progress);
      if (interaction.customId === IDS.games) return await this.selectGames(interaction, config, progress);
      if (interaction.customId === IDS.rules) return await this.acceptRules(interaction, config, progress);
      if (interaction.customId === IDS.apply) return await this.apply(interaction, config, progress);
      if (interaction.customId.startsWith(IDS.approve)) return await this.review(interaction, config, true);
      if (interaction.customId.startsWith(IDS.reject)) return await this.review(interaction, config, false);
    } catch (error) {
      logger.error('온보딩 처리 실패', {guildId: interaction.guildId, userId: interaction.user.id, error: error.message});
      await SafeInteraction.safeReply(interaction, {content: '가입 단계 처리에 실패했습니다. 봇 역할 순서와 권한을 확인해 주세요.', flags: MessageFlags.Ephemeral});
    }
  }

  async selectGender(interaction, config, progress) {
    if (progress.stage !== 'gender') return this.wrongStage(interaction);
    const roleId = interaction.values[0] === 'male' ? config.gender_male_role_id : config.gender_female_role_id;
    await interaction.member.roles.add(roleId);
    await this.transition(interaction.member, config, config.stage_role_ids.gender, config.stage_role_ids.games);
    await this.onboardingRepository.setStage(interaction.guildId, interaction.user.id, 'games', {genderRoleId: roleId});
    return this.next(interaction, config.game_channel_id);
  }

  async selectGames(interaction, config, progress) {
    if (progress.stage !== 'games') return this.wrongStage(interaction);
    const allowed = new Set((config.game_roles || []).map(role => role.roleId));
    const roleIds = interaction.values.filter(id => allowed.has(id));
    if (!roleIds.length) return SafeInteraction.safeReply(interaction, {content: '게임을 하나 이상 선택해 주세요.', flags: MessageFlags.Ephemeral});
    await interaction.member.roles.add(roleIds);
    await this.transition(interaction.member, config, config.stage_role_ids.games, config.stage_role_ids.rules);
    await this.onboardingRepository.setStage(interaction.guildId, interaction.user.id, 'rules', {gameRoleIds: roleIds});
    return this.next(interaction, config.rules_channel_id);
  }

  async acceptRules(interaction, config, progress) {
    if (progress.stage !== 'rules') return this.wrongStage(interaction);
    await this.transition(interaction.member, config, config.stage_role_ids.rules, config.stage_role_ids.application);
    await this.onboardingRepository.setStage(interaction.guildId, interaction.user.id, 'application', {rulesAccepted: true});
    return this.next(interaction, config.application_channel_id);
  }

  async apply(interaction, config, progress) {
    if (progress.stage !== 'application') return this.wrongStage(interaction);
    await this.transition(interaction.member, config, config.stage_role_ids.application, config.pending_role_id);
    await this.onboardingRepository.setStage(interaction.guildId, interaction.user.id, 'pending', {applied: true});
    const channel = await interaction.guild.channels.fetch(config.review_channel_id);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${IDS.approve}${interaction.user.id}`).setLabel('승인').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${IDS.reject}${interaction.user.id}`).setLabel('거절').setStyle(ButtonStyle.Danger)
    );
    await channel.send({embeds: [new EmbedBuilder().setTitle('신규 등업 신청').setDescription(`<@${interaction.user.id}> 님의 가입 신청입니다.`)], components: [row]});
    return SafeInteraction.safeReply(interaction, {content: '등업 신청이 접수되었습니다. 관리자 승인을 기다려 주세요.', flags: MessageFlags.Ephemeral});
  }

  async review(interaction, config, approved) {
    if (!interaction.member.permissions.has('Administrator')) return SafeInteraction.safeReply(interaction, {content: '관리자만 처리할 수 있습니다.', flags: MessageFlags.Ephemeral});
    const userId = interaction.customId.split(':')[2];
    const progress = await this.onboardingRepository.getProgress(interaction.guildId, userId);
    if (progress?.stage !== 'pending') return SafeInteraction.safeReply(interaction, {content: '이미 처리되었거나 유효하지 않은 신청입니다.', flags: MessageFlags.Ephemeral});
    const member = await interaction.guild.members.fetch(userId);
    if (approved) {
      await this.transition(member, config, config.pending_role_id, config.member_role_id);
      await this.onboardingRepository.setStage(interaction.guildId, userId, 'approved', {reviewedBy: interaction.user.id});
    } else {
      await this.transition(member, config, config.pending_role_id, config.stage_role_ids.application);
      await this.onboardingRepository.setStage(interaction.guildId, userId, 'application', {reviewedBy: interaction.user.id, rejectionReason: '관리자 거절'});
    }
    await interaction.message.edit({components: []});
    return SafeInteraction.safeReply(interaction, {content: approved ? `<@${userId}> 님을 승인했습니다.` : `<@${userId}> 님의 신청을 거절했습니다.`, flags: MessageFlags.Ephemeral});
  }

  wrongStage(interaction) { return SafeInteraction.safeReply(interaction, {content: '현재 진행 단계와 맞지 않습니다.', flags: MessageFlags.Ephemeral}); }
  next(interaction, channelId) { return SafeInteraction.safeReply(interaction, {content: `완료되었습니다. 다음 단계: <#${channelId}>`, flags: MessageFlags.Ephemeral}); }

  buildMessages(config) {
    const gender = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(IDS.gender).setPlaceholder('성별 선택').addOptions(
      {label: '남성', value: 'male'}, {label: '여성', value: 'female'}));
    const games = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(IDS.games).setPlaceholder('게임 선택').setMinValues(1).setMaxValues(Math.max(1, Math.min(25, config.game_roles.length))).addOptions(config.game_roles.map(role => ({label: role.label, value: role.roleId}))));
    const button = (id, label) => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Success));
    return {gender: {content: '환영합니다! 본인의 성별을 선택해 주세요.', components: [gender]}, games: {content: '플레이하는 게임을 모두 선택해 주세요.', components: [games]}, rules: {content: '서버 규칙을 모두 읽은 뒤 동의해 주세요.', components: [button(IDS.rules, '규칙에 동의합니다')]}, application: {content: '모든 가입 절차를 마쳤습니다. 등업을 신청해 주세요.', components: [button(IDS.apply, '등업 신청')]}};
  }
}
