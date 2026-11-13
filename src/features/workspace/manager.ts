import { ChevronRight, File, FileCode2, Folder, FolderOpen, Link2, LoaderCircle, RefreshCw, X, createIcons } from 'lucide';
import { folderRequest, handleFolderMessage } from './client';
import { parseFolderResult, type FolderEntry, type FolderResult, type FolderRoot } from './model';
import '../../styles/workspace.css';

interface Directory { entries: FolderEntry[]; loaded: boolean; loading: boolean; expanded: boolean; nextOffset?: number; error?: string }
interface Options { openFile(rootId: string, path: string): Promise<void>; notice(message: string): void }
const MODE_KEY = 'mini-mark.sidebar-mode.v1';
export function initializeWorkspace(options: Options) {
  const single = document.querySelector<HTMLElement>('#single-document-panel')!;
  const workspace = document.querySelector<HTMLElement>('#workspace-document-panel')!;
  const tree = document.querySelector<HTMLElement>('#workspace-tree')!;
  const status = document.querySelector<HTMLElement>('#workspace-status')!;
  const rootName = document.querySelector<HTMLElement>('#workspace-root-name')!;
  const rootTools = document.querySelector<HTMLElement>('#workspace-root-tools')!;
  const chooseButton = document.querySelector<HTMLButtonElement>('#open-folder')!;
  const refreshButton = document.querySelector<HTMLButtonElement>('#refresh-workspace')!;
  const closeButton = document.querySelector<HTMLButtonElement>('#close-workspace')!;
  const modes = [...document.querySelectorAll<HTMLButtonElement>('[data-sidebar-mode]')];
  let mode = localStorage.getItem(MODE_KEY) === 'workspace' ? 'workspace' : 'single';
  let root: FolderRoot | null = null, generation = 0, started = false, choosing = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const directories = new Map<string, Directory>();
  const icons = { ChevronRight, File, FileCode2, Folder, FolderOpen, Link2, LoaderCircle, RefreshCw, X };
  function setStatus(message: string) { status.textContent = message; }
  function setMode(next: string) {
    mode = next === 'workspace' ? 'workspace' : 'single';
    single.hidden = mode !== 'single'; workspace.hidden = mode !== 'workspace';
    modes.forEach(button => { button.classList.toggle('active', button.dataset.sidebarMode === mode); button.setAttribute('aria-pressed', String(button.dataset.sidebarMode === mode)); });
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* The current view remains usable without persistence. */ }
  }
  function directory(path: string) {
    let state = directories.get(path);
    if (!state) { state = { entries: [], loaded: false, loading: false, expanded: path === '' }; directories.set(path, state); }
    return state;
  }
  function updateRoot(result: FolderResult) {
    generation++; directories.clear(); root = result.root;
    if (root) directories.set('', { entries: result.entries, loaded: true, loading: false, expanded: true, nextOffset: result.nextOffset });
    setStatus(root ? '' : '尚未打开文件夹'); render();
  }
  function invalidateRequests() {
    generation++;
    for (const state of directories.values()) state.loading = false;
  }
  function refreshTree() {
    if (!root || choosing) return;
    invalidateRequests();
    for (const [path, state] of directories) {
      if (!path) continue;
      state.entries = []; state.loaded = false; state.error = undefined; state.nextOffset = undefined;
    }
    const expanded = [...directories.entries()].filter(([path, state]) => path && state.expanded).map(([path]) => path).slice(0, 30);
    void load('');
    for (const path of expanded) void load(path);
  }
  async function load(path: string, append = false) {
    if (!root) return;
    const state = directory(path), stamp = generation, rootId = root.id;
    if (state.loading) return;
    const offset = append ? state.nextOffset ?? 0 : 0;
    state.loading = true; state.error = undefined; render();
    try {
      const response = await folderRequest('list', { rootId, path, offset });
      if (stamp !== generation || root?.id !== rootId) return;
      const result = parseFolderResult(response, { rootId, path, offset });
      if (!result.root) throw new Error('工作区文件夹已不可用。');
      const existing = append ? state.entries : [];
      const seen = new Set(existing.map(entry => entry.path));
      state.entries = [...existing, ...result.entries.filter(entry => !seen.has(entry.path))];
      state.nextOffset = result.nextOffset; state.loaded = true; setStatus('');
    } catch (error) {
      if (stamp !== generation) return;
      state.error = error instanceof Error ? error.message : '目录读取失败。';
      setStatus(state.error);
    } finally { if (stamp === generation) { state.loading = false; render(); } }
  }
  function renderDirectory(path: string, container: HTMLElement, depth: number) {
    const state = directory(path);
    for (const entry of state.entries) {
      const item = document.createElement('div'); item.className = 'workspace-node';
      const button = document.createElement('button'); button.type = 'button'; button.className = 'workspace-entry';
      button.style.setProperty('--tree-depth', String(Math.min(depth, 12)));
      button.dataset.path = entry.path; button.dataset.kind = entry.type;
      button.setAttribute('role', 'treeitem'); button.setAttribute('aria-level', String(depth + 1));
      button.title = entry.link ? `${entry.name} · 链接不可打开` : entry.type === 'file' && !entry.supported ? `${entry.name} · 不支持编辑` : entry.name;
      button.setAttribute('aria-label', `${entry.type === 'directory' ? '文件夹' : '文件'} ${entry.name}`);
      const chevron = document.createElement('i'); chevron.dataset.lucide = entry.type === 'directory' ? 'chevron-right' : 'file';
      chevron.className = entry.type === 'directory' ? 'folder-chevron' : 'file-placeholder';
      const glyph = document.createElement('i'); glyph.dataset.lucide = entry.link ? 'link-2' : entry.type === 'directory' ? 'folder' : entry.supported ? 'file-code-2' : 'file';
      const label = document.createElement('span'); label.textContent = entry.name;
      button.append(chevron, glyph, label);
      button.disabled = entry.link === true || !entry.supported;
      item.append(button); container.append(item);
      if (entry.type === 'directory') {
        const child = directory(entry.path);
        button.setAttribute('aria-expanded', String(child.expanded));
        button.classList.toggle('expanded', child.expanded);
        button.onclick = () => {
          child.expanded = !child.expanded;
          if (child.expanded && !child.loaded) void load(entry.path);
          else render();
        };
        button.onkeydown = event => {
          if (event.key === 'ArrowRight' && !child.expanded || event.key === 'ArrowLeft' && child.expanded) { event.preventDefault(); button.click(); }
        };
        if (child.expanded) {
          const group = document.createElement('div'); group.setAttribute('role', 'group'); item.append(group);
          renderDirectory(entry.path, group, depth + 1);
        }
      } else {
        button.onclick = () => {
          if (!root || button.disabled) return;
          const expected = root.id;
          void options.openFile(expected, entry.path).catch(error => options.notice(error instanceof Error ? error.message : '文件打开失败。'));
        };
      }
    }
    if (state.loading) {
      const loading = document.createElement('div'); loading.className = 'workspace-tree-message'; loading.setAttribute('role', 'status'); loading.textContent = '正在读取…'; container.append(loading);
    } else if (state.error) {
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'workspace-tree-message workspace-retry';
      retry.textContent = '重新读取目录'; retry.onclick = () => void load(path); container.append(retry);
    } else if (!state.entries.length && state.loaded) {
      const empty = document.createElement('div'); empty.className = 'workspace-tree-message'; empty.textContent = '空文件夹'; container.append(empty);
    }
    if (state.nextOffset !== undefined && !state.loading) {
      const more = document.createElement('button'); more.type = 'button'; more.className = 'workspace-load-more';
      more.textContent = '加载更多'; more.setAttribute('aria-label', `加载更多 ${path || root?.name || ''}`);
      more.onclick = () => void load(path, true); container.append(more);
    }
  }
  function render() {
    const focused = tree.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.path : undefined;
    tree.replaceChildren();
    rootTools.hidden = !root;
    rootName.textContent = root?.name ?? ''; rootName.title = root?.path ?? '';
    chooseButton.disabled = choosing; closeButton.disabled = choosing;
    refreshButton.disabled = choosing || !root || directory('').loading;
    if (root) renderDirectory('', tree, 0);
    createIcons({ icons, root: workspace, attrs: { 'stroke-width': 1.65 } });
    if (focused) [...tree.querySelectorAll<HTMLElement>('[data-path]')].find(button => button.dataset.path === focused)?.focus();
  }
  async function restore() {
    if (choosing) return;
    invalidateRequests();
    const stamp = generation;
    setStatus('正在恢复工作区…');
    try {
      const response = await folderRequest('restore');
      if (stamp !== generation) return;
      updateRoot(parseFolderResult(response));
    } catch (error) { if (stamp === generation) setStatus(error instanceof Error ? error.message : '工作区恢复失败。'); }
  }
  async function choose() {
    if (choosing) return;
    invalidateRequests();
    const stamp = generation;
    choosing = true; render();
    try {
      const result = parseFolderResult(await folderRequest('choose'));
      if (stamp !== generation) return;
      if (!result.cancelled) { setMode('workspace'); updateRoot(result); }
    } catch (error) {
      const message = error instanceof Error ? error.message : '文件夹打开失败。';
      setStatus(message); options.notice(message);
    }
    finally { choosing = false; render(); }
  }
  async function close() {
    invalidateRequests();
    const stamp = generation;
    try {
      const result = await folderRequest('close');
      if (stamp === generation) updateRoot(parseFolderResult(result));
    } catch (error) { setStatus(error instanceof Error ? error.message : '工作区关闭失败。'); }
  }
  modes.forEach(button => { button.onclick = () => { setMode(button.dataset.sidebarMode!); if (mode === 'workspace' && started && !root) void restore(); }; });
  chooseButton.onclick = () => void choose();
  refreshButton.onclick = refreshTree;
  closeButton.onclick = () => void close();
  setMode(mode); render();
  return {
    start() { if (started) return; started = true; if (mode === 'workspace') void restore(); },
    handleMessage: handleFolderMessage,
    refreshAfterSave() {
      if (!root || mode !== 'workspace') return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        const expanded = [...directories.entries()].filter(([path, state]) => path && state.expanded && state.loaded).map(([path]) => path).slice(0, 30);
        void load('');
        for (const path of expanded) void load(path);
      }, 180);
    },
  };
}
