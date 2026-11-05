import { createIcons, Download, FilePlus2, FolderOpen, Play, Save, Trash2, X } from 'lucide';
import { executePlugin } from './runtime';
import { loadPlugins, parseManifest, parseResult, savePlugins, type Plugin, type PluginContext, type PluginResult } from './model';
import template from './writing-tools.js?raw';
import { send } from '../../platform/bridge';

export interface PluginSnapshot { documentId: string; revision: number; context: PluginContext; editable: boolean }
interface Options {
  snapshot(): PluginSnapshot;
  apply(snapshot: PluginSnapshot, result: PluginResult): void;
  notice(message: string): void;
}
export function initializePlugins(options: Options) {
  let plugins = loadPlugins();
  let selected: string | undefined;
  let busy = false;
  const dialog = document.createElement('dialog');
  dialog.id = 'plugins-dialog'; dialog.className = 'feature-dialog plugins-dialog';
  dialog.setAttribute('aria-labelledby', 'plugins-title');
  dialog.innerHTML = `
    <header><h2 id="plugins-title">插件</h2><button class="icon-button" data-action="close" title="关闭" aria-label="关闭插件窗口"><i data-lucide="x"></i></button></header>
    <div class="plugin-toolbar">
      <button data-action="import"><i data-lucide="folder-open"></i>导入</button>
      <button data-action="new"><i data-lucide="file-plus-2"></i>新建</button>
      <button data-action="download" title="导出源码" aria-label="导出插件源码"><i data-lucide="download"></i></button>
    </div>
    <div class="plugin-workspace"><nav class="plugin-list" aria-label="已安装插件"></nav>
      <section class="plugin-detail">
        <div class="plugin-detail-heading"><strong id="plugin-name">新插件</strong><label><input id="plugin-enabled" type="checkbox">启用</label></div>
        <div class="plugin-commands" aria-label="插件命令"></div>
        <label class="code-label" for="plugin-source">JavaScript 源码</label>
        <textarea id="plugin-source" spellcheck="false" autocapitalize="off" aria-label="插件源码"></textarea>
        <div class="plugin-detail-footer"><button data-action="remove" title="移除插件" aria-label="移除插件"><i data-lucide="trash-2"></i></button><span id="plugin-status" role="status"></span><button class="primary" data-action="save"><i data-lucide="save"></i>保存插件</button></div>
      </section>
    </div>`;
  document.body.append(dialog);
  createIcons({ icons: { Download, FilePlus2, FolderOpen, Play, Save, Trash2, X }, root: dialog });
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.js,text/javascript,application/javascript';
  const source = dialog.querySelector<HTMLTextAreaElement>('#plugin-source')!;
  const enabled = dialog.querySelector<HTMLInputElement>('#plugin-enabled')!;
  const status = dialog.querySelector<HTMLElement>('#plugin-status')!;
  const action = (name: string) => dialog.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!;
  function persist(next: Plugin[]) {
    savePlugins(next); plugins = next;
  }
  function current() { return plugins.find(plugin => plugin.id === selected); }
  function setBusy(value: boolean) {
    busy = value;
    dialog.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = value; });
    source.disabled = value; enabled.disabled = value || !current();
    if (!value) action('remove').disabled = !current();
  }
  function statusError(error: unknown) { status.textContent = error instanceof Error ? error.message : '插件操作失败。'; }
  function canLeave() { return busy ? false : !source.value || source.value === current()?.source || confirm('插件源码尚未保存，放弃本次源码修改吗？'); }
  function renderList() {
    const list = dialog.querySelector('.plugin-list')!;
    list.replaceChildren();
    for (const plugin of plugins) {
      const button = document.createElement('button');
      button.className = plugin.id === selected ? 'selected' : '';
      button.setAttribute('aria-pressed', String(plugin.id === selected));
      const title = document.createElement('span'); title.textContent = plugin.name;
      const version = document.createElement('small'); version.textContent = `${plugin.version} · ${plugin.enabled ? '已启用' : '已停用'}`;
      button.append(title, version);
      button.onclick = () => { if (canLeave()) select(plugin.id); };
      list.append(button);
    }
    if (!plugins.length) { const empty = document.createElement('p'); empty.textContent = '暂无插件'; list.append(empty); }
  }
  function renderCommands() {
    const container = dialog.querySelector('.plugin-commands')!;
    container.replaceChildren();
    const plugin = current();
    for (const command of plugin?.commands ?? []) {
      const button = document.createElement('button');
      button.textContent = command.title;
      button.disabled = !plugin?.enabled;
      button.onclick = () => void run(command.id);
      container.append(button);
    }
  }
  function select(id?: string, code = template) {
    selected = id;
    source.value = current()?.source ?? code;
    enabled.checked = current()?.enabled ?? false; enabled.disabled = !current();
    dialog.querySelector('#plugin-name')!.textContent = current()?.name ?? '新插件';
    status.textContent = '';
    action('remove').disabled = !current();
    renderList(); renderCommands();
  }
  async function save() {
    if (busy) return;
    setBusy(true); status.textContent = '检查插件…';
    try {
      const manifest = parseManifest(await executePlugin(source.value));
      const duplicate = plugins.find(plugin => plugin.id === manifest.id && plugin.id !== selected);
      if (duplicate) throw new Error('该插件 id 已存在，请先选择对应插件再修改。');
      const plugin: Plugin = { ...manifest, source: source.value, enabled: current()?.enabled ?? true, state: current()?.state };
      const next = plugins.filter(item => item.id !== selected);
      next.push(plugin); persist(next); select(plugin.id); status.textContent = '已保存';
    } catch (error) { statusError(error); }
    finally { setBusy(false); renderCommands(); }
  }
  async function run(command: string) {
    const plugin = current();
    if (busy || !plugin?.enabled) return;
    if (source.value !== plugin.source) { status.textContent = '请先保存源码修改。'; return; }
    const snapshot = options.snapshot();
    if (!snapshot.documentId) return;
    setBusy(true); status.textContent = '正在执行…';
    try {
      const result = parseResult(await executePlugin(plugin.source, command, { ...snapshot.context, state: plugin.state }));
      options.apply(snapshot, result);
      if (result.state !== undefined) persist(plugins.map(item => item.id === plugin.id ? { ...item, state: result.state } : item));
      status.textContent = '执行完成';
      if (result.message) options.notice(result.message);
      if (result.panel) {
        const panel = document.createElement('dialog');
        panel.className = 'feature-dialog plugin-result';
        const heading = document.createElement('h2'); heading.textContent = result.panel.title;
        const pre = document.createElement('pre'); pre.textContent = result.panel.text;
        const close = document.createElement('button'); close.textContent = '关闭'; close.onclick = () => panel.close();
        panel.append(heading, pre, close); panel.addEventListener('close', () => panel.remove());
        document.body.append(panel); panel.showModal();
      }
    } catch (error) { statusError(error); }
    finally { setBusy(false); renderCommands(); }
  }
  enabled.onchange = () => {
    try { persist(plugins.map(plugin => plugin.id === selected ? { ...plugin, enabled: enabled.checked } : plugin)); renderList(); renderCommands(); }
    catch (error) { enabled.checked = current()?.enabled ?? false; statusError(error); }
  };
  action('save').onclick = () => void save();
  action('new').onclick = () => { if (canLeave()) select(); };
  action('close').onclick = () => { if (canLeave()) dialog.close(); };
  dialog.addEventListener('cancel', event => { if (!canLeave()) event.preventDefault(); });
  dialog.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
  });
  action('remove').onclick = () => {
    if (!current() || !confirm(`移除插件“${current()!.name}”？`)) return;
    try { persist(plugins.filter(plugin => plugin.id !== selected)); select(plugins[0]?.id, ''); }
    catch (error) { statusError(error); }
  };
  action('import').onclick = () => { if (canLeave()) input.click(); };
  input.onchange = async () => {
    const file = input.files?.[0]; input.value = '';
    if (!file) return;
    if (file.size > 200000) { status.textContent = '插件文件不能超过 200 KB。'; return; }
    try { select(undefined, await file.text()); }
    catch (error) { statusError(error); }
  };
  action('download').onclick = () => {
    send('exportPlugin', { name: `${selected ?? 'mini-mark-plugin'}.js`, source: source.value });
  };
  select(plugins[0]?.id, '');
  return {
    open() { if (!dialog.open) dialog.showModal(); },
  };
}
