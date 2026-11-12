import { expect, test } from 'vitest';
import { isCloudSha, readCloudDeletion } from './model';

test('cloud deletion requires a complete SHA and an exact matching result', () => {
  for (const sha of ['a'.repeat(40), 'B'.repeat(64)]) expect(isCloudSha(sha)).toBe(true);
  for (const sha of [undefined, '', 'a'.repeat(39), 'a'.repeat(41), 'a'.repeat(40) + '\n', 'g'.repeat(40)]) expect(isCloudSha(sha)).toBe(false);
  const entry = { name: 'note.md', path: 'notes/note.md', type: 'file' as const, sha: 'a'.repeat(40) };
  const result = { path: entry.path, type: 'file', deleted: true, commit: 'b'.repeat(40) };
  expect(readCloudDeletion(result, entry)).toEqual(result);
  for (const invalid of [null, {}, { ...result, path: 'other.md' }, { ...result, type: 'dir' }, { ...result, deleted: false }, { ...result, commit: 'invalid' }]) {
    expect(() => readCloudDeletion(invalid, entry)).toThrow('删除结果无法确认');
  }
});
