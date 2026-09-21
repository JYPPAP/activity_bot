// .agents/guard.selftest.mjs — agy-guard.mjs 셀프테스트. 실행: node .agents/guard.selftest.mjs
import { execFileSync } from 'node:child_process';

const run = (name, args) =>
  JSON.parse(execFileSync('node', [new URL('./agy-guard.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], {
    input: JSON.stringify({ toolCall: { name, args } }),
  }).toString()).decision;

const cmd = (c) => run('run_command', { CommandLine: c });
const write = (p) => run('write_to_file', { TargetFile: p });
const view = (p) => run('view_file', { AbsolutePath: p });

const cases = [
  // [기대, 설명, 실제]
  ['deny', 'git commit', cmd('git commit -m x')],
  ['deny', 'git push', cmd('git push origin master')],
  ['deny', 'npm install', cmd('npm install foo')],
  ['deny', 'rm -rf', cmd('rm -rf src')],
  ['deny', 'curl', cmd('curl http://x')],
  ['deny', 'pm2', cmd('pm2 restart discord-bot')],
  ['deny', 'echo > .env', cmd('echo x > .env')],
  ['deny', 'tee .env', cmd('tee .env')],
  ['deny', 'sed -i migrations', cmd('sed -i s/a/b/ migrations/x.sql')],
  ['deny', 'cp ecosystem', cmd('cp a ecosystem.config.cjs')],
  ['deny', 'node -e write .env', cmd(`node -e "require('fs').writeFileSync('.env','x')"`)],
  ['deny', 'node -e write CLAUDE.md', cmd(`node -e "fs.writeFileSync('CLAUDE.md', s)"`)],
  ['allow', 'npm run lint', cmd('npm run lint')],
  ['allow', 'npm test', cmd('npm test')],
  ['allow', 'git diff', cmd('git diff -- src/x.js')],
  ['allow', 'sed -n migrations (읽기)', cmd('sed -n 1,5p migrations/x.sql')],
  ['allow', 'sed -i src', cmd('sed -i s/a/b/ src/a.js')],
  ['allow', 'node -e import container', cmd(`timeout 20 node -e "import('./src/container.js')"`)],
  ['allow', 'node -e write src', cmd(`node -e "require('fs').writeFileSync('src/a.js','x')"`)],
  ['deny', 'write .env', write('.env')],
  ['deny', 'write .env.example (abs)', write('C:/x/activity_bot/.env.example')],
  ['deny', 'write migrations', write('migrations/new.sql')],
  ['deny', 'write CLAUDE.md', write('CLAUDE.md')],
  ['deny', 'write .agents', write('.agents/hooks.json')],
  ['allow', 'write src', write('src/a.js')],
  ['allow', 'write tests', write('tests/utils/x.test.js')],
  ['allow', 'write docs/CLAUDE.md.bak', write('docs/CLAUDE.md.bak')],
  ['allow', 'view migrations', view('migrations/x.sql')],
];

let fail = 0;
for (const [expected, label, actual] of cases) {
  const ok = expected === actual;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(28)} expected=${expected} actual=${actual}`);
}
console.log(fail === 0 ? `\n모두 통과 (${cases.length})` : `\n실패 ${fail}/${cases.length}`);
process.exit(fail ? 1 : 0);
