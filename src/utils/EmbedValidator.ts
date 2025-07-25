// src/utils/EmbedValidator.ts - Discord embed comprehensive validator utility
import { EmbedBuilder, ColorResolvable } from 'discord.js';
import { LIMITS } from '../config/constants';

// Validation result types
export interface ValidationResult {
  isValid: boolean;
  violations: ValidationViolation[];
  warnings: ValidationWarning[];
  totalCharacters: number;
  totalFields: number;
  summary: ValidationSummary;
  suggestions: string[];
}

export interface ValidationViolation {
  type: ValidationViolationType;
  field: string;
  current: number | string;
  limit: number | string;
  severity: 'error' | 'critical';
  message: string;
  suggestion?: string;
}

export interface ValidationWarning {
  type: ValidationWarningType;
  field: string;
  current: number | string;
  threshold: number | string;
  message: string;
  suggestion?: string;
}

export interface ValidationSummary {
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  warningCount: number;
  criticalErrors: number;
  overallHealth: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  readabilityScore: number; // 0-100
  performanceScore: number; // 0-100
  complianceScore: number; // 0-100
}

export type ValidationViolationType = 
  | 'field_count_exceeded'
  | 'total_character_limit'
  | 'title_length'
  | 'description_length' 
  | 'field_name_length'
  | 'field_value_length'
  | 'footer_length'
  | 'author_name_length'
  | 'invalid_color'
  | 'invalid_url'
  | 'missing_required_field'
  | 'empty_content';

export type ValidationWarningType =
  | 'approaching_limit'
  | 'readability_concern'
  | 'performance_impact'
  | 'accessibility_issue'
  | 'best_practice_violation'
  | 'formatting_suggestion';

export interface EmbedValidationOptions {
  strictMode?: boolean; // More rigorous validation
  includeWarnings?: boolean; // Include performance and readability warnings
  validateUrls?: boolean; // Validate URL formats
  checkAccessibility?: boolean; // Check for accessibility issues
  calculateScores?: boolean; // Calculate quality scores
  maxRecommendedFields?: number; // Recommended field limit (default: 10)
  maxRecommendedCharacters?: number; // Recommended character limit (default: 4000)
  enableOptimizationSuggestions?: boolean; // Provide optimization tips
}

export interface EmbedOptimizationResult {
  originalEmbed: EmbedBuilder;
  optimizedEmbed: EmbedBuilder;
  optimizations: OptimizationApplied[];
  spacesSaved: number;
  fieldReduction: number;
  readabilityImprovement: number;
}

export interface OptimizationApplied {
  type: 'truncate' | 'compress' | 'merge' | 'split' | 'format';
  field: string;
  description: string;
  beforeSize: number;
  afterSize: number;
}

/**
 * Comprehensive Discord embed validator with advanced validation features
 */
export class EmbedValidator {
  private static readonly DEFAULT_OPTIONS: Required<EmbedValidationOptions> = {
    strictMode: false,
    includeWarnings: true,
    validateUrls: true,
    checkAccessibility: true,
    calculateScores: true,
    maxRecommendedFields: 10,
    maxRecommendedCharacters: 4000,
    enableOptimizationSuggestions: true
  };

  /**
   * Comprehensive embed validation with detailed analysis
   */
  static validateEmbed(
    embed: EmbedBuilder,
    options: EmbedValidationOptions = {}
  ): ValidationResult {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    
    const data = embed.toJSON();
    const violations: ValidationViolation[] = [];
    const warnings: ValidationWarning[] = [];
    const suggestions: string[] = [];
    
    let totalChecks = 0;
    let passedChecks = 0;

    // Core Discord API limit validations
    const coreValidation = this.validateCoreConstraints(data);
    violations.push(...coreValidation.violations);
    totalChecks += coreValidation.totalChecks;
    passedChecks += coreValidation.passedChecks;

    // Field-specific validations
    if (opts.includeWarnings) {
      const fieldValidation = this.validateFieldContent(data, opts);
      warnings.push(...fieldValidation.warnings);
      suggestions.push(...fieldValidation.suggestions);
      totalChecks += fieldValidation.totalChecks;
      passedChecks += fieldValidation.passedChecks;
    }

    // URL validation
    if (opts.validateUrls) {
      const urlValidation = this.validateUrls(data);
      violations.push(...urlValidation.violations);
      warnings.push(...urlValidation.warnings);
      totalChecks += urlValidation.totalChecks;
      passedChecks += urlValidation.passedChecks;
    }

    // Accessibility checks
    if (opts.checkAccessibility) {
      const accessibilityValidation = this.validateAccessibility(data);
      warnings.push(...accessibilityValidation.warnings);
      suggestions.push(...accessibilityValidation.suggestions);
      totalChecks += accessibilityValidation.totalChecks;
      passedChecks += accessibilityValidation.passedChecks;
    }

    // Optimization suggestions
    if (opts.enableOptimizationSuggestions) {
      const optimizationSuggestions = this.generateOptimizationSuggestions(data, opts);
      suggestions.push(...optimizationSuggestions);
    }

    // Calculate metrics
    const totalCharacters = this.calculateTotalCharacters(data);
    const totalFields = data.fields?.length || 0;
    const isValid = violations.filter(v => v.severity === 'error' || v.severity === 'critical').length === 0;
    
    // Generate quality scores
    const summary = opts.calculateScores 
      ? this.calculateQualityScores(data, violations, warnings, totalChecks, passedChecks)
      : this.generateBasicSummary(violations, warnings, totalChecks, passedChecks);

    return {
      isValid,
      violations,
      warnings,
      totalCharacters,
      totalFields,
      summary,
      suggestions
    };
  }

  /**
   * Validate core Discord API constraints
   */
  private static validateCoreConstraints(data: any): {
    violations: ValidationViolation[];
    totalChecks: number;
    passedChecks: number;
  } {
    const violations: ValidationViolation[] = [];
    let totalChecks = 0; 
    let passedChecks = 0;

    // Total character limit (6000)
    totalChecks++;
    const totalChars = this.calculateTotalCharacters(data);
    if (totalChars > LIMITS.MAX_EMBED_DESCRIPTION * 1.5) { // 6000 limit
      violations.push({
        type: 'total_character_limit',
        field: 'embed',
        current: totalChars,
        limit: LIMITS.MAX_EMBED_DESCRIPTION * 1.5,
        severity: 'critical',
        message: `총 문자 수가 Discord 제한(6000자)을 초과했습니다: ${totalChars}자`,
        suggestion: '내용을 축약하거나 여러 임베드로 분할하세요.'
      });
    } else {
      passedChecks++;
    }

    // Field count limit (25)
    totalChecks++;
    const fieldCount = data.fields?.length || 0;
    if (fieldCount > LIMITS.MAX_EMBED_FIELDS) {
      violations.push({
        type: 'field_count_exceeded',
        field: 'fields',
        current: fieldCount,
        limit: LIMITS.MAX_EMBED_FIELDS,
        severity: 'critical',
        message: `필드 수가 Discord 제한(25개)을 초과했습니다: ${fieldCount}개`,
        suggestion: '필드를 여러 임베드로 분할하거나 통합하세요.'
      });
    } else {
      passedChecks++;
    }

    // Title length (256)
    if (data.title) {
      totalChecks++;
      if (data.title.length > LIMITS.MAX_EMBED_TITLE) {
        violations.push({
          type: 'title_length',
          field: 'title',
          current: data.title.length,
          limit: LIMITS.MAX_EMBED_TITLE,
          severity: 'error',
          message: `제목이 Discord 제한(256자)을 초과했습니다: ${data.title.length}자`,
          suggestion: '제목을 축약하세요.'
        });
      } else {
        passedChecks++;
      }
    }

    // Description length (4096)
    if (data.description) {
      totalChecks++;
      if (data.description.length > LIMITS.MAX_EMBED_DESCRIPTION) {
        violations.push({
          type: 'description_length',
          field: 'description',
          current: data.description.length,
          limit: LIMITS.MAX_EMBED_DESCRIPTION,
          severity: 'error',
          message: `설명이 Discord 제한(4096자)을 초과했습니다: ${data.description.length}자`,
          suggestion: '설명을 축약하거나 여러 필드로 분할하세요.'
        });
      } else {
        passedChecks++;
      }
    }

    // Footer length (2048)
    if (data.footer?.text) {
      totalChecks++;
      if (data.footer.text.length > LIMITS.MAX_EMBED_FOOTER) {
        violations.push({
          type: 'footer_length',
          field: 'footer',
          current: data.footer.text.length,
          limit: LIMITS.MAX_EMBED_FOOTER,
          severity: 'error',
          message: `푸터가 Discord 제한(2048자)을 초과했습니다: ${data.footer.text.length}자`,
          suggestion: '푸터 텍스트를 축약하세요.'
        });
      } else {
        passedChecks++;
      }
    }

    // Author name length (256)
    if (data.author?.name) {
      totalChecks++;
      if (data.author.name.length > LIMITS.MAX_EMBED_AUTHOR) {
        violations.push({
          type: 'author_name_length',
          field: 'author',
          current: data.author.name.length,
          limit: LIMITS.MAX_EMBED_AUTHOR,
          severity: 'error',
          message: `작성자 이름이 Discord 제한(256자)을 초과했습니다: ${data.author.name.length}자`,
          suggestion: '작성자 이름을 축약하세요.'
        });
      } else {
        passedChecks++;
      }
    }

    // Field name and value lengths
    if (data.fields) {
      for (let i = 0; i < data.fields.length; i++) {
        const field = data.fields[i];
        
        // Field name length (256)
        totalChecks++;
        if (field.name.length > LIMITS.MAX_EMBED_AUTHOR) {
          violations.push({
            type: 'field_name_length',
            field: `fields[${i}].name`,
            current: field.name.length,
            limit: LIMITS.MAX_EMBED_AUTHOR,
            severity: 'error',
            message: `필드 ${i + 1}의 이름이 Discord 제한(256자)을 초과했습니다: ${field.name.length}자`,
            suggestion: '필드 이름을 축약하세요.'
          });
        } else {
          passedChecks++;
        }

        // Field value length (1024)
        totalChecks++;
        if (field.value.length > 1024) {
          violations.push({
            type: 'field_value_length',
            field: `fields[${i}].value`,
            current: field.value.length,
            limit: 1024,
            severity: 'error',
            message: `필드 ${i + 1}의 값이 Discord 제한(1024자)을 초과했습니다: ${field.value.length}자`,
            suggestion: '필드 값을 축약하거나 여러 필드로 분할하세요.'
          });
        } else {
          passedChecks++;
        }
      }
    }

    return { violations, totalChecks, passedChecks };
  }

  /**
   * Validate field content quality and readability
   */
  private static validateFieldContent(data: any, opts: Required<EmbedValidationOptions>): {
    warnings: ValidationWarning[];
    suggestions: string[];
    totalChecks: number;
    passedChecks: number;
  } {
    const warnings: ValidationWarning[] = [];
    const suggestions: string[] = [];
    let totalChecks = 0;
    let passedChecks = 0;

    const totalChars = this.calculateTotalCharacters(data);
    const fieldCount = data.fields?.length || 0;

    // Approaching limits warnings
    totalChecks++;
    if (totalChars > opts.maxRecommendedCharacters) {
      warnings.push({
        type: 'approaching_limit',
        field: 'embed',
        current: totalChars,
        threshold: opts.maxRecommendedCharacters,
        message: `권장 문자 수(${opts.maxRecommendedCharacters}자)를 초과했습니다: ${totalChars}자`,
        suggestion: '가독성을 위해 내용을 축약하는 것을 고려하세요.'
      });
    } else {
      passedChecks++;
    }

    totalChecks++;
    if (fieldCount > opts.maxRecommendedFields) {
      warnings.push({
        type: 'approaching_limit',
        field: 'fields',
        current: fieldCount,
        threshold: opts.maxRecommendedFields,
        message: `권장 필드 수(${opts.maxRecommendedFields}개)를 초과했습니다: ${fieldCount}개`,
        suggestion: '사용자 경험을 위해 필드 수를 줄이는 것을 고려하세요.'
      });
    } else {
      passedChecks++;
    }

    // Empty content checks
    if (!data.title && !data.description && (!data.fields || data.fields.length === 0)) {
      warnings.push({
        type: 'readability_concern',
        field: 'content',
        current: '빈 임베드',
        threshold: '최소 내용',
        message: '임베드에 의미있는 내용이 없습니다.',
        suggestion: '제목, 설명 또는 필드를 추가하세요.'
      });
    }

    // Readability analysis
    if (data.fields) {
      for (let i = 0; i < data.fields.length; i++) {
        const field = data.fields[i];
        totalChecks++;
        
        if (field.value.length < 10) {
          warnings.push({
            type: 'readability_concern',
            field: `fields[${i}]`,
            current: field.value.length,
            threshold: 10,
            message: `필드 ${i + 1}의 내용이 너무 짧습니다: ${field.value.length}자`,
            suggestion: '더 자세한 정보를 제공하거나 필드를 통합하세요.'
          });
        } else {
          passedChecks++;
        }

        // Check for empty field names
        totalChecks++;
        if (!field.name.trim()) {
          warnings.push({
            type: 'readability_concern',
            field: `fields[${i}].name`,
            current: '빈 이름',
            threshold: '의미있는 이름',
            message: `필드 ${i + 1}의 이름이 비어있습니다.`,
            suggestion: '필드에 설명적인 이름을 추가하세요.'
          });
        } else {
          passedChecks++;
        }
      }
    }

    // Color validation
    if (data.color !== undefined) {
      totalChecks++;
      if (!this.isValidColor(data.color)) {
        warnings.push({
          type: 'best_practice_violation',
          field: 'color',
          current: data.color,
          threshold: '유효한 색상',
          message: '색상 값이 유효하지 않습니다.',
          suggestion: '0x000000 ~ 0xFFFFFF 범위의 16진수 값을 사용하세요.'
        });
      } else {
        passedChecks++;
      }
    }

    return { warnings, suggestions, totalChecks, passedChecks };
  }

  /**
   * Validate URL formats in embed
   */
  private static validateUrls(data: any): {
    violations: ValidationViolation[];
    warnings: ValidationWarning[];
    totalChecks: number;
    passedChecks: number;
  } {
    const violations: ValidationViolation[] = [];
    const warnings: ValidationWarning[] = [];
    let totalChecks = 0;
    let passedChecks = 0;

    const urlFields = [
      { field: 'url', value: data.url },
      { field: 'thumbnail.url', value: data.thumbnail?.url },
      { field: 'image.url', value: data.image?.url },
      { field: 'author.url', value: data.author?.url },
      { field: 'author.icon_url', value: data.author?.icon_url },
      { field: 'footer.icon_url', value: data.footer?.icon_url }
    ];

    for (const { field, value } of urlFields) {
      if (value) {
        totalChecks++;
        if (!this.isValidUrl(value)) {
          violations.push({
            type: 'invalid_url',
            field,
            current: value,
            limit: '유효한 URL',
            severity: 'error',
            message: `잘못된 URL 형식입니다: ${field}`,
            suggestion: 'https:// 또는 http://로 시작하는 유효한 URL을 사용하세요.'
          });
        } else {
          passedChecks++;
        }
      }
    }

    return { violations, warnings, totalChecks, passedChecks };
  }

  /**
   * Validate accessibility considerations
   */
  private static validateAccessibility(data: any): {
    warnings: ValidationWarning[];
    suggestions: string[];
    totalChecks: number;
    passedChecks: number;
  } {
    const warnings: ValidationWarning[] = [];
    const suggestions: string[] = [];
    let totalChecks = 0;
    let passedChecks = 0;

    // Color contrast concerns
    if (data.color !== undefined) {
      totalChecks++;
      const colorValue = typeof data.color === 'number' ? data.color : parseInt(data.color);
      if (this.isLowContrastColor(colorValue)) {
        warnings.push({
          type: 'accessibility_issue',
          field: 'color',
          current: `#${colorValue.toString(16).padStart(6, '0')}`,
          threshold: '충분한 대비',
          message: '색상의 대비가 낮아 가시성이 떨어질 수 있습니다.',
          suggestion: '더 진한 색상이나 밝은 색상을 사용하세요.'
        });
      } else {
        passedChecks++;
      }
    }

    // Alt text for images
    if (data.image?.url) {
      totalChecks++;
      // Discord embeds don't support alt text, but we can suggest using description
      if (!data.description?.includes('이미지') && !data.description?.includes('그림')) {
        warnings.push({
          type: 'accessibility_issue',
          field: 'image',
          current: '설명 없음',
          threshold: '이미지 설명',
          message: '이미지에 대한 설명이 없습니다.',
          suggestion: '설명에 이미지 내용을 포함하세요.'
        });
      } else {
        passedChecks++;
      }
    }

    // Excessive emoji usage
    const textContent = [data.title, data.description, ...(data.fields?.map((f: any) => f.name + f.value) || [])].join(' ');
    if (textContent) {
      totalChecks++;
      const emojiCount = (textContent.match(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu) || []).length;
      const textLength = textContent.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').length;
      
      if (textLength > 0 && emojiCount / textLength > 0.1) {
        warnings.push({
          type: 'accessibility_issue',
          field: 'content',
          current: `${Math.round(emojiCount / textLength * 100)}%`,
          threshold: '10%',
          message: '이모지 사용 비율이 높아 스크린 리더 사용자에게 방해가 될 수 있습니다.',
          suggestion: '이모지 사용을 줄이고 텍스트 설명을 늘리세요.'
        });
      } else {
        passedChecks++;
      }
    }

    return { warnings, suggestions, totalChecks, passedChecks };
  }

  /**
   * Generate optimization suggestions
   */
  private static generateOptimizationSuggestions(data: any, opts: Required<EmbedValidationOptions>): string[] {
    const suggestions: string[] = [];
    
    const totalChars = this.calculateTotalCharacters(data);
    const fieldCount = data.fields?.length || 0;

    if (totalChars > opts.maxRecommendedCharacters * 0.8) {
      suggestions.push('💡 내용 최적화: 중요하지 않은 세부사항을 제거하여 가독성을 높이세요.');
    }

    if (fieldCount > opts.maxRecommendedFields * 0.8) {
      suggestions.push('💡 필드 최적화: 유사한 필드들을 통합하여 정보를 더 체계적으로 구성하세요.');
    }

    if (data.fields?.some((f: any) => f.value.length > 800)) {
      suggestions.push('💡 필드 길이 최적화: 긴 필드 값을 여러 필드로 분할하여 읽기 쉽게 만드세요.');
    }

    if (!data.title && data.description) {
      suggestions.push('💡 구조 개선: 설명의 일부를 제목으로 사용하여 임베드의 목적을 명확히 하세요.');
    }

    if (data.fields?.some((f: any) => !f.name.trim())) {
      suggestions.push('💡 필드 이름: 모든 필드에 의미있는 이름을 추가하세요.');
    }

    return suggestions;
  }

  /**
   * Calculate quality scores
   */
  private static calculateQualityScores(
    data: any,
    violations: ValidationViolation[],
    warnings: ValidationWarning[],
    totalChecks: number,
    passedChecks: number
  ): ValidationSummary {
    const criticalErrors = violations.filter(v => v.severity === 'critical').length;
    const regularErrors = violations.filter(v => v.severity === 'error').length;
    const warningCount = warnings.length;

    // Compliance score (0-100)
    const complianceScore = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 100;

    // Readability score (0-100)
    const totalChars = this.calculateTotalCharacters(data);
    const fieldCount = data.fields?.length || 0;
    let readabilityScore = 100;
    
    if (totalChars > 4000) readabilityScore -= Math.min(30, (totalChars - 4000) / 100);
    if (fieldCount > 10) readabilityScore -= Math.min(20, (fieldCount - 10) * 2);
    if (!data.title) readabilityScore -= 10;
    if (warningCount > 5) readabilityScore -= Math.min(20, (warningCount - 5) * 2);
    
    readabilityScore = Math.max(0, Math.round(readabilityScore));

    // Performance score (0-100)
    let performanceScore = 100;
    if (totalChars > 5000) performanceScore -= 20;
    if (fieldCount > 15) performanceScore -= 15;
    if (criticalErrors > 0) performanceScore -= 30;
    if (regularErrors > 0) performanceScore -= 15;
    
    performanceScore = Math.max(0, Math.round(performanceScore));

    // Overall health
    let overallHealth: ValidationSummary['overallHealth'] = 'excellent';
    if (criticalErrors > 0) overallHealth = 'critical';
    else if (regularErrors > 2 || performanceScore < 60) overallHealth = 'poor';
    else if (regularErrors > 0 || performanceScore < 80) overallHealth = 'fair';
    else if (warningCount > 3 || readabilityScore < 90) overallHealth = 'good';

    return {
      totalChecks,
      passedChecks,
      failedChecks: totalChecks - passedChecks,
      warningCount,
      criticalErrors,
      overallHealth,
      readabilityScore,
      performanceScore,
      complianceScore
    };
  }

  /**
   * Generate basic validation summary
   */
  private static generateBasicSummary(
    violations: ValidationViolation[],
    warnings: ValidationWarning[],
    totalChecks: number,
    passedChecks: number
  ): ValidationSummary {
    const criticalErrors = violations.filter(v => v.severity === 'critical').length;
    const failedChecks = totalChecks - passedChecks;
    
    let overallHealth: ValidationSummary['overallHealth'] = 'excellent';
    if (criticalErrors > 0) overallHealth = 'critical';
    else if (failedChecks > 2) overallHealth = 'poor';
    else if (failedChecks > 0) overallHealth = 'fair';
    else if (warnings.length > 3) overallHealth = 'good';

    return {
      totalChecks,
      passedChecks,
      failedChecks,
      warningCount: warnings.length,
      criticalErrors,
      overallHealth,
      readabilityScore: 0,
      performanceScore: 0,
      complianceScore: totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 100
    };
  }

  /**
   * Calculate total character count for embed
   */
  private static calculateTotalCharacters(data: any): number {
    let length = 0;

    if (data.title) length += data.title.length;
    if (data.description) length += data.description.length;
    if (data.footer?.text) length += data.footer.text.length;
    if (data.author?.name) length += data.author.name.length;

    if (data.fields) {
      for (const field of data.fields) {
        length += field.name.length + field.value.length;
      }
    }

    return length;
  }

  /**
   * Validate color value
   */
  private static isValidColor(color: any): boolean {
    if (typeof color === 'number') {
      return color >= 0 && color <= 0xFFFFFF;
    }
    if (typeof color === 'string') {
      const hex = color.replace('#', '');
      return /^[0-9A-Fa-f]{6}$/.test(hex);
    }
    return false;
  }

  /**
   * Validate URL format
   */
  private static isValidUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Check if color has low contrast
   */
  private static isLowContrastColor(color: number): boolean {
    // Convert to RGB
    const r = (color >> 16) & 255;
    const g = (color >> 8) & 255;
    const b = color & 255;
    
    // Calculate luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    
    // Consider very light or very dark colors as potentially low contrast
    return luminance < 0.2 || luminance > 0.8;
  }

  /**
   * Optimize embed for better performance and readability
   */
  static optimizeEmbed(
    embed: EmbedBuilder,
    options: EmbedValidationOptions = {}
  ): EmbedOptimizationResult {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    const originalData = embed.toJSON();
    const optimizedEmbed = EmbedBuilder.from(originalData);
    const optimizations: OptimizationApplied[] = [];
    
    let originalSize = this.calculateTotalCharacters(originalData);
    
    // Apply optimizations based on validation results
    const validation = this.validateEmbed(embed, options);
    
    // Truncate overly long fields
    const optimizedData = optimizedEmbed.toJSON();
    if (optimizedData.fields) {
      for (let i = 0; i < optimizedData.fields.length; i++) {
        const field = optimizedData.fields[i];
        if (field.value.length > 800) {
          const beforeSize = field.value.length;
          const truncated = field.value.substring(0, 800) + '...';
          optimizedData.fields[i].value = truncated;
          
          optimizations.push({
            type: 'truncate',
            field: `fields[${i}].value`,
            description: '긴 필드 값을 잘라내었습니다',
            beforeSize,
            afterSize: truncated.length
          });
        }
      }
    }
    
    // Apply optimized data
    const finalEmbed = EmbedBuilder.from(optimizedData);
    const finalSize = this.calculateTotalCharacters(optimizedData);
    
    const spacesSaved = originalSize - finalSize;
    const fieldReduction = (originalData.fields?.length || 0) - (optimizedData.fields?.length || 0);
    const readabilityImprovement = validation.summary.readabilityScore;
    
    return {
      originalEmbed: embed,
      optimizedEmbed: finalEmbed,
      optimizations,
      spacesSaved,
      fieldReduction,
      readabilityImprovement
    };
  }

  /**
   * Quick validation check for basic Discord limits
   */
  static quickValidate(embed: EmbedBuilder): boolean {
    const data = embed.toJSON();
    const totalChars = this.calculateTotalCharacters(data);
    const fieldCount = data.fields?.length || 0;

    if (totalChars > 6000) return false;
    if (fieldCount > 25) return false;
    if (data.title && data.title.length > 256) return false;
    if (data.description && data.description.length > 4096) return false;
    if (data.footer?.text && data.footer.text.length > 2048) return false;

    if (data.fields) {
      for (const field of data.fields) {
        if (field.name.length > 256) return false;
        if (field.value.length > 1024) return false;
      }
    }

    return true;
  }

  /**
   * Generate a comprehensive validation report
   */
  static generateValidationReport(embed: EmbedBuilder, options: EmbedValidationOptions = {}): string {
    const validation = this.validateEmbed(embed, options);
    const report: string[] = [];

    report.push('📋 **Discord Embed 검증 보고서**');
    report.push('=' .repeat(40));
    report.push('');

    // Summary
    const healthEmoji = {
      excellent: '🟢',
      good: '🟡',
      fair: '🟠',
      poor: '🔴',
      critical: '💀'
    }[validation.summary.overallHealth];

    report.push(`${healthEmoji} **전체 상태**: ${validation.summary.overallHealth.toUpperCase()}`);
    report.push(`📊 **준수율**: ${validation.summary.complianceScore}% (${validation.summary.passedChecks}/${validation.summary.totalChecks})`);
    report.push(`📝 **총 문자수**: ${validation.totalCharacters}/6000`);
    report.push(`📑 **필드 수**: ${validation.totalFields}/25`);
    report.push('');

    // Violations
    if (validation.violations.length > 0) {
      report.push('❌ **오류**:');
      validation.violations.forEach(violation => {
        const severity = violation.severity === 'critical' ? '🚨' : '⚠️';
        report.push(`  ${severity} ${violation.message}`);
        if (violation.suggestion) {
          report.push(`     💡 ${violation.suggestion}`);
        }
      });
      report.push('');
    }

    // Warnings
    if (validation.warnings.length > 0) {
      report.push('⚠️ **경고**:');
      validation.warnings.forEach(warning => {
        report.push(`  • ${warning.message}`);
        if (warning.suggestion) {
          report.push(`    💡 ${warning.suggestion}`);
        }
      });
      report.push('');
    }

    // Suggestions
    if (validation.suggestions.length > 0) {
      report.push('💡 **최적화 제안**:');
      validation.suggestions.forEach(suggestion => {
        report.push(`  • ${suggestion}`);
      });
      report.push('');
    }

    // Quality scores (if calculated)
    if (options.calculateScores !== false) {
      report.push('📈 **품질 점수**:');
      report.push(`  • 가독성: ${validation.summary.readabilityScore}/100`);
      report.push(`  • 성능: ${validation.summary.performanceScore}/100`);
      report.push(`  • 준수성: ${validation.summary.complianceScore}/100`);
    }

    return report.join('\n');
  }
}

// Utility functions for backward compatibility with existing embedBuilder.ts
export function validateEmbedLimits(embed: EmbedBuilder): ValidationResult {
  return EmbedValidator.validateEmbed(embed);
}

export function isEmbedValid(embed: EmbedBuilder): boolean {
  return EmbedValidator.quickValidate(embed);
}

export function getEmbedValidationReport(embed: EmbedBuilder): string {
  return EmbedValidator.generateValidationReport(embed);
}

export { EmbedValidator as default };