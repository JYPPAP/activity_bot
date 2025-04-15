// src/commands/gapListCommand.js - gap_list 명령어 (잠수 기능 추가)
import { MessageFlags, EmbedBuilder } from 'discord.js';
import { EmbedFactory } from '../utils/embedBuilder.js';
import { cleanRoleName, formatTime } from '../utils/formatters.js';
import { COLORS } from '../config/constants.js';

export class GapListCommand {
  constructor(activityTracker, dbManager) {
    this.activityTracker = activityTracker;
    this.db = dbManager;
  }

  /**
   * gap_list 명령어를 실행합니다.
   * @param {Interaction} interaction - 상호작용 객체
   */
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // 역할 옵션 가져오기
      const roleOption = interaction.options.getString("role");
      const roles = roleOption.split(',').map(r => cleanRoleName(r.trim()));
      const guild = interaction.guild;

      // 활동 데이터 초기화
      await this.activityTracker.initializeActivityData(guild);

      // 역할 멤버 가져오기
      const members = await guild.members.fetch();
      const roleMembers = members.filter(member =>
          member.roles.cache.some(r => roles.includes(r.name))
      );

      // 현재 활동 데이터 저장
      await this.activityTracker.saveActivityData();

      // 최신 데이터로 활성/비활성/잠수 사용자 분류
      const { activeUsers, inactiveUsers, afkUsers, resetTime, minHours } =
          await this.classifyUsers(roles[0], roleMembers);

      // 임베드 전송
      await this.sendActivityEmbed(interaction, activeUsers, inactiveUsers, afkUsers, roles[0], resetTime, minHours);

    } catch (error) {
      console.error('gap_list 명령어 실행 오류:', error);
      await interaction.followUp({
        content: '데이터 처리 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * 사용자를 활성/비활성/잠수로 분류합니다.
   * @param {string} role - 역할 이름
   * @param {Collection<string, GuildMember>} roleMembers - 역할 멤버 컬렉션
   * @returns {Object} - 분류된 사용자 목록과 설정 정보
   */
  async classifyUsers(role, roleMembers) {
    // 역할 설정 가져오기
    const roleConfig = await this.db.getRoleConfig(role);

    // 역할에 필요한 최소 활동 시간(밀리초)
    const minActivityHours = roleConfig ? roleConfig.minHours : 0;
    const minActivityTime = minActivityHours * 60 * 60 * 1000;

    // 리셋 시간 가져오기
    const resetTime = roleConfig ? roleConfig.resetTime : null;

    const activeUsers = [];
    const inactiveUsers = [];
    const afkUsers = []; // 잠수 멤버용 배열

    // 각 멤버 분류
    for (const [userId, member] of roleMembers.entries()) {
      // 사용자 활동 데이터 조회
      const userActivity = await this.db.getUserActivity(userId);
      const afkStatus = await this.db.getUserAfkStatus(userId);

      const userData = {
        userId,
        nickname: member.displayName,
        totalTime: userActivity ? userActivity.totalTime : 0
      };

      // 1. 잠수 상태 확인
      if (afkStatus) {
        // 잠수 기한이 만료되었는지 확인
        const now = Date.now();
        if (afkStatus.afkUntil > now) {
          userData.afkUntil = afkStatus.afkUntil;
          afkUsers.push(userData);
          continue; // 다음 사용자로 넘어감
        } else {
          // 만료된 경우 상태 해제
          await this.db.clearUserAfkStatus(userId);

          // 잠수 역할도 제거
          const afkRole = member.guild.roles.cache.find(role => role.name === "잠수");
          if (afkRole && member.roles.cache.has(afkRole.id)) {
            await member.roles.remove(afkRole);
          }
        }
      }

      // 2. 활동 시간 기준으로 분류
      if (userData.totalTime >= minActivityTime) {
        activeUsers.push(userData);
      } else {
        inactiveUsers.push(userData);
      }
    }

    // 활동 시간 기준으로 정렬
    activeUsers.sort((a, b) => b.totalTime - a.totalTime);
    inactiveUsers.sort((a, b) => b.totalTime - a.totalTime);
    afkUsers.sort((a, b) => b.totalTime - a.totalTime);

    return {
      activeUsers,
      inactiveUsers,
      afkUsers,
      resetTime,
      minHours: minActivityHours
    };
  }

  /**
   * 활동 데이터 임베드를 전송합니다.
   * @param {Interaction} interaction - 상호작용 객체
   * @param {Array<Object>} activeUsers - 활성 사용자 목록
   * @param {Array<Object>} inactiveUsers - 비활성 사용자 목록
   * @param {Array<Object>} afkUsers - 잠수 사용자 목록
   * @param {string} role - 역할 이름
   * @param {number} resetTime - 마지막 리셋 시간
   * @param {number} minHours - 최소 활동 시간(시)
   */
  async sendActivityEmbed(interaction, activeUsers, inactiveUsers, afkUsers, role, resetTime, minHours) {
    // 날짜 범위 설정 (시작일: 리셋 시간, 종료일: 현재)
    const now = new Date();
    const startDate = resetTime ? new Date(resetTime) : now;

    // 날짜 형식을 YYYY.MM.DD 형태로 포맷팅
    const formatSimpleDate = (date) => {
      return `${date.getFullYear()}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getDate().toString().padStart(2, '0')}`;
    };

    const startDateStr = formatSimpleDate(startDate);
    const endDateStr = formatSimpleDate(now);

    // 활성 사용자 임베드
    const activeEmbed = new EmbedBuilder()
        .setColor(COLORS.ACTIVE)
        .setTitle(`📊 ${cleanRoleName(role)} 역할 활동 목록 (${startDateStr} ~ ${endDateStr})`)
        .setDescription(`최소 활동 시간: ${minHours}시간`);

    activeEmbed.addFields(
        { name: `✅ 활동 기준 달성 멤버 (${activeUsers.length}명)`, value: '\u200B' }
    );

    if (activeUsers.length > 0) {
      activeEmbed.addFields(
          { name: '이름', value: activeUsers.map(user => user.nickname).join('\n'), inline: true },
          { name: '총 활동 시간', value: activeUsers.map(user => formatTime(user.totalTime)).join('\n'), inline: true }
      );
    } else {
      activeEmbed.addFields(
          { name: '\u200B', value: '기준 달성 멤버가 없습니다.', inline: false }
      );
    }

    // 비활성 사용자 임베드
    const inactiveEmbed = new EmbedBuilder()
        .setColor(COLORS.INACTIVE)
        .setTitle(`📊 ${cleanRoleName(role)} 역할 활동 목록 (${startDateStr} ~ ${endDateStr})`)
        .setDescription(`최소 활동 시간: ${minHours}시간`);

    inactiveEmbed.addFields(
        { name: `❌ 활동 기준 미달성 멤버 (${inactiveUsers.length}명)`, value: '\u200B' }
    );

    if (inactiveUsers.length > 0) {
      inactiveEmbed.addFields(
          { name: '이름', value: inactiveUsers.map(user => user.nickname).join('\n'), inline: true },
          { name: '총 활동 시간', value: inactiveUsers.map(user => formatTime(user.totalTime)).join('\n'), inline: true }
      );
    } else {
      inactiveEmbed.addFields(
          { name: '\u200B', value: '기준 미달성 멤버가 없습니다.', inline: false }
      );
    }

    // 임베드 배열 초기화
    const embeds = [activeEmbed, inactiveEmbed];

    // 잠수 사용자가 있을 경우에만 잠수 임베드 추가
    if (afkUsers.length > 0) {
      // 잠수 사용자 임베드
      const afkEmbed = new EmbedBuilder()
          .setColor('#808080') // 회색으로 설정
          .setTitle(`📊 ${cleanRoleName(role)} 역할 활동 목록 (${startDateStr} ~ ${endDateStr})`)
          .setDescription(`최소 활동 시간: ${minHours}시간`);

      afkEmbed.addFields(
          { name: `💤 잠수 중인 멤버 (${afkUsers.length}명)`, value: '\u200B' }
      );

      if (afkUsers.length > 0) {
        afkEmbed.addFields(
            { name: '이름', value: afkUsers.map(user => user.nickname).join('\n'), inline: true },
            { name: '총 활동 시간', value: afkUsers.map(user => formatTime(user.totalTime)).join('\n'), inline: true },
            {
              name: '잠수 해제 예정일',
              value: afkUsers.map(user => formatSimpleDate(new Date(user.afkUntil))).join('\n'),
              inline: true
            }
        );
      }

      // 잠수 임베드 추가
      embeds.push(afkEmbed);
    }

    try {
      // DM으로 임베드 전송
      for (const embed of embeds) {
        await interaction.user.send({ embeds: [embed] });
      }

      // 명령어 실행한 채널에 알림
      await interaction.followUp({
        content: '📩 활동 데이터 임베드를 DM으로 전송했습니다!',
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('DM 전송 실패:', error);

      // DM 전송 실패 시 채널에서 직접 임베드 제공
      await interaction.followUp({
        content: '📂 DM 전송에 실패했습니다. 여기에서 확인하세요:',
        embeds: embeds,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}