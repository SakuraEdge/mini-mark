import type { BrowserWorkspace } from '../../documents/workspace';
import { decodeFile, encodeFile } from './codec';
import { forgetOriginal, keepOriginal, originalBytes } from './originals';
import { isEncoding } from './model';

export async function openBrowserBytes(workspace: BrowserWorkspace, bytes: Uint8Array<ArrayBuffer>, name: string, path?: string) {
  const decoded = decodeFile(bytes, undefined, true);
  const key = await keepOriginal(bytes);
  const doc = workspace.add(decoded.text, name, decoded.text);
  Object.assign(doc, decoded, { originalKey: key, canReinterpret: true, path });
}
export async function browserEncoding(workspace: BrowserWorkspace, request: Record<string, unknown>, publish: () => void) {
  const doc = workspace.active, { action, encoding } = request;
  const original = doc.originalKey, pending = doc.pendingEncoding, current = doc.encoding;
  function checkCurrent() {
    if (workspace.active !== doc || doc.id !== request.documentId || doc.cloud || doc.text !== request.text || doc.revision !== request.revision ||
        doc.originalKey !== original || doc.pendingEncoding !== pending || doc.encoding !== current) throw new Error('文档状态已改变，请重新打开编码面板。');
  }
  checkCurrent();
  if (!isEncoding(encoding)) throw new Error('请选择支持的编码。');
  switch (action) {
    case 'previewRead': case 'switch': {
      if (!doc.canReinterpret || doc.text !== doc.baseline || pending) throw new Error('请先保存修改，再切换查看编码。');
      const decoded = decodeFile(await originalBytes(original), encoding);
      checkCurrent();
      if (action === 'switch') { Object.assign(doc, decoded, { baseline: decoded.text }); publish(); }
      return decoded.text.slice(0, 1000);
    }
    case 'previewConvert': case 'convert': {
      if (doc.needsEncoding) throw new Error('请先选择能正确读取正文的编码。');
      await encodeFile(doc.text, encoding, Boolean(doc.crlf), Boolean(doc.bom) || encoding !== (current ?? 'utf-8'));
      checkCurrent();
      if (action === 'convert') { doc.pendingEncoding = encoding === (current ?? 'utf-8') ? null : encoding; publish(); }
      return doc.text.slice(0, 1000);
    }
    default: throw new Error('未知的编码操作。');
  }
}
export async function downloadBrowserDocument(workspace: BrowserWorkspace, id: string, name: string, download: (bytes: Uint8Array<ArrayBuffer>) => void) {
  const doc = workspace.documents.find(item => item.id === id);
  if (!doc || doc.needsEncoding) throw new Error('请先选择能正确读取正文的编码。');
  const original = doc.originalKey, pending = doc.pendingEncoding, encoding = pending ?? doc.encoding ?? 'utf-8';
  const text = doc.text, revision = doc.revision;
  const bom = encoding === 'utf-8-bom' || encoding.startsWith('utf-16') && Boolean(pending || doc.bom);
  const bytes = await encodeFile(text, encoding, Boolean(doc.crlf), bom);
  const key = await keepOriginal(bytes);
  try {
    if (!workspace.documents.includes(doc) || workspace.active !== doc || doc.revision !== revision || doc.pendingEncoding !== pending || doc.originalKey !== original) throw new Error('文档已变化，请重新保存。');
    download(bytes);
  } catch (error) { forgetOriginal(key); throw error; }
  Object.assign(doc, { name, encoding, bom, pendingEncoding: null, originalKey: key, canReinterpret: true, autoName: false, baseline: text });
  forgetOriginal(original);
}
