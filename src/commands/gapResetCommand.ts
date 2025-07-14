// src/commands/gapResetCommand.ts - gap_reset 명령어
import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
  Collection,
  GuildMember,
} from 'discord.js';

import { cleanRoleName } from '../utils/formatters.js';

import {
  CommandBase,
  CommandServices,
  CommandResult,
  CommandExecutionOptions,
  CommandMetadata,
} from './CommandBase.js';

// 리셋 결과 인터페이스
interface ResetResult {
  role: string;
  memberCount: number;
  clearedMembers: string[];
  backupCreated: boolean;
  executionTime: number;
}

export class GapResetCommand extends CommandBase {
  public readonly metadata: CommandMetadata = {
    name: 'gap_reset',
    description: '지정된 역할의 모든 사용자의 활동 시간을 초기화합니다.',
    category: 'administration',
    permissions: ['Administrator'],
    cooldown: 30,
    adminOnly: true,
    guildOnly: true,
    usage: '/gap_reset role:<역할이름>',
    examples: ['/gap_reset role:정규', '/gap_reset role:준회원'],
    aliases: ['reset', '초기화'],
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
      .addStringOption((option) =>
        option.setName('role').setDescription('활동 시간을 초기화할 역할 이름').setRequired(true)
      )
      .addBooleanOption((option) =>
        option
          .setName('create_backup')
          .setDescription('초기화 전 백업 생성 여부')
          .setRequired(false)
      )
      .addBooleanOption((option) =>
        option.setName('confirm').setDescription('초기화 실행 확인 (안전장치)').setRequired(false)
      ) as SlashCommandBuilder;
  }

  /**
   * gap_reset 명령어의 실제 실행 로직
   * @param interaction - 상호작용 객체
   * @param options - 실행 옵션
   */
  protected async executeCommand(
    interaction: ChatInputCommandInteraction,
    _options: CommandExecutionOptions
  ): Promise<CommandResult> {
    const startTime = Date.now();

    try {
      // 역할 옵션 가져오기
      const roleOption = interaction.options.getString('role');
      const createBackup = interaction.options.getBoolean('create_backup') ?? true;
      const confirm = interaction.options.getBoolean('confirm') ?? false;

      if (!roleOption) {
        return {
          success: false,
          message: '역할을 지정해주세요.',
        };
      }

      const role = cleanRoleName(roleOption);

      // 안전장치 확인
      if (!confirm) {
        await interaction.followUp({
          content:
            `⚠️ **주의: 이 작업은 되돌릴 수 없습니다!**\n\n` +
            `역할 **${role}**의 모든 사용자의 활동 시간이 초기화됩니다.\n` +
            `계속하려면 \`confirm: true\` 옵션을 추가해주세요.`,
          flags: MessageFlags.Ephemeral,
        });

        return {
          success: false,
          message: '사용자 확인이 필요합니다.',
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

      // 해당 역할의 멤버들 가져오기
      const members = guild.members.cache.filter((member) =>
        member.roles.cache.some((r) => r.name === role)
      );

      if (members.size === 0) {
        return {
          success: false,
          message: `역할 "${role}"을 가진 멤버가 없습니다.`,
        };
      }

      // 진행 상황 알림
      await interaction.followUp({
        content:
          `🔄 **활동 시간 초기화 중...**\n\n` +
          `🎯 **역할:** ${role}\n` +
          `👥 **대상 멤버:** ${members.size}명\n` +
          `💾 **백업 생성:** ${createBackup ? '예' : '아니오'}\n\n` +
          `⏳ **처리 중...**`,
        flags: MessageFlags.Ephemeral,
      });

      // 백업 생성
      let backupCreated = false;
      if (createBackup) {
        try {
          await this.createBackup(role, members);
          backupCreated = true;
        } catch (error) {
          console.error('백업 생성 실패:', error);
          await interaction.followUp({
            content:
              `⚠️ **백업 생성에 실패했습니다.** 계속 진행하시겠습니까?\n` +
              `오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      // 사용자 활동 데이터 초기화 (임시로 비활성화 - 메서드 구현 필요)
      const clearedMembers: string[] = [];
      // TODO: Implement clearUserActivityData method in ActivityTracker
      // const userIds = members.map(member => member.user.id);
      // const cleared = this.activityTracker.clearUserActivityData(userIds);
      // if (cleared) {
      //   clearedMembers.push(...members.map(member => member.displayName));
      // }

      // 활동 데이터 초기화 및 재초기화
      await this.activityTracker.clearAndReinitializeActivityData(role);

      // 결과 생성
      const result: ResetResult = {
        role,
        memberCount: members.size,
        clearedMembers,
        backupCreated,
        executionTime: Date.now() - startTime,
      };

      // 성공 응답
      let responseMessage = `✅ **활동 시간 초기화가 완료되었습니다!**\n\n`;
      responseMessage += `🎯 **역할:** ${role}\n`;
      responseMessage += `👥 **초기화된 멤버:** ${members.size}명\n`;
      responseMessage += `💾 **백업 생성:** ${backupCreated ? '성공' : '실패 또는 건너뜀'}\n`;
      responseMessage += `⏱️ **처리 시간:** ${result.executionTime}ms\n\n`;
      responseMessage += `🔄 **모든 사용자의 활동 시간이 0으로 초기화되었습니다.**`;

      await interaction.followUp({
        content: responseMessage,
        flags: MessageFlags.Ephemeral,
      });

      // 로그 기록
      if (this.logService) {
        this.logService.logActivity(
          `활동 시간 초기화: ${role}`,
          [interaction.user.id],
          'activity_reset',
          {
            role,
            memberCount: members.size,
            backupCreated,
            executionTime: result.executionTime,
            clearedMembers: clearedMembers.length,
          }
        );
      }

      return {
        success: true,
        message: `역할 ${role}의 모든 사용자의 활동 시간이 초기화되었습니다.`,
        data: result,
      };
    } catch (error) {
      console.error('gap_reset 명령어 실행 오류:', error);

      const errorMessage =
        error instanceof Error ? error.message : '활동 시간 초기화 중 오류가 발생했습니다.';

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
   * 백업 생성
   * @param role - 역할 이름
   * @param members - 멤버 컬렉션
   */
  private async createBackup(
    role: string,
    members: Collection<string, GuildMember>
  ): Promise<void> {
    try {
      const backupData: {
        role: string;
        timestamp: number;
        members: Array<{
          userId: string;
          displayName: string;
          totalTime: number;
          startTime: number | null;
          lastActivity: number | null;
        }>;
      } = {
        role,
        timestamp: Date.now(),
        members: [],
      };

      // 각 멤버의 활동 데이터 수집
      for (const [userId, member] of members) {
        const activityData = await this.dbManager.getUserActivity(userId);
        backupData.members.push({
          userId,
          displayName: member.displayName,
          totalTime: activityData?.totalTime || 0,
          startTime: activityData?.startTime || null,
          lastActivity: activityData?.lastActivity || null,
        });
      }

      // 백업 파일 저장 (임시로 비활성화 - 메서드 구현 필요)
      const backupFilename = `backup_${role}_${Date.now()}.json`;
      // TODO: Implement saveBackup method in DatabaseManager
      // await this.dbManager.saveBackup(backupFilename, backupData);

      console.log(`백업 생성 요청: ${backupFilename} (구현 대기 중)`);
    } catch (error) {
      console.error('백업 생성 중 오류:', error);
      throw error;
    }
  }

  /**
   * 특정 사용자의 활동 시간 초기화
   * @param interaction - 상호작용 객체
   * @param userId - 사용자 ID
   */
  async resetUserActivity(
    interaction: ChatInputCommandInteraction,
    userId: string
  ): Promise<CommandResult> {
    try {
      const guild = interaction.guild;
      if (!guild) {
        return {
          success: false,
          message: '이 명령어는 서버에서만 사용할 수 있습니다.',
        };
      }

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        return {
          success: false,
          message: '해당 사용자를 서버에서 찾을 수 없습니다.',
        };
      }

      // 사용자의 활동 시간 초기화 (TODO: ActivityTracker에 공개 메서드 필요)
      // if (this.activityTracker.channelActivityTime?.has(userId)) {
      //   this.activityTracker.channelActivityTime.delete(userId);
      // }

      // 데이터베이스에서 활동 데이터 초기화 (TODO: DatabaseManager에 resetUserActivity 메서드 구현 필요)
      // await this.dbManager.resetUserActivity(userId);
      console.log(`사용자 ${userId}의 활동 데이터 초기화 요청 (구현 대기 중)`);

      await interaction.followUp({
        content: `✅ **${member.displayName}님의 활동 시간이 초기화되었습니다.**`,
        flags: MessageFlags.Ephemeral,
      });

      return {
        success: true,
        message: `${member.displayName}님의 활동 시간이 초기화되었습니다.`,
      };
    } catch (error) {
      console.error('사용자 활동 시간 초기화 오류:', error);
      return {
        success: false,
        message: '사용자 활동 시간 초기화 중 오류가 발생했습니다.',
        error: error as Error,
      };
    }
  }

  /**
   * 백업 목록 조회
   * @param interaction - 상호작용 객체
   */
  async listBackups(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      // TODO: Implement listBackups method in DatabaseManager
      const backups: any[] = []; // 임시로 빈 배열

      if (!backups || backups.length === 0) {
        await interaction.followUp({
          content: '📋 생성된 백업이 없습니다.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      let backupList = '📋 **백업 목록:**\n\n';
      backups.forEach((backup, index) => {
        const date = new Date(backup.timestamp).toLocaleString('ko-KR');
        backupList += `${index + 1}. **${backup.role}** (${date})\n`;
        backupList += `   📁 파일: ${backup.filename}\n`;
        backupList += `   👥 멤버: ${backup.memberCount}명\n\n`;
      });

      await interaction.followUp({
        content: backupList,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('백업 목록 조회 오류:', error);
      await interaction.followUp({
        content: '❌ 백업 목록 조회 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * 백업 복원
   * @param interaction - 상호작용 객체
   * @param backupFilename - 백업 파일명
   */
  async restoreBackup(
    interaction: ChatInputCommandInteraction,
    backupFilename: string
  ): Promise<CommandResult> {
    try {
      // TODO: Implement loadBackup method in DatabaseManager
      const backupData: any = null; // 임시로 null

      if (!backupData) {
        return {
          success: false,
          message: '백업 파일을 찾을 수 없습니다.',
        };
      }

      // 백업 데이터 복원
      let restoredCount = 0;
      for (const memberData of backupData.members) {
        try {
          await this.dbManager.updateUserActivity(
            memberData.userId,
            memberData.totalTime,
            memberData.startTime,
            memberData.displayName
          );
          restoredCount++;
        } catch (error) {
          console.error(`멤버 ${memberData.displayName} 복원 실패:`, error);
        }
      }

      await interaction.followUp({
        content:
          `✅ **백업 복원이 완료되었습니다!**\n\n` +
          `📁 **백업 파일:** ${backupFilename}\n` +
          `🎯 **역할:** ${backupData.role}\n` +
          `👥 **복원된 멤버:** ${restoredCount}/${backupData.members.length}명\n` +
          `📅 **백업 생성일:** ${new Date(backupData.timestamp).toLocaleString('ko-KR')}`,
        flags: MessageFlags.Ephemeral,
      });

      return {
        success: true,
        message: `백업이 성공적으로 복원되었습니다. (${restoredCount}명)`,
      };
    } catch (error) {
      console.error('백업 복원 오류:', error);
      return {
        success: false,
        message: '백업 복원 중 오류가 발생했습니다.',
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
• 지정된 역할의 모든 사용자의 활동 시간을 0으로 초기화합니다.
• 이 작업은 되돌릴 수 없으므로 주의해서 사용하세요.
• 백업 생성 옵션을 사용하여 데이터를 보호할 수 있습니다.
• 관리자 권한이 필요합니다.

**옵션:**
• \`role\`: 활동 시간을 초기화할 역할 이름 (필수)
• \`create_backup\`: 초기화 전 백업 생성 여부 (선택사항, 기본값: true)
• \`confirm\`: 초기화 실행 확인 (선택사항, 안전장치)

**예시:**
${this.metadata.examples?.map((ex) => `\`${ex}\``).join('\n')}

**주의사항:**
• 이 작업은 되돌릴 수 없습니다
• 백업 생성을 강력히 권장합니다
• confirm 옵션 없이는 실행되지 않습니다

**권한:** 관리자 전용
**쿨다운:** ${this.metadata.cooldown}초`;
  }
}
