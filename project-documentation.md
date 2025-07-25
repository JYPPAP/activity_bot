# Discord Activity Bot - Technical Documentation

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Core Services](#core-services)
4. [Database Design](#database-design)
5. [Discord Integration](#discord-integration)
6. [Configuration Management](#configuration-management)
7. [Performance Optimization](#performance-optimization)
8. [Development Workflow](#development-workflow)
9. [Deployment Guide](#deployment-guide)
10. [API Reference](#api-reference)
11. [Troubleshooting](#troubleshooting)

## System Overview

The Discord Activity Bot is a sophisticated TypeScript-based application designed to track and analyze voice channel activity in Discord servers. Built with enterprise-grade architecture patterns, the bot provides real-time activity monitoring, comprehensive reporting, and administrative tools for Discord communities.

### Key Features
- **Real-time Activity Tracking**: Voice channel session monitoring
- **Comprehensive Reporting**: Detailed activity reports with streaming delivery
- **User Classification**: Role-based activity requirements and tracking
- **Administrative Tools**: Guild configuration, AFK management, recruitment tools
- **Performance Optimization**: Designed for resource-constrained environments (Termux)
- **Scalable Architecture**: Service-oriented design with dependency injection

### Technology Stack
- **Runtime**: Node.js 18+
- **Language**: TypeScript (ES2022)
- **Framework**: Discord.js v14
- **Database**: PostgreSQL with Redis caching
- **DI Container**: TSyringe
- **Process Management**: PM2
- **Testing**: Jest with TypeScript support

## Architecture

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Discord Activity Bot                     │
├─────────────────────────────────────────────────────────────┤
│  Presentation Layer                                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
│  │   Discord   │ │    Slash    │ │     UI      │          │
│  │   Events    │ │  Commands   │ │ Components  │          │
│  └─────────────┘ └─────────────┘ └─────────────┘          │
├─────────────────────────────────────────────────────────────┤
│  Service Layer                                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │   Activity   │ │   Report     │ │  Member      │       │
│  │   Tracker    │ │   Engine     │ │  Fetch       │       │
│  └──────────────┘ └──────────────┘ └──────────────┘       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │     Log      │ │   Metrics    │ │   Command    │       │
│  │   Service    │ │   Service    │ │   Handler    │       │
│  └──────────────┘ └──────────────┘ └──────────────┘       │
├─────────────────────────────────────────────────────────────┤
│  Data Access Layer                                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │ PostgreSQL   │ │    Redis     │ │   Database   │       │
│  │   Manager    │ │   Service    │ │   Manager    │       │
│  └──────────────┘ └──────────────┘ └──────────────┘       │
├─────────────────────────────────────────────────────────────┤
│  Infrastructure Layer                                       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │  Connection  │ │   Circuit    │ │   Retry      │       │
│  │     Pool     │ │   Breaker    │ │   Manager    │       │
│  └──────────────┘ └──────────────┘ └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### Design Patterns

The system implements several key design patterns:

1. **Dependency Injection**: TSyringe container for service management
2. **Repository Pattern**: Database access abstraction
3. **Command Pattern**: Discord slash commands with deferred execution
4. **Observer Pattern**: Event-driven architecture for Discord events
5. **Strategy Pattern**: Multiple algorithms for user classification
6. **Factory Pattern**: Embed creation and service instantiation
7. **Circuit Breaker**: Resilience patterns for external API calls

### Service-Oriented Architecture

The system is organized into distinct service layers:

- **Core Services**: Essential business logic (ActivityTracker, CommandHandler)
- **Infrastructure Services**: Technical concerns (PostgreSQLManager, LogService)
- **Feature Services**: Specialized functionality (ReportEngine, MemberFetch)
- **Utility Services**: Cross-cutting concerns (PerformanceMonitoring, Metrics)

## Core Services

### ActivityTracker Service

The `ActivityTracker` is the heart of the bot, responsible for monitoring voice channel activities.

**Responsibilities:**
- Voice state change monitoring
- Session time calculation
- Activity data aggregation
- AFK detection and management

**Key Methods:**
```typescript
interface IActivityTracker {
  handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void>;
  endUserSession(userId: string, guildId: string): Promise<void>;
  getActiveUsers(guildId: string): Promise<ActivitySession[]>;
  updateSessionActivity(userId: string, guildId: string): Promise<void>;
}
```

### StreamingReportEngine Service

Advanced report generation with streaming capabilities for large datasets.

**Features:**
- Progressive report generation
- Memory-efficient processing
- Real-time progress updates
- Error recovery mechanisms

**Architecture:**
```typescript
interface IStreamingReportEngine {
  generateReport(config: ReportConfig): AsyncGenerator<ReportChunk>;
  getReportProgress(reportId: string): ReportProgress;
  cancelReport(reportId: string): Promise<void>;
}
```

### MemberFetchService

Optimized Discord member fetching with significant performance improvements (30s → 3s).

**Optimizations:**
- Batch processing with optimal chunk sizes
- Progress tracking and cancellation support
- Caching strategies
- Circuit breaker pattern for resilience

### PostgreSQLManager

Database access layer with connection pooling and transaction management.

**Features:**
- Connection pooling (max 20 connections)
- Prepared statement caching
- Transaction management
- Automatic retry mechanisms

## Database Design

### Schema Overview

The database schema is designed for optimal performance with time-series data:

```sql
-- Core activity tracking
user_activity (
  user_id VARCHAR(20),
  guild_id VARCHAR(20),
  channel_id VARCHAR(20),
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  duration INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Daily aggregation for performance
daily_activity_stats (
  user_id VARCHAR(20),
  guild_id VARCHAR(20),
  activity_date DATE,
  total_duration INTEGER,
  session_count INTEGER,
  last_activity TIMESTAMP
);

-- Role-based configuration
role_config (
  guild_id VARCHAR(20),
  role_id VARCHAR(20),
  daily_requirement INTEGER,
  weekly_requirement INTEGER,
  monthly_requirement INTEGER
);
```

### Indexing Strategy

Optimized indexes for common query patterns:

```sql
-- Performance indexes
CREATE INDEX idx_user_activity_user_guild ON user_activity(user_id, guild_id);
CREATE INDEX idx_user_activity_time ON user_activity(start_time, end_time);
CREATE INDEX idx_daily_stats_date ON daily_activity_stats(activity_date);
CREATE INDEX idx_daily_stats_user_guild ON daily_activity_stats(user_id, guild_id);
```

### Data Flow

1. **Write Path**: Voice events → Activity sessions → Aggregation triggers
2. **Read Path**: Cached queries → Aggregated views → Raw data fallback
3. **Aggregation**: Automatic triggers for daily/weekly/monthly stats

## Discord Integration

### Event Handling

The bot handles various Discord events:

```typescript
client.on('voiceStateUpdate', async (oldState, newState) => {
  await activityTracker.handleVoiceStateUpdate(oldState, newState);
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    await commandHandler.handleCommand(interaction);
  }
});
```

### Command System

Slash commands with Korean localization:

- **`/보고서`**: Activity reports with streaming delivery
- **`/설정`**: Guild configuration management
- **`/잠수`**: AFK status management
- **`/모집`**: Recruitment tools
- **`/갭체크`**: Gap analysis for activity requirements

### Embed System

Advanced embed generation with chunking for large content:

```typescript
interface IEmbedChunkingSystem {
  createChunkedEmbeds(
    data: any[],
    template: EmbedTemplate,
    chunkSize: number
  ): EmbedBuilder[];
  
  sendChunkedEmbeds(
    interaction: ChatInputCommandInteraction,
    embeds: EmbedBuilder[]
  ): Promise<void>;
}
```

## Configuration Management

### Environment Variables

**Required Variables:**
```bash
TOKEN=discord_bot_token
CLIENT_ID=discord_client_id
LOG_CHANNEL_ID=log_channel_id

# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=activity_bot
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password
```

**Optional Variables:**
```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=optional

# Discord Features
FORUM_CHANNEL_ID=channel_id
VOICE_CATEGORY_ID=category_id

# Performance
NODE_ENV=production
MAX_DB_CONNECTIONS=20
CACHE_TTL=3600
```

### Database Configuration

Guild-specific settings stored in database:

```typescript
interface GuildSettings {
  guildId: string;
  forumChannelId?: string;
  voiceCategoryId?: string;
  logChannelId?: string;
  requirementCheckEnabled: boolean;
  allowManualAfk: boolean;
  created_at: Date;
  updated_at: Date;
}
```

### Multi-Environment Support

Separate configuration files for different environments:
- `.env.development`: Development settings
- `.env.production`: Production settings
- `ecosystem.config.cjs`: PM2 process management

## Performance Optimization

### Memory Management

Optimized for Termux Android environment:

```typescript
// Memory monitoring
const performanceService = container.resolve<IPerformanceMonitoringService>(
  TYPES.PerformanceMonitoringService
);

// Garbage collection triggers
if (process.memoryUsage().heapUsed > MEMORY_THRESHOLD) {
  global.gc?.();
}
```

### Connection Pooling

Database connection optimization:

```typescript
const poolConfig = {
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  max: 20, // Maximum connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};
```

### Caching Strategy

Multi-level caching with Redis and memory fallback:

```typescript
interface ICacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  invalidate(pattern: string): Promise<void>;
}
```

### Streaming Architecture

Large dataset processing with streaming:

```typescript
async function* processLargeDataset(
  data: any[]
): AsyncGenerator<ProcessedChunk> {
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = data.slice(i, i + CHUNK_SIZE);
    yield await processChunk(chunk);
  }
}
```

## Development Workflow

### Project Structure

```
src/
├── commands/           # Discord slash commands
├── services/          # Business logic services
├── interfaces/        # TypeScript interfaces
├── utils/            # Utility functions
├── di/              # Dependency injection setup
├── migrations/      # Database migrations
└── tests/          # Test files
```

### TypeScript Configuration

Strict TypeScript configuration:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

### Testing Strategy

Comprehensive testing with Jest:

```json
{
  "testEnvironment": "node",
  "preset": "ts-jest/presets/default-esm",
  "extensionsToTreatAsEsm": [".ts"],
  "coverageDirectory": "coverage",
  "collectCoverageFrom": [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/tests/**"
  ]
}
```

### Build Process

Development and production builds:

```bash
# Development with hot reload
npm run dev

# Production build
npm run build
npm run start:prod
```

## Deployment Guide

### Termux Deployment

Optimized for Android Termux environment:

1. **Install Dependencies:**
```bash
pkg update && pkg upgrade
pkg install nodejs postgresql redis
```

2. **Database Setup:**
```bash
initdb -D $PREFIX/var/lib/postgresql
pg_ctl -D $PREFIX/var/lib/postgresql start
createdb activity_bot
```

3. **Application Setup:**
```bash
git clone <repository>
cd activity_bot
npm install
npm run build
```

4. **PM2 Configuration:**
```javascript
module.exports = {
  apps: [{
    name: 'activity-bot',
    script: './dist/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
```

### Production Deployment

1. **Environment Setup:**
```bash
export NODE_ENV=production
export TOKEN=your_discord_token
export POSTGRES_HOST=localhost
# ... other environment variables
```

2. **Database Migration:**
```bash
npm run migrate
```

3. **Start Application:**
```bash
npm run start:prod
```

### Health Monitoring

PM2 monitoring and log management:

```bash
# Monitor application
pm2 monit

# View logs
pm2 logs activity-bot

# Restart application
pm2 restart activity-bot
```

## API Reference

### Core Service Interfaces

#### IActivityTracker
```typescript
interface IActivityTracker {
  handleVoiceStateUpdate(
    oldState: VoiceState, 
    newState: VoiceState
  ): Promise<void>;
  
  endUserSession(
    userId: string, 
    guildId: string
  ): Promise<void>;
  
  getActiveUsers(guildId: string): Promise<ActivitySession[]>;
  
  updateSessionActivity(
    userId: string, 
    guildId: string
  ): Promise<void>;
  
  getUserActivityStats(
    userId: string, 
    guildId: string, 
    period: TimePeriod
  ): Promise<ActivityStats>;
}
```

#### IStreamingReportEngine
```typescript
interface IStreamingReportEngine {
  generateReport(config: ReportConfig): AsyncGenerator<ReportChunk>;
  getReportProgress(reportId: string): ReportProgress;
  cancelReport(reportId: string): Promise<void>;
  getAvailableTemplates(): ReportTemplate[];
}
```

#### IDatabaseManager
```typescript
interface IDatabaseManager {
  // User Activity
  insertUserActivity(activity: UserActivityRecord): Promise<void>;
  getUserActivity(
    userId: string, 
    guildId: string, 
    timeRange?: TimeRange
  ): Promise<UserActivityRecord[]>;
  
  // Statistics
  getDailyStats(
    guildId: string, 
    date: Date
  ): Promise<DailyActivityStats[]>;
  
  getWeeklyStats(
    guildId: string, 
    weekStart: Date
  ): Promise<WeeklyActivityStats[]>;
  
  getMonthlyStats(
    guildId: string, 
    month: Date
  ): Promise<MonthlyActivityStats[]>;
  
  // Configuration
  getGuildSettings(guildId: string): Promise<GuildSettings>;
  updateGuildSettings(
    guildId: string, 
    settings: Partial<GuildSettings>
  ): Promise<void>;
}
```

### Command Interfaces

#### ReportCommand (/보고서)
```typescript
interface ReportCommandOptions {
  period: 'daily' | 'weekly' | 'monthly';
  user?: User;
  role?: Role;
  format: 'detailed' | 'summary';
  streaming?: boolean;
}
```

#### SettingsCommand (/설정)
```typescript
interface SettingsCommandOptions {
  action: 'view' | 'update';
  setting?: keyof GuildSettings;
  value?: string;
}
```

### Error Handling

Comprehensive error handling with custom error types:

```typescript
class ActivityBotError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'ActivityBotError';
  }
}

class DatabaseError extends ActivityBotError {
  constructor(message: string, originalError?: Error) {
    super(message, 'DATABASE_ERROR', 500);
    this.cause = originalError;
  }
}

class DiscordAPIError extends ActivityBotError {
  constructor(message: string, statusCode: number) {
    super(message, 'DISCORD_API_ERROR', statusCode);
  }
}
```

## Troubleshooting

### Common Issues

#### Database Connection Issues
```bash
# Check PostgreSQL status
pg_ctl status -D $PREFIX/var/lib/postgresql

# Restart PostgreSQL
pg_ctl restart -D $PREFIX/var/lib/postgresql

# Check connection
psql -h localhost -U postgres -d activity_bot
```

#### Discord API Rate Limits
```typescript
// Rate limit handling is built-in
// Check logs for rate limit warnings
pm2 logs activity-bot | grep "rate limit"
```

#### Memory Issues in Termux
```bash
# Monitor memory usage
pm2 monit

# Restart with memory limit
pm2 restart activity-bot --max-memory-restart 200M
```

#### TypeScript Compilation Errors
```bash
# Clean build
npm run clean
npm run build

# Check TypeScript configuration
npx tsc --noEmit
```

### Performance Diagnostics

#### Database Performance
```sql
-- Check slow queries
SELECT query, mean_exec_time, calls 
FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;

-- Check index usage
SELECT schemaname, tablename, attname, n_distinct, correlation 
FROM pg_stats 
WHERE tablename = 'user_activity';
```

#### Application Performance
```typescript
// Enable performance monitoring
const performanceService = container.resolve(TYPES.PerformanceMonitoringService);
performanceService.startMonitoring();

// Check metrics
const metrics = await performanceService.getMetrics();
console.log('Response time:', metrics.responseTime);
console.log('Memory usage:', metrics.memoryUsage);
```

### Logging and Debugging

#### Log Levels
- `ERROR`: Critical errors requiring immediate attention
- `WARN`: Warning conditions that should be monitored
- `INFO`: General information about application flow
- `DEBUG`: Detailed debugging information

#### Debug Mode
```bash
# Enable debug logging
export LOG_LEVEL=debug
npm run dev
```

#### Performance Profiling
```bash
# Profile with Node.js built-in profiler
node --prof dist/index.js

# Analyze profile
node --prof-process isolate-*.log > profile.txt
```

## Conclusion

This technical documentation provides a comprehensive guide to the Discord Activity Bot architecture, implementation, and operational procedures. The system demonstrates enterprise-grade patterns while maintaining efficiency for resource-constrained environments.

For additional support or questions, refer to the source code comments and the development team's documentation repository.

---

**Version**: 1.0.0  
**Last Updated**: 2024-07-25  
**Maintained By**: Development Team