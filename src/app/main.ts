import { createIcons, X } from 'lucide';
import { mountApp, icon } from '../ui/layout';
import { undo, redo, isolateHistory } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import type { EditorState } from '@codemirror/state';
import { createEditor, insertCommand, modeCompartment, modeExtensions, replaceDocument, setEditorFont, setEditorEditable, setEditorLanguage, setHeadingLevel, surround, type EditorMode } from '../editor/editor';
import { connect, isDesktop, send, type DocumentData, type TabData } from '../platform/bridge';
import { headings, renderMarkdown, renderYaml, wordCount, setImageDocument } from '../markdown/render';
import { sample } from '../documents/sample';
import { documentLanguage, formatLabel, type DocumentLanguage } from '../documents/formats';
import { htmlTemplate, openBrowserPreview } from '../features/html/preview';
import { normalizeText } from '../documents/workspace';
import { APP_VERSION, initializeUpdates, openUpdates, scheduleUpdateCheck, handleUpdateMessage } from '../features/updates/updates';
import { initializeTheme, toggleTheme } from '../features/theme/theme';
import { initializeImages, handleImageMessage } from '../features/images/images';
import { initializePlugins } from '../features/plugins/manager';
import { initializeFormulas } from '../features/formulas/formulas';
import { handleFormulaMessage } from '../features/formulas/clipboard';
import '../styles/app.css';

const app = mountApp(isDesktop, APP_VERSION);
initializeUpdates();

let mode: EditorMode = 'live';
let name = '未命名.md';
let language: DocumentLanguage = 'markdown';
let baseline = '';
let fileOnDisk = false;
let loading = false;
let activeId = '';
let revision = 0;
let tabs: TabData[] = [];
let transitionPending = false;
interface CachedDocument { document: DocumentData; state: EditorState; mode: EditorMode; language: DocumentLanguage; editorScroll: number; readingScroll: number }
const documents = new Map<string, CachedDocument>();
let renderedTabsKey = '';
const tabElements = new Map<string, HTMLElement>();
const tabsContainer = document.querySelector<HTMLElement>('#tabs')!;
const tabIndicator = document.createElement('span');
tabIndicator.className = 'tab-indicator';
tabIndicator.setAttribute('aria-hidden', 'true');
tabsContainer.append(tabIndicator);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let surfaceAnimation: Animation | undefined;
reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) surfaceAnimation?.cancel(); });
new ResizeObserver(() => positionTabIndicator()).observe(tabsContainer);
void document.fonts.ready.then(() => positionTabIndicator());
let outlineTimer: ReturnType<typeof setTimeout>;
let persistTimer: ReturnType<typeof setTimeout>;
let previewTimer: ReturnType<typeof setTimeout>;
let toastTimer: ReturnType<typeof setTimeout>;
let fontSize = Number(localStorage.getItem('moye.font')) || 16;
initializeTheme();
const view = createEditor(document.querySelector('#editor')!, (update) => {
  const line = update.state.doc.lineAt(update.state.selection.main.head);
  document.querySelector('#cursor-position')!.textContent = `第 ${line.number} 行，第 ${update.state.selection.main.head - line.from + 1} 列`;
  if (update.docChanged) {
    if (!loading) revision++;
    const text = update.state.doc.toString();
    document.querySelector('#word-count')!.textContent = `${wordCount(text).toLocaleString()} 字`;
    document.querySelector('#line-count')!.textContent = `${update.state.doc.lines.toLocaleString()} 行`;
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(updateOutline, 160);
    if (mode === 'split') {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(refreshPreview, 90);
    }
    updateSaved(text);
    if (!loading) {
      clearTimeout(persistTimer);
      const snapshot = snapshotCurrent();
      persistTimer = setTimeout(() => send('edit', snapshot), 120);
    }
  }
});
const imageActions = initializeImages({
  view, notice: showToast,
  snapshot: () => ({ documentId: activeId, revision, editable: !transitionPending && mode !== 'read' && language === 'markdown' }),
});
const formulaActions = initializeFormulas({
  view, notice: showToast,
  snapshot: () => ({ documentId: activeId, revision, editable: !transitionPending && mode !== 'read' && language === 'markdown' }),
});
const pluginActions = initializePlugins({
  notice: showToast,
  snapshot: () => ({
    documentId: activeId, revision, editable: !transitionPending && mode !== 'read',
    context: {
      name, language, text: view.state.doc.toString(),
      selection: { from: view.state.selection.main.from, to: view.state.selection.main.to },
      selectedText: view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to),
    },
  }),
  apply: (snapshot, result) => {
    if (result.replaceSelection === undefined && result.replaceDocument === undefined) return;
    if (!snapshot.editable || transitionPending || mode === 'read' || view.composing || snapshot.documentId !== activeId || snapshot.revision !== revision) throw new Error('文档已修改或切换，请重新执行插件。');
    const replaceAll = result.replaceDocument !== undefined;
    const from = replaceAll ? 0 : snapshot.context.selection.from;
    const to = replaceAll ? view.state.doc.length : snapshot.context.selection.to;
    const text = normalizeText(result.replaceDocument ?? result.replaceSelection!);
    view.dispatch({
      changes: { from, to, insert: text }, selection: { anchor: from + text.length },
      annotations: isolateHistory.of('full'), userEvent: 'input',
    });
  },
});

function updateSaved(text = view.state.doc.toString()) {
  const dirty = text !== baseline;
  document.querySelector('#save-state')!.textContent = dirty ? '未保存' : fileOnDisk ? '已保存' : '草稿';
  document.querySelector('#sidebar-dirty')!.classList.toggle('visible', dirty);
  document.title = `${dirty ? '• ' : ''}${name} · Mini Mark`;
  const tab = tabs.find(item => item.id === activeId);
  if (tab) { tab.dirty = dirty; tab.revision = revision; }
  renderTabs();
}

function snapshotCurrent() { return { documentId: activeId, revision, text: view.state.doc.toString() }; }
function setTransitionPending(pending: boolean) {
  transitionPending = pending;
  setEditorEditable(view, !pending);
  app.classList.toggle('transition-pending', pending);
}
function cacheCurrent() {
  if (!activeId) return;
  const previous = documents.get(activeId);
  documents.set(activeId, {
    document: { id: activeId, name, text: view.state.doc.toString(), baseline, revision, path: previous?.document.path },
    state: view.state,
    mode,
    language,
    editorScroll: view.scrollDOM.scrollTop,
    readingScroll: document.querySelector<HTMLElement>('#reading-view')!.scrollTop,
  });
}
function renderTabs() {
  const key = JSON.stringify([activeId, tabs.map(tab => [tab.id, tab.name, tab.path, tab.dirty])]);
  if (key === renderedTabsKey) return;
  renderedTabsKey = key;
  for (const [id, item] of tabElements) {
    if (!tabs.some(tab => tab.id === id)) { item.remove(); tabElements.delete(id); }
  }
  for (const tab of tabs) {
    let item = tabElements.get(tab.id);
    if (!item) {
      item = document.createElement('div');
      const button = document.createElement('button');
      button.className = 'tab-select'; button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', 'surface');
      button.addEventListener('click', () => { if (tab.id !== activeId) nativeAction('activate', { targetId: tab.id }); });
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = tabs.findIndex(item => item.id === tab.id);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        nativeAction('activate', { targetId: tabs[next].id });
      });
      const dot = document.createElement('span'); dot.className = 'tab-dirty'; dot.setAttribute('aria-label', '未保存');
      const close = document.createElement('button'); close.className = 'tab-close icon-button';
      close.innerHTML = icon('x');
      close.addEventListener('click', () => nativeAction('closeTab', { targetId: tab.id }));
      item.append(button, dot, close);
      tabsContainer.insertBefore(item, tabIndicator);
      tabElements.set(tab.id, item);
      createIcons({ icons: { X }, root: item, attrs: { 'stroke-width': 1.65 } });
    }
    item.className = `document-tab${tab.id === activeId ? ' active' : ''}${tab.dirty ? ' dirty' : ''}`;
    const button = item.querySelector<HTMLButtonElement>('.tab-select')!;
    button.setAttribute('aria-selected', String(tab.id === activeId));
    button.setAttribute('aria-description', tab.path || tab.name);
    button.textContent = tab.name;
    button.tabIndex = tab.id === activeId ? 0 : -1;
    item.querySelector('.tab-close')!.setAttribute('aria-label', `关闭 ${tab.name}`);
  }
  positionTabIndicator();
  tabsContainer.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}

function positionTabIndicator() {
  const active = tabElements.get(activeId);
  if (!active) { tabIndicator.style.opacity = '0'; return; }
  tabIndicator.style.width = `${active.offsetWidth}px`;
  tabIndicator.style.transform = `translateX(${active.offsetLeft}px)`;
  tabIndicator.style.opacity = '1';
  requestAnimationFrame(() => tabIndicator.classList.add('positioned'));
}

function animateDocumentSwitch() {
  surfaceAnimation?.cancel();
  if (reducedMotion.matches) return;
  surfaceAnimation = document.querySelector('#surface')!.animate([{ opacity: .72 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' });
}

function updateOutline() {
  const outline = document.querySelector('#outline')!;
  outline.replaceChildren();
  if (language !== 'markdown') {
    const empty = document.createElement('span'); empty.className = 'outline-empty'; empty.textContent = '暂无标题'; outline.append(empty);
    return;
  }
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

function updateDocumentFormatUi() {
  const isYaml = language === 'yaml';
  const isHtml = language === 'html';
  app.classList.toggle('html-document', isHtml);
  document.querySelector<HTMLElement>('#html-tools')!.hidden = !isHtml;
  document.querySelector<HTMLElement>('.view-switch')!.hidden = isHtml;
  document.querySelector<HTMLButtonElement>('#save-pdf')!.hidden = isHtml;
  document.querySelector<HTMLButtonElement>('#export-html')!.hidden = isHtml;
  const format = document.querySelector<HTMLElement>('#document-format');
  if (format) format.textContent = formatLabel(name);
  const saveLabel = document.querySelector<HTMLElement>('#save-format-label');
  if (saveLabel) saveLabel.textContent = isHtml ? '保存 HTML (.html)' : isYaml ? '保存 YAML (.yaml)' : '保存 Markdown (.md)';
  const liveButton = document.querySelector<HTMLButtonElement>('.view-switch button[data-mode="live"]');
  if (liveButton) {
    liveButton.disabled = language !== 'markdown';
    liveButton.title = isYaml ? 'YAML 使用源码模式编辑' : '即时排版';
  }
  document.querySelectorAll<HTMLButtonElement>('#format-tools button').forEach((button) => {
    const markdownOnly = !['undo', 'redo'].includes(button.id);
    button.disabled = mode === 'read' || (language !== 'markdown' && markdownOnly);
  });
}

function setMode(next: EditorMode) {
  if (language === 'html') next = 'source';
  if (language === 'yaml' && next === 'live') next = 'source';
  const changed = mode !== next;
  mode = next;
  document.querySelector('#editor')!.toggleAttribute('hidden', next === 'read');
  const reading = document.querySelector<HTMLElement>('#reading-view')!;
  reading.hidden = next !== 'read' && next !== 'split';
  if (next === 'read' || next === 'split') reading.innerHTML = renderDocument(view.state.doc.toString());
  else {
    view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(next)) });
    view.focus();
  }
  if (next === 'split') {
    view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions('source')) });
    view.focus();
  }
  document.querySelectorAll<HTMLButtonElement>('.view-switch button[data-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === next);
    button.setAttribute('aria-pressed', String(button.dataset.mode === next));
  });
  updateDocumentFormatUi();
  document.querySelector('#surface')!.setAttribute('data-mode', next);
  cacheCurrent();
  if (changed) animateDocumentSwitch();
}

function refreshPreview() {
  if (mode === 'read' || mode === 'split') {
    const reading = document.querySelector<HTMLElement>('#reading-view')!;
    const scroll = reading.scrollTop;
    reading.innerHTML = renderDocument(view.state.doc.toString());
    reading.scrollTop = scroll;
  }
}

function renderDocument(text: string) {
  if (language === 'html') {
    const pre = document.createElement('pre'); pre.className = 'html-readonly-source'; pre.textContent = text;
    return pre.outerHTML;
  }
  return language === 'yaml' ? renderYaml(text) : renderMarkdown(text);
}

function toggleSidebar() {
  app.classList.toggle('sidebar-hidden');
  requestAnimationFrame(() => {
    view.requestMeasure();
    positionTabIndicator();
  });
}

function nativeAction(type: string, payload: Record<string, unknown> = {}) {
  if (!activeId || transitionPending) return;
  clearTimeout(persistTimer);
  cacheCurrent();
  setTransitionPending(true);
  // One message carries both the latest revision and the requested transition.
  send(type, { ...snapshotCurrent(), ...payload });
}

function on(id: string, action: () => void) { document.querySelector(`#${id}`)!.addEventListener('click', action); }
on('new-file', () => nativeAction('new'));
on('new-html', () => {
  document.querySelector<HTMLElement>('#more-menu')!.hidden = true;
  let number = 1;
  while (tabs.some(tab => tab.name.toLowerCase() === `未命名 ${number}.html`)) number++;
  nativeAction('new', { name: `未命名 ${number}.html`, initialText: htmlTemplate });
});
function runHtml(target: 'builtin' | 'chrome') {
  if (transitionPending || language !== 'html') return;
  if (isDesktop) nativeAction('runHtml', { target });
  else if (target === 'builtin') openBrowserPreview(view.state.doc.toString());
  else showToast('调用本地 Chrome 请使用桌面版。');
}
on('run-html', () => runHtml('builtin'));
on('chrome-html', () => runHtml('chrome'));
on('new-tab', () => nativeAction('new'));
on('open-file', () => nativeAction('open'));
on('save-file', () => { const menu = document.querySelector<HTMLElement>('#save-menu')!; menu.hidden = !menu.hidden; document.querySelector<HTMLElement>('#more-menu')!.hidden = true; });
on('save-markdown', () => { document.querySelector<HTMLElement>('#save-menu')!.hidden = true; nativeAction('save'); });
on('save-pdf', () => { document.querySelector<HTMLElement>('#save-menu')!.hidden = true; nativeAction('exportPdf'); });
on('save-markdown-as', () => { document.querySelector<HTMLElement>('#save-menu')!.hidden = true; nativeAction('saveAs'); });
on('save-as', () => { nativeAction('saveAs'); document.querySelector<HTMLElement>('#more-menu')!.hidden = true; });
on('toggle-sidebar', toggleSidebar);
on('current-file', () => { if (mode === 'read') setMode('live'); view.focus(); });
on('focus-mode', () => app.classList.toggle('focus-mode'));
on('bold', () => surround(view, '**'));
on('italic', () => surround(view, '*'));
on('link', () => surround(view, '[', '](https://)'));
on('image', () => imageActions.open());
on('undo', () => { undo(view); view.focus(); });
on('redo', () => { redo(view); view.focus(); });
on('math', formulaActions.open);
for (const id of ['code', 'table', 'quote']) on(id, () => insertCommand(view, id));
on('search', () => { if (mode === 'read') setMode('source'); openSearchPanel(view); });
on('theme', toggleTheme);
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
on('check-updates', () => { document.querySelector<HTMLElement>('#more-menu')!.hidden = true; openUpdates(); });
on('manage-plugins', () => { document.querySelector<HTMLElement>('#more-menu')!.hidden = true; pluginActions.open(); });
document.addEventListener('click', (event) => {
  if (!(event.target as Element).closest('#more,#more-menu')) document.querySelector<HTMLElement>('#more-menu')!.hidden = true;
  if (!(event.target as Element).closest('#save-file,#save-menu')) document.querySelector<HTMLElement>('#save-menu')!.hidden = true;
  const anchor = (event.target as Element).closest('a');
  if (anchor) {
    const url = anchor.getAttribute('href');
    if (url?.startsWith('#')) return;
    event.preventDefault(); if (url) send('openExternal', { url });
  }
});
on('sample', () => {
  document.querySelector<HTMLElement>('#more-menu')!.hidden = true;
  nativeAction('new', { initialText: sample, name: '示例文档.md' });
});
on('export-html', async () => {
  if (transitionPending) return;
  document.querySelector<HTMLElement>('#more-menu')!.hidden = true;
  const snapshot = { ...snapshotCurrent(), name };
  setTransitionPending(true);
  try {
    const { exportHtml } = await import('../markdown/export');
    const html = await exportHtml(snapshot.text, snapshot.name);
    send('exportHtml', { html, documentId: snapshot.documentId, name: snapshot.name });
  } catch (error) { setTransitionPending(false); showToast(error instanceof Error ? error.message : '导出失败'); }
});
document.querySelectorAll<HTMLButtonElement>('.view-switch button[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode as EditorMode)));
document.addEventListener('keydown', (event) => {
  if (document.querySelector('dialog[open]')) return;
  if (event.isComposing || event.keyCode === 229 || !(event.ctrlKey || event.metaKey)) return;
  if (transitionPending) { event.preventDefault(); event.stopPropagation(); return; }
  const key = event.key.toLowerCase();
  if (key === 'tab' && tabs.length > 1) {
    event.preventDefault(); event.stopPropagation();
    const index = tabs.findIndex(tab => tab.id === activeId);
    nativeAction('activate', { targetId: tabs[(index + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length].id });
    return;
  }
  const actions: Record<string, () => void> = {
    s: () => nativeAction(event.shiftKey ? 'saveAs' : 'save'),
    o: () => nativeAction('open'), n: () => nativeAction('new'),
    w: () => nativeAction('closeTab', { targetId: activeId }),
    b: () => { if (mode !== 'read' && language === 'markdown') surround(view, '**'); },
    i: () => { if (mode !== 'read' && language === 'markdown') surround(view, '*'); },
    k: () => { if (mode !== 'read' && language === 'markdown') surround(view, '[', '](https://)'); },
    '\\': toggleSidebar,
    '/': () => setMode(mode === 'source' ? 'live' : 'source'),
  };
  if (key === 'f' && event.shiftKey) { event.preventDefault(); event.stopPropagation(); app.classList.toggle('focus-mode'); return; }
  if (/^[1-6]$/.test(key)) {
    const target = event.target as Element | null;
    const editorFocused = view.hasFocus && !target?.closest('input,textarea,select,[role="searchbox"]');
    if (editorFocused && !event.shiftKey && !event.altKey && mode !== 'read' && language === 'markdown') {
      event.preventDefault(); event.stopPropagation(); setHeadingLevel(view, Number(key));
    }
    return;
  }
  if (actions[key]) { event.preventDefault(); actions[key](); }
}, true);
document.addEventListener('visibilitychange', () => { if (document.hidden && activeId) send('edit', snapshotCurrent()); });

let updateScheduled = false;
connect((message) => {
  if (handleFormulaMessage(message)) return;
  if (handleImageMessage(message)) return;
  if (handleUpdateMessage(message)) return;
  if (message.type === 'workspace') {
    const doc = { ...message.document, text: normalizeText(message.document.text), baseline: normalizeText(message.document.baseline) };
    const switchingDocument = Boolean(activeId && activeId !== doc.id);
    clearTimeout(persistTimer);
    if (switchingDocument) {
      const snapshot = snapshotCurrent();
      const hostRevision = message.tabs.find(tab => tab.id === activeId)?.revision;
      // External file opens can arrive before the edit debounce; send only genuinely newer text.
      if (hostRevision !== undefined && snapshot.revision > hostRevision) send('edit', snapshot);
    }
    cacheCurrent();
    tabs = message.tabs;
    for (const id of documents.keys()) if (!tabs.some(tab => tab.id === id)) documents.delete(id);
    const cached = documents.get(doc.id);
    const localIsNewer = cached && cached.document.revision > doc.revision;
    const current = localIsNewer ? cached.document : doc;
    activeId = doc.id;
    setImageDocument(doc.id + ':' + (doc.path ?? ''));
    name = doc.name;
    fileOnDisk = Boolean(doc.path);
    baseline = doc.baseline;
    revision = current.revision;
    loading = true;
    const nextLanguage = documentLanguage(doc.name);
    mode = nextLanguage === 'html' ? 'source' : cached?.mode ?? (nextLanguage === 'yaml' ? 'source' : mode);
    if (nextLanguage === 'yaml' && mode === 'live') mode = 'source';
    language = nextLanguage;
    if (cached && cached.document.text === current.text) {
      view.setState(cached.state);
      if (cached.language !== language) setEditorLanguage(view, language);
    } else replaceDocument(view, current.text, mode, language);
    documents.set(doc.id, {
      document: { ...current, name: doc.name, path: doc.path, baseline },
      state: view.state,
      mode,
      language,
      editorScroll: cached?.editorScroll ?? 0,
      readingScroll: cached?.readingScroll ?? 0,
    });
    applyFont();
    loading = false;
    document.querySelector('#document-name')!.textContent = name;
    document.querySelector('#sidebar-filename')!.textContent = name;
    document.querySelector('#current-file')!.setAttribute('title', doc.path || name);
    updateOutline(); updateSaved();
    document.querySelector('#word-count')!.textContent = `${wordCount(current.text).toLocaleString()} 字`;
    document.querySelector('#line-count')!.textContent = `${view.state.doc.lines.toLocaleString()} 行`;
    setMode(mode);
    const editorScroll = cached?.editorScroll ?? 0;
    const readingScroll = cached?.readingScroll ?? 0;
    view.requestMeasure({
      read: () => ({ editor: editorScroll, reading: readingScroll }),
      write: scroll => {
        if (mode !== 'read') view.scrollDOM.scrollTop = scroll.editor;
        if (mode === 'read' || mode === 'split') document.querySelector<HTMLElement>('#reading-view')!.scrollTop = scroll.reading;
      },
    });
    if (message.recovered) showToast('已恢复上次打开的文档和未保存草稿');
    setTransitionPending(false);
    if (switchingDocument) animateDocumentSwitch();
    if (mode !== 'read') view.focus();
    if (localIsNewer) send('edit', snapshotCurrent());
    void document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      window.__MOYE_READY__ = performance.now();
      send('rendered', { elapsed: window.__MOYE_READY__ });
      if (!updateScheduled) { updateScheduled = true; scheduleUpdateCheck(); }
    })));
  } else if (message.type === 'saved') {
    const cached = documents.get(message.documentId);
    if (cached) Object.assign(cached.document, { name: message.name, path: message.path, baseline: message.text });
    const tab = tabs.find(tab => tab.id === message.documentId);
    if (tab) Object.assign(tab, { name: message.name, path: message.path, dirty: cached ? cached.document.text !== message.text : false });
    if (message.documentId === activeId) {
      name = message.name; baseline = message.text; fileOnDisk = true;
      setImageDocument(activeId + ':' + (message.path ?? ''));
      const nextLanguage = documentLanguage(name);
      if (nextLanguage !== language) {
        language = nextLanguage;
        if (language === 'html' || language === 'yaml' && mode === 'live') mode = 'source';
        setEditorLanguage(view, language);
        if (cached) {
          cached.state = view.state;
          cached.mode = mode;
          cached.language = language;
        }
        setMode(mode);
      }
      document.querySelector('#document-name')!.textContent = name;
      document.querySelector('#sidebar-filename')!.textContent = name;
      document.querySelector('#current-file')!.setAttribute('title', message.path || name);
      updateSaved();
      view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(mode === 'split' ? 'source' : mode)) });
      refreshPreview();
    } else renderTabs();
    showToast(`已保存：${message.name}`);
  } else if (message.type === 'requestClosingText') {
    clearTimeout(persistTimer);
    setTransitionPending(true);
    send('closingText', { ...snapshotCurrent(), requestId: message.requestId });
  } else if (message.type === 'requestExportPdf') {
    showToast('正在生成 PDF…');
    void import('../markdown/export').then(async ({ exportHtml }) => {
      const html = await exportHtml(message.text, message.name);
      send('pdfHtml', { requestId: message.requestId, documentId: message.documentId, html });
    }).catch(error => send('pdfError', { requestId: message.requestId, documentId: message.documentId, message: error instanceof Error ? error.message : 'PDF 排版失败' }));
  } else if (message.type === 'operationComplete') setTransitionPending(false);
  else {
    if (message.type === 'error') setTransitionPending(false);
    if ('message' in message) showToast(message.message);
  }
});
