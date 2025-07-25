// src/config/features/FeatureGate.js - Feature Gate Decorators and Utilities
import { getFeatureToggle, isFeatureEnabled } from './FeatureToggle.js';

/**
 * Feature gate decorator for methods
 * Prevents method execution if feature is disabled
 */
export function featureGate(featureName, options = {}) {
  const {
    fallbackValue = null,
    throwError = false,
    logWarning = true,
    onDisabled = null
  } = options;

  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = function(...args) {
      if (!isFeatureEnabled(featureName)) {
        if (logWarning) {
          console.warn(`🚫 Method ${propertyKey} blocked: feature '${featureName}' is disabled`);
        }

        if (onDisabled && typeof onDisabled === 'function') {
          return onDisabled.call(this, ...args);
        }

        if (throwError) {
          throw new Error(`Feature '${featureName}' is disabled`);
        }

        return fallbackValue;
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}

/**
 * Conditional feature gate - only execute if feature is enabled
 * More flexible than the decorator approach
 */
export function withFeature(featureName, callback, fallback = null) {
  if (isFeatureEnabled(featureName)) {
    return callback();
  }
  
  if (fallback && typeof fallback === 'function') {
    return fallback();
  }
  
  return fallback;
}

/**
 * Async version of withFeature
 */
export async function withFeatureAsync(featureName, callback, fallback = null) {
  if (isFeatureEnabled(featureName)) {
    return await callback();
  }
  
  if (fallback && typeof fallback === 'function') {
    return await fallback();
  }
  
  return fallback;
}

/**
 * Feature-based conditional execution
 */
export class FeatureGateRunner {
  constructor() {
    this.toggle = getFeatureToggle();
  }

  /**
   * Execute callback only if feature is enabled
   */
  when(featureName, callback) {
    if (this.toggle.isEnabled(featureName)) {
      return callback();
    }
    return this;
  }

  /**
   * Execute callback only if feature is disabled
   */
  whenDisabled(featureName, callback) {
    if (!this.toggle.isEnabled(featureName)) {
      return callback();
    }
    return this;
  }

  /**
   * Execute callback if any of the features are enabled
   */
  whenAny(featureNames, callback) {
    const enabled = featureNames.some(name => this.toggle.isEnabled(name));
    if (enabled) {
      return callback();
    }
    return this;
  }

  /**
   * Execute callback if all features are enabled
   */
  whenAll(featureNames, callback) {
    const allEnabled = featureNames.every(name => this.toggle.isEnabled(name));
    if (allEnabled) {
      return callback();
    }
    return this;
  }

  /**
   * Execute different callbacks based on feature state
   */
  ifElse(featureName, enabledCallback, disabledCallback) {
    if (this.toggle.isEnabled(featureName)) {
      return enabledCallback();
    } else {
      return disabledCallback();
    }
  }
}

/**
 * Create a new feature gate runner
 */
export function createFeatureRunner() {
  return new FeatureGateRunner();
}

/**
 * Feature-aware service wrapper
 * Wraps service methods with feature gates
 */
export class FeatureAwareService {
  constructor(serviceName, requiredFeatures = []) {
    this.serviceName = serviceName;
    this.requiredFeatures = requiredFeatures;
    this.toggle = getFeatureToggle();
  }

  /**
   * Check if service can operate based on feature requirements
   */
  isAvailable() {
    return this.requiredFeatures.every(feature => this.toggle.isEnabled(feature));
  }

  /**
   * Execute method with feature check
   */
  execute(methodName, callback, fallback = null) {
    if (!this.isAvailable()) {
      console.warn(`🚫 Service ${this.serviceName}.${methodName} unavailable: required features disabled`);
      
      if (fallback && typeof fallback === 'function') {
        return fallback();
      }
      
      return null;
    }

    return callback();
  }

  /**
   * Async version
   */
  async executeAsync(methodName, callback, fallback = null) {
    if (!this.isAvailable()) {
      console.warn(`🚫 Service ${this.serviceName}.${methodName} unavailable: required features disabled`);
      
      if (fallback && typeof fallback === 'function') {
        return await fallback();
      }
      
      return null;
    }

    return await callback();
  }
}

/**
 * Feature-aware component loader
 * Dynamically loads components based on enabled features
 */
export class FeatureComponentLoader {
  constructor() {
    this.components = new Map();
    this.toggle = getFeatureToggle();
  }

  /**
   * Register a component with feature requirements
   */
  register(name, loader, requiredFeatures = []) {
    this.components.set(name, {
      loader,
      requiredFeatures,
      instance: null,
      loaded: false
    });
  }

  /**
   * Load component if features are enabled
   */
  async load(name) {
    const component = this.components.get(name);
    if (!component) {
      throw new Error(`Unknown component: ${name}`);
    }

    // Check if required features are enabled
    const canLoad = component.requiredFeatures.every(feature => 
      this.toggle.isEnabled(feature)
    );

    if (!canLoad) {
      console.warn(`🚫 Component ${name} not loaded: required features disabled`);
      return null;
    }

    // Load if not already loaded
    if (!component.loaded) {
      try {
        component.instance = await component.loader();
        component.loaded = true;
        console.log(`✅ Component ${name} loaded successfully`);
      } catch (error) {
        console.error(`❌ Failed to load component ${name}:`, error);
        return null;
      }
    }

    return component.instance;
  }

  /**
   * Load all available components
   */
  async loadAll() {
    const results = {};
    
    for (const [name] of this.components) {
      results[name] = await this.load(name);
    }

    return results;
  }

  /**
   * Get loaded components
   */
  getLoaded() {
    const loaded = {};
    
    for (const [name, component] of this.components) {
      if (component.loaded && component.instance) {
        loaded[name] = component.instance;
      }
    }

    return loaded;
  }
}

/**
 * Feature flag utilities
 */
export const FeatureUtils = {
  /**
   * Create a feature-aware configuration object
   */
  createConfig(baseConfig, featureConfigs) {
    const config = { ...baseConfig };
    
    Object.entries(featureConfigs).forEach(([feature, featureConfig]) => {
      if (isFeatureEnabled(feature)) {
        Object.assign(config, featureConfig);
      }
    });

    return config;
  },

  /**
   * Filter array based on feature requirements
   */
  filterByFeatures(items, getFeatures) {
    return items.filter(item => {
      const features = getFeatures(item);
      return features.every(feature => isFeatureEnabled(feature));
    });
  },

  /**
   * Group items by feature availability
   */
  groupByFeatureAvailability(items, getFeatures) {
    const available = [];
    const unavailable = [];

    items.forEach(item => {
      const features = getFeatures(item);
      const isAvailable = features.length === 0 || features.every(feature => isFeatureEnabled(feature));
      
      if (isAvailable) {
        available.push(item);
      } else {
        unavailable.push(item);
      }
    });

    return { available, unavailable };
  },

  /**
   * Create a feature-aware middleware
   */
  createMiddleware(featureName, options = {}) {
    const {
      onDisabled = (req, res, next) => {
        res.status(404).json({ error: 'Feature not available' });
      },
      checkFunction = null
    } = options;

    return (req, res, next) => {
      let canProceed = isFeatureEnabled(featureName);

      // Additional check function
      if (canProceed && checkFunction) {
        canProceed = checkFunction(req, res);
      }

      if (canProceed) {
        next();
      } else {
        onDisabled(req, res, next);
      }
    };
  },

  /**
   * Feature-aware event handler
   */
  createEventHandler(featureName, handler, options = {}) {
    const { logDisabled = true } = options;

    return (...args) => {
      if (!isFeatureEnabled(featureName)) {
        if (logDisabled) {
          console.warn(`🚫 Event handler blocked: feature '${featureName}' is disabled`);
        }
        return;
      }

      return handler(...args);
    };
  }
};

/**
 * Feature toggle React-like hook pattern (for future use)
 */
export function useFeature(featureName) {
  const toggle = getFeatureToggle();
  
  return {
    enabled: toggle.isEnabled(featureName),
    enable: () => toggle.enableFeature(featureName),
    disable: () => toggle.disableFeature(featureName),
    reset: () => toggle.resetFeature(featureName),
    feature: toggle.features.get(featureName)
  };
}

/**
 * Batch feature operations
 */
export const FeatureBatch = {
  /**
   * Enable multiple features
   */
  enable(featureNames) {
    const toggle = getFeatureToggle();
    const results = {};
    
    featureNames.forEach(name => {
      results[name] = toggle.enableFeature(name);
    });

    return results;
  },

  /**
   * Disable multiple features
   */
  disable(featureNames) {
    const toggle = getFeatureToggle();
    const results = {};
    
    featureNames.forEach(name => {
      results[name] = toggle.disableFeature(name);
    });

    return results;
  },

  /**
   * Reset multiple features
   */
  reset(featureNames) {
    const toggle = getFeatureToggle();
    const results = {};
    
    featureNames.forEach(name => {
      results[name] = toggle.resetFeature(name);
    });

    return results;
  },

  /**
   * Check status of multiple features
   */
  status(featureNames) {
    const toggle = getFeatureToggle();
    const results = {};
    
    featureNames.forEach(name => {
      results[name] = toggle.isEnabled(name);
    });

    return results;
  }
};

// Export everything for convenience
export {
  FeatureGateRunner,
  FeatureAwareService,
  FeatureComponentLoader
};