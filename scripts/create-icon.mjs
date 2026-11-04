import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  const svg = await readFile(new URL('../public/moye.svg', import.meta.url), 'utf8');
  await page.setContent(`<style>body{margin:0;background:transparent}svg{width:256px;height:256px}</style>${svg}`);
  const png = await page.screenshot({ omitBackground: true });
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  await mkdir(new URL('../native/Assets/', import.meta.url), { recursive: true });
  await writeFile(new URL('../native/Assets/moye.ico', import.meta.url), Buffer.concat([header, png]));
} finally { await browser.close(); }
