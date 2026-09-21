#!/usr/bin/env node
/**
 * scripts/check-docs-drift.mjs
 *
 * src/ 트리와 CODEBASE_MAP.md 사이의 drift(불일치)를 감지한다.
 * - src 에 있는데 CODEBASE_MAP 에 언급되지 않은 파일  => "undocumented"
 * - CODEBASE_MAP 에 언급되어 있지만 src 에 없는 파일  => "stale"
 * - Discord CustomId 상수와 문서 표의 양방향 불일치
 * - 문서의 주요 DI 키 중 container.js 에 없는 stale 등록
 *
 * 사용법:
 *   node scripts/check-docs-drift.mjs           # 사람이 읽기 좋은 리포트
 *   node scripts/check-docs-drift.mjs --strict  # drift 발견 시 exit 1 (CI/pre-push 용)
 *   node scripts/check-docs-drift.mjs --verbose # 스캔 파일과 문서에 생략된 DI 등록 표시
 *
 * Invariant I-10 을 강제하는 하네스 스크립트.
 *  - 의존성: Node 내장 모듈만 사용 (fs, path).
 *  - 대상 확장자: .js, .mjs, .cjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const SRC_DIR = path.join(ROOT, 'src');
const MAP_FILE = path.join(ROOT, 'CODEBASE_MAP.md');
const DISCORD_CONSTANTS_FILE = path.join(SRC_DIR, 'config', 'DiscordConstants.js');
const CONTAINER_FILE = path.join(SRC_DIR, 'container.js');

const CUSTOM_ID_SECTION = '## CustomId 접두사 (DiscordConstants.CUSTOM_ID_PREFIXES)';
const DI_SECTION = '## DI 컨테이너 (container.js) — 주요 의존성';

const STRICT = process.argv.includes('--strict');
const VERBOSE = process.argv.includes('--verbose');

// 제외 파일명 (필요 시 추가)
const EXCLUDE_BASENAMES = new Set(['index.js']); // 단순 re-export

function collectSourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (/\.(m?js|cjs)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function readMap() {
  if (!fs.existsSync(MAP_FILE)) {
    console.error(`[drift] CODEBASE_MAP.md 를 찾을 수 없습니다: ${MAP_FILE}`);
    process.exit(2);
  }
  return fs.readFileSync(MAP_FILE, 'utf8');
}

function srcRel(abs) {
  return path.relative(SRC_DIR, abs).split(path.sep).join('/');
}

function extractSection(mapText, heading) {
  const start = mapText.indexOf(heading);
  if (start === -1) {
    throw new Error(`CODEBASE_MAP.md 섹션을 찾을 수 없습니다: ${heading}`);
  }
  const contentStart = start + heading.length;
  const nextHeading = mapText.indexOf('\n## ', contentStart);
  return mapText.slice(contentStart, nextHeading === -1 ? mapText.length : nextHeading);
}

function extractObjectBlock(source, objectName) {
  const marker = new RegExp(`static\\s+${objectName}\\s*=\\s*\\{`);
  const match = marker.exec(source);
  if (!match) {
    throw new Error(`DiscordConstants.js 블록을 찾을 수 없습니다: static ${objectName}`);
  }
  const start = match.index + match[0].length;
  const end = source.indexOf('\n  };', start);
  if (end === -1) {
    throw new Error(`DiscordConstants.js 블록 끝을 찾을 수 없습니다: static ${objectName}`);
  }
  return source.slice(start, end);
}

function extractCustomIds(source) {
  const values = new Set();
  for (const objectName of ['CUSTOM_ID_PREFIXES', 'METHOD_VALUES']) {
    const block = extractObjectBlock(source, objectName);
    const entryPattern = /^\s*[A-Z][A-Z0-9_]*\s*:\s*'([^']+)'/gm;
    let match;
    while ((match = entryPattern.exec(block)) !== null) values.add(match[1]);
  }
  return values;
}

function extractDocumentedCustomIds(section) {
  const values = new Set();
  const rowPattern = /^\|\s*`([^`]+)`\s*\|/gm;
  let match;
  while ((match = rowPattern.exec(section)) !== null) values.add(match[1]);
  return values;
}

function extractContainerKeys(source) {
  const keys = new Set();
  const registrationPattern = /^\s*([A-Za-z_$][\w$]*)\s*:\s*as(?:Class|Function|Value)\s*\(/gm;
  let match;
  while ((match = registrationPattern.exec(source)) !== null) keys.add(match[1]);
  return keys;
}

function extractDocumentedDIKeys(section) {
  const codeBlock = section.match(/```(?:text)?\s*\n([\s\S]*?)```/);
  if (!codeBlock) throw new Error(`${DI_SECTION} 섹션의 코드 블록을 찾을 수 없습니다.`);
  const keys = new Set();
  for (const line of codeBlock[1].split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_$][\w$]*)\s*(?:\(|=)/);
    if (match) keys.add(match[1]);
  }
  return keys;
}

function main() {
  const mapText = readMap();
  const sources = collectSourceFiles(SRC_DIR).map(srcRel);

  let customIdSection;
  let diSection;
  try {
    customIdSection = extractSection(mapText, CUSTOM_ID_SECTION);
    diSection = extractSection(mapText, DI_SECTION);
  } catch (error) {
    console.error(`[drift] ${error.message}`);
    process.exit(1);
  }

  const undocumented = [];
  for (const rel of sources) {
    const base = path.basename(rel);
    if (EXCLUDE_BASENAMES.has(base)) continue;
    if (!mapText.includes(base) && !mapText.includes(rel)) {
      undocumented.push(rel);
    }
  }

  // stale: CODEBASE_MAP 안의 경로형 토큰 (슬래시 포함) 만 대상으로 삼는다.
  // 라이브러리명 "Node.js", "discord.js" 같은 false positive 를 피하기 위함.
  const stalePattern = /\b([\w./-]+\/[\w.-]+\.(?:m?js|cjs))\b/g;
  const mentioned = new Set();
  let m;
  while ((m = stalePattern.exec(mapText)) !== null) {
    const token = m[1];
    if (token.startsWith('node_modules/')) continue;
    if (token.includes('..')) continue;
    mentioned.add(token);
  }

  const existingRelSet = new Set(sources);
  const existingAbsLikeSet = new Set(sources.map((r) => `src/${r}`));
  const stale = [];
  for (const token of mentioned) {
    if (existingRelSet.has(token)) continue;
    if (existingAbsLikeSet.has(token)) continue;
    stale.push(token);
  }

  let codeCustomIds;
  let documentedCustomIds;
  let containerKeys;
  let documentedDIKeys;
  try {
    codeCustomIds = extractCustomIds(fs.readFileSync(DISCORD_CONSTANTS_FILE, 'utf8'));
    documentedCustomIds = extractDocumentedCustomIds(customIdSection);
    containerKeys = extractContainerKeys(fs.readFileSync(CONTAINER_FILE, 'utf8'));
    documentedDIKeys = extractDocumentedDIKeys(diSection);
  } catch (error) {
    console.error(`[drift] ${error.message}`);
    process.exit(1);
  }

  const customIdUndocumented = [...codeCustomIds].filter((id) => !documentedCustomIds.has(id));
  const customIdStale = [...documentedCustomIds].filter((id) => !codeCustomIds.has(id));
  const diStale = [...documentedDIKeys].filter((key) => !containerKeys.has(key));
  const diUndocumented = [...containerKeys].filter((key) => !documentedDIKeys.has(key));

  console.log('=== CODEBASE_MAP.md drift check ===');
  console.log(`src 파일 수       : ${sources.length}`);
  console.log(`undocumented     : ${undocumented.length}`);
  console.log(`stale 참조        : ${stale.length}`);
  console.log(`CustomId undocumented: ${customIdUndocumented.length}`);
  console.log(`CustomId stale       : ${customIdStale.length}`);
  console.log(`DI stale             : ${diStale.length}`);

  if (undocumented.length) {
    console.log('');
    console.log('[Undocumented] src 에 있는데 CODEBASE_MAP 에 없음:');
    undocumented.forEach((f) => console.log(`  - ${f}`));
  }
  if (stale.length) {
    console.log('');
    console.log('[Stale] CODEBASE_MAP 에 언급됐지만 src 에 없음:');
    stale.forEach((f) => console.log(`  - ${f}`));
  }
  customIdUndocumented.forEach((id) => console.log(`[CustomId undocumented] ${id}`));
  customIdStale.forEach((id) => console.log(`[CustomId stale] ${id}`));
  diStale.forEach((key) => console.log(`[DI stale] ${key}`));
  if (VERBOSE) {
    console.log('');
    console.log('[Source files scanned]');
    sources.forEach((f) => console.log(`  . ${f}`));
    console.log('');
    console.log('[DI registrations not listed as major dependencies]');
    diUndocumented.forEach((key) => console.log(`  - ${key}`));
  }

  const hasDrift = undocumented.length > 0 || stale.length > 0 ||
    customIdUndocumented.length > 0 || customIdStale.length > 0 || diStale.length > 0;
  if (hasDrift && STRICT) {
    console.error('');
    console.error('[drift] 불일치가 있어 종료 코드 1로 실패합니다 (--strict).');
    process.exit(1);
  }
  if (!hasDrift) {
    console.log('');
    console.log('[OK] drift 없음.');
  }
}

main();
