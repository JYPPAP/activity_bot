#!/usr/bin/env node

console.log('[Test] Testing discord-optimizer...');

async function test() {
  try {
    console.log('[Test] Importing discord.js...');
    const { Client, GatewayIntentBits } = await import('discord.js');
    console.log('[Test] discord.js imported successfully');
    
    console.log('[Test] Importing discord-optimizer...');
    const { MemoryGuard } = await import('discord-optimizer');
    console.log('[Test] discord-optimizer imported successfully');
    
    console.log('[Test] Creating base client...');
    const baseClient = new Client({
      intents: [GatewayIntentBits.Guilds],
    });
    console.log('[Test] Base client created');
    
    console.log('[Test] Wrapping with MemoryGuard...');
    const wrappedClient = MemoryGuard.wrap(baseClient, {
      maxMemory: 256,
      autoRestart: false,
    });
    console.log('[Test] MemoryGuard wrapped successfully');
    
    console.log('[Test] All tests passed!');
  } catch (error) {
    console.error('[Test] Error:', error);
  }
}

test().then(() => {
  console.log('[Test] Test completed');
  process.exit(0);
});