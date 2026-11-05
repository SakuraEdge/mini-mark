export interface PluginCommand { id: string; title: string }
export interface PluginManifest { id: string; name: string; version: string; commands: PluginCommand[] }
export interface Plugin extends PluginManifest { source: string; enabled: boolean; state?: unknown }
export interface PluginContext {
  text: string; name: string; language: string;
  selection: { from: number; to: number }; selectedText: string; state?: unknown;
}
export interface PluginResult {
  replaceSelection?: string; replaceDocument?: string;
  message?: string; panel?: { title: string; text: string }; state?: unknown;
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9.-]{0,63}$/.test(value);
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }

export function parseManifest(value: unknown): PluginManifest {
  if (!object(value) || !identifier(value.id) || !text(value.name, 80) || !text(value.version, 30) ||
    !Array.isArray(value.commands) || !value.commands.length || value.commands.length > 30) throw new Error('插件信息无效，请检查 id、name、version 和 commands。');
  const commands = value.commands.map(item => {
    if (!object(item) || !identifier(item.id) || !text(item.title, 80)) throw new Error('插件命令需要有效的 id 和 title。');
    return { id: item.id, title: item.title };
  });
  if (new Set(commands.map(command => command.id)).size !== commands.length) throw new Error('插件命令 id 不能重复。');
  return { id: value.id, name: value.name, version: value.version, commands };
}

export function parseResult(value: unknown): PluginResult {
  if (value == null) return {};
  if (!object(value)) throw new Error('插件结果必须是对象。');
  if (Object.keys(value).some(key => !['replaceSelection', 'replaceDocument', 'message', 'panel', 'state'].includes(key))) throw new Error('插件返回了不支持的结果字段。');
  const result: PluginResult = {};
  for (const key of ['replaceSelection', 'replaceDocument', 'message'] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string' || value[key].length > (key === 'message' ? 500 : 2_000_000)) throw new Error('插件返回的文字过长或格式无效。');
    result[key] = value[key];
  }
  if (result.replaceSelection !== undefined && result.replaceDocument !== undefined) throw new Error('一个命令只能选择一种替换方式。');
  if (value.panel !== undefined) {
    if (!object(value.panel) || !text(value.panel.title, 100) || typeof value.panel.text !== 'string' || value.panel.text.length > 100000) throw new Error('插件结果面板无效。');
    result.panel = { title: value.panel.title, text: value.panel.text };
  }
  if (value.state !== undefined) {
    const serialized = JSON.stringify(value.state);
    if (serialized.length > 65536) throw new Error('插件状态超过 64 KB。');
    result.state = JSON.parse(serialized);
  }
  return result;
}

const storageKey = 'minimark.plugins.v1';
export function loadPlugins(): Plugin[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(raw) || raw.length > 50) return [];
    const result: Plugin[] = [];
    for (const item of raw) {
      try {
        if (!object(item) || !text(item.source, 200000)) continue;
        const manifest = parseManifest(item);
        if (result.some(plugin => plugin.id === manifest.id)) continue;
        const state = parseResult({ state: item.state }).state;
        result.push({ ...manifest, source: item.source, enabled: item.enabled === true, state });
      } catch { /* One broken plugin must not prevent the editor from opening. */ }
    }
    return result;
  } catch { return []; }
}
export function savePlugins(plugins: Plugin[]) {
  if (plugins.length > 50) throw new Error('最多安装 50 个插件。');
  localStorage.setItem(storageKey, JSON.stringify(plugins));
}
