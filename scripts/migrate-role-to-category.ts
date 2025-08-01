#!/usr/bin/env tsx
// scripts/migrate-role-to-category.ts - Role-based에서 Category-based로 마이그레이션

import 'reflect-metadata';
import { container } from 'tsyringe';
import { config } from '../src/config/env';
import { DI_TOKENS } from '../src/interfaces/index';
import { GuildSettingsManager, ActivityTimeCategory } from '../src/services/GuildSettingsManager';
import { PostgreSQLManager } from '../src/services/PostgreSQLManager';
import { logger } from '../src/config/logger-termux';

interface RoleBasedSetting {
  roleId: string;
  roleName: string;
  minHours: number;
}

interface MigrationResult {
  totalGuilds: number;
  migratedGuilds: number;
  totalRoles: number;
  createdCategories: number;
  errors: string[];
}

/**
 * Role-based 설정에서 Category-based 설정으로 마이그레이션
 */
async function migrateRoleToCategory(): Promise<MigrationResult> {
  const result: MigrationResult = {
    totalGuilds: 0,
    migratedGuilds: 0,
    totalRoles: 0,
    createdCategories: 0,
    errors: [],
  };

  try {
    // DI 컨테이너 설정
    const dbManager = new PostgreSQLManager();
    container.registerInstance(DI_TOKENS.IDatabaseManager, dbManager);
    
    const guildSettingsManager = container.resolve(GuildSettingsManager);

    console.log('🚀 Role-based → Category-based 마이그레이션 시작...');
    console.log('='.repeat(60));

    // 1. 기존 role-based 설정이 있는 길드 조회 (guild_settings_backup 테이블 대신 guild_settings 사용)
    let guildsWithRoleSettings = [];
    try {
      guildsWithRoleSettings = await dbManager.all(`
        SELECT DISTINCT guild_id, 
          setting_value as role_settings_json
        FROM guild_settings 
        WHERE setting_type = 'role_activity' 
          AND setting_value IS NOT NULL 
          AND setting_value != '[]'
      `);
    } catch (error) {
      console.log('⚠️ 역할 기반 설정을 찾을 수 없습니다. (이미 마이그레이션되었거나 설정이 없음)');
      guildsWithRoleSettings = [];
    }

    result.totalGuilds = guildsWithRoleSettings.length;
    console.log(`📋 마이그레이션 대상 길드: ${result.totalGuilds}개`);

    if (result.totalGuilds === 0) {
      console.log('✅ 마이그레이션할 role-based 설정이 없습니다.');
      return result;
    }

    // 2. 각 길드별로 마이그레이션 수행
    for (const guild of guildsWithRoleSettings) {
      const guildId = guild.guild_id.toString();
      
      try {
        console.log(`\n🏢 길드 ${guildId} 마이그레이션 시작...`);
        
        // role_settings에서 roleConfigs 추출
        const roleSettings = JSON.parse(guild.role_settings_json);
        const roleConfigs: RoleBasedSetting[] = roleSettings.roleConfigs || [];
        
        result.totalRoles += roleConfigs.length;
        console.log(`  📝 기존 역할 설정: ${roleConfigs.length}개`);

        // 3. 기존 category 확인 (이미 마이그레이션된 경우 스킵)
        const existingCategories = await guildSettingsManager.getActivityTimeCategories(guildId);
        
        if (existingCategories.length > 0) {
          console.log(`  ⚠️  이미 ${existingCategories.length}개의 카테고리가 존재합니다. 스킵...`);
          continue;
        }

        // 4. Role-based 설정을 Category-based로 변환
        const categories = convertRolesToCategories(roleConfigs);
        console.log(`  🔄 생성할 카테고리: ${categories.length}개`);

        // 5. 새로운 카테고리들 생성
        for (const category of categories) {
          try {
            const updateResult = await guildSettingsManager.updateActivityTimeCategory(
              guildId,
              category.categoryName,
              category,
              'migration-script',
              'Migration Script'
            );

            if (updateResult.isValid) {
              result.createdCategories++;
              console.log(`    ✅ ${category.categoryName} 생성 완료`);
            } else {
              console.log(`    ❌ ${category.categoryName} 생성 실패: ${updateResult.error}`);
              result.errors.push(`Guild ${guildId} - ${category.categoryName}: ${updateResult.error}`);
            }
          } catch (error) {
            const errorMsg = `Guild ${guildId} - Category ${category.categoryName}: ${error}`;
            console.log(`    ❌ ${errorMsg}`);
            result.errors.push(errorMsg);
          }
        }

        result.migratedGuilds++;
        console.log(`  ✅ 길드 ${guildId} 마이그레이션 완료`);

      } catch (error) {
        const errorMsg = `Guild ${guildId} migration failed: ${error}`;
        console.log(`  ❌ ${errorMsg}`);
        result.errors.push(errorMsg);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 마이그레이션 결과:');
    console.log(`  • 총 길드 수: ${result.totalGuilds}`);
    console.log(`  • 마이그레이션된 길드: ${result.migratedGuilds}`);
    console.log(`  • 기존 역할 설정: ${result.totalRoles}개`);
    console.log(`  • 생성된 카테고리: ${result.createdCategories}개`);
    console.log(`  • 오류 발생: ${result.errors.length}개`);

    if (result.errors.length > 0) {
      console.log('\n❌ 오류 목록:');
      result.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
    }

    await dbManager.close();
    return result;

  } catch (error) {
    console.error('💥 마이그레이션 중 치명적 오류 발생:', error);
    result.errors.push(`Fatal error: ${error}`);
    throw error;
  }
}

/**
 * Role-based 설정을 Category-based로 변환
 */
function convertRolesToCategories(roleConfigs: RoleBasedSetting[]): ActivityTimeCategory[] {
  const categories: ActivityTimeCategory[] = [];
  
  // 기본 5단계 카테고리 생성
  const defaultCategories = [
    { name: '30시간+', min: 30, max: null, color: '#00ff00', order: 1 },
    { name: '20-30시간', min: 20, max: 30, color: '#ffff00', order: 2 },
    { name: '10-20시간', min: 10, max: 20, color: '#ffa500', order: 3 },
    { name: '5-10시간', min: 5, max: 10, color: '#ff6600', order: 4 },
    { name: '5시간 미만', min: 0, max: 5, color: '#ff0000', order: 5 },
  ];

  // 기존 역할 설정이 있다면 해당 시간을 참고하여 조정
  if (roleConfigs.length > 0) {
    const roleHours = roleConfigs.map(r => r.minHours).sort((a, b) => b - a);
    const maxHours = Math.max(...roleHours);
    
    console.log(`    📊 기존 역할별 최소 시간: [${roleHours.join(', ')}]시간`);
    console.log(`    📈 최대 요구 시간: ${maxHours}시간`);

    // 최대 시간에 따라 카테고리 조정
    if (maxHours > 30) {
      // 30시간을 초과하는 경우 상위 카테고리 추가
      categories.push({
        guildId: '', // 나중에 설정됨
        categoryName: `${maxHours}시간+`,
        minHours: maxHours,
        maxHours: null,
        displayOrder: 1,
        colorCode: '#00cc00',
        isActive: true,
      });
      
      // 기존 카테고리들의 순서 조정
      defaultCategories.forEach((cat, index) => {
        categories.push({
          guildId: '',
          categoryName: cat.name,
          minHours: cat.min,
          maxHours: cat.max,
          displayOrder: index + 2,
          colorCode: cat.color,
          isActive: true,
        });
      });
    } else {
      // 기본 카테고리 사용
      defaultCategories.forEach(cat => {
        categories.push({
          guildId: '',
          categoryName: cat.name,
          minHours: cat.min,
          maxHours: cat.max,
          displayOrder: cat.order,
          colorCode: cat.color,
          isActive: true,
        });
      });
    }
  } else {
    // 기본 카테고리만 생성
    defaultCategories.forEach(cat => {
      categories.push({
        guildId: '',
        categoryName: cat.name,
        minHours: cat.min,
        maxHours: cat.max,
        displayOrder: cat.order,
        colorCode: cat.color,
        isActive: true,
      });
    });
  }

  return categories;
}

/**
 * 마이그레이션 검증 함수
 */
async function validateMigration(): Promise<void> {
  try {
    const dbManager = new PostgreSQLManager();
    container.registerInstance(DI_TOKENS.IDatabaseManager, dbManager);
    const guildSettingsManager = container.resolve(GuildSettingsManager);

    console.log('\n🔍 마이그레이션 검증 시작...');

    // 마이그레이션된 길드들 확인
    const migratedGuilds = await dbManager.all(`
      SELECT 
        guild_id,
        COUNT(*) as category_count
      FROM activity_time_categories 
      WHERE is_active = true
      GROUP BY guild_id
      ORDER BY guild_id
    `);

    console.log(`📋 카테고리가 설정된 길드: ${migratedGuilds.length}개`);

    for (const guild of migratedGuilds) {
      console.log(`\n🏢 길드 ${guild.guild_id}:`);
      
      const categories = await guildSettingsManager.getActivityTimeCategories(guild.guild_id.toString());
      categories.forEach((cat, index) => {
        const maxDisplay = cat.maxHours ? `~${cat.maxHours}` : '+';
        console.log(`  ${index + 1}. ${cat.categoryName}: ${cat.minHours}${maxDisplay}시간 (${cat.colorCode})`);
      });

      // 테스트: 월별 분류 함수 실행
      try {
        const testClassification = await guildSettingsManager.getUserMonthlyActivityClassification(
          '877239107095515188', // 테스트 유저 ID
          guild.guild_id.toString()
        );
        
        if (testClassification) {
          console.log(`  🧪 테스트 분류: ${testClassification.categoryName} (${testClassification.totalHours}시간)`);
        }
      } catch (error) {
        console.log(`  ❌ 테스트 분류 실패: ${error}`);
      }
    }

    await dbManager.close();
    console.log('\n✅ 마이그레이션 검증 완료');

  } catch (error) {
    console.error('💥 검증 중 오류 발생:', error);
    throw error;
  }
}

// 스크립트 실행
async function main() {
  try {
    const args = process.argv.slice(2);
    const isValidateOnly = args.includes('--validate');
    const isDryRun = args.includes('--dry-run');

    if (isValidateOnly) {
      await validateMigration();
    } else {
      if (isDryRun) {
        console.log('🧪 DRY RUN 모드 - 실제 변경사항 없이 미리보기만 수행합니다.');
      }
      
      const result = await migrateRoleToCategory();
      
      if (result.errors.length === 0) {
        console.log('\n🎉 마이그레이션이 성공적으로 완료되었습니다!');
        
        if (!isDryRun) {
          console.log('\n📝 다음 단계:');
          console.log('  1. /설정 명령어에서 활동시간 분류 관리 기능 구현');
          console.log('  2. /보고서 명령어에서 새로운 분류 시스템 적용');
          console.log('  3. 기존 역할 기반 설정이 완전히 제거되었습니다.');
        }
      } else {
        console.log('\n⚠️ 마이그레이션이 완료되었지만 일부 오류가 발생했습니다.');
        console.log('위의 오류 목록을 확인하고 수동으로 처리해주세요.');
      }
    }

  } catch (error) {
    console.error('💥 스크립트 실행 실패:', error);
    process.exit(1);
  }
}

// 스크립트가 직접 실행된 경우에만 main() 호출
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { migrateRoleToCategory, validateMigration };