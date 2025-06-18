# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm start` - Start the Discord bot
- `npm run register` - Register Discord slash commands
- `npm run dev` - Start bot with nodemon for development
- `npm run restart` - Restart bot using PM2
- `npm run logs` - View PM2 logs
- `npm run restart-logs` - Restart bot and show logs

## Architecture Overview

This is a Discord activity tracking bot built with Node.js and Discord.js v14. The bot uses LowDB (JSON-based database) for data persistence and tracks voice channel activity, user classifications, and activity reports.

### Core Architecture Patterns

**Database Layer**: Uses DatabaseManager.js as a centralized data access layer with LowDB adapter. All database operations go through this service with consistent patterns:
- `forceReload()` before read operations
- `.write()` after write operations
- Separate tables: `user_activity`, `role_config`, `activity_logs`, `reset_history`, `log_members`, `afk_status`

**Service Layer**: Each major functionality is separated into services in `/src/services/`:
- `ActivityTracker` - Voice channel activity monitoring
- `DatabaseManager` - Data persistence layer
- `LogService` - Discord message logging
- `CalendarLogService` - Activity report generation
- `UserClassificationService` - User role/status management
- `EventManager` - Discord event handling

**Command Pattern**: Commands inherit from `CommandBase.js` and follow consistent patterns:
- Constructor receives services object with `{activityTracker, dbManager, calendarLogService, client}`
- Use `deferReply({flags: MessageFlags.Ephemeral})` for private responses
- Implement `executeCommand(interaction)` method

**Bot Singleton**: The Bot class uses singleton pattern and initializes all services in constructor order

### Database Schema

Current LowDB structure uses these main collections:
- `user_activity`: User voice activity tracking with userId, totalTime, startTime, displayName
- `role_config`: Role-based minimum activity requirements with roleName, minHours, resetTime, reportCycle
- `activity_logs`: Voice channel join/leave events with timestamp, eventType, channelId
- `afk_status`: Separate table for user AFK status with afkUntil timestamps
- `reset_history`: Audit trail for role resets

### Key Configuration

Environment variables are managed in `/src/config/env.js`:
- Required: TOKEN, GUILDID, LOG_CHANNEL_ID
- EXCLUDED_CHANNELS array for channels to ignore
- CALENDAR_LOG_CHANNEL_ID for activity reports

Constants in `/src/config/constants.js` define colors, message types, and filters used throughout the application.

### Development Notes

- Bot runs on PM2 process manager in production
- Uses ES modules (`"type": "module"` in package.json)
- Korean timezone and locale used for date formatting
- Activity data is JSON-based but structured to allow migration to other databases
- All services are dependency-injected through constructor patterns