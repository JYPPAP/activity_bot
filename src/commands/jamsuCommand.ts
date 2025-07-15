// src/commands/jamsuCommand.ts - 잠수 명령어
import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
  User,
  GuildMember,
  Role,
} from 'discord.js';

import { parseYYMMDD, calculateNextSunday, formatKoreanDateString } from '../utils/dateUtils.js';

import {
  CommandBase,
  CommandServices,
  CommandResult,
  CommandExecutionOptions,
  CommandMetadata,
} from './CommandBase.js';

// AFK 설정 결과 인터페이스
interface AfkSetResult {
  user: User;
  member: GuildMember;
  untilDate: Date;
  role: Role;
  formattedDate: string;
  isNewRole: boolean;
}

export class JamsuCommand extends CommandBase {
  public readonly metadata: CommandMetadata = {
    name: '잠수',
    description: '사용자를 잠수 상태로 설정합니다.',
    category: 'administration',
    permissions: ['ManageRoles'],
    cooldown: 5,
    adminOnly: true,
    guildOnly: true,
    usage: '/잠수 user:<사용자> until_date:<날짜>',
    examples: [
      '/잠수 user:@사용자 until_date:250510',
      '/잠수 user:@사용자 until_date:250615 reason:휴가',
    ],
    aliases: ['afk', '잠수'],
  };

  constructor(services: CommandServices) {
    super(services);
  }

  /**
   * 슬래시 명령어 빌더 생성
   */
  buildSlashCommand(): SlashCommandBuilder {
    return new SlashCommandBuilder()
      .setName(this.metadata.name)
      .setDescription(this.metadata.description)
      .addUserOption((option) =>
        option.setName('user').setDescription('잠수 상태로 설정할 사용자').setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName('until_date')
          .setDescription('잠수 해제 날짜 (YYMMDD 형식, 예: 250510)')
          .setRequired(true)
      )
      .addStringOption((option) =>
        option.setName('reason').setDescription('잠수 설정 사유 (선택사항)').setRequired(false)
      )
      .addBooleanOption((option) =>
        option
          .setName('notify_user')
          .setDescription('사용자에게 DM으로 알림 전송 여부')
          .setRequired(false)
      )
      .addIntegerOption((option) =>
        option
          .setName('duration_weeks')
          .setDescription('잠수 기간 (주 단위, 선택사항)')
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(52)
      ) as SlashCommandBuilder;
  }

  /**
   * 잠수 명령어의 실제 실행 로직
   * @param interaction - 상호작용 객체
   * @param options - 실행 옵션
   */
  protected async executeCommand(
    interaction: ChatInputCommandInteraction,
    _options: CommandExecutionOptions
  ): Promise<CommandResult> {
    try {
      // 사용자 옵션 가져오기
      const targetUser = interaction.options.getUser('user');
      const dateStr = interaction.options.getString('until_date');
      const reason = interaction.options.getString('reason');
      const notifyUser = interaction.options.getBoolean('notify_user') || false;
      const durationWeeks = interaction.options.getInteger('duration_weeks');

      if (!targetUser) {
        return {
          success: false,
          message: '사용자를 지정해주세요.',
        };
      }

      if (!dateStr || !/^\d{6}$/.test(dateStr)) {
        return {
          success: false,
          message: '날짜는 YYMMDD 형식으로 입력해주세요. (예: 250510)',
        };
      }

      // 길드 확인
      const guild = interaction.guild;
      if (!guild) {
        return {
          success: false,
          message: '이 명령어는 서버에서만 사용할 수 있습니다.',
        };
      }

      // 자기 자신을 잠수 상태로 설정하려는지 확인
      if (targetUser.id === interaction.user.id) {
        return {
          success: false,
          message: '자기 자신을 잠수 상태로 설정할 수 없습니다.',
        };
      }

      // 캐시 확인
      const cacheKey = `afk_set_${targetUser.id}`;
      const recentSet = this.getCached<number>(cacheKey);

      if (recentSet && Date.now() - recentSet < 60000) {
        // 1분 이내 중복 방지
        return {
          success: false,
          message:
            '같은 사용자에 대해 잠수 설정을 너무 자주 시도하고 있습니다. 잠시 후 다시 시도해주세요.',
        };
      }

      // 날짜 파싱 및 계산
      let untilDate: Date;

      if (durationWeeks) {
        // 주 단위로 계산
        const now = new Date();
        untilDate = new Date(now.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);
        untilDate = calculateNextSunday(untilDate);
      } else {
        // YYMMDD 형식 파싱
        const inputDate = parseYYMMDD(dateStr);
        untilDate = calculateNextSunday(inputDate);
      }

      // 날짜 유효성 검사
      const now = new Date();
      if (untilDate < now) {
        return {
          success: false,
          message: '지정한 날짜가 현재보다 과거입니다. 미래 날짜를 입력해주세요.',
        };
      }

      // 너무 먼 미래인지 확인 (1년 초과)
      const maxDate = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      if (untilDate > maxDate) {
        return {
          success: false,
          message: '잠수 기간이 너무 깁니다. 1년 이내로 설정해주세요.',
        };
      }

      // 멤버 가져오기
      const member = await guild.members.fetch(targetUser.id).catch(() => null);
      if (!member) {
        return {
          success: false,
          message: '해당 사용자를 서버에서 찾을 수 없습니다.',
        };
      }

      // 봇이나 관리자 권한 확인
      if (member.user.bot) {
        return {
          success: false,
          message: '봇 사용자는 잠수 상태로 설정할 수 없습니다.',
        };
      }

      if (
        member.permissions.has('Administrator') &&
        !(
          interaction.member?.permissions &&
          typeof interaction.member.permissions !== 'string' &&
          interaction.member.permissions.has('Administrator')
        )
      ) {
        return {
          success: false,
          message: '관리자 권한을 가진 사용자는 잠수 상태로 설정할 수 없습니다.',
        };
      }

      // 잠수 역할 찾기 또는 생성
      let afkRole = guild.roles.cache.find((role) => role.name === '잠수');
      let isNewRole = false;

      if (!afkRole) {
        try {
          afkRole = await guild.roles.create({
            name: '잠수',
            reason: '잠수 상태 관리를 위한 역할',
            color: 0x808080, // 회색
            hoist: false,
            mentionable: false,
          });
          isNewRole = true;
        } catch (error) {
          console.error('잠수 역할 생성 오류:', error);
          return {
            success: false,
            message: '잠수 역할을 생성할 수 없습니다. 권한을 확인해주세요.',
          };
        }
      }

      // 이미 잠수 상태인지 확인
      const hasAfkRole = member.roles.cache.has(afkRole.id);
      if (hasAfkRole) {
        // 기존 잠수 상태 정보 조회
        const existingAfkStatus = await this.dbManager.getUserAfkStatus(targetUser.id);
        if (existingAfkStatus) {
          const existingUntilDate = new Date(existingAfkStatus.afkStartTime || Date.now());
          const existingFormatted = formatKoreanDateString(existingUntilDate);

          return {
            success: false,
            message: `${targetUser.username}님은 이미 잠수 상태입니다. (${existingFormatted}까지)`,
          };
        }
      }

      // 역할 부여
      try {
        await member.roles.add(afkRole, `잠수 설정: ${reason || '사유 없음'}`);
      } catch (error) {
        console.error('역할 부여 오류:', error);
        return {
          success: false,
          message: '역할을 부여할 수 없습니다. 권한을 확인해주세요.',
        };
      }

      // DB에 잠수 정보 저장
      const untilTimestamp = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30일 후
      await this.dbManager.setUserAfkStatus(targetUser.id, targetUser.username, untilTimestamp);

      // 저장 확인 (디버깅용)
      const savedStatus = await this.dbManager.getUserAfkStatus(targetUser.id);
      console.log(`[디버깅] 잠수 상태 저장 확인:`, savedStatus);

      // 캐시 설정
      this.setCached(cacheKey, Date.now());

      // 한국어 날짜 포맷
      const formattedDate = formatKoreanDateString(untilDate);

      // 결과 객체 생성
      const result: AfkSetResult = {
        user: targetUser,
        member,
        untilDate,
        role: afkRole,
        formattedDate,
        isNewRole,
      };

      // 사용자에게 DM 알림
      if (notifyUser) {
        try {
          await targetUser.send({
            content:
              `🔕 **잠수 상태 알림**\n\n` +
              `${guild.name} 서버에서 ${formattedDate}까지 잠수 상태로 설정되었습니다.\n` +
              `${reason ? `**사유:** ${reason}\n` : ''}` +
              `잠수 해제일에 자동으로 역할이 제거됩니다.`,
          });
        } catch (error) {
          console.warn('DM 전송 실패:', error);
        }
      }

      // 성공 응답
      let responseMessage = `✅ **${targetUser.username}님을 ${formattedDate}까지 잠수 상태로 설정했습니다.**\n\n`;

      if (reason) {
        responseMessage += `📝 **사유:** ${reason}\n`;
      }

      if (isNewRole) {
        responseMessage += `🆕 **잠수 역할이 새로 생성되었습니다.**\n`;
      }

      if (notifyUser) {
        responseMessage += `📩 **사용자에게 DM으로 알림을 전송했습니다.**\n`;
      }

      responseMessage += `\n⏰ **자동 해제:** ${formattedDate}에 자동으로 역할이 제거됩니다.`;

      await interaction.followUp({
        content: responseMessage,
        flags: MessageFlags.Ephemeral,
      });

      // 로그 기록
      if (this.logService) {
        this.logService.logActivity(
          `잠수 상태 설정: ${targetUser.username}`,
          [interaction.user.id, targetUser.id],
          'afk_set',
          {
            target: targetUser.id,
            untilDate: untilDate.getTime(),
            reason,
            isNewRole,
            durationWeeks,
          }
        );
      }

      return {
        success: true,
        message: `${targetUser.username}님을 잠수 상태로 설정했습니다.`,
        data: result,
      };
    } catch (error) {
      console.error('잠수 명령어 실행 오류:', error);

      const errorMessage =
        error instanceof Error ? error.message : '잠수 상태 설정 중 오류가 발생했습니다.';

      await interaction.followUp({
        content: `❌ ${errorMessage}`,
        flags: MessageFlags.Ephemeral,
      });

      return {
        success: false,
        message: errorMessage,
        error: error as Error,
      };
    }
  }

  /**
   * 잠수 상태 해제
   * @param interaction - 상호작용 객체
   * @param targetUser - 대상 사용자
   */
  async removeAfkStatus(
    interaction: ChatInputCommandInteraction,
    targetUser: User
  ): Promise<CommandResult> {
    try {
      const guild = interaction.guild;
      if (!guild) {
        return {
          success: false,
          message: '이 명령어는 서버에서만 사용할 수 있습니다.',
        };
      }

      const member = await guild.members.fetch(targetUser.id).catch(() => null);
      if (!member) {
        return {
          success: false,
          message: '해당 사용자를 서버에서 찾을 수 없습니다.',
        };
      }

      // 잠수 역할 찾기
      const afkRole = guild.roles.cache.find((role) => role.name === '잠수');
      if (!afkRole) {
        return {
          success: false,
          message: '잠수 역할이 존재하지 않습니다.',
        };
      }

      // 잠수 역할 확인
      if (!member.roles.cache.has(afkRole.id)) {
        return {
          success: false,
          message: `${targetUser.username}님은 잠수 상태가 아닙니다.`,
        };
      }

      // 역할 제거
      await member.roles.remove(afkRole, '수동 잠수 해제');

      // DB에서 잠수 상태 제거
      await this.dbManager.clearUserAfkStatus(targetUser.id);

      await interaction.followUp({
        content: `✅ **${targetUser.username}님의 잠수 상태를 해제했습니다.**`,
        flags: MessageFlags.Ephemeral,
      });

      // 로그 기록
      if (this.logService) {
        this.logService.logActivity(
          `잠수 상태 해제: ${targetUser.username}`,
          [interaction.user.id, targetUser.id],
          'afk_remove',
          { target: targetUser.id }
        );
      }

      return {
        success: true,
        message: `${targetUser.username}님의 잠수 상태를 해제했습니다.`,
      };
    } catch (error) {
      console.error('잠수 상태 해제 오류:', error);
      return {
        success: false,
        message: '잠수 상태 해제 중 오류가 발생했습니다.',
        error: error as Error,
      };
    }
  }

  /**
   * 잠수 상태 조회
   * @param interaction - 상호작용 객체
   * @param targetUser - 대상 사용자
   */
  async getAfkStatus(
    interaction: ChatInputCommandInteraction,
    targetUser: User
  ): Promise<CommandResult> {
    try {
      const afkStatus = await this.dbManager.getUserAfkStatus(targetUser.id);

      if (!afkStatus) {
        await interaction.followUp({
          content: `📋 **${targetUser.username}님은 잠수 상태가 아닙니다.**`,
          flags: MessageFlags.Ephemeral,
        });
        return {
          success: true,
          message: `${targetUser.username}님은 잠수 상태가 아닙니다.`,
        };
      }

      const untilDate = new Date(afkStatus.afkStartTime || Date.now());
      const formattedDate = formatKoreanDateString(untilDate);
      const now = new Date();
      const remainingTime = untilDate.getTime() - now.getTime();
      const remainingDays = Math.ceil(remainingTime / (24 * 60 * 60 * 1000));

      let statusMessage = `📋 **${targetUser.username}님의 잠수 상태**\n\n`;
      statusMessage += `📅 **해제 예정일:** ${formattedDate}\n`;
      statusMessage += `⏰ **남은 기간:** ${remainingDays}일\n`;

      if (afkStatus.afkReason) {
        statusMessage += `📝 **사유:** ${afkStatus.afkReason}\n`;
      }

      await interaction.followUp({
        content: statusMessage,
        flags: MessageFlags.Ephemeral,
      });

      return {
        success: true,
        message: `${targetUser.username}님의 잠수 상태를 조회했습니다.`,
        data: afkStatus,
      };
    } catch (error) {
      console.error('잠수 상태 조회 오류:', error);
      return {
        success: false,
        message: '잠수 상태 조회 중 오류가 발생했습니다.',
        error: error as Error,
      };
    }
  }

  /**
   * 명령어 도움말 생성
   */
  public getHelp(): string {
    return `**${this.metadata.name}** - ${this.metadata.description}

**사용법:**
\`${this.metadata.usage}\`

**설명:**
• 지정된 사용자를 잠수 상태로 설정하고 "잠수" 역할을 부여합니다.
• 설정된 날짜에 자동으로 역할이 제거됩니다.
• 관리자 권한이 필요합니다.

**옵션:**
• \`user\`: 잠수 상태로 설정할 사용자 (필수)
• \`until_date\`: 잠수 해제 날짜 (YYMMDD 형식, 필수)
• \`reason\`: 잠수 설정 사유 (선택사항)
• \`notify_user\`: 사용자에게 DM 알림 전송 여부 (선택사항)
• \`duration_weeks\`: 잠수 기간 (주 단위, 선택사항)

**예시:**
${this.metadata.examples?.map((ex) => `\`${ex}\``).join('\n')}

**권한:** 관리자 전용, 역할 관리 권한 필요
**쿨다운:** ${this.metadata.cooldown}초`;
  }
}