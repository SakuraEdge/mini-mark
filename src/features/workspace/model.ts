export interface FolderRoot { id: string; name: string; path: string }
export interface FolderEntry { name: string; path: string; type: 'file' | 'directory'; supported: boolean; link?: boolean }
export interface FolderResult { root: FolderRoot | null; path: string; entries: FolderEntry[]; nextOffset?: number; cancelled?: boolean }
export const supportedWorkspaceFile = /\.(?:md|markdown|mdown|txt|yaml|yml|html|htm)$/i;
export function relativePath(value: string, allowRoot = false): string {
  if (allowRoot && value === '') return '';
  if (!value || value.length > 4096 || /[\\:\u0000-\u001f\u007f]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('工作区路径无效。');
  return value;
}
export function parentPath(value: string) { return value.slice(0, Math.max(0, value.lastIndexOf('/'))); }
export function parseFolderResult(value: unknown, expected?: { rootId: string; path: string; offset: number }): FolderResult {
  if (!value || typeof value !== 'object') throw new Error('工作区响应无效。');
  const data = value as Record<string, unknown>;
  if (data.cancelled === true) return { root: null, path: '', entries: [], cancelled: true };
  if (data.root === null) return { root: null, path: '', entries: [] };
  const root = data.root as FolderRoot | undefined;
  if (!root || typeof root.id !== 'string' || !root.id || typeof root.name !== 'string' || typeof root.path !== 'string' || typeof data.path !== 'string' || !Array.isArray(data.entries)) throw new Error('工作区响应无效。');
  relativePath(data.path, true);
  if (expected && (root.id !== expected.rootId || data.path !== expected.path)) throw new Error('工作区已切换，请刷新目录。');
  if (data.entries.length > 500) throw new Error('工作区目录分页过大。');
  const seen = new Set<string>(), entries: FolderEntry[] = [];
  for (const candidate of data.entries) {
    if (!candidate || typeof candidate !== 'object') continue;
    const entry = candidate as FolderEntry;
    if (typeof entry.name !== 'string' || typeof entry.path !== 'string' || !['file', 'directory'].includes(entry.type)) continue;
    if (parentPath(entry.path) !== data.path || entry.name !== entry.path.split('/').at(-1) || entry.name === '.' || entry.name === '..' || seen.has(entry.path)) continue;
    let safe = true;
    try { relativePath(entry.path); } catch { safe = false; }
    seen.add(entry.path);
    entries.push({ name: entry.name, path: entry.path, type: entry.type, supported: safe && entry.supported === true && (entry.type === 'directory' || supportedWorkspaceFile.test(entry.name)), link: entry.link === true });
  }
  const nextOffset = data.nextOffset ?? undefined;
  if (nextOffset !== undefined && (!Number.isSafeInteger(nextOffset) || Number(nextOffset) <= (expected?.offset ?? -1))) throw new Error('工作区分页响应无效。');
  return { root, path: data.path, entries, nextOffset: nextOffset as number | undefined };
}
