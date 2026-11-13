import { createIcons, PanelLeft, FilePlus2, FolderOpen, Save, ChevronDown, Bold, Italic, Link2, Code2, Sigma, Table2, Quote, Undo2, Redo2, Search, Sun, Moon, Focus, MoreHorizontal, FileCode2, Download, X, Check, Circle, List, PencilLine, Columns2, ImagePlus, Puzzle, Play, Globe, Cloud, Image, RefreshCw } from 'lucide';

const icons = { PanelLeft, FilePlus2, FolderOpen, Save, ChevronDown, Bold, Italic, Link2, Code2, Sigma, Table2, Quote, Undo2, Redo2, Search, Sun, Moon, Focus, MoreHorizontal, FileCode2, Download, X, Check, Circle, List, PencilLine, Columns2, ImagePlus, Puzzle, Play, Globe, Cloud, Image, RefreshCw };
export function icon(name: string) { return `<i data-lucide="${name}"></i>`; }
function tool(id: string, label: string, glyph: string, shortcut = '') {
  return `<button class="icon-button" id="${id}" aria-label="${label}" title="${label}${shortcut ? ` · ${shortcut}` : ''}">${icon(glyph)}</button>`;
}

export function mountApp(isDesktop: boolean, version: string) {
  const app = document.querySelector<HTMLDivElement>('#app')!;
  app.innerHTML = `
    <aside class="sidebar" id="sidebar">
      <button class="brand" id="brand-updates" aria-label="Mini Mark 版本与更新" title="版本与更新"><img src="./mini-mark.svg" alt="" width="34" height="34"><span>Mini Mark</span></button>
      <div class="file-actions"><button id="new-file">${icon('file-plus-2')}<span>新建</span></button><button id="open-file">${icon('file-code-2')}<span>打开</span></button><button id="open-folder">${icon('folder-open')}<span>打开文件夹</span></button></div>
      <div class="sidebar-mode-switch" role="group" aria-label="侧栏视图"><button data-sidebar-mode="single" aria-pressed="true">单文档</button><button data-sidebar-mode="workspace" aria-pressed="false">工作区文档</button></div>
      <section id="single-document-panel" class="sidebar-document-panel">
        <div class="section-label">当前文档</div>
        <button class="current-file" id="current-file">${icon('file-code-2')}<span id="sidebar-filename">未命名.md</span><span class="dirty-dot" id="sidebar-dirty"></span></button>
        <div class="outline-heading"><span class="section-label">大纲</span>${icon('list')}</div>
        <nav class="outline" id="outline" aria-label="文档大纲"></nav>
      </section>
      <section id="workspace-document-panel" class="sidebar-document-panel" hidden>
        <div id="workspace-root-tools" hidden><span id="workspace-root-name"></span>${tool('refresh-workspace', '刷新工作区', 'refresh-cw')}${tool('close-workspace', '关闭工作区', 'x')}</div>
        <nav id="workspace-tree" class="workspace-tree" role="tree" aria-label="工作区文件"></nav>
        <p id="workspace-status" role="status">尚未打开文件夹</p>
      </section>
      <div class="sidebar-bottom"><span class="local-dot"></span><button id="cloud-documents" title="打开云文档">${icon('cloud')}<span id="storage-mode">${isDesktop ? '本地文档' : '浏览器预览'}</span></button><span class="version">${version}</span></div>
    </aside>
    <main class="workspace">
      <header class="topbar">
        <div class="document-heading">${tool('toggle-sidebar', '切换侧栏', 'panel-left', 'Ctrl+\\\\')}<span class="document-name" id="document-name">未命名.md</span><span class="save-state" id="save-state"></span></div>
        <div class="topbar-actions">${tool('save-file', '保存', 'save', 'Ctrl+S')}<span class="divider"></span>${tool('theme', '切换主题', 'moon')}${tool('focus-mode', '专注模式', 'focus', 'Ctrl+Shift+F')}${tool('more', '更多', 'more-horizontal')}</div>
      </header>
      <div class="document-tabs"><div id="tabs" role="tablist" aria-label="打开的文档"></div>${tool('new-tab', '新建文档', 'file-plus-2', 'Ctrl+N')}</div>
      <div class="toolbar">
        <div class="format-tools" id="format-tools">
          ${tool('undo', '撤销', 'undo-2', 'Ctrl+Z')}${tool('redo', '重做', 'redo-2', 'Ctrl+Y')}<span class="divider"></span>
          ${tool('bold', '加粗', 'bold', 'Ctrl+B')}${tool('italic', '斜体', 'italic', 'Ctrl+I')}${tool('link', '链接', 'link-2', 'Ctrl+K')}<span class="divider"></span>
          ${tool('code', '代码块', 'code-2')}${tool('math', '公式', 'sigma')}${tool('table', '表格', 'table-2')}${tool('quote', '引用', 'quote')}${tool('image', '插入图片', 'image-plus')}
        </div>
        <div class="view-switch" role="group" aria-label="编辑视图"><button data-mode="live" class="active" aria-pressed="true">即时</button><button data-mode="source" aria-pressed="false">源码</button><button data-mode="read" aria-pressed="false">阅读</button><button data-mode="split" aria-pressed="false" title="左侧源码，右侧阅读">${icon('columns-2')}<span>分屏</span></button></div>
        <div id="html-tools" class="html-tools" hidden>${tool('run-html', '保存并在内置浏览器运行', 'play')}${tool('chrome-html', '保存并在 Chrome 运行', 'globe')}</div>
        ${tool('search', '查找与替换', 'search', 'Ctrl+F')}
      </div>
      <div class="document-surface" id="surface"><div id="editor"></div><article class="markdown-body reading-view" id="reading-view" hidden></article></div>
    <footer class="statusbar"><span id="word-count">0 字</span><span id="line-count">1 行</span><span class="status-spacer"></span><span id="cursor-position">第 1 行，第 1 列</span><span class="status-separator"></span><span>UTF-8</span><button id="font-size" title="切换字号" aria-label="切换字号">16 px</button><span class="markdown-badge" id="document-format">Markdown</span></footer>
    </main>
    <div id="more-menu" class="popup-menu" hidden>
      <button id="new-html">${icon('file-code-2')}<span>新建 HTML</span></button>
      <button id="save-as">${icon('save')}<span>另存为</span><kbd>Ctrl Shift S</kbd></button>
      <button id="export-html">${icon('download')}<span>导出 HTML</span></button>
      <button id="sample">${icon('file-code-2')}<span>示例文档</span></button>
      <button id="manage-plugins">${icon('puzzle')}<span>插件</span></button>
      <button id="custom-background">${icon('image')}<span>主题背景</span></button>
      <button id="check-updates">${icon('download')}<span>检测更新</span></button>
    </div>
    <div id="save-menu" class="popup-menu save-menu" role="menu" aria-label="保存格式" hidden>
      <button id="save-markdown" role="menuitem">${icon('file-code-2')}<span id="save-format-label">保存 Markdown (.md)</span><kbd>Ctrl S</kbd></button>
      <button id="save-pdf" role="menuitem">${icon('download')}<span>保存为 PDF (.pdf)</span></button>
      <button id="save-markdown-as" role="menuitem">${icon('save')}<span>另存为…</span><kbd>Ctrl Shift S</kbd></button>
      <button id="save-cloud" role="menuitem">${icon('cloud')}<span>保存至云文档…</span></button>
    </div>
    <div class="toast" id="toast" role="status" hidden></div>`;
  createIcons({ icons, attrs: { 'stroke-width': 1.65 } });
  return app;
}
