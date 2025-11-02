// src/managers/VoiceChannelNicknameManager.js - 음성 채널 닉네임 표시 관리자

import { ChannelType } from 'discord.js';

export class VoiceChannelNicknameManager {
  constructor(client, userNicknameService) {
    this.client = client;
    this.userNicknameService = userNicknameService;
    this.setupEventListeners();
  }

  /**
   * 이벤트 리스너 설정
   */
  setupEventListeners() {
    this.client.on('voiceStateUpdate', async (oldState, newState) => {
      await this.handleVoiceStateUpdate(oldState, newState);
    });
  }

  /**
   * 음성 채널 상태 변경 처리
   * @param {VoiceState} oldState - 이전 상태
   * @param {VoiceState} newState - 새 상태
   */
  async handleVoiceStateUpdate(oldState, newState) {
    try {
      // 음성 채널에 입장한 경우
      if (!oldState.channel && newState.channel) {
        await this.handleVoiceChannelJoin(newState);
      }
    } catch (error) {
      console.error('[VoiceChannelNicknameManager] 음성 채널 상태 변경 처리 오류:', error);
    }
  }

  /**
   * 음성 채널 입장 처리
   * @param {VoiceState} voiceState - 음성 상태
   */
  async handleVoiceChannelJoin(voiceState) {
    const { member, channel, guild } = voiceState;

    // 봇은 제외
    if (member.user.bot) {
      return;
    }

    // 음성 채널이 아니면 무시
    if (channel.type !== ChannelType.GuildVoice) {
      return;
    }

    // 사용자의 닉네임 가져오기
    const nicknames = await this.userNicknameService.getUserNicknames(guild.id, member.user.id);

    // 닉네임이 없으면 메시지 전송 안 함
    if (nicknames.length === 0) {
      return;
    }

    // 임베드 생성
    const embedData = this.userNicknameService.createVoiceChannelNicknameEmbed(member.user, nicknames);

    // 음성 채널의 채팅(스레드)에 메시지 전송
    await channel.send(embedData);
  }

}
