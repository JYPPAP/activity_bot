// Database Configuration and Connection Management
// Provides connection pooling, configuration, and environment management

import { Pool } from 'pg';
import winston from 'winston';

/**
 * Database configuration with environment-specific settings
 */
export class DatabaseConfig {
  constructor() {
    this.environment = process.env.NODE_ENV || 'development';
    this.config = this.loadConfiguration();
    this.logger = this.createLogger();
  }

  /**
   * Load database configuration based on environment
   * @returns {Object} Database configuration object
   */
  loadConfiguration() {
    const baseConfig = {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT) || 5432,
      database: process.env.POSTGRES_DB || 'discord_activity_bot',
      user: process.env.POSTGRES_USER || 'discord_bot',
      password: process.env.POSTGRES_PASSWORD,
      
      // SSL Configuration
      ssl: process.env.POSTGRES_SSL === 'true' ? {
        rejectUnauthorized: false,
        ca: process.env.POSTGRES_SSL_CA,
        key: process.env.POSTGRES_SSL_KEY,
        cert: process.env.POSTGRES_SSL_CERT
      } : false,

      // Connection Pool Settings
      max: parseInt(process.env.POSTGRES_MAX_CONNECTIONS) || 20,
      min: parseInt(process.env.POSTGRES_MIN_CONNECTIONS) || 2,
      idleTimeoutMillis: parseInt(process.env.POSTGRES_IDLE_TIMEOUT) || 30000,
      connectionTimeoutMillis: parseInt(process.env.POSTGRES_CONNECTION_TIMEOUT) || 5000,
      
      // Application settings
      application_name: `discord-bot-migration-${this.environment}`,
      statement_timeout: parseInt(process.env.POSTGRES_STATEMENT_TIMEOUT) || 30000,
      query_timeout: parseInt(process.env.POSTGRES_QUERY_TIMEOUT) || 15000
    };

    // Environment-specific overrides
    switch (this.environment) {
      case 'production':
        return {
          ...baseConfig,
          max: 30,
          min: 5,
          connectionTimeoutMillis: 10000,
          statement_timeout: 60000
        };
      case 'test':
        return {
          ...baseConfig,
          database: `${baseConfig.database}_test`,
          max: 5,
          min: 1
        };
      default:
        return baseConfig;
    }
  }

  /**
   * Create logger instance for database operations
   * @returns {winston.Logger} Configured logger
   */
  createLogger() {
    return winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'database-migration' },
      transports: [
        new winston.transports.File({ 
          filename: 'logs/database-error.log', 
          level: 'error' 
        }),
        new winston.transports.File({ 
          filename: 'logs/database-combined.log' 
        }),
        ...(this.environment !== 'production' ? [
          new winston.transports.Console({
            format: winston.format.combine(
              winston.format.colorize(),
              winston.format.simple()
            )
          })
        ] : [])
      ]
    });
  }

  /**
   * Get configuration object
   * @returns {Object} Database configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Get logger instance
   * @returns {winston.Logger} Logger instance
   */
  getLogger() {
    return this.logger;
  }

  /**
   * Validate configuration
   * @throws {Error} If configuration is invalid
   */
  validate() {
    const required = ['host', 'port', 'database', 'user'];
    const missing = required.filter(key => !this.config[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required database configuration: ${missing.join(', ')}`);
    }

    if (!this.config.password && this.environment === 'production') {
      throw new Error('Database password is required in production environment');
    }

    if (this.config.port < 1 || this.config.port > 65535) {
      throw new Error(`Invalid database port: ${this.config.port}`);
    }
  }
}

/**
 * PostgreSQL connection pool manager
 */
export class ConnectionPool {
  constructor(config) {
    this.config = config instanceof DatabaseConfig ? config : new DatabaseConfig();
    this.pool = null;
    this.logger = this.config.getLogger();
    this.isInitialized = false;
    this.metrics = {
      totalConnections: 0,
      activeQueries: 0,
      errors: 0,
      queryTimes: []
    };
  }

  /**
   * Initialize the connection pool
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      this.config.validate();
      const poolConfig = this.config.getConfig();
      
      this.pool = new Pool(poolConfig);
      this.setupEventHandlers();
      
      // Test connection
      await this.testConnection();
      
      this.isInitialized = true;
      this.logger.info('Database connection pool initialized successfully', {
        host: poolConfig.host,
        database: poolConfig.database,
        maxConnections: poolConfig.max
      });
    } catch (error) {
      this.logger.error('Failed to initialize database connection pool', error);
      throw error;
    }
  }

  /**
   * Setup event handlers for connection pool monitoring
   */
  setupEventHandlers() {
    this.pool.on('connect', (client) => {
      this.metrics.totalConnections++;
      this.logger.debug('New client connected to database', {
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount,
        waitingCount: this.pool.waitingCount
      });
    });

    this.pool.on('remove', (client) => {
      this.logger.debug('Client removed from pool', {
        totalCount: this.pool.totalCount
      });
    });

    this.pool.on('error', (err, client) => {
      this.metrics.errors++;
      this.logger.error('Unexpected error on idle client', err);
    });

    // Setup periodic pool monitoring
    if (process.env.POSTGRES_POOL_MONITORING === 'true') {
      setInterval(() => {
        this.logPoolStats();
      }, parseInt(process.env.POSTGRES_POOL_MONITORING_INTERVAL) || 60000);
    }
  }

  /**
   * Test database connection
   * @returns {Promise<void>}
   */
  async testConnection() {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT NOW() as current_time, version() as pg_version');
      this.logger.info('Database connection test successful', {
        currentTime: result.rows[0].current_time,
        version: result.rows[0].pg_version.split(' ')[0]
      });
    } finally {
      client.release();
    }
  }

  /**
   * Execute a query with performance monitoring
   * @param {string} text - SQL query text
   * @param {Array} params - Query parameters
   * @returns {Promise<Object>} Query result
   */
  async query(text, params = []) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const start = Date.now();
    this.metrics.activeQueries++;
    
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;
      
      this.metrics.queryTimes.push(duration);
      
      // Log slow queries
      if (duration > parseInt(process.env.POSTGRES_SLOW_QUERY_THRESHOLD) || 1000) {
        this.logger.warn('Slow query detected', {
          query: text.substring(0, 100),
          duration,
          rowCount: result.rowCount
        });
      }
      
      this.logger.debug('Query executed successfully', {
        duration,
        rowCount: result.rowCount,
        command: result.command
      });
      
      return result;
    } catch (error) {
      this.metrics.errors++;
      this.logger.error('Query execution failed', {
        query: text.substring(0, 100),
        error: error.message,
        duration: Date.now() - start
      });
      throw error;
    } finally {
      this.metrics.activeQueries--;
    }
  }

  /**
   * Get a client from the pool for transactions
   * @returns {Promise<Object>} Database client
   */
  async getClient() {
    if (!this.isInitialized) {
      await this.initialize();
    }
    return await this.pool.connect();
  }

  /**
   * Execute multiple queries in a transaction
   * @param {Function} callback - Function that receives client and executes queries
   * @returns {Promise<any>} Transaction result
   */
  async transaction(callback) {
    const client = await this.getClient();
    
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      
      this.logger.debug('Transaction completed successfully');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Transaction rolled back due to error', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get connection pool statistics
   * @returns {Object} Pool statistics
   */
  getPoolStats() {
    if (!this.pool) {
      return null;
    }

    const avgQueryTime = this.metrics.queryTimes.length > 0
      ? this.metrics.queryTimes.reduce((a, b) => a + b, 0) / this.metrics.queryTimes.length
      : 0;

    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      metrics: {
        ...this.metrics,
        averageQueryTime: Math.round(avgQueryTime),
        maxQueryTime: Math.max(...this.metrics.queryTimes, 0),
        minQueryTime: Math.min(...this.metrics.queryTimes, 0)
      }
    };
  }

  /**
   * Log pool statistics
   */
  logPoolStats() {
    const stats = this.getPoolStats();
    if (stats) {
      this.logger.info('Connection pool statistics', stats);
    }
  }

  /**
   * Health check for the connection pool
   * @returns {Promise<Object>} Health check result
   */
  async healthCheck() {
    try {
      const start = Date.now();
      await this.query('SELECT 1');
      const responseTime = Date.now() - start;
      
      const stats = this.getPoolStats();
      
      return {
        healthy: true,
        responseTime,
        timestamp: new Date().toISOString(),
        poolStats: stats
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Close all connections in the pool
   * @returns {Promise<void>}
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.logger.info('Database connection pool closed');
      this.isInitialized = false;
    }
  }
}

/**
 * Database utility functions
 */
export class DatabaseUtils {
  constructor(connectionPool) {
    this.pool = connectionPool;
    this.logger = connectionPool.logger;
  }

  /**
   * Check if a table exists
   * @param {string} tableName - Name of the table
   * @returns {Promise<boolean>} True if table exists
   */
  async tableExists(tableName) {
    const result = await this.pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = $1
      )
    `, [tableName]);
    
    return result.rows[0].exists;
  }

  /**
   * Get table row count
   * @param {string} tableName - Name of the table
   * @returns {Promise<number>} Number of rows
   */
  async getRowCount(tableName) {
    const result = await this.pool.query(`SELECT COUNT(*) FROM ${tableName}`);
    return parseInt(result.rows[0].count);
  }

  /**
   * Check if database schema is ready
   * @returns {Promise<boolean>} True if schema is ready
   */
  async isSchemaReady() {
    const requiredTables = [
      'users', 'roles', 'user_activities', 'activity_events',
      'activity_event_participants', 'user_role_assignments',
      'role_reset_history', 'afk_status', 'forum_messages',
      'voice_channel_mappings', 'schema_migrations', 'system_configuration'
    ];

    try {
      for (const table of requiredTables) {
        const exists = await this.tableExists(table);
        if (!exists) {
          this.logger.error(`Required table '${table}' does not exist`);
          return false;
        }
      }
      
      this.logger.info('Database schema validation passed');
      return true;
    } catch (error) {
      this.logger.error('Schema validation failed', error);
      return false;
    }
  }

  /**
   * Execute schema migration file
   * @param {string} schemaFile - Path to schema file
   * @returns {Promise<void>}
   */
  async executeSchemaFile(schemaFile) {
    const fs = await import('fs');
    const path = await import('path');
    
    if (!fs.existsSync(schemaFile)) {
      throw new Error(`Schema file not found: ${schemaFile}`);
    }

    const sql = fs.readFileSync(schemaFile, 'utf8');
    
    // Split SQL file into individual statements
    const statements = sql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    this.logger.info(`Executing ${statements.length} SQL statements from ${schemaFile}`);

    await this.pool.transaction(async (client) => {
      for (const statement of statements) {
        if (statement.trim()) {
          await client.query(statement);
        }
      }
    });

    this.logger.info('Schema file executed successfully');
  }

  /**
   * Record migration in schema_migrations table
   * @param {string} version - Migration version
   * @param {string} description - Migration description
   * @param {string} type - Migration type
   * @returns {Promise<void>}
   */
  async recordMigration(version, description, type = 'DATA') {
    await this.pool.query(`
      INSERT INTO schema_migrations (version, description, migration_type, applied_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (version) DO UPDATE SET
        applied_at = CURRENT_TIMESTAMP,
        status = 'SUCCESS'
    `, [version, description, type]);
  }

  /**
   * Check if migration has been applied
   * @param {string} version - Migration version
   * @returns {Promise<boolean>} True if migration exists
   */
  async isMigrationApplied(version) {
    const result = await this.pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM schema_migrations 
        WHERE version = $1 AND status = 'SUCCESS'
      )
    `, [version]);
    
    return result.rows[0].exists;
  }
}

// Export singleton instances for convenience
export const dbConfig = new DatabaseConfig();
export const connectionPool = new ConnectionPool(dbConfig);
export const dbUtils = new DatabaseUtils(connectionPool);