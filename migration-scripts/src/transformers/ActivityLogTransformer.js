// Activity Log Transformation
// Handles LowDB activity_logs → PostgreSQL activity_events + activity_event_participants transformation

import { v4 as uuidv4 } from 'uuid';

/**
 * Transforms LowDB activity logs to PostgreSQL normalized event structure
 */
export class ActivityLogTransformer {
  constructor(connectionPool, logger) {
    this.pool = connectionPool;
    this.logger = logger;
    this.userSessions = new Map(); // Track active sessions per user
    this.stats = {
      eventsProcessed: 0,
      participantsCreated: 0,
      sessionsCreated: 0,
      errors: 0,
      skipped: 0
    };
  }

  /**
   * Transform and migrate activity log data
   * @param {Array} lowdbActivityLogs - LowDB activity_logs array
   * @param {Object} lowdbLogMembers - LowDB log_members for participant data
   * @returns {Promise<Object>} Migration statistics
   */
  async transformActivityLogs(lowdbActivityLogs, lowdbLogMembers = {}) {
    this.logger.info('Starting activity logs transformation', {
      totalEvents: lowdbActivityLogs.length,
      totalMemberMappings: Object.keys(lowdbLogMembers).length
    });

    // Sort events by timestamp for proper session tracking
    const sortedLogs = this.sortEventsByTimestamp(lowdbActivityLogs);
    const errors = [];
    
    for (const logEntry of sortedLogs) {
      try {
        await this.transformSingleEvent(logEntry, lowdbLogMembers);
        this.stats.eventsProcessed++;
        
        if (this.stats.eventsProcessed % 1000 === 0) {
          this.logger.info('Activity log transformation progress', {
            processed: this.stats.eventsProcessed,
            errors: this.stats.errors,
            sessions: this.stats.sessionsCreated
          });
        }
      } catch (error) {
        this.stats.errors++;
        const errorDetails = {
          eventId: logEntry.id,
          userId: logEntry.userId,
          error: error.message,
          stack: error.stack
        };
        errors.push(errorDetails);
        this.logger.error('Failed to transform activity event', errorDetails);
      }
    }

    this.logger.info('Activity logs transformation completed', this.stats);
    return {
      stats: this.stats,
      errors
    };
  }

  /**
   * Transform single activity event
   * @param {Object} logEntry - Single log entry from LowDB
   * @param {Object} lowdbLogMembers - Member mappings
   */
  async transformSingleEvent(logEntry, lowdbLogMembers) {
    // Validate event data
    if (!this.validateEventData(logEntry)) {
      throw new Error(`Invalid event data: ${JSON.stringify(logEntry)}`);
    }

    await this.pool.transaction(async (client) => {
      // 1. Generate event ID and session tracking
      const eventId = uuidv4();
      const sessionId = this.getOrCreateSessionId(logEntry.userId, logEntry.eventType);
      
      // 2. Create activity event record
      await this.createActivityEventRecord(client, eventId, sessionId, logEntry);
      
      // 3. Create participant records
      const participants = lowdbLogMembers[logEntry.id] || [];
      await this.createParticipantRecords(client, eventId, participants, logEntry);
    });
  }

  /**
   * Create activity event record in PostgreSQL
   * @param {Object} client - Database client
   * @param {string} eventId - Generated UUID for event
   * @param {string} sessionId - Session UUID
   * @param {Object} logEntry - Log entry data
   */
  async createActivityEventRecord(client, eventId, sessionId, logEntry) {
    const eventTimestamp = new Date(logEntry.timestamp);
    const eventType = this.normalizeEventType(logEntry.eventType);
    const memberCount = parseInt(logEntry.membersCount) || 0;

    await client.query(`
      INSERT INTO activity_events (
        id,
        user_id,
        event_type,
        event_timestamp,
        channel_id,
        channel_name,
        member_count,
        session_id,
        event_source,
        additional_data,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      eventId,
      logEntry.userId,
      eventType,
      eventTimestamp,
      logEntry.channelId || null,
      this.sanitizeChannelName(logEntry.channelName),
      memberCount,
      sessionId,
      'lowdb_migration',
      JSON.stringify({
        originalId: logEntry.id,
        migrationTimestamp: new Date().toISOString()
      }),
      new Date()
    ]);

    this.logger.debug('Created activity event record', {
      eventId,
      userId: logEntry.userId,
      eventType,
      timestamp: eventTimestamp
    });
  }

  /**
   * Create participant records for event
   * @param {Object} client - Database client
   * @param {string} eventId - Event UUID
   * @param {Array} participants - Array of participant user IDs
   * @param {Object} logEntry - Original log entry for context
   */
  async createParticipantRecords(client, eventId, participants, logEntry) {
    if (!Array.isArray(participants) || participants.length === 0) {
      return;
    }

    // Filter valid Discord IDs
    const validParticipants = participants.filter(userId => this.isValidDiscordId(userId));
    
    if (validParticipants.length === 0) {
      this.logger.debug('No valid participants found for event', { eventId });
      return;
    }

    // Batch insert participants
    const values = validParticipants.map((participantId, index) => {
      const paramStart = index * 5 + 1;
      return `($${paramStart}, $${paramStart + 1}, $${paramStart + 2}, $${paramStart + 3}, $${paramStart + 4})`;
    }).join(', ');

    const params = [];
    validParticipants.forEach(participantId => {
      params.push(
        eventId,
        participantId,
        this.getParticipantState(participantId, logEntry),
        JSON.stringify({ migrationSource: 'lowdb' }),
        new Date()
      );
    });

    await client.query(`
      INSERT INTO activity_event_participants (
        event_id,
        participant_user_id,
        participant_state,
        additional_data,
        created_at
      )
      VALUES ${values}
      ON CONFLICT (event_id, participant_user_id) DO NOTHING
    `, params);

    this.stats.participantsCreated += validParticipants.length;
    
    this.logger.debug('Created participant records', {
      eventId,
      participantCount: validParticipants.length
    });
  }

  /**
   * Get or create session ID for user activity tracking
   * @param {string} userId - Discord user ID
   * @param {string} eventType - Event type (JOIN, LEAVE, etc.)
   * @returns {string} Session UUID
   */
  getOrCreateSessionId(userId, eventType) {
    const normalizedEventType = this.normalizeEventType(eventType);
    
    if (normalizedEventType === 'JOIN') {
      // Start new session
      const sessionId = uuidv4();
      this.userSessions.set(userId, sessionId);
      this.stats.sessionsCreated++;
      return sessionId;
    } else if (normalizedEventType === 'LEAVE' || normalizedEventType === 'DISCONNECT') {
      // End existing session or create new one if not exists
      const existingSession = this.userSessions.get(userId);
      if (existingSession) {
        this.userSessions.delete(userId);
        return existingSession;
      } else {
        // Create session for orphaned LEAVE event
        return uuidv4();
      }
    } else {
      // For MOVE, TIMEOUT, etc., use existing session or create new one
      let sessionId = this.userSessions.get(userId);
      if (!sessionId) {
        sessionId = uuidv4();
        this.userSessions.set(userId, sessionId);
        this.stats.sessionsCreated++;
      }
      return sessionId;
    }
  }

  /**
   * Normalize event type to match PostgreSQL enum
   * @param {string} eventType - Raw event type from LowDB
   * @returns {string} Normalized event type
   */
  normalizeEventType(eventType) {
    if (!eventType || typeof eventType !== 'string') {
      return 'UNKNOWN';
    }

    const normalized = eventType.toUpperCase().trim();
    const validTypes = ['JOIN', 'LEAVE', 'MOVE', 'DISCONNECT', 'TIMEOUT'];
    
    return validTypes.includes(normalized) ? normalized : 'UNKNOWN';
  }

  /**
   * Get participant state based on event context
   * @param {string} participantId - Participant user ID
   * @param {Object} logEntry - Event log entry
   * @returns {string} Participant state
   */
  getParticipantState(participantId, logEntry) {
    if (participantId === logEntry.userId) {
      return 'ACTIVE'; // The user who triggered the event
    }
    return 'PRESENT'; // Other participants in the channel
  }

  /**
   * Sort events by timestamp for proper session tracking
   * @param {Array} events - Array of event objects
   * @returns {Array} Sorted events
   */
  sortEventsByTimestamp(events) {
    return events.sort((a, b) => {
      const timestampA = parseInt(a.timestamp) || 0;
      const timestampB = parseInt(b.timestamp) || 0;
      return timestampA - timestampB;
    });
  }

  /**
   * Validate Discord ID format
   * @param {string} userId - User ID to validate
   * @returns {boolean} True if valid Discord ID
   */
  isValidDiscordId(userId) {
    return typeof userId === 'string' && /^[0-9]{17,20}$/.test(userId);
  }

  /**
   * Sanitize channel name for database storage
   * @param {string} channelName - Raw channel name
   * @returns {string} Sanitized channel name
   */
  sanitizeChannelName(channelName) {
    if (!channelName || typeof channelName !== 'string') {
      return 'Unknown Channel';
    }
    return channelName.trim().substring(0, 255) || 'Unknown Channel';
  }

  /**
   * Validate event data structure
   * @param {Object} logEntry - Event data to validate
   * @returns {boolean} True if valid
   */
  validateEventData(logEntry) {
    if (!logEntry || typeof logEntry !== 'object') {
      return false;
    }

    // Required fields
    if (!logEntry.id || !logEntry.userId || !logEntry.eventType || !logEntry.timestamp) {
      return false;
    }

    // Validate Discord ID
    if (!this.isValidDiscordId(logEntry.userId)) {
      return false;
    }

    // Validate timestamp
    const timestamp = parseInt(logEntry.timestamp);
    if (isNaN(timestamp) || timestamp < 0) {
      return false;
    }

    // Validate member count if present
    if (logEntry.membersCount !== undefined) {
      const memberCount = parseInt(logEntry.membersCount);
      if (isNaN(memberCount) || memberCount < 0) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get transformation statistics
   * @returns {Object} Current statistics
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.eventsProcessed / (this.stats.eventsProcessed + this.stats.errors) * 100,
      activeSessions: this.userSessions.size
    };
  }

  /**
   * Reset transformer state for new migration
   */
  reset() {
    this.userSessions.clear();
    this.stats = {
      eventsProcessed: 0,
      participantsCreated: 0,
      sessionsCreated: 0,
      errors: 0,
      skipped: 0
    };
  }

  /**
   * Validate activity logs data before transformation
   * @param {Array} lowdbActivityLogs - LowDB activity logs
   * @param {Object} lowdbLogMembers - LowDB log members
   * @returns {Array} Validation errors
   */
  validateData(lowdbActivityLogs, lowdbLogMembers = {}) {
    const errors = [];

    // Validate logs array
    if (!Array.isArray(lowdbActivityLogs)) {
      errors.push('Activity logs must be an array');
      return errors;
    }

    if (lowdbActivityLogs.length === 0) {
      errors.push('No activity logs found');
      return errors;
    }

    // Validate log members structure
    if (lowdbLogMembers && typeof lowdbLogMembers !== 'object') {
      errors.push('Log members must be an object');
    }

    // Check for duplicate event IDs
    const eventIds = new Set();
    for (const event of lowdbActivityLogs) {
      if (eventIds.has(event.id)) {
        errors.push(`Duplicate event ID found: ${event.id}`);
      }
      eventIds.add(event.id);

      // Validate individual event
      if (!this.validateEventData(event)) {
        errors.push(`Invalid event data for ID: ${event.id}`);
      }
    }

    return errors;
  }

  /**
   * Get activity logs migration summary
   * @param {Array} lowdbActivityLogs - LowDB activity logs
   * @returns {Object} Migration summary
   */
  getMigrationSummary(lowdbActivityLogs) {
    const summary = {
      totalEvents: lowdbActivityLogs.length,
      eventTypes: {},
      dateRange: { earliest: null, latest: null },
      uniqueUsers: new Set(),
      uniqueChannels: new Set(),
      estimatedSessions: 0
    };

    let earliestTimestamp = Infinity;
    let latestTimestamp = -Infinity;

    for (const event of lowdbActivityLogs) {
      // Count event types
      const eventType = this.normalizeEventType(event.eventType);
      summary.eventTypes[eventType] = (summary.eventTypes[eventType] || 0) + 1;

      // Track users and channels
      summary.uniqueUsers.add(event.userId);
      if (event.channelId) {
        summary.uniqueChannels.add(event.channelId);
      }

      // Track date range
      const timestamp = parseInt(event.timestamp);
      if (timestamp < earliestTimestamp) earliestTimestamp = timestamp;
      if (timestamp > latestTimestamp) latestTimestamp = timestamp;
    }

    // Convert timestamps to dates
    if (earliestTimestamp !== Infinity) {
      summary.dateRange.earliest = new Date(earliestTimestamp);
    }
    if (latestTimestamp !== -Infinity) {
      summary.dateRange.latest = new Date(latestTimestamp);
    }

    // Estimate sessions (rough approximation based on JOIN events)
    summary.estimatedSessions = summary.eventTypes['JOIN'] || 0;

    // Convert sets to counts
    summary.uniqueUsers = summary.uniqueUsers.size;
    summary.uniqueChannels = summary.uniqueChannels.size;

    return summary;
  }
}

export default ActivityLogTransformer;