import { ArrowUp, Cloud, ExternalLink, FileText, Folder, FolderPlus, LogIn, LogOut, RefreshCw, Save, X, createIcons } from 'lucide';
import { isDesktop, send } from '../../platform/bridge';
import { cloudRequest, handleCloudResponse } from './client';
import { cloudFileName, cloudFolderName, joinCloudPath, parentCloudPath, readCloudEntries, type CloudAccount, type CloudBinding, type CloudEntry, type CloudRepository, type DeviceAuthorization, type LoginPoll } from './model';
import '../../styles/cloud.css';

interface Options {
  snapshot(): { id: string; name: string; cloud?: CloudBinding | null };
  notice(message: string): void;
  openDocument(owner: string, path: string): void | Promise<void>;
  bindDocument(owner: string, path: string): void | Promise<void>;
  detachDocument(): void | Promise<void>;
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('操作已取消。', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

export function initializeCloud(options: Options) {
  let account: CloudAccount = { authenticated: false, configured: false };
  let repository: CloudRepository | undefined;
  let folder = '', intent: 'browse' | 'save' = 'browse', busy = false, authenticating = false;
  let entries: CloudEntry[] = [];
  let controller = new AbortController();
  let generation = 0;
  let currentDocumentId = '';
  let authorizationUrl = '';
  const dialog = document.createElement('dialog');
  dialog.id = 'cloud-dialog'; dialog.className = 'feature-dialog cloud-dialog';
  dialog.setAttribute('aria-labelledby', 'cloud-title');
  dialog.innerHTML = `
    <header><h2 id="cloud-title">云文档</h2><button class="icon-button" data-action="close" aria-label="关闭云文档窗口" title="关闭"><i data-lucide="x"></i></button></header>
    <div class="cloud-account">
      <i data-lucide="cloud"></i><div class="cloud-account-name"><strong id="cloud-account-name">GitHub</strong><span id="cloud-repository-name">未登录</span></div>
      <button data-action="login"><i data-lucide="log-in"></i>登录 GitHub</button>
      <button data-action="logout" hidden><i data-lucide="log-out"></i>退出登录</button>
    </div>
    <section class="cloud-authorization" aria-label="GitHub 授权" hidden>
      <span>GitHub 授权码</span><output id="cloud-user-code"></output>
      <div><button data-action="authorize"><i data-lucide="external-link"></i>前往 GitHub 授权</button><button data-action="cancel-login">取消登录</button></div>
    </section>
    <div class="cloud-document-mode">
      <span id="cloud-current-document"></span>
      <label><input id="cloud-enabled" type="checkbox">云文档</label>
    </div>
    <section id="cloud-repository-missing" hidden><span>MiniMarkDisk 尚未创建</span><button data-action="create-repository">创建私有仓库</button></section>
    <section class="cloud-browser" hidden>
      <div class="cloud-browser-toolbar">
        <button class="icon-button" data-action="up" aria-label="上一级目录" title="上一级目录"><i data-lucide="arrow-up"></i></button>
        <nav id="cloud-breadcrumb" aria-label="云文档目录"></nav>
        <button class="icon-button" data-action="new-folder" aria-label="新建云文件夹" title="新建文件夹"><i data-lucide="folder-plus"></i></button>
        <button class="icon-button" data-action="refresh" aria-label="刷新云目录" title="刷新目录"><i data-lucide="refresh-cw"></i></button>
      </div>
      <form id="cloud-folder-form" hidden><label for="cloud-folder-name">文件夹名称</label><input id="cloud-folder-name" autocomplete="off" maxlength="200"><button type="submit">创建</button><button type="button" data-action="cancel-folder">取消</button></form>
      <div id="cloud-entries" class="cloud-entries" aria-label="云端文件"></div>
    </section>
    <form id="cloud-save-form" hidden>
      <label class="cloud-save-choice"><input id="cloud-save-enabled" type="checkbox" checked>保存至云文档</label>
      <div class="cloud-save-target"><label for="cloud-file-name">文件名</label><input id="cloud-file-name" autocomplete="off" spellcheck="false" maxlength="240"><button type="submit" class="primary"><i data-lucide="save"></i>保存到此目录</button></div>
    </form>
    <div id="cloud-status" role="status" aria-live="polite"></div>
    <footer><span id="cloud-document-path"></span><button data-action="save-current"><i data-lucide="save"></i>保存当前文档到云端</button></footer>`;
  document.body.append(dialog);
  const icons = { ArrowUp, Cloud, ExternalLink, FileText, Folder, FolderPlus, LogIn, LogOut, RefreshCw, Save, X };
  createIcons({ icons, root: dialog, attrs: { 'stroke-width': 1.65 } });
  const get = <T extends HTMLElement>(id: string) => dialog.querySelector<T>(`#${id}`)!;
  const action = (name: string) => dialog.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!;
  const authorization = dialog.querySelector<HTMLElement>('.cloud-authorization')!;
  const browser = dialog.querySelector<HTMLElement>('.cloud-browser')!;
  const status = get('cloud-status');
  const fileName = get<HTMLInputElement>('cloud-file-name');
  const folderName = get<HTMLInputElement>('cloud-folder-name');
  const folderForm = get<HTMLFormElement>('cloud-folder-form');
  const saveForm = get<HTMLFormElement>('cloud-save-form');
  const enabled = get<HTMLInputElement>('cloud-enabled');
  const saveEnabled = get<HTMLInputElement>('cloud-save-enabled');

  function setStatus(text: string, error = false) {
    status.textContent = text; status.classList.toggle('error', error);
  }
  function showError(error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    setStatus(error instanceof Error ? error.message : '云文档操作失败。', true);
  }
  function redraw() {
    const snapshot = options.snapshot();
    get('cloud-account-name').textContent = account.login ?? 'GitHub';
    get('cloud-repository-name').textContent = account.authenticated ? `MiniMarkDisk${repository?.exists ? repository.private ? ' · 私有' : ' · 公开' : ''}` : '未登录';
    action('login').hidden = account.authenticated || authenticating;
    action('logout').hidden = !account.authenticated;
    authorization.hidden = !authenticating;
    browser.hidden = !repository?.exists || !account.authenticated;
    get('cloud-repository-missing').hidden = !account.authenticated || repository?.exists !== false;
    get('cloud-current-document').textContent = snapshot.name;
    get('cloud-document-path').textContent = snapshot.cloud ? `${snapshot.cloud.owner}/MiniMarkDisk/${snapshot.cloud.path}` : '本地文档';
    enabled.checked = Boolean(snapshot.cloud);
    enabled.disabled = busy || !snapshot.id;
    saveForm.hidden = intent !== 'save';
    action('save-current').hidden = intent === 'save';
    action('save-current').disabled = busy || !snapshot.id;
    action('up').disabled = busy || !folder;
    action('refresh').disabled = busy;
    action('new-folder').disabled = busy;
    action('login').disabled = busy || !isDesktop;
    action('logout').disabled = busy;
    action('authorize').disabled = !authorizationUrl;
    action('create-repository').disabled = busy;
    dialog.setAttribute('aria-busy', String(busy));
    fileName.disabled = busy || !saveEnabled.checked;
    saveEnabled.disabled = busy;
    saveForm.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = busy || !account.authenticated || !repository?.exists || !saveEnabled.checked;
    folderForm.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach(item => { item.disabled = busy; });
    get('cloud-entries').querySelectorAll<HTMLButtonElement>('button').forEach(item => { item.disabled = busy || intent === 'save' && item.dataset.type === 'file'; });
    get('cloud-breadcrumb').querySelectorAll<HTMLButtonElement>('button').forEach(item => { item.disabled = busy; });
  }
  async function perform(operation: (signal: AbortSignal) => Promise<void>) {
    if (busy) return;
    const stamp = generation;
    busy = true; redraw();
    try { await operation(controller.signal); }
    catch (error) { if (stamp === generation) showError(error); }
    finally { if (stamp === generation) { busy = false; redraw(); } }
  }
  function renderEntries() {
    const list = get('cloud-entries'); list.replaceChildren();
    for (const entry of entries) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.type = entry.type;
      button.className = 'cloud-entry'; button.setAttribute('aria-label', `${entry.type === 'dir' ? '文件夹' : '打开'} ${entry.name}`);
      const glyph = document.createElement('i'); glyph.dataset.lucide = entry.type === 'dir' ? 'folder' : 'file-text';
      const title = document.createElement('span'); title.textContent = entry.name;
      const detail = document.createElement('small');
      detail.textContent = entry.type === 'dir' ? '文件夹' : entry.size === undefined ? '' : entry.size < 1024 ? `${entry.size} B` : `${Math.ceil(entry.size / 1024)} KB`;
      button.append(glyph, title, detail);
      button.onclick = () => void perform(async signal => {
        if (entry.type === 'dir') await listFolder(entry.path, signal);
        else {
          setStatus('正在打开文档…');
          await options.openDocument(account.login!, entry.path);
          if (!signal.aborted) dialog.close();
        }
      });
      list.append(button);
    }
    if (!entries.length) { const empty = document.createElement('p'); empty.className = 'cloud-empty'; empty.textContent = '此目录没有文档'; list.append(empty); }
    const breadcrumb = get('cloud-breadcrumb'); breadcrumb.replaceChildren();
    const segments = ['MiniMarkDisk', ...folder.split('/').filter(Boolean)];
    for (let index = 0; index < segments.length; index++) {
      if (index > 0) { const separator = document.createElement('span'); separator.textContent = '/'; separator.setAttribute('aria-hidden', 'true'); breadcrumb.append(separator); }
      const button = document.createElement('button'); button.type = 'button'; button.textContent = segments[index];
      const target = index === 0 ? '' : segments.slice(1, index + 1).join('/');
      if (index === segments.length - 1) button.setAttribute('aria-current', 'location');
      button.onclick = () => void perform(signal => listFolder(target, signal));
      breadcrumb.append(button);
    }
    createIcons({ icons, root: list, attrs: { 'stroke-width': 1.65 } });
    redraw();
  }
  async function listFolder(path: string, signal: AbortSignal) {
    setStatus('正在读取目录…');
    const data = await cloudRequest<unknown>('list', { owner: account.login, path }, signal);
    if (signal.aborted) return;
    entries = readCloudEntries(data, path); folder = path;
    folderForm.hidden = true; folderName.value = '';
    renderEntries(); setStatus('');
  }
  async function createRepository(signal: AbortSignal) {
    if (!confirm(`在 GitHub 账号 ${account.login} 中创建私有仓库 MiniMarkDisk？`)) { setStatus('尚未创建仓库。'); return; }
    setStatus('正在创建私有仓库…');
    const result = await cloudRequest<CloudRepository>('createRepository', {}, signal);
    if (signal.aborted) return;
    repository = result; redraw();
    await listFolder('', signal);
  }
  async function loadRepository(signal: AbortSignal, offerCreate: boolean) {
    const result = await cloudRequest<CloudRepository>('repository', {}, signal);
    if (signal.aborted) return;
    repository = result;
    redraw();
    if (repository.exists) await listFolder(folder, signal);
    else if (offerCreate) await createRepository(signal);
    else setStatus('MiniMarkDisk 尚未创建。');
  }
  async function refresh(signal: AbortSignal) {
    setStatus('正在连接 GitHub…');
    const result = await cloudRequest<CloudAccount>('status', {}, signal);
    if (signal.aborted) return;
    account = result; repository = undefined; redraw();
    if (account.authenticated && account.login) await loadRepository(signal, false);
    else setStatus(account.configured ? '尚未登录 GitHub。' : '此版本尚未配置 GitHub 登录。');
  }
  function beginSave() {
    intent = 'save';
    const snapshot = options.snapshot();
    fileName.value = snapshot.cloud?.path.split('/').at(-1) ?? snapshot.name;
    saveEnabled.checked = true;
    redraw();
  }
  async function login(signal: AbortSignal) {
    setStatus('正在发起 GitHub 登录…');
    authenticating = true; authorizationUrl = '';
    get('cloud-user-code').textContent = '';
    redraw();
    const auth = await cloudRequest<DeviceAuthorization>('startLogin', {}, signal);
    if (signal.aborted) return;
    const url = new URL(auth.verificationUri);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password) throw new Error('GitHub 授权地址无效。');
    authorizationUrl = url.href; authenticating = true;
    get('cloud-user-code').textContent = auth.userCode; redraw();
    send('openExternal', { url: authorizationUrl });
    let interval = Math.max(5, Number(auth.interval) || 5);
    const expiresAt = Date.now() + Math.min(1800, Math.max(1, Number(auth.expiresIn) || 900)) * 1000;
    setStatus('等待 GitHub 授权…');
    while (!signal.aborted && Date.now() < expiresAt) {
      await wait(interval * 1000, signal);
      const poll = await cloudRequest<LoginPoll>('pollLogin', {}, signal);
      if (signal.aborted) return;
      if (poll.authenticated && poll.login) {
        authenticating = false; authorizationUrl = '';
        account = { authenticated: true, login: poll.login, configured: true }; folder = '';
        redraw(); await loadRepository(signal, true); return;
      }
      interval = Math.max(interval, Number(poll.interval) || interval);
      if (!poll.pending) throw new Error('GitHub 登录未完成，请重试。');
    }
    if (!signal.aborted) throw new Error('GitHub 授权码已过期，请重新登录。');
  }
  function cancelPendingLogin() {
    if (!authenticating) return;
    authenticating = false; authorizationUrl = '';
    void cloudRequest('cancelLogin').catch(() => {});
  }
  function resetRequests() {
    generation++; controller.abort(); controller = new AbortController(); busy = false;
    cancelPendingLogin();
  }
  function documentChanged() {
    const snapshot = options.snapshot();
    if (snapshot.id !== currentDocumentId) {
      currentDocumentId = snapshot.id;
      fileName.value = snapshot.cloud?.path.split('/').at(-1) ?? snapshot.name;
    }
    redraw();
  }
  action('login').onclick = () => void perform(async signal => {
    try { await login(signal); }
    finally { if (!signal.aborted) { cancelPendingLogin(); redraw(); } }
  });
  action('authorize').onclick = () => { if (authorizationUrl) send('openExternal', { url: authorizationUrl }); };
  action('cancel-login').onclick = () => { resetRequests(); setStatus('已取消登录。'); redraw(); };
  action('logout').onclick = () => void perform(async signal => {
    await cloudRequest('logout', {}, signal);
    if (signal.aborted) return;
    account = { authenticated: false, configured: account.configured }; repository = undefined; entries = []; folder = '';
    renderEntries(); setStatus('已退出 GitHub。');
  });
  action('create-repository').onclick = () => void perform(createRepository);
  action('up').onclick = () => void perform(signal => listFolder(parentCloudPath(folder), signal));
  action('refresh').onclick = () => void perform(signal => listFolder(folder, signal));
  action('new-folder').onclick = () => { folderForm.hidden = !folderForm.hidden; if (!folderForm.hidden) folderName.focus(); };
  action('cancel-folder').onclick = () => { folderForm.hidden = true; folderName.value = ''; };
  action('close').onclick = () => dialog.close();
  action('save-current').onclick = beginSave;
  saveEnabled.onchange = redraw;
  enabled.onchange = () => {
    if (enabled.checked) beginSave();
    else void perform(async () => {
      await options.detachDocument(); documentChanged(); setStatus('已切换为本地文档。');
    });
    redraw();
  };
  folderForm.onsubmit = event => {
    event.preventDefault();
    void perform(async signal => {
      const path = joinCloudPath(folder, cloudFolderName(folderName.value));
      setStatus('正在创建文件夹…');
      await cloudRequest('folder', { owner: account.login, path }, signal);
      if (!signal.aborted) await listFolder(folder, signal);
    });
  };
  saveForm.onsubmit = event => {
    event.preventDefault();
    if (!saveEnabled.checked || !account.login || !repository?.exists) return;
    void perform(async signal => {
      const path = joinCloudPath(folder, cloudFileName(fileName.value));
      const snapshot = options.snapshot();
      if (entries.some(entry => entry.path === path) && !(snapshot.cloud?.owner.toLowerCase() === account.login?.toLowerCase() && snapshot.cloud?.path === path)) throw new Error('此目录中已有同名文档，请更换文件名。');
      setStatus('正在保存云文档…');
      await options.bindDocument(account.login!, path);
      if (signal.aborted) return;
      documentChanged(); options.notice('已保存至云文档。'); dialog.close();
    });
  };
  dialog.addEventListener('close', () => { resetRequests(); redraw(); });
  return {
    open(next: 'browse' | 'save' = 'browse') {
      resetRequests(); intent = next; folder = ''; entries = []; repository = undefined;
      currentDocumentId = ''; documentChanged();
      if (next === 'save') beginSave();
      if (!dialog.open) dialog.showModal();
      void perform(refresh);
    },
    handleMessage: handleCloudResponse,
    documentChanged,
  };
}
