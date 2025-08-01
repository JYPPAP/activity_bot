// src/services/GuildSettingsManager.ts - 길드 설정 관리 서비스
import { injectable, inject } from 'tsyringe';

import { logger } from '../config/logger-termux.js';
import type { IDatabaseManager } from '../interfaces/IDatabaseManager';
import { DI_TOKENS } from '../interfaces/index.js';
import { SecurityValidator, ValidationResult } from '../utils/SecurityValidator.js';

export interface GuildSetting {
  id?: number;
  guildId: string;
  settingType: 'role_activity' | 'game_list' | 'exclude_channels' | 'channel_management';
  settingKey: string;
  settingValue: any;
  createdAt: number;
  updatedAt: number;
}

export interface RoleActivitySetting {
  roleId?: string;           // Discord 역할 ID (불변 식별자)
  roleName?: string;         // 역할 이름 (표시용, 가변)
  minHours: number;
  warningThreshold?: number;
  allowedAfkDuration?: number;
  lastNameUpdate?: number;   // 마지막 이름 업데이트 시간
  createdAt?: number;        // 생성 시간
}

export interface GameListSetting {
  games: string[];
  lastUpdated: number;
}

export interface ExcludeChannelsSetting {
  excludedChannels: string[]; // 완전 제외 (활동+로그 둘 다 제외)
  activityLimitedChannels: string[]; // 활동 제한 (로그는 출력, 활동만 제외)
  lastUpdated: number;
}

export interface ChannelManagementSetting {
  logChannelId?: string;
  forumChannelId?: string;
  voiceCategoryId?: string;
  forumTagId?: string;
  lastUpdated: number;
}

export interface SettingsAuditLog {
  id?: number;
  guildId: string;
  userId: string;
  userName: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  settingType: string;
  settingKey?: string;
  oldValue?: any;
  newValue?: any;
  timestamp: number;
}

export interface ActivityTimeCategory {
  guildId: string;
  categoryName: string;
  minHours: number;
  maxHours?: number;
  displayOrder: number;
  colorCode: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MonthlyActivityClassification {
  userId: string;
  guildId: string;
  monthPeriod: string;
  totalHours: number;
  categoryName: string;
  colorCode: string;
  displayOrder: number;
}

export interface GuildActivityThreshold {
  guildId: string;
  thresholdHours: number;
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * 길드별 설정 관리 서비스
 */
@injectable()
export class GuildSettingsManager {
  private dbManager: IDatabaseManager;

  constructor(@inject(DI_TOKENS.IDatabaseManager) dbManager: IDatabaseManager) {
    this.dbManager = dbManager;
  }

  /**
   * 데이터베이스 초기화 (테이블 생성)
   */
  async initializeDatabase(): Promise<void> {
    try {
      // 길드 설정 테이블 생성 - PostgreSQL에서는 이미 생성되어 있으므로 skip
      // PostgreSQLManager의 createTables에서 이미 처리됨

      // 감사 로그 테이블 생성 - PostgreSQL에서는 이미 생성되어 있으므로 skip
      // PostgreSQLManager의 createTables에서 이미 처리됨

      // 인덱스 생성 - PostgreSQL에서는 이미 생성되어 있으므로 skip
      // PostgreSQLManager의 createTables에서 이미 처리됨

      logger.info('[GuildSettingsManager] 데이터베이스 초기화 완료', undefined);
    } catch (error) {
      logger.error('[GuildSettingsManager] 데이터베이스 초기화 실패:', error as any);
      throw error;
    }
  }

  /**
   * 역할 활동 시간 설정
   */
  async setRoleActivityTime(
    guildId: string,
    roleName: string,
    minHours: number,
    userId: string,
    userName: string,
    roleId?: string  // 새 매개변수: Discord 역할 ID
  ): Promise<ValidationResult> {
    try {
      // 입력 검증
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) return guildValidation;

      const roleValidation = SecurityValidator.validateRoleName(roleName);
      if (!roleValidation.isValid) return roleValidation;

      const hoursValidation = SecurityValidator.validateHours(minHours);
      if (!hoursValidation.isValid) return hoursValidation;

      const userValidation = SecurityValidator.validateUserId(userId);
      if (!userValidation.isValid) return userValidation;

      // 기존 설정 조회
      const existingSetting = await this.getRoleActivityTime(guildId, roleName);

      // 설정 데이터 생성
      const currentTime = Date.now();
      const settingData: RoleActivitySetting = {
        ...(roleId && { roleId }),                    // Discord 역할 ID (있는 경우만)
        roleName: roleValidation.sanitizedValue,      // 역할 이름
        minHours: hoursValidation.sanitizedValue,
        warningThreshold: Math.floor(minHours * 0.8), // 80% 경고
        allowedAfkDuration: 30 * 60 * 1000,          // 30분
        lastNameUpdate: currentTime,                  // 마지막 이름 업데이트
        createdAt: existingSetting ? existingSetting.createdAt || currentTime : currentTime, // 생성 시간 유지
      };

      // 저장 키 결정: roleId가 있으면 roleId, 없으면 roleName 사용
      const settingKey = roleId || roleValidation.sanitizedValue;
      console.log(`[GuildSettings] 설정 저장: key="${settingKey}", roleId="${roleId}", roleName="${roleValidation.sanitizedValue}"`);

      // 데이터베이스 저장 (updated_at은 트리거가 자동 처리)
      await this.dbManager.run(
        `
        INSERT INTO guild_settings 
        (guild_id, setting_type, setting_key, setting_value) 
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (guild_id, setting_type, setting_key) 
        DO UPDATE SET 
          setting_value = EXCLUDED.setting_value
      `,
        [guildId, 'role_activity', settingKey, JSON.stringify(settingData)]
      );

      // 감사 로그 기록
      await this.logSettingChange({
        guildId,
        userId,
        userName,
        action: existingSetting ? 'UPDATE' : 'CREATE',
        settingType: 'role_activity',
        settingKey,  // 새로운 키 사용
        oldValue: existingSetting,
        newValue: settingData,
        timestamp: currentTime,
      });

      logger.info('[GuildSettingsManager] 역할 활동 시간 설정 완료', {
        guildId,
        settingKey,
        roleId,
        roleName: roleValidation.sanitizedValue,
        minHours: hoursValidation.sanitizedValue,
        userId,
      } as any);

      const result: ValidationResult = {
        isValid: true,
        sanitizedValue: settingData,
      };

      if (hoursValidation.warnings) {
        result.warnings = hoursValidation.warnings;
      }

      return result;
    } catch (error) {
      logger.error('[GuildSettingsManager] 역할 활동 시간 설정 실패:', error as any);
      return {
        isValid: false,
        error: '설정 저장 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * 역할 활동 시간 조회 - 역할 이름과 ID 양방향 지원
   */
  async getRoleActivityTime(
    guildId: string,
    roleNameOrId: string
  ): Promise<RoleActivitySetting | null> {
    try {
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) return null;

      const roleValidation = SecurityValidator.validateRoleName(roleNameOrId);
      if (!roleValidation.isValid) return null;

      const startTime = Date.now();
      console.log(`[GuildSettings] 역할 설정 조회 시작: "${roleNameOrId}"`);

      // 1. 직접 키로 검색 (가장 빠른 방법)
      const directQueryStart = Date.now();
      let row = await this.dbManager.get(
        `
        SELECT setting_value FROM guild_settings 
        WHERE guild_id = $1 AND setting_type = $2 AND setting_key = $3
      `,
        [guildId, 'role_activity', roleValidation.sanitizedValue]
      );
      const directQueryTime = Date.now() - directQueryStart;
      console.log(`[GuildSettings] 직접 키 조회 완료: ${directQueryTime}ms`);

      if (row) {
        console.log(`[GuildSettings] 직접 키 매칭으로 찾음: ${roleNameOrId}, 총 소요시간: ${Date.now() - startTime}ms`);
        return JSON.parse(row.setting_value);
      }

      // 2. 모든 역할 설정을 가져와서 JSON 내부 검색
      console.log(`[GuildSettings] 직접 키 매칭 실패, JSON 내부 검색 시작`);
      const jsonSearchStart = Date.now();
      const allRows = await this.dbManager.all(
        `
        SELECT setting_key, setting_value FROM guild_settings 
        WHERE guild_id = $1 AND setting_type = $2
      `,
        [guildId, 'role_activity']
      );
      const jsonQueryTime = Date.now() - jsonSearchStart;

      console.log(`[GuildSettings] 전체 역할 설정 조회 완료: ${jsonQueryTime}ms, 설정 수: ${allRows.length}`);

      for (const configRow of allRows) {
        try {
          const config = JSON.parse(configRow.setting_value);
          console.log(`[GuildSettings] 검사 중인 설정:`, {
            settingKey: configRow.setting_key,
            roleName: config.roleName,
            roleId: config.roleId,
            searchTerm: roleNameOrId
          });

          // 3. JSON 내부의 roleName 또는 roleId와 매칭
          if (config.roleName === roleNameOrId || 
              config.roleId === roleNameOrId) {
            console.log(`[GuildSettings] JSON 내부에서 찾음: ${roleNameOrId} -> ${configRow.setting_key}`);
            return config;
          }

          // 4. 정규화된 이름으로 비교
          const normalizedSearchTerm = this.normalizeRoleName(roleNameOrId);
          const normalizedConfigName = this.normalizeRoleName(config.roleName || '');
          
          if (normalizedConfigName && normalizedConfigName === normalizedSearchTerm) {
            console.log(`[GuildSettings] 정규화된 이름으로 찾음: "${roleNameOrId}" -> "${config.roleName}"`);
            return config;
          }
        } catch (parseError) {
          console.warn(`[GuildSettings] JSON 파싱 실패:`, {
            settingKey: configRow.setting_key,
            error: parseError
          });
        }
      }

      console.log(`[GuildSettings] 역할 설정을 찾을 수 없음: ${roleNameOrId}`);
      return null;
    } catch (error) {
      logger.error('[GuildSettingsManager] 역할 활동 시간 조회 실패:', error as any);
      return null;
    }
  }

  /**
   * 역할 이름 정규화 (공백, 특수문자 처리)
   */
  private normalizeRoleName(roleName: string): string {
    if (!roleName || typeof roleName !== 'string') {
      return '';
    }
    
    return roleName
      .trim()                    // 앞뒤 공백 제거
      .replace(/\s+/g, ' ')      // 연속 공백을 하나로
      .replace(/@/g, '')         // @ 기호 제거
      .toLowerCase();            // 소문자 변환
  }

  /**
   * 특정 역할의 이름이 변경되었는지 확인하고 업데이트
   * @param guildId - 길드 ID
   * @param roleId - Discord 역할 ID
   * @param currentRoleName - 현재 Discord에서의 역할 이름
   * @returns 업데이트 결과
   */
  async updateRoleNameIfChanged(
    guildId: string,
    roleId: string,
    currentRoleName: string
  ): Promise<{ updated: boolean; oldName?: string; newName?: string }> {
    try {
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) {
        return { updated: false };
      }

      console.log(`[GuildSettings] 역할 이름 변경 확인: roleId=${roleId}, currentName="${currentRoleName}"`);

      // roleId로 기존 설정 조회
      const existingSetting = await this.getRoleActivityTime(guildId, roleId);
      if (!existingSetting || !existingSetting.roleName) {
        console.log(`[GuildSettings] 기존 설정을 찾을 수 없음: roleId=${roleId}`);
        return { updated: false };
      }

      // 이름이 변경되었는지 확인
      if (existingSetting.roleName === currentRoleName) {
        console.log(`[GuildSettings] 역할 이름 변경 없음: "${currentRoleName}"`);
        return { updated: false };
      }

      const oldName = existingSetting.roleName;
      console.log(`[GuildSettings] 역할 이름 변경 감지: "${oldName}" -> "${currentRoleName}"`);

      // 설정 업데이트
      const updatedSetting: RoleActivitySetting = {
        ...existingSetting,
        roleName: currentRoleName,
        lastNameUpdate: Date.now()
      };

      // 데이터베이스 업데이트
      await this.dbManager.run(
        `
        UPDATE guild_settings 
        SET setting_value = $1
        WHERE guild_id = $2 AND setting_type = $3 AND setting_key = $4
      `,
        [JSON.stringify(updatedSetting), guildId, 'role_activity', roleId]
      );

      // 감사 로그 기록
      await this.logSettingChange({
        guildId,
        userId: 'system',
        userName: 'System',
        action: 'UPDATE',
        settingType: 'role_activity',
        settingKey: roleId,
        oldValue: existingSetting,
        newValue: updatedSetting,
        timestamp: Date.now(),
      });

      logger.info('[GuildSettingsManager] 역할 이름 자동 업데이트 완료', {
        guildId,
        roleId,
        oldName,
        newName: currentRoleName,
      } as any);

      return { updated: true, oldName, newName: currentRoleName };
    } catch (error) {
      logger.error('[GuildSettingsManager] 역할 이름 업데이트 실패:', error as any);
      return { updated: false };
    }
  }



  /**
   * 역할 활동시간 설정 삭제
   */
  async removeRoleActivityTime(
    guildId: string,
    roleName: string,
    userId: string = 'system',
    userName: string = 'System'
  ): Promise<ValidationResult> {
    try {
      // 입력 검증
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) return guildValidation;

      const roleValidation = SecurityValidator.validateRoleName(roleName);
      if (!roleValidation.isValid) return roleValidation;

      const userValidation = SecurityValidator.validateUserId(userId);
      if (!userValidation.isValid) return userValidation;

      // 기존 설정 존재 확인
      const existingSetting = await this.getRoleActivityTime(guildId, roleName);
      if (!existingSetting) {
        return {
          isValid: false,
          error: '삭제할 역할 설정을 찾을 수 없습니다.',
        };
      }

      // 데이터베이스에서 삭제
      const result = await this.dbManager.run(
        `
        DELETE FROM guild_settings 
        WHERE guild_id = $1 AND setting_type = $2 AND setting_key = $3
      `,
        [guildId, 'role_activity', roleValidation.sanitizedValue]
      );

      if (result.changes === 0) {
        return {
          isValid: false,
          error: '역할 설정 삭제에 실패했습니다.',
        };
      }

      // 감사 로그 기록
      await this.logSettingChange({
        guildId,
        userId,
        userName,
        action: 'DELETE',
        settingType: 'role_activity',
        settingKey: roleValidation.sanitizedValue,
        oldValue: JSON.stringify(existingSetting),
        newValue: null,
        timestamp: Date.now(),
      });

      logger.info('[GuildSettingsManager] 역할 활동시간 설정 삭제 완료', {
        guildId,
        roleName: roleValidation.sanitizedValue,
        userId,
        userName,
      });

      return {
        isValid: true,
        sanitizedValue: true,
      };
    } catch (error) {
      logger.error('[GuildSettingsManager] 역할 활동시간 설정 삭제 실패:', error as any);
      return {
        isValid: false,
        error: '역할 설정 삭제 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * 게임 목록 설정
   */
  async setGameList(
    guildId: string,
    gameListInput: string,
    userId: string,
    userName: string
  ): Promise<ValidationResult> {
    try {
      // 입력 검증
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) return guildValidation;

      const gameListValidation = SecurityValidator.validateGameList(gameListInput);
      if (!gameListValidation.isValid) return gameListValidation;

      const userValidation = SecurityValidator.validateUserId(userId);
      if (!userValidation.isValid) return userValidation;

      // 기존 설정 조회
      const existingSetting = await this.getGameList(guildId);

      // 설정 데이터 생성
      const settingData: GameListSetting = {
        games: gameListValidation.sanitizedValue,
        lastUpdated: Date.now(),
      };

      // 데이터베이스 저장 (updated_at은 트리거가 자동 처리)
      await this.dbManager.run(
        `
        INSERT INTO guild_settings (guild_id, activity_tracking) 
        VALUES ($1, jsonb_build_object('game_list', $2::jsonb))
        ON CONFLICT (guild_id) 
        DO UPDATE SET 
          activity_tracking = COALESCE(guild_settings.activity_tracking, '{}'::jsonb) || jsonb_build_object('game_list', $2::jsonb),
          updated_at = NOW()
      `,
        [guildId, JSON.stringify(settingData)]
      );

      // 감사 로그 기록
      await this.logSettingChange({
        guildId,
        userId,
        userName,
        action: existingSetting ? 'UPDATE' : 'CREATE',
        settingType: 'game_list',
        settingKey: 'games',
        oldValue: existingSetting,
        newValue: settingData,
        timestamp: Date.now(),
      });

      logger.info('[GuildSettingsManager] 게임 목록 설정 완료', {
        guildId,
        gameCount: gameListValidation.sanitizedValue.length,
        userId,
      } as any);

      const result: ValidationResult = {
        isValid: true,
        sanitizedValue: settingData,
      };

      if (gameListValidation.warnings) {
        result.warnings = gameListValidation.warnings;
      }

      return result;
    } catch (error) {
      logger.error('[GuildSettingsManager] 게임 목록 설정 실패:', error as any);
      return {
        isValid: false,
        error: '설정 저장 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * 게임 목록 조회
   */
  async getGameList(guildId: string): Promise<GameListSetting | null> {
    try {
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) return null;

      const row = await this.dbManager.get(
        `
        SELECT activity_tracking FROM guild_settings 
        WHERE guild_id = $1
      `,
        [guildId]
      );

      if (!row || !row.activity_tracking) return null;

      const activitySettings = row.activity_tracking;
      return activitySettings.game_list || null;
    } catch (error) {
      logger.error('[GuildSettingsManager] 게임 목록 조회 실패:', error as any);
      return null;
    }
  }

  /**
   * 제외 채널 설정
   */
  async setExcludeChannels(
    guildId: string,
    excludedChannelIds: string,
    activityLimitedChannelIds: string,
    userId: string,
    userName: string
  ): Promise<ValidationResult> {
    try {
      // 입력 검증
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) return guildValidation;

      // 완전 제외 채널 검증
      const excludedChannelValidation = SecurityValidator.validateChannelIds(
        excludedChannelIds || ''
      );
      if (!excludedChannelValidation.isValid) {
        return { isValid: false, error: `완전 제외 채널 오류: ${excludedChannelValidation.error}` };
      }

      // 활동 제한 채널 검증
      const activityLimitedValidation = SecurityValidator.validateChannelIds(
        activityLimitedChannelIds || ''
      );
      if (!activityLimitedValidation.isValid) {
        return { isValid: false, error: `활동 제한 채널 오류: ${activityLimitedValidation.error}` };
      }

      const userValidation = SecurityValidator.validateUserId(userId);
      if (!userValidation.isValid) return userValidation;

      // 기존 설정 조회
      const existingSetting = await this.getExcludeChannels(guildId);

      // 설정 데이터 생성
      const settingData: ExcludeChannelsSetting = {
        excludedChannels: excludedChannelValidation.sanitizedValue,
        activityLimitedChannels: activityLimitedValidation.sanitizedValue,
        lastUpdated: Date.now(),
      };

      // 데이터베이스 저장 (updated_at은 트리거가 자동 처리)
      await this.dbManager.run(
        `
        INSERT INTO guild_settings (guild_id, exclude_channels) 
        VALUES ($1, $2::jsonb)
        ON CONFLICT (guild_id) 
        DO UPDATE SET 
          exclude_channels = $2::jsonb,
          updated_at = NOW()
      `,
        [guildId, JSON.stringify(settingData)]
      );

      // 감사 로그 기록
      await this.logSettingChange({
        guildId,
        userId,
        userName,
        action: existingSetting ? 'UPDATE' : 'CREATE',
        settingType: 'exclude_channels',
        settingKey: 'channels',
        oldValue: existingSetting,
        newValue: settingData,
        timestamp: Date.now(),
      });

      logger.info('[GuildSettingsManager] 제외 채널 설정 완료', {
        guildId,
        excludedChannelCount: excludedChannelValidation.sanitizedValue.length,
        activityLimitedChannelCount: activityLimitedValidation.sanitizedValue.length,
        userId,
      } as any);

      const result: ValidationResult = {
        isValid: true,
        sanitizedValue: settingData,
      };

      const warnings = [
        ...(excludedChannelValidation.warnings || []),
        ...(activityLimitedValidation.warnings || []),
      ];

      if (warnings.length > 0) {
        result.warnings = warnings;
      }

      return result;
    } catch (error) {
      logger.error('[GuildSettingsManager] 제외 채널 설정 실패:', error as any);
      return {
        isValid: false,
        error: '설정 저장 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * 제외 채널 조회
   */
  async getExcludeChannels(guildId: string): Promise<ExcludeChannelsSetting | null> {
    try {
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) return null;

      const row = await this.dbManager.get(
        `
        SELECT exclude_channels FROM guild_settings 
        WHERE guild_id = $1
      `,
        [guildId]
      );

      if (!row || !row.exclude_channels) return null;

      const parsedData = row.exclude_channels;

      // 이전 구조에서 새로운 구조로 마이그레이션
      if (parsedData.channels && !parsedData.excludedChannels) {
        const migratedData: ExcludeChannelsSetting = {
          excludedChannels: parsedData.channels, // 기존 채널들은 완전 제외로 마이그레이션
          activityLimitedChannels: [], // 활동 제한 채널은 빈 배열로 초기화
          lastUpdated: parsedData.lastUpdated || Date.now(),
        };

        // 마이그레이션된 데이터를 다시 저장
        await this.dbManager.run(
          `
          UPDATE guild_settings 
          SET exclude_channels = $1::jsonb, updated_at = NOW()
          WHERE guild_id = $2
        `,
          [JSON.stringify(migratedData), guildId]
        );

        logger.info('[GuildSettingsManager] 제외 채널 데이터 마이그레이션 완료', {
          guildId,
          oldChannelCount: parsedData.channels.length,
          newExcludedChannelCount: migratedData.excludedChannels.length,
        } as any);

        return migratedData;
      }

      // 이미 새로운 구조인 경우 그대로 반환
      return parsedData as ExcludeChannelsSetting;
    } catch (error) {
      logger.error('[GuildSettingsManager] 제외 채널 조회 실패:', error as any);
      return null;
    }
  }

  /**
   * 채널 관리 설정
   */
  async setChannelManagement(
    guildId: string,
    channels: {
      logChannelId?: string;
      forumChannelId?: string;
      voiceCategoryId?: string;
      forumTagId?: string;
    },
    userId: string,
    userName: string
  ): Promise<ValidationResult> {
    try {
      // 입력 검증
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) return guildValidation;

      const userValidation = SecurityValidator.validateUserId(userId);
      if (!userValidation.isValid) return userValidation;

      // 채널 ID 검증
      const validatedChannels: {
        logChannelId?: string;
        forumChannelId?: string;
        voiceCategoryId?: string;
        forumTagId?: string;
      } = {};

      if (channels.logChannelId) {
        const logChannelValidation = SecurityValidator.validateChannelId(channels.logChannelId);
        if (!logChannelValidation.isValid) {
          return { isValid: false, error: `로그 채널 ID 오류: ${logChannelValidation.error}` };
        }
        validatedChannels.logChannelId = logChannelValidation.sanitizedValue;
      }

      if (channels.forumChannelId) {
        const forumChannelValidation = SecurityValidator.validateChannelId(channels.forumChannelId);
        if (!forumChannelValidation.isValid) {
          return { isValid: false, error: `포럼 채널 ID 오류: ${forumChannelValidation.error}` };
        }
        validatedChannels.forumChannelId = forumChannelValidation.sanitizedValue;
      }

      if (channels.voiceCategoryId) {
        const voiceCategoryValidation = SecurityValidator.validateChannelId(
          channels.voiceCategoryId
        );
        if (!voiceCategoryValidation.isValid) {
          return {
            isValid: false,
            error: `음성 카테고리 ID 오류: ${voiceCategoryValidation.error}`,
          };
        }
        validatedChannels.voiceCategoryId = voiceCategoryValidation.sanitizedValue;
      }

      if (channels.forumTagId) {
        const forumTagValidation = SecurityValidator.validateChannelId(channels.forumTagId);
        if (!forumTagValidation.isValid) {
          return { isValid: false, error: `포럼 태그 ID 오류: ${forumTagValidation.error}` };
        }
        validatedChannels.forumTagId = forumTagValidation.sanitizedValue;
      }

      // 기존 설정 조회
      const existingSetting = await this.getChannelManagement(guildId);

      // 설정 데이터 생성
      const settingData: ChannelManagementSetting = {
        ...validatedChannels,
        lastUpdated: Date.now(),
      };

      // 데이터베이스 저장 (updated_at은 트리거가 자동 처리)
      await this.dbManager.run(
        `
        INSERT INTO guild_settings (guild_id, channel_management) 
        VALUES ($1, $2::jsonb)
        ON CONFLICT (guild_id) 
        DO UPDATE SET 
          channel_management = $2::jsonb,
          updated_at = NOW()
      `,
        [guildId, JSON.stringify(settingData)]
      );

      // 감사 로그 기록
      await this.logSettingChange({
        guildId,
        userId,
        userName,
        action: existingSetting ? 'UPDATE' : 'CREATE',
        settingType: 'channel_management',
        settingKey: 'channels',
        oldValue: existingSetting,
        newValue: settingData,
        timestamp: Date.now(),
      });

      logger.info('[GuildSettingsManager] 채널 관리 설정 완료', {
        guildId,
        channels: validatedChannels,
        userId,
      } as any);

      return {
        isValid: true,
        sanitizedValue: settingData,
      };
    } catch (error) {
      logger.error('[GuildSettingsManager] 채널 관리 설정 실패:', error as any);
      return {
        isValid: false,
        error: '설정 저장 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * 채널 관리 설정 조회
   */
  async getChannelManagement(guildId: string): Promise<ChannelManagementSetting | null> {
    try {
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) return null;

      const row = await this.dbManager.get(
        `
        SELECT channel_management FROM guild_settings 
        WHERE guild_id = $1
      `,
        [guildId]
      );

      if (!row || !row.channel_management) return null;

      return row.channel_management;
    } catch (error) {
      logger.error('[GuildSettingsManager] 채널 관리 설정 조회 실패:', error as any);
      return null;
    }
  }

  /**
   * 길드의 모든 설정 조회
   */
  async getAllGuildSettings(guildId: string): Promise<{
    activityThreshold: { hours: number; value: string } | null;
    gameList: GameListSetting | null;
    excludeChannels: ExcludeChannelsSetting | null;
    channelManagement: ChannelManagementSetting | null;
  }> {
    try {
      const [activityThreshold, gameList, excludeChannels, channelManagement] = await Promise.all([
        this.getGuildActivityThreshold(guildId),
        this.getGameList(guildId),
        this.getExcludeChannels(guildId),
        this.getChannelManagement(guildId),
      ]);

      return {
        activityThreshold: activityThreshold ? { 
          hours: await this.getGuildActivityThresholdHours(guildId),
          value: activityThreshold.thresholdHours.toString() 
        } : null,
        gameList,
        excludeChannels,
        channelManagement,
      };
    } catch (error) {
      logger.error('[GuildSettingsManager] 모든 길드 설정 조회 실패:', error as any);
      return {
        activityThreshold: null,
        gameList: null,
        excludeChannels: null,
        channelManagement: null,
      };
    }
  }

  /**
   * 설정 변경 로그 기록
   */
  private async logSettingChange(auditLog: SettingsAuditLog): Promise<void> {
    try {
      await this.dbManager.run(
        `
        INSERT INTO settings_audit_log 
        (guild_id, user_id, user_name, action, setting_type, setting_key, old_value, new_value, timestamp) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
        [
          auditLog.guildId,
          auditLog.userId,
          auditLog.userName,
          auditLog.action,
          auditLog.settingType,
          auditLog.settingKey || null,
          auditLog.oldValue ? JSON.stringify(auditLog.oldValue) : null,
          auditLog.newValue ? JSON.stringify(auditLog.newValue) : null,
          auditLog.timestamp,
        ]
      );
    } catch (error) {
      logger.error('[GuildSettingsManager] 감사 로그 기록 실패:', error as any);
    }
  }

  /**
   * 설정 변경 로그 조회
   */
  async getSettingAuditLog(guildId: string, limit: number = 50): Promise<SettingsAuditLog[]> {
    try {
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) return [];

      const rows = await this.dbManager.all(
        `
        SELECT * FROM settings_audit_log 
        WHERE guild_id = $1 
        ORDER BY timestamp DESC 
        LIMIT $2
      `,
        [guildId, limit]
      );

      return rows.map((row) => ({
        id: row.id,
        guildId: row.guild_id,
        userId: row.user_id,
        userName: row.user_name,
        action: row.action,
        settingType: row.setting_type,
        settingKey: row.setting_key,
        oldValue: row.old_value ? JSON.parse(row.old_value) : null,
        newValue: row.new_value ? JSON.parse(row.new_value) : null,
        timestamp: row.timestamp,
      }));
    } catch (error) {
      logger.error('[GuildSettingsManager] 감사 로그 조회 실패:', error as any);
      return [];
    }
  }

  /**
   * 설정 삭제
   */
  async deleteSetting(
    guildId: string,
    settingType: string,
    settingKey: string,
    userId: string,
    userName: string
  ): Promise<ValidationResult> {
    try {
      // 입력 검증
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) return guildValidation;

      const typeValidation = SecurityValidator.validateSettingType(settingType);
      if (!typeValidation.isValid) return typeValidation;

      const userValidation = SecurityValidator.validateUserId(userId);
      if (!userValidation.isValid) return userValidation;

      // 기존 설정 조회
      const existingSetting = await this.dbManager.get(
        `
        SELECT setting_value FROM guild_settings 
        WHERE guild_id = $1 AND setting_type = $2 AND setting_key = $3
      `,
        [guildId, settingType, settingKey]
      );

      if (!existingSetting) {
        return {
          isValid: false,
          error: '삭제할 설정을 찾을 수 없습니다.',
        };
      }

      // 설정 삭제
      await this.dbManager.run(
        `
        DELETE FROM guild_settings 
        WHERE guild_id = $1 AND setting_type = $2 AND setting_key = $3
      `,
        [guildId, settingType, settingKey]
      );

      // 감사 로그 기록
      await this.logSettingChange({
        guildId,
        userId,
        userName,
        action: 'DELETE',
        settingType,
        settingKey,
        oldValue: JSON.parse(existingSetting.setting_value),
        newValue: null,
        timestamp: Date.now(),
      });

      logger.info('[GuildSettingsManager] 설정 삭제 완료', {
        guildId,
        settingType,
        settingKey,
        userId,
      } as any);

      return {
        isValid: true,
        sanitizedValue: true,
      };
    } catch (error) {
      logger.error('[GuildSettingsManager] 설정 삭제 실패:', error as any);
      return {
        isValid: false,
        error: '설정 삭제 중 오류가 발생했습니다.',
      };
    }
  }

  // =====================================================
  // 활동시간 분류 시스템 메서드들
  // =====================================================

  /**
   * 길드의 활동시간 분류 카테고리 조회
   */
  async getActivityTimeCategories(guildId: string): Promise<ActivityTimeCategory[]> {
    try {
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) return [];

      const rows = await this.dbManager.all(
        `
        SELECT 
          guild_id, category_name, min_hours, max_hours, 
          display_order, color_code, is_active, created_at, updated_at
        FROM activity_time_categories 
        WHERE guild_id = $1 AND is_active = true
        ORDER BY display_order ASC
        `,
        [guildId]
      );

      return rows.map(row => ({
        guildId: row.guild_id.toString(),
        categoryName: row.category_name,
        minHours: row.min_hours,
        maxHours: row.max_hours,
        displayOrder: row.display_order,
        colorCode: row.color_code,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } catch (error) {
      logger.error('[GuildSettingsManager] 활동시간 분류 조회 실패:', error as any);
      return [];
    }
  }

  /**
   * 활동시간 분류 카테고리 업데이트
   */
  async updateActivityTimeCategory(
    guildId: string,
    categoryName: string,
    categoryData: Partial<ActivityTimeCategory>,
    userId: string,
    userName: string
  ): Promise<ValidationResult> {
    try {
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) {
        return { isValid: false, error: '유효하지 않은 길드 ID입니다.' };
      }

      // 기존 카테고리 조회
      const existingCategory = await this.dbManager.get(
        `
        SELECT * FROM activity_time_categories 
        WHERE guild_id = $1 AND category_name = $2
        `,
        [guildId, categoryName]
      );

      if (existingCategory) {
        // 업데이트
        await this.dbManager.run(
          `
          UPDATE activity_time_categories 
          SET min_hours = $3, max_hours = $4, display_order = $5, 
              color_code = $6, is_active = $7, updated_at = NOW()
          WHERE guild_id = $1 AND category_name = $2
          `,
          [
            guildId, 
            categoryName,
            categoryData.minHours ?? existingCategory.min_hours,
            categoryData.maxHours ?? existingCategory.max_hours,
            categoryData.displayOrder ?? existingCategory.display_order,
            categoryData.colorCode ?? existingCategory.color_code,
            categoryData.isActive ?? existingCategory.is_active,
          ]
        );
      } else {
        // 새로 생성
        await this.dbManager.run(
          `
          INSERT INTO activity_time_categories 
          (guild_id, category_name, min_hours, max_hours, display_order, color_code, is_active)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            guildId,
            categoryName,
            categoryData.minHours ?? 0,
            categoryData.maxHours,
            categoryData.displayOrder ?? 1,
            categoryData.colorCode ?? '#666666',
            categoryData.isActive ?? true,
          ]
        );
      }

      // 감사 로그 기록
      await this.logSettingChange({
        guildId,
        userId,
        userName,
        action: existingCategory ? 'UPDATE' : 'CREATE',
        settingType: 'activity_time_category',
        settingKey: categoryName,
        oldValue: existingCategory || null,
        newValue: categoryData,
        timestamp: Date.now(),
      });

      logger.info('[GuildSettingsManager] 활동시간 분류 카테고리 업데이트 완료', {
        guildId,
        categoryName,
        action: existingCategory ? 'UPDATE' : 'CREATE',
        userId,
      } as any);

      return { isValid: true, sanitizedValue: categoryData };
    } catch (error) {
      logger.error('[GuildSettingsManager] 활동시간 분류 카테고리 업데이트 실패:', error as any);
      return {
        isValid: false,
        error: '분류 카테고리 업데이트 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * 사용자의 월별 활동 분류 조회
   */
  async getUserMonthlyActivityClassification(
    userId: string,
    guildId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<MonthlyActivityClassification | null> {
    try {
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) return null;

      const start = startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const end = endDate || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);

      const result = await this.dbManager.get(
        `
        SELECT * FROM get_user_monthly_activity_classification($1, $2, $3, $4)
        `,
        [userId, guildId, start.toISOString().split('T')[0], end.toISOString().split('T')[0]]
      );

      if (!result) return null;

      return {
        userId: result.user_id,
        guildId: result.guild_id.toString(),
        monthPeriod: result.month_period,
        totalHours: parseFloat(result.total_hours),
        categoryName: result.category_name,
        colorCode: result.color_code,
        displayOrder: result.display_order,
      };
    } catch (error) {
      logger.error('[GuildSettingsManager] 월별 활동 분류 조회 실패:', error as any);
      return null;
    }
  }

  /**
   * 길드 전체 월별 활동 보고서 조회
   */
  async getGuildMonthlyActivityReport(
    guildId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<MonthlyActivityClassification[]> {
    try {
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) return [];

      const start = startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const end = endDate || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);

      const rows = await this.dbManager.all(
        `
        SELECT * FROM get_guild_monthly_activity_report($1, $2, $3)
        `,
        [guildId, start.toISOString().split('T')[0], end.toISOString().split('T')[0]]
      );

      return rows.map(row => ({
        userId: row.user_id,
        guildId: guildId,
        monthPeriod: start.toISOString().substring(0, 7), // YYYY-MM format
        totalHours: parseFloat(row.total_hours),
        categoryName: row.category_name,
        colorCode: row.color_code,
        displayOrder: row.display_order,
      }));
    } catch (error) {
      logger.error('[GuildSettingsManager] 길드 월별 활동 보고서 조회 실패:', error as any);
      return [];
    }
  }

  /**
   * 활동시간 분류 카테고리 삭제
   */
  async deleteActivityTimeCategory(
    guildId: string,
    categoryName: string,
    userId: string,
    userName: string
  ): Promise<ValidationResult> {
    try {
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) {
        return { isValid: false, error: '유효하지 않은 길드 ID입니다.' };
      }

      // 기존 카테고리 조회
      const existingCategory = await this.dbManager.get(
        `
        SELECT * FROM activity_time_categories 
        WHERE guild_id = $1 AND category_name = $2
        `,
        [guildId, categoryName]
      );

      if (!existingCategory) {
        return {
          isValid: false,
          error: '삭제할 분류 카테고리를 찾을 수 없습니다.',
        };
      }

      // 카테고리 삭제
      await this.dbManager.run(
        `
        DELETE FROM activity_time_categories 
        WHERE guild_id = $1 AND category_name = $2
        `,
        [guildId, categoryName]
      );

      // 감사 로그 기록
      await this.logSettingChange({
        guildId,
        userId,
        userName,
        action: 'DELETE',
        settingType: 'activity_time_category',
        settingKey: categoryName,
        oldValue: existingCategory,
        newValue: null,
        timestamp: Date.now(),
      });

      logger.info('[GuildSettingsManager] 활동시간 분류 카테고리 삭제 완료', {
        guildId,
        categoryName,
        userId,
      } as any);

      return { isValid: true, sanitizedValue: true };
    } catch (error) {
      logger.error('[GuildSettingsManager] 활동시간 분류 카테고리 삭제 실패:', error as any);
      return {
        isValid: false,
        error: '분류 카테고리 삭제 중 오류가 발생했습니다.',
      };
    }
  }

  // =====================================================
  // 길드 전역 활동 임계값 관리 메서드들
  // =====================================================

  /**
   * 길드의 전역 활동 임계값 설정
   * @param guildId - 길드 ID
   * @param thresholdHours - 임계값 (시간 단위)
   * @param userId - 설정한 사용자 ID
   * @param userName - 설정한 사용자 이름
   * @param description - 설정 설명 (선택사항)
   * @returns 설정 결과
   */
  async setGuildActivityThreshold(
    guildId: string,
    thresholdHours: number,
    userId: string,
    userName: string,
    description?: string
  ): Promise<ValidationResult> {
    try {
      // 입력 검증
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) return guildValidation;

      const hoursValidation = SecurityValidator.validateHours(thresholdHours);
      if (!hoursValidation.isValid) return hoursValidation;

      const userValidation = SecurityValidator.validateUserId(userId);
      if (!userValidation.isValid) return userValidation;

      // 기존 설정 조회
      const existingSetting = await this.getGuildActivityThreshold(guildId);

      // 설정 데이터 생성
      const currentTime = Date.now();
      const settingData: GuildActivityThreshold = {
        guildId,
        thresholdHours: hoursValidation.sanitizedValue,
        description: description || `길드 전역 활동 임계값: ${hoursValidation.sanitizedValue}시간`,
        ...(existingSetting && { createdAt: existingSetting.createdAt }),
        updatedAt: new Date(currentTime),
      };

      // 데이터베이스 저장
      await this.dbManager.run(
        `
        INSERT INTO guild_settings 
        (guild_id, setting_type, setting_key, setting_value) 
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (guild_id, setting_type, setting_key) 
        DO UPDATE SET 
          setting_value = EXCLUDED.setting_value
      `,
        [guildId, 'guild_activity_threshold', 'threshold', JSON.stringify(settingData)]
      );

      // 감사 로그 기록
      await this.logSettingChange({
        guildId,
        userId,
        userName,
        action: existingSetting ? 'UPDATE' : 'CREATE',
        settingType: 'guild_activity_threshold',
        settingKey: 'threshold',
        oldValue: existingSetting,
        newValue: settingData,
        timestamp: currentTime,
      });

      logger.info('[GuildSettingsManager] 길드 전역 활동 임계값 설정 완료', {
        guildId,
        thresholdHours: hoursValidation.sanitizedValue,
        userId,
        userName,
      } as any);

      const result: ValidationResult = {
        isValid: true,
        sanitizedValue: settingData,
      };

      if (hoursValidation.warnings) {
        result.warnings = hoursValidation.warnings;
      }

      return result;
    } catch (error) {
      logger.error('[GuildSettingsManager] 길드 전역 활동 임계값 설정 실패:', error as any);
      return {
        isValid: false,
        error: '길드 활동 임계값 설정 중 오류가 발생했습니다.',
      };
    }
  }

  /**
   * 길드의 전역 활동 임계값 조회
   * @param guildId - 길드 ID
   * @returns 설정된 임계값 정보 또는 null (기본값: 30시간)
   */
  async getGuildActivityThreshold(guildId: string): Promise<GuildActivityThreshold | null> {
    try {
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) return null;

      const row = await this.dbManager.get(
        `
        SELECT setting_value FROM guild_settings 
        WHERE guild_id = $1 AND setting_type = $2 AND setting_key = $3
      `,
        [guildId, 'guild_activity_threshold', 'threshold']
      );

      if (!row || !row.setting_value) {
        // 기본값 반환: 30시간
        return {
          guildId,
          thresholdHours: 30,
          description: '기본 길드 활동 임계값 (30시간)',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }

      return JSON.parse(row.setting_value) as GuildActivityThreshold;
    } catch (error) {
      logger.error('[GuildSettingsManager] 길드 전역 활동 임계값 조회 실패:', error as any);
      // 오류 시에도 기본값 반환
      return {
        guildId,
        thresholdHours: 30,
        description: '기본 길드 활동 임계값 (30시간) - 오류로 인한 기본값',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
  }

  /**
   * 길드의 전역 활동 임계값을 시간 단위로 간단 조회
   * @param guildId - 길드 ID
   * @returns 임계값 (시간 단위, 기본값: 30)
   */
  async getGuildActivityThresholdHours(guildId: string): Promise<number> {
    try {
      const threshold = await this.getGuildActivityThreshold(guildId);
      return threshold ? threshold.thresholdHours : 30;
    } catch (error) {
      logger.error('[GuildSettingsManager] 길드 활동 임계값 시간 조회 실패:', error as any);
      return 30; // 기본값
    }
  }

  /**
   * 길드의 전역 활동 임계값 삭제 (기본값으로 되돌리기)
   * @param guildId - 길드 ID
   * @param userId - 삭제한 사용자 ID
   * @param userName - 삭제한 사용자 이름
   * @returns 삭제 결과
   */
  async removeGuildActivityThreshold(
    guildId: string,
    userId: string = 'system',
    userName: string = 'System'
  ): Promise<ValidationResult> {
    try {
      // 입력 검증
      const guildValidation = SecurityValidator.validateGuildId(guildId);
      if (!guildValidation.isValid) return guildValidation;

      const userValidation = SecurityValidator.validateUserId(userId);
      if (!userValidation.isValid) return userValidation;

      // 기존 설정 존재 확인
      const existingSetting = await this.getGuildActivityThreshold(guildId);
      if (!existingSetting || existingSetting.thresholdHours === 30) {
        return {
          isValid: true,
          sanitizedValue: true,
          warnings: ['이미 기본값(30시간)으로 설정되어 있습니다.'],
        };
      }

      // 데이터베이스에서 삭제
      const result = await this.dbManager.run(
        `
        DELETE FROM guild_settings 
        WHERE guild_id = $1 AND setting_type = $2 AND setting_key = $3
      `,
        [guildId, 'guild_activity_threshold', 'threshold']
      );

      if (result.changes === 0) {
        return {
          isValid: false,
          error: '길드 활동 임계값 삭제에 실패했습니다.',
        };
      }

      // 감사 로그 기록
      await this.logSettingChange({
        guildId,
        userId,
        userName,
        action: 'DELETE',
        settingType: 'guild_activity_threshold',
        settingKey: 'threshold',
        oldValue: existingSetting,
        newValue: null,
        timestamp: Date.now(),
      });

      logger.info('[GuildSettingsManager] 길드 전역 활동 임계값 삭제 완료 (기본값으로 복원)', {
        guildId,
        userId,
        userName,
      } as any);

      return {
        isValid: true,
        sanitizedValue: true,
      };
    } catch (error) {
      logger.error('[GuildSettingsManager] 길드 전역 활동 임계값 삭제 실패:', error as any);
      return {
        isValid: false,
        error: '길드 활동 임계값 삭제 중 오류가 발생했습니다.',
      };
    }
  }
}
