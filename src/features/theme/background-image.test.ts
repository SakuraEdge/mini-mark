import { expect, test } from 'vitest';
import { imageDimensions } from './background-image';

function png(width: number, height: number) {
  const bytes = new Uint8Array(24), view = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}

test('PNG and JPEG dimensions are checked before decoding', () => {
  expect(imageDimensions(png(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  const jpeg = new Uint8Array([255, 216, 255, 192, 0, 11, 8, 4, 56, 7, 128, 1, 1, 17, 0]);
  expect(imageDimensions(jpeg)).toEqual({ width: 1920, height: 1080 });
  expect(() => imageDimensions(png(8000, 8000))).toThrow('尺寸过大');
  expect(() => imageDimensions(png(0, 100))).toThrow('格式无效');
  expect(() => imageDimensions(new TextEncoder().encode('<svg onload="alert(1)"/>'))).toThrow('格式无效');
  expect(() => imageDimensions(jpeg.slice(0, 6))).toThrow('格式无效');
});

test('WebP chunk dimensions and truncation are validated', () => {
  const bytes = new Uint8Array(30), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('RIFF'), 0); bytes.set(new TextEncoder().encode('WEBPVP8X'), 8);
  view.setUint32(4, 22, true); view.setUint32(16, 10, true);
  bytes.set([127, 7, 0, 55, 4, 0], 24);
  expect(imageDimensions(bytes)).toEqual({ width: 1920, height: 1080 });
  expect(() => imageDimensions(bytes.slice(0, 29))).toThrow('格式无效');
});
