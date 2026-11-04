import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const folder = new URL('../release/mac-build/Moye.iconset/', import.meta.url);
await mkdir(folder, { recursive: true });
const browser = await chromium.launch();
try {
  const svg = await readFile(new URL('../public/moye.svg', import.meta.url), 'utf8');
  const page = await browser.newPage();
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = size * scale;
      await page.setViewportSize({ width: pixels, height: pixels });
      await page.setContent(`<style>body{margin:0}svg{width:${pixels}px;height:${pixels}px}</style>${svg}`);
      await writeFile(new URL(`icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`, folder), await page.screenshot({ omitBackground: true }));
    }
  }
} finally { await browser.close(); }
