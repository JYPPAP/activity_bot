// PostgreSQL Performance Configuration and Connection Pooling
// Optimized settings for Discord bot usage patterns

export const POSTGRES_PERFORMANCE_CONFIG = {
  // Connection Pool Settings
  connection: {
    // Basic Connection
    user: process.env.POSTGRES_USER || 'discord_bot',
    password: process.env.POSTGRES_PASSWORD,
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT) || 5432,
    database: process.env.POSTGRES_DB || 'discord_activity_bot',
    
    // SSL Configuration
    ssl: process.env.POSTGRES_SSL === 'true' ? {
      rejectUnauthorized: false,
      ca: process.env.POSTGRES_SSL_CA,
      key: process.env.POSTGRES_SSL_KEY,
      cert: process.env.POSTGRES_SSL_CERT
    } : false,

    // Connection Pool Settings
    max: parseInt(process.env.POSTGRES_MAX_CONNECTIONS) || 20,        // Maximum connections in pool
    min: parseInt(process.env.POSTGRES_MIN_CONNECTIONS) || 2,         // Minimum connections to maintain
    idleTimeoutMillis: parseInt(process.env.POSTGRES_IDLE_TIMEOUT) || 30000,  // 30s idle timeout
    connectionTimeoutMillis: parseInt(process.env.POSTGRES_CONNECTION_TIMEOUT) || 2000,  // 2s connection timeout
    
    // Query Settings
    query_timeout: parseInt(process.env.POSTGRES_QUERY_TIMEOUT) || 10000,  // 10s query timeout
    statement_timeout: parseInt(process.env.POSTGRES_STATEMENT_TIMEOUT) || 15000,  // 15s statement timeout
    
    // Application Name for monitoring
    application_name: process.env.POSTGRES_APP_NAME || 'discord-activity-bot'
  },

  // Performance Tuning Parameters
  performance: {
    // Memory Settings (for postgresql.conf)
    shared_buffers: process.env.POSTGRES_SHARED_BUFFERS || '256MB',
    effective_cache_size: process.env.POSTGRES_EFFECTIVE_CACHE_SIZE || '1GB',
    work_mem: process.env.POSTGRES_WORK_MEM || '4MB',
    maintenance_work_mem: process.env.POSTGRES_MAINTENANCE_WORK_MEM || '64MB',
    
    // Checkpoint Settings
    checkpoint_completion_target: parseFloat(process.env.POSTGRES_CHECKPOINT_TARGET) || 0.7,
    wal_buffers: process.env.POSTGRES_WAL_BUFFERS || '16MB',
    
    // Logging for Performance Monitoring
    log_min_duration_statement: parseInt(process.env.POSTGRES_LOG_SLOW_QUERIES) || 1000,  // Log queries > 1s
    log_checkpoints: process.env.POSTGRES_LOG_CHECKPOINTS === 'true',
    log_connections: process.env.POSTGRES_LOG_CONNECTIONS === 'true',
    log_disconnections: process.env.POSTGRES_LOG_DISCONNECTIONS === 'true',
    
    // Query Optimization
    random_page_cost: parseFloat(process.env.POSTGRES_RANDOM_PAGE_COST) || 1.1,  // For SSD
    effective_io_concurrency: parseInt(process.env.POSTGRES_IO_CONCURRENCY) || 200,  // For SSD
    
    // Autovacuum Settings
    autovacuum: process.env.POSTGRES_AUTOVACUUM !== 'false',
    autovacuum_max_workers: parseInt(process.env.POSTGRES_AUTOVACUUM_WORKERS) || 3,
    autovacuum_naptime: process.env.POSTGRES_AUTOVACUUM_NAPTIME || '1min'
  },

  // Monitoring and Health Check Settings
  monitoring: {
    // Health check query
    healthCheckQuery: 'SELECT 1',
    healthCheckInterval: parseInt(process.env.POSTGRES_HEALTH_CHECK_INTERVAL) || 30000,  // 30s
    
    // Connection pool monitoring
    poolMonitoringEnabled: process.env.POSTGRES_POOL_MONITORING === 'true',
    poolMonitoringInterval: parseInt(process.env.POSTGRES_POOL_MONITORING_INTERVAL) || 60000,  // 1min
    
    // Query performance tracking
    trackSlowQueries: process.env.POSTGRES_TRACK_SLOW_QUERIES === 'true',
    slowQueryThreshold: parseInt(process.env.POSTGRES_SLOW_QUERY_THRESHOLD) || 1000,  // 1s
    
    // Metrics collection
    enableMetrics: process.env.POSTGRES_ENABLE_METRICS === 'true',
    metricsPort: parseInt(process.env.POSTGRES_METRICS_PORT) || 9090
  }
};

// Environment-specific configurations
export const ENVIRONMENT_CONFIGS = {
  development: {
    ...POSTGRES_PERFORMANCE_CONFIG,
    connection: {
      ...POSTGRES_PERFORMANCE_CONFIG.connection,
      max: 5,  // Fewer connections for development
      min: 1,
      query_timeout: 30000,  // Longer timeout for debugging
    },
    performance: {
      ...POSTGRES_PERFORMANCE_CONFIG.performance,
      log_min_duration_statement: 500,  // Log queries > 500ms in dev
      log_connections: true,
      log_disconnections: true,
    }
  },

  production: {
    ...POSTGRES_PERFORMANCE_CONFIG,
    connection: {
      ...POSTGRES_PERFORMANCE_CONFIG.connection,
      max: 25,  // More connections for production load
      min: 5,
      connectionTimeoutMillis: 5000,  // Longer connection timeout
    },
    performance: {
      ...POSTGRES_PERFORMANCE_CONFIG.performance,
      shared_buffers: '512MB',  // More memory for production
      effective_cache_size: '2GB',
      work_mem: '8MB',
    },
    monitoring: {
      ...POSTGRES_PERFORMANCE_CONFIG.monitoring,
      poolMonitoringEnabled: true,
      trackSlowQueries: true,
      enableMetrics: true,
    }
  },

  test: {
    ...POSTGRES_PERFORMANCE_CONFIG,
    connection: {
      ...POSTGRES_PERFORMANCE_CONFIG.connection,
      max: 3,  // Minimal connections for testing
      min: 1,
      database: (process.env.POSTGRES_DB || 'discord_activity_bot') + '_test',
    }
  }
};

// Connection Pool Factory
export class ConnectionPoolFactory {
  static create(environment = 'development') {
    const config = ENVIRONMENT_CONFIGS[environment] || ENVIRONMENT_CONFIGS.development;
    return new Pool(config.connection);
  }

  static createWithMonitoring(environment = 'development') {
    const config = ENVIRONMENT_CONFIGS[environment] || ENVIRONMENT_CONFIGS.development;
    const pool = new Pool(config.connection);

    // Setup monitoring if enabled
    if (config.monitoring.poolMonitoringEnabled) {
      this.setupPoolMonitoring(pool, config.monitoring);
    }

    if (config.monitoring.trackSlowQueries) {
      this.setupSlowQueryTracking(pool, config.monitoring);
    }

    return pool;
  }

  static setupPoolMonitoring(pool, monitoringConfig) {
    setInterval(() => {
      console.log('[PostgreSQL Pool] Stats:', {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      });
    }, monitoringConfig.poolMonitoringInterval);

    pool.on('connect', (client) => {
      console.log('[PostgreSQL Pool] New client connected. Total:', pool.totalCount);
    });

    pool.on('remove', (client) => {
      console.log('[PostgreSQL Pool] Client removed. Total:', pool.totalCount);
    });

    pool.on('error', (err, client) => {
      console.error('[PostgreSQL Pool] Error:', err);
    });
  }

  static setupSlowQueryTracking(pool, monitoringConfig) {
    const originalQuery = pool.query.bind(pool);
    
    pool.query = function(text, params, callback) {
      const start = Date.now();
      
      const wrappedCallback = (err, result) => {
        const duration = Date.now() - start;
        
        if (duration > monitoringConfig.slowQueryThreshold) {
          console.warn(`[PostgreSQL] Slow query (${duration}ms):`, {
            query: typeof text === 'string' ? text.substring(0, 100) : text.text?.substring(0, 100),
            duration,
            timestamp: new Date().toISOString()
          });
        }
        
        if (callback) callback(err, result);
      };

      if (typeof params === 'function') {
        return originalQuery(text, wrappedCallback);
      } else {
        return originalQuery(text, params, wrappedCallback);
      }
    };
  }
}

// Database Performance Analysis Utilities
export class PerformanceAnalyzer {
  constructor(pool) {
    this.pool = pool;
  }

  async analyzeTableStats() {
    const query = `
      SELECT 
        schemaname,
        tablename,
        n_tup_ins,
        n_tup_upd,
        n_tup_del,
        n_live_tup,
        n_dead_tup,
        last_vacuum,
        last_autovacuum,
        last_analyze,
        last_autoanalyze
      FROM pg_stat_user_tables
      ORDER BY n_live_tup DESC;
    `;

    try {
      const result = await this.pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('[PostgreSQL] Table stats analysis error:', error);
      return [];
    }
  }

  async analyzeIndexUsage() {
    const query = `
      SELECT 
        schemaname,
        tablename,
        indexname,
        idx_tup_read,
        idx_tup_fetch,
        idx_scan
      FROM pg_stat_user_indexes
      WHERE idx_scan = 0
      ORDER BY schemaname, tablename;
    `;

    try {
      const result = await this.pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('[PostgreSQL] Index usage analysis error:', error);
      return [];
    }
  }

  async analyzeSlowQueries() {
    // Requires pg_stat_statements extension
    const query = `
      SELECT 
        query,
        calls,
        total_time,
        mean_time,
        rows,
        100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0) AS hit_percent
      FROM pg_stat_statements
      WHERE mean_time > 100  -- Queries with mean time > 100ms
      ORDER BY mean_time DESC
      LIMIT 10;
    `;

    try {
      const result = await this.pool.query(query);
      return result.rows;
    } catch (error) {
      if (error.message.includes('pg_stat_statements')) {
        console.warn('[PostgreSQL] pg_stat_statements extension not available');
      } else {
        console.error('[PostgreSQL] Slow query analysis error:', error);
      }
      return [];
    }
  }

  async generatePerformanceReport() {
    console.log('🔍 PostgreSQL Performance Analysis Report');
    console.log('=' .repeat(50));

    const tableStats = await this.analyzeTableStats();
    const indexUsage = await this.analyzeIndexUsage();
    const slowQueries = await this.analyzeSlowQueries();

    console.log('\n📊 Table Statistics:');
    tableStats.forEach(stat => {
      console.log(`  ${stat.tablename}: ${stat.n_live_tup} live rows, ${stat.n_dead_tup} dead rows`);
    });

    console.log('\n🔍 Unused Indexes:');
    if (indexUsage.length === 0) {
      console.log('  ✅ All indexes are being used');
    } else {
      indexUsage.forEach(index => {
        console.log(`  ❌ ${index.indexname} on ${index.tablename} (never scanned)`);
      });
    }

    console.log('\n🐌 Slow Queries:');
    if (slowQueries.length === 0) {
      console.log('  ✅ No slow queries detected (or pg_stat_statements not available)');
    } else {
      slowQueries.forEach(query => {
        console.log(`  ⚠️ ${query.mean_time.toFixed(2)}ms avg: ${query.query.substring(0, 80)}...`);
      });
    }

    console.log('\n' + '=' .repeat(50));
  }
}

// Database Health Check
export class HealthChecker {
  constructor(pool) {
    this.pool = pool;
    this.isHealthy = true;
    this.lastCheck = null;
  }

  async checkHealth() {
    try {
      const start = Date.now();
      await this.pool.query('SELECT 1');
      const responseTime = Date.now() - start;

      this.isHealthy = true;
      this.lastCheck = Date.now();

      return {
        healthy: true,
        responseTime,
        timestamp: new Date().toISOString(),
        poolStats: {
          total: this.pool.totalCount,
          idle: this.pool.idleCount,
          waiting: this.pool.waitingCount
        }
      };
    } catch (error) {
      this.isHealthy = false;
      this.lastCheck = Date.now();

      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  startHealthChecking(intervalMs = 30000) {
    setInterval(async () => {
      const health = await this.checkHealth();
      
      if (!health.healthy) {
        console.error('[PostgreSQL] Health check failed:', health.error);
      } else if (health.responseTime > 1000) {
        console.warn(`[PostgreSQL] Health check slow: ${health.responseTime}ms`);
      }
    }, intervalMs);

    console.log(`[PostgreSQL] Health checking started (${intervalMs}ms interval)`);
  }
}