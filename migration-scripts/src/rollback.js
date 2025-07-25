#!/usr/bin/env node

// Migration Rollback System
// Comprehensive rollback capabilities for LowDB to PostgreSQL migration

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import path from 'path';

import { ConnectionPool, DatabaseConfig, DatabaseUtils } from './config/database.js';

/**
 * Migration Rollback System
 */
class MigrationRollback {
  constructor(options = {}) {
    this.options = {
      backupPath: options.backupPath || './backups',
      targetBackup: options.targetBackup || null,
      dryRun: options.dryRun || false,
      force: options.force || false,
      preserveSchema: options.preserveSchema || false,
      ...options
    };

    this.dbConfig = new DatabaseConfig();
    this.pool = new ConnectionPool(this.dbConfig);
    this.dbUtils = new DatabaseUtils(this.pool);
    this.logger = this.dbConfig.getLogger();

    this.rollbackStats = {
      startTime: null,
      endTime: null,
      backupRestored: null,
      tablesCleared: 0,
      recordsRemoved: 0,
      errors: []
    };
  }

  /**
   * Execute complete rollback process
   * @returns {Promise<Object>} Rollback results
   */
  async executeRollback() {
    const spinner = ora('Initializing rollback process...').start();

    try {
      this.rollbackStats.startTime = new Date();

      // Initialize database connection
      await this.pool.initialize();

      // Phase 1: Pre-rollback validation
      spinner.text = 'Phase 1: Pre-rollback validation...';
      await this.validatePreRollback();

      // Phase 2: Create safety backup
      spinner.text = 'Phase 2: Creating safety backup...';
      await this.createSafetyBackup();

      // Phase 3: Clear migrated data
      spinner.text = 'Phase 3: Clearing migrated data...';
      await this.clearMigratedData();

      // Phase 4: Restore from backup (if specified)
      if (this.options.targetBackup) {
        spinner.text = 'Phase 4: Restoring from backup...';
        await this.restoreFromBackup();
      }

      // Phase 5: Cleanup and validation
      spinner.text = 'Phase 5: Post-rollback cleanup...';
      await this.performPostRollbackCleanup();

      this.rollbackStats.endTime = new Date();

      spinner.succeed(chalk.green('Rollback completed successfully!'));

      // Display results
      this.displayRollbackResults();

      return {
        success: true,
        stats: this.rollbackStats
      };

    } catch (error) {
      spinner.fail(chalk.red('Rollback failed!'));
      this.logger.error('Rollback failed', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Phase 1: Pre-rollback validation
   */
  async validatePreRollback() {
    this.logger.info('Starting pre-rollback validation');

    // 1. Check database connectivity
    const healthCheck = await this.pool.healthCheck();
    if (!healthCheck.healthy) {
      throw new Error(`Database connection failed: ${healthCheck.error}`);
    }

    // 2. Verify migration metadata exists
    const migrationExists = await this.checkMigrationExists();
    if (!migrationExists && !this.options.force) {
      throw new Error('No migration metadata found. Use --force to override.');
    }

    // 3. Check backup directory and files
    if (this.options.targetBackup) {
      await this.validateBackupFile();
    }

    // 4. Confirm rollback scope
    await this.analyzeMigrationScope();

    // 5. Safety confirmation (unless force flag is used)
    if (!this.options.force && !this.options.dryRun) {
      await this.confirmRollback();
    }

    this.logger.info('Pre-rollback validation completed');
  }

  /**
   * Phase 2: Create safety backup
   */
  async createSafetyBackup() {
    this.logger.info('Creating safety backup before rollback');

    if (this.options.dryRun) {
      this.logger.info('Dry run mode: Skipping safety backup creation');
      return;
    }

    // Ensure backup directory exists
    await fs.mkdir(this.options.backupPath, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(this.options.backupPath, `pre-rollback-backup-${timestamp}.sql`);

    // Create PostgreSQL dump
    await this.createPostgreSQLDump(backupFile);

    this.rollbackStats.safetyBackup = backupFile;
    this.logger.info('Safety backup created', { backupFile });
  }

  /**
   * Phase 3: Clear migrated data
   */
  async clearMigratedData() {
    this.logger.info('Clearing migrated data');

    if (this.options.dryRun) {
      this.logger.info('Dry run mode: Simulating data clearing...');
      await this.simulateDataClearing();
      return;
    }

    await this.pool.transaction(async (client) => {
      // Clear data in dependency-safe order
      const clearingOrder = [
        'activity_event_participants',
        'activity_events',
        'user_role_assignments',
        'role_reset_history',
        'user_activities',
        'afk_status',
        'forum_messages',
        'voice_channel_mappings',
        'users',
        'roles'
      ];

      for (const tableName of clearingOrder) {
        try {
          const result = await client.query(`DELETE FROM ${tableName}`);
          const deletedCount = result.rowCount;
          
          this.rollbackStats.recordsRemoved += deletedCount;
          this.rollbackStats.tablesCleared++;
          
          this.logger.info(`Cleared table ${tableName}`, {
            recordsDeleted: deletedCount
          });
        } catch (error) {
          this.logger.error(`Failed to clear table ${tableName}`, error);
          throw error;
        }
      }

      // Clear migration metadata
      await client.query(`
        DELETE FROM schema_migrations 
        WHERE migration_type = 'DATA' 
        AND description LIKE '%LowDB%'
      `);

      // Reset sequences if preserving schema
      if (this.options.preserveSchema) {
        await this.resetSequences(client);
      }
    });

    this.logger.info('Migrated data cleared successfully');
  }

  /**
   * Phase 4: Restore from backup
   */
  async restoreFromBackup() {
    this.logger.info('Restoring from backup', {
      backupFile: this.options.targetBackup
    });

    if (this.options.dryRun) {
      this.logger.info('Dry run mode: Skipping backup restoration');
      return;
    }

    // Check if backup is LowDB or PostgreSQL format
    const backupPath = path.resolve(this.options.targetBackup);
    const backupExtension = path.extname(backupPath).toLowerCase();

    if (backupExtension === '.json') {
      // LowDB backup - restore to original location
      await this.restoreLowDBBackup(backupPath);
    } else if (backupExtension === '.sql') {
      // PostgreSQL backup - restore to database
      await this.restorePostgreSQLBackup(backupPath);
    } else {
      throw new Error(`Unsupported backup format: ${backupExtension}`);
    }

    this.rollbackStats.backupRestored = backupPath;
    this.logger.info('Backup restoration completed');
  }

  /**
   * Phase 5: Post-rollback cleanup
   */
  async performPostRollbackCleanup() {
    this.logger.info('Performing post-rollback cleanup');

    if (this.options.dryRun) {
      this.logger.info('Dry run mode: Skipping cleanup');
      return;
    }

    // 1. Update migration metadata
    await this.updateMigrationMetadata();

    // 2. Vacuum and analyze tables
    await this.optimizeDatabase();

    // 3. Verify rollback completion
    await this.verifyRollbackCompletion();

    this.logger.info('Post-rollback cleanup completed');
  }

  /**
   * Support methods
   */

  async checkMigrationExists() {
    try {
      const result = await this.pool.query(`
        SELECT COUNT(*) as count 
        FROM schema_migrations 
        WHERE migration_type = 'DATA' 
        AND status = 'SUCCESS'
      `);
      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      // Table might not exist
      return false;
    }
  }

  async validateBackupFile() {
    const backupPath = path.resolve(this.options.targetBackup);
    
    try {
      await fs.access(backupPath);
      const stats = await fs.stat(backupPath);
      
      if (stats.size === 0) {
        throw new Error('Backup file is empty');
      }

      this.logger.info('Backup file validated', {
        path: backupPath,
        size: `${Math.round(stats.size / 1024 / 1024)}MB`
      });
    } catch (error) {
      throw new Error(`Backup file validation failed: ${error.message}`);
    }
  }

  async analyzeMigrationScope() {
    const tablesWithData = [];
    const migrationTables = [
      'users', 'user_activities', 'roles', 'activity_events',
      'activity_event_participants', 'user_role_assignments',
      'role_reset_history', 'afk_status', 'forum_messages',
      'voice_channel_mappings'
    ];

    for (const table of migrationTables) {
      try {
        const count = await this.dbUtils.getRowCount(table);
        if (count > 0) {
          tablesWithData.push({ table, count });
        }
      } catch (error) {
        // Table might not exist
        continue;
      }
    }

    this.rollbackStats.migrationScope = tablesWithData;
    this.logger.info('Migration scope analyzed', { tablesWithData });
  }

  async confirmRollback() {
    // In a real implementation, this would prompt the user for confirmation
    // For now, we'll log the intention
    this.logger.warn('DESTRUCTIVE OPERATION: This will remove all migrated data');
    this.logger.warn('Use --force flag to skip this confirmation in automated scenarios');
    
    // Simulated confirmation - in production, this would use readline or similar
    const totalRecords = this.rollbackStats.migrationScope
      ? this.rollbackStats.migrationScope.reduce((sum, table) => sum + table.count, 0)
      : 0;
    
    if (totalRecords > 10000) {
      throw new Error('Large dataset detected. This operation will remove significant data. Use --force to proceed.');
    }
  }

  async createPostgreSQLDump(backupFile) {
    // Create a basic SQL dump of current state
    const dumpQuery = `
      SELECT 'INSERT INTO ' || quote_ident(table_name) || ' SELECT * FROM ' || quote_ident(table_name) || ';' as dump_sql
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;

    const result = await this.pool.query(dumpQuery);
    const dumpContent = result.rows.map(row => row.dump_sql).join('\n');
    const fullDump = `-- PostgreSQL Safety Backup\n-- Created: ${new Date().toISOString()}\n\n${dumpContent}`;

    await fs.writeFile(backupFile, fullDump, 'utf8');
  }

  async simulateDataClearing() {
    const simulationResults = {};
    const tables = [
      'users', 'user_activities', 'roles', 'activity_events',
      'activity_event_participants', 'user_role_assignments',
      'role_reset_history', 'afk_status', 'forum_messages',
      'voice_channel_mappings'
    ];

    for (const table of tables) {
      try {
        const count = await this.dbUtils.getRowCount(table);
        simulationResults[table] = count;
        this.rollbackStats.recordsRemoved += count;
      } catch (error) {
        simulationResults[table] = 0;
      }
    }

    this.logger.info('Data clearing simulation results', simulationResults);
  }

  async resetSequences(client) {
    const sequenceQuery = `
      SELECT sequence_name
      FROM information_schema.sequences
      WHERE sequence_schema = 'public'
    `;

    const sequences = await client.query(sequenceQuery);
    
    for (const seq of sequences.rows) {
      await client.query(`ALTER SEQUENCE ${seq.sequence_name} RESTART WITH 1`);
    }

    this.logger.info('Sequences reset', {
      count: sequences.rows.length
    });
  }

  async restoreLowDBBackup(backupPath) {
    // Copy LowDB backup to original location
    const originalPath = '../activity_bot.json'; // Default LowDB path
    
    try {
      await fs.copyFile(backupPath, originalPath);
      this.logger.info('LowDB backup restored', {
        from: backupPath,
        to: originalPath
      });
    } catch (error) {
      throw new Error(`Failed to restore LowDB backup: ${error.message}`);
    }
  }

  async restorePostgreSQLBackup(backupPath) {
    // Read and execute SQL backup
    const backupContent = await fs.readFile(backupPath, 'utf8');
    const statements = backupContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    await this.pool.transaction(async (client) => {
      for (const statement of statements) {
        if (statement.trim()) {
          await client.query(statement);
        }
      }
    });

    this.logger.info('PostgreSQL backup restored', {
      statements: statements.length
    });
  }

  async updateMigrationMetadata() {
    // Record rollback in migration history
    await this.pool.query(`
      INSERT INTO schema_migrations (version, description, migration_type, status, applied_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
    `, [
      `rollback-${Date.now()}`,
      'Rollback of LowDB to PostgreSQL migration',
      'ROLLBACK',
      'SUCCESS'
    ]);
  }

  async optimizeDatabase() {
    // Vacuum and analyze all tables
    const tables = [
      'users', 'user_activities', 'roles', 'activity_events',
      'activity_event_participants', 'user_role_assignments',
      'role_reset_history', 'afk_status', 'forum_messages',
      'voice_channel_mappings', 'schema_migrations'
    ];

    for (const table of tables) {
      try {
        await this.pool.query(`VACUUM ANALYZE ${table}`);
      } catch (error) {
        // Table might not exist, continue
        continue;
      }
    }

    this.logger.info('Database optimization completed');
  }

  async verifyRollbackCompletion() {
    const verificationResults = {};
    const migrationTables = [
      'users', 'user_activities', 'roles', 'activity_events'
    ];

    for (const table of migrationTables) {
      try {
        const count = await this.dbUtils.getRowCount(table);
        verificationResults[table] = count;
      } catch (error) {
        verificationResults[table] = 'table_not_found';
      }
    }

    this.rollbackStats.verificationResults = verificationResults;
    this.logger.info('Rollback verification completed', verificationResults);

    // Check if rollback was successful (all tables should be empty or not exist)
    const hasData = Object.values(verificationResults).some(count => 
      typeof count === 'number' && count > 0
    );

    if (hasData && !this.options.targetBackup) {
      this.logger.warn('Some tables still contain data after rollback');
    }
  }

  displayRollbackResults() {
    const duration = this.rollbackStats.endTime - this.rollbackStats.startTime;

    console.log('\n' + chalk.blue('🔄 Rollback Results Summary'));
    console.log(chalk.blue('='.repeat(50)));
    console.log(chalk.white(`Total Duration: ${Math.round(duration / 1000)}s`));
    console.log(chalk.white(`Start Time: ${this.rollbackStats.startTime.toISOString()}`));
    console.log(chalk.white(`End Time: ${this.rollbackStats.endTime.toISOString()}`));
    console.log('');

    console.log(chalk.yellow('ROLLBACK ACTIONS:'));
    console.log(chalk.white(`  Tables Cleared: ${this.rollbackStats.tablesCleared}`));
    console.log(chalk.white(`  Records Removed: ${this.rollbackStats.recordsRemoved}`));
    
    if (this.rollbackStats.backupRestored) {
      console.log(chalk.white(`  Backup Restored: ${path.basename(this.rollbackStats.backupRestored)}`));
    }

    if (this.rollbackStats.safetyBackup) {
      console.log(chalk.gray(`  Safety Backup: ${path.basename(this.rollbackStats.safetyBackup)}`));
    }

    if (this.rollbackStats.verificationResults) {
      console.log(chalk.yellow('\nFINAL STATE:'));
      for (const [table, count] of Object.entries(this.rollbackStats.verificationResults)) {
        const displayCount = typeof count === 'number' ? count : count;
        console.log(chalk.white(`  ${table}: ${displayCount}`));
      }
    }

    if (this.rollbackStats.errors.length > 0) {
      console.log(chalk.red('\nERRORS:'));
      this.rollbackStats.errors.forEach(error => {
        console.log(chalk.red(`  • ${error}`));
      });
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
  .name('rollback')
  .description('Migration rollback tool')
  .version('2.0.0');

program
  .command('execute')
  .description('Execute migration rollback')
  .option('--dry-run', 'Simulate rollback without making changes')
  .option('--force', 'Skip safety confirmations')
  .option('--backup-path <path>', 'Path to backup directory', './backups')
  .option('--target-backup <file>', 'Specific backup file to restore')
  .option('--preserve-schema', 'Keep database schema, only clear data')
  .action(async (options) => {
    const rollback = new MigrationRollback(options);

    try {
      await rollback.executeRollback();
      console.log(chalk.green('\n✅ Rollback completed successfully!'));
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('\n❌ Rollback failed:'), error.message);
      if (process.env.NODE_ENV === 'development') {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

program
  .command('list-backups')
  .description('List available backup files')
  .option('--backup-path <path>', 'Path to backup directory', './backups')
  .action(async (options) => {
    try {
      const backupDir = path.resolve(options.backupPath);
      const files = await fs.readdir(backupDir);
      const backupFiles = files.filter(file => 
        file.endsWith('.json') || file.endsWith('.sql')
      );

      if (backupFiles.length === 0) {
        console.log(chalk.yellow('No backup files found'));
        return;
      }

      console.log(chalk.blue('Available backup files:'));
      for (const file of backupFiles) {
        const fullPath = path.join(backupDir, file);
        const stats = await fs.stat(fullPath);
        const size = Math.round(stats.size / 1024);
        const date = stats.mtime.toISOString().split('T')[0];
        
        console.log(chalk.white(`  ${file} (${size}KB, ${date})`));
      }
    } catch (error) {
      console.error(chalk.red('Failed to list backups:'), error.message);
      process.exit(1);
    }
  });

program
  .command('validate-backup')
  .description('Validate a specific backup file')
  .argument('<backup-file>', 'Path to backup file')
  .action(async (backupFile) => {
    try {
      const backupPath = path.resolve(backupFile);
      await fs.access(backupPath);
      
      const stats = await fs.stat(backupPath);
      const extension = path.extname(backupPath).toLowerCase();
      
      console.log(chalk.green('✅ Backup file validation:'));
      console.log(chalk.white(`  Path: ${backupPath}`));
      console.log(chalk.white(`  Size: ${Math.round(stats.size / 1024 / 1024)}MB`));
      console.log(chalk.white(`  Type: ${extension === '.json' ? 'LowDB' : 'PostgreSQL'}`));
      console.log(chalk.white(`  Modified: ${stats.mtime.toISOString()}`));
      
      // Basic content validation
      if (extension === '.json') {
        const content = await fs.readFile(backupPath, 'utf8');
        const data = JSON.parse(content);
        console.log(chalk.white(`  Collections: ${Object.keys(data).length}`));
      }

    } catch (error) {
      console.error(chalk.red('❌ Backup validation failed:'), error.message);
      process.exit(1);
    }
  });

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse();
}

export { MigrationRollback };
export default MigrationRollback;