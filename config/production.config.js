// config/production.config.js - Production environment configuration
export default {
  // Server configuration for production
  server: {
    port: process.env.PORT || 8080,
    host: '0.0.0.0', // Listen on all interfaces
    cors: {
      enabled: true,
      origin: process.env.ALLOWED_ORIGINS?.split(',') || false,
      credentials: true
    }
  },

  // Production logging
  logging: {
    level: 'warn',
    format: 'json',
    timestamp: true,
    colorize: false,
    maxFiles: 10,
    maxSize: '50m',
    directory: './logs',
    handleExceptions: true,
    handleRejections: true,
    exitOnError: false
  },

  // Production features
  features: {
    // Core features (all enabled)
    activityTracking: true,
    voiceChannelIntegration: true,
    forumIntegration: true,
    recruitmentSystem: true,
    commandSystem: true,
    participantTracking: true,
    emojiReactions: true,
    
    // Optional features
    activityReports: true,
    calendarLogging: false, // Configurable via env
    advancedPermissions: true,
    userClassification: false, // Configurable via env
    
    // System features
    monitoring: true,
    debugging: false,
    hotReload: false,
    resourceOptimization: true,
    performanceMonitoring: true,
    debugLogging: false,
    errorReporting: true,
    slackNotifications: true,
    
    // Experimental features (disabled in production)
    experimental: false,
    experimentalUi: false,
    apiEndpoints: false, // Configurable via env
    
    // Production-specific
    securityHardening: true
  },

  // Database configuration for production
  database: {
    type: process.env.DB_TYPE || 'sqlite',
    database: process.env.DB_NAME || './activity_bot.sqlite',
    synchronize: false, // Never auto-sync in production
    logging: false, // Disable query logging
    pool: {
      max: 20,
      min: 5,
      idle: 30000,
      acquire: 60000,
      evict: 60000
    },
    // SQLite specific optimizations
    sqlite: {
      pragma: {
        journal_mode: 'WAL',
        synchronous: 'NORMAL',
        cache_size: -2000,
        temp_store: 'MEMORY',
        mmap_size: 30000000000
      }
    }
  },

  // Discord production settings
  discord: {
    cache: {
      messages: 50, // Limit cache for memory efficiency
      users: 100
    },
    presence: {
      status: 'online',
      activities: [{
        name: '음성 채널 활동',
        type: 'WATCHING'
      }]
    },
    sharding: {
      enabled: false, // Enable if needed for multiple guilds
      totalShards: 'auto'
    },
    // Retry and timeout settings
    retryLimit: 3,
    restRequestTimeout: 30000
  },

  // Activity tracking (optimized for production)
  activity: {
    trackingInterval: 60000, // 1 minute
    minActivityDuration: 300000, // 5 minutes
    maxIdleTime: 600000, // 10 minutes
    reportSchedule: '0 9 * * MON', // Every Monday at 9 AM
    excludeAfk: true,
    // Performance optimizations
    batchSize: 100,
    flushInterval: 30000
  },

  // Command settings for production
  commands: {
    prefix: '!',
    cooldown: 3000, // 3 seconds
    globalCooldown: true,
    maxCommandsPerMinute: 20,
    blacklist: {
      enabled: true,
      autoBlacklist: true,
      threshold: 50 // Commands per minute to trigger blacklist
    }
  },

  // Production integrations
  integrations: {
    errsole: {
      enabled: true,
      collectLogs: ['error', 'warn'],
      password: process.env.ERRSOLE_PASSWORD,
      port: process.env.ERRSOLE_PORT || 8001,
      secure: true
    },
    slack: {
      enabled: true,
      minLevel: 'error',
      includeStackTrace: true,
      rateLimit: {
        maxPerHour: 20
      }
    }
  },

  // Performance settings (strict for production)
  performance: {
    maxListeners: 15,
    gcInterval: 300000, // 5 minutes
    memoryThreshold: 0.8, // 80%
    cpuThreshold: 0.85, // 85%
    // Auto-scaling thresholds
    autoScale: {
      enabled: false,
      minInstances: 1,
      maxInstances: 4,
      targetCpu: 70,
      targetMemory: 75
    }
  },

  // Security configuration
  security: {
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100,
      skipSuccessfulRequests: true,
      standardHeaders: true,
      legacyHeaders: false
    },
    helmet: {
      enabled: true,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"]
        }
      }
    },
    cors: {
      credentials: true,
      maxAge: 86400
    }
  },

  // Monitoring and alerting
  monitoring: {
    healthCheck: {
      enabled: true,
      interval: 60000, // 1 minute
      timeout: 10000,
      path: '/health'
    },
    metrics: {
      enabled: true,
      interval: 60000,
      includeNodeMetrics: true
    },
    alerts: {
      memory: {
        threshold: 0.9,
        duration: 300000 // 5 minutes
      },
      cpu: {
        threshold: 0.95,
        duration: 300000
      },
      errors: {
        threshold: 10,
        window: 300000
      }
    }
  },

  // Backup configuration
  backup: {
    enabled: true,
    schedule: '0 3 * * *', // Daily at 3 AM
    retention: 7, // Keep 7 days of backups
    destination: './backups'
  }
};