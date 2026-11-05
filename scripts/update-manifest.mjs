import { createHash } from 'node:crypto';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const version = process.argv[2];
const folder = process.argv[3];
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? '') || !folder) throw new Error('Expected stable version and release-assets folder');
const name = `MiniMark-Setup-${version}-windows-x64.exe`;
const legacyName = `Moye-Setup-${version}-windows-x64.exe`;
const bytes = await readFile(join(folder, name));
await copyFile(join(folder, name), join(folder, legacyName));
const manifest = {
  schemaVersion: 1,
  version,
  windows: {
    url: `https://github.com/SakuraEdge/moye-markdown/releases/download/v${version}/${legacyName}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  },
  windowsV2: {
    url: `https://github.com/SakuraEdge/mini-mark/releases/download/v${version}/${name}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  },
};
await writeFile(join(folder, 'update.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Created ${basename(folder)}/update.json for ${version}`);
