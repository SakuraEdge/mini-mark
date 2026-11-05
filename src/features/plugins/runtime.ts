import type { PluginContext } from './model';

export function executePlugin(source: string, command?: string, context?: PluginContext): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const token = crypto.randomUUID();
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    frame.className = 'plugin-runtime';
    const url = new URL('plugin-host.html', document.baseURI);
    url.hash = token;
    frame.src = url.href;
    let sent = false;
    let finished = false;
    const finish = (error?: string, value?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      frame.remove();
      if (error) reject(new Error(error)); else resolve(value);
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.miniMarkPlugin !== token) return;
      if (event.data.ready && !sent) {
        sent = true;
        frame.contentWindow!.postMessage({ token, source, command, context }, '*');
        return;
      }
      if (!sent) return;
      if (event.data.error) finish(String(event.data.error).slice(0, 500));
      else if (event.data.result) {
        const result = event.data.result;
        finish(result.error ? String(result.error).slice(0, 500) : undefined, result.value);
      }
    };
    const timer = setTimeout(() => finish('插件运行超时，已停止执行。'), 4000);
    window.addEventListener('message', receive);
    document.body.append(frame);
  });
}
