// src/utils/channelSelectMenu.js - 음성 채널 연동 SelectMenu 유틸리티
import { 
  StringSelectMenuBuilder, 
  StringSelectMenuOptionBuilder, 
  ActionRowBuilder, 
  EmbedBuilder 
} from 'discord.js';

/**
 * 음성 채널 연동용 SelectMenu 생성 유틸리티
 */
export class ChannelSelectMenuFactory {
  /**
   * 구인구직 카드 선택 메뉴를 생성합니다.
   * @param {string} channelId - 음성채널 ID
   * @param {string} channelName - 음성채널 이름
   * @param {Array} availableJobPosts - 연동 가능한 구인구직 카드 목록
   * @returns {Object} - { embed, actionRow }
   */
  static createJobPostSelectionMenu(channelId, channelName, availableJobPosts = []) {
    // 임베드 생성
    const embed = new EmbedBuilder()
      .setColor('#FFD700') // 골드 색상
      .setTitle('🎙️ 음성채널 구인구직 연동')
      .setDescription(
        `**${channelName}** 채널이 생성되었습니다!\n\n` +
        '이 채널을 기존 구인구직 카드와 연동하거나 새로운 카드를 만들어보세요.\n' +
        '연동하면 해당 구인구직 카드에 입장/관전 버튼이 추가됩니다.'
      )
      .addFields(
        {
          name: '📋 선택 옵션',
          value: '• **기존 카드 연동**: 이미 생성된 구인구직 카드와 연동\n' +
                 '• **새로 만들기**: 이 채널명으로 새 구인구직 카드 생성\n' +
                 '• **나중에 하기**: 지금은 연동하지 않음',
          inline: false
        }
      )
      .setFooter({
        text: '🔄 30초 후 자동으로 사라집니다'
      })
      .setTimestamp();

    // SelectMenu 옵션 구성
    const options = [];

    // 연동 가능한 기존 카드들 (채널 ID가 없는 카드들)
    if (availableJobPosts.length > 0) {
      // 최대 23개까지만 표시 (새로 만들기, 나중에 하기 포함해서 25개 제한)
      const limitedJobs = availableJobPosts.slice(0, 23);
      
      limitedJobs.forEach(job => {
        const description = [
          `👥 ${job.memberCount}명`,
          `⏰ ${job.startTime}`,
          job.roleTags ? `🏷️ ${job.roleTags}` : null
        ].filter(Boolean).join(' | ');

        options.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(job.title.length > 100 ? `${job.title.substring(0, 97)}...` : job.title)
            .setDescription(description.length > 100 ? `${description.substring(0, 97)}...` : description)
            .setValue(`link_existing_${job.id}`)
            .setEmoji('🔗')
        );
      });
    }

    // "새로 만들기" 옵션
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel('새 구인구직 카드 만들기')
        .setDescription(`"${channelName}" 제목으로 새 카드 생성`)
        .setValue(`create_new_${channelId}`)
        .setEmoji('✨')
    );

    // "나중에 하기" 옵션
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel('나중에 하기')
        .setDescription('지금은 구인구직 카드와 연동하지 않습니다')
        .setValue('skip')
        .setEmoji('⏭️')
    );

    // SelectMenu 생성
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`jobpost_channel_link_${channelId}`)
      .setPlaceholder('구인구직 카드를 선택하세요...')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options);

    const actionRow = new ActionRowBuilder().addComponents(selectMenu);

    return { embed, actionRow };
  }

  /**
   * SelectMenu customId를 파싱합니다.
   * @param {string} customId - 커스텀 ID
   * @returns {Object} - { type, channelId, action, targetId }
   */
  static parseSelectMenuCustomId(customId) {
    const parts = customId.split('_');
    
    if (parts[0] === 'jobpost' && parts[1] === 'channel' && parts[2] === 'link') {
      return {
        type: 'channel_link',
        channelId: parts[3],
        action: null,
        targetId: null
      };
    }
    
    return null;
  }

  /**
   * SelectMenu 선택값을 파싱합니다.
   * @param {string} value - 선택된 값
   * @returns {Object} - { action, targetId }
   */
  static parseSelectMenuValue(value) {
    if (value === 'skip') {
      return { action: 'skip', targetId: null };
    }
    
    if (value.startsWith('link_existing_')) {
      return { 
        action: 'link_existing', 
        targetId: value.replace('link_existing_', '') 
      };
    }
    
    if (value.startsWith('create_new_')) {
      return { 
        action: 'create_new', 
        targetId: value.replace('create_new_', '') 
      };
    }
    
    return { action: 'unknown', targetId: null };
  }

  /**
   * SelectMenu 성공 응답 임베드를 생성합니다.
   * @param {string} action - 수행된 액션
   * @param {Object} result - 결과 데이터
   * @returns {EmbedBuilder} - 성공 임베드
   */
  static createSuccessEmbed(action, result) {
    const embed = new EmbedBuilder()
      .setColor('#00FF00') // 초록색
      .setTimestamp();

    switch (action) {
      case 'link_existing':
        embed
          .setTitle('🔗 채널 연동 완료')
          .setDescription(
            `**${result.channelName}** 채널이 기존 구인구직 카드와 연동되었습니다!`
          )
          .addFields(
            {
              name: '📌 연동된 카드',
              value: `**${result.jobPost.title}**\n👥 ${result.jobPost.memberCount}명 | ⏰ ${result.jobPost.startTime}`,
              inline: false
            }
          );
        break;

      case 'create_new':
        embed
          .setTitle('✨ 새 카드 생성 완료')
          .setDescription(
            `**${result.channelName}** 채널과 함께 새 구인구직 카드가 생성되었습니다!`
          )
          .addFields(
            {
              name: '📌 생성된 카드',
              value: `**${result.jobPost.title}**\n👥 ${result.jobPost.memberCount}명 | ⏰ ${result.jobPost.startTime}`,
              inline: false
            }
          );
        break;

      case 'skip':
        embed
          .setTitle('⏭️ 연동 건너뛰기')
          .setDescription('구인구직 카드 연동을 건너뛰었습니다.\n나중에 `/job_post` 명령어로 연동할 수 있습니다.');
        break;

      default:
        embed
          .setTitle('✅ 처리 완료')
          .setDescription('요청이 처리되었습니다.');
    }

    return embed;
  }

  /**
   * SelectMenu 오류 응답 임베드를 생성합니다.
   * @param {string} error - 오류 메시지
   * @returns {EmbedBuilder} - 오류 임베드
   */
  static createErrorEmbed(error) {
    return new EmbedBuilder()
      .setColor('#FF0000') // 빨간색
      .setTitle('❌ 오류 발생')
      .setDescription(error)
      .setTimestamp();
  }

  /**
   * 타임아웃된 SelectMenu 임베드를 생성합니다.
   * @returns {EmbedBuilder} - 타임아웃 임베드
   */
  static createTimeoutEmbed() {
    return new EmbedBuilder()
      .setColor('#808080') // 회색
      .setTitle('⏰ 시간 초과')
      .setDescription('구인구직 카드 연동 시간이 초과되었습니다.\n`/job_post` 명령어로 나중에 연동할 수 있습니다.')
      .setTimestamp();
  }
}