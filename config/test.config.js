// config/test.config.js - Test environment configuration
export default {
  // Server configuration for testing
  server: {
    port: 0, // Random port for parallel tests
    host: 'localhost'
  },

  // Minimal logging for tests
  logging: {
    level: 'error',
    format: 'json',
    timestamp: false,
    silent: true // Suppress logs during tests
  },

  // Test features
  features: {
    // Core features (minimal for testing)
    activityTracking: true,
    voiceChannelIntegration: true,
    forumIntegration: true,
    recruitmentSystem: true,
    commandSystem: true,
    participantTracking: false, // Disabled for faster tests
    emojiReactions: false,
    
    // Optional features (disabled for speed)
    activityReports: false,
    calendarLogging: false,
    advancedPermissions: false,
    userClassification: false,
    
    // System features
    monitoring: false,
    debugging: true,
    hotReload: false,
    resourceOptimization: false,
    performanceMonitoring: false,
    debugLogging: false,
    errorReporting: false,
    slackNotifications: false,
    
    // Test-specific features
    mockDiscordClient: true,
    testFixtures: true,
    experimental: false
  },

  // In-memory database for tests
  database: {
    type: 'sqlite',
    database: ':memory:',
    synchronize: true,
    logging: false,
    dropSchema: true // Fresh database for each test
  },

  // Discord test settings
  discord: {
    // Use test token
    testMode: true,
    cache: {
      messages: 10,
      users: 10
    },
    // Mock Discord client
    mock: {
      enabled: true,
      guilds: ['test-guild-id'],
      channels: ['test-channel-id'],
      users: ['test-user-id']
    }
  },

  // Fast intervals for testing
  activity: {
    trackingInterval: 1000, // 1 second
    minActivityDuration: 1000, // 1 second
    maxIdleTime: 2000, // 2 seconds
    reportSchedule: null, // Disable scheduled reports
    testMode: true
  },

  // Test command settings
  commands: {
    prefix: '!test',
    cooldown: 0, // No cooldown in tests
    testMode: true
  },

  // Disable integrations for tests
  integrations: {
    errsole: {
      enabled: false
    },
    slack: {
      enabled: false
    }
  },

  // Test utilities
  test: {
    timeout: 30000, // 30 seconds per test
    retries: 0,
    parallel: true,
    coverage: {
      enabled: true,
      threshold: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    },
    fixtures: {
      users: 5,
      channels: 3,
      messages: 20
    }
  }
};