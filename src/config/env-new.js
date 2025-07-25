// src/config/env-new.js - New environment configuration using the environment detection system
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
} from './environment/index.js';

// Initialize environment on module load
let initialized = false;
let initPromise = null;

/**
 * Ensure environment is initialized
 */
async function ensureInitialized() {
  if (initialized) return;
  
  if (!initPromise) {
    initPromise = initializeEnvironment();
  }
  
  await initPromise;
  initialized = true;
}

/**
 * Get configuration with automatic initialization
 */
async function getConfiguration() {
  await ensureInitialized();
  return getAllConfig();
}

/**
 * Build legacy config structure for backward compatibility
 */
async function buildLegacyConfig() {
  await ensureInitialized();
  
  return {
    // Discord configuration
    TOKEN: getConfig('discord.token'),
    GUILDID: getConfig('discord.guildId'),
    CLIENT_ID: getConfig('discord.clientId'),
    LOG_CHANNEL_ID: getConfig('discord.channels.log'),
    CALENDAR_LOG_CHANNEL_ID: getConfig('discord.channels.calendar'),
    FORUM_CHANNEL_ID: getConfig('discord.channels.forum'),
    VOICE_CATEGORY_ID: getConfig('discord.channels.voiceCategory'),
    FORUM_TAG_ID: getConfig('discord.forum.tagId'),
    DEV_ID: getConfig('discord.devId'),
    
    // Excluded channels
    EXCLUDED_CHANNELS: getConfig('discord.channels.excluded', []),
    EXCLUDED_CHANNELS_FOR_LOGS: getConfig('discord.channels.excludedForLogs', []),
    
    // Server configuration
    NODE_ENV: getEnvironmentInfo()?.environment || 'development',
    ERRSOLE_HOST: getConfig('monitoring.errsole.host') || getConfig('server.host'),
    ERRSOLE_PORT: getConfig('monitoring.errsole.port'),
    
    // Monitoring
    ENABLE_SLACK_ALERTS: getConfig('monitoring.slack.enabled') ? 'true' : 'false',
    SLACK_WEBHOOK_URL: getConfig('monitoring.slack.webhookUrl'),
    SLACK_CHANNEL: getConfig('monitoring.slack.channel'),
    SLACK_MIN_LEVEL: getConfig('monitoring.slack.minLevel'),
    
    // Network
    PHONE_IP: getConfig('network.phoneIp')
  };
}

// Export legacy config (will be populated after initialization)
export let config = {};

// Initialize and populate config
(async () => {
  try {
    config = await buildLegacyConfig();
  } catch (error) {
    console.error('Failed to initialize environment configuration:', error);
    // Fallback to basic environment variables
    config = {
      TOKEN: process.env.TOKEN,
      GUILDID: process.env.GUILDID,
      CLIENT_ID: process.env.CLIENT_ID,
      LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID,
      EXCLUDED_CHANNELS: [],
      EXCLUDED_CHANNELS_FOR_LOGS: [],
      NODE_ENV: process.env.NODE_ENV || 'development'
    };
  }
})();

// Export new configuration utilities
export {
  getConfiguration,
  getConfig,
  hasConfig,
  getAllConfig,
  isProduction,
  isDevelopment,
  isTermux,
  hasFeature,
  getEnvironmentInfo,
  getMetadata,
  ensureInitialized
};

// Helper function to validate required config
export async function validateRequiredConfig() {
  await ensureInitialized();
  
  const required = [
    'discord.token',
    'discord.guildId',
    'discord.channels.log'
  ];
  
  const missing = required.filter(key => !hasConfig(key) || !getConfig(key));
  
  if (missing.length > 0) {
    throw new Error(`Required configuration missing: ${missing.join(', ')}`);
  }
  
  return true;
}