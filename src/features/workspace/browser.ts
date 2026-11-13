import { parentPath, relativePath, supportedWorkspaceFile, type FolderEntry, type FolderResult, type FolderRoot } from './model';

let root: FolderRoot | null = null;
let files = new Map<string, File>();
let entries = new Map<string, FolderEntry>();
let choosing = false;
function list(path = '', offset = 0): FolderResult {
  relativePath(path, true);
  if (!root) return { root: null, path: '', entries: [] };
  if (path && entries.get(path)?.type !== 'directory') throw new Error('工作区目录不存在。');
  const children = [...entries.values()].filter(entry => parentPath(entry.path) === path).sort((a, b) =>
    Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name, 'zh-CN'));
  return { root, path, entries: children.slice(offset, offset + 500), ...(offset + 500 < children.length ? { nextOffset: offset + 500 } : {}) };
}
async function choose(): Promise<FolderResult> {
  if (choosing) throw new Error('文件夹选择窗口已打开。');
  choosing = true;
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.setAttribute('webkitdirectory', '');
    const finish = () => { choosing = false; input.remove(); };
    input.oncancel = () => { finish(); resolve({ root, path: '', entries: [], cancelled: true }); };
    input.onchange = () => {
      try {
        const selected = [...input.files ?? []];
        if (!selected.length) { resolve({ root, path: '', entries: [], cancelled: true }); return; }
        const folderName = selected[0].webkitRelativePath.split('/')[0];
        const nextFiles = new Map<string, File>(), nextEntries = new Map<string, FolderEntry>();
        for (const file of selected) {
          const parts = file.webkitRelativePath.split('/');
          if (parts.shift() !== folderName) throw new Error('所选文件不属于同一文件夹。');
          const path = relativePath(parts.join('/'));
          nextFiles.set(path, file);
          nextEntries.set(path, { name: file.name, path, type: 'file', supported: supportedWorkspaceFile.test(file.name) });
          for (let length = 1; length < parts.length; length++) {
            const directory = parts.slice(0, length).join('/');
            nextEntries.set(directory, { name: parts[length - 1], path: directory, type: 'directory', supported: true });
          }
        }
        root = { id: crypto.randomUUID(), name: folderName, path: folderName }; files = nextFiles; entries = nextEntries;
        resolve(list());
      } catch (error) { reject(error); }
      finally { finish(); }
    };
    input.hidden = true; document.body.append(input); input.click();
  });
}
export async function browserFolderRequest(action: string, payload: Record<string, unknown>): Promise<FolderResult> {
  if (action === 'choose') return choose();
  if (action === 'restore') return list();
  if (action === 'close') { root = null; files.clear(); entries.clear(); return list(); }
  if (action === 'list') {
    if (!root || payload.rootId !== root.id) throw new Error('工作区已关闭或切换。');
    const offset = payload.offset === undefined ? 0 : Number(payload.offset);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('工作区分页无效。');
    return list(String(payload.path ?? ''), offset);
  }
  throw new Error('未知工作区操作。');
}
export async function readBrowserWorkspaceFile(rootId: string, path: string) {
  relativePath(path);
  if (!root || root.id !== rootId) throw new Error('工作区已关闭或切换。');
  const file = files.get(path);
  if (!file || !supportedWorkspaceFile.test(file.name)) throw new Error('此文件类型不能在 Mini Mark 中编辑。');
  if (file.size > 20 * 1024 * 1024) throw new Error('文件超过 20 MB。');
  const bytes = await file.arrayBuffer();
  if (!root || root.id !== rootId) throw new Error('工作区已关闭或切换。');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text.includes('\0')) throw new Error('文件不是 UTF-8 文本文档。');
  return { name: file.name, text };
}
