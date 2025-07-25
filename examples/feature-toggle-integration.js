// examples/feature-toggle-integration.js - Feature Toggle Integration Examples

import { Features, featureGate, withFeature, FeatureAwareService } from '../src/config/features/index.js';

/**
 * Example 1: Basic Feature Checking
 */
function basicExample() {
  console.log('\n📋 Example 1: Basic Feature Checking\n');
  
  // Simple feature check
  if (Features.is('activity_tracking')) {
    console.log('✅ Activity tracking is enabled');
  }
  
  // Get all enabled features
  const enabled = Features.enabled();
  console.log(`Enabled features: ${enabled.join(', ')}`);
  
  // Conditional execution
  Features.when('forum_integration', () => {
    console.log('🔧 Setting up forum integration...');
  });
  
  // Runtime feature control
  Features.enable('debug_logging', true); // temporary
  console.log(`Debug logging enabled: ${Features.is('debug_logging')}`);
}

/**
 * Example 2: Service Integration with Feature Gates
 */
class ActivityTrackingService extends FeatureAwareService {
  constructor() {
    super('ActivityTrackingService', ['activity_tracking', 'participant_tracking']);
  }

  @featureGate('activity_tracking', { 
    fallbackValue: false,
    logWarning: true 
  })
  async trackUserActivity(userId, channelId, action) {
    // This method only executes if activity_tracking feature is enabled
    console.log(`Tracking ${action} for user ${userId} in channel ${channelId}`);
    
    // Additional feature-specific logic
    if (Features.is('participant_tracking')) {
      console.log('📊 Enhanced participant tracking enabled');
      // Additional tracking logic
    }
    
    return true;
  }

  async processActivityEvent(event) {
    return this.execute('processActivityEvent', () => {
      console.log('Processing activity event:', event.type);
      
      // Feature-specific processing
      withFeature('advanced_permissions', () => {
        console.log('🔐 Applying advanced permission checks');
      });
      
      withFeature('performance_monitoring', () => {
        console.log('📈 Recording performance metrics');
      });
      
      return { processed: true, timestamp: Date.now() };
    }, () => {
      console.log('⚠️  Activity tracking disabled, event ignored');
      return { processed: false, reason: 'feature_disabled' };
    });
  }
}

/**
 * Example 3: Forum Integration Service
 */
class ForumIntegrationService {
  constructor() {
    this.featureService = Features.service('ForumIntegrationService', [
      'forum_integration',
      'voice_channel_integration'
    ]);
  }

  async createForumPost(voiceChannelData) {
    return this.featureService.executeAsync('createForumPost', async () => {
      console.log('📝 Creating forum post for voice channel');
      
      // Base forum post creation
      const post = {
        title: `Voice Channel: ${voiceChannelData.name}`,
        content: 'Auto-generated forum post',
        participants: voiceChannelData.participants
      };
      
      // Feature-enhanced content
      await withFeature('emoji_reactions', async () => {
        console.log('😎 Adding emoji reactions to forum post');
        post.reactions = ['👍', '🎤', '🎮'];
      });
      
      await withFeature('recruitment_system', async () => {
        console.log('📢 Adding recruitment information');
        post.recruitment = {
          recruiting: true,
          slots: voiceChannelData.maxParticipants - voiceChannelData.participants.length
        };
      });
      
      return post;
    }, async () => {
      console.log('⚠️  Forum integration disabled');
      return null;
    });
  }

  @featureGate('forum_integration')
  async updateForumPost(postId, participants) {
    console.log(`Updating forum post ${postId} with ${participants.length} participants`);
    
    // Conditional updates based on features
    const updates = {};
    
    Features.when('participant_tracking', () => {
      updates.participantHistory = participants.map(p => ({
        userId: p.id,
        joinTime: p.joinTime,
        displayName: p.displayName
      }));
    });
    
    Features.when('user_classification', () => {
      updates.classifications = participants.map(p => ({
        userId: p.id,
        classification: this.classifyUser(p)
      }));
    });
    
    return updates;
  }

  classifyUser(participant) {
    // Mock user classification
    return 'regular_member';
  }
}

/**
 * Example 4: Feature-Based Service Loading
 */
class ServiceManager {
  constructor() {
    this.loader = Features.loader();
    this.setupServiceLoading();
  }

  setupServiceLoading() {
    // Register services with their feature requirements
    this.loader.register('activityTracker', 
      () => import('../src/services/activityTracker.js'),
      ['activity_tracking']
    );
    
    this.loader.register('forumPostManager',
      () => import('../src/services/ForumPostManager.js'),
      ['forum_integration']
    );
    
    this.loader.register('recruitmentService',
      () => import('../src/services/RecruitmentService.js'),
      ['recruitment_system', 'forum_integration']
    );
    
    this.loader.register('emojiReactionService',
      () => import('../src/services/EmojiReactionService.js'),
      ['emoji_reactions', 'forum_integration']
    );
    
    this.loader.register('activityReportService',
      () => import('../src/services/activityReportService.js'),
      ['activity_reports', 'activity_tracking']
    );
  }

  async initializeServices() {
    console.log('\n🚀 Loading feature-enabled services...\n');
    
    const services = await this.loader.loadAll();
    
    Object.entries(services).forEach(([name, service]) => {
      if (service) {
        console.log(`✅ ${name} loaded and available`);
      } else {
        console.log(`⚠️  ${name} not loaded (features disabled)`);
      }
    });
    
    return services;
  }
}

/**
 * Example 5: Feature-Based Configuration
 */
function createBotConfiguration() {
  console.log('\n⚙️  Creating feature-based bot configuration...\n');
  
  const baseConfig = {
    name: 'Discord Activity Bot',
    intents: ['Guilds', 'GuildVoiceStates']
  };
  
  // Feature-based configuration enhancement
  const featureConfigs = {
    activity_tracking: {
      intents: [...baseConfig.intents, 'GuildMessages'],
      trackingInterval: 60000
    },
    
    forum_integration: {
      intents: [...baseConfig.intents, 'GuildMessages', 'MessageContent'],
      forumChannelId: process.env.FORUM_CHANNEL_ID
    },
    
    emoji_reactions: {
      intents: [...baseConfig.intents, 'GuildMessageReactions'],
      reactionDelay: 1000
    },
    
    recruitment_system: {
      recruitmentChannelId: process.env.RECRUITMENT_CHANNEL_ID,
      maxRecruitmentPosts: 10
    },
    
    debug_logging: {
      logLevel: 'debug',
      verboseErrors: true
    }
  };
  
  const config = Features.utils.createConfig(baseConfig, featureConfigs);
  
  // Remove duplicate intents
  if (config.intents) {
    config.intents = [...new Set(config.intents)];
  }
  
  console.log('Generated configuration:', JSON.stringify(config, null, 2));
  return config;
}

/**
 * Example 6: Feature Monitoring and Stats
 */
function monitorFeatures() {
  console.log('\n📊 Feature System Statistics\n');
  
  const stats = Features.stats();
  console.log(`Total features: ${stats.total}`);
  console.log(`Enabled: ${stats.enabled}`);
  console.log(`Disabled: ${stats.disabled}`);
  console.log(`Experimental: ${stats.experimental}`);
  console.log(`Environment: ${stats.environment}`);
  console.log(`Platform: ${stats.platform}`);
  
  // Feature change monitoring
  const toggle = Features.getFeatureToggle();
  
  toggle.onFeatureChange('activity_tracking', (enabled, featureName) => {
    console.log(`🔄 Feature ${featureName} changed: ${enabled ? 'enabled' : 'disabled'}`);
  });
  
  // Simulate feature changes
  setTimeout(() => {
    console.log('\n🔧 Testing feature toggle...');
    Features.disable('activity_tracking');
    setTimeout(() => {
      Features.enable('activity_tracking');
    }, 1000);
  }, 2000);
}

/**
 * Example 7: Advanced Feature Runner Patterns
 */
function advancedFeaturePatterns() {
  console.log('\n🎯 Advanced Feature Patterns\n');
  
  const runner = Features.runner();
  
  // Complex conditional logic
  runner
    .when('activity_tracking', () => {
      console.log('📊 Activity tracking enabled');
    })
    .whenAll(['forum_integration', 'recruitment_system'], () => {
      console.log('📢 Full recruitment system available');
    })
    .whenAny(['debug_logging', 'performance_monitoring'], () => {
      console.log('🔍 Some monitoring is available');
    })
    .ifElse('emoji_reactions',
      () => console.log('😎 Emoji reactions will be added'),
      () => console.log('⚪ Plain text posts only')
    );
  
  // Batch feature operations
  const batchResults = Features.batch.status([
    'activity_tracking',
    'forum_integration',
    'recruitment_system'
  ]);
  
  console.log('Batch feature status:', batchResults);
}

/**
 * Run all examples
 */
async function runAllExamples() {
  console.log('🎛️  Feature Toggle Integration Examples\n');
  console.log('=' .repeat(50));
  
  try {
    // Wait for features to initialize
    await Features.ensureInitialized();
    
    // Run examples
    basicExample();
    
    const activityService = new ActivityTrackingService();
    await activityService.trackUserActivity('user123', 'channel456', 'join');
    await activityService.processActivityEvent({ type: 'voice_join', userId: 'user123' });
    
    const forumService = new ForumIntegrationService();
    const post = await forumService.createForumPost({
      name: 'Test Channel',
      participants: [{ id: 'user1', displayName: 'User 1' }],
      maxParticipants: 10
    });
    console.log('Created forum post:', post);
    
    const serviceManager = new ServiceManager();
    await serviceManager.initializeServices();
    
    createBotConfiguration();
    monitorFeatures();
    advancedFeaturePatterns();
    
    console.log('\n' + '=' .repeat(50));
    console.log('\n✅ All feature toggle examples completed!');
    
  } catch (error) {
    console.error('\n❌ Error running examples:', error);
  }
}

// Run examples if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples().catch(console.error);
}

export {
  ActivityTrackingService,
  ForumIntegrationService,
  ServiceManager,
  runAllExamples
};