// src/examples/EmbedValidatorExamples.ts - Discord embed validator usage examples
import { EmbedBuilder } from 'discord.js';
import { EmbedValidator } from '../utils/EmbedValidator.js';

/**
 * Discord embed validator 사용 예제 모음
 */
export class EmbedValidatorExamples {
  
  /**
   * 예제 1: 기본 검증 - 유효한 임베드
   */
  static example1_ValidEmbed(): void {
    console.log('🟢 예제 1: 유효한 임베드 검증');
    console.log('=' .repeat(50));

    const validEmbed = new EmbedBuilder()
      .setTitle('📊 활동 보고서')
      .setDescription('이번 주 멤버들의 활동 현황입니다.')
      .setColor(0x00ff00)
      .addFields(
        { name: '달성 멤버', value: '10명', inline: true },
        { name: '미달성 멤버', value: '5명', inline: true },
        { name: '잠수 멤버', value: '2명', inline: true }
      )
      .setFooter({ text: '생성일: 2024-01-15' })
      .setTimestamp();

    const validation = EmbedValidator.validateEmbed(validEmbed);
    
    console.log(`✅ 검증 결과: ${validation.isValid ? 'PASS' : 'FAIL'}`);
    console.log(`📊 준수율: ${validation.summary.complianceScore}%`);
    console.log(`📝 총 문자수: ${validation.totalCharacters}/6000`);
    console.log(`📑 필드 수: ${validation.totalFields}/25`);
    console.log(`🏥 전체 상태: ${validation.summary.overallHealth.toUpperCase()}`);
    
    if (validation.warnings.length > 0) {
      console.log(`⚠️ 경고 ${validation.warnings.length}개:`);
      validation.warnings.forEach(warning => {
        console.log(`   • ${warning.message}`);
      });
    }

    if (validation.suggestions.length > 0) {
      console.log(`💡 최적화 제안:`);
      validation.suggestions.forEach(suggestion => {
        console.log(`   • ${suggestion}`);
      });
    }

    console.log('');
  }

  /**
   * 예제 2: 제한 초과 - 필드 수 초과 (25개 제한)
   */
  static example2_FieldCountExceeded(): void {
    console.log('🔴 예제 2: 필드 수 제한 초과 (25개 제한)');
    console.log('=' .repeat(50));

    const overFieldEmbed = new EmbedBuilder()
      .setTitle('📊 대용량 멤버 리스트')
      .setDescription('모든 멤버의 상세 활동 정보입니다.')
      .setColor(0xff0000);

    // 30개 필드 추가 (Discord 제한 25개 초과)
    for (let i = 1; i <= 30; i++) {
      overFieldEmbed.addFields({
        name: `멤버 ${i}`,
        value: `활동시간: ${i * 2}시간 ${(i * 30) % 60}분\n역할: ${i % 3 === 0 ? '관리자' : '회원'}`,
        inline: true
      });
    }

    const validation = EmbedValidator.validateEmbed(overFieldEmbed);
    
    console.log(`❌ 검증 결과: ${validation.isValid ? 'PASS' : 'FAIL'}`);
    console.log(`📊 준수율: ${validation.summary.complianceScore}%`);
    console.log(`📑 필드 수: ${validation.totalFields}/25 (${validation.totalFields - 25}개 초과)`);
    
    console.log(`🚨 치명적 오류 ${validation.violations.filter(v => v.severity === 'critical').length}개:`);
    validation.violations
      .filter(v => v.severity === 'critical')
      .forEach(violation => {
        console.log(`   • ${violation.message}`);
        if (violation.suggestion) {
          console.log(`     💡 ${violation.suggestion}`);
        }
      });

    console.log('');
  }

  /**
   * 예제 3: 문자 수 제한 초과 (6000자 제한)
   */
  static example3_CharacterLimitExceeded(): void {
    console.log('🔴 예제 3: 총 문자 수 제한 초과 (6000자 제한)');
    console.log('=' .repeat(50));

    const longTextEmbed = new EmbedBuilder()
      .setTitle('📚 매우 긴 설명을 가진 임베드')
      .setDescription('A'.repeat(4500)) // 4500자 설명
      .setColor(0xff0000);

    // 각각 200자씩 15개 필드 추가 (총 3000자)
    for (let i = 1; i <= 15; i++) {
      longTextEmbed.addFields({
        name: `섹션 ${i}`,
        value: 'B'.repeat(200),
        inline: false
      });
    }

    const validation = EmbedValidator.validateEmbed(longTextEmbed);
    
    console.log(`❌ 검증 결과: ${validation.isValid ? 'PASS' : 'FAIL'}`);
    console.log(`📝 총 문자수: ${validation.totalCharacters}/6000 (${validation.totalCharacters - 6000}자 초과)`);
    
    validation.violations.forEach(violation => {
      const severity = violation.severity === 'critical' ? '🚨' : '⚠️';
      console.log(`${severity} ${violation.message}`);
      if (violation.suggestion) {
        console.log(`     💡 ${violation.suggestion}`);
      }
    });

    console.log('');
  }

  /**
   * 예제 4: 필드 값 길이 초과 (1024자 제한)
   */
  static example4_FieldValueLengthExceeded(): void {
    console.log('🔴 예제 4: 필드 값 길이 초과 (1024자 제한)');
    console.log('=' .repeat(50));

    const longFieldEmbed = new EmbedBuilder()
      .setTitle('📋 긴 필드 값 테스트')
      .setDescription('필드 값이 너무 긴 경우의 검증 테스트입니다.')
      .setColor(0xff0000)
      .addFields(
        { name: '정상 필드', value: '이것은 정상적인 길이의 필드입니다.', inline: false },
        { name: '초과 필드', value: 'C'.repeat(1100), inline: false }, // 1100자 (1024자 초과)
        { name: '또 다른 초과 필드', value: 'D'.repeat(1500), inline: false } // 1500자 초과
      );

    const validation = EmbedValidator.validateEmbed(longFieldEmbed);
    
    console.log(`❌ 검증 결과: ${validation.isValid ? 'PASS' : 'FAIL'}`);
    
    const fieldErrors = validation.violations.filter(v => v.type === 'field_value_length');
    console.log(`📑 필드 값 길이 오류 ${fieldErrors.length}개:`);
    fieldErrors.forEach(violation => {
      console.log(`   • ${violation.message}`);
      if (violation.suggestion) {
        console.log(`     💡 ${violation.suggestion}`);
      }
    });

    console.log('');
  }

  /**
   * 예제 5: 제목과 설명 길이 검증
   */
  static example5_TitleDescriptionValidation(): void {
    console.log('🔴 예제 5: 제목과 설명 길이 검증');
    console.log('=' .repeat(50));

    const longTitleEmbed = new EmbedBuilder()
      .setTitle('A'.repeat(300)) // 256자 제한 초과
      .setDescription('B'.repeat(4200)) // 4096자 제한 초과
      .setColor(0xff0000)
      .setFooter({ text: 'C'.repeat(2100) }); // 2048자 제한 초과

    const validation = EmbedValidator.validateEmbed(longTitleEmbed);
    
    console.log(`❌ 검증 결과: ${validation.isValid ? 'PASS' : 'FAIL'}`);
    
    // 각 부분별 오류 표시
    const titleErrors = validation.violations.filter(v => v.type === 'title_length');
    const descErrors = validation.violations.filter(v => v.type === 'description_length');
    const footerErrors = validation.violations.filter(v => v.type === 'footer_length');
    
    if (titleErrors.length > 0) {
      console.log(`📝 제목 오류: ${titleErrors[0].current}/256자`);
    }
    
    if (descErrors.length > 0) {
      console.log(`📄 설명 오류: ${descErrors[0].current}/4096자`);
    }
    
    if (footerErrors.length > 0) {
      console.log(`📋 푸터 오류: ${footerErrors[0].current}/2048자`);
    }

    console.log('');
  }

  /**
   * 예제 6: 색상 및 URL 검증
   */
  static example6_ColorUrlValidation(): void {
    console.log('🟡 예제 6: 색상 및 URL 검증');
    console.log('=' .repeat(50));

    const colorUrlEmbed = new EmbedBuilder()
      .setTitle('🎨 색상과 URL 테스트')
      .setDescription('색상과 URL 형식 검증 테스트입니다.')
      .setColor(0xFFFFFF + 1) // 잘못된 색상 (범위 초과)
      .setThumbnail('invalid-url') // 잘못된 URL
      .setImage('ftp://example.com/image.png') // 지원하지 않는 프로토콜
      .setURL('not-a-url'); // 잘못된 URL

    const validation = EmbedValidator.validateEmbed(colorUrlEmbed, {
      validateUrls: true,
      includeWarnings: true
    });
    
    console.log(`⚠️ 검증 결과: ${validation.isValid ? 'PASS' : 'FAIL'}`);
    
    const urlErrors = validation.violations.filter(v => v.type === 'invalid_url');
    console.log(`🔗 URL 오류 ${urlErrors.length}개:`);
    urlErrors.forEach(violation => {
      console.log(`   • ${violation.field}: ${violation.message}`);
    });

    const colorWarnings = validation.warnings.filter(w => w.field === 'color');
    if (colorWarnings.length > 0) {
      console.log(`🎨 색상 경고:`);
      colorWarnings.forEach(warning => {
        console.log(`   • ${warning.message}`);
      });
    }

    console.log('');
  }

  /**
   * 예제 7: 접근성 검증
   */
  static example7_AccessibilityValidation(): void {
    console.log('🟡 예제 7: 접근성 검증');
    console.log('=' .repeat(50));

    const accessibilityEmbed = new EmbedBuilder()
      .setTitle('♿ 접근성 테스트 🎉🎊✨🌟💫⭐🔥💯🎯🚀')
      .setDescription('이모지가 너무 많은 📱💻🖥️⌚📟 텍스트입니다! 🎵🎶🎤🎧🎼')
      .setColor(0xF0F0F0) // 대비가 낮은 색상
      .setImage('https://example.com/image.png') // 이미지 설명 없음
      .addFields(
        { name: '🎮 게임', value: '🏆🥇🏅🎖️🏵️', inline: true },
        { name: '🍕 음식', value: '🍔🍟🌭🥪🌮', inline: true }
      );

    const validation = EmbedValidator.validateEmbed(accessibilityEmbed, {
      checkAccessibility: true,
      includeWarnings: true
    });
    
    console.log(`⚠️ 검증 결과: ${validation.isValid ? 'PASS' : 'FAIL'}`);
    
    const accessibilityWarnings = validation.warnings.filter(w => w.type === 'accessibility_issue');
    console.log(`♿ 접근성 경고 ${accessibilityWarnings.length}개:`);
    accessibilityWarnings.forEach(warning => {
      console.log(`   • ${warning.message}`);
      if (warning.suggestion) {
        console.log(`     💡 ${warning.suggestion}`);
      }
    });

    console.log('');
  }

  /**
   * 예제 8: 임베드 최적화
   */
  static example8_EmbedOptimization(): void {
    console.log('🔧 예제 8: 임베드 최적화');
    console.log('=' .repeat(50));

    const unoptimizedEmbed = new EmbedBuilder()
      .setTitle('📊 최적화가 필요한 임베드')
      .setDescription('이 임베드는 여러 최적화 기회를 가지고 있습니다.')
      .setColor(0x00ff00)
      .addFields(
        { name: '매우 긴 필드', value: 'X'.repeat(900), inline: false },
        { name: '또 다른 긴 필드', value: 'Y'.repeat(850), inline: false },
        { name: '', value: '이름이 없는 필드입니다.', inline: false }
      );

    console.log('🔍 원본 임베드 분석:');
    const originalValidation = EmbedValidator.validateEmbed(unoptimizedEmbed);
    console.log(`   📝 총 문자수: ${originalValidation.totalCharacters}`);
    console.log(`   📊 가독성 점수: ${originalValidation.summary.readabilityScore}/100`);
    console.log(`   ⚠️ 경고 수: ${originalValidation.warnings.length}개`);

    console.log('');
    console.log('⚙️ 최적화 적용 중...');
    const optimization = EmbedValidator.optimizeEmbed(unoptimizedEmbed);

    console.log('✅ 최적화 완료:');
    console.log(`   💾 절약된 공간: ${optimization.spacesSaved}자`);
    console.log(`   📊 적용된 최적화: ${optimization.optimizations.length}개`);
    
    optimization.optimizations.forEach(opt => {
      console.log(`   • ${opt.description}: ${opt.beforeSize} → ${opt.afterSize}자`);
    });

    const optimizedValidation = EmbedValidator.validateEmbed(optimization.optimizedEmbed);
    console.log(`   📈 최적화 후 가독성: ${optimizedValidation.summary.readabilityScore}/100`);

    console.log('');
  }

  /**
   * 예제 9: 빠른 검증 (성능 테스트)
   */
  static example9_QuickValidation(): void {
    console.log('⚡ 예제 9: 빠른 검증 성능 테스트');
    console.log('=' .repeat(50));

    const testEmbed = new EmbedBuilder()
      .setTitle('⚡ 빠른 검증 테스트')
      .setDescription('성능을 위한 빠른 검증 기능 테스트입니다.')
      .setColor(0x00ff00)
      .addFields(
        { name: '테스트 필드 1', value: '값 1', inline: true },
        { name: '테스트 필드 2', value: '값 2', inline: true }
      );

    // 성능 측정
    const iterations = 1000;
    
    console.log(`🔬 ${iterations}회 반복 성능 테스트:`);
    
    // 빠른 검증
    const quickStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      EmbedValidator.quickValidate(testEmbed);
    }
    const quickEnd = performance.now();
    const quickTime = quickEnd - quickStart;
    
    // 전체 검증
    const fullStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      EmbedValidator.validateEmbed(testEmbed, { calculateScores: false });
    }
    const fullEnd = performance.now();
    const fullTime = fullEnd - fullStart;

    console.log(`   ⚡ 빠른 검증: ${quickTime.toFixed(2)}ms (평균 ${(quickTime/iterations).toFixed(4)}ms)`);
    console.log(`   🔍 전체 검증: ${fullTime.toFixed(2)}ms (평균 ${(fullTime/iterations).toFixed(4)}ms)`);
    console.log(`   📊 성능 차이: ${(fullTime/quickTime).toFixed(1)}배`);

    console.log('');
  }

  /**
   * 예제 10: 종합 검증 보고서 생성
   */
  static example10_ComprehensiveValidationReport(): void {
    console.log('📋 예제 10: 종합 검증 보고서');
    console.log('=' .repeat(50));

    const complexEmbed = new EmbedBuilder()
      .setTitle('🏢 복잡한 업무 보고서')
      .setDescription('이것은 여러 섹션과 다양한 정보를 포함한 복잡한 업무 보고서입니다. 여기에는 프로젝트 진행 상황, 팀 성과, 예산 정보, 일정 관리 등이 포함됩니다.')
      .setColor(0x3498db)
      .setThumbnail('https://example.com/company-logo.png')
      .addFields(
        { name: '📊 프로젝트 진행률', value: '85% 완료\n예상 완료일: 2024-02-15', inline: true },
        { name: '👥 팀 구성', value: '개발자 5명\n디자이너 2명\nPM 1명', inline: true },
        { name: '💰 예산 현황', value: '사용: $45,000\n잔여: $15,000\n총예산: $60,000', inline: true },
        { name: '📅 주요 일정', value: '• 개발 완료: 2024-02-10\n• 테스트: 2024-02-12\n• 배포: 2024-02-15', inline: false },
        { name: '⚠️ 주요 이슈', value: '1. API 통합 지연\n2. 디자인 승인 대기\n3. 서버 용량 검토 필요', inline: false },
        { name: '✅ 완료된 작업', value: '• 핵심 기능 개발\n• 데이터베이스 설계\n• 사용자 인터페이스 80%', inline: true },
        { name: '🔄 진행 중인 작업', value: '• API 문서화\n• 단위 테스트 작성\n• 성능 최적화', inline: true },
        { name: '📋 다음 단계', value: '• 통합 테스트\n• 사용자 승인 테스트\n• 배포 준비', inline: true }
      )
      .setFooter({ text: '보고서 생성일: 2024-01-15 | 담당자: 개발팀' })
      .setTimestamp();

    // 종합 검증 실행
    const validation = EmbedValidator.validateEmbed(complexEmbed, {
      strictMode: false,
      includeWarnings: true,
      validateUrls: true,
      checkAccessibility: true,
      calculateScores: true,
      enableOptimizationSuggestions: true
    });

    // 보고서 생성 및 출력
    const report = EmbedValidator.generateValidationReport(complexEmbed, {
      calculateScores: true
    });

    console.log(report);
    console.log('');

    // 추가 통계 정보
    console.log('📈 **상세 통계**:');
    console.log(`   🎯 검증 항목: ${validation.summary.totalChecks}개`);
    console.log(`   ✅ 통과: ${validation.summary.passedChecks}개`);
    console.log(`   ❌ 실패: ${validation.summary.failedChecks}개`);
    console.log(`   ⚠️ 경고: ${validation.summary.warningCount}개`);
    console.log(`   🚨 치명적 오류: ${validation.summary.criticalErrors}개`);
    console.log('');
  }

  /**
   * 모든 예제 실행
   */
  static runAllExamples(): void {
    console.log('🚀 Discord Embed Validator 예제 실행 시작');
    console.log('='.repeat(60));
    console.log('');

    this.example1_ValidEmbed();
    this.example2_FieldCountExceeded();
    this.example3_CharacterLimitExceeded();
    this.example4_FieldValueLengthExceeded();
    this.example5_TitleDescriptionValidation();
    this.example6_ColorUrlValidation();
    this.example7_AccessibilityValidation();
    this.example8_EmbedOptimization();
    this.example9_QuickValidation();
    this.example10_ComprehensiveValidationReport();

    console.log('✅ 모든 예제 실행 완료');
    console.log('='.repeat(60));
  }
}

// 실행 가능한 데모 함수
export function runEmbedValidatorDemo(): void {
  EmbedValidatorExamples.runAllExamples();
}

// 개별 예제 실행 함수들
export const {
  example1_ValidEmbed,
  example2_FieldCountExceeded,
  example3_CharacterLimitExceeded,
  example4_FieldValueLengthExceeded,
  example5_TitleDescriptionValidation,
  example6_ColorUrlValidation,
  example7_AccessibilityValidation,
  example8_EmbedOptimization,
  example9_QuickValidation,
  example10_ComprehensiveValidationReport
} = EmbedValidatorExamples;