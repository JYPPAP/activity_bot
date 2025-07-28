// src/services/FeatureManagerService.ts - 기능 관리 서비스
import { injectable } from 'tsyringe';

import { isDevelopment } from '../config/env.js';

/**
 * 사용 가능한 기능 목록
 */
export enum Features {
  // 코어 기능
  ACTIVITY_TRACKING = 'ACTIVITY_TRACKING',
  VOICE_LOGGING = 'VOICE_LOGGING',
  SLASH_COMMANDS = 'SLASH_COMMANDS',

  // 고급 기능
  EMOJI_REACTIONS = 'EMOJI_REACTIONS',
  FORUM_INTEGRATION = 'FORUM_INTEGRATION',
  AFK_MANAGEMENT = 'AFK_MANAGEMENT',
  USER_CLASSIFICATION = 'USER_CLASSIFICATION',

  // 통계 및 분석
  DAILY_STATS = 'DAILY_STATS',
  WEEKLY_REPORTS = 'WEEKLY_REPORTS',
  ACTIVITY_ANALYTICS = 'ACTIVITY_ANALYTICS',

  // 알림 시스템
  SLACK_NOTIFICATIONS = 'SLACK_NOTIFICATIONS',
  DISCORD_ALERTS = 'DISCORD_ALERTS',
  ERROR_REPORTING = 'ERROR_REPORTING',

  // 데이터베이스
  POSTGRESQL_SUPPORT = 'POSTGRESQL_SUPPORT',
  REDIS_CACHING = 'REDIS_CACHING',
  DATA_MIGRATION = 'DATA_MIGRATION',

  // 개발자 도구
  DEBUG_MODE = 'DEBUG_MODE',
  PERFORMANCE_MONITORING = 'PERFORMANCE_MONITORING',
  API_ENDPOINTS = 'API_ENDPOINTS',
}

/**
 * 기능 설정 인터페이스
 */
export interface FeatureConfig {
  enabled: boolean;
  envVar?: string;
  requiredEnvVars?: string[];
  dependencies?: Features[];
  environments?: ('development' | 'production' | 'test')[];
  description?: string;
}

/**
 * 기능 상태 정보
 */
export interface FeatureStatus {
  feature: Features;
  enabled: boolean;
  reason?: string;
  missingDependencies?: Features[];
  missingEnvVars?: string[];
}

/**
 * 기능 관리 서비스
 * 환경변수와 설정에 따라 기능을 동적으로 활성화/비활성화
 */
@injectable()
export class FeatureManagerService {
  private readonly featureConfigs: Map<Features, FeatureConfig>;
  private readonly featureStates: Map<Features, boolean> = new Map();

  constructor() {
    this.featureConfigs = this.initializeFeatureConfigs();
    this.evaluateAllFeatures();
  }

  /**
   * 기능 설정 초기화
   */
  private initializeFeatureConfigs(): Map<Features, FeatureConfig> {
    const configs = new Map<Features, FeatureConfig>();

    // 코어 기능 (항상 활성화)
    configs.set(Features.ACTIVITY_TRACKING, {
      enabled: true,
      description: '음성 채널 활동 시간 추적',
    });

    configs.set(Features.VOICE_LOGGING, {
      enabled: true,
      description: '음성 채널 입퇴장 로깅',
    });

    configs.set(Features.SLASH_COMMANDS, {
      enabled: true,
      description: '슬래시 명령어 지원',
    });

    // 고급 기능 (조건부 활성화)
    configs.set(Features.EMOJI_REACTIONS, {
      enabled: true,
      envVar: 'ENABLE_EMOJI_REACTIONS',
      description: '이모지 반응 기능',
    });

    configs.set(Features.FORUM_INTEGRATION, {
      enabled: true,
      envVar: 'ENABLE_FORUM_INTEGRATION',
      requiredEnvVars: ['FORUM_CHANNEL_ID'],
      description: '포럼 채널 통합',
    });

    configs.set(Features.AFK_MANAGEMENT, {
      enabled: true,
      envVar: 'ENABLE_AFK_MANAGEMENT',
      description: 'AFK 상태 관리',
    });

    configs.set(Features.USER_CLASSIFICATION, {
      enabled: true,
      envVar: 'ENABLE_USER_CLASSIFICATION',
      description: '사용자 역할 분류',
    });

    // 통계 및 분석
    configs.set(Features.DAILY_STATS, {
      enabled: true,
      envVar: 'ENABLE_DAILY_STATS',
      description: '일일 통계 생성',
    });

    configs.set(Features.WEEKLY_REPORTS, {
      enabled: true,
      envVar: 'ENABLE_WEEKLY_REPORTS',
      dependencies: [Features.DAILY_STATS],
      description: '주간 리포트 생성',
    });

    configs.set(Features.ACTIVITY_ANALYTICS, {
      enabled: true,
      envVar: 'ENABLE_ACTIVITY_ANALYTICS',
      dependencies: [Features.ACTIVITY_TRACKING],
      description: '활동 분석 기능',
    });

    // 알림 시스템
    configs.set(Features.SLACK_NOTIFICATIONS, {
      enabled: false,
      envVar: 'ENABLE_SLACK_ALERTS',
      requiredEnvVars: ['SLACK_WEBHOOK_URL'],
      description: 'Slack 알림 전송',
    });

    configs.set(Features.DISCORD_ALERTS, {
      enabled: true,
      envVar: 'ENABLE_DISCORD_ALERTS',
      description: 'Discord 내 알림',
    });

    configs.set(Features.ERROR_REPORTING, {
      enabled: true,
      envVar: 'ENABLE_ERROR_REPORTING',
      environments: ['production'],
      description: '오류 리포팅',
    });

    // 데이터베이스
    configs.set(Features.POSTGRESQL_SUPPORT, {
      enabled: false,
      envVar: 'ENABLE_POSTGRESQL',
      requiredEnvVars: ['POSTGRES_HOST', 'POSTGRES_DB'],
      description: 'PostgreSQL 데이터베이스 지원',
    });

    configs.set(Features.REDIS_CACHING, {
      enabled: false,
      envVar: 'ENABLE_REDIS',
      requiredEnvVars: ['REDIS_HOST'],
      description: 'Redis 캐싱',
    });

    configs.set(Features.DATA_MIGRATION, {
      enabled: false,
      envVar: 'ENABLE_DATA_MIGRATION',
      environments: ['development'],
      description: '데이터 마이그레이션 도구',
    });

    // 개발자 도구
    configs.set(Features.DEBUG_MODE, {
      enabled: false,
      envVar: 'ENABLE_DEBUG_MODE',
      environments: ['development'],
      description: '디버그 모드',
    });

    configs.set(Features.PERFORMANCE_MONITORING, {
      enabled: false,
      envVar: 'ENABLE_PERFORMANCE_MONITORING',
      description: '성능 모니터링',
    });

    configs.set(Features.API_ENDPOINTS, {
      enabled: false,
      envVar: 'ENABLE_API_ENDPOINTS',
      requiredEnvVars: ['API_PORT'],
      description: 'REST API 엔드포인트',
    });

    return configs;
  }

  /**
   * 모든 기능 상태 평가
   */
  private evaluateAllFeatures(): void {
    for (const [feature, config] of this.featureConfigs.entries()) {
      this.featureStates.set(feature, this.evaluateFeature(feature, config));
    }
  }

  /**
   * 특정 기능 상태 평가
   */
  private evaluateFeature(_feature: Features, config: FeatureConfig): boolean {
    // 기본적으로 비활성화된 기능
    if (!config.enabled) {
      return false;
    }

    // 환경 조건 확인
    if (config.environments && config.environments.length > 0) {
      const currentEnv = process.env.NODE_ENV || 'development';
      if (!config.environments.includes(currentEnv as any)) {
        return false;
      }
    }

    // 환경변수 확인
    if (config.envVar) {
      const envValue = process.env[config.envVar];
      if (envValue !== 'true' && envValue !== '1') {
        return false;
      }
    }

    // 필수 환경변수 확인
    if (config.requiredEnvVars) {
      for (const envVar of config.requiredEnvVars) {
        if (!process.env[envVar]) {
          return false;
        }
      }
    }

    // 의존성 확인
    if (config.dependencies) {
      for (const dependency of config.dependencies) {
        if (!this.isFeatureEnabled(dependency)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * 기능 활성화 여부 확인
   */
  public isFeatureEnabled(feature: Features): boolean {
    return this.featureStates.get(feature) || false;
  }

  /**
   * 여러 기능이 모두 활성화되어 있는지 확인
   */
  public areAllFeaturesEnabled(features: Features[]): boolean {
    return features.every((feature) => this.isFeatureEnabled(feature));
  }

  /**
   * 여러 기능 중 하나라도 활성화되어 있는지 확인
   */
  public isAnyFeatureEnabled(features: Features[]): boolean {
    return features.some((feature) => this.isFeatureEnabled(feature));
  }

  /**
   * 기능 상태 정보 가져오기
   */
  public getFeatureStatus(feature: Features): FeatureStatus {
    const config = this.featureConfigs.get(feature);
    const enabled = this.isFeatureEnabled(feature);

    if (!config) {
      return {
        feature,
        enabled: false,
        reason: '알 수 없는 기능',
      };
    }

    const status: FeatureStatus = {
      feature,
      enabled,
    };

    if (!enabled) {
      // 비활성화 이유 분석
      if (!config.enabled) {
        status.reason = '기본적으로 비활성화됨';
      } else if (config.environments) {
        const currentEnv = process.env.NODE_ENV || 'development';
        if (!config.environments.includes(currentEnv as any)) {
          status.reason = `현재 환경(${currentEnv})에서 지원되지 않음`;
        }
      } else if (config.envVar) {
        const envValue = process.env[config.envVar];
        if (envValue !== 'true' && envValue !== '1') {
          status.reason = `환경변수 ${config.envVar}가 활성화되지 않음`;
        }
      } else if (config.requiredEnvVars) {
        const missingEnvVars = config.requiredEnvVars.filter((envVar) => !process.env[envVar]);
        if (missingEnvVars.length > 0) {
          status.missingEnvVars = missingEnvVars;
          status.reason = `필수 환경변수 누락: ${missingEnvVars.join(', ')}`;
        }
      } else if (config.dependencies) {
        const missingDependencies = config.dependencies.filter(
          (dep) => !this.isFeatureEnabled(dep)
        );
        if (missingDependencies.length > 0) {
          status.missingDependencies = missingDependencies;
          status.reason = `의존 기능 비활성화: ${missingDependencies.join(', ')}`;
        }
      }
    }

    return status;
  }

  /**
   * 모든 기능 상태 목록 가져오기
   */
  public getAllFeatureStatuses(): FeatureStatus[] {
    return Array.from(this.featureConfigs.keys()).map((feature) => this.getFeatureStatus(feature));
  }

  /**
   * 활성화된 기능 목록 가져오기
   */
  public getEnabledFeatures(): Features[] {
    return Array.from(this.featureStates.entries())
      .filter(([, enabled]) => enabled)
      .map(([feature]) => feature);
  }

  /**
   * 비활성화된 기능 목록 가져오기
   */
  public getDisabledFeatures(): Features[] {
    return Array.from(this.featureStates.entries())
      .filter(([, enabled]) => !enabled)
      .map(([feature]) => feature);
  }

  /**
   * 기능 동적 활성화 (런타임 중)
   */
  public enableFeature(feature: Features): boolean {
    const config = this.featureConfigs.get(feature);
    if (!config) {
      return false;
    }

    // 기본 조건 재검사
    const enabled = this.evaluateFeature(feature, config);
    this.featureStates.set(feature, enabled);

    if (isDevelopment()) {
      console.log(`[FeatureManager] 기능 ${feature}: ${enabled ? '활성화' : '비활성화'}`);
    }

    return enabled;
  }

  /**
   * 기능 동적 비활성화 (런타임 중)
   */
  public disableFeature(feature: Features): void {
    this.featureStates.set(feature, false);

    if (isDevelopment()) {
      console.log(`[FeatureManager] 기능 ${feature}: 강제 비활성화`);
    }
  }

  /**
   * 기능 재평가 (환경변수 변경 후)
   */
  public reevaluateFeatures(): void {
    this.evaluateAllFeatures();

    if (isDevelopment()) {
      console.log('[FeatureManager] 모든 기능 재평가 완료');
      this.logFeatureStatuses();
    }
  }

  /**
   * 기능 상태 로깅 (개발 환경)
   */
  public logFeatureStatuses(): void {
    if (!isDevelopment()) {
      return;
    }

    console.log('\n=== 기능 상태 ===');

    const enabledFeatures = this.getEnabledFeatures();
    const disabledFeatures = this.getDisabledFeatures();

    console.log(`✅ 활성화된 기능 (${enabledFeatures.length}개):`);
    enabledFeatures.forEach((feature) => {
      const config = this.featureConfigs.get(feature);
      console.log(`  - ${feature}: ${config?.description || ''}`);
    });

    console.log(`❌ 비활성화된 기능 (${disabledFeatures.length}개):`);
    disabledFeatures.forEach((feature) => {
      const status = this.getFeatureStatus(feature);
      console.log(`  - ${feature}: ${status.reason || '알 수 없는 이유'}`);
    });

    console.log('================\n');
  }

  /**
   * 조건부 실행 헬퍼
   */
  public withFeature<T>(
    feature: Features,
    callback: () => T | Promise<T>,
    fallback?: () => T | Promise<T>
  ): T | Promise<T> | undefined {
    if (this.isFeatureEnabled(feature)) {
      return callback();
    } else if (fallback) {
      return fallback();
    }
    return undefined;
  }

  /**
   * 조건부 클래스 인스턴스 생성
   */
  public conditionalInstance<T>(
    feature: Features,
    factory: () => T,
    fallback?: () => T
  ): T | undefined {
    if (this.isFeatureEnabled(feature)) {
      return factory();
    } else if (fallback) {
      return fallback();
    }
    return undefined;
  }

  /**
   * 기능별 설정 가져오기
   */
  public getFeatureConfig(feature: Features): FeatureConfig | undefined {
    return this.featureConfigs.get(feature);
  }

  /**
   * 통계 정보 가져오기
   */
  public getStats(): {
    totalFeatures: number;
    enabledFeatures: number;
    disabledFeatures: number;
    enabledPercentage: number;
  } {
    const total = this.featureConfigs.size;
    const enabled = this.getEnabledFeatures().length;
    const disabled = this.getDisabledFeatures().length;

    return {
      totalFeatures: total,
      enabledFeatures: enabled,
      disabledFeatures: disabled,
      enabledPercentage: total > 0 ? Math.round((enabled / total) * 100) : 0,
    };
  }
}
