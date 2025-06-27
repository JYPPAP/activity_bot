// src/ui/RecruitmentUIBuilder.js - 구인구직 UI 빌더
import { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder 
} from 'discord.js';
import { RecruitmentConfig } from '../config/RecruitmentConfig.js';
import { DiscordConstants } from '../config/DiscordConstants.js';

export class RecruitmentUIBuilder {
  /**
   * 구인구직 연동 초기 임베드 생성
   * @param {string} voiceChannelName - 음성 채널 이름
   * @returns {EmbedBuilder} - 생성된 임베드
   */
  static createInitialEmbed(voiceChannelName) {
    return new EmbedBuilder()
      .setTitle('🎮 구인구직 포럼 연동')
      .setDescription(
        `음성 채널 **${voiceChannelName}**에서 구인구직을 시작하세요!\n\n` +
        '• 👁️ **관전**: 별명에 [관전] 태그 추가'
      )
      .setColor(RecruitmentConfig.COLORS.INFO)
      .setFooter({ text: '아래 버튼을 클릭하여 원하는 작업을 선택하세요.' });
  }
  
  /**
   * 구인구직 연동 버튼들 생성
   * @param {string} voiceChannelId - 음성 채널 ID
   * @returns {Array<ActionRowBuilder>} - 액션 로우 배열
   */
  static createInitialButtons(voiceChannelId) {
    const connectButton = new ButtonBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_CONNECT}${voiceChannelId}`)
      .setLabel('🎯 연동하기')
      .setStyle(ButtonStyle.Primary);
    
    const spectateButton = new ButtonBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.VOICE_SPECTATE}${voiceChannelId}`)
      .setLabel('👁️ 관전')
      .setStyle(ButtonStyle.Secondary);
    
    return [
      new ActionRowBuilder().addComponents(connectButton, spectateButton)
    ];
  }
  
  /**
   * 연동 방법 선택 임베드 생성
   * @param {string} voiceChannelName - 음성 채널 이름
   * @returns {EmbedBuilder} - 생성된 임베드
   */
  static createMethodSelectionEmbed(voiceChannelName) {
    return new EmbedBuilder()
      .setTitle('🎮 구인구직 포럼 연동')
      .setDescription(
        `음성 채널 **${voiceChannelName}**에서 구인구직을 시작하세요!\n\n` +
        '📌 **연동 방법**\n' +
        '• 🆕 **새 포럼 생성**: 새로운 구인구직 포럼을 만들어 연동\n' +
        '• 🔗 **기존 포럼 선택**: 이미 생성된 구인구직에 음성 채널 연결\n\n' +
        '💡 아래 드롭다운에서 원하는 방법을 선택하세요.'
      )
      .setColor(RecruitmentConfig.COLORS.INFO)
      .setFooter({ text: '연동 방법을 선택한 후 다음 단계로 진행됩니다.' });
  }
  
  /**
   * 연동 방법 선택 드롭다운 생성
   * @param {string} voiceChannelId - 음성 채널 ID
   * @param {Array} existingPosts - 기존 포스트 목록
   * @returns {ActionRowBuilder} - 드롭다운이 포함된 액션 로우
   */
  static createMethodSelectMenu(voiceChannelId, existingPosts = []) {
    const options = [
      {
        label: '🆕 새 구인구직 포럼 생성하기',
        description: '새로운 구인구직 포럼을 만들어 음성 채널과 연동',
        value: DiscordConstants.METHOD_VALUES.NEW_FORUM,
        emoji: '🆕'
      }
    ];
    
    // 기존 포스트가 있으면 선택 옵션 추가
    existingPosts.forEach((post, index) => {
      if (index < 8) { // 최대 8개까지만 (새 포럼 생성 + 7개 기존 포스트)
        options.push({
          label: `🔗 ${post.name}`,
          description: `기존 구인구직에 연동 (멤버: ${post.memberCount}명)`,
          value: `${DiscordConstants.METHOD_VALUES.EXISTING_FORUM_PREFIX}${post.id}`,
          emoji: '🔗'
        });
      }
    });
    
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`${DiscordConstants.CUSTOM_ID_PREFIXES.RECRUITMENT_METHOD}${voiceChannelId}`)
      .setPlaceholder('연동 방법을 선택하세요')
      .addOptions(options);
    
    return new ActionRowBuilder().addComponents(selectMenu);
  }
  
  /**
   * 역할 태그 선택 임베드 생성
   * @param {Array} selectedTags - 선택된 태그 목록
   * @param {boolean} isStandalone - 독립 모드 여부
   * @returns {EmbedBuilder} - 생성된 임베드
   */
  static createRoleTagSelectionEmbed(selectedTags = [], isStandalone = false) {
    const selectedTagsText = selectedTags.length > 0 ? selectedTags.join(', ') : '없음';
    const modeText = isStandalone ? '독립 구인구직' : '음성 채널 연동';
    
    return new EmbedBuilder()
      .setTitle('🏷️ 역할 태그 선택')
      .setDescription(
        `**${modeText}**을 위한 역할 태그를 선택하세요.\n\n` +
        `선택된 태그: **${selectedTagsText}**\n\n` +
        `💡 최대 ${RecruitmentConfig.MAX_SELECTED_TAGS}개까지 선택할 수 있습니다.\n` +
        '✅ 선택이 완료되면 "선택 완료" 버튼을 클릭하세요.'
      )
      .setColor(RecruitmentConfig.COLORS.INFO);
  }
  
  /**
   * 역할 태그 버튼 그리드 생성
   * @param {Array} selectedTags - 선택된 태그 목록
   * @param {string} voiceChannelId - 음성 채널 ID (선택사항)
   * @param {string} methodValue - 메서드 값 (선택사항)
   * @param {boolean} isStandalone - 독립 모드 여부
   * @returns {Array<ActionRowBuilder>} - 버튼 그리드 액션 로우 배열
   */
  static createRoleTagButtons(selectedTags = [], voiceChannelId = null, methodValue = null, isStandalone = false) {
    const components = [];
    
    // 4행 4열 버튼 그리드 생성 (15개 태그만 표시)
    for (let row = 0; row < RecruitmentConfig.BUTTON_GRID_ROWS; row++) {
      const actionRow = new ActionRowBuilder();
      let hasButtons = false;
      
      for (let col = 0; col < RecruitmentConfig.BUTTON_GRID_COLS; col++) {
        const tagIndex = row * RecruitmentConfig.BUTTON_GRID_COLS + col;
        const tag = RecruitmentConfig.ROLE_TAG_VALUES[tagIndex];
        
        // 태그가 존재할 때만 버튼 생성
        if (tag) {
          const isSelected = selectedTags.includes(tag);
          
          let buttonCustomId;
          if (isStandalone) {
            buttonCustomId = `${DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_BUTTON}${tag}`;
          } else {
            buttonCustomId = `${DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_BUTTON}${tag}_${voiceChannelId}_${methodValue}`;
          }
          
          const button = new ButtonBuilder()
            .setCustomId(buttonCustomId)
            .setLabel(tag)
            .setStyle(isSelected ? ButtonStyle.Primary : ButtonStyle.Secondary);
          
          actionRow.addComponents(button);
          hasButtons = true;
        }
      }
      
      // 버튼이 있는 행만 추가
      if (hasButtons) {
        components.push(actionRow);
      }
    }
    
    // 완료 버튼 추가
    let completeCustomId;
    if (isStandalone) {
      completeCustomId = DiscordConstants.CUSTOM_ID_PREFIXES.STANDALONE_ROLE_COMPLETE;
    } else {
      completeCustomId = `${DiscordConstants.CUSTOM_ID_PREFIXES.ROLE_COMPLETE}${voiceChannelId}_${methodValue}`;
    }
    
    const completeButton = new ButtonBuilder()
      .setCustomId(completeCustomId)
      .setLabel('선택 완료')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✅')
      .setDisabled(selectedTags.length === 0);
    
    const completeRow = new ActionRowBuilder().addComponents(completeButton);
    components.push(completeRow);
    
    return components;
  }
  
  /**
   * 독립 구인구직 생성 임베드
   * @returns {EmbedBuilder} - 생성된 임베드
   */
  static createStandaloneRecruitmentEmbed() {
    return new EmbedBuilder()
      .setTitle('🎮 구인구직 포럼 생성')
      .setDescription(
        '새로운 구인구직 포럼을 생성합니다.\n\n' +
        '📌 **단계**\n' +
        '1. 🏷️ **역할 태그 선택** (현재 단계)\n' +
        '2. 📝 **구인구직 정보 입력**\n' +
        '3. 🎯 **포럼 포스트 생성**\n\n' +
        '💡 역할 태그를 선택하면 해당 역할의 멤버들이 알림을 받습니다.'
      )
      .setColor(RecruitmentConfig.COLORS.INFO)
      .setFooter({ text: '(장기 컨텐츠는 연동X)' });
  }
  
  /**
   * 성공 메시지 임베드 생성
   * @param {string} title - 제목
   * @param {string} description - 설명
   * @param {Object} fields - 추가 필드 (선택사항)
   * @returns {EmbedBuilder} - 생성된 임베드
   */
  static createSuccessEmbed(title, description, fields = []) {
    const embed = new EmbedBuilder()
      .setTitle(`✅ ${title}`)
      .setDescription(description)
      .setColor(RecruitmentConfig.COLORS.SUCCESS)
      .setTimestamp();
    
    if (fields.length > 0) {
      embed.addFields(fields);
    }
    
    return embed;
  }
  
  /**
   * 에러 메시지 임베드 생성
   * @param {string} title - 제목
   * @param {string} description - 설명
   * @returns {EmbedBuilder} - 생성된 임베드
   */
  static createErrorEmbed(title, description) {
    return new EmbedBuilder()
      .setTitle(`❌ ${title}`)
      .setDescription(description)
      .setColor(RecruitmentConfig.COLORS.ERROR)
      .setTimestamp();
  }
  
  /**
   * 경고 메시지 임베드 생성
   * @param {string} title - 제목
   * @param {string} description - 설명
   * @returns {EmbedBuilder} - 생성된 임베드
   */
  static createWarningEmbed(title, description) {
    return new EmbedBuilder()
      .setTitle(`⚠️ ${title}`)
      .setDescription(description)
      .setColor(RecruitmentConfig.COLORS.WARNING)
      .setTimestamp();
  }
  
  /**
   * 참여자 정보 임베드 생성
   * @param {string} voiceChannelName - 음성 채널 이름
   * @param {Object} participantStats - 참여자 통계
   * @returns {EmbedBuilder} - 생성된 임베드
   */
  static createParticipantInfoEmbed(voiceChannelName, participantStats) {
    return new EmbedBuilder()
      .setTitle(`👥 ${voiceChannelName} 참여자 현황`)
      .setDescription(
        `**전체 참여자**: ${participantStats.total}명\n` +
        `**활성 참여자**: ${participantStats.active}명\n` +
        `**대기 중**: ${participantStats.waiting}명\n` +
        `**관전 중**: ${participantStats.spectating}명`
      )
      .setColor(RecruitmentConfig.COLORS.INFO)
      .setTimestamp();
  }
}