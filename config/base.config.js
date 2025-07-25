// config/base.config.js - Base configuration for all environments
export default {
  // Application metadata
  app: {
    name: 'discord-activity-bot',
    version: '1.0.0',
    description: 'Discord 음성 채널 활동 추적 봇',
    author: 'Your Team',
    repository: 'https://github.com/your-repo'
  },

  // Server defaults
  server: {
    port: 3000,
    host: 'localhost',
    cors: {
      enabled: true,
      origin: '*'
    }
  },

  // Logging defaults
  logging: {
    level: 'info',
    format: 'json',
    timestamp: true,
    colorize: false,
    maxFiles: 5,
    maxSize: '20m',
    directory: './logs'
  },

  // Security defaults
  security: {
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100,
      message: 'Too many requests from this IP'
    },
    helmet: {
      enabled: true
    }
  },

  // Feature flags
  features: {
    // Core features
    activityTracking: true,
    voiceChannelIntegration: true,
    forumIntegration: true,
    recruitmentSystem: true,
    commandSystem: true,
    participantTracking: true,
    emojiReactions: true,
    
    // Optional features
    activityReports: true,
    calendarLogging: false,
    advancedPermissions: false,
    userClassification: false,
    
    // System features
    monitoring: false,
    debugging: false,
    hotReload: false,
    resourceOptimization: false,
    performanceMonitoring: false,
    debugLogging: false,
    errorReporting: false,
    slackNotifications: false,
    
    // Experimental features
    experimental: false,
    experimentalUi: false,
    apiEndpoints: false,
    
    // Custom features (can be overridden per environment)
    custom: {}
  },

  // Database defaults
  database: {
    type: 'sqlite',
    database: './activity_bot.sqlite',
    synchronize: false,
    logging: false,
    entities: ['./src/entities/**/*.js'],
    migrations: ['./src/migrations/**/*.js'],
    pool: {
      max: 10,
      min: 0,
      idle: 10000
    }
  },

  // Discord bot settings
  discord: {
    intents: [
      'Guilds',
      'GuildMembers',
      'GuildMessages',
      'GuildVoiceStates',
      'MessageContent',
      'GuildMessageReactions'
    ],
    partials: ['Message', 'Channel', 'Reaction'],
    cache: {
      messages: 100,
      users: 200
    },
    presence: {
      status: 'online',
      activities: [{
        name: '음성 채널 활동',
        type: 'WATCHING'
      }]
    }
  },

  // Activity tracking settings
  activity: {
    trackingInterval: 60000, // 1 minute
    minActivityDuration: 300000, // 5 minutes
    maxIdleTime: 600000, // 10 minutes
    reportSchedule: '0 9 * * MON', // Every Monday at 9 AM
    excludeAfk: true
  },

  // Command settings
  commands: {
    prefix: '!',
    cooldown: 3000, // 3 seconds
    adminOnly: ['reload', 'shutdown', 'config'],
    enabled: true
  },

  // Integration settings
  integrations: {
    errsole: {
      enabled: false,
      collectLogs: ['error', 'warn'],
      password: null
    },
    slack: {
      enabled: false,
      minLevel: 'error',
      includeStackTrace: false
    }
  },

  // Performance settings
  performance: {
    maxListeners: 20,
    gcInterval: 300000, // 5 minutes
    memoryThreshold: 0.8, // 80% memory usage warning
    cpuThreshold: 0.9 // 90% CPU usage warning
  },

  // Paths
  paths: {
    commands: './src/commands',
    services: './src/services',
    config: './src/config',
    logs: './logs',
    data: './data',
    temp: './temp'
  }
};