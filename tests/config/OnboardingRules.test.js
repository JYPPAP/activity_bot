import {beforeEach, describe, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {readdir, readFile} from 'node:fs/promises';
import {loadOnboardingRules} from '../../src/config/OnboardingRules.js';

vi.mock('node:fs/promises', () => ({readdir: vi.fn(), readFile: vi.fn()}));

const file = name => ({name, isFile: () => true});

describe('loadOnboardingRules', () => {
  beforeEach(() => {
    readdir.mockReset().mockResolvedValue([]);
    readFile.mockReset();
  });

  it('loads sorted Markdown/text pages and ignores documentation, examples, and directories', async () => {
    readdir.mockResolvedValue([
      file('02-게임.txt'), file('README.md'), file('01-기본.md'), file('03-규칙.example.md'),
      file('other.json'), file('04-규칙.example.txt'), {name: '05-폴더.md', isFile: () => false}
    ]);
    readFile.mockResolvedValueOnce('기본 규칙').mockResolvedValueOnce('게임 규칙');
    const {pages, revision} = await loadOnboardingRules('Ignored fallback');
    expect(pages).toEqual([
      {title: '01-기본', content: '기본 규칙'}, {title: '02-게임', content: '게임 규칙'}
    ]);
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(decodeURIComponent(readFile.mock.calls[0][0].pathname)).toMatch(/config\/onboarding\/rules\/01-기본\.md$/);
    expect(readFile.mock.calls[0][1]).toBe('utf8');
    expect(revision).toBe(createHash('sha256').update(JSON.stringify(pages)).digest('hex'));
  });

  it('strips UTF-8 BOM and normalizes Windows line endings', async () => {
    readdir.mockResolvedValue([file('01-규칙.MD')]);
    readFile.mockResolvedValue('\uFEFF# 규칙\r\n본문\r\n');
    const result = await loadOnboardingRules();
    expect(result.pages).toEqual([{title: '01-규칙', content: '# 규칙\n본문'}]);
  });

  it('uses saved legacy rules when no actual documents exist', async () => {
    readdir.mockResolvedValue([file('README.md'), file('01.example.md')]);
    const result = await loadOnboardingRules('  예전 규칙  ');
    expect(result.pages).toEqual([{title: '서버 규칙', content: '예전 규칙'}]);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('uses fallback when the rules directory does not exist', async () => {
    readdir.mockRejectedValue(Object.assign(new Error('Missing directory'), {code: 'ENOENT'}));
    await expect(loadOnboardingRules('기존 규칙')).resolves.toMatchObject({pages: [{title: '서버 규칙', content: '기존 규칙'}]});
  });

  it('fails clearly when neither documents nor legacy rules are available', async () => {
    await expect(loadOnboardingRules()).rejects.toThrow('config/onboarding/rules/');
  });

  it('does not silently use fallback when the rules directory cannot be read', async () => {
    const failure = Object.assign(new Error('Access denied'), {code: 'EACCES'});
    readdir.mockRejectedValue(failure);
    await expect(loadOnboardingRules('기존 규칙')).rejects.toBe(failure);
  });

  it('rejects empty documents and does not replace them with legacy rules', async () => {
    readdir.mockResolvedValue([file('01-빈규칙.md')]);
    readFile.mockResolvedValue('\uFEFF  \n');
    await expect(loadOnboardingRules('기존 규칙')).rejects.toThrow('문서가 비어 있습니다: 01-빈규칙.md');
  });

  it('accepts 3500 characters but identifies a document exceeding the limit', async () => {
    readdir.mockResolvedValue([file('01-규칙.md')]);
    readFile.mockResolvedValueOnce('가'.repeat(3500)).mockResolvedValueOnce('가'.repeat(3501));
    await expect(loadOnboardingRules()).resolves.toMatchObject({pages: [{content: '가'.repeat(3500)}]});
    await expect(loadOnboardingRules()).rejects.toThrow('3500자 이하여야 합니다: 01-규칙.md');
    readdir.mockResolvedValue([]);
    await expect(loadOnboardingRules('가'.repeat(3501))).rejects.toThrow('3500자');
  });

  it('changes the revision when the title or content changes, but remains stable otherwise', async () => {
    readdir.mockResolvedValue([file('01-규칙.md')]);
    readFile.mockResolvedValue('원래 내용');
    const original = await loadOnboardingRules();
    expect((await loadOnboardingRules()).revision).toBe(original.revision);
    readdir.mockResolvedValue([file('01-수정제목.md')]);
    expect((await loadOnboardingRules()).revision).not.toBe(original.revision);
    readdir.mockResolvedValue([file('01-규칙.md')]);
    readFile.mockResolvedValue('수정 내용');
    expect((await loadOnboardingRules()).revision).not.toBe(original.revision);
  });
});
