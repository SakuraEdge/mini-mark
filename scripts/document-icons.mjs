import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const folder = new URL('../public/document-icons/', import.meta.url);
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

function ico(images) {
  const dimensions = sizes.filter(size => size <= 256);
  const header = Buffer.alloc(6 + 16 * dimensions.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(dimensions.length, 4);
  let offset = header.length;
  dimensions.forEach((size, index) => {
    const image = images.get(size);
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  return Buffer.concat([header, ...dimensions.map(size => images.get(size))]);
}

function icns(images) {
  const types = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 };
  const chunks = Object.entries(types).map(([type, size]) => {
    const image = images.get(size);
    const header = Buffer.alloc(8);
    header.write(type);
    header.writeUInt32BE(image.length + 8, 4);
    return Buffer.concat([header, image]);
  });
  const header = Buffer.alloc(8);
  header.write('icns');
  header.writeUInt32BE(8 + chunks.reduce((length, chunk) => length + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {});
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const name of ['markdown', 'yaml', 'html']) {
    const svg = await readFile(new URL(`${name}.svg`, folder), 'utf8');
    const images = new Map();
    for (const size of sizes) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<style>body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
      images.set(size, await page.screenshot({ omitBackground: true }));
    }
    await writeFile(new URL(`${name}.ico`, folder), ico(images));
    await writeFile(new URL(`${name}.icns`, folder), icns(images));
    await writeFile(new URL(`${name}.png`, folder), images.get(256));
  }
} finally {
  await browser.close();
}
