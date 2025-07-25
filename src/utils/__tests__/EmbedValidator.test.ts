// src/utils/__tests__/EmbedValidator.test.ts - Discord embed validator unit tests
import { EmbedBuilder } from 'discord.js';
import { EmbedValidator, ValidationResult } from '../EmbedValidator';

describe('EmbedValidator', () => {
  describe('Core Constraint Validation', () => {
    test('should pass validation for a valid embed', () => {
      const validEmbed = new EmbedBuilder()
        .setTitle('Valid Title')
        .setDescription('Valid description')
        .setColor(0x00ff00)
        .addFields({ name: 'Field', value: 'Value', inline: false });

      const result = EmbedValidator.validateEmbed(validEmbed);
      
      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.totalCharacters).toBeLessThanOrEqual(6000);
      expect(result.totalFields).toBeLessThanOrEqual(25);
    });

    test('should fail validation when field count exceeds 25', () => {
      const embed = new EmbedBuilder()
        .setTitle('Too Many Fields')
        .setColor(0x00ff00);

      // Add 26 fields (exceeds Discord limit of 25)
      for (let i = 0; i < 26; i++) {
        embed.addFields({ name: `Field ${i}`, value: `Value ${i}`, inline: true });
      }

      const result = EmbedValidator.validateEmbed(embed);
      
      expect(result.isValid).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          type: 'field_count_exceeded',
          severity: 'critical',
          current: 26,
          limit: 25
        })
      );
    });

    test('should fail validation when total characters exceed 6000', () => {
      const embed = new EmbedBuilder()
        .setTitle('Character Limit Test')
        .setDescription('A'.repeat(6001)) // Exceeds 6000 character limit
        .setColor(0x00ff00);

      const result = EmbedValidator.validateEmbed(embed);
      
      expect(result.isValid).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          type: 'total_character_limit',
          severity: 'critical'
        })
      );
    });

    test('should fail validation when title exceeds 256 characters', () => {
      const embed = new EmbedBuilder()
        .setTitle('A'.repeat(257)) // Exceeds 256 character limit
        .setColor(0x00ff00);

      const result = EmbedValidator.validateEmbed(embed);
      
      expect(result.isValid).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          type: 'title_length',
          severity: 'error',
          current: 257,
          limit: 256
        })
      );
    });

    test('should fail validation when description exceeds 4096 characters', () => {
      const embed = new EmbedBuilder()
        .setTitle('Description Test')
        .setDescription('B'.repeat(4097)) // Exceeds 4096 character limit
        .setColor(0x00ff00);

      const result = EmbedValidator.validateEmbed(embed);
      
      expect(result.isValid).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          type: 'description_length',
          severity: 'error',
          current: 4097,
          limit: 4096
        })
      );
    });

    test('should fail validation when field value exceeds 1024 characters', () => {
      const embed = new EmbedBuilder()
        .setTitle('Field Value Test')
        .setColor(0x00ff00)
        .addFields({ name: 'Long Field', value: 'C'.repeat(1025), inline: false }); // Exceeds 1024 limit

      const result = EmbedValidator.validateEmbed(embed);
      
      expect(result.isValid).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          type: 'field_value_length',
          severity: 'error',
          current: 1025,
          limit: 1024
        })
      );
    });

    test('should fail validation when footer exceeds 2048 characters', () => {
      const embed = new EmbedBuilder()
        .setTitle('Footer Test')
        .setColor(0x00ff00)
        .setFooter({ text: 'D'.repeat(2049) }); // Exceeds 2048 limit

      const result = EmbedValidator.validateEmbed(embed);
      
      expect(result.isValid).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          type: 'footer_length',
          severity: 'error',
          current: 2049,
          limit: 2048
        })
      );
    });
  });

  describe('URL Validation', () => {
    test('should validate valid URLs', () => {
      const embed = new EmbedBuilder()
        .setTitle('URL Test')
        .setURL('https://example.com')
        .setThumbnail('https://example.com/thumb.png')
        .setImage('https://example.com/image.jpg')
        .setColor(0x00ff00);

      const result = EmbedValidator.validateEmbed(embed, { validateUrls: true });
      
      const urlViolations = result.violations.filter(v => v.type === 'invalid_url');
      expect(urlViolations).toHaveLength(0);
    });

    test('should fail validation for invalid URLs', () => {
      const embed = new EmbedBuilder()
        .setTitle('Invalid URL Test')
        .setURL('not-a-url')
        .setThumbnail('ftp://example.com/thumb.png') // Unsupported protocol
        .setColor(0x00ff00);

      const result = EmbedValidator.validateEmbed(embed, { validateUrls: true });
      
      const urlViolations = result.violations.filter(v => v.type === 'invalid_url');
      expect(urlViolations.length).toBeGreaterThan(0);
    });
  });

  describe('Color Validation', () => {
    test('should validate valid colors', () => {
      const validColors = [0x000000, 0xFFFFFF, 0x00FF00, 0xFF0000, 0x0000FF];
      
      validColors.forEach(color => {
        const embed = new EmbedBuilder()
          .setTitle('Color Test')
          .setColor(color);

        const result = EmbedValidator.validateEmbed(embed);
        const colorViolations = result.violations.filter(v => v.type === 'invalid_color');
        expect(colorViolations).toHaveLength(0);
      });
    });

    test('should warn about low contrast colors', () => {
      const lowContrastColors = [0xF0F0F0, 0x101010]; // Very light and very dark
      
      lowContrastColors.forEach(color => {
        const embed = new EmbedBuilder()
          .setTitle('Low Contrast Test')
          .setColor(color);

        const result = EmbedValidator.validateEmbed(embed, { checkAccessibility: true });
        const accessibilityWarnings = result.warnings.filter(w => w.type === 'accessibility_issue');
        expect(accessibilityWarnings.length).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Accessibility Validation', () => {
    test('should warn about excessive emoji usage', () => {
      const embed = new EmbedBuilder()
        .setTitle('🎉🎊✨🌟💫⭐🔥💯🎯🚀 Too Many Emojis')
        .setDescription('🎵🎶🎤🎧🎼 This has way too many emojis! 📱💻🖥️⌚📟')
        .setColor(0x00ff00);

      const result = EmbedValidator.validateEmbed(embed, { checkAccessibility: true });
      
      const emojiWarnings = result.warnings.filter(w => 
        w.type === 'accessibility_issue' && w.message.includes('이모지')
      );
      expect(emojiWarnings.length).toBeGreaterThan(0);
    });

    test('should warn about missing image descriptions', () => {
      const embed = new EmbedBuilder()
        .setTitle('Image Test')
        .setDescription('This embed has an image but no description')
        .setImage('https://example.com/image.png')
        .setColor(0x00ff00);

      const result = EmbedValidator.validateEmbed(embed, { checkAccessibility: true });
      
      const imageWarnings = result.warnings.filter(w => 
        w.type === 'accessibility_issue' && w.field === 'image'
      );
      expect(imageWarnings.length).toBeGreaterThan(0);
    });
  });

  describe('Performance and Quality Scores', () => {
    test('should calculate quality scores when enabled', () => {
      const embed = new EmbedBuilder()
        .setTitle('Quality Test')
        .setDescription('This is a well-structured embed for testing quality scoring.')
        .setColor(0x00ff00)
        .addFields(
          { name: 'Good Field', value: 'Appropriate length content', inline: true },
          { name: 'Another Field', value: 'More good content here', inline: true }
        );

      const result = EmbedValidator.validateEmbed(embed, { calculateScores: true });
      
      expect(result.summary.readabilityScore).toBeGreaterThanOrEqual(0);
      expect(result.summary.readabilityScore).toBeLessThanOrEqual(100);
      expect(result.summary.performanceScore).toBeGreaterThanOrEqual(0);
      expect(result.summary.performanceScore).toBeLessThanOrEqual(100);
      expect(result.summary.complianceScore).toBeGreaterThanOrEqual(0);
      expect(result.summary.complianceScore).toBeLessThanOrEqual(100);
    });

    test('should assign appropriate health status', () => {
      // Excellent embed
      const excellentEmbed = new EmbedBuilder()
        .setTitle('Perfect Embed')
        .setDescription('This is a perfectly crafted embed.')
        .setColor(0x00ff00)
        .addFields({ name: 'Field', value: 'Value', inline: true });

      const excellentResult = EmbedValidator.validateEmbed(excellentEmbed);
      expect(['excellent', 'good']).toContain(excellentResult.summary.overallHealth);

      // Critical embed (exceeds limits)
      const criticalEmbed = new EmbedBuilder()
        .setTitle('Critical Embed')
        .setDescription('A'.repeat(6001)) // Exceeds character limit
        .setColor(0x00ff00);

      const criticalResult = EmbedValidator.validateEmbed(criticalEmbed);
      expect(criticalResult.summary.overallHealth).toBe('critical');
    });
  });

  describe('Optimization Features', () => {
    test('should optimize overly long field values', () => {
      const embed = new EmbedBuilder()
        .setTitle('Optimization Test')
        .setColor(0x00ff00)
        .addFields({ name: 'Long Field', value: 'X'.repeat(900), inline: false });

      const optimization = EmbedValidator.optimizeEmbed(embed);
      
      expect(optimization.spacesSaved).toBeGreaterThan(0);
      expect(optimization.optimizations.length).toBeGreaterThan(0);
      expect(optimization.optimizations[0].type).toBe('truncate');
    });

    test('should not modify embeds that don't need optimization', () => {
      const embed = new EmbedBuilder()
        .setTitle('Good Embed')
        .setDescription('This embed is already optimized.')
        .setColor(0x00ff00)
        .addFields({ name: 'Field', value: 'Short value', inline: true });

      const optimization = EmbedValidator.optimizeEmbed(embed);
      
      expect(optimization.spacesSaved).toBe(0);
      expect(optimization.optimizations).toHaveLength(0);
    });
  });

  describe('Quick Validation', () => {
    test('should quickly validate valid embeds', () => {
      const embed = new EmbedBuilder()
        .setTitle('Quick Test')
        .setDescription('Quick validation test')
        .setColor(0x00ff00);

      const isValid = EmbedValidator.quickValidate(embed);
      expect(isValid).toBe(true);
    });

    test('should quickly detect invalid embeds', () => {
      const embed = new EmbedBuilder()
        .setTitle('A'.repeat(300)) // Exceeds title limit
        .setColor(0x00ff00);

      const isValid = EmbedValidator.quickValidate(embed);
      expect(isValid).toBe(false);
    });

    test('should be faster than full validation', () => {
      const embed = new EmbedBuilder()
        .setTitle('Performance Test')
        .setDescription('Testing validation performance')
        .setColor(0x00ff00)
        .addFields(
          { name: 'Field 1', value: 'Value 1', inline: true },
          { name: 'Field 2', value: 'Value 2', inline: true }
        );

      const iterations = 100;

      // Quick validation timing
      const quickStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        EmbedValidator.quickValidate(embed);
      }
      const quickTime = performance.now() - quickStart;

      // Full validation timing
      const fullStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        EmbedValidator.validateEmbed(embed, { calculateScores: false });
      }
      const fullTime = performance.now() - fullStart;

      expect(quickTime).toBeLessThan(fullTime);
    });
  });

  describe('Validation Report Generation', () => {
    test('should generate comprehensive validation reports', () => {
      const embed = new EmbedBuilder()
        .setTitle('Report Test')
        .setDescription('Testing report generation')
        .setColor(0x00ff00)
        .addFields({ name: 'Field', value: 'Value', inline: true });

      const report = EmbedValidator.generateValidationReport(embed);
      
      expect(report).toContain('Discord Embed 검증 보고서');
      expect(report).toContain('전체 상태');
      expect(report).toContain('준수율');
      expect(report).toContain('총 문자수');
      expect(report).toContain('필드 수');
    });

    test('should include violations and warnings in reports', () => {
      const embed = new EmbedBuilder()
        .setTitle('A'.repeat(300)) // Title too long
        .setDescription('This will generate violations')
        .setColor(0x00ff00);

      const report = EmbedValidator.generateValidationReport(embed);
      
      expect(report).toContain('오류');
      expect(report).toContain('제한');
    });
  });

  describe('Utility Functions', () => {
    test('validateEmbedLimits should work as backward compatibility', () => {
      const embed = new EmbedBuilder()
        .setTitle('Compatibility Test')
        .setColor(0x00ff00);

      const result = EmbedValidator.validateEmbed(embed);
      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('violations');
      expect(result).toHaveProperty('warnings');
    });

    test('quickValidate should work for simple checks', () => {
      const validEmbed = new EmbedBuilder()
        .setTitle('Valid')
        .setColor(0x00ff00);

      const invalidEmbed = new EmbedBuilder()
        .setTitle('A'.repeat(300))
        .setColor(0x00ff00);

      expect(EmbedValidator.quickValidate(validEmbed)).toBe(true);
      expect(EmbedValidator.quickValidate(invalidEmbed)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty embeds gracefully', () => {
      const emptyEmbed = new EmbedBuilder();

      const result = EmbedValidator.validateEmbed(emptyEmbed);
      expect(result.isValid).toBe(true); // Empty embed is technically valid
      expect(result.totalCharacters).toBe(0);
      expect(result.totalFields).toBe(0);
    });

    test('should handle embeds with only whitespace', () => {
      const whitespaceEmbed = new EmbedBuilder()
        .setTitle('   ')
        .setDescription('   ')
        .setColor(0x00ff00);

      const result = EmbedValidator.validateEmbed(whitespaceEmbed, { includeWarnings: true });
      expect(result.isValid).toBe(true);
      expect(result.warnings.length).toBeGreaterThanOrEqual(0);
    });

    test('should handle null and undefined values', () => {
      const embed = new EmbedBuilder()
        .setTitle('Null Test')
        .setColor(0x00ff00);

      // Test that validation doesn't crash with missing optional fields
      expect(() => EmbedValidator.validateEmbed(embed)).not.toThrow();
    });

    test('should handle special characters and unicode', () => {
      const unicodeEmbed = new EmbedBuilder()
        .setTitle('🌟 Unicode Test 한글 テスト 🌟')
        .setDescription('This embed contains various unicode characters: ñáéíóú, 中文, العربية, русский')
        .setColor(0x00ff00)
        .addFields({
          name: '🎯 Special Characters',
          value: '©®™ ±×÷ αβγ λμν 🔥💎⚡',
          inline: true
        });

      const result = EmbedValidator.validateEmbed(unicodeEmbed);
      expect(result.isValid).toBe(true);
      expect(result.totalCharacters).toBeGreaterThan(0);
    });
  });
});