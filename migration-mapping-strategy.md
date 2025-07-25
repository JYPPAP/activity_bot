# 🔄 LowDB to PostgreSQL Migration Mapping Strategy

## 📊 Data Transformation Overview

### **Migration Complexity Matrix**
| LowDB Structure | PostgreSQL Tables | Complexity | Strategy |
|-----------------|-------------------|------------|----------|
| `user_activity` | `users` + `user_activities` | **Medium** | Extract & Normalize |
| `role_config` | `roles` | **Low** | Direct mapping |
| `activity_logs` | `activity_events` + `activity_event_participants` | **High** | Restructure & Enrich |
| `reset_history` | `role_reset_history` | **Low** | Direct mapping with enhancement |
| `afk_status` | `afk_status` | **Medium** | Normalize & Enhance |
| `forum_messages` | `forum_messages` | **Low** | Direct mapping |
| `voice_channel_mappings` | `voice_channel_mappings` | **Low** | Direct mapping with metrics |

---

## 🎯 Detailed Migration Mappings

### **1. User Activity Migration (Complex Normalization)**

#### **Source: LowDB `user_activity`**
```json
{
  "442997845625274368": {
    "userId": "442997845625274368",
    "totalTime": 441140806,
    "startTime": null,
    "displayName": "초초"
  }
}
```

#### **Target: PostgreSQL Tables**

**`users` Table:**
```sql
INSERT INTO users (id, display_name, first_seen, last_seen, is_active)
VALUES (
  '442997845625274368',
  '초초',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  true
);
```

**`user_activities` Table:**
```sql
INSERT INTO user_activities (
  user_id, 
  total_time_ms, 
  current_session_start,
  is_currently_active,
  session_count,
  last_activity_at
)
VALUES (
  '442997845625274368',
  441140806,
  CASE WHEN startTime IS NOT NULL THEN to_timestamp(startTime/1000) ELSE NULL END,
  CASE WHEN startTime IS NOT NULL THEN true ELSE false END,
  CASE WHEN startTime IS NOT NULL THEN 1 ELSE 0 END,
  CURRENT_TIMESTAMP
);
```

#### **Migration Logic:**
```javascript
// Migration function for user activity
async function migrateUserActivity(lowdbData) {
  for (const [userId, userData] of Object.entries(lowdbData.user_activity)) {
    // 1. Create or update user record
    await createUser(userId, userData.displayName);
    
    // 2. Create activity record with computed fields
    await createUserActivity({
      userId: userId,
      totalTimeMs: userData.totalTime || 0,
      currentSessionStart: userData.startTime ? new Date(userData.startTime) : null,
      isCurrentlyActive: userData.startTime !== null,
      sessionCount: userData.startTime ? 1 : 0
    });
  }
}
```

---

### **2. Role Configuration Migration (Direct Mapping)**

#### **Source: LowDB `role_config`**
```json
{
  "역할명": {
    "roleName": "역할명",
    "minHours": 10,
    "resetTime": 1640995200000,
    "reportCycle": 1
  }
}
```

#### **Target: PostgreSQL `roles` Table**
```sql
INSERT INTO roles (name, min_hours, report_cycle_weeks, created_at)
VALUES (
  '역할명',
  10.00,
  1,
  CURRENT_TIMESTAMP
);

-- Create reset history record if resetTime exists
INSERT INTO role_reset_history (
  role_id,
  reset_timestamp,
  reset_reason,
  admin_username
)
VALUES (
  (SELECT id FROM roles WHERE name = '역할명'),
  to_timestamp(1640995200000/1000),
  'Legacy data migration',
  'system'
);
```

---

### **3. Activity Logs Migration (Complex Restructuring)**

#### **Source: LowDB `activity_logs`**
```json
[
  {
    "id": "1672531200000-442997845625274368-abcdef",
    "userId": "442997845625274368",
    "eventType": "JOIN",
    "channelId": "123456789012345678",
    "channelName": "General Voice",
    "timestamp": 1672531200000,
    "membersCount": 3
  }
]
```

#### **Target: PostgreSQL `activity_events`**
```sql
-- Generate UUID for event
INSERT INTO activity_events (
  id,
  user_id,
  event_type,
  event_timestamp,
  channel_id,
  channel_name,
  member_count,
  session_id,
  event_source
)
VALUES (
  uuid_generate_v4(),
  '442997845625274368',
  'JOIN',
  to_timestamp(1672531200000/1000),
  '123456789012345678',
  'General Voice',
  3,
  uuid_generate_v4(), -- Generate session ID for grouping
  'lowdb_migration'
);
```

#### **Enhanced Migration with Session Tracking:**
```javascript
async function migrateActivityLogs(lowdbData) {
  const userSessions = new Map(); // Track active sessions per user
  
  for (const logEntry of lowdbData.activity_logs) {
    const eventId = uuid.v4();
    
    // Create activity event
    await createActivityEvent({
      id: eventId,
      userId: logEntry.userId,
      eventType: logEntry.eventType,
      timestamp: new Date(logEntry.timestamp),
      channelId: logEntry.channelId,
      channelName: logEntry.channelName,
      memberCount: logEntry.membersCount,
      sessionId: getOrCreateSessionId(logEntry.userId, logEntry.eventType, userSessions)
    });
    
    // Create participant records
    const members = lowdbData.log_members[logEntry.id] || [];
    for (const memberId of members) {
      await createEventParticipant(eventId, memberId);
    }
  }
}
```

---

### **4. AFK Status Migration (Normalization & Enhancement)**

#### **Source: LowDB `afk_status`**
```json
{
  "442997845625274368": {
    "userId": "442997845625274368",
    "displayName": "초초",
    "afkUntil": 1672617600000,
    "createdAt": 1672531200000
  }
}
```

#### **Target: PostgreSQL `afk_status`**
```sql
INSERT INTO afk_status (
  user_id,
  afk_start,
  afk_until,
  afk_type,
  afk_reason,
  is_active,
  set_by_user_id
)
VALUES (
  '442997845625274368',
  to_timestamp(1672531200000/1000),
  to_timestamp(1672617600000/1000),
  'MANUAL',
  'Legacy AFK status from migration',
  CASE WHEN to_timestamp(1672617600000/1000) > CURRENT_TIMESTAMP THEN true ELSE false END,
  '442997845625274368' -- Self-set
);
```

---

### **5. Forum & Voice Channel Migration (Direct with Enhancement)**

#### **Forum Messages Migration:**
```sql
-- Transform nested structure to flat table
INSERT INTO forum_messages (thread_id, message_type, message_id, is_active)
SELECT 
  thread_id,
  message_type,
  unnest(message_ids) as message_id,
  true as is_active
FROM (
  -- Flatten the nested JSON structure during migration
  SELECT 
    key as thread_id,
    msg_type as message_type,
    string_to_array(msg_ids, ',') as message_ids
  FROM jsonb_each_text(forum_messages_json)
) flattened;
```

#### **Voice Channel Mappings Migration:**
```sql
INSERT INTO voice_channel_mappings (
  voice_channel_id,
  forum_post_id,
  last_participant_count,
  created_at,
  updated_at,
  is_active
)
VALUES (
  voice_channel_id,
  forum_post_id,
  last_participant_count,
  to_timestamp(created_at/1000),
  to_timestamp(last_updated/1000),
  true
);
```

---

## 🔧 Migration Execution Strategy

### **Phase 1: Schema Preparation**
```sql
-- 1. Create all tables and indexes
\i postgresql-schema-design.sql

-- 2. Verify schema integrity
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' 
ORDER BY table_name, ordinal_position;
```

### **Phase 2: Data Migration Order (Dependency-Aware)**
```javascript
const migrationOrder = [
  'users',                    // 1. Base user records
  'roles',                    // 2. Role definitions
  'user_activities',          // 3. Activity data (depends on users)
  'activity_events',          // 4. Event logs (depends on users)
  'activity_event_participants', // 5. Event participants (depends on events)
  'role_reset_history',       // 6. Reset history (depends on roles)
  'afk_status',              // 7. AFK status (depends on users)
  'forum_messages',          // 8. Forum integration (independent)
  'voice_channel_mappings'   // 9. Voice mappings (independent)
];
```

### **Phase 3: Data Validation**
```sql
-- Validation queries for migration integrity
WITH migration_validation AS (
  SELECT 
    'users' as table_name,
    COUNT(*) as record_count,
    COUNT(DISTINCT id) as unique_count,
    MIN(created_at) as earliest_record,
    MAX(updated_at) as latest_record
  FROM users
  
  UNION ALL
  
  SELECT 
    'user_activities',
    COUNT(*),
    COUNT(DISTINCT user_id),
    MIN(created_at),
    MAX(updated_at)
  FROM user_activities
  
  UNION ALL
  
  SELECT 
    'activity_events',
    COUNT(*),
    COUNT(DISTINCT user_id),
    MIN(event_timestamp),
    MAX(event_timestamp)
  FROM activity_events
)
SELECT * FROM migration_validation;

-- Referential integrity check
SELECT 
  'user_activities_orphans' as check_name,
  COUNT(*) as orphan_count
FROM user_activities ua
LEFT JOIN users u ON ua.user_id = u.id
WHERE u.id IS NULL

UNION ALL

SELECT 
  'activity_events_orphans',
  COUNT(*)
FROM activity_events ae
LEFT JOIN users u ON ae.user_id = u.id
WHERE u.id IS NULL;
```

---

## 📈 Performance Optimization Strategy

### **Batch Processing Configuration**
```javascript
const MIGRATION_CONFIG = {
  batchSize: 1000,           // Process 1000 records at a time
  concurrency: 5,            // Max 5 parallel operations
  retryAttempts: 3,          // Retry failed operations
  progressInterval: 10000,   // Log progress every 10k records
  memoryThreshold: 0.8       // Pause if memory usage > 80%
};
```

### **Index Creation Strategy**
```sql
-- Create indexes AFTER data migration for better performance
-- Primary indexes (created with tables)
-- Secondary indexes (created post-migration)

-- Performance-critical indexes
CREATE INDEX CONCURRENTLY idx_activity_events_user_time_range 
ON activity_events(user_id, event_timestamp) 
WHERE event_timestamp > (CURRENT_TIMESTAMP - interval '30 days');

-- Partial indexes for active records
CREATE INDEX CONCURRENTLY idx_users_active_recent
ON users(last_seen DESC) 
WHERE is_active = true;

-- Composite indexes for complex queries
CREATE INDEX CONCURRENTLY idx_user_activities_performance
ON user_activities(total_time_ms DESC, is_currently_active, last_activity_at DESC);
```

### **Migration Performance Monitoring**
```javascript
class MigrationMonitor {
  constructor() {
    this.startTime = Date.now();
    this.recordsProcessed = 0;
    this.errors = [];
  }
  
  logProgress(tableName, processed, total) {
    const elapsed = Date.now() - this.startTime;
    const rate = processed / (elapsed / 1000);
    const eta = (total - processed) / rate;
    
    console.log(`${tableName}: ${processed}/${total} (${(processed/total*100).toFixed(1)}%) - ${rate.toFixed(0)} rec/sec - ETA: ${eta.toFixed(0)}s`);
  }
  
  async checkMemoryUsage() {
    const memUsage = process.memoryUsage();
    const memPercent = memUsage.rss / (1024 * 1024 * 1024); // GB
    
    if (memPercent > MIGRATION_CONFIG.memoryThreshold) {
      console.warn(`High memory usage: ${memPercent.toFixed(2)}GB - pausing...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}
```

---

## 🧪 Migration Testing Strategy

The migration mapping strategy provides **comprehensive data transformation** from LowDB's denormalized JSON structure to PostgreSQL's normalized relational schema, ensuring **data integrity**, **performance optimization**, and **future scalability** for the Discord activity bot.