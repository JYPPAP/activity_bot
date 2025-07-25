// src/config/migrate-env.js - Helper to migrate from old env.js to new environment system
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Migrate from old env.js to new environment system
 */
export async function migrateEnvironmentConfig() {
  console.log('🔄 Starting environment configuration migration...');
  
  try {
    // 1. Backup old env.js
    const oldEnvPath = path.join(__dirname, 'env.js');
    const backupPath = path.join(__dirname, 'env.js.backup');
    
    if (fs.existsSync(oldEnvPath) && !fs.existsSync(backupPath)) {
      fs.copyFileSync(oldEnvPath, backupPath);
      console.log('✅ Backed up old env.js to env.js.backup');
    }
    
    // 2. Create new env.js that imports from env-new.js
    const migrationContent = `// src/config/env.js - Migrated to new environment system
// This file maintains backward compatibility while using the new environment detection system

import { config as newConfig, validateRequiredConfig } from './env-new.js';

// Re-export the config object for backward compatibility
export const config = newConfig;

// Re-export all new utilities
export * from './env-new.js';

// Validate on import (async, but errors will be logged)
validateRequiredConfig().catch(error => {
  console.error('❌ Environment configuration validation failed:', error);
  console.error('Please check your .env files and environment variables');
});

console.log('✅ Environment configuration loaded successfully');
`;
    
    // 3. Write the migration file
    fs.writeFileSync(oldEnvPath, migrationContent);
    console.log('✅ Updated env.js to use new environment system');
    
    // 4. Check for .env files
    const rootDir = path.resolve(__dirname, '../..');
    const envFiles = ['.env', '.env.development', '.env.production'];
    const existingEnvFiles = envFiles.filter(file => 
      fs.existsSync(path.join(rootDir, file))
    );
    
    if (existingEnvFiles.length > 0) {
      console.log(`✅ Found existing .env files: ${existingEnvFiles.join(', ')}`);
      console.log('   These will be automatically loaded by the new system');
    }
    
    // 5. Create example .env if it doesn't exist
    const envExamplePath = path.join(rootDir, '.env.example');
    if (!fs.existsSync(envExamplePath)) {
      const exampleContent = `# Discord Bot Configuration
TOKEN=your_discord_bot_token_here
CLIENT_ID=your_discord_client_id_here
GUILDID=your_discord_guild_id_here

# Channel IDs
LOG_CHANNEL_ID=your_log_channel_id_here
CALENDAR_LOG_CHANNEL_ID=your_calendar_channel_id_here
FORUM_CHANNEL_ID=your_forum_channel_id_here
VOICE_CATEGORY_ID=your_voice_category_id_here
FORUM_TAG_ID=your_forum_tag_id_here

# Excluded Channels (optional)
EXCLUDE_CHANNELID_1=
EXCLUDE_CHANNELID_2=
EXCLUDE_CHANNELID_3=
EXCLUDE_CHANNELID_4=
EXCLUDE_CHANNELID_5=
EXCLUDE_CHANNELID_6=

# Developer Settings
DEV_ID=your_developer_user_id_here

# Server Configuration
PORT=3000
HOST=localhost

# Monitoring (optional)
ERRSOLE_HOST=0.0.0.0
ERRSOLE_PORT=8001
ERRSOLE_PASSWORD=your_errsole_password_here

# Slack Integration (optional)
ENABLE_SLACK_ALERTS=false
SLACK_WEBHOOK_URL=your_slack_webhook_url_here
SLACK_CHANNEL=#alerts
SLACK_MIN_LEVEL=error

# Network Settings (optional)
PHONE_IP=your_phone_ip_here
`;
      fs.writeFileSync(envExamplePath, exampleContent);
      console.log('✅ Created .env.example with all available options');
    }
    
    console.log('\n✅ Migration completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('1. Review your .env files to ensure all required variables are set');
    console.log('2. The new system automatically detects your environment (development/production/termux)');
    console.log('3. Environment-specific configs are loaded from config/*.config.js files');
    console.log('4. Run your application - it should work with no code changes');
    console.log('\n💡 Benefits of the new system:');
    console.log('- Automatic environment detection (including Termux)');
    console.log('- Type-safe configuration with validation');
    console.log('- Environment-specific configuration files');
    console.log('- Better error messages for missing configs');
    console.log('- Performance optimizations based on environment');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateEnvironmentConfig().catch(console.error);
}