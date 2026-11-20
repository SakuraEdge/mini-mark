export const encodingNames = {
  'utf-8': 'UTF-8', 'utf-8-bom': 'UTF-8（带 BOM）', gbk: 'GBK', gb18030: 'GB18030',
  'windows-1252': 'Windows-1252', 'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE',
} as const;
export type Encoding = keyof typeof encodingNames;
export interface EncodingMetadata {
  encoding?: Encoding; pendingEncoding?: Encoding | null; needsEncoding?: boolean; canReinterpret?: boolean;
}
export function isEncoding(value: unknown): value is Encoding {
  return typeof value === 'string' && Object.hasOwn(encodingNames, value);
}
export const byteLimit = 20 * 1024 * 1024;
