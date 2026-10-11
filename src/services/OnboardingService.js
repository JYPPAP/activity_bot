import {ChannelType, MessageFlags, PermissionFlagsBits} from 'discord.js';
import {SafeInteraction} from '../utils/SafeInteraction.js';
import {logger} from '../config/logger-termux.js';
import {DiscordConstants} from '../config/DiscordConstants.js';
import {OnboardingUIBuilder} from '../ui/OnboardingUIBuilder.js';

const IDS = DiscordConstants.CUSTOM_ID_PREFIXES;
const CLEANUP_DELAY = 10 * 60 * 1000;
const topicFor = p => `onboarding:${p.guild_id}:${p.user_id}`;
const cardMarker = p => `onboarding-card:${p.guild_id}:${p.user_id}`;
const reviewMarker = p => `onboarding-review:${p.guild_id}:${p.user_id}:${new Date(p.applied_at).toISOString()}`;
const footerOf = message => message.embeds?.[0]?.footer?.text;

export class OnboardingService {
  constructor(onboardingRepository, client) {
    this.onboardingRepository = onboardingRepository;
    this.client = client;
    this.cleanupTimer = null;
    this.maintaining = false;
  }

  isInteraction(customId = '') { return customId.startsWith('onboarding:'); }

  logError(error, context) {
    logger.error('개인 가입 채널 처리 실패', {...context, error: error.message, stack: error.stack});
  }

  async fetchOptional(manager, id) {
    if (!id) return null;
    try { return await manager.fetch(id); }
    catch (error) {
      if ([10003, 10008, 10007].includes(Number(error.code))) return null;
      throw error;
    }
  }

  async initialize() {
    for (const progress of await this.onboardingRepository.getActiveProgress()) await this.restoreProgress(progress);
    await this.maintenance();
    this.stop();
    this.cleanupTimer = setInterval(() => {
      this.maintenance().catch(error => this.logError(error, {operation: 'maintenance'}));
    }, 60 * 1000);
    this.cleanupTimer.unref();
  }

  stop() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }

  async maintenance() {
    if (this.maintaining) return;
    this.maintaining = true;
    try {
      for (const progress of await this.onboardingRepository.getInterruptedProgress()) await this.restoreProgress(progress);
      for (const progress of await this.onboardingRepository.getDueCleanup()) {
        try {
          await this.onboardingRepository.withMemberLock(progress.guild_id, progress.user_id, async repository => {
            const current = await repository.getProgress(progress.guild_id, progress.user_id);
            if (current?.stage === 'approved' && !current.review_action && current.cleanup_at && new Date(current.cleanup_at) <= new Date()) {
              const guild = this.client.guilds.cache.get(progress.guild_id);
              if (guild) {
                const member = await this.fetchOptional(guild.members, current.user_id);
                await this.removeSessionChannel(guild, current, repository, !member);
              }
            }
          });
        } catch (error) { this.logError(error, {operation: 'cleanup', userId: progress.user_id}); }
      }
    } finally { this.maintaining = false; }
  }

  async restoreProgress(progress) {
    const guild = this.client.guilds.cache.get(progress.guild_id);
    if (!guild) return;
    try {
      await this.onboardingRepository.withMemberLock(progress.guild_id, progress.user_id, async repository => {
        const current = await repository.getProgress(progress.guild_id, progress.user_id);
        const config = await repository.getConfig(progress.guild_id);
        if (!current || !config?.enabled || !config.category_id) return;
        const member = await this.fetchOptional(guild.members, progress.user_id);
        if (!member) return this.removeSessionChannel(guild, current, repository, true);
        if (current.review_action) await this.completeReview(member, config, current, repository);
        else if (current.stage === 'approved') {
          await this.updateReviewMessage(guild, config, current);
          const channel = await this.fetchOptional(guild.channels, current.channel_id);
          if (channel) await this.ensureCard(channel, config, current, repository);
        } else await this.resumeSession(member, config, current, repository);
      });
    } catch (error) { this.logError(error, {operation: 'restore', guildId: progress.guild_id, userId: progress.user_id}); }
  }

  async handleMemberAdd(member) {
    if (member.user.bot) return;
    const config = await this.onboardingRepository.getConfig(member.guild.id);
    if (config?.enabled && config.category_id) await this.openSession(member);
  }

  async handleMemberRemove(member) {
    if (member.user.bot) return;
    await this.onboardingRepository.withMemberLock(member.guild.id, member.id, async repository => {
      const progress = await repository.getProgress(member.guild.id, member.id);
      if (progress) await this.removeSessionChannel(member.guild, progress, repository, true);
    });
  }

  async openSession(member) {
    if (member.user.bot) return null;
    return this.onboardingRepository.withMemberLock(member.guild.id, member.id, async repository => {
      const config = await repository.getConfig(member.guild.id);
      if (!config?.enabled || !config.category_id) throw new Error('가입관리 설정을 먼저 완료해 주세요.');
      let progress = await repository.getProgress(member.guild.id, member.id);
      if (progress?.departed_at) progress = await repository.saveProgress(member.guild.id, member.id, {departedAt: null});
      if (progress?.review_action) {
        await this.completeReview(member, config, progress, repository);
        progress = await repository.getProgress(member.guild.id, member.id);
      }
      if (progress?.stage === 'approved') {
        await this.grantMemberRoles(member, config, progress);
        return null;
      }
      if (member.roles.cache.has(config.member_role_id)) return null;
      progress ||= await repository.ensureProgress(member.guild.id, member.id);
      return this.resumeSession(member, config, progress, repository);
    });
  }

  async resumeSession(member, config, progress, repository) {
    const obsolete = Object.values(config.stage_role_ids || {}).filter(id => member.roles.cache.has(id));
    if (obsolete.length) await member.roles.remove(obsolete);
    if (progress.review_action) {
      await this.completeReview(member, config, progress, repository);
      progress = await repository.getProgress(member.guild.id, member.id);
    }
    const channel = await this.ensureChannel(member, config, progress, repository);
    progress = await repository.getProgress(member.guild.id, member.id);
    if (progress.stage === 'pending') {
      await this.validateRoles(member.guild, config, progress);
      await member.roles.add(config.pending_role_id);
      progress = await this.ensureReviewMessage(member.guild, config, progress, repository);
    }
    await this.ensureCard(channel, config, progress, repository);
    return channel;
  }

  assertSessionChannel(channel, progress) {
    if (channel.type !== ChannelType.GuildText || channel.topic !== topicFor(progress)) {
      throw new Error('가입 채널의 사용자 식별 정보가 일치하지 않습니다.');
    }
  }

  async ensureChannel(member, config, progress, repository) {
    let channel = await this.fetchOptional(member.guild.channels, progress.channel_id);
    if (channel) { this.assertSessionChannel(channel, progress); return channel; }
    // 채널 생성 직후 종료되어 DB에 ID를 기록하지 못한 경우에도 기존 채널을 다시 찾는다.
    const channels = await member.guild.channels.fetch();
    channel = channels.find(item => item?.type === ChannelType.GuildText && item.topic === topicFor(progress));
    if (!channel) {
      const name = (member.user.username || '회원').replace(/[^\p{L}\p{N}-]/gu, '-').slice(0, 40);
      channel = await member.guild.channels.create({
        name: `가입-${name}-${member.id.slice(-6)}`, type: ChannelType.GuildText,
        parent: config.category_id, topic: topicFor(progress), reason: '신규 회원 개인 가입 안내',
        permissionOverwrites: [
          {id: member.guild.id, deny: [PermissionFlagsBits.ViewChannel]},
          {id: this.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks]},
          {id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads,
              PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads]},
        ],
      });
    }
    await repository.saveProgress(progress.guild_id, progress.user_id, {channelId: channel.id, messageId: null});
    return channel;
  }

  async findMarkedMessage(channel, marker, since = null) {
    let before;
    do {
      const messages = await channel.messages.fetch({limit: 100, ...(before ? {before} : {})});
      const found = messages.find(message => message.author.id === this.client.user.id && footerOf(message) === marker);
      if (found) return found;
      const oldest = messages.last();
      if (messages.size < 100 || !since || oldest.createdTimestamp < new Date(since).getTime() - 60 * 1000) return null;
      before = oldest.id;
    } while (before);
    return null;
  }

  async ensureCard(channel, config, progress, repository) {
    this.assertSessionChannel(channel, progress);
    let message = await this.fetchOptional(channel.messages, progress.message_id);
    if (message && (message.author.id !== this.client.user.id || footerOf(message) !== cardMarker(progress))) {
      throw new Error('가입 안내 메시지의 식별 정보가 일치하지 않습니다.');
    }
    message ||= await this.findMarkedMessage(channel, cardMarker(progress));
    if (!message) return this.replaceCard(channel, config, progress, repository);
    await message.edit(OnboardingUIBuilder.buildCard(config, progress));
    await repository.saveProgress(progress.guild_id, progress.user_id, {messageId: message.id});
    await this.pruneCards(channel, progress, message.id);
    return message;
  }

  async replaceCard(channel, config, progress, repository) {
    this.assertSessionChannel(channel, progress);
    const message = await channel.send(OnboardingUIBuilder.buildCard(config, progress));
    await repository.saveProgress(progress.guild_id, progress.user_id, {messageId: message.id});
    await this.pruneCards(channel, progress, message.id);
    return message;
  }

  async pruneCards(channel, progress, keepId) {
    const messages = await channel.messages.fetch({limit: 100});
    for (const message of messages.values()) {
      if (message.id !== keepId && message.author.id === this.client.user.id && footerOf(message) === cardMarker(progress)) {
        try { await message.delete(); }
        catch (error) { logger.warn('이전 가입 카드 삭제 실패', {channelId: channel.id, messageId: message.id, error: error.message}); }
      }
    }
  }

  async publishWelcome(guild) {
    return this.onboardingRepository.withMemberLock(guild.id, 'welcome', async repository => {
      const config = await repository.getConfig(guild.id);
      if (!config?.enabled || !config.category_id) throw new Error('먼저 /가입관리 설정을 실행해 주세요.');
      const channel = await guild.channels.fetch(config.welcome_channel_id);
      const payload = OnboardingUIBuilder.buildWelcome();
      payload.embeds[0].setFooter({text: 'onboarding-welcome'});
      let message = await this.fetchOptional(channel.messages, config.welcome_message_id);
      if (message && (message.author.id !== this.client.user.id || footerOf(message) !== 'onboarding-welcome')) throw new Error('가입 시작 메시지의 식별 정보가 일치하지 않습니다.');
      message ||= await this.findMarkedMessage(channel, 'onboarding-welcome');
      message = message ? await message.edit(payload) : await channel.send(payload);
      await repository.saveWelcomeMessage(guild.id, message.id);
      return message;
    });
  }

  async handleInteraction(interaction) {
    await SafeInteraction.safeDeferReply(interaction, {ephemeral: true});
    try {
      if (!interaction.guild || !interaction.member) return this.reply(interaction, '서버 안에서만 사용할 수 있습니다.');
      if (interaction.customId === IDS.ONBOARDING_START) {
        const config = await this.onboardingRepository.getConfig(interaction.guildId);
        if (interaction.channelId !== config?.welcome_channel_id) return this.reply(interaction, '가입 안내 채널에서 시작해 주세요.');
        const channel = await this.openSession(interaction.member);
        return this.reply(interaction, channel ? `개인 가입 채널에서 이어서 진행해 주세요: <#${channel.id}>` : '이미 정회원 가입이 완료되었습니다.');
      }
      if (interaction.customId.startsWith(IDS.ONBOARDING_APPROVE) || interaction.customId.startsWith(IDS.ONBOARDING_REJECT)) return await this.review(interaction);
      const errorMessage = await this.onboardingRepository.withMemberLock(interaction.guildId, interaction.user.id, async repository => {
        const config = await repository.getConfig(interaction.guildId);
        const progress = await repository.getProgress(interaction.guildId, interaction.user.id);
        if (!config?.enabled || !config.category_id) return '가입관리 설정을 먼저 완료해 주세요.';
        if (!progress || progress.channel_id !== interaction.channelId || progress.message_id !== interaction.message.id) {
          return '현재 가입 화면이 아닙니다. 가입 안내 채널에서 이어하기를 눌러 주세요.';
        }
        this.assertSessionChannel(interaction.channel, progress);
        return this.processStep(interaction, config, progress, repository);
      });
      if (errorMessage) return this.reply(interaction, errorMessage);
      try { await interaction.deleteReply(); }
      catch (error) { logger.warn('가입 처리 응답 정리 실패', {error: error.message, interactionId: interaction.id}); }
    } catch (error) {
      this.logError(error, {guildId: interaction.guildId, userId: interaction.user.id, customId: interaction.customId});
      await this.reply(interaction, '처리를 완료하지 못했습니다. 잠시 후 가입 안내 채널의 이어하기를 눌러 주세요.');
    }
  }

  reply(interaction, content) {
    return SafeInteraction.safeReply(interaction, {content, flags: MessageFlags.Ephemeral, allowedMentions: {parse: []}});
  }

  async processStep(interaction, config, progress, repository) {
    const id = interaction.customId;
    let patch;
    if (progress.review_action) return '관리자 심사 결과를 반영 중입니다. 잠시 후 다시 진행해 주세요.';
    if (id === IDS.ONBOARDING_CLOSE && progress.stage === 'approved') {
      await this.removeSessionChannel(interaction.guild, progress, repository);
      return null;
    }
    if (id.startsWith(IDS.ONBOARDING_GENDER_CHOICE) && progress.stage === 'gender') {
      const value = id.slice(IDS.ONBOARDING_GENDER_CHOICE.length);
      if (!['male', 'female'].includes(value)) return '성별 선택이 올바르지 않습니다.';
      patch = {stage: 'games', genderRoleId: value === 'male' ? config.gender_male_role_id : config.gender_female_role_id};
    } else if (id === IDS.ONBOARDING_GAMES && progress.stage === 'games') {
      const allowed = new Set(config.game_roles.map(game => game.roleId));
      const selected = [...new Set(interaction.values || [])];
      if (!selected.length || selected.some(roleId => !allowed.has(roleId))) return '등록된 게임을 하나 이상 선택해 주세요.';
      const updated = await repository.saveProgress(progress.guild_id, progress.user_id, {gameRoleIds: selected});
      await interaction.message.edit(OnboardingUIBuilder.buildCard(config, updated));
      return null;
    } else if (id === IDS.ONBOARDING_GAMES_CONFIRM && progress.stage === 'games') {
      if (!this.validSelections(config, progress)) return '성별과 등록된 게임을 하나 이상 선택해 주세요.';
      patch = {stage: 'rules'};
    } else if (id === IDS.ONBOARDING_RULES && progress.stage === 'rules') {
      patch = {stage: 'application', rulesAcceptedAt: new Date()};
    } else if (id.startsWith(IDS.ONBOARDING_BACK)) {
      const target = id.slice(IDS.ONBOARDING_BACK.length);
      const destinations = {games: ['gender'], rules: ['games'], application: ['gender', 'games']};
      if (!destinations[progress.stage]?.includes(target)) return '현재 단계에서 이동할 수 없는 화면입니다.';
      patch = {stage: target, rulesAcceptedAt: null};
    } else if (id === IDS.ONBOARDING_APPLY && progress.stage === 'application') {
      if (!this.validSelections(config, progress) || !progress.rules_accepted_at) return '성별·게임 선택과 규칙 동의를 완료해 주세요.';
      await this.validateRoles(interaction.guild, config, progress);
      const updated = await repository.saveProgress(progress.guild_id, progress.user_id, {
        stage: 'pending', appliedAt: new Date(), messageId: null, reviewMessageId: null, reviewAction: null, rejectionReason: null,
      });
      await interaction.member.roles.add(config.pending_role_id);
      await this.ensureReviewMessage(interaction.guild, config, updated, repository);
      await this.replaceCard(interaction.channel, config, updated, repository);
      return null;
    } else return '현재 진행 단계와 맞지 않는 요청입니다.';
    const updated = await repository.saveProgress(progress.guild_id, progress.user_id, {...patch, messageId: null});
    await this.replaceCard(interaction.channel, config, updated, repository);
    return null;
  }

  validSelections(config, progress) {
    const allowed = new Set((config.game_roles || []).map(game => game.roleId));
    return [config.gender_male_role_id, config.gender_female_role_id].includes(progress.gender_role_id)
      && progress.game_role_ids?.length > 0 && progress.game_role_ids.every(id => allowed.has(id));
  }

  async validateRoles(guild, config, progress) {
    if (progress.stage !== 'approved' && !this.validSelections(config, progress)) throw new Error('가입 역할 선택을 다시 확인해야 합니다.');
    const selected = progress.stage === 'approved'
      ? [...([config.gender_male_role_id, config.gender_female_role_id].includes(progress.gender_role_id) ? [progress.gender_role_id] : []),
        ...(progress.game_role_ids || []).filter(id => config.game_roles.some(game => game.roleId === id))]
      : [progress.gender_role_id, ...progress.game_role_ids];
    const bot = await guild.members.fetchMe();
    const ids = [config.member_role_id, config.pending_role_id, ...selected];
    if (new Set(ids).size !== ids.length) throw new Error('가입 역할 설정이 중복되었습니다.');
    for (const id of ids) {
      const role = await guild.roles.fetch(id);
      if (!role || role.id === guild.id || role.managed || role.permissions.has(PermissionFlagsBits.Administrator)
        || bot.roles.highest.comparePositionTo(role) <= 0) throw new Error('봇이 지급할 수 없는 가입 역할입니다.');
    }
    return [...selected, config.member_role_id];
  }

  async grantMemberRoles(member, config, progress) {
    const roles = await this.validateRoles(member.guild, config, progress);
    await member.roles.add(roles);
    await member.roles.remove(config.pending_role_id);
  }

  async ensureReviewMessage(guild, config, progress, repository) {
    if (!progress.applied_at) progress = await repository.saveProgress(progress.guild_id, progress.user_id, {appliedAt: new Date()});
    const channel = await guild.channels.fetch(config.review_channel_id);
    let message = await this.fetchOptional(channel.messages, progress.review_message_id);
    if (message && (message.author.id !== this.client.user.id || footerOf(message) !== reviewMarker(progress))) throw new Error('심사 메시지의 식별 정보가 일치하지 않습니다.');
    message ||= await this.findMarkedMessage(channel, reviewMarker(progress), progress.applied_at);
    if (!message) message = await channel.send(OnboardingUIBuilder.buildReview(config, progress));
    return repository.saveProgress(progress.guild_id, progress.user_id, {reviewMessageId: message.id});
  }

  async review(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return this.reply(interaction, '관리자만 처리할 수 있습니다.');
    const approved = interaction.customId.startsWith(IDS.ONBOARDING_APPROVE);
    const userId = interaction.customId.slice((approved ? IDS.ONBOARDING_APPROVE : IDS.ONBOARDING_REJECT).length);
    const result = await this.onboardingRepository.withMemberLock(interaction.guildId, userId, async repository => {
      const config = await repository.getConfig(interaction.guildId);
      let progress = await repository.getProgress(interaction.guildId, userId);
      if (!config?.enabled || interaction.channelId !== config.review_channel_id || progress?.stage !== 'pending'
        || progress.review_message_id !== interaction.message.id) return '이미 처리되었거나 유효하지 않은 신청입니다.';
      const action = approved ? 'approve' : 'reject';
      if (progress.review_action && progress.review_action !== action) return '다른 심사 결정이 이미 처리 중입니다.';
      const member = await this.fetchOptional(interaction.guild.members, userId);
      if (!member) return '해당 사용자는 현재 서버에 없습니다.';
      if (!progress.review_action) progress = await repository.saveProgress(interaction.guildId, userId, {
        reviewAction: action, reviewedBy: interaction.user.id,
      });
      await this.completeReview(member, config, progress, repository);
      return approved ? '가입을 승인했습니다.' : '신청을 거절하고 수정·재신청 화면으로 돌려보냈습니다.';
    });
    return this.reply(interaction, result);
  }

  async completeReview(member, config, progress, repository) {
    const approved = progress.review_action === 'approve';
    if (progress.stage === 'pending') {
      if (approved) await this.grantMemberRoles(member, config, progress);
      else await member.roles.remove(config.pending_role_id);
      progress = await repository.saveProgress(progress.guild_id, progress.user_id, {
        stage: approved ? 'approved' : 'application', reviewedAt: new Date(), messageId: null,
        rejectionReason: approved ? null : '관리자가 신청을 거절했습니다. 입력 내용을 확인하고 다시 신청해 주세요.',
        cleanupAt: approved ? new Date(Date.now() + CLEANUP_DELAY) : null,
      });
    }
    await this.updateReviewMessage(member.guild, config, progress);
    const channel = await this.fetchOptional(member.guild.channels, progress.channel_id);
    if (channel) {
      if (progress.message_id) await this.ensureCard(channel, config, progress, repository);
      else await this.replaceCard(channel, config, progress, repository);
    }
    await repository.saveProgress(progress.guild_id, progress.user_id, {reviewAction: null,
      ...(!approved ? {reviewMessageId: null} : {})});
  }

  async updateReviewMessage(guild, config, progress) {
    if (!progress.review_message_id) return;
    const channel = await guild.channels.fetch(config.review_channel_id);
    const message = await this.fetchOptional(channel.messages, progress.review_message_id);
    if (message) {
      if (message.author.id !== this.client.user.id || footerOf(message) !== reviewMarker(progress)) throw new Error('심사 메시지 식별 정보가 일치하지 않습니다.');
      await message.edit(OnboardingUIBuilder.buildReviewed(config, progress));
    }
  }

  async removeSessionChannel(guild, progress, repository, departed = false) {
    if (departed) {
      await repository.saveProgress(progress.guild_id, progress.user_id, {messageId: null,
        ...(progress.stage === 'approved' ? {cleanupAt: new Date()} : {})});
    }
    let channel = await this.fetchOptional(guild.channels, progress.channel_id);
    if (!channel) {
      const channels = await guild.channels.fetch();
      channel = channels.find(item => item?.type === ChannelType.GuildText && item.topic === topicFor(progress));
    }
    if (channel) {
      this.assertSessionChannel(channel, progress);
      await channel.delete('개인 가입 절차 종료');
    }
    await repository.saveProgress(progress.guild_id, progress.user_id, {channelId: null, messageId: null, cleanupAt: null,
      ...(departed ? {departedAt: new Date()} : {})});
  }
}
