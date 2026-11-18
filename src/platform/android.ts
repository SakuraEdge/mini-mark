// Android injects this object only into the trusted, top-level application origin.
const channel = typeof window === 'undefined' ? undefined : window.MiniMarkNative;
export const isAndroid = Boolean(channel) || typeof location !== 'undefined' && new URLSearchParams(location.search).get('android') === '1';

if (channel) {
  const listeners = new Set<(event: MessageEvent) => void>();
  channel.onmessage = event => {
    try {
      const message = JSON.parse(String(event.data));
      listeners.forEach(listener => listener(new MessageEvent('message', { data: message })));
    } catch { /* Malformed native messages cannot become application actions. */ }
  };
  window.chrome ??= {};
  window.chrome.webview = {
    postMessage: message => channel.postMessage(JSON.stringify(message)),
    addEventListener: (_type, callback) => { listeners.add(callback); },
  };
  document.documentElement.classList.add('android-app');
}
if (isAndroid) document.documentElement.classList.add('android-app');
