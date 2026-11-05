import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = new URL('../docs/branding/concepts/', import.meta.url);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 790 }, deviceScaleFactor: 1 });
  await page.goto(new URL('preview.html', root).href);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode()));
  });
  await page.screenshot({ path: fileURLToPath(new URL('mini-mark-icon-concepts.png', root)), fullPage: true });
  for (const name of ['a', 'b', 'c']) {
    const svg = await readFile(new URL(`mini-mark-${name}.svg`, root), 'utf8');
    await page.setViewportSize({ width: 1024, height: 1024 });
    await page.setContent(`<style>html,body{margin:0;width:1024px;height:1024px;background:transparent}svg{display:block;width:1024px;height:1024px}</style>${svg}`);
    await writeFile(new URL(`mini-mark-${name}.png`, root), await page.screenshot({ omitBackground: true }));
  }
} finally {
  await browser.close();
}
