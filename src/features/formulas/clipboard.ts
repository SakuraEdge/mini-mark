import { send, type HostMessage } from '../../platform/bridge';

export interface EquationData { mathml: string; omml: string; html: string }
const pending = new Map<string, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();

export function copyEquation(data: EquationData): Promise<void> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('复制超时，请重试。')); }, 10000);
    pending.set(requestId, { resolve, reject, timer });
    send('copyEquation', { requestId, ...data });
  });
}

export function handleFormulaMessage(message: HostMessage) {
  if (message.type !== 'equationCopied') return false;
  const request = pending.get(message.requestId);
  if (!request) return true;
  pending.delete(message.requestId); clearTimeout(request.timer);
  if (message.error) request.reject(new Error(message.error));
  else request.resolve();
  return true;
}
