import {ChannelType, MessageFlags, PermissionFlagsBits, OverwriteType} from 'discord.js';
import {hasCommandPermission} from '../config/commandPermissions.js';
import {SafeInteraction} from '../utils/SafeInteraction.js';
import {DiscordConstants} from '../config/DiscordConstants.js';
import {config as environment} from '../config/env.js';
import {loadOnboardingRules} from '../config/OnboardingRules.js';

class OnboardingSetupError extends Error {}

export class OnboardingManagementCommand {
  constructor(onboardingRepository, onboardingService) {
    this.onboardingRepository = onboardingRepository;
    this.onboardingService = onboardingService;
  }

  async execute(interaction) {
    if (!hasCommandPermission(interaction.member, '가입관리')) {
      return SafeInteraction.safeReply(interaction, {content: '사장 역할 또는 개발자 권한이 필요합니다.', flags: MessageFlags.Ephemeral});
    }
    await SafeInteraction.safeDeferReply(interaction, {ephemeral: true});
    try {
      return await this.dispatch(interaction);
    } catch (error) {
      if (!(error instanceof OnboardingSetupError)) throw error;
      return SafeInteraction.safeReply(interaction, {content: error.message, flags: MessageFlags.Ephemeral});
    }
  }

  async dispatch(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === '설정') return this.configure(interaction);
    if (subcommand === '게임추가') {
      const config = await this.onboardingRepository.getConfig(interaction.guildId);
      if (!config?.enabled || !config.category_id) throw new OnboardingSetupError('먼저 /가입관리 설정을 완료해 주세요.');
      const bot = await interaction.guild.members.fetchMe();
      const role = await interaction.guild.roles.fetch(interaction.options.getRole('역할', true).id);
      this.validateRole(role, bot, interaction.guildId);
      const reserved = [config?.gender_male_role_id, config?.gender_female_role_id, config?.pending_role_id,
        DiscordConstants.ROLE_IDS.MEMBER, ...Object.values(config?.stage_role_ids ?? {})];
      if (reserved.includes(role.id)) throw new OnboardingSetupError('게임 역할은 성별·대기·정회원·기존 단계 역할과 달라야 합니다.');
      const name = interaction.options.getString('이름', true).trim();
      if (!name || name.length > 100) throw new OnboardingSetupError('게임 이름은 1~100자로 입력해 주세요.');
      const remainingGames = (config.game_roles ?? []).filter(game => game.roleId !== role.id && game.label !== name);
      if (remainingGames.length >= 25) throw new OnboardingSetupError('게임 선택지는 최대 25개입니다. 기존 이름이나 역할로 수정해 주세요.');
      const roles = await this.onboardingRepository.addGameRole(interaction.guildId, name, role.id);
      return SafeInteraction.safeReply(interaction, {content: `게임 역할을 저장했습니다. 현재 ${roles.length}개입니다.`});
    }
    await this.onboardingService.publishWelcome(interaction.guild);
    return SafeInteraction.safeReply(interaction, {content: '온보딩 채널에 가입 시작 / 이어하기 안내를 게시했습니다.'});
  }

  validateRole(role, bot, guildId) {
    if (!role || role.guild.id !== guildId || role.id === guildId || role.managed ||
        role.permissions.has(PermissionFlagsBits.Administrator) ||
        bot.roles.highest.comparePositionTo(role) <= 0 ||
        !bot.permissions.has(PermissionFlagsBits.ManageRoles)) {
      throw new OnboardingSetupError('역할을 확인해 주세요. 일반 역할을 선택하고 봇에 역할 관리 권한을 부여한 뒤 봇 역할을 그 위로 올려 주세요.');
    }
  }

  async configure(interaction) {
    const guild = interaction.guild;
    const config = await this.onboardingRepository.getConfig(guild.id);
    const rulesText = interaction.options.getString('규칙')?.trim() || config?.rules_text || '';
    try {
      await loadOnboardingRules(rulesText);
    } catch (error) {
      throw new OnboardingSetupError(`가입 규칙을 확인해 주세요: ${error.message}`);
    }
    const categoryId = environment.ONBOARDING_CATEGORY_ID ||
      interaction.options.getChannel('가입카테고리')?.id || config?.category_id;
    if (!categoryId) throw new OnboardingSetupError('가입 카테고리를 선택하거나 .env의 ONBOARDING_CATEGORY_ID에 카테고리 ID를 설정해 주세요.');
    const welcome = await guild.channels.fetch(DiscordConstants.CHANNEL_IDS.ONBOARDING);
    const category = await guild.channels.fetch(categoryId);
    const review = await guild.channels.fetch(interaction.options.getChannel('심사채널', true).id);
    if (!welcome || !category || !review || welcome.guild.id !== guild.id ||
        category.guild.id !== guild.id || review.guild.id !== guild.id ||
        welcome.type !== ChannelType.GuildText || category.type !== ChannelType.GuildCategory ||
        review.type !== ChannelType.GuildText || review.id === welcome.id) {
      throw new OnboardingSetupError('서버 내 가입 카테고리와 별도의 관리자 전용 심사 채널을 선택해 주세요.');
    }
    const bot = await guild.members.fetchMe();
    if (!bot.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.SendMessagesInThreads])) {
      throw new OnboardingSetupError('봇 역할의 서버 권한에 채널 관리·역할 관리·채널 보기·메시지 보내기·기록 보기·Embed 링크·공개 스레드 만들기·비공개 스레드 만들기·스레드에서 메시지 보내기가 필요합니다. 개인 채널 권한 설정을 위해 채널별 허용뿐 아니라 서버 권한도 부여해 주세요.');
    }
    const messagePermissions = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
    if (!welcome.permissionsFor(bot)?.has([...messagePermissions, PermissionFlagsBits.ManageRoles]) ||
        !review.permissionsFor(bot)?.has([...messagePermissions, PermissionFlagsBits.ManageRoles]) ||
        !category.permissionsFor(bot)?.has([...messagePermissions, PermissionFlagsBits.ManageChannels])) {
      throw new OnboardingSetupError('봇의 채널별 권한을 확인해 주세요. 채널 보기·메시지 보내기·Embed 링크·기록 보기, 온보딩·심사 채널의 역할 관리 및 가입 카테고리의 채널 관리 권한이 필요합니다.');
    }
    const roleIds = {
      maleRoleId: interaction.options.getRole('남성역할', true).id,
      femaleRoleId: interaction.options.getRole('여성역할', true).id,
      pendingRoleId: interaction.options.getRole('대기역할', true).id,
      memberRoleId: DiscordConstants.ROLE_IDS.MEMBER
    };
    if (new Set(Object.values(roleIds)).size !== 4) throw new OnboardingSetupError('성별·대기·정회원 역할은 모두 서로 달라야 합니다.');
    for (const id of Object.values(roleIds)) this.validateRole(await guild.roles.fetch(id), bot, guild.id);
    if (config?.game_roles?.some(game => Object.values(roleIds).includes(game.roleId))) {
      throw new OnboardingSetupError('성별·대기·정회원 역할을 기존 게임 역할과 다르게 선택해 주세요.');
    }
    const roles = await guild.roles.fetch();
    for (const role of roles.values()) {
      if (role.tags?.botId !== bot.id && !role.permissions.has(PermissionFlagsBits.Administrator) &&
          review.permissionsFor(role)?.has(PermissionFlagsBits.ViewChannel)) {
        throw new OnboardingSetupError('심사 채널이 일반 역할에 공개되어 있습니다. 관리자와 봇만 볼 수 있도록 먼저 권한을 설정해 주세요.');
      }
    }
    for (const overwrite of review.permissionOverwrites.cache.values()) {
      if (overwrite.type !== OverwriteType.Member || overwrite.id === bot.id || overwrite.id === interaction.user.id) continue;
      const member = await guild.members.fetch(overwrite.id).catch(error => {
        if (Number(error.code) === 10007) return null;
        throw error;
      });
      if (member && !member.permissions.has(PermissionFlagsBits.Administrator) &&
          review.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)) {
        throw new OnboardingSetupError('심사 채널에 다른 일반 사용자 접근 권한이 있습니다. 본인·관리자·봇만 볼 수 있도록 먼저 권한을 설정해 주세요.');
      }
    }
    // Preserve the category's existing channels; personal channels receive explicit private overwrites.
    await review.permissionOverwrites.edit(interaction.user.id, {ViewChannel: true, ReadMessageHistory: true});
    await welcome.permissionOverwrites.edit(bot.id, {ViewChannel: true, SendMessages: true});
    await welcome.permissionOverwrites.edit(guild.roles.everyone, {ViewChannel: true, SendMessages: false});
    const legacyRoles = new Set(Object.values(config?.stage_role_ids ?? {}));
    for (const role of roles.values()) {
      if (role.id === guild.id || role.permissions.has(PermissionFlagsBits.Administrator)) continue;
      if (legacyRoles.has(role.id)) {
        await welcome.permissionOverwrites.edit(role.id, {ViewChannel: null, SendMessages: false});
      } else if (welcome.permissionsFor(role)?.has(PermissionFlagsBits.SendMessages)) {
        await welcome.permissionOverwrites.edit(role.id, {SendMessages: false});
      }
    }
    for (const overwrite of welcome.permissionOverwrites.cache.values()) {
      if (overwrite.type === OverwriteType.Member && overwrite.id !== bot.id &&
          overwrite.allow.has(PermissionFlagsBits.SendMessages)) {
        await welcome.permissionOverwrites.edit(overwrite.id, {SendMessages: false});
      }
    }
    await this.onboardingRepository.saveConfig(guild.id, {
      welcomeChannelId: welcome.id, categoryId: category.id, reviewChannelId: review.id,
      reviewManagerUserId: interaction.user.id,
      ...roleIds, rulesText
    });
    return SafeInteraction.safeReply(interaction, {content: '개인 가입 채널 설정을 저장하고 본인을 심사 담당자로 등록했습니다. 게임 역할을 추가한 뒤 /가입관리 게시를 실행해 주세요.'});
  }
}
