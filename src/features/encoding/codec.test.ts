import { describe, expect, it } from 'vitest';
import { decodeFile, encodeFile } from './codec';
import type { Encoding } from './model';
describe('file bytes', () => {
  const fixtures: [Encoding, string, number[]][] = [
    ['gbk', '中文\n', [0xd6, 0xd0, 0xce, 0xc4, 13, 10]],
    ['gb18030', '𠀀', [0x95, 0x32, 0x82, 0x36]],
    ['windows-1252', '€é', [0x80, 0xe9]],
    ['utf-16le', '中', [0xff, 0xfe, 0x2d, 0x4e]], ['utf-16be', '中', [0xfe, 0xff, 0x4e, 0x2d]],
    ['utf-8-bom', '中', [0xef, 0xbb, 0xbf, 0xe4, 0xb8, 0xad]], ['utf-8', '中', [0xe4, 0xb8, 0xad]],
  ];
  it.each(fixtures)('%s reads and writes the fixture exactly', async (encoding, text, fixture) => {
    const bytes = Uint8Array.from(fixture);
    const result = decodeFile(bytes, encoding);
    expect(result.text).toBe(text);
    expect(await encodeFile(text, encoding, result.crlf, result.bom)).toEqual(bytes);
  });
  it('recovers invalid UTF-8 and rejects loss and malformed Unicode', async () => {
    expect(decodeFile(Uint8Array.of(0xd6, 0xd0), undefined, true).needsEncoding).toBe(true);
    await expect(encodeFile('中文', 'windows-1252', false, false)).rejects.toThrow();
    await expect(encodeFile('\ud800', 'utf-8', false, false)).rejects.toThrow();
  });
});
