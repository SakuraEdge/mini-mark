import { send } from '../../platform/bridge';
import type { FolderResult } from './model';

interface Pending { resolve(value: unknown): void; reject(error: Error): void; timer?: ReturnType<typeof setTimeout> }
const pending = new Map<string, Pending>();
export function folderRequest(action: 'choose' | 'restore' | 'list' | 'close', payload: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = action === 'choose' ? undefined : setTimeout(() => {
      pending.delete(requestId); reject(new Error('工作区读取超时，请重试。'));
    }, 30000);
    pending.set(requestId, { resolve, reject, timer });
    send('folderRequest', { ...payload, requestId, action });
  });
}
export function handleFolderMessage(message: { type: string }) {
  if (message.type !== 'folderResponse') return false;
  const response = message as { type: string; requestId: string; data?: FolderResult; error?: string };
  const request = pending.get(response.requestId);
  if (!request) return true;
  clearTimeout(request.timer); pending.delete(response.requestId);
  if (response.error) request.reject(new Error(response.error));
  else request.resolve(response.data);
  return true;
}
