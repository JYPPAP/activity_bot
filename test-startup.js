#!/usr/bin/env node

import 'reflect-metadata';
import { config } from './dist/config/env.js';

console.log('[Test] Starting test...');
console.log('[Test] Environment variables loaded');
console.log('[Test] TOKEN:', config.TOKEN ? 'Set' : 'Not set');
console.log('[Test] LOG_CHANNEL_ID:', config.LOG_CHANNEL_ID ? 'Set' : 'Not set');
console.log('[Test] POSTGRES_HOST:', config.POSTGRES_HOST ? 'Set' : 'Not set');

// Test Discord client creation
import { Client, GatewayIntentBits } from 'discord.js';
import { MemoryGuard } from 'discord-optimizer';

console.log('[Test] Creating Discord client...');
try {
  const baseClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });
  
  console.log('[Test] Base client created');
  
  const wrappedClient = MemoryGuard.wrap(baseClient, {
    maxMemory: 256,
    autoRestart: false,
  });
  
  console.log('[Test] MemoryGuard wrapped client created');
  console.log('[Test] Success!');
} catch (error) {
  console.error('[Test] Error creating client:', error);
}

process.exit(0);