import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage();
  const svg = await readFile(new URL('../public/mini-mark.svg', import.meta.url), 'utf8');
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    images.push(await page.screenshot({ omitBackground: true }));
  }
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (let index = 0; index < sizes.length; index++) {
    const entry = 6 + index * 16, size = sizes[index];
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  }
  await mkdir(new URL('../native/Assets/', import.meta.url), { recursive: true });
  await writeFile(new URL('../native/Assets/mini-mark.ico', import.meta.url), Buffer.concat([header, ...images]));
  await page.setViewportSize({ width: 512, height: 512 });
  await page.setContent(`<style>body{margin:0;background:transparent}svg{display:block;width:512px;height:512px}</style>${svg}`);
  await mkdir(new URL('../docs/branding/', import.meta.url), { recursive: true });
  await writeFile(new URL('../docs/branding/mini-mark-final.png', import.meta.url), await page.screenshot({ omitBackground: true }));
} finally { await browser.close(); }
