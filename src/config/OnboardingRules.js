import {createHash} from 'node:crypto';
import {readdir, readFile} from 'node:fs/promises';
import {extname} from 'node:path';

const RULES_DIRECTORY = new URL('../../config/onboarding/rules/', import.meta.url);

function rulePage(title, text, source) {
  const content = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  if (!content) throw new Error(`가입 규칙 문서가 비어 있습니다: ${source}`);
  if (content.length > 3500) throw new Error(`가입 규칙 문서는 파일당 3500자 이하여야 합니다: ${source}`);
  return {title, content};
}

export async function loadOnboardingRules(legacyText = '') {
  let entries;
  try { entries = await readdir(RULES_DIRECTORY, {withFileTypes: true}); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    entries = [];
  }
  const names = entries.filter(entry => entry.isFile()
    && /\.(md|txt)$/i.test(entry.name)
    && !/^readme\.md$/i.test(entry.name)
    && !/\.example\.(md|txt)$/i.test(entry.name)).map(entry => entry.name).sort();
  const pages = [];
  for (const name of names) {
    const text = await readFile(new URL(encodeURIComponent(name), RULES_DIRECTORY), 'utf8');
    pages.push(rulePage(name.slice(0, -extname(name).length), text, name));
  }
  if (!pages.length) {
    if (!legacyText.trim()) throw new Error('config/onboarding/rules/에 .md 또는 .txt 규칙 문서를 추가하거나 가입관리 설정의 규칙을 입력해 주세요.');
    pages.push(rulePage('서버 규칙', legacyText, '가입관리 설정의 규칙'));
  }
  const revision = createHash('sha256').update(JSON.stringify(pages)).digest('hex');
  return {pages, revision};
}
