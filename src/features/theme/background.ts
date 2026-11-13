import { ImagePlus, Trash2, X, createIcons } from 'lucide';
import { prepareBackground } from './background-image';
import { readBackground, writeBackground, type BackgroundRecord } from './background-storage';
import '../../styles/background.css';

export function initializeBackground(options: { notice(message: string): void }) {
  const layer = document.createElement('img');
  layer.id = 'theme-background'; layer.alt = ''; layer.setAttribute('aria-hidden', 'true'); layer.hidden = true;
  document.querySelector('#app')!.prepend(layer);
  const dialog = document.createElement('dialog');
  dialog.id = 'background-dialog'; dialog.className = 'feature-dialog background-dialog'; dialog.setAttribute('aria-labelledby', 'background-title');
  dialog.innerHTML = `<header><h2 id="background-title">主题背景</h2><button type="button" class="icon-button" data-action="close" aria-label="关闭背景设置" title="关闭"><i data-lucide="x"></i></button></header>
    <div class="background-preview"><img alt="背景预览" hidden><span>未设置背景</span></div>
    <div class="background-file"><span id="background-name">无图片</span><button type="button" data-action="choose"><i data-lucide="image-plus"></i>选择图片</button></div>
    <label class="background-enabled"><span>启用背景</span><input id="background-enabled" type="checkbox"></label>
    <div class="background-range-heading"><label for="background-transparency">透明度</label><output id="background-value" for="background-transparency">82%</output></div>
    <input id="background-transparency" type="range" min="0" max="100" step="1" value="82">
    <p id="background-status" role="status" aria-live="polite"></p>
    <footer><button type="button" data-action="remove"><i data-lucide="trash-2"></i>移除背景</button><button type="button" class="primary" data-action="done">完成</button></footer>`;
  document.body.append(dialog);
  createIcons({ icons: { ImagePlus, Trash2, X }, root: dialog, attrs: { 'stroke-width': 1.65 } });
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.id = 'background-file-input'; input.hidden = true;
  dialog.append(input);
  const button = (action: string) => dialog.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
  const preview = dialog.querySelector<HTMLImageElement>('.background-preview img')!;
  const empty = dialog.querySelector<HTMLElement>('.background-preview span')!;
  const enabled = dialog.querySelector<HTMLInputElement>('#background-enabled')!;
  const slider = dialog.querySelector<HTMLInputElement>('#background-transparency')!;
  const status = dialog.querySelector<HTMLElement>('#background-status')!;
  let current: BackgroundRecord | null = null, objectUrl = '', busy = false, generation = 0, ready = false;
  let writeQueue = Promise.resolve(), pendingTimer: ReturnType<typeof setTimeout> | undefined;

  function failure(error: unknown) {
    const message = error instanceof Error ? error.message : '背景设置失败。';
    status.textContent = message;
    if (!dialog.open) options.notice(message);
  }
  function apply() {
    const visible = Boolean(current?.enabled && objectUrl);
    layer.hidden = !visible;
    document.documentElement.classList.toggle('has-theme-background', visible);
    const opacity = (100 - (current?.transparency ?? 82)) / 100;
    layer.style.opacity = String(opacity); preview.style.opacity = String(opacity);
    enabled.checked = current?.enabled ?? false;
    slider.value = String(current?.transparency ?? 82);
    dialog.querySelector('#background-value')!.textContent = `${slider.value}%`;
    dialog.querySelector('#background-name')!.textContent = current?.name ?? '无图片';
    preview.hidden = !objectUrl; empty.hidden = Boolean(objectUrl);
    button('choose').disabled = busy || !ready;
    button('remove').disabled = busy || !ready || !current;
    enabled.disabled = slider.disabled = busy || !ready || !current;
    dialog.setAttribute('aria-busy', String(busy));
  }
  function persist(record: BackgroundRecord | null, metadataOnly = false) {
    const write = writeQueue.then(() => writeBackground(record, metadataOnly));
    writeQueue = write.catch(() => {});
    return write;
  }
  function flush() {
    clearTimeout(pendingTimer); pendingTimer = undefined;
    const stamp = generation, record = current;
    void persist(record, true).then(() => { if (stamp === generation) status.textContent = '已保存'; }, error => { if (stamp === generation) failure(error); });
  }
  function change() {
    if (!current || busy) return;
    generation++;
    current = { ...current, enabled: enabled.checked, transparency: Number(slider.value) };
    apply(); status.textContent = '';
    clearTimeout(pendingTimer); pendingTimer = setTimeout(flush, 180);
  }
  async function decode(blob: Blob) {
    const url = URL.createObjectURL(blob), image = new Image();
    try { image.src = url; await image.decode(); return url; }
    catch { URL.revokeObjectURL(url); throw new Error('背景图片无法读取，请重新选择。'); }
  }
  function install(record: BackgroundRecord | null, url: string) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    current = record; objectUrl = url;
    if (url) { layer.src = url; preview.src = url; }
    else { layer.removeAttribute('src'); preview.removeAttribute('src'); }
    apply();
  }
  async function load() {
    const stamp = generation;
    try {
      const record = await readBackground();
      const url = record ? await decode(record.image) : '';
      if (stamp === generation) install(record, url);
      else if (url) URL.revokeObjectURL(url);
    } catch (error) { status.textContent = error instanceof Error ? error.message : '背景设置无法读取。'; }
    finally { ready = true; apply(); }
  }
  async function choose(file: File) {
    if (busy || !ready) return;
    clearTimeout(pendingTimer); pendingTimer = undefined;
    const stamp = ++generation;
    busy = true; apply(); status.textContent = '正在处理图片…';
    let url = '';
    try {
      const blob = await prepareBackground(file);
      url = await decode(blob);
      const record: BackgroundRecord = { schema: 1, image: blob, name: file.name.slice(0, 240), enabled: true, transparency: current?.transparency ?? 82 };
      await persist(record);
      if (stamp !== generation) { URL.revokeObjectURL(url); return; }
      install(record, url); url = ''; status.textContent = '已保存';
    } catch (error) { failure(error); }
    finally { if (url) URL.revokeObjectURL(url); busy = false; apply(); }
  }
  button('choose').onclick = () => input.click();
  input.onchange = () => { const file = input.files?.[0]; input.value = ''; if (file) void choose(file); };
  enabled.onchange = change; slider.oninput = change;
  slider.onchange = () => { if (pendingTimer) flush(); };
  button('remove').onclick = async () => {
    if (!current || busy) return;
    generation++; clearTimeout(pendingTimer); pendingTimer = undefined;
    busy = true; apply();
    try { await persist(null); install(null, ''); status.textContent = '已移除背景'; }
    catch (error) { failure(error); }
    finally { busy = false; apply(); }
  };
  for (const action of ['close', 'done']) button(action).onclick = () => dialog.close();
  dialog.addEventListener('close', () => { if (pendingTimer) flush(); });
  void load();
  return { open() { apply(); if (!dialog.open) dialog.showModal(); } };
}
