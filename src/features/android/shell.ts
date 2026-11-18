import { createIcons, ArrowLeft, Cloud, FileText, Files, FolderOpen, FolderTree, ListTree, Search, Settings2, Plus, X, Type, Ellipsis, SunMoon, Puzzle, Image, Keyboard, Download, Heading1, Bold, Italic, Link2, Code2, Quote, Table2, ListChecks, Sigma } from 'lucide';
import { isAndroid } from '../../platform/android';
import { send, type TabData } from '../../platform/bridge';
import { documentLanguage } from '../../documents/formats';
import { openUpdates } from '../updates/updates';
import { initializeTheme } from '../theme/theme';
import type { EditorMode } from '../../editor/editor';
import './shell.css';

interface Options {
  snapshot(): { id: string; name: string; tabs: TabData[]; mode: EditorMode; markdown: boolean; busy: boolean };
  action(type: string, payload?: Record<string, unknown>): void;
  insert(command: string): void;
  heading(level: number): void;
  setMode(mode: EditorMode): void;
  setFont(size: number): void;
  openCloud(intent?: 'browse' | 'save'): void;
  rename(id: string): void;
  measure(): void;
}
const icons = { ArrowLeft, Cloud, FileText, Files, FolderOpen, FolderTree, ListTree, Search, Settings2, Plus, X, Type, Ellipsis, SunMoon, Puzzle, Image, Keyboard, Download, Heading1, Bold, Italic, Link2, Code2, Quote, Table2, ListChecks, Sigma };
const glyph = (name: string) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
function iconButton(id: string, label: string, icon: string) { return `<button id="${id}" type="button" class="icon-button" aria-label="${label}" title="${label}">${glyph(icon)}</button>`; }
function escape(value: string) { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!)); }

export function initializeAndroidShell(options: Options) {
  if (!isAndroid) return { refresh() {}, receiveWorkspace() {}, completeOperation() {}, conflict(_message: { documentId: string; owner: string; path: string }) {} };
  const app = document.querySelector<HTMLElement>('#app')!;
  const editor = app.querySelector<HTMLElement>('.workspace')!;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  let page = 'library', filter = 'all', query = '', openedOnce = false;
  let renderedFiles = '';
  let visibleTab = '';
  let conflict: { documentId: string; owner: string; path: string } | undefined;
  const pageElement = document.createElement('section');
  pageElement.id = 'mobile-page';
  pageElement.innerHTML = `<header class="mobile-appbar"><div id="mobile-title"></div><div id="mobile-header-actions"></div></header>
    <div id="mobile-library" class="mobile-page-content"><div class="mobile-title-row"><h1>我的文档</h1><button id="mobile-new" class="mobile-primary">${glyph('plus')}新建</button></div><label class="mobile-search">${glyph('search')}<input id="mobile-search" type="search" placeholder="搜索文档" aria-label="搜索文档"></label><div class="mobile-filters" role="group" aria-label="文档范围"><button data-filter="all" aria-pressed="true">全部</button><button data-filter="local" aria-pressed="false">本地</button><button data-filter="cloud" aria-pressed="false">云文档</button></div><div class="mobile-section-title">最近编辑</div><div id="mobile-files"></div><p class="mobile-hint" id="mobile-draft-hint">草稿暂存于此设备</p></div>
    <div id="mobile-folders" class="mobile-page-content" hidden><div class="mobile-title-row"><h1>工作区</h1><span id="mobile-folder-actions"></span></div><div id="mobile-folder-content"></div></div>
    <div id="mobile-settings" class="mobile-page-content" hidden><h1>设置</h1><div class="mobile-settings-group"><h2>外观</h2><div class="mobile-theme-options"><button data-theme-choice="light">浅色</button><button data-theme-choice="dark">深色</button><button data-theme-choice="system">跟随系统</button></div><label class="mobile-range-label">正文字号 <output id="mobile-font-output"></output><input type="range" id="mobile-font" min="14" max="22" step="1" aria-label="正文字号"></label><button data-click="custom-background">${glyph('image')}主题背景</button></div><div class="mobile-settings-group"><h2>编辑</h2><button data-click="manage-plugins">${glyph('puzzle')}插件</button><button id="mobile-shortcuts">${glyph('keyboard')}外接键盘快捷键</button><label class="mobile-switch">显示多文档标签<input id="mobile-show-tabs" type="checkbox" checked></label></div><div class="mobile-settings-group"><h2>账号与应用</h2><button id="mobile-settings-cloud">${glyph('cloud')}GitHub 云文档</button><button id="mobile-updates">${glyph('download')}版本与更新</button></div></div>`;
  app.prepend(pageElement);
  const navigation = document.createElement('nav'); navigation.id = 'mobile-navigation'; navigation.setAttribute('aria-label', '主要导航');
  navigation.innerHTML = [['library', '文档', 'files'], ['folders', '工作区', 'folder-tree'], ['cloud', '云文档', 'cloud'], ['settings', '设置', 'settings-2']].map(([id, title, icon]) => `<button type="button" data-mobile-page="${id}">${glyph(icon)}<span>${title}</span></button>`).join('');
  app.append(navigation);
  const brand = $('brand-updates');
  $('mobile-title').append(brand);
  $('mobile-header-actions').append($('open-file'));
  $('mobile-folder-actions').append($('open-folder'));
  const folderPanel = $('workspace-document-panel');
  $('mobile-folder-content').append(folderPanel);
  const topbar = editor.querySelector<HTMLElement>('.topbar')!;
  topbar.insertAdjacentHTML('afterbegin', iconButton('mobile-back', '返回文档库', 'arrow-left'));
  topbar.append($('save-file'));
  topbar.insertAdjacentHTML('beforeend', iconButton('mobile-outline', '文档大纲', 'list-tree'));
  const tools = document.createElement('div'); tools.id = 'mobile-editor-tools';
  const extras = document.createElement('div'); extras.hidden = true; extras.id = 'mobile-extra-tools';
  const format = $('format-tools');
  for (const id of ['bold', 'italic', 'link', 'code', 'table', 'quote']) extras.append($(id));
  tools.append($('undo'), $('redo'));
  tools.insertAdjacentHTML('beforeend', '<button id="mobile-format" type="button" class="icon-button" aria-label="格式工具">Aa</button>');
  tools.append($('math'), $('image'));
  tools.insertAdjacentHTML('beforeend', '<button id="mobile-commands" type="button" class="icon-button" aria-label="快捷指令">/?</button>');
  tools.append($('more'));
  format.remove(); editor.append(extras, tools);
  $('more-menu').classList.add('mobile-more-menu');
  $('more-menu').insertAdjacentHTML('afterbegin', '<h2>更多功能</h2>' + iconButton('mobile-more-close', '关闭更多功能', 'x'));
  for (const [id, text, icon] of [['mobile-menu-outline', '文档大纲', 'list-tree'], ['mobile-menu-search', '查找替换', 'search'], ['mobile-menu-pdf', '导出 PDF', 'download'], ['mobile-menu-focus', '专注模式', 'files'], ['mobile-menu-cloud', '云文档', 'cloud'], ['mobile-menu-rename', '重命名', 'type'], ['mobile-menu-close', '关闭文档', 'x']]) {
    $('more-menu').insertAdjacentHTML('beforeend', `<button id="${id}">${glyph(icon)}<span>${text}</span></button>`);
  }
  $('save-menu').insertAdjacentHTML('afterbegin', '<h2>保存与导出</h2>' + iconButton('mobile-save-close', '关闭保存菜单', 'x'));
  const sheet = document.createElement('dialog'); sheet.id = 'mobile-sheet'; sheet.className = 'feature-dialog mobile-sheet';
  document.body.append(sheet);
  function drawIcons(root: HTMLElement = app) {
    root.querySelectorAll('svg[data-lucide]').forEach(element => element.removeAttribute('data-lucide'));
    createIcons({ icons, root, attrs: { 'stroke-width': 1.65 } });
  }
  function click(id: string) { $(id).click(); }
  function openSheet(title: string, content: string) {
    sheet.innerHTML = `<header><h2>${title}</h2><button type="button" class="icon-button" aria-label="关闭面板">${glyph('x')}</button></header><div class="mobile-sheet-content">${content}</div>`;
    sheet.querySelector('header button')!.addEventListener('click', () => sheet.close());
    drawIcons(sheet); if (!sheet.open) sheet.showModal();
  }
  function newDocument() {
    openSheet('新建文档', [['md', 'Markdown', 'file-text'], ['yaml', 'YAML', 'code-2'], ['html', 'HTML', 'code-2'], ['txt', '纯文本', 'file-text']].map(([kind, title, icon]) => `<button data-new-kind="${kind}">${glyph(icon)}${title}</button>`).join(''));
  }
  function showOutline() {
    openSheet('文档大纲', '<div id="mobile-outline-content"></div>');
    const target = sheet.querySelector('#mobile-outline-content')!;
    for (const source of [...$('outline').querySelectorAll<HTMLButtonElement>('button')]) {
      const item = document.createElement('button'); item.textContent = source.textContent; item.className = source.className;
      item.onclick = () => { sheet.close(); source.click(); };
      target.append(item);
    }
    if (!target.childNodes.length) target.textContent = '添加标题后会出现在这里。';
  }
  function editorPage() {
    page = 'editor'; app.dataset.mobilePage = page; pageElement.hidden = true; editor.hidden = false; navigation.hidden = true;
    localStorage.setItem('minimark.android.page', page);
    visibleTab = ''; refresh();
    requestAnimationFrame(options.measure);
  }
  function showPage(next: string) {
    $('more-menu').hidden = true; $('save-menu').hidden = true;
    if (next !== 'cloud' && $<HTMLDialogElement>('cloud-dialog').open) {
      page = next;
      $<HTMLDialogElement>('cloud-dialog').close();
    }
    if (next === 'cloud') {
      page = 'cloud'; app.dataset.mobilePage = page; pageElement.hidden = true; editor.hidden = true; navigation.hidden = false;
      options.openCloud();
    } else {
      page = next; app.dataset.mobilePage = page; pageElement.hidden = false; editor.hidden = true; navigation.hidden = false;
      for (const [name, id] of [['library', 'mobile-library'], ['folders', 'mobile-folders'], ['settings', 'mobile-settings']]) $(id).hidden = name !== page;
      if (page === 'folders') { document.querySelector<HTMLButtonElement>('[data-sidebar-mode="workspace"]')!.click(); folderPanel.hidden = false; }
      refresh();
    }
    navigation.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.setAttribute('aria-current', button.dataset.mobilePage === page ? 'page' : 'false'));
    localStorage.setItem('minimark.android.page', page === 'cloud' ? 'library' : page);
  }
  function refresh() {
    const snapshot = options.snapshot();
    const tabs = snapshot.tabs.filter(tab => tab.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (filter === 'all' || (filter === 'cloud' ? Boolean(tab.cloud) : !tab.cloud)));
    const filesKey = JSON.stringify(tabs.map(tab => [tab.id, tab.name, tab.path, tab.cloud?.path, tab.dirty]));
    const list = $('mobile-files');
    if (filesKey !== renderedFiles) {
      renderedFiles = filesKey; list.replaceChildren();
      for (const tab of tabs) {
        const row = document.createElement('div'); row.className = 'mobile-file-row';
        const language = documentLanguage(tab.name);
        row.innerHTML = `<button class="mobile-file" data-mobile-document="${escape(tab.id)}"><span class="mobile-file-glyph ${language}">${language === 'markdown' ? glyph('file-text') : language.toUpperCase()}</span><span><strong>${escape(tab.name)}</strong><small>${tab.cloud ? '云文档' : tab.path ? '本地文件' : '本地草稿'} · ${tab.dirty ? '有未保存修改' : tab.path || tab.cloud ? '已保存' : '已暂存'}</small></span></button><button class="icon-button" data-mobile-menu="${escape(tab.id)}" aria-label="${escape(tab.name)}的操作">${glyph('ellipsis')}</button>`;
        list.append(row);
      }
      if (!tabs.length) list.innerHTML = '<p class="mobile-empty">没有匹配的文档</p>';
      drawIcons(list);
    }
    $('mobile-draft-hint').textContent = snapshot.busy ? '正在处理文档…' : '草稿暂存于此设备';
    $('mobile-format').toggleAttribute('disabled', !snapshot.markdown || snapshot.mode === 'read' || snapshot.busy);
    $('mobile-commands').toggleAttribute('disabled', !snapshot.markdown || snapshot.mode === 'read' || snapshot.busy);
    for (const id of ['undo', 'redo', 'bold', 'italic', 'link', 'code', 'table', 'quote', 'math', 'image']) {
      const markdownOnly = id !== 'undo' && id !== 'redo';
      $(id).toggleAttribute('disabled', snapshot.busy || snapshot.mode === 'read' || markdownOnly && !snapshot.markdown);
    }
    $('mobile-outline').toggleAttribute('disabled', !snapshot.markdown);
    const nextTab = `${snapshot.id}:${snapshot.name}`;
    if (page === 'editor' && visibleTab !== nextTab) {
      visibleTab = nextTab;
      requestAnimationFrame(() => $('tabs').querySelector('.document-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' }));
    }
    const font = Number(localStorage.getItem('moye.font')) || 16;
    $('mobile-font-output').textContent = `${font} px`; $<HTMLInputElement>('mobile-font').value = String(font);
    $('mobile-show-tabs').toggleAttribute('checked', localStorage.getItem('minimark.android.tabs') !== 'false');
    app.classList.toggle('mobile-tabs-hidden', localStorage.getItem('minimark.android.tabs') === 'false');
    $('mobile-settings').querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === (localStorage.getItem('moye.theme') || 'system'))));
  }
  $('mobile-new').onclick = newDocument;
  $('new-tab').addEventListener('click', event => { event.stopImmediatePropagation(); newDocument(); }, true);
  $('mobile-back').onclick = () => { app.classList.remove('focus-mode'); showPage('library'); };
  $('mobile-outline').onclick = showOutline;
  $('mobile-menu-outline').onclick = () => { $('more-menu').hidden = true; showOutline(); };
  for (const [id, target] of [['mobile-menu-search', 'search'], ['mobile-menu-pdf', 'save-pdf'], ['mobile-menu-focus', 'focus-mode']]) $(id).onclick = () => { $('more-menu').hidden = true; click(target); };
  $('mobile-menu-cloud').onclick = () => { $('more-menu').hidden = true; options.openCloud(); };
  $('mobile-menu-rename').onclick = () => { $('more-menu').hidden = true; options.rename(options.snapshot().id); };
  $('mobile-menu-close').onclick = () => { $('more-menu').hidden = true; options.action('closeTab', { targetId: options.snapshot().id }); };
  $('mobile-more-close').onclick = () => { $('more-menu').hidden = true; };
  $('mobile-save-close').onclick = () => { $('save-menu').hidden = true; };
  $('mobile-settings-cloud').onclick = () => showPage('cloud');
  $('mobile-updates').onclick = openUpdates;
  $('mobile-shortcuts').onclick = () => openSheet('外接键盘快捷键', '<p>Ctrl N 新建文档</p><p>Ctrl O 打开文件</p><p>Ctrl S 保存</p><p>Ctrl Shift S 另存为</p><p>Ctrl F 查找替换</p><p>Ctrl 1 … 6 标题等级</p><p>Ctrl W 关闭标签</p>');
  $('mobile-format').onclick = () => openSheet('格式工具', '<div class="mobile-format-grid">' + [['bold', '加粗', 'bold'], ['italic', '斜体', 'italic'], ['link', '链接', 'link-2'], ['code', '代码块', 'code-2'], ['table', '表格', 'table-2'], ['quote', '引用', 'quote']].map(([id, label, icon]) => `<button data-format-click="${id}">${glyph(icon)}${label}</button>`).join('') + '</div><div class="mobile-heading-tools">' + [1, 2, 3, 4, 5, 6].map(level => `<button data-heading="${level}">H${level}</button>`).join('') + '</div>');
  $('mobile-commands').onclick = () => openSheet('快捷指令', [['math', '/公式', 'sigma'], ['image', '/图片', 'image'], ['table', '/表格', 'table-2'], ['code', '/代码', 'code-2'], ['quote', '/引用', 'quote'], ['task', '/待办', 'list-checks']].map(([id, label, icon]) => `<button data-command="${id}">${glyph(icon)}${label}</button>`).join(''));
  $<HTMLInputElement>('mobile-search').oninput = event => { query = (event.target as HTMLInputElement).value; refresh(); };
  $<HTMLInputElement>('mobile-font').oninput = event => { const size = Number((event.target as HTMLInputElement).value); options.setFont(size); $('mobile-font-output').textContent = `${size} px`; };
  $<HTMLInputElement>('mobile-show-tabs').onchange = event => { localStorage.setItem('minimark.android.tabs', String((event.target as HTMLInputElement).checked)); refresh(); };
  document.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button'); if (!button || button.disabled) return;
    if (button.dataset.mobilePage) showPage(button.dataset.mobilePage);
    if (button.dataset.mobileDocument) { editorPage(); options.action('activate', { targetId: button.dataset.mobileDocument }); }
    if (button.dataset.mobileMenu) {
      const id = button.dataset.mobileMenu, doc = options.snapshot().tabs.find(item => item.id === id)!;
      openSheet(doc.name, `<button data-open-doc="${escape(id)}">${glyph('file-text')}打开文档</button><button data-rename-doc="${escape(id)}">${glyph('type')}重命名</button><button data-close-doc="${escape(id)}">${glyph('x')}关闭文档</button>`);
    }
    if (button.dataset.openDoc) { sheet.close(); editorPage(); options.action('activate', { targetId: button.dataset.openDoc }); }
    if (button.dataset.renameDoc) { sheet.close(); options.rename(button.dataset.renameDoc); }
    if (button.dataset.closeDoc) { sheet.close(); options.action('closeTab', { targetId: button.dataset.closeDoc }); }
    if (button.dataset.newKind) {
      const kind = button.dataset.newKind; sheet.close(); editorPage();
      let number = 1; while (options.snapshot().tabs.some(tab => tab.name === `未命名 ${number}.${kind}`)) number++;
      if (kind === 'md') options.action('new');
      else if (kind === 'html') click('new-html');
      else options.action('new', { name: `未命名 ${number}.${kind}`, initialText: '' });
    }
    if (button.dataset.command) {
      sheet.close(); const command = button.dataset.command;
      if (command === 'math' || command === 'image') click(command); else options.insert(command);
    }
    if (button.dataset.formatClick) { sheet.close(); click(button.dataset.formatClick); }
    if (button.dataset.heading) { sheet.close(); options.heading(Number(button.dataset.heading)); }
    if (button.dataset.click) click(button.dataset.click);
    if (button.dataset.filter) { filter = button.dataset.filter; document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); refresh(); }
    if (button.dataset.themeChoice) {
      const theme = button.dataset.themeChoice;
      if (theme === 'system') localStorage.removeItem('moye.theme'); else localStorage.setItem('moye.theme', theme);
      initializeTheme(); refresh();
    }
    if (button.closest('#workspace-tree') && button.dataset.kind === 'file') editorPage();
    if (button.closest('#cloud-entries') && button.classList.contains('cloud-entry') && button.dataset.type === 'file') editorPage();
    if (button.id === 'open-file') { openedOnce = true; }
    if (button.dataset.conflictAction && conflict) {
      const current = options.snapshot();
      if (current.id !== conflict.documentId) { sheet.close(); return; }
      sheet.close();
      if (button.dataset.conflictAction === 'remote') options.action('cloudOpenRemote', { owner: conflict.owner, cloudPath: conflict.path });
      if (button.dataset.conflictAction === 'copy') options.openCloud('save');
    }
  });
  $('cloud-dialog').addEventListener('close', () => { if (!$<HTMLDialogElement>('cloud-dialog').open && page === 'cloud') showPage('library'); });
  window.miniMarkBack = () => {
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (dialog) { const event = new Event('cancel', { cancelable: true }); if (dialog.dispatchEvent(event)) dialog.close(); return true; }
    if (!$('more-menu').hidden || !$('save-menu').hidden) { $('more-menu').hidden = true; $('save-menu').hidden = true; return true; }
    if (page !== 'library') { showPage('library'); return true; }
    return false;
  };
  new MutationObserver(refresh).observe($('tabs'), { childList: true });
  const viewport = window.visualViewport;
  const resize = () => { document.documentElement.style.setProperty('--mobile-height', `${viewport?.height || innerHeight}px`); requestAnimationFrame(options.measure); };
  viewport?.addEventListener('resize', resize); resize();
  const syncAppearance = () => send('appearance', { dark: document.documentElement.dataset.theme === 'dark' });
  new MutationObserver(syncAppearance).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  syncAppearance();
  const savedPage = localStorage.getItem('minimark.android.page');
  drawIcons();
  if (savedPage === 'editor') editorPage(); else showPage(['folders', 'settings'].includes(savedPage || '') ? savedPage! : 'library');
  return {
    refresh,
    receiveWorkspace() {
      if (openedOnce) { openedOnce = false; editorPage(); }
    },
    completeOperation() { openedOnce = false; },
    conflict(message: { documentId: string; owner: string; path: string }) {
      conflict = message;
      openSheet('云端文档已更新', `<p>当前修改已保留。可以另存一份云文档，或将云端版本打开到新标签继续核对。</p><p>${escape(message.owner)}/MiniMarkDisk/${escape(message.path)}</p><button data-conflict-action="copy">${glyph('cloud')}另存一份云文档</button><button data-conflict-action="remote">${glyph('files')}保留本机草稿并打开云端版本</button>`);
    },
  };
}
