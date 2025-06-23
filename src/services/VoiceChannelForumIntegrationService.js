// src/services/VoiceChannelForumIntegrationService.js - 음성채널-포럼 통합 서비스
import { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle,
  StringSelectMenuBuilder,
  ChannelType,
  MessageFlags
} from 'discord.js';

export class VoiceChannelForumIntegrationService {
  constructor(client, forumChannelId, voiceCategoryId) {
    this.client = client;
    this.forumChannelId = forumChannelId; // 1385861379377987655
    this.voiceCategoryId = voiceCategoryId; // 1243578210684243970
    this.channelPostMap = new Map(); // 음성채널 ID -> 포럼 포스트 ID 매핑
    this.updateQueue = new Map(); // 업데이트 큐 (중복 방지)
    
    // ========== 구인구직 기능 권한 설정 ==========
    // 구인구직 기능 활성화 여부 (true: 활성화, false: 비활성화)
    this.RECRUITMENT_ENABLED = true;
    
    // 구인구직 기능 접근 허용 사용자 ID 목록
    this.ALLOWED_USER_IDS = [
      '592666673627004939' // 특정 사용자 ID
    ];
    // ==========================================
    
    // 디버깅용: 주기적으로 매핑 상태 출력 및 삭제된 채널 정리
    setInterval(async () => {
      if (this.channelPostMap.size > 0) {
        console.log(`[VoiceForumService] ⏰ 정기 체크 - 현재 채널-포스트 매핑 (${this.channelPostMap.size}개):`, Array.from(this.channelPostMap.entries()));
        
        // 삭제된 채널 정리
        await this.cleanupDeletedChannels();
      } else {
        console.log(`[VoiceForumService] ⏰ 정기 체크 - 현재 매핑된 채널 없음`);
      }
    }, 30000); // 30초마다
  }

  /**
   * ========== 권한 체크 메서드 ==========
   * 사용자가 구인구직 기능에 접근할 수 있는지 확인
   * @param {User} user - 확인할 사용자
   * @param {GuildMember} member - 길드 멤버 객체 (관리자 권한 확인용)
   * @returns {boolean} - 접근 가능 여부
   */
  hasRecruitmentPermission(user, member = null) {
    // 구인구직 기능이 비활성화된 경우
    if (!this.RECRUITMENT_ENABLED) {
      console.log(`[VoiceForumService] ❌ 구인구직 기능이 비활성화됨`);
      return false;
    }

    // 허용된 사용자 ID 목록에 있는 경우
    if (this.ALLOWED_USER_IDS.includes(user.id)) {
      console.log(`[VoiceForumService] ✅ 허용된 사용자: ${user.displayName} (${user.id})`);
      return true;
    }

    // 관리자 권한이 있는 경우
    if (member && member.permissions.has('Administrator')) {
      console.log(`[VoiceForumService] ✅ 관리자 권한: ${user.displayName} (${user.id})`);
      return true;
    }

    console.log(`[VoiceForumService] ❌ 권한 없음: ${user.displayName} (${user.id})`);
    return false;
  }
  // ====================================

  /**
   * 음성 채널 생성 이벤트 핸들러
   * @param {Channel} channel - 생성된 채널
   */
  async handleChannelCreate(channel) {
    try {
      // 음성 채널이고 지정된 카테고리에 생성된 경우만 처리
      if (channel.type === ChannelType.GuildVoice && 
          channel.parentId === this.voiceCategoryId) {
        
        console.log(`[VoiceForumService] 음성 채널 생성 감지: ${channel.name} (ID: ${channel.id})`);
        
        // ========== 권한 체크 ==========
        // 구인구직 기능이 비활성화된 경우 임베드 전송 안함
        if (!this.RECRUITMENT_ENABLED) {
          console.log(`[VoiceForumService] 구인구직 기능 비활성화로 임베드 전송 안함: ${channel.name}`);
          return;
        }
        
        // 권한이 있는 사용자가 채널에 있는지 확인하고 임베드 전송
        setTimeout(async () => {
          await this.checkAndSendRecruitmentEmbed(channel);
        }, 5000);
        // =============================
      }
    } catch (error) {
      console.error('음성 채널 생성 처리 오류:', error);
    }
  }

  /**
   * 권한이 있는 사용자가 있을 때만 구인구직 임베드 전송
   * @param {VoiceChannel} voiceChannel - 음성 채널
   */
  async checkAndSendRecruitmentEmbed(voiceChannel) {
    try {
      // 채널에 있는 멤버들 중 권한이 있는 사용자가 있는지 확인
      const members = voiceChannel.members;
      let hasAuthorizedUser = false;

      for (const [memberId, member] of members) {
        if (this.hasRecruitmentPermission(member.user, member)) {
          hasAuthorizedUser = true;
          console.log(`[VoiceForumService] 권한 있는 사용자 발견: ${member.displayName} (${member.id})`);
          break;
        }
      }

      if (hasAuthorizedUser) {
        console.log(`[VoiceForumService] 권한 있는 사용자가 있어 임베드 전송: ${voiceChannel.name}`);
        await this.sendRecruitmentEmbed(voiceChannel);
      } else {
        console.log(`[VoiceForumService] 권한 있는 사용자가 없어 임베드 전송 안함: ${voiceChannel.name}`);
      }
    } catch (error) {
      console.error(`[VoiceForumService] 권한 확인 및 임베드 전송 오류:`, error);
    }
  }

  /**
   * 음성 채널 삭제 이벤트 핸들러
   * @param {Channel} channel - 삭제된 채널
   */
  async handleChannelDelete(channel) {
    try {
      console.log(`[VoiceForumService] ═══ 채널 삭제 이벤트 시작 ═══`);
      console.log(`[VoiceForumService] 채널명: ${channel.name}`);
      console.log(`[VoiceForumService] 채널ID: ${channel.id}`);
      console.log(`[VoiceForumService] 채널타입: ${channel.type} (음성채널: ${ChannelType.GuildVoice})`);
      console.log(`[VoiceForumService] 카테고리ID: ${channel.parentId} (대상카테고리: ${this.voiceCategoryId})`);
      console.log(`[VoiceForumService] 현재 전체 매핑:`, this.channelPostMap);
      console.log(`[VoiceForumService] 매핑된 채널 수: ${this.channelPostMap.size}`);
      console.log(`[VoiceForumService] 삭제된 채널이 매핑에 있는가? ${this.channelPostMap.has(channel.id)}`);
      
      // 조건 체크
      const isVoiceChannel = channel.type === ChannelType.GuildVoice;
      const isInTargetCategory = channel.parentId === this.voiceCategoryId;
      const hasMappedPost = this.channelPostMap.has(channel.id);
      
      console.log(`[VoiceForumService] 조건 체크:`);
      console.log(`[VoiceForumService] - 음성 채널인가? ${isVoiceChannel}`);
      console.log(`[VoiceForumService] - 대상 카테고리인가? ${isInTargetCategory}`);
      console.log(`[VoiceForumService] - 매핑된 포스트가 있는가? ${hasMappedPost}`);
      
      // 음성 채널이고 매핑된 포럼 포스트가 있는 경우
      if (isVoiceChannel && hasMappedPost) {
        console.log(`[VoiceForumService] ✅ 아카이브 조건 충족 - 처리 시작`);
        
        const postId = this.channelPostMap.get(channel.id);
        console.log(`[VoiceForumService] 연결된 포럼 포스트 ID: ${postId}`);
        
        await this.archiveForumPost(postId);
        
        // 매핑 제거
        this.channelPostMap.delete(channel.id);
        console.log(`[VoiceForumService] 채널-포스트 매핑 제거 완료`);
        console.log(`[VoiceForumService] ✅ 아카이브 처리 완료`);
      } else {
        console.log(`[VoiceForumService] ❌ 아카이브 조건 불충족:`);
        console.log(`[VoiceForumService] - 음성채널: ${isVoiceChannel}`);
        console.log(`[VoiceForumService] - 대상카테고리: ${isInTargetCategory}`);
        console.log(`[VoiceForumService] - 매핑존재: ${hasMappedPost}`);
        
        if (!hasMappedPost) {
          console.log(`[VoiceForumService] 💡 매핑이 없는 이유 확인:`);
          console.log(`[VoiceForumService] - 포럼 생성 시 매핑이 저장되었는가?`);
          console.log(`[VoiceForumService] - 이전에 매핑이 삭제되었는가?`);
        }
      }
      
      console.log(`[VoiceForumService] ═══ 채널 삭제 이벤트 종료 ═══`);
    } catch (error) {
      console.error('[VoiceForumService] 음성 채널 삭제 처리 오류:', error);
    }
  }

  /**
   * 음성 채널 업데이트 이벤트 핸들러
   * @param {Channel} oldChannel - 업데이트 전 채널
   * @param {Channel} newChannel - 업데이트 후 채널
   */
  async handleChannelUpdate(oldChannel, newChannel) {
    try {
      // 음성 채널이고 이름이 변경되었으며 매핑된 포럼이 있는 경우
      if (newChannel.type === ChannelType.GuildVoice && 
          oldChannel.name !== newChannel.name &&
          this.channelPostMap.has(newChannel.id)) {
        
        console.log(`음성 채널 이름 변경 감지: ${oldChannel.name} -> ${newChannel.name} (ID: ${newChannel.id})`);
        
        const postId = this.channelPostMap.get(newChannel.id);
        await this.updateVoiceChannelLink(postId, newChannel.name, newChannel.id, newChannel.guild.id);
      }
    } catch (error) {
      console.error('음성 채널 업데이트 처리 오류:', error);
    }
  }

  /**
   * 음성 채널 상태 변경 이벤트 핸들러 (사용자 입장/퇴장)
   * @param {VoiceState} oldState - 이전 음성 상태
   * @param {VoiceState} newState - 새로운 음성 상태
   */
  async handleVoiceStateUpdate(oldState, newState) {
    try {
      // 음성 채널에 사용자가 입장하거나 퇴장한 경우
      const channelChanged = oldState.channelId !== newState.channelId;
      
      console.log(`[VoiceForumService] 음성 상태 변경 감지: ${oldState.channelId} -> ${newState.channelId}, 사용자: ${newState.member?.displayName || 'Unknown'}`);
      
      if (channelChanged) {
        // 이전 채널에서 퇴장한 경우
        if (oldState.channelId && this.channelPostMap.has(oldState.channelId)) {
          console.log(`[VoiceForumService] 이전 채널에서 퇴장 처리: ${oldState.channelId}`);
          // 중복 업데이트 방지를 위한 큐 기반 업데이트
          this.queueTitleUpdate(oldState.channelId, true);
        }
        
        // 새 채널에 입장한 경우
        if (newState.channelId && this.channelPostMap.has(newState.channelId)) {
          console.log(`[VoiceForumService] 새 채널에 입장 처리: ${newState.channelId}`);
          // 중복 업데이트 방지를 위한 큐 기반 업데이트
          this.queueTitleUpdate(newState.channelId, false);
        }
        
        // ========== 구인구직 임베드 확인 ==========
        // 권한이 있는 사용자가 새 채널에 입장한 경우, 해당 채널에 임베드가 없으면 전송
        if (newState.channelId && 
            newState.member && 
            this.hasRecruitmentPermission(newState.member.user, newState.member)) {
          
          const voiceChannel = newState.channel;
          if (voiceChannel && 
              voiceChannel.parentId === this.voiceCategoryId && 
              !this.channelPostMap.has(newState.channelId)) {
            
            console.log(`[VoiceForumService] 권한 있는 사용자 입장, 임베드 확인: ${voiceChannel.name}`);
            
            // 채널에 구인구직 임베드가 없는지 확인하고 전송
            setTimeout(async () => {
              await this.checkAndSendRecruitmentEmbedIfNeeded(voiceChannel);
            }, 2000);
          }
        }
        // =======================================
      }
    } catch (error) {
      console.error('음성 상태 업데이트 처리 오류:', error);
    }
  }

  /**
   * 채널에 구인구직 임베드가 없으면 전송
   * @param {VoiceChannel} voiceChannel - 음성 채널
   */
  async checkAndSendRecruitmentEmbedIfNeeded(voiceChannel) {
    try {
      // 최근 메시지들을 확인해서 구인구직 임베드가 이미 있는지 확인
      const recentMessages = await voiceChannel.messages.fetch({ limit: 10 });
      
      let hasRecruitmentEmbed = false;
      for (const [messageId, message] of recentMessages) {
        if (message.author.bot && 
            message.embeds.length > 0 && 
            message.embeds[0].title === '🎯 구인구직 연동') {
          hasRecruitmentEmbed = true;
          console.log(`[VoiceForumService] 구인구직 임베드가 이미 존재함: ${voiceChannel.name}`);
          break;
        }
      }

      if (!hasRecruitmentEmbed) {
        console.log(`[VoiceForumService] 구인구직 임베드가 없어 새로 전송: ${voiceChannel.name}`);
        await this.sendRecruitmentEmbed(voiceChannel);
      }
    } catch (error) {
      console.error(`[VoiceForumService] 임베드 확인 및 전송 오류:`, error);
    }
  }

  /**
   * 제목 업데이트를 큐에 추가 (중복 방지)
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {boolean} checkEmpty - 빈 채널 확인 여부
   */
  queueTitleUpdate(voiceChannelId, checkEmpty = false) {
    // 이미 큐에 있는 업데이트 취소
    if (this.updateQueue.has(voiceChannelId)) {
      clearTimeout(this.updateQueue.get(voiceChannelId));
    }

    // 새로운 업데이트 예약
    const timeoutId = setTimeout(async () => {
      try {
        console.log(`[VoiceForumService] 큐에서 제목 업데이트 실행: ${voiceChannelId}`);
        await this.updateForumPostTitle(voiceChannelId);
        
        if (checkEmpty) {
          await this.checkAndArchiveIfEmpty(voiceChannelId);
        }
        
        // 큐에서 제거
        this.updateQueue.delete(voiceChannelId);
      } catch (error) {
        console.error(`[VoiceForumService] 큐 업데이트 오류:`, error);
        this.updateQueue.delete(voiceChannelId);
      }
    }, 5000); // 5초 지연

    this.updateQueue.set(voiceChannelId, timeoutId);
    console.log(`[VoiceForumService] 제목 업데이트 큐에 추가: ${voiceChannelId}`);
  }

  /**
   * 음성 채널이 비었는지 확인하고 포럼 포스트 아카이브
   * @param {string} voiceChannelId - 음성 채널 ID
   */
  async checkAndArchiveIfEmpty(voiceChannelId) {
    try {
      const voiceChannel = await this.client.channels.fetch(voiceChannelId);
      if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
        console.log(`[VoiceForumService] 음성 채널을 찾을 수 없음 또는 삭제됨: ${voiceChannelId}`);
        // 채널이 삭제된 경우 포럼 포스트 아카이브
        await this.handleDeletedChannelCleanup(voiceChannelId);
        return;
      }

      // 음성 채널이 완전히 비었는지 확인
      const memberCount = voiceChannel.members.size;
      console.log(`[VoiceForumService] 음성 채널 ${voiceChannel.name} 멤버 수: ${memberCount}`);
      
      if (memberCount === 0) {
        console.log(`[VoiceForumService] 음성 채널이 비어있음. 포럼 포스트 아카이브: ${voiceChannelId}`);
        const postId = this.channelPostMap.get(voiceChannelId);
        if (postId) {
          await this.archiveForumPost(postId);
          this.channelPostMap.delete(voiceChannelId);
        }
      }
    } catch (error) {
      // 채널이 삭제된 경우 (Unknown Channel 오류)
      if (error.code === 10003) {
        console.log(`[VoiceForumService] 🗑️ 빈 채널 체크 중 삭제된 채널 감지: ${voiceChannelId}`);
        await this.handleDeletedChannelCleanup(voiceChannelId);
        return;
      }
      
      console.error(`[VoiceForumService] 빈 채널 확인 및 아카이브 오류:`, error);
    }
  }

  /**
   * 음성 채널의 참여자 수를 카운트 (관전자 제외)
   * @param {string} voiceChannelId - 음성 채널 ID
   * @returns {number} - 관전자를 제외한 참여자 수
   */
  async countActiveParticipants(voiceChannelId) {
    try {
      const voiceChannel = await this.client.channels.fetch(voiceChannelId);
      if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
        console.log(`[VoiceForumService] 음성 채널을 찾을 수 없음: ${voiceChannelId}`);
        return 0;
      }

      // 음성 채널의 모든 멤버를 가져와서 관전자가 아닌 사용자 수를 카운트
      const members = voiceChannel.members;
      let activeCount = 0;
      let spectatorCount = 0;

      console.log(`[VoiceForumService] 음성 채널 ${voiceChannel.name}의 전체 멤버 수: ${members.size}`);

      for (const [memberId, member] of members) {
        const nickname = member.nickname || member.user.displayName;
        console.log(`[VoiceForumService] 멤버 확인: ${nickname} (ID: ${memberId})`);
        
        // [관전]으로 시작하지 않는 사용자만 카운트
        if (!nickname.startsWith('[관전]')) {
          activeCount++;
          console.log(`[VoiceForumService] 활성 참여자로 카운트: ${nickname}`);
        } else {
          spectatorCount++;
          console.log(`[VoiceForumService] 관전자로 제외: ${nickname}`);
        }
      }

      console.log(`[VoiceForumService] 최종 카운트 - 활성: ${activeCount}, 관전: ${spectatorCount}, 총: ${members.size}`);
      return activeCount;
    } catch (error) {
      // 채널이 삭제된 경우 (Unknown Channel 오류)
      if (error.code === 10003) {
        console.log(`[VoiceForumService] 🗑️ 채널이 삭제됨 감지: ${voiceChannelId}`);
        // 삭제된 채널의 포럼 포스트 아카이브 처리
        await this.handleDeletedChannelCleanup(voiceChannelId);
        return 0;
      }
      
      console.error('참여자 수 카운트 오류:', error);
      return 0;
    }
  }

  /**
   * 삭제된 채널의 정리 작업
   * @param {string} voiceChannelId - 삭제된 음성 채널 ID
   */
  async handleDeletedChannelCleanup(voiceChannelId) {
    try {
      const postId = this.channelPostMap.get(voiceChannelId);
      if (postId) {
        console.log(`[VoiceForumService] 🗑️ 삭제된 채널의 포럼 포스트 아카이브 시작: ${voiceChannelId} -> ${postId}`);
        await this.archiveForumPost(postId);
        this.channelPostMap.delete(voiceChannelId);
        console.log(`[VoiceForumService] ✅ 삭제된 채널 정리 완료: ${voiceChannelId}`);
      }
    } catch (error) {
      console.error(`[VoiceForumService] 삭제된 채널 정리 오류:`, error);
    }
  }

  /**
   * 모든 매핑된 채널 중 삭제된 채널들을 정리
   */
  async cleanupDeletedChannels() {
    console.log(`[VoiceForumService] 🧹 삭제된 채널 일괄 정리 시작 (매핑 수: ${this.channelPostMap.size})`);
    
    const deletedChannels = [];
    
    for (const [channelId, postId] of this.channelPostMap.entries()) {
      try {
        await this.client.channels.fetch(channelId);
        // 채널이 존재하면 계속
      } catch (error) {
        if (error.code === 10003) {
          // Unknown Channel 오류 - 채널이 삭제됨
          console.log(`[VoiceForumService] 🗑️ 정리 대상 발견: ${channelId} -> ${postId}`);
          deletedChannels.push(channelId);
        }
      }
    }
    
    // 삭제된 채널들 정리
    for (const channelId of deletedChannels) {
      await this.handleDeletedChannelCleanup(channelId);
    }
    
    if (deletedChannels.length > 0) {
      console.log(`[VoiceForumService] ✅ 삭제된 채널 일괄 정리 완료: ${deletedChannels.length}개 채널 정리됨`);
    } else {
      console.log(`[VoiceForumService] ✅ 삭제된 채널 없음 - 정리 불필요`);
    }
  }

  /**
   * 포럼 포스트 제목 및 내용에서 현재 참여자 수 업데이트
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {number} retryCount - 재시도 횟수
   */
  async updateForumPostTitle(voiceChannelId, retryCount = 0) {
    try {
      const postId = this.channelPostMap.get(voiceChannelId);
      if (!postId) {
        console.log(`[VoiceForumService] 포스트 ID를 찾을 수 없음: ${voiceChannelId}`);
        return;
      }

      const thread = await this.client.channels.fetch(postId);
      if (!thread || !thread.isThread() || thread.archived) {
        console.log(`[VoiceForumService] 스레드를 찾을 수 없거나 아카이브됨: ${postId}`);
        return;
      }

      // 현재 참여자 수 카운트
      const currentCount = await this.countActiveParticipants(voiceChannelId);
      console.log(`[VoiceForumService] 현재 참여자 수: ${currentCount}`);
      
      // 현재 제목에서 패턴 찾기 (예: 1/5, 2/5 등)
      const currentTitle = thread.name;
      const participantPattern = /\d+\/\d+/;
      const match = currentTitle.match(participantPattern);
      
      console.log(`[VoiceForumService] 현재 제목: ${currentTitle}, 패턴 매치: ${match ? match[0] : 'none'}`);
      
      if (match) {
        // 기존 패턴이 있는 경우 현재 참여자 수만 업데이트
        const [currentPattern] = match;
        const maxCount = currentPattern.split('/')[1]; // 최대 인원수는 유지
        const newPattern = `${currentCount}/${maxCount}`;
        const newTitle = currentTitle.replace(participantPattern, newPattern);
        
        console.log(`[VoiceForumService] 패턴 변경: ${currentPattern} -> ${newPattern}`);
        console.log(`[VoiceForumService] 제목 변경: ${currentTitle} -> ${newTitle}`);
        
        // 제목이 실제로 변경된 경우에만 업데이트
        if (newTitle !== currentTitle) {
          try {
            // 1. 스레드 제목 업데이트 (재시도 로직 포함)
            await this.updateThreadNameWithRetry(thread, newTitle, 3);
            console.log(`[VoiceForumService] 스레드 제목 업데이트 완료`);
            
            // 2. 포럼 포스트 내용의 제목도 업데이트
            await this.updateForumPostContent(thread, currentPattern, newPattern);
            
            console.log(`포럼 포스트 제목 및 내용 업데이트: ${currentTitle} -> ${newTitle}`);
          } catch (updateError) {
            console.error(`[VoiceForumService] 업데이트 실패 (시도 ${retryCount + 1}/3):`, updateError.message);
            
            // 최대 3번까지 재시도
            if (retryCount < 2) {
              console.log(`[VoiceForumService] ${1000 * (retryCount + 30)}ms 후 재시도...`);
              setTimeout(() => {
                this.updateForumPostTitle(voiceChannelId, retryCount + 1);
              }, 1000 * (retryCount + 30)); // 2초, 3초, 4초 간격
            } else {
              console.error(`[VoiceForumService] 최대 재시도 횟수 초과. 업데이트 포기: ${voiceChannelId}`);
            }
          }
        } else {
          console.log(`[VoiceForumService] 제목 변경 불필요 (동일함)`);
        }
      } else {
        console.log(`[VoiceForumService] 제목에서 참여자 패턴을 찾을 수 없음`);
      }
    } catch (error) {
      console.error('포럼 포스트 제목 업데이트 오류:', error);
      
      // 최대 3번까지 재시도
      if (retryCount < 2) {
        console.log(`[VoiceForumService] ${1000 * (retryCount + 30)}ms 후 재시도...`);
        setTimeout(() => {
          this.updateForumPostTitle(voiceChannelId, retryCount + 1);
        }, 1000 * (retryCount + 30));
      }
    }
  }

  /**
   * 스레드 이름 업데이트 (재시도 로직 포함)
   * @param {ThreadChannel} thread - 스레드 채널
   * @param {string} newName - 새로운 이름
   * @param {number} maxRetries - 최대 재시도 횟수
   */
  async updateThreadNameWithRetry(thread, newName, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await thread.setName(newName);
        console.log(`[VoiceForumService] 스레드 이름 업데이트 성공 (시도 ${attempt}/${maxRetries})`);
        return; // 성공시 함수 종료
      } catch (error) {
        console.warn(`[VoiceForumService] 스레드 이름 업데이트 실패 (시도 ${attempt}/${maxRetries}):`, error.message);
        
        if (attempt === maxRetries) {
          throw error; // 마지막 시도에서 실패하면 에러 throw
        }
        
        // 다음 시도 전 대기 (지수적 백오프)
        const delay = Math.pow(30, attempt) * 1000; // 2초, 4초, 8초
        console.log(`[VoiceForumService] ${delay}ms 후 재시도...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * 포럼 포스트 내용의 제목 부분 업데이트
   * @param {ThreadChannel} thread - 스레드 채널
   * @param {string} oldPattern - 기존 패턴 (예: "1/5")
   * @param {string} newPattern - 새로운 패턴 (예: "2/5")
   */
  async updateForumPostContent(thread, oldPattern, newPattern) {
    try {
      // 스레드의 첫 번째 메시지 (임베드) 가져오기
      const messages = await thread.messages.fetch({ limit: 1 });
      const firstMessage = messages.first();
      
      if (!firstMessage || !firstMessage.embeds.length) {
        return;
      }

      const embed = EmbedBuilder.from(firstMessage.embeds[0]);
      
      // 임베드의 description에서 제목 부분 찾아서 업데이트
      if (embed.data.description) {
        const updatedDescription = embed.data.description.replace(
          new RegExp(oldPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          newPattern
        );
        
        // description이 실제로 변경된 경우에만 업데이트
        if (updatedDescription !== embed.data.description) {
          embed.setDescription(updatedDescription);
          await firstMessage.edit({ embeds: [embed] });
          console.log(`포럼 포스트 내용 업데이트: ${oldPattern} -> ${newPattern}`);
        }
      }
    } catch (error) {
      console.error('포럼 포스트 내용 업데이트 오류:', error);
    }
  }

  /**
   * 구인구직 연동 임베드 메시지를 음성 채널에 전송
   * @param {VoiceChannel} voiceChannel - 음성 채널
   */
  async sendRecruitmentEmbed(voiceChannel) {
    try {
      // ========== 권한 체크 ==========
      // 구인구직 기능이 비활성화된 경우 임베드 전송 안함
      if (!this.RECRUITMENT_ENABLED) {
        console.log(`[VoiceForumService] 구인구직 기능 비활성화로 임베드 전송 안함: ${voiceChannel.name}`);
        return;
      }
      // =============================

      const embed = new EmbedBuilder()
        .setTitle('🎯 구인구직 연동')
        .setDescription('이 음성 채널을 구인구직 포럼에 연동하시겠습니까?\n\n✅ **권한이 있는 사용자만** 이 메시지를 볼 수 있습니다')
        .addFields(
          { name: '📍 채널', value: voiceChannel.name, inline: true },
          { name: '🔗 바로가기', value: `<#${voiceChannel.id}>`, inline: true }
        )
        .setColor(0x5865F2)
        .setTimestamp();

      const button = new ButtonBuilder()
        .setCustomId(`recruitment_options_${voiceChannel.id}`)
        .setLabel('구인구직 연동하기')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📝');

      const row = new ActionRowBuilder().addComponents(button);

      await voiceChannel.send({
        embeds: [embed],
        components: [row]
      });

      console.log(`구인구직 임베드 전송 완료: ${voiceChannel.name}`);
    } catch (error) {
      console.error('구인구직 임베드 전송 오류:', error);
    }
  }

  /**
   * 활성화된 포럼 포스트 목록 가져오기
   * @param {string} userId - 사용자 ID (옵션, 지정시 해당 사용자가 작성한 포스트만)
   * @returns {Array} - 활성화된 포럼 포스트 배열
   */
  async getActiveForumPosts(userId = null) {
    try {
      const forumChannel = await this.client.channels.fetch(this.forumChannelId);
      
      if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
        return [];
      }

      // 활성화된 스레드만 가져오기
      const activeThreads = await forumChannel.threads.fetchActive();
      
      let filteredThreads = activeThreads.threads.filter(thread => !thread.archived && !thread.locked);
      
      // 특정 사용자의 포스트만 필터링 (요청된 경우)
      if (userId) {
        console.log(`[VoiceForumService] ${userId} 사용자의 포스트만 필터링 중...`);
        
        const userPosts = [];
        for (const [threadId, thread] of filteredThreads) {
          try {
            // 스레드의 첫 번째 메시지 가져오기 (내용에서 모집자 확인용)
            const messages = await thread.messages.fetch({ limit: 1 });
            const firstMessage = messages.first();
            
            if (firstMessage) {
              let isUserPost = false;
              
              // 1. 메시지 작성자가 사용자인 경우 (직접 연동)
              if (firstMessage.author.id === userId) {
                isUserPost = true;
                console.log(`[VoiceForumService] 직접 작성 포스트: ${thread.name}`);
              }
              
              // 2. 봇이 작성했지만 내용에 모집자 ID가 있는 경우 (/구직 명령어)
              else if (firstMessage.author.bot) {
                console.log(`[VoiceForumService] 봇 포스트 분석 시작: ${thread.name}`);
                console.log(`[VoiceForumService] 임베드 개수: ${firstMessage.embeds?.length || 0}`);
                
                // 임베드가 있는지 확인하고 안전하게 접근
                if (firstMessage.embeds && firstMessage.embeds.length > 0) {
                  const embedDescription = firstMessage.embeds[0].description;
                  console.log(`[VoiceForumService] 임베드 설명 일부:`, embedDescription ? embedDescription.substring(0, 200) + '...' : 'null');
                  
                  if (embedDescription) {
                    // 모집자 멘션 패턴 찾기: <@사용자ID>
                    const recruiterPattern = new RegExp(`<@${userId}>`);
                    console.log(`[VoiceForumService] 모집자 패턴 검색: <@${userId}>`);
                    
                    if (recruiterPattern.test(embedDescription)) {
                      isUserPost = true;
                      console.log(`[VoiceForumService] ✅ 봇 작성 포스트의 모집자 발견: ${thread.name}`);
                    } else {
                      console.log(`[VoiceForumService] ❌ 모집자 패턴 없음: ${thread.name}`);
                    }
                  } else {
                    console.log(`[VoiceForumService] ❌ 임베드 설명 없음: ${thread.name}`);
                  }
                } else {
                  console.log(`[VoiceForumService] ❌ 봇 포스트에 임베드 없음: ${thread.name}`);
                  console.log(`[VoiceForumService] 메시지 내용 길이: ${firstMessage.content?.length || 0}`);
                  console.log(`[VoiceForumService] 메시지 내용 일부:`, firstMessage.content ? firstMessage.content.substring(0, 200) + '...' : 'null');
                  
                  // 임베드가 없는 경우 메시지 내용에서 직접 검색
                  if (firstMessage.content && firstMessage.content.includes(`<@${userId}>`)) {
                    isUserPost = true;
                    console.log(`[VoiceForumService] ✅ 봇 작성 포스트의 메시지 내용에서 모집자 발견: ${thread.name}`);
                  } else {
                    console.log(`[VoiceForumService] ❌ 메시지 내용에서도 모집자 패턴 없음: <@${userId}>`);
                  }
                }
              } else {
                console.log(`[VoiceForumService] 기타 포스트 (봇=${firstMessage.author.bot}, 임베드=${firstMessage.embeds?.length || 0}): ${thread.name}`);
              }
              
              if (isUserPost) {
                userPosts.push(thread);
                console.log(`[VoiceForumService] 사용자 포스트 발견: ${thread.name}`);
              }
            }
          } catch (fetchError) {
            console.warn(`[VoiceForumService] 스레드 메시지 조회 실패: ${threadId}`, fetchError.message);
          }
        }
        
        filteredThreads = new Map(userPosts.map(thread => [thread.id, thread]));
        console.log(`[VoiceForumService] 필터링 결과: ${filteredThreads.size}개 포스트`);
      }
      
      return Array.from(filteredThreads.values())
        .map(thread => ({
          id: thread.id,
          name: thread.name,
          memberCount: thread.memberCount
        }))
        .slice(0, 15); // 드롭다운 최대 15개 제한
    } catch (error) {
      console.error('활성화된 포럼 포스트 조회 오류:', error);
      return [];
    }
  }

  /**
   * 버튼 인터랙션 처리 (1단계: 옵션 선택)
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   */
  async handleButtonInteraction(interaction) {
    try {
      if (!interaction.customId.startsWith('recruitment_options_')) {
        return;
      }

      // ========== 권한 체크 ==========
      if (!this.hasRecruitmentPermission(interaction.user, interaction.member)) {
        await interaction.reply({
          content: '❌ **구인구직 기능 접근 권한이 없습니다.**\n\n이 기능은 현재 베타 테스트 중으로 특정 사용자와 관리자만 이용할 수 있습니다.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      // =============================

      const voiceChannelId = interaction.customId.split('_')[2];
      const voiceChannel = await this.client.channels.fetch(voiceChannelId);

      if (!voiceChannel) {
        await interaction.reply({
          content: '❌ 음성 채널을 찾을 수 없습니다.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      // 활성화된 포럼 포스트 가져오기 (버튼을 누른 사용자의 포스트만)
      const activePosts = await this.getActiveForumPosts(interaction.user.id);

      const embed = new EmbedBuilder()
        .setTitle('🎯 구인구직 연동 방법 선택')
        .setDescription('새로운 포럼을 생성하거나 본인이 작성한 기존 포럼에 연동할 수 있습니다.')
        .setColor(0x5865F2);

      const selectOptions = [
        {
          label: '🆕 새 구인구직 포럼 생성',
          description: '새로운 포럼 포스트를 생성합니다',
          value: `new_forum_${voiceChannelId}`
        }
      ];

      // 사용자가 작성한 활성화된 포럼이 있으면 선택지에 추가
      if (activePosts.length > 0) {
        activePosts.forEach(post => {
          selectOptions.push({
            label: `🔗 ${post.name}`,
            description: `내가 작성한 "${post.name}" 포럼에 연동`,
            value: `existing_forum_${voiceChannelId}_${post.id}`
          });
        });
      } else {
        // 사용자가 작성한 포럼이 없는 경우 안내 메시지 추가
        embed.setDescription('새로운 포럼을 생성하거나 본인이 작성한 기존 포럼에 연동할 수 있습니다.\n\n💡 현재 연동할 수 있는 본인 작성 포럼이 없습니다.');
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`recruitment_select_${voiceChannelId}`)
        .setPlaceholder('연동 방법을 선택하세요')
        .addOptions(selectOptions);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      await interaction.reply({
        embeds: [embed],
        components: [row],
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      console.error('버튼 인터랙션 처리 오류:', error);
      await interaction.reply({
        content: '❌ 오류가 발생했습니다. 다시 시도해주세요.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  /**
   * 드롭다운 선택 처리
   * @param {StringSelectMenuInteraction} interaction - 드롭다운 인터랙션
   */
  async handleSelectMenuInteraction(interaction) {
    try {
      if (!interaction.customId.startsWith('recruitment_select_')) {
        return;
      }

      const selectedValue = interaction.values[0];
      const voiceChannelId = interaction.customId.split('_')[2];

      if (selectedValue.startsWith('new_forum_')) {
        // 새 포럼 생성 - 모달 표시
        await this.showRecruitmentModal(interaction, voiceChannelId);
      } else if (selectedValue.startsWith('existing_forum_')) {
        // 기존 포럼 연동
        const parts = selectedValue.split('_');
        const existingPostId = parts[3];
        await this.linkToExistingForum(interaction, voiceChannelId, existingPostId);
      }
    } catch (error) {
      console.error('드롭다운 선택 처리 오류:', error);
      await interaction.reply({
        content: '❌ 오류가 발생했습니다. 다시 시도해주세요.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  /**
   * 독립적인 구인구직 모달 표시 (명령어용)
   * @param {Interaction} interaction - 인터랙션 객체
   */
  async showStandaloneRecruitmentModal(interaction) {
    try {
      // ========== 권한 체크 ==========
      // 이 메서드는 이미 RecruitmentCommand에서 권한 체크를 했지만
      // 추가 보안을 위해 여기서도 체크
      if (!this.hasRecruitmentPermission(interaction.user, interaction.member)) {
        await interaction.reply({
          content: '❌ **구인구직 기능 접근 권한이 없습니다.**\n\n이 기능은 현재 베타 테스트 중으로 특정 사용자와 관리자만 이용할 수 있습니다.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      // =============================

      const modal = new ModalBuilder()
        .setCustomId('standalone_recruitment_modal')
        .setTitle('구인구직 포럼 생성');

      const titleInput = new TextInputBuilder()
        .setCustomId('recruitment_title')
        .setLabel('제목 (현재 인원/최대 인원) 필수')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('예: 칼바람 1/5 오후 8시')
        .setRequired(true)
        .setMaxLength(100);

      const tagsInput = new TextInputBuilder()
        .setCustomId('recruitment_tags')
        .setLabel('태그 (쉼표로 구분)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('예: 칼바람, 롤, 스팀게임')
        .setRequired(false)
        .setMaxLength(100);

      const descriptionInput = new TextInputBuilder()
        .setCustomId('recruitment_description')
        .setLabel('상세 설명')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('게임 모드, 티어, 기타 요구사항 등을 자유롭게 작성해주세요.')
        .setRequired(false)
        .setMaxLength(1000);

      const firstRow = new ActionRowBuilder().addComponents(titleInput);
      const secondRow = new ActionRowBuilder().addComponents(tagsInput);
      const thirdRow = new ActionRowBuilder().addComponents(descriptionInput);

      modal.addComponents(firstRow, secondRow, thirdRow);

      await interaction.showModal(modal);
    } catch (error) {
      console.error('독립 모달 표시 오류:', error);
    }
  }

  /**
   * 구인구직 모달 표시 (새 포럼 생성용)
   * @param {Interaction} interaction - 인터랙션 객체
   * @param {string} voiceChannelId - 음성 채널 ID
   */
  async showRecruitmentModal(interaction, voiceChannelId) {
    try {
      const modal = new ModalBuilder()
        .setCustomId(`recruitment_modal_${voiceChannelId}`)
        .setTitle('새 구인구직 포럼 생성');

      const titleInput = new TextInputBuilder()
        .setCustomId('recruitment_title')
        .setLabel('제목 (현재 인원/최대 인원) 필수')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('예: 칼바람 1/5 오후 8시')
        .setRequired(true)
        .setMaxLength(100);

      const tagsInput = new TextInputBuilder()
        .setCustomId('recruitment_tags')
        .setLabel('태그 (쉼표로 구분)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('예: 칼바람, 롤, 스팀게임')
        .setRequired(false)
        .setMaxLength(100);

      const descriptionInput = new TextInputBuilder()
        .setCustomId('recruitment_description')
        .setLabel('상세 설명')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('게임 모드, 티어, 기타 요구사항 등을 자유롭게 작성해주세요.')
        .setRequired(false)
        .setMaxLength(1000);

      const firstRow = new ActionRowBuilder().addComponents(titleInput);
      const secondRow = new ActionRowBuilder().addComponents(tagsInput);
      const thirdRow = new ActionRowBuilder().addComponents(descriptionInput);

      modal.addComponents(firstRow, secondRow, thirdRow);

      await interaction.showModal(modal);
    } catch (error) {
      console.error('모달 표시 오류:', error);
    }
  }

  /**
   * 기존 포럼에 연동
   * @param {Interaction} interaction - 인터랙션 객체
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {string} existingPostId - 기존 포스트 ID
   */
  async linkToExistingForum(interaction, voiceChannelId, existingPostId) {
    try {
      const voiceChannel = await this.client.channels.fetch(voiceChannelId);
      const existingThread = await this.client.channels.fetch(existingPostId);

      if (!voiceChannel || !existingThread) {
        await interaction.reply({
          content: '❌ 채널을 찾을 수 없습니다.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      // 기존 포럼에 음성 채널 링크 추가
      const linkEmbed = new EmbedBuilder()
        .setTitle('🔊 음성 채널 연동')
        .setDescription(`새로운 음성 채널이 이 구인구직에 연동되었습니다!`)
        .addFields(
          { name: '🎯 연결된 음성 채널', value: `[${voiceChannel.name} 참여하기](https://discord.com/channels/${voiceChannel.guild.id}/${voiceChannel.id})`, inline: false },
          { name: '👤 연동자', value: `<@${interaction.user.id}>`, inline: true }
        )
        .setColor(0x00FF00)
        .setTimestamp();

      await existingThread.send({ embeds: [linkEmbed] });

      // 기존 포럼 포스트의 음성 채널 필드 업데이트
      await this.updateVoiceChannelLink(existingPostId, voiceChannel.name, voiceChannel.id, voiceChannel.guild.id);

      // 채널-포스트 매핑 저장
      this.channelPostMap.set(voiceChannelId, existingPostId);
      console.log(`[VoiceForumService] 🔗 기존 포럼 연동 매핑 저장: ${voiceChannelId} -> ${existingPostId}`);
      console.log(`[VoiceForumService] 현재 매핑 상태:`, Array.from(this.channelPostMap.entries()));

      await this.safeReply(interaction, {
        content: `✅ 기존 구인구직에 성공적으로 연동되었습니다!\n🔗 포럼: <#${existingPostId}>`,
        flags: MessageFlags.Ephemeral
      });

      console.log(`기존 포럼 연동 완료: ${voiceChannel.name} -> ${existingThread.name}`);
    } catch (error) {
      console.error('기존 포럼 연동 오류:', error);
      await this.safeReply(interaction, {
        content: '❌ 연동에 실패했습니다. 다시 시도해주세요.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  /**
   * 독립적인 포럼 포스트 생성 (음성 채널 없이)
   * @param {Object} recruitmentData - 구인구직 데이터
   * @returns {string|null} - 생성된 포스트 ID 또는 null
   */
  async createStandaloneForumPost(recruitmentData) {
    try {
      const forumChannel = await this.client.channels.fetch(this.forumChannelId);
      
      if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
        console.error('포럼 채널을 찾을 수 없거나 올바른 포럼 채널이 아닙니다.');
        return null;
      }

      // 태그를 역할 멘션으로 변환 (길드 정보 필요)
      const guild = forumChannel.guild;
      const roleMentions = await this.convertTagsToRoleMentions(recruitmentData.tags, guild);
      const tagsText = roleMentions ? roleMentions : '';

      // 텍스트 크기를 키우기 위해 마크다운 사용
      const largeDescription = `## 📝 상세 설명\n${recruitmentData.description}`;
      const largeVoiceChannel = `## 🔊 음성 채널\n음성 채널에서 연동 버튼을 클릭하면 자동으로 연결됩니다.`;
      const largeTags = tagsText ? `## 🏷️ 태그\n${tagsText}` : '';
      const largeRecruiter = `## 👤 모집자\n<@${recruitmentData.author.id}>`;

      console.log(`[VoiceForumService] 독립 포스트 생성 - 모집자: <@${recruitmentData.author.id}>`);
      console.log(`[VoiceForumService] 독립 포스트 생성 - 제목: ${recruitmentData.title}`);

      // 전체 내용을 하나의 큰 텍스트로 구성
      let content = `# 🎮 ${recruitmentData.title}\n\n`;
      
      if (largeTags) {
        content += `${largeTags}\n\n`;
      }
      
      content += `${largeDescription}\n\n`;
      content += `${largeVoiceChannel}\n\n`;
      content += `${largeRecruiter}`;

      const embed = new EmbedBuilder()
        .setDescription(content)
        .setColor(0xFFB800) // 독립 포스트는 주황색으로 구분
        .setFooter({ 
          text: '음성 채널에서 "구인구직 연동하기" 버튼을 클릭하여 연결하세요.',
          iconURL: recruitmentData.author.displayAvatarURL()
        });

      const thread = await forumChannel.threads.create({
        name: recruitmentData.title,
        message: {
          embeds: [embed]
        }
      });

      // 모집자를 스레드에 자동으로 추가 (팔로우)
      try {
        await thread.members.add(recruitmentData.author.id);
        console.log(`모집자가 독립 스레드에 자동으로 추가됨: ${recruitmentData.author.id}`);
      } catch (addError) {
        console.warn('모집자를 독립 스레드에 추가하는데 실패:', addError.message);
      }

      console.log(`독립 포럼 포스트 생성 완료: ${thread.name} (ID: ${thread.id})`);
      return thread.id;
    } catch (error) {
      console.error('독립 포럼 포스트 생성 오류:', error);
      return null;
    }
  }

  /**
   * 음성 채널 이름 실시간 업데이트
   * @param {string} postId - 포스트 ID
   * @param {string} newChannelName - 새로운 채널 이름
   * @param {string} channelId - 채널 ID
   * @param {string} guildId - 길드 ID
   */
  async updateVoiceChannelLink(postId, newChannelName, channelId, guildId) {
    try {
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread() || thread.archived) {
        return;
      }

      // 스레드의 첫 번째 메시지 (임베드) 가져오기
      const messages = await thread.messages.fetch({ limit: 1 });
      const firstMessage = messages.first();
      
      if (!firstMessage || !firstMessage.embeds.length) {
        return;
      }

      const embed = EmbedBuilder.from(firstMessage.embeds[0]);
      
      // 음성 채널 필드 찾아서 업데이트
      const fieldIndex = embed.data.fields?.findIndex(field => 
        field.name === '🔊 음성 채널'
      );

      if (fieldIndex !== -1) {
        embed.data.fields[fieldIndex].value = `[${newChannelName} 참여하기](https://discord.com/channels/${guildId}/${channelId})`;
        
        await firstMessage.edit({ embeds: [embed] });
        console.log(`포럼 포스트 음성 채널 링크 업데이트: ${newChannelName} (ID: ${postId})`);
      }
    } catch (error) {
      console.error('음성 채널 링크 업데이트 오류:', error);
    }
  }

  /**
   * 모달 제출 처리
   * @param {ModalSubmitInteraction} interaction - 모달 제출 인터랙션
   */
  async handleModalSubmit(interaction) {
    try {
      console.log(`[VoiceForumService] 모달 제출 처리 시작: ${interaction.customId}`);
      
      // 독립적인 구인구직 모달 처리
      if (interaction.customId === 'standalone_recruitment_modal') {
        await this.handleStandaloneModalSubmit(interaction);
        return;
      }

      // 음성 채널 연동 모달 처리
      if (interaction.customId.startsWith('recruitment_modal_')) {
        await this.handleVoiceChannelModalSubmit(interaction);
        return;
      }
    } catch (error) {
      console.error('모달 제출 처리 오류:', error);
      
      // 안전한 오류 응답
      await this.safeReply(interaction, {
        content: '❌ 오류가 발생했습니다. 다시 시도해주세요.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  /**
   * 안전한 인터랙션 응답 (만료 및 중복 응답 방지)
   * @param {Interaction} interaction - 인터랙션 객체
   * @param {Object} replyOptions - 응답 옵션
   */
  async safeReply(interaction, replyOptions) {
    try {
      // 인터랙션이 이미 응답되었거나 지연 응답된 경우 체크
      if (interaction.replied) {
        console.log(`[VoiceForumService] 인터랙션이 이미 응답됨 - followUp 사용`);
        await interaction.followUp(replyOptions);
      } else if (interaction.deferred) {
        console.log(`[VoiceForumService] 인터랙션이 지연됨 - editReply 사용`);
        await interaction.editReply(replyOptions);
      } else {
        console.log(`[VoiceForumService] 일반 응답 사용`);
        await interaction.reply(replyOptions);
      }
    } catch (error) {
      // Unknown interaction 오류 등을 무시
      if (error.code === 10062) {
        console.warn(`[VoiceForumService] 인터랙션 만료됨 - 응답 무시`);
      } else {
        console.error(`[VoiceForumService] 안전한 응답 실패:`, error);
      }
    }
  }

  /**
   * 독립적인 모달 제출 처리
   * @param {ModalSubmitInteraction} interaction - 모달 제출 인터랙션
   */
  async handleStandaloneModalSubmit(interaction) {
    console.log(`[VoiceForumService] 독립 모달 제출 처리 시작`);
    
    try {
      // 모달 입력값 추출
      const title = interaction.fields.getTextInputValue('recruitment_title');
      const tags = interaction.fields.getTextInputValue('recruitment_tags') || '';
      const description = interaction.fields.getTextInputValue('recruitment_description') || '설명 없음';

      console.log(`[VoiceForumService] 포럼 포스트 생성 중: ${title}`);

      // 독립적인 포럼 포스트 생성
      const postId = await this.createStandaloneForumPost({
        title,
        tags,
        description,
        author: interaction.user
      });

      if (postId) {
        await this.safeReply(interaction, {
          content: `✅ 구인구직 포럼이 성공적으로 생성되었습니다!\n🔗 포럼: <#${postId}>\n\n💡 음성 채널에서 "구인구직 연동하기" 버튼을 클릭하여 이 포럼과 연결할 수 있습니다.`,
          flags: MessageFlags.Ephemeral
        });
        console.log(`[VoiceForumService] 독립 포럼 생성 완료: ${postId}`);
      } else {
        await this.safeReply(interaction, {
          content: '❌ 포럼 포스트 생성에 실패했습니다. 다시 시도해주세요.',
          flags: MessageFlags.Ephemeral
        });
        console.log(`[VoiceForumService] 독립 포럼 생성 실패`);
      }
    } catch (error) {
      console.error(`[VoiceForumService] 독립 모달 제출 처리 오류:`, error);
      
      await this.safeReply(interaction, {
        content: '❌ 처리 중 오류가 발생했습니다. 다시 시도해주세요.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  /**
   * 음성 채널 연동 모달 제출 처리
   * @param {ModalSubmitInteraction} interaction - 모달 제출 인터랙션
   */
  async handleVoiceChannelModalSubmit(interaction) {
    console.log(`[VoiceForumService] 음성 채널 연동 모달 제출 처리 시작`);
    
    try {
      const voiceChannelId = interaction.customId.split('_')[2];
      const voiceChannel = await this.client.channels.fetch(voiceChannelId);

      if (!voiceChannel) {
        await this.safeReply(interaction, {
          content: '❌ 음성 채널을 찾을 수 없습니다.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      // 모달 입력값 추출
      const title = interaction.fields.getTextInputValue('recruitment_title');
      const tags = interaction.fields.getTextInputValue('recruitment_tags') || '';
      const description = interaction.fields.getTextInputValue('recruitment_description') || '설명 없음';

      console.log(`[VoiceForumService] 음성 채널 연동 포럼 생성 중: ${title}`);

      // 포럼 채널에서 포스트 생성
      const postId = await this.createForumPost(voiceChannel, {
        title,
        tags,
        description,
        author: interaction.user
      });

      if (postId) {
        // 채널-포스트 매핑 저장
        this.channelPostMap.set(voiceChannelId, postId);
        console.log(`[VoiceForumService] 🔗 새 포럼 생성 매핑 저장: ${voiceChannelId} -> ${postId}`);
        console.log(`[VoiceForumService] 현재 매핑 상태:`, Array.from(this.channelPostMap.entries()));

        await this.safeReply(interaction, {
          content: `✅ 구인구직이 성공적으로 등록되었습니다!\n🔗 포럼: <#${postId}>`,
          flags: MessageFlags.Ephemeral
        });
        console.log(`[VoiceForumService] 음성 채널 연동 포럼 생성 완료: ${postId}`);
      } else {
        await this.safeReply(interaction, {
          content: '❌ 포럼 포스트 생성에 실패했습니다. 다시 시도해주세요.',
          flags: MessageFlags.Ephemeral
        });
        console.log(`[VoiceForumService] 음성 채널 연동 포럼 생성 실패`);
      }
    } catch (error) {
      console.error(`[VoiceForumService] 음성 채널 연동 모달 제출 처리 오류:`, error);
      
      await this.safeReply(interaction, {
        content: '❌ 처리 중 오류가 발생했습니다. 다시 시도해주세요.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  /**
   * 태그를 역할 멘션으로 변환
   * @param {string} tags - 쉼표로 구분된 태그 문자열
   * @param {Guild} guild - 디스코드 길드 객체
   * @returns {string} - 변환된 역할 멘션 문자열
   */
  async convertTagsToRoleMentions(tags, guild) {
    if (!tags || !tags.trim()) {
      return '';
    }

    const tagArray = tags.split(',').map(tag => tag.trim());
    const roleMentions = [];

    for (const tag of tagArray) {
      // 길드에서 태그와 일치하는 역할 찾기 (대소문자 구분 안함)
      const role = guild.roles.cache.find(r => 
        r.name.toLowerCase() === tag.toLowerCase()
      );

      if (role) {
        roleMentions.push(`<@&${role.id}>`);
      } else {
        // 역할이 없으면 그냥 텍스트로 표시
        roleMentions.push(`@${tag}`);
      }
    }

    return roleMentions.join(', ');
  }

  /**
   * 포럼 채널에 포스트 생성
   * @param {VoiceChannel} voiceChannel - 음성 채널
   * @param {Object} recruitmentData - 구인구직 데이터
   * @returns {string|null} - 생성된 포스트 ID 또는 null
   */
  async createForumPost(voiceChannel, recruitmentData) {
    try {
      const forumChannel = await this.client.channels.fetch(this.forumChannelId);
      
      if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
        console.error('포럼 채널을 찾을 수 없거나 올바른 포럼 채널이 아닙니다.');
        return null;
      }

      // 태그를 역할 멘션으로 변환
      const roleMentions = await this.convertTagsToRoleMentions(recruitmentData.tags, voiceChannel.guild);
      const tagsText = roleMentions ? roleMentions : '';

      // 텍스트 크기를 키우기 위해 마크다운 사용
      const largeDescription = `## 📝 상세 설명\n${recruitmentData.description}`;
      const largeVoiceChannel = `## 🔊 음성 채널\n[${voiceChannel.name} 참여하기](https://discord.com/channels/${voiceChannel.guild.id}/${voiceChannel.id})`;
      const largeTags = tagsText ? `## 🏷️ 태그\n${tagsText}` : '';
      const largeRecruiter = `## 👤 모집자\n<@${recruitmentData.author.id}>`;

      // 전체 내용을 하나의 큰 텍스트로 구성
      let content = `# 🎮 ${recruitmentData.title}\n\n`;
      
      if (largeTags) {
        content += `${largeTags}\n\n`;
      }
      
      content += `${largeDescription}\n\n`;
      content += `${largeVoiceChannel}\n\n`;
      content += `${largeRecruiter}`;

      // 음성 채널 대기/관전/초기화 버튼 생성
      const waitButton = new ButtonBuilder()
        .setCustomId(`voice_wait_${voiceChannel.id}`)
        .setLabel('대기하기')
        .setStyle(ButtonStyle.Success)
        .setEmoji('⏳');

      const spectateButton = new ButtonBuilder()
        .setCustomId(`voice_spectate_${voiceChannel.id}`)
        .setLabel('관전하기')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('👁️');

      const resetButton = new ButtonBuilder()
        .setCustomId(`voice_reset_${voiceChannel.id}`)
        .setLabel('초기화')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔄');

      const voiceButtonRow = new ActionRowBuilder().addComponents(waitButton, spectateButton, resetButton);

      const embed = new EmbedBuilder()
        .setDescription(content)
        .setColor(0x00FF00)
        .setFooter({ 
          text: '음성 채널이 삭제되면 이 포스트는 자동으로 아카이브됩니다.',
          iconURL: recruitmentData.author.displayAvatarURL()
        });

      const thread = await forumChannel.threads.create({
        name: recruitmentData.title,
        message: {
          embeds: [embed],
          components: [voiceButtonRow]
        }
      });

      // 모집자를 스레드에 자동으로 추가 (팔로우)
      try {
        await thread.members.add(recruitmentData.author.id);
        console.log(`모집자가 스레드에 자동으로 추가됨: ${recruitmentData.author.id}`);
      } catch (addError) {
        console.warn('모집자를 스레드에 추가하는데 실패:', addError.message);
      }

      console.log(`포럼 포스트 생성 완료: ${thread.name} (ID: ${thread.id})`);
      return thread.id;
    } catch (error) {
      console.error('포럼 포스트 생성 오류:', error);
      return null;
    }
  }

  /**
   * 포럼 포스트 아카이브
   * @param {string} postId - 포스트 ID
   */
  async archiveForumPost(postId) {
    try {
      console.log(`[VoiceForumService] 포럼 포스트 아카이브 시작: ${postId}`);
      
      const thread = await this.client.channels.fetch(postId);
      
      if (!thread || !thread.isThread()) {
        console.error(`[VoiceForumService] 스레드를 찾을 수 없습니다: ${postId}`);
        return;
      }

      console.log(`[VoiceForumService] 스레드 정보: ${thread.name}, 아카이브됨: ${thread.archived}, 잠김: ${thread.locked}`);

      // 이미 아카이브되었거나 잠겨있는지 확인
      if (thread.archived) {
        console.log(`[VoiceForumService] 스레드가 이미 아카이브되어 있습니다: ${thread.name} (ID: ${postId})`);
        return;
      }

      // 아카이브 알림 메시지 전송 (스레드가 활성화되어 있을 때만)
      try {
        console.log(`[VoiceForumService] 아카이브 알림 메시지 전송 중...`);
        const archiveEmbed = new EmbedBuilder()
          .setTitle('📁 구인구직 종료')
          .setDescription('연결된 음성 채널이 삭제되어 이 구인구직이 자동으로 종료되었습니다.')
          .setColor(0xFF6B6B)
          .setTimestamp();

        await thread.send({ embeds: [archiveEmbed] });
        console.log(`[VoiceForumService] 아카이브 알림 메시지 전송 완료`);
      } catch (messageError) {
        console.warn(`[VoiceForumService] 아카이브 메시지 전송 실패:`, messageError.message);
      }

      // 스레드 아카이브 및 잠금
      try {
        console.log(`[VoiceForumService] 스레드 아카이브 및 잠금 시작...`);
        
        if (!thread.archived) {
          await thread.setArchived(true);
          console.log(`[VoiceForumService] 스레드 아카이브 완료`);
        }
        
        if (!thread.locked) {
          await thread.setLocked(true);
          console.log(`[VoiceForumService] 스레드 잠금 완료`);
        }
        
        console.log(`[VoiceForumService] 포럼 포스트 아카이브 완료: ${thread.name} (ID: ${postId})`);
      } catch (archiveError) {
        // 이미 아카이브된 경우의 에러는 무시
        if (archiveError.code === 50083) {
          console.log(`[VoiceForumService] 스레드가 이미 아카이브되어 있습니다: ${thread.name} (ID: ${postId})`);
        } else {
          console.error(`[VoiceForumService] 스레드 아카이브 실패:`, archiveError);
        }
      }
    } catch (error) {
      console.error(`[VoiceForumService] 포럼 포스트 아카이브 처리 오류:`, error);
    }
  }

  /**
   * 음성 채널 참여/관전 버튼 처리
   * @param {ButtonInteraction} interaction - 버튼 인터랙션
   */
  async handleVoiceChannelButtons(interaction) {
    try {
      if (interaction.customId.startsWith('voice_wait_')) {
        // 대기하기 버튼 처리
        const voiceChannelId = interaction.customId.split('_')[2];
        const voiceChannel = await this.client.channels.fetch(voiceChannelId);
        
        if (!voiceChannel) {
          await interaction.reply({
            content: '❌ 음성 채널을 찾을 수 없습니다.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const member = interaction.member;
        const currentNickname = member.nickname || member.user.displayName;
        
        // [관전]이 있으면 [대기]로 변경, 없으면 [대기] 추가
        let newNickname;
        if (currentNickname.startsWith('[관전]')) {
          newNickname = currentNickname.replace('[관전]', '[대기]');
        } else if (currentNickname.startsWith('[대기]')) {
          await interaction.reply({
            content: '⏳ 이미 대기 모드로 설정되어 있습니다.',
            flags: MessageFlags.Ephemeral
          });
          return;
        } else {
          newNickname = `[대기] ${currentNickname}`;
        }

        try {
          await member.setNickname(newNickname);
          await interaction.reply({
            content: `⏳ 대기 모드로 설정되었습니다!\n🔊 음성 채널: **${voiceChannel.name}**\n📝 닉네임: "${newNickname}"`,
            flags: MessageFlags.Ephemeral
          });
        } catch (nicknameError) {
          console.error('닉네임 변경 오류:', nicknameError);
          await interaction.reply({
            content: `❌ 닉네임 변경에 실패했습니다.\n🔊 음성 채널: **${voiceChannel.name}**\n💡 수동으로 닉네임을 "${newNickname}"로 변경해주세요.`,
            flags: MessageFlags.Ephemeral
          });
        }

      } else if (interaction.customId.startsWith('voice_spectate_')) {
        // 관전하기 버튼 처리
        const voiceChannelId = interaction.customId.split('_')[2];
        const voiceChannel = await this.client.channels.fetch(voiceChannelId);
        
        if (!voiceChannel) {
          await interaction.reply({
            content: '❌ 음성 채널을 찾을 수 없습니다.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const member = interaction.member;
        const currentNickname = member.nickname || member.user.displayName;
        
        // [대기]가 있으면 [관전]으로 변경, 없으면 [관전] 추가
        let newNickname;
        if (currentNickname.startsWith('[대기]')) {
          newNickname = currentNickname.replace('[대기]', '[관전]');
        } else if (currentNickname.startsWith('[관전]')) {
          await interaction.reply({
            content: '👁️ 이미 관전 모드로 설정되어 있습니다.',
            flags: MessageFlags.Ephemeral
          });
          return;
        } else {
          newNickname = `[관전] ${currentNickname}`;
        }

        try {
          await member.setNickname(newNickname);
          await interaction.reply({
            content: `👁️ 관전 모드로 설정되었습니다!\n🔊 음성 채널: **${voiceChannel.name}**\n📝 닉네임: "${newNickname}"`,
            flags: MessageFlags.Ephemeral
          });
        } catch (nicknameError) {
          console.error('닉네임 변경 오류:', nicknameError);
          await interaction.reply({
            content: `❌ 닉네임 변경에 실패했습니다.\n🔊 음성 채널: **${voiceChannel.name}**\n💡 수동으로 닉네임을 "${newNickname}"로 변경해주세요.`,
            flags: MessageFlags.Ephemeral
          });
        }

      } else if (interaction.customId.startsWith('voice_reset_')) {
        // 초기화 버튼 처리
        const voiceChannelId = interaction.customId.split('_')[2];
        const voiceChannel = await this.client.channels.fetch(voiceChannelId);
        
        if (!voiceChannel) {
          await interaction.reply({
            content: '❌ 음성 채널을 찾을 수 없습니다.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        const member = interaction.member;
        const currentNickname = member.nickname || member.user.displayName;
        
        // [대기] 또는 [관전] 태그 제거
        let newNickname = currentNickname;
        if (currentNickname.startsWith('[대기] ')) {
          newNickname = currentNickname.replace('[대기] ', '');
        } else if (currentNickname.startsWith('[관전] ')) {
          newNickname = currentNickname.replace('[관전] ', '');
        } else {
          await interaction.reply({
            content: '🔄 닉네임에 제거할 태그가 없습니다.',
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        try {
          await member.setNickname(newNickname);
          await interaction.reply({
            content: `🔄 닉네임이 초기화되었습니다!\n🔊 음성 채널: **${voiceChannel.name}**\n📝 닉네임: "${newNickname}"`,
            flags: MessageFlags.Ephemeral
          });
        } catch (nicknameError) {
          console.error('닉네임 초기화 오류:', nicknameError);
          await interaction.reply({
            content: `❌ 닉네임 초기화에 실패했습니다.\n🔊 음성 채널: **${voiceChannel.name}**\n💡 수동으로 닉네임을 "${newNickname}"로 변경해주세요.`,
            flags: MessageFlags.Ephemeral
          });
        }
      }
    } catch (error) {
      console.error('음성 채널 버튼 처리 오류:', error);
      await interaction.reply({
        content: '❌ 오류가 발생했습니다. 다시 시도해주세요.',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  /**
   * 인터랙션 처리 (버튼, 드롭다운, 모달 통합)
   * @param {Interaction} interaction - 인터랙션 객체
   */
  async handleInteraction(interaction) {
    try {
      if (interaction.isButton()) {
        // 음성 채널 대기/관전/초기화 버튼 확인
        if (interaction.customId.startsWith('voice_wait_') || 
            interaction.customId.startsWith('voice_spectate_') || 
            interaction.customId.startsWith('voice_reset_')) {
          await this.handleVoiceChannelButtons(interaction);
        } else {
          await this.handleButtonInteraction(interaction);
        }
      } else if (interaction.isStringSelectMenu()) {
        await this.handleSelectMenuInteraction(interaction);
      } else if (interaction.isModalSubmit()) {
        await this.handleModalSubmit(interaction);
      }
    } catch (error) {
      console.error('인터랙션 처리 오류:', error);
    }
  }
}