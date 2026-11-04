import { sample } from '../documents/sample';
import { BrowserWorkspace, type DocumentData, type TabData } from '../documents/workspace';
export type { DocumentData, TabData } from '../documents/workspace';

export type HostMessage =
  | { type: 'workspace'; tabs: TabData[]; document: DocumentData; recovered?: boolean }
  | { type: 'saved'; documentId: string; name: string; path?: string; text: string }
  | { type: 'requestClosingText'; requestId: string }
  | { type: 'requestExportPdf'; requestId: string; documentId: string; text: string; name: string }
  | { type: 'operationComplete' }
  | { type: 'updateResult'; requestId: string; releases?: unknown; error?: string; cacheNotice?: string; installSupported?: boolean }
  | { type: 'updateInstallStatus'; message: string; downloading: boolean }
  | { type: 'error' | 'notice'; message: string };

const native = window.chrome?.webview;
export const isDesktop = Boolean(native);
let onMessage: (message: HostMessage) => void = () => {};
let workspace = new BrowserWorkspace();
let fileInput: HTMLInputElement | undefined;
const SESSION_KEY = 'moye.session.v2';

function persist() {
  try { localStorage.setItem(SESSION_KEY, workspace.serialize()); }
  catch { onMessage({ type: 'error', message: '浏览器草稿空间已满，请保存到文件。' }); }
}
function publish(recovered = false) {
  persist();
  onMessage({ type: 'workspace', tabs: workspace.tabs, document: { ...workspace.active }, recovered });
}
function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function connect(callback: typeof onMessage) {
  onMessage = callback;
  if (native) {
    native.addEventListener('message', event => callback(event.data));
    native.postMessage({ type: 'ready' });
    return;
  }
  const restored = BrowserWorkspace.restore(localStorage.getItem(SESSION_KEY));
  if (restored) workspace = restored;
  else {
    try {
      const legacy = JSON.parse(localStorage.getItem('moye.draft.v1') ?? 'null');
      if (legacy && typeof legacy.text === 'string') workspace.add(legacy.text, legacy.name, legacy.baseline ?? '');
    } catch { /* Preserve an unreadable legacy entry for manual recovery. */ }
    if (!workspace.documents.length) workspace.add(sample, '随手记.md', sample);
  }
  publish(workspace.documents.some(document => document.text !== document.baseline));
}

export function send(type: string, payload: Record<string, unknown> = {}) {
  if (native) { native.postMessage({ type, ...payload }); return; }
  const id = typeof payload.documentId === 'string' ? payload.documentId : workspace.activeId;
  if (typeof payload.text === 'string' && typeof payload.revision === 'number') workspace.update(id, payload.text, payload.revision);
  const doc = workspace.documents.find(item => item.id === id);
  if (type === 'edit') { persist(); return; }
  if (type === 'new') { workspace.add(String(payload.initialText ?? ''), typeof payload.name === 'string' ? payload.name : undefined); publish(); }
  if (type === 'activate') { workspace.activate(String(payload.targetId)); publish(); }
  if (type === 'closeTab') {
    const target = workspace.documents.find(item => item.id === payload.targetId);
    if (!target || target.text === target.baseline || confirm(`“${target.name}”尚未保存。确定关闭并丢弃修改吗？`)) {
      workspace.remove(String(payload.targetId)); publish();
    }
    onMessage({ type: 'operationComplete' });
  }
  if (type === 'open') {
    fileInput ??= Object.assign(document.createElement('input'), { type: 'file', accept: '.md,.markdown,.txt,text/plain,text/markdown', multiple: true });
    fileInput.onchange = async () => {
      try {
        for (const file of Array.from(fileInput?.files ?? [])) {
          const text = (await file.text()).replace(/\r\n/g, '\n');
          workspace.add(text, file.name, text);
        }
        publish();
      } finally { if (fileInput) fileInput.value = ''; onMessage({ type: 'operationComplete' }); }
    };
    fileInput.oncancel = () => onMessage({ type: 'operationComplete' });
    fileInput.click();
  }
  if ((type === 'save' || type === 'saveAs') && doc) {
    const name = type === 'saveAs' ? prompt('Markdown 文件名', doc.name) : doc.name;
    if (name) {
      download(name.toLowerCase().endsWith('.md') ? name : `${name}.md`, doc.text, 'text/markdown;charset=utf-8');
      onMessage({ type: 'notice', message: '已发起 Markdown 下载；草稿仍保留。' });
    }
  }
  if (type === 'exportHtml') {
    download(String(payload.name ?? doc?.name ?? '未命名').replace(/\.[^.]+$/, '') + '.html', String(payload.html), 'text/html;charset=utf-8');
    onMessage({ type: 'operationComplete' });
  }
  if (type === 'exportPdf' && doc) onMessage({ type: 'requestExportPdf', requestId: crypto.randomUUID(), documentId: doc.id, text: doc.text, name: doc.name });
  if (type === 'pdfHtml') {
    const iframe = document.createElement('iframe');
    iframe.className = 'print-frame'; iframe.title = 'PDF 打印文档';
    iframe.srcdoc = String(payload.html);
    iframe.onload = async () => {
      try {
        const child = iframe.contentWindow!;
        await child.document.fonts.ready;
        await Promise.all(Array.from(child.document.images, image => image.decode().catch(() => {})));
        child.addEventListener('afterprint', () => iframe.remove(), { once: true });
        child.focus(); child.print();
      } catch { iframe.remove(); onMessage({ type: 'error', message: '无法打开打印窗口，请使用桌面版保存 PDF。' }); }
    };
    document.body.append(iframe);
  }
  if (type === 'pdfError') onMessage({ type: 'error', message: String(payload.message ?? 'PDF 导出失败') });
  if (['save', 'saveAs', 'exportPdf'].includes(type)) onMessage({ type: 'operationComplete' });
  if (type === 'openExternal' && typeof payload.url === 'string' && /^https?:\/\//i.test(payload.url)) window.open(payload.url, '_blank', 'noopener,noreferrer');
}

window.addEventListener('beforeunload', event => {
  if (!native && workspace.documents.some(document => document.text !== document.baseline)) { event.preventDefault(); event.returnValue = ''; }
});
