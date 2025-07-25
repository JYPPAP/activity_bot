// src/config/features/FeatureToggle.js - Environment-based Feature Toggle System
import { 
  getConfig, 
  hasConfig,
  getEnvironmentInfo,
  isProduction,
  isDevelopment, 
  isTest,
  isTermux,
  hasFeature
} from '../environment/index.js';

/**
 * FeatureToggle - Environment-aware feature flag management system
 */
export class FeatureToggle {
  constructor() {
    this.features = new Map();
    this.cache = new Map();
    this.listeners = new Map();
    this.environment = null;
    this.initialized = false;
  }

  /**
   * Initialize the feature toggle system
   */
  async initialize() {
    if (this.initialized) return;

    try {
      this.environment = getEnvironmentInfo();
      await this.loadFeatureDefinitions();
      this.setupEnvironmentSpecificFeatures();
      this.initialized = true;
      
      console.log(`🎛️  Feature Toggle System initialized for ${this.environment.environment} environment`);
      console.log(`🔧 Loaded ${this.features.size} feature definitions`);
      
    } catch (error) {
      console.error('❌ Failed to initialize feature toggle system:', error);
      // Graceful degradation - continue with empty features
      this.initialized = true;
    }
  }

  /**
   * Load feature definitions from configuration
   */
  async loadFeatureDefinitions() {
    // Core Discord Bot Features
    this.defineFeature('activity_tracking', {
      description: 'Voice channel activity tracking',
      default: true,
      environments: {
        development: true,
        production: true,
        test: false
      },
      platforms: {
        termux: true,
        linux: true,
        windows: true,
        macos: true
      },
      dependencies: ['discord_client'],
      requiredServices: ['DatabaseManager', 'VoiceChannelManager']
    });

    this.defineFeature('forum_integration', {
      description: 'Forum post creation and management',
      default: true,
      environments: {
        development: true,
        production: true,
        test: false
      },
      dependencies: ['activity_tracking'],
      requiredServices: ['ForumPostManager', 'VoiceChannelForumIntegrationService']
    });

    this.defineFeature('recruitment_system', {
      description: 'Recruitment posting and management',
      default: true,
      environments: {
        development: true,
        production: true,
        test: false
      },
      dependencies: ['forum_integration'],
      requiredServices: ['RecruitmentService', 'RecruitmentUIBuilder']
    });

    this.defineFeature('emoji_reactions', {
      description: 'Automated emoji reactions to posts',
      default: true,
      environments: {
        development: true,
        production: true,
        test: false
      },
      dependencies: ['forum_integration'],
      requiredServices: ['EmojiReactionService']
    });

    this.defineFeature('activity_reports', {
      description: 'Automated activity report generation',
      default: true,
      environments: {
        development: false, // Usually disabled in dev
        production: true,
        test: false
      },
      schedule: {
        enabled: true,
        cron: '0 9 * * MON' // Every Monday at 9 AM
      },
      requiredServices: ['activityReportService']
    });

    this.defineFeature('calendar_logging', {
      description: 'Calendar-based activity logging',
      default: false,
      environments: {
        development: true,
        production: getConfig('features.calendarLogging', false),
        test: false
      },
      requiredServices: ['calendarLogService']
    });

    this.defineFeature('advanced_permissions', {
      description: 'Advanced permission system',
      default: false,
      environments: {
        development: true,
        production: true,
        test: false
      },
      requiredServices: ['PermissionService']
    });

    this.defineFeature('participant_tracking', {
      description: 'Detailed participant tracking',
      default: true,
      environments: {
        development: true,
        production: true,
        test: false
      },
      requiredServices: ['ParticipantTracker'],
      performanceImpact: 'medium'
    });

    this.defineFeature('user_classification', {
      description: 'User classification and categorization',
      default: false,
      environments: {
        development: true,
        production: getConfig('features.userClassification', false),
        test: false
      },
      requiredServices: ['UserClassificationService']
    });

    // Performance and Resource Features
    this.defineFeature('resource_optimization', {
      description: 'Resource usage optimization',
      default: false,
      environments: {
        development: false,
        production: isTermux() || hasFeature('limited-resources'),
        test: false
      },
      platforms: {
        termux: true, // Always enabled on Termux
        linux: getConfig('features.resourceOptimization', false),
        windows: getConfig('features.resourceOptimization', false),
        macos: getConfig('features.resourceOptimization', false)
      }
    });

    this.defineFeature('performance_monitoring', {
      description: 'Performance metrics collection',
      default: false,
      environments: {
        development: true,
        production: getConfig('monitoring.performance.enabled', true),
        test: false
      },
      requiredServices: ['PerformanceMonitor']
    });

    // Debugging and Development Features
    this.defineFeature('debug_logging', {
      description: 'Enhanced debug logging',
      default: false,
      environments: {
        development: true,
        production: false,
        test: true
      }
    });

    this.defineFeature('hot_reload', {
      description: 'Hot reload for development',
      default: false,
      environments: {
        development: getConfig('features.hotReload', false),
        production: false,
        test: false
      }
    });

    this.defineFeature('mock_discord_client', {
      description: 'Mock Discord client for testing',
      default: false,
      environments: {
        development: false,
        production: false,
        test: true
      }
    });

    // Monitoring and Error Reporting Features
    this.defineFeature('error_reporting', {
      description: 'External error reporting',
      default: false,
      environments: {
        development: false,
        production: hasConfig('monitoring.errsole.enabled') || hasConfig('monitoring.slack.enabled'),
        test: false
      },
      dependencies: ['monitoring_service']
    });

    this.defineFeature('slack_notifications', {
      description: 'Slack notifications for alerts',
      default: false,
      environments: {
        development: false,
        production: getConfig('monitoring.slack.enabled', false),
        test: false
      },
      dependencies: ['monitoring_service']
    });

    // Experimental Features
    this.defineFeature('experimental_ui', {
      description: 'Experimental UI components',
      default: false,
      environments: {
        development: getConfig('features.experimental', false),
        production: false,
        test: false
      },
      experimental: true
    });

    this.defineFeature('api_endpoints', {
      description: 'REST API endpoints',
      default: false,
      environments: {
        development: getConfig('api.enabled', false),
        production: getConfig('api.enabled', false),
        test: false
      },
      requiredServices: ['APIServer']
    });

    // Load custom features from configuration
    await this.loadCustomFeatures();
  }

  /**
   * Load custom features from environment configuration
   */
  async loadCustomFeatures() {
    const customFeatures = getConfig('features.custom', {});
    
    Object.entries(customFeatures).forEach(([name, config]) => {
      this.defineFeature(name, {
        description: config.description || `Custom feature: ${name}`,
        default: config.default || false,
        environments: config.environments || {},
        dependencies: config.dependencies || [],
        requiredServices: config.requiredServices || [],
        experimental: config.experimental || false,
        ...config
      });
    });
  }

  /**
   * Setup environment-specific feature configurations
   */
  setupEnvironmentSpecificFeatures() {
    const env = this.environment.environment;
    const platform = this.environment.platform;
    
    // Apply environment-specific overrides
    const envFeatures = getConfig(`features.${env}`, {});
    Object.entries(envFeatures).forEach(([featureName, enabled]) => {
      if (this.features.has(featureName)) {
        const feature = this.features.get(featureName);
        feature.environmentOverride = enabled;
      }
    });

    // Apply platform-specific overrides
    const platformFeatures = getConfig(`features.platforms.${platform}`, {});
    Object.entries(platformFeatures).forEach(([featureName, enabled]) => {
      if (this.features.has(featureName)) {
        const feature = this.features.get(featureName);
        feature.platformOverride = enabled;
      }
    });

    // Auto-enable features based on available services
    this.autoEnableBasedOnServices();
  }

  /**
   * Auto-enable features based on available services
   */
  autoEnableBasedOnServices() {
    // This would check if required services are available
    // For now, we assume all services are available
    console.log('🔍 Auto-enabling features based on available services...');
  }

  /**
   * Define a feature with its configuration
   */
  defineFeature(name, config) {
    const feature = {
      name,
      description: config.description || '',
      default: config.default || false,
      environments: config.environments || {},
      platforms: config.platforms || {},
      dependencies: config.dependencies || [],
      requiredServices: config.requiredServices || [],
      performanceImpact: config.performanceImpact || 'low',
      experimental: config.experimental || false,
      schedule: config.schedule || null,
      conditions: config.conditions || null,
      environmentOverride: null,
      platformOverride: null,
      runtimeOverride: null,
      ...config
    };

    this.features.set(name, feature);
  }

  /**
   * Check if a feature is enabled
   */
  isEnabled(featureName) {
    if (!this.initialized) {
      console.warn(`Feature toggle not initialized, defaulting ${featureName} to false`);
      return false;
    }

    // Check cache first
    const cacheKey = `enabled_${featureName}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const enabled = this.calculateFeatureState(featureName);
    
    // Cache result for performance
    this.cache.set(cacheKey, enabled);
    
    return enabled;
  }

  /**
   * Calculate feature state based on all conditions
   */
  calculateFeatureState(featureName) {
    const feature = this.features.get(featureName);
    if (!feature) {
      console.warn(`Unknown feature: ${featureName}`);
      return false;
    }

    // Priority order: runtime > environment config > platform > environment > default
    
    // 1. Runtime override (highest priority)
    if (feature.runtimeOverride !== null) {
      return feature.runtimeOverride;
    }

    // 2. Environment configuration override
    if (feature.environmentOverride !== null) {
      return feature.environmentOverride;
    }

    // 3. Platform-specific configuration
    if (feature.platformOverride !== null) {
      return feature.platformOverride;
    }

    // 4. Platform-specific default
    const platform = this.environment.platform;
    if (feature.platforms && feature.platforms[platform] !== undefined) {
      return feature.platforms[platform];
    }

    // 5. Environment-specific default
    const env = this.environment.environment;
    if (feature.environments && feature.environments[env] !== undefined) {
      return feature.environments[env];
    }

    // 6. Check dependencies
    if (feature.dependencies && feature.dependencies.length > 0) {
      const dependenciesMet = feature.dependencies.every(dep => this.isEnabled(dep));
      if (!dependenciesMet) {
        return false;
      }
    }

    // 7. Check custom conditions
    if (feature.conditions) {
      try {
        const conditionResult = this.evaluateConditions(feature.conditions);
        if (!conditionResult) {
          return false;
        }
      } catch (error) {
        console.error(`Error evaluating conditions for feature ${featureName}:`, error);
        return false;
      }
    }

    // 8. Default value
    return feature.default;
  }

  /**
   * Evaluate custom conditions
   */
  evaluateConditions(conditions) {
    if (typeof conditions === 'function') {
      return conditions(this.environment, this);
    }

    if (typeof conditions === 'object') {
      // Support for complex condition objects
      if (conditions.memoryThreshold) {
        const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024; // MB
        return memoryUsage < conditions.memoryThreshold;
      }

      if (conditions.timeRange) {
        const now = new Date();
        const hour = now.getHours();
        return hour >= conditions.timeRange.start && hour <= conditions.timeRange.end;
      }

      if (conditions.environment) {
        return conditions.environment.includes(this.environment.environment);
      }
    }

    return true;
  }

  /**
   * Temporarily enable a feature at runtime
   */
  enableFeature(featureName, temporary = false) {
    const feature = this.features.get(featureName);
    if (!feature) {
      console.warn(`Cannot enable unknown feature: ${featureName}`);
      return false;
    }

    feature.runtimeOverride = true;
    this.clearCache(featureName);
    
    console.log(`✅ Feature enabled: ${featureName}${temporary ? ' (temporary)' : ''}`);
    
    if (temporary) {
      // Auto-disable after 1 hour
      setTimeout(() => {
        this.disableFeature(featureName);
      }, 60 * 60 * 1000);
    }

    this.notifyListeners(featureName, true);
    return true;
  }

  /**
   * Temporarily disable a feature at runtime
   */
  disableFeature(featureName) {
    const feature = this.features.get(featureName);
    if (!feature) {
      console.warn(`Cannot disable unknown feature: ${featureName}`);
      return false;
    }

    feature.runtimeOverride = false;
    this.clearCache(featureName);
    
    console.log(`❌ Feature disabled: ${featureName}`);
    this.notifyListeners(featureName, false);
    return true;
  }

  /**
   * Reset feature to its default state
   */
  resetFeature(featureName) {
    const feature = this.features.get(featureName);
    if (!feature) {
      console.warn(`Cannot reset unknown feature: ${featureName}`);
      return false;
    }

    feature.runtimeOverride = null;
    this.clearCache(featureName);
    
    console.log(`🔄 Feature reset: ${featureName}`);
    this.notifyListeners(featureName, this.isEnabled(featureName));
    return true;
  }

  /**
   * Get all feature states
   */
  getAllFeatures() {
    const features = {};
    for (const [name] of this.features) {
      features[name] = {
        enabled: this.isEnabled(name),
        ...this.features.get(name)
      };
    }
    return features;
  }

  /**
   * Get enabled features only
   */
  getEnabledFeatures() {
    const enabled = [];
    for (const [name] of this.features) {
      if (this.isEnabled(name)) {
        enabled.push(name);
      }
    }
    return enabled;
  }

  /**
   * Register a listener for feature changes
   */
  onFeatureChange(featureName, callback) {
    if (!this.listeners.has(featureName)) {
      this.listeners.set(featureName, []);
    }
    this.listeners.get(featureName).push(callback);
  }

  /**
   * Notify listeners of feature changes
   */
  notifyListeners(featureName, enabled) {
    const listeners = this.listeners.get(featureName);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(enabled, featureName);
        } catch (error) {
          console.error(`Error in feature change listener for ${featureName}:`, error);
        }
      });
    }
  }

  /**
   * Clear cache for a specific feature
   */
  clearCache(featureName) {
    this.cache.delete(`enabled_${featureName}`);
  }

  /**
   * Clear all cache
   */
  clearAllCache() {
    this.cache.clear();
  }

  /**
   * Get feature statistics
   */
  getStats() {
    const total = this.features.size;
    const enabled = this.getEnabledFeatures().length;
    const experimental = Array.from(this.features.values()).filter(f => f.experimental).length;
    
    return {
      total,
      enabled,
      disabled: total - enabled,
      experimental,
      environment: this.environment.environment,
      platform: this.environment.platform,
      cacheSize: this.cache.size
    };
  }
}

// Create singleton instance
let featureToggle = null;

/**
 * Get the feature toggle instance
 */
export function getFeatureToggle() {
  if (!featureToggle) {
    featureToggle = new FeatureToggle();
  }
  return featureToggle;
}

/**
 * Initialize feature toggle system
 */
export async function initializeFeatures() {
  const toggle = getFeatureToggle();
  await toggle.initialize();
  return toggle;
}

/**
 * Check if a feature is enabled (convenience function)
 */
export function isFeatureEnabled(featureName) {
  const toggle = getFeatureToggle();
  return toggle.isEnabled(featureName);
}

/**
 * Get all enabled features (convenience function)
 */
export function getEnabledFeatures() {
  const toggle = getFeatureToggle();
  return toggle.getEnabledFeatures();
}

/**
 * Enable a feature at runtime (convenience function)
 */
export function enableFeature(featureName, temporary = false) {
  const toggle = getFeatureToggle();
  return toggle.enableFeature(featureName, temporary);
}

/**
 * Disable a feature at runtime (convenience function)
 */
export function disableFeature(featureName) {
  const toggle = getFeatureToggle();
  return toggle.disableFeature(featureName);
}

// Export the main class
export default FeatureToggle;