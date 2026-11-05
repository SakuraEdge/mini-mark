import { readFile, readdir, writeFile } from 'node:fs/promises';
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const sections = ['THIRD-PARTY NOTICES - MINI MARK\n\nRuntime npm dependencies and their distributed license texts.\n.NET and WebView2 redistribution notices are also included in the Windows package.'];
for (const [location, metadata] of Object.entries(lock.packages)) {
  if (!location || metadata.dev || metadata.devOptional) continue;
  const directory = new URL(`../${location}/`, import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('package.json', directory), 'utf8'));
  const entries = (await readdir(directory)).filter(name => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name));
  sections.push(`\n${'='.repeat(72)}\n${manifest.name} ${manifest.version} (${manifest.license ?? 'see package'})\n`);
  for (const entry of entries) {
    try { sections.push(await readFile(new URL(entry, directory), 'utf8')); } catch {}
  }
}
await writeFile(new URL('../THIRD_PARTY_NOTICES.txt', import.meta.url), sections.join('\n'));
