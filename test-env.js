#!/usr/bin/env node

console.log('[Test] Starting environment test...');

try {
  console.log('[Test] Loading env module...');
  const { config } = await import('./dist/config/env.js');
  console.log('[Test] Environment loaded successfully');
  console.log('[Test] TOKEN:', config.TOKEN ? 'Set' : 'Not set');
  console.log('[Test] CLIENT_ID:', config.CLIENT_ID || 'Not set');
  console.log('[Test] Done!');
} catch (error) {
  console.error('[Test] Error loading environment:', error);
}

process.exit(0);