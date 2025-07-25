// examples/environment-usage.js - Example usage of the environment configuration system

import { 
  initializeEnvironment, 
  getConfig, 
  hasConfig,
  getAllConfig,
  isProduction,
  isDevelopment,
  isTermux,
  hasFeature,
  getEnvironmentInfo,
  getMetadata
} from '../src/config/environment/index.js';

/**
 * Example 1: Basic initialization and usage
 */
async function basicExample() {
  console.log('\n📋 Example 1: Basic Usage\n');
  
  // Initialize the environment system
  await initializeEnvironment();
  
  // Get simple configuration values
  const botToken = getConfig('discord.token');
  const serverPort = getConfig('server.port', 3000);
  const logLevel = getConfig('logging.level');
  
  console.log(`Bot Token: ${botToken ? '[REDACTED]' : 'Not set'}`);
  console.log(`Server Port: ${serverPort}`);
  console.log(`Log Level: ${logLevel}`);
  
  // Check environment
  console.log(`\nEnvironment: ${getEnvironmentInfo().environment}`);
  console.log(`Is Production: ${isProduction()}`);
  console.log(`Is Development: ${isDevelopment()}`);
  console.log(`Is Termux: ${isTermux()}`);
}

/**
 * Example 2: Working with nested configuration
 */
async function nestedConfigExample() {
  console.log('\n📋 Example 2: Nested Configuration\n');
  
  // Get nested values
  const channels = {
    log: getConfig('discord.channels.log'),
    calendar: getConfig('discord.channels.calendar'),
    forum: getConfig('discord.channels.forum'),
    excluded: getConfig('discord.channels.excluded', [])
  };
  
  console.log('Discord Channels:', channels);
  
  // Check if optional configs exist
  if (hasConfig('monitoring.slack.webhookUrl')) {
    console.log('Slack monitoring is configured');
    const slackConfig = {
      enabled: getConfig('monitoring.slack.enabled'),
      channel: getConfig('monitoring.slack.channel'),
      minLevel: getConfig('monitoring.slack.minLevel')
    };
    console.log('Slack Config:', slackConfig);
  }
}

/**
 * Example 3: Feature detection and platform-specific logic
 */
async function featureDetectionExample() {
  console.log('\n📋 Example 3: Feature Detection\n');
  
  const env = getEnvironmentInfo();
  console.log(`Platform: ${env.platform}`);
  console.log(`Features: ${env.features.join(', ')}`);
  
  // Platform-specific logic
  if (isTermux()) {
    console.log('\n📱 Running on Termux - applying mobile optimizations:');
    console.log('- Reduced connection pool size');
    console.log('- Lower memory cache limits');
    console.log('- Battery-friendly intervals');
  }
  
  // Feature-based logic
  if (hasFeature('pm2')) {
    console.log('\n🔄 Running under PM2 process manager');
    const pm2Info = getMetadata().pm2;
    console.log(`PM2 Instance ID: ${pm2Info?.id}`);
    console.log(`PM2 App Name: ${pm2Info?.name}`);
  }
  
  if (hasFeature('docker')) {
    console.log('\n🐳 Running in Docker container');
  }
  
  if (hasFeature('external-monitoring')) {
    console.log('\n📊 External monitoring is configured');
  }
}

/**
 * Example 4: Environment-specific behavior
 */
async function environmentSpecificExample() {
  console.log('\n📋 Example 4: Environment-Specific Behavior\n');
  
  if (isDevelopment()) {
    console.log('🔧 Development Mode:');
    console.log('- Debug logging enabled');
    console.log('- Hot reload active');
    console.log('- Database auto-sync enabled');
    console.log('- Detailed error messages');
    
    // Development-only features
    const devTools = {
      hotReload: getConfig('features.hotReload'),
      debugging: getConfig('features.debugging'),
      dbSync: getConfig('database.synchronize')
    };
    console.log('Dev Tools:', devTools);
  } else if (isProduction()) {
    console.log('🚀 Production Mode:');
    console.log('- Performance optimizations active');
    console.log('- Monitoring enabled');
    console.log('- Minimal logging');
    console.log('- Security hardening applied');
    
    // Production-only features
    const prodFeatures = {
      monitoring: getConfig('features.monitoring'),
      resourceOptimization: getConfig('features.resourceOptimization'),
      errorReporting: getConfig('features.errorReporting')
    };
    console.log('Production Features:', prodFeatures);
  }
}

/**
 * Example 5: System metadata and diagnostics
 */
async function systemMetadataExample() {
  console.log('\n📋 Example 5: System Metadata\n');
  
  const metadata = getMetadata();
  
  console.log('System Information:');
  console.log(`- Node Version: ${metadata.nodeVersion}`);
  console.log(`- Platform: ${metadata.platform} (${metadata.arch})`);
  console.log(`- CPUs: ${metadata.cpus}`);
  console.log(`- Total Memory: ${(metadata.totalMemory / 1024 / 1024 / 1024).toFixed(2)} GB`);
  console.log(`- Free Memory: ${(metadata.freeMemory / 1024 / 1024 / 1024).toFixed(2)} GB`);
  console.log(`- Uptime: ${(metadata.uptime / 3600).toFixed(2)} hours`);
  console.log(`- Process ID: ${metadata.pid}`);
  console.log(`- Timezone: ${metadata.timezone}`);
  console.log(`- Locale: ${metadata.locale}`);
}

/**
 * Example 6: Configuration validation
 */
async function validationExample() {
  console.log('\n📋 Example 6: Configuration Validation\n');
  
  try {
    // This would be done internally, but showing for example
    const allConfig = getAllConfig();
    
    // Check required Discord configuration
    const requiredDiscord = ['discord.token', 'discord.clientId', 'discord.guildId'];
    const missingDiscord = requiredDiscord.filter(path => !hasConfig(path));
    
    if (missingDiscord.length > 0) {
      console.log('❌ Missing required Discord configuration:');
      missingDiscord.forEach(path => console.log(`  - ${path}`));
    } else {
      console.log('✅ All required Discord configuration present');
    }
    
    // Check monitoring configuration
    if (isProduction() && !hasConfig('monitoring.errsole.enabled') && !hasConfig('monitoring.slack.enabled')) {
      console.log('⚠️  Warning: No monitoring configured for production');
    }
    
    // Validate configuration values
    const token = getConfig('discord.token');
    if (token && token.length < 50) {
      console.log('⚠️  Warning: Discord token seems too short');
    }
    
  } catch (error) {
    console.error('Configuration validation error:', error);
  }
}

/**
 * Example 7: Dynamic configuration usage
 */
async function dynamicConfigExample() {
  console.log('\n📋 Example 7: Dynamic Configuration Usage\n');
  
  // Database configuration based on environment
  const dbConfig = {
    type: getConfig('database.type'),
    database: getConfig('database.database'),
    logging: getConfig('database.logging'),
    synchronize: getConfig('database.synchronize')
  };
  
  console.log('Database Configuration:', dbConfig);
  
  // Activity tracking configuration
  const activityConfig = {
    trackingInterval: getConfig('activity.trackingInterval'),
    minActivityDuration: getConfig('activity.minActivityDuration'),
    excludeAfk: getConfig('activity.excludeAfk')
  };
  
  console.log('\nActivity Tracking:', activityConfig);
  console.log(`Tracking every ${activityConfig.trackingInterval / 1000} seconds`);
  console.log(`Minimum activity: ${activityConfig.minActivityDuration / 1000} seconds`);
  
  // Performance settings
  const perfConfig = {
    maxListeners: getConfig('performance.maxListeners'),
    gcInterval: getConfig('performance.gcInterval'),
    memoryThreshold: getConfig('performance.memoryThreshold')
  };
  
  console.log('\nPerformance Settings:', perfConfig);
}

/**
 * Run all examples
 */
async function runAllExamples() {
  console.log('🚀 Environment Configuration System Examples\n');
  console.log('=' .repeat(50));
  
  try {
    await basicExample();
    await nestedConfigExample();
    await featureDetectionExample();
    await environmentSpecificExample();
    await systemMetadataExample();
    await validationExample();
    await dynamicConfigExample();
    
    console.log('\n' + '=' .repeat(50));
    console.log('\n✅ All examples completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Error running examples:', error);
  }
}

// Run examples if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples().catch(console.error);
}