import { describe, expect, it } from 'vitest';

import {
  containsThreats,
  isJsonSafe,
  normalizeDiscordElements,
  removeSecurityThreats,
  sanitizeJsonUnsafeChars,
  validateAndSanitizeInput,
  validateLength,
} from '../../src/utils/inputValidator.js';

describe('validateLength', () => {
  it('rejects a trimmed value below the minimum', () => {
    const result = validateLength(' a ', 2, 4);
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it('accepts values on the minimum and maximum boundaries', () => {
    expect(validateLength('ab', 2, 4).isValid).toBe(true);
    expect(validateLength('abcd', 2, 4).isValid).toBe(true);
  });

  it('rejects a value one character over the maximum', () => {
    const result = validateLength('abcde', 2, 4);
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});

describe('JSON safety helpers', () => {
  it('normalizes quotes, backslashes, controls, and whitespace', () => {
    expect(sanitizeJsonUnsafeChars('  "a"\\b\n\tc  ')).toBe("'a'\\\\b c");
  });

  it('recognizes ordinary and escaped text as JSON-safe', () => {
    expect(isJsonSafe('plain text')).toBe(true);
    expect(isJsonSafe('quote " and slash \\')).toBe(true);
  });
});

describe('security helpers', () => {
  it('removes XSS and SQL patterns in non-strict mode but keeps commands', () => {
    const result = removeSecurityThreats('<script>x</script> SELECT -- $(date)', false);
    expect(result.sanitizedText).toBe(' SELECT  $(date)');
    expect(result.threatsFound).toEqual(['XSS 패턴', 'SQL 인젝션 패턴']);
  });

  it('also removes command injection patterns in strict mode', () => {
    const result = removeSecurityThreats('safe $(date) && `whoami`', true);
    expect(result.sanitizedText).toBe('safe   ');
    expect(result.threatsFound).toContain('명령 인젝션 패턴');
  });

  it('detects distinct threat categories', () => {
    const result = containsThreats('<script>x</script> UNION SELECT 1 && echo');
    expect(result.hasThreats).toBe(true);
    expect(result.threats).toMatchObject({
      xss: true,
      sqlInjection: true,
      commandInjection: true,
    });
  });
});

describe('normalizeDiscordElements', () => {
  it('preserves URLs when they are allowed', () => {
    const result = normalizeDiscordElements('visit https://example.com', true);
    expect(result.sanitizedText).toBe('visit https://example.com');
    expect(result.normalized).toEqual([]);
  });

  it('replaces URLs when they are not allowed', () => {
    const result = normalizeDiscordElements('visit https://example.com now', false);
    expect(result.sanitizedText).toBe('visit [링크 제거됨] now');
    expect(result.normalized).toContain('URL 제거');
  });
});

describe('validateAndSanitizeInput', () => {
  it('accepts and normalizes ordinary input', () => {
    const result = validateAndSanitizeInput('  hello   world  ', { minLength: 2 });
    expect(result).toMatchObject({
      isValid: true,
      sanitizedText: 'hello world',
      errors: [],
      warnings: [],
    });
  });

  it('sanitizes threat-bearing input and reports a warning', () => {
    const result = validateAndSanitizeInput('<script>alert(1)</script> safe', {
      strictMode: true,
    });
    expect(result.isValid).toBe(true);
    expect(result.sanitizedText).toBe(' safe');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('XSS 패턴');
  });
});
