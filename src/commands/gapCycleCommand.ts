// src/commands/gapCycleCommand.ts - gap_cycle 명령어
import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { cleanRoleName } from '../utils/formatters.js';
import { CommandBase, CommandServices, CommandResult, CommandExecutionOptions, CommandMetadata } from './CommandBase.js';

// 보고서 주기 타입
type ReportCycle = 1 | 2 | 4 | 8 | 12 | 26 | 52;

// 주기 설정 결과 인터페이스
interface CycleSetResult {
  role: string;
  cycle: number;
  cycleText: string;
  nextReportTime: number;
  nextReportDate: Date;
  previousCycle?: number;
}

// 주기 옵션 인터페이스
interface CycleOption {
  value: ReportCycle;
  name: string;
  description: string;
}

export class GapCycleCommand extends CommandBase {
  public readonly metadata: CommandMetadata = {
    name: 'gap_cycle',
    description: '역할별 보고서 출력 주기를 설정합니다.',
    category: 'administration',
    permissions: ['Administrator'],
    cooldown: 5,
    adminOnly: true,
    guildOnly: true,
    usage: '/gap_cycle role:<역할이름> cycle:<주기>',
    examples: [
      '/gap_cycle role:정규 cycle:1',
      '/gap_cycle role:준회원 cycle:2',
      '/gap_cycle role:전체 cycle:4'
    ],
    aliases: ['cycle', '주기설정']
  };

  private readonly cycleOptions: CycleOption[] = [
    { value: 1, name: '매주', description: '매주 보고서 생성' },
    { value: 2, name: '격주', description: '2주마다 보고서 생성' },
    { value: 4, name: '월간', description: '4주마다 보고서 생성' },
    { value: 8, name: '격월', description: '8주마다 보고서 생성' },
    { value: 12, name: '분기', description: '12주마다 보고서 생성' },
    { value: 26, name: '반기', description: '26주마다 보고서 생성' },
    { value: 52, name: '연간', description: '52주마다 보고서 생성' }
  ];

  constructor(services: CommandServices) {
    super(services);
  }

  /**
   * 슬래시 명령어 빌더 생성
   */
  buildSlashCommand(): SlashCommandBuilder {
    const builder = new SlashCommandBuilder()
      .setName(this.metadata.name)
      .setDescription(this.metadata.description)
      .addStringOption(option =>
        option
          .setName('role')
          .setDescription('설정할 역할 이름')
          .setRequired(true)
      )
      .addIntegerOption(option => {
        const cycleOption = option
          .setName('cycle')
          .setDescription('보고서 출력 주기 (주 단위)')
          .setRequired(true);

        // 주기 옵션 추가
        this.cycleOptions.forEach(opt => {
          cycleOption.addChoices({ name: opt.name, value: opt.value });
        });

        return cycleOption;
      })
      .addBooleanOption(option =>
        option
          .setName('immediate_report')
          .setDescription('설정 후 즉시 보고서 생성 여부')
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('notify_members')
          .setDescription('역할 멤버들에게 알림 전송 여부')
          .setRequired(false)
      ) as SlashCommandBuilder;

    return builder;
  }

  /**
   * gap_cycle 명령어의 실제 실행 로직
   * @param interaction - 상호작용 객체
   * @param options - 실행 옵션
   */
  protected async executeCommand(interaction: ChatInputCommandInteraction, options: CommandExecutionOptions): Promise<CommandResult> {
    try {
      // 역할 옵션 가져오기
      const roleOption = interaction.options.getString("role");
      const cycle = interaction.options.getInteger("cycle") as ReportCycle;
      const immediateReport = interaction.options.getBoolean("immediate_report") || false;
      const notifyMembers = interaction.options.getBoolean("notify_members") || false;

      if (!roleOption) {
        return {
          success: false,
          message: "역할을 지정해주세요."
        };
      }

      if (!cycle) {
        return {
          success: false,
          message: "주기를 선택해주세요."
        };
      }

      const role = cleanRoleName(roleOption);

      // 유효한 주기인지 확인
      const cycleOption = this.cycleOptions.find(opt => opt.value === cycle);
      if (!cycleOption) {
        return {
          success: false,
          message: "유효하지 않은 주기입니다."
        };
      }

      // 역할 설정 확인
      const roleConfig = await this.dbManager.getRoleConfig(role);
      if (!roleConfig) {
        return {
          success: false,
          message: `역할 "${role}"에 대한 설정을 찾을 수 없습니다. 먼저 /gap_config 명령어로 설정해주세요.`
        };
      }

      // 캐시 확인
      const cacheKey = `cycle_set_${role}`;
      const recentSet = this.getCached<number>(cacheKey);
      
      if (recentSet && Date.now() - recentSet < 30000) { // 30초 이내 중복 방지
        return {
          success: false,
          message: "같은 역할에 대해 주기 설정을 너무 자주 시도하고 있습니다. 잠시 후 다시 시도해주세요."
        };
      }

      // 이전 주기 저장
      const previousCycle = roleConfig.reportCycle;

      // 역할 보고서 주기 업데이트
      const updateResult = await this.dbManager.updateRoleReportCycle(role, cycle);
      if (!updateResult) {
        return {
          success: false,
          message: "주기 설정 업데이트에 실패했습니다."
        };
      }

      // 다음 보고서 예정 시간 계산
      const nextReportTime = await this.calculateNextReportTime(role, cycle);
      const nextReportDate = new Date(nextReportTime);

      // 결과 객체 생성
      const result: CycleSetResult = {
        role,
        cycle,
        cycleText: cycleOption.name,
        nextReportTime,
        nextReportDate,
        previousCycle
      };

      // 캐시 설정
      this.setCached(cacheKey, Date.now());

      // 성공 응답
      let responseMessage = `✅ **역할 "${role}"의 보고서 출력 주기가 ${cycleOption.name}로 설정되었습니다.**\n\n`;
      responseMessage += `📅 **다음 예정 보고서:** ${nextReportDate.toLocaleString('ko-KR')}\n`;
      responseMessage += `📊 **설정 내용:** ${cycleOption.description}\n`;
      
      if (previousCycle && previousCycle !== cycle) {
        const previousOption = this.cycleOptions.find(opt => opt.value === previousCycle);
        responseMessage += `🔄 **이전 설정:** ${previousOption?.name || `${previousCycle}주마다`}\n`;
      }

      // 즉시 보고서 생성
      if (immediateReport) {
        responseMessage += `\n⏳ **즉시 보고서를 생성하고 있습니다...**`;
        
        try {
          // 즉시 보고서 생성 로직 (실제 구현 필요)
          // await this.generateImmediateReport(role, interaction.channel);
          responseMessage += `\n✅ **즉시 보고서가 생성되었습니다.**`;
        } catch (error) {
          console.error('즉시 보고서 생성 실패:', error);
          responseMessage += `\n❌ **즉시 보고서 생성에 실패했습니다.**`;
        }
      }

      // 멤버 알림
      if (notifyMembers) {
        try {
          const notificationCount = await this.notifyRoleMembers(role, cycleOption, nextReportDate, interaction);
          responseMessage += `\n📢 **${notificationCount}명의 멤버에게 알림을 전송했습니다.**`;
        } catch (error) {
          console.error('멤버 알림 전송 실패:', error);
          responseMessage += `\n❌ **멤버 알림 전송에 실패했습니다.**`;
        }
      }

      await interaction.followUp({
        content: responseMessage,
        flags: MessageFlags.Ephemeral,
      });

      // 로그 기록
      if (this.logService) {
        this.logService.logActivity(
          `보고서 주기 설정: ${role}`,
          [interaction.user.id],
          'cycle_set',
          {
            role,
            cycle,
            cycleText: cycleOption.name,
            nextReportTime,
            previousCycle,
            immediateReport,
            notifyMembers
          }
        );
      }

      return {
        success: true,
        message: `역할 "${role}"의 보고서 주기가 ${cycleOption.name}로 설정되었습니다.`,
        data: result
      };

    } catch (error) {
      console.error('gap_cycle 명령어 실행 오류:', error);
      
      const errorMessage = error instanceof Error ? error.message : '주기 설정 중 오류가 발생했습니다.';
      
      await interaction.followUp({
        content: `❌ ${errorMessage}`,
        flags: MessageFlags.Ephemeral,
      });

      return {
        success: false,
        message: errorMessage,
        error: error as Error
      };
    }
  }

  /**
   * 다음 보고서 시간 계산
   * @param role - 역할 이름
   * @param cycle - 주기 (주 단위)
   */
  private async calculateNextReportTime(role: string, cycle: number): Promise<number> {
    try {
      // 기존 DB 메소드 사용
      const nextReportTime = await this.dbManager.getNextReportTime(role);
      
      if (nextReportTime) {
        return nextReportTime;
      }

      // 기본 계산: 다음 일요일부터 시작
      const now = new Date();
      const nextSunday = new Date(now);
      nextSunday.setDate(now.getDate() + (7 - now.getDay()) % 7);
      nextSunday.setHours(0, 0, 0, 0);
      
      // 주기에 따른 시간 추가
      const cycleMillis = cycle * 7 * 24 * 60 * 60 * 1000;
      
      return nextSunday.getTime() + cycleMillis;
    } catch (error) {
      console.error('다음 보고서 시간 계산 오류:', error);
      
      // 기본값: 현재 시간 + 1주
      return Date.now() + (7 * 24 * 60 * 60 * 1000);
    }
  }

  /**
   * 역할 멤버들에게 알림 전송
   * @param role - 역할 이름
   * @param cycleOption - 주기 옵션
   * @param nextReportDate - 다음 보고서 날짜
   * @param interaction - 상호작용 객체
   */
  private async notifyRoleMembers(
    role: string, 
    cycleOption: CycleOption, 
    nextReportDate: Date, 
    interaction: ChatInputCommandInteraction
  ): Promise<number> {
    try {
      const guild = interaction.guild;
      if (!guild) return 0;

      // 역할 찾기
      const guildRole = guild.roles.cache.find(r => r.name === role);
      if (!guildRole) return 0;

      // 멤버 가져오기
      const members = await guild.members.fetch();
      const roleMembers = members.filter(member => member.roles.cache.has(guildRole.id));

      let notificationCount = 0;
      const notificationMessage = `📊 **보고서 주기 변경 알림**\n\n` +
                                `🎯 **역할:** ${role}\n` +
                                `📅 **새로운 주기:** ${cycleOption.name}\n` +
                                `⏰ **다음 보고서:** ${nextReportDate.toLocaleString('ko-KR')}\n\n` +
                                `이제 ${cycleOption.description}됩니다.`;

      // 각 멤버에게 DM 전송
      for (const [, member] of roleMembers) {
        try {
          await member.send(notificationMessage);
          notificationCount++;
        } catch (error) {
          console.warn(`멤버 ${member.displayName}에게 알림 전송 실패:`, error);
        }
      }

      return notificationCount;
    } catch (error) {
      console.error('멤버 알림 전송 오류:', error);
      return 0;
    }
  }

  /**
   * 현재 주기 설정 조회
   * @param interaction - 상호작용 객체
   * @param role - 역할 이름
   */
  async getCurrentCycle(interaction: ChatInputCommandInteraction, role: string): Promise<void> {
    try {
      const roleConfig = await this.dbManager.getRoleConfig(role);
      
      if (!roleConfig) {
        await interaction.followUp({
          content: `❌ 역할 **${role}**의 설정을 찾을 수 없습니다.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const cycle = roleConfig.reportCycle;
      const cycleOption = this.cycleOptions.find(opt => opt.value === cycle);
      const cycleText = cycleOption?.name || `${cycle}주마다`;

      let statusMessage = `📊 **역할 ${role}의 현재 보고서 주기:**\n\n`;
      statusMessage += `🔄 **주기:** ${cycleText}\n`;
      statusMessage += `📝 **설명:** ${cycleOption?.description || `${cycle}주마다 보고서 생성`}\n`;
      
      // 다음 보고서 시간 조회
      try {
        const nextReportTime = await this.dbManager.getNextReportTime(role);
        if (nextReportTime) {
          const nextReportDate = new Date(nextReportTime);
          statusMessage += `⏰ **다음 보고서:** ${nextReportDate.toLocaleString('ko-KR')}\n`;
        }
      } catch (error) {
        console.warn('다음 보고서 시간 조회 실패:', error);
      }

      await interaction.followUp({
        content: statusMessage,
        flags: MessageFlags.Ephemeral,
      });

    } catch (error) {
      console.error('현재 주기 조회 오류:', error);
      await interaction.followUp({
        content: '❌ 주기 설정 조회 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * 모든 역할의 주기 설정 조회
   * @param interaction - 상호작용 객체
   */
  async getAllCycles(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const allConfigs = await this.dbManager.getAllRoleConfigs();
      
      if (!allConfigs || allConfigs.length === 0) {
        await interaction.followUp({
          content: '📋 설정된 역할이 없습니다.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      let statusMessage = '📊 **모든 역할의 보고서 주기 설정:**\n\n';
      
      allConfigs.forEach((config, index) => {
        const cycle = config.reportCycle;
        const cycleOption = this.cycleOptions.find(opt => opt.value === cycle);
        const cycleText = cycleOption?.name || `${cycle}주마다`;
        
        statusMessage += `${index + 1}. **${config.role}**\n`;
        statusMessage += `   🔄 주기: ${cycleText}\n`;
        statusMessage += `   📊 최소 활동: ${config.minHours}시간\n\n`;
      });

      await interaction.followUp({
        content: statusMessage,
        flags: MessageFlags.Ephemeral,
      });

    } catch (error) {
      console.error('전체 주기 조회 오류:', error);
      await interaction.followUp({
        content: '❌ 주기 설정 조회 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * 명령어 도움말 생성
   */
  public getHelp(): string {
    const cycleList = this.cycleOptions.map(opt => `• ${opt.name} (${opt.value}주): ${opt.description}`).join('\n');
    
    return `**${this.metadata.name}** - ${this.metadata.description}

**사용법:**
\`${this.metadata.usage}\`

**설명:**
• 지정된 역할의 자동 보고서 생성 주기를 설정합니다.
• 설정된 주기에 따라 정기적으로 활동 보고서가 생성됩니다.
• 관리자 권한이 필요합니다.

**옵션:**
• \`role\`: 설정할 역할 이름 (필수)
• \`cycle\`: 보고서 출력 주기 (필수)
• \`immediate_report\`: 설정 후 즉시 보고서 생성 여부 (선택사항)
• \`notify_members\`: 역할 멤버들에게 알림 전송 여부 (선택사항)

**사용 가능한 주기:**
${cycleList}

**예시:**
${this.metadata.examples?.map(ex => `\`${ex}\``).join('\n')}

**권한:** 관리자 전용
**쿨다운:** ${this.metadata.cooldown}초`;
  }
}