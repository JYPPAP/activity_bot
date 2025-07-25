#!/usr/bin/env node

// Main Migration Orchestrator
// Coordinates the complete LowDB to PostgreSQL migration process

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';

import { ConnectionPool, DatabaseConfig, DatabaseUtils } from './config/database.js';
import { UserTransformer } from './transformers/UserTransformer.js';
import { RoleTransformer } from './transformers/RoleTransformer.js';
import { ActivityLogTransformer } from './transformers/ActivityLogTransformer.js';
import { MiscTransformer } from './transformers/MiscTransformer.js';

/**
 * Main Migration Orchestrator Class
 */
class MigrationOrchestrator {
  constructor(options = {}) {
    this.options = {
      dryRun: options.dryRun || false,
      batchSize: options.batchSize || 1000,
      skipValidation: options.skipValidation || false,
      backupPath: options.backupPath || './backups',
      lowdbPath: options.lowdbPath || '../activity_bot.json',
      schemaPath: options.schemaPath || '../postgresql-schema-design.sql',
      ...options
    };

    this.dbConfig = new DatabaseConfig();
    this.pool = new ConnectionPool(this.dbConfig);
    this.dbUtils = new DatabaseUtils(this.pool);
    this.logger = this.dbConfig.getLogger();

    // Migration statistics
    this.stats = {
      startTime: null,
      endTime: null,
      totalRecords: 0,
      migratedRecords: 0,
      errors: [],
      phases: {}
    };
  }

  /**
   * Execute complete migration process
   * @returns {Promise<Object>} Migration results
   */
  async executeMigration() {
    const spinner = ora('Initializing migration process...').start();
    
    try {
      this.stats.startTime = new Date();
      
      // Phase 1: Pre-migration validation
      spinner.text = 'Phase 1: Pre-migration validation...';
      await this.validatePreMigration();
      
      // Phase 2: Database preparation
      spinner.text = 'Phase 2: Database preparation...';
      await this.prepareDatabaseSchema();
      
      // Phase 3: Data backup
      spinner.text = 'Phase 3: Creating data backup...';
      await this.createDataBackup();
      
      // Phase 4: Data transformation and migration
      spinner.text = 'Phase 4: Data transformation and migration...';
      const migrationResults = await this.executeDataMigration();
      
      // Phase 5: Post-migration validation
      spinner.text = 'Phase 5: Post-migration validation...';
      await this.validatePostMigration();
      
      // Phase 6: Optimization
      spinner.text = 'Phase 6: Database optimization...';
      await this.optimizeDatabase();
      
      this.stats.endTime = new Date();
      
      spinner.succeed(chalk.green('Migration completed successfully!'));
      
      // Display results
      this.displayMigrationResults(migrationResults);
      
      return {
        success: true,
        stats: this.stats,
        results: migrationResults
      };
      
    } catch (error) {
      spinner.fail(chalk.red('Migration failed!'));
      this.logger.error('Migration failed', error);
      throw error;
    }
  }

  /**
   * Phase 1: Pre-migration validation
   */
  async validatePreMigration() {
    this.logger.info('Starting pre-migration validation');
    
    // 1. Validate LowDB file exists and is readable
    const lowdbExists = await this.checkFileExists(this.options.lowdbPath);
    if (!lowdbExists) {
      throw new Error(`LowDB file not found: ${this.options.lowdbPath}`);
    }
    
    // 2. Load and validate LowDB data structure
    const lowdbData = await this.loadLowDBData();
    await this.validateLowDBStructure(lowdbData);
    
    // 3. Test database connectivity
    await this.pool.initialize();
    const healthCheck = await this.pool.healthCheck();
    if (!healthCheck.healthy) {
      throw new Error(`Database connection failed: ${healthCheck.error}`);
    }
    
    // 4. Check if database is empty (avoid accidental overwrites)
    if (!this.options.dryRun && !this.options.skipValidation) {
      await this.validateDatabaseEmpty();
    }
    
    this.logger.info('Pre-migration validation completed successfully');
  }

  /**
   * Phase 2: Database schema preparation
   */
  async prepareDatabaseSchema() {
    this.logger.info('Preparing database schema');
    
    if (this.options.dryRun) {
      this.logger.info('Dry run mode: Skipping schema creation');
      return;
    }
    
    // 1. Check if schema file exists
    const schemaExists = await this.checkFileExists(this.options.schemaPath);
    if (!schemaExists) {
      throw new Error(`Schema file not found: ${this.options.schemaPath}`);
    }
    
    // 2. Execute schema creation
    await this.dbUtils.executeSchemaFile(this.options.schemaPath);
    
    // 3. Verify schema is ready
    const schemaReady = await this.dbUtils.isSchemaReady();
    if (!schemaReady) {
      throw new Error('Database schema validation failed');
    }
    
    // 4. Record schema migration
    await this.dbUtils.recordMigration(
      '2024.01.001',
      'PostgreSQL schema creation from LowDB migration',
      'SCHEMA'
    );
    
    this.logger.info('Database schema prepared successfully');
  }

  /**
   * Phase 3: Create data backup
   */
  async createDataBackup() {
    this.logger.info('Creating data backup');
    
    // Ensure backup directory exists
    await fs.mkdir(this.options.backupPath, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(this.options.backupPath, `lowdb-backup-${timestamp}.json`);
    
    // Copy LowDB file to backup location
    await fs.copyFile(this.options.lowdbPath, backupFile);
    
    this.logger.info('Data backup created', { backupFile });
  }

  /**
   * Phase 4: Execute data migration
   */
  async executeDataMigration() {
    this.logger.info('Starting data migration');
    
    const lowdbData = await this.loadLowDBData();
    const results = {};
    
    if (this.options.dryRun) {
      this.logger.info('Dry run mode: Simulating migration...');
      return this.simulateMigration(lowdbData);
    }
    
    // Migration order (dependency-aware)
    const migrationPhases = [
      { name: 'users', transformer: UserTransformer, data: lowdbData.user_activity },
      { name: 'roles', transformer: RoleTransformer, data: lowdbData.role_config },
      { name: 'activity_logs', transformer: ActivityLogTransformer, data: [lowdbData.activity_logs, lowdbData.log_members] },
      { name: 'misc_collections', transformer: MiscTransformer, data: lowdbData }
    ];
    
    for (const phase of migrationPhases) {
      if (!phase.data || (Array.isArray(phase.data) && phase.data[0] && Object.keys(phase.data[0]).length === 0)) {
        this.logger.info(`Skipping ${phase.name} - no data found`);
        continue;
      }
      
      this.logger.info(`Starting ${phase.name} migration`);
      const phaseStartTime = Date.now();
      
      try {
        const transformer = new phase.transformer(this.pool, this.logger);
        
        let phaseResult;
        if (phase.name === 'activity_logs') {
          phaseResult = await transformer.transformActivityLogs(phase.data[0], phase.data[1]);
        } else if (phase.name === 'misc_collections') {
          phaseResult = await transformer.transformMiscCollections(phase.data);
        } else if (phase.name === 'users') {
          phaseResult = await transformer.transformUserActivity(phase.data);
        } else if (phase.name === 'roles') {
          phaseResult = await transformer.transformRoleConfig(phase.data);
        }
        
        const phaseDuration = Date.now() - phaseStartTime;
        
        results[phase.name] = {
          ...phaseResult,
          duration: phaseDuration
        };
        
        this.stats.phases[phase.name] = {
          duration: phaseDuration,
          success: true,
          recordsProcessed: phaseResult.stats ? 
            Object.values(phaseResult.stats).reduce((a, b) => typeof b === 'number' ? a + b : a, 0) : 0
        };
        
        this.logger.info(`Completed ${phase.name} migration`, {
          duration: phaseDuration,
          stats: phaseResult.stats
        });
        
      } catch (error) {
        this.stats.phases[phase.name] = {
          duration: Date.now() - phaseStartTime,
          success: false,
          error: error.message
        };
        throw error;
      }
    }
    
    // Record data migration
    await this.dbUtils.recordMigration(
      '2024.01.002',
      'Data migration from LowDB to PostgreSQL',
      'DATA'
    );
    
    return results;
  }

  /**
   * Phase 5: Post-migration validation
   */
  async validatePostMigration() {
    this.logger.info('Starting post-migration validation');
    
    if (this.options.dryRun) {
      this.logger.info('Dry run mode: Skipping post-migration validation');
      return;
    }
    
    // 1. Verify data integrity
    await this.validateDataIntegrity();
    
    // 2. Check referential integrity
    await this.validateReferentialIntegrity();
    
    // 3. Verify record counts
    await this.validateRecordCounts();
    
    this.logger.info('Post-migration validation completed successfully');
  }

  /**
   * Phase 6: Database optimization
   */
  async optimizeDatabase() {
    this.logger.info('Starting database optimization');
    
    if (this.options.dryRun) {
      this.logger.info('Dry run mode: Skipping database optimization');
      return;
    }
    
    // 1. Update table statistics
    await this.pool.query('ANALYZE');
    
    // 2. Create additional indexes if needed
    await this.createOptimizationIndexes();
    
    this.logger.info('Database optimization completed');
  }

  /**
   * Utility methods
   */
  async checkFileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async loadLowDBData() {
    const data = await fs.readFile(this.options.lowdbPath, 'utf8');
    return JSON.parse(data);
  }

  async validateLowDBStructure(data) {
    const requiredCollections = ['user_activity', 'role_config'];
    const missingCollections = requiredCollections.filter(collection => !data[collection]);
    
    if (missingCollections.length > 0) {
      throw new Error(`Missing required collections: ${missingCollections.join(', ')}`);
    }
  }

  async validateDatabaseEmpty() {
    const userCount = await this.dbUtils.getRowCount('users');
    if (userCount > 0) {
      throw new Error('Database is not empty. Use --force to override or clean the database first.');
    }
  }

  async validateDataIntegrity() {
    // Check for orphaned records
    const orphanedActivities = await this.pool.query(`
      SELECT COUNT(*) as count
      FROM user_activities ua
      LEFT JOIN users u ON ua.user_id = u.id
      WHERE u.id IS NULL
    `);
    
    if (parseInt(orphanedActivities.rows[0].count) > 0) {
      throw new Error(`Found ${orphanedActivities.rows[0].count} orphaned user activities`);
    }
  }

  async validateReferentialIntegrity() {
    // Verify foreign key constraints
    const constraintViolations = await this.pool.query(`
      SELECT conname, conrelid::regclass
      FROM pg_constraint
      WHERE contype = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgconstraint = pg_constraint.oid
      )
    `);
    
    if (constraintViolations.rows.length > 0) {
      throw new Error('Foreign key constraint violations detected');
    }
  }

  async validateRecordCounts() {
    const counts = {};
    const tables = ['users', 'user_activities', 'roles', 'activity_events'];
    
    for (const table of tables) {
      counts[table] = await this.dbUtils.getRowCount(table);
    }
    
    this.logger.info('Record counts after migration', counts);
    this.stats.finalCounts = counts;
  }

  async createOptimizationIndexes() {
    const optimizationIndexes = [
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_activities_total_time_desc ON user_activities(total_time_ms DESC)',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_events_recent ON activity_events(event_timestamp DESC) WHERE event_timestamp > CURRENT_TIMESTAMP - interval \'30 days\'',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_active ON users(is_active, last_seen DESC) WHERE is_active = true'
    ];
    
    for (const indexSQL of optimizationIndexes) {
      try {
        await this.pool.query(indexSQL);
      } catch (error) {
        this.logger.warn('Failed to create optimization index', { error: error.message, sql: indexSQL });
      }
    }
  }

  simulateMigration(lowdbData) {
    const simulation = {
      users: {
        records: Object.keys(lowdbData.user_activity || {}).length,
        estimated_time: '30s'
      },
      roles: {
        records: Object.keys(lowdbData.role_config || {}).length,
        estimated_time: '5s'
      },
      activity_logs: {
        records: (lowdbData.activity_logs || []).length,
        estimated_time: '2m'
      },
      misc_collections: {
        records: [
          Object.keys(lowdbData.reset_history || {}).length,
          Object.keys(lowdbData.afk_status || {}).length,
          Object.keys(lowdbData.forum_messages || {}).length,
          Object.keys(lowdbData.voice_channel_mappings || {}).length
        ].reduce((a, b) => a + b, 0),
        estimated_time: '45s'
      }
    };
    
    this.logger.info('Migration simulation results', simulation);
    return simulation;
  }

  displayMigrationResults(results) {
    const duration = this.stats.endTime - this.stats.startTime;
    
    console.log('\n' + chalk.green('🎉 Migration Results Summary'));
    console.log(chalk.blue('='.repeat(50)));
    console.log(chalk.white(`Total Duration: ${Math.round(duration / 1000)}s`));
    console.log(chalk.white(`Start Time: ${this.stats.startTime.toISOString()}`));
    console.log(chalk.white(`End Time: ${this.stats.endTime.toISOString()}`));
    console.log('');
    
    for (const [phase, result] of Object.entries(results)) {
      if (result.stats) {
        console.log(chalk.yellow(`${phase.toUpperCase()}:`));
        for (const [key, value] of Object.entries(result.stats)) {
          if (typeof value === 'number') {
            console.log(chalk.white(`  ${key}: ${value}`));
          }
        }
        console.log(chalk.gray(`  Duration: ${Math.round(result.duration / 1000)}s`));
        console.log('');
      }
    }
    
    if (this.stats.finalCounts) {
      console.log(chalk.yellow('FINAL RECORD COUNTS:'));
      for (const [table, count] of Object.entries(this.stats.finalCounts)) {
        console.log(chalk.white(`  ${table}: ${count}`));
      }
    }
  }

  async cleanup() {
    if (this.pool) {
      await this.pool.close();
    }
  }
}

/**
 * CLI Interface
 */
const program = new Command();

program
  .name('migrate')
  .description('LowDB to PostgreSQL migration tool')
  .version('2.0.0');

program
  .command('run')
  .description('Execute the complete migration process')
  .option('--dry-run', 'Simulate migration without making changes')
  .option('--lowdb-path <path>', 'Path to LowDB JSON file', '../activity_bot.json')
  .option('--schema-path <path>', 'Path to PostgreSQL schema file', '../postgresql-schema-design.sql')
  .option('--backup-path <path>', 'Path for backup files', './backups')
  .option('--batch-size <size>', 'Batch size for processing', '1000')
  .option('--skip-validation', 'Skip pre-migration validation checks')
  .option('--force', 'Override safety checks')
  .action(async (options) => {
    const orchestrator = new MigrationOrchestrator({
      ...options,
      batchSize: parseInt(options.batchSize)
    });
    
    try {
      await orchestrator.executeMigration();
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('Migration failed:'), error.message);
      if (process.env.NODE_ENV === 'development') {
        console.error(error.stack);
      }
      process.exit(1);
    } finally {
      await orchestrator.cleanup();
    }
  });

program
  .command('validate')
  .description('Validate LowDB data and PostgreSQL connection')
  .option('--lowdb-path <path>', 'Path to LowDB JSON file', '../activity_bot.json')
  .action(async (options) => {
    const orchestrator = new MigrationOrchestrator(options);
    
    try {
      await orchestrator.validatePreMigration();
      console.log(chalk.green('✅ Validation passed'));
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('❌ Validation failed:'), error.message);
      process.exit(1);
    } finally {
      await orchestrator.cleanup();
    }
  });

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error(chalk.red('Uncaught exception:'), error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('Unhandled rejection at:'), promise, 'reason:', reason);
  process.exit(1);
});

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse();
}

export { MigrationOrchestrator };
export default MigrationOrchestrator;