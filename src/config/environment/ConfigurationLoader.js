// src/config/environment/ConfigurationLoader.js - Configuration Loading and Management
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getEnvironment } from './EnvironmentDetector.js';
import { getSecuritySanitizer } from './SecuritySanitizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../..');

/**
 * ConfigurationLoader - Manages environment-specific configuration loading
 * with validation, merging, and type safety
 */
export class ConfigurationLoader {
  constructor() {
    this.config = {};
    this.environment = getEnvironment();
    this.configCache = new Map();
    this.validators = new Map();
    this.transformers = new Map();
    this.sanitizer = getSecuritySanitizer();
    this.configHashes = new Map(); // For integrity checking
  }

  /**
   * Load configuration based on detected environment
   */
  async load() {
    try {
      this.sanitizer.secureLog('info', '🔐 Starting secure configuration loading');
      
      // 1. Load base configuration with security validation
      const baseConfig = await this.loadBaseConfig();
      
      // 2. Load environment-specific configuration with security validation
      const envConfig = await this.loadEnvironmentConfig();
      
      // 3. Load dotenv files with sanitization
      const dotenvConfig = await this.loadDotEnvFiles();
      
      // 4. Merge configurations (priority: env vars > env config > base config)
      this.config = this.mergeConfigurations(baseConfig, envConfig, dotenvConfig);
      
      // 5. Apply security sanitization
      this.config = this.sanitizer.sanitizeConfig(this.config);
      
      // 6. Apply transformations
      this.config = await this.applyTransformations(this.config);
      
      // 7. Validate configuration
      await this.validateConfiguration(this.config);
      
      // 8. Generate security summary
      const securitySummary = this.sanitizer.createSecuritySummary(this.config);
      this.sanitizer.secureLog('info', '🛡️  Configuration security validation completed', {
        sensitiveFields: securitySummary.sensitiveFieldsCount,
        securityFlags: securitySummary.securityFlags
      });
      
      // 9. Store configuration hash for integrity monitoring
      this.configHashes.set('main', securitySummary.configHash);
      
      // 10. Freeze configuration in production
      if (this.environment.isProduction()) {
        this.freezeConfiguration();
      }
      
      return this.config;
    } catch (error) {
      this.sanitizer.secureLog('error', 'Configuration loading failed', { error: error.message });
      throw new Error(`Configuration loading failed: ${error.message}`);
    }
  }

  /**
   * Load base configuration that applies to all environments
   */
  async loadBaseConfig() {
    const baseConfigPath = path.join(ROOT_DIR, 'config', 'base.config.js');
    
    // Default base configuration
    const defaultBase = {
      app: {
        name: 'discord-bot',
        version: '1.0.0',
        description: 'Discord 음성 채널 활동 추적 봇'
      },
      server: {
        port: 3000,
        host: 'localhost'
      },
      logging: {
        level: 'info',
        format: 'json',
        timestamp: true
      },
      security: {
        rateLimit: {
          windowMs: 15 * 60 * 1000, // 15 minutes
          max: 100
        }
      },
      features: {
        monitoring: true,
        debugging: false,
        hotReload: false
      }
    };
    
    // Try to load custom base config with security validation
    if (fs.existsSync(baseConfigPath)) {
      try {
        // Validate file path
        const safePath = this.sanitizer.validateFilePath(baseConfigPath);
        
        // Read and validate file content
        const fileContent = fs.readFileSync(safePath, 'utf8');
        this.sanitizer.validateConfigFileContent(fileContent, safePath);
        
        const customBase = await import(safePath);
        const mergedConfig = this.deepMerge(defaultBase, customBase.default || customBase);
        
        this.sanitizer.secureLog('info', 'Base configuration loaded successfully', {
          path: path.basename(safePath),
          hash: this.sanitizer.generateContentHash(mergedConfig)
        });
        
        return mergedConfig;
      } catch (error) {
        this.sanitizer.secureLog('warn', 'Failed to load base config', { error: error.message });
        console.warn(`Failed to load base config: ${error.message}`);
      }
    }
    
    return defaultBase;
  }

  /**
   * Load environment-specific configuration
   */
  async loadEnvironmentConfig() {
    const env = this.environment.environment;
    const envConfigPath = path.join(ROOT_DIR, 'config', `${env}.config.js`);
    
    // Environment-specific defaults
    const envDefaults = {
      development: {
        server: {
          port: 3000,
          host: 'localhost'
        },
        logging: {
          level: 'debug',
          format: 'pretty'
        },
        features: {
          debugging: true,
          hotReload: true,
          monitoring: false
        },
        database: {
          synchronize: true,
          logging: true
        }
      },
      production: {
        server: {
          port: process.env.PORT || 8080,
          host: '0.0.0.0'
        },
        logging: {
          level: 'warn',
          format: 'json'
        },
        features: {
          debugging: false,
          hotReload: false,
          monitoring: true
        },
        database: {
          synchronize: false,
          logging: false
        }
      },
      test: {
        server: {
          port: 0, // Random port
          host: 'localhost'
        },
        logging: {
          level: 'error',
          format: 'json'
        },
        features: {
          debugging: true,
          hotReload: false,
          monitoring: false
        },
        database: {
          type: 'sqlite',
          database: ':memory:'
        }
      },
      staging: {
        // Similar to production but with some debugging
        server: {
          port: process.env.PORT || 3001,
          host: '0.0.0.0'
        },
        logging: {
          level: 'info',
          format: 'json'
        },
        features: {
          debugging: true,
          hotReload: false,
          monitoring: true
        }
      }
    };
    
    let config = envDefaults[env] || {};
    
    // Load custom environment config if exists with security validation
    if (fs.existsSync(envConfigPath)) {
      try {
        // Validate file path
        const safePath = this.sanitizer.validateFilePath(envConfigPath);
        
        // Read and validate file content
        const fileContent = fs.readFileSync(safePath, 'utf8');
        this.sanitizer.validateConfigFileContent(fileContent, safePath);
        
        const customEnvConfig = await import(safePath);
        config = this.deepMerge(config, customEnvConfig.default || customEnvConfig);
        
        this.sanitizer.secureLog('info', 'Environment configuration loaded', {
          environment: env,
          path: path.basename(safePath)
        });
      } catch (error) {
        this.sanitizer.secureLog('warn', `Failed to load ${env} config`, { error: error.message });
        console.warn(`Failed to load ${env} config: ${error.message}`);
      }
    }
    
    // Apply platform-specific overrides
    if (this.environment.isTermux()) {
      config = this.applyTermuxOverrides(config);
    }
    
    return config;
  }

  /**
   * Load .env files based on environment with security validation
   */
  async loadDotEnvFiles() {
    const env = this.environment.environment;
    const envFiles = [
      `.env.${env}.local`,
      `.env.${env}`,
      '.env.local',
      '.env'
    ];
    
    this.sanitizer.secureLog('info', 'Loading environment files', { environment: env });
    
    // Load files in reverse order (least specific to most specific)
    for (const file of envFiles.reverse()) {
      const filePath = path.join(ROOT_DIR, file);
      if (fs.existsSync(filePath)) {
        try {
          // Validate file path
          const safePath = this.sanitizer.validateFilePath(filePath);
          
          // Read and validate file content
          const fileContent = fs.readFileSync(safePath, 'utf8');
          this.sanitizer.validateConfigFileContent(fileContent, safePath);
          
          dotenv.config({ path: safePath });
          
          this.sanitizer.secureLog('debug', 'Environment file loaded', {
            file: path.basename(safePath)
          });
        } catch (error) {
          this.sanitizer.secureLog('warn', 'Failed to load environment file', {
            file: path.basename(filePath),
            error: error.message
          });
        }
      }
    }
    
    // Map and sanitize environment variables
    return this.mapEnvironmentVariables();
  }

  /**
   * Map environment variables to configuration structure with sanitization
   */
  mapEnvironmentVariables() {
    // Sanitize all environment variables first
    const sanitizedEnv = this.sanitizer.sanitizeEnvironmentVariables(process.env);
    
    const config = {
      discord: {
        token: sanitizedEnv.TOKEN,
        clientId: sanitizedEnv.CLIENT_ID,
        guildId: sanitizedEnv.GUILDID,
        channels: {
          log: sanitizedEnv.LOG_CHANNEL_ID,
          calendar: sanitizedEnv.CALENDAR_LOG_CHANNEL_ID,
          forum: sanitizedEnv.FORUM_CHANNEL_ID,
          voiceCategory: sanitizedEnv.VOICE_CATEGORY_ID,
          excluded: this.parseArrayEnv([
            sanitizedEnv.EXCLUDE_CHANNELID_1,
            sanitizedEnv.EXCLUDE_CHANNELID_2,
            sanitizedEnv.EXCLUDE_CHANNELID_3,
            sanitizedEnv.EXCLUDE_CHANNELID_4,
            sanitizedEnv.EXCLUDE_CHANNELID_5,
            sanitizedEnv.EXCLUDE_CHANNELID_6,
          ]),
          excludedForLogs: this.parseArrayEnv([
            sanitizedEnv.EXCLUDE_CHANNELID_1,
            sanitizedEnv.EXCLUDE_CHANNELID_2,
            sanitizedEnv.EXCLUDE_CHANNELID_3,
          ])
        },
        forum: {
          tagId: sanitizedEnv.FORUM_TAG_ID
        },
        devId: sanitizedEnv.DEV_ID
      },
      server: {
        port: this.parseIntEnv(sanitizedEnv.PORT) || undefined,
        host: sanitizedEnv.HOST || sanitizedEnv.ERRSOLE_HOST
      },
      monitoring: {
        errsole: {
          enabled: this.environment.hasFeature('external-monitoring'),
          host: sanitizedEnv.ERRSOLE_HOST,
          port: this.parseIntEnv(sanitizedEnv.ERRSOLE_PORT),
          password: sanitizedEnv.ERRSOLE_PASSWORD
        },
        slack: {
          enabled: this.parseBoolEnv(sanitizedEnv.ENABLE_SLACK_ALERTS),
          webhookUrl: sanitizedEnv.SLACK_WEBHOOK_URL,
          channel: sanitizedEnv.SLACK_CHANNEL,
          minLevel: sanitizedEnv.SLACK_MIN_LEVEL
        }
      },
      network: {
        phoneIp: sanitizedEnv.PHONE_IP
      }
    };
    
    this.sanitizer.secureLog('debug', 'Environment variables mapped', {
      variableCount: Object.keys(sanitizedEnv).length,
      configHash: this.sanitizer.generateContentHash(config)
    });
    
    return config;
  }

  /**
   * Apply Termux-specific configuration overrides
   */
  applyTermuxOverrides(config) {
    return this.deepMerge(config, {
      server: {
        host: '0.0.0.0' // Allow external connections
      },
      features: {
        monitoring: true, // Enable monitoring in Termux
        resourceOptimization: true // Optimize for limited resources
      },
      database: {
        pool: {
          max: 5, // Limit connections
          min: 1,
          idle: 10000
        }
      }
    });
  }

  /**
   * Deep merge configuration objects
   */
  deepMerge(target, ...sources) {
    if (!sources.length) return target;
    const source = sources.shift();
    
    if (this.isObject(target) && this.isObject(source)) {
      for (const key in source) {
        if (this.isObject(source[key])) {
          if (!target[key]) Object.assign(target, { [key]: {} });
          this.deepMerge(target[key], source[key]);
        } else {
          Object.assign(target, { [key]: source[key] });
        }
      }
    }
    
    return this.deepMerge(target, ...sources);
  }

  /**
   * Merge configurations with proper precedence
   */
  mergeConfigurations(base, env, dotenv) {
    // Remove undefined values from dotenv config
    const cleanDotenv = this.removeUndefined(dotenv);
    
    // Merge in order: base < env < dotenv
    return this.deepMerge({}, base, env, cleanDotenv);
  }

  /**
   * Remove undefined values from object recursively
   */
  removeUndefined(obj) {
    if (!this.isObject(obj)) return obj;
    
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = this.isObject(value) ? this.removeUndefined(value) : value;
      }
    }
    return cleaned;
  }

  /**
   * Register a configuration validator
   */
  registerValidator(path, validator) {
    this.validators.set(path, validator);
  }

  /**
   * Register a configuration transformer
   */
  registerTransformer(path, transformer) {
    this.transformers.set(path, transformer);
  }

  /**
   * Apply transformations to configuration values
   */
  async applyTransformations(config) {
    const transformed = { ...config };
    
    for (const [path, transformer] of this.transformers) {
      const value = this.getValueByPath(transformed, path);
      if (value !== undefined) {
        const newValue = await transformer(value, this.environment);
        this.setValueByPath(transformed, path, newValue);
      }
    }
    
    return transformed;
  }

  /**
   * Validate the configuration
   */
  async validateConfiguration(config) {
    const errors = [];
    
    // Run registered validators
    for (const [path, validator] of this.validators) {
      const value = this.getValueByPath(config, path);
      try {
        await validator(value, this.environment);
      } catch (error) {
        errors.push(`Validation failed for ${path}: ${error.message}`);
      }
    }
    
    // Built-in validations
    if (this.environment.isProduction()) {
      // Required fields for production
      const required = [
        'discord.token',
        'discord.clientId',
        'discord.guildId',
        'discord.channels.log'
      ];
      
      for (const path of required) {
        const value = this.getValueByPath(config, path);
        if (!value) {
          errors.push(`Required configuration missing: ${path}`);
        }
      }
    }
    
    if (errors.length > 0) {
      throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
    }
  }

  /**
   * Freeze configuration to prevent modifications in production
   */
  freezeConfiguration() {
    this.deepFreeze(this.config);
  }

  /**
   * Deep freeze an object
   */
  deepFreeze(obj) {
    Object.freeze(obj);
    Object.getOwnPropertyNames(obj).forEach(prop => {
      if (obj[prop] !== null && (typeof obj[prop] === 'object' || typeof obj[prop] === 'function')) {
        this.deepFreeze(obj[prop]);
      }
    });
    return obj;
  }

  // Utility methods
  isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
  }

  parseArrayEnv(values) {
    return values.filter(Boolean);
  }

  parseIntEnv(value) {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? undefined : parsed;
  }

  parseBoolEnv(value) {
    if (value === undefined || value === null) return false;
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  }

  getValueByPath(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  setValueByPath(obj, path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((current, key) => {
      if (!current[key]) current[key] = {};
      return current[key];
    }, obj);
    target[lastKey] = value;
  }

  /**
   * Get configuration value by path with security logging
   */
  get(path, defaultValue) {
    const value = this.getValueByPath(this.config, path);
    
    // Log sensitive field access in production for monitoring
    if (this.environment.isProduction() && this.sanitizer.isSensitiveField(path)) {
      this.sanitizer.secureLog('debug', 'Sensitive configuration accessed', {
        path: path,
        hasValue: value !== undefined
      });
    }
    
    return value !== undefined ? value : defaultValue;
  }

  /**
   * Check if configuration has a value
   */
  has(path) {
    return this.getValueByPath(this.config, path) !== undefined;
  }

  /**
   * Get all configuration with sensitive data redaction for logging
   */
  getAll() {
    return { ...this.config };
  }
  
  /**
   * Get all configuration with sensitive data redacted (for logging/debugging)
   */
  getAllRedacted() {
    return this.sanitizer.redactSensitiveData(this.config);
  }
  
  /**
   * Verify configuration integrity
   */
  verifyIntegrity() {
    const currentHash = this.sanitizer.generateContentHash(this.config);
    const originalHash = this.configHashes.get('main');
    
    if (originalHash && currentHash !== originalHash) {
      this.sanitizer.secureLog('warn', 'Configuration integrity check failed', {
        expected: originalHash,
        actual: currentHash
      });
      return false;
    }
    
    return true;
  }
}

// Singleton instance
let loader = null;

/**
 * Get the configuration loader instance
 */
export function getConfigLoader() {
  if (!loader) {
    loader = new ConfigurationLoader();
  }
  return loader;
}

/**
 * Load and get configuration
 */
export async function loadConfiguration() {
  const loader = getConfigLoader();
  return await loader.load();
}