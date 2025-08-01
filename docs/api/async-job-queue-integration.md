# Async Job Queue Integration Guide

## Overview

This guide shows how to integrate the Async Job Queue system into your Discord bot project, including DI container registration, command integration, and practical usage examples.

## Step 1: DI Container Registration

Update your dependency injection container to register the AsyncJobQueue service:

### Update interfaces/index.ts

```typescript
// src/interfaces/index.ts
export type { 
  IAsyncJobQueue,
  Job,
  JobStatus,
  JobPriority,
  JobContext,
  JobConfig,
  JobProgress,
  JobResult,
  JobHandler,
  AsyncJobQueueConfig
} from './IAsyncJobQueue';

export const DI_TOKENS = {
  // ... existing tokens
  IAsyncJobQueue: Symbol.for('IAsyncJobQueue'),
  // ... rest of tokens
} as const;
```

### Update DI Container

```typescript
// src/di/container.ts
import { container } from 'tsyringe';
import { AsyncJobQueue } from '../services/AsyncJobQueue';
import { DI_TOKENS } from '../interfaces';

// Register AsyncJobQueue service
container.register(DI_TOKENS.IAsyncJobQueue, {
  useFactory: (c) => {
    const client = c.resolve(DI_TOKENS.DiscordClient);
    const dbManager = c.resolve(DI_TOKENS.IDatabaseManager);
    const logService = c.resolve(DI_TOKENS.ILogService);
    
    // Custom configuration
    const config = {
      maxConcurrentJobs: 15,
      enableDiscordProgressUpdates: true,
      progressUpdateInterval: 3000,
      enableResultCaching: true,
      defaultCacheTTL: 1800000, // 30 minutes
      enableMetrics: true
    };
    
    return new AsyncJobQueue(client, dbManager, logService, config);
  }
});
```

## Step 2: Service Initialization

Initialize the job queue service in your main bot file:

### Update bot.ts

```typescript
// src/bot.ts
import { container } from 'tsyringe';
import type { IAsyncJobQueue } from './interfaces/IAsyncJobQueue';
import { DI_TOKENS } from './interfaces';

// Import job handlers
import { 
  createMemberActivityAnalysisHandler,
  createBulkRoleAssignmentHandler,
  createDataExportHandler,
  createScheduledMessageHandler
} from './services/jobHandlers/ExampleJobHandlers';

export class ActivityBot {
  private jobQueue?: IAsyncJobQueue;

  async initialize() {
    // ... existing initialization code

    // Initialize job queue
    await this.initializeJobQueue();
    
    // ... rest of initialization
  }

  private async initializeJobQueue() {
    try {
      this.jobQueue = container.resolve<IAsyncJobQueue>(DI_TOKENS.IAsyncJobQueue);
      
      // Register job handlers
      const client = container.resolve(DI_TOKENS.DiscordClient);
      const dbManager = container.resolve(DI_TOKENS.IDatabaseManager);
      const logService = container.resolve(DI_TOKENS.ILogService);

      // Member Activity Analysis Handler
      const memberActivityHandler = createMemberActivityAnalysisHandler(
        client, 
        dbManager, 
        logService
      );
      this.jobQueue.registerHandler('member-activity-analysis', memberActivityHandler, {
        timeout: 600000, // 10 minutes
        maxRetries: 2,
        enableProgressUpdates: true,
        cacheResults: true,
        cacheTTL: 3600000 // 1 hour
      });

      // Bulk Role Assignment Handler
      const roleAssignmentHandler = createBulkRoleAssignmentHandler(client, logService);
      this.jobQueue.registerHandler('bulk-role-assignment', roleAssignmentHandler, {
        timeout: 300000, // 5 minutes
        maxRetries: 1,
        enableProgressUpdates: true
      });

      // Data Export Handler
      const dataExportHandler = createDataExportHandler(client, dbManager, logService);
      this.jobQueue.registerHandler('data-export', dataExportHandler, {
        timeout: 900000, // 15 minutes
        maxRetries: 1,
        enableProgressUpdates: true,
        cacheResults: false // Export should not be cached
      });

      // Scheduled Message Handler
      const scheduledMessageHandler = createScheduledMessageHandler(client, logService);
      this.jobQueue.registerHandler('scheduled-message', scheduledMessageHandler, {
        timeout: 60000, // 1 minute
        maxRetries: 2,
        enableProgressUpdates: true
      });

      // Start processing jobs
      this.jobQueue.startProcessing();

      // Set up event listeners for monitoring
      this.setupJobQueueEventListeners();

      console.log('✅ Async Job Queue initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Async Job Queue:', error);
      throw error;
    }
  }

  private setupJobQueueEventListeners() {
    if (!this.jobQueue) return;

    this.jobQueue.on('jobCompleted', (job, result) => {
      console.log(`✅ Job ${job.id} (${job.type}) completed in ${result.executionTime}ms`);
    });

    this.jobQueue.on('jobFailed', (job, error) => {
      console.error(`❌ Job ${job.id} (${job.type}) failed:`, error.message);
    });

    this.jobQueue.on('jobProgress', (job, progress) => {
      if (progress.percentage % 25 === 0) { // Log every 25%
        console.log(`🔄 Job ${job.id} progress: ${progress.percentage}% - ${progress.message}`);
      }
    });

    this.jobQueue.on('error', (error) => {
      console.error('🚨 Job Queue Error:', error);
    });
  }

  async shutdown() {
    // Gracefully stop job processing
    if (this.jobQueue) {
      console.log('Stopping job queue...');
      await this.jobQueue.stopProcessing();
    }
    
    // ... existing shutdown code
  }
}
```

## Step 3: Create Job Management Commands

Create dedicated commands for managing async jobs:

### JobCommand.ts

```typescript
// src/commands/JobCommand.ts
import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} from 'discord.js';
import { injectable, inject } from 'tsyringe';
import { CommandBase, CommandServices } from './CommandBase';
import type { IAsyncJobQueue, JobStatus } from '../interfaces/IAsyncJobQueue';
import { DI_TOKENS } from '../interfaces';

@injectable()
export class JobCommand extends CommandBase {
  constructor(
    services: CommandServices,
    @inject(DI_TOKENS.IAsyncJobQueue) private jobQueue: IAsyncJobQueue
  ) {
    super({
      name: 'job',
      description: 'Manage async jobs',
      permissions: ['Administrator']
    });
  }

  static getSlashCommand() {
    return new SlashCommandBuilder()
      .setName('job')
      .setDescription('Manage async jobs')
      .addSubcommand(subcommand =>
        subcommand
          .setName('start')
          .setDescription('Start a new job')
          .addStringOption(option =>
            option
              .setName('type')
              .setDescription('Job type')
              .setRequired(true)
              .addChoices(
                { name: 'Member Activity Analysis', value: 'member-activity-analysis' },
                { name: 'Bulk Role Assignment', value: 'bulk-role-assignment' },
                { name: 'Data Export', value: 'data-export' }
              )
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('status')
          .setDescription('Check job status')
          .addStringOption(option =>
            option
              .setName('job-id')
              .setDescription('Job ID to check')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('list')
          .setDescription('List recent jobs')
          .addStringOption(option =>
            option
              .setName('status')
              .setDescription('Filter by status')
              .addChoices(
                { name: 'All', value: 'all' },
                { name: 'Running', value: 'running' },
                { name: 'Completed', value: 'completed' },
                { name: 'Failed', value: 'failed' }
              )
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('cancel')
          .setDescription('Cancel a running job')
          .addStringOption(option =>
            option
              .setName('job-id')
              .setDescription('Job ID to cancel')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('stats')
          .setDescription('View job queue statistics')
      );
  }

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'start':
        await this.handleStartJob(interaction);
        break;
      case 'status':
        await this.handleJobStatus(interaction);
        break;
      case 'list':
        await this.handleJobList(interaction);
        break;
      case 'cancel':
        await this.handleJobCancel(interaction);
        break;
      case 'stats':
        await this.handleJobStats(interaction);
        break;
    }
  }

  private async handleStartJob(interaction: ChatInputCommandInteraction): Promise<void> {
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
              startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
              endDate: new Date(),
              includeVoiceTime: true,
              includeMessageCount: true,
              generateReport: true
            },
            {
              userId: interaction.user.id,
              guildId: interaction.guild!.id,
              channelId: interaction.channel!.id,
              interaction: interaction
            }
          );
          break;

        case 'bulk-role-assignment':
          // This would typically get parameters from a modal or additional options
          await interaction.editReply('Bulk role assignment requires additional parameters. Use the web interface or provide member/role IDs.');
          return;

        case 'data-export':
          jobId = await this.jobQueue.enqueueJob(
            'data-export',
            {
              guildId: interaction.guild!.id,
              exportType: 'all',
              format: 'json',
              includePersonalData: false
            },
            {
              userId: interaction.user.id,
              guildId: interaction.guild!.id,
              channelId: interaction.channel!.id,
              interaction: interaction
            }
          );
          break;

        default:
          await interaction.editReply('Unknown job type');
          return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🚀 Job Started')
        .setDescription(`Job has been queued successfully!`)
        .addFields([
          { name: 'Job ID', value: `\`${jobId}\``, inline: true },
          { name: 'Type', value: jobType, inline: true },
          { name: 'Status', value: 'Queued', inline: true }
        ])
        .setColor(0x00AE86)
        .setTimestamp();

      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`job-status-${jobId}`)
            .setLabel('Check Status')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📊')
        );

      await interaction.editReply({ embeds: [embed], components: [row] });

    } catch (error) {
      console.error('Failed to start job:', error);
      await interaction.editReply('❌ Failed to start job. Please try again.');
    }
  }

  private async handleJobStatus(interaction: ChatInputCommandInteraction): Promise<void> {
    const jobId = interaction.options.getString('job-id', true);
    
    await interaction.deferReply();

    try {
      const job = await this.jobQueue.getJob(jobId);
      
      if (!job) {
        await interaction.editReply('❌ Job not found');
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('📊 Job Status')
        .addFields([
          { name: 'Job ID', value: `\`${job.id}\``, inline: true },
          { name: 'Type', value: job.type, inline: true },
          { name: 'Status', value: this.getStatusEmoji(job.status) + ' ' + job.status, inline: true },
          { name: 'Created', value: `<t:${Math.floor(job.createdAt.getTime() / 1000)}:R>`, inline: true }
        ])
        .setColor(this.getStatusColor(job.status))
        .setTimestamp();

      if (job.startedAt) {
        embed.addFields([
          { name: 'Started', value: `<t:${Math.floor(job.startedAt.getTime() / 1000)}:R>`, inline: true }
        ]);
      }

      if (job.completedAt) {
        embed.addFields([
          { name: 'Completed', value: `<t:${Math.floor(job.completedAt.getTime() / 1000)}:R>`, inline: true }
        ]);
      }

      if (job.progress) {
        embed.addFields([
          { name: 'Progress', value: `${job.progress.percentage}% - ${job.progress.message || 'Processing...'}`, inline: false }
        ]);
      }

      if (job.result?.executionTime) {
        embed.addFields([
          { name: 'Execution Time', value: `${job.result.executionTime}ms`, inline: true }
        ]);
      }

      if (job.lastError) {
        embed.addFields([
          { name: 'Last Error', value: `\`\`\`${job.lastError.message}\`\`\``, inline: false }
        ]);
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Failed to get job status:', error);
      await interaction.editReply('❌ Failed to retrieve job status');
    }
  }

  private async handleJobList(interaction: ChatInputCommandInteraction): Promise<void> {
    const statusFilter = interaction.options.getString('status') || 'all';
    
    await interaction.deferReply();

    try {
      const filter: any = {
        userId: interaction.user.id,
        limit: 10
      };

      if (statusFilter !== 'all') {
        filter.status = statusFilter as JobStatus;
      }

      const jobs = await this.jobQueue.getJobs(filter);

      if (jobs.length === 0) {
        await interaction.editReply('📭 No jobs found');
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('📋 Recent Jobs')
        .setDescription(`Showing ${jobs.length} most recent jobs`)
        .setColor(0x00AE86)
        .setTimestamp();

      for (const job of jobs.slice(0, 5)) {
        const statusEmoji = this.getStatusEmoji(job.status);
        const createdTime = `<t:${Math.floor(job.createdAt.getTime() / 1000)}:R>`;
        
        embed.addFields([
          {
            name: `${statusEmoji} ${job.type}`,
            value: `ID: \`${job.id}\`\nCreated: ${createdTime}`,
            inline: true
          }
        ]);
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Failed to list jobs:', error);
      await interaction.editReply('❌ Failed to retrieve job list');
    }
  }

  private async handleJobCancel(interaction: ChatInputCommandInteraction): Promise<void> {
    const jobId = interaction.options.getString('job-id', true);
    
    await interaction.deferReply();

    try {
      const cancelled = await this.jobQueue.cancelJob(jobId, 'Cancelled by user');
      
      if (cancelled) {
        await interaction.editReply(`✅ Job \`${jobId}\` has been cancelled`);
      } else {
        await interaction.editReply(`❌ Could not cancel job \`${jobId}\`. It may have already completed or not exist.`);
      }

    } catch (error) {
      console.error('Failed to cancel job:', error);
      await interaction.editReply('❌ Failed to cancel job');
    }
  }

  private async handleJobStats(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    try {
      const stats = await this.jobQueue.getStatistics();
      const health = await this.jobQueue.getHealthStatus();

      const embed = new EmbedBuilder()
        .setTitle('📈 Job Queue Statistics')
        .addFields([
          { name: 'Total Jobs', value: stats.totalJobs.toString(), inline: true },
          { name: 'Completed', value: stats.completedJobs.toString(), inline: true },
          { name: 'Failed', value: stats.failedJobs.toString(), inline: true },
          { name: 'Running', value: stats.runningJobs.toString(), inline: true },
          { name: 'Pending', value: stats.pendingJobs.toString(), inline: true },
          { name: 'Success Rate', value: `${((stats.completedJobs / Math.max(stats.totalJobs, 1)) * 100).toFixed(1)}%`, inline: true },
          { name: 'Avg Execution Time', value: `${stats.averageExecutionTime.toFixed(0)}ms`, inline: true },
          { name: 'Throughput', value: `${stats.throughputPerMinute.toFixed(1)}/min`, inline: true },
          { name: 'Cache Hit Rate', value: `${(stats.cacheHitRate * 100).toFixed(1)}%`, inline: true },
          { name: 'Health Status', value: this.getHealthEmoji(health.status) + ' ' + health.status.toUpperCase(), inline: false }
        ])
        .setColor(health.status === 'healthy' ? 0x00FF00 : health.status === 'degraded' ? 0xFFFF00 : 0xFF0000)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Failed to get job stats:', error);
      await interaction.editReply('❌ Failed to retrieve statistics');
    }
  }

  private getStatusEmoji(status: JobStatus): string {
    switch (status) {
      case JobStatus.PENDING: return '⏳';
      case JobStatus.RUNNING: return '🔄';
      case JobStatus.COMPLETED: return '✅';
      case JobStatus.FAILED: return '❌';
      case JobStatus.CANCELLED: return '⛔';
      case JobStatus.TIMEOUT: return '⏰';
      case JobStatus.RETRYING: return '🔁';
      default: return '❓';
    }
  }

  private getStatusColor(status: JobStatus): number {
    switch (status) {
      case JobStatus.COMPLETED: return 0x00FF00;
      case JobStatus.RUNNING: case JobStatus.RETRYING: return 0x00AE86;
      case JobStatus.PENDING: return 0xFFFF00;
      case JobStatus.FAILED: case JobStatus.TIMEOUT: return 0xFF0000;
      case JobStatus.CANCELLED: return 0x808080;
      default: return 0x000000;
    }
  }

  private getHealthEmoji(status: string): string {
    switch (status) {
      case 'healthy': return '💚';
      case 'degraded': return '💛';
      case 'critical': return '❤️';
      default: return '❓';
    }
  }
}
```

### Register the JobCommand

```typescript
// src/commands/commandHandler.ts - Add to initializeCommands()
const jobCommand = new JobCommand(services, container.resolve(DI_TOKENS.IAsyncJobQueue));
this.registerCommand('job', jobCommand);
```

## Step 4: Register Slash Commands

Update your command registration script:

```typescript
// scripts/registerCommands.ts
import { JobCommand } from '../src/commands/JobCommand';

const commands = [
  // ... existing commands
  JobCommand.getSlashCommand()
];
```

## Step 5: Usage Examples

### Basic Job Execution

```typescript
// In any service or command
async executeAnalysisJob(interaction: CommandInteraction) {
  const jobQueue = container.resolve<IAsyncJobQueue>(DI_TOKENS.IAsyncJobQueue);
  
  const jobId = await jobQueue.enqueueJob(
    'member-activity-analysis',
    {
      guildId: interaction.guild!.id,
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-31'),
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
  
  await interaction.reply(`Analysis started! Job ID: ${jobId}`);
}
```

### Custom Job Handler

```typescript
// Create a custom handler
const customHandler: JobHandler<{ data: string }, { result: string }> = async (
  job,
  context,
  progressCallback
) => {
  await progressCallback({
    current: 0,
    total: 100,
    percentage: 0,
    message: 'Starting custom processing...'
  });

  // Your custom logic here
  const result = await processCustomData(job.payload.data);

  await progressCallback({
    current: 100,
    total: 100,
    percentage: 100,
    message: 'Custom processing completed!'
  });

  return { result };
};

// Register and use
jobQueue.registerHandler('custom-process', customHandler);

const jobId = await jobQueue.enqueueJob(
  'custom-process',
  { data: 'your-data' },
  { userId: 'user-id' }
);
```

### Monitoring Jobs

```typescript
// Set up comprehensive monitoring
jobQueue.on('jobCompleted', async (job, result) => {
  // Log successful completion
  console.log(`✅ Job ${job.id} completed successfully`);
  
  // Send notification to admin channel
  if (job.context.guildId) {
    const guild = await client.guilds.fetch(job.context.guildId);
    const adminChannel = guild.channels.cache.find(ch => ch.name === 'admin-logs');
    if (adminChannel?.isTextBased()) {
      await adminChannel.send(`Job ${job.type} completed for user <@${job.context.userId}>`);
    }
  }
});

jobQueue.on('jobFailed', async (job, error) => {
  // Log failure
  console.error(`❌ Job ${job.id} failed:`, error);
  
  // Alert administrators
  // Implementation depends on your alerting system
});
```

## Step 6: Environment Configuration

Add job queue configuration to your environment:

```env
# .env
# Job Queue Configuration
JOB_QUEUE_MAX_CONCURRENT=15
JOB_QUEUE_TIMEOUT=300000
JOB_QUEUE_ENABLE_CACHE=true
JOB_QUEUE_CACHE_TTL=1800000
JOB_QUEUE_WEBHOOK_URL=https://your-webhook-endpoint.com/jobs
```

```typescript
// src/config/env.ts
export const config = {
  // ... existing config
  
  // Job Queue settings
  JOB_QUEUE: {
    MAX_CONCURRENT: parseInt(process.env.JOB_QUEUE_MAX_CONCURRENT || '10'),
    TIMEOUT: parseInt(process.env.JOB_QUEUE_TIMEOUT || '300000'),
    ENABLE_CACHE: process.env.JOB_QUEUE_ENABLE_CACHE === 'true',
    CACHE_TTL: parseInt(process.env.JOB_QUEUE_CACHE_TTL || '3600000'),
    WEBHOOK_URL: process.env.JOB_QUEUE_WEBHOOK_URL
  }
};
```

## Step 7: Testing Integration

Create integration tests:

```typescript
// tests/integration/job-queue-integration.test.ts
describe('Job Queue Integration', () => {
  let container: DependencyContainer;
  let jobQueue: IAsyncJobQueue;

  beforeEach(async () => {
    // Set up test container
    container = createTestContainer();
    jobQueue = container.resolve<IAsyncJobQueue>(DI_TOKENS.IAsyncJobQueue);
  });

  test('should integrate with command system', async () => {
    const jobCommand = new JobCommand(mockServices, jobQueue);
    const interaction = createMockInteraction();
    
    await jobCommand.execute(interaction);
    
    expect(interaction.reply).toHaveBeenCalled();
  });

  test('should process jobs with Discord integration', async () => {
    const jobId = await jobQueue.enqueueJob(
      'member-activity-analysis',
      { guildId: 'test-guild' },
      { userId: 'test-user', interaction: mockInteraction }
    );

    const job = await waitForJobCompletion(jobQueue, jobId);
    expect(job.status).toBe(JobStatus.COMPLETED);
  });
});
```

## Best Practices for Integration

1. **Graceful Shutdown**: Always stop job processing during shutdown
2. **Error Handling**: Implement comprehensive error handling and alerting
3. **Resource Management**: Monitor memory usage and adjust configuration
4. **User Feedback**: Provide clear feedback about job status and progress
5. **Permissions**: Ensure proper permission checks for job management commands
6. **Monitoring**: Set up health checks and alerting for production use

## Troubleshooting Common Integration Issues

1. **DI Registration Errors**: Ensure all dependencies are registered before AsyncJobQueue
2. **Command Registration**: Make sure job commands are properly registered with Discord
3. **Permission Issues**: Verify bot has necessary permissions for progress updates
4. **Memory Leaks**: Monitor for unbounded growth in job queues or caches
5. **Discord Rate Limits**: Implement proper rate limiting in job handlers

This integration guide provides a complete setup for using the Async Job Queue system in your Discord bot project. The system is now ready for production use with comprehensive monitoring, error handling, and user-friendly commands.
