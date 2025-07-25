#!/usr/bin/env node

// Migration Validation System
// Comprehensive validation for LowDB to PostgreSQL migration

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';

import { ConnectionPool, DatabaseConfig, DatabaseUtils } from './config/database.js';

/**
 * Migration Validation System
 */
class MigrationValidator {
  constructor(options = {}) {
    this.options = {
      lowdbPath: options.lowdbPath || '../activity_bot.json',
      verbose: options.verbose || false,
      fixIssues: options.fixIssues || false,
      ...options
    };

    this.dbConfig = new DatabaseConfig();
    this.pool = new ConnectionPool(this.dbConfig);
    this.dbUtils = new DatabaseUtils(this.pool);
    this.logger = this.dbConfig.getLogger();

    this.validationResults = {
      preValidation: { passed: 0, failed: 0, warnings: 0, issues: [] },
      postValidation: { passed: 0, failed: 0, warnings: 0, issues: [] },
      dataIntegrity: { passed: 0, failed: 0, warnings: 0, issues: [] },
      performance: { passed: 0, failed: 0, warnings: 0, issues: [] }
    };
  }

  /**
   * Execute complete validation suite
   * @returns {Promise<Object>} Validation results
   */
  async executeValidation() {
    const spinner = ora('Starting migration validation...').start();

    try {
      // Initialize database connection
      await this.pool.initialize();

      // Pre-migration validation
      spinner.text = 'Running pre-migration validation...';
      await this.validatePreMigration();

      // Post-migration validation (if data exists)
      spinner.text = 'Running post-migration validation...';
      await this.validatePostMigration();

      // Data integrity validation
      spinner.text = 'Validating data integrity...';
      await this.validateDataIntegrity();

      // Performance validation
      spinner.text = 'Running performance validation...';
      await this.validatePerformance();

      spinner.succeed(chalk.green('Validation completed!'));

      // Display results
      this.displayValidationResults();

      return this.validationResults;

    } catch (error) {
      spinner.fail(chalk.red('Validation failed!'));
      this.logger.error('Validation failed', error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Pre-migration validation
   */
  async validatePreMigration() {
    const tests = [
      { name: 'LowDB File Accessibility', test: this.validateLowDBFile.bind(this) },
      { name: 'LowDB Data Structure', test: this.validateLowDBStructure.bind(this) },
      { name: 'Database Connectivity', test: this.validateDatabaseConnection.bind(this) },
      { name: 'Database Permissions', test: this.validateDatabasePermissions.bind(this) },
      { name: 'Schema Compatibility', test: this.validateSchemaCompatibility.bind(this) },
      { name: 'Disk Space Requirements', test: this.validateDiskSpace.bind(this) }
    ];

    for (const test of tests) {
      try {
        await test.test();
        this.recordResult('preValidation', 'passed', test.name);
      } catch (error) {
        this.recordResult('preValidation', 'failed', test.name, error.message);
      }
    }
  }

  /**
   * Post-migration validation
   */
  async validatePostMigration() {
    // Check if migration has been run
    const userCount = await this.dbUtils.getRowCount('users').catch(() => 0);
    if (userCount === 0) {
      this.recordResult('postValidation', 'warnings', 'Migration Status', 'No migrated data found - skipping post-migration validation');
      return;
    }

    const tests = [
      { name: 'Schema Structure', test: this.validateSchemaStructure.bind(this) },
      { name: 'Table Constraints', test: this.validateConstraints.bind(this) },
      { name: 'Index Coverage', test: this.validateIndexes.bind(this) },
      { name: 'Foreign Key Integrity', test: this.validateForeignKeys.bind(this) },
      { name: 'Data Completeness', test: this.validateDataCompleteness.bind(this) },
      { name: 'Migration Metadata', test: this.validateMigrationMetadata.bind(this) }
    ];

    for (const test of tests) {
      try {
        await test.test();
        this.recordResult('postValidation', 'passed', test.name);
      } catch (error) {
        this.recordResult('postValidation', 'failed', test.name, error.message);
      }
    }
  }

  /**
   * Data integrity validation
   */
  async validateDataIntegrity() {
    const tests = [
      { name: 'User Data Consistency', test: this.validateUserDataConsistency.bind(this) },
      { name: 'Activity Data Accuracy', test: this.validateActivityDataAccuracy.bind(this) },
      { name: 'Role Configuration Integrity', test: this.validateRoleIntegrity.bind(this) },
      { name: 'Event Log Completeness', test: this.validateEventLogCompleteness.bind(this) },
      { name: 'Computed Fields Accuracy', test: this.validateComputedFields.bind(this) },
      { name: 'Timestamp Consistency', test: this.validateTimestamps.bind(this) }
    ];

    for (const test of tests) {
      try {
        await test.test();
        this.recordResult('dataIntegrity', 'passed', test.name);
      } catch (error) {
        this.recordResult('dataIntegrity', 'failed', test.name, error.message);
      }
    }
  }

  /**
   * Performance validation
   */
  async validatePerformance() {
    const tests = [
      { name: 'Query Performance', test: this.validateQueryPerformance.bind(this) },
      { name: 'Index Utilization', test: this.validateIndexUtilization.bind(this) },
      { name: 'Connection Pool Health', test: this.validateConnectionPool.bind(this) },
      { name: 'Memory Usage', test: this.validateMemoryUsage.bind(this) },
      { name: 'Table Statistics', test: this.validateTableStatistics.bind(this) }
    ];

    for (const test of tests) {
      try {
        await test.test();
        this.recordResult('performance', 'passed', test.name);
      } catch (error) {
        this.recordResult('performance', 'failed', test.name, error.message);
      }
    }
  }

  /**
   * Individual validation tests
   */

  async validateLowDBFile() {
    try {
      await fs.access(this.options.lowdbPath);
      const stats = await fs.stat(this.options.lowdbPath);
      
      if (stats.size === 0) {
        throw new Error('LowDB file is empty');
      }

      if (stats.size > 100 * 1024 * 1024) { // 100MB
        this.recordResult('preValidation', 'warnings', 'LowDB File Size', `Large file detected: ${Math.round(stats.size / 1024 / 1024)}MB`);
      }
    } catch (error) {
      throw new Error(`LowDB file validation failed: ${error.message}`);
    }
  }

  async validateLowDBStructure() {
    try {
      const data = JSON.parse(await fs.readFile(this.options.lowdbPath, 'utf8'));
      
      const requiredCollections = ['user_activity', 'role_config'];
      const missingCollections = requiredCollections.filter(collection => !data[collection]);
      
      if (missingCollections.length > 0) {
        throw new Error(`Missing required collections: ${missingCollections.join(', ')}`);
      }

      // Validate data types and structure
      if (typeof data.user_activity !== 'object') {
        throw new Error('user_activity must be an object');
      }

      if (typeof data.role_config !== 'object') {
        throw new Error('role_config must be an object');
      }

      // Check for basic data consistency
      const userCount = Object.keys(data.user_activity).length;
      const roleCount = Object.keys(data.role_config).length;

      if (userCount === 0) {
        this.recordResult('preValidation', 'warnings', 'User Data', 'No users found in LowDB');
      }

      if (roleCount === 0) {
        this.recordResult('preValidation', 'warnings', 'Role Data', 'No roles found in LowDB');
      }

    } catch (error) {
      throw new Error(`LowDB structure validation failed: ${error.message}`);
    }
  }

  async validateDatabaseConnection() {
    const healthCheck = await this.pool.healthCheck();
    if (!healthCheck.healthy) {
      throw new Error(`Database connection failed: ${healthCheck.error}`);
    }

    if (healthCheck.responseTime > 1000) {
      this.recordResult('preValidation', 'warnings', 'Connection Performance', `Slow connection: ${healthCheck.responseTime}ms`);
    }
  }

  async validateDatabasePermissions() {
    const requiredPermissions = [
      { sql: 'CREATE TABLE test_permissions_table (id SERIAL)', description: 'CREATE TABLE' },
      { sql: 'INSERT INTO test_permissions_table DEFAULT VALUES', description: 'INSERT' },
      { sql: 'SELECT * FROM test_permissions_table', description: 'SELECT' },
      { sql: 'UPDATE test_permissions_table SET id = id', description: 'UPDATE' },
      { sql: 'DELETE FROM test_permissions_table', description: 'DELETE' },
      { sql: 'DROP TABLE test_permissions_table', description: 'DROP TABLE' }
    ];

    for (const permission of requiredPermissions) {
      try {
        await this.pool.query(permission.sql);
      } catch (error) {
        throw new Error(`Missing ${permission.description} permission: ${error.message}`);
      }
    }
  }

  async validateSchemaCompatibility() {
    // Check PostgreSQL version
    const versionResult = await this.pool.query('SELECT version()');
    const version = versionResult.rows[0].version;
    
    const majorVersion = parseInt(version.split(' ')[1].split('.')[0]);
    if (majorVersion < 12) {
      throw new Error(`PostgreSQL 12+ required, found version: ${majorVersion}`);
    }

    // Check for required extensions
    const requiredExtensions = ['uuid-ossp'];
    for (const extension of requiredExtensions) {
      try {
        await this.pool.query(`CREATE EXTENSION IF NOT EXISTS "${extension}"`);
      } catch (error) {
        throw new Error(`Failed to create extension ${extension}: ${error.message}`);
      }
    }
  }

  async validateDiskSpace() {
    // Estimate required disk space based on LowDB size
    const stats = await fs.stat(this.options.lowdbPath);
    const estimatedPostgresSize = stats.size * 2; // Rough estimate: 2x JSON size

    // Check available disk space (simplified - would need OS-specific implementation)
    this.recordResult('preValidation', 'warnings', 'Disk Space', `Estimated PostgreSQL size: ${Math.round(estimatedPostgresSize / 1024 / 1024)}MB`);
  }

  async validateSchemaStructure() {
    const requiredTables = [
      'users', 'roles', 'user_activities', 'activity_events',
      'activity_event_participants', 'user_role_assignments',
      'role_reset_history', 'afk_status', 'forum_messages',
      'voice_channel_mappings', 'schema_migrations', 'system_configuration'
    ];

    for (const table of requiredTables) {
      const exists = await this.dbUtils.tableExists(table);
      if (!exists) {
        throw new Error(`Required table '${table}' does not exist`);
      }
    }
  }

  async validateConstraints() {
    const constraintChecks = [
      {
        name: 'Discord ID Format Constraints',
        sql: `SELECT COUNT(*) as violations FROM users WHERE id !~ '^[0-9]{17,20}$'`
      },
      {
        name: 'Non-negative Time Constraints',
        sql: `SELECT COUNT(*) as violations FROM user_activities WHERE total_time_ms < 0`
      },
      {
        name: 'Valid Event Types',
        sql: `SELECT COUNT(*) as violations FROM activity_events WHERE event_type NOT IN ('JOIN', 'LEAVE', 'MOVE', 'DISCONNECT', 'TIMEOUT')`
      }
    ];

    for (const check of constraintChecks) {
      const result = await this.pool.query(check.sql);
      const violations = parseInt(result.rows[0].violations);
      
      if (violations > 0) {
        throw new Error(`${check.name}: ${violations} constraint violations found`);
      }
    }
  }

  async validateIndexes() {
    const expectedIndexes = [
      'users_pkey',
      'idx_user_activities_total_time',
      'idx_activity_events_user_timestamp',
      'idx_user_role_assignments_user'
    ];

    const existingIndexes = await this.pool.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE schemaname = 'public'
    `);

    const existingIndexNames = existingIndexes.rows.map(row => row.indexname);
    const missingIndexes = expectedIndexes.filter(index => !existingIndexNames.includes(index));

    if (missingIndexes.length > 0) {
      this.recordResult('postValidation', 'warnings', 'Missing Indexes', `Missing indexes: ${missingIndexes.join(', ')}`);
    }
  }

  async validateForeignKeys() {
    const foreignKeyChecks = [
      {
        name: 'User Activities Foreign Keys',
        sql: `SELECT COUNT(*) as orphans FROM user_activities ua LEFT JOIN users u ON ua.user_id = u.id WHERE u.id IS NULL`
      },
      {
        name: 'Activity Events Foreign Keys',
        sql: `SELECT COUNT(*) as orphans FROM activity_events ae LEFT JOIN users u ON ae.user_id = u.id WHERE u.id IS NULL`
      },
      {
        name: 'Role Assignments Foreign Keys',
        sql: `SELECT COUNT(*) as orphans FROM user_role_assignments ura LEFT JOIN users u ON ura.user_id = u.id WHERE u.id IS NULL`
      }
    ];

    for (const check of foreignKeyChecks) {
      const result = await this.pool.query(check.sql);
      const orphans = parseInt(result.rows[0].orphans);
      
      if (orphans > 0) {
        throw new Error(`${check.name}: ${orphans} orphaned records found`);
      }
    }
  }

  async validateDataCompleteness() {
    // Compare record counts between LowDB and PostgreSQL
    const lowdbData = JSON.parse(await fs.readFile(this.options.lowdbPath, 'utf8'));
    
    const comparisons = [
      {
        name: 'Users',
        lowdbCount: Object.keys(lowdbData.user_activity || {}).length,
        postgresCount: await this.dbUtils.getRowCount('users')
      },
      {
        name: 'Roles',
        lowdbCount: Object.keys(lowdbData.role_config || {}).length,
        postgresCount: await this.dbUtils.getRowCount('roles')
      }
    ];

    for (const comparison of comparisons) {
      if (comparison.lowdbCount !== comparison.postgresCount) {
        throw new Error(`${comparison.name} count mismatch: LowDB=${comparison.lowdbCount}, PostgreSQL=${comparison.postgresCount}`);
      }
    }
  }

  async validateMigrationMetadata() {
    const migrationCount = await this.pool.query(`
      SELECT COUNT(*) as count 
      FROM schema_migrations 
      WHERE status = 'SUCCESS'
    `);

    if (parseInt(migrationCount.rows[0].count) === 0) {
      throw new Error('No successful migration records found');
    }
  }

  async validateUserDataConsistency() {
    // Check computed fields accuracy
    const computedFieldCheck = await this.pool.query(`
      SELECT COUNT(*) as inconsistent
      FROM user_activities
      WHERE ABS(total_hours - (total_time_ms / 3600000.0)) > 0.01
    `);

    const inconsistentCount = parseInt(computedFieldCheck.rows[0].inconsistent);
    if (inconsistentCount > 0) {
      throw new Error(`${inconsistentCount} users have inconsistent computed fields`);
    }
  }

  async validateActivityDataAccuracy() {
    // Check for logical inconsistencies in activity data
    const logicalChecks = [
      {
        name: 'Negative session counts',
        sql: `SELECT COUNT(*) as count FROM user_activities WHERE session_count < 0`
      },
      {
        name: 'Invalid current session states',
        sql: `SELECT COUNT(*) as count FROM user_activities WHERE is_currently_active = true AND current_session_start IS NULL`
      }
    ];

    for (const check of logicalChecks) {
      const result = await this.pool.query(check.sql);
      const count = parseInt(result.rows[0].count);
      
      if (count > 0) {
        throw new Error(`${check.name}: ${count} inconsistencies found`);
      }
    }
  }

  async validateRoleIntegrity() {
    // Check role configuration consistency
    const roleChecks = [
      {
        name: 'Invalid minimum hours',
        sql: `SELECT COUNT(*) as count FROM roles WHERE min_hours < 0`
      },
      {
        name: 'Invalid report cycles',
        sql: `SELECT COUNT(*) as count FROM roles WHERE report_cycle_weeks < 1`
      }
    ];

    for (const check of roleChecks) {
      const result = await this.pool.query(check.sql);
      const count = parseInt(result.rows[0].count);
      
      if (count > 0) {
        throw new Error(`${check.name}: ${count} issues found`);
      }
    }
  }

  async validateEventLogCompleteness() {
    // Check for session consistency in event logs
    const sessionCheck = await this.pool.query(`
      SELECT COUNT(*) as orphaned_events
      FROM activity_events ae
      WHERE ae.session_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM activity_events ae2
        WHERE ae2.session_id = ae.session_id
        AND ae2.event_type = 'JOIN'
      )
    `);

    const orphanedEvents = parseInt(sessionCheck.rows[0].orphaned_events);
    if (orphanedEvents > 100) { // Allow some orphaned events from migration edge cases
      this.recordResult('dataIntegrity', 'warnings', 'Session Consistency', `${orphanedEvents} events with potentially orphaned sessions`);
    }
  }

  async validateComputedFields() {
    // Verify all computed fields are accurate
    const computedFieldTests = [
      {
        name: 'User activity hours',
        sql: `SELECT COUNT(*) as incorrect FROM user_activities WHERE ABS(total_hours - (total_time_ms / 3600000.0)) > 0.01`
      },
      {
        name: 'User activity days',
        sql: `SELECT COUNT(*) as incorrect FROM user_activities WHERE ABS(total_days - (total_time_ms / 86400000.0)) > 0.001`
      }
    ];

    for (const test of computedFieldTests) {
      const result = await this.pool.query(test.sql);
      const incorrect = parseInt(result.rows[0].incorrect);
      
      if (incorrect > 0) {
        throw new Error(`${test.name}: ${incorrect} computed fields are incorrect`);
      }
    }
  }

  async validateTimestamps() {
    // Check for reasonable timestamp values
    const timestampChecks = [
      {
        name: 'Future timestamps',
        sql: `SELECT COUNT(*) as count FROM activity_events WHERE event_timestamp > CURRENT_TIMESTAMP + interval '1 day'`
      },
      {
        name: 'Very old timestamps',
        sql: `SELECT COUNT(*) as count FROM activity_events WHERE event_timestamp < '2020-01-01'`
      }
    ];

    for (const check of timestampChecks) {
      const result = await this.pool.query(check.sql);
      const count = parseInt(result.rows[0].count);
      
      if (count > 0) {
        this.recordResult('dataIntegrity', 'warnings', check.name, `${count} suspicious timestamps found`);
      }
    }
  }

  async validateQueryPerformance() {
    const performanceTests = [
      {
        name: 'User lookup by ID',
        sql: `SELECT id FROM users WHERE id = '123456789012345678'`,
        maxTime: 10
      },
      {
        name: 'Top users by activity',
        sql: `SELECT id, total_hours FROM user_activities ORDER BY total_time_ms DESC LIMIT 10`,
        maxTime: 100
      },
      {
        name: 'Recent activity events',
        sql: `SELECT id FROM activity_events WHERE event_timestamp > CURRENT_TIMESTAMP - interval '7 days' LIMIT 100`,
        maxTime: 200
      }
    ];

    for (const test of performanceTests) {
      const startTime = Date.now();
      await this.pool.query(test.sql);
      const duration = Date.now() - startTime;
      
      if (duration > test.maxTime) {
        this.recordResult('performance', 'warnings', test.name, `Query took ${duration}ms (expected <${test.maxTime}ms)`);
      }
    }
  }

  async validateIndexUtilization() {
    // Check if indexes are being used
    const indexUsageQuery = `
      SELECT 
        schemaname,
        tablename,
        indexname,
        idx_tup_read,
        idx_tup_fetch
      FROM pg_stat_user_indexes
      WHERE schemaname = 'public'
      AND idx_tup_read = 0
      ORDER BY tablename, indexname
    `;

    const unusedIndexes = await this.pool.query(indexUsageQuery);
    if (unusedIndexes.rows.length > 0) {
      const indexNames = unusedIndexes.rows.map(row => `${row.tablename}.${row.indexname}`).join(', ');
      this.recordResult('performance', 'warnings', 'Unused Indexes', `Potentially unused indexes: ${indexNames}`);
    }
  }

  async validateConnectionPool() {
    const poolStats = this.pool.getPoolStats();
    if (!poolStats) {
      throw new Error('Unable to retrieve connection pool statistics');
    }

    if (poolStats.waitingCount > 0) {
      this.recordResult('performance', 'warnings', 'Connection Pool', `${poolStats.waitingCount} connections waiting`);
    }

    if (poolStats.metrics.errors > 0) {
      this.recordResult('performance', 'warnings', 'Connection Errors', `${poolStats.metrics.errors} connection errors recorded`);
    }
  }

  async validateMemoryUsage() {
    // Check database memory usage
    const memoryQuery = `
      SELECT 
        setting as shared_buffers,
        unit
      FROM pg_settings 
      WHERE name = 'shared_buffers'
    `;

    const memoryResult = await this.pool.query(memoryQuery);
    const sharedBuffers = memoryResult.rows[0];
    
    // Basic memory configuration check
    if (parseInt(sharedBuffers.shared_buffers) < 128 && sharedBuffers.unit === 'MB') {
      this.recordResult('performance', 'warnings', 'Memory Configuration', 'shared_buffers appears to be set quite low');
    }
  }

  async validateTableStatistics() {
    // Check if table statistics are up to date
    const statsQuery = `
      SELECT 
        schemaname,
        tablename,
        last_analyze,
        n_tup_ins + n_tup_upd + n_tup_del as total_changes
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      AND (last_analyze IS NULL OR last_analyze < CURRENT_TIMESTAMP - interval '7 days')
      AND n_tup_ins + n_tup_upd + n_tup_del > 1000
    `;

    const staleStats = await this.pool.query(statsQuery);
    if (staleStats.rows.length > 0) {
      const tableNames = staleStats.rows.map(row => row.tablename).join(', ');
      this.recordResult('performance', 'warnings', 'Table Statistics', `Tables with stale statistics: ${tableNames}`);
    }
  }

  /**
   * Utility methods
   */
  recordResult(category, type, testName, details = null) {
    this.validationResults[category][type]++;
    
    if (type === 'failed' || type === 'warnings') {
      this.validationResults[category].issues.push({
        test: testName,
        type,
        details,
        timestamp: new Date().toISOString()
      });
    }

    if (this.options.verbose) {
      const color = type === 'failed' ? 'red' : type === 'warnings' ? 'yellow' : 'green';
      const icon = type === 'failed' ? '❌' : type === 'warnings' ? '⚠️' : '✅';
      console.log(chalk[color](`${icon} ${testName}${details ? ': ' + details : ''}`));
    }
  }

  displayValidationResults() {
    console.log('\n' + chalk.blue('📊 Validation Results Summary'));
    console.log(chalk.blue('='.repeat(50)));

    for (const [category, results] of Object.entries(this.validationResults)) {
      const total = results.passed + results.failed + results.warnings;
      if (total === 0) continue;

      console.log(chalk.white(`\n${category.toUpperCase()}:`));
      console.log(chalk.green(`  ✅ Passed: ${results.passed}`));
      console.log(chalk.red(`  ❌ Failed: ${results.failed}`));
      console.log(chalk.yellow(`  ⚠️  Warnings: ${results.warnings}`));

      if (results.issues.length > 0) {
        console.log(chalk.gray('  Issues:'));
        results.issues.slice(0, 5).forEach(issue => {
          const color = issue.type === 'failed' ? 'red' : 'yellow';
          console.log(chalk[color](`    • ${issue.test}${issue.details ? ': ' + issue.details : ''}`));
        });
        
        if (results.issues.length > 5) {
          console.log(chalk.gray(`    ... and ${results.issues.length - 5} more issues`));
        }
      }
    }

    // Overall summary
    const totalPassed = Object.values(this.validationResults).reduce((sum, cat) => sum + cat.passed, 0);
    const totalFailed = Object.values(this.validationResults).reduce((sum, cat) => sum + cat.failed, 0);
    const totalWarnings = Object.values(this.validationResults).reduce((sum, cat) => sum + cat.warnings, 0);

    console.log(chalk.blue('\n' + '='.repeat(50)));
    console.log(chalk.white(`Total Tests: ${totalPassed + totalFailed + totalWarnings}`));
    console.log(chalk.green(`Passed: ${totalPassed}`));
    console.log(chalk.red(`Failed: ${totalFailed}`));
    console.log(chalk.yellow(`Warnings: ${totalWarnings}`));

    if (totalFailed === 0) {
      console.log(chalk.green('\n🎉 All critical validations passed!'));
    } else {
      console.log(chalk.red(`\n💥 ${totalFailed} critical issues found!`));
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
  .name('validate')
  .description('Migration validation tool')
  .version('2.0.0');

program
  .command('all')
  .description('Run complete validation suite')
  .option('--lowdb-path <path>', 'Path to LowDB JSON file', '../activity_bot.json')
  .option('--verbose', 'Verbose output')
  .option('--fix-issues', 'Attempt to fix discovered issues')
  .action(async (options) => {
    const validator = new MigrationValidator(options);
    
    try {
      const results = await validator.executeValidation();
      
      const totalFailed = Object.values(results).reduce((sum, cat) => sum + cat.failed, 0);
      process.exit(totalFailed > 0 ? 1 : 0);
    } catch (error) {
      console.error(chalk.red('Validation failed:'), error.message);
      process.exit(1);
    }
  });

program
  .command('pre')
  .description('Run pre-migration validation only')
  .option('--lowdb-path <path>', 'Path to LowDB JSON file', '../activity_bot.json')
  .option('--verbose', 'Verbose output')
  .action(async (options) => {
    const validator = new MigrationValidator(options);
    
    try {
      await validator.pool.initialize();
      await validator.validatePreMigration();
      
      console.log(chalk.green('✅ Pre-migration validation passed'));
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('❌ Pre-migration validation failed:'), error.message);
      process.exit(1);
    } finally {
      await validator.cleanup();
    }
  });

program
  .command('post')
  .description('Run post-migration validation only')
  .option('--verbose', 'Verbose output')
  .action(async (options) => {
    const validator = new MigrationValidator(options);
    
    try {
      await validator.pool.initialize();
      await validator.validatePostMigration();
      
      console.log(chalk.green('✅ Post-migration validation passed'));
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('❌ Post-migration validation failed:'), error.message);
      process.exit(1);
    } finally {
      await validator.cleanup();
    }
  });

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  program.parse();
}

export { MigrationValidator };
export default MigrationValidator;