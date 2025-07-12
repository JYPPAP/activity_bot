// src/commands/gapSaveCommand.ts - gap_save 명령어
import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { CommandBase, CommandServices, CommandResult, CommandExecutionOptions, CommandMetadata } from './CommandBase.js';

// 저장 결과 인터페이스
interface SaveResult {
  savedUsers: number;
  executionTime: number;
  dataSize: number;
  backupCreated: boolean;
}

export class GapSaveCommand extends CommandBase {
  public readonly metadata: CommandMetadata = {
    name: 'gap_save',
    description: '현재 활동 데이터를 저장하고 최신화합니다.',
    category: 'administration',
    permissions: ['Administrator'],
    cooldown: 10,
    adminOnly: true,
    guildOnly: true,
    usage: '/gap_save',
    examples: [
      '/gap_save',
      '/gap_save create_backup:true'
    ],
    aliases: ['save', '저장']
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
      .addBooleanOption(option =>
        option
          .setName('create_backup')
          .setDescription('백업 생성 여부')
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('force_sync')
          .setDescription('강제 동기화 여부')
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('clear_cache')
          .setDescription('캐시 정리 여부')
          .setRequired(false)
      ) as SlashCommandBuilder;
  }

  /**
   * gap_save 명령어의 실제 실행 로직
   * @param interaction - 상호작용 객체
   * @param options - 실행 옵션
   */
  protected async executeCommand(interaction: ChatInputCommandInteraction, _options: CommandExecutionOptions): Promise<CommandResult> {
    const startTime = Date.now();
    
    try {
      const createBackup = interaction.options.getBoolean('create_backup') ?? false;
      const forceSync = interaction.options.getBoolean('force_sync') ?? false;
      const clearCache = interaction.options.getBoolean('clear_cache') ?? false;

      // 진행 상황 알림
      await interaction.followUp({
        content: `💾 **활동 데이터 저장 중...**\n\n` +
                `📊 **백업 생성:** ${createBackup ? '예' : '아니오'}\n` +
                `🔄 **강제 동기화:** ${forceSync ? '예' : '아니오'}\n` +
                `🗑️ **캐시 정리:** ${clearCache ? '예' : '아니오'}\n\n` +
                `⏳ **처리 중...**`,
        flags: MessageFlags.Ephemeral,
      });

      // 백업 생성
      let backupCreated = false;
      if (createBackup) {
        try {
          await this.createDataBackup();
          backupCreated = true;
        } catch (error) {
          console.error('백업 생성 실패:', error);
        }
      }

      // 활동 데이터 저장
      const saveStats = await this.activityTracker.saveActivityData();
      
      // 강제 동기화
      if (forceSync) {
        await this.performForceSync();
      }

      // 활동 데이터 초기화 및 재초기화 (모든 역할 대상)
      await this.activityTracker.clearAndReinitializeActivityData('all');

      // 캐시 정리
      if (clearCache) {
        this.clearCache();
      }

      // 결과 생성
      const result: SaveResult = {
        savedUsers: saveStats?.savedUsers || 0,
        executionTime: Date.now() - startTime,
        dataSize: saveStats?.dataSize || 0,
        backupCreated
      };

      // 성공 응답
      let responseMessage = `✅ **활동 데이터가 성공적으로 저장되었습니다!**\n\n`;
      responseMessage += `👥 **저장된 사용자:** ${result.savedUsers}명\n`;
      responseMessage += `💾 **데이터 크기:** ${this.formatDataSize(result.dataSize)}\n`;
      responseMessage += `💾 **백업 생성:** ${backupCreated ? '성공' : '건너뜀'}\n`;
      responseMessage += `⏱️ **처리 시간:** ${result.executionTime}ms\n\n`;
      responseMessage += `🔄 **데이터가 최신화되었습니다.**`;

      if (forceSync) {
        responseMessage += `\n🔄 **강제 동기화가 완료되었습니다.**`;
      }

      if (clearCache) {
        responseMessage += `\n🗑️ **캐시가 정리되었습니다.**`;
      }

      await interaction.followUp({
        content: responseMessage,
        flags: MessageFlags.Ephemeral,
      });

      // 로그 기록
      if (this.logService) {
        this.logService.logActivity(
          '활동 데이터 저장',
          [interaction.user.id],
          'data_save',
          {
            savedUsers: result.savedUsers,
            dataSize: result.dataSize,
            backupCreated,
            forceSync,
            clearCache,
            executionTime: result.executionTime
          }
        );
      }

      return {
        success: true,
        message: '활동 데이터가 성공적으로 저장되었습니다.',
        data: result
      };

    } catch (error) {
      console.error('gap_save 명령어 실행 오류:', error);
      
      const errorMessage = error instanceof Error ? error.message : '활동 데이터 저장 중 오류가 발생했습니다.';
      
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
   * 데이터 백업 생성
   */
  private async createDataBackup(): Promise<void> {
    try {
      const backupData = {
        timestamp: Date.now(),
        type: 'full_activity_backup',
        data: await this.activityTracker.getAllActivityData()
      };

      const backupFilename = `activity_backup_${Date.now()}.json`;
      await this.dbManager.saveBackup(backupFilename, backupData);
      
      console.log(`활동 데이터 백업 생성 완료: ${backupFilename}`);
    } catch (error) {
      console.error('데이터 백업 생성 중 오류:', error);
      throw error;
    }
  }

  /**
   * 강제 동기화 수행
   */
  private async performForceSync(): Promise<void> {
    try {
      // 모든 사용자의 활동 데이터 강제 동기화
      await this.activityTracker.forceSyncAllUsers();
      
      // 데이터베이스 일관성 검사
      await this.dbManager.validateDataConsistency();
      
      console.log('강제 동기화 완료');
    } catch (error) {
      console.error('강제 동기화 중 오류:', error);
      throw error;
    }
  }

  /**
   * 데이터 크기 포맷팅
   * @param bytes - 바이트 수
   */
  private formatDataSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  /**
   * 데이터 상태 조회
   * @param interaction - 상호작용 객체
   */
  async getDataStatus(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      const stats = await this.activityTracker.getActivityStats();
      
      let statusMessage = `📊 **활동 데이터 상태:**\n\n`;
      statusMessage += `👥 **추적 중인 사용자:** ${stats.trackedUsers}명\n`;
      statusMessage += `🔄 **활성 세션:** ${stats.activeSessions}개\n`;
      statusMessage += `💾 **데이터 크기:** ${this.formatDataSize(stats.dataSize)}\n`;
      statusMessage += `🕐 **마지막 저장:** ${new Date(stats.lastSave).toLocaleString('ko-KR')}\n`;
      statusMessage += `🕐 **마지막 동기화:** ${new Date(stats.lastSync).toLocaleString('ko-KR')}\n\n`;
      
      if (stats.pendingWrites > 0) {
        statusMessage += `⚠️ **대기 중인 쓰기:** ${stats.pendingWrites}개\n`;
      }
      
      if (stats.errors > 0) {
        statusMessage += `❌ **최근 오류:** ${stats.errors}건\n`;
      }

      await interaction.followUp({
        content: statusMessage,
        flags: MessageFlags.Ephemeral,
      });

    } catch (error) {
      console.error('데이터 상태 조회 오류:', error);
      await interaction.followUp({
        content: '❌ 데이터 상태 조회 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * 자동 저장 설정
   * @param interaction - 상호작용 객체
   * @param enabled - 자동 저장 활성화 여부
   * @param interval - 저장 간격 (분)
   */
  async setAutoSave(interaction: ChatInputCommandInteraction, enabled: boolean, interval: number = 30): Promise<CommandResult> {
    try {
      await this.activityTracker.setAutoSave(enabled, interval * 60 * 1000);
      
      const message = enabled 
        ? `✅ **자동 저장이 활성화되었습니다.** (${interval}분 간격)`
        : `✅ **자동 저장이 비활성화되었습니다.**`;

      await interaction.followUp({
        content: message,
        flags: MessageFlags.Ephemeral,
      });

      return {
        success: true,
        message: `자동 저장이 ${enabled ? '활성화' : '비활성화'}되었습니다.`
      };

    } catch (error) {
      console.error('자동 저장 설정 오류:', error);
      return {
        success: false,
        message: '자동 저장 설정 중 오류가 발생했습니다.',
        error: error as Error
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
• 현재 메모리에 있는 활동 데이터를 데이터베이스에 저장합니다.
• 저장 후 활동 데이터를 초기화하고 재초기화합니다.
• 데이터 손실을 방지하기 위해 정기적으로 실행하는 것이 좋습니다.
• 관리자 권한이 필요합니다.

**옵션:**
• \`create_backup\`: 백업 생성 여부 (선택사항)
• \`force_sync\`: 강제 동기화 여부 (선택사항)
• \`clear_cache\`: 캐시 정리 여부 (선택사항)

**예시:**
${this.metadata.examples?.map(ex => `\`${ex}\``).join('\n')}

**참고:**
• 자동 저장 기능이 활성화되어 있어도 수동 저장이 필요한 경우가 있습니다
• 백업 생성 옵션을 사용하면 데이터 안전성이 향상됩니다
• 강제 동기화는 데이터 불일치 문제를 해결합니다

**권한:** 관리자 전용
**쿨다운:** ${this.metadata.cooldown}초`;
  }
}