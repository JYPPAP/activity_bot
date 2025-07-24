// src/services/ConditionalServiceWrapper.ts - 조건부 서비스 래퍼
import { injectable, inject } from 'tsyringe';

import { FeatureManagerService, Features } from './FeatureManagerService';

/**
 * 기능 조건부 서비스 래퍼
 * 특정 기능이 활성화된 경우에만 서비스 메소드를 실행
 */
@injectable()
export class ConditionalServiceWrapper {
  constructor(@inject(FeatureManagerService) private featureManager: FeatureManagerService) {}

  /**
   * 기능 조건부 메소드 실행
   */
  public async executeIfFeatureEnabled<T>(
    feature: Features,
    callback: () => T | Promise<T>,
    fallbackMessage?: string
  ): Promise<T | null> {
    if (this.featureManager.isFeatureEnabled(feature)) {
      return await callback();
    } else {
      if (fallbackMessage) {
        console.log(`[ConditionalService] ${feature} 기능이 비활성화됨: ${fallbackMessage}`);
      }
      return null;
    }
  }

  /**
   * 이모지 반응 기능 조건부 실행
   */
  public async withEmojiReactions<T>(callback: () => T | Promise<T>): Promise<T | null> {
    return this.executeIfFeatureEnabled(
      Features.EMOJI_REACTIONS,
      callback,
      '이모지 반응 기능이 비활성화되어 있습니다.'
    );
  }

  /**
   * 포럼 통합 기능 조건부 실행
   */
  public async withForumIntegration<T>(callback: () => T | Promise<T>): Promise<T | null> {
    return this.executeIfFeatureEnabled(
      Features.FORUM_INTEGRATION,
      callback,
      '포럼 통합 기능이 비활성화되어 있습니다.'
    );
  }

  /**
   * Slack 알림 기능 조건부 실행
   */
  public async withSlackNotifications<T>(callback: () => T | Promise<T>): Promise<T | null> {
    return this.executeIfFeatureEnabled(
      Features.SLACK_NOTIFICATIONS,
      callback,
      'Slack 알림 기능이 비활성화되어 있습니다.'
    );
  }

  /**
   * Redis 캐싱 기능 조건부 실행
   */
  public async withRedisCache<T>(
    callback: () => T | Promise<T>,
    fallback?: () => T | Promise<T>
  ): Promise<T | null> {
    if (this.featureManager.isFeatureEnabled(Features.REDIS_CACHING)) {
      return await callback();
    } else if (fallback) {
      console.log('[ConditionalService] Redis 비활성화, 대체 로직 실행');
      return await fallback();
    }
    return null;
  }

  /**
   * PostgreSQL 기능 조건부 실행
   */
  public async withPostgreSQLSupport<T>(
    callback: () => T | Promise<T>,
    sqliteFallback?: () => T | Promise<T>
  ): Promise<T | null> {
    if (this.featureManager.isFeatureEnabled(Features.POSTGRESQL_SUPPORT)) {
      return await callback();
    } else if (sqliteFallback) {
      console.log('[ConditionalService] PostgreSQL 비활성화, SQLite 사용');
      return await sqliteFallback();
    }
    return null;
  }

  /**
   * 디버그 모드 조건부 실행
   */
  public withDebugMode<T>(callback: () => T | Promise<T>): T | Promise<T> | null {
    if (this.featureManager.isFeatureEnabled(Features.DEBUG_MODE)) {
      return callback();
    }
    return null;
  }

  /**
   * 성능 모니터링 조건부 실행
   */
  public async withPerformanceMonitoring<T>(
    callback: () => T | Promise<T>,
    label?: string
  ): Promise<T> {
    if (this.featureManager.isFeatureEnabled(Features.PERFORMANCE_MONITORING)) {
      const startTime = Date.now();
      const result = await callback();
      const endTime = Date.now();
      console.log(`[Performance] ${label || 'Operation'}: ${endTime - startTime}ms`);
      return result;
    } else {
      return await callback();
    }
  }

  /**
   * 다중 기능 조건부 실행 (AND 조건)
   */
  public async withAllFeatures<T>(
    features: Features[],
    callback: () => T | Promise<T>
  ): Promise<T | null> {
    if (this.featureManager.areAllFeaturesEnabled(features)) {
      return await callback();
    } else {
      const disabledFeatures = features.filter((f) => !this.featureManager.isFeatureEnabled(f));
      console.log(`[ConditionalService] 필요한 기능이 비활성화됨: ${disabledFeatures.join(', ')}`);
      return null;
    }
  }

  /**
   * 다중 기능 조건부 실행 (OR 조건)
   */
  public async withAnyFeature<T>(
    features: Features[],
    callback: () => T | Promise<T>
  ): Promise<T | null> {
    if (this.featureManager.isAnyFeatureEnabled(features)) {
      return await callback();
    } else {
      console.log(`[ConditionalService] 요구된 기능들이 모두 비활성화됨: ${features.join(', ')}`);
      return null;
    }
  }

  /**
   * 기능 상태에 따른 조건부 로직 실행
   */
  public async conditionalExecution<T>(
    conditions: Array<{
      features: Features[];
      logic: 'AND' | 'OR';
      callback: () => T | Promise<T>;
      label?: string;
    }>,
    defaultCallback?: () => T | Promise<T>
  ): Promise<T | null> {
    for (const condition of conditions) {
      const isEnabled =
        condition.logic === 'AND'
          ? this.featureManager.areAllFeaturesEnabled(condition.features)
          : this.featureManager.isAnyFeatureEnabled(condition.features);

      if (isEnabled) {
        if (condition.label) {
          console.log(`[ConditionalService] 조건 충족: ${condition.label}`);
        }
        return await condition.callback();
      }
    }

    if (defaultCallback) {
      console.log('[ConditionalService] 모든 조건 미충족, 기본 로직 실행');
      return await defaultCallback();
    }

    return null;
  }

  /**
   * 기능별 설정값 조건부 가져오기
   */
  public getFeatureConfig<T>(feature: Features, configGetter: () => T, defaultValue: T): T {
    if (this.featureManager.isFeatureEnabled(feature)) {
      return configGetter();
    }
    return defaultValue;
  }

  /**
   * 기능 상태 체크 및 경고 로그
   */
  public checkFeatureAndWarn(feature: Features, operationName: string): boolean {
    const isEnabled = this.featureManager.isFeatureEnabled(feature);

    if (!isEnabled) {
      const status = this.featureManager.getFeatureStatus(feature);
      console.warn(
        `[ConditionalService] ${operationName} 실행 불가: ${feature} 기능 비활성화 (${status.reason})`
      );
    }

    return isEnabled;
  }

  /**
   * 환경별 조건부 실행
   */
  public async executeForEnvironment<T>(
    environments: ('development' | 'production' | 'test')[],
    callback: () => T | Promise<T>
  ): Promise<T | null> {
    const currentEnv = (process.env.NODE_ENV as any) || 'development';

    if (environments.includes(currentEnv)) {
      return await callback();
    } else {
      console.log(`[ConditionalService] 현재 환경(${currentEnv})에서 실행되지 않음`);
      return null;
    }
  }

  /**
   * 기능 의존성 체크
   */
  public checkDependencies(feature: Features): {
    satisfied: boolean;
    missing: Features[];
  } {
    const config = this.featureManager.getFeatureConfig(feature);
    const missing: Features[] = [];

    if (config?.dependencies) {
      for (const dependency of config.dependencies) {
        if (!this.featureManager.isFeatureEnabled(dependency)) {
          missing.push(dependency);
        }
      }
    }

    return {
      satisfied: missing.length === 0,
      missing,
    };
  }

  /**
   * 기능 매니저 직접 액세스 (고급 사용)
   */
  public getFeatureManager(): FeatureManagerService {
    return this.featureManager;
  }
}
