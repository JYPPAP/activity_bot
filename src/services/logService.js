// src/services/logService.js - 로깅 서비스
import { EmbedBuilder, ChannelType } from 'discord.js';
import { TIME, COLORS, MESSAGE_TYPES } from '../config/constants.js';
import { EmbedFactory } from '../utils/embedBuilder.js';

export class LogService {
  constructor(client, logChannelId) {
    this.client = client;
    this.logChannelId = logChannelId;
    this.logMessages = [];
    this.logTimeout = null;
  }

  /**
   * 음성 채널 활동을 로그에 기록합니다.
   * @param {string} message - 로그 메시지
   * @param {Array<string>} membersInChannel - 채널에 있는 멤버 목록
   * @param {string} eventType - 이벤트 타입 (선택적)
   */
  logActivity(message, membersInChannel = [], eventType = '') {
    // 채널 생성 메시지일 경우 멤버 목록을 표시하지 않음
    if (message.includes(MESSAGE_TYPES.CHANNEL_CREATE)) {
      membersInChannel = [];
    }

    this.logMessages.push({
      message,
      members: membersInChannel,
      eventType
    });

    // 이전 타임아웃 취소
    if (this.logTimeout) {
      clearTimeout(this.logTimeout);
    }

    // 새 타임아웃 설정 - 5분(300,000ms) 후 로그 전송
    this.logTimeout = setTimeout(async () => {
      await this.sendLogMessages();
    }, TIME.LOG_DELAY);
  }

  /**
   * 누적된 로그 메시지를 로그 채널로 전송합니다.
   */
  async sendLogMessages() {
    const logChannel = this.client.channels.cache.get(this.logChannelId);
    if (!logChannel) return;

    for (const log of this.logMessages) {
      const embed = EmbedFactory.createLogEmbed(log.message, log.members);
      await logChannel.send({ embeds: [embed] });
    }

    this.logMessages = []; // 로그 초기화
  }

  /**
   * 채널에 있는 멤버 목록을 가져옵니다.
   * @param {VoiceChannel} channel - 음성 채널 객체
   * @returns {Array<string>} - 멤버 표시 이름 배열
   */
  async getVoiceChannelMembers(channel) {
    if (!channel) return [];
    
    try {
      const freshChannel = await channel.guild.channels.fetch(channel.id);
      return freshChannel.members.map(member => member.displayName);
    } catch (error) {
      console.error('채널 멤버 정보 가져오기 오류:', error);
      return [];
    }
  }

  /**
   * 채널 업데이트 이벤트 핸들러
   * @param {Channel} oldChannel - 이전 채널 상태
   * @param {Channel} newChannel - 새 채널 상태
   */
  async handleChannelUpdate(oldChannel, newChannel) {
    if (newChannel.type === ChannelType.GuildVoice) {
      if (oldChannel.name !== newChannel.name) {
        const membersInChannel = await this.getVoiceChannelMembers(newChannel);
        this.logActivity(
          `${MESSAGE_TYPES.CHANNEL_RENAME}: \`${oldChannel.name}\` → \`${newChannel.name}\``, 
          membersInChannel
        );
      }
    }
  }

  /**
   * 채널 생성 이벤트 핸들러
   * @param {Channel} channel - 생성된 채널
   */
  async handleChannelCreate(channel) {
    if (channel.type === ChannelType.GuildVoice) {
      this.logActivity(`${MESSAGE_TYPES.CHANNEL_CREATE}: ${channel.name}`, []);
    }
  }
}