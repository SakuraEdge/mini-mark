export interface CloudBinding {
  owner: string;
  path: string;
  sha?: string;
  baseline: string;
}

export interface CloudAccount {
  authenticated: boolean;
  login?: string;
  configured: boolean;
}

export interface CloudRepository {
  exists: boolean;
  login?: string;
  defaultBranch?: string;
  private?: boolean;
}

export interface CloudEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  sha?: string;
  size?: number;
}

export interface DeviceAuthorization {
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
}

export interface LoginPoll {
  pending?: boolean;
  interval?: number;
  authenticated?: boolean;
  login?: string;
}

export const cloudExtensions = /\.(?:md|markdown|mdown|txt|yaml|yml|html|htm)$/i;

export function cloudPath(value: string, allowRoot = false): string {
  if (allowRoot && value === '') return '';
  if (!value || value.length > 1024 || /[\\\u0000-\u001f\u007f]/.test(value)) throw new Error('文件路径无效。');
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw new Error('文件路径无效。');
  return parts.join('/');
}

export function cloudFileName(value: string): string {
  const name = value.trim();
  if (name.includes('/')) throw new Error('文件名不能包含目录分隔符。');
  cloudPath(name);
  if (!cloudExtensions.test(name)) throw new Error('请选择 Markdown、YAML、HTML 或 TXT 文件名。');
  return name;
}

export function cloudFolderName(value: string): string {
  const name = value.trim();
  if (name.includes('/')) throw new Error('文件夹名称不能包含目录分隔符。');
  return cloudPath(name);
}

export function parentCloudPath(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}

export function joinCloudPath(folder: string, name: string): string {
  return cloudPath(folder ? `${folder}/${name}` : name);
}

export function readCloudEntries(value: unknown, folder: string): CloudEntry[] {
  if (!value || typeof value !== 'object' || !('entries' in value) || !Array.isArray(value.entries)) throw new Error('云端目录格式无效。');
  const entries: CloudEntry[] = [];
  for (const item of value.entries) {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string' || typeof item.path !== 'string' || !['file', 'dir'].includes(item.type)) continue;
    if (item.name === '.gitkeep' || item.name.includes('/') || item.name.includes('\\')) continue;
    try {
      const path = cloudPath(item.path);
      if (parentCloudPath(path) !== folder || path.split('/').at(-1) !== item.name) continue;
      if (item.type === 'file' && !cloudExtensions.test(item.name)) continue;
      entries.push({ name: item.name, path, type: item.type, sha: typeof item.sha === 'string' ? item.sha : undefined, size: typeof item.size === 'number' ? item.size : undefined });
    } catch { /* Ignore entries outside this directory. */ }
  }
  return entries.sort((a, b) => Number(b.type === 'dir') - Number(a.type === 'dir') || a.name.localeCompare(b.name, 'zh-CN'));
}
