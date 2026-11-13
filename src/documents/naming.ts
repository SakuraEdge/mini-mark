const supportedExtension = /\.(md|markdown|mdown|txt|yaml|yml|html|htm)$/i;
const invalidCharacters = /[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/;
const reservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
interface NamingDocument { name: string; path?: string | null; cloud?: unknown; autoName?: boolean }

export function canAutoName(document: NamingDocument): boolean {
  if (document.path || document.cloud || !/\.md$/i.test(document.name)) return false;
  return document.autoName ?? /^未命名(?: [1-9]\d*)?\.md$/i.test(document.name);
}

export function headingDocumentName(text: string): string | null {
  const firstLine = text.split(/\r\n?|\n/, 1)[0];
  const match = /^ {0,3}#[ \t]+(.+)$/.exec(firstLine);
  if (!match) return null;
  let title = match[1].replace(/[ \t]+#+[ \t]*$/, '').trim();
  if (/^#+$/.test(title)) return null;
  if (!title) return null;
  title = title.replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  if (!title) return null;
  if (reservedName.test(title)) title = `_${title}`;
  let shortened = '', bytes = 0;
  const encoder = new TextEncoder();
  for (const character of Array.from(title).slice(0, 117)) {
    const length = encoder.encode(character).length;
    if (bytes + length > 237) break;
    shortened += character; bytes += length;
  }
  title = shortened.replace(/[. ]+$/, '');
  return title ? `${title}.md` : null;
}

export function documentName(value: string, currentName: string): string {
  if (!value || value !== value.trim() || invalidCharacters.test(value) || /[. ]$/.test(value) || value === '.' || value === '..') throw new Error('请输入有效文件名，不能包含路径、控制字符或末尾空格。');
  let name = value;
  if (!name.includes('.')) name += supportedExtension.exec(currentName)?.[0] ?? '.md';
  if (!supportedExtension.test(name)) throw new Error('文件扩展名须为 Markdown、YAML、HTML 或 TXT。');
  if (reservedName.test(name)) throw new Error('此名称为系统保留名称，请使用其他名称。');
  if (Array.from(name).length > 120) throw new Error('文件名不能超过 120 个字符。');
  if (new TextEncoder().encode(name).length > 240) throw new Error('文件名过长，请缩短名称。');
  return name;
}

export function automaticDocumentName(text: string, currentName: string, titleHint?: string): string {
  const heading = headingDocumentName(text);
  if (heading) return heading;
  if (titleHint && /\.md$/i.test(titleHint)) {
    try { return documentName(titleHint, currentName); } catch { /* Ignore invalid stale metadata. */ }
  }
  return currentName;
}
