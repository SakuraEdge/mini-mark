import { expect, test } from 'vitest';
import { parseFolderResult, relativePath } from './model';
const root = { id: 'root', name: 'Project', path: 'D:/Project' };
test('workspace pages require matching authority, safe parent paths and bounded pagination', () => {
  for (const path of ['../escape', '/absolute', 'a//b', 'C:/file', 'a\\b', 'a/..']) expect(() => relativePath(path)).toThrow();
  const result = parseFolderResult({ root, path: '', entries: [
    { name: 'docs', path: 'docs', type: 'directory', supported: true },
    { name: 'file.md', path: 'file.md', type: 'file', supported: true },
    { name: 'program.exe', path: 'program.exe', type: 'file', supported: true },
    { name: 'not:this.md', path: 'not:this.md', type: 'file', supported: true },
    { name: 'escape', path: '../escape', type: 'file', supported: true },
  ], nextOffset: 500 }, { rootId: 'root', path: '', offset: 0 });
  expect(result.entries).toHaveLength(4);
  expect(result.entries[0].supported).toBe(true);
  expect(result.entries[2].supported).toBe(false);
  expect(result.entries[3].supported).toBe(false);
  expect(() => parseFolderResult({ root, path: '', entries: [] }, { rootId: 'other', path: '', offset: 0 })).toThrow();
  expect(() => parseFolderResult({ root, path: '', entries: [], nextOffset: 0 }, { rootId: 'root', path: '', offset: 0 })).toThrow();
  expect(parseFolderResult({ root, path: '', entries: [], nextOffset: null }, { rootId: 'root', path: '', offset: 0 }).nextOffset).toBeUndefined();
});
