import type { EditorView } from '@codemirror/view';
import { send, type HostMessage } from '../../platform/bridge';

interface Snapshot { documentId: string; revision: number; editable: boolean }
interface Options { view: EditorView; snapshot(): Snapshot; notice(message: string): void }
interface ImageInput { name: string; dataUrl: string }
interface Pending { resolve(value: string[]): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
const pending = new Map<string, Pending>();

export function handleImageMessage(message: HostMessage) {
  if (message.type !== 'imagesImported') return false;
  const request = pending.get(message.requestId);
  if (!request) return true;
  pending.delete(message.requestId); clearTimeout(request.timer);
  if (message.error) request.reject(new Error(message.error));
  else request.resolve(message.sources ?? []);
  return true;
}
function importImages(documentId: string, images: ImageInput[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('图片导入超时，请重试。')); }, 20000);
    pending.set(requestId, { resolve, reject, timer });
    send('importImages', { requestId, documentId, images });
  });
}
function readImage(file: File): Promise<ImageInput> {
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) return Promise.reject(new Error('请选择 PNG、JPEG、GIF 或 WebP 图片。'));
  if (file.size > 10 * 1024 * 1024 || !file.size) return Promise.reject(new Error('单张图片需在 10 MB 以内。'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取图片。'));
    reader.onload = () => resolve({ name: file.name, dataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  });
}
export function imageMarkdown(alt: string, src: string) {
  const label = alt.replace(/[\r\n]/g, ' ').replace(/[\\[\]]/g, '\\$&');
  const target = src.replace(/ /g, '%20').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/\r|\n/g, '');
  return `![${label}](<${target}>)`;
}
export function initializeImages(options: Options) {
  const { view, snapshot, notice } = options;
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/png,image/jpeg,image/gif,image/webp'; input.multiple = true;
  const dialog = document.createElement('dialog');
  dialog.className = 'feature-dialog image-dialog'; dialog.id = 'image-dialog';
  dialog.setAttribute('aria-labelledby', 'image-title');
  dialog.innerHTML = `<header><h2 id="image-title">插入图片</h2><button class="icon-button" id="image-close" aria-label="关闭图片窗口" title="关闭">×</button></header>
    <button id="image-file">选择本地图片</button>
    <label for="image-url">图片地址</label><input id="image-url" type="text" placeholder="https:// 或相对路径" autocomplete="off">
    <label for="image-alt">图片描述</label><input id="image-alt" type="text" autocomplete="off">
    <p id="image-status" role="status"></p><footer><button class="primary" id="image-insert">插入</button></footer>`;
  document.body.append(dialog);
  const url = dialog.querySelector<HTMLInputElement>('#image-url')!;
  const alt = dialog.querySelector<HTMLInputElement>('#image-alt')!;
  const status = dialog.querySelector<HTMLElement>('#image-status')!;
  let target: (Snapshot & { from: number; to: number }) | undefined;
  let importing = false;
  function capture(position?: number) {
    const selection = view.state.selection.main;
    return { ...snapshot(), from: position ?? selection.from, to: position ?? selection.to };
  }
  function insert(context: NonNullable<typeof target>, markdown: string) {
    const current = snapshot();
    if (!current.editable || current.documentId !== context.documentId || current.revision !== context.revision || view.composing) throw new Error('文档已切换或修改，请重新插入图片。');
    const before = context.from && view.state.sliceDoc(context.from - 1, context.from) !== '\n' ? '\n' : '';
    const after = view.state.sliceDoc(context.to, context.to + 1) === '\n' ? '' : '\n';
    const text = before + markdown + after;
    const updated = view.state.sliceDoc(0, context.from) + text + view.state.sliceDoc(context.to);
    if (new TextEncoder().encode(updated).length > 20 * 1024 * 1024) throw new Error('内嵌图片会使文档超过 20 MB，请先保存文档再导入图片。');
    view.dispatch({ changes: { from: context.from, to: context.to, insert: text }, selection: { anchor: context.from + text.length }, userEvent: 'input' });
    view.focus();
  }
  async function files(files: File[], context = capture()) {
    if (!context.editable || importing || !files.length) return;
    if (files.length > 10) { notice('一次最多插入 10 张图片。'); return; }
    importing = true;
    try {
      const images = await Promise.all(files.map(readImage));
      const current = snapshot();
      if (current.documentId !== context.documentId || current.revision !== context.revision) throw new Error('文档已修改，请重新插入图片。');
      const sources = await importImages(context.documentId, images);
      if (sources.length !== images.length) throw new Error('图片导入结果不完整。');
      insert(context, sources.map((src, index) => imageMarkdown(images[index].name.replace(/\.[^.]+$/, ''), src)).join('\n'));
      dialog.close();
    } catch (error) { notice(error instanceof Error ? error.message : '图片导入失败。'); }
    finally { importing = false; }
  }
  input.onchange = () => { const selected = [...input.files ?? []]; input.value = ''; void files(selected, target ?? capture()); };
  dialog.querySelector('#image-close')!.addEventListener('click', () => dialog.close());
  dialog.querySelector('#image-file')!.addEventListener('click', () => input.click());
  dialog.querySelector('#image-insert')!.addEventListener('click', () => {
    try {
      const source = url.value.trim();
      if (!source || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(source) && !/^https:\/\//i.test(source)) throw new Error('请输入 HTTPS 图片地址或文档旁的相对路径。');
      if (source.includes('\\') || /[\r\n]/.test(source)) throw new Error('相对路径请使用正斜杠。');
      insert(target ?? capture(), imageMarkdown(alt.value, source)); dialog.close();
    } catch (error) { status.textContent = error instanceof Error ? error.message : '无法插入图片。'; }
  });
  view.contentDOM.addEventListener('paste', event => {
    const selected = [...event.clipboardData?.files ?? []].filter(file => file.type.startsWith('image/'));
    if (!selected.length || !snapshot().editable || view.composing) return;
    event.preventDefault(); event.stopImmediatePropagation(); void files(selected);
  }, true);
  view.contentDOM.addEventListener('dragover', event => {
    if (snapshot().editable && [...event.dataTransfer?.items ?? []].some(item => item.kind === 'file' && item.type.startsWith('image/'))) event.preventDefault();
  });
  view.contentDOM.addEventListener('drop', event => {
    const selected = [...event.dataTransfer?.files ?? []].filter(file => file.type.startsWith('image/'));
    if (!selected.length || !snapshot().editable || view.composing) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const position = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? undefined;
    void files(selected, capture(position));
  }, true);
  return {
    open() {
      target = capture();
      if (!target.editable) return;
      url.value = ''; alt.value = ''; status.textContent = '';
      if (!dialog.open) dialog.showModal();
    },
  };
}
