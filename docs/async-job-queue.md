# Async Job Queue System Documentation

## Overview

The Async Job Queue System provides a comprehensive solution for background job processing in Discord bots with features including progress tracking, retry management, result caching, and webhook delivery.

## Key Features

- **Background Processing**: Non-blocking job execution with configurable concurrency
- **Progress Updates**: Real-time progress tracking via Discord interactions
- **Retry Management**: Intelligent retry with exponential backoff
- **Result Caching**: LRU cache with TTL for performance optimization
- **Webhook Delivery**: HTTP webhook support for result delivery
- **Priority Queue**: Job prioritization with multiple priority levels
- **Health Monitoring**: Comprehensive metrics and health checks
- **Event-Driven**: EventEmitter-based architecture for loose coupling

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Job Enqueue   │────│  Priority Queue │────│  Job Processor  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │              ┌─────────────────┐              │
         └──────────────│  Result Cache   │──────────────┘
                        └─────────────────┘
                                 │
                   ┌─────────────────────────────────┐
                   │        Event System             │
                   │  • Progress Updates             │
                   │  • Discord Interactions         │
                   │  • Webhook Delivery             │
                   │  • Health Monitoring            │
                   └─────────────────────────────────┘
```

## Quick Start

### 1. Service Registration

```typescript
// src/di/container.ts
import { container } from 'tsyringe';
import { AsyncJobQueue } from '../services/AsyncJobQueue';
import { DI_TOKENS } from '../interfaces';

container.register(DI_TOKENS.IAsyncJobQueue, {
  useClass: AsyncJobQueue
});
```

### 2. Basic Job Handler

```typescript
import { JobHandler } from '../interfaces/IAsyncJobQueue';

const simpleHandler: JobHandler<{ message: string }, { result: string }> = async (
  job,
  context,
  progressCallback
) => {
  // Update progress
  await progressCallback({
    current: 50,
    total: 100,
    percentage: 50,
    message: 'Processing...'
  });

  // Process job
  const result = `Processed: ${job.payload.message}`;

  await progressCallback({
    current: 100,
    total: 100,
    percentage: 100,
    message: 'Completed!'
  });

  return { result };
};
```

### 3. Register and Use

```typescript
// Register handler
jobQueue.registerHandler('simple-task', simpleHandler);

// Start processing
jobQueue.startProcessing();

// Enqueue job
const jobId = await jobQueue.enqueueJob(
  'simple-task',
  { message: 'Hello World' },
  {
    userId: interaction.user.id,
    guildId: interaction.guild?.id,
    interaction: interaction
  }
);
```

## Job Handlers

### Handler Interface

```typescript
export type JobHandler<TPayload = any, TResult = any> = (
  job: Job,
  context: JobContext,
  progressCallback: (progress: JobProgress) => Promise<void>
) => Promise<TResult>;
```

### Example Handlers

#### Member Activity Analysis

```typescript
import { createMemberActivityAnalysisHandler } from '../services/jobHandlers/ExampleJobHandlers';

const handler = createMemberActivityAnalysisHandler(client, dbManager, logService);
jobQueue.registerHandler('member-activity-analysis', handler);

// Usage
const jobId = await jobQueue.enqueueJob(
  'member-activity-analysis',
  {
    guildId: interaction.guild.id,
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-01-31'),
    includeVoiceTime: true,
    includeMessageCount: true,
    generateReport: true
  },
  {
    userId: interaction.user.id,
    guildId: interaction.guild.id,
    interaction: interaction
  }
);
```

#### Bulk Role Assignment

```typescript
import { createBulkRoleAssignmentHandler } from '../services/jobHandlers/ExampleJobHandlers';

const handler = createBulkRoleAssignmentHandler(client, logService);
jobQueue.registerHandler('bulk-role-assignment', handler);

// Usage
const jobId = await jobQueue.enqueueJob(
  'bulk-role-assignment',
  {
    guildId: interaction.guild.id,
    memberIds: ['123456789', '987654321'],
    roleIds: ['555666777'],
    action: 'add',
    reason: 'Bulk assignment via bot'
  },
  {
    userId: interaction.user.id,
    guildId: interaction.guild.id,
    interaction: interaction
  }
);
```

## Discord Integration

### Slash Command Integration

```typescript
// src/commands/AsyncJobCommand.ts
import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { injectable, inject } from 'tsyringe';
import { CommandBase } from './CommandBase';
import type { IAsyncJobQueue } from '../interfaces/IAsyncJobQueue';
import { DI_TOKENS } from '../interfaces';

@injectable()
export class AsyncJobCommand extends CommandBase {
  constructor(
    @inject(DI_TOKENS.IAsyncJobQueue) private jobQueue: IAsyncJobQueue
  ) {
    super({
      name: 'async-job',
      description: 'Manage async jobs',
      permissions: ['Administrator']
    });
  }

  static getSlashCommand() {
    return new SlashCommandBuilder()
      .setName('async-job')
      .setDescription('Execute async job')
      .addStringOption(option =>
        option
          .setName('type')
          .setDescription('Job type')
          .setRequired(true)
          .addChoices(
            { name: 'Member Analysis', value: 'member-activity-analysis' },
            { name: 'Role Assignment', value: 'bulk-role-assignment' },
            { name: 'Data Export', value: 'data-export' }
          )
      );
  }

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const jobType = interaction.options.getString('type', true);

    await interaction.deferReply();

    try {
      let jobId: string;
      
      switch (jobType) {
        case 'member-activity-analysis':
          jobId = await this.jobQueue.enqueueJob(
            'member-activity-analysis',
            {
              guildId: interaction.guild!.id,
              startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
              endDate: new Date(),
              includeVoiceTime: true,
              includeMessageCount: true,
              generateReport: true
            },
            {
              userId: interaction.user.id,
              guildId: interaction.guild!.id,
              interaction: interaction
            }
          );
          break;

        default:
          await interaction.editReply('Unknown job type');
          return;
      }

      await interaction.editReply({
        content: `Job started! ID: \`${jobId}\`\n\nYou'll receive progress updates as the job runs.`,
      });

    } catch (error) {
      console.error('Failed to start async job:', error);
      await interaction.editReply('Failed to start job. Please try again.');
    }
  }
}
```

### Progress Updates

The system automatically sends progress updates to Discord interactions:

```typescript
// Progress updates are sent automatically
// Customize the embed template in configuration
const config: Partial<AsyncJobQueueConfig> = {
  enableDiscordProgressUpdates: true,
  progressUpdateInterval: 2000,
  progressEmbedTemplate: {
    title: 'Job Progress',
    color: 0x00AE86
  }
};
```

## Configuration

### Default Configuration

```typescript
export const DEFAULT_ASYNC_JOB_QUEUE_CONFIG: AsyncJobQueueConfig = {
  // Queue settings
  maxConcurrentJobs: 10,
  maxQueueSize: 1000,
  defaultJobTimeout: 300000, // 5 minutes
  defaultMaxRetries: 3,
  defaultRetryDelay: 5000,
  
  // Progress update settings
  enableDiscordProgressUpdates: true,
  progressUpdateInterval: 2000,
  
  // Caching settings
  enableResultCaching: true,
  defaultCacheTTL: 3600000, // 1 hour
  maxCacheSize: 10000,
  cacheEvictionPolicy: 'lru',
  
  // Webhook settings
  enableWebhookDelivery: false,
  webhookRetryPolicy: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2
  },
  
  // Monitoring settings
  enableMetrics: true,
  metricsCollectionInterval: 60000,
  enableHealthChecks: true,
  healthCheckInterval: 30000,
  
  // Cleanup settings
  cleanupInterval: 300000, // 5 minutes
  completedJobRetentionTime: 86400000, // 24 hours
  failedJobRetentionTime: 259200000, // 3 days
  maxLogEntries: 100,
  
  // Performance settings
  batchProcessingSize: 5,
  enableJobBatching: false,
  jobProcessingInterval: 1000
};
```

### Custom Configuration

```typescript
const customConfig: Partial<AsyncJobQueueConfig> = {
  maxConcurrentJobs: 20,
  defaultJobTimeout: 600000, // 10 minutes
  enableWebhookDelivery: true,
  defaultWebhookConfig: {
    url: 'https://your-webhook-endpoint.com/jobs',
    method: 'POST',
    timeout: 10000,
    retries: 2
  }
};

const jobQueue = new AsyncJobQueue(client, dbManager, logService, customConfig);
```

## Webhook Integration

### Webhook Configuration

```typescript
const webhookConfig: WebhookConfig = {
  url: 'https://your-api.com/webhook/jobs',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your-token',
    'Content-Type': 'application/json'
  },
  timeout: 15000,
  retries: 3,
  retryDelay: 2000,
  enableAuth: true,
  authToken: 'your-auth-token',
  transformPayload: (job, result) => ({
    jobId: job.id,
    type: job.type,
    status: result.success ? 'completed' : 'failed',
    data: result.data,
    timestamp: new Date().toISOString()
  })
};
```

### Webhook Payload

```typescript
// Default webhook payload structure
{
  jobId: string;
  type: string;
  status: 'completed' | 'failed';
  userId: string;
  guildId?: string;
  result: {
    success: boolean;
    data?: any;
    error?: string;
    executionTime: number;
    retryCount: number;
  };
  metadata: {
    startedAt: string;
    completedAt: string;
    progress?: JobProgress;
  };
}
```

## Monitoring and Health Checks

### Statistics

```typescript
const stats = await jobQueue.getStatistics();
console.log('Queue Statistics:', {
  totalJobs: stats.totalJobs,
  completedJobs: stats.completedJobs,
  failedJobs: stats.failedJobs,
  averageExecutionTime: stats.averageExecutionTime,
  throughput: stats.throughputPerMinute,
  errorRate: stats.errorRate,
  cacheHitRate: stats.cacheHitRate
});
```

### Health Status

```typescript
const health = await jobQueue.getHealthStatus();
console.log('Queue Health:', {
  status: health.status, // 'healthy' | 'degraded' | 'critical'
  uptime: health.uptime,
  processingRate: health.processingRate,
  queueBacklog: health.queueBacklog,
  issues: health.issues,
  recommendations: health.recommendations
});
```

### Events

```typescript
// Listen for job events
jobQueue.on('jobCompleted', (job, result) => {
  console.log(`Job ${job.id} completed:`, result);
});

jobQueue.on('jobFailed', (job, error) => {
  console.error(`Job ${job.id} failed:`, error);
});

jobQueue.on('jobProgress', (job, progress) => {
  console.log(`Job ${job.id} progress: ${progress.percentage}%`);
});

jobQueue.on('queueEmpty', () => {
  console.log('Queue is empty');
});

jobQueue.on('error', (error) => {
  console.error('Queue error:', error);
});
```

## Best Practices

### Job Handler Design

1. **Idempotent Operations**: Design handlers to be safely retryable
2. **Progress Updates**: Provide meaningful progress information
3. **Error Handling**: Use specific error types for different failure modes
4. **Resource Management**: Clean up resources in finally blocks
5. **Timeout Awareness**: Design for configurable timeouts

```typescript
const robustHandler: JobHandler<PayloadType, ResultType> = async (job, context, progressCallback) => {
  const resources: Resource[] = [];
  
  try {
    await progressCallback({
      current: 0,
      total: 100,
      percentage: 0,
      message: 'Initializing...',
      stage: 'init'
    });

    // Acquire resources
    const resource = await acquireResource();
    resources.push(resource);

    // Process with progress updates
    for (let i = 0; i < items.length; i++) {
      await processItem(items[i]);
      
      await progressCallback({
        current: i + 1,
        total: items.length,
        percentage: ((i + 1) / items.length) * 100,
        message: `Processed ${i + 1}/${items.length} items`,
        stage: 'processing'
      });
    }

    return { success: true, processedCount: items.length };

  } catch (error) {
    if (error instanceof SpecificError) {
      throw new JobError('Specific failure reason', { retryable: true });
    }
    throw error;
  } finally {
    // Clean up resources
    for (const resource of resources) {
      await resource.cleanup();
    }
  }
};
```

### Performance Optimization

1. **Batch Operations**: Group related operations when possible
2. **Cache Results**: Enable caching for expensive computations
3. **Monitor Metrics**: Track execution times and resource usage
4. **Tune Concurrency**: Adjust based on system capacity

```typescript
// Optimal configuration for high-throughput scenarios
const highThroughputConfig: Partial<AsyncJobQueueConfig> = {
  maxConcurrentJobs: 50,
  enableJobBatching: true,
  batchProcessingSize: 10,
  jobProcessingInterval: 500,
  enableResultCaching: true,
  maxCacheSize: 50000
};
```

### Error Handling

1. **Structured Errors**: Use custom error types with metadata
2. **Retry Strategy**: Configure appropriate retry policies
3. **Circuit Breaker**: Implement circuit breaker for external services
4. **Graceful Degradation**: Handle partial failures gracefully

```typescript
class JobError extends Error {
  constructor(
    message: string,
    public metadata: {
      retryable?: boolean;
      severity?: 'low' | 'medium' | 'high';
      category?: string;
    } = {}
  ) {
    super(message);
    this.name = 'JobError';
  }
}
```

## Testing

### Unit Tests

```typescript
describe('AsyncJobQueue', () => {
  test('should process jobs with correct priority order', async () => {
    // Test implementation
  });

  test('should retry failed jobs according to policy', async () => {
    // Test implementation
  });

  test('should cache and reuse results correctly', async () => {
    // Test implementation
  });
});
```

### Integration Tests

```typescript
describe('Job Handler Integration', () => {
  test('should complete member activity analysis', async () => {
    // Full integration test
  });
});
```

## Migration Guide

### From Manual Processing

```typescript
// Before: Manual processing
async function processMembers(interaction: CommandInteraction) {
  await interaction.deferReply();
  
  try {
    const result = await longRunningProcess();
    await interaction.editReply(`Completed: ${result}`);
  } catch (error) {
    await interaction.editReply('Failed to process');
  }
}

// After: Async job queue
async function processMembers(interaction: CommandInteraction) {
  const jobId = await jobQueue.enqueueJob(
    'member-processing',
    { guildId: interaction.guild.id },
    { 
      userId: interaction.user.id,
      interaction: interaction 
    }
  );
  
  await interaction.reply(`Processing started! Job ID: ${jobId}`);
  // Progress updates will be sent automatically
}
```

## Troubleshooting

### Common Issues

1. **Jobs Stuck in Pending**: Check concurrency limits and handler registration
2. **High Memory Usage**: Tune cache settings and cleanup intervals
3. **Slow Processing**: Review handler efficiency and system resources
4. **Discord Rate Limits**: Implement proper rate limiting in handlers

### Debug Mode

```typescript
// Enable debug logging
const debugConfig: Partial<AsyncJobQueueConfig> = {
  enableMetrics: true,
  logLevel: 'debug'
};

// Monitor events for debugging
jobQueue.on('debug', (event, data) => {
  console.log(`[Debug] ${event}:`, data);
});
```

## API Reference

### Core Methods

- `enqueueJob<T>(type, payload, context, config?)` - Enqueue a new job
- `getJob(jobId)` - Retrieve job by ID
- `getJobs(filter?)` - Get jobs with optional filtering  
- `cancelJob(jobId, reason?)` - Cancel a pending/running job
- `retryJob(jobId, newConfig?)` - Retry a failed job
- `registerHandler<T,R>(type, handler, defaultConfig?)` - Register job handler
- `startProcessing()` - Start job processing
- `stopProcessing()` - Stop job processing gracefully
- `getStatistics()` - Get queue statistics
- `getHealthStatus()` - Get health status

### Configuration Options

See the `AsyncJobQueueConfig` interface for complete configuration options.

### Event Types

- `jobEnqueued` - Job added to queue
- `jobStarted` - Job execution started  
- `jobProgress` - Job progress updated
- `jobCompleted` - Job completed successfully
- `jobFailed` - Job failed
- `jobCancelled` - Job cancelled
- `jobRetry` - Job retry attempted
- `queueEmpty` - Queue became empty
- `queueFull` - Queue reached capacity
- `error` - Queue error occurred

---

For more examples and advanced usage, see the test files and example job handlers in the codebase.