// src/utils/inputValidator.js - 포괄적 입력 검증 및 보안 처리

/**
 * 포괄적 입력 검증 및 정화 메인 함수
 * @param {string} text - 검증할 텍스트
 * @param {object} options - 검증 옵션
 * @returns {object} - {isValid, sanitizedText, errors, warnings}
 */
export function validateAndSanitizeInput(text, options = {}) {
  const config = {
    maxLength: options.maxLength || 2000,
    minLength: options.minLength || 1,
    allowUrls: options.allowUrls !== false,
    strictMode: options.strictMode || false,
    fieldName: options.fieldName || 'input'
  };

  const result = {
    isValid: true,
    sanitizedText: text,
    errors: [],
    warnings: []
  };

  try {
    // 1. 기본 유효성 검사
    if (!text || typeof text !== 'string') {
      result.errors.push('입력 텍스트가 유효하지 않습니다.');
      result.isValid = false;
      return result;
    }

    // 2. 길이 검증
    const lengthResult = validateLength(text, config.minLength, config.maxLength);
    if (!lengthResult.isValid) {
      result.errors.push(...lengthResult.errors);
      result.isValid = false;
    }

    // 3. JSON 안전성 처리
    result.sanitizedText = sanitizeJsonUnsafeChars(result.sanitizedText);

    // 4. 보안 위험 요소 제거
    const securityResult = removeSecurityThreats(result.sanitizedText, config.strictMode);
    result.sanitizedText = securityResult.sanitizedText;
    if (securityResult.threatsFound.length > 0) {
      result.warnings.push(`보안 위험 요소가 제거되었습니다: ${securityResult.threatsFound.join(', ')}`);
      console.warn(`[InputValidator] 보안 위험 입력 감지: ${securityResult.threatsFound.join(', ')}`, {
        originalText: text.substring(0, 100),
        fieldName: config.fieldName
      });
    }

    // 5. 스팸 패턴 필터링
    const spamResult = filterSpamPatterns(result.sanitizedText);
    result.sanitizedText = spamResult.sanitizedText;
    if (spamResult.patternsFound.length > 0) {
      result.warnings.push(`스팸 패턴이 정리되었습니다: ${spamResult.patternsFound.join(', ')}`);
    }

    // 6. 디스코드 요소 정규화
    const discordResult = normalizeDiscordElements(result.sanitizedText, config.allowUrls);
    result.sanitizedText = discordResult.sanitizedText;
    if (discordResult.normalized.length > 0) {
      result.warnings.push(`디스코드 요소가 정리되었습니다: ${discordResult.normalized.join(', ')}`);
    }

    // 7. 최종 안전성 검사
    if (!isJsonSafe(result.sanitizedText)) {
      result.errors.push('텍스트가 여전히 JSON 안전하지 않습니다.');
      result.isValid = false;
    }

    // 8. 빈 텍스트 검사 (정화 후)
    if (result.sanitizedText.trim().length === 0) {
      result.errors.push('유효한 내용이 없습니다.');
      result.isValid = false;
    }

  } catch (error) {
    console.error('[InputValidator] 입력 검증 중 오류 발생:', error);
    result.errors.push('입력 검증 중 오류가 발생했습니다.');
    result.isValid = false;
  }

  return result;
}

/**
 * JSON 파괴 문자 정화
 * @param {string} text 
 * @returns {string}
 */
export function sanitizeJsonUnsafeChars(text) {
  return text
    // 큰따옴표를 작은따옴표로 대체
    .replace(/"/g, "'")
    // 백슬래시 이스케이프
    .replace(/\\/g, "\\\\")
    // 제어문자를 공백으로 대체
    .replace(/[\r\n\t]/g, ' ')
    // 연속된 공백 정리
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 보안 위험 요소 제거
 * @param {string} text 
 * @param {boolean} strictMode 
 * @returns {object}
 */
export function removeSecurityThreats(text, strictMode = false) {
  const threats = [];
  let sanitized = text;

  // XSS 패턴
  const xssPatterns = [
    /<script[\s\S]*?<\/script>/gi,
    /<iframe[\s\S]*?<\/iframe>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<[^>]*on\w+\s*=.*?>/gi
  ];

  xssPatterns.forEach((pattern, index) => {
    if (pattern.test(sanitized)) {
      threats.push('XSS 패턴');
      sanitized = sanitized.replace(pattern, '');
    }
  });

  // SQL 인젝션 패턴
  const sqlPatterns = [
    /[';]|--|union\s+select|drop\s+table|insert\s+into|update\s+set/gi,
    /\s+(or|and)\s+.*(=|like)/gi
  ];

  sqlPatterns.forEach(pattern => {
    if (pattern.test(sanitized)) {
      threats.push('SQL 인젝션 패턴');
      sanitized = sanitized.replace(pattern, '');
    }
  });

  // 명령 인젝션 패턴
  const commandPatterns = [
    /\$\([^)]*\)/g,
    /`[^`]*`/g,
    /(&&|\|\|)/g
  ];

  if (strictMode) {
    commandPatterns.forEach(pattern => {
      if (pattern.test(sanitized)) {
        threats.push('명령 인젝션 패턴');
        sanitized = sanitized.replace(pattern, '');
      }
    });
  }

  return {
    sanitizedText: sanitized,
    threatsFound: [...new Set(threats)]
  };
}

/**
 * 스팸 패턴 필터링
 * @param {string} text 
 * @returns {object}
 */
export function filterSpamPatterns(text) {
  const patterns = [];
  let sanitized = text;

  // 과도한 반복 문자 (5개 이상)
  const repeatedChars = /(.)\1{4,}/g;
  if (repeatedChars.test(sanitized)) {
    patterns.push('반복 문자');
    sanitized = sanitized.replace(repeatedChars, (match, char) => char.repeat(3));
  }

  // 과도한 특수문자
  const excessiveSpecial = /[!@#$%^&*()_+=\[\]{}|;:,.<>?]{5,}/g;
  if (excessiveSpecial.test(sanitized)) {
    patterns.push('과도한 특수문자');
    sanitized = sanitized.replace(excessiveSpecial, (match) => match.substring(0, 3));
  }

  // 과도한 이모지 (10개 이상 연속)
  const excessiveEmoji = /([\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]){10,}/gu;
  if (excessiveEmoji.test(sanitized)) {
    patterns.push('과도한 이모지');
    sanitized = sanitized.replace(excessiveEmoji, (match) => match.substring(0, 30));
  }

  return {
    sanitizedText: sanitized,
    patternsFound: [...new Set(patterns)]
  };
}

/**
 * 디스코드 요소 정규화
 * @param {string} text 
 * @param {boolean} allowUrls 
 * @returns {object}
 */
export function normalizeDiscordElements(text, allowUrls = true) {
  const normalized = [];
  let sanitized = text;

  // @everyone, @here 남용 방지 (2개 이상)
  const everyoneCount = (sanitized.match(/@everyone/g) || []).length;
  const hereCount = (sanitized.match(/@here/g) || []).length;
  
  if (everyoneCount > 1) {
    normalized.push('@everyone 제한');
    sanitized = sanitized.replace(/@everyone/g, '@everyone').replace(/@everyone.*@everyone/g, '@everyone');
  }
  
  if (hereCount > 1) {
    normalized.push('@here 제한');
    sanitized = sanitized.replace(/@here/g, '@here').replace(/@here.*@here/g, '@here');
  }

  // URL 처리
  if (!allowUrls) {
    const urlPattern = /https?:\/\/[^\s]+/g;
    if (urlPattern.test(sanitized)) {
      normalized.push('URL 제거');
      sanitized = sanitized.replace(urlPattern, '[링크 제거됨]');
    }
  }

  // 과도한 마크다운 (볼드, 이탤릭 등) 정리
  const excessiveMarkdown = /(\*{3,}|_{3,}|~{3,}|`{3,})/g;
  if (excessiveMarkdown.test(sanitized)) {
    normalized.push('마크다운 정리');
    sanitized = sanitized.replace(/\*{3,}/g, '**').replace(/_{3,}/g, '__').replace(/~{3,}/g, '~~');
  }

  return {
    sanitizedText: sanitized,
    normalized: [...new Set(normalized)]
  };
}

/**
 * 길이 검증
 * @param {string} text 
 * @param {number} minLength 
 * @param {number} maxLength 
 * @returns {object}
 */
export function validateLength(text, minLength = 1, maxLength = 2000) {
  const errors = [];
  const trimmedLength = text.trim().length;

  if (trimmedLength < minLength) {
    errors.push(`최소 ${minLength}자 이상 입력해주세요. (현재: ${trimmedLength}자)`);
  }

  if (trimmedLength > maxLength) {
    errors.push(`최대 ${maxLength}자까지 입력 가능합니다. (현재: ${trimmedLength}자)`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * JSON 안전성 검사
 * @param {string} text 
 * @returns {boolean}
 */
export function isJsonSafe(text) {
  try {
    // JSON 객체에 넣어서 파싱 테스트
    const testObj = { test: text };
    JSON.stringify(testObj);
    JSON.parse(JSON.stringify(testObj));
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 위험 요소 감지
 * @param {string} text 
 * @returns {object}
 */
export function containsThreats(text) {
  const threats = {
    xss: /<script|javascript:|on\w+\s*=/i.test(text),
    sqlInjection: /(union\s+select|drop\s+table|'|;|--)/i.test(text),
    commandInjection: /\$\(|`.*`|&&|\|\|/.test(text),
    jsonUnsafe: !isJsonSafe(text)
  };

  return {
    hasThreats: Object.values(threats).some(threat => threat),
    threats
  };
}

/**
 * 검증 오류 메시지 생성
 * @param {array} errors 
 * @param {array} warnings 
 * @param {string} fieldName 
 * @returns {string}
 */
export function getValidationErrorMessage(errors = [], warnings = [], fieldName = '입력') {
  let message = '';

  if (errors.length > 0) {
    message += `❌ **${fieldName} 오류:**\n`;
    errors.forEach(error => {
      message += `• ${error}\n`;
    });
  }

  if (warnings.length > 0) {
    message += `⚠️ **${fieldName} 경고:**\n`;
    warnings.forEach(warning => {
      message += `• ${warning}\n`;
    });
  }

  if (!message) {
    message = `✅ ${fieldName}이(가) 안전하게 처리되었습니다.`;
  }

  return message;
}

/**
 * 특정 용도별 사전 정의된 검증 설정
 */
export const VALIDATION_PRESETS = {
  TITLE: {
    maxLength: 100,
    minLength: 2,
    allowUrls: false,
    strictMode: true,
    fieldName: '제목'
  },
  CONTENT: {
    maxLength: 2000,
    minLength: 10,
    allowUrls: true,
    strictMode: false,
    fieldName: '내용'
  },
  USERNAME: {
    maxLength: 32,
    minLength: 2,
    allowUrls: false,
    strictMode: true,
    fieldName: '사용자명'
  },
  DESCRIPTION: {
    maxLength: 500,
    minLength: 5,
    allowUrls: true,
    strictMode: false,
    fieldName: '설명'
  }
};

export default {
  validateAndSanitizeInput,
  sanitizeJsonUnsafeChars,
  removeSecurityThreats,
  filterSpamPatterns,
  normalizeDiscordElements,
  validateLength,
  isJsonSafe,
  containsThreats,
  getValidationErrorMessage,
  VALIDATION_PRESETS
};