// src/commands/CommandRegistry.js - Performance-optimized dynamic command loading system
import { performance } from 'perf_hooks';
import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class CommandRegistry {
  constructor() {
    this.commands = new Map();
    this.commandCategories = new Map();
    this.commandMetrics = new Map();
    this.loadedCommands = new Set();
    this.loadStartTime = null;
    
    // Performance thresholds (ms)
    this.LOAD_TIME_WARNING = 100;
    this.EXECUTION_TIME_WARNING = 1000;
    
    // Command categories for optimization
    this.categories = {
      CORE: { priority: 1, loadOnStartup: true },
      ADMIN: { priority: 2, loadOnStartup: false }, 
      UTILITY: { priority: 3, loadOnStartup: false },
      INTEGRATION: { priority: 4, loadOnStartup: false }
    };
  }

  /**
   * Initialize command registry with performance monitoring
   */
  async initialize(services) {
    const startTime = performance.now();
    this.loadStartTime = startTime;
    this.services = services;

    console.log('🚀 CommandRegistry: Starting dynamic command loading...');

    try {
      // Load command metadata first (fast operation)
      await this.loadCommandMetadata();
      
      // Load core commands immediately for fastest startup
      await this.loadCoreCommands();
      
      // Schedule non-core commands for lazy loading
      this.scheduleRemainingCommands();
      
      const loadTime = performance.now() - startTime;
      console.log(`✅ CommandRegistry: Core commands loaded in ${loadTime.toFixed(2)}ms`);
      
      return true;
    } catch (error) {
      console.error('❌ CommandRegistry: Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Load command metadata without instantiating commands
   */
  async loadCommandMetadata() {
    const commandsDir = __dirname;
    const files = await readdir(commandsDir);
    
    const commandFiles = files.filter(file => 
      file.endsWith('Command.js') && 
      file !== 'CommandBase.js' &&
      file !== 'CommandRegistry.js'
    );

    // Define command categories for performance optimization
    const commandCategories = {
      // Core commands - load immediately
      'gapCheckCommand.js': 'CORE',
      'recruitmentCommand.js': 'CORE',
      
      // Admin commands - lazy load
      'gapReportCommand.js': 'ADMIN',
      'gapAfkCommand.js': 'ADMIN'
    };

    for (const file of commandFiles) {
      const category = commandCategories[file] || 'UTILITY';
      this.commandCategories.set(file, category);
      
      // Initialize metrics tracking
      this.commandMetrics.set(file, {
        loadTime: 0,
        executionCount: 0,
        totalExecutionTime: 0,
        averageExecutionTime: 0,
        lastUsed: null,
        errors: 0
      });
    }
  }

  /**
   * Load core commands immediately for optimal startup performance
   */
  async loadCoreCommands() {
    const coreCommands = Array.from(this.commandCategories.entries())
      .filter(([file, category]) => category === 'CORE')
      .map(([file]) => file);

    for (const file of coreCommands) {
      await this.loadCommand(file);
    }
  }

  /**
   * Schedule remaining commands for lazy loading
   */
  scheduleRemainingCommands() {
    const nonCoreCommands = Array.from(this.commandCategories.entries())
      .filter(([file, category]) => category !== 'CORE')
      .map(([file]) => file);

    // Use setTimeout to load non-core commands after startup
    setTimeout(async () => {
      console.log('📦 CommandRegistry: Loading remaining commands...');
      const startTime = performance.now();
      
      for (const file of nonCoreCommands) {
        await this.loadCommand(file);
      }
      
      const loadTime = performance.now() - startTime;
      console.log(`✅ CommandRegistry: All commands loaded in ${loadTime.toFixed(2)}ms`);
    }, 100); // Minimal delay to not block startup
  }

  /**
   * Dynamically load a command with performance monitoring
   */
  async loadCommand(filename) {
    if (this.loadedCommands.has(filename)) {
      return; // Already loaded
    }

    const loadStart = performance.now();
    
    try {
      const commandPath = join(__dirname, filename);
      const module = await import(commandPath);
      
      // Get the command class (assuming export pattern)
      const CommandClass = Object.values(module)[0];
      
      if (!CommandClass) {
        throw new Error(`No command class found in ${filename}`);
      }

      // Create command instance with appropriate services
      const commandInstance = this.createCommandInstance(CommandClass, filename);
      
      // Extract command name and register
      const commandName = this.extractCommandName(commandInstance, filename);
      this.commands.set(commandName, commandInstance);
      
      this.loadedCommands.add(filename);
      
      const loadTime = performance.now() - loadStart;
      this.commandMetrics.get(filename).loadTime = loadTime;
      
      // Warn about slow loading commands
      if (loadTime > this.LOAD_TIME_WARNING) {
        console.warn(`⚠️ Slow command load: ${filename} took ${loadTime.toFixed(2)}ms`);
      }
      
      console.log(`📁 Loaded: ${commandName} (${loadTime.toFixed(2)}ms)`);
      
    } catch (error) {
      console.error(`❌ Failed to load command ${filename}:`, error);
      this.commandMetrics.get(filename).errors++;
      throw error;
    }
  }

  /**
   * Create command instance with appropriate service dependencies
   */
  createCommandInstance(CommandClass, filename) {
    const { client, activityTracker, dbManager, calendarLogService, voiceForumService, userClassificationService } = this.services;
    
    // Service dependency mapping for performance optimization
    const serviceMappings = {
      'gapCheckCommand.js': () => new CommandClass(activityTracker, dbManager),
      'gapReportCommand.js': () => {
        const cmd = new CommandClass(dbManager, activityTracker);
        if (cmd.setUserClassificationService) {
          cmd.setUserClassificationService(userClassificationService);
        }
        return cmd;
      },
      'gapAfkCommand.js': () => new CommandClass(client, dbManager),
      'recruitmentCommand.js': () => new CommandClass({ client, voiceForumService })
    };

    const factory = serviceMappings[filename];
    if (factory) {
      return factory();
    }

    // Fallback for unknown commands
    return new CommandClass(this.services);
  }

  /**
   * Extract command name from instance or filename
   */
  extractCommandName(commandInstance, filename) {
    // Command name mapping for performance
    const nameMapping = {
      'gapCheckCommand.js': '시간체크',
      'gapReportCommand.js': '보고서',
      'gapAfkCommand.js': '잠수',
      'recruitmentCommand.js': '구직'
    };

    return nameMapping[filename] || filename.replace('Command.js', '').toLowerCase();
  }

  /**
   * Get command with lazy loading support
   */
  async getCommand(commandName) {
    // If command is already loaded, return immediately
    if (this.commands.has(commandName)) {
      return this.commands.get(commandName);
    }

    // Try to lazy load the command
    const filename = this.findCommandFile(commandName);
    if (filename && !this.loadedCommands.has(filename)) {
      await this.loadCommand(filename);
      return this.commands.get(commandName);
    }

    return null;
  }

  /**
   * Find command file by command name
   */
  findCommandFile(commandName) {
    const reverseMapping = {
      '시간체크': 'gapCheckCommand.js',
      '보고서': 'gapReportCommand.js',
      '잠수': 'gapAfkCommand.js',
      '구직': 'recruitmentCommand.js'
    };

    return reverseMapping[commandName];
  }

  /**
   * Track command execution performance
   */
  trackExecution(commandName, executionTime, success = true) {
    const filename = this.findCommandFile(commandName);
    if (!filename) return;

    const metrics = this.commandMetrics.get(filename);
    if (!metrics) return;

    metrics.executionCount++;
    metrics.totalExecutionTime += executionTime;
    metrics.averageExecutionTime = metrics.totalExecutionTime / metrics.executionCount;
    metrics.lastUsed = new Date();

    if (!success) {
      metrics.errors++;
    }

    // Warn about slow commands
    if (executionTime > this.EXECUTION_TIME_WARNING) {
      console.warn(`⚠️ Slow command execution: ${commandName} took ${executionTime.toFixed(2)}ms`);
    }
  }

  /**
   * Get performance analytics
   */
  getAnalytics() {
    const totalLoadTime = this.loadStartTime ? performance.now() - this.loadStartTime : 0;
    
    const commandStats = Array.from(this.commandMetrics.entries()).map(([filename, metrics]) => ({
      filename,
      category: this.commandCategories.get(filename),
      ...metrics,
      isLoaded: this.loadedCommands.has(filename)
    }));

    return {
      totalCommands: this.commandMetrics.size,
      loadedCommands: this.loadedCommands.size,
      totalLoadTime: totalLoadTime.toFixed(2),
      commandStats,
      slowLoadingCommands: commandStats.filter(cmd => cmd.loadTime > this.LOAD_TIME_WARNING),
      slowExecutingCommands: commandStats.filter(cmd => cmd.averageExecutionTime > this.EXECUTION_TIME_WARNING),
      mostUsedCommands: commandStats.sort((a, b) => b.executionCount - a.executionCount).slice(0, 5),
      errorProneCommands: commandStats.filter(cmd => cmd.errors > 0)
    };
  }

  /**
   * Get all loaded commands
   */
  getAllCommands() {
    return this.commands;
  }

  /**
   * Check if command exists (without loading)
   */
  hasCommand(commandName) {
    return this.commands.has(commandName) || !!this.findCommandFile(commandName);
  }
}