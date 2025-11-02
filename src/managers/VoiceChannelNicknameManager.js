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
    console.log('[VoiceChannelNicknameManager] 초기화 완료 - voiceStateUpdate 이벤트 리스너 등록');
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
      // 1. 음성 채널 입장 (null → 채널)
      if (!oldState.channel && newState.channel) {
        console.log('[VoiceChannelNicknameManager] 음성 채널 입장 감지');
        await this.handleVoiceChannelJoin(newState);
      }
      // 2. 음성 채널 이동 (채널 → 다른 채널)
      // "방-생성하기" → 새 음성채널 케이스 포함
      else if (oldState.channel && newState.channel && oldState.channelId !== newState.channelId) {
        console.log('[VoiceChannelNicknameManager] 음성 채널 이동 감지:', {
          from: oldState.channel.name,
          to: newState.channel.name
        });
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

    console.log('[VoiceChannelNicknameManager] 음성 채널 입장 처리:', {
      user: member.user.username,
      userId: member.user.id,
      channel: channel.name,
      channelId: channel.id,
      channelType: channel.type
    });

    // 봇은 제외
    if (member.user.bot) {
      console.log('[VoiceChannelNicknameManager] 봇 사용자 감지, 건너뜀');
      return;
    }

    // 음성 채널이 아니면 무시
    if (channel.type !== ChannelType.GuildVoice) {
      console.log('[VoiceChannelNicknameManager] 음성 채널이 아님, 건너뜀:', channel.type);
      return;
    }

    // "방-생성하기" 채널은 제외 (경유 채널이므로 메시지 보내지 않음)
    if (channel.name.includes('방-생성하기')) {
      console.log('[VoiceChannelNicknameManager] 방-생성하기 채널 감지, 건너뜀');
      return;
    }

    // 사용자의 닉네임 가져오기
    const nicknames = await this.userNicknameService.getUserNicknames(guild.id, member.user.id);
    console.log('[VoiceChannelNicknameManager] 닉네임 조회 결과:', nicknames.length, '개');

    // 닉네임이 없으면 메시지 전송 안 함
    if (nicknames.length === 0) {
      console.log('[VoiceChannelNicknameManager] 등록된 닉네임 없음, 메시지 전송 안 함');
      return;
    }

    // 연결된 텍스트 채널 찾기
    const textChannel = await this.findLinkedTextChannel(channel);
    if (!textChannel) {
      console.log('[VoiceChannelNicknameManager] ❌ 텍스트 채널을 찾을 수 없음');
      return;
    }

    // 임베드 생성
    const embedData = this.userNicknameService.createVoiceChannelNicknameEmbed(member.user, nicknames);

    // 텍스트 채널에 메시지 전송
    try {
      await textChannel.send(embedData);
      console.log('[VoiceChannelNicknameManager] ✅ 메시지 전송 완료:', {
        textChannel: textChannel.name,
        user: member.user.username
      });
    } catch (error) {
      console.error('[VoiceChannelNicknameManager] ❌ 메시지 전송 실패:', error.message);
    }
  }

  /**
   * 음성 채널과 연결된 텍스트 채널 찾기
   * @param {VoiceChannel} voiceChannel - 음성 채널
   * @returns {Promise<TextChannel|null>} - 연결된 텍스트 채널
   */
  async findLinkedTextChannel(voiceChannel) {
    try {
      console.log('[VoiceChannelNicknameManager] 텍스트 채널 검색 시작:', voiceChannel.name);

      // 1. 같은 이름의 텍스트 채널 찾기
      const sameNameChannel = voiceChannel.guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildText &&
          channel.name === voiceChannel.name
      );

      if (sameNameChannel) {
        console.log('[VoiceChannelNicknameManager] 같은 이름 텍스트 채널 발견:', sameNameChannel.name);
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
          console.log('[VoiceChannelNicknameManager] 같은 카테고리 텍스트 채널 발견:', categoryChannel.name);
          return categoryChannel;
        }
      }

      // 3. 기본 텍스트 채널 사용 (일반, general 등)
      const defaultChannel = voiceChannel.guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildText &&
          (channel.name === '일반' || channel.name === 'general' || channel.name === '채팅')
      );

      if (defaultChannel) {
        console.log('[VoiceChannelNicknameManager] 기본 텍스트 채널 사용:', defaultChannel.name);
        return defaultChannel;
      }

      return null;
    } catch (error) {
      console.error('[VoiceChannelNicknameManager] 텍스트 채널 찾기 오류:', error);
      return null;
    }
  }

}
