// src/config/environment/index.js - Main Environment Configuration Manager
import { getEnvironment, ENVIRONMENT } from './EnvironmentDetector.js';
import { getConfigLoader, loadConfiguration } from './ConfigurationLoader.js';
import { getConfigSchema, validateConfiguration } from './ConfigurationSchema.js';
import { getSecuritySanitizer } from './SecuritySanitizer.js';
import { getSecurityMonitor, startSecurityMonitoring } from './SecurityMonitor.js';

/**
 * EnvironmentManager - Central manager for environment detection and configuration
 */
class EnvironmentManager {
  constructor() {
    this.initialized = false;
    this.config = null;
    this.environment = null;
    this.loader = null;
    this.schema = null;
    this.sanitizer = null;
    this.securityMonitor = null;
  }

  /**
   * Initialize the environment and configuration system
   */
  async initialize() {
    if (this.initialized) {
      return this.config;
    }

    try {
      console.log('🚀 Initializing Environment Configuration System...');
      
      // 1. Detect environment
      this.environment = getEnvironment();
      console.log(`📍 Environment detected: ${this.environment.environment} on ${this.environment.platform}`);
      
      // 2. Get configuration loader, schema, and security components
      this.loader = getConfigLoader();
      this.schema = getConfigSchema();
      this.sanitizer = getSecuritySanitizer();
      this.securityMonitor = getSecurityMonitor();
      
      // 3. Register custom validators and transformers
      await this.registerCustomHandlers();
      
      // 4. Load configuration
      console.log('📁 Loading configuration...');
      this.config = await this.loader.load();
      
      // 5. Validate configuration with security checks
      console.log('✅ Validating configuration...');
      const validation = await this.schema.validate(this.config);
      
      if (!validation.valid) {
        console.error('❌ Configuration validation failed:');
        validation.errors.forEach(error => console.error(`  - ${error}`));
        throw new Error('Configuration validation failed');
      }
      
      if (validation.warnings.length > 0) {
        console.warn('⚠️  Configuration warnings:');
        validation.warnings.forEach(warning => console.warn(`  - ${warning}`));
      }
      
      if (validation.securityIssues && validation.securityIssues.length > 0) {
        const criticalIssues = validation.securityIssues.filter(issue => issue.severity === 'critical');
        if (criticalIssues.length > 0) {
          console.error('🚨 Critical security issues detected:');
          criticalIssues.forEach(issue => console.error(`  - ${issue.message}`));
        }
        
        const nonCriticalIssues = validation.securityIssues.filter(issue => issue.severity !== 'critical');
        if (nonCriticalIssues.length > 0) {
          console.warn('⚠️  Security warnings:');
          nonCriticalIssues.forEach(issue => console.warn(`  - ${issue.message}`));
        }
      }
      
      // 6. Setup environment-specific features
      await this.setupEnvironmentFeatures();
      
      // 7. Start security monitoring in production
      if (this.environment.isProduction()) {
        this.securityMonitor.start();
        console.log('🛡️  Security monitoring enabled');
      }
      
      this.initialized = true;
      console.log('✅ Environment configuration initialized successfully');
      
      // 8. Perform initial integrity check
      setTimeout(() => {
        this.performIntegrityCheck();
      }, 5000); // Check after 5 seconds
      
      return this.config;
    } catch (error) {
      console.error('❌ Failed to initialize environment configuration:', error);
      throw error;
    }
  }

  /**
   * Register custom validators and transformers
   */
  async registerCustomHandlers() {
    // Discord token validator
    this.schema.registerValidator('discord.token', async (token, config, env) => {
      if (env.isProduction() && (!token || token.length < 50)) {
        throw new Error('Invalid Discord token for production environment');
      }
    });
    
    // Monitoring configuration validator
    this.schema.registerValidator('monitoring', async (monitoring, config, env) => {
      if (env.isProduction() && !monitoring.errsole.enabled && !monitoring.slack.enabled) {
        console.warn('⚠️  No monitoring enabled for production environment');
      }
    });
    
    // Port transformer for string to number conversion
    this.loader.registerTransformer('server.port', async (port, env) => {
      if (typeof port === 'string') {
        return parseInt(port, 10);
      }
      return port;
    });
    
    // Host transformer for production environments
    this.loader.registerTransformer('server.host', async (host, env) => {
      if (env.isProduction() && host === 'localhost') {
        console.warn('⚠️  Using localhost in production - consider using 0.0.0.0');
      }
      return host;
    });
  }

  /**
   * Setup environment-specific features
   */
  async setupEnvironmentFeatures() {
    const env = this.environment;
    
    // Development features
    if (env.isDevelopment()) {
      // Enable hot reload
      if (this.config.features?.hotReload) {
        console.log('🔥 Hot reload enabled for development');
      }
      
      // Enable debug logging
      if (this.config.features?.debugging) {
        console.log('🐛 Debug mode enabled');
        process.env.DEBUG = '*';
      }
    }
    
    // Production features
    if (env.isProduction()) {
      // Enable monitoring
      if (this.config.monitoring?.errsole?.enabled) {
        console.log('📊 Errsole monitoring enabled');
      }
      
      if (this.config.monitoring?.slack?.enabled) {
        console.log('📢 Slack notifications enabled');
      }
      
      // Enable resource optimization
      if (env.hasFeature('limited-resources') || this.config.features?.resourceOptimization) {
        console.log('⚡ Resource optimization enabled');
        this.enableResourceOptimization();
      }
    }
    
    // Termux-specific features
    if (env.isTermux()) {
      console.log('📱 Termux environment detected - applying mobile optimizations');
      this.applyTermuxOptimizations();
    }
  }

  /**
   * Enable resource optimization for limited environments
   */
  enableResourceOptimization() {
    // Reduce memory usage
    if (global.gc) {
      setInterval(() => {
        global.gc();
      }, 60000); // Run GC every minute
    }
    
    // Limit concurrent operations
    process.env.UV_THREADPOOL_SIZE = '4';
  }

  /**
   * Apply Termux-specific optimizations
   */
  applyTermuxOptimizations() {
    // Set process priority
    try {
      process.nice(10); // Lower priority to be nice to the system
    } catch (error) {
      // Ignore if not supported
    }
  }

  /**
   * Get configuration value with security logging
   */
  get(path, defaultValue) {
    if (!this.initialized) {
      throw new Error('Environment not initialized. Call initialize() first.');
    }
    return this.loader.get(path, defaultValue);
  }
  
  /**
   * Get configuration with sensitive data redacted
   */
  getRedacted() {
    if (!this.initialized) {
      throw new Error('Environment not initialized. Call initialize() first.');
    }
    return this.loader.getAllRedacted();
  }

  /**
   * Check if configuration has value
   */
  has(path) {
    if (!this.initialized) {
      throw new Error('Environment not initialized. Call initialize() first.');
    }
    return this.loader.has(path);
  }

  /**
   * Get all configuration
   */
  getAll() {
    if (!this.initialized) {
      throw new Error('Environment not initialized. Call initialize() first.');
    }
    return this.loader.getAll();
  }

  /**
   * Get environment info
   */
  getEnvironment() {
    return this.environment;
  }

  /**
   * Check if in production
   */
  isProduction() {
    return this.environment?.isProduction() || false;
  }

  /**
   * Check if in development
   */
  isDevelopment() {
    return this.environment?.isDevelopment() || false;
  }

  /**
   * Check if in test
   */
  isTest() {
    return this.environment?.isTest() || false;
  }

  /**
   * Check if running in Termux
   */
  isTermux() {
    return this.environment?.isTermux() || false;
  }

  /**
   * Check if environment has a specific feature
   */
  hasFeature(feature) {
    return this.environment?.hasFeature(feature) || false;
  }

  /**
   * Get environment metadata
   */
  getMetadata() {
    return this.environment?.metadata || {};
  }
  
  /**
   * Perform configuration integrity check
   */
  performIntegrityCheck() {
    if (!this.initialized || !this.loader) {
      return false;
    }
    
    const integrityValid = this.loader.verifyIntegrity();
    if (!integrityValid) {
      this.sanitizer.secureLog('error', '🚨 Configuration integrity check failed');
      if (this.securityMonitor) {
        this.securityMonitor.recordSecurityEvent('config_integrity_failure', 'critical', {
          timestamp: new Date().toISOString()
        });
      }
    }
    
    return integrityValid;
  }
  
  /**
   * Get security statistics
   */
  getSecurityStats() {
    if (!this.securityMonitor) {
      return { monitoring: false };
    }
    
    return {
      monitoring: this.securityMonitor.isMonitoring,
      ...this.securityMonitor.getSecurityStats()
    };
  }
  
  /**
   * Enable security monitoring
   */
  enableSecurityMonitoring() {
    if (this.securityMonitor && !this.securityMonitor.isMonitoring) {
      this.securityMonitor.start();
      return true;
    }
    return false;
  }
  
  /**
   * Disable security monitoring
   */
  disableSecurityMonitoring() {
    if (this.securityMonitor && this.securityMonitor.isMonitoring) {
      this.securityMonitor.stop();
      return true;
    }
    return false;
  }
}

// Create singleton instance
const envManager = new EnvironmentManager();

// Export convenience functions
export const initializeEnvironment = () => envManager.initialize();
export const getConfig = (path, defaultValue) => envManager.get(path, defaultValue);
export const getConfigRedacted = () => envManager.getRedacted();
export const hasConfig = (path) => envManager.has(path);
export const getAllConfig = () => envManager.getAll();
export const getEnvironmentInfo = () => envManager.getEnvironment();
export const isProduction = () => envManager.isProduction();
export const isDevelopment = () => envManager.isDevelopment();
export const isTest = () => envManager.isTest();
export const isTermux = () => envManager.isTermux();
export const hasFeature = (feature) => envManager.hasFeature(feature);
export const getMetadata = () => envManager.getMetadata();
export const performIntegrityCheck = () => envManager.performIntegrityCheck();
export const getSecurityStats = () => envManager.getSecurityStats();
export const enableSecurityMonitoring = () => envManager.enableSecurityMonitoring();
export const disableSecurityMonitoring = () => envManager.disableSecurityMonitoring();

// Re-export core modules
export { EnvironmentDetector, getEnvironment, ENVIRONMENT } from './EnvironmentDetector.js';
export { ConfigurationLoader, getConfigLoader, loadConfiguration } from './ConfigurationLoader.js';
export { ConfigurationSchema, getConfigSchema, validateConfiguration } from './ConfigurationSchema.js';
export { SecuritySanitizer, getSecuritySanitizer } from './SecuritySanitizer.js';
export { SecurityMonitor, getSecurityMonitor, startSecurityMonitoring } from './SecurityMonitor.js';

// Export the manager instance
export default envManager;