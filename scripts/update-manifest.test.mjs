import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createUpdateManifest } from './update-manifest.mjs';

test('Rev manifest separates public naming from the monotonic internal version', () => {
  const bytes = Buffer.from('verified installer fixture');
  const manifest = createUpdateManifest('4.0.1', '1.0.1', bytes);
  assert.deepEqual(manifest, {
    schemaVersion: 2,
    version: '4.0.1',
    releaseVersion: '1.0.1',
    tag: 'rev-v1.0.1',
    windows: {
      url: 'https://github.com/SakuraEdge/mini-mark/releases/download/rev-v1.0.1/MiniMark-Rev-1.0.1-Setup-windows-x64.exe',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
    },
  });
  assert.equal(Object.hasOwn(manifest, 'windowsV2'), false);
});

test('future Rev releases do not reintroduce internal-version download names', () => {
  const manifest = createUpdateManifest('5.0.0', '2.0.0', Buffer.from('installer'));
  assert.equal(manifest.tag, 'rev-v2.0.0');
  assert.match(manifest.windows.url, /\/rev-v2\.0\.0\/MiniMark-Rev-2\.0\.0-Setup-windows-x64\.exe$/);
  assert.doesNotMatch(manifest.windows.url, /5\.0\.0/);
});

test('invalid versions and empty installers cannot generate a release manifest', () => {
  for (const version of ['v1.0.1', '1.0', '01.0.1', '1.0.1-beta', '1.0.1\n', '2147483648.0.0', '../1.0.1', null]) {
    assert.throws(() => createUpdateManifest(version, '1.0.1', Buffer.from('installer')));
    assert.throws(() => createUpdateManifest('4.0.1', version, Buffer.from('installer')));
  }
  assert.throws(() => createUpdateManifest('4.0.1', '1.0.1', Buffer.alloc(0)));
});

test('release notes remain bounded optional text in compatible schema 2 manifests', () => {
  const notes = '# Rev v1.0.3\n\n- 工作区目录\n- 自定义背景';
  const manifest = createUpdateManifest('4.0.3', '1.0.3', Buffer.from('installer'), notes);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.notes, notes);
  for (const invalid of [null, {}, ['text'], 'a'.repeat(16001), 'a\0b']) {
    assert.throws(() => createUpdateManifest('4.0.3', '1.0.3', Buffer.from('installer'), invalid));
  }
});
