// src/commands/settingsCommand.ts - 설정 명령어
import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';

import { cleanRoleName } from '../utils/formatters';

import {
  CommandBase,
  CommandServices,
  CommandResult,
  CommandExecutionOptions,
  CommandMetadata,
} from './CommandBase';

// 설정 유효성 검사 인터페이스
interface ConfigValidation {
  isValid: boolean;
  error?: string;
  warnings?: string[];
}

// 역할 설정 인터페이스
interface RoleConfig {
  role: string;
  hours: number;
  resetTime: number | undefined;
  reportCycle: string | undefined;
  enabled: boolean | undefined;
}

export class SettingsCommand extends CommandBase {
  public readonly metadata: CommandMetadata = {
    name: '설정',
    description: '역할별 최소 활동시간을 설정합니다.',
    category: 'administration',
    permissions: ['Administrator'],
    cooldown: 5,
    adminOnly: true,
    guildOnly: true,
    usage: '/설정 role:<역할이름> hours:<시간>',
    examples: ['/설정 role:정규 hours:10', '/설정 role:준회원 hours:5'],
    aliases: ['config', '설정'],
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
        option.setName('role').setDescription('설정할 역할 이름').setRequired(true)
      )
      .addIntegerOption(
        (option) =>
          option
            .setName('hours')
            .setDescription('최소 활동시간 (시간)')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(168) // 7일
      )
      .addStringOption((option) =>
        option
          .setName('reset_time')
          .setDescription('리셋 시간 (선택사항, 형식: YYYY-MM-DD HH:MM)')
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName('report_cycle')
          .setDescription('보고 주기 (선택사항: daily, weekly, monthly)')
          .setRequired(false)
          .addChoices(
            { name: '일간', value: 'daily' },
            { name: '주간', value: 'weekly' },
            { name: '월간', value: 'monthly' }
          )
      )
      .addBooleanOption((option) =>
        option.setName('enabled').setDescription('역할 활성화 여부 (선택사항)').setRequired(false)
      ) as SlashCommandBuilder;
  }

  /**
   * 설정 명령어의 실제 실행 로직
   * @param interaction - 상호작용 객체
   * @param options - 실행 옵션
   */
  protected async executeCommand(
    interaction: ChatInputCommandInteraction,
    _options: CommandExecutionOptions
  ): Promise<CommandResult> {
    try {
      // 명령어 옵션 가져오기
      const roleOption = interaction.options.getString('role');
      const hoursOption = interaction.options.getInteger('hours');
      const resetTimeOption = interaction.options.getString('reset_time');
      const reportCycleOption = interaction.options.getString('report_cycle');
      const enabledOption = interaction.options.getBoolean('enabled');

      if (!roleOption || hoursOption === null) {
        throw new Error('역할과 시간은 필수 옵션입니다.');
      }

      const role = cleanRoleName(roleOption);
      const hours = hoursOption;

      // 설정 유효성 검사
      const validation = this.validateConfig({
        role,
        hours,
        resetTime: resetTimeOption ? new Date(resetTimeOption).getTime() : undefined,
        reportCycle: reportCycleOption || undefined,
        enabled: enabledOption !== null ? enabledOption : undefined,
      });

      if (!validation.isValid) {
        return {
          success: false,
          message: validation.error || '설정 유효성 검사 실패',
        };
      }

      // 기존 설정 확인
      const existingConfig = await this.dbManager.getRoleConfig(role);
      const isUpdate = !!existingConfig;

      // 역할 설정 업데이트
      const updateData: any = { minHours: hours };

      if (resetTimeOption) {
        const resetTime = new Date(resetTimeOption);
        if (isNaN(resetTime.getTime())) {
          throw new Error('잘못된 리셋 시간 형식입니다. (예: 2024-01-01 00:00)');
        }
        updateData.resetTime = resetTime.getTime();
      }

      if (reportCycleOption) {
        updateData.reportCycle = reportCycleOption;
      }

      if (enabledOption !== null) {
        updateData.enabled = enabledOption;
      }

      // 캐시 키 생성
      const cacheKey = `role_config_${role}`;

      // 데이터베이스 업데이트
      const updateResult = await this.dbManager.updateRoleConfig(role, hours, updateData);

      if (!updateResult) {
        throw new Error('데이터베이스 업데이트에 실패했습니다.');
      }

      // 캐시 업데이트
      const newConfig = {
        role,
        minHours: hours,
        ...updateData,
        updatedAt: Date.now(),
      };
      this.setCached(cacheKey, newConfig);

      // 응답 메시지 생성
      let responseMessage = `✅ 역할 **${role}**의 설정이 ${isUpdate ? '업데이트' : '생성'}되었습니다!\n\n`;
      responseMessage += `📊 **최소 활동시간:** ${hours}시간\n`;

      if (resetTimeOption) {
        responseMessage += `🔄 **리셋 시간:** ${resetTimeOption}\n`;
      }

      if (reportCycleOption) {
        responseMessage += `📅 **보고 주기:** ${this.getReportCycleDisplayName(reportCycleOption)}\n`;
      }

      if (enabledOption !== null) {
        responseMessage += `🔧 **활성화:** ${enabledOption ? '예' : '아니오'}\n`;
      }

      // 경고 메시지 추가
      if (validation.warnings && validation.warnings.length > 0) {
        responseMessage += `\n⚠️ **경고:**\n${validation.warnings.map((w) => `• ${w}`).join('\n')}`;
      }

      // 성공 응답
      await interaction.followUp({
        content: responseMessage,
        flags: MessageFlags.Ephemeral,
      });

      // 로그 기록
      if (this.logService) {
        this.logService.logActivity(
          `역할 설정 ${isUpdate ? '업데이트' : '생성'}: ${role}`,
          [interaction.user.id],
          'role_config_change',
          {
            role,
            hours,
            resetTime: resetTimeOption,
            reportCycle: reportCycleOption,
            enabled: enabledOption,
            isUpdate,
          }
        );
      }

      return {
        success: true,
        message: `역할 ${role}의 설정이 성공적으로 ${isUpdate ? '업데이트' : '생성'}되었습니다.`,
        data: newConfig,
      };
    } catch (error) {
      console.error('설정 명령어 실행 오류:', error);

      const errorMessage =
        error instanceof Error ? error.message : '설정 저장 중 알 수 없는 오류가 발생했습니다.';

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
   * 설정 유효성 검사
   * @param config - 검사할 설정
   */
  private validateConfig(config: Partial<RoleConfig>): ConfigValidation {
    const warnings: string[] = [];

    // 역할 이름 검사
    if (!config.role || config.role.trim().length === 0) {
      return { isValid: false, error: '역할 이름은 필수입니다.' };
    }

    if (config.role.length > 50) {
      return { isValid: false, error: '역할 이름은 50자를 초과할 수 없습니다.' };
    }

    // 시간 검사
    if (config.hours === undefined || config.hours < 0) {
      return { isValid: false, error: '시간은 0 이상이어야 합니다.' };
    }

    if (config.hours > 168) {
      return { isValid: false, error: '시간은 168시간(7일)을 초과할 수 없습니다.' };
    }

    // 경고 조건 검사
    if (config.hours > 100) {
      warnings.push('매우 높은 활동시간이 설정되었습니다.');
    }

    if (config.hours === 0) {
      warnings.push('최소 활동시간이 0시간으로 설정되었습니다.');
    }

    // 리셋 시간 검사
    if (config.resetTime && config.resetTime < Date.now()) {
      warnings.push('리셋 시간이 과거로 설정되었습니다.');
    }

    const result: ConfigValidation = {
      isValid: true,
    };

    if (warnings.length > 0) {
      result.warnings = warnings;
    }

    return result;
  }

  /**
   * 보고 주기 표시명 반환
   * @param cycle - 보고 주기
   */
  private getReportCycleDisplayName(cycle: string): string {
    switch (cycle) {
      case 'daily':
        return '일간';
      case 'weekly':
        return '주간';
      case 'monthly':
        return '월간';
      default:
        return cycle;
    }
  }

  /**
   * 현재 역할 설정 조회
   * @param interaction - 상호작용 객체
   * @param roleName - 역할 이름
   */
  async getCurrentConfig(
    interaction: ChatInputCommandInteraction,
    roleName: string
  ): Promise<void> {
    try {
      const config = await this.dbManager.getRoleConfig(roleName);

      if (!config) {
        await interaction.followUp({
          content: `❌ 역할 **${roleName}**의 설정을 찾을 수 없습니다.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      let configMessage = `📋 **역할 ${roleName}의 현재 설정:**\n\n`;
      configMessage += `📊 **최소 활동시간:** ${config.minHours}시간\n`;

      if (config.resetTime) {
        configMessage += `🔄 **리셋 시간:** ${new Date(config.resetTime).toLocaleString('ko-KR')}\n`;
      }

      if (config.reportCycle) {
        configMessage += `📅 **보고 주기:** ${this.getReportCycleDisplayName(config.reportCycle)}\n`;
      }

      if (config.enabled !== undefined) {
        configMessage += `🔧 **활성화:** ${config.enabled ? '예' : '아니오'}\n`;
      }

      await interaction.followUp({
        content: configMessage,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('설정 조회 오류:', error);
      await interaction.followUp({
        content: '❌ 설정 조회 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * 모든 역할 설정 조회
   * @param interaction - 상호작용 객체
   */
  async getAllConfigs(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const configs = await this.dbManager.getAllRoleConfigs();

      if (!configs || configs.length === 0) {
        await interaction.followUp({
          content: '📋 설정된 역할이 없습니다.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      let configMessage = '📋 **모든 역할 설정 목록:**\n\n';

      configs.forEach((config, index) => {
        configMessage += `${index + 1}. **${config.role}**\n`;
        configMessage += `   📊 최소 활동시간: ${config.minHours}시간\n`;

        if (config.resetTime) {
          configMessage += `   🔄 리셋 시간: ${new Date(config.resetTime).toLocaleString('ko-KR')}\n`;
        }

        if (config.reportCycle) {
          configMessage += `   📅 보고 주기: ${this.getReportCycleDisplayName(config.reportCycle)}\n`;
        }

        configMessage += '\n';
      });

      await interaction.followUp({
        content: configMessage,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('전체 설정 조회 오류:', error);
      await interaction.followUp({
        content: '❌ 설정 조회 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
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
• 지정된 역할의 최소 활동시간을 설정합니다.
• 리셋 시간과 보고 주기를 선택적으로 설정할 수 있습니다.
• 관리자 권한이 필요합니다.

**옵션:**
• \`role\`: 설정할 역할 이름 (필수)
• \`hours\`: 최소 활동시간 (0-168시간, 필수)
• \`reset_time\`: 리셋 시간 (선택사항, 형식: YYYY-MM-DD HH:MM)
• \`report_cycle\`: 보고 주기 (선택사항: daily/weekly/monthly)
• \`enabled\`: 역할 활성화 여부 (선택사항)

**예시:**
${this.metadata.examples?.map((ex) => `\`${ex}\``).join('\n')}

**권한:** 관리자 전용
**쿨다운:** ${this.metadata.cooldown}초`;
  }
}
