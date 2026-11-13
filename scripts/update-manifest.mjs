import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

function stableVersion(value) {
  return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) &&
    value.split('.').every(part => Number(part) <= 2147483647 && String(Number(part)) === part);
}

export function createUpdateManifest(version, releaseVersion, bytes, notes) {
  if (!stableVersion(version) || !stableVersion(releaseVersion)) throw new Error('Expected stable internal and Rev versions');
  if (!bytes.length || bytes.length > 256 * 1024 * 1024) throw new Error('Installer size is outside supported bounds');
  if (notes !== undefined && (typeof notes !== 'string' || notes.length > 16000 || notes.includes('\0'))) throw new Error('Release notes must be text within 16000 characters');
  const tag = `rev-v${releaseVersion}`;
  return {
    schemaVersion: 2,
    version,
    releaseVersion,
    tag,
    ...(notes === undefined ? {} : { notes }),
    windows: {
      url: `https://github.com/SakuraEdge/mini-mark/releases/download/${tag}/MiniMark-Rev-${releaseVersion}-Setup-windows-x64.exe`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , version, folder, releaseVersion] = process.argv;
  if (!folder || !stableVersion(version) || !stableVersion(releaseVersion)) throw new Error('Expected version, folder, and Rev version');
  const bytes = await readFile(join(folder, `MiniMark-Rev-${releaseVersion}-Setup-windows-x64.exe`));
  const notes = await readFile(new URL(`../docs/release-rev-v${releaseVersion}.md`, import.meta.url), 'utf8');
  const manifest = createUpdateManifest(version, releaseVersion, bytes, notes);
  await writeFile(join(folder, 'update.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Created ${basename(folder)}/update.json for Rev v${releaseVersion}`);
}
