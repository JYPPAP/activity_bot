import {MessageFlags} from 'discord.js';
import {hasCommandPermission} from '../config/commandPermissions.js';
import {SafeInteraction} from '../utils/SafeInteraction.js';
import {DiscordConstants} from '../config/DiscordConstants.js';

export class OnboardingManagementCommand {
  constructor(onboardingRepository, onboardingService) {
    this.onboardingRepository = onboardingRepository;
    this.onboardingService = onboardingService;
  }

  async execute(interaction) {
    if (!hasCommandPermission(interaction.member, '가입관리')) {
      await SafeInteraction.safeReply(interaction, {content: '사장 역할 또는 개발자 권한이 필요합니다.', flags: MessageFlags.Ephemeral});
      return;
    }
    const subcommand = interaction.options.getSubcommand();
    await SafeInteraction.safeDeferReply(interaction, {ephemeral: true});
    if (subcommand === '설정') {
      const value = name => interaction.options.get(name, true).value;
      const channelIds = {
        gender: DiscordConstants.CHANNEL_IDS.ONBOARDING,
        games: value('게임채널'),
        rules: value('규칙채널'),
        application: value('신청채널')
      };
      const reviewChannelId = value('심사채널');
      const stageRoleIds = {
        gender: value('성별단계역할'), games: value('게임단계역할'),
        rules: value('규칙단계역할'), application: value('신청단계역할')
      };
      const roleIds = {
        male: value('남성역할'), female: value('여성역할'),
        pending: value('대기역할'), member: DiscordConstants.ROLE_IDS.MEMBER,
        ...stageRoleIds
      };
      if (new Set([...Object.values(channelIds), reviewChannelId]).size !== 5) {
        return SafeInteraction.safeReply(interaction, {content: '가입 단계와 심사 채널은 모두 서로 달라야 합니다.'});
      }
      if (new Set(Object.values(roleIds)).size !== Object.keys(roleIds).length) {
        return SafeInteraction.safeReply(interaction, {content: '가입 관리에 사용하는 역할은 모두 서로 달라야 합니다.'});
      }
      const saved = await this.onboardingRepository.saveConfig(interaction.guildId, {
        welcomeChannelId: channelIds.gender, gameChannelId: channelIds.games,
        rulesChannelId: channelIds.rules, applicationChannelId: channelIds.application,
        reviewChannelId, maleRoleId: roleIds.male,
        femaleRoleId: roleIds.female, pendingRoleId: roleIds.pending,
        memberRoleId: roleIds.member, stageRoleIds
      });
      for (const stage of Object.keys(channelIds)) {
        const channel = await interaction.guild.channels.fetch(channelIds[stage]);
        await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {ViewChannel: false});
        const roleId = saved.stage_role_ids[stage];
        for (const stageRoleId of Object.values(saved.stage_role_ids)) {
          await channel.permissionOverwrites.edit(stageRoleId, {
            ViewChannel: stageRoleId === roleId,
            SendMessages: false
          });
        }
      }
      return SafeInteraction.safeReply(interaction, {content: '가입 단계 설정을 저장하고 활성화했습니다.'});
    }
    if (subcommand === '게임추가') {
      const roles = await this.onboardingRepository.addGameRole(interaction.guildId,
        interaction.options.getString('이름', true), interaction.options.getRole('역할', true).id);
      return SafeInteraction.safeReply(interaction, {content: `게임 역할을 저장했습니다. 현재 ${roles.length}개입니다.`});
    }
    const config = await this.onboardingRepository.getConfig(interaction.guildId);
    if (!config) throw new Error('먼저 /가입관리 설정을 실행해 주세요.');
    if (!config.game_roles?.length) throw new Error('먼저 게임 역할을 하나 이상 추가해 주세요.');
    const messages = this.onboardingService.buildMessages(config);
    const channelIds = {
      gender: config.welcome_channel_id,
      games: config.game_channel_id,
      rules: config.rules_channel_id,
      application: config.application_channel_id
    };
    for (const stage of Object.keys(messages)) {
      const channel = await interaction.guild.channels.fetch(channelIds[stage]);
      const message = messages[stage];
      await channel.send(message);
    }
    return SafeInteraction.safeReply(interaction, {content: '가입 안내 메시지를 각 단계 채널에 게시했습니다.'});
  }
}
