import { normalizeText } from '../../documents/workspace';
import { byteLimit, type Encoding } from './model';

const marks: Partial<Record<Encoding, number[]>> = { 'utf-8-bom': [0xef, 0xbb, 0xbf], 'utf-16le': [0xff, 0xfe], 'utf-16be': [0xfe, 0xff] };
export function decodeFile(bytes: Uint8Array, requested?: Encoding, offerChoice = false) {
  if (bytes.length > byteLimit) throw new Error('文件超过 20 MB。');
  const mark = (Object.keys(marks) as Encoding[]).find(id => marks[id]!.every((value, index) => bytes[index] === value));
  let encoding: Encoding = requested ?? mark ?? 'utf-8';
  const bom = mark === encoding || mark === 'utf-8-bom' && encoding === 'utf-8';
  if (encoding === 'utf-8-bom' || encoding === 'utf-8') encoding = bom ? 'utf-8-bom' : 'utf-8';
  try {
    const decoder = new TextDecoder(encoding === 'utf-8-bom' ? 'utf-8' : encoding, { fatal: true, ignoreBOM: true });
    const raw = decoder.decode(bytes.subarray(bom ? marks[mark!]!.length : 0));
    if (raw.includes('\0')) throw new Error();
    return { text: normalizeText(raw), encoding, bom, crlf: raw.includes('\r\n'), needsEncoding: false };
  } catch {
    if (!offerChoice) throw new Error('所选编码无法读取完整文件。');
    return { text: '', encoding, bom, crlf: false, needsEncoding: true };
  }
}
export async function encodeFile(text: string, encoding: Encoding, crlf: boolean, bom: boolean) {
  const raw = crlf ? normalizeText(text).replace(/\n/g, '\r\n') : normalizeText(text);
  if (raw.includes('\0')) throw new Error('正文中包含空字符。');
  const prefix = encoding === 'utf-8-bom' || bom ? marks[encoding] ?? [] : [];
  let body: Uint8Array<ArrayBuffer>;
  try {
    if (encoding === 'utf-8' || encoding === 'utf-8-bom') body = new TextEncoder().encode(raw);
    else if (encoding === 'utf-16le' || encoding === 'utf-16be') {
      if (raw.length * 2 + prefix.length > byteLimit) throw new RangeError();
      body = new Uint8Array(raw.length * 2);
      const view = new DataView(body.buffer);
      for (let i = 0; i < raw.length; i++) view.setUint16(i * 2, raw.charCodeAt(i), encoding === 'utf-16le');
    } else {
      const { TextEncoder: LegacyEncoder } = await import('./legacy-encoder');
      body = new LegacyEncoder(encoding).encode(raw);
    }
    if (body.length + prefix.length > byteLimit) throw new RangeError();
    if (new TextDecoder(encoding === 'utf-8-bom' ? 'utf-8' : encoding, { fatal: true, ignoreBOM: true }).decode(body) !== raw) throw new Error();
  } catch (error) {
    if (error instanceof RangeError && !error.message) throw new Error('编码后的文件超过 20 MB。');
    throw new Error('目标编码无法完整表示正文，请选择其他编码。');
  }
  if (!prefix.length) return body;
  const bytes = new Uint8Array(prefix.length + body.length); bytes.set(prefix); bytes.set(body, prefix.length); return bytes;
}
