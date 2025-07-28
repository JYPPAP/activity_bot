// src/utils/ConnectionPool.ts - HTTP Connection Pool Manager

import https from 'https';
import http from 'http';
import { EventEmitter } from 'events';
import { URL } from 'url';

// Connection pool interfaces
interface PooledConnection {
  id: string;
  agent: https.Agent | http.Agent;
  host: string;
  port: number;
  protocol: 'http:' | 'https:';
  created: number;
  lastUsed: number;
  activeRequests: number;
  totalRequests: number;
  isHealthy: boolean;
  errors: number;
}

interface ConnectionPoolOptions {
  maxConnections: number;
  maxConnectionsPerHost: number;
  connectionTimeout: number;
  requestTimeout: number;
  keepAliveTimeout: number;
  enableKeepAlive: boolean;
  enableHttp2: boolean;
  maxIdleTime: number;
  healthCheckInterval: number;
  retryDelay: number;
  maxRetries: number;
}

interface PoolStatistics {
  total: number;
  active: number;
  idle: number;
  pending: number;
  healthy: number;
  unhealthy: number;
  averageAge: number;
  totalRequests: number;
  totalErrors: number;
}

export class ConnectionPool extends EventEmitter {
  private connections: Map<string, PooledConnection> = new Map();
  private pendingConnections: Map<string, Promise<PooledConnection>> = new Map();
  private hostConnections: Map<string, Set<string>> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  constructor(private options: ConnectionPoolOptions) {
    super();
    this.startCleanupInterval();
    this.startHealthCheckInterval();
  }

  /**
   * Get or create a connection for the specified URL
   */
  async getConnection(url: string): Promise<PooledConnection> {
    if (this.isShuttingDown) {
      throw new Error('Connection pool is shutting down');
    }

    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname;
    const port = parseInt(parsedUrl.port) || (parsedUrl.protocol === 'https:' ? 443 : 80);
    const protocol = parsedUrl.protocol as 'http:' | 'https:';
    const connectionKey = `${protocol}//${host}:${port}`;

    // Check for existing healthy connection
    const existingConnection = this.findHealthyConnection(connectionKey);
    if (existingConnection) {
      existingConnection.lastUsed = Date.now();
      existingConnection.activeRequests++;
      return existingConnection;
    }

    // Check if we're already creating a connection for this host
    const pendingConnection = this.pendingConnections.get(connectionKey);
    if (pendingConnection) {
      return await pendingConnection;
    }

    // Create new connection
    const connectionPromise = this.createConnection(host, port, protocol, connectionKey);
    this.pendingConnections.set(connectionKey, connectionPromise);

    try {
      const connection = await connectionPromise;
      this.pendingConnections.delete(connectionKey);
      return connection;
    } catch (error) {
      this.pendingConnections.delete(connectionKey);
      throw error;
    }
  }

  /**
   * Release a connection back to the pool
   */
  releaseConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.activeRequests = Math.max(0, connection.activeRequests - 1);
      connection.lastUsed = Date.now();
    }
  }

  /**
   * Remove a connection from the pool
   */
  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    // Update host connection tracking
    const hostKey = `${connection.protocol}//${connection.host}:${connection.port}`;
    const hostConnections = this.hostConnections.get(hostKey);
    if (hostConnections) {
      hostConnections.delete(connectionId);
      if (hostConnections.size === 0) {
        this.hostConnections.delete(hostKey);
      }
    }

    // Destroy the agent
    connection.agent.destroy();

    // Remove from pool
    this.connections.delete(connectionId);

    this.emit('connectionRemoved', connectionId);
  }

  /**
   * Get pool statistics
   */
  getStatistics(): PoolStatistics {
    const connections = Array.from(this.connections.values());
    const now = Date.now();

    const active = connections.filter(c => c.activeRequests > 0).length;
    const idle = connections.filter(c => c.activeRequests === 0).length;
    const healthy = connections.filter(c => c.isHealthy).length;
    const unhealthy = connections.filter(c => !c.isHealthy).length;
    
    const totalRequests = connections.reduce((sum, c) => sum + c.totalRequests, 0);
    const totalErrors = connections.reduce((sum, c) => sum + c.errors, 0);
    const averageAge = connections.length > 0 
      ? connections.reduce((sum, c) => sum + (now - c.created), 0) / connections.length
      : 0;

    return {
      total: connections.length,
      active,
      idle,
      pending: this.pendingConnections.size,
      healthy,
      unhealthy,
      averageAge: Math.round(averageAge / 1000), // Convert to seconds
      totalRequests,
      totalErrors
    };
  }

  /**
   * Close idle connections
   */
  closeIdleConnections(): number {
    const now = Date.now();
    const connectionsToRemove: string[] = [];

    for (const [id, connection] of this.connections) {
      const idleTime = now - connection.lastUsed;
      if (connection.activeRequests === 0 && idleTime > this.options.maxIdleTime) {
        connectionsToRemove.push(id);
      }
    }

    connectionsToRemove.forEach(id => this.removeConnection(id));
    return connectionsToRemove.length;
  }

  /**
   * Health check all connections
   */
  async performHealthCheck(): Promise<void> {
    const connections = Array.from(this.connections.values());
    const healthCheckPromises = connections.map(connection => 
      this.checkConnectionHealth(connection)
    );

    await Promise.allSettled(healthCheckPromises);
  }

  /**
   * Shutdown the connection pool
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Clear intervals
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Wait for pending connections to complete or timeout
    const pendingPromises = Array.from(this.pendingConnections.values());
    if (pendingPromises.length > 0) {
      await Promise.allSettled(pendingPromises.map(p => 
        Promise.race([p, this.timeout(5000)])
      ));
    }

    // Close all connections
    const connectionIds = Array.from(this.connections.keys());
    connectionIds.forEach(id => this.removeConnection(id));

    this.emit('shutdown');
  }

  /**
   * Create a new connection
   */
  private async createConnection(
    host: string, 
    port: number, 
    protocol: 'http:' | 'https:', 
    connectionKey: string
  ): Promise<PooledConnection> {
    // Check connection limits
    const hostConnections = this.hostConnections.get(connectionKey) || new Set();
    if (hostConnections.size >= this.options.maxConnectionsPerHost) {
      throw new Error(`Maximum connections per host reached for ${host}:${port}`);
    }

    if (this.connections.size >= this.options.maxConnections) {
      // Try to close idle connections first
      const closedConnections = this.closeIdleConnections();
      if (closedConnections === 0 && this.connections.size >= this.options.maxConnections) {
        throw new Error('Maximum total connections reached');
      }
    }

    const connectionId = `${connectionKey}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create appropriate agent
    const agentOptions = {
      keepAlive: this.options.enableKeepAlive,
      keepAliveMsecs: this.options.keepAliveTimeout,
      maxSockets: this.options.maxConnectionsPerHost,
      maxFreeSockets: Math.floor(this.options.maxConnectionsPerHost / 2),
      timeout: this.options.connectionTimeout,
      freeSocketTimeout: this.options.maxIdleTime,
    };

    const agent = protocol === 'https:' 
      ? new https.Agent(agentOptions)
      : new http.Agent(agentOptions);

    const connection: PooledConnection = {
      id: connectionId,
      agent,
      host,
      port,
      protocol,
      created: Date.now(),
      lastUsed: Date.now(),
      activeRequests: 1, // Start with 1 since this request will use it
      totalRequests: 0,
      isHealthy: true,
      errors: 0
    };

    // Add to tracking maps
    this.connections.set(connectionId, connection);
    if (!this.hostConnections.has(connectionKey)) {
      this.hostConnections.set(connectionKey, new Set());
    }
    this.hostConnections.get(connectionKey)!.add(connectionId);

    // Test the connection
    try {
      await this.testConnection(connection);
      this.emit('connectionCreated', connection);
      return connection;
    } catch (error) {
      this.removeConnection(connectionId);
      throw error;
    }
  }

  /**
   * Find a healthy connection for the given key
   */
  private findHealthyConnection(connectionKey: string): PooledConnection | null {
    const hostConnections = this.hostConnections.get(connectionKey);
    if (!hostConnections) return null;

    for (const connectionId of hostConnections) {
      const connection = this.connections.get(connectionId);
      if (connection && connection.isHealthy && connection.activeRequests < this.options.maxConnectionsPerHost) {
        return connection;
      }
    }

    return null;
  }

  /**
   * Test connection health
   */
  private async testConnection(connection: PooledConnection): Promise<void> {
    return new Promise((resolve, reject) => {
      const testUrl = `${connection.protocol}//${connection.host}:${connection.port}/`;
      const request = (connection.protocol === 'https:' ? https : http).request(
        testUrl,
        {
          method: 'HEAD',
          timeout: this.options.connectionTimeout,
          agent: connection.agent
        },
        (response) => {
          response.on('data', () => {}); // Consume response
          resolve();
        }
      );

      request.on('error', (error) => {
        connection.errors++;
        connection.isHealthy = false;
        reject(error);
      });

      request.on('timeout', () => {
        request.destroy();
        connection.errors++;
        connection.isHealthy = false;
        reject(new Error('Connection test timeout'));
      });

      request.end();
    });
  }

  /**
   * Check individual connection health
   */
  private async checkConnectionHealth(connection: PooledConnection): Promise<void> {
    try {
      await this.testConnection(connection);
      connection.isHealthy = true;
    } catch (error) {
      connection.isHealthy = false;
      this.emit('connectionUnhealthy', connection.id, error);
      
      // Remove unhealthy connections after too many errors
      if (connection.errors > this.options.maxRetries) {
        this.removeConnection(connection.id);
      }
    }
  }

  /**
   * Start cleanup interval for idle connections
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      const closedConnections = this.closeIdleConnections();
      if (closedConnections > 0) {
        this.emit('idleConnectionsClosed', closedConnections);
      }
    }, Math.max(this.options.maxIdleTime / 4, 30000)); // Run cleanup every quarter of max idle time, min 30s
  }

  /**
   * Start health check interval
   */
  private startHealthCheckInterval(): void {
    if (this.options.healthCheckInterval > 0) {
      this.healthCheckInterval = setInterval(() => {
        this.performHealthCheck().catch(error => {
          this.emit('healthCheckError', error);
        });
      }, this.options.healthCheckInterval);
    }
  }

  /**
   * Utility method for timeout promises
   */
  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), ms);
    });
  }

  /**
   * Get connection by ID
   */
  getConnectionById(connectionId: string): PooledConnection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Get all connections for a host
   */
  getConnectionsForHost(host: string, port: number, protocol: 'http:' | 'https:'): PooledConnection[] {
    const connectionKey = `${protocol}//${host}:${port}`;
    const hostConnections = this.hostConnections.get(connectionKey);
    if (!hostConnections) return [];

    return Array.from(hostConnections)
      .map(id => this.connections.get(id))
      .filter((conn): conn is PooledConnection => conn !== undefined);
  }

  /**
   * Force refresh all connections
   */
  async refreshAllConnections(): Promise<void> {
    const allConnections = Array.from(this.connections.keys());
    const refreshPromises = allConnections.map(async (connectionId) => {
      try {
        const connection = this.connections.get(connectionId);
        if (connection) {
          await this.checkConnectionHealth(connection);
        }
      } catch (error) {
        this.emit('connectionRefreshError', connectionId, error);
      }
    });

    await Promise.allSettled(refreshPromises);
  }

  /**
   * Get detailed connection information
   */
  getDetailedStats(): {
    connections: Array<{
      id: string;
      host: string;
      port: number;
      protocol: string;
      age: number;
      lastUsed: number;
      activeRequests: number;
      totalRequests: number;
      errors: number;
      isHealthy: boolean;
    }>;
    summary: PoolStatistics;
  } {
    const now = Date.now();
    const connections = Array.from(this.connections.values()).map(conn => ({
      id: conn.id,
      host: conn.host,
      port: conn.port,
      protocol: conn.protocol,
      age: Math.round((now - conn.created) / 1000),
      lastUsed: Math.round((now - conn.lastUsed) / 1000),
      activeRequests: conn.activeRequests,
      totalRequests: conn.totalRequests,
      errors: conn.errors,
      isHealthy: conn.isHealthy
    }));

    return {
      connections,
      summary: this.getStatistics()
    };
  }
}