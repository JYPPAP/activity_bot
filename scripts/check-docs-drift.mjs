#!/usr/bin/env node
/**
 * scripts/check-docs-drift.mjs
 *
 * src/ 트리와 CODEBASE_MAP.md 사이의 drift(불일치)를 감지한다.
 * - src 에 있는데 CODEBASE_MAP 에 언급되지 않은 파일  => "undocumented"
 * - CODEBASE_MAP 에 언급되어 있지만 src 에 없는 파일  => "stale"
 *
 * 사용법:
 *   node scripts/check-docs-drift.mjs           # 사람이 읽기 좋은 리포트
 *   node scripts/check-docs-drift.mjs --strict  # drift 발견 시 exit 1 (CI/pre-push 용)
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

function main() {
  const mapText = readMap();
  const sources = collectSourceFiles(SRC_DIR).map(srcRel);

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

  console.log('=== CODEBASE_MAP.md drift check ===');
  console.log(`src 파일 수       : ${sources.length}`);
  console.log(`undocumented     : ${undocumented.length}`);
  console.log(`stale 참조        : ${stale.length}`);

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
  if (VERBOSE) {
    console.log('');
    console.log('[Source files scanned]');
    sources.forEach((f) => console.log(`  . ${f}`));
  }

  const hasDrift = undocumented.length > 0 || stale.length > 0;
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
