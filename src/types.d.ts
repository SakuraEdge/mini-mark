declare module 'markdown-it-texmath';
declare module 'markdown-it-task-lists';

interface Window {
  chrome?: {
    webview?: {
      postMessage: (message: unknown) => void;
      addEventListener: (type: 'message', callback: (event: MessageEvent) => void) => void;
    };
  };
  __MOYE_READY__?: number;
}
