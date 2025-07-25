// src/config/environment/ConfigurationSchema.js - Configuration Schema and Validation
import { getEnvironment } from './EnvironmentDetector.js';
import { getSecuritySanitizer } from './SecuritySanitizer.js';

/**
 * ConfigurationSchema - Defines and validates configuration structure
 */
export class ConfigurationSchema {
  constructor() {
    this.schemas = new Map();
    this.customValidators = new Map();
    this.environment = getEnvironment();
    this.sanitizer = getSecuritySanitizer();
    this.initializeSchemas();
  }

  /**
   * Initialize built-in schemas
   */
  initializeSchemas() {
    // Discord configuration schema
    this.defineSchema('discord', {
      type: 'object',
      required: ['token', 'clientId', 'guildId'],
      properties: {
        token: {
          type: 'string',
          pattern: /^[A-Za-z0-9._-]{24,}$/,
          sensitive: true,
          minLength: 50,
          maxLength: 100,
          description: 'Discord bot token',
          security: {
            encrypted: false,
            logAccess: true,
            productionRequired: true
          }
        },
        clientId: {
          type: 'string',
          pattern: /^\d{17,19}$/,
          description: 'Discord application client ID'
        },
        guildId: {
          type: 'string',
          pattern: /^\d{17,19}$/,
          description: 'Discord guild (server) ID'
        },
        devId: {
          type: 'string',
          pattern: /^\d{17,19}$/,
          optional: true,
          description: 'Developer user ID for admin commands'
        },
        channels: {
          type: 'object',
          required: ['log'],
          properties: {
            log: {
              type: 'string',
              pattern: /^\d{17,19}$/,
              description: 'Log channel ID'
            },
            calendar: {
              type: 'string',
              pattern: /^\d{17,19}$/,
              optional: true,
              description: 'Calendar log channel ID'
            },
            forum: {
              type: 'string',
              pattern: /^\d{17,19}$/,
              optional: true,
              description: 'Forum channel ID'
            },
            voiceCategory: {
              type: 'string',
              pattern: /^\d{17,19}$/,
              optional: true,
              description: 'Voice channel category ID'
            },
            excluded: {
              type: 'array',
              items: {
                type: 'string',
                pattern: /^\d{17,19}$/
              },
              default: [],
              description: 'Excluded channel IDs for activity tracking'
            },
            excludedForLogs: {
              type: 'array',
              items: {
                type: 'string',
                pattern: /^\d{17,19}$/
              },
              default: [],
              description: 'Excluded channel IDs for logging'
            }
          }
        },
        forum: {
          type: 'object',
          optional: true,
          properties: {
            tagId: {
              type: 'string',
              pattern: /^\d{17,19}$/,
              optional: true,
              description: 'Forum tag ID'
            }
          }
        }
      }
    });

    // Server configuration schema
    this.defineSchema('server', {
      type: 'object',
      properties: {
        port: {
          type: 'number',
          min: 0,
          max: 65535,
          default: 3000,
          transform: (value) => parseInt(value, 10),
          description: 'Server port number'
        },
        host: {
          type: 'string',
          default: 'localhost',
          enum: ['localhost', '127.0.0.1', '0.0.0.0'],
          description: 'Server host address'
        }
      }
    });

    // Logging configuration schema
    this.defineSchema('logging', {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: ['error', 'warn', 'info', 'debug', 'trace'],
          default: 'info',
          description: 'Logging level'
        },
        format: {
          type: 'string',
          enum: ['json', 'pretty', 'simple'],
          default: 'json',
          description: 'Log output format'
        },
        timestamp: {
          type: 'boolean',
          default: true,
          description: 'Include timestamps in logs'
        }
      }
    });

    // Monitoring configuration schema
    this.defineSchema('monitoring', {
      type: 'object',
      properties: {
        errsole: {
          type: 'object',
          properties: {
            enabled: {
              type: 'boolean',
              default: false,
              description: 'Enable Errsole monitoring'
            },
            host: {
              type: 'string',
              optional: true,
              description: 'Errsole host address'
            },
            port: {
              type: 'number',
              min: 0,
              max: 65535,
              optional: true,
              description: 'Errsole port'
            }
          }
        },
        slack: {
          type: 'object',
          properties: {
            enabled: {
              type: 'boolean',
              default: false,
              description: 'Enable Slack notifications'
            },
            webhookUrl: {
              type: 'string',
              pattern: /^https:\/\/hooks\.slack\.com\//,
              optional: true,
              sensitive: true,
              description: 'Slack webhook URL',
              security: {
                httpsRequired: true,
                domainWhitelist: ['hooks.slack.com'],
                logAccess: true
              }
            },
            channel: {
              type: 'string',
              optional: true,
              description: 'Slack channel for notifications'
            },
            minLevel: {
              type: 'string',
              enum: ['error', 'warn', 'info'],
              default: 'error',
              optional: true,
              description: 'Minimum log level for Slack notifications'
            }
          }
        }
      }
    });

    // Features configuration schema
    this.defineSchema('features', {
      type: 'object',
      properties: {
        monitoring: {
          type: 'boolean',
          default: true,
          description: 'Enable monitoring features'
        },
        debugging: {
          type: 'boolean',
          default: false,
          description: 'Enable debugging features'
        },
        hotReload: {
          type: 'boolean',
          default: false,
          description: 'Enable hot reload'
        },
        resourceOptimization: {
          type: 'boolean',
          default: false,
          description: 'Enable resource optimization for limited environments'
        }
      }
    });

    // Database configuration schema
    this.defineSchema('database', {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['sqlite', 'postgres', 'mysql', 'mongodb'],
          default: 'sqlite',
          description: 'Database type'
        },
        database: {
          type: 'string',
          default: './activity_bot.sqlite',
          description: 'Database name or path'
        },
        synchronize: {
          type: 'boolean',
          default: false,
          description: 'Auto-sync database schema'
        },
        logging: {
          type: 'boolean',
          default: false,
          description: 'Enable database query logging'
        },
        pool: {
          type: 'object',
          optional: true,
          properties: {
            max: {
              type: 'number',
              min: 1,
              max: 100,
              default: 10,
              description: 'Maximum pool connections'
            },
            min: {
              type: 'number',
              min: 0,
              max: 100,
              default: 0,
              description: 'Minimum pool connections'
            },
            idle: {
              type: 'number',
              min: 0,
              default: 10000,
              description: 'Idle timeout in milliseconds'
            }
          }
        }
      }
    });
  }

  /**
   * Define a configuration schema
   */
  defineSchema(path, schema) {
    this.schemas.set(path, schema);
  }

  /**
   * Register a custom validator function
   */
  registerValidator(path, validator) {
    this.customValidators.set(path, validator);
  }

  /**
   * Validate a configuration object against schemas with security checks
   */
  async validate(config) {
    const errors = [];
    const warnings = [];
    const securityIssues = [];

    this.sanitizer.secureLog('info', 'Starting configuration validation');

    // Validate each schema
    for (const [path, schema] of this.schemas) {
      const value = this.getValueByPath(config, path);
      const result = await this.validateValue(value, schema, path);
      
      errors.push(...result.errors);
      warnings.push(...result.warnings);
      
      // Security-specific validations
      if (schema.security && value !== undefined && value !== null) {
        const securityResult = await this.validateSecurity(value, schema.security, path);
        securityIssues.push(...securityResult);
      }
    }

    // Run custom validators
    for (const [path, validator] of this.customValidators) {
      try {
        const value = this.getValueByPath(config, path);
        await validator(value, config, this.environment);
      } catch (error) {
        errors.push(`Custom validation failed for ${path}: ${error.message}`);
      }
    }
    
    // Add security-specific validations
    const environmentSecurityCheck = await this.validateEnvironmentSecurity(config);
    securityIssues.push(...environmentSecurityCheck);

    // Convert critical security issues to errors
    const criticalSecurityIssues = securityIssues.filter(issue => issue.severity === 'critical');
    errors.push(...criticalSecurityIssues.map(issue => `Security: ${issue.message}`));
    
    // Convert non-critical security issues to warnings
    const nonCriticalSecurityIssues = securityIssues.filter(issue => issue.severity !== 'critical');
    warnings.push(...nonCriticalSecurityIssues.map(issue => `Security: ${issue.message}`));

    this.sanitizer.secureLog('info', 'Configuration validation completed', {
      errors: errors.length,
      warnings: warnings.length,
      securityIssues: securityIssues.length
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      securityIssues
    };
  }

  /**
   * Validate a single value against a schema
   */
  async validateValue(value, schema, path = '') {
    const errors = [];
    const warnings = [];

    // Check if value is required
    if (schema.required && (value === undefined || value === null)) {
      errors.push(`${path} is required`);
      return { errors, warnings };
    }

    // Skip validation if optional and not provided
    if (schema.optional && (value === undefined || value === null)) {
      return { errors, warnings };
    }

    // Apply default if value is not provided
    if (value === undefined && schema.default !== undefined) {
      value = schema.default;
    }

    // Type validation
    if (schema.type) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== schema.type) {
        errors.push(`${path} must be of type ${schema.type}, got ${actualType}`);
        return { errors, warnings };
      }
    }

    // Type-specific validations
    switch (schema.type) {
      case 'string':
        await this.validateString(value, schema, path, errors, warnings);
        break;
      case 'number':
        await this.validateNumber(value, schema, path, errors, warnings);
        break;
      case 'boolean':
        await this.validateBoolean(value, schema, path, errors, warnings);
        break;
      case 'array':
        await this.validateArray(value, schema, path, errors, warnings);
        break;
      case 'object':
        await this.validateObject(value, schema, path, errors, warnings);
        break;
    }

    // Custom validation function
    if (schema.validate) {
      try {
        await schema.validate(value, this.environment);
      } catch (error) {
        errors.push(`${path} validation failed: ${error.message}`);
      }
    }

    // Environment-specific validation
    if (schema.environments && !schema.environments.includes(this.environment.environment)) {
      warnings.push(`${path} is not typically used in ${this.environment.environment} environment`);
    }

    return { errors, warnings };
  }

  /**
   * Validate string values
   */
  async validateString(value, schema, path, errors, warnings) {
    // Pattern validation
    if (schema.pattern && !schema.pattern.test(value)) {
      errors.push(`${path} does not match required pattern`);
    }

    // Enum validation
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`${path} must be one of: ${schema.enum.join(', ')}`);
    }

    // Length validation
    if (schema.minLength && value.length < schema.minLength) {
      errors.push(`${path} must be at least ${schema.minLength} characters long`);
    }
    if (schema.maxLength && value.length > schema.maxLength) {
      errors.push(`${path} must be at most ${schema.maxLength} characters long`);
    }

    // Sensitive data warning
    if (schema.sensitive && this.environment.isDevelopment()) {
      warnings.push(`${path} contains sensitive data - ensure it's not logged or exposed`);
    }
  }

  /**
   * Validate number values
   */
  async validateNumber(value, schema, path, errors, warnings) {
    if (schema.min !== undefined && value < schema.min) {
      errors.push(`${path} must be at least ${schema.min}`);
    }
    if (schema.max !== undefined && value > schema.max) {
      errors.push(`${path} must be at most ${schema.max}`);
    }
    if (schema.integer && !Number.isInteger(value)) {
      errors.push(`${path} must be an integer`);
    }
  }

  /**
   * Validate boolean values
   */
  async validateBoolean(value, schema, path, errors, warnings) {
    // Boolean specific validations can be added here
  }

  /**
   * Validate array values
   */
  async validateArray(value, schema, path, errors, warnings) {
    if (schema.minItems && value.length < schema.minItems) {
      errors.push(`${path} must have at least ${schema.minItems} items`);
    }
    if (schema.maxItems && value.length > schema.maxItems) {
      errors.push(`${path} must have at most ${schema.maxItems} items`);
    }

    // Validate each item
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const itemResult = await this.validateValue(value[i], schema.items, `${path}[${i}]`);
        errors.push(...itemResult.errors);
        warnings.push(...itemResult.warnings);
      }
    }
  }

  /**
   * Validate object values
   */
  async validateObject(value, schema, path, errors, warnings) {
    // Check required properties
    if (schema.required) {
      for (const requiredProp of schema.required) {
        if (!(requiredProp in value)) {
          errors.push(`${path}.${requiredProp} is required`);
        }
      }
    }

    // Validate properties
    if (schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        const propPath = path ? `${path}.${propName}` : propName;
        const propResult = await this.validateValue(value[propName], propSchema, propPath);
        errors.push(...propResult.errors);
        warnings.push(...propResult.warnings);
      }
    }

    // Check for additional properties
    if (schema.additionalProperties === false) {
      const allowedProps = new Set(Object.keys(schema.properties || {}));
      for (const prop of Object.keys(value)) {
        if (!allowedProps.has(prop)) {
          warnings.push(`${path}.${prop} is not a recognized property`);
        }
      }
    }
  }

  /**
   * Validate security-specific schema properties
   */
  async validateSecurity(value, securityConfig, path) {
    const issues = [];
    
    // HTTPS requirement check
    if (securityConfig.httpsRequired && typeof value === 'string') {
      if (!value.startsWith('https://')) {
        issues.push({
          severity: this.environment.isProduction() ? 'critical' : 'warning',
          message: `${path} must use HTTPS in ${this.environment.environment} environment`
        });
      }
    }
    
    // Domain whitelist check
    if (securityConfig.domainWhitelist && typeof value === 'string') {
      try {
        const url = new URL(value);
        if (!securityConfig.domainWhitelist.includes(url.hostname)) {
          issues.push({
            severity: 'warning',
            message: `${path} domain '${url.hostname}' not in whitelist: ${securityConfig.domainWhitelist.join(', ')}`
          });
        }
      } catch (error) {
        issues.push({
          severity: 'critical',
          message: `${path} contains invalid URL: ${error.message}`
        });
      }
    }
    
    // Production requirement check
    if (securityConfig.productionRequired && this.environment.isProduction()) {
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        issues.push({
          severity: 'critical',
          message: `${path} is required in production environment`
        });
      }
    }
    
    return issues;
  }
  
  /**
   * Validate environment-specific security requirements
   */
  async validateEnvironmentSecurity(config) {
    const issues = [];
    
    // Production-specific security checks
    if (this.environment.isProduction()) {
      // Check for debug features in production
      if (config.features?.debugging) {
        issues.push({
          severity: 'warning',
          message: 'Debug features should be disabled in production'
        });
      }
      
      // Check for insecure host binding
      if (config.server?.host === '0.0.0.0') {
        issues.push({
          severity: 'warning',
          message: 'Binding to 0.0.0.0 exposes service to all network interfaces'
        });
      }
      
      // Check for monitoring configuration
      if (!config.monitoring?.errsole?.enabled && !config.monitoring?.slack?.enabled) {
        issues.push({
          severity: 'warning',
          message: 'No monitoring configured for production environment'
        });
      }
      
      // Check for weak passwords/secrets
      if (config.monitoring?.errsole?.password) {
        const password = config.monitoring.errsole.password;
        if (typeof password === 'string' && password.length < 12) {
          issues.push({
            severity: 'critical',
            message: 'Errsole password too weak (minimum 12 characters)'
          });
        }
      }
    }
    
    // Development-specific security warnings
    if (this.environment.isDevelopment()) {
      if (config.server?.host === '0.0.0.0') {
        issues.push({
          severity: 'info',
          message: 'Development server exposed to all interfaces - ensure firewall protection'
        });
      }
    }
    
    // Termux-specific security considerations
    if (this.environment.isTermux()) {
      if (config.features?.resourceOptimization !== true) {
        issues.push({
          severity: 'warning',
          message: 'Resource optimization recommended for Termux environment'
        });
      }
    }
    
    return issues;
  }
  
  /**
   * Get value by dot-notation path
   */
  getValueByPath(obj, path) {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}

// Singleton instance
let schema = null;

/**
 * Get the configuration schema instance
 */
export function getConfigSchema() {
  if (!schema) {
    schema = new ConfigurationSchema();
  }
  return schema;
}

// Export validation function for convenience
export async function validateConfiguration(config) {
  const schema = getConfigSchema();
  return await schema.validate(config);
}