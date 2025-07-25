// src/config/environment/SecurityMonitor.js - Security Monitoring and Alerting
import { EventEmitter } from 'events';
import { getEnvironment } from './EnvironmentDetector.js';
import { getSecuritySanitizer } from './SecuritySanitizer.js';

/**
 * SecurityMonitor - Monitors configuration security and sends alerts
 */
export class SecurityMonitor extends EventEmitter {
  constructor() {
    super();
    this.environment = getEnvironment();
    this.sanitizer = getSecuritySanitizer();
    this.securityEvents = [];
    this.alertThresholds = {
      criticalEvents: 5, // Alert after 5 critical events
      timeWindow: 300000, // 5 minutes
      maxEvents: 100 // Keep last 100 events
    };
    this.isMonitoring = false;
  }

  /**
   * Start security monitoring
   */
  start() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.sanitizer.secureLog('info', '🛡️  Security monitoring started');
    
    // Set up periodic security checks
    this.setupPeriodicChecks();
    
    // Listen for security events
    this.setupEventListeners();
    
    this.emit('monitoring_started');
  }

  /**
   * Stop security monitoring
   */
  stop() {
    if (!this.isMonitoring) return;
    
    this.isMonitoring = false;
    this.sanitizer.secureLog('info', '🛡️  Security monitoring stopped');
    
    if (this.periodicCheck) {
      clearInterval(this.periodicCheck);
    }
    
    this.emit('monitoring_stopped');
  }

  /**
   * Setup periodic security checks
   */
  setupPeriodicChecks() {
    // Run security checks every 5 minutes in production, every 30 seconds in development
    const interval = this.environment.isProduction() ? 300000 : 30000;
    
    this.periodicCheck = setInterval(() => {
      this.performSecurityCheck();
    }, interval);
  }

  /**
   * Setup event listeners for security monitoring
   */
  setupEventListeners() {
    // Monitor process events
    process.on('warning', (warning) => {
      this.recordSecurityEvent('process_warning', 'warning', {
        name: warning.name,
        message: warning.message,
        stack: warning.stack
      });
    });

    // Monitor uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.recordSecurityEvent('uncaught_exception', 'critical', {
        message: error.message,
        stack: error.stack
      });
    });

    // Monitor unhandled rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.recordSecurityEvent('unhandled_rejection', 'critical', {
        reason: reason?.toString(),
        promise: promise?.toString()
      });
    });
  }

  /**
   * Perform comprehensive security check
   */
  async performSecurityCheck() {
    try {
      const checks = [
        this.checkMemoryUsage(),
        this.checkFileSystemSecurity(),
        this.checkEnvironmentSecurity(),
        this.checkNetworkSecurity(),
        this.checkProcessSecurity()
      ];

      const results = await Promise.allSettled(checks);
      
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          this.recordSecurityEvent('security_check_failed', 'warning', {
            checkIndex: index,
            error: result.reason?.message
          });
        }
      });

      this.emit('security_check_completed', { results });
    } catch (error) {
      this.sanitizer.secureLog('error', 'Security check failed', { error: error.message });
    }
  }

  /**
   * Check memory usage for potential issues
   */
  async checkMemoryUsage() {
    const memoryUsage = process.memoryUsage();
    const totalMemory = require('os').totalmem();
    const usagePercent = (memoryUsage.heapUsed / totalMemory) * 100;

    if (usagePercent > 80) {
      this.recordSecurityEvent('high_memory_usage', 'warning', {
        usagePercent: usagePercent.toFixed(2),
        heapUsed: memoryUsage.heapUsed,
        totalMemory
      });
    }

    // Check for potential memory leaks
    if (this.lastMemoryCheck) {
      const memoryGrowth = memoryUsage.heapUsed - this.lastMemoryCheck;
      const growthRate = memoryGrowth / (Date.now() - this.lastMemoryCheckTime);
      
      if (growthRate > 1000) { // More than 1KB/ms growth
        this.recordSecurityEvent('potential_memory_leak', 'warning', {
          growthRate: growthRate.toFixed(2),
          memoryGrowth
        });
      }
    }

    this.lastMemoryCheck = memoryUsage.heapUsed;
    this.lastMemoryCheckTime = Date.now();
  }

  /**
   * Check file system security
   */
  async checkFileSystemSecurity() {
    const fs = require('fs');
    const path = require('path');
    
    // Check if critical files have been modified
    const criticalFiles = [
      'package.json',
      'src/config/environment/index.js',
      'src/config/environment/ConfigurationLoader.js'
    ];

    for (const file of criticalFiles) {
      try {
        const filePath = path.join(process.cwd(), file);
        if (fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          const fileKey = `file_${file.replace(/[^a-zA-Z0-9]/g, '_')}`;
          
          if (this.fileHashes && this.fileHashes[fileKey]) {
            const content = fs.readFileSync(filePath, 'utf8');
            const currentHash = this.sanitizer.generateContentHash(content);
            
            if (currentHash !== this.fileHashes[fileKey]) {
              this.recordSecurityEvent('critical_file_modified', 'critical', {
                file,
                expectedHash: this.fileHashes[fileKey],
                actualHash: currentHash
              });
            }
          } else {
            // Initialize file hash
            if (!this.fileHashes) this.fileHashes = {};
            const content = fs.readFileSync(filePath, 'utf8');
            this.fileHashes[fileKey] = this.sanitizer.generateContentHash(content);
          }
        }
      } catch (error) {
        this.recordSecurityEvent('file_check_failed', 'warning', {
          file,
          error: error.message
        });
      }
    }
  }

  /**
   * Check environment security
   */
  async checkEnvironmentSecurity() {
    // Check for suspicious environment variables
    const suspiciousEnvVars = Object.keys(process.env).filter(key => {
      const lowerKey = key.toLowerCase();
      return lowerKey.includes('exploit') || 
             lowerKey.includes('hack') || 
             lowerKey.includes('payload') ||
             lowerKey.includes('injection');
    });

    if (suspiciousEnvVars.length > 0) {
      this.recordSecurityEvent('suspicious_env_vars', 'warning', {
        variables: suspiciousEnvVars
      });
    }

    // Check for environment variable pollution
    const envVarCount = Object.keys(process.env).length;
    if (envVarCount > 200) {
      this.recordSecurityEvent('env_var_pollution', 'warning', {
        count: envVarCount
      });
    }
  }

  /**
   * Check network security
   */
  async checkNetworkSecurity() {
    // Check for suspicious network activity (placeholder - would need actual network monitoring)
    const activeHandles = process._getActiveHandles();
    const activeRequests = process._getActiveRequests();

    if (activeHandles.length > 50) {
      this.recordSecurityEvent('high_active_handles', 'warning', {
        count: activeHandles.length
      });
    }

    if (activeRequests.length > 20) {
      this.recordSecurityEvent('high_active_requests', 'warning', {
        count: activeRequests.length
      });
    }
  }

  /**
   * Check process security
   */
  async checkProcessSecurity() {
    // Check process uptime (very long uptime might indicate issues)
    const uptime = process.uptime();
    if (uptime > 86400 * 7) { // More than 7 days
      this.recordSecurityEvent('long_process_uptime', 'info', {
        uptimeDays: (uptime / 86400).toFixed(2)
      });
    }

    // Check for process title changes
    if (this.originalProcessTitle && process.title !== this.originalProcessTitle) {
      this.recordSecurityEvent('process_title_changed', 'warning', {
        original: this.originalProcessTitle,
        current: process.title
      });
    } else if (!this.originalProcessTitle) {
      this.originalProcessTitle = process.title;
    }
  }

  /**
   * Record a security event
   */
  recordSecurityEvent(type, severity, details = {}) {
    const event = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      type,
      severity,
      details,
      environment: this.environment.environment,
      platform: this.environment.platform,
      pid: process.pid
    };

    // Add to events list
    this.securityEvents.unshift(event);
    
    // Keep only recent events
    if (this.securityEvents.length > this.alertThresholds.maxEvents) {
      this.securityEvents = this.securityEvents.slice(0, this.alertThresholds.maxEvents);
    }

    // Log event
    this.sanitizer.secureLog(severity, `Security event: ${type}`, details);

    // Emit event for listeners
    this.emit('security_event', event);

    // Check if alert threshold is reached
    this.checkAlertThresholds();

    return event;
  }

  /**
   * Check if alert thresholds are reached
   */
  checkAlertThresholds() {
    const now = Date.now();
    const windowStart = now - this.alertThresholds.timeWindow;

    const recentCriticalEvents = this.securityEvents.filter(event => {
      const eventTime = new Date(event.timestamp).getTime();
      return event.severity === 'critical' && eventTime >= windowStart;
    });

    if (recentCriticalEvents.length >= this.alertThresholds.criticalEvents) {
      this.triggerAlert('critical_threshold_reached', {
        eventCount: recentCriticalEvents.length,
        timeWindow: this.alertThresholds.timeWindow / 60000, // minutes
        events: recentCriticalEvents.map(e => ({ type: e.type, timestamp: e.timestamp }))
      });
    }
  }

  /**
   * Trigger a security alert
   */
  triggerAlert(alertType, details) {
    const alert = {
      id: `alert-${Date.now()}`,
      type: alertType,
      timestamp: new Date().toISOString(),
      severity: 'critical',
      details,
      environment: this.environment.environment
    };

    this.sanitizer.secureLog('error', `🚨 Security Alert: ${alertType}`, details);
    
    this.emit('security_alert', alert);

    // In production, this could send to external monitoring services
    if (this.environment.isProduction()) {
      this.sendExternalAlert(alert);
    }
  }

  /**
   * Send alert to external monitoring services
   */
  async sendExternalAlert(alert) {
    try {
      // Placeholder for external alert integration
      // Could integrate with Slack, email, PagerDuty, etc.
      console.error('🚨 SECURITY ALERT 🚨', JSON.stringify(alert, null, 2));
    } catch (error) {
      this.sanitizer.secureLog('error', 'Failed to send external alert', { error: error.message });
    }
  }

  /**
   * Get security event statistics
   */
  getSecurityStats() {
    const now = Date.now();
    const last24Hours = now - (24 * 60 * 60 * 1000);
    const lastHour = now - (60 * 60 * 1000);

    const recentEvents = this.securityEvents.filter(event => {
      const eventTime = new Date(event.timestamp).getTime();
      return eventTime >= last24Hours;
    });

    const recentCritical = recentEvents.filter(e => e.severity === 'critical');
    const recentWarnings = recentEvents.filter(e => e.severity === 'warning');

    return {
      total: this.securityEvents.length,
      last24Hours: recentEvents.length,
      lastHour: this.securityEvents.filter(event => {
        const eventTime = new Date(event.timestamp).getTime();
        return eventTime >= lastHour;
      }).length,
      critical: recentCritical.length,
      warnings: recentWarnings.length,
      mostCommonTypes: this.getMostCommonEventTypes(recentEvents)
    };
  }

  /**
   * Get most common event types
   */
  getMostCommonEventTypes(events, limit = 5) {
    const typeCounts = {};
    
    events.forEach(event => {
      typeCounts[event.type] = (typeCounts[event.type] || 0) + 1;
    });

    return Object.entries(typeCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, limit)
      .map(([type, count]) => ({ type, count }));
  }

  /**
   * Get recent security events
   */
  getRecentEvents(limit = 50) {
    return this.securityEvents.slice(0, limit);
  }

  /**
   * Clear old security events
   */
  clearOldEvents(olderThanMs = 7 * 24 * 60 * 60 * 1000) { // 7 days
    const cutoff = Date.now() - olderThanMs;
    const originalCount = this.securityEvents.length;
    
    this.securityEvents = this.securityEvents.filter(event => {
      const eventTime = new Date(event.timestamp).getTime();
      return eventTime >= cutoff;
    });

    const removed = originalCount - this.securityEvents.length;
    if (removed > 0) {
      this.sanitizer.secureLog('info', 'Cleared old security events', { removed });
    }
  }
}

// Create singleton instance
let monitor = null;

/**
 * Get the security monitor instance
 */
export function getSecurityMonitor() {
  if (!monitor) {
    monitor = new SecurityMonitor();
  }
  return monitor;
}

/**
 * Start security monitoring
 */
export function startSecurityMonitoring() {
  const securityMonitor = getSecurityMonitor();
  securityMonitor.start();
  return securityMonitor;
}

export default SecurityMonitor;