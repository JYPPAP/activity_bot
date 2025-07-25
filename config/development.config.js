// config/development.config.js - Development environment configuration
export default {
  // Server configuration for development
  server: {
    port: 3000,
    host: 'localhost',
    cors: {
      enabled: true,
      origin: ['http://localhost:3000', 'http://localhost:3001'],
      credentials: true
    }
  },

  // Enhanced logging for development
  logging: {
    level: 'debug',
    format: 'pretty',
    timestamp: true,
    colorize: true,
    prettyPrint: true,
    handleExceptions: true,
    handleRejections: true
  },

  // Development features
  features: {
    // Core features (all enabled for testing)
    activityTracking: true,
    voiceChannelIntegration: true,
    forumIntegration: true,
    recruitmentSystem: true,
    commandSystem: true,
    participantTracking: true,
    emojiReactions: true,
    
    // Optional features (enabled for testing)
    activityReports: false, // Usually disabled in dev
    calendarLogging: true,
    advancedPermissions: true,
    userClassification: true,
    
    // System features
    monitoring: false,
    debugging: true,
    hotReload: true,
    resourceOptimization: false,
    performanceMonitoring: true,
    debugLogging: true,
    errorReporting: false,
    slackNotifications: false,
    
    // Experimental features (enabled for testing)
    experimental: true,
    experimentalUi: true,
    apiEndpoints: true,
    
    // Development-specific features
    mockDiscordClient: false,
    verboseErrors: true,
    detailedLogs: true
  },

  // Database configuration for development
  database: {
    type: 'sqlite',
    database: './activity_bot_dev.sqlite',
    synchronize: true, // Auto-sync schema in development
    logging: true, // Log all queries
    dropSchema: false, // Don't drop schema on sync
    pool: {
      max: 5,
      min: 1,
      idle: 10000
    }
  },

  // Discord development settings
  discord: {
    // Use development bot token from .env.development
    cache: {
      messages: 200, // Cache more messages for debugging
      users: 500
    },
    presence: {
      status: 'idle',
      activities: [{
        name: '[DEV] 테스트 중',
        type: 'PLAYING'
      }]
    },
    // Shorter intervals for testing
    activityUpdateInterval: 30000 // 30 seconds
  },

  // Activity tracking (faster for testing)
  activity: {
    trackingInterval: 30000, // 30 seconds
    minActivityDuration: 60000, // 1 minute
    maxIdleTime: 120000, // 2 minutes
    reportSchedule: '*/5 * * * *', // Every 5 minutes for testing
    excludeAfk: true,
    debugMode: true
  },

  // Command settings for development
  commands: {
    prefix: '!dev',
    cooldown: 1000, // 1 second for easier testing
    debugCommands: true,
    testMode: true
  },

  // Development integrations
  integrations: {
    errsole: {
      enabled: true,
      collectLogs: ['error', 'warn', 'info', 'debug'],
      password: 'dev123', // Simple password for development
      port: 8001
    },
    slack: {
      enabled: false, // Usually disabled in development
      testMode: true
    }
  },

  // Performance (relaxed for development)
  performance: {
    maxListeners: 50, // Higher limit for development
    gcInterval: 600000, // 10 minutes
    memoryThreshold: 0.95, // 95% - more lenient
    cpuThreshold: 0.95 // 95% - more lenient
  },

  // Development tools
  devTools: {
    inspector: {
      enabled: true,
      port: 9229
    },
    profiling: {
      enabled: false,
      cpuProfile: false,
      heapSnapshot: false
    },
    sourceMap: true
  },

  // API configuration for development
  api: {
    enabled: true,
    port: 3001,
    swagger: {
      enabled: true,
      path: '/api-docs'
    },
    graphql: {
      enabled: false,
      playground: true
    }
  }
};