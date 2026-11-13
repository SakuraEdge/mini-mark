import { expect, test } from 'vitest';
import { automaticDocumentName, canAutoName, documentName, headingDocumentName } from './naming';
import { BrowserWorkspace } from './workspace';

test('only a nonempty first-line H1 names generated Markdown drafts', () => {
  expect(headingDocumentName('# 标题\n## 下文')).toBe('标题.md');
  expect(headingDocumentName('   # 标题 ### \r\n正文')).toBe('标题.md');
  expect(headingDocumentName('#\t标题')).toBe('标题.md');
  for (const text of ['## 二级', '正文\n# 之后', '\n# 之后', '    # 代码', '\t# 代码', '#无空格', '# ', '# ###', '#\t', '---\n# 标题']) expect(headingDocumentName(text)).toBeNull();
  expect(headingDocumentName('# CON.md')).toBe('_CON.md.md');
  expect(headingDocumentName('# <>:"/\\|?*')).toBeNull();
  expect(headingDocumentName('# 文件 / 名: test...')).toBe('文件 名 test.md');
  expect(headingDocumentName('# Control\u0080\u009fName')).toBe('Control Name.md');
  expect(new TextEncoder().encode(headingDocumentName(`# ${'😀'.repeat(130)}`)!).length).toBeLessThanOrEqual(240);
  expect(headingDocumentName(`# ${'中'.repeat(100)}`)).toBe('中'.repeat(79) + '.md');
});

test('auto-name guards and explicit false distinguish loaded and manually named drafts', () => {
  expect(canAutoName({ name: '未命名 1.md' })).toBe(true);
  expect(canAutoName({ name: '已自动生成.md', autoName: true })).toBe(true);
  for (const document of [
    { name: '未命名.md', autoName: false }, { name: '手动名称.md' }, { name: '未命名 1.yaml', autoName: true },
    { name: '未命名.md', path: 'D:/未命名.md', autoName: true }, { name: '未命名.md', cloud: {}, autoName: true },
  ]) expect(canAutoName(document)).toBe(false);
});

test('manual names preserve omitted extensions and reject unsafe or oversized filenames', () => {
  expect(documentName('新名字', 'source.YAML')).toBe('新名字.YAML');
  expect(documentName('新名字', 'source.txt')).toBe('新名字.txt');
  expect(documentName('new.html', 'source.md')).toBe('new.html');
  for (const name of ['', '.', '..', '../file', 'a\\b', 'file/', ' leading', 'tail ', 'tail.', 'CON', 'con.md', 'COM1.txt', 'LPT9.yaml', 'x.exe', 'x:\n.md', 'Control\u0080Name.md', 'Control\u009fName.md', 'a'.repeat(118) + '.md']) expect(() => documentName(name, 'old.md')).toThrow();
  expect(documentName('中'.repeat(79), 'old.md')).toBe('中'.repeat(79) + '.md');
  expect(() => documentName('中'.repeat(80), 'old.md')).toThrow('文件名过长');
});

test('workspace naming changes metadata only and manual rename freezes automatic names', () => {
  const workspace = new BrowserWorkspace();
  const document = workspace.add();
  workspace.update(document.id, '# First\nbody', 1);
  expect(document.name).toBe('First.md');
  workspace.update(document.id, '## Not first level', 2);
  expect(document.name).toBe('First.md');
  workspace.rename(document.id, '手动');
  workspace.update(document.id, '# Different title', 3);
  expect(document.name).toBe('手动.md');
  expect(document.text).toBe('# Different title');
  expect(document.revision).toBe(3);
  expect(document.baseline).toBe('');
  expect(document.autoName).toBe(false);
  expect(BrowserWorkspace.restore(workspace.serialize())!.active.autoName).toBe(false);
  expect(workspace.add('# Loaded first title', '未命名 9.md').autoName).toBe(false);
  expect(automaticDocumentName('plain', '未命名 1.md', 'Previous.md')).toBe('Previous.md');
  expect(automaticDocumentName('# Current', '未命名 1.md', 'Previous.md')).toBe('Current.md');
  expect(automaticDocumentName('plain', '未命名 1.md', '../invalid.md')).toBe('未命名 1.md');
  expect(automaticDocumentName('plain', '未命名 1.md', 'Other.html')).toBe('未命名 1.md');
});
