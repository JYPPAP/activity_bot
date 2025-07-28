#!/usr/bin/env node

console.log('[Test] Starting minimal test...');

async function test() {
  try {
    console.log('[Test] Step 1: Import reflect-metadata');
    await import('reflect-metadata');
    console.log('[Test] Step 1: Success');
    
    console.log('[Test] Step 2: Import env');
    await import('./dist/config/env.js');
    console.log('[Test] Step 2: Success');
    
    console.log('[Test] Step 3: Import logger');
    await import('./dist/config/logger-termux.js');
    console.log('[Test] Step 3: Success');
    
    console.log('[Test] Step 4: Import Bot class');
    const { Bot } = await import('./dist/bot.js');
    console.log('[Test] Step 4: Success');
    
    console.log('[Test] Step 5: Import server keepAlive');
    const { keepAlive } = await import('./dist/../server.js');
    console.log('[Test] Step 5: Success');
    
    console.log('[Test] All imports successful!');
  } catch (error) {
    console.error('[Test] Error:', error);
  }
}

test().then(() => {
  console.log('[Test] Test completed');
  process.exit(0);
});