import {MessageFlags, PermissionsBitField} from 'discord.js';
import {SafeInteraction} from '../utils/SafeInteraction.js';

export class OnboardingManagementCommand {
  constructor(onboardingRepository, onboardingService) {
    this.onboardingRepository = onboardingRepository;
    this.onboardingService = onboardingService;
  }

  async execute(interaction) {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      await SafeInteraction.safeReply(interaction, {content: '서버 관리자만 사용할 수 있습니다.', flags: MessageFlags.Ephemeral});
      return;
    }
    const subcommand = interaction.options.getSubcommand();
    await SafeInteraction.safeDeferReply(interaction, {ephemeral: true});
    if (subcommand === '설정') {
      const value = name => interaction.options.get(name, true).value;
      const saved = await this.onboardingRepository.saveConfig(interaction.guildId, {
        welcomeChannelId: value('환영채널'), gameChannelId: value('게임채널'),
        rulesChannelId: value('규칙채널'), applicationChannelId: value('신청채널'),
        reviewChannelId: value('심사채널'), maleRoleId: value('남성역할'),
        femaleRoleId: value('여성역할'), pendingRoleId: value('대기역할'),
        memberRoleId: value('정회원역할'), stageRoleIds: {
          gender: value('성별단계역할'), games: value('게임단계역할'),
          rules: value('규칙단계역할'), application: value('신청단계역할')
        }
      });
      const channelRoles = [
        [saved.welcome_channel_id, saved.stage_role_ids.gender],
        [saved.game_channel_id, saved.stage_role_ids.games],
        [saved.rules_channel_id, saved.stage_role_ids.rules],
        [saved.application_channel_id, saved.stage_role_ids.application]
      ];
      for (const [channelId, roleId] of channelRoles) {
        const channel = await interaction.guild.channels.fetch(channelId);
        await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {ViewChannel: false});
        await channel.permissionOverwrites.edit(roleId, {ViewChannel: true, SendMessages: false});
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
    for (const [channelId, message] of [[config.welcome_channel_id, messages.gender],
      [config.game_channel_id, messages.games], [config.rules_channel_id, messages.rules],
      [config.application_channel_id, messages.application]]) {
      const channel = await interaction.guild.channels.fetch(channelId);
      await channel.send(message);
    }
    return SafeInteraction.safeReply(interaction, {content: '가입 안내 메시지를 네 단계 채널에 게시했습니다.'});
  }
}
