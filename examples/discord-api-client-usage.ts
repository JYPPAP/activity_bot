// examples/discord-api-client-usage.ts - Usage Examples for Discord API Client Wrapper

import { DiscordAPIClient } from '../src/utils/DiscordAPIClient';
import { DiscordAPIClientConfig } from '../src/interfaces/IDiscordAPIClient';

/**
 * Basic Configuration Example
 */
function createBasicClient(): DiscordAPIClient {
  const config: DiscordAPIClientConfig = {
    token: process.env.DISCORD_BOT_TOKEN || 'your-bot-token',
    baseURL: 'https://discord.com/api/v10',
    
    // Optional: Connection pool settings
    connectionPool: {
      maxConnections: 50,
      maxConnectionsPerHost: 10,
      connectionTimeout: 5000,
      enableKeepAlive: true
    },
    
    // Optional: Request queue settings  
    requestQueue: {
      maxQueueSize: 1000,
      processingInterval: 100,
      batchTimeout: 100,
      batchSize: 10
    },
    
    // Optional: Retry settings
    retry: {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      jitter: true,
      retryableStatusCodes: [429, 500, 502, 503, 504]
    },
    
    // Optional: Circuit breaker settings
    circuitBreaker: {
      enable: true,
      failureThreshold: 5,
      successThreshold: 3,
      resetTimeout: 60000
    },
    
    // Optional: Metrics settings
    metrics: {
      enableMetrics: true,
      metricsInterval: 1000
    }
  };

  return new DiscordAPIClient(config);
}

/**
 * High-Performance Configuration Example
 */
function createHighPerformanceClient(): DiscordAPIClient {
  const config: DiscordAPIClientConfig = {
    token: process.env.DISCORD_BOT_TOKEN || 'your-bot-token',
    baseURL: 'https://discord.com/api/v10',
    
    connectionPool: {
      maxConnections: 100,          // Higher connection limit
      maxConnectionsPerHost: 20,    // More connections per host
      connectionTimeout: 3000,      // Faster timeout
      requestTimeout: 15000,        // Shorter request timeout
      enableKeepAlive: true,
      keepAliveTimeout: 10000,
      maxIdleTime: 30000,
      healthCheckInterval: 15000
    },
    
    requestQueue: {
      maxQueueSize: 5000,          // Larger queue
      processingInterval: 50,       // Faster processing
      batchTimeout: 50,            // Quicker batching
      batchSize: 20                // Larger batches
    },
    
    retry: {
      maxRetries: 5,
      baseDelay: 500,              // Faster initial retry
      maxDelay: 20000,
      exponentialBase: 1.5,        // Gentler backoff
      jitter: true
    },
    
    circuitBreaker: {
      enable: true,
      failureThreshold: 10,        // More tolerant
      successThreshold: 5,
      resetTimeout: 30000,         // Faster recovery
      monitoringPeriod: 30000
    }
  };

  return new DiscordAPIClient(config);
}

/**
 * Example 1: Basic Message Operations
 */
async function messageOperationsExample() {
  const client = createBasicClient();
  
  try {
    // Send a simple message
    const messageResponse = await client.post('/channels/123456789/messages', {
      content: 'Hello, Discord!',
      embeds: [{
        title: 'Welcome',
        description: 'This message was sent using the Discord API client wrapper',
        color: 0x00ff00,
        timestamp: new Date().toISOString()
      }]
    });

    if (messageResponse.success) {
      console.log('Message sent successfully:', messageResponse.data);
      
      // Edit the message
      const editResponse = await client.patch(`/channels/123456789/messages/${messageResponse.data.id}`, {
        content: 'Hello, Discord! (edited)',
        embeds: messageResponse.data.embeds
      });
      
      if (editResponse.success) {
        console.log('Message edited successfully');
      }
      
      // Delete the message after 5 seconds
      setTimeout(async () => {
        await client.delete(`/channels/123456789/messages/${messageResponse.data.id}`);
        console.log('Message deleted');
      }, 5000);
    }
  } catch (error) {
    console.error('Message operation failed:', error);
  } finally {
    await client.shutdown();
  }
}

/**
 * Example 2: Bulk Operations with Batching
 */
async function bulkOperationsExample() {
  const client = createHighPerformanceClient();
  
  try {
    // Fetch multiple channels in a batch
    const channelIds = ['123456789', '987654321', '555666777'];
    const batchRequest = {
      requests: channelIds.map(channelId => ({
        method: 'GET',
        endpoint: `/channels/${channelId}`
      })),
      priority: 'high'
    };

    const batchResponse = await client.batchRequest(batchRequest);
    console.log(`Fetched ${batchResponse.successfulRequests}/${batchResponse.totalRequests} channels`);
    
    // Process successful responses
    batchResponse.results.forEach((result, index) => {
      if (result.success) {
        console.log(`Channel ${channelIds[index]}:`, result.data.name);
      } else {
        console.error(`Failed to fetch channel ${channelIds[index]}:`, result.error?.message);
      }
    });
    
  } catch (error) {
    console.error('Bulk operations failed:', error);
  } finally {
    await client.shutdown();
  }
}

/**
 * Example 3: Priority-based Request Handling
 */
async function priorityRequestsExample() {
  const client = createBasicClient();
  
  try {
    // Send requests with different priorities
    const requests = [
      client.get('/gateway', { priority: 'critical' }),
      client.get('/users/@me', { priority: 'high' }),
      client.get('/applications/@me', { priority: 'normal' }),
      client.get('/channels/123456789', { priority: 'low' })
    ];
    
    const responses = await Promise.all(requests);
    responses.forEach((response, index) => {
      console.log(`Request ${index + 1} completed:`, response.success);
    });
    
  } catch (error) {
    console.error('Priority requests failed:', error);
  } finally {
    await client.shutdown();
  }
}

/**
 * Example 4: Monitoring and Health Checks
 */
async function monitoringExample() {
  const client = createBasicClient();
  
  // Set up event listeners for monitoring
  client.on('circuitBreakerOpen', (state) => {
    console.warn('Circuit breaker opened:', state);
  });
  
  client.on('circuitBreakerClosed', (state) => {
    console.log('Circuit breaker closed:', state);
  });
  
  client.on('queueFull', (queueSize) => {
    console.warn('Request queue is full:', queueSize);
  });
  
  client.on('metricsUpdated', (metrics) => {
    if (metrics.errorRate > 10) {
      console.warn('High error rate detected:', metrics.errorRate + '%');
    }
  });
  
  try {
    // Make some requests
    await Promise.all([
      client.get('/gateway'),
      client.get('/users/@me'),
      client.get('/applications/@me')
    ]);
    
    // Check system health
    const health = await client.healthCheck();
    console.log('System health:', {
      isHealthy: health.isHealthy,
      responseTime: health.responseTime + 'ms',
      circuitBreakerState: health.circuitBreakerState,
      activeConnections: health.connectionPoolStats?.activeConnections,
      queuedRequests: health.queueStats?.queuedRequests
    });
    
    // Get detailed metrics
    const metrics = client.getMetrics();
    console.log('Performance metrics:', {
      totalRequests: metrics.totalRequests,
      successRate: ((metrics.successfulRequests / metrics.totalRequests) * 100).toFixed(2) + '%',
      averageResponseTime: metrics.averageResponseTime + 'ms',
      throughput: metrics.throughputPerSecond + ' req/s'
    });
    
    // Get detailed system status
    const status = client.getDetailedStatus();
    console.log('Connection pool status:', status.connectionPool.summary);
    console.log('Request queue status:', status.requestQueue.statistics);
    
  } catch (error) {
    console.error('Monitoring example failed:', error);
  } finally {
    await client.shutdown();
  }
}

/**
 * Example 5: Error Handling and Recovery
 */
async function errorHandlingExample() {
  const client = createBasicClient();
  
  try {
    // Attempt requests that might fail
    const responses = await Promise.allSettled([
      client.get('/invalid-endpoint'),
      client.get('/channels/invalid-id'),
      client.post('/channels/123456789/messages', { invalid: 'data' })
    ]);
    
    responses.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (result.value.success) {
          console.log(`Request ${index + 1} succeeded`);
        } else {
          console.log(`Request ${index + 1} failed:`, result.value.error?.message);
        }
      } else {
        console.log(`Request ${index + 1} rejected:`, result.reason);
      }
    });
    
    // Check circuit breaker state after failures
    const circuitBreakerState = client.getCircuitBreakerState();
    console.log('Circuit breaker state:', circuitBreakerState);
    
  } catch (error) {
    console.error('Error handling example failed:', error);
  } finally {
    await client.shutdown();
  }
}

/**
 * Example 6: Real-time Bot Application
 */
async function botApplicationExample() {
  const client = createHighPerformanceClient();
  
  try {
    // Simulate a bot handling multiple concurrent operations
    const botOperations = [
      // Fetch guild information
      client.get('/guilds/123456789'),
      
      // Get guild members
      client.get('/guilds/123456789/members?limit=1000'),
      
      // Send welcome messages to multiple channels
      ...Array.from({ length: 5 }, (_, i) => 
        client.post(`/channels/channel${i}/messages`, {
          content: `Welcome to the server! #${i + 1}`,
          priority: 'normal'
        })
      ),
      
      // Update bot presence
      client.patch('/applications/@me', {
        description: 'Active Discord bot using API wrapper'
      }, { priority: 'low' })
    ];
    
    console.log('Starting bot operations...');
    const startTime = Date.now();
    
    const results = await Promise.allSettled(botOperations);
    const endTime = Date.now();
    
    const successful = results.filter(r => 
      r.status === 'fulfilled' && r.value.success
    ).length;
    
    console.log(`Bot operations completed: ${successful}/${results.length} successful`);
    console.log(`Total time: ${endTime - startTime}ms`);
    
    // Get final metrics
    const finalMetrics = client.getMetrics();
    console.log('Final bot metrics:', {
      totalRequests: finalMetrics.totalRequests,
      throughput: finalMetrics.throughputPerSecond,
      errorRate: finalMetrics.errorRate
    });
    
  } catch (error) {
    console.error('Bot application example failed:', error);
  } finally {
    await client.shutdown();
  }
}

/**
 * Run examples
 */
async function runExamples() {
  console.log('=== Discord API Client Wrapper Examples ===\n');
  
  try {
    console.log('1. Message Operations Example');
    await messageOperationsExample();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('\n2. Bulk Operations Example');
    await bulkOperationsExample();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('\n3. Priority Requests Example');
    await priorityRequestsExample();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('\n4. Monitoring Example');
    await monitoringExample();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('\n5. Error Handling Example');
    await errorHandlingExample();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('\n6. Bot Application Example');
    await botApplicationExample();
    
  } catch (error) {
    console.error('Examples failed:', error);
  }
  
  console.log('\n=== Examples completed ===');
}

// Export functions for individual testing
export {
  createBasicClient,
  createHighPerformanceClient,
  messageOperationsExample,
  bulkOperationsExample,
  priorityRequestsExample,
  monitoringExample,
  errorHandlingExample,
  botApplicationExample,
  runExamples
};

// Run examples if this file is executed directly
if (require.main === module) {
  runExamples().catch(console.error);
}