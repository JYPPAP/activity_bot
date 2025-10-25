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

    // 음성 채널의 텍스트 채널 찾기
    const textChannel = await this.findLinkedTextChannel(channel);
    if (!textChannel) {
      return;
    }

    // 사용자의 닉네임 가져오기
    const nicknames = await this.userNicknameService.getUserNicknames(guild.id, member.user.id);

    // 닉네임이 없으면 메시지 전송 안 함
    if (nicknames.length === 0) {
      return;
    }

    // 임베드 생성 및 전송
    const embedData = this.userNicknameService.createVoiceChannelNicknameEmbed(member.user, nicknames);

    await textChannel.send(embedData);
  }

  /**
   * 음성 채널과 연결된 텍스트 채널 찾기
   * @param {VoiceChannel} voiceChannel - 음성 채널
   * @returns {Promise<TextChannel|null>} - 연결된 텍스트 채널
   */
  async findLinkedTextChannel(voiceChannel) {
    try {
      // 1. 같은 이름의 텍스트 채널 찾기
      const sameNameChannel = voiceChannel.guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildText &&
          channel.name === voiceChannel.name
      );

      if (sameNameChannel) {
        return sameNameChannel;
      }

      // 2. 같은 카테고리 내의 첫 번째 텍스트 채널 찾기
      if (voiceChannel.parent) {
        const categoryChannel = voiceChannel.guild.channels.cache.find(
          (channel) =>
            channel.type === ChannelType.GuildText &&
            channel.parentId === voiceChannel.parentId
        );

        if (categoryChannel) {
          return categoryChannel;
        }
      }

      // 3. 기본 텍스트 채널 사용 (일반, general 등)
      const defaultChannel = voiceChannel.guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildText &&
          (channel.name === '일반' || channel.name === 'general' || channel.name === '채팅')
      );

      return defaultChannel || null;
    } catch (error) {
      console.error('[VoiceChannelNicknameManager] 텍스트 채널 찾기 오류:', error);
      return null;
    }
  }

  /**
   * 특정 채널에서 닉네임 표시 활성화
   * @param {string} guildId - 길드 ID
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {string} textChannelId - 텍스트 채널 ID
   */
  async enableNicknameDisplay(guildId, voiceChannelId, textChannelId) {
    // TODO: 데이터베이스에 채널 매핑 저장
    // 현재는 자동으로 같은 이름의 텍스트 채널을 찾음
    console.log(`[VoiceChannelNicknameManager] 닉네임 표시 활성화: ${voiceChannelId} -> ${textChannelId}`);
  }

  /**
   * 특정 채널에서 닉네임 표시 비활성화
   * @param {string} guildId - 길드 ID
   * @param {string} voiceChannelId - 음성 채널 ID
   */
  async disableNicknameDisplay(guildId, voiceChannelId) {
    // TODO: 데이터베이스에서 채널 매핑 제거
    console.log(`[VoiceChannelNicknameManager] 닉네임 표시 비활성화: ${voiceChannelId}`);
  }
}
