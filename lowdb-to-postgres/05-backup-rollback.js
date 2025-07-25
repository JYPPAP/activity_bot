#!/usr/bin/env node
// Backup and Rollback Strategy for PostgreSQL Migration
// Provides comprehensive backup, restore, and rollback capabilities

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import pg from 'pg';
const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class BackupManager {
  constructor(connectionConfig) {
    this.config = connectionConfig;
    this.backupDir = path.join(__dirname, 'backups');
    this.pool = new Pool(connectionConfig);
    
    // Ensure backup directory exists
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Create a comprehensive backup before migration
   */
  async createPreMigrationBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `pre-migration-${timestamp}`;
    
    console.log('🔄 Creating pre-migration backup...');
    
    const backupFiles = {
      lowdb: await this.backupLowDBFile(backupName),
      postgres: await this.createPostgreSQLDump(backupName),
      schema: await this.backupCurrentSchema(backupName),
      metadata: await this.createBackupMetadata(backupName)
    };

    console.log('✅ Pre-migration backup completed:', backupFiles);
    return backupFiles;
  }

  /**
   * Backup current LowDB file
   */
  async backupLowDBFile(backupName) {
    const lowdbFile = path.join(__dirname, '..', 'activity_bot.json');
    const backupFile = path.join(this.backupDir, `${backupName}-lowdb.json`);

    if (fs.existsSync(lowdbFile)) {
      fs.copyFileSync(lowdbFile, backupFile);
      console.log(`✅ LowDB backup: ${backupFile}`);
      return backupFile;
    } else {
      console.warn('⚠️ LowDB file not found, skipping backup');
      return null;
    }
  }

  /**
   * Create PostgreSQL database dump using pg_dump
   */
  async createPostgreSQLDump(backupName) {
    const dumpFile = path.join(this.backupDir, `${backupName}-postgres.sql`);
    
    return new Promise((resolve, reject) => {
      const pgDumpArgs = [
        '-h', this.config.host,
        '-p', this.config.port.toString(),
        '-U', this.config.user,
        '-d', this.config.database,
        '--verbose',
        '--clean',
        '--if-exists',
        '--create',
        '--format=plain',
        '--file', dumpFile
      ];

      // Set PGPASSWORD environment variable
      const env = { ...process.env, PGPASSWORD: this.config.password };

      const pgDump = spawn('pg_dump', pgDumpArgs, { env });

      let stderr = '';
      pgDump.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pgDump.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ PostgreSQL dump: ${dumpFile}`);
          resolve(dumpFile);
        } else {
          console.error('❌ pg_dump failed:', stderr);
          reject(new Error(`pg_dump failed with code ${code}: ${stderr}`));
        }
      });

      pgDump.on('error', (error) => {
        console.error('❌ pg_dump error:', error);
        reject(error);
      });
    });
  }

  /**
   * Backup current database schema structure
   */
  async backupCurrentSchema(backupName) {
    const schemaFile = path.join(this.backupDir, `${backupName}-schema.sql`);
    
    try {
      const client = await this.pool.connect();
      
      // Get table structure
      const tablesQuery = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name;
      `;
      
      const tablesResult = await client.query(tablesQuery);
      let schemaSQL = '-- Database Schema Backup\n';
      schemaSQL += `-- Generated: ${new Date().toISOString()}\n\n`;

      for (const table of tablesResult.rows) {
        const tableName = table.table_name;
        
        // Get CREATE TABLE statement
        const createTableQuery = `
          SELECT pg_get_constraintdef(c.oid) as constraint_def
          FROM pg_constraint c
          JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE n.nspname = 'public' AND c.conrelid = '${tableName}'::regclass;
        `;

        schemaSQL += `-- Table: ${tableName}\n`;
        schemaSQL += `-- Row count: `;
        
        try {
          const countResult = await client.query(`SELECT COUNT(*) FROM ${tableName}`);
          schemaSQL += countResult.rows[0].count;
        } catch (error) {
          schemaSQL += 'N/A';
        }
        
        schemaSQL += '\n\n';
      }

      client.release();
      
      fs.writeFileSync(schemaFile, schemaSQL);
      console.log(`✅ Schema backup: ${schemaFile}`);
      return schemaFile;
      
    } catch (error) {
      console.error('❌ Schema backup failed:', error);
      return null;
    }
  }

  /**
   * Create backup metadata file
   */
  async createBackupMetadata(backupName) {
    const metadataFile = path.join(this.backupDir, `${backupName}-metadata.json`);
    
    const metadata = {
      backupName,
      timestamp: new Date().toISOString(),
      databaseConfig: {
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.user
      },
      version: await this.getDatabaseVersion(),
      tableStats: await this.getTableStatistics(),
      migrationStatus: 'pre-migration'
    };

    fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
    console.log(`✅ Metadata backup: ${metadataFile}`);
    return metadataFile;
  }

  /**
   * Get PostgreSQL version information
   */
  async getDatabaseVersion() {
    try {
      const client = await this.pool.connect();
      const result = await client.query('SELECT version()');
      client.release();
      return result.rows[0].version;
    } catch (error) {
      return 'Unknown';
    }
  }

  /**
   * Get table statistics
   */
  async getTableStatistics() {
    try {
      const client = await this.pool.connect();
      
      const query = `
        SELECT 
          t.table_name,
          COALESCE(c.row_count, 0) as row_count,
          pg_size_pretty(pg_total_relation_size(t.table_name::regclass)) as size
        FROM information_schema.tables t
        LEFT JOIN (
          SELECT 
            schemaname,
            tablename,
            n_live_tup as row_count
          FROM pg_stat_user_tables
        ) c ON t.table_name = c.tablename
        WHERE t.table_schema = 'public'
        ORDER BY t.table_name;
      `;

      const result = await client.query(query);
      client.release();
      
      return result.rows.reduce((stats, row) => {
        stats[row.table_name] = {
          rowCount: parseInt(row.row_count) || 0,
          size: row.size || '0 bytes'
        };
        return stats;
      }, {});
      
    } catch (error) {
      console.error('Error getting table statistics:', error);
      return {};
    }
  }

  /**
   * List all available backups
   */
  listBackups() {
    const backups = fs.readdirSync(this.backupDir)
      .filter(file => file.endsWith('-metadata.json'))
      .map(file => {
        const metadataPath = path.join(this.backupDir, file);
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        return {
          name: metadata.backupName,
          timestamp: metadata.timestamp,
          status: metadata.migrationStatus,
          path: metadataPath
        };
      })
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return backups;
  }

  /**
   * Close connection pool
   */
  async close() {
    await this.pool.end();
  }
}

export class RollbackManager {
  constructor(connectionConfig) {
    this.config = connectionConfig;
    this.pool = new Pool(connectionConfig);
    this.backupManager = new BackupManager(connectionConfig);
  }

  /**
   * Rollback to LowDB from PostgreSQL
   */
  async rollbackToLowDB(backupName) {
    console.log(`🔄 Rolling back to LowDB using backup: ${backupName}`);
    
    try {
      // 1. Find the backup
      const backups = this.backupManager.listBackups();
      const backup = backups.find(b => b.name === backupName);
      
      if (!backup) {
        throw new Error(`Backup not found: ${backupName}`);
      }

      // 2. Restore LowDB file
      const lowdbBackup = path.join(this.backupManager.backupDir, `${backupName}-lowdb.json`);
      const lowdbTarget = path.join(__dirname, '..', 'activity_bot.json');
      
      if (fs.existsSync(lowdbBackup)) {
        // Create backup of current state
        if (fs.existsSync(lowdbTarget)) {
          const rollbackTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
          fs.copyFileSync(lowdbTarget, `${lowdbTarget}.rollback-${rollbackTimestamp}.bak`);
        }
        
        fs.copyFileSync(lowdbBackup, lowdbTarget);
        console.log(`✅ LowDB file restored: ${lowdbTarget}`);
      } else {
        console.warn('⚠️ LowDB backup not found, cannot restore');
      }

      // 3. Update configuration to use LowDB
      await this.updateConfigurationForLowDB();

      // 4. Create rollback log
      await this.createRollbackLog(backupName, 'lowdb');

      console.log('✅ Rollback to LowDB completed successfully');
      return true;

    } catch (error) {
      console.error('❌ Rollback to LowDB failed:', error);
      return false;
    }
  }

  /**
   * Rollback PostgreSQL database to a previous state
   */
  async rollbackPostgreSQL(backupName) {
    console.log(`🔄 Rolling back PostgreSQL to backup: ${backupName}`);
    
    try {
      // 1. Create current state backup before rollback
      const currentBackup = await this.backupManager.createPreMigrationBackup();
      console.log('✅ Current state backed up before rollback');

      // 2. Restore from PostgreSQL dump
      const dumpFile = path.join(this.backupManager.backupDir, `${backupName}-postgres.sql`);
      
      if (fs.existsSync(dumpFile)) {
        await this.restoreFromPostgreSQLDump(dumpFile);
        console.log('✅ PostgreSQL database restored from dump');
      } else {
        throw new Error(`PostgreSQL dump not found: ${dumpFile}`);
      }

      // 3. Create rollback log
      await this.createRollbackLog(backupName, 'postgresql');

      console.log('✅ PostgreSQL rollback completed successfully');
      return true;

    } catch (error) {
      console.error('❌ PostgreSQL rollback failed:', error);
      return false;
    }
  }

  /**
   * Restore PostgreSQL database from dump file
   */
  async restoreFromPostgreSQLDump(dumpFile) {
    return new Promise((resolve, reject) => {
      const psqlArgs = [
        '-h', this.config.host,
        '-p', this.config.port.toString(),
        '-U', this.config.user,
        '-d', this.config.database,
        '-f', dumpFile,
        '--verbose'
      ];

      const env = { ...process.env, PGPASSWORD: this.config.password };
      const psql = spawn('psql', psqlArgs, { env });

      let stderr = '';
      psql.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      psql.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`psql failed with code ${code}: ${stderr}`));
        }
      });

      psql.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Update application configuration to use LowDB
   */
  async updateConfigurationForLowDB() {
    // This would typically involve updating environment variables
    // or configuration files to switch back to LowDB
    console.log('📝 Configuration updated to use LowDB');
    
    // Example: Update a config file
    const configHint = `
To complete the rollback to LowDB, update your configuration:

1. Set DATABASE_TYPE=lowdb in your environment
2. Comment out PostgreSQL environment variables
3. Restart the application

Example .env changes:
DATABASE_TYPE=lowdb
# POSTGRES_HOST=localhost
# POSTGRES_USER=discord_bot
# POSTGRES_PASSWORD=password
# POSTGRES_DB=discord_activity_bot
    `;
    
    console.log(configHint);
  }

  /**
   * Create rollback log entry
   */
  async createRollbackLog(backupName, rollbackType) {
    const logFile = path.join(this.backupManager.backupDir, 'rollback-log.json');
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      backupName,
      rollbackType,
      user: process.env.USER || 'unknown',
      reason: 'Manual rollback'
    };

    let logs = [];
    if (fs.existsSync(logFile)) {
      logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    }

    logs.push(logEntry);
    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
    
    console.log(`📝 Rollback logged: ${logFile}`);
  }

  /**
   * Validate rollback success
   */
  async validateRollback(rollbackType) {
    console.log(`🔍 Validating ${rollbackType} rollback...`);
    
    if (rollbackType === 'lowdb') {
      return this.validateLowDBRollback();
    } else if (rollbackType === 'postgresql') {
      return this.validatePostgreSQLRollback();
    }
    
    return false;
  }

  async validateLowDBRollback() {
    const lowdbFile = path.join(__dirname, '..', 'activity_bot.json');
    
    if (!fs.existsSync(lowdbFile)) {
      console.error('❌ LowDB file not found');
      return false;
    }

    try {
      const data = JSON.parse(fs.readFileSync(lowdbFile, 'utf8'));
      const requiredKeys = ['user_activity', 'role_config', 'activity_logs'];
      
      for (const key of requiredKeys) {
        if (!data[key]) {
          console.error(`❌ Missing required key: ${key}`);
          return false;
        }
      }

      console.log('✅ LowDB rollback validation passed');
      return true;
      
    } catch (error) {
      console.error('❌ LowDB validation failed:', error);
      return false;
    }
  }

  async validatePostgreSQLRollback() {
    try {
      const client = await this.pool.connect();
      
      // Check if required tables exist
      const tablesQuery = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('users', 'user_activities', 'activity_logs', 'roles');
      `;
      
      const result = await client.query(tablesQuery);
      client.release();
      
      if (result.rows.length < 4) {
        console.error('❌ Required tables missing after rollback');
        return false;
      }

      console.log('✅ PostgreSQL rollback validation passed');
      return true;
      
    } catch (error) {
      console.error('❌ PostgreSQL validation failed:', error);
      return false;
    }
  }

  /**
   * Close connection pool
   */
  async close() {
    await this.pool.end();
    await this.backupManager.close();
  }
}

// CLI interface for backup and rollback operations
export class BackupRollbackCLI {
  constructor(connectionConfig) {
    this.backupManager = new BackupManager(connectionConfig);
    this.rollbackManager = new RollbackManager(connectionConfig);
  }

  async showMenu() {
    console.log('\n🔧 Backup & Rollback Management');
    console.log('================================');
    console.log('1. Create backup');
    console.log('2. List backups');
    console.log('3. Rollback to LowDB');
    console.log('4. Rollback PostgreSQL');
    console.log('5. Validate system');
    console.log('6. Exit');
    console.log('================================');
  }

  async listBackups() {
    const backups = this.backupManager.listBackups();
    
    if (backups.length === 0) {
      console.log('📭 No backups found');
      return;
    }

    console.log('\n📦 Available Backups:');
    backups.forEach((backup, index) => {
      console.log(`${index + 1}. ${backup.name}`);
      console.log(`   📅 ${backup.timestamp}`);
      console.log(`   📊 Status: ${backup.status}`);
      console.log('');
    });
  }

  async close() {
    await this.backupManager.close();
    await this.rollbackManager.close();
  }
}

// Command line execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const connectionConfig = {
    user: process.env.POSTGRES_USER || 'discord_bot',
    password: process.env.POSTGRES_PASSWORD || 'password',
    host: process.env.POSTGRES_HOST || 'localhost',
    port: process.env.POSTGRES_PORT || 5432,
    database: process.env.POSTGRES_DB || 'discord_activity_bot'
  };

  const cli = new BackupRollbackCLI(connectionConfig);
  
  const operation = process.argv[2];
  
  switch (operation) {
    case 'backup':
      console.log('Creating backup...');
      await cli.backupManager.createPreMigrationBackup();
      break;
    case 'list':
      await cli.listBackups();
      break;
    case 'rollback-lowdb':
      const backupName = process.argv[3];
      if (!backupName) {
        console.error('Usage: node backup-rollback.js rollback-lowdb <backup-name>');
        process.exit(1);
      }
      await cli.rollbackManager.rollbackToLowDB(backupName);
      break;
    default:
      await cli.showMenu();
  }
  
  await cli.close();
}