#!/usr/bin/env node
// .agents/agy-guard.mjs — agy PreToolUse 훅. stdin JSON → stdout {decision, reason}.
// 금지 명령/경로를 기계적으로 차단한다. 규칙 설명: .agents/rules/agy-guardrails.md
import fs from 'node:fs';

// fail-closed: 입력을 해석할 수 없으면 차단한다 (페이로드 형식이 바뀌면 조용히 통과되지 않도록)
let input;
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8').trim() || '{}');
} catch (e) {
  process.stdout.write(JSON.stringify({ decision: 'deny', reason: `[agy-guard] 훅 입력 파싱 실패: ${e.message}` }));
  process.exit(0);
}
const call = input.toolCall || {};
const name = String(call.name || '');
const args = call.args || {};
if (!name) {
  process.stdout.write(JSON.stringify({ decision: 'deny', reason: '[agy-guard] toolCall.name 없음 — 페이로드 형식 확인 필요' }));
  process.exit(0);
}

const DENY_CMD = [
  /\bgit\s+(commit|push|reset|checkout|restore|clean|stash|rebase|merge|tag|branch\s+-[dD])\b/i,
  /\bgit\s+update-index\b/i,
  /\bnpm\s+(install|i|uninstall|un|update|publish|ci)\b/i,
  /\b(pnpm|yarn)\s+(add|install|remove|publish)\b/i,
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b/i,
  /\bRemove-Item\b.*-Recurse/i,
  /\bdel\s+\/[sq]/i,
  /\brmdir\s+\/s/i,
  /\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i,
  /\b(pm2|psql|node-pg-migrate)\b/i,
  /\.git[\/](hooks|index|HEAD|config)/i,
];
const DENY_PATH = JSON.parse(fs.readFileSync(new URL('./deny-paths.json', import.meta.url), 'utf8')).map((p) => new RegExp(p, 'i'));

function deny(reason) {
  process.stdout.write(JSON.stringify({ decision: 'deny', reason: `[agy-guard] ${reason}` }));
  process.exit(0);
}

const strings = [];
(function collect(v) {
  if (typeof v === 'string') strings.push(v);
  else if (Array.isArray(v)) v.forEach(collect);
  else if (v && typeof v === 'object') Object.values(v).forEach(collect);
})(args);

if (name === 'run_command') {
  const cmd = String(args.CommandLine || args.commandLine || args.command || strings.join(' '));
  for (const re of DENY_CMD) if (re.test(cmd)) deny(`금지 명령: ${cmd.slice(0, 120)}`);
  // 리다이렉션·in-place 쓰기 명령으로 금지 경로를 건드리는 것도 차단
  const WRITE_CMD = /[>|]\s*\S|\bsed\s+-[a-z]*i|\btee\b|\bnode\s+(-e|--eval|-p)\b|\b(mv|cp|touch|truncate)\b|(Set|Add)-Content|Out-File|(Move|Copy|New|Remove)-Item/i;
  if (WRITE_CMD.test(cmd)) for (const re of DENY_PATH) if (re.test(cmd)) deny(`금지 경로 쓰기: ${cmd.slice(0, 120)}`);
} else if (!/^(view|read|list|grep|search|find|codebase|glob)/i.test(name)) {
  // 파일 수정 계열 도구: 인자 중 금지 경로가 있으면 차단
  for (const s of strings) for (const re of DENY_PATH) if (re.test(s)) deny(`금지 경로 수정 (${name}): ${s.slice(0, 120)}`);
}

process.stdout.write(JSON.stringify({ decision: 'allow' }));
