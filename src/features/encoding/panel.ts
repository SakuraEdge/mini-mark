import { createIcons, ArrowRightLeft, BookOpen, X } from 'lucide';
import { send, type HostMessage } from '../../platform/bridge';
import { encodingNames, type Encoding, type EncodingMetadata } from './model';
import './panel.css';

interface Snapshot extends EncodingMetadata { documentId: string; revision: number; text: string; dirty: boolean; cloud: boolean }
export function initializeEncoding(snapshot: () => Snapshot, prepare: () => void, notice: (message: string) => void) {
  const trigger = document.querySelector<HTMLButtonElement>('#file-encoding')!;
  const dialog = document.createElement('dialog'); dialog.id = 'encoding-panel'; dialog.setAttribute('aria-labelledby', 'encoding-heading');
  const labels = { ...encodingNames, gbk: 'GBK（简体中文 ANSI · CP936）', gb18030: 'GB18030（中文）', 'windows-1252': 'Windows-1252（西欧 ANSI）' };
  dialog.innerHTML = `<header><h2 id="encoding-heading">文件编码</h2><button type="button" data-close aria-label="关闭文件编码"><i data-lucide="x"></i></button></header>
    <div class="encoding-modes" role="group" aria-label="编码操作"><button type="button" data-read><i data-lucide="book-open"></i>切换为…</button><button type="button" data-convert><i data-lucide="arrow-right-left"></i>转换为…</button></div>
    <label for="encoding-target">查看编码</label><select id="encoding-target">${Object.entries(labels).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select>
    <div class="encoding-caption"><span></span><small></small></div><pre class="encoding-preview"></pre><p role="status"></p>
    <footer><button type="button" data-cancel>取消</button><button type="button" data-apply></button></footer>`;
  document.body.append(dialog); createIcons({ icons: { ArrowRightLeft, BookOpen, X }, root: dialog });
  const el = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const target = el<HTMLSelectElement>('select'), apply = el<HTMLButtonElement>('[data-apply]');
  const read = el<HTMLButtonElement>('[data-read]'), convert = el<HTMLButtonElement>('[data-convert]');
  const hint = el('p'), preview = el('pre');
  let mode: 'read' | 'convert' = 'read', openedId = '', applying = false;
  let pending: { id: string; revision: number; resolve: (text: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined;
  let generation = 0;
  function invalidate() {
    generation++;
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error('预览已过期。')); pending = undefined; }
  }
  function request(action: string): Promise<string> {
    const doc = snapshot(), requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (pending?.id === requestId) { pending = undefined; reject(new Error('读取超时，请重试。')); } }, 15000);
      pending = { id: requestId, revision: doc.revision, resolve, reject, timer };
      send('encodingRequest', { documentId: doc.documentId, revision: doc.revision, text: doc.text, requestId, action, encoding: target.value });
    });
  }
  function setBusy(value: boolean) {
    applying = value; target.disabled = read.disabled = convert.disabled = value;
    el<HTMLButtonElement>('[data-cancel]').disabled = el<HTMLButtonElement>('[data-close]').disabled = value;
  }
  async function refresh() {
    invalidate(); const ticket = generation;
    const doc = snapshot(), reading = mode === 'read', name = encodingNames[target.value as Encoding];
    read.setAttribute('aria-pressed', String(reading)); convert.setAttribute('aria-pressed', String(!reading));
    el('label').textContent = reading ? '查看编码' : '保存编码'; el('.encoding-caption span').textContent = reading ? '试读预览' : '待保存正文';
    el('.encoding-caption small').textContent = name; preview.textContent = ''; apply.disabled = true;
    apply.textContent = `${reading ? '切换为' : '转换为'} ${name}`;
    if (reading && (!doc.canReinterpret || doc.dirty)) { hint.textContent = doc.canReinterpret ? '请先保存当前修改，再切换查看编码。' : '打开本地文件后可试读原始字节。'; return; }
    if (!reading && doc.needsEncoding) { hint.textContent = '请先在「切换为…」中选择能正确读取正文的编码。'; return; }
    hint.textContent = '正在校验完整文档…';
    try {
      const result = await request(reading ? 'previewRead' : 'previewConvert');
      if (generation !== ticket || !dialog.open) return;
      preview.textContent = result; hint.textContent = reading ? '按原始文件字节试读。切换后可继续编辑。' : '保存时写入目标编码，原有换行格式将保留。';
      apply.disabled = !reading && target.value === (doc.pendingEncoding ?? doc.encoding ?? 'utf-8');
    } catch (error) { if (generation === ticket) hint.textContent = (error as Error).message; }
  }
  function open() {
    const doc = snapshot(); if (doc.cloud || !doc.documentId || dialog.open) return;
    prepare(); openedId = doc.documentId; mode = doc.canReinterpret && !doc.pendingEncoding ? 'read' : 'convert';
    target.value = doc.pendingEncoding ?? doc.encoding ?? 'utf-8'; setBusy(false); dialog.showModal(); trigger.setAttribute('aria-expanded', 'true'); void refresh(); target.focus();
  }
  trigger.onclick = open;
  read.onclick = () => { mode = 'read'; void refresh(); }; convert.onclick = () => { mode = 'convert'; void refresh(); };
  target.onchange = () => void refresh();
  el('[data-cancel]').onclick = el('[data-close]').onclick = () => dialog.close();
  dialog.oncancel = event => { if (applying) event.preventDefault(); };
  dialog.onclose = () => { invalidate(); setBusy(false); trigger.setAttribute('aria-expanded', 'false'); };
  apply.onclick = async () => {
    if (apply.disabled || applying) return;
    setBusy(true); apply.disabled = true; const ticket = generation;
    try {
      await request(mode === 'read' ? 'switch' : 'convert');
      if (ticket !== generation) return;
      dialog.close(); notice(mode === 'read' ? '已切换查看编码。' : '已设置保存编码。');
    } catch (error) { if (ticket === generation) { hint.textContent = (error as Error).message; } }
    finally { if (ticket === generation) setBusy(false); }
  };
  return {
    update() {
      const doc = snapshot(), current = encodingNames[doc.encoding ?? 'utf-8'];
      trigger.disabled = doc.cloud; trigger.title = doc.cloud ? '云文档使用 UTF-8' : '文件编码';
      trigger.textContent = doc.needsEncoding ? '选择编码…' : doc.pendingEncoding ? `${current} → ${encodingNames[doc.pendingEncoding]}` : current;
      if (dialog.open && (doc.documentId !== openedId || doc.cloud)) dialog.close();
    },
    open,
    handle(message: Extract<HostMessage, { type: 'encodingResponse' }>) {
      if (!pending || pending.id !== message.requestId || message.documentId !== openedId) return;
      const waiting = pending; clearTimeout(waiting.timer); pending = undefined;
      const doc = snapshot();
      if (doc.documentId !== openedId || doc.revision !== waiting.revision) waiting.reject(new Error('文档已变化，请重新打开编码面板。'));
      else if (message.error) waiting.reject(new Error(message.error)); else waiting.resolve(message.preview ?? '');
    },
  };
}
