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

    // 이전에 해당 사용자의 닉네임 메시지가 있다면 삭제
    await this.deletePreviousNicknameMessage(channel, member.user.id);

    // 임베드 생성
    const embedData = this.userNicknameService.createVoiceChannelNicknameEmbed(member.user, member, nicknames);

    // 음성 채널에 직접 메시지 전송 (RecruitmentService와 동일 방식)
    try {
      await channel.send(embedData);
      console.log('[VoiceChannelNicknameManager] ✅ 메시지 전송 완료:', {
        voiceChannel: channel.name,
        user: member.user.username
      });
    } catch (error) {
      console.error('[VoiceChannelNicknameManager] ❌ 메시지 전송 실패:', error.message);
    }
  }

  /**
   * 이전에 보낸 사용자의 닉네임 메시지 삭제
   * @param {VoiceChannel} channel - 음성 채널
   * @param {string} userId - 사용자 ID
   */
  async deletePreviousNicknameMessage(channel, userId) {
    try {
      // 최근 100개 메시지 가져오기
      const messages = await channel.messages.fetch({ limit: 100 });

      console.log('[VoiceChannelNicknameManager] 이전 메시지 검색:', {
        channel: channel.name,
        userId: userId,
        totalMessages: messages.size
      });

      // 봇이 보낸 메시지 중 해당 사용자의 닉네임 정보를 담은 임베드 찾기
      const previousMessage = messages.find(msg => {
        // 봇이 보낸 메시지가 아니면 제외
        if (!msg.author.bot || msg.author.id !== this.client.user.id) {
          return false;
        }

        // 임베드가 없으면 제외
        if (!msg.embeds || msg.embeds.length === 0) {
          return false;
        }

        const embed = msg.embeds[0];

        // author.iconURL이 해당 사용자의 아바타 URL인지 확인
        if (embed.author && embed.author.iconURL) {
          // 사용자 ID가 URL에 포함되어 있는지 확인
          return embed.author.iconURL.includes(userId);
        }

        return false;
      });

      if (previousMessage) {
        await previousMessage.delete();
        console.log('[VoiceChannelNicknameManager] ✅ 이전 메시지 삭제 완료:', {
          messageId: previousMessage.id,
          userId: userId
        });
      } else {
        console.log('[VoiceChannelNicknameManager] 삭제할 이전 메시지 없음');
      }
    } catch (error) {
      // 메시지 삭제 실패는 치명적이지 않으므로 경고만 출력
      console.warn('[VoiceChannelNicknameManager] ⚠️ 이전 메시지 삭제 실패:', error.message);
    }
  }

}
