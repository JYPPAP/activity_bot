// src/config/features/index.js - Feature Toggle System Entry Point
import { 
  getFeatureToggle, 
  initializeFeatures, 
  isFeatureEnabled, 
  getEnabledFeatures,
  enableFeature,
  disableFeature
} from './FeatureToggle.js';

import {
  featureGate,
  withFeature,
  withFeatureAsync,
  createFeatureRunner,
  FeatureAwareService,
  FeatureComponentLoader,
  FeatureUtils,
  useFeature,
  FeatureBatch
} from './FeatureGate.js';

// Initialize features on module load
let initialized = false;
let initPromise = null;

/**
 * Ensure features are initialized
 */
async function ensureInitialized() {
  if (initialized) return;
  
  if (!initPromise) {
    initPromise = initializeFeatures();
  }
  
  await initPromise;
  initialized = true;
}

/**
 * Auto-initialize features when imported
 */
(async () => {
  try {
    await ensureInitialized();
  } catch (error) {
    console.error('Failed to auto-initialize features:', error);
  }
})();

// Re-export all functionality
export {
  // Core system
  getFeatureToggle,
  initializeFeatures,
  isFeatureEnabled,
  getEnabledFeatures,
  enableFeature,
  disableFeature,
  ensureInitialized,
  
  // Gates and utilities
  featureGate,
  withFeature,
  withFeatureAsync,
  createFeatureRunner,
  FeatureAwareService,
  FeatureComponentLoader,
  FeatureUtils,
  useFeature,
  FeatureBatch
};

// Export convenience functions for common patterns
export const Features = {
  // Quick checks
  is: isFeatureEnabled,
  enabled: getEnabledFeatures,
  
  // Runtime control
  enable: enableFeature,
  disable: disableFeature,
  
  // Conditional execution
  when: (feature, callback) => withFeature(feature, callback),
  whenAsync: (feature, callback) => withFeatureAsync(feature, callback),
  
  // Service integration
  service: (name, features) => new FeatureAwareService(name, features),
  loader: () => new FeatureComponentLoader(),
  runner: () => createFeatureRunner(),
  
  // Utilities
  utils: FeatureUtils,
  batch: FeatureBatch,
  
  // Statistics
  stats: () => getFeatureToggle().getStats(),
  all: () => getFeatureToggle().getAllFeatures()
};

// Default export
export default Features;