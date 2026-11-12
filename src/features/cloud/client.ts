import { isDesktop, send } from '../../platform/bridge';

export interface CloudResponse {
  type: 'cloudResponse';
  requestId: string;
  data?: unknown;
  error?: string;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort(): void;
}

const pending = new Map<string, PendingRequest>();

function remove(id: string) {
  const request = pending.get(id);
  if (!request) return;
  clearTimeout(request.timer);
  request.signal?.removeEventListener('abort', request.abort);
  pending.delete(id);
  return request;
}

export function cloudRequest<T>(action: string, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  if (!isDesktop) return Promise.reject(new Error('云文档仅支持桌面版。'));
  if (signal?.aborted) return Promise.reject(new DOMException('操作已取消。', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const abort = () => remove(requestId)?.reject(new DOMException('操作已取消。', 'AbortError'));
    const timer = setTimeout(() => remove(requestId)?.reject(new Error('GitHub 请求超时，请重试。')), 45000);
    pending.set(requestId, { resolve: value => resolve(value as T), reject, timer, signal, abort });
    signal?.addEventListener('abort', abort, { once: true });
    try { send('cloudRequest', { ...payload, requestId, action }); }
    catch (error) { remove(requestId)?.reject(error instanceof Error ? error : new Error('无法发送云文档请求。')); }
  });
}

export function handleCloudResponse(message: { type: string }): boolean {
  if (message.type !== 'cloudResponse') return false;
  const response = message as CloudResponse;
  const request = remove(response.requestId);
  if (!request) return true;
  if (response.error) request.reject(new Error(response.error));
  else request.resolve(response.data);
  return true;
}
