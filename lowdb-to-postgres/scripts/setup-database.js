#!/usr/bin/env node
// Database Setup Script - Automated PostgreSQL setup for Discord bot

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DatabaseSetup {
  constructor() {
    this.config = {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: process.env.POSTGRES_PORT || 5432,
      database: process.env.POSTGRES_DB || 'discord_activity_bot',
      user: process.env.POSTGRES_USER || 'discord_bot',
      password: process.env.POSTGRES_PASSWORD || this.generatePassword(),
      adminUser: process.env.POSTGRES_ADMIN_USER || 'postgres',
      adminPassword: process.env.POSTGRES_ADMIN_PASSWORD || ''
    };
  }

  generatePassword() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }

  async runCommand(command, args, env = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });

      // For interactive commands, close stdin
      child.stdin.end();
    });
  }

  async checkPostgreSQLInstalled() {
    try {
      await this.runCommand('psql', ['--version']);
      console.log('✅ PostgreSQL is installed');
      return true;
    } catch (error) {
      console.log('❌ PostgreSQL is not installed');
      return false;
    }
  }

  async installPostgreSQL() {
    console.log('🔧 Installing PostgreSQL...');
    
    const platform = process.platform;
    
    try {
      if (platform === 'linux') {
        // Ubuntu/Debian
        await this.runCommand('sudo', ['apt', 'update']);
        await this.runCommand('sudo', ['apt', 'install', '-y', 'postgresql', 'postgresql-contrib']);
      } else if (platform === 'darwin') {
        // macOS
        await this.runCommand('brew', ['install', 'postgresql']);
        await this.runCommand('brew', ['services', 'start', 'postgresql']);
      } else {
        console.log('⚠️ Automatic installation not supported on this platform');
        console.log('Please install PostgreSQL manually and run this script again');
        return false;
      }
      
      console.log('✅ PostgreSQL installed successfully');
      return true;
    } catch (error) {
      console.error('❌ PostgreSQL installation failed:', error.message);
      return false;
    }
  }

  async checkPostgreSQLRunning() {
    try {
      await this.runCommand('psql', ['-h', this.config.host, '-U', this.config.adminUser, '-c', 'SELECT 1'], {
        PGPASSWORD: this.config.adminPassword
      });
      console.log('✅ PostgreSQL is running');
      return true;
    } catch (error) {
      console.log('❌ PostgreSQL is not running or not accessible');
      return false;
    }
  }

  async startPostgreSQL() {
    console.log('🚀 Starting PostgreSQL...');
    
    const platform = process.platform;
    
    try {
      if (platform === 'linux') {
        await this.runCommand('sudo', ['systemctl', 'start', 'postgresql']);
        await this.runCommand('sudo', ['systemctl', 'enable', 'postgresql']);
      } else if (platform === 'darwin') {
        await this.runCommand('brew', ['services', 'start', 'postgresql']);
      }
      
      console.log('✅ PostgreSQL started successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to start PostgreSQL:', error.message);
      return false;
    }
  }

  async createDatabase() {
    console.log(`🏗️ Creating database: ${this.config.database}`);
    
    try {
      // Create database
      await this.runCommand('psql', [
        '-h', this.config.host,
        '-U', this.config.adminUser,
        '-c', `CREATE DATABASE ${this.config.database};`
      ], {
        PGPASSWORD: this.config.adminPassword
      });
      
      console.log(`✅ Database '${this.config.database}' created`);
      return true;
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log(`✅ Database '${this.config.database}' already exists`);
        return true;
      } else {
        console.error('❌ Database creation failed:', error.message);
        return false;
      }
    }
  }

  async createUser() {
    console.log(`👤 Creating user: ${this.config.user}`);
    
    try {
      // Create user
      await this.runCommand('psql', [
        '-h', this.config.host,
        '-U', this.config.adminUser,
        '-c', `CREATE USER ${this.config.user} WITH ENCRYPTED PASSWORD '${this.config.password}';`
      ], {
        PGPASSWORD: this.config.adminPassword
      });
      
      console.log(`✅ User '${this.config.user}' created`);
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log(`✅ User '${this.config.user}' already exists`);
      } else {
        console.error('❌ User creation failed:', error.message);
        return false;
      }
    }

    try {
      // Grant privileges
      await this.runCommand('psql', [
        '-h', this.config.host,
        '-U', this.config.adminUser,
        '-c', `GRANT ALL PRIVILEGES ON DATABASE ${this.config.database} TO ${this.config.user};`
      ], {
        PGPASSWORD: this.config.adminPassword
      });
      
      console.log(`✅ Privileges granted to '${this.config.user}'`);
      return true;
    } catch (error) {
      console.error('❌ Privilege granting failed:', error.message);
      return false;
    }
  }

  async applySchema() {
    console.log('📋 Applying database schema...');
    
    const schemaFile = path.join(__dirname, '..', '01-schema.sql');
    
    if (!fs.existsSync(schemaFile)) {
      console.error(`❌ Schema file not found: ${schemaFile}`);
      return false;
    }

    try {
      await this.runCommand('psql', [
        '-h', this.config.host,
        '-U', this.config.user,
        '-d', this.config.database,
        '-f', schemaFile
      ], {
        PGPASSWORD: this.config.password
      });
      
      console.log('✅ Database schema applied successfully');
      return true;
    } catch (error) {
      console.error('❌ Schema application failed:', error.message);
      return false;
    }
  }

  async testConnection() {
    console.log('🔗 Testing database connection...');
    
    try {
      const result = await this.runCommand('psql', [
        '-h', this.config.host,
        '-U', this.config.user,
        '-d', this.config.database,
        '-c', 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = \'public\';'
      ], {
        PGPASSWORD: this.config.password
      });
      
      console.log('✅ Database connection successful');
      console.log(`📊 Found tables in schema:`, result.stdout.trim());
      return true;
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      return false;
    }
  }

  generateEnvFile() {
    const envContent = `# PostgreSQL Configuration for Discord Activity Bot
# Generated by setup script on ${new Date().toISOString()}

POSTGRES_HOST=${this.config.host}
POSTGRES_PORT=${this.config.port}
POSTGRES_DB=${this.config.database}
POSTGRES_USER=${this.config.user}
POSTGRES_PASSWORD=${this.config.password}
POSTGRES_SSL=false

# Connection Pool Settings
POSTGRES_MAX_CONNECTIONS=20
POSTGRES_MIN_CONNECTIONS=2
POSTGRES_IDLE_TIMEOUT=30000
POSTGRES_CONNECTION_TIMEOUT=2000

# Performance Monitoring
POSTGRES_TRACK_SLOW_QUERIES=true
POSTGRES_SLOW_QUERY_THRESHOLD=1000
POSTGRES_POOL_MONITORING=true
POSTGRES_LOG_CONNECTIONS=false
POSTGRES_LOG_DISCONNECTIONS=false

# Health Check Settings
POSTGRES_HEALTH_CHECK_INTERVAL=30000
POSTGRES_ENABLE_METRICS=false
POSTGRES_METRICS_PORT=9090

# Application Settings
DATABASE_TYPE=postgresql
NODE_ENV=development
`;

    const envFile = path.join(__dirname, '..', '..', '.env.postgresql');
    fs.writeFileSync(envFile, envContent);
    
    console.log(`📄 Environment file created: ${envFile}`);
    console.log('💡 Copy this to .env to use PostgreSQL configuration');
    
    return envFile;
  }

  async runSetup() {
    console.log('🎯 Discord Activity Bot - PostgreSQL Setup');
    console.log('==========================================');
    
    try {
      // 1. Check if PostgreSQL is installed
      const isInstalled = await this.checkPostgreSQLInstalled();
      if (!isInstalled) {
        const installed = await this.installPostgreSQL();
        if (!installed) {
          console.log('❌ Setup failed: PostgreSQL installation required');
          return false;
        }
      }

      // 2. Check if PostgreSQL is running
      const isRunning = await this.checkPostgreSQLRunning();
      if (!isRunning) {
        const started = await this.startPostgreSQL();
        if (!started) {
          console.log('❌ Setup failed: PostgreSQL must be running');
          return false;
        }
        
        // Wait a moment for PostgreSQL to fully start
        console.log('⏳ Waiting for PostgreSQL to start...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // 3. Create database
      const databaseCreated = await this.createDatabase();
      if (!databaseCreated) {
        console.log('❌ Setup failed: Database creation failed');
        return false;
      }

      // 4. Create user
      const userCreated = await this.createUser();
      if (!userCreated) {
        console.log('❌ Setup failed: User creation failed');
        return false;
      }

      // 5. Apply schema
      const schemaApplied = await this.applySchema();
      if (!schemaApplied) {
        console.log('❌ Setup failed: Schema application failed');
        return false;
      }

      // 6. Test connection
      const connectionOk = await this.testConnection();
      if (!connectionOk) {
        console.log('❌ Setup failed: Connection test failed');
        return false;
      }

      // 7. Generate environment file
      this.generateEnvFile();

      console.log('');
      console.log('🎉 PostgreSQL setup completed successfully!');
      console.log('==========================================');
      console.log('Next steps:');
      console.log('1. Copy .env.postgresql to .env');
      console.log('2. Run migration: npm run migrate');
      console.log('3. Update your application to use PostgreSQL');
      console.log('');
      console.log('Database connection details:');
      console.log(`  Host: ${this.config.host}`);
      console.log(`  Port: ${this.config.port}`);
      console.log(`  Database: ${this.config.database}`);
      console.log(`  User: ${this.config.user}`);
      console.log(`  Password: ${this.config.password}`);
      
      return true;
    } catch (error) {
      console.error('💥 Setup failed with error:', error);
      return false;
    }
  }
}

// Run setup if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const setup = new DatabaseSetup();
  
  setup.runSetup().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Setup script error:', error);
    process.exit(1);
  });
}

export default DatabaseSetup;