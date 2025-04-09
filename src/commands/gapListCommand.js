// src/commands/gapListCommand.js - gap_list 명령어 (수정)
import { MessageFlags } from 'discord.js';
import { EmbedFactory } from '../utils/embedBuilder.js';
import { cleanRoleName } from '../utils/formatters.js';

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
      const roles = roleOption.split(',').map(r => r.trim());
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

      // 최신 데이터로 활성/비활성 사용자 분류
      const { activeUsers, inactiveUsers, resetTime, minHours } =
          await this.classifyUsers(roles[0], roleMembers);

      // 임베드 전송
      await this.sendActivityEmbed(interaction, activeUsers, inactiveUsers, roles[0], resetTime, minHours);

    } catch (error) {
      console.error('gap_list 명령어 실행 오류:', error);
      await interaction.followUp({
        content: '데이터 처리 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * 사용자를 활성/비활성으로 분류합니다.
   * @param {string} role - 역할 이름
   * @param {Collection<string, GuildMember>} roleMembers - 역할 멤버 컬렉션
   * @returns {Object} - 분류된 사용자 목록과 설정 정보
   */
  async classifyUsers(role, roleMembers) {
    // 활동 데이터와 설정 가져오기
    const activities = await this.db.getAllUserActivity();
    const roleConfig = await this.db.getRoleConfig(role);

    // 활동 데이터를 Map으로 변환
    const activityMap = new Map();
    activities.forEach(activity => {
      activityMap.set(activity.userId, activity);
    });

    // 역할에 필요한 최소 활동 시간(밀리초)
    const minActivityHours = roleConfig ? roleConfig.minHours : 0;
    const minActivityTime = minActivityHours * 60 * 60 * 1000;

    // 리셋 시간 가져오기
    const resetTime = roleConfig ? roleConfig.resetTime : null;

    const activeUsers = [];
    const inactiveUsers = [];
    const afkUsers = []; // 잠수 멤버용 배열 추가

    roleMembers.forEach(member => {
      const userId = member.user.id;
      const activity = activityData.get(userId) || { totalTime: 0 };

      const userData = {
        userId,
        nickname: member.displayName,
        totalTime: activity.totalTime,
        isAfk: member.roles.cache.some(r => r.name.includes('잠수')) // 잠수 역할 확인
      };

      // 잠수 역할이 있는 경우 afkUsers에 추가
      if (userData.isAfk) {
        afkUsers.push(userData);
      }
      // 그 외는 기존 로직대로 분류
      else if (userData.totalTime >= minActivityTime) {
        activeUsers.push(userData);
      } else {
        inactiveUsers.push(userData);
      }
    });

    // 활동 시간 기준으로 정렬
    activeUsers.sort((a, b) => b.totalTime - a.totalTime);
    inactiveUsers.sort((a, b) => b.totalTime - a.totalTime);

    return {
      activeUsers,
      inactiveUsers,
      afkUsers, // 잠수 멤버 목록 추가
      resetTime,
      minHours: minActivityHours
    };
  }

  /**
   * 활동 데이터 임베드를 전송합니다.
   * @param {Interaction} interaction - 상호작용 객체
   * @param {Array<Object>} activeUsers - 활성 사용자 목록
   * @param {Array<Object>} inactiveUsers - 비활성 사용자 목록
   * @param {string} role - 역할 이름
   * @param {number} resetTime - 마지막 리셋 시간
   * @param {number} minHours - 최소 활동 시간(시)
   */
  async sendActivityEmbed(interaction, activeUsers, inactiveUsers, afkUsers, role, resetTime, minHours) {
    // 활성 사용자 임베드 생성
    const activeEmbed = EmbedFactory.createActivityEmbed('active', {
      role: cleanRoleName(role),
      users: activeUsers,
      resetTime,
      minActivityTime: minHours
    });

    // 비활성 사용자 임베드 생성
    const inactiveEmbed = EmbedFactory.createActivityEmbed('inactive', {
      role: cleanRoleName(role),
      users: inactiveUsers,
      resetTime,
      minActivityTime: minHours
    });

    // 잠수 사용자 임베드 생성
    const afkEmbed = new EmbedBuilder()
        .setColor('#808080') // 회색으로 설정
        .setTitle(`💤 잠수 중인 멤버 (${afkUsers.length}명)`)
        .setDescription(`역할: ${cleanRoleName(role)}`)
        .addFields(
            {
              name: '이름',
              value: afkUsers.map(user => user.nickname).join('\n') || '없음',
              inline: true
            },
            {
              name: '총 활동 시간',
              value: afkUsers.map(user => formatTime(user.totalTime)).join('\n') || '없음',
              inline: true
            }
        );

    try {
      // DM으로 임베드 전송
      await interaction.user.send({ embeds: [activeEmbed] });
      await interaction.user.send({ embeds: [inactiveEmbed] });
      if (afkUsers.length > 0) {
        await interaction.user.send({ embeds: [afkEmbed] });
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
        embeds: [activeEmbed, inactiveEmbed],
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}