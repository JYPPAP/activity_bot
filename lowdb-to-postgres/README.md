# 🐘 PostgreSQL Migration Guide for Discord Activity Bot

Complete migration strategy from LowDB JSON storage to PostgreSQL for enhanced scalability, performance, and data integrity.

## 📋 Migration Overview

### **Current State**
- **Storage**: LowDB with JSON file (`activity_bot.json`)
- **Data Volume**: ~50 users, months of activity logs
- **Performance**: File-based with 30-second caching
- **Limitations**: Concurrent access, scalability constraints

### **Target State**  
- **Storage**: PostgreSQL with normalized schema
- **Performance**: Connection pooling, query optimization
- **Scalability**: Support for 1000+ users
- **Features**: ACID transactions, backup/restore, monitoring

---

## 🏗️ Architecture Design

### **Database Schema**
```
users (Discord user data)
├── user_activities (activity tracking)
├── activity_logs (event logging)
└── activity_log_members (event participants)

roles (Discord role configuration)
└── role_resets (administrative history)

afk_status (AFK state management)
forum_messages (Discord forum integration)
voice_channel_mappings (channel-forum mappings)
```

### **Migration Components**
1. **`01-schema.sql`** - PostgreSQL schema definition
2. **`02-migrate-data.js`** - Data migration script
3. **`03-postgres-database-manager.js`** - Repository pattern data access
4. **`04-performance-config.js`** - Connection pooling & optimization
5. **`05-backup-rollback.js`** - Backup & rollback strategies

---

## 🚀 Quick Start Migration

### **Prerequisites**
```bash
# Install PostgreSQL (Ubuntu/Debian)
sudo apt update
sudo apt install postgresql postgresql-contrib

# Install PostgreSQL (macOS)
brew install postgresql
brew services start postgresql

# Install Node.js dependencies
npm install pg
```

### **Step 1: PostgreSQL Setup**
```bash
# Create database and user
sudo -u postgres psql
CREATE DATABASE discord_activity_bot;
CREATE USER discord_bot WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE discord_activity_bot TO discord_bot;
\\q
```

### **Step 2: Environment Configuration**
```bash
# Create .env file
cat > .env << EOF
# PostgreSQL Configuration
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=discord_activity_bot
POSTGRES_USER=discord_bot
POSTGRES_PASSWORD=your_secure_password
POSTGRES_SSL=false

# Connection Pool Settings
POSTGRES_MAX_CONNECTIONS=20
POSTGRES_MIN_CONNECTIONS=2
POSTGRES_IDLE_TIMEOUT=30000
POSTGRES_CONNECTION_TIMEOUT=2000

# Performance Monitoring
POSTGRES_TRACK_SLOW_QUERIES=true
POSTGRES_SLOW_QUERY_THRESHOLD=1000
POSTGRES_POOL_MONITORING=true
EOF
```

### **Step 3: Schema Creation**
```bash
# Apply PostgreSQL schema
psql -h localhost -U discord_bot -d discord_activity_bot -f ./lowdb-to-postgres/01-schema.sql
```

### **Step 4: Data Migration**
```bash
# Run migration script
node ./lowdb-to-postgres/02-migrate-data.js
```

### **Step 5: Application Update**
```javascript
// Update your main application file
import { PostgreSQLDatabaseManager } from './lowdb-to-postgres/03-postgres-database-manager.js';

// Replace LowDB DatabaseManager
const dbManager = new PostgreSQLDatabaseManager({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD
});
```

---

## 📊 Migration Process

### **Phase 1: Preparation**
1. **Backup Current Data**
   ```bash
   node ./lowdb-to-postgres/05-backup-rollback.js backup
   ```

2. **Validate Data Integrity**
   ```bash
   # Check LowDB file structure
   jq '.user_activity | length' activity_bot.json
   jq '.role_config | length' activity_bot.json
   ```

3. **Setup PostgreSQL Environment**
   ```bash
   # Test connection
   psql -h localhost -U discord_bot -d discord_activity_bot -c "SELECT 1;"
   ```

### **Phase 2: Schema Migration**
1. **Create Database Schema**
   ```bash
   psql -h localhost -U discord_bot -d discord_activity_bot -f ./lowdb-to-postgres/01-schema.sql
   ```

2. **Verify Schema Creation**
   ```sql
   -- Check tables
   \\dt
   
   -- Check indexes
   \\di
   
   -- Verify constraints
   SELECT conname, contype FROM pg_constraint WHERE connamespace = 'public'::regnamespace;
   ```

### **Phase 3: Data Migration**
1. **Run Migration Script**
   ```bash
   node ./lowdb-to-postgres/02-migrate-data.js
   ```

2. **Migration Validation**
   ```sql
   -- Verify data counts
   SELECT 'users' as table_name, COUNT(*) FROM users
   UNION ALL
   SELECT 'user_activities', COUNT(*) FROM user_activities
   UNION ALL
   SELECT 'activity_logs', COUNT(*) FROM activity_logs
   UNION ALL
   SELECT 'roles', COUNT(*) FROM roles;
   ```

### **Phase 4: Application Integration**
1. **Update Database Manager**
   ```javascript
   // Replace in your main bot file
   import { PostgreSQLDatabaseManager } from './lowdb-to-postgres/03-postgres-database-manager.js';
   const dbManager = new PostgreSQLDatabaseManager();
   ```

2. **Test Application Functionality**
   ```bash
   # Start bot in test mode
   NODE_ENV=test npm start
   
   # Run Discord command tests
   # /시간체크
   # /보고서 [role] [start_date] [end_date]
   ```

### **Phase 5: Production Deployment**
1. **Performance Optimization**
   ```bash
   # Apply performance configuration
   node -e "
   import { PerformanceAnalyzer } from './lowdb-to-postgres/04-performance-config.js';
   const analyzer = new PerformanceAnalyzer(pool);
   await analyzer.generatePerformanceReport();
   "
   ```

2. **Monitoring Setup**
   ```javascript
   import { HealthChecker } from './lowdb-to-postgres/04-performance-config.js';
   const healthChecker = new HealthChecker(pool);
   healthChecker.startHealthChecking(30000); // 30s intervals
   ```

---

## 🔧 Configuration Reference

### **Environment Variables**
| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | localhost | PostgreSQL server host |
| `POSTGRES_PORT` | 5432 | PostgreSQL server port |
| `POSTGRES_DB` | discord_activity_bot | Database name |
| `POSTGRES_USER` | discord_bot | Database user |
| `POSTGRES_PASSWORD` | - | Database password |
| `POSTGRES_SSL` | false | Enable SSL connection |
| `POSTGRES_MAX_CONNECTIONS` | 20 | Maximum pool connections |
| `POSTGRES_MIN_CONNECTIONS` | 2 | Minimum pool connections |
| `POSTGRES_IDLE_TIMEOUT` | 30000 | Idle connection timeout (ms) |
| `POSTGRES_TRACK_SLOW_QUERIES` | false | Enable slow query logging |
| `POSTGRES_SLOW_QUERY_THRESHOLD` | 1000 | Slow query threshold (ms) |

### **PostgreSQL Configuration (postgresql.conf)**
```ini
# Memory Settings
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 4MB
maintenance_work_mem = 64MB

# Connection Settings
max_connections = 100
listen_addresses = 'localhost'

# Logging
log_min_duration_statement = 1000  # Log queries > 1s
log_checkpoints = on
log_connections = on
log_disconnections = on

# Performance
random_page_cost = 1.1  # For SSD
effective_io_concurrency = 200  # For SSD
```

---

## 🔄 Backup & Rollback Procedures

### **Creating Backups**
```bash
# Create comprehensive backup
node ./lowdb-to-postgres/05-backup-rollback.js backup

# Manual PostgreSQL dump
pg_dump -h localhost -U discord_bot -d discord_activity_bot > backup-$(date +%Y%m%d-%H%M%S).sql
```

### **Rollback to LowDB**
```bash
# List available backups
node ./lowdb-to-postgres/05-backup-rollback.js list

# Rollback to specific backup
node ./lowdb-to-postgres/05-backup-rollback.js rollback-lowdb pre-migration-2025-01-25T10-30-00-000Z

# Update configuration
echo "DATABASE_TYPE=lowdb" >> .env
```

### **PostgreSQL Rollback**
```bash
# Rollback PostgreSQL to previous state
node ./lowdb-to-postgres/05-backup-rollback.js rollback-postgresql backup-name

# Restore from manual dump
psql -h localhost -U discord_bot -d discord_activity_bot < backup-20250125-103000.sql
```

---

## 📈 Performance Optimization

### **Query Optimization**
```sql
-- Analyze query performance
EXPLAIN ANALYZE SELECT * FROM user_activities WHERE total_time_ms > 3600000;

-- Create custom indexes for common queries
CREATE INDEX idx_activity_logs_user_timestamp ON activity_logs(user_id, timestamp DESC);
CREATE INDEX idx_user_activities_total_time ON user_activities(total_time_ms DESC);
```

### **Connection Pool Tuning**
```javascript
// Optimal pool settings for different environments
const poolConfig = {
  development: { max: 5, min: 1 },
  production: { max: 25, min: 5 },
  test: { max: 3, min: 1 }
};
```

### **Monitoring Queries**
```sql
-- Find slow queries (requires pg_stat_statements)
SELECT query, calls, total_time, mean_time 
FROM pg_stat_statements 
WHERE mean_time > 100 
ORDER BY mean_time DESC 
LIMIT 10;

-- Check index usage
SELECT schemaname, tablename, indexname, idx_scan 
FROM pg_stat_user_indexes 
WHERE idx_scan = 0;
```

---

## 🚨 Troubleshooting

### **Common Issues**

**Connection Errors**
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Test connection
psql -h localhost -U discord_bot -d discord_activity_bot -c "SELECT 1;"

# Check logs
sudo tail -f /var/log/postgresql/postgresql-*.log
```

**Migration Failures**
```bash
# Check migration log
cat ./lowdb-to-postgres/backups/migration-log.json

# Validate data integrity
node -e "
const { Pool } = require('pg');
const pool = new Pool({...config});
// Run validation queries
"
```

**Performance Issues**
```sql
-- Check table sizes
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check active connections
SELECT count(*) FROM pg_stat_activity;
```

### **Debug Mode**
```bash
# Enable detailed logging
export DEBUG=discord-bot:*
export POSTGRES_LOG_CONNECTIONS=true
export POSTGRES_TRACK_SLOW_QUERIES=true

# Run with debug output
node index.js
```

---

## 📋 Migration Checklist

### **Pre-Migration**
- [ ] PostgreSQL installed and configured
- [ ] Database and user created
- [ ] Environment variables set
- [ ] LowDB backup created
- [ ] Schema validation completed

### **Migration**
- [ ] Schema applied successfully
- [ ] Data migration completed
- [ ] Row counts validated
- [ ] Indexes created
- [ ] Constraints verified

### **Post-Migration**
- [ ] Application updated to use PostgreSQL
- [ ] Discord commands tested
- [ ] Performance monitoring enabled
- [ ] Backup strategy implemented
- [ ] Rollback procedure tested

### **Production**
- [ ] Load testing completed
- [ ] Monitoring alerts configured
- [ ] Documentation updated
- [ ] Team training completed
- [ ] Incident response plan updated

---

## 📞 Support & Maintenance

### **Regular Maintenance**
```bash
# Weekly database maintenance
psql -h localhost -U discord_bot -d discord_activity_bot -c "VACUUM ANALYZE;"

# Monthly backup verification
node ./lowdb-to-postgres/05-backup-rollback.js backup
```

### **Monitoring Setup**
```javascript
// Health check endpoint
app.get('/health', async (req, res) => {
  const health = await healthChecker.checkHealth();
  res.status(health.healthy ? 200 : 500).json(health);
});
```

### **Performance Reports**
```bash
# Generate monthly performance report
node -e "
import { PerformanceAnalyzer } from './lowdb-to-postgres/04-performance-config.js';
const analyzer = new PerformanceAnalyzer(pool);
await analyzer.generatePerformanceReport();
"
```

---

## 🔗 Additional Resources

- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Node.js pg Library](https://node-postgres.com/)
- [Discord.js Guide](https://discordjs.guide/)
- [Database Performance Tuning](https://wiki.postgresql.org/wiki/Performance_Optimization)

---

**Migration designed for Discord Activity Bot** - Transforming from LowDB to PostgreSQL for enterprise-scale Discord community management.