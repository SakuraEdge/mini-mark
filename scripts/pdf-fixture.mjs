import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
const output = resolve(process.argv[2] || 'test-results/pdf-fixture.html');
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4175', '--strictPort'], { stdio: 'ignore', windowsHide: true });
let browser;
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch('http://127.0.0.1:4175')).ok) break; } catch {}
    if (attempt === 100) throw new Error('PDF fixture server did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4175');
  const markdown = await readFile('tests/fixtures/pdf.md', 'utf8');
  const html = await page.evaluate(async text => {
    const { exportHtml } = await import('/src/markdown/export.ts');
    return exportHtml(text, '中文排版与公式验证.md');
  }, markdown);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html);
  await copyFile('public/moye.svg', resolve(dirname(output), 'moye.svg'));
  console.log(JSON.stringify({ html: output, bytes: Buffer.byteLength(html) }));
} finally { await browser?.close(); server.kill(); }
