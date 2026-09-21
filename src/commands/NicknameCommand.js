import { SafeInteraction } from '../utils/SafeInteraction.js';
import { logger } from '../config/logger-termux.js';
// src/commands/NicknameCommand.js - 닉네임 변경 명령어
import { MessageFlags, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { CommandBase } from './CommandBase.js';
import { DiscordConstants } from '../config/DiscordConstants.js';

export class NicknameCommand extends CommandBase {
  constructor(services) {
    super(services);
    this.voiceChannelManager = services.voiceChannelManager;
  }

  /**
   * 명령어 실행 (CommandBase의 execute를 오버라이드)
   * @param interaction - 상호작용 객체
   */
  async execute(interaction) {
    try {
      // 즉시 defer하여 3초 제한 해결
      const deferResult = await SafeInteraction.safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
      // null 실패도 기존 catch 경로로 전달하여 후속 작업을 중단한다.
      if (deferResult === null) {
        throw new Error('인터랙션 지연 응답에 실패했습니다.');
      }

      // 채널 ID 파라미터 가져오기
      const channelId = interaction.options.getString('channel');
      
      // 채널 유효성 검사
      let channel = null;
      let channelName = '지정된 채널';
      
      try {
        channel = await interaction.client.channels.fetch(channelId);
        if (!channel) {
          await interaction.editReply({
            content: '❌ **유효하지 않은 채널 ID입니다.**\n올바른 채널 ID를 입력해주세요.'
          });
          return;
        }
        channelName = channel.name;
      } catch (error) {
        await interaction.editReply({
          content: '❌ **유효하지 않은 채널 ID입니다.**\n올바른 채널 ID를 입력해주세요.'
        });
        return;
      }

      // 채널에 메시지 전송 권한 확인
      const botMember = await interaction.guild.members.fetch(interaction.client.user.id);
      const permissions = channel.permissionsFor(botMember);
      
      if (!permissions.has('SendMessages')) {
        await interaction.editReply({
          content: `❌ **채널 권한 부족**\n**${channelName}** 채널에 메시지를 보낼 권한이 없습니다.`
        });
        return;
      }

      // UI 생성
      const embed = this.createNicknameEmbed(channelName);
      const buttons = this.createNicknameButtons(channelId);

      // 지정한 채널에 메시지 전송
      await channel.send({
        embeds: [embed],
        components: [buttons]
      });

      // 명령어 실행자에게 성공 메시지 응답
      await interaction.editReply({
        content: `✅ **닉네임 변경 버튼 설정 완료**\n**${channelName}** 채널에 닉네임 변경 버튼을 설정했습니다.`
      });

    } catch (error) {
      logger.error(`${this.constructor.name} 명령어 실행 오류`, { error: error.message, stack: error.stack });

      // 에러 응답
      await interaction.editReply({
        content: '명령어 실행 중 오류가 발생했습니다.',
      });
    }
  }

  /**
   * 닉네임 변경 안내 임베드 생성
   * @param {string} channelName - 채널 이름
   * @returns {EmbedBuilder} - 생성된 임베드
   */
  createNicknameEmbed(channelName) {
    return new EmbedBuilder()
      .setTitle('🏷️ 관전, 대기 달기')
      .setDescription(
        '아래 버튼을 클릭하여 닉네임 접두사를 변경할 수 있습니다.\n\n' +
        '📋 **사용 가능한 접두사**\n' +
        '• **관전** - [관전] [닉네임] 형태로 변경\n' +
        '• **대기** - [대기] [닉네임] 형태로 변경\n' +
        '• **초기화** - 원래 닉네임으로 복원'
      )
      .setColor(0x5865F2);
  }

  /**
   * 닉네임 변경 버튼 생성
   * @param {string} channelId - 채널 ID
   * @returns {ActionRowBuilder} - 버튼 액션 로우
   */
  createNicknameButtons(channelId) {
    const spectateButton = new ButtonBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_SPECTATE}${channelId}`)
      .setLabel(`${DiscordConstants.EMOJIS.SPECTATOR} 관전`)
      .setStyle(ButtonStyle.Secondary);

    const waitButton = new ButtonBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_WAIT}${channelId}`)
      .setLabel('⏳ 대기')
      .setStyle(ButtonStyle.Success);

    const resetButton = new ButtonBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_RESET}${channelId}`)
      .setLabel(`${DiscordConstants.EMOJIS.RESET} 초기화`)
      .setStyle(ButtonStyle.Primary);

    return new ActionRowBuilder().addComponents(spectateButton, waitButton, resetButton);
  }
}