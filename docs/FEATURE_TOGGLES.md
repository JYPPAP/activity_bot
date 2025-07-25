# Environment-Based Feature Toggle System

## Overview

The Feature Toggle System provides sophisticated, environment-aware feature flag management for the Discord Activity Bot. It enables safe deployment, A/B testing, gradual rollouts, and environment-specific feature control.

## Key Features

- 🌍 **Environment-Aware**: Automatic feature configuration based on detected environment
- 🎛️ **Runtime Control**: Enable/disable features without redeployment
- 🔒 **Dependency Management**: Features can depend on other features or services
- 🚀 **Performance-Aware**: Minimal overhead with intelligent caching
- 🛡️ **Safe by Default**: Graceful degradation when features are disabled
- 📊 **Monitoring**: Built-in statistics and change tracking
- 🔧 **Developer-Friendly**: Decorators, utilities, and easy integration patterns

## Quick Start

### Basic Usage

```javascript
import { Features } from './src/config/features/index.js';

// Check if a feature is enabled
if (Features.is('activity_tracking')) {
  console.log('Activity tracking is enabled');
}

// Conditional execution
Features.when('forum_integration', () => {
  setupForumIntegration();
});

// Runtime control
Features.enable('debug_logging');
Features.disable('experimental_features');
```

### Service Integration

```javascript
import { featureGate, FeatureAwareService } from './src/config/features/index.js';

class MyService extends FeatureAwareService {
  constructor() {
    super('MyService', ['activity_tracking']); // Required features
  }

  @featureGate('advanced_tracking', { fallbackValue: null })
  async trackAdvancedMetrics(data) {
    // This method only executes if 'advanced_tracking' is enabled
    return await this.processAdvancedTracking(data);
  }
}
```

## Core Features

### Discord Bot Features

| Feature | Description | Default | Dependencies |
|---------|-------------|---------|--------------|
| `activity_tracking` | Voice channel activity tracking | ✅ | `discord_client` |
| `forum_integration` | Forum post creation and management | ✅ | `activity_tracking` |
| `recruitment_system` | Recruitment posting system | ✅ | `forum_integration` |
| `emoji_reactions` | Automated emoji reactions | ✅ | `forum_integration` |
| `activity_reports` | Automated report generation | ✅* | `activity_tracking` |
| `participant_tracking` | Detailed participant tracking | ✅ | - |
| `calendar_logging` | Calendar-based logging | ❌ | - |
| `advanced_permissions` | Advanced permission system | ❌ | - |
| `user_classification` | User categorization | ❌ | - |

*Disabled in development environment

### System Features

| Feature | Description | Default | Environment |
|---------|-------------|---------|-------------|
| `resource_optimization` | Memory/CPU optimization | Auto** | All |
| `performance_monitoring` | Performance metrics | ❌ | Production |
| `debug_logging` | Enhanced debug output | ❌ | Development |
| `hot_reload` | Development hot reload | ❌ | Development |
| `error_reporting` | External error reporting | Auto*** | Production |
| `slack_notifications` | Slack alert integration | Auto*** | Production |

**Auto-enabled on Termux or when `limited-resources` detected  
***Auto-enabled when monitoring services are configured

### Experimental Features

| Feature | Description | Default | Notes |
|---------|-------------|---------|-------|
| `experimental_ui` | Experimental UI components | ❌ | Development only |
| `api_endpoints` | REST API endpoints | ❌ | Configurable |
| `mock_discord_client` | Mock client for testing | ❌ | Test environment |

## Configuration

### Environment-Specific Configuration

Features are configured in environment config files:

**development.config.js**:
```javascript
features: {
  // All core features enabled for testing
  activityTracking: true,
  forumIntegration: true,
  
  // Development-specific
  debugging: true,
  hotReload: true,
  experimentalUi: true,
  
  // Disabled for performance
  activityReports: false
}
```

**production.config.js**:
```javascript
features: {
  // Core features enabled
  activityTracking: true,
  forumIntegration: true,
  
  // Production optimizations
  resourceOptimization: true,
  performanceMonitoring: true,
  errorReporting: true,
  
  // Experimental disabled
  experimental: false
}
```

### Runtime Configuration

```javascript
// Environment variables
FEATURE_ACTIVITY_TRACKING=true
FEATURE_DEBUG_LOGGING=false

// Configuration override
getConfig('features.activityTracking', true)
```

## Usage Patterns

### 1. Feature Gates (Decorators)

```javascript
import { featureGate } from './src/config/features/index.js';

class ActivityService {
  @featureGate('activity_tracking', {
    fallbackValue: false,
    logWarning: true
  })
  async trackActivity(userId, action) {
    // Only executes if feature is enabled
    return await this.doTracking(userId, action);
  }
  
  @featureGate('advanced_tracking', {
    throwError: true
  })
  async advancedTracking(data) {
    // Throws error if feature disabled
    return await this.processAdvanced(data);
  }
}
```

### 2. Conditional Execution

```javascript
import { withFeature, Features } from './src/config/features/index.js';

// Simple conditional
const result = withFeature('forum_integration', () => {
  return createForumPost(data);
}, () => {
  return { created: false, reason: 'feature_disabled' };
});

// Async conditional
const post = await withFeatureAsync('forum_integration', async () => {
  return await createForumPostAsync(data);
});

// Feature runner pattern
Features.runner()
  .when('activity_tracking', () => {
    console.log('Starting activity tracking');
  })
  .whenAll(['forum_integration', 'recruitment_system'], () => {
    console.log('Full recruitment system available');
  })
  .ifElse('debug_logging',
    () => console.log('Debug mode active'),
    () => console.log('Production mode')
  );
```

### 3. Service Integration

```javascript
import { FeatureAwareService } from './src/config/features/index.js';

class ForumService extends FeatureAwareService {
  constructor() {
    super('ForumService', ['forum_integration', 'activity_tracking']);
  }
  
  async createPost(data) {
    return this.executeAsync('createPost', async () => {
      // Core functionality
      const post = await this.doCreatePost(data);
      
      // Feature-enhanced functionality
      Features.when('emoji_reactions', () => {
        this.addEmojiReactions(post);
      });
      
      Features.when('recruitment_system', () => {
        this.addRecruitmentInfo(post);
      });
      
      return post;
    }, async () => {
      // Fallback when service unavailable
      return { error: 'Forum integration disabled' };
    });
  }
}
```

### 4. Component Loading

```javascript
import { FeatureComponentLoader } from './src/config/features/index.js';

const loader = new FeatureComponentLoader();

// Register components with feature requirements
loader.register('activityTracker', 
  () => import('./services/activityTracker.js'),
  ['activity_tracking']
);

loader.register('forumManager',
  () => import('./services/ForumPostManager.js'),
  ['forum_integration']
);

// Load only enabled components
const components = await loader.loadAll();
```

### 5. Configuration Generation

```javascript
import { FeatureUtils } from './src/config/features/index.js';

const baseConfig = {
  intents: ['Guilds', 'GuildVoiceStates']
};

const featureConfigs = {
  activity_tracking: {
    intents: ['GuildMessages'],
    trackingInterval: 60000
  },
  forum_integration: {
    intents: ['MessageContent'],
    forumChannelId: process.env.FORUM_CHANNEL_ID
  }
};

// Generate feature-aware configuration
const config = FeatureUtils.createConfig(baseConfig, featureConfigs);
```

## API Reference

### Core Functions

```javascript
// Feature checking
Features.is(featureName): boolean
Features.enabled(): string[]

// Runtime control
Features.enable(featureName, temporary?: boolean): boolean
Features.disable(featureName): boolean

// Statistics
Features.stats(): FeatureStats
Features.all(): FeatureMap
```

### Decorators

```javascript
@featureGate(featureName, options?)
// Options:
// - fallbackValue: any - Return value when disabled
// - throwError: boolean - Throw error when disabled
// - logWarning: boolean - Log warning when disabled
// - onDisabled: function - Custom disabled handler
```

### Utilities

```javascript
// Conditional execution
withFeature(feature, callback, fallback?)
withFeatureAsync(feature, callback, fallback?)

// Feature runner
createFeatureRunner()
  .when(feature, callback)
  .whenAll(features, callback)
  .whenAny(features, callback)
  .ifElse(feature, enabled, disabled)

// Service integration
new FeatureAwareService(name, requiredFeatures)
  .execute(method, callback, fallback?)
  .executeAsync(method, callback, fallback?)

// Component loading
new FeatureComponentLoader()
  .register(name, loader, requiredFeatures)
  .load(name)
  .loadAll()
```

### Batch Operations

```javascript
Features.batch.enable(featureNames)
Features.batch.disable(featureNames)
Features.batch.status(featureNames)
Features.batch.reset(featureNames)
```

## Advanced Features

### Feature Dependencies

```javascript
// Define feature with dependencies
defineFeature('recruitment_system', {
  dependencies: ['forum_integration', 'activity_tracking'],
  requiredServices: ['RecruitmentService']
});

// Feature automatically disabled if dependencies aren't met
```

### Custom Conditions

```javascript
defineFeature('memory_intensive_feature', {
  conditions: {
    memoryThreshold: 500, // MB
    timeRange: { start: 9, end: 17 }, // Business hours
    environment: ['production', 'staging']
  }
});

// Or function-based conditions
defineFeature('custom_feature', {
  conditions: (env, toggle) => {
    return env.platform !== 'termux' && process.memoryUsage().heapUsed < 100 * 1024 * 1024;
  }
});
```

### Feature Change Listeners

```javascript
const toggle = Features.getFeatureToggle();

toggle.onFeatureChange('activity_tracking', (enabled, feature) => {
  if (enabled) {
    console.log('Activity tracking enabled - initializing...');
    initializeActivityTracking();
  } else {
    console.log('Activity tracking disabled - cleaning up...');
    cleanupActivityTracking();
  }
});
```

### Environment-Specific Overrides

```javascript
// Platform-specific configuration
features: {
  platforms: {
    termux: {
      resourceOptimization: true,
      performanceMonitoring: false
    },
    linux: {
      performanceMonitoring: true
    }
  }
}
```

## Best Practices

### 1. Feature Naming

- Use descriptive, hierarchical names: `activity_tracking`, `forum_integration`
- Group related features: `debug_*`, `experimental_*`
- Avoid negatives: Use `enable_feature` not `disable_feature`

### 2. Default Values

- Core features should default to `true`
- Experimental features should default to `false`
- Performance features should be environment-aware

### 3. Graceful Degradation

```javascript
// Good: Provide fallback functionality
@featureGate('advanced_tracking', { 
  fallbackValue: { tracked: false, reason: 'feature_disabled' }
})
async trackAdvanced(data) {
  return await this.doAdvancedTracking(data);
}

// Better: Provide meaningful alternatives
async trackActivity(data) {
  if (Features.is('advanced_tracking')) {
    return await this.trackAdvanced(data);
  } else {
    return await this.trackBasic(data);
  }
}
```

### 4. Performance Considerations

- Cache feature states in hot paths
- Use feature gates for expensive operations
- Consider memory usage of disabled features

```javascript
// Cache feature state for hot paths
class PerformanceCriticalService {
  constructor() {
    this.trackingEnabled = Features.is('activity_tracking');
    
    // Update cache when feature changes
    Features.getFeatureToggle().onFeatureChange('activity_tracking', (enabled) => {
      this.trackingEnabled = enabled;
    });
  }
  
  hotPath() {
    if (this.trackingEnabled) {
      // Use cached value instead of checking every time
      this.track();
    }
  }
}
```

### 5. Testing with Feature Toggles

```javascript
// Test with features enabled
beforeEach(() => {
  Features.enable('test_feature');
});

afterEach(() => {
  Features.reset('test_feature');
});

// Test both enabled and disabled states
describe('Feature-dependent functionality', () => {
  it('should work when feature enabled', () => {
    Features.enable('my_feature');
    expect(myFunction()).toBe(expectedValue);
  });
  
  it('should fallback when feature disabled', () => {
    Features.disable('my_feature');
    expect(myFunction()).toBe(fallbackValue);
  });
});
```

## Monitoring and Debugging

### Feature Statistics

```javascript
const stats = Features.stats();
console.log(`Features: ${stats.enabled}/${stats.total} enabled`);
console.log(`Environment: ${stats.environment} on ${stats.platform}`);
```

### Debug Information

```javascript
// Get all feature states
const allFeatures = Features.all();
Object.entries(allFeatures).forEach(([name, feature]) => {
  console.log(`${name}: ${feature.enabled ? '✅' : '❌'} (${feature.description})`);
});

// Monitor feature changes
Features.getFeatureToggle().onFeatureChange('*', (enabled, feature) => {
  console.log(`Feature ${feature} changed: ${enabled}`);
});
```

### Performance Monitoring

```javascript
// Monitor feature toggle performance
const start = Date.now();
const isEnabled = Features.is('my_feature');
const duration = Date.now() - start;

if (duration > 1) {
  console.warn(`Feature check took ${duration}ms - consider caching`);
}
```

## Migration Guide

### From Environment Variables

```javascript
// Before
if (process.env.ENABLE_TRACKING === 'true') {
  doTracking();
}

// After
Features.when('activity_tracking', () => {
  doTracking();
});
```

### From Configuration Flags

```javascript
// Before
if (config.features.forumIntegration) {
  setupForum();
}

// After
Features.when('forum_integration', () => {
  setupForum();
});
```

### Gradual Migration

1. Start with wrapper functions
2. Gradually add decorators
3. Convert to feature-aware services
4. Remove old configuration flags

## Troubleshooting

### Common Issues

1. **Feature not working despite being enabled**
   - Check dependencies are met
   - Verify required services are available
   - Check custom conditions

2. **Performance issues**
   - Cache feature states in hot paths
   - Use batch operations
   - Monitor feature check frequency

3. **Configuration not loading**
   - Ensure environment is properly detected
   - Check configuration file syntax
   - Verify environment variable names

### Debug Commands

```javascript
// Get feature debug info
console.log(Features.getFeatureToggle().features.get('my_feature'));

// Clear feature cache
Features.getFeatureToggle().clearAllCache();

// Reset all features to defaults
Features.batch.reset(Features.enabled());
```

## Examples

See `examples/feature-toggle-integration.js` for comprehensive usage examples including:

- Service integration patterns
- Component loading strategies
- Configuration generation
- Monitoring and statistics
- Advanced conditional logic

## License

This feature toggle system is part of the Discord Activity Bot project.