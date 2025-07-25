# Environment Detection and Configuration System

## Overview

The Environment Detection System provides intelligent, automatic environment detection and configuration management for the Discord bot. It supports multiple environments (development, production, staging, test) and platforms (including Termux) with type-safe configuration and validation.

## Features

- 🔍 **Automatic Environment Detection**: Detects runtime environment based on multiple factors
- 🌍 **Multi-Environment Support**: Development, Production, Staging, Test, and custom environments
- 📱 **Platform Detection**: Special support for Termux and mobile environments
- ✅ **Configuration Validation**: Schema-based validation with type checking
- 🔧 **Environment-Specific Configs**: Separate configuration files for each environment
- 🚀 **Performance Optimization**: Automatic optimizations based on environment
- 🛡️ **Type Safety**: Full TypeScript-like validation for configurations
- 🔄 **Backward Compatible**: Works with existing env.js structure

## Architecture

```
src/config/environment/
├── index.js                 # Main environment manager
├── EnvironmentDetector.js   # Environment detection logic
├── ConfigurationLoader.js   # Configuration loading and merging
└── ConfigurationSchema.js   # Schema definition and validation

config/
├── base.config.js          # Base configuration for all environments
├── development.config.js   # Development-specific configuration
├── production.config.js    # Production-specific configuration
└── test.config.js         # Test-specific configuration
```

## Quick Start

### 1. Basic Usage

```javascript
import { initializeEnvironment, getConfig, isProduction } from './src/config/environment/index.js';

// Initialize environment (required once at startup)
await initializeEnvironment();

// Get configuration values
const token = getConfig('discord.token');
const port = getConfig('server.port', 3000); // with default value

// Check environment
if (isProduction()) {
  console.log('Running in production mode');
}
```

### 2. Migration from Old System

Run the migration helper:

```bash
node src/config/migrate-env.js
```

This will:
- Backup your old `env.js`
- Update it to use the new system
- Maintain backward compatibility
- Create example configuration files

### 3. Environment Variables

The system loads `.env` files in this order (later files override earlier ones):

1. `.env` - Default values
2. `.env.local` - Local overrides (gitignored)
3. `.env.[environment]` - Environment-specific values
4. `.env.[environment].local` - Local environment-specific overrides

Example `.env.production`:
```env
TOKEN=your_production_bot_token
NODE_ENV=production
ENABLE_SLACK_ALERTS=true
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

## Environment Detection

The system detects the environment using multiple methods:

1. **NODE_ENV Variable**: Explicit environment setting
2. **CI/CD Detection**: Recognizes CI environments (GitHub Actions, Jenkins, etc.)
3. **File Detection**: Looks for `.env.[environment]` files
4. **Command Line Args**: `--production`, `--development` flags
5. **Platform Detection**: Special handling for Termux/mobile
6. **Default Fallback**: Defaults to development

### Supported Environments

- **development**: Local development with debugging features
- **production**: Optimized for performance and monitoring
- **staging**: Production-like with some debugging
- **test**: For automated testing with mocks
- **custom**: Any custom environment name

### Platform Detection

The system automatically detects:
- **Windows**: Full features
- **macOS**: Full features
- **Linux**: Full features
- **Termux**: Mobile optimizations, resource limits

## Configuration Structure

### Schema Definition

```javascript
// Example schema definition
defineSchema('discord', {
  type: 'object',
  required: ['token', 'clientId', 'guildId'],
  properties: {
    token: {
      type: 'string',
      pattern: /^[A-Za-z0-9._-]{24,}$/,
      sensitive: true,
      description: 'Discord bot token'
    },
    clientId: {
      type: 'string',
      pattern: /^\d{17,19}$/,
      description: 'Discord application client ID'
    }
  }
});
```

### Configuration Merging

Configurations are merged in this priority order:
1. Base configuration (`base.config.js`)
2. Environment-specific configuration (`[env].config.js`)
3. Environment variables (`.env` files)
4. Runtime overrides

### Accessing Configuration

```javascript
// Get nested values
const logChannel = getConfig('discord.channels.log');
const dbType = getConfig('database.type', 'sqlite');

// Check if config exists
if (hasConfig('monitoring.slack.webhookUrl')) {
  // Enable Slack integration
}

// Get all configuration
const allConfig = getAllConfig();

// Environment checks
if (isDevelopment()) {
  // Development-only code
}

if (isTermux()) {
  // Mobile-specific optimizations
}

// Feature flags
if (hasFeature('monitoring')) {
  // Enable monitoring
}
```

## Environment-Specific Features

### Development
- Debug logging enabled
- Hot reload support
- Detailed error messages
- Schema auto-sync for database
- Longer timeouts for debugging

### Production
- Performance optimizations
- Monitoring enabled (Errsole, Slack)
- Minimal logging
- Resource optimization
- Security hardening

### Termux/Mobile
- Reduced resource usage
- Lower connection pools
- Optimized cache sizes
- External connection support (0.0.0.0)
- Battery-friendly intervals

## Validation

### Built-in Validations

- **Type Checking**: string, number, boolean, array, object
- **Pattern Matching**: Regex validation for strings
- **Range Validation**: Min/max for numbers
- **Required Fields**: Ensures critical config exists
- **Enum Validation**: Restricts to allowed values

### Custom Validators

```javascript
// Register custom validator
schema.registerValidator('discord.token', async (token, config, env) => {
  if (env.isProduction() && (!token || token.length < 50)) {
    throw new Error('Invalid Discord token for production');
  }
});
```

### Validation Results

```javascript
const validation = await validateConfiguration(config);
if (!validation.valid) {
  console.error('Configuration errors:', validation.errors);
  console.warn('Configuration warnings:', validation.warnings);
}
```

## Advanced Features

### Transformers

Apply transformations to config values:

```javascript
loader.registerTransformer('server.port', async (port, env) => {
  // Convert string to number
  return typeof port === 'string' ? parseInt(port, 10) : port;
});
```

### Feature Detection

The system automatically detects available features:

- **file-write**: File system write access
- **external-monitoring**: Errsole/Slack configured
- **pm2**: Running under PM2
- **docker**: Running in container
- **hot-reload**: Development hot reload
- **performance-mode**: Production optimizations

### Metadata

Access system metadata:

```javascript
const metadata = getMetadata();
console.log(`Running on ${metadata.platform} with ${metadata.cpus} CPUs`);
console.log(`Node.js ${metadata.nodeVersion}`);
console.log(`Memory: ${metadata.freeMemory / 1024 / 1024}MB free`);
```

## Performance Considerations

### Memory Usage

- Configuration is loaded once and cached
- Production configs are frozen (immutable)
- Minimal overhead (~2-5MB)

### Loading Time

- Initial load: ~50-200ms
- Subsequent access: <1ms
- Validation: ~10-50ms

### Optimizations

- Lazy loading of optional features
- Efficient merging algorithm
- Cached environment detection
- Minimal file I/O

## Troubleshooting

### Common Issues

1. **Missing Configuration**
   ```
   Error: Required configuration missing: discord.token
   ```
   Solution: Ensure all required environment variables are set

2. **Validation Failures**
   ```
   Error: discord.clientId must match pattern /^\d{17,19}$/
   ```
   Solution: Check the format of your configuration values

3. **Environment Not Detected**
   ```
   Environment detected: development (expected: production)
   ```
   Solution: Set NODE_ENV=production explicitly

### Debug Mode

Enable detailed logging:

```javascript
process.env.DEBUG = 'env:*';
await initializeEnvironment();
```

### Health Check

```javascript
// Check system health
const env = getEnvironmentInfo();
console.log('Environment:', env.environment);
console.log('Platform:', env.platform);
console.log('Features:', env.features);
console.log('Production:', env.isProduction);
```

## Security Best Practices

1. **Never commit `.env` files** - Use `.env.example` as template
2. **Mark sensitive configs** - Use `sensitive: true` in schema
3. **Validate in production** - Ensure all required configs exist
4. **Use environment variables** - For secrets and tokens
5. **Rotate credentials** - Regular token/password rotation
6. **Monitor access** - Log configuration access in production

## API Reference

### Main Functions

```javascript
// Initialize environment
await initializeEnvironment();

// Get configuration
getConfig(path: string, defaultValue?: any): any
hasConfig(path: string): boolean
getAllConfig(): object

// Environment checks
isProduction(): boolean
isDevelopment(): boolean
isTest(): boolean
isStaging(): boolean
isTermux(): boolean

// Feature checks
hasFeature(feature: string): boolean

// Get environment info
getEnvironmentInfo(): EnvironmentInfo
getMetadata(): EnvironmentMetadata
```

### Configuration Schema

```javascript
// Define schema
defineSchema(path: string, schema: SchemaDefinition): void

// Register validators
registerValidator(path: string, validator: ValidatorFunction): void

// Validate configuration
validateConfiguration(config: object): ValidationResult
```

### Environment Detection

```javascript
// Get detector instance
const detector = getEnvironment();

// Access detection results
detector.environment    // 'production', 'development', etc.
detector.platform       // 'windows', 'linux', 'termux', etc.
detector.features       // Set of detected features
detector.metadata       // System metadata
```

## Contributing

When adding new configuration options:

1. Add to schema in `ConfigurationSchema.js`
2. Add defaults to `base.config.js`
3. Add environment-specific overrides if needed
4. Document in this file
5. Add validation tests

## License

This environment configuration system is part of the Discord Activity Bot project.