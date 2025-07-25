// src/config/environment/SecuritySanitizer.js - Security Sanitization and Protection
import crypto from 'crypto';
import path from 'path';
import { getEnvironment } from './EnvironmentDetector.js';

/**
 * SecuritySanitizer - Provides security hardening for configuration management
 */
export class SecuritySanitizer {
  constructor() {
    this.environment = getEnvironment();
    this.sensitiveFields = new Set([
      'token', 'password', 'secret', 'key', 'webhook', 'api_key',
      'client_secret', 'private_key', 'auth_token', 'access_token'
    ]);
    this.allowedPaths = new Set();
    this.setupAllowedPaths();
  }

  /**
   * Setup allowed configuration file paths
   */
  setupAllowedPaths() {
    const rootDir = process.cwd();
    const configPaths = [
      path.join(rootDir, 'config'),
      path.join(rootDir, 'src', 'config'),
      path.join(rootDir, '.env'),
      path.join(rootDir, '.env.local'),
      path.join(rootDir, '.env.development'),
      path.join(rootDir, '.env.production'),
      path.join(rootDir, '.env.test')
    ];

    configPaths.forEach(configPath => {
      this.allowedPaths.add(path.resolve(configPath));
    });
  }

  /**
   * Validate file path to prevent path traversal attacks
   */
  validateFilePath(filePath) {
    try {
      const resolvedPath = path.resolve(filePath);
      const isAllowed = Array.from(this.allowedPaths).some(allowedPath => {
        return resolvedPath.startsWith(allowedPath) || 
               allowedPath.startsWith(resolvedPath);
      });

      if (!isAllowed) {
        throw new Error(`Access denied: Path outside allowed directories - ${filePath}`);
      }

      // Additional checks for suspicious patterns
      if (filePath.includes('..') || filePath.includes('~')) {
        throw new Error(`Suspicious path pattern detected: ${filePath}`);
      }

      return resolvedPath;
    } catch (error) {
      throw new Error(`Path validation failed: ${error.message}`);
    }
  }

  /**
   * Sanitize configuration values
   */
  sanitizeConfig(config, depth = 0) {
    if (depth > 10) {
      throw new Error('Configuration structure too deep - possible circular reference');
    }

    if (typeof config !== 'object' || config === null) {
      return config;
    }

    if (Array.isArray(config)) {
      return config.map(item => this.sanitizeConfig(item, depth + 1));
    }

    const sanitized = {};
    
    for (const [key, value] of Object.entries(config)) {
      // Validate key names
      if (!this.isValidKeyName(key)) {
        console.warn(`⚠️  Skipping invalid configuration key: ${key}`);
        continue;
      }

      // Sanitize based on value type and sensitivity
      if (typeof value === 'string') {
        sanitized[key] = this.sanitizeStringValue(key, value);
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeConfig(value, depth + 1);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Validate configuration key names
   */
  isValidKeyName(key) {
    // Allow alphanumeric, underscore, dash, and dot
    const validKeyPattern = /^[a-zA-Z0-9_.-]+$/;
    if (!validKeyPattern.test(key)) {
      return false;
    }

    // Reject suspicious key names
    const suspiciousPatterns = [
      '__proto__', 'constructor', 'prototype',
      'eval', 'function', 'script', 'import'
    ];

    return !suspiciousPatterns.some(pattern => 
      key.toLowerCase().includes(pattern)
    );
  }

  /**
   * Sanitize string values with context awareness
   */
  sanitizeStringValue(key, value) {
    // Check for potential injection patterns
    if (this.containsSuspiciousContent(value)) {
      console.warn(`⚠️  Suspicious content detected in ${key}, sanitizing...`);
      return this.cleanSuspiciousContent(value);
    }

    // URL validation for webhook/API endpoints
    if (this.isUrlField(key)) {
      return this.validateUrl(value);
    }

    // Discord ID validation
    if (this.isDiscordIdField(key)) {
      return this.validateDiscordId(value);
    }

    return value;
  }

  /**
   * Check for suspicious content in string values
   */
  containsSuspiciousContent(value) {
    const suspiciousPatterns = [
      // Script injection
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/i,
      /vbscript:/i,
      /onload\s*=/i,
      /onerror\s*=/i,
      
      // Command injection
      /[;&|`$(){}[\]]/,
      /\.\.\//,
      /~\//,
      
      // SQL-like patterns (though not directly applicable, good to catch)
      /union\s+select/i,
      /drop\s+table/i,
      /delete\s+from/i,
      
      // File system patterns
      /\/etc\/passwd/,
      /\/proc\//,
      /\\windows\\system32/i
    ];

    return suspiciousPatterns.some(pattern => pattern.test(value));
  }

  /**
   * Clean suspicious content from strings
   */
  cleanSuspiciousContent(value) {
    return value
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/vbscript:/gi, '')
      .replace(/[;&|`$(){}[\]]/g, '')
      .replace(/\.\.\//g, '')
      .replace(/~\//g, '')
      .trim();
  }

  /**
   * Check if field is URL-related
   */
  isUrlField(key) {
    const urlFieldPatterns = [
      /url$/i, /webhook$/i, /endpoint$/i, /api$/i, /host$/i
    ];
    return urlFieldPatterns.some(pattern => pattern.test(key));
  }

  /**
   * Validate URL format and security
   */
  validateUrl(url) {
    try {
      const parsedUrl = new URL(url);
      
      // Only allow HTTPS in production
      if (this.environment.isProduction() && parsedUrl.protocol !== 'https:') {
        throw new Error('Only HTTPS URLs allowed in production');
      }

      // Block internal/private networks
      if (this.isPrivateNetwork(parsedUrl.hostname)) {
        throw new Error('Private network URLs not allowed');
      }

      return url;
    } catch (error) {
      throw new Error(`Invalid URL format: ${error.message}`);
    }
  }

  /**
   * Check if hostname is in private network range
   */
  isPrivateNetwork(hostname) {
    // Private IP ranges
    const privateRanges = [
      /^10\./,
      /^192\.168\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^127\./,
      /^localhost$/i,
      /^::1$/,
      /^fc00:/,
      /^fe80:/
    ];

    return privateRanges.some(range => range.test(hostname));
  }

  /**
   * Check if field is Discord ID related
   */
  isDiscordIdField(key) {
    const discordIdPatterns = [
      /id$/i, /channelid$/i, /guildid$/i, /userid$/i, /clientid$/i
    ];
    return discordIdPatterns.some(pattern => pattern.test(key));
  }

  /**
   * Validate Discord ID format
   */
  validateDiscordId(id) {
    const discordIdPattern = /^\d{17,19}$/;
    if (!discordIdPattern.test(id)) {
      throw new Error(`Invalid Discord ID format: ${id}`);
    }
    return id;
  }

  /**
   * Redact sensitive information for logging
   */
  redactSensitiveData(config, depth = 0) {
    if (depth > 10) {
      return '[Max depth exceeded]';
    }

    if (typeof config !== 'object' || config === null) {
      return config;
    }

    if (Array.isArray(config)) {
      return config.map(item => this.redactSensitiveData(item, depth + 1));
    }

    const redacted = {};
    
    for (const [key, value] of Object.entries(config)) {
      if (this.isSensitiveField(key)) {
        redacted[key] = this.redactValue(value);
      } else if (typeof value === 'object' && value !== null) {
        redacted[key] = this.redactSensitiveData(value, depth + 1);
      } else {
        redacted[key] = value;
      }
    }

    return redacted;
  }

  /**
   * Check if field contains sensitive information
   */
  isSensitiveField(key) {
    const lowerKey = key.toLowerCase();
    return this.sensitiveFields.has(lowerKey) || 
           Array.from(this.sensitiveFields).some(pattern => 
             lowerKey.includes(pattern)
           );
  }

  /**
   * Redact sensitive values for logging
   */
  redactValue(value) {
    if (typeof value !== 'string') {
      return '[REDACTED]';
    }

    if (value.length <= 4) {
      return '[REDACTED]';
    }

    // Show first 2 and last 2 characters for identification
    return `${value.substring(0, 2)}***${value.substring(value.length - 2)}`;
  }

  /**
   * Generate content hash for integrity checking
   */
  generateContentHash(content) {
    return crypto.createHash('sha256')
                 .update(JSON.stringify(content))
                 .digest('hex');
  }

  /**
   * Verify content integrity
   */
  verifyContentIntegrity(content, expectedHash) {
    const actualHash = this.generateContentHash(content);
    return actualHash === expectedHash;
  }

  /**
   * Secure environment variable processing
   */
  sanitizeEnvironmentVariables(envVars) {
    const sanitized = {};
    const maxValueLength = 10000; // Prevent memory exhaustion

    for (const [key, value] of Object.entries(envVars)) {
      // Validate key
      if (!this.isValidKeyName(key)) {
        console.warn(`⚠️  Skipping invalid environment variable: ${key}`);
        continue;
      }

      // Check value length
      if (typeof value === 'string' && value.length > maxValueLength) {
        console.warn(`⚠️  Environment variable ${key} too long, truncating`);
        sanitized[key] = value.substring(0, maxValueLength);
        continue;
      }

      // Sanitize value
      if (typeof value === 'string') {
        sanitized[key] = this.sanitizeStringValue(key, value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Validate configuration file content before parsing
   */
  validateConfigFileContent(content, filePath) {
    // Check for suspicious patterns in raw content
    const suspiciousPatterns = [
      /require\s*\(\s*['"]child_process['"]/, // Command execution
      /eval\s*\(/, // Code evaluation
      /Function\s*\(/, // Dynamic function creation
      /import\s*\(\s*['"].*?['"].*?\)/, // Dynamic imports
      /__proto__/, // Prototype pollution
      /process\.env\s*=/, // Environment manipulation
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(content)) {
        throw new Error(`Suspicious content detected in configuration file: ${filePath}`);
      }
    }

    // Check file size
    if (content.length > 1000000) { // 1MB limit
      throw new Error(`Configuration file too large: ${filePath}`);
    }

    return true;
  }

  /**
   * Secure logging with sensitive data redaction
   */
  secureLog(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      environment: this.environment.environment,
      process: process.pid
    };

    if (data) {
      logEntry.data = this.redactSensitiveData(data);
    }

    // In production, avoid console logging of sensitive operations
    if (this.environment.isProduction() && level === 'debug') {
      return;
    }

    console.log(`[${level.toUpperCase()}] ${message}`, data ? logEntry.data : '');
  }

  /**
   * Create secure configuration summary for monitoring
   */
  createSecuritySummary(config) {
    const summary = {
      timestamp: new Date().toISOString(),
      environment: this.environment.environment,
      configHash: this.generateContentHash(config),
      sensitiveFieldsCount: this.countSensitiveFields(config),
      validationPassed: true,
      securityFlags: []
    };

    // Add security flags based on configuration
    if (this.environment.isProduction()) {
      if (config.server?.host === '0.0.0.0') {
        summary.securityFlags.push('external_host_binding');
      }
      
      if (config.features?.debugging) {
        summary.securityFlags.push('debug_enabled_in_production');
      }

      if (!config.monitoring?.enabled) {
        summary.securityFlags.push('monitoring_disabled');
      }
    }

    return summary;
  }

  /**
   * Count sensitive fields in configuration
   */
  countSensitiveFields(config, count = 0, depth = 0) {
    if (depth > 10 || typeof config !== 'object' || config === null) {
      return count;
    }

    for (const [key, value] of Object.entries(config)) {
      if (this.isSensitiveField(key)) {
        count++;
      }
      if (typeof value === 'object' && value !== null) {
        count = this.countSensitiveFields(value, count, depth + 1);
      }
    }

    return count;
  }
}

// Export singleton instance
let sanitizer = null;

/**
 * Get the security sanitizer instance
 */
export function getSecuritySanitizer() {
  if (!sanitizer) {
    sanitizer = new SecuritySanitizer();
  }
  return sanitizer;
}

export default SecuritySanitizer;