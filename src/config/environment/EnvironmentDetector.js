// src/config/environment/EnvironmentDetector.js - Environment Detection Module
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * EnvironmentDetector - Detects and validates the runtime environment
 * Supports: development, production, staging, test, termux
 */
export class EnvironmentDetector {
  constructor() {
    this.environment = null;
    this.platform = null;
    this.features = new Set();
    this.metadata = {};
  }

  /**
   * Detect the current environment based on multiple factors
   */
  detect() {
    // 1. Check explicit NODE_ENV
    const nodeEnv = process.env.NODE_ENV?.toLowerCase();
    
    // 2. Detect platform and special environments
    this.detectPlatform();
    
    // 3. Determine environment
    this.environment = this.determineEnvironment(nodeEnv);
    
    // 4. Detect available features
    this.detectFeatures();
    
    // 5. Collect metadata
    this.collectMetadata();
    
    return {
      environment: this.environment,
      platform: this.platform,
      features: Array.from(this.features),
      metadata: this.metadata,
      isProduction: this.isProduction(),
      isDevelopment: this.isDevelopment(),
      isTest: this.isTest(),
      isStaging: this.isStaging(),
      isTermux: this.isTermux()
    };
  }

  /**
   * Detect the runtime platform
   */
  detectPlatform() {
    const platform = process.platform;
    
    // Check for Termux environment
    if (this.isTermuxEnvironment()) {
      this.platform = 'termux';
      this.features.add('mobile');
      this.features.add('limited-resources');
    } else if (platform === 'darwin') {
      this.platform = 'macos';
    } else if (platform === 'win32') {
      this.platform = 'windows';
    } else if (platform === 'linux') {
      this.platform = 'linux';
    } else {
      this.platform = platform;
    }
  }

  /**
   * Check if running in Termux environment
   */
  isTermuxEnvironment() {
    // Multiple checks for Termux detection
    return (
      process.env.PREFIX?.includes('com.termux') ||
      process.env.TERMUX_VERSION !== undefined ||
      fs.existsSync('/data/data/com.termux') ||
      process.env.HOME?.includes('com.termux')
    );
  }

  /**
   * Determine the environment based on various factors
   */
  determineEnvironment(nodeEnv) {
    // Priority order for environment detection
    
    // 1. Explicit NODE_ENV
    if (nodeEnv) {
      if (['prod', 'production'].includes(nodeEnv)) return 'production';
      if (['dev', 'development'].includes(nodeEnv)) return 'development';
      if (['test', 'testing'].includes(nodeEnv)) return 'test';
      if (['stage', 'staging'].includes(nodeEnv)) return 'staging';
      return nodeEnv; // Allow custom environments
    }
    
    // 2. Check for CI/CD environments
    if (this.isCI()) {
      return 'test';
    }
    
    // 3. Check for specific environment files
    const rootDir = path.resolve(__dirname, '../../..');
    if (fs.existsSync(path.join(rootDir, '.env.production'))) {
      return 'production';
    }
    if (fs.existsSync(path.join(rootDir, '.env.development'))) {
      return 'development';
    }
    
    // 4. Check command line arguments
    const args = process.argv.join(' ');
    if (args.includes('--production') || args.includes('--prod')) {
      return 'production';
    }
    if (args.includes('--development') || args.includes('--dev')) {
      return 'development';
    }
    
    // 5. Default based on platform
    if (this.platform === 'termux') {
      return 'production'; // Termux usually runs production
    }
    
    // 6. Default fallback
    return 'development';
  }

  /**
   * Detect available features based on environment
   */
  detectFeatures() {
    // File system features
    try {
      const testFile = path.join(os.tmpdir(), `.env-detect-${Date.now()}`);
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      this.features.add('file-write');
    } catch {
      // Limited file system access
    }
    
    // Network features
    if (process.env.ERRSOLE_HOST || process.env.SLACK_WEBHOOK_URL) {
      this.features.add('external-monitoring');
    }
    
    // PM2 detection
    if (process.env.PM2 || process.env.pm_id !== undefined) {
      this.features.add('pm2');
      this.features.add('process-management');
    }
    
    // Docker detection
    if (fs.existsSync('/.dockerenv') || process.env.DOCKER_CONTAINER) {
      this.features.add('docker');
      this.features.add('containerized');
    }
    
    // Development features
    if (this.environment === 'development') {
      this.features.add('hot-reload');
      this.features.add('debug-mode');
      this.features.add('verbose-logging');
    }
    
    // Production features
    if (this.environment === 'production') {
      this.features.add('performance-mode');
      this.features.add('error-reporting');
      this.features.add('monitoring');
    }
  }

  /**
   * Collect metadata about the environment
   */
  collectMetadata() {
    this.metadata = {
      nodeVersion: process.version,
      platform: this.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      uptime: os.uptime(),
      hostname: os.hostname(),
      user: os.userInfo().username,
      cwd: process.cwd(),
      pid: process.pid,
      ppid: process.ppid,
      execPath: process.execPath,
      v8Version: process.versions.v8,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: Intl.DateTimeFormat().resolvedOptions().locale
    };
    
    // Add PM2 specific metadata
    if (this.features.has('pm2')) {
      this.metadata.pm2 = {
        id: process.env.pm_id,
        name: process.env.name,
        instances: process.env.instances
      };
    }
    
    // Add container metadata
    if (this.features.has('docker')) {
      this.metadata.container = {
        isDocker: true,
        hostname: this.metadata.hostname
      };
    }
  }

  /**
   * Check if running in CI environment
   */
  isCI() {
    return !!(
      process.env.CI ||
      process.env.CONTINUOUS_INTEGRATION ||
      process.env.GITHUB_ACTIONS ||
      process.env.GITLAB_CI ||
      process.env.JENKINS ||
      process.env.TRAVIS
    );
  }

  // Helper methods
  isProduction() {
    return this.environment === 'production';
  }

  isDevelopment() {
    return this.environment === 'development';
  }

  isTest() {
    return this.environment === 'test';
  }

  isStaging() {
    return this.environment === 'staging';
  }

  isTermux() {
    return this.platform === 'termux';
  }

  hasFeature(feature) {
    return this.features.has(feature);
  }
}

// Singleton instance
let detector = null;

/**
 * Get the environment detector instance
 */
export function getEnvironment() {
  if (!detector) {
    detector = new EnvironmentDetector();
    detector.detect();
  }
  return detector;
}

// Export detected environment for convenience
export const ENVIRONMENT = getEnvironment();