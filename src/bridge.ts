import { sample } from './sample';

export interface DocumentData {
  text: string;
  name: string;
  path?: string;
  saved?: boolean;
  recovered?: boolean;
  baseline?: string;
}
export type HostMessage =
  | { type: 'document'; document: DocumentData }
  | { type: 'saved'; name: string; path?: string; text: string }
  | { type: 'requestClosingText' }
  | { type: 'error' | 'notice'; message: string };

const native = window.chrome?.webview;
let documentId: string | undefined;
export const isDesktop = Boolean(native);
let onMessage: (message: HostMessage) => void = () => {};
let browserName = '未命名.md';
let browserBaseline = '';
let browserText = '';
let fileInput: HTMLInputElement | undefined;
const DRAFT_KEY = 'moye.draft.v1';

function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function browserDocument(text: string, name: string, saved: boolean) {
  browserText = text; browserName = name; browserBaseline = saved ? text : '';
  onMessage({ type: 'document', document: { text, name, saved, baseline: browserBaseline } });
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ text, name, baseline: browserBaseline }));
}

export function connect(callback: typeof onMessage) {
  onMessage = callback;
  if (native) {
    native.addEventListener('message', (event) => {
      if (event.data.type === 'document') documentId = event.data.documentId;
      else if (event.data.documentId && event.data.documentId !== documentId) return;
      callback(event.data);
    });
    native.postMessage({ type: 'ready' });
  } else {
    let draft: { text: string; name: string; baseline: string } | null = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null'); } catch { /* Ignore a malformed browser draft. */ }
    if (draft && typeof draft.text === 'string') {
      browserText = draft.text; browserName = draft.name; browserBaseline = draft.baseline ?? '';
      callback({ type: 'document', document: { text: draft.text, name: draft.name, baseline: browserBaseline, saved: draft.text === browserBaseline, recovered: draft.text !== browserBaseline } });
    } else browserDocument(sample, '随手记.md', true);
  }
}

export function send(type: string, payload: Record<string, unknown> = {}) {
  if (native) { native.postMessage({ type, documentId, ...payload }); return; }
  const text = typeof payload.text === 'string' ? payload.text : browserText;
  if (type === 'edit') {
    browserText = text;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ text, name: browserName, baseline: browserBaseline })); }
    catch { onMessage({ type: 'error', message: '浏览器草稿空间已满，请保存到文件。' }); }
  }
  if (type === 'new' || type === 'open') {
    if (browserText !== browserBaseline && !window.confirm('当前内容尚未保存，仍要切换文档吗？')) return;
    if (type === 'new') browserDocument('', '未命名.md', false);
    else {
      fileInput ??= Object.assign(document.createElement('input'), { type: 'file', accept: '.md,.markdown,.txt,text/plain,text/markdown' });
      fileInput.onchange = async () => {
        const file = fileInput?.files?.[0];
        if (file) browserDocument((await file.text()).replace(/\r\n/g, '\n'), file.name, true);
        if (fileInput) fileInput.value = '';
      };
      fileInput.click();
    }
  }
  if (type === 'save' || type === 'saveAs') {
    const name = type === 'saveAs' ? window.prompt('文件名', browserName) : browserName;
    if (!name) return;
    browserName = name.endsWith('.md') ? name : `${name}.md`;
    download(browserName, text, 'text/markdown;charset=utf-8');
    // Browsers cannot verify that a download was accepted or persisted.
    onMessage({ type: 'notice', message: '已发起 Markdown 下载；草稿仍保留。' });
  }
  if (type === 'exportHtml') download(browserName.replace(/\.[^.]+$/, '') + '.html', String(payload.html), 'text/html;charset=utf-8');
  if (type === 'openExternal' && typeof payload.url === 'string' && /^https?:\/\//i.test(payload.url)) window.open(payload.url, '_blank', 'noopener,noreferrer');
}

window.addEventListener('beforeunload', (event) => {
  if (!native && browserText !== browserBaseline) { event.preventDefault(); event.returnValue = ''; }
});
