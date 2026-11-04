import { createIcons, PanelLeft, FilePlus2, FolderOpen, Save, ChevronDown, Bold, Italic, Link2, Code2, Sigma, Table2, Quote, Undo2, Redo2, Search, Sun, Moon, Focus, MoreHorizontal, FileCode2, Download, X, Check, Circle, List, PencilLine } from 'lucide';
import { undo, redo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { createEditor, insertCommand, modeCompartment, modeExtensions, replaceDocument, setEditorFont, surround, type EditorMode } from './editor';
import { connect, isDesktop, send } from './bridge';
import { headings, renderMarkdown, wordCount } from './markdown';
import { sample } from './sample';
import './style.css';

const icons = { PanelLeft, FilePlus2, FolderOpen, Save, ChevronDown, Bold, Italic, Link2, Code2, Sigma, Table2, Quote, Undo2, Redo2, Search, Sun, Moon, Focus, MoreHorizontal, FileCode2, Download, X, Check, Circle, List, PencilLine };
function icon(name: string) { return `<i data-lucide="${name}"></i>`; }
function tool(id: string, label: string, glyph: string, shortcut = '') {
  return `<button class="icon-button" id="${id}" aria-label="${label}" title="${label}${shortcut ? ` · ${shortcut}` : ''}">${icon(glyph)}</button>`;
}
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <aside class="sidebar" id="sidebar">
    <div class="brand"><img src="./moye.svg" alt="" width="29" height="29"><span>墨页<span class="brand-en">MOYE</span></span></div>
    <div class="file-actions"><button id="new-file">${icon('file-plus-2')}<span>新建</span></button><button id="open-file">${icon('folder-open')}<span>打开</span></button></div>
    <div class="section-label">当前文档</div>
    <button class="current-file" id="current-file">${icon('file-code-2')}<span id="sidebar-filename">未命名.md</span><span class="dirty-dot" id="sidebar-dirty"></span></button>
    <div class="outline-heading"><span class="section-label">大纲</span>${icon('list')}</div>
    <nav class="outline" id="outline" aria-label="文档大纲"></nav>
    <div class="sidebar-bottom"><span class="local-dot"></span><span>${isDesktop ? '本地文档' : '浏览器预览'}</span><span class="version">v0.1</span></div>
  </aside>
  <main class="workspace">
    <header class="topbar">
      <div class="document-heading">${tool('toggle-sidebar', '切换侧栏', 'panel-left', 'Ctrl+\\\\')}<span class="document-name" id="document-name">未命名.md</span><span class="save-state" id="save-state"></span></div>
      <div class="topbar-actions">${tool('save-file', '保存', 'save', 'Ctrl+S')}<span class="divider"></span>${tool('theme', '切换主题', 'moon')}${tool('focus-mode', '专注模式', 'focus', 'Ctrl+Shift+F')}${tool('more', '更多', 'more-horizontal')}</div>
    </header>
    <div class="toolbar">
      <div class="format-tools" id="format-tools">
        ${tool('undo', '撤销', 'undo-2', 'Ctrl+Z')}${tool('redo', '重做', 'redo-2', 'Ctrl+Y')}<span class="divider"></span>
        ${tool('bold', '加粗', 'bold', 'Ctrl+B')}${tool('italic', '斜体', 'italic', 'Ctrl+I')}${tool('link', '链接', 'link-2', 'Ctrl+K')}<span class="divider"></span>
        ${tool('code', '代码块', 'code-2')}${tool('math', '公式', 'sigma')}${tool('table', '表格', 'table-2')}${tool('quote', '引用', 'quote')}
      </div>
      <div class="view-switch" role="group" aria-label="编辑视图"><button data-mode="live" class="active" aria-pressed="true">即时</button><button data-mode="source" aria-pressed="false">源码</button><button data-mode="read" aria-pressed="false">阅读</button></div>
      ${tool('search', '查找与替换', 'search', 'Ctrl+F')}
    </div>
    <div class="document-surface" id="surface"><div id="editor"></div><article class="markdown-body reading-view" id="reading-view" hidden></article></div>
    <footer class="statusbar"><span id="word-count">0 字</span><span id="line-count">1 行</span><span class="status-spacer"></span><span id="cursor-position">第 1 行，第 1 列</span><span class="status-separator"></span><span>UTF-8</span><button id="font-size" title="切换字号" aria-label="切换字号">16 px</button><span class="markdown-badge">Markdown</span></footer>
  </main>
  <div id="more-menu" class="popup-menu" hidden>
    <button id="save-as">${icon('save')}<span>另存为</span><kbd>Ctrl Shift S</kbd></button>
    <button id="export-html">${icon('download')}<span>导出 HTML</span></button>
    <button id="sample">${icon('file-code-2')}<span>示例文档</span></button>
  </div>
  <div class="toast" id="toast" role="status" hidden></div>`;
createIcons({ icons, attrs: { 'stroke-width': 1.65 } });

let mode: EditorMode = 'live';
let name = '未命名.md';
let baseline = '';
let fileOnDisk = false;
let loading = false;
let outlineTimer: ReturnType<typeof setTimeout>;
let persistTimer: ReturnType<typeof setTimeout>;
let toastTimer: ReturnType<typeof setTimeout>;
let fontSize = Number(localStorage.getItem('moye.font')) || 16;
let theme = localStorage.getItem('moye.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
document.documentElement.dataset.theme = theme;
const view = createEditor(document.querySelector('#editor')!, (update) => {
  const line = update.state.doc.lineAt(update.state.selection.main.head);
  document.querySelector('#cursor-position')!.textContent = `第 ${line.number} 行，第 ${update.state.selection.main.head - line.from + 1} 列`;
  if (update.docChanged) {
    const text = update.state.doc.toString();
    document.querySelector('#word-count')!.textContent = `${wordCount(text).toLocaleString()} 字`;
    document.querySelector('#line-count')!.textContent = `${update.state.doc.lines.toLocaleString()} 行`;
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(updateOutline, 160);
    updateSaved(text);
    if (!loading) {
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => send('edit', { text: view.state.doc.toString() }), 120);
    }
  }
});

function updateSaved(text = view.state.doc.toString()) {
  const dirty = text !== baseline;
  document.querySelector('#save-state')!.textContent = dirty ? '未保存' : fileOnDisk ? '已保存' : '草稿';
  document.querySelector('#sidebar-dirty')!.classList.toggle('visible', dirty);
  document.title = `${dirty ? '• ' : ''}${name} · 墨页`;
}

function updateOutline() {
  const outline = document.querySelector('#outline')!;
  outline.replaceChildren();
  for (const heading of headings(view.state.doc.toString())) {
    const button = document.createElement('button');
    button.textContent = heading.text;
    button.style.paddingLeft = `${16 + Math.min(heading.level - 1, 3) * 12}px`;
    button.className = `outline-item level-${heading.level}`;
    button.title = heading.text;
    button.addEventListener('click', () => {
      if (mode === 'read') {
        const all = [...document.querySelector('#reading-view')!.querySelectorAll('h1,h2,h3,h4,h5,h6')];
        const index = headings(view.state.doc.toString()).findIndex((item) => item.from === heading.from);
        all[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        view.dispatch({ selection: { anchor: heading.from }, scrollIntoView: true }); view.focus();
      }
      outline.querySelectorAll('.active').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
    });
    outline.append(button);
  }
  if (!outline.childNodes.length) {
    const empty = document.createElement('span'); empty.className = 'outline-empty'; empty.textContent = '暂无标题'; outline.append(empty);
  }
}

function showToast(message: string) {
  const toast = document.querySelector<HTMLElement>('#toast')!;
  toast.textContent = message; toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 4500);
}

function setMode(next: EditorMode) {
  mode = next;
  document.querySelector('#editor')!.toggleAttribute('hidden', next === 'read');
  const reading = document.querySelector<HTMLElement>('#reading-view')!;
  reading.hidden = next !== 'read';
  if (next === 'read') reading.innerHTML = renderMarkdown(view.state.doc.toString());
  else {
    view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(next)) });
    view.focus();
  }
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === next);
    button.setAttribute('aria-pressed', String(button.dataset.mode === next));
  });
  document.querySelectorAll<HTMLButtonElement>('#format-tools button').forEach((button) => { button.disabled = next === 'read'; });
  document.querySelector('#surface')!.setAttribute('data-mode', next);
}

function nativeAction(type: string) {
  clearTimeout(persistTimer);
  send('edit', { text: view.state.doc.toString() });
  send(type, { text: view.state.doc.toString() });
}

function on(id: string, action: () => void) { document.querySelector(`#${id}`)!.addEventListener('click', action); }
on('new-file', () => nativeAction('new'));
on('open-file', () => nativeAction('open'));
on('save-file', () => nativeAction('save'));
on('save-as', () => { nativeAction('saveAs'); document.querySelector<HTMLElement>('#more-menu')!.hidden = true; });
on('toggle-sidebar', () => app.classList.toggle('sidebar-hidden'));
on('current-file', () => { if (mode === 'read') setMode('live'); view.focus(); });
on('focus-mode', () => app.classList.toggle('focus-mode'));
on('bold', () => surround(view, '**'));
on('italic', () => surround(view, '*'));
on('link', () => surround(view, '[', '](https://)'));
on('undo', () => { undo(view); view.focus(); });
on('redo', () => { redo(view); view.focus(); });
for (const id of ['code', 'math', 'table', 'quote']) on(id, () => insertCommand(view, id));
on('search', () => { if (mode === 'read') setMode('source'); openSearchPanel(view); });
on('theme', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme; localStorage.setItem('moye.theme', theme);
});
on('font-size', () => {
  fontSize = fontSize >= 22 ? 14 : fontSize + 2;
  applyFont(); localStorage.setItem('moye.font', String(fontSize));
});
function applyFont() {
  fontSize = Math.max(14, Math.min(22, fontSize));
  setEditorFont(view, fontSize);
  document.documentElement.style.setProperty('--editor-size', `${fontSize}px`);
  document.querySelector('#font-size')!.textContent = `${fontSize} px`;
}
applyFont();
on('more', () => { const menu = document.querySelector<HTMLElement>('#more-menu')!; menu.hidden = !menu.hidden; });
document.addEventListener('click', (event) => {
  if (!(event.target as Element).closest('#more,#more-menu')) document.querySelector<HTMLElement>('#more-menu')!.hidden = true;
  const anchor = (event.target as Element).closest('a');
  if (anchor) {
    const url = anchor.getAttribute('href');
    if (url?.startsWith('#')) return;
    event.preventDefault(); if (url) send('openExternal', { url });
  }
});
on('sample', () => {
  document.querySelector<HTMLElement>('#more-menu')!.hidden = true;
  if (view.state.doc.toString() !== baseline && !confirm('替换当前未保存的内容？')) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: sample }, selection: { anchor: 0 } });
  if (mode === 'read') setMode('live'); view.focus();
});
on('export-html', async () => {
  document.querySelector<HTMLElement>('#more-menu')!.hidden = true;
  try {
    const { exportHtml } = await import('./export');
    const html = await exportHtml(view.state.doc.toString(), name);
    send('exportHtml', { html });
  } catch (error) { showToast(error instanceof Error ? error.message : '导出失败'); }
});
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode as EditorMode)));
document.addEventListener('keydown', (event) => {
  if (event.isComposing || event.keyCode === 229 || !(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  const actions: Record<string, () => void> = {
    s: () => nativeAction(event.shiftKey ? 'saveAs' : 'save'),
    o: () => nativeAction('open'), n: () => nativeAction('new'),
    b: () => { if (mode !== 'read') surround(view, '**'); },
    i: () => { if (mode !== 'read') surround(view, '*'); },
    k: () => { if (mode !== 'read') surround(view, '[', '](https://)'); },
    '\\': () => app.classList.toggle('sidebar-hidden'),
    '/': () => setMode(mode === 'source' ? 'live' : 'source'),
  };
  if (key === 'f' && event.shiftKey) { event.preventDefault(); event.stopPropagation(); app.classList.toggle('focus-mode'); return; }
  if (actions[key]) { event.preventDefault(); actions[key](); }
}, true);
document.addEventListener('visibilitychange', () => { if (document.hidden) send('edit', { text: view.state.doc.toString() }); });

connect((message) => {
  if (message.type === 'document') {
    const doc = message.document;
    clearTimeout(persistTimer);
    name = doc.name;
    fileOnDisk = Boolean(doc.path);
    baseline = doc.baseline ?? (doc.saved ? doc.text : '');
    loading = true;
    replaceDocument(view, doc.text, mode);
    applyFont();
    loading = false;
    document.querySelector('#document-name')!.textContent = name;
    document.querySelector('#sidebar-filename')!.textContent = name;
    document.querySelector('#current-file')!.setAttribute('title', doc.path || name);
    updateOutline(); updateSaved();
    document.querySelector('#word-count')!.textContent = `${wordCount(doc.text).toLocaleString()} 字`;
    document.querySelector('#line-count')!.textContent = `${view.state.doc.lines.toLocaleString()} 行`;
    if (mode === 'read') setMode('read');
    if (doc.recovered) showToast('已恢复上次未保存的草稿');
    view.focus();
    void document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      window.__MOYE_READY__ = performance.now();
      send('rendered', { elapsed: window.__MOYE_READY__ });
    })));
  } else if (message.type === 'saved') {
    name = message.name; baseline = message.text; fileOnDisk = true;
    document.querySelector('#document-name')!.textContent = name;
    document.querySelector('#sidebar-filename')!.textContent = name;
    updateSaved(); showToast('已保存');
  } else if (message.type === 'requestClosingText') {
    clearTimeout(persistTimer);
    send('closingText', { text: view.state.doc.toString() });
  } else showToast(message.message);
});
