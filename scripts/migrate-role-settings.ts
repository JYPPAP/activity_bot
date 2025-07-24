#!/usr/bin/env npx tsx
// scripts/migrate-role-settings.ts - 역할 설정 마이그레이션 스크립트

import 'reflect-metadata';
import { container } from 'tsyringe';
import { Client, GatewayIntentBits } from 'discord.js';
import { config } from '../src/config/env';
import { PostgreSQLManager } from '../src/services/PostgreSQLManager';
import { GuildSettingsManager, RoleActivitySetting } from '../src/services/GuildSettingsManager';
import { DI_TOKENS } from '../src/interfaces/index';

interface MigrationResult {
  guildId: string;
  guildName: string;
  totalSettings: number;
  migratedSettings: number;
  errorSettings: number;
  results: Array<{
    settingKey: string;
    roleName: string;
    roleId?: string;
    success: boolean;
    error?: string;
  }>;
}

interface MigrationSummary {
  totalGuilds: number;
  totalSettings: number;
  migratedSettings: number;
  errorSettings: number;
  guildResults: MigrationResult[];
}

class RoleSettingsMigrator {
  private client: Client;
  private dbManager: PostgreSQLManager;
  private guildSettingsManager: GuildSettingsManager;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildRoles,
      ],
    });

    // 의존성 주입 설정
    container.registerSingleton(DI_TOKENS.DiscordClient, Client);
    container.registerInstance(DI_TOKENS.DiscordClient, this.client);

    this.dbManager = new PostgreSQLManager();
    this.guildSettingsManager = new GuildSettingsManager(this.dbManager);
  }

  /**
   * 마이그레이션 실행
   */
  async migrate(): Promise<MigrationSummary> {
    console.log('🚀 역할 설정 마이그레이션 시작...');
    
    try {
      // 데이터베이스 연결
      await this.dbManager.connect();
      console.log('✅ 데이터베이스 연결 완료');

      // Discord 클라이언트 로그인 (타임아웃 설정)
      console.log('🔗 Discord 클라이언트 로그인 중...');
      await Promise.race([
        this.client.login(config.DISCORD_TOKEN),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Discord 로그인 타임아웃')), 30000)
        )
      ]);
      console.log('✅ Discord 클라이언트 로그인 완료');

      // 클라이언트가 준비될 때까지 대기
      await new Promise<void>((resolve) => {
        if (this.client.isReady()) {
          resolve();
        } else {
          this.client.once('ready', () => resolve());
        }
      });

      // 길드 목록 확인
      console.log(`📊 접근 가능한 길드 수: ${this.client.guilds.cache.size}`);
      if (this.client.guilds.cache.size === 0) {
        console.warn('⚠️ 접근 가능한 길드가 없습니다. 봇이 서버에 초대되었는지 확인하세요.');
        return {
          totalGuilds: 0,
          totalSettings: 0,
          migratedSettings: 0,
          errorSettings: 0,
          guildResults: []
        };
      }

      // 모든 길드의 역할 설정 마이그레이션
      const guildResults: MigrationResult[] = [];
      
      for (const guild of this.client.guilds.cache.values()) {
        console.log(`\n📋 길드 "${guild.name}" (${guild.id}) 마이그레이션 시작...`);
        
        try {
          const result = await this.migrateGuildRoleSettings(guild.id, guild.name);
          guildResults.push(result);
          
          console.log(`✅ 길드 "${guild.name}" 마이그레이션 완료: ${result.migratedSettings}/${result.totalSettings} 성공`);
        } catch (error) {
          console.error(`❌ 길드 "${guild.name}" 마이그레이션 실패:`, error);
          guildResults.push({
            guildId: guild.id,
            guildName: guild.name,
            totalSettings: 0,
            migratedSettings: 0,
            errorSettings: 1,
            results: [{
              settingKey: 'guild_error',
              roleName: 'N/A',
              success: false,
              error: error instanceof Error ? error.message : '알 수 없는 오류'
            }]
          });
        }
      }

      // 전체 결과 집계
      const summary: MigrationSummary = {
        totalGuilds: guildResults.length,
        totalSettings: guildResults.reduce((sum, r) => sum + r.totalSettings, 0),
        migratedSettings: guildResults.reduce((sum, r) => sum + r.migratedSettings, 0),
        errorSettings: guildResults.reduce((sum, r) => sum + r.errorSettings, 0),
        guildResults
      };

      console.log('\n🏁 마이그레이션 완료 요약:');
      console.log(`총 길드: ${summary.totalGuilds}`);
      console.log(`총 설정: ${summary.totalSettings}`);
      console.log(`성공: ${summary.migratedSettings}`);
      console.log(`실패: ${summary.errorSettings}`);

      return summary;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * 특정 길드의 역할 설정 마이그레이션
   */
  private async migrateGuildRoleSettings(guildId: string, guildName: string): Promise<MigrationResult> {
    const result: MigrationResult = {
      guildId,
      guildName,
      totalSettings: 0,
      migratedSettings: 0,
      errorSettings: 0,
      results: []
    };

    try {
      // Discord 길드 가져오기
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) {
        throw new Error('길드를 찾을 수 없습니다');
      }

      // 길드의 모든 역할 가져오기
      await guild.roles.fetch();
      const roleMap = new Map<string, { id: string; name: string }>();
      for (const role of guild.roles.cache.values()) {
        roleMap.set(role.name.toLowerCase(), { id: role.id, name: role.name });
      }

      // 기존 역할 설정 조회
      const existingSettings = await this.guildSettingsManager.getAllRoleActivityTimes(guildId);
      result.totalSettings = Object.keys(existingSettings).length;

      console.log(`  📊 기존 설정 ${result.totalSettings}개 발견`);

      for (const [settingKey, setting] of Object.entries(existingSettings)) {
        const migrationItem = {
          settingKey,
          roleName: setting.roleName || settingKey,
          success: false,
          error: undefined as string | undefined
        };

        try {
          // 이미 roleId가 있는 경우 건너뛰기
          if (setting.roleId) {
            console.log(`  ⏭️ 이미 roleId가 있음: ${settingKey}`);
            migrationItem.success = true;
            migrationItem.roleId = setting.roleId;
            result.migratedSettings++;
            result.results.push(migrationItem);
            continue;
          }

          // 역할 이름으로 Discord 역할 ID 찾기
          const roleName = setting.roleName || settingKey;
          const roleInfo = roleMap.get(roleName.toLowerCase());
          
          if (!roleInfo) {
            throw new Error(`Discord에서 역할을 찾을 수 없음: "${roleName}"`);
          }

          console.log(`  🔍 역할 ID 찾음: "${roleName}" -> ${roleInfo.id}`);

          // 설정 업데이트
          const updatedSetting: RoleActivitySetting = {
            ...setting,
            roleId: roleInfo.id,
            roleName: roleInfo.name, // 정확한 이름으로 업데이트
            lastNameUpdate: Date.now()
          };

          // 새로운 키(roleId)로 저장하고 기존 키 삭제
          await this.updateSettingWithNewKey(guildId, settingKey, roleInfo.id, updatedSetting);

          migrationItem.success = true;
          migrationItem.roleId = roleInfo.id;
          result.migratedSettings++;

          console.log(`  ✅ 마이그레이션 성공: "${roleName}" -> ${roleInfo.id}`);
        } catch (error) {
          migrationItem.error = error instanceof Error ? error.message : '알 수 없는 오류';
          result.errorSettings++;
          console.error(`  ❌ 마이그레이션 실패: ${settingKey} -`, migrationItem.error);
        }

        result.results.push(migrationItem);
      }

      return result;
    } catch (error) {
      result.errorSettings = Math.max(1, result.totalSettings);
      result.results.push({
        settingKey: 'guild_migration_error',
        roleName: 'N/A',
        success: false,
        error: error instanceof Error ? error.message : '알 수 없는 오류'
      });
      throw error;
    }
  }

  /**
   * 설정을 새로운 키로 업데이트하고 기존 키 삭제
   */
  private async updateSettingWithNewKey(
    guildId: string,
    oldKey: string,
    newKey: string,
    setting: RoleActivitySetting
  ): Promise<void> {
    try {
      // 트랜잭션으로 처리
      await this.dbManager.transaction(async () => {
        // 새로운 키로 삽입
        await this.dbManager.run(
          `
          INSERT INTO guild_settings 
          (guild_id, setting_type, setting_key, setting_value) 
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (guild_id, setting_type, setting_key) 
          DO UPDATE SET setting_value = EXCLUDED.setting_value
        `,
          [guildId, 'role_activity', newKey, JSON.stringify(setting)]
        );

        // 기존 키와 새 키가 다른 경우에만 기존 키 삭제
        if (oldKey !== newKey) {
          await this.dbManager.run(
            `
            DELETE FROM guild_settings 
            WHERE guild_id = $1 AND setting_type = $2 AND setting_key = $3
          `,
            [guildId, 'role_activity', oldKey]
          );
        }
      });
    } catch (error) {
      console.error('설정 키 업데이트 실패:', error);
      throw error;
    }
  }

  /**
   * 리소스 정리
   */
  private async cleanup(): Promise<void> {
    try {
      if (this.client) {
        this.client.destroy();
        console.log('✅ Discord 클라이언트 종료');
      }
      if (this.dbManager) {
        await this.dbManager.disconnect();
        console.log('✅ 데이터베이스 연결 종료');
      }
    } catch (error) {
      console.error('정리 중 오류:', error);
    }
  }

  /**
   * 드라이런 모드 (실제 변경 없이 미리보기)
   */
  async dryRun(): Promise<MigrationSummary> {
    console.log('🔍 드라이런 모드: 실제 변경 없이 마이그레이션 미리보기...');
    
    // 실제 updateSettingWithNewKey 메서드를 모킹
    const originalUpdate = this.updateSettingWithNewKey;
    this.updateSettingWithNewKey = async (guildId, oldKey, newKey, setting) => {
      console.log(`  [DRY RUN] 업데이트 예정: ${oldKey} -> ${newKey}`);
      return Promise.resolve();
    };

    try {
      const result = await this.migrate();
      console.log('\n🔍 드라이런 완료 - 실제 변경사항은 없습니다.');
      return result;
    } finally {
      // 원래 메서드 복원
      this.updateSettingWithNewKey = originalUpdate;
    }
  }
}

/**
 * 메인 실행 함수
 */
async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run') || args.includes('-d');
  const isHelp = args.includes('--help') || args.includes('-h');

  if (isHelp) {
    console.log(`
역할 설정 마이그레이션 스크립트

사용법:
  npx tsx scripts/migrate-role-settings.ts [옵션]

옵션:
  --dry-run, -d    드라이런 모드 (실제 변경 없이 미리보기)
  --help, -h       도움말 표시

설명:
  기존 guild_settings의 역할 설정에 Discord 역할 ID를 추가하고,
  새로운 하이브리드 구조로 마이그레이션합니다.

주의사항:
  - 마이그레이션 전에 데이터베이스 백업을 권장합니다
  - Discord 봇이 해당 서버에 접근할 수 있어야 합니다
  - 역할 이름이 정확히 일치해야 합니다
`);
    return;
  }

  const migrator = new RoleSettingsMigrator();

  try {
    const summary = isDryRun ? await migrator.dryRun() : await migrator.migrate();
    
    console.log('\n📊 최종 결과:');
    console.log(`총 길드: ${summary.totalGuilds}`);
    console.log(`총 설정: ${summary.totalSettings}`);
    console.log(`마이그레이션 성공: ${summary.migratedSettings}`);
    console.log(`마이그레이션 실패: ${summary.errorSettings}`);
    
    if (summary.errorSettings > 0) {
      console.log('\n❌ 실패한 항목들:');
      for (const guildResult of summary.guildResults) {
        for (const result of guildResult.results) {
          if (!result.success && result.error) {
            console.log(`  - ${guildResult.guildName}: ${result.roleName} - ${result.error}`);
          }
        }
      }
    }

    process.exit(summary.errorSettings > 0 ? 1 : 0);
  } catch (error) {
    console.error('❌ 마이그레이션 실패:', error);
    process.exit(1);
  }
}

// 스크립트가 직접 실행된 경우에만 main 함수 호출
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { RoleSettingsMigrator, MigrationResult, MigrationSummary };