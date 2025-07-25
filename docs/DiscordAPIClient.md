# Discord API Client Wrapper

A comprehensive Discord API client wrapper with advanced features including connection pooling, request queuing, batching, automatic retry with jitter, circuit breaker pattern, and performance metrics collection.

## Features

- **Connection Pooling**: Efficient HTTP connection management with health checks and automatic cleanup
- **Request Queuing & Batching**: Priority-based request queuing with intelligent batching for bulk operations
- **Automatic Retry with Jitter**: Intelligent retry logic with exponential backoff and jitter to prevent thundering herd
- **Circuit Breaker Pattern**: Automatic failure detection and recovery to prevent cascade failures
- **Performance Metrics**: Comprehensive metrics collection with real-time monitoring and alerting
- **Type Safety**: Full TypeScript support with comprehensive interfaces
- **Event-Driven Architecture**: Rich event system for monitoring and debugging

## Installation

```bash
npm install
```

## Quick Start

```typescript
import { DiscordAPIClient } from './src/utils/DiscordAPIClient';

const client = new DiscordAPIClient({
  token: 'your-bot-token',
  baseURL: 'https://discord.com/api/v10'
});

// Send a message
const response = await client.post('/channels/123456789/messages', {
  content: 'Hello, Discord!'
});

console.log('Message sent:', response.success);

// Clean up
await client.shutdown();
```

## Configuration

### Basic Configuration

```typescript
const config = {
  token: 'your-bot-token',
  baseURL: 'https://discord.com/api/v10'
};
```

### Advanced Configuration

```typescript
const config = {
  token: 'your-bot-token',
  baseURL: 'https://discord.com/api/v10',
  
  // Connection Pool Settings
  connectionPool: {
    maxConnections: 50,
    maxConnectionsPerHost: 10,
    connectionTimeout: 5000,
    enableKeepAlive: true,
    healthCheckInterval: 30000
  },
  
  // Request Queue Settings
  requestQueue: {
    maxQueueSize: 1000,
    processingInterval: 100,
    batchTimeout: 100,
    batchSize: 10
  },
  
  // Retry Settings
  retry: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    jitter: true,
    retryableStatusCodes: [429, 500, 502, 503, 504]
  },
  
  // Circuit Breaker Settings
  circuitBreaker: {
    enable: true,
    failureThreshold: 5,
    successThreshold: 3,
    resetTimeout: 60000
  },
  
  // Metrics Settings
  metrics: {
    enableMetrics: true,
    metricsInterval: 1000
  }
};
```

## API Reference

### HTTP Methods

#### `get<T>(endpoint: string, config?: Partial<DiscordAPIRequest>): Promise<DiscordAPIResponse<T>>`
Perform a GET request.

```typescript
const channel = await client.get('/channels/123456789');
```

#### `post<T>(endpoint: string, data?: any, config?: Partial<DiscordAPIRequest>): Promise<DiscordAPIResponse<T>>`
Perform a POST request.

```typescript
const message = await client.post('/channels/123456789/messages', {
  content: 'Hello, World!'
});
```

#### `put<T>(endpoint: string, data?: any, config?: Partial<DiscordAPIRequest>): Promise<DiscordAPIResponse<T>>`
Perform a PUT request.

#### `patch<T>(endpoint: string, data?: any, config?: Partial<DiscordAPIRequest>): Promise<DiscordAPIResponse<T>>`
Perform a PATCH request.

#### `delete<T>(endpoint: string, config?: Partial<DiscordAPIRequest>): Promise<DiscordAPIResponse<T>>`
Perform a DELETE request.

### Batch Operations

#### `batchRequest<T>(batch: BatchRequest): Promise<BatchResponse<T>>`
Execute multiple requests in a batch.

```typescript
const batchResponse = await client.batchRequest({
  requests: [
    { method: 'GET', endpoint: '/channels/1' },
    { method: 'GET', endpoint: '/channels/2' },
    { method: 'GET', endpoint: '/channels/3' }
  ],
  priority: 'normal'
});
```

### Monitoring & Health

#### `getMetrics(): PerformanceMetrics`
Get current performance metrics.

```typescript
const metrics = client.getMetrics();
console.log('Total requests:', metrics.totalRequests);
console.log('Error rate:', metrics.errorRate + '%');
console.log('Average response time:', metrics.averageResponseTime + 'ms');
```

#### `healthCheck(): Promise<HealthStatus>`
Perform a comprehensive health check.

```typescript
const health = await client.healthCheck();
console.log('System healthy:', health.isHealthy);
console.log('Response time:', health.responseTime + 'ms');
```

#### `getCircuitBreakerState(): CircuitBreakerState`
Get current circuit breaker state.

```typescript
const state = client.getCircuitBreakerState();
console.log('Circuit breaker state:', state.state); // 'closed', 'open', or 'half-open'
```

#### `getDetailedStatus()`
Get comprehensive system status.

```typescript
const status = client.getDetailedStatus();
console.log('Connection pool:', status.connectionPool);
console.log('Request queue:', status.requestQueue);
console.log('Circuit breaker:', status.circuitBreaker);
```

## Request Configuration

### Priority Levels

Requests can be assigned priority levels:

- `critical`: Highest priority, bypasses queue
- `high`: High priority
- `normal`: Default priority
- `low`: Lowest priority

```typescript
await client.get('/gateway', { priority: 'critical' });
```

### Request Options

```typescript
const options = {
  priority: 'high',
  timeout: 10000,
  retryable: true,
  batchable: false,
  headers: {
    'Custom-Header': 'value'
  }
};

await client.get('/endpoint', options);
```

## Event Handling

The client emits various events for monitoring:

```typescript
// Connection events
client.on('connectionCreated', (connection) => {
  console.log('New connection created:', connection.id);
});

client.on('connectionRemoved', (connectionId) => {
  console.log('Connection removed:', connectionId);
});

// Queue events
client.on('requestQueued', (requestId, priority) => {
  console.log('Request queued:', requestId, priority);
});

client.on('queueFull', (queueSize) => {
  console.warn('Queue is full:', queueSize);
});

// Circuit breaker events
client.on('circuitBreakerOpen', (state) => {
  console.warn('Circuit breaker opened:', state);
});

client.on('circuitBreakerClosed', (state) => {
  console.log('Circuit breaker closed:', state);
});

// Retry events
client.on('retryAttempt', (requestId, attempt, decision) => {
  console.log('Retry attempt:', requestId, attempt.attemptNumber);
});

// Metrics events
client.on('metricsUpdated', (metrics) => {
  if (metrics.errorRate > 10) {
    console.warn('High error rate:', metrics.errorRate + '%');
  }
});
```

## Performance Optimization

### High-Performance Configuration

For high-throughput applications:

```typescript
const client = new DiscordAPIClient({
  token: 'your-bot-token',
  connectionPool: {
    maxConnections: 100,
    maxConnectionsPerHost: 20,
    connectionTimeout: 3000
  },
  requestQueue: {
    maxQueueSize: 5000,
    processingInterval: 50,
    batchSize: 20
  },
  retry: {
    maxRetries: 5,
    baseDelay: 500,
    exponentialBase: 1.5
  }
});
```

### Batch Operations for Bulk Requests

Use batching for multiple related requests:

```typescript
// Instead of multiple individual requests
const responses = await Promise.all([
  client.get('/channels/1'),
  client.get('/channels/2'),
  client.get('/channels/3')
]);

// Use batch request
const batchResponse = await client.batchRequest({
  requests: [
    { method: 'GET', endpoint: '/channels/1' },
    { method: 'GET', endpoint: '/channels/2' },
    { method: 'GET', endpoint: '/channels/3' }
  ]
});
```

## Error Handling

### Response Structure

All responses follow a consistent structure:

```typescript
interface DiscordAPIResponse<T> {
  success: boolean;
  data?: T;
  error?: Error;
  status?: number;
  headers?: Record<string, string>;
  metadata: {
    requestId: string;
    executionTime: number;
    retryCount: number;
    fromCache: boolean;
  };
}
```

### Error Handling Patterns

```typescript
try {
  const response = await client.get('/channels/123456789');
  
  if (response.success) {
    console.log('Channel data:', response.data);
  } else {
    console.error('Request failed:', response.error?.message);
  }
} catch (error) {
  console.error('Network error:', error.message);
}
```

### Circuit Breaker Protection

The circuit breaker automatically protects against cascading failures:

- **Closed**: Normal operation, requests pass through
- **Open**: Failures detected, requests are rejected immediately
- **Half-Open**: Testing recovery, limited requests allowed

## Monitoring & Observability

### Metrics Collection

The client automatically collects comprehensive metrics:

```typescript
const metrics = client.getMetrics();

console.log('Performance Metrics:');
console.log('- Total requests:', metrics.totalRequests);
console.log('- Success rate:', (metrics.successfulRequests / metrics.totalRequests * 100).toFixed(2) + '%');
console.log('- Average response time:', metrics.averageResponseTime + 'ms');
console.log('- P95 response time:', metrics.p95ResponseTime + 'ms');
console.log('- Throughput:', metrics.throughputPerSecond + ' req/s');
console.log('- Error rate:', metrics.errorRate + '%');
console.log('- Cache hit rate:', metrics.cacheHitRate + '%');
```

### Health Monitoring

```typescript
const health = await client.healthCheck();

if (!health.isHealthy) {
  console.error('System unhealthy:', health.error);
  
  // Check specific components
  if (health.circuitBreakerState === 'open') {
    console.error('Circuit breaker is open');
  }
  
  if (health.queueStats && health.queueStats.queuedRequests > 1000) {
    console.warn('High queue backlog');
  }
}
```

## Testing

Run the comprehensive test suite:

```bash
npm test
```

The test suite includes:
- Unit tests for all components
- Integration tests
- Load testing scenarios
- Error handling validation
- Performance benchmarks

## Examples

See `examples/discord-api-client-usage.ts` for comprehensive usage examples including:

1. Basic message operations
2. Bulk operations with batching
3. Priority-based request handling
4. Monitoring and health checks
5. Error handling and recovery
6. Real-time bot applications

## Best Practices

### 1. Resource Management

Always clean up resources:

```typescript
const client = new DiscordAPIClient(config);

try {
  // Your application logic
  await client.get('/channels/123456789');
} finally {
  // Always shutdown the client
  await client.shutdown();
}
```

### 2. Error Handling

Implement proper error handling:

```typescript
const response = await client.post('/channels/123456789/messages', data);

if (!response.success) {
  if (response.status === 429) {
    console.log('Rate limited, will retry automatically');
  } else if (response.status === 403) {
    console.error('Insufficient permissions');
  } else {
    console.error('Unexpected error:', response.error?.message);
  }
}
```

### 3. Monitoring

Set up monitoring for production:

```typescript
client.on('circuitBreakerOpen', () => {
  // Alert ops team
  console.error('ALERT: Circuit breaker opened');
});

client.on('metricsUpdated', (metrics) => {
  if (metrics.errorRate > 5) {
    console.warn('WARNING: High error rate detected');
  }
});
```

### 4. Performance Optimization

Use appropriate configurations for your use case:

```typescript
// For high-throughput bots
const config = {
  connectionPool: { maxConnections: 100 },
  requestQueue: { batchSize: 20 },
  // ...
};

// For simple bots
const config = {
  connectionPool: { maxConnections: 10 },
  requestQueue: { batchSize: 5 },
  // ...
};
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - see LICENSE file for details.