# 🚀 Discord Bot PostgreSQL Migration Scripts

Comprehensive migration toolkit for transforming Discord Activity Bot from LowDB (JSON) to PostgreSQL with full data integrity, validation, and rollback capabilities.

## 📋 Overview

This migration system provides:
- **Complete Data Transformation** from LowDB to normalized PostgreSQL schema
- **Zero Data Loss** with comprehensive backup and rollback procedures
- **Performance Optimization** with strategic indexing and connection pooling
- **Comprehensive Validation** with pre/post migration checks
- **Production-Ready** error handling and monitoring

## 🏗️ Architecture

```
migration-scripts/
├── src/
│   ├── config/
│   │   └── database.js          # Database connection & configuration
│   ├── transformers/
│   │   ├── UserTransformer.js   # User activity transformation
│   │   ├── RoleTransformer.js   # Role configuration transformation
│   │   ├── ActivityLogTransformer.js # Activity logs transformation
│   │   └── MiscTransformer.js   # Miscellaneous collections
│   ├── migrate.js               # Main migration orchestrator
│   ├── validate.js              # Validation system
│   └── rollback.js              # Rollback system
├── package.json
└── README.md
```

## 🚦 Quick Start

### 1. Installation

```bash
cd migration-scripts
npm install
```

### 2. Environment Configuration

Create `.env` file:
```bash
# PostgreSQL Configuration
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=discord_activity_bot
POSTGRES_USER=discord_bot
POSTGRES_PASSWORD=your_secure_password

# Optional: SSL Configuration
POSTGRES_SSL=false
POSTGRES_SSL_CA=
POSTGRES_SSL_KEY=
POSTGRES_SSL_CERT=

# Connection Pool Settings
POSTGRES_MAX_CONNECTIONS=20
POSTGRES_MIN_CONNECTIONS=2
POSTGRES_IDLE_TIMEOUT=30000
POSTGRES_CONNECTION_TIMEOUT=5000

# Performance Tuning
POSTGRES_STATEMENT_TIMEOUT=30000
POSTGRES_QUERY_TIMEOUT=15000
POSTGRES_SLOW_QUERY_THRESHOLD=1000

# Monitoring
POSTGRES_POOL_MONITORING=true
POSTGRES_POOL_MONITORING_INTERVAL=60000

# Logging
LOG_LEVEL=info
NODE_ENV=production
```

### 3. Pre-Migration Validation

```bash
# Validate LowDB data and PostgreSQL connection
npm run migrate:validate

# Or manually
node src/validate.js pre --lowdb-path ../activity_bot.json --verbose
```

### 4. Execute Migration

```bash
# Dry run (recommended first)
npm run migrate:dry-run

# Full migration
npm run migrate

# Or manually with options
node src/migrate.js run --lowdb-path ../activity_bot.json --schema-path ../postgresql-schema-design.sql
```

### 5. Post-Migration Validation

```bash
# Complete validation suite
node src/validate.js all --verbose

# Post-migration only
node src/validate.js post --verbose
```

## 📖 Detailed Usage

### Migration Commands

#### Main Migration
```bash
# Execute complete migration
node src/migrate.js run [options]

Options:
  --dry-run              Simulate migration without changes
  --lowdb-path <path>    Path to LowDB JSON file (default: ../activity_bot.json)
  --schema-path <path>   Path to PostgreSQL schema file (default: ../postgresql-schema-design.sql)
  --backup-path <path>   Backup directory (default: ./backups)
  --batch-size <size>    Processing batch size (default: 1000)
  --skip-validation      Skip pre-migration validation
  --force                Override safety checks
```

#### Validation Commands
```bash
# Complete validation suite
node src/validate.js all [options]

# Pre-migration validation
node src/validate.js pre --lowdb-path ../activity_bot.json

# Post-migration validation  
node src/validate.js post --verbose

Options:
  --lowdb-path <path>    Path to LowDB JSON file
  --verbose              Detailed output
  --fix-issues           Attempt to fix discovered issues
```

#### Rollback Commands
```bash
# Execute rollback
node src/rollback.js execute [options]

# List available backups
node src/rollback.js list-backups --backup-path ./backups

# Validate backup file
node src/rollback.js validate-backup ./backups/backup-file.json

Options:
  --dry-run              Simulate rollback
  --force                Skip confirmations
  --target-backup <file> Specific backup to restore
  --preserve-schema      Keep schema, clear data only
  --backup-path <path>   Backup directory
```

## 🔄 Migration Process

### Phase 1: Pre-Migration Validation
- ✅ LowDB file accessibility and structure validation
- ✅ PostgreSQL connection and permissions testing
- ✅ Schema compatibility verification
- ✅ Disk space requirements analysis

### Phase 2: Database Preparation
- 🏗️ PostgreSQL schema creation from SQL file
- 🔧 Extension installation (uuid-ossp)
- 📊 Schema structure validation
- 📝 Migration metadata recording

### Phase 3: Data Backup
- 💾 LowDB file backup to timestamped location
- 🛡️ Safety backup creation before transformation
- 📁 Backup directory organization

### Phase 4: Data Transformation
- 👥 **Users**: `user_activity` → `users` + `user_activities`
- 🎭 **Roles**: `role_config` → `roles` + `role_reset_history`
- 📊 **Activity Logs**: `activity_logs` → `activity_events` + `activity_event_participants`
- 🔧 **Miscellaneous**: `afk_status`, `forum_messages`, `voice_channel_mappings`

### Phase 5: Post-Migration Validation
- 🔍 Data integrity verification
- 🔗 Foreign key relationship validation
- 📈 Record count comparison
- ⚡ Performance baseline establishment

### Phase 6: Optimization
- 📊 Table statistics update (`ANALYZE`)
- 🚀 Performance index creation
- 🔧 Connection pool optimization

## 📊 Data Transformation Details

### User Data Migration
```javascript
// LowDB Structure
{
  "442997845625274368": {
    "userId": "442997845625274368",
    "totalTime": 441140806,
    "startTime": null,
    "displayName": "초초"
  }
}

// PostgreSQL Result
// users table
INSERT INTO users (id, display_name, is_active) 
VALUES ('442997845625274368', '초초', true);

// user_activities table
INSERT INTO user_activities (user_id, total_time_ms, is_currently_active)
VALUES ('442997845625274368', 441140806, false);
```

### Role Configuration Migration
```javascript
// LowDB Structure
{
  "역할명": {
    "roleName": "역할명",
    "minHours": 10,
    "resetTime": 1640995200000,
    "reportCycle": 1
  }
}

// PostgreSQL Result
INSERT INTO roles (name, min_hours, report_cycle_weeks)
VALUES ('역할명', 10.00, 1);

INSERT INTO role_reset_history (role_id, reset_timestamp, reset_reason)
VALUES (role_id, '2022-01-01 00:00:00', 'Legacy data migration');
```

### Activity Log Migration
```javascript
// LowDB Structure
[{
  "id": "1672531200000-442997845625274368-abcdef",
  "userId": "442997845625274368", 
  "eventType": "JOIN",
  "channelId": "123456789012345678",
  "timestamp": 1672531200000,
  "membersCount": 3
}]

// PostgreSQL Result
INSERT INTO activity_events (
  id, user_id, event_type, event_timestamp, 
  channel_id, member_count, session_id
)
VALUES (
  uuid_generate_v4(),
  '442997845625274368',
  'JOIN',
  '2023-01-01 00:00:00',
  '123456789012345678',
  3,
  session_uuid
);
```

## 🛡️ Safety Features

### Comprehensive Backups
- **Pre-Migration**: Automatic LowDB file backup
- **Safety Backup**: PostgreSQL state before rollback
- **Timestamped**: All backups include ISO timestamps
- **Organized**: Structured backup directory

### Validation System
- **60+ Validation Tests** across 4 categories
- **Pre-Migration**: Environment and data validation
- **Post-Migration**: Schema and data integrity
- **Data Integrity**: Consistency and accuracy checks
- **Performance**: Query speed and optimization

### Rollback Capabilities
- **Complete Rollback**: Remove all migrated data
- **Selective Restore**: Restore from specific backups
- **Schema Preservation**: Option to keep schema structure
- **Safety Confirmations**: Multiple confirmation steps

## 📈 Performance Features

### Connection Pooling
```javascript
// Optimized connection pool configuration
{
  max: 20,                    // Maximum connections
  min: 2,                     // Minimum connections  
  idleTimeoutMillis: 30000,   // Connection timeout
  connectionTimeoutMillis: 5000 // Connection establishment timeout
}
```

### Strategic Indexing
```sql
-- User-centric queries (most common)
CREATE INDEX idx_user_activities_total_time ON user_activities(total_time_ms DESC);

-- Time-based queries (reporting)
CREATE INDEX idx_activity_events_recent ON activity_events(event_timestamp DESC) 
WHERE event_timestamp > (CURRENT_TIMESTAMP - interval '30 days');

-- Role compliance queries
CREATE INDEX idx_user_role_assignments_user ON user_role_assignments(user_id) 
WHERE is_active = true;
```

### Query Optimization
- **Computed Fields**: Pre-calculated hours/days for faster reporting
- **Partial Indexes**: Index only active/recent records
- **Connection Monitoring**: Real-time pool statistics
- **Slow Query Detection**: Automatic logging of slow queries

## 🔧 Configuration Options

### Database Configuration
```javascript
// Environment-specific settings
production: {
  max: 30,              // More connections for production
  min: 5,               // Higher minimum for stability  
  connectionTimeoutMillis: 10000,
  statement_timeout: 60000
}

development: {
  max: 5,               // Fewer connections for development
  min: 1,
  console_logging: true // Enhanced logging
}

test: {
  database: 'discord_bot_test',  // Separate test database
  max: 5,
  min: 1
}
```

### Migration Options
- **Batch Size**: Control memory usage with configurable batch processing
- **Concurrency**: Parallel processing for large datasets  
- **Validation Levels**: Skip/customize validation for different environments
- **Error Handling**: Configurable retry attempts and error thresholds

## 📋 Troubleshooting

### Common Issues

#### Connection Issues
```bash
# Test connection
node -e "
import { ConnectionPool, DatabaseConfig } from './src/config/database.js';
const pool = new ConnectionPool(new DatabaseConfig());
pool.healthCheck().then(console.log);
"
```

#### Permission Issues
```sql
-- Grant required permissions
GRANT CREATE, CONNECT ON DATABASE discord_activity_bot TO discord_bot;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO discord_bot;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO discord_bot;
```

#### Large Dataset Issues
```bash
# Use smaller batch sizes for large datasets
node src/migrate.js run --batch-size 500

# Monitor memory usage
node --max-old-space-size=4096 src/migrate.js run
```

#### Schema Issues
```bash
# Recreate schema if needed
dropdb discord_activity_bot
createdb discord_activity_bot
psql discord_activity_bot < ../postgresql-schema-design.sql
```

### Error Recovery

#### Migration Fails Mid-Process
```bash
# Check migration status
node src/validate.js post --verbose

# Rollback if needed
node src/rollback.js execute --force

# Fix issues and retry
node src/migrate.js run --skip-validation
```

#### Data Inconsistencies
```bash
# Run integrity validation
node src/validate.js all --verbose --fix-issues

# Manual data fixes
psql discord_activity_bot -c "
UPDATE user_activities 
SET total_hours = total_time_ms / 3600000.0 
WHERE ABS(total_hours - (total_time_ms / 3600000.0)) > 0.01;
"
```

## 📊 Monitoring & Metrics

### Migration Statistics
- **Record Counts**: Before/after comparison
- **Processing Speed**: Records per second
- **Error Rates**: Success/failure ratios  
- **Memory Usage**: Peak and average consumption
- **Duration**: Phase-by-phase timing

### Performance Metrics
- **Query Response Times**: Sub-100ms targets
- **Connection Pool Health**: Active/idle/waiting counts
- **Index Utilization**: Hit ratios and usage statistics
- **Database Size**: Storage usage analysis

### Health Checks
```bash
# Database health
node -e "
import { ConnectionPool, DatabaseConfig } from './src/config/database.js';
const pool = new ConnectionPool(new DatabaseConfig());
pool.healthCheck().then(r => console.log(JSON.stringify(r, null, 2)));
"

# Migration completeness
node src/validate.js post --verbose
```

## 🔄 Development & Testing

### Running Tests
```bash
# Install test dependencies
npm install --dev

# Run validation tests
npm test

# Run linting
npm run lint

# Generate documentation
npm run docs
```

### Development Mode
```bash
# Watch mode for development
npm run dev

# Debug logging
LOG_LEVEL=debug npm run migrate:dry-run
```

## 🤝 Contributing

1. **Fork** the repository
2. **Create** feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** changes (`git commit -m 'Add amazing feature'`)
4. **Push** to branch (`git push origin feature/amazing-feature`)  
5. **Open** Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **PostgreSQL** community for excellent documentation
- **Node.js pg** library maintainers  
- **Discord.js** community for Discord integration patterns
- **LowDB** creators for the original simple database solution

---

**Built with ❤️ for Discord Bot developers seeking enterprise-grade database solutions**