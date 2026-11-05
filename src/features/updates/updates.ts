import { send, isDesktop, type HostMessage } from '../../platform/bridge';

export const APP_VERSION = __APP_VERSION__;
const SETTINGS_KEY = 'moye.updates.v1';
const DAY = 86_400_000;
export interface Release { tag_name: string; name?: string; draft?: boolean; prerelease?: boolean }
interface Version { core: number[]; pre: string[] }
export function parseVersion(value: string): Version | null {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) return null;
  const core = match.slice(1, 4).map(Number), pre = match[4]?.split('.') ?? [];
  if (core.some(n => !Number.isSafeInteger(n)) || pre.some(p => !p || (/^\d+$/.test(p) && p.length > 1 && p[0] === '0'))) return null;
  return { core, pre };
}
export function compareVersions(left: string, right: string) {
  const a = parseVersion(left), b = parseVersion(right);
  if (!a || !b) throw new Error('Invalid semantic version');
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return Math.sign(a.core[i] - b.core[i]);
  if (!a.pre.length || !b.pre.length) return Math.sign(Number(!a.pre.length) - Number(!b.pre.length));
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return x.length === y.length ? (x < y ? -1 : 1) : Math.sign(x.length - y.length);
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
export function latestRelease(data: unknown, current: string): Release | null {
  if (!Array.isArray(data)) throw new Error('GitHub 返回的版本列表无效。');
  return data.filter((r): r is Release => r && typeof r.tag_name === 'string' && parseVersion(r.tag_name) !== null && !r.draft && !r.prerelease && !parseVersion(r.tag_name)!.pre.length && compareVersions(r.tag_name, current) > 0)
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0] ?? null;
}
export function isMajorUpdate(current: string, candidate: string) {
  return parseVersion(candidate)!.core[0] > parseVersion(current)!.core[0];
}
interface Settings { auto: boolean; notifyMajor: boolean; lastAttempt: number; promptedMajor: number }
function readSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return { auto: raw.auto !== false, notifyMajor: raw.notifyMajor !== false, lastAttempt: Number(raw.lastAttempt) || 0, promptedMajor: Number(raw.promptedMajor) || 0 };
  } catch { return { auto: true, notifyMajor: true, lastAttempt: 0, promptedMajor: 0 }; }
}
export function shouldPrompt(settings: Pick<Settings, 'notifyMajor' | 'promptedMajor'>, current: string, candidate: string) {
  return settings.notifyMajor && isMajorUpdate(current, candidate) && parseVersion(candidate)!.core[0] > settings.promptedMajor;
}

let dialog: HTMLDialogElement;
let settings = readSettings();
let pending: { id: string; manual: boolean; timer: ReturnType<typeof setTimeout> } | undefined;
let candidate: Release | null = null;
let installSupported = false;
let installing = false;
function element<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  catch { element('update-status').textContent = '无法保存提醒偏好，请检查本地存储空间。'; }
}
function openDialog() {
  if (!dialog.open) dialog.showModal();
}
function setResult(text: string) {
  element('update-status').textContent = text;
  element<HTMLButtonElement>('update-check').disabled = Boolean(pending) || installing;
  element<HTMLButtonElement>('update-release').hidden = !candidate;
  element<HTMLButtonElement>('update-install').hidden = !candidate || !installSupported;
  element<HTMLButtonElement>('update-install').disabled = installing;
  element<HTMLButtonElement>('update-cancel').hidden = !installing;
}
export function initializeUpdates() {
  const container = document.createElement('div');
  container.innerHTML = `<dialog id="update-dialog" class="update-dialog" aria-labelledby="update-title">
    <header><h2 id="update-title">软件更新</h2><button id="update-close" class="icon-button" aria-label="关闭更新窗口" title="关闭">×</button></header>
    <p class="update-version">当前版本 ${APP_VERSION}</p>
    <p id="update-status" role="status">从 GitHub 检查正式版本。</p>
    <div class="update-options">
      <label><input id="update-auto" type="checkbox">自动检测更新</label>
      <label><input id="update-suppress" type="checkbox">不再弹出大版本更新提醒</label>
    </div>
    <footer><button id="update-cancel" hidden>取消下载</button><button id="update-check">检测更新</button><button id="update-release" hidden>查看新版 / 下载</button><button id="update-install" class="primary" hidden>下载并覆盖更新</button></footer>
  </dialog>`;
  document.body.append(container);
  dialog = element('update-dialog');
  element<HTMLInputElement>('update-auto').checked = settings.auto;
  element<HTMLInputElement>('update-suppress').checked = !settings.notifyMajor;
  element('update-close').onclick = () => dialog.close();
  element('update-auto').onchange = () => { settings.auto = element<HTMLInputElement>('update-auto').checked; saveSettings(); };
  element('update-suppress').onchange = () => { settings.notifyMajor = !element<HTMLInputElement>('update-suppress').checked; saveSettings(); };
  element('update-check').onclick = () => checkUpdates(true);
  element('update-cancel').onclick = () => send('cancelUpdate');
  element('update-install').onclick = () => {
    if (!candidate || installing) return;
    installing = true; setResult('正在准备更新安装包…');
    send('installUpdate', { version: candidate.tag_name });
  };
  element('update-release').onclick = () => { if (candidate) send('openExternal', { url: `https://github.com/SakuraEdge/mini-mark/releases/tag/${encodeURIComponent(candidate.tag_name)}` }); };
}
export function openUpdates() {
  element('update-title').textContent = '软件更新';
  openDialog();
  checkUpdates(true);
}
export function scheduleUpdateCheck() {
  if (!isDesktop || !settings.auto) return;
  const elapsed = Date.now() - settings.lastAttempt;
  if (elapsed >= 0 && elapsed < DAY) return;
  // Start only after the editor is usable; network work never blocks document loading.
  setTimeout(() => { if (settings.auto) checkUpdates(false); }, 5000);
}
function checkUpdates(manual: boolean) {
  if (installing) return;
  if (!isDesktop) { setResult('请在桌面版中检测更新。'); return; }
  if (pending) { pending.manual ||= manual; return; }
  if (!manual) { settings.lastAttempt = Date.now(); saveSettings(); }
  candidate = null;
  const id = crypto.randomUUID();
  pending = { id, manual, timer: setTimeout(() => handleUpdateMessage({ type: 'updateResult', requestId: id, error: '检测超时，请稍后重试。' }), 20000) };
  setResult('正在连接 GitHub…');
  send('checkUpdates', { requestId: id });
}
export function handleUpdateMessage(message: HostMessage): boolean {
  if (message.type === 'updateInstallStatus') {
    installing = message.downloading;
    setResult(message.message);
    return true;
  }
  if (message.type !== 'updateResult') return false;
  if (!pending || pending.id !== message.requestId) return true;
  const manual = pending.manual;
  clearTimeout(pending.timer); pending = undefined;
  if (message.error) { setResult(message.error); return true; }
  try {
    candidate = latestRelease(message.releases, APP_VERSION);
    installSupported = message.installSupported === true;
    const summary = candidate ? `发现${isMajorUpdate(APP_VERSION, candidate.tag_name) ? '大版本' : '新版本'} ${candidate.tag_name}。` : message.cacheNotice ? '缓存中没有高于当前版本的更新。' : `当前已是最新正式版本（${APP_VERSION}）。`;
    setResult(message.cacheNotice ? `${message.cacheNotice}\n${summary}` : summary);
    if (candidate && !manual && !message.cacheNotice && shouldPrompt(settings, APP_VERSION, candidate.tag_name)) {
      // Defer the modal until this window is active, so it cannot steal focus.
      const show = () => {
        if (!candidate || !shouldPrompt(settings, APP_VERSION, candidate.tag_name)) return;
        settings.promptedMajor = parseVersion(candidate.tag_name)!.core[0]; saveSettings();
        element('update-title').textContent = '发现大版本更新';
        openDialog();
      };
      if (document.hasFocus()) show();
      else window.addEventListener('focus', show, { once: true });
    }
  } catch (error) { setResult(error instanceof Error ? error.message : '无法读取更新信息。'); }
  return true;
}
