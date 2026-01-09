// src/services/EmojiReactionService.js - 이모지 반응 처리 서비스
import { TextProcessor } from '../utils/TextProcessor.js';
import { DiscordConstants } from '../config/DiscordConstants.js';

export class EmojiReactionService {
  constructor(client, forumPostManager) {
    this.client = client;
    this.forumPostManager = forumPostManager;
    
    // 감지할 이모지 ID
    this.targetEmojiId = '1319891512573689917';

    // 이전 참가자 목록을 저장하는 캐시 (channelId -> participants[])
    this.previousParticipants = new Map();

    // 버튼 기반 포스트 캐시 (threadId -> boolean)
    this.buttonBasedPosts = new Map();
  }

  /**
   * 서비스 초기화 - 기존 포럼의 참가자 정보 복구
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      console.log('[EmojiReactionService] 서비스 초기화 시작...');

      // 데이터베이스에서 모든 활성 포럼 레코드 조회
      const databaseManager = this.forumPostManager.databaseManager;
      if (!databaseManager) {
        console.warn('[EmojiReactionService] DatabaseManager를 사용할 수 없어 초기화를 건너뜁니다.');
        return;
      }

      // 데이터베이스에서 모든 활성 포럼의 참가자 정보 복구
      const participantsMap = await databaseManager.getAllActiveParticipants();

      console.log(`[EmojiReactionService] ${participantsMap.size}개의 활성 포럼에서 참가자 정보 복구`);

      let restoredCount = 0;

      for (const [forumPostId, participants] of participantsMap.entries()) {
        try {
          console.log(`[EmojiReactionService] 포럼 ${forumPostId} 참가자 정보 복구 시작...`);

          // 포럼 스레드가 존재하는지 확인
          const channel = await this.client.channels.fetch(forumPostId).catch(() => null);
          if (!channel || !this.isForumThread(channel)) {
            console.warn(`[EmojiReactionService] 포럼 스레드를 찾을 수 없음: ${forumPostId}`);
            continue;
          }

          if (channel.archived) {
            console.log(`[EmojiReactionService] 아카이브된 포럼 건너뛰기: ${forumPostId}`);
            continue;
          }

          // 캐시에 참가자 정보 저장
          if (participants.length > 0) {
            this.previousParticipants.set(forumPostId, participants);
            restoredCount++;
            console.log(`[EmojiReactionService] 포럼 ${forumPostId} 참가자 ${participants.length}명 복구 완료`);
          } else {
            console.log(`[EmojiReactionService] 포럼 ${forumPostId} 기존 참가자 없음`);
          }

        } catch (error) {
          console.error(`[EmojiReactionService] 포럼 ${forumPostId} 참가자 복구 실패:`, error);
        }
      }

      console.log(`[EmojiReactionService] 초기화 완료: ${restoredCount}개 포럼의 참가자 정보 복구`);

    } catch (error) {
      console.error('[EmojiReactionService] 초기화 오류:', error);
    }
  }

  /**
   * 이모지 반응 추가 이벤트 처리
   * @param {MessageReaction} reaction - 반응 객체
   * @param {User} user - 반응한 사용자
   * @returns {Promise<void>}
   */
  async handleMessageReactionAdd(reaction, user) {
    try {
      // 봇 자신의 반응은 무시
      if (user.bot) {
        return;
      }

      // 부분적으로 로드된 반응이나 메시지 완전히 로드
      const fullReaction = await this.ensureFullReaction(reaction);
      if (!fullReaction) {
        console.warn('[EmojiReactionService] 반응 또는 메시지를 완전히 로드할 수 없음');
        return;
      }

      // 특정 이모지 ID가 아니면 무시
      if (!this.isTargetEmoji(fullReaction)) {
        return;
      }

      // 포럼 스레드가 아니면 무시
      if (!this.isForumThread(fullReaction.message.channel)) {
        return;
      }

      // 버튼 기반 포스트인지 확인 (하위 호환성)
      const hasParticipationButton = await this.checkForParticipationButton(fullReaction.message.channel.id);
      if (hasParticipationButton) {
        console.log('[EmojiReactionService] 버튼 기반 참가 시스템 감지, 이모지 무시');
        return;
      }

      console.log(`[EmojiReactionService] 참가 이모지 반응 감지: ${user.displayName || user.username} in ${fullReaction.message.channel.name}`);

      // 해당 이모지에 반응한 모든 사용자 가져오기 (재시도 로직 포함)
      const participants = await this.getReactionParticipantsWithRetry(fullReaction);
      if (participants === null) {
        console.error('[EmojiReactionService] 참가자 목록 가져오기 실패 (모든 재시도 실패)');
        return;
      }

      // 참가자 변화 감지 및 알림 메시지 전송
      await this.handleParticipantChanges(fullReaction.message.channel.id, participants);

      // 참가자 목록 메시지 전송 (ForumPostManager를 통해)
      const success = await this.forumPostManager.sendEmojiParticipantUpdate(
        fullReaction.message.channel.id, 
        participants, 
        '참가'
      );

      if (!success) {
        console.warn('[EmojiReactionService] 참가자 목록 메시지 전송 실패');
      }

    } catch (error) {
      console.error('[EmojiReactionService] 이모지 반응 처리 오류:', error);
    }
  }

  /**
   * 이모지 반응 제거 이벤트 처리
   * @param {MessageReaction} reaction - 반응 객체
   * @param {User} user - 반응을 제거한 사용자
   * @returns {Promise<void>}
   */
  async handleMessageReactionRemove(reaction, user) {
    try {
      // 봇 자신의 반응은 무시
      if (user.bot) {
        return;
      }

      // 부분적으로 로드된 반응이나 메시지 완전히 로드
      const fullReaction = await this.ensureFullReaction(reaction);
      if (!fullReaction) {
        console.warn('[EmojiReactionService] 반응 또는 메시지를 완전히 로드할 수 없음');
        return;
      }

      // 특정 이모지 ID가 아니면 무시
      if (!this.isTargetEmoji(fullReaction)) {
        return;
      }

      // 포럼 스레드가 아니면 무시
      if (!this.isForumThread(fullReaction.message.channel)) {
        return;
      }

      // 버튼 기반 포스트인지 확인 (하위 호환성)
      const hasParticipationButton = await this.checkForParticipationButton(fullReaction.message.channel.id);
      if (hasParticipationButton) {
        console.log('[EmojiReactionService] 버튼 기반 참가 시스템 감지, 이모지 무시');
        return;
      }

      console.log(`[EmojiReactionService] 참가 이모지 반응 제거 감지: ${user.displayName || user.username} in ${fullReaction.message.channel.name}`);

      // 해당 이모지에 반응한 모든 사용자 가져오기 (재시도 로직 포함)
      const participants = await this.getReactionParticipantsWithRetry(fullReaction);
      if (participants === null) {
        console.error('[EmojiReactionService] 참가자 목록 가져오기 실패 (모든 재시도 실패)');
        return;
      }

      // 참가자 변화 감지 및 알림 메시지 전송
      await this.handleParticipantChanges(fullReaction.message.channel.id, participants);

      // 참가자 목록 메시지 전송 (ForumPostManager를 통해)
      const success = await this.forumPostManager.sendEmojiParticipantUpdate(
        fullReaction.message.channel.id, 
        participants, 
        '참가'
      );

      if (!success) {
        console.warn('[EmojiReactionService] 참가자 목록 메시지 전송 실패');
      }

    } catch (error) {
      console.error('[EmojiReactionService] 이모지 반응 제거 처리 오류:', error);
    }
  }

  /**
   * 대상 이모지인지 확인
   * @param {MessageReaction} reaction - 반응 객체
   * @returns {boolean} - 대상 이모지 여부
   */
  isTargetEmoji(reaction) {
    // 커스텀 이모지인 경우 ID로 확인
    if (reaction.emoji.id) {
      return reaction.emoji.id === this.targetEmojiId;
    }
    
    // 유니코드 이모지인 경우 이름으로 확인 (필요시)
    return false;
  }

  /**
   * 포럼 스레드인지 확인
   * @param {Channel} channel - 채널 객체
   * @returns {boolean} - 포럼 스레드 여부
   */
  isForumThread(channel) {
    return channel && channel.isThread() && channel.parent && channel.parent.type === 15; // GuildForum
  }

  /**
   * 해당 이모지에 반응한 참가자들 가져오기
   * @param {MessageReaction} reaction - 반응 객체
   * @returns {Promise<Array<string>>} - 참가자 닉네임 배열
   */
  async getReactionParticipants(reaction) {
    try {
      // 반응이 부분적으로 로드된 경우 완전히 가져오기
      if (reaction.partial) {
        await reaction.fetch();
      }

      // 반응한 사용자들 가져오기
      const users = await reaction.users.fetch();
      
      // 봇 제외하고 사용자들만 필터링
      const realUsers = users.filter(user => !user.bot);

      // 길드 멤버 정보를 가져와서 닉네임 추출
      const guild = reaction.message.guild;
      const participants = [];

      for (const user of realUsers.values()) {
        try {
          const member = await guild.members.fetch(user.id).catch(err => {
            // 일반적인 상황이므로 debug 레벨로 낮춤 (사용자가 서버를 나간 경우 등)
            console.debug(`[EmojiReactionService] 멤버 정보 조회 불가: ${user.username} (${user.id}) - ${err.message}`);
            return null;
          });
          
          if (member) {
            // 서버 닉네임이 있으면 사용, 없으면 전역 닉네임 사용
            const displayName = member.displayName || user.displayName || user.username;
            // 닉네임 정리 (태그 제거)
            const cleanedName = TextProcessor.cleanNickname(displayName);
            participants.push(cleanedName);
          } else {
            // 멤버를 가져오지 못한 경우 전역 닉네임 사용
            const cleanedName = TextProcessor.cleanNickname(user.displayName || user.username);
            participants.push(cleanedName);
          }
        } catch (error) {
          // 예외 상황에 대한 최종 fallback
          console.warn(`[EmojiReactionService] 사용자 처리 중 예외 발생: ${user.username}`, error.message);
          const cleanedName = TextProcessor.cleanNickname(user.displayName || user.username);
          participants.push(cleanedName);
        }
      }

      return participants;

    } catch (error) {
      console.error('[EmojiReactionService] 참가자 목록 가져오기 오류:', error);
      return [];
    }
  }

  /**
   * 포럼 포스트가 버튼 기반 참가 시스템을 사용하는지 확인
   * @param {string} threadId - 포럼 스레드 ID
   * @returns {Promise<boolean>}
   */
  async checkForParticipationButton(threadId) {
    try {
      // 캐시 확인
      if (this.buttonBasedPosts.has(threadId)) {
        return this.buttonBasedPosts.get(threadId);
      }

      // 스레드 가져오기
      const thread = await this.client.channels.fetch(threadId);
      if (!thread) return false;

      // 첫 메시지 확인
      const starterMessage = await thread.fetchStarterMessage();
      if (!starterMessage?.components) return false;

      // 참가 버튼 존재 여부 확인 (FORUM_PARTICIPATE, FORUM_JOIN, FORUM_LEAVE)
      const hasButton = starterMessage.components.some(row =>
        row.components.some(component =>
          component.customId?.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_PARTICIPATE) ||
          component.customId?.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_JOIN) ||
          component.customId?.startsWith(DiscordConstants.CUSTOM_ID_PREFIXES.FORUM_LEAVE)
        )
      );

      // 캐시에 저장
      this.buttonBasedPosts.set(threadId, hasButton);
      return hasButton;

    } catch (error) {
      console.error('[EmojiReactionService] 버튼 확인 중 오류:', error);
      return false; // 오류 시 이모지 방식으로 폴백
    }
  }

  /**
   * 재시도 로직을 포함한 참가자 목록 가져오기
   * @param {MessageReaction} reaction - 반응 객체
   * @returns {Promise<Array<string>|null>} - 참가자 닉네임 배열 또는 null (실패 시)
   */
  async getReactionParticipantsWithRetry(reaction, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const participants = await this.getReactionParticipants(reaction);
        console.log(`[EmojiReactionService] 참가자 목록 가져오기 성공 (시도 ${attempt}/${maxRetries}): ${participants.length}명`);
        return participants;
      } catch (error) {
        console.warn(`[EmojiReactionService] 참가자 목록 가져오기 실패 (시도 ${attempt}/${maxRetries}):`, error.message);
        
        if (attempt === maxRetries) {
          console.error(`[EmojiReactionService] 모든 재시도 실패 (${maxRetries}회 시도)`, error);
          return null;
        }
        
        // 지수 백오프: 1초, 2초, 4초
        const delay = Math.pow(2, attempt - 1) * 1000;
        console.log(`[EmojiReactionService] ${delay}ms 후 재시도...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    return null;
  }

  /**
   * 반응과 메시지가 완전히 로드되었는지 확인하고 필요시 fetch
   * @param {MessageReaction} reaction - 반응 객체
   * @returns {Promise<MessageReaction|null>} - 완전히 로드된 반응 객체 또는 null
   */
  async ensureFullReaction(reaction) {
    try {
      // 반응이 부분적으로 로드된 경우 완전히 fetch
      if (reaction.partial) {
        console.log('[EmojiReactionService] 부분 로드된 반응을 완전히 로드 중...');
        await reaction.fetch();
      }

      // 메시지가 부분적으로 로드된 경우 완전히 fetch
      if (reaction.message.partial) {
        console.log('[EmojiReactionService] 부분 로드된 메시지를 완전히 로드 중...');
        await reaction.message.fetch();
      }

      // 채널 정보도 확인
      if (!reaction.message.channel) {
        console.warn('[EmojiReactionService] 메시지에 채널 정보가 없음');
        return null;
      }

      return reaction;
    } catch (error) {
      console.error('[EmojiReactionService] 반응/메시지 완전 로드 실패:', error);
      return null;
    }
  }


  /**
   * 특정 포스트의 특정 메시지에서 이모지 반응 참가자 가져오기
   * @param {string} channelId - 채널 ID
   * @param {string} messageId - 메시지 ID
   * @returns {Promise<Array<string>|null>} - 참가자 닉네임 배열 또는 null
   */
  async getParticipantsFromMessage(channelId, messageId) {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !this.isForumThread(channel)) {
        console.warn(`[EmojiReactionService] 유효하지 않은 포럼 스레드: ${channelId}`);
        return null;
      }

      const message = await channel.messages.fetch(messageId);
      if (!message) {
        console.warn(`[EmojiReactionService] 메시지를 찾을 수 없음: ${messageId}`);
        return null;
      }

      // 해당 이모지 반응 찾기
      const targetReaction = message.reactions.cache.find(reaction => 
        this.isTargetEmoji(reaction)
      );

      if (!targetReaction) {
        console.log(`[EmojiReactionService] 대상 이모지 반응이 없음: ${messageId}`);
        return [];
      }

      return await this.getReactionParticipants(targetReaction);

    } catch (error) {
      console.error('[EmojiReactionService] 메시지에서 참가자 가져오기 오류:', error);
      return null;
    }
  }

  /**
   * 참가자 목록의 변화를 감지합니다.
   * @param {string} channelId - 채널 ID
   * @param {Array<string>} currentParticipants - 현재 참가자 목록
   * @returns {Object} - {joined: string[], left: string[]} 변화 정보
   */
  detectParticipantChanges(channelId, currentParticipants) {
    const previousParticipants = this.previousParticipants.get(channelId) || [];
    
    // 새로 참가한 사용자들 (이전에 없었는데 현재에 있는)
    const joinedUsers = currentParticipants.filter(user => !previousParticipants.includes(user));
    
    // 참가 취소한 사용자들 (이전에 있었는데 현재에 없는)
    const leftUsers = previousParticipants.filter(user => !currentParticipants.includes(user));
    
    return { joined: joinedUsers, left: leftUsers };
  }

  /**
   * 참가자 목록을 캐시에 저장합니다.
   * @param {string} channelId - 채널 ID
   * @param {Array<string>} participants - 참가자 목록
   */
  updateParticipantCache(channelId, participants) {
    this.previousParticipants.set(channelId, [...participants]);
  }

  /**
   * 참가자 변화를 처리하고 알림 메시지를 전송합니다.
   * @param {string} channelId - 채널 ID
   * @param {Array<string>} participants - 현재 참가자 목록
   * @returns {Promise<void>}
   */
  async handleParticipantChanges(channelId, participants) {
    try {
      // 변화 감지
      const changes = this.detectParticipantChanges(channelId, participants);

      // 변화가 있을 때만 알림 메시지 전송 및 데이터베이스 동기화
      if (changes.joined.length > 0 || changes.left.length > 0) {
        console.log(`[EmojiReactionService] 참가자 변화 감지 - 참가: ${changes.joined.length}명, 참가 취소: ${changes.left.length}명`);

        // 데이터베이스 동기화
        const databaseManager = this.forumPostManager.databaseManager;
        if (databaseManager) {
          // 참가한 사용자 추가
          for (const nickname of changes.joined) {
            try {
              // 닉네임으로 유저 ID를 찾아야 함 - 포럼 스레드에서 멤버 검색
              const channel = await this.client.channels.fetch(channelId);
              if (channel && channel.isThread()) {
                const guild = channel.guild;
                const members = await guild.members.fetch();
                const member = members.find(m => {
                  const cleanedName = TextProcessor.cleanNickname(m.displayName);
                  return cleanedName === nickname;
                });

                if (member) {
                  await databaseManager.addParticipant(channelId, member.id, nickname);
                  console.log(`[EmojiReactionService] DB에 참가자 추가: ${nickname} (${member.id})`);
                }
              }
            } catch (error) {
              console.error(`[EmojiReactionService] DB 참가자 추가 실패 (${nickname}):`, error.message);
            }
          }

          // 참가 취소한 사용자 제거
          for (const nickname of changes.left) {
            try {
              // 닉네임으로 유저 ID를 찾아야 함
              const channel = await this.client.channels.fetch(channelId);
              if (channel && channel.isThread()) {
                const guild = channel.guild;
                const members = await guild.members.fetch();
                const member = members.find(m => {
                  const cleanedName = TextProcessor.cleanNickname(m.displayName);
                  return cleanedName === nickname;
                });

                if (member) {
                  await databaseManager.removeParticipant(channelId, member.id);
                  console.log(`[EmojiReactionService] DB에서 참가자 제거: ${nickname} (${member.id})`);
                }
              }
            } catch (error) {
              console.error(`[EmojiReactionService] DB 참가자 제거 실패 (${nickname}):`, error.message);
            }
          }
        }

        // 변화 알림 메시지 전송
        await this.forumPostManager.sendParticipantChangeNotification(
          channelId,
          changes.joined,
          changes.left
        );
      }

      // 캐시 업데이트
      this.updateParticipantCache(channelId, participants);

    } catch (error) {
      console.error('[EmojiReactionService] 참가자 변화 처리 오류:', error);
    }
  }

  /**
   * 포럼 채널에서 기존 참가자 정보를 추출합니다.
   * @param {Channel} channel - 포럼 스레드 채널
   * @returns {Promise<Array<string>>} - 참가자 닉네임 배열
   */
  async findExistingParticipants(channel) {
    try {
      console.log(`[EmojiReactionService] ${channel.id} 포럼의 기존 참가자 정보 추출 중...`);
      
      // 스레드의 메시지들 조회 (최근 100개)
      const messages = await channel.messages.fetch({ limit: 100 });
      const participants = new Set();

      // 각 메시지의 이모지 반응 확인
      for (const message of messages.values()) {
        for (const reaction of message.reactions.cache.values()) {
          // 대상 이모지인지 확인
          if (this.isTargetEmoji(reaction)) {
            console.log(`[EmojiReactionService] 메시지 ${message.id}에서 대상 이모지 발견`);
            
            try {
              // 반응한 사용자들 가져오기
              const users = await reaction.users.fetch();
              
              for (const user of users.values()) {
                if (!user.bot) { // 봇은 제외
                  try {
                    const member = await channel.guild.members.fetch(user.id);
                    if (member) {
                      const displayName = member.displayName || member.user.username;
                      // 닉네임 정리 (태그 제거)
                      const cleanedName = TextProcessor.cleanNickname(displayName);
                      participants.add(cleanedName);
                    }
                  } catch (memberError) {
                    // 멤버를 가져오지 못한 경우 전역 닉네임 사용
                    const cleanedName = TextProcessor.cleanNickname(user.displayName || user.username);
                    participants.add(cleanedName);
                  }
                }
              }
            } catch (reactionError) {
              console.warn(`[EmojiReactionService] 반응 처리 실패:`, reactionError.message);
            }
          }
        }
      }

      const participantArray = Array.from(participants);
      console.log(`[EmojiReactionService] ${channel.id} 포럼에서 ${participantArray.length}명의 기존 참가자 발견:`, participantArray);
      
      return participantArray;
      
    } catch (error) {
      console.error(`[EmojiReactionService] ${channel.id} 포럼의 기존 참가자 정보 추출 실패:`, error);
      return [];
    }
  }
}